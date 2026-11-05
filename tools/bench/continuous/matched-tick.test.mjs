// CW6 (#740 M7): the matched-tick verifier passes on a world's true snapshots and fails when a snapshot's tick does not
// match the state it holds (a skipped or repeated tick) or the state itself differs. Offline, a temporary database only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyMatchedTicks } from './matched-tick.mjs';

const ROOT = new URL('../../../', import.meta.url);
const { Db } = await import(new URL('apps/server/src/db.ts', ROOT).href);
const { WorldHost } = await import(new URL('apps/server/src/world.ts', ROOT).href);
const mars = await import(new URL('packages/engine-mars/src/index.ts', ROOT).href);

/** A small launcher-shaped world: genesis, then snapshots at three ticks; returns the rows as the harness captures them. */
async function run(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw6-matched-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  t.mock.method(console, 'log', () => {});
  const file = join(dir, 'sim.db'), db = new Db(file), worldId = 'mt-1';
  const host = new WorldHost(db, await mars.marsFactory({ ...mars.GREEN_FIELD_WORLD, safeCrewRemoval: true }), 'sim-genesis-1', 1e9, worldId);
  host.boot();
  const rows = [];
  const snap = () => { host.saveSnapshot(true); const r = db.db.prepare('SELECT world_id, tick, seq, state_hash, physical_hash, rules_version, snapshot, at FROM snapshots WHERE world_id = ? ORDER BY tick DESC LIMIT 1').get(worldId);
    rows.push({ worldId, tick: r.tick, seq: r.seq, stateHash: r.state_hash, physicalHash: r.physical_hash, rulesVersion: r.rules_version, at: r.at, body: JSON.parse(r.snapshot) }); };
  for (let i = 0; i < 20; i++) host.tickOnce();
  snap();
  for (let k = 0; k < 2; k++) { for (let i = 0; i < 60; i++) host.tickOnce(); snap(); }
  host.stop(); db.close();
  return { file, worldId, rows };
}

test('true snapshots match their replay at every tick', async (t) => {
  const { file, worldId, rows } = await run(t);
  const r = await verifyMatchedTicks({ dbFile: file, worldId, samples: rows });
  assert.deepEqual(r.fails, []);
  assert.equal(r.verdict, 'pass');
  assert.deepEqual(r.samples.map((s) => [s.tick, s.engineEqual, s.mindsEqual]), [[rows[1].tick, true, true], [rows[2].tick, true, true]]);
});

test('a snapshot one tick off its state (a skipped tick) fails', async (t) => {
  const { file, worldId, rows } = await run(t);
  const r = await verifyMatchedTicks({ dbFile: file, worldId, samples: [rows[0], rows[1], { ...rows[2], tick: rows[2].tick - 1 }] });
  assert.equal(r.verdict, 'fail');
  assert.match(r.fails.join(' '), new RegExp(`engine state differs at tick ${rows[2].tick - 1}`));
});

test('a different state at a matched tick fails', async (t) => {
  const { file, worldId, rows } = await run(t);
  const r = await verifyMatchedTicks({ dbFile: file, worldId, samples: [rows[0], { ...rows[1], stateHash: rows[2].stateHash }, rows[2]] });
  assert.equal(r.verdict, 'fail');
  assert.deepEqual(r.samples.map((s) => s.engineEqual), [false, true]);
});
