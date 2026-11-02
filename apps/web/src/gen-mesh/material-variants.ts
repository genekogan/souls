// Lane PERF-MATERIALS: clone-on-write for shared materials. The gen-mesh library materials (materials.ts), a GLB's
// prepared materials and static-merge's merged materials are shared by every thing that draws them, so nothing may
// write to one for a single object. A per-object edit (a lamp's glow level, a look's tint, a flat rug's polygon
// offset) takes a variant instead: one clone per (source material, edit key), shared by every object that asks for the
// same edit, released with its source. Eden 2026 drew 813 lamp glow materials (one clone per lamp, 16 distinct looks)
// before this; now a glow level is one material however many lamps show it.
import * as THREE from 'three';

type Variants = Map<string, THREE.Material>;
const variants = new WeakMap<THREE.Material, Variants>();
/** Variants kept per source material; past this the oldest keys are forgotten (a thing still drawing one keeps it alive). */
export const VARIANT_CAP = 128;

/** The variant of `base` for `key`: a clone edited once by `edit`, cached; the same object for the same key. */
export function variantOf<M extends THREE.Material>(base: M, key: string, edit: (m: M) => void): M {
  let byKey = variants.get(base);
  if (!byKey) {
    byKey = new Map(); variants.set(base, byKey);
    const made = byKey;
    base.addEventListener('dispose', () => { for (const m of made.values()) m.dispose(); made.clear(); });
  }
  let m = byKey.get(key) as M | undefined;
  if (!m) {
    m = base.clone() as M; edit(m); m.needsUpdate = true;
    byKey.set(key, m);
    if (byKey.size > VARIANT_CAP) byKey.delete(byKey.keys().next().value!);
  }
  return m;
}
/** Variants made from `base` so far (tests and probes). */
export function variantCount(base: THREE.Material): number { return variants.get(base)?.size ?? 0; }
