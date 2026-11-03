import test from 'node:test';
import assert from 'node:assert/strict';
import { Admission, admissionMiddleware } from '../../apps/server/src/load/admission.ts';
import { checkedCapabilities, pollAdmissionRead, ScenarioReadError } from '../god-skill/e2e/admission-read.mjs';

const path = '/v1/edge/capabilities';
const ready = { status: 200, data: { capabilities: [{ id: 'walk:mimos' }] }, retryAfter: null };
const check = response => ({ ok: checkedCapabilities(response).some(c => c.id === 'walk:mimos') });

// Use the server's real refusal encoder, without a server, credentials, or a live world.
async function refusal(admission, level) {
  const headers = new Headers();
  const context = { req: { path, method: 'GET', header: () => undefined, raw: { signal: new AbortController().signal } },
    env: {}, res: { status: 200, headers }, set() {}, header: (key, value) => headers.set(key, value),
    json: (data, status) => Response.json(data, { status, headers }) };
  const response = await admissionMiddleware(admission, () => level, () => 'fixture')(context, () => { throw Error('refused read ran'); });
  return { status: response.status, data: await response.json(), retryAfter: response.headers.get('retry-after') };
}

test('a real admission 429 is retried only after its guidance, with a shared 30 s deadline', async t => {
  let clock = 0;
  const admission = new Admission({ now: () => clock }); t.after(() => admission.close());
  const first = admission.request({ key: 'soul:fixture', god: false,
    route: { cls: 'C2', id: 'edge:capabilities', god: false, deadlineMs: 8000 } });
  assert.equal(await first.turn, 'run'); clock = 2500; first.done(); admission.setLoadLevel('red');
  const response = await refusal(admission, 'red');
  assert.equal(response.status, 429); assert.equal(response.data.error.code, 'soul.slow-down');
  const hint = Number(response.retryAfter) * 1000;
  const started = clock, calls = [], waits = [];
  assert.deepEqual(await pollAdmissionRead(async (_, options) => {
    calls.push({ at: clock, method: options.method }); return calls.length === 1 ? response : ready;
  }, path, check, { timeoutMs: 30000, now: () => clock, wait: async ms => { waits.push(ms); clock += ms; } }), { ok: true });
  assert.deepEqual(waits, [hint]); assert.deepEqual(calls, [{ at: started, method: 'GET' }, { at: started + hint, method: 'GET' }]);
  assert.ok(clock < started + 30000); assert.equal(admission.shed.cooled, 0);
});

test('a real admission 503 retains its error and refuses a retry outside the remaining deadline', async t => {
  const admission = new Admission(); t.after(() => admission.close()); admission.setLoadLevel('black');
  const response = await refusal(admission, 'black');
  assert.equal(response.status, 503); assert.equal(response.data.error.code, 'world.busy');
  let clock = 0, calls = 0; const waits = [];
  await assert.rejects(pollAdmissionRead(async () => { calls++; return response; }, path, check,
    { timeoutMs: 30000, now: () => clock, wait: async ms => { waits.push(ms); clock += ms; } }), error => {
    assert.ok(error instanceof ScenarioReadError);
    assert.deepEqual(error.detail, { reason: 'retry-after-exceeds-deadline', status: 503, code: 'world.busy',
      message: response.data.error.message, retryAfter: response.retryAfter, elapsedMs: 15000, attempts: 2 });
    return true;
  });
  assert.equal(calls, 2); assert.deepEqual(waits, [15000]);
});

test('server hints and successful-but-empty menus share one absolute deadline', async () => {
  let clock = 0; const calls = [], waits = [];
  const response = { status: 429, data: { contract: 'eden-edge/1', error: { code: 'soul.busy', message: 'pending read' }, world: { retry_after_s: 2 } }, retryAfter: '1' };
  await assert.rejects(pollAdmissionRead(async () => { calls.push(clock); return calls.length === 1 ? response : { status: 200, data: { capabilities: [] }, retryAfter: null }; }, path, check,
    { timeoutMs: 3000, now: () => clock, wait: async ms => { waits.push(ms); clock += ms; } }), error => {
    assert.equal(error.detail.reason, 'deadline'); assert.equal(error.detail.status, 200);
    assert.equal(error.detail.elapsedMs, 3000); assert.deepEqual(error.detail.result, { ok: false }); return true;
  });
  assert.deepEqual(calls, [0, 2000, 2500]); assert.deepEqual(waits, [2000, 500, 500]);
});

test('HTTP-date Retry-After is honored without resetting the monotonic deadline', async () => {
  let clock = 0, calls = 0;
  const wall = Date.UTC(2026, 0, 1);
  const response = { status: 503, data: { contract: 'eden-edge/1', error: { code: 'world.busy', message: 'busy' } }, retryAfter: new Date(wall + 2000).toUTCString() };
  await pollAdmissionRead(async () => ++calls === 1 ? response : ready, path, check,
    { timeoutMs: 3000, now: () => clock, wallNow: () => wall + clock, wait: async ms => { clock += ms; } });
  assert.equal(clock, 2000); assert.equal(calls, 2);
});

test('unrecognized errors and malformed success fail visibly without another request', async () => {
  for (const response of [
    { status: 401, data: { error: { code: 'unauthorized', message: 'sign in' } }, retryAfter: null },
    { status: 429, data: { contract: 'eden-edge/1', error: { code: 'rate-limited', message: 'rate limited' } }, retryAfter: '1' },
    { status: 503, data: { contract: 'eden-edge/1', error: { code: 'unavailable', message: 'ledger failed' } }, retryAfter: '1' },
    { status: 200, data: {}, retryAfter: null },
  ]) {
    let calls = 0;
    await assert.rejects(pollAdmissionRead(async () => { calls++; return response; }, path, check, { timeoutMs: 30000 }), ScenarioReadError);
    assert.equal(calls, 1);
  }
});

test('direct capability reads preserve refusal evidence instead of inventing an empty menu', () => {
  assert.throws(() => checkedCapabilities({ status: 429, data: { error: { code: 'soul.slow-down', message: 'wait' } }, retryAfter: '60', elapsedMs: 8 }), error => {
    assert.equal(error.detail.status, 429); assert.equal(error.detail.code, 'soul.slow-down');
    assert.equal(error.detail.retryAfter, '60'); assert.equal(error.detail.elapsedMs, 8); return true;
  });
  assert.deepEqual(checkedCapabilities({ status: 200, data: { capabilities: [] } }), []);
});

test('an in-flight read is aborted at the same deadline and cannot produce a late pass', async () => {
  let signal;
  await assert.rejects(pollAdmissionRead((_, options) => { signal = options.signal; return new Promise(() => {}); }, path, check, { timeoutMs: 20 }), error => {
    assert.equal(error.detail.reason, 'deadline'); assert.equal(error.detail.attempts, 1); return true;
  });
  assert.equal(signal.aborted, true);
});
