// Humanoid look dims (bodies/humanoid.ts): height, build and walking speed change the engine body; unset (or
// default) they leave it exactly as today's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS, MAX_HUMAN_STEP_PER_TICK, SPEED_CAPS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll } from '../world/factory.ts';
import { walkTo, WALK_SPEED_CAP } from '../locomotion/walk.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import { bodyProfile } from '../bodies/navigation.ts';
import { bodyProblem, withBody } from '../bodies/body.ts';
import * as humanoid from '../bodies/humanoid.ts';
import { HUMANOID_DIM_RANGES, HUMANOID_RADIUS_RANGE, dimsOf, humanoidDims, humanoidProfile, humanRadius } from '../bodies/humanoid.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Body } from '../world/types.ts';
import { hypot } from '../core/math.ts';
import { DT } from '../runtime/runtime.ts';

const MODEL = 'humanoid2-0123456789abcdef';
const look = (params: Record<string, string | number>): Body => ({ family: 'humanoid', model: MODEL, params });

test('unset or default dims are today\'s body exactly (same profile object, radius, eyes, seats)', () => {
  for (const b of [undefined, { family: 'humanoid' } as Body, look({ hat: 'cap' }), look({ preset: 'punk' }), look({ height: 1.75, build: 1, walkSpeed: 1.35, headSize: 1.1 })]) {
    assert.equal(humanoidProfile(b), HUMAN_PROFILE, JSON.stringify(b));
    const d = humanoidDims(b);
    assert.equal(d.standard, true); assert.equal(d.radius, HUMAN_RADIUS); assert.equal(d.eyeHeight, 1.62); assert.equal(d.seatedEyeHeight, 1.15);
    assert.deepEqual(d.seat, [0.2, 1.2], 'the seat range of today\'s body is pose.ts seatHeight 0.2–1.2');
    assert.equal(humanRadius({ body: b }), HUMAN_RADIUS);
  }
  assert.equal(bodyProfile(human('p', 0, 0)), HUMAN_PROFILE, 'an entity without a body field');
  assert.equal(HUMANOID_DIM_RANGES.walkSpeed[1], WALK_SPEED_CAP, 'the fastest walk is the engine\'s cap');
  assert.equal(HUMAN_RADIUS, HUMAN_PROFILE.radius);
});

test('height and build change radius, height, eyes and seat fit; walk speed changes the profile speed', () => {
  const tall = humanoidDims(look({ height: 1.85, build: 1.1 })), small = humanoidDims(look({ height: 1.65, build: 0.92 }));
  assert.equal(HUMANOID_RADIUS_RANGE[1], HUMAN_RADIUS, 'the collider never exceeds today\'s body (lane N1: wider bodies were refused 0.84-0.9 m doors)');
  assert.equal(tall.radius, HUMAN_RADIUS, `tall radius ${tall.radius} is capped at today's`); assert.equal(tall.standard, false, 'but the tall body is not today\'s');
  assert.ok(small.radius < HUMAN_RADIUS && small.radius >= HUMANOID_RADIUS_RANGE[0], `small radius ${small.radius}`);
  assert.equal(dimsOf({ build: 1.1 }).radius, HUMAN_RADIUS); assert.equal(dimsOf({ height: 1.85 }).radius, HUMAN_RADIUS);
  assert.equal(dimsOf({ build: 0.92 }).radius, 0.258); assert.equal(dimsOf({ height: 1.65 }).radius, 0.272);
  assert.equal(tall.eyeHeight, 1.713); assert.equal(small.eyeHeight, 1.527);
  const p = humanoidProfile(look({ height: 1.85, walkSpeed: 1.0 }));
  assert.notEqual(p, HUMAN_PROFILE); assert.equal(p.speed, 1.0); assert.equal(p.height, 1.903); assert.equal(p.radius, HUMAN_RADIUS);
  assert.equal(humanoidProfile(look({ height: 1.85, walkSpeed: 1.0 })), p, 'profiles are shared per dims');
  assert.equal(humanoidProfile(look({ headSize: 1.08 })), HUMAN_PROFILE, 'head size is drawn only');
  // #1083: the comfortable seat range still scales with the body (drawing reads it), but nothing refuses a seat by height
  assert.deepEqual(humanoidDims(look({ height: 1.65 })).seat.map((x) => x <= 1.2), [true, true]);
  assert.equal((humanoid as Record<string, unknown>).seatFitProblem, undefined, 'no seat-fit refusal is exported');
});

