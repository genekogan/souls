// route-reach/1 (#872): reachable places refused by the paged planner. One regression per fixed cause, each shown refused
// without the policy (old histories keep that answer) and planned and walked with it; a place no walk reaches still refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD } from './engine.ts';
import { groundFact } from './ground-bridge.ts';
import { nextEntityPhysics, type WorldEditV1 } from './entity-physics.ts';
import { emptyGround } from '../../ground/src/index.ts';

const factory = await marsFactory(GREEN_FIELD_WORLD);
type Body = { pose: { p: [number, number, number] }; human: { level?: number } };
type Reach = { ok: true; length: number; levels: number[] } | { ok: false; code: string; message: string };
type Eng = ReturnType<typeof factory.create> & { installGroundV1(f: unknown): unknown; applyWorldEditV1(ev: WorldEditV1): { hash: string; trapped: string[] };
  reachV1(a: { p: [number, number]; level?: number }, b: { p: [number, number]; level?: number }): Reach; relocateHumanV1(id: string, to: [number, number]): boolean;
  configureRuntimePolicy(p: { sleepBlockTicks: number; routeReachV1?: boolean }): void; world: { entities: Record<string, Body> }; runtime: { violations: unknown[] } };
const wall = (id: string, c: [number, number], half: [number, number]) => ({ id, obb: { c, half, yaw: 0 }, y0: 0, y1: 3, kind: 'fixture' as const, label: 'fence' });
function world(seed: string, set: WorldEditV1['set'], levels: WorldEditV1['levels'] = [], policy = false): Eng {
  const g = emptyGround(2000); g.extent = [-200, -1000, 1800, 1000];
  const e = factory.create(factory.genesis(seed)) as never as Eng;
  e.installGroundV1(groundFact(g, 1, { paged: true }));
  e.spawnHuman({ id: 'h_ana', label: 'Ana', soul: 's_ana' });
  const ev: WorldEditV1 = { contract: 'world-edit/1', seq: 1, hash: '', levels, set, assets: {} };
  ev.hash = nextEntityPhysics(undefined, ev).hash;
  assert.equal(e.applyWorldEditV1(ev).hash, ev.hash);
  if (policy) e.configureRuntimePolicy({ sleepBlockTicks: 1200, routeReachV1: true });
  return e;
}
const run = (e: Eng, steps: unknown[], ticks = 20 * 240) => {
  const adm = e.perform({ actor: 'h_ana', label: 'walk', steps } as never) as { ok: boolean; id: string; diagnostic?: unknown };
  assert.ok(adm.ok, JSON.stringify(adm));
  for (let n = 0; n < ticks; n++) { const end = (e.step().programs as { id: string; kind: string; code?: string }[]).find((p) => p.id === adm.id && ['completed', 'failed', 'cancelled'].includes(p.kind)); if (end) return end; }
  return null;
};

// A fence 110 m long the coarse path crosses (thin walls are not coarse-solid): the start and the goal lie in one 64 m
// ground tile, so the hop's window is that tile, and the only way round leaves it (bench-eden: eden-classroom-1).
const fence = { e_fence: { surfaces: [], solids: [wall('fence', [85, 35], [0.11, 55])], links: [] } } as unknown as WorldEditV1['set'];
test('route-reach/1: a hop whose way round leaves the tile window is planned one tile wider, and walked', () => {
  const old = world('fence-old', fence), now = world('fence-new', fence, [], true);
  const before = old.reachV1({ p: [70, 32] }, { p: [100, 32] });
  assert.equal(before.ok, false); assert.equal((before as { code: string }).code, 'route.unreachable', JSON.stringify(before));
  const after = now.reachV1({ p: [70, 32] }, { p: [100, 32] });
  assert.equal(after.ok, true, JSON.stringify(after)); assert.ok((after as { length: number }).length > 100, `round the fence: ${JSON.stringify(after)}`);
  assert.ok(now.relocateHumanV1('h_ana', [70, 32]));
  const b = now.world.entities.h_ana; let crossed = false, x0 = b.pose.p[0];
  const steps = [{ verb: 'walk_to', params: { to: [100, 32] } }];
  const adm = now.perform({ actor: 'h_ana', label: 'walk', steps } as never) as { ok: boolean; id: string };
  assert.ok(adm.ok, JSON.stringify(adm));
  let end;
  for (let n = 0; n < 20 * 240 && !end; n++) {
    end = (now.step().programs as { id: string; kind: string; code?: string }[]).find((p) => p.id === adm.id && ['completed', 'failed', 'cancelled'].includes(p.kind));
    const [x, , z] = b.pose.p; if ((x0 - 85) * (x - 85) < 0 && z > -20 && z < 90) crossed = true; x0 = x;
  }
  assert.equal(end?.kind, 'completed', JSON.stringify(end));
  assert.ok(Math.hypot(b.pose.p[0] - 100, b.pose.p[2] - 32) < 1, `arrived: ${b.pose.p}`);
  assert.equal(crossed, false, 'never through the fence');
  assert.deepEqual(now.runtime.violations, []);
});

