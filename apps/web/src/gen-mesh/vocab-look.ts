// VOCAB-MECH: the catalogue's look conventions, for any def's picture (kit, generator or imported GLB). The physics half
// is in world-compiler vocab (stretch scales the bake). Applied by the gen-mesh registry around every builder, so lanes
// write nothing to get them: a def opts in by declaring the params (vocab `conventions()`), or by having the state.
//
//   stretch  sx sy sz           a per-axis scale (wrapper group; the layer's uniform scale stays outside)
//   warp     taper bend skew    vertex deformation over the def's height (geometry cloned per look)
//   paint    tint vary          multiply every surface by a colour; per-instance colour variation from the seed
//   wear     condition          worn (faded), damaged (dark, askew), construction (a scaffold round it)
//   state    open lit on level  role:door / role:lid swing open; role:flame shows when lit; glow off when on=false;
//                               role:fill rises with level (0..1); station: role:needle slides, role:knob turns
import * as THREE from 'three';
import type { MeshCtx } from './registry.ts';
import { DRAWER_TRAVEL } from '@sim/world-compiler';
import { variantOf } from './material-variants.ts';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const declared = (ctx: MeshCtx, k: string) => Object.hasOwn(ctx.def.params ?? {}, k);
const STATE_LOOKS = ['open', 'lit', 'on', 'level', 'moisture', 'locked', 'station'] as const;

export type Look = { sx: number; sy: number; sz: number; taper: number; bend: number; skew: number; tint: string | null; vary: number; condition: string; state: Record<string, unknown> };
export function lookOf(ctx: MeshCtx): Look | null {
  const p = ctx.params, st = (ctx.entity.state ?? {}) as Record<string, unknown>, defState = ctx.def.state ?? {};
  const g = (k: string, d: number) => (declared(ctx, k) ? num(p[k], d) : d);
  const state: Record<string, unknown> = {};
  for (const k of STATE_LOOKS) if (Object.hasOwn(defState, k) || st[k] !== undefined) state[k] = st[k] ?? (defState as Record<string, { default?: unknown }>)[k]?.default;
  const look: Look = { sx: g('sx', 1), sy: g('sy', 1), sz: g('sz', 1), taper: g('taper', 0), bend: g('bend', 0), skew: g('skew', 0),
    tint: declared(ctx, 'tint') && typeof p.tint === 'string' && /^#[0-9a-f]{6}$/i.test(p.tint) ? p.tint : null, vary: g('vary', 0),
    condition: declared(ctx, 'condition') && typeof p.condition === 'string' ? p.condition : 'new', state };
  const active = look.sx !== 1 || look.sy !== 1 || look.sz !== 1 || look.taper || look.bend || look.skew || look.tint || look.vary > 0 || look.condition !== 'new' || stateMatters(look.state, ctx);
  return active ? look : null;
}
/** State only changes the picture when it differs from what the plain build shows (doors closed, flames on, glow on, full). */
function stateMatters(s: Record<string, unknown>, ctx: MeshCtx) {
  return s.open === true || s.locked === true || s.lit === false || (s.on === false && !ctx.def.components.light) || (typeof s.level === 'number' && s.level < 1) || (typeof s.moisture === 'number' && s.moisture < 1) || typeof s.station === 'string';
}

/** A material changed for a look, shared by every instance with the same look (a variant of the source material,
 *  material-variants.ts: released with its source instead of a uuid-keyed map). */
function lookMaterial(m: THREE.Material, key: string, edit: (m: THREE.MeshStandardMaterial) => void): THREE.Material {
  return variantOf(m, 'look:' + key, edit as (m: THREE.Material) => void);
}
function hashSeed(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

/** Paint, wear and glow on one subtree (also run on GLB children that arrive later). */
function paintSubtree(root: THREE.Object3D, look: Look, ctx: MeshCtx) {
  const seed = ctx.entity.seed ?? hashSeed(ctx.entity.id) * 1e9, r = hashSeed(String(seed));
  const mul = new THREE.Color(1, 1, 1);
  if (look.tint) mul.multiply(new THREE.Color(look.tint));
  if (look.condition === 'worn') mul.multiply(new THREE.Color(0.86, 0.83, 0.78));
  if (look.condition === 'damaged') mul.multiply(new THREE.Color(0.64, 0.6, 0.56));
  if (look.condition === 'construction') mul.multiply(new THREE.Color(0.93, 0.9, 0.86));
  const dh = look.vary ? (r - 0.5) * 0.08 * look.vary : 0, dl = look.vary ? (hashSeed(String(seed) + 'l') - 0.5) * 0.24 * look.vary : 0;
  const glowOff = look.state.on === false && !ctx.def.components.light;
  const key = `${mul.getHexString()}|${dh.toFixed(3)}|${dl.toFixed(3)}|${look.condition}|${glowOff}`;
  if (key === `ffffff|0.000|0.000|new|false`) return;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh || mesh.userData.vocabPainted === key || mesh.name === 'asset frame hook' || mesh.userData.shadowProxy) return;   // (a shadow proxy draws no colour)
    const edit = (m: THREE.MeshStandardMaterial) => {
      if (m.color) { m.color.multiply(mul); if (dh || dl) m.color.offsetHSL(dh, 0, dl); }
      if (look.condition === 'worn' || look.condition === 'damaged') { if (typeof m.roughness === 'number') m.roughness = Math.min(1, m.roughness + 0.15); }
      if (glowOff && m.emissive) m.emissiveIntensity = 0;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => lookMaterial(m, key, edit)) : lookMaterial(mesh.material, key, edit);
    mesh.userData.vocabPainted = key;
  });
}

