// node --test tools/world-launcher/health-dash.test.mjs
// Lane DASH: the owner's health page numbers against direct reads, with fake world processes (fake-world.mjs) on the
// lane's ports: proxy :6994, children 6990–6993. (The Clerk owner-only test is health-dash-auth.test.mjs, :6999.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openLauncher } from './launcher.mjs';

const PORT = 6994, RANGE = [6990, 6993], O = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'health-dash-test-'));
const root = join(dir, 'srv'), dataDir = join(root, 'production'), backups = join(dir, 'backups');
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), FAKE_TICK_MS: w.slug === 'alpha' ? '61.5' : '4.2', ...(w.slug === 'halts' ? { FAKE_LIVE: '1', DATA_DIR: w.dataDir } : {}) } });
let L;
const get = (p, h = {}) => fetch(`${O}${p}`, { headers: h });
const dash = async () => { const r = await get('/__sim/health?json=1'); assert.equal(r.status, 200); return r.json(); };

before(async () => {
  mkdirSync(join(root, 'legacy'), { recursive: true }); mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'keeper.json'), JSON.stringify({ active: { gen: 3, build: 'dev', since: '2026-10-21T08:00:00.000Z' } }));
  writeFileSync(join(root, 'legacy', 'keeper.json'), JSON.stringify({ active: { gen: 9, build: 'we-legacy00000', since: '2026-10-17T02:00:00.000Z' } }));
  writeFileSync(join(dataDir, 'backup-last.json'), JSON.stringify({ stage: 'production', at: new Date().toISOString(), ok: true, snapshot: 'abcd1234', dbsOk: 7, dbs: 7, addedMb: 12.5, failed: [] }));
  writeFileSync(join(root, 'legacy', 'backup-last.json'), JSON.stringify({ stage: 'legacy', at: '2026-10-20T03:30:00.000Z', ok: false, error: 'repository locked' }));
  mkdirSync(join(backups, 'drill-20261020'), { recursive: true }); mkdirSync(join(backups, 'drill-20261021'));
  writeFileSync(join(backups, 'drill-20261021', 'RESTORED.json'), JSON.stringify({ stage: 'production', at: '2026-10-21T04:00:00.000Z', snapshot: 'abcd1234', dbs: 7, dbsOk: 7, ok: true }));
  process.env.SIM_BACKUP_ROOT = backups;
  L = await openLauncher({ port: PORT, range: RANGE, dataDir, templatesDir, command, eager: 0, log: () => {} });
  for (const name of ['Alpha', 'Beta']) {
    const r = await fetch(`${O}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, template: 'empty' }) });
    assert.equal(r.status, 201, await r.text());
  }
});
after(async () => { await L?.close(); delete process.env.SIM_BACKUP_ROOT; });

test('the page shell has no data; the numbers need the operator on loopback (a dev launcher has no owner sign-in)', async () => {
  const r = await get('/__sim/health');
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/);
  const html = await r.text();
  for (const s of ['alpha', 'beta', 'we-legacy', 'abcd1234', 'drill-2026']) assert.equal(html.includes(s), false, `shell leaks ${s}`);
  assert.match(html, /prefers-color-scheme:dark/); assert.match(html, /width=device-width/);
  assert.equal((await get('/__sim/health?json=1', { 'x-forwarded-for': '203.0.113.9' })).status, 401, 'through a proxy, without a sign-in');
});

test('numbers match direct reads: worlds, Souls, tick lag, RSS, last god edit, release, backups, drill, arrivals, errors, sim-watch', async () => {
  // a god edit deep in alpha's history (the scan walks back in chunks between requests), and a newer one in beta
  const mk = (slug, n, editSeqs) => {
    const db = new DatabaseSync(join(dataDir, 'worlds', slug, 'sim.db'));
    db.exec('CREATE TABLE IF NOT EXISTS events (world_id TEXT NOT NULL, seq INTEGER NOT NULL, tick INTEGER NOT NULL, kind TEXT NOT NULL, author TEXT NOT NULL, payload TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, seq))');
    const ins = db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?)');
    db.exec('BEGIN'); for (let s = 1; s <= n; s++) ins.run(`${slug}-1`, s, s, editSeqs.includes(s) ? 'world-edit' : 'tick', 'sys', '{}', 1_760_000_000_000 + s); db.exec('COMMIT');
    db.close();
  };
  mk('alpha', 65_000, [10, 20]); mk('beta', 100, [99]);
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  await fetch(`${O}/__sim/client-errors`, { method: 'POST', headers: { 'user-agent': ua }, body: JSON.stringify({ b: 'dev', w: 'alpha', e: [{ k: 'arrived', ms: 2400 }] }) });
  await fetch(`${O}/__sim/client-errors`, { method: 'POST', headers: { 'user-agent': ua }, body: JSON.stringify({ b: 'dev', w: 'beta', e: [{ k: 'js', m: 'TypeError: injected', s: 'Scene' }] }) });
  await get('/__sim/healthz', { 'user-agent': 'sim-watch/1 (+lane t4-o1)', 'x-sim-watch-down': 'legacy launcher' });

  let d = await dash();
  for (let i = 0; i < 8 && d.worlds.find((w) => w.slug === 'alpha').lastEdit === null; i++) { await new Promise((r) => setTimeout(r, 50)); d = await dash(); }
  const kids = (await (await get('/__sim/launcher')).json()).children;
  const A = d.worlds.find((w) => w.slug === 'alpha'), B = d.worlds.find((w) => w.slug === 'beta');
  assert.equal(d.totals.worlds, 2); assert.equal(d.totals.running, 2);
  assert.equal(A.status, 'running'); assert.equal(A.viewers, 0); assert.equal(A.souls, null);
  assert.equal(A.entities, 3, 'from the cached god status (fake world: 3)');
  assert.deepEqual(A.tickMs, { avg: 61.5, max: 123, n: 400 }); assert.equal(A.clockRate, 1);
  assert.equal(A.lastEdit, new Date(1_760_000_000_000 + 20).toISOString(), 'the newest world-edit, 65 000 events back');
  assert.equal(B.lastEdit, new Date(1_760_000_000_000 + 99).toISOString());
  const pid = kids.find((k) => k.slug === 'alpha').pid;
  const rss = Math.round(Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) / 1024);
  assert.ok(Math.abs(A.rssMb - rss) <= Math.max(8, rss * 0.25), `rss ${A.rssMb} vs ps ${rss}`);
  assert.equal(d.build.build, 'dev'); assert.equal(d.build.since, '2026-10-21T08:00:00.000Z');
  const legacy = d.stages.find((s) => s.stage === 'legacy'), prod = d.stages.find((s) => s.self);
  assert.equal(legacy.build, 'we-legacy00000'); assert.equal(legacy.backup.ok, false);
  assert.equal(prod.backup.dbsOk, 7); assert.equal(prod.stage, 'production');
  assert.deepEqual({ name: d.drill.name, ok: d.drill.ok, dbsOk: d.drill.dbsOk }, { name: 'drill-20261021', ok: true, dbsOk: 7 });
  assert.equal(d.arrivals.n, 1); assert.equal(d.arrivals.p50, 2400);
  assert.equal(d.errors.newSinceRelease, 1); assert.equal(d.errors.top[0].message, 'TypeError: injected'); assert.deepEqual(d.errors.top[0].worlds, ['beta']);
  assert.equal(d.watch.down, 'legacy launcher');
  const texts = d.alerts.map((a) => a.text).join('\n');
  assert.match(texts, /legacy backup failed: repository locked/); assert.match(texts, /alpha: ticks average 61.5 ms/); assert.match(texts, /1 new client error kind/);
  assert.match(texts, /sim-watch reports down: legacy launcher/); assert.doesNotMatch(texts, /beta: ticks/);
  assert.ok(d.host.cpus > 0 && d.host.memory.totalMb > 0 && d.host.disk.freeGb > 0);
  assert.ok(d.ms < 300, `server time ${d.ms} ms`);
});

test('a frozen or slow world never holds the page up: its last answer stays', async () => {
  const kids = (await (await get('/__sim/launcher')).json()).children;
  const pid = kids.find((k) => k.slug === 'beta').pid;
  process.kill(pid, 'SIGSTOP');   // as good as a stuck world: /healthz never answers
  try {
    const t0 = performance.now(), d = await dash(), wall = performance.now() - t0;
    assert.ok(wall < 600, `wall ${Math.round(wall)} ms`); assert.ok(d.ms < 300, `server time ${d.ms} ms`);
    assert.deepEqual(d.worlds.find((w) => w.slug === 'beta').tickMs, { avg: 4.2, max: 8.4, n: 400 }, 'kept from the last answer');
  } finally { process.kill(pid, 'SIGCONT'); }
});

test('#1150: a halted world keeps its last tick numbers, shows its counts by rule and rung and is a bad alert; hostOk goes false with the code alone; records read from the store, loopback only', async () => {
  const made = await fetch(`${O}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Halts', template: 'empty', slug: 'halts' }) });
  assert.equal(made.status, 201, await made.text());
  const row = (d) => d.worlds.find((w) => w.slug === 'halts');
  let d = await dash();
  for (let i = 0; i < 40 && !row(d)?.tickMs; i++) { await new Promise((r) => setTimeout(r, 100)); d = await dash(); }
  assert.deepEqual(row(d).tickMs, { avg: 4.2, max: 8.4, n: 400 }); assert.equal(row(d).glitches, null, 'a fake world from before the counts'); assert.equal(row(d).halted, undefined);
  const kid = L.pool.status('halts');
  assert.equal((await fetch(`http://127.0.0.1:${kid.port}/w/halts/halt`)).status, 200);
  for (let i = 0; i < 100 && !row(d).halted; i++) { await L.pool.guard(); d = await dash(); if (!row(d).halted) await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(row(d).halted, true);
  assert.deepEqual(row(d).glitches, { total: 2, byRule: { 'collision.human-load': { recovery: 1, halt: 1 } } });
  assert.deepEqual(row(d).tickMs, { avg: 4.2, max: 8.4, n: 400 }, 'kept from the last answer');
  assert.ok(d.alerts.some((a) => a.level === 'bad' && /^halts: halted/.test(a.text)), JSON.stringify(d.alerts));
  const html = await (await get('/__sim/health')).text();
  assert.match(html, /<h2>Glitches/); assert.match(html, /halted/);
  const pub = await (await get('/__sim/healthz', { 'x-forwarded-for': '203.0.113.9' })).json();
  assert.equal(pub.hostOk, false); assert.ok(pub.hostCodes.includes('halted'));
  assert.equal(pub.worldProblems, undefined, 'the text and the world are for loopback');
  const local = await (await get('/__sim/healthz')).json();
  assert.ok(local.worldProblems.some((x) => x.slug === 'halts' && x.code === 'halted'));
});

test('#1150: /__sim/glitches reads each store, for a world not running too; ?world= adds its records with their evidence; loopback only', async () => {
  const dbFile = join(dataDir, 'worlds', 'alpha', 'sim.db'), db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE glitches_v1 (id INTEGER PRIMARY KEY, world_id TEXT NOT NULL, at INTEGER NOT NULL, tick INTEGER NOT NULL, rung TEXT NOT NULL, rule TEXT NOT NULL, bodies TEXT NOT NULL, evidence TEXT NOT NULL)');
  const ins = db.prepare('INSERT INTO glitches_v1 (world_id, at, tick, rung, rule, bodies, evidence) VALUES (?,?,?,?,?,?,?)');
  ins.run('alpha-1', 1_760_000_000_000, 7, 'recovery', 'collision.human-human', '["a","b"]', '{"seq":3}');
  ins.run('alpha-1', 1_760_000_001_000, 9, 'halt', 'collision.human-human', '["a"]', '{"why":"recovery replay still faults"}');
  db.close();
  const all = await (await get('/__sim/glitches')).json();
  assert.deepEqual(all.worlds, { alpha: { total: 2, byRule: { 'collision.human-human': { recovery: 1, halt: 1 } }, last: '2025-10-09T08:53:21.000Z' } });
  const one = await (await get('/__sim/glitches?world=alpha&limit=1')).json();
  assert.equal(one.worlds.alpha.records.length, 1);
  assert.deepEqual(one.worlds.alpha.records[0], { at: '2025-10-09T08:53:21.000Z', tick: 9, rung: 'halt', rule: 'collision.human-human', bodies: ['a'], evidence: { why: 'recovery replay still faults' } });
  assert.equal((await get('/__sim/glitches', { 'x-forwarded-for': '203.0.113.9' })).status, 404);
});
