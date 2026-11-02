// Scenario diagnostics only. Never include response bodies, credentials or request headers in gate logs.
const code = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(value) ? value : 'unknown';
const seconds = value => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 'unknown';
const diagnostic = response => {
  const data = response?.data;
  const load = ['green', 'amber', 'red', 'black'].includes(data?.world?.load) ? data.world.load : 'unknown';
  return `HTTP ${response?.status ?? 'unknown'} code=${code(data?.error?.code)} retryAfterS=${seconds(response?.retryAfter ?? data?.world?.retry_after_s)} load=${load}`;
};

// Only safe reads use this function. Refused writes must never be repeated by a scenario.
// The admission contract sends numeric Retry-After seconds; HTTP-date values fail rather than being guessed.
export async function edgeRead(request, { now = Date.now, deadline = now() + 120_000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onRetry = message => console.log(message) } = {}) {
  let last;
  while (now() < deadline) {
    const response = await request(Math.max(1, deadline - now()));
    if (response.status === 200) return response;
    last = diagnostic(response);
    const error = response.data?.error?.code;
    const transient = response.status === 503 && error === 'world.busy'
      || response.status === 429 && ['soul.slow-down', 'soul.busy'].includes(error);
    const retryS = seconds(response.retryAfter ?? response.data?.world?.retry_after_s);
    if (!transient || retryS === 'unknown' || retryS <= 0) throw new Error(`edge read ${last}`);
    if (now() + retryS * 1000 >= deadline) break;
    onRetry(`edge read retry: ${last}`);
    await sleep(retryS * 1000);
  }
  throw new Error(`edge read deadline exhausted; ${last ?? 'no request attempted'}`);
}

export function observation(response) {
  const data = response?.data;
  const position = data?.self?.position;
  if (response?.status === 200 && Array.isArray(position) && position.length === 3 && position.every(Number.isFinite)) return data;
  throw new Error(`edge observation ${diagnostic(response)}; missing or invalid self.position`);
}
