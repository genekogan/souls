// Camera: forced cuts, replay independence (SPEC §28) and planner performance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provingGround } from '../scenes/proving-ground.ts';
import type { Obstacle } from '../spatial/types.ts';
import type { Vec2 } from '../core/math.ts';
import { hashOf } from '../core/hash.ts';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, human, addAll } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import type { ActionDef } from '../actions/types.ts';
import { CameraWorld } from '../camera/geom.ts';
import { placement, sweepCrossing } from '../camera/quality.ts';
import { evaluateShot, type Sampler, type ShotSpec, type SubjectPose } from '../camera/shots.ts';
import { LiveSolver } from '../camera/solve.ts';
import { planCameraTrack } from '../camera/plan.ts';
import { toCameraTrack } from '../camera/track.ts';
import { walker } from '../camera/samplers.ts';

test('camera collision: a wall too tall to clear forces a deliberate, explained cut', () => {
  const tall: Obstacle = { id: 'tall', obb: { c: [0, 10], half: [12, 0.2], yaw: 0 }, y0: 0, y1: 40, kind: 'wall', label: 'tall wall' };
  const scene = provingGround({ extra: [tall] });
  const world = new CameraWorld(scene);
  const spec: ShotSpec = { kind: 'path', keys: [{ t: 0, position: [0, 1.6, 5], target: [5, 1, 10] }, { t: 8, position: [0, 1.6, 15], target: [5, 1, 10] }] };
  const plan = planCameraTrack(spec, () => ({}), world, { duration: 8 });
  const r = plan.report;
  assert.equal(r.invalidSamples, 0);
  assert.equal(r.sweptCrossings, 0);
  assert.equal(r.cuts.length, 1, JSON.stringify(r.cuts));
  assert.match(r.cuts[0].reason, /'tall wall'/);
  for (let i = 1; i < plan.samples.length; i++) {
    const a = plan.samples[i - 1], b = plan.samples[i];
    assert.ok(placement(world, b.position).valid);
    if (!b.cut) assert.equal(sweepCrossing(world, a.position, b.position), null, `t=${b.t}`);
  }
  console.log(`  tall wall: cut at t=${r.cuts[0].t}s ${r.cuts[0].from}→${r.cuts[0].to}: ${r.cuts[0].reason}`);
});

function runtimeRun(camera: null | ((rt: Runtime) => void)) {
  const base = provingGround();
  const w = addAll(emptyWorld('proving-ground', base), human('p1', -15, 0), human('p2', -13, -2));
  const rt = new Runtime(w, new Map<string, ActionDef>([['walk_to', walkTo]]), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  const rec: Record<string, SubjectPose>[] = [];
  rt.observers.push({
    onTick(r: Runtime) {
      rec.push(Object.fromEntries(['p1', 'p2'].map((id) => [id, { p: [...r.world.entities[id].pose.p] as [number, number, number], yaw: r.world.entities[id].pose.yaw }])));
      camera?.(r);
    },
  });
  rt.submit('walk_to', { actor: 'p1', x: -15, z: 12 });
  rt.submit('walk_to', { actor: 'p2', x: -14, z: 11 });
  assert.ok(rt.runUntilIdle(20 * 60));
  return { rt, rec, hash: hashOf(rt.world) };
}

test('camera replay independence: live camera solving and different planned tracks never change the take', () => {
  const plain = runtimeRun(null);
  const world = new CameraWorld(provingGround());
  let ticks = 0;
  const solver = new LiveSolver(world);
  const spec: ShotSpec = { kind: 'follow', subject: 'p1', offset: [-9, 1.5, 0], frame: 'world' };
  const withCam = runtimeRun((rt) => {
    if (ticks++ % 2) return;
    const subjects: Record<string, SubjectPose> = { p1: { p: rt.world.entities.p1.pose.p, yaw: rt.world.entities.p1.pose.yaw } };
    solver.step(ticks / 20, evaluateShot(spec, () => subjects, 0), subjects, ['p1']);
  });
  assert.equal(withCam.hash, plain.hash, 'live camera does not alter actor routes / final world');
  // reshoot the recorded performance with two different camera tracks
  const sampler: Sampler = (t) => plain.rec[Math.min(plain.rec.length - 1, Math.round(t * 20))];
  const dur = (plain.rec.length - 1) / 20;
  const before = hashOf(plain.rt.world);
  const follow = planCameraTrack(spec, sampler, world, { duration: dur });
  const group = planCameraTrack({ kind: 'frameGroup', subjects: ['p1', 'p2'], azimuth: -Math.PI / 2, elevation: 0.5 }, sampler, world, { duration: dur });
  const tracks = [toCameraTrack('cam-follow', 'take-x', follow), toCameraTrack('cam-group', 'take-x', group)];
  assert.notEqual(hashOf(tracks[0]), hashOf(tracks[1]));
  assert.equal(hashOf(plain.rt.world), before, 'planning camera tracks never mutates world state');
  assert.equal(follow.report.invalidSamples + group.report.invalidSamples, 0);
});

test('camera perf: plan a 60 s track at 10 Hz with 3 subjects in < 1 s', () => {
  const loop: Vec2[] = [[-15, 0], [-15, 12], [-15, 5], [-21, 5], [-21, 18], [-9, 18], [-9, 5], [-15, 5], [-15, 0]];
  const w1 = walker(loop, 1.3, 0, true), w2 = walker(loop, 1.3, 1.5, true), w3 = walker(loop, 1.3, 3, true);
  const sampler: Sampler = (t) => ({ p1: w1(t), p2: w2(t), p3: w3(t) });
  const world = new CameraWorld(provingGround());
  const spec: ShotSpec = { kind: 'frameGroup', subjects: ['p1', 'p2', 'p3'], azimuth: Math.PI, elevation: 0.3 };
  planCameraTrack(spec, sampler, world, { duration: 5 }); // warm-up (JIT)
  // The budget is on the work, so it is CPU time, best of three: on a loaded CI host a process waits for a core, and wall
  // time counts that wait (#1162: 527 ms hosted, 1364 ms on a host at load 33 of 48, with the same plan).
  let ms = Infinity, plan!: ReturnType<typeof planCameraTrack>;
  for (let i = 0; i < 3; i++) {
    const before = process.cpuUsage();
    plan = planCameraTrack(spec, sampler, world, { duration: 60, hz: 10 });
    const used = process.cpuUsage(before);
    ms = Math.min(ms, (used.user + used.system) / 1000);
  }
  const r = plan.report;
  console.log(`  perf: 60 s @10 Hz, 3 subjects, ${plan.samples.length} samples → ${ms.toFixed(0)} ms; readable ${(r.readableFraction * 100).toFixed(0)}%, min ${r.minReadability.toFixed(2)}, cuts ${r.cuts.length}, invalid ${r.invalidSamples}`);
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
  assert.equal(r.invalidSamples, 0);
  assert.equal(r.sweptCrossings, 0);
});
