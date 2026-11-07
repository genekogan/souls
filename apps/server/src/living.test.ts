import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { marsFactory } from '@souls/engine-mars';
import { clockAt, newLife, advanceNeeds, livingChoice } from '@souls/brain';
import { WorldHost } from './world.ts';
import { LivingWorld } from './living.ts';
import { Db } from './db.ts';

test('model reservations retain costs across concurrent admission, restarts, budget changes and call pruning', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'souls-budget-')), 'test.db');
  let db = new Db(path);
  const a = db.reserveCost(0.6, 'test', 1); assert.throws(() => db.reserveCost(0.5, 'test', 1), /budget/);
  a.settle(0.3); db.reserveCost(0.6, 'uncertain-transport', 1); db.pruneBrainCalls(0); db.close();
  db = new Db(path); assert.ok(Math.abs(db.paidCost() - 0.9) < 1e-12);
  assert.throws(() => db.reserveCost(0.2, 'test', 1), /budget/);
  assert.throws(() => db.reserveCost(0.01, 'test', 0.5), /budget/);
  assert.equal(db.paidCost(Date.now() + 86400_001), 0); db.close();
});

test('one hour of world ticks is a day; enacted rest/eating/company change slow needs', () => {
  assert.equal(clockAt(72000, 0).day, 1); assert.equal(clockAt(33000, 0).hour, 17);
  const idle = newLife(0), asleep = newLife(0), eating = newLife(0), talking = newLife(0);
  advanceNeeds(idle, 12000, 'idle', false); advanceNeeds(asleep, 12000, 'sleep', false);
  advanceNeeds(eating, 12000, 'eat', false); advanceNeeds(talking, 12000, 'talk', true);
  assert.ok(asleep.needs.energy > idle.needs.energy); assert.ok(eating.needs.hunger < idle.needs.hunger); assert.ok(talking.needs.company < idle.needs.company);
});

test('seeded living choices respond to needs and journal while remaining variable', () => {
  const options = ['rest', 'eat supper', 'garden'].map(id => ({ id, template: id, label: id, steps: [], durationHint: 'minutes' as const }));
  const base = { world: { time: 'afternoon', weather: 'clear', happening: 'a quiet place' }, soul: { name: 'test', about: 'likes gardens', intent: 'none', ownerNote: null, hasIntent: false, intentIsNew: false, energy: 'fine', where: 'here', doing: 'idle', recent: [], needs: { energy: 95, hunger: 95, company: 10, restlessness: 10 }, journal: 'I enjoy garden work.' }, nudge: null, nearby: [], options, running: false, trigger: 'test' };
  const counts = (needs: typeof base.soul.needs) => Array.from({ length: 500 }, (_, i) => livingChoice({ ...base, soul: { ...base.soul, needs } }, String(i)).option);
  const hungry = counts(base.soul.needs), tired = counts({ ...base.soul.needs, energy: 0, hunger: 0 });
  assert.ok(hungry.filter(x => x === 'eat supper').length > tired.filter(x => x === 'eat supper').length);
  assert.ok(tired.filter(x => x === 'rest').length > hungry.filter(x => x === 'rest').length);
  assert.ok(new Set(hungry).size > 1); assert.deepEqual(livingChoice(base, 'same'), livingChoice(base, 'same'));
});

test('daily quiet barrier renews Runtime and checkpoint resumes exact needs, journal and physical hash', async () => {
  const db = new Db(join(mkdtempSync(join(tmpdir(), 'souls-living-')), 'test.db')), factory = await marsFactory();
  const host = new WorldHost(db, factory, 'living', 1e9, 'mars-1'); host.boot();
  const living = new LivingWorld(host);
  void living.install(['People may share supper.']);
  void host.enqueue('birth', 'test', { soulId: 's_A', entityId: 'h_A', name: 'A', description: 'quiet', owner: 'test-owner' });
  for (let i = 0; i < 20; i++) host.tickOnce();
  assert.ok(db.events(host.worldId).some(e => e.payload?.compact));
  assert.equal(host.quietBarrier, false);
  void host.enqueue('rules', 'test', { soulId: 's_A', reflection: { day: 0, journal: 'I watched first light.' } }); host.tickOnce();
  host.saveSnapshot();
  const needs = structuredClone(host.minds.get('s_A')!.life), hash = host.engine.stateHash();
  const next = new WorldHost(db, factory, 'living', 1e9, 'mars-1'); assert.equal(next.boot().from, 'snapshot');
  assert.equal(next.engine.stateHash(), hash); assert.deepEqual(next.minds.get('s_A')!.life, needs);
  for (let i = 0; i < 100; i++) { host.tickOnce(); next.tickOnce(); }
  assert.equal(next.engine.stateHash(), host.engine.stateHash()); assert.deepEqual(next.minds.get('s_A')!.life, host.minds.get('s_A')!.life); db.close();
});