test('route-reach/1: a place no walk reaches still refuses honestly', () => {
  // the same fence closed into a ring round the goal: no way in at any window
  const ring = { e_ring: { surfaces: [], solids: [wall('n', [100, 22], [10, 0.11]), wall('s', [100, 42], [10, 0.11]), wall('w', [90, 32], [0.11, 10]), wall('e', [110, 32], [0.11, 10])], links: [] } } as unknown as WorldEditV1['set'];
  const composites = (x: Eng) => (x as never as { rt: { services: { spatial: { ground: { stats: { composites: number } } } } } }).rt.services.spatial.ground.stats.composites;
  const off = world('ring-off', ring), e = world('ring', ring, [], true);
  for (const x of [off, e]) {
    const c0 = composites(x), r = x.reachV1({ p: [70, 32] }, { p: [100, 32] });
    assert.equal(r.ok, false, JSON.stringify(r)); assert.equal((r as { code: string }).code, 'route.unreachable');
    (x as never as { spent: number }).spent = composites(x) - c0;
  }
  // and cheaply: the sealed goal is found inside the first window, so no wider window is composed (review: it flooded one)
  assert.equal((e as never as { spent: number }).spent, (off as never as { spent: number }).spent, 'no extra window for a sealed goal');
});

// A two-storey house with stairs: from its upper floor, a ground goal 110 m away was refused `ground.too-far`.
const [cx, cz] = [60, 30];
const house = { e_house: {
  surfaces: [{ id: 'h:ground', level: 0, y: 0, obb: { c: [cx, cz], half: [3.9, 2.9], yaw: 0 } }, { id: 'h:floor-1', level: 1, y: 2.85, obb: { c: [cx, cz], half: [3.9, 2.9], yaw: 0 } }],
  solids: [wall('h:n', [cx, cz - 3], [4, 0.11]), wall('h:e', [cx + 4, cz], [0.11, 3]), wall('h:w', [cx - 4, cz], [0.11, 3]), wall('h:s1', [cx - 2.275, cz + 3], [1.725, 0.11]), wall('h:s2', [cx + 2.275, cz + 3], [1.725, 0.11])].map((s) => ({ ...s, y1: 5.6 })),
  links: [{ id: 'h:stairs', kind: 'stairs', from: { level: 0, p: [cx + 3.2, cz + 1.6], y: 0 }, to: { level: 1, p: [cx + 3.2, cz - 1.6], y: 2.85 }, width: 1.1, heading: -Math.PI / 2, path: Array.from({ length: 17 }, (_, i) => [cx + 3.2, (2.85 * i) / 16, cz + 1.6 - (3.2 * i) / 16] as [number, number, number]), usable: true }],
} } as unknown as WorldEditV1['set'];
const floors = [{ id: 1, y: 2.85, label: 'floor at 2.85 m' }];
test('route-reach/1: a far walk from an upper floor goes down the stairs and on, a chunk at a time', () => {
  const old = world('upper-old', house, floors), now = world('upper-new', house, floors, true);
  const from = { p: [cx - 2, cz - 1] as [number, number], level: 1 }, far: [number, number] = [cx + 110, cz + 5];
  const before = old.reachV1(from, { p: far });
  assert.equal(before.ok, false); assert.equal((before as { code: string }).code, 'ground.too-far', JSON.stringify(before));
  const after = now.reachV1(from, { p: far });
  assert.equal(after.ok, true, JSON.stringify(after)); assert.deepEqual((after as { levels: number[] }).levels.sort(), [0, 1]);
  // the walk itself: up the stairs first, then the far walk from the upper floor
  const up = run(now, [{ verb: 'mars:walk_to', params: { x: from.p[0], z: from.p[1], level: 1 } }]);
  assert.equal(up?.kind, 'completed', JSON.stringify(up)); assert.equal(now.world.entities.h_ana.human.level, 1);
  const go = run(now, [{ verb: 'mars:walk_to', params: { x: far[0], z: far[1], level: 0 } }]);
  assert.equal(go?.kind, 'completed', JSON.stringify(go));
  const p = now.world.entities.h_ana.pose.p;
  assert.ok(Math.hypot(p[0] - far[0], p[2] - far[1]) < 1, `arrived: ${p}`); assert.equal(now.world.entities.h_ana.human.level ?? 0, 0);
  assert.deepEqual(now.runtime.violations, []);
});

