// kit/2 mesh half: rounded low-poly primitives merged into few draws; parts with a `role` stay
// separate under pivot groups so creature gaits and spinning wheels can move them. Owner: L1.
// Geometry is cached per (def hash, palette) so many instances share one BufferGeometry.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { expandKitProgram, kitArgs, kitWhen, type KitArgs, type KitProgramArgs, type KitShape } from '@souls/generators';
import { fallingWaterMaterial, fallingWaterSheets, isSprayShape, rippleMaterial, type Disc } from '../fx/water.ts';
import { flameClusters, flameHint, isFlameShape, isSmokeShape, mountFlames, smokeSources } from '../fx/flames.ts';
import { registerMesh, type MeshCtx } from './registry.ts';
import { shapeFaceMeshes } from './faces.ts'; // XP8 hook
import { kitClassSurface, kitSurfaceAttribute, kitSurfaceSuffix } from './kit-surfaces.ts'; // Y1 / XP7 hook
import { addShadowProxy } from './shadow-proxy.ts';

const cache = new Map<string, THREE.Object3D>();
/** Entry 33: hand-operated things this viewer has drawn out (on false), so a fire catches only when it was seen lit by hand. */
const wasOut = new Map<string, boolean>();

/** Geometry for one primitive, centred where its kind is naturally centred; caller transforms. */
function primitive(sh: KitShape, round: number, v: number): THREE.BufferGeometry {
  const seg = sh.segments ?? 10;
  switch (sh.kind) {
    case 'box': case 'rbox': {
      const [w, h, d] = sh.size ?? [1, 1, 1];
      const r = Math.min(sh.round ?? (sh.kind === 'rbox' ? Math.max(round, 0.06) : round), Math.min(w, h, d) / 2 - 1e-4);
      if (r <= 0.005) return new THREE.BoxGeometry(w, h, d);
      if (sh.kind === 'rbox' && (sh.segments ?? 0) >= 2) return new RoundedBoxGeometry(w, h, d, v === 2 ? seg : 2, r);  // explicitly smooth
      // chamfered box: a bevelled extrude (~28–44 tris) instead of RoundedBox (108): rounded look, 80/20 budget
      const s = new THREE.Shape(); s.moveTo(-w / 2 + r, -h / 2 + r); s.lineTo(w / 2 - r, -h / 2 + r); s.lineTo(w / 2 - r, h / 2 - r); s.lineTo(-w / 2 + r, h / 2 - r); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-3, d - 2 * r), bevelEnabled: true, bevelSize: r, bevelThickness: r, bevelSegments: 1, curveSegments: 1 });
      g.translate(0, 0, -(d - 2 * r) / 2); return g;
    }
    case 'cyl': return new THREE.CylinderGeometry(sh.r2 ?? sh.r ?? 0.5, sh.r ?? 0.5, sh.h ?? 1, seg, 1, false, 0, v === 2 ? sh.arc ?? Math.PI * 2 : Math.PI * 2);
    case 'cone': return new THREE.ConeGeometry(sh.r ?? 0.5, sh.h ?? 1, seg, 1, false, 0, v === 2 ? sh.arc ?? Math.PI * 2 : Math.PI * 2);
    case 'capsule': return new THREE.CapsuleGeometry(sh.r ?? 0.2, sh.h ?? 0.6, 2, Math.max(6, Math.min(seg, 10)));
    case 'sphere': return new THREE.SphereGeometry(sh.r ?? 0.5, seg, Math.max(4, Math.round(seg * 0.6)), 0, v === 2 ? sh.arc ?? Math.PI * 2 : Math.PI * 2);
    case 'torus': return new THREE.TorusGeometry(sh.r ?? 0.5, sh.r2 ?? 0.1, 6, seg, sh.arc ?? Math.PI * 2);
    case 'ring': { const g = new THREE.TorusGeometry(sh.r ?? 0.5, sh.r2 ?? 0.1, 6, seg, sh.arc ?? Math.PI * 2); g.rotateX(Math.PI / 2); return g; }
    case 'wedge': {
      const [w, h, d] = sh.size ?? [1, 1, 1];
      const s = new THREE.Shape([new THREE.Vector2(-d / 2, -h / 2), new THREE.Vector2(d / 2, -h / 2), new THREE.Vector2(-d / 2, h / 2)]);
      const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: (sh.round ?? round) > 0.005, bevelSize: Math.min(sh.round ?? round, 0.03), bevelThickness: Math.min(sh.round ?? round, 0.03), bevelSegments: 1 });
      g.translate(0, 0, -w / 2); g.rotateY(-Math.PI / 2); return g;
    }
    case 'arch': {
      const [w, h, d] = sh.size ?? [2, 2, 0.3]; const t = Math.min(w, h) * 0.18, rIn = w / 2 - t, spring = h - w / 2;
      // K2: the shared expander supplies a pointed ribbon in the ordinary arch frame.
      if (sh.polygon) {
        const s = new THREE.Shape(sh.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
        const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); g.translate(0, -h / 2, -d / 2); return g;
      }
      const arc = v === 2 ? sh.arc ?? Math.PI : Math.PI, start = Math.PI / 2 + arc / 2, end = Math.PI / 2 - arc / 2, x = arc === Math.PI ? 1 : Math.sin(arc / 2), y = arc === Math.PI ? 0 : Math.cos(arc / 2);
      const s = new THREE.Shape(); s.moveTo(-w / 2 * x, 0); s.lineTo(-w / 2 * x, spring + w / 2 * y); s.absarc(0, spring, w / 2, start, end, true); s.lineTo(w / 2 * x, 0); s.lineTo(rIn * x, 0); s.lineTo(rIn * x, spring + rIn * y); s.absarc(0, spring, rIn, end, start, false); s.lineTo(-rIn * x, 0); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: Math.max(6, seg) }); g.translate(0, -h / 2, -d / 2); return g;
    }
    case 'lathe': return new THREE.LatheGeometry((sh.profile ?? [[0.5, 0], [0.5, 1]]).map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg, 0, v === 2 ? sh.arc ?? Math.PI * 2 : Math.PI * 2);
    case 'extrude': {
      const s = new THREE.Shape((sh.polygon ?? [[0, 0], [1, 0], [0, 1]]).map(([x, z]) => new THREE.Vector2(x, z)));
      if (v === 2) for (const hole of sh.holes ?? []) s.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, z))));
      const g = new THREE.ExtrudeGeometry(s, { depth: sh.h ?? 0.2, bevelEnabled: (sh.round ?? round) > 0.005, bevelSize: Math.min(sh.round ?? round, 0.03), bevelThickness: Math.min(sh.round ?? round, 0.03), bevelSegments: 1 });
      g.rotateX(Math.PI / 2); g.translate(0, sh.h ?? 0.2, 0); return g;
    }
    case 'loft': return loft(sh);
    case 'sweep': {
      const pts = (sh.path ?? [[0, 0, 0], [1, 0, 0]]).map(([x, y, z]) => new THREE.Vector3(x, y, z));
      if (v === 2 && sh.profile) return new THREE.ExtrudeGeometry(new THREE.Shape(sh.profile.map(([x, y]) => new THREE.Vector2(x, y))), { steps: Math.max(4, pts.length * 4), extrudePath: profileCurve(pts), bevelEnabled: false });
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(4, pts.length * 4), sh.r ?? 0.05, Math.max(5, Math.min(seg, 8)), false);
    }
  }
}

