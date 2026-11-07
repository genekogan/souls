import test from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD, type MarsEngine } from './engine.ts';
import { entityPhysicsHash, nextEntityPhysics, type WorldEditV1 } from './entity-physics.ts';
import { assetFromDef, assetIdFor, type DefFacts } from './catalog-adapter.ts';
import type { Engine } from '@souls/engine-contract';
import { CATALOG } from '../../../mars/viewer/engine/world/catalog.ts';
// test-only: the contract WorldState type does not list the engine's entityPhysicsV1 field
const phys = (x: { world: unknown }) => (x.world as { entityPhysicsV1?: any }).entityPhysicsV1;

// A two-floor house as the bridge derives it (hand-written here): walls with a front door gap, an upper floor at
// 2.85 m, a straight flight along the east wall, a chair and a table upstairs, a bowl on the table.
const wall = (id: string, c: [number, number], half: [number, number], y1 = 5.6) => ({ id, obb: { c, half, yaw: 0 }, y0: 0, y1, kind: 'fixture' as const, label: 'house wall' });
function house(): WorldEditV1['set'][string] {
  return {
    surfaces: [{ id: 'house:ground', level: 0, y: 0, obb: { c: [10, 0], half: [3.9, 2.9], yaw: 0 } }, { id: 'house:floor-1', level: 1, y: 2.85, obb: { c: [10, 0], half: [3.9, 2.9], yaw: 0 } }],
    solids: [wall('house:n', [10, -3], [4, 0.11]), wall('house:e', [14, 0], [0.11, 3]), wall('house:w', [6, 0], [0.11, 3]), wall('house:s1', [7.725, 3], [1.725, 0.11]), wall('house:s2', [12.275, 3], [1.725, 0.11])],
    links: [{ id: 'house:stairs', kind: 'stairs', from: { level: 0, p: [13.2, 1.6], y: 0 }, to: { level: 1, p: [13.2, -1.6], y: 2.85 }, width: 1.1, heading: -Math.PI / 2, path: Array.from({ length: 17 }, (_, i) => [13.2, (2.85 * i) / 16, 1.6 - (3.2 * i) / 16] as [number, number, number]), usable: true }],
  };
}
const chairFacts: DefFacts = { ref: 'core-chair@1', hash: 'c'.repeat(64), name: 'core-chair', tags: ['seat'], layer: 'solid', components: { seat: { height: 0.45 } }, slots: [{ id: 'seat', kind: 'seat', p: [0, 0.45, 0], yaw: 0 }], box: [0.5, 0.45, 0.5] };
const tableFacts: DefFacts = { ref: 'core-table@1', hash: 't'.repeat(64), name: 'core-table', tags: [], layer: 'solid', components: { surface: { height: 0.75 } }, slots: [{ id: 'top', kind: 'surface', p: [0, 0.75, 0], yaw: 0, capacity: 12 }], box: [1.2, 0.75, 0.8] };
const bowlFacts: DefFacts = { ref: 'core-bowl@1', hash: 'b'.repeat(64), name: 'core-bowl', tags: ['item'], layer: 'solid', components: { carryable: { mass: 0.5, grips: 1 }, container: { capacity: 1 } }, slots: [], box: [0.25, 0.1, 0.25] };

function edit(seq: number, set: WorldEditV1['set'], prev?: ReturnType<typeof nextEntityPhysics>, assets: Record<string, unknown> = {}): WorldEditV1 {
  const levels = [{ id: 1, y: 2.85, label: 'floor at 2.85 m' }];
  const draft: WorldEditV1 = { contract: 'world-edit/1', seq, hash: '', levels, set, assets };
  draft.hash = nextEntityPhysics(prev, draft).hash;
  return draft;
}

