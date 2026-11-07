// G9 (lane Z1): a viewer whose world closes its socket with 1001 "server restarting" (a release handover) tries again
// within 150 ms; any other close, or a second close before a welcome, keeps the exponential backoff (>= 250 ms first).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Connection } from '@souls/client';

type Fake = { send(s: string): void; close(): void; readyState: number; onopen: any; onmessage: any; onclose: any; onerror: any };
function rig(t: import('node:test').TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const made: Fake[] = [];
  const c = new Connection('ws://world.invalid/ws', async () => null, {}, () => { const ws: Fake = { send() {}, close() {}, readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null }; made.push(ws); return ws; });
  c.connect();
  t.after(() => c.close());
  return { made, c };
}

test('a 1001 close (server restarting) reconnects within 150 ms', (t) => {
  // The retry waits 50 + 100 * Math.random() ms. t4-quar (2026-10-21): pin both ends of the jitter; ticking 149 ms with a
  // live Math.random failed whenever it drew above 0.99 (V5-server-full, gate run-6b0abdefd).
  for (const r of [0, 0.999999]) {
    const random = t.mock.method(Math, 'random', () => r);
    const { made, c } = rig(t);
    made[0].onclose({ code: 1001 });
    t.mock.timers.tick(49);
    assert.equal(made.length, 1, `random ${r}: no retry before 50 ms`);
    t.mock.timers.tick(101);
    assert.equal(made.length, 2, `random ${r}: a second socket is opened within 150 ms`);
    c.close(); random.mock.restore(); t.mock.timers.reset();
  }
});

test('another close, or a second 1001 before a welcome, waits the backoff', (t) => {
  const { made } = rig(t);
  made[0].onclose({ code: 1006 });
  t.mock.timers.tick(200);
  assert.equal(made.length, 1, 'an abnormal close waits at least 250 ms');
  t.mock.timers.tick(600);
  assert.equal(made.length, 2);
  made[1].onclose({ code: 1001 });
  t.mock.timers.tick(400);
  assert.equal(made.length, 2, 'not welcomed since: no fast retry, the backoff grows (>= 500 ms)');
});
