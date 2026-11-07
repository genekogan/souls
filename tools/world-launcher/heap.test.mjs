// node --test tools/world-launcher/heap.test.mjs — lane L1 (server reliability): the heap cap is per world (LOAD-CONTRACT §4).
// Fake worlds on a free block of ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openLauncher, withHeap } from './launcher.mjs';
import { worldHeapMb, DEFAULT_WORLD_HEAP_MB, BIG_WORLD_HEAP_MB } from './registry.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(4);

const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
// a stray heap flag in the child's NODE_OPTIONS (production.mjs's old form) must never give a world a second cap
const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), NODE_OPTIONS: '--max-old-space-size=300 --no-deprecation' } });
const near = (got, mb) => got >= mb && got - mb <= 200;   // V8 adds its young generation (~100 MB) to the old-space cap

test('worldHeapMb: the registry entry wins, the launcher flag is a default, Eden-2026-class worlds get 2048', () => {
  assert.equal(DEFAULT_WORLD_HEAP_MB, 1536); assert.equal(BIG_WORLD_HEAP_MB, 2048);
  assert.equal(worldHeapMb({ slug: 'a' }), 1536);
  assert.equal(worldHeapMb({ slug: 'a' }, 1024), 1024);
  assert.equal(worldHeapMb({ slug: 'a', worldHeapMb: 3072 }, 1024), 3072);
  assert.equal(worldHeapMb({ slug: 'a', template: 'eden-2026' }), 2048);
  assert.equal(worldHeapMb({ slug: 'a', entities: 5030 }, 1024), 2048);
  assert.equal(worldHeapMb({ slug: 'a', entities: 5030 }, 2560), 2560);
  assert.equal(worldHeapMb({ slug: 'a', worldHeapMb: 12 }), 1536);   // nonsense is ignored
});

test('install.sh writes 1536 as the default and never the old 768 cap', () => {
  const sh = readFileSync(new URL('./deploy/install.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(sh, /768/);
  assert.equal((sh.match(/--world-heap-mb 1536/g) ?? []).length, 2);
});

test('each world boots with its own heap flag; set-heap changes it from the next boot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l1-heap-'));
  const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
  writeFileSync(join(templatesDir, 'eden-2026.json'), JSON.stringify({ schema: 'genesis/1', name: 'Eden 2026', batches: [] }));
  const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
  const P = P0 + 3, base = `http://127.0.0.1:${P}`;
  const L = await openLauncher({ port: P, range: [P0, P0 + 2], dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {}, prewarm: false });
  const make = (name, template) => fetch(`${base}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, template }) }).then((r) => r.json());
  const argv = (slug) => fetch(`${base}/w/${slug}/argv`).then((r) => r.json());
  const op = (body) => fetch(`${base}/__sim/op/set-heap`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const plain = await make('Plain'), big = await make('Big', 'eden-2026');
    const a = await argv(plain.slug), b = await argv(big.slug);
    assert.deepEqual([a.execArgv, a.heapMb, a.nodeOptions], [['--max-old-space-size=1536'], '1536', '--no-deprecation']); assert.ok(near(a.limitMb, 1536), `limit ${a.limitMb}`);
    assert.deepEqual([b.execArgv, b.heapMb], [['--max-old-space-size=2048'], '2048']); assert.ok(near(b.limitMb, 2048), `limit ${b.limitMb}`);
    assert.equal((await op({ slug: plain.slug, worldHeapMb: 99 })).status, 400);
    const r = await op({ slug: plain.slug, worldHeapMb: 2560 }); assert.equal(r.status, 200); assert.equal((await r.json()).heapMb, 2560);
    const kids = await fetch(`${base}/__sim/launcher`).then((x) => x.json());
    assert.equal(kids.children.find((c) => c.slug === plain.slug).heapMb, 2560);
    await L.pool.stop(plain.slug);
    const c = await argv(plain.slug); assert.deepEqual(c.execArgv, ['--max-old-space-size=2560']); assert.ok(near(c.limitMb, 2560), `limit ${c.limitMb}`);
    assert.equal((await op({ slug: plain.slug, worldHeapMb: null })).status, 200);
    assert.equal(JSON.parse(readFileSync(join(dir, 'data', 'worlds.json'), 'utf8')).worlds.find((w) => w.slug === plain.slug).worldHeapMb, undefined);
  } finally { await L.close(); }
});

test('the explicit node flag wins over a heap flag left in NODE_OPTIONS (an --env-file one cannot be stripped)', () => {
  const d = withHeap({ cmd: process.execPath, args: ['x.mjs'], env: { NODE_OPTIONS: '--max-old-space-size=300' } }, 1536);
  assert.equal(d.env.NODE_OPTIONS, undefined); assert.deepEqual(d.args, ['--max-old-space-size=1536', 'x.mjs']);
  const r = spawnSync(process.execPath, ['--max-old-space-size=1536', '-e', "console.log(Math.round(require('v8').getHeapStatistics().heap_size_limit / 2 ** 20))"], { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=300' }, encoding: 'utf8' });
  assert.ok(near(Number(r.stdout.trim()), 1536), `limit ${r.stdout}`);
  const other = withHeap({ cmd: '/usr/bin/env', args: [], env: { NODE_OPTIONS: '--max-old-space-size=300 --trace-gc' } }, 2048);
  assert.equal(other.env.NODE_OPTIONS, '--trace-gc --max-old-space-size=2048');
});
