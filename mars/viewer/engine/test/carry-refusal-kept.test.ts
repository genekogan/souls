// #1015: a refused native carry plan is kept, so the same refused request does not search again. The verdict is the
// one a fresh search gives; feasible routes are never kept; a navigation change searches afresh. Work is counted in
// planner poses (Spatial.stats.carry*), not wall time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { carryCorridors } from '../carry/scenes.ts';
import { formationFor, laidPose } from '../carry/formation.ts';
import { KEPT_REFUSALS_PER_GRID } from '../carry/validate.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';

const REG = new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry]]);
const upright19 = (id: string, x: number, z: number, th = 0) => {
  const pose = laidPose(formationFor('upright-19ft', 4), { x, z, th }, 0);
  return component(id, 'upright-19ft', pose.p, pose.yaw, { pose });
};
const crew = ['q1', 'q2', 'q3', 'q4'];
/** Corridor B (1.5 m): four people walk it, the 19 ft formation cannot (carry.clearance after a full search). */
function narrow(...more: Entity[]) {
  const w = addAll(emptyWorld('carry-refusal-kept', carryCorridors()), upright19('u1', 4, 22), human('q1', 1.5, 19.5), human('q2', 6.5, 19.5), human('q3', 1.5, 24.5), human('q4', 6.5, 24.5), ...more);
  const sp = new Spatial(carryCorridors());
  return { rt: new Runtime(w, REG, { spatial: sp }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]), sp };
}
const far = { crew, item: 'u1', to: { x: 18, z: 36, yaw: Math.PI / 2 } };
const stats = (sp: Spatial) => ({ searches: sp.stats.carrySearches, expanded: sp.stats.carryExpanded, kept: sp.stats.carryRefusalsKept });

test('#1015: the same refused carry searches once; 60 repeats return the fresh verdict and expand no more poses', () => {
  const { rt, sp } = narrow(), before = rt.stateHash();
  const first = rt.submit('carry', far);
  assert.equal(first.status, 'failed'); assert.equal(first.diagnostic!.code, 'carry.clearance', first.diagnostic!.message);
  const once = stats(sp);
  assert.equal(once.searches, 1); assert.ok(once.expanded > 1000, `a real search (${once.expanded} poses)`); assert.equal(once.kept, 0);
  for (let i = 0; i < 60; i++) {
    const again = rt.submit('carry', far);
    assert.equal(again.status, 'failed');
    assert.deepEqual(again.diagnostic, first.diagnostic, `repeat ${i}: the same code, message, subjects, at and details`);
  }
  assert.deepEqual(stats(sp), { searches: 1, expanded: once.expanded, kept: 60 }, '60 repeats answered from the kept verdict');
  assert.equal(rt.stateHash(), before, 'nothing in the world changed');
  // a fresh engine on the same world searches again and reaches the identical verdict (the cache is never the authority)
  const fresh = narrow(), r = fresh.rt.submit('carry', far);
  assert.deepEqual(r.diagnostic, first.diagnostic); assert.equal(fresh.sp.stats.carrySearches, 1);
  // the copy handed out cannot change what is kept
  (first.diagnostic as { message: string }).message = 'mutated by a caller';
  assert.notEqual(rt.submit('carry', far).diagnostic!.message, 'mutated by a caller');
});

test('#1015: a different request (another target, crew order or start) is its own search', () => {
  const { rt, sp } = narrow();
  rt.submit('carry', far); rt.submit('carry', { ...far, to: { ...far.to, x: 17.5 } }); rt.submit('carry', { ...far, crew: ['q2', 'q1', 'q3', 'q4'] });
  assert.equal(sp.stats.carrySearches, 3);
  rt.submit('carry', far); assert.equal(sp.stats.carrySearches, 3, 'the first one is still kept');
});

test('#1015: a feasible carry is never kept; it plans every time', () => {
  const { rt, sp } = narrow(), near = { crew, item: 'u1', to: { x: 4, z: 21, yaw: 0 } };
  for (let i = 0; i < 3; i++) {
    const a = rt.submit('carry', near);
    assert.equal(a.status, 'executing', a.diagnostic?.message); rt.cancel(a.id);
  }
  assert.equal(sp.stats.carrySearches, 3); assert.equal(sp.stats.carryRefusalsKept, 0);
});

test('#1015: a navigation change searches afresh; a static obstacle anywhere is a new grid', () => {
  const { rt, sp } = narrow();
  const first = rt.submit('carry', far); const epoch = sp.epoch;
  rt.world.entities.crate = component('crate', 'upright-19ft', [4, 0, 4], 0, { phase: 'stored' });
  const again = rt.submit('carry', far);
  assert.ok(sp.epoch > epoch, 'the scene changed');
  assert.equal(sp.stats.carrySearches, 2, 'searched again after the change');
  assert.equal(again.diagnostic!.code, first.diagnostic!.code);
});

test('#1015: at most a few refusals are kept per grid, oldest first out', () => {
  const { rt, sp } = narrow();
  const at = (i: number) => ({ ...far, to: { ...far.to, x: 18 - i * 0.01 } });
  for (let i = 0; i <= KEPT_REFUSALS_PER_GRID; i++) rt.submit('carry', at(i));
  assert.equal(sp.stats.carrySearches, KEPT_REFUSALS_PER_GRID + 1);
  rt.submit('carry', at(KEPT_REFUSALS_PER_GRID)); assert.equal(sp.stats.carrySearches, KEPT_REFUSALS_PER_GRID + 1, 'the newest is kept');
  rt.submit('carry', at(0)); assert.equal(sp.stats.carrySearches, KEPT_REFUSALS_PER_GRID + 2, 'the oldest was let go');
});
