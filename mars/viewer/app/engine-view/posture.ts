// Handling postures (owner feedback §6): crouch / squat, kneel on one knee, stand with a load, reach
// up, reach down (bend at the hips, or kneel at a deck / beam edge and bend over it), hold high / hold
// low — as ONE small solver over the body's degrees of freedom, chosen per tick from where the hands
// must go:
//   drop  — pelvis lowered by bending the knees, feet planted (a squat when deep),
//   bend  — torso pitched forward at the hips (standing: the pelvis shifts back a little to balance),
//   rise  — heels up (≤ 6 cm) when the hands must go above the standing reach,
//   kneel — one knee on the floor, hips at BODY_MODEL.kneelHip (drop follows), the other foot planted
//           out to the side; the torso may bend further (to bendMax.kneel) to reach down over an edge.
// The solver minimises "hands out of reach" first, then effort, with per-activity preferences
// (style): lift from the knees with the torso upright for ground pickups; bend at the hips (or kneel
// once a standing bend would pass ~60°) to reach down; stand tall to reach up. Pure numbers (no
// three.js objects), node-testable; the renderer (humans.ts) applies the result to the rig and then
// runs the arm IK (reach honesty: an arm whose point is still beyond its length after the best
// posture hangs; nothing stretches).
import { BODY_MODEL } from './rig.ts';

/** Rig measurements in the person's frame (metres; f = forward, up = above the floor, lat = right). */
export type Dims = {
  /** Height of the hip joints (UpperLeg origins) above the floor, standing. */
  hipH: number;
  /** Height of the torso-bend pivot (Hips bone). */
  pivotH: number;
  /** Ankle (Foot bone origin) height above the floor when the sole is on it. */
  ankleH: number;
  /** Hip joint → knee → ankle length. */
  legLen: number;
  /** Hip joint → knee, knee → ankle. */
  thigh: number;
  shin: number;
  /** Shoulder-joint midpoint relative to the pivot (standing). */
  sh: { f: number; up: number };
  /**
   * The spine as the pose layer bends it: pivot (Hips) → Abdomen → Torso → shoulder midpoint, each
   * segment (f, up) standing; the bend turns them by 0.6, 0.8 and 1.0 × bend (humans.ts bendTorso).
   */
  chain: { f: number; up: number }[];
  /** Shoulder joint lateral half-width. */
  shHalf: number;
  /** Shoulder → elbow → palm length. */
  armLen: number;
  /** The pivot (Hips bone) relative to the hip-joint midpoint, standing (prone.ts pitches the pelvis about the hip joints). */
  pivotF: number;
  pivotUp: number;
  /**
   * From the skinned mesh in the Idle pose (humans.ts measure): how far the front of the body (torso, thighs, shins)
   * is ahead of the hip joints — the hip height of this body lying on its stomach (prone.ts) — and how far the front
   * of the chest is ahead of the shoulder joints (lying flat, the shoulder joints are this high above the deck).
   */
  lieHip: number;
  chestDepth: number;
  /** Surface of the left foot relative to its ankle (f, up; standing, a sample of skinned vertices): how low it reaches when pitched. */
  foot: [number, number][];
};

export type Style = 'knees' | 'hips' | 'up' | 'walk' | 'lean' | 'stand';
export type Target = { f: number; up: number; lat: number };
export type Posture = { drop: number; bend: number; rise: number; kneel: number };
export const NEUTRAL: Posture = { drop: 0, bend: 0, rise: 0, kneel: 0 };

const DEG = Math.PI / 180;
/** Deepest pelvis: hips this high above the floor (a full squat). */
export const SQUAT_HIP = BODY_MODEL.squatHip;
export const RISE_MAX = BODY_MODEL.heelRise;
/** Knee on the floor: the kneeling knee's centre this high (kneecap), the up-knee foot this far out to the side. */
export const KNEE_Y = 0.05;
export const KNEEL_SIDE = 0.3;
/** Arm reach the solver plans with (fraction of the arm length; the IK clamps at 0.97). */
const PLAN_REACH = 0.92;
/** A standing hip bend past this costs extra (it reads as lying on the load); kneeling is the alternative. */
const DEEP_BEND = 60 * DEG;

const STYLE: Record<Style, { bendMax: number; wDrop: number; wBend: number; rise: boolean; dropMax?: number; kneel?: number; deep?: number }> = {
  knees: { bendMax: BODY_MODEL.bendMax.knees, wDrop: 0.5, wBend: 1.4, rise: false, kneel: 2.0 }, // kneel only when a squat + bend cannot do it
  hips: { bendMax: BODY_MODEL.bendMax.hips, wDrop: 0.8, wBend: 0.35, rise: false, kneel: 0.45 },
  up: { bendMax: 30 * DEG, wDrop: 4, wBend: 3, rise: true },
  // Soul Actions 43: a standing hand reach to a counter or table top (a mug set down, a kettle held over a cup): bend at
  // the hips, the knees only a little. 'hips' let a 1.6 m body squat 0.26 m to set a mug 0.49 m ahead on a 0.75 m table.
  lean: { bendMax: BODY_MODEL.bendMax.hips, wDrop: 2.4, wBend: 0.35, rise: false, kneel: 3.0, deep: 75 * DEG },
  walk: { bendMax: 25 * DEG, wDrop: 4, wBend: 2, rise: false, dropMax: 0.08 }, // 25°: walking a load held out ahead (hang_beam walk-in: hands 0.5–0.65 m ahead at hip height)
  // Entry 33 (retest on M04): a hand reach to a switch or a torch at or above the hips is made standing. A target just
  // past the plan reach (a 1.2 m switch from 0.55 m on a 1.67 m body) leans a few degrees in; under 'knees' the 0.04 m knee
  // dip cost a fortieth of that lean, so the body dipped at the knees for a switch at chest height.
  // M05 #636: a preference alone still chose a 4.2 cm dip; enforce Entry33's existing 3 cm standing bound.
  stand: { bendMax: BODY_MODEL.bendMax.knees, wDrop: 4, wBend: 1.4, rise: false, dropMax: 0.03 },
};

