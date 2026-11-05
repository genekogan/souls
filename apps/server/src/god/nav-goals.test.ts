import test from 'node:test';
import assert from 'node:assert/strict';
import { GodNav, type NavHost } from './nav.ts';

type Vec2 = [number, number];
/** Target-selection unit fixture: exact local standing space and reachability, independent of raster resolution. */
function house(degrees: number, offCentre = false, pocket?: Vec2, aside?: Vec2) {
  const yaw = degrees * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw), origin: Vec2 = [13.17, -7.23];
  const world = ([x, z]: Vec2): Vec2 => [origin[0] + x * c + z * s, origin[1] - x * s + z * c];
  const local = ([x, z]: Vec2): Vec2 => [(x - origin[0]) * c - (z - origin[1]) * s, (x - origin[0]) * s + (z - origin[1]) * c];
  const entity = { id: 'house', name: 'house', def: 'house@1', in: { parent: 'world' } };
  const def = { name: 'house', form: 'point', components: {}, tags: ['building'], make: { kind: 'mesh' } };
  const polygon = offCentre ? [[2.6, -3], [3.4, -3], [3.4, 4], [2.6, 4]] : [[-4, -3], [4, -3], [4, 4], [-4, 4]];
  const baked = { rooms: [{ id: 'living', polygon }],
    slots: [{ id: 'living', kind: 'room', p: [offCentre ? 3 : 0, 0, 0.5], yaw: 0 }],
    openings: [{ id: 'front-door', kind: 'door', at: [offCentre ? 3 : 0, 4], yaw: 0, width: 1, state: 'open' }] };
  const attempts: Vec2[] = [];
  const nav = new GodNav({ model: {
    entities: new Map([['house', entity]]), editSeq: 1,
    ground: () => ({ waters: [] }), resolvedDef: () => def, bake: () => baked,
    worldPose: () => ({ x: origin[0], y: 0, z: origin[1], yaw, s: 1 }),
    pathOf: () => 'house', get: () => undefined,
  }, engine: { world: { tick: 0, entities: {} },
    standableNearV1: (at: Vec2, _level: number, _except: unknown, _r: number, ring?: number) => {
      // `aside`: someone already stands on the room's goal, so the people-aware 6-ring refinement moves to this local spot
      if (aside && ring === 6) return world(aside);
      const [x, z] = local(at);
      // A narrow entrance wing offset from the building centre. There is standing room only along its actual
      // opening normal; a radial approach is in the side wall. Outside the front wall is ordinary open ground.
      return !offCentre || z >= 4 || (x >= 2.6 && x <= 3.4) ? at : null;
    },
    reachV1: (_from: unknown, to: { p: Vec2 }) => {
      const p = local(to.p); attempts.push(p);
      return { ok: !!pocket && Math.hypot(p[0] - pocket[0], p[1] - pocket[1]) < 0.04 };
    },
  }, levelAt: () => 0, engineOwned: () => false } as unknown as NavHost);
  return { nav, world, local, attempts };
}

test('off-centre entrances use the opening normal at every building yaw', () => {
  for (const degrees of [0, 30, 37, 45, 60, 82]) {
    const { nav, world, local } = house(degrees, true);
    const building = nav.thing('house')!;
    const goal = nav.goal(building, world([3, 8]));
    assert.ok(goal, `${degrees}: an indoor goal exists`);
    const p = local(goal.p);
    assert.ok(Math.abs(p[0] - 3) < 0.02 && Math.abs(p[1] - 3) < 0.02, `${degrees}: inside along the door normal, got ${p}`);
    const approach = local(building.stands![0]);
    assert.ok(Math.abs(approach[0] - 3) < 0.002 && Math.abs(approach[1] - 5.2) < 0.002, `${degrees}: approach is normal to the opening`);
  }
});

test('a reachable furnished-room pocket stays offered after the building turns', () => {
  for (const degrees of [0, 30, 37, 45, 60, 82]) {
    const pocket: Vec2 = [-0.1, 0.3];
    const { nav, world, local } = house(degrees, false, pocket);
    const goal = nav.goal(nav.thing('house/living')!, world([0, 8]));
    assert.ok(goal, `${degrees}: the reachable pocket is found`);
    const p = local(goal.p);
    assert.ok(Math.hypot(p[0] - pocket[0], p[1] - pocket[1]) < 0.04, `${degrees}: goal stays in the reachable pocket`);
  }
});

