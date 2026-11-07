// Offline mesher tests; no renderer, network or test server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { kitArgs, kitPhysics, KIT_PRIMITIVES, type KitProgramArgs } from '@souls/generators';
import { buildKit, parseKitArgs } from './kit.mesh.ts';
import { MaterialLib } from './materials.ts';
import { animate, bindMotionModel, setClockNight, quantizeGlow } from './motion.ts';
import { WorldModel, applyBatch, defSchema, type Entity, type StoredDef } from '@souls/world-compiler';
import examples from '../../../../tools/god-skill/scripts/gallery-language-examples.json' with { type: 'json' };

const square = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
const hole = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const shapes = (s: Record<string, unknown>[], v = 2, extra = {}) => kitArgs.parse({ v, round: 0, shapes: s.map(sh => ({ at: [0, 0, 0], ...sh })), ...extra });
const draw = (a: KitProgramArgs, params: Record<string, unknown> = {}) => buildKit(a, { materials: new MaterialLib(), tint: (key, fallback) => key === 'test' ? '#00ff00' : fallback, params, state: {} });
const meshes = (o: THREE.Object3D) => { const m: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = []; o.traverse(n => { if ((n as THREE.Mesh).isMesh) m.push(n as never); }); return m; };
const tris = (o: THREE.Object3D) => meshes(o).reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0);
function signature(a: KitProgramArgs, params = {}) {
  const o = draw(a, params), hash = createHash('sha256'); o.updateMatrixWorld(true);
  o.traverse(n => { hash.update(JSON.stringify({ name: n.name, matrix: n.matrixWorld.elements, gait: n.userData.gait })); });
  for (const m of meshes(o)) {
    for (const k of ['position', 'normal', 'color']) hash.update(Buffer.from(m.geometry.attributes[k].array.buffer));
    hash.update(JSON.stringify({ roughness: m.material.roughness, metalness: m.material.metalness, glow: m.material.emissiveIntensity, opacity: m.material.opacity }));
  }
  return hash.digest('hex');
}

test('arc opens the first v2 dome, sphere, cylinder, cone and arch; legacy arcs keep their look', () => {
  for (const sh of [{ kind: 'lathe', profile: [[2, 0], [1.8, 1], [0, 2]] }, { kind: 'sphere' }, { kind: 'cyl' }, { kind: 'cone' }, { kind: 'arch' }]) {
    const arc = sh.kind === 'arch' ? Math.PI * 0.7 : Math.PI * 1.7;
    assert.notEqual(signature(shapes([sh])), signature(shapes([{ ...sh, arc }])));
    assert.equal(signature(shapes([sh], 1)), signature(shapes([{ ...sh, arc }], 1)));
  }
  const args = shapes([{ kind: 'lathe', profile: [[2, 0], [1.8, 1], [0, 2]], arc: Math.PI * 1.8, segments: 20 }]);
  const positions = meshes(draw(args))[0].geometry.attributes.position;
  // Three's lathe begins on +z, increases toward +x: the omitted final wedge has x<0,z>0.
  for (let i = 0; i < positions.count; i++) if (Math.hypot(positions.getX(i), positions.getZ(i)) > 0.1) {
    const phi = (Math.atan2(positions.getX(i), positions.getZ(i)) + Math.PI * 2) % (Math.PI * 2);
    assert.ok(phi <= Math.PI * 1.8 + 1e-6);
  }
});

test('four glow classes preserve per-vertex colour, including mixed finishes on a moving role', () => {
  const a = shapes([0.1, 0.3, 0.6, 0.9].map((glow, i) => ({ kind: 'sphere', at: [i * 2, 0, 0], color: '#e04020', glow })));
  const ms = meshes(draw(a)); assert.equal(ms.length, 4); assert.deepEqual(ms.map(m => m.material.emissiveIntensity), [0.2, 0.4, 0.65, 1]);
  const shader = { fragmentShader: THREE.ShaderLib.standard.fragmentShader } as Parameters<THREE.Material['onBeforeCompile']>[0];
  ms[0].material.onBeforeCompile(shader, {} as THREE.WebGLRenderer); assert.match(shader.fragmentShader, /totalEmissiveRadiance \*= vColor\.rgb;/);
  assert.equal(ms[0].material.emissive.getHexString(), 'ffffff'); assert.ok(ms[0].geometry.attributes.color.getX(0) > ms[0].geometry.attributes.color.getY(0));
  const mixed = meshes(draw(shapes([{ kind: 'box', material: 'metal', role: 'head' }, { kind: 'sphere', material: 'glass', glow: 0.3, role: 'head' }])));
  assert.equal(mixed.length, 2); assert.equal(mixed[0].material.metalness, 0.25); assert.equal(mixed[1].material.transparent, true); assert.equal(mixed[1].material.emissiveIntensity, 0.4);
  assert.equal(meshes(draw(shapes([{ kind: 'sphere', glow: 0.1 }, { kind: 'sphere', glow: 1 }], 1))).length, 1);
});