/** Start a profile upright (+y toward world up), then parallel-transport it along the curve.
 * Three's arbitrary initial Frenet normal can otherwise turn a roof upside down on a +z path. */
function profileCurve(points: THREE.Vector3[]): THREE.CatmullRomCurve3 {
  const curve = new THREE.CatmullRomCurve3(points), frames = curve.computeFrenetFrames.bind(curve);
  curve.computeFrenetFrames = (segments, closed) => {
    const f = frames(segments, closed), t = f.tangents[0];
    const up = Math.abs(t.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1);
    up.addScaledVector(t, -up.dot(t)).normalize();
    const normal = new THREE.Vector3().crossVectors(up, t).normalize();
    const c = f.normals[0].dot(normal), s = f.binormals[0].dot(normal);
    for (let i = 0; i < f.normals.length; i++) {
      const n = f.normals[i].clone(), b = f.binormals[i].clone();
      f.normals[i].copy(n).multiplyScalar(c).addScaledVector(b, s);
      f.binormals[i].copy(b).multiplyScalar(c).addScaledVector(n, -s);
    }
    return f;
  };
  return curve;
}

/** A capped loft pairs polygon[i] at y=0 with top[i] at y=h (same winding). */
function loft(sh: KitShape): THREE.BufferGeometry {
  let bottom = sh.polygon!, top = sh.top!;
  if (THREE.ShapeUtils.isClockWise(bottom.map(p => new THREE.Vector2(...p)))) { bottom = [...bottom].reverse(); top = [...top].reverse(); }
  const n = bottom.length, h = sh.h ?? 1;
  const positions = [...bottom.flatMap(([x, z]) => [x, 0, z]), ...top.flatMap(([x, z]) => [x, h, z])];
  const indices: number[] = [];
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(bottom.map(p => new THREE.Vector2(...p)), [])) indices.push(a, b, c);
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(top.map(p => new THREE.Vector2(...p)), [])) indices.push(n + c, n + b, n + a);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; indices.push(i, n + i, j, j, n + i, n + j); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices);
  // Flat face normals, matching extrude rather than averaging corners across adjacent faces.
  const out = g.toNonIndexed(); g.dispose(); out.computeVertexNormals(); return out;
}