test('a room goal moved aside round someone standing on it stays where the front door reaches (else the reachable goal)', () => {
  // V6-party S6 (moss-cottage living, two extra chairs and a hearth): the spot beside the occupied goal was inside the room
  // but in a pocket the furniture closes off, and the act was refused route.unreachable
  for (const degrees of [0, 37]) {
    const centre: Vec2 = [0, 0.5], pocket: Vec2 = [-3.4, -2.6];
    const { nav, world, local } = house(degrees, false, centre, pocket);
    const goal = nav.goal(nav.thing('house/living')!, world([0, 8]));
    assert.ok(goal, `${degrees}: a goal exists`);
    const p = local(goal.p);
    assert.ok(Math.hypot(p[0] - centre[0], p[1] - centre[1]) < 0.04, `${degrees}: not the closed-off spot beside it, got ${p}`);
  }
});

test('furnished-room fallback samples rotate with the room, preserving bounded reach checks', () => {
  let baseline: Vec2[] | undefined;
  for (const degrees of [0, 30, 37, 45, 60, 82]) {
    const { nav, world, attempts } = house(degrees);
    assert.equal(nav.goal(nav.thing('house/living')!, world([0, 8])), null, 'the exact reach oracle refuses every pocket');
    assert.ok(attempts.length > 1 && attempts.length <= 15, 'centre plus at most fourteen fallback reach checks');
    if (!baseline) baseline = attempts;
    else {
      assert.equal(attempts.length, baseline.length);
      // Published goals round world coordinates to centimetres; compare local samples within that rounding envelope.
      for (let i = 0; i < attempts.length; i++) assert.ok(Math.hypot(attempts[i][0] - baseline[i][0], attempts[i][1] - baseline[i][1]) < 0.015,
        `${degrees}: local fallback ${i} changed from ${baseline[i]} to ${attempts[i]}`);
    }
  }
});

test('freeze2/L3: room goals stay cached per world version past 200 rooms (no re-routing every room on each sweep)', () => {
  // one long hall of 260 small rooms, each reachable at its centre from its own door: a Soul's capabilities sweep reads every
  // room's goal; once the 50-tick goal cache lapses, the next sweep must reuse the per-version room goals, not route again
  const n = 260, rooms = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, polygon: [[i * 3, 0], [i * 3 + 2, 0], [i * 3 + 2, 2], [i * 3, 2]] }));
  const baked = { rooms, slots: rooms.map((r, i) => ({ id: r.id, kind: 'room', p: [i * 3 + 1, 1, 0.5], yaw: 0 })),
    openings: rooms.map((r, i) => ({ id: `door-${r.id}`, kind: 'door', at: [i * 3 + 1, 0], yaw: Math.PI, width: 1, state: 'open' })) };
  const entity = { id: 'hall', name: 'hall', def: 'hall@1', in: { parent: 'world' } };
  const def = { name: 'hall', form: 'point', components: {}, tags: ['building'], make: { kind: 'mesh' } };
  let reaches = 0; const world = { tick: 0, entities: {} };
  const nav = new GodNav({ model: { entities: new Map([['hall', entity]]), editSeq: 1, ground: () => ({ waters: [] }), resolvedDef: () => def, bake: () => baked,
    worldPose: () => ({ x: 0, y: 0, z: 0, yaw: 0, s: 1 }), pathOf: () => 'hall', get: () => undefined },
  engine: { world, standableNearV1: (at: Vec2) => at, reachV1: () => { reaches++; return { ok: true }; } }, levelAt: () => 0, engineOwned: () => false } as unknown as NavHost);
  const roomThings = nav.things().filter(t => t.kind === 'room' && t.entry);
  assert.ok(roomThings.length >= 250, `rooms in the index: ${roomThings.length}`);
  const sweep = () => { for (const t of roomThings) assert.ok(nav.goal(t, [0, -5]), t.ref); };
  sweep(); const first = reaches; assert.ok(first >= roomThings.length);
  world.tick += 200; sweep();
  assert.equal(reaches, first, 'the second sweep reuses every room goal of this world version');
});

