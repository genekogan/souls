// CW6 (#740 M7): the matched-tick verifier passes on a world's true periodic snapshots, which follow logged inputs after
// S0 (a Soul's birth and a walk), and fails when a logged input is dropped or its payload changed, when a snapshot's
// tick does not hold its state, or when a day-clock catch-up was logged. Offline, a temporary database only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate as turn } from 'node:timers/promises';
import { verifyMatchedTicks } from './matched-tick.mjs';

const ROOT = new URL('../../../', import.meta.url);
const { Db } = await import(new URL('apps/server/src/db.ts', ROOT).href);
const { WorldHost } = await import(new URL('apps/server/src/world.ts', ROOT).href);
const mars = await import(new URL('packages/engine-mars/src/index.ts', ROOT).href);

const worldId = 'mt-1', soul = { soulId: 's_a', entityId: 'h_a' };
/** A launcher-shaped world that snapshots every 40 ticks on its own (the periodic path): a Soul is born after S0 and
 *  walks; returns the database file and the snapshot rows as the harness captures them. */
async function run(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw6-matched-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  t.mock.method(console, 'log', () => {});
  const file = join(dir, 'sim.db'), db = new Db(file);
  const host = new WorldHost(db, await mars.marsFactory({ ...mars.GREEN_FIELD_WORLD, safeCrewRemoval: true }), 'sim-genesis-1', 40, worldId);
  host.boot();
  // a living world's day (launcher worlds log theirs at creation): minds then carry needs that advance every tick
  void host.enqueue('rules', 'world', { dayConfig: { origin: 0, dayTicks: 28_800, customs: [] }, why: 'the day of this test world' });
  const rows = {}, capture = () => { for (const r of db.db.prepare('SELECT world_id, tick, seq, state_hash, physical_hash, rules_version, snapshot, at FROM snapshots WHERE world_id = ?').all(worldId))
    rows[r.tick] ??= { worldId, tick: r.tick, seq: r.seq, stateHash: r.state_hash, physicalHash: r.physical_hash, rulesVersion: r.rules_version, at: r.at, body: JSON.parse(r.snapshot) }; };
  const ticks = async (n) => { for (let i = 0; i < n; i++) { host.tickOnce(); await turn(); capture(); } };
  await ticks(45);
  void host.enqueue('birth', 'test', { soulId: soul.soulId, entityId: soul.entityId, name: 'Alice', description: 'test', owner: 'owner' });
  await ticks(10);
  void host.enqueue('decision', 'test', { ...soul, option: 'walk', label: 'Walking', steps: [{ verb: 'walk_to', params: { to: [6, 4] } }], reevalTicks: 200, fallback: false, trigger: 'test' });
  await ticks(120);
  host.stop(); db.close();
  return { dir, file, rows: Object.values(rows) };
}
const variant = (dir, file, name, sql) => { const c = join(dir, `${name}.db`); copyFileSync(file, c); const d = new DatabaseSync(c); d.exec(sql); d.close(); return c; };

test('true periodic snapshots match their replay at every tick, through logged inputs', async (t) => {
  const { file, rows } = await run(t);
  const r = await verifyMatchedTicks({ dbFile: file, worldId, samples: rows });
  assert.deepEqual(r.fails, []);
  assert.ok(r.samples.length >= 3, `${r.samples.length} matched ticks`);
  assert.ok(r.samples.every((s) => s.engineEqual && s.mindsEqual));
  assert.deepEqual(r.inputs.map((e) => e.kind), ['birth', 'decision']);
  const last = r.samples.at(-1).souls.find((s) => s.soulId === soul.soulId);
  assert.ok(last?.needs, 'the Soul has needs, so they are compared');
  assert.notDeepEqual(last.pos, [0, 0], 'the walk moved the body');
});

test('a dropped or changed logged input fails', async (t) => {
  const { dir, file, rows } = await run(t);
  for (const [name, sql] of [['dropped', "DELETE FROM events WHERE kind = 'decision'"],
    ['changed', "UPDATE events SET payload = json_set(payload, '$.steps[0].params.to', json('[-6,4]')) WHERE kind = 'decision'"]]) {
    const r = await verifyMatchedTicks({ dbFile: variant(dir, file, name, sql), worldId, samples: rows });
    assert.equal(r.verdict, 'fail', name);
    assert.match(r.fails.join(' '), /engine state differs/, name);
  }
});

test('a snapshot one tick off its state fails', async (t) => {
  const { file, rows } = await run(t);
  const [a, b, c] = rows.sort((x, y) => x.tick - y.tick).slice(-3);
  const r = await verifyMatchedTicks({ dbFile: file, worldId, samples: [a, b, { ...c, tick: c.tick - 1 }] });
  assert.equal(r.verdict, 'fail');
  assert.match(r.fails.join(' '), new RegExp(`engine state differs at tick ${c.tick - 1}`));
});

test('a logged day-clock catch-up fails even though it replays', async (t) => {
  const { dir, file, rows } = await run(t);
  const s0 = rows.sort((x, y) => x.tick - y.tick)[0];
  const c = variant(dir, file, 'catchup', `INSERT INTO events (world_id, seq, tick, kind, author, payload, at) SELECT world_id, MAX(seq) + 1, MAX(tick), 'rules', 'world', '{"why":"world clock: caught up"}', 0 FROM events WHERE world_id = '${worldId}'`);
  const r = await verifyMatchedTicks({ dbFile: c, worldId, samples: rows.filter((x) => x.tick >= s0.tick) });
  assert.equal(r.verdict, 'fail');
  assert.match(r.fails.join(' '), /catch-up/);
});