/** Style for an engine activity (engine/construction/handup.ts phases, carry, raise, items). */
export function styleFor(activity: string, walking: boolean): Style {
  if (walking) return 'walk';
  if (activity === 'reach_up' || activity === 'walk-load' || activity === 'push') return 'up';
  if (activity === 'reach_down' || activity === 'take' || activity === 'lay' || activity === 'set_down' || activity === 'reach' || activity === 'serve') return 'hips';
  return 'knees'; // crouch, lift, stand_with_load, carry, support, hold, release, idle with a grip
}

/** Share of the bend reached at each spine joint (Hips, Abdomen, Torso): humans.ts bendTorso. */
export const BEND_SHARE = [0.6, 0.8, 1.0];

/**
 * Shoulder midpoint (f, up above the floor) for a posture, through the bent spine chain. The pelvis
 * shifts back by 0.3 × the shoulders' forward travel to balance a bend (`back`, m).
 */
export function shoulderAt(d: Dims, p: Posture) {
  let f = 0, up = 0;
  d.chain.forEach((sg, i) => {
    const a = p.bend * BEND_SHARE[i], c = Math.cos(a), s = Math.sin(a);
    f += sg.f * c + sg.up * s;
    up += sg.up * c - sg.f * s;
  });
  const back = 0.3 * Math.max(0, f - d.sh.f) * (1 - p.kneel); // a kneeling body is held by the knee, not by leaning back
  return { f: f - back, up: d.pivotH - p.drop + p.rise + up, back };
}

/** Distance from each target to its shoulder (targets[i].lat sign picks the side). */
function reachErr(d: Dims, p: Posture, ts: Target[]) {
  const s = shoulderAt(d, p);
  let err = 0, close = 0;
  for (const t of ts) {
    const side = t.lat >= 0 ? 1 : -1;
    const dist = Math.hypot(t.f - s.f, t.up - s.up, t.lat - side * d.shHalf);
    err += Math.max(0, dist - PLAN_REACH * d.armLen);
    close += Math.max(0, 0.4 * d.armLen - dist);
  }
  return { err, close };
}

/** Whether each target is within the IK's longest arm (BODY_MODEL.maxExtension) of its shoulder under `p`. */
export const postureReaches = (d: Dims, p: Posture, ts: Target[]) => ts.every((t) => reachErr(d, p, [t]).err <= (BODY_MODEL.maxExtension - PLAN_REACH) * d.armLen + 1e-9);

/** Pelvis drop of a one-knee kneel for this rig: hip joints straight above a knee resting on the floor. */
export const kneelDrop = (d: Dims) => Math.max(0, d.hipH - (KNEE_Y + d.thigh));

/** Best posture for `targets` (body frame) under `style`: grid search, deterministic. */
export function solvePosture(d: Dims, ts: Target[], style: Style): Posture {
  if (!ts.length) return NEUTRAL;
  const st = STYLE[style];
  const dropMax = Math.min(st.dropMax ?? Infinity, Math.max(0, d.hipH - SQUAT_HIP));
  let best = NEUTRAL, bc = Infinity;
  const ND = 12, NB = Math.max(1, Math.round(st.bendMax / (5 * DEG)));
  const rises = st.rise ? [0, RISE_MAX / 2, RISE_MAX] : [0];
  const score = (p: Posture, effort: number) => {
    const r = reachErr(d, p, ts);
    const cost = 40 * r.err + 30 * r.close + effort;
    if (cost < bc - 1e-9) [best, bc] = [p, cost];
  };
  for (let i = 0; i <= ND; i++)
    for (let j = 0; j <= NB; j++)
      for (const rise of rises) {
        const p = { drop: (dropMax * i) / ND, bend: (st.bendMax * j) / NB, rise, kneel: 0 };
        score(p, st.wDrop * p.drop + st.wBend * p.bend + 3 * rise + (st.kneel !== undefined ? 2.5 * Math.max(0, p.bend - (st.deep ?? DEEP_BEND)) : 0));
      }
  if (st.kneel !== undefined) {
    // one knee down: the pelvis height is fixed by the thigh, the torso may bend over an edge
    const drop = kneelDrop(d), NK = Math.round(BODY_MODEL.bendMax.kneel / (5 * DEG));
    for (let j = 0; j <= NK; j++) {
      const p = { drop, bend: (BODY_MODEL.bendMax.kneel * j) / NK, rise: 0, kneel: 1 };
      score(p, st.kneel + 0.35 * p.bend);
    }
  }
  return best;
}

/** Move `cur` toward `goal` at most `rate` × full range per call (drop in m, bend in rad, kneel 0–1). */
export function approach(cur: Posture, goal: Posture, k: number): Posture {
  const step = (a: number, b: number, max: number) => a + Math.max(-max, Math.min(max, b - a));
  return { drop: step(cur.drop, goal.drop, 0.55 * k), bend: step(cur.bend, goal.bend, 1.6 * k), rise: step(cur.rise, goal.rise, RISE_MAX * k), kneel: step(cur.kneel, goal.kneel, k) };
}
