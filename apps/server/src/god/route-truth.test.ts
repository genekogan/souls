// RT (2026-10-20): `here` exits and `go` tell the truth about walks the body cannot make. A yard walled all round with
// its only door shut: its exit says reachable:false (no eta) and `go` refuses with the engine's route code; open the
// door and the same exit has an eta and `go` resolves (the answer is cached per navigation epoch, so it follows the door).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { hereFrame } from '../edge/perception/here.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('route truth: a sealed yard is listed unreachable and go refuses; opened, it has an eta and go resolves', { timeout: 300_000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); edge.comms?.close(); f.db.close(); });
  await settle(2);
  const ok = (r: any) => { assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); return r; };
  const cx = 14;
  ok(god.act({ ops: [
    // a closed square of garden wall, its only way in a door (shut as placed) in the gap at (cx, 0)
    { op: 'place', def: coreRef('garden-wall'), name: 'yard-wall', shape: { path: [[cx - 0.6, 0], [cx - 5, 0], [cx - 5, 8], [cx + 5, 8], [cx + 5, 0], [cx + 0.6, 0]] } },
    { op: 'place', def: coreRef('door'), name: 'yard-door', p: [cx, 0] },
    { op: 'place', def: coreRef('plaza'), name: 'yard', shape: { area: [[cx - 3, 2], [cx + 3, 2], [cx + 3, 6], [cx - 3, 6]] } },
    { op: 'place', def: coreRef('plaza'), name: 'green', shape: { area: [[-14, -6], [-8, -6], [-8, 0], [-14, 0]] } },
  ] }, 'a walled yard with a shut door, and an open green'));
  await settle(4);
  bridge.perceive.sync(true);
  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'curious' }));
  await settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const exit = (id: string) => (hereFrame(edge, soul) as any).exits.find((x: any) => x.to === id);

  const shut = exit('g-yard');
  assert.ok(shut, 'the yard is listed as an exit');
  assert.equal(shut.reachable, false, JSON.stringify(shut)); assert.equal(shut.why, 'route.unreachable'); assert.equal(shut.eta, undefined);
  const green = exit('g-green');
  assert.ok(green && green.reachable === undefined && /^~/.test(green.eta), JSON.stringify(green));
  const go: any = edge.intents.resolve(soul, { verb: 'go', target: { place: 'yard' } } as any);
  assert.equal(go.ok, false, JSON.stringify(go)); assert.equal(go.code, 'route.unreachable');
  assert.equal((edge.intents.resolve(soul, { verb: 'go', target: { place: 'green' } } as any) as any).ok, true);

  ok(god.act({ ops: [{ op: 'set', id: god.model.get('yard-door')!.id, state: { open: true } }] }));
  await settle(4);
  const open = exit('g-yard');
  assert.ok(open && open.reachable === undefined && /^~/.test(open.eta), JSON.stringify(open));
  assert.equal((edge.intents.resolve(soul, { verb: 'go', target: { place: 'yard' } } as any) as any).ok, true);
});

test('run to a building: run to its front door, then walk inside', { timeout: 300_000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); edge.comms?.close(); f.db.close(); });
  await settle(2);
  const r: any = god.act({ ops: [{ op: 'place', def: coreRef('cottage'), name: 'cottage', p: [24, 10], r: -1.0685826404927201 }] });
  assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600));
  await settle(4);
  bridge.perceive.sync(true);
  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'curious' }));
  await settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  assert.equal(edge.capabilities(soul).some((c) => c.id === 'run:g-cottage'), false, 'the listing offers no gait to a building');
  const a: any = await accept(f.host, edge.act(soul, { capability: 'run:g-cottage' }));
  assert.equal(a.accepted, true, JSON.stringify(a));
  // the plan offered on demand: at a run to the stand outside the front door, then the walk inside as offered
  const b = edge.coreA.binds(soul), caps = [...b.caps], plans = new Map<string, any>(b.plans);
  assert.equal(bridge.nav.gaitOnDemand(soul, 'g-cottage', 'run', caps, plans), true);
  const steps = plans.get('run:g-cottage').steps, door = bridge.nav.thing('cottage')!.stands![0];
  assert.deepEqual(steps[0].params, { to: door, gait: 'run', standoff: 0 }); assert.equal(steps.at(-1).verb, 'walk_to'); assert.equal(steps.at(-1).params.gait, undefined);
  assert.match(plans.get('run:g-cottage').label, /^Run to the door of cottage, then walk inside/);
  for (let i = 0; i < 4000; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); const o: any = edge.observe(soul, new Set()); if (i > 40 && !o.self.receipts.length) break; } }
  await settle(2);
  const rc: any = edge.observe(soul, new Set());
  assert.ok(edge.placePathOf(soul.soulId).some((x) => x.id === 'g-cottage'), `inside the cottage: ${JSON.stringify(f.host.engine.world.entities[row.entity_id].pose.p)} ${JSON.stringify(rc.self).slice(0, 400)}`);
});