test('kit metal retains diffuse lighting without an environment map; global legacy metal stays unchanged', () => {
  const lib = new MaterialLib(), material = meshes(draw(shapes([{ kind: 'box', material: 'metal' }])))[0].material;
  assert.equal(material.envMap, null); assert.ok(material.metalness <= 0.3); assert.ok(material.roughness < 0.6);
  assert.equal((lib.get('metal') as THREE.MeshStandardMaterial).metalness, 0.8);
  assert.equal(meshes(draw(shapes([{ kind: 'box', material: 'metal' }], 1)))[0].material.metalness, 0);
});

test('night motion retains the four glow levels and state/look clones retain the colour shader', () => {
  const obj = draw(shapes([0.1, 0.3, 0.6, 0.9].map(glow => ({ kind: 'sphere', glow, color: '#ee3300' }))));
  const e = { id: 'lamp', state: {} } as Entity, d = { components: { light: {} } } as StoredDef;
  animate(obj, e, d, 1_000_000_000, { y: 0, yaw: 0 });
  const levels = meshes(obj).map(m => m.material.emissiveIntensity);
  // lane PERF-MATERIALS: a glow level is a shared material per ~1% step (motion.ts quantizeGlow), so ratios hold to a step
  assert.ok(Math.abs(levels[0] / levels[3] - 0.2) < 0.02, levels.join()); assert.ok(Math.abs(levels[2] / levels[3] - 0.65) < 0.02, levels.join());
  e.state!.on = false; animate(obj, e, d, 1_000_000_001, { y: 0, yaw: 0 });
  for (const m of meshes(obj)) {
    assert.equal(m.material.emissiveIntensity, 0);
    const shader = { fragmentShader: THREE.ShaderLib.standard.fragmentShader } as Parameters<THREE.Material['onBeforeCompile']>[0];
    m.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer); assert.match(shader.fragmentShader, /totalEmissiveRadiance \*= vColor\.rgb;/);
  }
  e.state!.on = true; animate(obj, e, d, 1_000_000_002, { y: 0, yaw: 0 });
  assert.ok(Math.abs(meshes(obj)[0].material.emissiveIntensity / meshes(obj)[3].material.emissiveIntensity - 0.2) < 0.02);
});

test('slit dome, one-shape rose and upright curved roof are admitted on their first define', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'kit-examples' });
  for (const raw of examples) {
    const def = defSchema.parse({ ...raw, name: raw.name.replace(/^core-/, 'test-') });
    const r = applyBatch(w, { ops: [{ op: 'define', def }] }, 'god', 1); assert.equal(r.result.accepted, true, JSON.stringify(r.result));
    const a = kitArgs.parse(raw.make.args), obj = draw(a);
    assert.ok(tris(obj) <= kitPhysics(a).tris, raw.name);
    if (raw.name === 'core-curved-roof') { const b = new THREE.Box3().setFromObject(obj); assert.ok(b.max.y > 4.49 && b.min.y > 2.84); assert.equal(a.shapes.length, 1); }
    console.log(`${raw.name}: ${a.shapes.length} shapes, ${tris(obj)} triangles, ${meshes(obj).length} draws`);
  }
  const invalid = defSchema.parse({ ...examples[0], name: 'test-unused-field', make: { kind: 'gen', gen: 'kit/2', args: { v: 2, shapes: [{ kind: 'sphere', at: [0, 0, 0], h: 2 }] } } });
  const r = applyBatch(w, { ops: [{ op: 'define', def: invalid }] }, 'god', 2);
  assert.equal(r.result.accepted, false); if (!r.result.accepted) { assert.equal(r.result.failures[0].field, 'make.args.shapes.0.h'); assert.match(r.result.failures[0].fix!, /remove h/); }
});