/** Warp every mesh in the root frame: taper narrows towards the top, bend leans forward (+z), skew shears sideways (+x). */
function warpSubtree(root: THREE.Object3D, look: Look, height: number) {
  if (!look.taper && !look.bend && !look.skew) return;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), v = new THREE.Vector3(), h = Math.max(0.05, height);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh || mesh.userData.vocabWarped || mesh.name === 'asset frame hook') return;
    const rel = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld), back = rel.clone().invert();
    const g = mesh.geometry.clone(), pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(rel);
      const t = Math.max(0, Math.min(1.2, v.y / h)), k = 1 - look.taper * t;
      v.x = v.x * k + look.skew * h * t; v.z = v.z * k + look.bend * h * t * t;
      v.applyMatrix4(back); pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
    mesh.geometry = g; mesh.userData.vocabWarped = true;
  });
}

/** Entry 37: a radio's needle slides along the dial to its station's mark (± RADIO_NEEDLE_STEP m) and its tuning knob turns. */
export const RADIO_NEEDLE_STEP = 0.06, RADIO_KNOB_TURN = -1.35;
export function stationIndex(def: MeshCtx['def'], station: unknown): number {
  const values = (def.state as Record<string, { values?: string[] }> | undefined)?.station?.values ?? [];
  return Math.max(0, values.indexOf(String(station)));
}
/** State drawn by roles (kit parts with `role`): door/lid swing, flame shows, fill rises, a radio's needle and knob. */
function stateRoles(root: THREE.Object3D, look: Look, ctx: MeshCtx) {
  const s = look.state;
  const tuned = typeof s.station === 'string' ? stationIndex(ctx.def, s.station) - 1 : null;
  root.traverse((o) => {
    const role = o.userData.role as string | undefined; if (!role) return;
    if (role === 'door' && s.open !== undefined) o.rotation.y = s.open === true ? -Math.PI * 0.48 : 0;
    if (role === 'lid' && s.open !== undefined) o.rotation.x = s.open === true ? -Math.PI * 0.6 : 0;
    // Soul Actions entry 23: curtains draw back to their outer ends (pleats bunch), a roller blind rolls up to its top
    if ((role === 'curtain-l' || role === 'curtain-r') && s.open !== undefined) o.scale.x = s.open === true ? 0.22 : 1;
    if (role === 'blind' && s.open !== undefined) o.scale.y = s.open === true ? 0.08 : 1;
    // Soul Actions entry 24: a drawer slides straight out of the front; its closed place is kept for the hand's timeline
    if (role === 'drawer' && s.open !== undefined) { o.userData.restZ = o.position.z; if (s.open === true) o.position.z += DRAWER_TRAVEL; }
    // Soul Actions entry 32: a lock's bolt thrown across into the keeper, the thumb-turn turned across; the key only in the hand
    if (role === 'bolt' || role === 'thumb' || role === 'key') lockPose(o, role, s.locked === true ? 1 : 0, false);
    if (role === 'flame' && s.lit !== undefined) o.visible = s.lit !== false;
    if (role === 'fill' && typeof s.level === 'number') { o.scale.y = Math.max(0.001, Math.min(1, s.level)); o.visible = s.level > 0.001; }
    // W5: a bed's damp patch (role fill on a thing with `moisture`, no `level`) spreads across the soil as it is watered
    else if (role === 'fill' && typeof s.moisture === 'number') { const m = Math.max(0.001, Math.min(1, s.moisture)); o.scale.set(m, 1, m); o.visible = s.moisture > 0.02; }
    // Entry 16: a planter's plant (parts with role head on a thing with moisture) droops and browns when dry
    if (role === 'head' && typeof s.moisture === 'number' && s.moisture < 1) { const dry = 1 - Math.max(0, Math.min(1, s.moisture));
      o.scale.y *= 1 - 0.45 * dry; o.rotation.z += (o.position.x >= 0 ? -1 : 1) * 0.5 * dry;
      const q = Math.round(dry * 4) / 4; if (q > 0) o.traverse((c) => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.color) (c as THREE.Mesh).material = lookMaterial(m, 'dry' + q, (x) => x.color.lerp(new THREE.Color('#8a7246'), 0.7 * q)); }); }
    if (role === 'needle' && tuned !== null) { o.userData.restX ??= o.position.x; o.position.x = (o.userData.restX as number) + tuned * RADIO_NEEDLE_STEP; }
    if (role === 'knob' && tuned !== null) o.rotation.z = (tuned + 1) * RADIO_KNOB_TURN;
    if ((role === 'light' || role === 'screen') && s.on === false) o.traverse((c) => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.emissive) (c as THREE.Mesh).material = lookMaterial(m, 'off', (x) => { x.emissiveIntensity = 0; }); });
  });
}

