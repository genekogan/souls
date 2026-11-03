// Scenario-only GET polling. One deadline covers requests and waits; writes never enter this helper.
const ADMISSION_CODES = { 429: new Set(['soul.busy', 'soul.slow-down']), 503: new Set(['world.busy']) };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class ScenarioReadError extends Error {
  constructor(reason, response, { elapsedMs = response?.elapsedMs ?? 0, attempts = 1, result } = {}) {
    const detail = { reason, status: response?.status ?? null, code: response?.data?.error?.code ?? null,
      message: response?.data?.error?.message ?? null, retryAfter: response?.retryAfter ?? null,
      elapsedMs: Math.round(elapsedMs), attempts, ...(result ? { result } : {}) };
    super('scenario read failed: ' + JSON.stringify(detail));
    this.name = 'ScenarioReadError';
    this.detail = detail;
  }
}

export function checkedCapabilities(response) {
  if (response.status !== 200) throw new ScenarioReadError('http-refusal', response);
  if (!Array.isArray(response.data?.capabilities)) throw new ScenarioReadError('invalid-capabilities-response', response);
  return response.data.capabilities;
}

function retryDelay(response, wallNow) {
  const header = response.retryAfter;
  const numeric = header == null || header.trim() === '' ? NaN : Number(header);
  const hints = [Number.isFinite(numeric) ? numeric * 1000 : header ? Date.parse(header) - wallNow() : NaN,
    response.data?.world?.retry_after_s == null ? NaN : Number(response.data.world.retry_after_s) * 1000]
    .filter(ms => Number.isFinite(ms) && ms >= 0);
  return hints.length ? Math.max(1, Math.ceil(Math.max(...hints))) : null;
}

/** `request` is the scenario's raw API adapter; only successful reads reach `check`. */
export async function pollAdmissionRead(request, path, check, { timeoutMs, as = 'soul', everyMs = 500,
  now = () => performance.now(), wallNow = Date.now, wait = sleep } = {}) {
  if (!(timeoutMs > 0) || !(everyMs > 0)) throw new Error('positive scenario read deadline and poll interval required');
  const started = now(), deadline = started + timeoutMs;
  let response, result, attempts = 0;
  const fail = reason => new ScenarioReadError(reason, response, { elapsedMs: now() - started, attempts, result });
  for (;;) {
    const remaining = deadline - now();
    if (remaining <= 0) throw fail('deadline');
    const controller = new AbortController();
    let timer;
    try {
      attempts++;
      response = await Promise.race([
        request(path, { method: 'GET', as, signal: controller.signal }),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail('deadline')); }, Math.ceil(remaining)); }),
      ]);
    } catch (error) {
      if (controller.signal.aborted || now() >= deadline) throw fail('deadline');
      throw error; // Network and non-admission failures are evidence, never an automatic retry.
    } finally { clearTimeout(timer); }
    if (now() >= deadline) throw fail('deadline');
    let delay;
    if (response.status === 200) {
      result = check(response);
      if (result?.ok) return result;
      delay = everyMs;
    } else {
      result = undefined;
      if (response.data?.contract !== 'eden-edge/1' || !ADMISSION_CODES[response.status]?.has(response.data?.error?.code)) throw fail('http-refusal');
      delay = retryDelay(response, wallNow);
      if (delay === null) throw fail('admission-without-retry-guidance');
      if (now() + delay >= deadline) throw fail('retry-after-exceeds-deadline');
    }
    await wait(Math.min(delay, Math.max(0, deadline - now())));
  }
}
