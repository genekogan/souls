// W2: every flame part in an entity world burns with old Eden's animated fire (fx/fire.ts), whoever made it.
// A kit flame is a shape with `role: flame`, or (for god-made fires that never name the role) a glowing shape tinted
// flame/fire/ember, or a glowing warm-coloured shape in a def whose name or tags say fire (torch, brazier, hearth,
// candle…). kit.mesh.ts gives those shapes the flame role and records their clusters on the role pivot
// (`userData.flames`); `mountFlames` puts one fire on each cluster. Its static cones stay as the far stand-in:
// within reach the fire replaces them, nearer still it adds embers and smoke. motion.ts ticks `userData.fx`.
import * as THREE from 'three';
import type { StoredDef } from '@souls/world-compiler';
import { createFire, seedOf, type Fire, type FireKind } from './fire.ts';
import { registerFx } from './debug.ts';

const FIRE_WORDS = /(^|[^a-z])(fire|campfire|bonfire|firepit|fire-pit|fire-bowl|torch|brazier|hearth|fireplace|candle|candelabra|candlestick|forge|kiln|furnace|flame)/;
/** The def says fire (its name or a tag), so its glowing warm parts are flames even without the role. */
export function flameHint(def: Pick<StoredDef, 'name' | 'tags'>): boolean {
  return FIRE_WORDS.test(def.name.toLowerCase()) || def.tags.some((t) => FIRE_WORDS.test(t.toLowerCase()));
}
const FLAME_TINT = /flame|fire|ember/;
type ShapeLike = { kind?: string; role?: string; tint?: string; glow?: number; material?: string; color?: string; at: readonly number[]; r?: number; h?: number; size?: readonly number[]; scale?: readonly number[]; profile?: readonly (readonly number[])[] };
const hsl = { h: 0, s: 0, l: 0 }, tmp = new THREE.Color();
/** True for a kit shape that draws a flame. `color` is the shape's resolved colour (for the warm-hue test). */
export function isFlameShape(sh: ShapeLike, hint: boolean, color?: string): boolean {
  if (isSmokeShape(sh)) return false; // a chimney stack draws its smoke as grey `role: flame` puffs
  if (sh.role === 'flame') return true;
  if (sh.role || !(sh.glow && sh.glow > 0)) return false;
  if (FLAME_TINT.test(sh.tint ?? '')) return true;
  if (!hint || !color) return false;
  tmp.set(color).getHSL(hsl);
  return (hsl.h < 0.16 || hsl.h > 0.97) && hsl.s > 0.45 && hsl.l > 0.3 && hsl.l < 0.72; // cream lamp glass (l ≈ 0.78) is not a flame
}

/** W2: a grey puff drawn as a shape (tint smoke/steam, no glow): the atmosphere's moving smoke replaces it. */
export function isSmokeShape(sh: ShapeLike): boolean { return !(sh.glow && sh.glow > 0) && /smoke|steam/.test(sh.tint ?? ''); }
/** Smoke sources [x, y, z, scale] (kit frame) for the shapes that draw smoke: one per puff column, at its base. */
export function smokeSources(shapes: readonly ShapeLike[]): [number, number, number, number][] {
  return flameClusters(shapes, new THREE.Vector3()).map((c) => [c.p[0], c.p[1], c.p[2], Math.max(0.6, Math.min(3, c.r / 0.3))]);
}

export type FlameCluster = { p: [number, number, number]; r: number; h: number };
/** Approximate box of a kit shape: [min, max] in the kit's frame (minus `offset`). */
function shapeBox(sh: ShapeLike, offset: THREE.Vector3): THREE.Box3 {
  const s = sh.scale ?? [1, 1, 1], c = new THREE.Vector3(sh.at[0], sh.at[1], sh.at[2]).sub(offset);
  let hx = 0.1, hy = 0.1, hz = 0.1, lift = 0;
  if (sh.kind === 'lathe') { const pr = sh.profile ?? [[0.5, 0], [0.5, 1]]; hx = hz = Math.max(...pr.map((q) => q[0])); hy = Math.max(...pr.map((q) => q[1])) / 2; lift = hy; }
  else if (sh.kind === 'box') { const z = sh.size ?? [1, 1, 1]; hx = z[0] / 2; hy = z[1] / 2; hz = z[2] / 2; }
  else if (sh.kind === 'sphere') hx = hy = hz = sh.r ?? 0.5;
  else { hx = hz = sh.r ?? 0.5; hy = (sh.h ?? 1) / 2; }
  hx *= s[0]; hy *= s[1]; hz *= s[2]; c.y += lift * s[1];
  return new THREE.Box3(new THREE.Vector3(c.x - hx, c.y - hy, c.z - hz), new THREE.Vector3(c.x + hx, c.y + hy, c.z + hz));
}
/** Group touching flame shapes into fires (the two candles of an altar are two fires; a campfire's three cones, one). */
export function flameClusters(shapes: readonly ShapeLike[], offset: THREE.Vector3): FlameCluster[] {
  const boxes = shapes.map((sh) => shapeBox(sh, offset)), group = boxes.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  const pad = new THREE.Vector3();
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].clone(), size = a.getSize(pad); a.expandByScalar(Math.max(size.x, size.z) * 0.5);
    if (a.intersectsBox(boxes[j])) group[find(i)] = find(j);
  }
  const out = new Map<number, THREE.Box3>();
  boxes.forEach((b, i) => { const k = find(i), u = out.get(k); if (u) u.union(b); else out.set(k, b.clone()); });
  return [...out.values()].map((b) => {
    const c = b.getCenter(new THREE.Vector3()), z = b.getSize(new THREE.Vector3());
    return { p: [c.x, b.min.y, c.z], r: Math.max(0.006, Math.max(z.x, z.z) / 2), h: Math.max(0.01, z.y) };
  });
}

