import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CREATION_LIMITS as L } from '@souls/generators';
import { Db } from '../db.ts';
import { GodMode } from './god.ts';
import { ApiError } from '../souls.ts';

test('world asset count and bytes refuse before files or provenance are written', t => {
  const dir = mkdtempSync(join(tmpdir(), 's1-budget-')), db = new Db(':memory:');
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const g = new GodMode(db, { worldId: 'budget', ownerId: 'dev:owner', tick: () => 0, emit: () => {}, assetDir: dir });
  for (const metas of [Array.from({ length: L.worldAssets + 1 }, (_, i) => ({ sha: String(i).padStart(64, '0'), bytes: 1 })), [{ sha: '1'.repeat(64), bytes: L.worldAssetBytes + 1 }]]) {
    assert.throws(() => g.assets.checkWorldBudget(metas), e => e instanceof ApiError && e.code === 'budget.world' && !!e.extra?.measured && !!e.extra?.limit);
  }
  assert.deepEqual(readdirSync(dir), []);
  assert.equal((db.db.prepare('SELECT count(*) AS n FROM world_assets_v1').get() as { n: number }).n, 0);
});
test('journal budget is world-scoped and refuses atomically without pruning accepted history', t => {
  const db = new Db(':memory:'); t.after(() => db.close());
  const g = new GodMode(db, { worldId: 'journal-budget', ownerId: 'dev:owner', tick: () => 0, emit: () => {} });
  assert.equal(g.act({ ops: [{ op: 'world', state: { constitution: 'before' } }] }).accepted, true);
  const usage = db.db.prepare('SELECT entries,bytes FROM world_edit_usage_v1 WHERE world_id=?').get(g.opts.worldId) as { entries: number; bytes: number };
  assert.equal(usage.entries, 1); assert.ok(usage.bytes > 0);
  const before = g.model.snapshot();
  for (const [entries, bytes, field] of [[L.journalEntries, usage.bytes, 'journal.entries'], [usage.entries, L.journalBytes, 'journal.bytes']] as const) {
    db.db.prepare('UPDATE world_edit_usage_v1 SET entries=?,bytes=? WHERE world_id=?').run(entries, bytes, g.opts.worldId);
    const r = g.act({ ops: [{ op: 'world', state: { constitution: 'too much' } }] });
    assert.equal(r.accepted, false);
    if (!r.accepted) { assert.equal(r.failures[0].code, 'budget.world'); assert.equal(r.failures[0].field, field); assert.ok(Number(r.failures[0].measured) > Number(r.failures[0].limit)); }
    assert.deepEqual(g.model.snapshot(), before); assert.equal(g.store.edits().length, 1);
  }
  const other = new GodMode(db, { worldId: 'other-world', ownerId: 'dev:owner', tick: () => 0, emit: () => {} });
  assert.equal(other.act({ ops: [{ op: 'world', state: { constitution: 'still works' } }] }).accepted, true);
});
test('exhausted journal leaves a bounded reserve for engine retirement, while new growth stays refused', t => {
  const db = new Db(':memory:'); t.after(() => db.close());
  const g = new GodMode(db, { worldId: 'cleanup-reserve', ownerId: 'dev:owner', tick: () => 0, emit: () => {} });
  assert.equal(g.act({ ops: [{ op: 'place', def: 'core/bench@1', name: 'remove-me' }] }).accepted, true);
  db.db.prepare('UPDATE world_edit_usage_v1 SET entries=?,bytes=? WHERE world_id=?').run(L.journalEntries, L.journalBytes, g.opts.worldId);
  assert.equal(g.engineAct([{ op: 'place', def: 'core/bench@1', p: [10, 0] } as never], 'new growth').accepted, false);
  assert.equal(g.engineAct([{ op: 'remove', id: 'remove-me', cascade: true }], 'retirement').accepted, true);
  assert.equal(g.model.get('remove-me'), undefined); assert.equal(g.store.edits().length, 2);
});