test('one holed extrude has open ray paths, both windings, and conservative solid box physics', () => {
  for (const reverse of [false, true]) {
    const a = shapes([{ kind: 'extrude', polygon: reverse ? [...square].reverse() : square, holes: [reverse ? [...hole].reverse() : hole], h: 0.4 }]);
    const o = draw(a); o.updateMatrixWorld(true);
    const ray = (x: number) => new THREE.Raycaster(new THREE.Vector3(x, 2, 0), new THREE.Vector3(0, -1, 0)).intersectObject(o, true);
    assert.equal(ray(0).length, 0); assert.ok(ray(1.5).length > 0); assert.equal(meshes(o).length, 1);
    assert.ok(tris(o) <= kitPhysics(a).tris); assert.equal(kitPhysics(a).colliders.length, 1);
  }
});

test('loft caps face out, taper between outlines, and a swept profile makes one curved roof shape', () => {
  const a = shapes([{ kind: 'loft', polygon: square, top: hole, h: 3 }]), o = draw(a); o.updateMatrixWorld(true);
  for (const [y, dir] of [[4, -1], [-1, 1]]) assert.ok(new THREE.Raycaster(new THREE.Vector3(0, y, 0), new THREE.Vector3(0, dir, 0)).intersectObject(o, true).length > 0);
  const roof = shapes([{ kind: 'sweep', path: [[0, 0, -3], [0, 0, 3]], profile: [[-3, 0], [-2, 0.8], [-1, 1.3], [0, 1.5], [1, 1.3], [2, 0.8], [3, 0], [3, -0.15], [2, 0.65], [1, 1.15], [0, 1.35], [-1, 1.15], [-2, 0.65], [-3, -0.15]], material: 'tile' }]);
  assert.equal(roof.shapes.length, 1); assert.equal(meshes(draw(roof)).length, 1); assert.ok(tris(draw(roof)) <= kitPhysics(roof).tris);
});

test('every rendered triangle is covered by v2 estimates across primitives, bevels and segment counts', () => {
  for (const kind of KIT_PRIMITIVES) for (const seg of [undefined, 6, 8]) for (const round of [0, 0.03]) {
    const sh: Record<string, unknown> = { kind, round, segments: seg, polygon: square, top: hole, profile: kind === 'sweep' ? hole : [[0.3, 0], [0.5, 0.5], [0.2, 1]], path: [[0, 0, 0], [1, 1, 2], [2, 0, 4]], holes: [hole] };
    const tryArgs = shapesForKind(sh); const parsed = kitArgs.safeParse({ v: 2, round, shapes: [tryArgs] });
    if (kind === 'rbox' && round === 0 && seg !== undefined) { assert.equal(parsed.success, false); if (!parsed.success) assert.match(parsed.error.issues[0].message, /segments.*fix:/); continue; }
    assert.ok(parsed.success, JSON.stringify(parsed.error)); if (!parsed.success) continue;
    assert.ok(tris(draw(parsed.data)) <= kitPhysics(parsed.data).tris, `${kind}, segments=${seg}, round=${round}: mesh ${tris(draw(parsed.data))} > estimate ${kitPhysics(parsed.data).tris}`);
  }
});

const allowed: Record<string, string[]> = { box: ['size', 'round'], rbox: ['size', 'round', 'segments'], wedge: ['size', 'round'], cyl: ['r', 'r2', 'h', 'segments', 'arc'], cone: ['r', 'h', 'segments', 'arc'], capsule: ['r', 'h', 'segments'], sphere: ['r', 'segments', 'arc'], ring: ['r', 'r2', 'segments', 'arc'], torus: ['r', 'r2', 'segments', 'arc'], arch: ['size', 'segments', 'arc'], lathe: ['profile', 'segments', 'arc'], extrude: ['polygon', 'holes', 'h', 'round'], loft: ['polygon', 'top', 'h'], sweep: ['path', 'profile'] };
function shapesForKind(sh: Record<string, unknown>) { return Object.fromEntries(Object.entries({ at: [0, 0, 0], ...sh }).filter(([k]) => ['kind', 'at'].includes(k) || allowed[String(sh.kind)].includes(k))); }

