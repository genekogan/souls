import * as THREE from 'three';
/** B3: a chip, an Explore Soul row or the card's Follow button (all through requestFollowSoul) flies the camera to the
 * Soul's Follow shot, then Follow takes over there with no jump. Presentation only. */

/** Seconds for a flight whose eye travels `distance` metres while its gaze turns `turn` radians:
 * clamp(1, 3, 1 + d/60 + θ/120°). */
export function soulFlightSeconds(distance: number, turn: number): number {
  const d = Number.isFinite(distance) ? Math.max(0, distance) : 0, t = Number.isFinite(turn) ? Math.abs(turn) : 0;
  return Math.max(1, Math.min(3, 1 + d / 60 + t / (Math.PI * 2 / 3)));
}
/** Cubic ease-in-out: 0 → 0, 1 → 1, symmetric, zero speed at both ends. */
export function easeInOut(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
/** Follow's framing distance and elevation (LiveWorld's Follow entry keeps an offset up to 12 m). */
export const SHOT_NEAR = 6, SHOT_FAR = 12, SHOT_LOW = 15 * Math.PI / 180, SHOT_HIGH = 40 * Math.PI / 180;
/** The Follow shot of a Soul whose follow target (body + 1 m) is `target`, from `eye`: the camera stays on its side of the
 * Soul at 6–12 m and 15–40° above the horizontal, looking at the target. */
export function followShot(eye: THREE.Vector3, target: THREE.Vector3): { eye: THREE.Vector3; target: THREE.Vector3 } {
  const off = eye.clone().sub(target), flat = Math.hypot(off.x, off.z);
  const heading = flat > 1e-6 ? Math.atan2(off.x, off.z) : 0;
  const elevation = Math.max(SHOT_LOW, Math.min(SHOT_HIGH, Math.atan2(off.y, flat)));
  const r = Math.max(SHOT_NEAR, Math.min(SHOT_FAR, off.length()));
  const dir = new THREE.Vector3(Math.sin(heading) * Math.cos(elevation), Math.sin(elevation), Math.cos(heading) * Math.cos(elevation));
  return { eye: target.clone().addScaledVector(dir, r), target: target.clone() };
}
export type FlightPose = { eye: THREE.Vector3; target: THREE.Vector3; done: boolean };
/** One flight. It starts from the camera's own eye and gaze (the gaze point at the pivot's distance, so a head turned away
 * from its pivot does not snap) and tracks a walking Soul: the shot moves with the Soul's target. */
export class SoulFlight {
  readonly soulId: string;
  readonly seconds: number;
  private t = 0;
  private fromEye: THREE.Vector3; private fromTarget: THREE.Vector3;
  private shotOffset: THREE.Vector3;
  constructor(soulId: string, eye: THREE.Vector3, gaze: THREE.Vector3, pivotDistance: number, target: THREE.Vector3) {
    this.soulId = soulId;
    const shot = followShot(eye, target), g = gaze.clone().normalize();
    this.fromEye = eye.clone();
    this.fromTarget = eye.clone().addScaledVector(g, Number.isFinite(pivotDistance) && pivotDistance > .5 ? pivotDistance : 20);
    this.shotOffset = shot.eye.clone().sub(shot.target);
    const toGaze = shot.target.clone().sub(shot.eye).normalize();
    this.seconds = soulFlightSeconds(shot.eye.distanceTo(eye), g.angleTo(toGaze));
  }
  /** Advance by `dt` seconds toward the Soul's current follow target. */
  step(dt: number, target: THREE.Vector3): FlightPose {
    this.t = Math.min(1, this.t + (Number.isFinite(dt) ? Math.max(0, dt) : 0) / this.seconds);
    const k = easeInOut(this.t), toTarget = target.clone(), toEye = target.clone().add(this.shotOffset);
    return { eye: this.fromEye.clone().lerp(toEye, k), target: this.fromTarget.clone().lerp(toTarget, k), done: this.t >= 1 };
  }
  get progress() { return this.t; }
}
