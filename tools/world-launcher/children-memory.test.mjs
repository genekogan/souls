// node --test tools/world-launcher/children-memory.test.mjs (lane P3; fake worlds on a free block of ports)
// The unit's own memory limit (cgroup MemoryHigh/Max, shared by every world of the unit) makes room like the host floor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChildPool } from './children.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(4);

const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port) } });
const world = (slug) => ({ slug, dataDir: join(tmpdir(), slug) });

test('near the unit memory limit, the least recently used idle world sleeps before another boots', async () => {
  let low = 0; const room = () => (low-- > 0 ? 500 : 5_000);
  const pool = new ChildPool({ root: process.cwd(), range: [P0, P0 + 3], logDir: mkdtempSync(join(tmpdir(), 'p3-mem-')), command, healthPath: (s) => `/w/${s}/healthz`, idleMs: 0, minFreeMb: 1, unitRoom: room, unitFloorMb: 768 });
  try {
    await pool.ensure(world('a')); await new Promise((r) => setTimeout(r, 10));
    await pool.ensure(world('b'));
    assert.deepEqual([pool.status('a').status, pool.status('b').status], ['running', 'running'], 'room under the limit: both run');
    low = 1;   // the unit is within one world of its limit (once: the sleeper's memory then comes back)
    await new Promise((r) => setTimeout(r, 10));
    await pool.ensure(world('c'));
    assert.equal(pool.status('a').status, 'asleep', 'the least recently used idle world made room');
    assert.equal(pool.status('c').status, 'running');
  } finally { await pool.closeAll(); }
});

test('without a host floor (minFreeMb 0, a laptop) the unit limit is not consulted', async () => {
  let asked = 0;
  const pool = new ChildPool({ root: process.cwd(), range: [P0, P0 + 3], logDir: mkdtempSync(join(tmpdir(), 'p3-mem-')), command, healthPath: (s) => `/w/${s}/healthz`, idleMs: 0, unitRoom: () => { asked++; return 0; } });
  try { await pool.ensure(world('d')); assert.equal(pool.status('d').status, 'running'); assert.equal(asked, 0); } finally { await pool.closeAll(); }
});