async function built() {
  const f = await marsFactory(GREEN_FIELD_WORLD), e = f.create(f.genesis('entity-physics')) as unknown as MarsEngine & Engine;
  const chairId = assetIdFor(chairFacts, '{}'), tableId = assetIdFor(tableFacts, '{}'), bowlId = assetIdFor(bowlFacts, '{}');
  const assets = { [chairId]: assetFromDef(chairId, chairFacts), [tableId]: assetFromDef(tableId, tableFacts), [bowlId]: assetFromDef(bowlId, bowlFacts) };
  const tableSlot = (assets[tableId].surfaceSlots ?? [])[0]!.id;
  const set: WorldEditV1['set'] = {
    e_house1: house(),
    e_chair1: { fixture: { def: chairId, kind: 'fixture', label: 'chair', p: [8, 2.85, -1], yaw: 0 } },
    e_table1: { fixture: { def: tableId, kind: 'fixture', label: 'table', p: [10, 2.85, -1.6], yaw: 0 } },
    e_bowl01: { fixture: { def: bowlId, kind: 'item', label: 'bowl', p: [10, 3.6, -1.6], yaw: 0, support: { kind: 'resting-on', on: 'e_table1', slot: tableSlot } } },
  };
  const ev = edit(1, set, undefined, assets);
  const r = e.applyWorldEditV1(ev);
  assert.equal(r.hash, ev.hash);
  e.spawnHuman({ id: 'h_walker0001', label: 'Walker', soul: 's_walker0001' });
  return { f, e, ev, tableSlot };
}
const run = (e: Engine, n: number, until?: () => boolean) => { for (let i = 0; i < n && !(until?.()); i++) e.step(); };

test('free seat approach read preserves state and identifies an exact physically usable native slot', async () => {
  const {e} = await built(), before = e.stateHash();
  const slots = e.freeSeatSlotsV1('e_chair1', 'h_walker0001');
  assert.equal(slots.length, 1); assert.ok(slots[0].id.startsWith('e_chair1#'));
  assert.equal(slots[0].level, 1); assert.deepEqual(slots[0].p, [8, -1]); assert.ok(slots[0].approach);
  assert.equal(e.stateHash(), before, 'approach query does not claim or move anything');
  const started = e.perform({actor: 'h_walker0001', label: 'exact native seat', steps: [{verb: 'mars:sit', params: {slot: slots[0].id}}, {verb: 'rest', params: {seconds: 60}}]});
  assert.equal(started.ok, true, JSON.stringify(started));
  run(e, 2400, () => e.world.entities.h_walker0001.human?.activity === 'sit');
  assert.equal(e.world.entities.h_walker0001.human?.activity, 'sit');
  assert.deepEqual(e.freeSeatSlotsV1('e_chair1'), []); assert.deepEqual(e.freeSeatSlotsV1('missing'), []);
  assert.deepEqual(e.runtime.violations, []);
});

