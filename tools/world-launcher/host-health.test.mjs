// Unit tests for deploy/host-health.mjs (lane OPS2). No ports.
import test from 'node:test'; import assert from 'node:assert/strict';
import { evaluate, memAvailableMb } from './deploy/host-health.mjs';
const GB = 1e9;
test('MemAvailable parses from /proc/meminfo', () => {
  assert.equal(memAvailableMb('MemTotal:       16000000 kB\nMemAvailable:    8429280 kB\n'), 8232);
  assert.equal(memAvailableMb('MemTotal: 1 kB\n'), null);
});
test('thresholds: disk <15% or <20 GB, MemAvailable <1.5 GB', () => {
  assert.equal(evaluate({ diskTotalBytes: 301 * GB, diskFreeBytes: 48 * GB, memMb: 8232 }).ok, true);
  assert.match(evaluate({ diskTotalBytes: 301 * GB, diskFreeBytes: 40 * GB, memMb: 8232 }).problems.join(), /13.3% < 15%/);
  assert.match(evaluate({ diskTotalBytes: 100 * GB, diskFreeBytes: 19 * GB, memMb: 8232 }).problems.join(), /19 GB < 20 GB/);
  assert.match(evaluate({ diskTotalBytes: 301 * GB, diskFreeBytes: 48 * GB, memMb: 1200 }).problems.join(), /1200 MB < 1536 MB/);
  assert.equal(evaluate({ diskTotalBytes: 301 * GB, diskFreeBytes: 48 * GB, memMb: null }).ok, false);
});
test('t4-o1: unit memory cap, OOM kills and enabled-backup failures set short codes', () => {
  const base = { diskTotalBytes: 301 * GB, diskFreeBytes: 150 * GB, memMb: 8000 };
  const G = 2 ** 30;
  const ok = evaluate({ ...base, units: { production: { workingBytes: 2 * G, maxBytes: 9 * G, oomKills: 0 } }, prevUnits: { production: { oomKills: 0 } },
    backups: { production: { enabled: false }, legacy: { enabled: true, result: 'success' } } });
  assert.equal(ok.ok, true); assert.deepEqual(ok.codes, []); assert.equal(ok.units.production.maxMb, 9216);
  const near = evaluate({ ...base, units: { production: { workingBytes: 8.2 * G, maxBytes: 9 * G, oomKills: 2 } }, prevUnits: { production: { oomKills: 1 } } });
  assert.deepEqual(near.codes, ['cap:production', 'oom:production']);
  assert.match(near.problems.join(), /91.1% of its 9216 MB cap/);
  const backup = evaluate({ ...base, backups: { production: { enabled: true, result: 'signal' }, legacy: { enabled: false, result: 'signal' } } });
  assert.deepEqual(backup.codes, ['backup:production']);
  assert.deepEqual(evaluate({ ...base, diskFreeBytes: 40 * GB }).codes, ['disk']);
});
test('t4-o1: readCgroup subtracts inactive file cache', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs'); const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const { readCgroup } = await import('./deploy/host-health.mjs');
  const d = mkdtempSync(join(tmpdir(), 'cg-'));
  writeFileSync(join(d, 'memory.current'), '1812049920\n'); writeFileSync(join(d, 'memory.max'), '9663676416\n');
  writeFileSync(join(d, 'memory.stat'), 'anon 1288466432\nfile 476405760\ninactive_file 476078080\n');
  writeFileSync(join(d, 'memory.events'), 'low 0\nhigh 0\nmax 0\noom 0\noom_kill 3\noom_group_kill 0\n');
  assert.deepEqual(readCgroup(d), { workingBytes: 1812049920 - 476078080, maxBytes: 9663676416, oomKills: 3 });
});

test('#1150: a halted world from the launcher\'s guard is an ALERT with its own code', async () => {
  const { evaluate } = await import('./deploy/host-health.mjs');
  const r = evaluate({ diskTotalBytes: 301e9, diskFreeBytes: 100e9, memMb: 8232, worldProblems: [{ slug: 'w', code: 'halted', text: 'w halted: its clock has stopped' }] });
  assert.equal(r.ok, false); assert.deepEqual(r.codes, ['halted']); assert.deepEqual(r.problems, ['w halted: its clock has stopped']);
});