const flameDefs = new WeakMap<object, boolean>();
/** Does this def draw a flame (so it must be animated, never instanced)? Cheap, cached per def args. */
export function hasFlames(def: StoredDef): boolean {
  if (def.make.kind !== 'gen' || def.make.gen !== 'kit/2') return false;
  const args = def.make.args as object | undefined; if (!args) return false;
  let v = flameDefs.get(args);
  if (v === undefined) {
    const shapes = (args as { shapes?: unknown }).shapes, hint = flameHint(def);
    if (Array.isArray(shapes)) v = shapes.some((sh: ShapeLike) => isFlameShape(sh, hint, sh.color) || hint && !!sh.glow && !isSmokeShape(sh));
    else { const text = JSON.stringify(args); v = /"role":"flame"/.test(text) || /"tint":"[^"]*(flame|fire|ember)[^"]*"/.test(text) && /"glow":/.test(text) || hint && /"glow":/.test(text); }
    flameDefs.set(args, v);
  }
  return v;
}

// ---------------------------------------------------------------- per-entity fires
// The camera is read where it is known: each fire's (or stand-in's) onBeforeRender. Shadow passes use other cameras.
const cam = new THREE.Vector3(1e9, 1e9, 1e9);
function noteCamera(_r: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera) { if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) cam.setFromMatrixPosition(camera.matrixWorld); }
const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
/** Reach (m) of each detail level per size class: [flames, embers and smoke]. */
const REACH: Record<FireKind, [number, number]> = { candle: [14, 14], torch: [50, 22], full: [110, 40] };
const kindOf = (c: FlameCluster): FireKind => (c.r < 0.05 ? 'candle' : c.r < 0.2 ? 'torch' : 'full');
/** Stats for the inspector and the frame-cost bench. */
export const flameStats = { mounted: 0, near: 0, enabled: true };
let phone: boolean | null = null;

type Mounted = { fire: Fire; standIns: THREE.Object3D[]; kind: FireKind; level: 0 | 1 | 2 | -1; id: string; strength: number };
const live = new Set<Mounted>();
function show(f: Mounted, level: 0 | 1 | 2) { f.fire.setDetail(level); for (const s of f.standIns) s.visible = level === 0; }
registerFx('fire', {
  set(on) { flameStats.enabled = on; for (const f of live) show(f, on && f.level > 0 ? f.level as 1 | 2 : 0); },
  /** `burning`: the fires drawn near the camera now, with their catch strength (entry 33 proofs). */
  stats() { return { ...flameStats, burning: [...live].filter((f) => f.level > 0).map((f) => ({ id: f.id, kind: f.kind, strength: +f.strength.toFixed(3) })) }; },
});
/** Mount a fire on every flame cluster under `obj`; returns false when there is none. `catchUp`: a fire a Soul just lit
 *  by hand (a hand-operated def is rebuilt at the contact) catches and grows to full over IGNITE seconds. */
const IGNITE = 1.6;
export function mountFlames(obj: THREE.Object3D, id: string, catchUp = false, wisp = false): boolean {
  const fires: Mounted[] = [];
  obj.traverse((pivot) => {
    const clusters = pivot.userData?.flames as FlameCluster[] | undefined; if (!clusters?.length) return;
    const standIns = pivot.children.filter((c) => (c as THREE.Mesh).isMesh);
    for (const m of standIns) m.onBeforeRender = noteCamera;
    clusters.forEach((c, i) => {
      const kind = kindOf(c), fire = createFire(seedOf(`${id}#${i}`), c.r * 1.05, kind, c.h * 1.05, wisp && kind === 'torch');
      fire.group.position.set(c.p[0], c.p[1], c.p[2]);
      fire.group.children[0].onBeforeRender = noteCamera;
      pivot.add(fire.group);
      const f: Mounted = { fire, standIns, kind, level: -1, id, strength: catchUp ? 0.12 : 1 }; fires.push(f); live.add(f);
    });
  });
  if (!fires.length) return false;
  flameStats.mounted += fires.length;
  const at = new THREE.Vector3();
  // the layer ticks a rebuilt thing only after its edit ease-in, so the catch-up starts small here and is timed from the
  // mount (epoch seconds, the clock `t` below is on), not from the first tick
  const t0 = Date.now() / 1000;
  if (catchUp) for (const f of fires) { f.fire.update(0, 0.12); for (const s of f.standIns) s.visible = false; }
  obj.userData.fx = (t: number) => {
    phone ??= (globalThis as { __soulsQuality?: { tier?: string } }).__soulsQuality?.tier === 'phone';
    const time = reduced?.matches ? 7.3 : t;
    const k = catchUp && !reduced?.matches ? Math.min(1, Math.max(0, (t - t0) / IGNITE)) : 1, strength = 0.12 + 0.88 * k * k * (3 - 2 * k);
    for (const f of fires) {
      at.setFromMatrixPosition(f.fire.group.matrixWorld);
      const d = at.distanceTo(cam), [r1, r2] = REACH[f.kind];
      if (!flameStats.enabled) continue;
      const level: 0 | 1 | 2 = d < r2 && !phone ? 2 : d < r1 ? 1 : 0;
      if (level !== f.level) {
        if (f.level > 0) flameStats.near--; if (level > 0) flameStats.near++;
        f.level = level; show(f, level);
      }
      if (level > 0) f.fire.update(time, strength);
      f.strength = strength;
    }
  };
  obj.addEventListener('removed', function gone() {
    obj.removeEventListener('removed', gone);
    for (const f of fires) { if (f.level > 0) flameStats.near--; f.fire.dispose(); live.delete(f); }
    flameStats.mounted -= fires.length;
  });
  return true;
}