test('seeded field fuzz: each geometry field changes the mesh for its supported kinds or is refused with field/fix', () => {
  const fields: Record<string, unknown> = { size: [2, 3, 0.5], r: 0.7, r2: 0.2, h: 1.3, round: 0.025, segments: 8, profile: [[0.2, 0], [0.7, 1], [0.3, 2]], polygon: [[-3, -2], [2, -2], [2, 2], [-3, 2]], top: hole.map(p => p.map(n => n * 0.6)), holes: [hole], path: [[0, 0, 0], [1, 1, 2]], arc: 2.3 };
  let seed = 317;
  for (const kind of KIT_PRIMITIVES) for (const [field, value] of Object.entries(fields)) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const base = shapesForKind({ kind, polygon: square, top: hole, ...(kind === 'sweep' ? { profile: hole } : {}), segments: 6 });
    const next = { ...base, [field]: value, at: [seed % 3, 0, 0] };
    if (kind === 'sweep' && field === 'profile') next.profile = square;
    // K2 adds polygonal arches; their polygon replaces the round arch's segment control.
    if (kind === 'arch' && field === 'polygon') { delete base.segments; delete next.segments; }
    const parsed = kitArgs.safeParse({ v: 2, round: 0, shapes: [next] });
    if (!parsed.success) { assert.ok(parsed.error.issues.some(i => i.path.at(-1) === field && /fix:/.test(i.message)), `${kind}.${field}: ${parsed.error}`); continue; }
    assert.notEqual(signature(shapes([{ ...base, at: next.at }])), signature(parsed.data), `${kind}.${field}`);
  }
});

test('common shape fields alter geometry, material, visibility, animation or physical behavior', () => {
  const base = { kind: 'box', size: [1, 2, 3] };
  for (const extra of [{ at: [1, 0, 0] }, { scale: [2, 1, 1] }, { yaw: 0.2 }, { pitch: 0.2 }, { roll: 0.2 }, { color: '#ff0000' }, { material: 'metal' }, { tint: 'test' }, { glow: 0.5 }, { role: 'head' }, { when: 'variant=other' }]) assert.notEqual(signature(shapes([base])), signature(shapes([{ ...base, ...extra }])));
  const role = { ...base, role: 'head' }; assert.notEqual(signature(shapes([role])), signature(shapes([{ ...role, pivot: [1, 2, 0] }])));
  assert.equal(kitPhysics(shapes([{ ...base, collide: false }])).colliders.length, 0);
  assert.equal(kitPhysics(shapes([{ ...base, collide: true }])).colliders.length, 1);
});

test('rotated/scaled off-centre outlines and spline overshoot stay inside conservative colliders', () => {
  for (const sh of [{ kind: 'extrude', polygon: [[3, 4], [5, 4], [5, 6], [3, 6]], h: 2, round: 0.02 }, { kind: 'loft', polygon: square, top: hole.map(([x, z]) => [x + 3, z + 2]), h: 3 }, { kind: 'sweep', profile: hole, path: [[0, 0, 0], [1, 3, 0], [1.01, 3, 0], [4, 0, 2]] }]) {
    const a = shapes([{ ...sh, at: [1, 8, 2], scale: [1.3, 0.8, 1.7], pitch: 0.3, roll: 0.2, yaw: 0.4, collide: true }]);
    const b = kitPhysics(a), o = draw(a); const pos = meshes(o)[0].geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      assert.ok(b.colliders.some(c => { const dx = x - c.c[0], dz = z - c.c[1], co = Math.cos(c.yaw), si = Math.sin(c.yaw); return y >= c.y0 - 1e-5 && y <= c.y1 + 1e-5 && Math.abs(dx * co - dz * si) <= c.half[0] + 1e-5 && Math.abs(dx * si + dz * co) <= c.half[1] + 1e-5; }), `${sh.kind}: vertex ${[x, y, z]} outside colliders`);
    }
  }
});

