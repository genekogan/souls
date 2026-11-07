// E1: the public owner/Soul flow must reach actual rooms and seats at arbitrary yaw. This deliberately uses the
// default furnished roundhouse, rather than an empty doorway-only reach query: furniture and seat approaches rotate
// with the house too. One in-memory world and resident serve all angles; houses only turn while the resident is out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { runQuery } from './query.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec3 = [number, number, number];
type Obstacle = { id: string; obb: { c: [number, number]; half: [number, number]; yaw: number }; y0: number; y1: number };
const radians = (degrees: number) => degrees * Math.PI / 180;
const RADIUS = 0.28;
// Native poses and projected OBBs are quantized. This allowance is much smaller than a navigation raster cell.
const EPS = 0.015;

/** Exact disc-to-OBB clearance, independent of the planner's raster and reachability result. */
function clearance(p: Vec3, o: Obstacle) {
  const dx = p[0] - o.obb.c[0], dz = p[2] - o.obb.c[1], c = Math.cos(o.obb.yaw), s = Math.sin(o.obb.yaw);
  const x = Math.max(0, Math.abs(dx * c + dz * s) - o.obb.half[0]);
  const z = Math.max(0, Math.abs(-dx * s + dz * c) - o.obb.half[1]);
  return Math.hypot(x, z);
}