/** Transform a primitive by scale, rotation (YXZ: yaw, pitch, roll) and position; returns non-indexed geometry with vertex colours. */
function placed(sh: KitShape, round: number, v: number, color: THREE.Color, offset?: THREE.Vector3, surface = false): THREE.BufferGeometry {
  const g0 = primitive(sh, round, v); const g = g0.index ? g0.toNonIndexed() : g0; if (g !== g0) g0.dispose();
  if (surface) g.setAttribute('edenSurf', kitSurfaceAttribute(sh, g)); // Y1: shape-local metres, before placement
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(sh.at[0], sh.at[1], sh.at[2]).sub(offset ?? new THREE.Vector3()),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(sh.pitch ?? 0, sh.yaw ?? 0, sh.roll ?? 0, 'YXZ')),
    new THREE.Vector3(...(sh.scale ?? [1, 1, 1])),
  );
  g.applyMatrix4(m);
  // K2: reflected geometry is baked into vertices; retain outward face winding.
  if (m.determinant() < 0) for (const attribute of Object.values(g.attributes)) {
    const a = attribute as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i += 3) for (let k = 0; k < a.itemSize; k++) {
      const j = (i + 1) * a.itemSize + k, l = (i + 2) * a.itemSize + k;
      const v = a.array[j]; a.array[j] = a.array[l]; a.array[l] = v;
    }
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count, cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { cols[i * 3] = color.r; cols[i * 3 + 1] = color.g; cols[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color' && k !== 'edenSurf') g.deleteAttribute(k);
  return g;
}
function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0; for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const surf = geos.every((g) => g.attributes.edenSurf) ? new Float32Array(count * 4) : null; // Y1
  let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array as Float32Array, o * 3); nor.set(g.attributes.normal.array as Float32Array, o * 3); col.set(g.attributes.color.array as Float32Array, o * 3); surf?.set(g.attributes.edenSurf.array as Float32Array, o * 4); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (surf) out.setAttribute('edenSurf', new THREE.BufferAttribute(surf, 4)); // Y1
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}
/** W2 sway: which part of a plant a shape is (' trunk', ' foliage', or '' for its pot, soil and stones, which stay still).
 *  A small plant sways whole (its pot sits at the root, where the bend is ~0), so it keeps its one draw. */
