import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { marsFactory, GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { fixture, invite, accept, factory as plainFactory } from '../test/native-owner-fixture.ts';
import { planRetireResidents, retireResidents, retireResidentsBootHook, ownerKind } from './retire-residents.ts';

const factory = await marsFactory({ ...GREEN_FIELD_WORLD, safeCrewRemoval: true });
const ACCT = 'acct_0f8b7c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f';
async function settle(f: ReturnType<typeof fixture>) { for (let i = 0; i < 20; i++) { f.host.drainInputs(); await delay(1); } }

test('owner kinds: only a registry account id (acct_<uuid>) counts as signed in', () => {
  assert.equal(ownerKind(ACCT), 'account');
  assert.equal(ownerKind('dev:alice'), 'dev');
  assert.equal(ownerKind('did:privy:abc'), 'privy');
  assert.equal(ownerKind('system'), 'system');
  assert.equal(ownerKind('acct_not-a-uuid'), 'other');
});

test('lifecycle world: plan lists only Souls with no signed-in owner; apply retires them and keeps the account-owned Soul', async (t) => {
  const f = fixture(':memory:', factory); f.souls.enableLifecycle(); t.after(() => f.db.close());
  await invite(f, 'alice');
  f.db.upsertUser({ id: ACCT, email: null, wallet: null, role: 'admin' });
  const a = f.souls.acceptLifecycleCreate('dev:alice', { name: 'Old Alice', description: 'pre-sign-in' });
  const k = f.souls.acceptLifecycleCreate(ACCT, { name: 'Signed Kim', description: 'signed in' });
  await settle(f);
  const alice = f.db.soul(a.scope.soulId)!, kim = f.db.soul(k.scope.soulId)!;
  assert.ok(f.host.engine.world.entities[alice.entity_id] && f.host.engine.world.entities[kim.entity_id]);
  const plan = planRetireResidents(f.db, f.host.worldId);
  assert.deepEqual(plan.planned.map((p) => [p.soulId, p.name, p.ownerKind]), [[alice.id, 'Old Alice', 'dev']]);
  assert.deepEqual(plan.kept, [{ soulId: kim.id, name: 'Signed Kim' }]);
  const dry = await retireResidents(f.souls, f.db, f.host.worldId);
  assert.deepEqual(dry.retired, []); assert.equal(f.db.soul(alice.id)!.retired_at, null);
  const result = await retireResidents(f.souls, f.db, f.host.worldId, { dryRun: false });
  await settle(f);
  assert.deepEqual(result.retired, [alice.id]); assert.deepEqual(result.deferred, []);
  assert.notEqual(f.db.soul(alice.id)!.retired_at, null);
  assert.equal(f.host.engine.world.entities[alice.entity_id], undefined, 'the body leaves the world');
  assert.equal(f.db.soul(kim.id)!.retired_at, null); assert.ok(f.host.engine.world.entities[kim.entity_id]);
  assert.deepEqual(planRetireResidents(f.db, f.host.worldId).planned, [], 'a second plan finds nobody');
});

test('plain world (no lifecycle): apply uses the ordinary journaled retire', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'retire-residents-')); const f = fixture(join(dir, 'sim.db'), plainFactory);
  t.after(() => { f.host.stop(); f.db.close(); rmSync(dir, { recursive: true, force: true }); });
  await invite(f, 'bob');
  const bob = await accept(f.host, f.souls.create('dev:bob', { name: 'Old Bob', description: 'pre-sign-in' }));
  const result = await accept(f.host, retireResidents(f.souls, f.db, f.host.worldId, { dryRun: false }));
  await settle(f);
  assert.deepEqual(result.retired, [bob.id]); assert.notEqual(f.db.soul(bob.id)!.retired_at, null);
  assert.equal(f.db.events(f.host.worldId).filter((e) => e.kind === 'retire' && e.payload.soulId === bob.id).length, 1);
});

test('boot hook: the one-shot file runs once, writes a report with ids and names, and is renamed; stray lines are refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'retire-residents-hook-'));
  try {
    const rows = [{ id: 's_old', world_id: 'w', owner: 'dev:x', entity_id: 'h_old', name: 'Old', native: 0, retired_at: null }, { id: 's_new', world_id: 'w', owner: ACCT, entity_id: 'h_new', name: 'New', native: 0, retired_at: null }];
    const db = { liveSouls: () => rows } as never, calls: string[] = [], souls = { operatorRetire: async (id: string) => { calls.push(id); } };
    assert.equal(await retireResidentsBootHook(souls, db, 'w', dir, {}, () => {}), null, 'no file, no run');
    writeFileSync(join(dir, 'retire-residents.env'), 'RETIRE_RESIDENTS_MODE=plan\n');
    const plan = await retireResidentsBootHook(souls, db, 'w', dir, {}, () => {});
    assert.deepEqual(plan!.planned.map((p) => p.soulId), ['s_old']); assert.deepEqual(calls, []);
    const files = readdirSync(dir);
    assert.ok(files.some((f) => f.startsWith('retire-residents.env.done-plan-')));
    const report = JSON.parse(readFileSync(join(dir, files.find((f) => f.startsWith('retire-residents-plan-'))!), 'utf8'));
    assert.deepEqual(report.result.planned[0], { soulId: 's_old', name: 'Old', owner: 'dev:x', ownerKind: 'dev', entityId: 'h_old', native: false });
    writeFileSync(join(dir, 'retire-residents.env'), 'RETIRE_RESIDENTS_MODE=apply\n');
    const applied = await retireResidentsBootHook(souls, db, 'w', dir, {}, () => {});
    assert.deepEqual(applied!.retired, ['s_old']); assert.deepEqual(calls, ['s_old']);
    writeFileSync(join(dir, 'retire-residents.env'), 'RETIRE_RESIDENTS_MODE=apply\nOTHER=1\n');
    await assert.rejects(retireResidentsBootHook(souls, db, 'w', dir, {}, () => {}), /only a RETIRE_RESIDENTS_MODE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
