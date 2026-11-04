import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LATENCY_TEST, SERVER_SHARDS, serverTestFiles, serverShardFiles, serverShards, serverTestDurations } from './server-test-files.mjs';
import { JOBS } from './ci-scope.mjs';

// today's split before #807: two shards by alternating index (kept here only to prove the new one covers the same files)
const twoShardUnion = (all) => [0, 1].flatMap((s) => all.filter((f) => f !== LATENCY_TEST).filter((_, i) => i % 2 === s)).map((f) => `src/${f}`).sort();

test('the shards plus latency cover nested server tests exactly once', t => {
  const src = mkdtempSync(join(tmpdir(), 'server-ci-inventory-'));
  t.after(() => rmSync(src, { recursive: true, force: true }));
  const expected = ['z.test.ts', 'split/menu-world.test.ts', LATENCY_TEST, 'god/read-content-binding.test.ts', 'god/nested/contract.test.ts',
    'god/exact-authored-walk.test.ts', 'a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'].sort();
  for (const file of [...expected].reverse().concat('god/implementation.ts', 'god/readme.md')) { mkdirSync(dirname(join(src, file)), { recursive: true }); writeFileSync(join(src, file), ''); }
  const all = serverTestFiles(src);
  assert.deepEqual(all, expected);
  const shards = Array.from({ length: SERVER_SHARDS }, (_, s) => serverShardFiles(all, s, SERVER_SHARDS, { 'src/z.test.ts': 100, 'src/a.test.ts': 1, 'src/b.test.ts': 1, 'src/c.test.ts': 1 }));
  const flat = shards.flat();
  assert.equal(new Set(flat).size, flat.length, 'no file in two shards');
  assert.deepEqual([...flat, `src/${LATENCY_TEST}`].sort(), expected.map(f => `src/${f}`));
  assert.deepEqual(shards.find((s) => s.includes('src/z.test.ts')), ['src/z.test.ts'], 'the heaviest file gets a shard to itself');
});

test('the real inventory: same files as the two shards, every shard used, slowest shard under 12 minutes measured', t => {
  const all = serverTestFiles(), shards = serverShards(all), flat = shards.flatMap((s) => s.files);
  assert.equal(shards.length, SERVER_SHARDS); assert.ok(SERVER_SHARDS >= 4 && SERVER_SHARDS <= 6);
  assert.equal(new Set(flat).size, flat.length);
  assert.deepEqual([...flat].sort(), twoShardUnion(all), 'union equals the old two shards\' file sets');
  assert.ok(!flat.includes(`src/${LATENCY_TEST}`), 'latency stays in its own job');
  const d = serverTestDurations(), measured = flat.filter((f) => Number.isFinite(d[f])).length;
  assert.ok(measured / flat.length > 0.9, `${measured}/${flat.length} files measured`);
  const max = Math.max(...shards.map((s) => s.seconds));
  assert.ok(max < 11 * 60, `slowest shard ${max} s by measurement (target < 12 min with setup)`);
  t.diagnostic(shards.map((s, i) => `server-${i}: ${s.files.length} files, ${s.seconds} s`).join('; '));
});

test('deterministic, and the scope map selects every server shard', () => {
  const all = serverTestFiles();
  assert.deepEqual(serverShards(all), serverShards(all));
  assert.deepEqual(JOBS.filter((j) => j.kind === 'server').map((j) => j.name), Array.from({ length: SERVER_SHARDS }, (_, i) => `server-${i}`));
});

test('missing latency inventory, invalid shard, and empty shard fail closed', () => {
  assert.throws(() => serverShardFiles(['a.test.ts'], 0), /latency test is missing/);
  assert.throws(() => serverShardFiles([LATENCY_TEST, 'a.test.ts'], SERVER_SHARDS), /Invalid server shard/);
  assert.throws(() => serverShardFiles([LATENCY_TEST, 'a.test.ts'], -1), /Invalid server shard/);
  assert.throws(() => serverShardFiles([LATENCY_TEST, 'a.test.ts'], 0, 2), /Empty server shard/);
});