const PLANT_STILL = /pot|soil|clay|stone|rock|box|planter|metal|rim|base|ground|earth|mulch|gravel|plinth|tub/, PLANT_TRUNK = /bark|trunk|wood|stem|branch|log/;
function plantPart(sh: KitShape, plant: 'tree' | 'small'): string { const t = `${sh.tint ?? ''} ${sh.material ?? ''}`; return sh.glow ? '' : plant === 'small' ? ' foliage' : PLANT_STILL.test(t) ? '' : PLANT_TRUNK.test(t) ? ' trunk' : ' foliage'; }
const plantMats = new WeakMap<THREE.Material, Map<string, THREE.Material>>();
function plantMaterial(base: THREE.Material, part: string): THREE.Material {
  let byPart = plantMats.get(base); if (!byPart) { byPart = new Map(); plantMats.set(base, byPart); }
  let m = byPart.get(part); if (!m) { m = base.clone(); m.name = `kit plant ${part}`; byPart.set(part, m); }
  return m;
}
/** W2 sway: a def that is a plant (trees, bushes, flowers) sways in the wind. */
export function isPlantDef(def: { tags: readonly string[]; components?: Record<string, unknown> }): 'tree' | 'small' | null {
  if (def.tags.some((t) => /^(tree|conifer|broadleaf|palm)$/.test(t))) return 'tree';
  return def.components?.plant || def.tags.some((t) => /^(plant|shrub|bush|flower|flowers|reed|grass)$/.test(t)) ? 'small' : null;
}
/** Material class of a shape: shapes of one class merge into one draw. */
// Four bounded emissive classes, so glow does not add one draw per numerical value.
const glowLevel = (value: number | undefined) => value ? Math.min(4, Math.ceil(value * 4)) : 0;
const classOf = (sh: KitShape, v: number, surfaces = false) => v === 2 ? `${sh.material ?? 'paint'}:${glowLevel(sh.glow ?? (sh.material === 'emissive' ? 1 : 0))}${kitSurfaceSuffix(sh, surfaces)}` : (sh.material === 'glass' ? 'glass' : sh.material === 'water' ? 'water' : sh.glow ? 'glow' : 'solid');