test('furnished roundhouses: enter, reach the named room, sit and leave at 0/30/37/45/60/82 degrees and parent yaw', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const E = f.host.engine as any;
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  let bodyId: string | undefined, ownSeat: string | undefined, previous: Vec3 | undefined, previousSitting = false;
  let trace: Vec3[] | undefined;
  const me = () => E.world.entities[bodyId!];
  const pose = (): Vec3 => [...me().pose.p] as Vec3;
  const sample = () => {
    if (!bodyId) return;
    const p = pose(), h = me().human;
    const sitting = ['sit', 'sit-down', 'stand-up'].includes(h.activity) || h.baseActivity === 'sit';
    // The scene contains the projected building solids and registered furniture obstacles. Only the resident's
    // own seat may overlap its body during the sit/stand transition; walking approaches get the full disc check.
    const obstacles: Obstacle[] = E.rt.services.spatial.scene?.obstacles ?? [];
    assert.ok(obstacles.length, 'the collision oracle sees projected walls and furniture');
    const from = previous ?? p, steps = Math.max(1, Math.ceil(Math.hypot(p[0] - from[0], p[2] - from[2]) / 0.04));
    for (let k = 0; k <= steps; k++) {
      const u = k / steps, q: Vec3 = [from[0] + (p[0] - from[0]) * u, from[1] + (p[1] - from[1]) * u, from[2] + (p[2] - from[2]) * u];
      for (const o of obstacles) {
        if (q[1] + 1.8 <= o.y0 + EPS || q[1] >= o.y1 - EPS) continue;
        if (ownSeat && (sitting || previousSitting) && (o.id === ownSeat || o.id.startsWith(`${ownSeat}#`))) continue;
        const d = clearance(q, o);
        assert.ok(d >= RADIUS - EPS, `tick ${E.world.tick}, ${h.activity}, body ${q}: ${d.toFixed(3)} m from ${o.id}`);
      }
    }
    previous = p; previousSitting = sitting; trace?.push(p);
  };
  const tick = () => { f.host.tickOnce(); sample(); };
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { tick(); await setImmediate(); f.host.drainInputs(); } };
  const edit = (ops: any[], note: string) => {
    const r: any = god.act({ ops }, note);
    assert.equal(r.accepted, true, JSON.stringify(r));
  };
  await settle(2);
  edit([
    { op: 'place', def: coreRef('roundhouse'), name: 'rose-house', p: [-12, 4] },
    { op: 'place', def: coreRef('roundhouse'), name: 'blue-house', p: [12, 4], r: radians(82) },
    { op: 'place', def: coreRef('plaza'), name: 'lawn', shape: { area: [[-3, -14], [3, -14], [3, -8], [-3, -8]] } },
  ], 'two houses and an outside destination');
  for (const ref of ['rose-house', 'blue-house']) {
    const furnish = (runQuery(god.model, { furnish: { ref } }) as any).furnish;
    assert.ok(furnish.ops.length, `${ref} has the default furnishing recipe`);
    edit(furnish.ops, `furnish ${ref}`);
  }
  await settle(4);
  const seatOf = (ref: string) => {
    const house = god.model.get(ref)!;
    const seat = [...god.model.entities.values()].filter((e) => e.in.parent === house.id && e.in.slot === 'living' && god.model.slotsOf(e).some((s) => s.kind === 'seat'))
      .sort((a, b) => Number(!/armchair/.test(a.def)) - Number(!/armchair/.test(b.def)))[0];
    assert.ok(seat, `${ref} has a seat inside its named living room`);
    return seat.id;
  };
  await invite(f, 'yaw');
  const row: any = await accept(f.host, f.souls.create('dev:yaw', { name: 'Yaw', description: 'a scripted visitor' }));
  bodyId = row.entity_id;
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  await settle(3);
  const room = () => (runQuery(god.model, { where: [me().pose.p[0], me().pose.p[2]] }).where as any).room;
  const assertRoom = (ref: string) => assert.deepEqual(room(), { building: ref, room: 'living', floor: 0 }, `in ${ref}/living at ${pose()}`);
  const issue = async (capability: string, params?: Record<string, unknown>) => {
    const a: any = await accept(f.host, edge.act(soul, { capability, ...(params ? { params } : {}) }));
    assert.equal(a.accepted, true, `${capability}: ${JSON.stringify(a)}`);
    return a.receipt?.id ?? a.receiptId ?? a.id;
  };
  const until = async (predicate: () => boolean, label: string, n = 5000) => {
    for (let i = 0; i < n && !predicate(); i++) {
      tick();
      if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); }
    }
    assert.ok(predicate(), `${label}; final pose ${pose()}, activity ${me().human.activity}`);
    await settle(2);
  };
  const walk = async (capability: string) => {
    trace = [pose()];
    const id = await issue(capability);
    await until(() => {
      const r: any = edge.receipt(soul.soulId, id);
      if (r?.phase === 'failed' || r?.phase === 'cancelled') assert.fail(`${capability}: ${JSON.stringify(r)}`);
      return r?.phase === 'completed';
    }, `${capability} completed`);
    const points = trace; trace = undefined;
    return points;
  };
  /** Assert a route crosses the actual front opening, with the whole body clear of the door jambs. */
  const doorwayCrossed = (ref: string, points: Vec3[], inward: boolean) => {
    const house = god.model.get(ref)!, wp = god.model.worldPose(house);
    const baked = god.model.bake(god.model.resolvedDef(house.def)!, house.params ?? {}, house.seed ?? 0, house.shape);
    const door = baked.openings!.find((o) => o.id === 'front-door')!;
    assert.ok(door, `${ref} has a front door`);
    const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw), nx = Math.sin(door.yaw), nz = Math.cos(door.yaw);
    const local = (p: Vec3) => {
      const dx = (p[0] - wp.x) / wp.s, dz = (p[2] - wp.z) / wp.s;
      const x = dx * c - dz * s - door.at[0], z = dx * s + dz * c - door.at[1];
      return { normal: x * nx + z * nz, side: x * nz - z * nx };
    };
    assert.ok(points.some((p, i) => {
      if (!i) return false;
      const a = local(points[i - 1]), b = local(p);
      if (!(inward ? a.normal > 0 && b.normal <= 0 : a.normal < 0 && b.normal >= 0)) return false;
      const u = a.normal / (a.normal - b.normal), side = a.side + (b.side - a.side) * u;
      return Math.abs(side) <= door.width / 2 - RADIUS / wp.s + EPS;
    }), `${ref}: ${inward ? 'entered' : 'left'} through its front door`);
  };
  const visit = async (ref: string) => {
    doorwayCrossed(ref, await walk(`walk:${ref}`), true);
    assertRoom(ref);
    await walk(`walk:${ref}/living`);
    assertRoom(ref);
    ownSeat = seatOf(ref);
    await issue(`sit:${ownSeat}`, { seconds: 600 });
    await until(() => me().human.activity === 'sit' && E.bodyUsesV1(ownSeat)?.body === bodyId, `seated inside ${ref}`);
    assertRoom(ref);
    assert.equal(E.bodyUsesV1(ownSeat)?.body, bodyId, 'the actual indoor seat is held by this resident');
    doorwayCrossed(ref, await walk('walk:lawn'), false);
    assert.equal(room(), null, `outside after leaving ${ref}`);
    assert.equal(E.bodyUsesV1(ownSeat), null, 'leaving releases the indoor seat');
    ownSeat = undefined;
  };
  await walk('walk:lawn');
  await t.test('a closed door refuses an indoor seat without walking through walls', async () => {
    const original = god.model.resolvedDef(coreRef('roundhouse'))!;
    const { ref: _ref, hash: _hash, by: _by, born: _born, ...definition } = original;
    edit([
      { op: 'define', def: { ...definition, name: 'closeable-roundhouse', state: { ...definition.state, doors: { type: 'json', default: {} } } } },
      { op: 'place', tmp: '$sealed', def: 'closeable-roundhouse@1', name: 'sealed-house', p: [0, -24], r: radians(37), state: { doors: { 'front-door': 'closed' } } },
      { op: 'place', def: coreRef('chair'), name: 'chair', in: { parent: '$sealed', slot: 'living' }, p: [0, 0, 0] },
    ], 'close the only entrance to an indoor chair');
    await settle(4);
    const denied: any = await accept(f.host, edge.act(soul, { capability: `sit:${seatOf('sealed-house')}` }));
    assert.equal(denied.accepted, false, 'the unreachable seat is refused before movement');
    assert.match(denied.code, /^(route|slot)\./);
    assert.equal(room(), null, 'the resident remains outside');
    edit([{ op: 'remove', id: 'sealed-house' }], 'remove the closed-door control');
    await settle(4);
  });
  for (const degrees of [0, 30, 37, 45, 60, 82]) {
    await t.test(`${degrees} degrees`, async () => {
      edit([{ op: 'move', id: 'rose-house', p: [-12, 4], r: radians(degrees) }], `turn the empty house to ${degrees} degrees`);
      previous = undefined;
      await settle(4);
      await visit('rose-house');
    });
  }
  await t.test('between two differently rotated houses', async () => {
    edit([{ op: 'move', id: 'rose-house', p: [-12, 4], r: radians(37) }], 'two different house rotations');
    previous = undefined;
    await settle(4);
    await walk('walk:rose-house/living');
    assertRoom('rose-house');
    const points = await walk('walk:blue-house/living');
    doorwayCrossed('rose-house', points, false);
    doorwayCrossed('blue-house', points, true);
    assertRoom('blue-house');
    doorwayCrossed('blue-house', await walk('walk:lawn'), false);
  });
  await t.test('building and furniture compose enclosing-world parent yaw', async () => {
    // A nonphysical world frame exercises the same parent transform used to orient an imported world. No legacy
    // engine map or live world is changed; the child retains its own 37-degree yaw, composed with the frame's 19.
    edit([
      { op: 'define', def: { schema: 'def/1', name: 'yaw-frame', version: 1, description: 'A nonphysical world frame.', tags: ['frame'], make: { kind: 'none' }, layer: 'decor', size: { box: [1, 0.05, 1] } } },
      { op: 'place', tmp: '$frame', def: 'yaw-frame@1', name: 'district', p: [0, 0], r: radians(19) },
      { op: 'move', id: 'rose-house', in: { parent: '$frame' }, p: [-12, 0, 4], r: radians(37) },
    ], 'orient the enclosing world frame');
    previous = undefined;
    await settle(4);
    assert.ok(Math.abs(god.model.worldPose(god.model.get('district/rose-house')!).yaw - radians(56)) < 1e-6, 'parent and building yaws compose');
    await visit('district/rose-house');
  });
  assert.deepEqual(E.runtime.violations, []);
});
