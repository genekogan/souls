// #371 H-b: every HTTP answer carries x-handler-ms, the server's own wall time for the request, so a late answer can be
// split into server time and the client's own time (eden.mjs prints both with EDEN_TRACE=1). Refusals and errors too.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../test/native-owner-fixture.ts';

test('x-handler-ms on a normal answer, a 404 and a body-size refusal: a non-negative number with one decimal', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => {f.host.stop(); f.db.close();});
  const ok = await f.app.request('/healthz'), missing = await f.app.request('/v1/no-such-route');
  const big = await f.app.request('/v1/edge/say', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text: 'x'.repeat(2_000_000)})});
  assert.equal(ok.status, 200); assert.equal(missing.status, 404); assert.equal(big.status, 413);
  for (const r of [ok, missing, big]) {
    const h = r.headers.get('x-handler-ms');
    assert.match(h ?? '', /^\d+\.\d$/, `${r.status}: ${h}`); assert.ok(Number(h) >= 0);
  }
});
