// Soul Actions entry 34: the plants of a growing planter (core-garden-planter@2), drawn from its state: growth (seed,
// sprout, leafy, flowering, fruiting), moisture and thirst (wilting). Three plants in a row — two cosmos either side of a
// tomato. Each plant is a small skeleton (a main stem and side branches) carrying leaves, flowers and fruit; every part is
// an instance of a shared shape (a few draws per bed, whatever its stage). `posePlants` takes a continuous growth value,
// so a stage change or a wilt eases instead of popping (WorldEntityLayer tweens it).
import * as THREE from 'three';
import { biologyRecordOf, biologyAt } from '@sim/world-compiler';

type St = Record<string, unknown> | undefined;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const k = clamp01(v); return k * k * (3 - 2 * k); };
/** The look a planter's state asks for: growth 0..4, wilt 0..1 (dry and thirsty), moisture 0..1 (the damp patch). */
export type PlantLook = { g: number; w: number; m: number };
export const isGrowingDef = (def: { state?: Record<string, { type?: string }> }) => def.state?.growth?.type === 'number';
export function plantLookOf(state: St, def: { state?: Record<string, { default?: unknown }> }, hour?: number): PlantLook {
  const d = (k: string, f: number) => num(state?.[k], num(def.state?.[k]?.default, f));
  const anchor = biologyRecordOf(state, def);
  if (anchor && anchor.biologyHour >= 0) { const at = anchor.biologyEnabled ? biologyAt(anchor, hour ?? anchor.biologyHour) : {g:anchor.biologyGrowth,w:anchor.biologyWilt,m:anchor.biologyMoisture}; return {g:at.g,w:at.w,m:at.m}; }
  const m = d('moisture', 0.1), thirst = d('thirst', 0);
  return { g: Math.max(0, Math.min(4, d('growth', 0))), m, w: m >= 0.34 ? 0 : 0.35 + 0.65 * Math.min(1, thirst / 3) };
}

// ---- shared shapes (made once) ----
function leafGeo(width: number, arch: number, lobes = 0) {
  const s = new THREE.Shape(), n = 14; s.moveTo(0, 0);
  const half = (x: number) => width * Math.sin(Math.PI * Math.pow(x, 0.8)) * (lobes ? 0.75 + 0.25 * Math.abs(Math.sin(x * Math.PI * lobes)) : 1) / 2;
  for (let i = 1; i <= n; i++) { const x = i / n; s.lineTo(x, half(x)); }
  for (let i = n - 1; i >= 1; i--) { const x = i / n; s.lineTo(x, -half(x)); }
  s.lineTo(0, 0);
  const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2);   // in the x–z plane, face up, base at the origin
  const p = g.attributes.position as THREE.BufferAttribute;
  // the blade arches and drops toward its tip and folds up a little along the midrib
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, arch * x * (1 - x) * 0.9 - 0.18 * x * x + Math.abs(z) * 0.45); }
  g.computeVertexNormals(); return g;
}
let shapes: Record<'narrow' | 'broad' | 'petal' | 'stem' | 'ball' | 'mound', THREE.BufferGeometry> | null = null;
function getShapes() {
  if (shapes) return shapes;
  const stem = new THREE.CylinderGeometry(0.75, 1, 1, 6, 1); stem.translate(0, 0.5, 0);
  return (shapes = { narrow: leafGeo(0.2, 0.25), broad: leafGeo(0.5, 0.35, 3), petal: leafGeo(0.42, 0.12), stem, ball: new THREE.SphereGeometry(1, 12, 9), mound: new THREE.SphereGeometry(1, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2) });
}
const C = { leaf: new THREE.Color('#4a8a35'), tomatoLeaf: new THREE.Color('#3f7a33'), dry: new THREE.Color('#8f7a4e'), stem: new THREE.Color('#5a8636'), petal: new THREE.Color('#f39ac0'), petalDry: new THREE.Color('#b8a096'), eye: new THREE.Color('#e9b52c'), green: new THREE.Color('#7fae45'), red: new THREE.Color('#dc3f28'), mound: new THREE.Color('#3b2a1c'), yellow: new THREE.Color('#f2d23c') };

