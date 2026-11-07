// The drawn pose of a floater: its ground pose lifted by hoverHeight, plus a bob, a forward tilt with
// speed, a small sway and a yaw drift — all pure functions of (entity id, sampled tick, sampled speed).
// No wall clock and no frame-to-frame state, so a replay at the same tick draws the same head (and a
// paused take holds still unless the caller advances the tick). Deterministic trig (core/math dsin).
import { clamp, dsin, type Vec3 } from '../core/math.ts';
import type { FloaterBody } from './body.ts';
import {MOTION_LIMITS,type MotionAdapter,type BodyMotionState} from './motion.ts';

export type FloaterPose = { p: Vec3; yaw: number; pitch: number; roll: number };

/** Motion constants (amplitudes in m / rad, periods in seconds of sim time). */
export const BOB = { amp: 0.045, periodMin: 3.2, periodMax: 4.6, swayRoll: 0.035, swayPitch: 0.025, yawDrift: 0.05, leanPerMps: 0.12, leanMax: 0.16 };

/** FNV-1a of the id → [0, 1): a stable per-entity phase/period so heads never bob in unison. */
export function idPhase(id: string, salt = 0): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h / 0x100000000;
}

const TWO_PI = 2 * Math.PI;

/**
 * Floater pose at sampled tick `tick` (may be fractional — sampleTake's frame.tick) with step `dt` (s).
 * `ground` is the sampled entity pose (p on the walkable surface; yaw/pitch/roll as recorded);
 * `speed` the sampled ground speed (m/s) if published.
 */
export function floaterPose(id: string, ground: { p: Vec3; yaw: number; pitch?: number; roll?: number;activity?:string;state?:Record<string,unknown> }, body: FloaterBody, tick: number, dt: number, speed = 0): FloaterPose {
  if(body.motion)return authoredPose(id,ground,body,tick,dt,speed);
  const t = tick * dt;
  const period = BOB.periodMin + (BOB.periodMax - BOB.periodMin) * idPhase(id, 1);
  const ph = TWO_PI * idPhase(id, 2);
  const w = TWO_PI / period;
  const bob = BOB.amp * dsin(w * t + ph);
  const lean = clamp(Math.abs(speed) * BOB.leanPerMps, 0, BOB.leanMax);
  return {
    p: [ground.p[0], ground.p[1] + body.hoverHeight + bob, ground.p[2]],
    yaw: ground.yaw + BOB.yawDrift * dsin(w * 0.37 * t + ph * 1.7),
    // nose dips into travel (+pitch = forward in the renderer), with a slow nod out of phase with the bob
    pitch: (ground.pitch ?? 0) + lean + BOB.swayPitch * dsin(w * t + ph + Math.PI / 2),
    roll: (ground.roll ?? 0) + BOB.swayRoll * dsin(w * 0.61 * t + ph * 2.3),
  };
}

/** Stateless sampled-tick evaluation: reverse scrubbing, reload and interruption have identical poses. */
function authoredPose(id:string,ground:Parameters<typeof floaterPose>[1],body:FloaterBody,tick:number,dt:number,speed:number):FloaterPose {
 const motion=body.motion!,t=tick*dt,phase=TWO_PI*idPhase(id,2);
 const sample=(a:MotionAdapter)=>{const w=TWO_PI*t/a.period+phase;return {bob:a.bob*dsin(w),pitch:a.pitch*dsin(w+Math.PI/2),roll:a.roll*dsin(w*.999),yaw:a.yaw*dsin(w)};};
 const mix=(a:ReturnType<typeof sample>,b:ReturnType<typeof sample>,w:number)=>({bob:a.bob+(b.bob-a.bob)*w,pitch:a.pitch+(b.pitch-a.pitch)*w,roll:a.roll+(b.roll-a.roll)*w,yaw:a.yaw+(b.yaw-a.yaw)*w});
 const smooth=(x:number)=>{const v=clamp(x,0,1);return v*v*(3-2*v);};
 let q=sample(ground.activity==='rest'?motion.rest:motion.idle);
 q=mix(q,sample(motion.move),clamp(Math.abs(speed)/.4,0,1));
 const signal=ground.state?.bodyMotionV1 as BodyMotionState|undefined;
 if(motion.dance&&signal&&Number.isFinite(signal.since)&&Number.isFinite(signal.until)){
  const fade=MOTION_LIMITS.fadeSeconds/dt;
  const weight=signal.release?signal.release.weight*(1-smooth((tick-signal.release.at)/fade)):Math.min(smooth((tick-signal.since)/fade),smooth((signal.until-tick)/fade));
  q=mix(q,sample(motion.dance),weight);
 }
 return {p:[ground.p[0],ground.p[1]+body.hoverHeight+q.bob,ground.p[2]],yaw:ground.yaw+q.yaw,pitch:(ground.pitch??0)+q.pitch,roll:(ground.roll??0)+q.roll};
}