/** Entry 32: a lock's moving part at `k` (0 unlocked … 1 locked): the bolt slides 6 cm across the gap into the keeper, the
 *  thumb-turn and the key turn a quarter; the key is drawn only while a hand turns it. Shared with the entity layer, which
 *  drives `k` from the hand's recorded turn. */
export const LOCK_BOLT_TRAVEL = 0.06;
export function lockPose(o: THREE.Object3D, role: string, k: number, keyShown: boolean) {
  if (role === 'bolt') { const rest = o.userData.restPos as number[] | undefined; o.position.x = (rest?.[0] ?? o.position.x) + LOCK_BOLT_TRAVEL * k; }
  else if (role === 'thumb') o.rotation.z = (Math.PI / 2) * k;
  else if (role === 'key') { o.rotation.z = (Math.PI / 2) * k; o.visible = keyShown; }
}
/** A scaffold of poles and boards round the def's box: "under construction". */
function scaffold(box: [number, number, number]): THREE.Object3D {
  const g = new THREE.Group(); g.name = 'vocab:scaffold';
  const [w, h, d] = box, pad = 0.35, x = w / 2 + pad, z = d / 2 + pad, top = h + 0.4;
  const pole = new THREE.MeshStandardMaterial({ color: '#b9a27a', roughness: 0.9 }), board = new THREE.MeshStandardMaterial({ color: '#c8a46a', roughness: 0.95 });
  const cols = Math.max(2, Math.ceil(w / 2.2) + 1), rows = Math.max(2, Math.ceil(d / 2.2) + 1);
  const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, top, 6); poleGeo.translate(0, top / 2, 0);
  for (let i = 0; i < cols; i++) for (const zz of [-z, z]) { const m = new THREE.Mesh(poleGeo, pole); m.position.set(-x + (2 * x * i) / (cols - 1), 0, zz); g.add(m); }
  for (let j = 1; j < rows - 1; j++) for (const xx of [-x, x]) { const m = new THREE.Mesh(poleGeo, pole); m.position.set(xx, 0, -z + (2 * z * j) / (rows - 1)); g.add(m); }
  for (let y = 1.6; y < top; y += 1.8) {
    for (const zz of [-z, z]) { const b = new THREE.Mesh(new THREE.BoxGeometry(2 * x, 0.05, 0.4), board); b.position.set(0, y, zz); g.add(b); }
    for (const xx of [-x, x]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 2 * z), board); b.position.set(xx, y, 0); g.add(b); }
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Wrap a built picture with its look. Returns the object the entity layer places (a wrapper when stretched). */
export function applyLook(obj: THREE.Object3D | null, ctx: MeshCtx): THREE.Object3D | null {
  if (!obj) return obj;
  const look = lookOf(ctx); if (!look) return obj;
  const box = ctx.baked.box as [number, number, number];
  const h = box[1] / (look.sy || 1);   // the picture is built at the unstretched size
  const apply = (root: THREE.Object3D) => { warpSubtree(root, look, h); paintSubtree(root, look, ctx); stateRoles(root, look, ctx); };
  apply(obj);
  // imported meshes arrive after build (mesh.mesh.ts adds the GLB later): give them the same look when they land
  // the event object is reused (its child is null again by the microtask): keep the child itself (entry 34 found it)
  obj.addEventListener('childadded', (e: { child?: THREE.Object3D }) => { const child = e.child; if (child) queueMicrotask(() => apply(child)); });
  if (look.condition === 'damaged') { obj.rotation.z = (hashSeed(ctx.entity.id) - 0.5) * 0.06; obj.rotation.x = (hashSeed(ctx.entity.id + 'x') - 0.5) * 0.05; }
  const stretched = look.sx !== 1 || look.sy !== 1 || look.sz !== 1;
  if (!stretched && look.condition !== 'construction') return obj;
  const wrap = new THREE.Group(); wrap.name = obj.name; wrap.userData = { ...obj.userData, vocabWrap: true };
  delete wrap.userData.instanceKey;
  obj.scale.set(look.sx, look.sy, look.sz); wrap.add(obj);
  if (look.condition === 'construction') wrap.add(scaffold(box));
  return wrap;
}
/** Builders' instance keys must not merge a looked-at instance with plain ones. */
export const lookKey = (ctx: MeshCtx) => { const l = lookOf(ctx); return l ? JSON.stringify(l) : ''; };
