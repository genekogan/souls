// SPOTS 2026-10-22: a picnic sits on the blanket (seat top 0.2 m, the ground); a tall body was refused pose.seat-too-low.
// #1083 (Gene, 2026-11-06): any body sits at any seat height a def declares; a picnic, a low stool and a high one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll } from '../world/factory.ts';
import { poseV1 } from '../social/pose.ts';
import type { ActionDef } from '../actions/types.ts';

const tall = () => {
  const scene = provingGround(), world = addAll(emptyWorld('proving-ground', scene), human('a', -6, -6));
  (world.entities.a as any).body = { family: 'humanoid', model: 'humanoid2-0123456789abcdef', params: { height: 1.85 } };
  const spatial = new Spatial(scene); spatial.sync(world);
  return new Runtime(world, new Map<string, ActionDef>([[poseV1.verb, poseV1 as ActionDef]]), { spatial }, DEFAULT_INVARIANTS);
};
test('a tall body picnics on a blanket (0.2 m), eats on a 0.1 m stool and on a 1.6 m one: no seat height is refused', () => {
  for (const [activity, seatHeight] of [['picnic', 0.2], ['eat', 0.2], ['eat', 0.1], ['eat', 1.6]] as const) {
    const rt = tall(), r = rt.submit('pose_v1', { actor: 'a', activity, seconds: 2, base: 'sit', seatHeight });
    assert.notEqual(r.status, 'failed', `${activity} at ${seatHeight} m: ${JSON.stringify(r).slice(0, 300)}`);
    for (let i = 0; i < 80; i++) rt.step();
    assert.deepEqual(rt.violations, [], `${activity} at ${seatHeight} m`);
  }
});
