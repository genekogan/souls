import * as THREE from 'three';
import type {PublicSoul} from '@souls/protocol';
import {turn,UP} from '../../../mars/viewer/app/engine-view/rig.ts';
/** LINK BODY (2026-10-24): how the body rule's states look (presentation only; the server owns the state, the engine the
 *  posture). A sleeper lies down through the engine's own nap pose and a wake stands up through the clip fade, so this layer
 *  only adds what the engine has no pose for:
 *   - zombie (a body without a soul): arms held forward, head lolling to one side, a slow lurching sway, on top of the slow
 *     (half speed) shuffle the engine walks;
 *   - floating (asleep or zombie in water): the treading body laid back along the water surface, face to the sky.
 *  Render-time only, like WorldIdleLife: applied after the rig is posed, undone right after the draw. */
export type PublicBody = NonNullable<PublicSoul['body']>;
export type BodyPoseSoul = {id: string; root: THREE.Object3D | null; yaw: number; activity: string; body: PublicBody | null | undefined};

/** The word over a body whose agent is away (null: the usual name tag). */
export function bodyLabel(body: PublicBody | null | undefined): 'Asleep' | 'Zombie' | null {
  return body?.state === 'asleep' ? 'Asleep' : body?.state === 'zombie' ? 'Zombie' : null;
}
/** Lurch phase per Soul, stable across frames. */
const phaseOf = (id: string) => {let h = 2166136261; for (let i = 0; i < id.length; i++) {h ^= id.charCodeAt(i); h = Math.imul(h, 16777619);} return (h >>> 0) / 4294967296;};
export const FLOAT_TILT = 1.38, ZOMBIE_ARMS = 0.9;
type Bones = {head?: THREE.Object3D; torso?: THREE.Object3D; hips?: THREE.Object3D; arms: [THREE.Object3D, THREE.Object3D, THREE.Object3D][]};

export class WorldBodyPoses {
  private bones = new WeakMap<THREE.Object3D, Bones>();
  private saved: {o: THREE.Object3D; q: THREE.Quaternion; p?: THREE.Vector3}[] = [];
  private readonly f = new THREE.Vector3(); private readonly a = new THREE.Vector3(); private readonly v = new THREE.Vector3(); private readonly w = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private find(root: THREE.Object3D): Bones {
    let b = this.bones.get(root); if (b) return b;
    const by = new Map<string, THREE.Object3D>();
    root.traverse(o => {if ((o as THREE.Bone).isBone && !by.has(o.name)) by.set(o.name, o);});
    b = {head: by.get('Head'), torso: by.get('Torso'), hips: by.get('Hips'), arms: []};
    for (const k of ['L', 'R']) {const u = by.get('UpperArm' + k), l = by.get('LowerArm' + k), h = by.get('Wrist' + k); if (u && l && h) b.arms.push([u, l, h]);}
    this.bones.set(root, b); return b;
  }
  private keep(o: THREE.Object3D, position = false) {this.saved.push({o, q: o.quaternion.clone(), ...(position ? {p: o.position.clone()} : {})});}
  /** Point a bone (from its joint to the next) along a world direction, by weight `k`. */
  private aim(bone: THREE.Object3D, next: THREE.Object3D, dir: THREE.Vector3, k: number) {
    const from = bone.getWorldPosition(this.v), to = next.getWorldPosition(this.w).sub(from); if (to.lengthSq() < 1e-8) return;
    to.normalize(); const axis = this.a.crossVectors(to, dir); const s = axis.length(); if (s < 1e-5) return;
    this.keep(bone); turn(bone, axis.divideScalar(s), Math.atan2(s, to.dot(dir)) * k);
  }
  /** Call once per frame after people are posed (and after idle life), before the draw. */
  apply(souls: readonly BodyPoseSoul[], seconds: number, reducedMotion = false) {
    for (const s of souls) {
      const st = s.body?.state; if (!s.root || !s.body || (st !== 'zombie' && st !== 'asleep')) continue;
      const b = this.find(s.root), ph = phaseOf(s.id), amp = reducedMotion ? 0.4 : 1;
      this.f.set(Math.cos(s.yaw), 0, Math.sin(s.yaw));
      const water = s.body.doing === 'floating' && /tread|swim/.test(s.activity);
      if (water) {
        // floating: lay the treading body back about the hips, face up, its line at the water surface (the tread clip holds the
        // head 0.16 m above it); a slow gentle bob
        const hips = b.hips ?? b.torso, head = b.head; if (!hips || !head) continue;
        const surface = head.getWorldPosition(this.w).y - 0.16, pivot = hips.getWorldPosition(this.v.clone());
        this.keep(s.root, true);
        this.q.setFromAxisAngle(this.a.crossVectors(this.f, UP).normalize(), FLOAT_TILT);
        s.root.position.sub(pivot).applyQuaternion(this.q).add(pivot);
        s.root.quaternion.premultiply(this.q);
        s.root.position.y += surface - 0.06 - pivot.y + 0.03 * amp * Math.sin(seconds * 0.9 + ph * 6.28);
        s.root.updateMatrixWorld(true);
        continue;
      }
      if (st !== 'zombie') continue;
      // zombie: arms forward (straight, a little down and in), head lolling, a slow lurch side to side and a forward slump
      const right = this.a.crossVectors(this.f, UP).normalize().clone();
      const sway = Math.sin(seconds * 1.7 + ph * 6.28) * amp;
      if (b.torso) {this.keep(b.torso); turn(b.torso, this.f, 0.11 * sway); turn(b.torso, right, -0.16);}
      if (b.head) {this.keep(b.head); turn(b.head, this.f, (ph < 0.5 ? 1 : -1) * 0.32 + 0.08 * sway); turn(b.head, right, -0.22);}
      for (const [i, [upper, lower, wrist]] of b.arms.entries()) {
        const side = i === 0 ? 1 : -1, dir = this.f.clone().multiplyScalar(0.93).addScaledVector(UP, -0.3 + 0.05 * Math.sin(seconds * 1.7 + i)).addScaledVector(right, 0.12 * side).normalize();
        this.aim(upper, lower, dir, ZOMBIE_ARMS); this.aim(lower, wrist, dir, ZOMBIE_ARMS);
      }
    }
  }
  /** Undo this frame's changes (call right after the draw, before idle life's restore). */
  restore() {
    for (let i = this.saved.length - 1; i >= 0; i--) {const s = this.saved[i]; s.o.quaternion.copy(s.q); if (s.p) s.o.position.copy(s.p);}
    this.saved.length = 0;
  }
}