test('bodyProblem accepts looks in range, refuses out-of-range dims; withBody keeps a look', () => {
  assert.equal(bodyProblem(look({ height: 1.85, build: 1.1, walkSpeed: 1.2, hat: 'cap' })), null);
  assert.equal(bodyProblem(look({ walkSpeed: 1.5 })), 'body.params.walkSpeed', 'never above the walk cap');
  assert.equal(bodyProblem(look({ height: 2.4 })), 'body.params.height');
  assert.equal(bodyProblem(look({ build: 'broad' })), 'body.params.build');
  assert.equal(bodyProblem({ family: 'humanoid', model: 'casual', params: { hat: 'cap' } }), 'body.params', 'params need a look key');
  assert.equal(bodyProblem({ family: 'floater', model: MODEL, params: {} }), 'body.params');
  assert.equal(bodyProblem({ family: 'humanoid', model: MODEL }), 'body.humanoid-fields', 'a look key without params is not a body');
  const e = withBody(human('p', 0, 0), look({ height: 1.8 })); assert.deepEqual(e.body, look({ height: 1.8 }));
  assert.equal(withBody(human('p', 0, 0), { family: 'humanoid' }).body, undefined, 'a plain humanoid stays without the field');
});

function walkOnce(body: Body | undefined) {
  const base = provingGround();
  const p = human('p1', -18, -15, { yaw: 0 }); if (body) p.body = body;
  const rt = new Runtime(addAll(emptyWorld('proving-ground', base), p), new Map<string, ActionDef>([['walk_to', walkTo]]), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  let maxStep = 0, maxSpeed = 0, prev = [...rt.world.entities.p1.pose.p];
  rt.observers.push({ onTick() { const q = rt.world.entities.p1.pose.p; maxStep = Math.max(maxStep, hypot(q[0] - prev[0], q[2] - prev[2])); maxSpeed = Math.max(maxSpeed, rt.world.entities.p1.human?.speed ?? 0); prev = [...q]; } });
  const a = rt.submit('walk_to', { actor: 'p1', x: -12, z: -15 });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  assert.ok(rt.runUntilIdle(30 * 60));
  assert.equal(a.status, 'completed');
  assert.deepEqual(rt.violations, []);
  return { time: rt.time, maxStep, maxSpeed, hash: rt.stateHash() };
}

test('walking speed: a slow body takes longer, a fast one stays under the per-tick limit; defaults walk as today', () => {
  const today = walkOnce(undefined), same = walkOnce(look({ hat: 'cap', height: 1.75, walkSpeed: 1.35 }));
  assert.equal(same.time, today.time, 'a default look walks exactly as a body without one');
  const slow = walkOnce(look({ walkSpeed: 0.9 })), fast = walkOnce(look({ walkSpeed: 1.4, height: 1.85, build: 1.1 }));
  assert.ok(slow.time > today.time * 1.25, `slow ${slow.time}s vs ${today.time}s`);
  assert.ok(fast.time <= today.time, `fast ${fast.time}s vs ${today.time}s`);
  for (const r of [today, slow, fast]) {
    assert.ok(r.maxStep <= WALK_SPEED_CAP * DT + 1e-6 && r.maxStep < MAX_HUMAN_STEP_PER_TICK, `max step ${r.maxStep}`);
    assert.ok(r.maxSpeed <= SPEED_CAPS.walk * 1.05, `published speed ${r.maxSpeed}`);
  }
  assert.ok(slow.maxStep <= 0.9 * DT + 1e-6, `slow max step ${slow.maxStep}`);
});

test('looks v2 body shape: the widest of shoulders/chest/hips/weight widens the drawn body, never the collider (capped at today\'s); narrower never shrinks it', () => {
  for (const k of ['shoulders', 'chest', 'hips', 'weight'] as const) {
    const [lo, hi] = HUMANOID_DIM_RANGES[k];
    const wide = humanoidDims(look({ [k]: hi })), narrow = humanoidDims(look({ [k]: lo }));
    assert.ok(wide.radius === HUMAN_RADIUS && !wide.standard && wide.width === hi, `${k} ${hi} is drawn wider, collides as today's (${wide.radius})`);
    assert.equal(narrow.radius, HUMAN_RADIUS, `${k} ${lo} keeps today's radius`); assert.equal(narrow.standard, true, 'and is today\'s body');
    assert.deepEqual(wide.seat, [0.2, 1.2], 'shape never changes seat fit'); assert.equal(wide.eyeHeight, 1.62, 'nor eye height');
  }
  const widest = humanoidDims(look({ height: 1.85, build: 1.1, shoulders: 1.12, chest: 1.15, hips: 1.15, weight: 1.25 }));
  assert.equal(widest.radius, HUMAN_RADIUS, 'the widest body collides as today\'s (its door test: humanoid-door.test.ts)');
  assert.equal(humanoidProfile(look({ weight: 1.2 })).speed, HUMAN_PROFILE.speed, 'shape is not speed');
  assert.match(String(bodyProblem(look({ weight: 1.6 }))), /weight/, 'out-of-range shape is refused');
  assert.equal(bodyProblem(look({ weight: 1.2, shoulders: 1.1 })), null);
});