test('world-edit: a Soul routes through the door, up the stairs, sits on the god chair upstairs', async () => {
  const { e } = await built();
  const reach = e.reachV1({ p: [10, 8] }, { p: [8.8, -1], level: 1 });
  assert.equal(reach.ok, true, JSON.stringify(reach));
  if (reach.ok) { assert.ok(reach.levels.includes(1)); assert.ok(reach.length > 10); }
  // the route enters through the door gap (z = 3 at x in 9.45..10.55), never through a wall
  const r = e.perform({ actor: 'h_walker0001', label: 'sit upstairs', steps: [{ verb: 'sit', params: { on: 'e_chair1', seconds: 30 } }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  run(e, 2400, () => e.world.entities.h_walker0001.human?.activity === 'sit');
  const h = e.world.entities.h_walker0001;
  assert.equal(h.human?.activity, 'sit');
  assert.equal(h.human?.level, 1);
  assert.ok(h.pose.p[1] > 2.5, `seated upstairs at y ${h.pose.p[1]}`);
  assert.deepEqual(e.bodyUsesV1('e_chair1'), { body: 'h_walker0001', how: 'occupied' });
  assert.deepEqual(e.runtime.violations, []);
});

test('world-edit: the Soul takes the god bowl from the table upstairs and puts it back on another slot', async () => {
  const { e, tableSlot } = await built();
  const take = e.perform({ actor: 'h_walker0001', label: 'take the bowl', steps: [{ verb: 'mars:walk_to', params: { x: 10, z: -0.6, level: 1 } }, { verb: 'mars:take_item', params: { item: 'e_bowl01', hand: 'right' } }] });
  assert.equal(take.ok, true, JSON.stringify(take));
  run(e, 3000, () => (e.world.entities.e_bowl01 as { support?: { kind?: string } }).support?.kind === 'in-hand' && !e.programOf('h_walker0001'));
  assert.deepEqual((e.world.entities.e_bowl01 as { support?: { kind?: string } }).support, { kind: 'in-hand', by: 'h_walker0001', hand: 'right' });
  assert.deepEqual(e.bodyUsesV1('e_bowl01'), { body: 'h_walker0001', how: 'held' });
  const other = tableSlot.replace(/c0$/, 'c1');
  const put = e.perform({ actor: 'h_walker0001', label: 'put it down', steps: [{ verb: 'mars:put_item', params: { item: 'e_bowl01', surfaceSlot: `e_table1#${other}` } }] });
  assert.equal(put.ok, true, JSON.stringify(put));
  run(e, 1200, () => (e.world.entities.e_bowl01 as { support?: { kind?: string } }).support?.kind === 'resting-on' && !e.programOf('h_walker0001'));
  assert.deepEqual((e.world.entities.e_bowl01 as { support?: { kind?: string } }).support, { kind: 'resting-on', on: 'e_table1', slot: other });
});

test('world-edit: a closed door blocks the route; opening it restores it; replay and restore agree', async () => {
  const { f, e, ev } = await built();
  const door = { ...house()!, solids: [...house()!.solids!, wall('house:door', [10, 3], [0.55, 0.06], 2.1)] };
  const closed = edit(2, { e_house1: door }, phys(e));
  e.applyWorldEditV1(closed);
  const blocked = e.reachV1({ p: [10, 8] }, { p: [10, 0] });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.code, /route\./);
  // snapshot/restore re-bases on the restored physics, in a fresh process too (the derived assets come from the snapshot)
  const snap = e.snapshot();
  for (const id of Object.keys(CATALOG)) if (id.startsWith('ew:')) delete CATALOG[id];
  const back = f.restore(snap) as unknown as MarsEngine;
  assert.equal(back.reachV1({ p: [10, 8] }, { p: [10, 0] }).ok, false);
  assert.equal(back.stateHash(), e.stateHash());
  e.applyWorldEditV1(edit(3, { e_house1: house() }, phys(e)));
  assert.equal(e.reachV1({ p: [10, 8] }, { p: [10, 0] }).ok, true);
  // a fresh engine fed the same events derives the same physics hash
  const g = f.create(f.genesis('entity-physics')) as unknown as MarsEngine;
  g.applyWorldEditV1(ev); g.applyWorldEditV1(closed);
  assert.equal(phys(g)!.hash, entityPhysicsHash(phys(g)!));
  assert.equal(g.reachV1({ p: [10, 8] }, { p: [10, 0] }).ok, false);
});

test('world-edit: removing a solid entity removes its physics; a world without edits is unchanged', async () => {
  const f = await marsFactory(GREEN_FIELD_WORLD), a = f.create(f.genesis('same')), b = f.create(f.genesis('same')) as unknown as MarsEngine & Engine;
  assert.equal(a.stateHash(), b.stateHash());
  b.applyWorldEditV1(edit(1, { e_wall001: { solids: [wall('w', [0, 5], [5, 0.2])] } }));
  assert.notEqual(a.stateHash(), b.stateHash());
  assert.equal(Object.keys(phys(b)!.byEntity).length, 1);
  b.applyWorldEditV1(edit(2, { e_wall001: null }, phys(b)));
  assert.equal(Object.keys(phys(b)!.byEntity).length, 0);
});

test('world-edit: a fixture that names its floor\'s level sits there, not on the level nearest its height (lane LEVELS)', async () => {
  // one engine level per floor height: the house's floor (2.92 m) matched level 1 (first seen at 2.85 m) and another
  // building's floor made level 2 at 2.95 m, nearer the chair's 2.92 m. Without a level the chair's seat took level 2
  // (no floor there: no standing room); named, it stays on its floor. Old journals (no level) keep the nearest rule.
  const make = async (level?: number) => {
    const f = await marsFactory(GREEN_FIELD_WORLD), e = f.create(f.genesis('entity-physics-level')) as unknown as MarsEngine & Engine;
    const chairId = assetIdFor(chairFacts, '{}'), h = house()!;
    h.surfaces = h.surfaces!.map((s) => (s.level === 1 ? { ...s, y: 2.92 } : s));
    h.links = h.links!.map((l) => ({ ...l, to: { ...l.to, y: 2.92 } }));
    const set: WorldEditV1['set'] = {
      e_house1: h,
      e_shed01: { surfaces: [{ id: 'shed:floor-1', level: 2, y: 2.95, obb: { c: [40, 0], half: [2, 2], yaw: 0 } }] },
      e_chair1: { fixture: { def: chairId, kind: 'fixture', label: 'chair', p: [8, 2.92, -1], yaw: 0, ...(level ? { level } : {}) } },
    };
    const levels = [{ id: 1, y: 2.85, label: 'floor at 2.85 m' }, { id: 2, y: 2.95, label: 'floor at 2.95 m' }];
    const ev: WorldEditV1 = { contract: 'world-edit/1', seq: 1, hash: '', levels, set, assets: { [chairId]: assetFromDef(chairId, chairFacts) } };
    ev.hash = nextEntityPhysics(undefined, ev).hash;
    assert.equal(e.applyWorldEditV1(ev).hash, ev.hash);
    e.spawnHuman({ id: 'h_walker0001', label: 'Walker', soul: 's_walker0001' });
    return e;
  };
  const old = await make();
  assert.equal((old.world.entities.e_chair1 as { level?: number }).level, undefined);
  assert.equal(old.freeSeatSlotsV1('e_chair1', 'h_walker0001')[0]?.level, 2, 'no level: the nearest height (unchanged replay)');
  const e = await make(1);
  assert.equal((e.world.entities.e_chair1 as { level?: number }).level, 1);
  const slots = e.freeSeatSlotsV1('e_chair1', 'h_walker0001');
  assert.equal(slots.length, 1); assert.equal(slots[0].level, 1); assert.ok(slots[0].approach);
  const r = e.perform({ actor: 'h_walker0001', label: 'sit upstairs', steps: [{ verb: 'sit', params: { on: 'e_chair1', seconds: 30 } }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  run(e, 2400, () => e.world.entities.h_walker0001.human?.activity === 'sit');
  assert.equal(e.world.entities.h_walker0001.human?.activity, 'sit');
  assert.equal(e.world.entities.h_walker0001.human?.level, 1);
  assert.deepEqual(e.runtime.violations, []);
});

test('a fixture title edit updates perception without invalidating routes or moving bodies', async () => {
  const {e, ev} = await built();
  const spatial = (e as unknown as {rt:{services:{spatial:{sync(w:unknown):void;epoch:number}}}}).rt.services.spatial;
  spatial.sync(e.world); const epoch = spatial.epoch, before = structuredClone(e.world.entities.h_walker0001.pose);
  const fixture = {...ev.set.e_chair1!.fixture!, label: 'Presenter’s chair'};
  const renamed = edit(2, {e_chair1:{fixture}}, phys(e));
  const result = e.applyWorldEditV1(renamed); spatial.sync(e.world);
  assert.equal(e.world.entities.e_chair1.label, 'Presenter’s chair');
  assert.equal(spatial.epoch, epoch, 'metadata does not cause route replanning');
  assert.deepEqual(result.relocated, []); assert.deepEqual(e.world.entities.h_walker0001.pose, before);
  const moved = edit(3, {e_chair1:{fixture:{...fixture,p:[8.5,2.85,-1]}}}, phys(e));
  e.applyWorldEditV1(moved); spatial.sync(e.world);
  assert.ok(spatial.epoch > epoch, 'a real fixture move still invalidates navigation');
});
