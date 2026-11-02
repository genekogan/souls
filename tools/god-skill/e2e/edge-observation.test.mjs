import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { edgeRead, observation } from './edge-observation.mjs';

test('valid observation preserves the original body and position', () => {
  const data = { self: { position: [1, 0, -3], activity: 'walk' }, tick: 42 };
  assert.equal(observation({ status: 200, data }), data);
});

test('refused reads report status, error code and retry metadata instead of a missing-self TypeError', () => {
  for (const [status, code] of [[503, 'world.busy'], [429, 'soul.slow-down'], [401, 'unauthorized']]) {
    assert.throws(() => observation({ status, retryAfter: '2', data: { error: { code, message: 'secret-body' }, world: { load: 'red' }, token: 'secret-token' } }), error => {
      assert.equal(error.name, 'Error');
      assert.match(error.message, new RegExp(`HTTP ${status} code=${code} retryAfterS=2 load=red`));
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  }
});

test('malformed successes and untrusted diagnostics fail without copying their raw content', () => {
  for (const position of [undefined, [0, 1], [0, NaN, 1], 'secret-position']) {
    assert.throws(() => observation({ status: 200, retryAfter: 'secret-retry', data: { self: { position }, error: { code: 'secret\nheader' }, world: { load: 'secret-load' } } }), error => {
      assert.match(error.message, /HTTP 200 code=unknown retryAfterS=unknown load=unknown/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  }
});

test('transient refused reads honor the full server delay inside the existing deadline', async () => {
  for (const [status, code] of [[429, 'soul.slow-down'], [429, 'soul.busy'], [503, 'world.busy']]) {
    let time = 0;
    const calls = [], logs = [];
    const success = { status: 200, data: { self: { position: [0, 0, 0] } } };
    const result = await edgeRead(async timeout => {
      calls.push({ at: time, timeout });
      return calls.length === 1 ? { status, retryAfter: '13', data: { error: { code, message: 'secret' }, world: { retry_after_s: 1, load: 'red' } } } : success;
    }, { now: () => time, deadline: 20_000, sleep: async ms => { time += ms; }, onRetry: message => logs.push(message) });
    assert.equal(result, success);
    assert.deepEqual(calls, [{ at: 0, timeout: 20_000 }, { at: 13_000, timeout: 7_000 }]);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0], /secret/);
  }
});

test('repeated refusals cannot extend a journey deadline or retry before Retry-After', async () => {
  let time = 0;
  const calls = [];
  await assert.rejects(edgeRead(async timeout => {
    calls.push({ at: time, timeout });
    return { status: 503, retryAfter: '1', data: { error: { code: 'world.busy' } } };
  }, { now: () => time, deadline: 3_000, sleep: async ms => { time += ms; }, onRetry: () => {} }), /deadline exhausted; HTTP 503 code=world.busy/);
  assert.deepEqual(calls, [{ at: 0, timeout: 3_000 }, { at: 1_000, timeout: 2_000 }, { at: 2_000, timeout: 1_000 }]);
  assert.equal(time, 2_000);
});

test('permanent errors, missing retry instructions and transport failures are never retried', async () => {
  for (const response of [
    { status: 401, data: { error: { code: 'unauthorized' } } },
    { status: 500, retryAfter: '1', data: { error: { code: 'world.busy' } } },
    { status: 429, retryAfter: '1', data: { error: { code: 'unknown' } } },
    { status: 503, data: { error: { code: 'world.busy' } } },
    { status: 503, retryAfter: '0', data: { error: { code: 'world.busy' } } },
  ]) {
    let calls = 0;
    await assert.rejects(edgeRead(async () => { calls++; return response; }, { sleep: async () => assert.fail('must not wait'), onRetry: () => assert.fail('must not retry') }), /edge read HTTP/);
    assert.equal(calls, 1);
  }
  const offline = new Error('connection failed');
  await assert.rejects(edgeRead(async () => { throw offline; }), error => error === offline);
});

test('an expired walk still returns its terminal observation and running phase for the normal assertion to reject', async () => {
  // Exercise the actual scenario's soulDoes function with a virtual clock and transport: no server or extra wait.
  const source = readFileSync(new URL('./lm-two.mjs', import.meta.url), 'utf8');
  const functionSource = source.slice(source.indexOf('async function soulDoes('), source.indexOf('/** The longest time'));
  let time = 0;
  const deadlines = [];
  const soulDoes = runInNewContext(`${functionSource}; soulDoes`, {
    Date: { now: () => time },
    api: async () => ({ data: { accepted: true, receipt: { id: 'test-receipt', phase: 'running' } } }),
    read: async () => ({ data: { receipt: { phase: 'running' } } }),
    observe: async (soul, deadline) => {
      deadlines.push(deadline);
      return observation(await edgeRead(async () => ({ status: 200, data: { self: { position: [0, 0, 0], activity: 'walk' }, tick: 1 } }), { now: () => time, deadline }));
    },
    sleep: async ms => { time += ms; },
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
    xz: p => [p[0], p[2]],
  });
  const result = await soulDoes({}, 'walk:test', { maxS: 1 });
  assert.equal(result.phase, 'running');
  assert.equal(result.samples.length, 2);
  assert.deepEqual([...result.end.p], [0, 0, 0]);
  assert.deepEqual(deadlines, [1000, 1000, 31_400]);
});