/** VOCAB-MECH: which `when` shapes are on for these params/state (a cache key part; '' when the kit has none). */
export function kitWhenKey(args: KitArgs | KitProgramArgs, params: Record<string, unknown> = {}, state?: Record<string, unknown>): string {
  return args.shapes.some((s) => s.when) ? args.shapes.map((s) => (s.when ? (kitWhen(s.when, params, state ?? {}) ? '1' : '0') : '')).join('') : '';
}
export function buildKit(input: unknown, ctx: Pick<MeshCtx, 'materials' | 'tint'> & { params?: Record<string, unknown>; state?: Record<string, unknown>; flameHint?: boolean; smokeFx?: boolean; plant?: 'tree' | 'small' | null }): THREE.Group {
  // K2 hook: the same expansion runs before physics and before mesh construction.
  const args = expandKitProgram(input, ctx.params);
  const root = new THREE.Group();
  const byClass = new Map<string, THREE.BufferGeometry[]>();
  const byRole = new Map<string, KitShape[]>(), smoke: KitShape[] = [], discs: Disc[] = [];
  const color = new THREE.Color(), surfaces = args.v === 2 && args.surfaces === true; // Y1: the kit's surfaces opt-in
  for (const sh of args.shapes) {
    if (sh.when && !kitWhen(sh.when, ctx.params ?? {}, ctx.state ?? {})) continue;
    if (ctx.smokeFx && isSmokeShape(sh)) { smoke.push(sh); continue; } // W2: drawn by the atmosphere's moving smoke
    // W2: a glowing flame-tinted shape (or a warm glow in a def that says fire) is a flame, role or not (fx/flames.ts)
    const role = sh.role ?? (isFlameShape(sh, !!ctx.flameHint, ctx.tint(sh.tint, sh.color ?? ctx.materials.colorOf(sh.material))) ? 'flame' : undefined);
    // E2: each gondola (role `gondola`, pivoted at its own hanger) is a group of its own, so it can hang from the turning wheel
    if (role) { const key = role === 'gondola' && sh.pivot ? `gondola#${sh.pivot.join(',')}` : role, list = byRole.get(key) ?? []; list.push(sh); byRole.set(key, list); continue; }
    color.set(ctx.tint(sh.tint, sh.color ?? ctx.materials.colorOf(sh.material)));
    const k = classOf(sh, args.v, surfaces) + (isSprayShape(sh) ? ' spray' : ctx.plant ? plantPart(sh, ctx.plant) : ''); const list = byClass.get(k) ?? [];
    if (sh.material === 'water' && sh.kind === 'cyl' && !sh.role) discs.push({ x: sh.at[0], y: sh.at[1] + (sh.h ?? 1) / 2 * (sh.scale?.[1] ?? 1), z: sh.at[2], r: (sh.r ?? 0.5) * (sh.scale?.[0] ?? 1) }); list.push(placed(sh, args.round, args.v, color, undefined, args.v === 2 && !!kitClassSurface(k, surfaces))); byClass.set(k, list);
  }
  const matFor = (k: string): THREE.Material => {
    // W2 sway: a plant's trunk and foliage get their own material (never shared with a building), so the wind can bend them
    const part = / (trunk|foliage)$/.exec(k); if (part) return plantMaterial(matFor(k.slice(0, part.index)), part[1]);
    if (k.endsWith(' spray')) return fallingWaterMaterial('spray'); // W2: jets and cascades fall
    if (k.startsWith('water')) return rippleMaterial(matForBase(k)); // W2: fountain water ripples
    return matForBase(k);
  };
  const matForBase = (k: string): THREE.Material => {
    if (args.v !== 2) return k === 'glass' ? ctx.materials.get('glass', undefined, { vertexColors: true }) : k === 'water' ? ctx.materials.get('water', undefined, { vertexColors: true }) : k === 'glow' ? ctx.materials.get('emissive', undefined, { vertexColors: true, glow: 0.8 }) : ctx.materials.get('paint', undefined, { vertexColors: true });
    const [kind, level] = k.split(':');
    return ctx.materials.get(kind as KitShape['material'], undefined, { vertexColors: true, glow: [0, 0.2, 0.4, 0.65, 1][Number(level)], vertexGlow: true, ...(kind === 'metal' ? { finish: 'kit-metal' as const } : {}), surface: kitClassSurface(k, surfaces) });
  };
  for (const [k, geos] of byClass) { const mesh = new THREE.Mesh(merge(geos), matFor(k)); mesh.castShadow = args.v === 2 ? !k.startsWith('glass:') && !k.startsWith('water:') : k === 'solid'; mesh.receiveShadow = true; mesh.name = `kit:${k}`; const sway = / (trunk|foliage)$/.exec(k)?.[1]; if (sway) mesh.userData.edenWindMode = sway === 'trunk' ? 'trunk' : 'crown'; root.add(mesh); }
  // XP8 hook: faces (text, this world's images, seeded glass/mosaic) sit on their shapes; role faces follow the pivot below.
  if (args.v === 2) for (const sh of args.shapes) if (sh.faces && !sh.role && (!sh.when || kitWhen(sh.when, ctx.params ?? {}, ctx.state ?? {}))) for (const face of shapeFaceMeshes(sh, args.round)) root.add(face);
  for (const [key, shapes] of byRole) {
    const role = key.split('#')[0];
    // pivot: explicit on any shape, else the top centre of the role's parts (legs swing from the hip)
    const explicit = shapes.find((s) => s.pivot)?.pivot;
    const pv = explicit ? new THREE.Vector3(...explicit) : (() => { const b = new THREE.Box3(); for (const s of shapes) b.expandByPoint(new THREE.Vector3(...s.at)); const c = b.getCenter(new THREE.Vector3()); return new THREE.Vector3(c.x, b.max.y + (role.startsWith('leg') || role.startsWith('arm') ? (shapes[0].h ?? shapes[0].size?.[1] ?? 0.2) / 2 : 0), c.z); })();
    const pivot = new THREE.Group(); pivot.name = `role:${role}`; pivot.position.copy(pv); pivot.userData.role = role; pivot.userData.rest = pivot.quaternion.clone();
    if (role === 'flame') pivot.userData.flames = flameClusters(shapes, pv); // W2: where the animated fires go
    if (args.v !== 2) {
      const geos = shapes.map((sh) => { color.set(ctx.tint(sh.tint, sh.color ?? ctx.materials.colorOf(sh.material))); return placed(sh, args.round, args.v, color, pv); });
      // W2: a flame glows in its own tint (vertex colour); the plain emissive class glows cream-white whatever the tint
      const mesh = new THREE.Mesh(merge(geos), shapes.some((s) => s.glow) ? ctx.materials.get('emissive', undefined, { vertexColors: true, glow: 0.8, ...(role === 'flame' ? { vertexGlow: true } : {}) }) : ctx.materials.get('paint', undefined, { vertexColors: true }));
      mesh.castShadow = true; pivot.add(mesh);
    } else {
      const classes = new Map<string, THREE.BufferGeometry[]>();
      for (const sh of shapes) { color.set(ctx.tint(sh.tint, sh.color ?? ctx.materials.colorOf(sh.material))); const k = classOf(sh, 2, surfaces) + (isSprayShape(sh) ? ' spray' : ''), list = classes.get(k) ?? []; list.push(placed(sh, args.round, 2, color, pv, !!kitClassSurface(k, surfaces))); classes.set(k, list); }
      for (const [k, geos] of classes) { const mesh = new THREE.Mesh(merge(geos), matFor(k)); mesh.castShadow = !k.startsWith('glass:') && !k.startsWith('water:'); mesh.receiveShadow = true; mesh.name = `kit:${k}`; pivot.add(mesh); }
      if (args.v === 2) for (const sh of shapes) for (const face of shapeFaceMeshes(sh, args.round, pv)) pivot.add(face); // XP8 hook
    }
    root.add(pivot);
  }
  // Soul Actions entry 32: a lock's moving parts (bolt, thumb-turn, key) ride on the door leaf, so they swing with it
  const leafPivot = root.children.find((o) => o.userData.role === 'door');
  if (leafPivot) for (const o of [...root.children]) if (o.userData.role === 'bolt' || o.userData.role === 'thumb' || o.userData.role === 'key') { leafPivot.attach(o); o.userData.restPos = o.position.toArray(); if (o.userData.role === 'key') o.visible = false; }
  root.userData.gait = args.gait;
  if (smoke.length) root.userData.edenSmokeSources = smokeSources(smoke);
  for (const sheet of fallingWaterSheets(discs)) root.add(sheet); // W2: tiered fountains overflow
  return root;
}

