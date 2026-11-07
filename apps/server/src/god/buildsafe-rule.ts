// The clearance rule the commit-time auto-repair (buildsafe/1, lane BS2) judges ways by: one swap point. It is
// BUILDSAFE part 1's shared clearance rule (packages/generators/src/clearance.ts, also furnish.mjs's ways rule: a body
// PLAN_R round on a NAV_CELL grid; a piece's approach is in front of each seat, else the free spot nearest it).
// buildsafe.ts reads nothing else.
import { approachOf as clearanceApproach, PLAN_R, NAV_CELL } from '@souls/generators';

export type Vec2 = [number, number];
/** A way key: the free cell nearest any of `pts` within `r` metres stands for it (as the walk goal search does). */
export type ApproachKey = { pts: Vec2[]; r: number };

/** Body radius (with the plan margin) and raster cell of the ways rule (clearance.ts PLAN_R / NAV_CELL). */
export const BODY_R = PLAN_R;
export const CELL = NAV_CELL;
/** Heights above the floor a blocker must reach into to stop a walker (furnish.mjs: walls 0.15..1.6 m). */
export const BAND: [number, number] = [0.15, 1.6];
/** The standing spot of a piece (`baked` in its def frame) at world `at`, `yaw`. */
export function approachOf(baked: unknown, at: Vec2, yaw: number): ApproachKey {
  const k = clearanceApproach(baked as Parameters<typeof clearanceApproach>[0], at, yaw) as unknown;
  return Array.isArray(k) ? { pts: [k as Vec2], r: 0.3 } : k as ApproachKey;
}