test('route-reach/1 replays: a snapshot keeps the policy, and a world without it is unchanged', () => {
  const now = world('upper-snap', house, floors, true);
  const b = factory.restore(now.snapshot()) as never as Eng;
  const from = { p: [cx - 2, cz - 1] as [number, number], level: 1 }, far: [number, number] = [cx + 110, cz + 5];
  assert.equal(b.reachV1(from, { p: far }).ok, true, 'restored with the policy');
  const old = factory.restore(world('upper-old2', house, floors).snapshot()) as never as Eng;
  assert.equal((old.reachV1(from, { p: far }) as { code?: string }).code, 'ground.too-far', 'restored without it');
});

// bench-eden / eden-2026: from an upper floor, `walk:field` (a place 100 m away) said "field is full and nobody can stand
// beside it" when every spot was only too far to plan; now it is planned. (A place people fill still says full: it is the
// unchanged branch, taken only while someone stands inside it.)
test('route-reach/1: a far place is planned from an upper floor, not reported full', () => {
  type R = Eng & { installPlaceRegionsV1(l: { id: string; label: string; polygon: [number, number][] }[]): string[]; canPerform(p: unknown): { code: string; message: string } | null };
  const mk = (seed: string, policy: boolean) => {
    const e = world(seed, house, floors, policy) as R;
    e.configureRuntimePolicy({ sleepBlockTicks: 1200, spreadV2: true, ...(policy ? { routeReachV1: true } : {}) } as never);
    assert.deepEqual(e.installPlaceRegionsV1([{ id: 'far-field', label: 'Far field', polygon: [[160, 20], [175, 20], [175, 35], [160, 35]] }]), ['far-field']);
    const up = run(e, [{ verb: 'mars:walk_to', params: { x: cx - 2, z: cz - 1, level: 1 } }]);
    assert.equal(up?.kind, 'completed', JSON.stringify(up)); assert.equal(e.world.entities.h_ana.human.level, 1);
    return e;
  };
  const steps = [{ verb: 'walk_to', params: { to: 'far-field', spread: 'region/1' } }];
  const old = mk('field-old', false).canPerform({ actor: 'h_ana', label: 'walk to the field', steps });
  assert.equal(old?.code, 'route.region-full', JSON.stringify(old));
  const now = mk('field-new', true);
  assert.equal(now.canPerform({ actor: 'h_ana', label: 'walk to the field', steps }), null);
  const go = run(now, steps);
  assert.equal(go?.kind, 'completed', JSON.stringify(go));
  const p = now.world.entities.h_ana.pose.p; assert.ok(p[0] >= 160 && p[0] <= 175 && p[2] >= 20 && p[2] <= 35, `in the field: ${p}`);
  assert.deepEqual(now.runtime.violations, []);
});

