// E-polish item 2 (souls-r2 shots): core/rock and core/boulder-pile baked no colliders, so Souls walked through them.
// Now each rounded lobe of the rock collides (one box per boulder, not one block over the whole pile); through the real
// GodMode and engine bridge the engine has no standing room inside god-placed rocks and a Soul walking at one goes round it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { kitArgs, kitPhysics } from '@souls/generators';
import { fixture, invite, accept, factory } from '../test/native-owner-fixture.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';
import { GodMode } from './god/god.ts';
import { installEngineBridge } from './god/engine-bridge.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('rocks block: rounded per-boulder colliders; the engine routes a Soul round a god-placed boulder pile', { timeout: 300000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  const host = f.host, settle = async (n = 3) => { for (let i = 0; i < n; i++) { host.tickOnce(); await setImmediate(); host.drainInputs(); } };
  await settle(2);
  // the defs: one collider per rock lobe (the moss cap and anything flat do not collide), never one box over the whole pile
  for (const [name, lobes] of [['rock', 2], ['boulder-pile', 3]] as const) {
    const def = god.model.resolvedDef(coreRef(name))!, baked = kitPhysics(kitArgs.parse((def.make as any).args));
    assert.equal(baked.colliders.length, lobes, `${name}: ${baked.colliders.length} colliders`);
    assert.ok(baked.colliders.every((c) => 2 * c.half[0] < baked.box[0] - 0.05 || 2 * c.half[1] < baked.box[2] - 0.05), `${name}: no collider is the whole bounding block`);
  }
  await invite(f, 'ana');
  const row: any = await accept(host, f.souls.create('dev:ana', { name: 'Ana', description: 'walks' }));
  await settle(3);
  const E = host.engine as any, id = row.entity_id as string, at = [...E.world.entities[id].pose.p] as number[];
  const pile: [number, number] = [at[0] + 6, at[2]], small: [number, number] = [at[0], at[2] + 6];
  const free = (p: [number, number]) => E.clearanceAtV1(p[0], p[1]);
  assert.ok(free(pile) > 0.3 && free(small) > 0.3, 'open ground before');
  const r = god.act({ ops: [
    { op: 'place', def: coreRef('boulder-pile'), name: 'pile', p: pile, params: {}, r: 0 },
    { op: 'place', def: coreRef('rock'), name: 'small-rock', p: small, s: 0.5 },
  ] } as any);
  assert.equal(r.accepted, true, JSON.stringify(r));
  await settle(3);
  assert.equal(free(pile), 0, 'no standing room inside the boulder pile');
  assert.equal(free(small), 0, 'nor inside a half-size rock');
  // she walks to the far side of the pile: the route bends round it and never enters it
  const to: [number, number] = [pile[0] + 4, pile[1]];
  await accept(host, host.enqueue('decision', `edge:${row.id}`, { soulId: row.id, entityId: id, option: 'walk', label: 'walk', steps: [{ verb: 'walk_to', params: { to } }], reevalTicks: 1e9, fallback: false, trigger: 'edge-test' }));
  let closest = 99;
  for (let i = 0; i < 3000 && (E.programOf(id) || Math.hypot(E.world.entities[id].pose.p[0] - to[0], E.world.entities[id].pose.p[2] - to[1]) > 0.3); i++) {
    host.tickOnce(); const p = E.world.entities[id].pose.p; closest = Math.min(closest, Math.hypot(p[0] - pile[0], p[2] - pile[1]));
    if (i % 20 === 0) { await setImmediate(); host.drainInputs(); }
  }
  const end = E.world.entities[id].pose.p;
  assert.ok(Math.hypot(end[0] - to[0], end[2] - to[1]) <= 0.3, `arrived on the far side ${end}`);
  assert.ok(closest > 0.8, `kept clear of the pile's main boulder (closest ${closest.toFixed(2)} m)`);
  assert.deepEqual(E.runtime.violations, []);
});