/** kitArgs.safeParse is a pure function of a def's `make.args`; every instance of a def passes the same object (L3e: ~1.3 s
 *  of a 4x phone's Eden 2026 arrival was re-validating it per instance, twice). Defs are content-addressed and never edited
 *  in place (the prototype cache above already relies on that), so one result per args object is the same answer. */
const parsedArgs = new WeakMap<object, ReturnType<typeof kitArgs.safeParse>>();
export function parseKitArgs(args: Record<string, unknown>): ReturnType<typeof kitArgs.safeParse> {
  let r = parsedArgs.get(args);
  if (!r) { r = kitArgs.safeParse(args); parsedArgs.set(args, r); }
  return r;
}

registerMesh({
  gen: 'kit/2',
  build(ctx) {
    const parsed = parseKitArgs(ctx.args); if (!parsed.success) return null;
    const key = kitCacheKey(ctx, parsed.data);
    let proto = cache.get(key);
    if (!proto) {
      proto = buildKit(parsed.data, { ...ctx, state: ctx.entity.state ?? {}, flameHint: flameHint(ctx.def), plant: isPlantDef(ctx.def), smokeFx: !ctx.def.components.route && !ctx.def.tags.includes('moving') });
      // lane PERF-MATERIALS: a kit of several static casters casts as one proxy (shadow-proxy.ts); role parts keep their own
      try { addShadowProxy(proto, { generated: true }); } catch (e) { console.warn('kit shadow proxy skipped', e); }
      cache.set(key, proto);
    }
    // clone shares geometry and materials; pivots are cloned so each instance animates on its own
    const obj = proto.clone(true); obj.userData = { ...proto.userData };
    // W2: flame parts burn (fx/flames.ts); not on a building site. A fire lit by hand catches (entry 22); entry 33: only
    // when this viewer saw it out before (a fire already burning when a viewer arrives burns at full); a torch smokes.
    const hand = ctx.def.tags.includes('hand-operated'), lit = ctx.entity.state?.on === true, catchUp = hand && lit && wasOut.get(ctx.entity.id) === true;
    if (hand) wasOut.set(ctx.entity.id, !lit);
    if (ctx.params.condition !== 'construction') mountFlames(obj, ctx.entity.id, catchUp, ctx.def.tags.includes('torch'));
    return obj;
  },
  instanceKey(ctx) { const a = parseKitArgs(ctx.args); return a.success ? kitCacheKey(ctx, a.data) : null; },
});

// K2: $params can change geometry; both prototype and instance identity include numeric values.
function kitCacheKey(ctx: MeshCtx, args: KitProgramArgs): string {
  return ctx.def.hash + ':' + JSON.stringify(Object.fromEntries(Object.entries(ctx.params).filter(([, v]) => typeof v === 'number' || typeof v === 'string' && /^#/.test(v)).sort(([a], [b]) => a.localeCompare(b)))) + ':' + kitWhenKey(args, ctx.params, ctx.entity.state);
}