// Review round 2: a sealed area bigger than a bounded flood (a 55 x 56 m walled yard) must not pay for the wide window
// either, for one walk or for a spread into it (every spot of the yard, each a refused plan).
test('route-reach/1: a large sealed yard is refused as cheaply as before, walk and spread', () => {
  type R = Eng & { installPlaceRegionsV1(l: { id: string; label: string; polygon: [number, number][] }[]): string[] };
  const yard = { e_yard: { surfaces: [], solids: [wall('n', [97.5, 4], [27.5, 0.11]), wall('s', [97.5, 60], [27.5, 0.11]), wall('w', [70, 32], [0.11, 28]), wall('e', [125, 32], [0.11, 28])], links: [] } } as unknown as WorldEditV1['set'];
  const composites = (x: Eng) => (x as never as { rt: { services: { spatial: { ground: { stats: { composites: number } } } } } }).rt.services.spatial.ground.stats.composites;
  const spent: Record<string, number[]> = {};
  for (const [name, policy] of [['off', false], ['on', true]] as const) {
    const e = world(`yard-${name}`, yard, [], policy) as R;
    e.configureRuntimePolicy({ sleepBlockTicks: 1200, spreadV2: true, ...(policy ? { routeReachV1: true } : {}) } as never);
    assert.deepEqual(e.installPlaceRegionsV1([{ id: 'walled-yard', label: 'Walled yard', polygon: [[75, 9], [120, 9], [120, 55], [75, 55]] }]), ['walled-yard']);
    assert.ok(e.relocateHumanV1('h_ana', [50, 32]));
    const c0 = composites(e), walk = e.reachV1({ p: [50, 32] }, { p: [100, 32] }), c1 = composites(e);
    assert.equal(walk.ok, false, JSON.stringify(walk));
    // a spread's spot is chosen when the step expands (canPerform admits it), so the walk itself is run to its refusal
    const end = run(e, [{ verb: 'walk_to', params: { to: 'walled-yard', spread: 'region/1' } }], 20 * 60);
    assert.equal(end?.kind, 'failed', JSON.stringify(end)); assert.equal(end?.code, 'route.unreachable');
    spent[name] = [c1 - c0, composites(e) - c1];
  }
  assert.deepEqual(spent.on, spent.off, `no extra window composed: ${JSON.stringify(spent)}`);
});

// Review round 3: the per-grid memo. An open flood first, then a room whose only door opens onto that open ground: the room
// is not sealed (an earlier flood's "reaches the edge" cells are a way out, never a wall).
test('route-reach/1: enclosedIn memo never seals a room that opens onto ground an earlier flood reached', async () => {
  const { enclosedIn } = await import('../../../mars/viewer/engine/spatial/tiled.ts');
  const grid = (sealed: boolean) => {
    const n = 30, clearance = new Float32Array(n * n).fill(1), at = (i: number, j: number) => j * n + i;
    for (let i = 22; i <= 28; i++) { clearance[at(i, 12)] = 0; clearance[at(i, 18)] = 0; }
    for (let j = 12; j <= 18; j++) { clearance[at(28, j)] = 0; if (j !== 15 || sealed) clearance[at(22, j)] = 0; }
    return { level: 0, y: 0, cell: 1, nx: n, nz: n, ox: 0, oz: 0, x0: 0, z0: 0, free: new Uint8Array(n * n).fill(1), clearance, blockers: new Map() } as never;
  };
  const room: [number, number] = [25.5, 15.5], open: [number, number] = [12.5, 15.5];
  const g = grid(false);
  assert.equal(enclosedIn(g, open, 0.5, 0.5), false);
  assert.equal(enclosedIn(g, room, 0.5, 0.5), false, 'the room opens onto the flooded ground');
  assert.equal(enclosedIn(g, room, 0.5, 0.5), false, 'and the memo agrees');
  const s = grid(true);
  assert.equal(enclosedIn(s, open, 0.5, 0.5), false);
  assert.equal(enclosedIn(s, room, 0.5, 0.5), true, 'a room with no door is sealed');
  assert.equal(enclosedIn(s, room, 0.5, 0.5), true);
});