// Lane M 2026-10-17 (Mars): from the kitchen's raised dining hall `walk:freeside` (~90 m) failed "too far to plan from
// an upper floor; walk down first" (the engine pages long walks on the ground only). A far ground goal from a raised room
// now walks out to the building's front first.
test('from a raised room, a far ground goal is walked to via the building front; a near one directly', () => {
  const entities = new Map<string, unknown>([
    ['house', { id: 'house', name: 'house', def: 'house@1', in: { parent: 'world' } }],
    ['shed', { id: 'shed', name: 'shed', def: 'shed@1', in: { parent: 'world' } }],
    ['hut', { id: 'hut', name: 'hut', def: 'shed@1', in: { parent: 'world' } }],
    ['me', { id: 'me', def: 'core/humanoid@1', in: { parent: 'world' } }],
  ]);
  const defs: Record<string, unknown> = {
    'house@1': { name: 'house', form: 'point', components: {}, tags: ['building'], make: { kind: 'mesh' } },
    'shed@1': { name: 'shed', form: 'point', components: {}, tags: [], make: { kind: 'mesh' } },
    'core/humanoid@1': { name: 'core-humanoid', form: 'point', components: { body: {} }, tags: ['body'], make: { kind: 'none' } },
  };
  const bakes: Record<string, unknown> = {
    'house@1': { rooms: [{ id: 'hall', polygon: [[-4, -3], [4, -3], [4, 3], [-4, 3]], y: 0.53 }], slots: [{ id: 'hall', kind: 'room', p: [0, 0.53, 0], yaw: 0 }],
      openings: [{ id: 'front-door', kind: 'door', at: [0, 3], yaw: 0, width: 1, state: 'open' }] },
    'shed@1': { slots: [], colliders: [] },
  };
  const poses: Record<string, { x: number; y: number; z: number; yaw: number; s: number }> = { house: { x: 0, y: 0, z: 0, yaw: 0, s: 1 }, shed: { x: 100, y: 0, z: 0, yaw: 0, s: 1 }, hut: { x: 20, y: 0, z: 0, yaw: 0, s: 1 }, me: { x: 0, y: 0.53, z: 0, yaw: 0, s: 1 } };
  const nav = new GodNav({ model: {
    entities, editSeq: 1, ground: () => ({ waters: [] }),
    resolvedDef: (ref: string) => defs[ref], bake: (d: { name: string }) => bakes[`${d.name.replace(/^core-/, 'core/')}@1`] ?? { slots: [] },
    worldPose: (e: { id: string }) => poses[e.id], pathOf: (id: string) => id, get: () => undefined,
  }, engine: { world: { tick: 0, entities: { me: { pose: { p: [0, 0.53, 0], yaw: 0 }, human: { level: 1, activity: 'stand' } } } },
    standableNearV1: (at: Vec2) => at, reachV1: () => ({ ok: true }), clearanceAtV1: () => 1,
  }, levelAt: (_x: number, _z: number, y?: number) => ((y ?? 0) > 0.3 ? 1 : 0), engineOwned: () => false } as unknown as NavHost);
  const caps: { id: string }[] = [], plans = new Map<string, { steps: { verb: string; params: Record<string, unknown> }[] }>();
  nav.capabilities({ soulId: 's', entityId: 'me' } as never, caps as never, plans as never);
  const far = plans.get('walk:shed'), near = plans.get('walk:hut');
  assert.ok(far && near, `plans offered: ${[...plans.keys()].join(', ')}`);
  assert.equal(far.steps.length, 2, JSON.stringify(far.steps));
  assert.deepEqual([far.steps[0].verb, far.steps[0].params.level], ['mars:walk_to', 0]);
  assert.ok(Math.abs((far.steps[0].params.z as number) - 3) < 1.5, `walks out through the front door first: ${JSON.stringify(far.steps[0])}`);
  assert.equal(near.steps.length, 1, 'a near ground goal is planned directly');
});

test('#882: a roof goal cached before navigation warms is made again once warm (RESOLVE2 roofReach), then cached', () => {
  // A roof whose own patch (x < 2) is cut off from the stair's strip (x >= 2): connected only from x = 2.
  const clock = { tick: 0 }, nav0 = { warm: false, checks: 0 };
  const nav = new GodNav({ model: { entities: new Map(), editSeq: 1, ground: () => ({ waters: [] }), resolvedDef: () => undefined, pathOf: () => '', get: () => undefined },
    engine: { world: clock, standableNearV1: (at: Vec2) => at, navWarmV1: () => nav0.warm, navNearestMainV1: () => null,
      navCheckV1: (xs: { id: string; p: Vec2 }[]) => { nav0.checks++; return xs.map(x => ({ id: x.id, ok: x.p[0] >= 2 })); } },
    levelAt: () => 1, engineOwned: () => false } as unknown as NavHost);
  const planter = { ref: 'house/roof-planter', id: 'planter', name: 'roof planter', words: ['planter'], kind: 'thing', at: [0, 0], level: 1, stands: [[0, 0]] } as unknown as Parameters<GodNav['goal']>[0];
  const me: Vec2 = [0, 20];
  assert.deepEqual(nav.goal(planter, me), { p: [0, 0], level: 1 }, 'cold: the planter front, unchecked');
  nav0.warm = true; clock.tick = 1;
  assert.deepEqual(nav.goal(planter, me), { p: [2, 0], level: 1 }, 'warm, inside the old entry\'s 50 ticks: moved to the connected strip');
  const checks = nav0.checks; clock.tick = 2;
  assert.deepEqual(nav.goal(planter, me), { p: [2, 0], level: 1 });
  assert.equal(nav0.checks, checks, 'a goal made warm keeps the 50-tick cache');
});
