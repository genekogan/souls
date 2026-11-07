// PC17 (#696): two crews side by side. A crew halts short of another crew's load (`pathOtherLoad`) and an idle body
// does not take a station from a crew (`yieldIdle`); a busy one still does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { entityFootprint, Spatial } from '../spatial/service.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { findStations } from '../construction/access.ts';
import { hypot } from '../core/math.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';
import type { SpatialScene } from '../spatial/types.ts';

const scene: SpatialScene = {
  bounds: [-20, -20, 20, 20],
  levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [20, 20], yaw: 0 } }],
  obstacles: [],
  links: [],
};
const REG = new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry]]);
const setup = (...es: Entity[]) => new Runtime(addAll(emptyWorld('crew-clearance', scene), ...es), REG, { spatial: new Spatial(scene) }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]);
/** Someone with a task of their own: nobody can ask them to step aside. */
const busy = (id: string, x: number, z: number) => { const h = human(id, x, z); h.human!.task = 'elsewhere'; return h; };

test('a crew halts short of another crew\'s load, naming that crew, with none of its bodies in the way', () => {
  // crew 2 holds its beam across crew 1's way, stopped by someone busy: only the middle of the beam is on that way
  const rt = setup(
    component('b1', 'beam-12ft', [0, 0, -9], Math.PI / 2), human('p1', 0, -12), human('p2', 0, -6.5),
    component('b2', 'beam-12ft', [-4, 0, 0], 0), human('q1', -6.2, 0), human('q2', -1.8, 0),
    busy('stay', 3.4, 0),
  );
  const one = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b1', to: { x: 0, z: 6, yaw: Math.PI / 2 }, clearLiftV1: true });
  const two = rt.submit('carry', { crew: ['q1', 'q2'], item: 'b2', to: { x: 6, z: 0, yaw: 0 }, clearLiftV1: true });
  assert.equal(one.status, 'executing', one.diagnostic?.message);
  assert.equal(two.status, 'executing', two.diagnostic?.message);
  for (let i = 0; i < 400 && one.diagnostic?.code !== 'carry.path-occupied'; i++) rt.step();
  assert.equal(one.diagnostic?.code, 'carry.path-occupied', `${one.status} ${one.phase}`);
  assert.deepEqual(one.diagnostic?.subjects, ['b1', 'q1'], 'the hold names the load and the other crew');
  // its lane is x = 0 and its carriers walk 0.4 m off it, so a body has to be within about 1 m of that lane to stop it
  const x = (id: string) => Math.abs(rt.world.entities[id].pose.p[0]);
  for (const id of ['q1', 'q2']) assert.ok(x(id) > 1.2, `${id} is off the lane: ${x(id)}`);
  assert.ok(Math.abs(entityFootprint(rt.world.entities.b2).obb.c[0]) < 0.1, 'the middle of the beam is on it');
  // and both get there once crew 2 has gone round the one who won't move
  assert.ok(rt.runUntilIdle(20 * 60), `${one.status} ${two.status}`);
  assert.deepEqual([one.status, two.status], ['completed', 'completed']);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

const target = { label: 'a joist', obb: { c: [0, 0] as [number, number], half: [1.5, 0.1] as [number, number], yaw: 0 }, y: 1, y0: 0.8 };
const stationsWith = (who: Entity | null, yieldIdle?: true) => {
  const rt = setup(human('a', -4, 3), human('b', 4, 3), ...(who ? [who] : []));
  const r = findStations(rt, ['a', 'b'], [[-1.5, 0.6], [1.5, 0.6]], { ...target, ...(yieldIdle ? { yieldIdle } : {}) });
  assert.ok(r.ok, JSON.stringify(r));
  return r.stations.map((s) => s.p);
};

test('someone idle does not take a station from a crew that yields it; someone busy does', () => {
  const [free] = stationsWith(null);
  const [x, z] = free;
  assert.notDeepEqual(stationsWith(human('c', x, z))[0], free, 'as before: a body takes its spot');
  assert.deepEqual(stationsWith(human('c', x, z), true)[0], free, 'an idle body yields it');
  assert.notDeepEqual(stationsWith(busy('c', x, z), true)[0], free, 'a busy body does not');
  const walking = human('c', x, z); walking.human!.activity = 'walk';
  assert.notDeepEqual(stationsWith(walking, true)[0], free, 'nor one on the move');
  const holding = human('c', x, z); holding.human!.grip = { entity: 'b1', slot: 'end-a' };
  assert.notDeepEqual(stationsWith(holding, true)[0], free, 'nor one holding something');
});
