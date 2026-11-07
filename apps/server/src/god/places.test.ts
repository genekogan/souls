// R4-INFO: a god's world gives a Soul's agent Eden's quality of place information — through the real host, sequencer,
// edge ledger and compiler. The god builds a plaza with a fountain and a bench, a furnished roundhouse, a pond, a
// gazebo and a lone statue; the map lists them as walkable places (kinds, parents, descriptions, the room enclosed with
// a capacity, the pond's shore), `here` lists exits to them, the Soul's walk into the room ends with "where" naming it,
// and when the god turns the house round her (furniture closing in), she steps to open floor and can walk out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { hereFrame } from '../edge/perception/here.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { runQuery } from './query.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('god-built places: map, exits, where, and a Soul not left closed in when the god turns her house', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const r = god.act({ ops: [
    { op: 'define', def: { schema: 'def/1', name: 'open-pavilion', make: { kind: 'gen', gen: 'building/1', args: { style: 'pavilion' } }, size: { box: [8, 4, 6] } } },
    { op: 'place', tmp: '$pl', def: coreRef('plaza'), name: 'plaza', shape: { area: [[-8, -25], [8, -25], [8, -11], [-8, -11]] } },
    { op: 'place', def: coreRef('fountain'), name: 'fountain', p: [0, -20] },
    { op: 'place', def: coreRef('bench'), name: 'plaza-bench', p: [0, -16.5] },
    { op: 'place', def: coreRef('roundhouse'), name: 'moss-cottage', p: [-16, 4] },
    { op: 'place', def: coreRef('pond'), name: 'pond', shape: { area: [[10, 6], [18, 6], [18, 14], [10, 14]] }, params: { depth: 0.3, level: 0, edge: 1 } },
    { op: 'place', def: coreRef('gazebo'), name: 'gazebo', p: [-4, 22] },
    { op: 'place', def: 'open-pavilion@1', name: 'pavilion', p: [30, 25] },
    { op: 'place', def: coreRef('obelisk'), name: 'needle', p: [22, -14] },
  ] }, 'a village') as any;
  assert.equal(r.accepted, true, JSON.stringify(r));
  const fr: any = god.act({ ops: (runQuery(god.model, { furnish: { ref: 'moss-cottage' } } as any) as any).furnish.ops }, 'furnish');
  assert.equal(fr.accepted, true, JSON.stringify(fr));
  await settle(4);
  bridge.perceive.sync(true);

  // the map: places with kinds, parents, descriptions; walkable through the ledger's hook
  const map = new Map(edge.map().map((p: any) => [p.id, p]));
  const p = (id: string) => map.get(id) as any;
  for (const id of ['g-plaza', 'g-moss-cottage', 'g-moss-cottage.living', 'g-pond', 'g-pond.shore-bank', 'g-gazebo', 'g-needle']) assert.ok(p(id)?.walkable, `${id} walkable: ${JSON.stringify(p(id))}`);
  assert.equal(p('g-plaza').kind, 'plaza'); assert.match(p('g-plaza').description, /^a plaza with a fountain/); assert.match(p('g-plaza').description, /bench/);
  assert.equal(p('g-moss-cottage.living').enclosed, true); assert.equal(p('g-moss-cottage.living').parent, 'g-moss-cottage'); assert.ok(p('g-moss-cottage.living').capacity >= 1);
  assert.equal(p('g-pond').kind, 'water'); assert.equal(p('g-pond').parent, 'g-pond.shore-bank');
  assert.equal(p('g-gazebo').kind, 'gazebo'); assert.equal(p('g-gazebo').capacity, 10);
  assert.match(p('g-pavilion').description, /open-sided, with no front door/);
  assert.doesNotMatch(p('g-pavilion').description, /front door is closed/);
  assert.equal(p('g-needle').kind, 'landmark');
  assert.equal(map.has('g-fountain'), false, 'a fountain inside the plaza is not a landmark of its own');

  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'curious' }));
  await settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const E = f.host.engine as any, me = () => E.world.entities[row.entity_id];
  const done = async (n = 6000) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); const o: any = edge.observe(soul, new Set()); if (i > 40 && !o.self.receipts.length) break; } } await settle(2); };

  // walks target places; `here` lists them as exits (Eden's format)
  const caps = edge.capabilities(soul);
  assert.deepEqual(caps.find((c) => c.id === 'walk:plaza')?.target, { id: 'g-plaza', kind: 'place' });
  assert.deepEqual(caps.find((c) => c.id === 'walk:pond')?.target, { id: 'g-pond.shore-bank', kind: 'place' });
  assert.ok(caps.some((c) => c.id === 'hang-out:gazebo'), 'hang-out at a god place');
  const h0: any = hereFrame(edge, soul);
  assert.ok(h0.exits.some((x: any) => x.to === 'g-plaza' && x.walk === 'walk:plaza' && /^~/.test(x.eta)), JSON.stringify(h0.exits));

  // into the living room: "where" names it
  const a1: any = await accept(f.host, edge.act(soul, { capability: 'walk:moss-cottage/living' }));
  assert.equal(a1.accepted, true, JSON.stringify(a1));
  await done();
  assert.deepEqual(edge.placePathOf(soul.soulId).map((x) => x.id).slice(0, 2), ['g-moss-cottage.living', 'g-moss-cottage'], `in the room: ${me().pose.p}`);
  // the god turns the house 45° (a furnished roundhouse at a diagonal closes its furniture round the middle)
  const mv: any = god.act({ ops: [{ op: 'move', id: 'moss-cottage', p: [-16, 4], r: Math.PI / 4 }] }, 'turn the cottage');
  assert.equal(mv.accepted, true, JSON.stringify(mv));
  await settle(30);
  const entry = bridge.nav.thing('moss-cottage/living')!.entry!;
  const reach = E.reachV1({ p: [me().pose.p[0], me().pose.p[2]], level: 0 }, { p: entry.p, level: entry.level });
  assert.equal(reach.ok, true, `she can walk out after the god turned her house: at ${me().pose.p}`);
  const a2: any = await accept(f.host, edge.act(soul, { capability: 'walk:plaza' }));
  assert.equal(a2.accepted, true, JSON.stringify(a2));
  await done();
  assert.equal(edge.placePathOf(soul.soulId)[0]?.id, 'g-plaza', `in the plaza: ${me().pose.p}`);
  assert.deepEqual(E.runtime.violations, []);
});