// ---- layout: each plant's skeleton (in the plant's own frame, at full size) and its parts ----
type V = [number, number, number];
type Branch = { at: number; phi: number; up: number; len: number; t: number };
type Leaf = { plant: number; on: number; u: number; phi: number; len: number; t: number; pitch: number; coty?: true };
type Bloom = { plant: number; on: number; t: number; size: number; phi: number };
type Fruit = { plant: number; on: number; u: number; phi: number; t: number; r: number };
type Plant = { x: number; z: number; yaw: number; tomato: boolean; height: number; branches: Branch[]; leanPhi: number };
type Layout = { plants: Plant[]; leaves: Leaf[]; blooms: Bloom[]; fruits: Fruit[]; stems: { plant: number; seg: number }[] };
function layout(seed: number): Layout {
  let s = (seed | 0) || 1; const r = () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 3266489917 | 0) >>> 0) / 4294967296;
  const plants: Plant[] = [-0.26, 0.01, 0.27].map((x, i) => {
    const tomato = i === 1, nb = tomato ? 3 : 2;
    const branches: Branch[] = Array.from({ length: nb }, (_, k) => ({ at: (tomato ? 0.32 : 0.42) + k * 0.2, phi: k * 2.4 + r() * 0.8, up: tomato ? 0.55 + r() * 0.2 : 0.95 + r() * 0.2, len: (tomato ? 0.5 : 0.55) * (1 - 0.15 * k), t: 1.35 + 0.25 * k }));
    return { x: x + (r() - 0.5) * 0.04, z: (r() - 0.5) * 0.08, yaw: r() * Math.PI * 2, tomato, height: tomato ? 0.36 : 0.33 + r() * 0.05, branches, leanPhi: r() * Math.PI * 2 };
  });
  const leaves: Leaf[] = [], blooms: Bloom[] = [], fruits: Fruit[] = [], stems: { plant: number; seg: number }[] = [];
  plants.forEach((p, i) => {
    stems.push({ plant: i, seg: -1 }); p.branches.forEach((_, k) => stems.push({ plant: i, seg: k }));
    // seed leaves at the sprout, then true leaves up the main stem in a spiral, more on each branch
    leaves.push({ plant: i, on: -1, u: 1, phi: 0, len: 0.034, t: 0.2, pitch: 0.15, coty: true }, { plant: i, on: -1, u: 1, phi: Math.PI, len: 0.034, t: 0.3, pitch: 0.15, coty: true });
    const main = p.tomato ? 10 : 12;
    for (let k = 0; k < main; k++) leaves.push({ plant: i, on: -1, u: 0.1 + 0.85 * k / main, phi: k * 2.39996 + r() * 0.4, len: (p.tomato ? 0.13 : 0.1) * (1.15 - 0.45 * k / main) * (0.85 + r() * 0.3), t: 0.85 + 1.2 * k / main, pitch: 0.35 + 0.3 * k / main + (r() - 0.5) * 0.2 });
    p.branches.forEach((b, k) => { for (let j = 0; j < (p.tomato ? 3 : 5); j++) leaves.push({ plant: i, on: k, u: 0.3 + 0.65 * j / (p.tomato ? 3 : 5), phi: b.phi + (j % 2 ? 1.3 : -1.3) + (r() - 0.5) * 0.4, len: (p.tomato ? 0.11 : 0.07) * (0.85 + r() * 0.3), t: b.t + 0.2 + 0.3 * j / 5, pitch: 0.3 + r() * 0.3 }); });
    if (p.tomato) {
      blooms.push({ plant: i, on: -1, t: 2.3, size: 0.013, phi: 0 }, ...p.branches.map((_, k) => ({ plant: i, on: k, t: 2.45 + 0.15 * k, size: 0.012, phi: k })));
      p.branches.forEach((b, k) => { for (let j = 0; j < 2; j++) fruits.push({ plant: i, on: k, u: 0.45 + 0.3 * j, phi: b.phi + (j ? 0.9 : -0.9), t: 3.0 + 0.12 * (k * 2 + j), r: 0.019 + r() * 0.006 }); });
    } else blooms.push({ plant: i, on: -1, t: 2.1, size: 0.034, phi: r() }, ...p.branches.map((_, k) => ({ plant: i, on: k, t: 2.3 + 0.25 * k, size: 0.03 + r() * 0.006, phi: r() })));
  });
  return { plants, leaves, blooms, fruits, stems };
}

