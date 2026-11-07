// L6 (LOAD-CONTRACT v1 §3): the viewer reconnects with jitter capped at 30 s, waits at least 5 s after a 1013 (hub full /
// world unavailable), and keeps the hub's `{t:'load', level}` hint as `conn.load` without treating it as an error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Connection } from '@souls/client';

type Fake = { send(s: string): void; close(): void; readyState: number; onopen: any; onmessage: any; onclose: any; onerror: any };
function rig(t: import('node:test').TestContext, handlers: Record<string, unknown> = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const made: Fake[] = [];
  const c = new Connection('ws://world.invalid/ws', async () => null, handlers as never, () => { const ws: Fake = { send() {}, close() {}, readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null }; made.push(ws); return ws as never; });
  c.connect();
  t.after(() => c.close());
  return { made, c };
}

test('a 1013 close waits at least 5 s before the next try', (t) => {
  const random = t.mock.method(Math, 'random', () => 0);
  const { made } = rig(t);
  made[0].onclose({ code: 1013 });
  t.mock.timers.tick(4_999);
  assert.equal(made.length, 1, 'no retry inside the 5 s floor');
  t.mock.timers.tick(2);
  assert.equal(made.length, 2);
  random.mock.restore();
});

test('repeated closes back off to at most 30 s, never less than half the window', (t) => {
  const random = t.mock.method(Math, 'random', () => 0.999999);
  const { made } = rig(t);
  for (let i = 0; i < 12; i++) { made.at(-1)!.onclose({ code: 1006 }); t.mock.timers.tick(30_000); }
  assert.equal(made.length, 13, 'every try came back within the 30 s cap');
  random.mock.restore(); const low = t.mock.method(Math, 'random', () => 0);
  made.at(-1)!.onclose({ code: 1006 });
  t.mock.timers.tick(14_999);
  assert.equal(made.length, 13, 'at the cap the floor is 15 s');
  t.mock.timers.tick(2);
  assert.equal(made.length, 14);
  low.mock.restore();
});

test("the hub's {t:'load'} frame sets conn.load and calls onLoad; unknown levels are ignored", (t) => {
  const seen: string[] = [];
  const { made, c } = rig(t, { onLoad: (l: string) => seen.push(l) });
  for (const level of ['amber', 'purple', 'green']) made[0].onmessage({ data: JSON.stringify({ t: 'load', level }) });
  assert.deepEqual(seen, ['amber', 'green']);
  assert.equal(c.load, 'green');
});