// r2.1 walk: walk-lantern@1's glow body (an rbox with glow .75) drew nothing at night. three declares vColor as vec4,
// so `vec3 *= vColor` failed to compile ("cannot convert from vec4 to vec3") and the glow program was dropped.
test('the kit glow shader multiplies the vec3 radiance by a vec3 of the vertex colour, as three declares it', () => {
  const m = new MaterialLib().get('paint', undefined, { vertexColors: true, glow: 0.65, vertexGlow: true });
  const shader = { fragmentShader: THREE.ShaderLib.standard.fragmentShader } as Parameters<THREE.Material['onBeforeCompile']>[0];
  m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  const expand = (src: string): string => src.replace(/#include <(\w+)>/g, (_, k: string) => expand((THREE.ShaderChunk as Record<string, string>)[k] ?? ''));
  const src = expand(shader.fragmentShader), declared = /varying\s+(vec[34])\s+vColor\s*;/.exec(src)?.[1];
  const line = src.split('\n').find(l => /totalEmissiveRadiance\s*\*=/.test(l) && l.includes('vColor'));
  assert.ok(declared && line, 'the glow line and the vColor declaration are both in the compiled source');
  assert.ok(/vec3\s+totalEmissiveRadiance/.test(src));
  assert.ok(declared === 'vec3' || /vColor\.rgb\b/.test(line!), `${line!.trim()} multiplies a vec3 by a ${declared}`);
});

test('kit glow parts brighten at night from the world clock even when no motion model is bound', () => {
  bindMotionModel(null);
  const obj = draw(shapes([{ kind: 'rbox', size: [0.22, 0.3, 0.22], glow: 0.75, color: '#ffd27a' }]));
  const e = { id: 'walk-lantern', state: {} } as Entity, d = { components: { light: { on: true } } } as StoredDef;
  try {
    setClockNight(0); animate(obj, e, d, 1_000_000_000, { y: 0, yaw: 0 }); const day = meshes(obj)[0].material.emissiveIntensity;
    setClockNight(1); animate(obj, e, d, 1_000_000_000, { y: 0, yaw: 0 }); const night = meshes(obj)[0].material.emissiveIntensity;
    assert.ok(night > 5 * day, `night ${night} vs day ${day}`);
    assert.ok(Math.abs(night - quantizeGlow((0.25 + 1.4 + 0.03 * Math.sin(1_000_000_000 * 3)) * 0.65)) < 1e-9, String(night));   // (shared ~1% glow steps)
  } finally { setClockNight(null); }
});

test('L3e: parseKitArgs is kitArgs.safeParse, once per args object (valid, program and invalid args), and a build leaves it unchanged', () => {
  const cases: Record<string, unknown>[] = [...examples.map((raw) => raw.make.args as Record<string, unknown>), { v: 2, shapes: [{ kind: 'sphere', at: [0, 0, 0], h: 2 }] }, { v: 2, shapes: [{ kind: 'box', at: [0, 0, 0], size: ['$w', 1, 1], repeat: { n: 3, step: [1, 0, 0] } }] }, { shapes: [] }];
  for (const args of cases) {
    const fresh = kitArgs.safeParse(args), memo = parseKitArgs(args);
    assert.equal(memo.success, fresh.success);
    assert.deepEqual(memo.success ? memo.data : memo.error.issues, fresh.success ? fresh.data : fresh.error.issues);
    assert.equal(parseKitArgs(args), memo, 'second call reuses the first result');
    assert.notEqual(parseKitArgs(structuredClone(args)), memo, 'keyed by object, not by content');
    if (memo.success) { draw(memo.data, { w: 2 }); draw(memo.data, { w: 3 }); assert.deepEqual(memo.data, kitArgs.parse(args), 'building does not mutate the shared result'); }
  }
});

test('a from/to segment rising and sideways at once is drawn on from→to, not mirrored about its midpoint', () => {
  // Regression (harvest 2026-10-18): expansion yaw atan2(−dx, −dz) made this YXZ viewer draw the mirror image.
  const from = [-1, 0.1, -1], to = [1, 2.1, 1.2], d = to.map((v, k) => v - from[k]), len = Math.hypot(...d);
  const o = draw(kitArgs.parse({ v: 2, round: 0, box: [3, 2.4, 3], shapes: [{ kind: 'box', from, to, size: [0.1, 1, 0.1] }] })); o.updateMatrixWorld(true);
  const p = new THREE.Vector3(); let lowest = { y: Infinity, x: 0, z: 0 }, worst = 0;
  for (const m of meshes(o)) { const pos = m.geometry.attributes.position; for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    const t = ((p.x - from[0]) * d[0] + (p.y - from[1]) * d[1] + (p.z - from[2]) * d[2]) / len ** 2;
    worst = Math.max(worst, Math.hypot(p.x - from[0] - t * d[0], p.y - from[1] - t * d[1], p.z - from[2] - t * d[2]));
    if (p.y < lowest.y) lowest = { y: p.y, x: p.x, z: p.z };
  } }
  assert.ok(worst < 0.1, `every vertex within the beam's half-diagonal of the from→to line (worst ${worst.toFixed(3)} m)`);
  assert.ok(Math.hypot(lowest.x - from[0], lowest.z - from[2]) < 0.15, 'the low end stands at from');
});