const PETALS = 8, TOMATO_PETALS = 5, SOIL_Y = 0.372;
export type PlantGroup = THREE.Group & { userData: { plantLayout: Layout; meshes: Record<string, THREE.InstancedMesh>; mats: Record<string, THREE.MeshStandardMaterial>; look?: PlantLook } };
/** The plants of a growing planter, posed at `look`. Its own few instanced meshes; never instanced with other things. */
export function plantGroup(seed: number, look: PlantLook): PlantGroup {
  const sh = getShapes(), L = layout(seed), g = new THREE.Group() as PlantGroup;
  g.name = 'plant growth';
  const mat = (c: THREE.Color, side: THREE.Side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ color: c.clone(), roughness: 0.82, metalness: 0, side });
  const mats = { leaf: mat(C.leaf, THREE.DoubleSide), tleaf: mat(C.tomatoLeaf, THREE.DoubleSide), stem: mat(C.stem), petal: mat(C.petal, THREE.DoubleSide), tpetal: mat(C.yellow, THREE.DoubleSide), eye: mat(C.eye), fruit: mat(C.green), mound: mat(C.mound) };
  mats.fruit.roughness = 0.35;
  const n = (f: (b: Bloom) => number) => L.blooms.reduce((s, b) => s + f(b), 0);
  const im = (geo: THREE.BufferGeometry, m: THREE.Material, count: number, name: string) => { const x = new THREE.InstancedMesh(geo, m, Math.max(1, count)); x.name = name; x.castShadow = true; x.frustumCulled = false; g.add(x); return x; };
  const tomato = (lf: Leaf) => L.plants[lf.plant].tomato;
  const meshes = { mound: im(sh.mound, mats.mound, L.plants.length, 'mounds'), stem: im(sh.stem, mats.stem, L.stems.length + L.fruits.length, 'stems'),
    leaf: im(sh.narrow, mats.leaf, L.leaves.filter((x) => !tomato(x)).length, 'cosmos leaves'), tleaf: im(sh.broad, mats.tleaf, L.leaves.filter(tomato).length, 'tomato leaves'),
    petal: im(sh.petal, mats.petal, n((b) => (L.plants[b.plant].tomato ? 0 : PETALS)), 'cosmos petals'), tpetal: im(sh.petal, mats.tpetal, n((b) => (L.plants[b.plant].tomato ? TOMATO_PETALS : 0)), 'tomato flowers'),
    eye: im(sh.ball, mats.eye, L.blooms.length, 'flower centres'), fruit: im(sh.ball, mats.fruit, L.fruits.length, 'tomatoes') };
  meshes.mound.castShadow = false;
  g.userData.plantLayout = L; g.userData.meshes = meshes; g.userData.mats = mats;
  posePlants(g, look);
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), _d = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
/** Height of a plant's main stem through the stages (m): a 1 cm shoot, a 5 cm sprout, then most of its height when leafy. */
function heightAt(p: Plant, g: number) {
  const k: [number, number][] = [[0, 0], [0.2, 0.012], [1, 0.055], [2, 0.75 * p.height], [3, 0.95 * p.height], [4, p.height]];
  for (let i = 1; i < k.length; i++) if (g <= k[i][0]) { const [g0, h0] = k[i - 1], [g1, h1] = k[i]; return h0 + (h1 - h0) * smooth((g - g0) / (g1 - g0)); }
  return p.height;
}
/** Pose every part for growth `g` (0..4, continuous) and wilt `w` (0..1). Called on build and while a change eases. */
export function posePlants(group: PlantGroup, look: PlantLook) {
  const { plantLayout: L, meshes, mats } = group.userData, { g, w } = look;
  let si = 0, li = 0, tli = 0, pi = 0, ti = 0;
  const frames = L.plants.map((p) => {
    // the plant's frame: its foot on the soil, its own yaw, the whole plant bowed over to one side as it wilts
    const q = new THREE.Quaternion().setFromAxisAngle(Y, p.yaw), bow = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(p.leanPhi), 0, Math.sin(p.leanPhi)), 0.3 * w);
    const rot = bow.multiply(q), base = new THREE.Vector3(p.x, SOIL_Y, p.z), H = heightAt(p, g);
    const to = (v: V, out: THREE.Vector3) => out.set(v[0], v[1], v[2]).applyQuaternion(rot).add(base);
    // the skeleton at this size: the main stem straight up, branches out of it (they droop as it wilts)
    const top: V = [0, H, 0], bk = smooth((g - 1.2) / 1.0);
    const branch = (b: Branch): { from: V; to: V } => { const y = b.at * H, l = b.len * H * bk, e = b.up - 0.5 * w; return { from: [0, y, 0], to: [Math.cos(b.phi) * Math.cos(e) * l, y + Math.sin(e) * l, -Math.sin(b.phi) * Math.cos(e) * l] }; };
    const segs = [{ from: [0, 0, 0] as V, to: top }, ...p.branches.map(branch)];
    const along = (on: number, u: number): V => { const s0 = segs[on + 1]; return [s0.from[0] + (s0.to[0] - s0.from[0]) * u, s0.from[1] + (s0.to[1] - s0.from[1]) * u, s0.from[2] + (s0.to[2] - s0.from[2]) * u]; };
    return { p, rot, to, segs, along, H, bk };
  });
  const seg = (a: THREE.Vector3, b: THREE.Vector3, r: number) => { _d.subVectors(b, a); const l = _d.length(); if (l < 1e-4) return HIDE; _q.setFromUnitVectors(Y, _d.multiplyScalar(1 / l)); return _m.compose(a, _q, _s.set(r, l, r)); };
  L.plants.forEach((p, i) => {
    const k = 1 - smooth(g / 0.9);
    meshes.mound.setMatrixAt(i, k > 0.01 ? _m.compose(_p.set(p.x, SOIL_Y - 0.004, p.z), _q.identity(), _s.set(0.04 * (0.7 + 0.3 * k), 0.016 * k, 0.04 * (0.7 + 0.3 * k))) : HIDE);
  });
  for (const st of L.stems) {
    const f = frames[st.plant], s0 = f.segs[st.seg + 1], thick = 0.0022 + 0.0042 * smooth(g / 3) * (st.seg < 0 ? 1 : 0.7);
    const show = st.seg < 0 ? g > 0.12 : f.bk > 0.02;
    meshes.stem.setMatrixAt(si++, show ? seg(f.to(s0.from, _a), f.to(s0.to, _b), thick) : HIDE);
  }
  for (const lf of L.leaves) {
    const f = frames[lf.plant], tomato = f.p.tomato, mesh = tomato ? meshes.tleaf : meshes.leaf, idx = tomato ? tli++ : li++;
    let k = smooth((g - lf.t) / 0.7); if (lf.coty) k *= 1 - 0.8 * smooth((g - 1.5) / 1.0); if (lf.on >= 0) k *= f.bk;
    if (k < 0.01) { mesh.setMatrixAt(idx, HIDE); continue; }
    f.to(f.along(lf.on, lf.u), _p);
    // the blade points out from its stem; its pitch tips it down as the plant wilts
    _q.copy(f.rot).multiply(_q2.setFromAxisAngle(Y, lf.phi)).multiply(_q3.setFromAxisAngle(Z, lf.pitch - 1.25 * w * (0.5 + 0.5 * lf.u)));
    const len = lf.len * k;
    mesh.setMatrixAt(idx, _m.compose(_p, _q, _s.set(len, len, len * (1 - 0.3 * w))));
  }
  L.blooms.forEach((b, i) => {
    const f = frames[b.plant], tomato = f.p.tomato, mesh = tomato ? meshes.tpetal : meshes.petal, n = tomato ? TOMATO_PETALS : PETALS;
    const open = smooth((g - b.t) / 0.8) * (b.on >= 0 ? f.bk : 1) * (tomato ? 1 - 0.5 * smooth((g - 3.2) / 0.6) : 1);
    const next = () => (tomato ? ti++ : pi++);
    if (open < 0.01) { meshes.eye.setMatrixAt(i, HIDE); for (let j = 0; j < n; j++) mesh.setMatrixAt(next(), HIDE); return; }
    const s0 = f.segs[b.on + 1]; f.to(s0.to, _p);
    // a bud swells and opens at the tip; the flower faces up and nods as it wilts (a tomato's flowers hang)
    const nod = (tomato ? 1.2 : 0.2) + 1.1 * w, size = b.size * (0.4 + 0.6 * open);
    _q.copy(f.rot).multiply(_q2.setFromAxisAngle(Y, b.phi)).multiply(_q3.setFromAxisAngle(Z, -nod));
    const face = _q.clone();
    meshes.eye.setMatrixAt(i, _m.compose(_p, face, _s.set(size * 0.26, size * 0.18, size * 0.26)));
    for (let j = 0; j < n; j++) {
      _q.copy(face).multiply(_q2.setFromAxisAngle(Y, (j / n) * Math.PI * 2)).multiply(_q3.setFromAxisAngle(Z, 0.12 + 0.45 * w + (1 - open) * 1.25));
      mesh.setMatrixAt(next(), _m.compose(_p, _q, _s.set(size, size, size)));
    }
  });
  L.fruits.forEach((fr, i) => {
    const f = frames[fr.plant], k = smooth((g - fr.t) / 0.7) * f.bk;
    if (k < 0.01) { meshes.fruit.setMatrixAt(i, HIDE); meshes.stem.setMatrixAt(si++, HIDE); return; }
    // a short stalk out of the branch, the tomato hanging under it
    const at = f.along(fr.on, fr.u), stalkEnd: V = [at[0] + Math.cos(fr.phi) * 0.022, at[1] - 0.012, at[2] - Math.sin(fr.phi) * 0.022], r = fr.r * (0.3 + 0.7 * k);
    f.to(at, _a); f.to(stalkEnd, _b); meshes.stem.setMatrixAt(si++, seg(_a, _b, 0.0018));
    meshes.fruit.setMatrixAt(i, _m.compose(_p.set(_b.x, _b.y - r * 0.9, _b.z), _q.identity(), _s.set(r, r * 0.86, r)));
  });
  for (const m of Object.values(meshes)) m.instanceMatrix.needsUpdate = true;
  // colour: leaves and stems brown off as it wilts; petals fade; tomatoes ripen from green to red
  mats.leaf.color.copy(C.leaf).lerp(C.dry, 0.7 * w); mats.tleaf.color.copy(C.tomatoLeaf).lerp(C.dry, 0.7 * w);
  mats.stem.color.copy(C.stem).lerp(C.dry, 0.5 * w);
  mats.petal.color.copy(C.petal).lerp(C.petalDry, 0.55 * w);
  mats.fruit.color.copy(C.green).lerp(C.red, smooth((g - 3.3) / 0.6)).lerp(_c.copy(C.dry), 0.25 * w);
  group.userData.look = { ...look };
}

/** Stable plant layout, independent of the viewer's current model. */
export const plantSeed = (id:string) => {let h=2166136261;for(let i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),16777619);return h;};
export function plantPatch(root:THREE.Object3D,m:number){root.traverse(o=>{if(o.userData.role==='fill'){const k=Math.max(.001,Math.min(1,m));o.scale.set(k,1,k);o.visible=m>.02;}});}
