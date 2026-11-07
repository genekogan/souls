import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { testPort } from '../test/test-port.ts';

const hold = async (port: number) => { const s = createServer(); s.listen(port, '127.0.0.1'); await once(s, 'listening'); return s; };

test('a test port is free, below the ephemeral range, and can be bound again after it is released', async () => {
  const port = await testPort();
  assert.ok(port >= 10_000 && port < 32_000, String(port));
  for (let i = 0; i < 2; i++) { const s = await hold(port); await new Promise(r => s.close(r)); }
});

test('a block is consecutive and every port in it is free', async () => {
  const base = await testPort(12);
  assert.ok(base + 11 < 32_000);
  const held = await Promise.all(Array.from({ length: 12 }, (_, i) => hold(base + i)));
  await Promise.all(held.map(s => new Promise(r => s.close(r))));
});

test('a port something else holds is never handed out', async (t) => {
  const inside = await testPort(), busy = await hold(inside); t.after(() => { busy.close(); });
  const real = Math.random; let calls = 0;   // the first draw lands on the held port (the middle of its slot), so it must look again
  Math.random = () => calls++ === 0 ? (inside - 10_000 + 0.5) / (32_000 - 10_000 - 1) : real();
  t.after(() => { Math.random = real; });
  const port = await testPort();
  assert.notEqual(port, inside); assert.ok(calls >= 2, 'it looked again');
});
