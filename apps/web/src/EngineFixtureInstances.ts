import type * as THREE from 'three';
import type { MotionInstancer } from './MotionInstancer.ts';

const GROUP_NAME = 'engine fixtures';

/** Cache the scene lookup, while keeping only the current fixture owner's children instanced. */
export class EngineFixtureInstances {
  private readonly instancer: MotionInstancer;
  private group: THREE.Object3D | null = null;
  private lookIn = 0;
  private roots = new Set<THREE.Object3D>();

  constructor(instancer: MotionInstancer) { this.instancer = instancer; }

  track(scene: THREE.Scene) {
    if (this.group) {
      // A fixture group keeps its parent when its whole TakePeople/expansion owner is removed.
      let ancestor: THREE.Object3D | null = this.group;
      while (ancestor && ancestor !== scene) ancestor = ancestor.parent;
      if (!ancestor || this.group.name !== GROUP_NAME) this.clear();
    }
    if (!this.group && this.lookIn-- <= 0) {
      this.group = scene.getObjectByName(GROUP_NAME) ?? null;
      this.lookIn = 59; // retry a missing group on the 60th following frame
    }
    for (const root of this.roots) {
      if (this.group && root.parent === this.group) continue;
      this.instancer.untrack(root);
      this.roots.delete(root);
    }
    if (this.group) {
      this.instancer.trackChildren(this.group);
      for (const root of this.group.children) this.roots.add(root);
    }
  }

  clear() {
    for (const root of this.roots) this.instancer.untrack(root);
    this.roots.clear();
    this.group = null;
    this.lookIn = 0;
  }
}
