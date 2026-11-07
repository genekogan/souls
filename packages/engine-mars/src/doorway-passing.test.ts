// F3 (rehearsal item 14): two Souls meeting face to face in a god-built cottage's doorway must pass within seconds
// (one steps aside), never both "wait" for minutes. Party Hill (2026-10-10) deadlocked ~2.5 min in rose-cottage: both
// bodies inside one single-file (narrow) stretch, the holder waiting for the person in its way, the other yielding the
// passage it could not leave; W47's release only swapped the two roles every 3 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD, type MarsEngine } from './engine.ts';
import { nextEntityPhysics, type WorldEditV1 } from './entity-physics.ts';
import type { Engine } from '@souls/engine-contract';

// A one-room cottage as the bridge derives it: four walls, a 1.0 m front door gap (the building generator's exterior
// door width) in the south wall (z = 3) at x = 10.
const wall = (id: string, c: [number, number], half: [number, number]) => ({ id, obb: { c, half, yaw: 0 }, y0: 0, y1: 2.8, kind: 'fixture' as const, label: 'cottage wall' });
function cottage(door = 1.0): WorldEditV1['set'][string] {
  const g = door / 2;
  return {
    surfaces: [{ id: 'cottage:ground', level: 0, y: 0, obb: { c: [10, 0], half: [3.9, 2.9], yaw: 0 } }],
    solids: [wall('cottage:n', [10, -3], [4, 0.11]), wall('cottage:e', [14, 0], [0.11, 3]), wall('cottage:w', [6, 0], [0.11, 3]),
      wall('cottage:s1', [(6 + 10 - g) / 2, 3], [(10 - g - 6) / 2, 0.11]), wall('cottage:s2', [(10 + g + 14) / 2, 3], [(14 - 10 - g) / 2, 0.11])],
  };
}

async function world() {
  const f = await marsFactory(GREEN_FIELD_WORLD), e = f.create(f.genesis('doorway')) as unknown as MarsEngine & Engine;
  const draft: WorldEditV1 = { contract: 'world-edit/1', seq: 1, hash: '', levels: [], set: { e_cottage1: cottage() }, assets: {} };
  draft.hash = nextEntityPhysics(undefined, draft).hash;
  e.applyWorldEditV1(draft);
  return e;
}

const IN = 'h_inside0001', OUT = 'h_outside001';
async function cross(inAt: [number, number], outAt: [number, number]) {
  const e = await world();
  e.spawnHuman({ id: IN, label: 'In', soul: 's_inside0001' });
  e.spawnHuman({ id: OUT, label: 'Out', soul: 's_outside001' });
  const place = (id: string, [x, z]: [number, number], yaw: number) => { const h = e.world.entities[id]; h.pose.p = [x, h.pose.p[1], z]; h.pose.yaw = yaw; };
  place(IN, inAt, 0); place(OUT, outAt, Math.PI);
  const a = e.perform({ actor: IN, label: 'go out', steps: [{ verb: 'mars:walk_to', params: { x: 10.4, z: 7 } }] });
  const b = e.perform({ actor: OUT, label: 'go in', steps: [{ verb: 'mars:walk_to', params: { x: 9.6, z: -1.5 } }] });
  assert.equal(a.ok && b.ok, true, JSON.stringify([a, b]));
  let t = 0, minD = Infinity;
  for (; t < 3600 && (e.programOf(IN) || e.programOf(OUT)); t++) {
    e.step();
    const p = e.world.entities[IN].pose.p, q = e.world.entities[OUT].pose.p;
    minD = Math.min(minD, Math.hypot(p[0] - q[0], p[2] - q[2]));
  }
  return { e, t, minD };
}

for (const [name, inAt, outAt] of [
  ['meeting at the door', [10, 1.2], [10, 4.8]],
  ['face to face inside the door gap', [10, 2.0], [10, 3.2]],
  ['face to face, off-centre', [9.8, 2.2], [10.2, 3.3]],
] as [string, [number, number], [number, number]][]) {
  test(`doorway: two Souls crossing a cottage door in opposite directions both get through within seconds (${name})`, async () => {
    const { e, t, minD } = await cross(inAt, outAt);
    const pos = (id: string) => e.world.entities[id].pose.p.map((v) => +v.toFixed(2)).join(',');
    assert.ok(e.world.entities[IN].pose.p[2] > 5, `the inside walker got out: ${pos(IN)} after ${t} ticks`);
    assert.ok(e.world.entities[OUT].pose.p[2] < 0, `the outside walker got in: ${pos(OUT)} after ${t} ticks`);
    // 20 ticks a second: both through within 30 s (the rehearsal waited ~150 s; unresolved, this runs the full 180 s)
    assert.ok(t < 600, `both through within 30 s (took ${t / 20} s)`);
    assert.ok(minD >= 0.5, `the bodies never overlap (closest ${minD.toFixed(2)} m)`);
    assert.deepEqual(e.runtime.violations, []);
  });
}
