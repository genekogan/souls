// Y1 / XP7: god kit surfaces. Offline mesher/material/shader-text tests; no renderer, network or test server.
import { rippleMaterial } from '../fx/water.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { kitArgs, materialEnum, KIT_PATTERNS, type KitProgramArgs } from '@souls/generators';
import { CORE_KIT, WorldModel } from '@souls/world-compiler';
import { buildKit } from './kit.mesh.ts';
import { MaterialLib } from './materials.ts';
import { KitSurfaceMaterial, KIT_PATTERN_ID, MATERIAL_SURFACE, kitSurface } from './kit-surfaces.ts';
import { applyWorldRealism } from '../WorldEdenRealism.ts';

type M = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
const kit = (s: Record<string, unknown>[], v = 2, extra: Record<string, unknown> = {}) => kitArgs.parse({ v, round: 0, ...extra, shapes: s.map(sh => ({ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 1], ...sh })) });
const draw = (a: KitProgramArgs, lib = new MaterialLib()) => buildKit(a, { materials: lib, tint: (_k, fallback) => fallback, params: {}, state: {} });
const meshes = (o: THREE.Object3D) => { const m: M[] = []; o.traverse(n => { if ((n as THREE.Mesh).isMesh) m.push(n as M); }); return m; };
const byName = (o: THREE.Object3D) => Object.fromEntries(meshes(o).map(m => [m.name, m]));
const surfaced = (m: M) => m.material instanceof KitSurfaceMaterial;
const compile = (material: THREE.Material) => {
  const lib = THREE.ShaderLib.standard;
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) } as unknown as Parameters<THREE.Material['onBeforeCompile']>[0];
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer); return shader;
};
/** A tiny GLSL preprocessor for #ifdef/#ifndef/#else/#endif with one define set or not (enough for these blocks). */
function preprocess(src: string, defined: Set<string>) {
  const out: string[] = [], stack: boolean[] = [];
  for (const line of src.split('\n')) {
    const t = line.trim(), on = stack.every(Boolean);
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^#ifdef\s+(\w+)/))) stack.push(defined.has(m[1]));
    else if ((m = t.match(/^#ifndef\s+(\w+)/))) stack.push(!defined.has(m[1]));
    else if (/^#if\b/.test(t)) stack.push(true);
    else if (/^#else\b/.test(t)) stack.push(!stack.pop());
    else if (/^#endif\b/.test(t)) { assert.ok(stack.length, 'unbalanced #endif'); stack.pop(); }
    else if (on) out.push(line);
  }
  assert.equal(stack.length, 0, 'unbalanced #if');
  return out.join('\n');
}

test('contract-1 kits and every library kit draw exactly as before: no surface material, no surface attribute', () => {
  for (const material of ['stone', 'wood', 'tile', 'fabric', undefined]) {
    for (const m of meshes(draw(kit([{ material }, { kind: 'cyl', at: [2, 1, 0], r: 0.4, h: 2, material }], 1)))) {
      assert.equal(surfaced(m), false); assert.equal(m.geometry.attributes.edenSurf, undefined);
      assert.deepEqual(Object.keys(m.geometry.attributes).sort(), ['color', 'normal', 'position']);
    }
  }
  const model = new WorldModel({ constants: { ground: 'land' }, seed: 'surfaces' });
  let kits = 0;
  for (const raw of CORE_KIT) {
    const d = model.defineDef(raw, 'core', 0);
    if (d.make.kind !== 'gen' || d.make.gen !== 'kit/2') continue;
    const parsed = kitArgs.safeParse(d.make.args); if (!parsed.success) continue;
    kits++;
    for (const m of meshes(draw(parsed.data))) { assert.equal(surfaced(m), false, d.name); assert.equal(m.geometry.attributes.edenSurf, undefined, d.name); }
  }
  assert.ok(kits > 50, `library kits checked: ${kits}`);
});

test('contract-2 kits without surfaces: true draw exactly as before; only an explicit pattern opts a shape in', () => {
  const shapes = [undefined, ...materialEnum.options].flatMap((material, i) => [{ material, at: [i * 2, 0.5, 0] }, { kind: 'cyl', size: undefined, material, at: [i * 2, 2, 0], r: 0.4, h: 1 }, { material, pattern: 'none', at: [i * 2, 4, 0] }]);
  const lib = new MaterialLib(), plain = draw(kit(shapes), lib);
  for (const m of meshes(plain)) {
    assert.equal(surfaced(m), false, m.name); assert.equal(m.geometry.attributes.edenSurf, undefined, m.name);
    assert.deepEqual(Object.keys(m.geometry.attributes).sort(), ['color', 'normal', 'position'], m.name);
    // The very material the pre-surface mesher asked for (same MaterialLib key, no surface part).
    const [, kind, level] = m.name.split(':');
    const asked = lib.get(kind as never, undefined, { vertexColors: true, glow: [0, 0.2, 0.4, 0.65, 1][Number(level)], vertexGlow: true, ...(kind === 'metal' ? { finish: 'kit-metal' as const } : {}) });
    assert.equal(m.material, kind === 'water' ? rippleMaterial(asked) : asked, m.name); // W2: water draws with its rippling copy
  }
  assert.deepEqual(meshes(plain).map(m => m.name).sort(), meshes(draw(kit(shapes, 2, { surfaces: false }))).map(m => m.name).sort());
  const o = byName(draw(kit([{ material: 'stone' }, { material: 'stone', pattern: 'ashlar', at: [2, 0.5, 0] }, { material: 'stone', pattern: 'none', at: [4, 0.5, 0] }, { pattern: 'stripes', at: [6, 0.5, 0] }])));
  assert.deepEqual(Object.keys(o).sort(), ['kit:paint:0:stripes', 'kit:stone:0', 'kit:stone:0:ashlar']);
  assert.equal(surfaced(o['kit:stone:0']), false); assert.equal(o['kit:stone:0'].geometry.attributes.position.count, 2 * 36, 'pattern none joins the flat draw');
  assert.deepEqual(o['kit:stone:0:ashlar'].material.userData.kitSurface, { cls: 'stone', pattern: 2 }); assert.ok(o['kit:paint:0:stripes'].geometry.attributes.edenSurf);
});

test('contract-2 kits with surfaces: true take the realism class of each material; paint, plastic, glass, water and glow stay flat', () => {
  const o = byName(draw(kit([
    { material: 'stone' }, { material: 'wood', at: [2, 0.5, 0] }, { material: 'tile', at: [4, 0.5, 0] }, { material: 'fabric', at: [6, 0.5, 0] },
    { at: [8, 0.5, 0] }, { material: 'plastic', at: [10, 0.5, 0] }, { material: 'glass', at: [12, 0.5, 0] }, { material: 'stone', glow: 0.3, at: [14, 0.5, 0] },
  ], 2, { surfaces: true })));
  assert.deepEqual(Object.keys(o).sort(), ['kit:fabric:0', 'kit:glass:0', 'kit:paint:0', 'kit:plastic:0', 'kit:stone:0', 'kit:stone:2', 'kit:tile:0', 'kit:wood:0']);
  for (const [name, cls] of [['kit:stone:0', 'stone'], ['kit:wood:0', 'wood'], ['kit:tile:0', 'roof'], ['kit:fabric:0', 'cloth']] as const) {
    assert.ok(surfaced(o[name]), name); assert.deepEqual(o[name].material.userData.kitSurface, { cls, pattern: 0 });
    const a = o[name].geometry.attributes.edenSurf; assert.equal(a.itemSize, 4); assert.equal(a.count, o[name].geometry.attributes.position.count);
  }
  for (const name of ['kit:paint:0', 'kit:plastic:0', 'kit:glass:0', 'kit:stone:2']) { assert.equal(surfaced(o[name]), false, name); assert.equal(o[name].geometry.attributes.edenSurf, undefined, name); }
  // Unchanged finishes: the surface keeps the material's declared roughness/metalness (kit metal included).
  assert.equal(o['kit:stone:0'].material.roughness, 0.92); assert.equal(o['kit:stone:2'].material.emissiveIntensity, 0.4);
  const metal = meshes(draw(kit([{ material: 'metal' }], 2, { surfaces: true })))[0].material; assert.ok(metal instanceof KitSurfaceMaterial); assert.equal(metal.metalness, 0.25); assert.equal(metal.roughness, 0.32);
});

test('patterns draw apart only when they change the surface; none flattens a material that has a class', () => {
  const o = byName(draw(kit([
    { material: 'stone' }, { material: 'stone', pattern: 'marble', at: [2, 0.5, 0] }, { material: 'stone', pattern: 'ashlar', at: [4, 0.5, 0] },
    { material: 'stone', pattern: 'none', at: [6, 0.5, 0] }, { pattern: 'none', at: [8, 0.5, 0] }, { at: [10, 0.5, 0] }, { pattern: 'stripes', at: [12, 0.5, 0] },
    { material: 'wood', pattern: 'planks', at: [14, 0.5, 0] }, { material: 'tile', pattern: 'shingles', at: [16, 0.5, 0] },
  ], 2, { surfaces: true })));
  assert.deepEqual(Object.keys(o).sort(), ['kit:paint:0', 'kit:paint:0:stripes', 'kit:stone:0', 'kit:stone:0:ashlar', 'kit:stone:0:marble', 'kit:stone:0:none', 'kit:tile:0:shingles', 'kit:wood:0:planks']);
  assert.equal(o['kit:paint:0'].geometry.attributes.position.count, 2 * 36, 'pattern none on paint joins the plain paint draw');
  assert.deepEqual(o['kit:stone:0:marble'].material.userData.kitSurface, { cls: 'stone', pattern: 1 });
  assert.deepEqual(o['kit:paint:0:stripes'].material.userData.kitSurface, { cls: 'generic', pattern: 5 });
  assert.deepEqual(o['kit:wood:0:planks'].material.userData.kitSurface, { cls: 'wood', pattern: 3 });
  assert.equal(surfaced(o['kit:stone:0:none']), false); assert.equal(o['kit:stone:0:none'].geometry.attributes.edenSurf, undefined);
  for (const p of KIT_PATTERNS) if (p !== 'none') assert.ok(KIT_PATTERN_ID[p] > 0, p);
  for (const material of Object.keys(MATERIAL_SURFACE)) { assert.ok(kitSurface(material, 0, undefined, true), material); assert.equal(kitSurface(material, 0), null, material); }
});

test('surface coordinates are shape-local metres: they follow yaw, pitch, scale and mirrors, and x is the long side', () => {
  const at: [number, number, number] = [3, 1, -2];
  const local = (sh: Record<string, unknown>) => meshes(draw(kit([{ material: 'stone', at, ...sh }], 2, { surfaces: true })))[0].geometry.attributes.edenSurf as THREE.BufferAttribute;
  const plain = local({ size: [2, 1, 1] }), turned = local({ size: [2, 1, 1], yaw: 0.7, pitch: 0.4 });
  assert.deepEqual([...turned.array], [...plain.array], 'rotation is not baked into the surface coordinates');
  const xs = Array.from({ length: plain.count }, (_, i) => plain.getX(i));
  assert.ok(Math.abs(Math.max(...xs) - 1) < 1e-6 && Math.abs(Math.min(...xs) + 1) < 1e-6);
  const long = local({ size: [1, 1, 3] }), lx = Array.from({ length: long.count }, (_, i) => long.getX(i));
  assert.ok(Math.abs(Math.max(...lx) - 1.5) < 1e-6, 'a box longer in z is drawn with x along its length');
  const scaled = local({ size: [2, 1, 1], scale: [-2, 1, 1] }), sx = Array.from({ length: scaled.count }, (_, i) => scaled.getX(i));
  assert.ok(Math.abs(Math.max(...sx) - 2) < 1e-6 && Math.abs(Math.min(...sx) + 2) < 1e-6, 'scale (including a mirror) is applied');
  // One word per shape: seed in [0, .99) and, around round shapes, an even stripe count >= 8.
  const word = (a: THREE.BufferAttribute) => a.getW(0);
  assert.ok(word(plain) >= 0 && word(plain) < 0.99);
  for (let i = 1; i < plain.count; i++) assert.equal(plain.getW(i), word(plain));
  const cone = local({ kind: 'cone', size: undefined, r: 3, h: 2 }), ring = Math.floor(word(cone) + 1e-3);
  assert.ok(ring >= 8 && ring % 2 === 0, `ring ${ring}`); assert.equal(ring, 2 * Math.round(Math.PI * 3 / 0.4));
  assert.notEqual(word(local({ size: [2, 1, 1] })), word(local({ at: [0, 2, 0], size: [2, 1, 1] })), 'shapes differ by seed');
});

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** Per surfaced triangle: the god shader's face normal (WorldEdenRealism: n = normalize(cross(dFdx L, dFdy L)) oriented
 *  by sign(dot(cross(dFdx W, dFdy W), N))). L and W are affine in screen space on one triangle, so both derivative
 *  crosses are the edge crosses times one shared Jacobian, whose sign cancels. Also the least-squares local->kit map. */
function shaderFaces(m: M) {
  const P = m.geometry.attributes.position, Nn = m.geometry.attributes.normal, S = m.geometry.attributes.edenSurf as THREE.BufferAttribute;
  const W = (i: number): V3 => [P.getX(i), P.getY(i), P.getZ(i)], L = (i: number): V3 => [S.getX(i), S.getY(i), S.getZ(i)];
  const mean = (f: (i: number) => V3) => { const s: V3 = [0, 0, 0]; for (let i = 0; i < P.count; i++) f(i).forEach((v, k) => { s[k] += v / P.count; }); return s; };
  const lm = mean(L), wm = mean(W), wl = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0), ll = wl.clone();
  for (let i = 0; i < P.count; i++) {
    const l = sub(L(i), lm), w = sub(W(i), wm);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { wl.elements[c * 3 + r] += w[r] * l[c]; ll.elements[c * 3 + r] += l[r] * l[c]; }
  }
  const A = wl.multiply(ll.invert()), faces: { n: V3; N: V3; kit: V3 }[] = [];
  for (let i = 0; i < P.count; i += 3) {
    const cl = cross3(sub(L(i + 1), L(i)), sub(L(i + 2), L(i))), cw = cross3(sub(W(i + 1), W(i)), sub(W(i + 2), W(i)));
    if (Math.hypot(...cw) < 1e-9) continue;
    const N = unit([0, 1, 2].reduce<V3>((s, k) => [s[0] + Nn.getX(i + k), s[1] + Nn.getY(i + k), s[2] + Nn.getZ(i + k)], [0, 0, 0]));
    const n = unit(cl).map(v => v * Math.sign(dot3(cw, N))) as V3, kit = new THREE.Vector3(...n).applyMatrix3(A).toArray() as V3;
    faces.push({ n, N, kit });
  }
  return { faces, det: A.determinant() };
}

test('the shader face normal points out of every surfaced triangle: long-z shapes, wedges, mirrors and rotations', () => {
  const cases: Record<string, unknown>[] = [
    { size: [3, 1, 1] }, { size: [1, 1, 3] }, { kind: 'wedge', size: [2, 1, 4] }, { kind: 'wedge', size: [4, 1, 2] },
    { size: [1, 1, 3], scale: [-1, 1, 1] }, { size: [1, 1, 3], scale: [1, 1, -2] }, { kind: 'wedge', size: [2, 1, 4], scale: [-1, 1, 1], yaw: 1.2 },
    { size: [1, 1, 3], yaw: 0.7, pitch: 0.4, roll: 0.3 }, { size: [3, 1, 1], yaw: -2.1, pitch: -0.5 }, { kind: 'rbox', size: [1, 0.5, 2.5], round: 0.1 },
    { kind: 'cyl', size: undefined, r: 0.5, h: 2 }, { kind: 'cone', size: undefined, r: 2, h: 1, pitch: 0.3 }, { kind: 'sphere', size: undefined, r: 1 },
    { kind: 'extrude', size: undefined, polygon: [[0, 0], [0.6, 0], [0.6, 2.5], [0, 2.5]], h: 0.3 },
  ];
  for (const sh of cases) {
    const label = JSON.stringify(sh), { faces, det } = shaderFaces(meshes(draw(kit([{ material: 'stone', pattern: 'ashlar', ...sh }])))[0]);
    assert.ok(det > 0, `${label}: the shape-local frame is a rotation of the kit frame (det ${det.toFixed(3)})`);
    assert.ok(faces.length >= 8, label);
    for (const f of faces) assert.ok(dot3(f.kit, f.N) > 0.5, `${label}: shader normal ${f.n.map(v => v.toFixed(2))} points into the shape (geometry normal ${f.N.map(v => v.toFixed(2))})`);
  }
  // The class looks read n.y: a top face reads up and a ridge along z keeps its slopes facing up.
  const ys = (sh: Record<string, unknown>) => shaderFaces(meshes(draw(kit([{ material: 'tile', ...sh }], 2, { surfaces: true })))[0]).faces.map(f => [f.N[1], f.n[1]]);
  for (const [N, n] of ys({ size: [1, 1, 3] })) if (N > 0.99) assert.ok(n > 0.99, `top face of a box longer in z reads n.y ${n}`);
  const slope = ys({ kind: 'wedge', size: [2, 1, 4] }).filter(([N]) => N > 0.5 && N < 0.99);
  assert.ok(slope.length > 0 && slope.every(([N, n]) => Math.abs(n - N) < 1e-3), `z-ridged wedge slope reads up: ${JSON.stringify(slope)}`);
});

test('moving roles keep their surfaces; clones made by looks and lights keep the shader', () => {
  const o = draw(kit([{ kind: 'cyl', size: undefined, r: 0.5, h: 0.2, material: 'wood', pattern: 'planks', role: 'wheel' }, { kind: 'box', material: 'stone', role: 'door', at: [2, 1, 0], size: [1, 2, 0.1] }], 2, { surfaces: true }));
  const ms = meshes(o); assert.equal(ms.length, 2);
  for (const m of ms) { assert.ok(surfaced(m)); assert.ok(m.geometry.attributes.edenSurf); assert.ok(m.parent?.name.startsWith('role:')); }
  const clone = ms[0].material.clone();
  assert.ok(clone instanceof KitSurfaceMaterial); assert.deepEqual(clone.userData.kitSurface, ms[0].material.userData.kitSurface);
  assert.equal(clone.customProgramCacheKey(), ms[0].material.customProgramCacheKey());
  assert.notEqual(new THREE.MeshStandardMaterial().customProgramCacheKey(), clone.customProgramCacheKey());
});

test('the god program binds no Eden textures, reads the surface attribute and carries class and pattern as uniforms', () => {
  const marble = meshes(draw(kit([{ material: 'stone', pattern: 'marble' }])))[0].material, shader = compile(marble);
  assert.match(shader.vertexShader, /^#define EDEN_GOD_SURFACE\n/); assert.match(shader.fragmentShader, /^#define EDEN_GOD_SURFACE\n/);
  assert.equal((shader.uniforms.edenPattern as THREE.IUniform).value, 1);
  assert.equal(((shader.uniforms.edenRealism as THREE.IUniform).value as THREE.Vector4).x, 9);
  const god = new Set(['EDEN_GOD_SURFACE']), v = preprocess(shader.vertexShader, god), f = preprocess(shader.fragmentShader, god);
  assert.match(v, /attribute vec4 edenSurf;/); assert.match(v, /vEdenL=edenSurf\.xyz/); assert.match(v, /vEdenH=\.8;/, 'no base fade from the kit frame');
  assert.doesNotMatch(f, /texture2D\(eden/, 'no Eden pattern texture is sampled in the god variant');
  assert.match(f, /if\(edenPattern>\.5\)/); assert.match(f, /roughnessFactor=clamp\(roughnessFactor\*edenRough/);
  // The native Eden realism variant is unchanged by the god blocks: textures still sampled, no surface attribute.
  const native = new THREE.MeshStandardMaterial({ color: '#888888' }), mesh = new THREE.Mesh(new THREE.BoxGeometry(), native); mesh.name = 'stone plinth';
  const root = new THREE.Group(); root.add(mesh); assert.equal(applyWorldRealism(root), 1);
  const ns = compile(native), nv = preprocess(ns.vertexShader, new Set()), nf = preprocess(ns.fragmentShader, new Set());
  assert.doesNotMatch(ns.fragmentShader, /#define EDEN_GOD_SURFACE/); assert.doesNotMatch(nv, /edenSurf/); assert.doesNotMatch(nf, /edenPattern|vEdenL/);
  assert.match(nf, /texture2D\(edenPatA/); assert.notEqual(native.customProgramCacheKey(), marble.customProgramCacheKey());
});

test('a pattern skips the class work, and the god program carries no terrain, flower, skin or water branch', () => {
  const god = preprocess(compile(meshes(draw(kit([{ material: 'stone', pattern: 'ashlar' }])))[0].material).fragmentShader, new Set(['EDEN_GOD_SURFACE']));
  const native = new THREE.MeshStandardMaterial(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), native); mesh.name = 'stone plinth';
  const root = new THREE.Group(); root.add(mesh); applyWorldRealism(root);
  const nf = preprocess(compile(native).fragmentShader, new Set());
  for (const branch of ['if(cls<1.5){', 'else if(cls<2.5){', 'else if(cls<5.5){', 'else if(cls<12.5){', 'else if(cls>14.5){']) {
    assert.ok(!god.includes(branch), `god program has no ${branch}`); assert.ok(nf.includes(branch), `native keeps ${branch}`);
  }
  // The pattern block heads the class chain: `if(edenPattern>.5){…}else if(cls<3.5){…}…`.
  const head = god.indexOf('if(edenPattern>.5){'), soil = god.indexOf('if(cls<3.5){');
  assert.ok(head > 0 && soil > head, 'pattern block precedes the class chain');
  assert.match(god.slice(head, soil).replace(/\/\/[^\n]*/g, ''), /}else\s*$/, 'the class chain is the else of the pattern block');
});

test('?surfaces=0 turns every god surface off', async () => {
  const saved = (globalThis as { location?: unknown }).location;
  (globalThis as { location?: unknown }).location = { search: '?surfaces=0' };
  try {
    const fresh = './kit-surfaces.ts?surfaces-off', off = await import(fresh) as typeof import('./kit-surfaces.ts'); // a second module instance
    assert.equal(off.kitSurface('stone', 0, 'marble'), null); assert.equal(off.kitSurface('wood', 0, undefined, true), null);
    assert.equal(off.kitSurfaceSuffix({ kind: 'box', at: [0, 0, 0], material: 'stone', pattern: 'marble' }), '');
  } finally { (globalThis as { location?: unknown }).location = saved; }
});
