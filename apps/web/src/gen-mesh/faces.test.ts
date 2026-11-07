// XP8 faces, offline: real kit/building meshes with a recorded network log (no renderer, server or network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GENERATORS, kitArgs, type Value } from '@souls/generators';
import { CORE_KIT, WorldModel, type Entity } from '@souls/world-compiler';
import { buildKit } from './kit.mesh.ts';
import { FACE_TEXTURE_BUDGET, decalGroups, faceImagePath, faceTextureCache, patternPixels, patternSize, shapeFaceMeshes, textCanvasSize } from './faces.ts';
import { MaterialLib } from './materials.ts';
import { meshFor, type MeshCtx } from './registry.ts';
import './building.mesh.ts';

const fixtures = JSON.parse(readFileSync(new URL('../../../../packages/generators/src/fixtures/faces-kits.json', import.meta.url), 'utf8'));
const sha = 'e'.repeat(64), image = `/assets/${sha}.png`;
type FaceMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
const faces = (o: THREE.Object3D, name = 'kit-face') => { const out: FaceMesh[] = []; o.traverse(n => { if ((n as THREE.Mesh).isMesh && n.name === name) out.push(n as FaceMesh); }); return out; };
const draw = (args: unknown, params: Record<string, unknown> = {}) => buildKit(args, { materials: new MaterialLib(), tint: (_k, f) => f, params, state: {} });
const vertices = (m: FaceMesh) => { m.updateWorldMatrix(true, false); const p = m.geometry.attributes.position; return Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)); };
const uvs = (m: FaceMesh) => { const a = m.geometry.attributes.uv; return Array.from({ length: a.count }, (_, i) => [a.getX(i), a.getY(i)]); };
/** Every triangle faces along its stored normal (front side outward). */
function windsOutward(m: FaceMesh) {
  const v = vertices(m), n = new THREE.Vector3().fromBufferAttribute(m.geometry.attributes.normal, 0).transformDirection(m.matrixWorld);
  for (let i = 0; i < v.length; i += 3) assert.ok(new THREE.Vector3().crossVectors(v[i + 1].clone().sub(v[i]), v[i + 2].clone().sub(v[i])).dot(n) > 0, `triangle ${i / 3} winds inward`);
  return n;
}
const centre = (m: FaceMesh) => new THREE.Box3().setFromPoints(vertices(m)).getCenter(new THREE.Vector3());
function coreWorld(seed = 'faces') { const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed }); for (const d of CORE_KIT) w.defineDef(d, 'core', 0); return w; }
/** A real building mesh for a core def with its default params plus `extra`, baked as the server bakes it. */
function building(w: WorldModel, ref: string, extra: Record<string, unknown> = {}, materials = new MaterialLib()) {
  const def = w.def(ref)!;
  const params = { ...Object.fromEntries(Object.entries({ ...GENERATORS['building/1'].params, ...def.params }).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default])), ...extra };
  const baked = w.bake(def, params as Record<string, Value>, 7);
  const root = meshFor(def)!.build({ def, entity: { id: 'b', def: def.ref, in: { parent: 'world' }, by: 't', born: 0, v: 1, params } as Entity, params, args: def.make.kind === 'gen' ? def.make.args ?? {} : {}, baked, model: w, materials, tint: (_k: string, f: string) => f } as MeshCtx)!;
  root.updateMatrixWorld(true);
  return { root, baked };
}

/** A browser-ish document whose canvases record fillText; the network log records every request-shaped call. */
function sandbox() {
  const globals = globalThis as unknown as Record<string, unknown>, saved = new Map(['location', 'document', 'fetch', 'XMLHttpRequest', 'Image'].map(k => [k, globals[k]]));
  const log: string[] = [], texts: { text: string; x: number; align: string }[] = [];
  const context = { font: '', fillStyle: '', textAlign: 'start', textBaseline: '', fillRect() {}, measureText: (s: string) => ({ width: s.length * 9 }), fillText(text: string, x: number) { texts.push({ text, x, align: this.textAlign }); } };
  globals.location = new URL('http://offline.invalid/w/fixture?dev=1');
  globals.document = { createElement: (tag: string) => { if (tag !== 'canvas') log.push(`createElement:${tag}`); return { width: 0, height: 0, getContext: () => context, set src(v: string) { log.push(`src:${v}`); } }; }, createElementNS: (_ns: string, tag: string) => { log.push(`createElementNS:${tag}`); return { set src(v: string) { log.push(`src:${v}`); }, addEventListener() {}, removeEventListener() {} }; } };
  globals.fetch = (url: unknown) => { log.push(`fetch:${String(url)}`); return Promise.reject(new Error('offline')); };
  globals.XMLHttpRequest = class { open(_m: string, url: string) { log.push(`xhr:${url}`); } send() {} };
  globals.Image = class { set src(v: string) { log.push(`img:${v}`); } };
  const loaders = [THREE.TextureLoader, THREE.ImageLoader, THREE.FileLoader, THREE.ImageBitmapLoader] as unknown as { prototype: { load: (url: string) => unknown }; name: string }[];
  const originals = loaders.map(L => L.prototype.load);
  loaders.forEach((L, i) => { L.prototype.load = function(url: string) { log.push(`${i === 0 ? 'TextureLoader' : L.name}:${url}`); return i === 0 ? new THREE.Texture() : undefined; }; });
  return { log, texts, restore() { loaders.forEach((L, i) => { L.prototype.load = originals[i]; }); for (const [k, v] of saved) globals[k] = v; } };
}

test('seeded patterns are deterministic, use their palette, lead or grout their pieces, and fold stained glass symmetric', () => {
  const digest = (a: Uint8Array) => createHash('sha256').update(a).digest('hex');
  const glass = patternPixels('stained-glass', 96, 160, { seed: 7 });
  assert.equal(digest(glass), digest(patternPixels('stained-glass', 96, 160, { seed: 7 })));
  assert.notEqual(digest(glass), digest(patternPixels('stained-glass', 96, 160, { seed: 8 })));
  let lead = 0;
  for (let y = 0; y < 160; y++) for (let x = 0; x < 96; x++) {
    const k = (y * 96 + x) * 4, m = (y * 96 + 95 - x) * 4;
    assert.equal(glass[k + 3], 255); assert.deepEqual([...glass.subarray(k, k + 3)], [...glass.subarray(m, m + 3)], `fold at ${x},${y}`);
    if (glass[k] === 38 && glass[k + 1] === 34 && glass[k + 2] === 30) lead++;
  }
  assert.ok(lead / (96 * 160) > 0.08 && lead / (96 * 160) < 0.5, `lead fraction ${lead / (96 * 160)}`);
  const two = patternPixels('stained-glass', 64, 64, { seed: 1, palette: ['#ff0000', '#0000ff'] });
  for (let k = 0; k < two.length; k += 4) if (!(two[k] === 38 && two[k + 1] === 34)) assert.equal(two[k + 1] < 40, true, 'only red and blue glass (plus lead)');
  const mosaic = patternPixels('mosaic', 128, 128, { seed: 3, cells: 16 }), colours = new Set<string>();
  for (let k = 0; k < mosaic.length; k += 4) colours.add(mosaic.subarray(k, k + 3).join(','));
  assert.ok(colours.has('204,196,180'), 'grout'); assert.ok(colours.size > 20, 'tesserae vary in shade');
  assert.equal(digest(mosaic), digest(patternPixels('mosaic', 128, 128, { seed: 3, cells: 16 })));
});

test('stained glass borders a shaped face by stroking its outline: same pixels as per-pixel distance, a fraction of the time', () => {
  const ngon = (n: number, w: number, h: number) => Array.from({ length: n }, (_, i) => { const a = (i / n) * 2 * Math.PI; return [w / 2 + (w / 2 - 1) * Math.cos(a), h / 2 + (h / 2 - 1) * Math.sin(a)] as [number, number]; });
  const digest = (a: Uint8Array) => createHash('sha256').update(a).digest('hex').slice(0, 16);
  // Digests of the earlier per-pixel implementation (every pixel measured against every outline edge).
  assert.equal(digest(patternPixels('stained-glass', 200, 300, { seed: 3, outline: ngon(64, 200, 300) })), 'be6340c38d9d7cb0');
  assert.equal(digest(patternPixels('stained-glass', 159, 512, { seed: 7, outline: ngon(19, 159, 512) })), '8eea4f1e0e66a040');
  assert.equal(digest(patternPixels('stained-glass', 128, 128, { seed: 2, outline: [[0, 0], [128, 0], [0, 128]] })), 'f594d27b35fe6908');
  assert.equal(digest(patternPixels('stained-glass', 96, 160, { seed: 7 })), '5d3bd29a4a87b4bb');
  // A rose window (512², 64-vertex outline) took about a second on the main thread; best of three now.
  const rose = ngon(64, 512, 512); let best = Infinity;
  for (let i = 0; i < 3; i++) { const t = performance.now(); patternPixels('stained-glass', 512, 512, { seed: 1, outline: rose }); best = Math.min(best, performance.now() - t); }
  assert.ok(best < 100, `512² rose window took ${best.toFixed(1)} ms`);
  // And the viewer draws glass at 256 px at most (pieces are large); mosaic keeps 512 for its small tesserae.
  assert.equal(patternSize('stained-glass', 4, 4), 256); assert.equal(patternSize('mosaic', 4, 4), 512); assert.equal(patternSize('stained-glass', 0.5, 0.5), 128);
});

test('a menu board is one kit: header and priced lines drawn on the board front, a notice on the back', () => {
  const box = sandbox();
  try {
    const root = draw(fixtures.menuBoard.make.args), list = faces(root);
    assert.equal(list.length, 3);
    const [header, lines, back] = list;
    for (const f of list) { assert.equal(f.userData.face, 'text'); assert.ok(f.material.map instanceof THREE.CanvasTexture); }
    assert.deepEqual(windsOutward(header).toArray().map(v => Math.round(v * 1000) / 1000), [0, 0, 1]);
    assert.deepEqual(windsOutward(back).toArray().map(v => Math.round(v * 1000) / 1000), [0, 0, -1]);
    const c = centre(header); assert.ok(Math.abs(c.y - 1.58) < 1e-6 && Math.abs(c.z - (0.06 + 0.025 + 0.004)) < 1e-6, c.toArray().join());
    assert.ok(Math.abs(centre(lines).y - 1.17) < 1e-6);
    const size = new THREE.Box3().setFromPoints(vertices(header)).getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x - (1.1 - 2 * 0.0249)) < 1e-3 && Math.abs(size.y - 0.2) < 1e-6, size.toArray().join());
    for (const [u, v] of uvs(lines)) assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1);
    // A tab is a price column: the item at the left margin, the price right-aligned.
    const tea = box.texts.find(t => t.text === 'Tea')!, price = box.texts.find(t => t.text === '2')!;
    assert.equal(tea.align, 'left'); assert.equal(price.align, 'right'); assert.ok(price.x > tea.x);
    assert.ok(box.texts.some(t => t.text === 'CAFE MENU' && t.align === 'center'));
    assert.deepEqual(box.log, [], 'text faces request nothing');
  } finally { box.restore(); }
});

test('a stained-glass window is one face shaped like its lancet, on the front cap, lit, from a seeded pixel texture', () => {
  const root = draw(fixtures.stainedGlassWindow.make.args), [glass, ...rest] = faces(root);
  assert.equal(rest.length, 0, 'one face');
  assert.equal(glass.userData.face, 'stained-glass'); assert.ok(glass.material.map instanceof THREE.DataTexture);
  assert.ok(glass.material.emissiveIntensity > 0, 'stained glass glows a little');
  const n = windsOutward(glass); assert.ok(n.z > 0.999, n.toArray().join());
  const b = new THREE.Box3().setFromPoints(vertices(glass)), s = b.getSize(new THREE.Vector3());
  assert.ok(Math.abs(s.x - 0.92) < 1e-3 && Math.abs(s.y - 2.96) < 1e-3 && s.z < 1e-4, s.toArray().join());
  assert.ok(Math.abs(b.min.y) < 1e-3 && Math.abs(b.min.z - 0.004) < 1e-4, 'on the pane\'s front cap, lifted 4 mm');
  const lancet = 2 * 8 + 3; // a segments-8 lancet outline: two base corners and a 17-point crown
  assert.equal(glass.geometry.attributes.position.count / 3, lancet - 2, 'the outline triangulated');
  const mosaic = faces(draw(fixtures.mosaicMedallion.make.args));
  assert.equal(mosaic.length, 1); assert.ok(windsOutward(mosaic[0]).y > 0.999); assert.equal(mosaic[0].userData.face, 'mosaic');
});

test('mirrored copies carry faces to the mirror side and stay readable; role faces follow their pivot; `when` hides them', () => {
  const pair = faces(draw({ v: 2, box: [3, 1, 1], round: 0, shapes: [{ kind: 'box', at: [1, 0.5, 0], size: [0.5, 0.5, 0.5], mirror: 'x', faces: [{ side: 'right', pattern: 'mosaic' }] }] }));
  assert.equal(pair.length, 2);
  const [a, b] = pair, na = windsOutward(a), nb = windsOutward(b);
  assert.ok(na.x > 0.999 && centre(a).x > 1.2 && nb.x < -0.999 && centre(b).x < -1.2, 'outer sides of both copies');
  // Readable from outside: u grows toward the viewer's right (−z seen from +x; +z seen from −x).
  for (const [m, sign] of [[a, -1], [b, 1]] as const) {
    const v = vertices(m), u = uvs(m), hi = u.indexOf(u.reduce((p, q) => q[0] > p[0] ? q : p)), lo = u.indexOf(u.reduce((p, q) => q[0] < p[0] ? q : p));
    assert.ok(Math.sign(v[hi].z - v[lo].z) === sign, 'text is not mirrored');
  }
  const door = draw({ v: 2, round: 0, shapes: [{ kind: 'box', at: [0, 1, 0], size: [0.9, 2, 0.05], role: 'door', pivot: [-0.45, 1, 0], faces: [{ text: 'No 7', h: 0.2, at: [0, 0.4] }] }] });
  assert.equal(faces(door)[0].parent?.name, 'role:door');
  assert.ok(centre(faces(door)[0]).distanceTo(new THREE.Vector3(0, 1.4, 0.029)) < 1e-6, 'the face is placed in the kit frame under its pivot');
  const awning = { v: 2, round: 0, shapes: [{ kind: 'box', at: [0, 1, 0], size: [1, 0.3, 0.05], when: 'awning', faces: [{ text: 'OPEN' }] }] };
  assert.equal(faces(draw(awning, { awning: true })).length, 1); assert.equal(faces(draw(awning, { awning: false })).length, 0);
  // A stored contract-1 kit with a stray `faces` still renders (as it did before XP8) and draws no face.
  for (const stray of [[{ text: 'OPEN' }], 'legacy']) {
    const legacy = { shapes: [{ kind: 'box', at: [0, 1, 0], size: [1, 0.3, 0.05], faces: stray }, { kind: 'box', at: [0, 1, 0], size: [0.2, 0.2, 0.2], role: 'door', faces: stray }] };
    assert.equal(kitArgs.safeParse(legacy).success, true); assert.equal(faces(draw(legacy)).length, 0);
  }
});

test('network log: faces, patterns and decals request only this world\'s /assets/ images, and zero external URLs', async t => {
  const box = sandbox(), materials = new MaterialLib();
  try {
    assert.equal(faceImagePath(image), `/w/fixture${image}`);
    for (const bad of ['https://external.invalid/a.png', '//external.invalid/a.png', 'data:image/png;base64,AA', `/w/other${image}`, `${image}?u=https://x`, `/assets/${sha}.svg`]) assert.equal(faceImagePath(bad), null, bad);
    draw(fixtures.menuBoard.make.args); draw(fixtures.stainedGlassWindow.make.args); draw(fixtures.mosaicMedallion.make.args);
    const poster = faces(draw({ v: 2, shapes: [{ kind: 'box', at: [0, 1, 0], size: [1, 1.4, 0.04], faces: [{ image }, { side: 'back', image }] }] }));
    assert.equal(poster.length, 2); assert.equal(poster[0].material.map, poster[1].material.map, 'one texture per image');
    // Defence in depth: a face or decal that skipped admission still never reaches the loader.
    const smuggled = shapeFaceMeshes({ kind: 'box', at: [0, 0, 0], size: [1, 1, 0.1], faces: [{ image: 'https://external.invalid/tracker.png' }] } as never, 0);
    assert.equal((smuggled[0].material as THREE.MeshStandardMaterial).map, null);
    const { root: shop } = building(coreWorld(), 'core/shop@1', { decals: [...fixtures.shopDecals, { slot: 'facade-f0-e-1', w: 1, h: 1, image }, { slot: 'facade-f0-w-1', w: 1, h: 1, image: 'https://external.invalid/t.png' }] }, materials);
    assert.equal(faces(shop, 'building-decal').length, 4);
    t.diagnostic(`network log: ${JSON.stringify(box.log)}`);
    assert.deepEqual(box.log, [`TextureLoader:/w/fixture${image}`], 'one same-origin world image, cached; nothing else');
    assert.equal(box.log.filter(l => /:(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(l)).length, 0, 'zero external requests');
  } finally { box.restore(); materials.dispose(); }
});

test('building decals sit on their wall slots, in their storey\'s group, turned with the building', () => {
  const w = coreWorld('decals'), def = w.def('core/shop@1')!;
  for (const front of ['s', 'e']) {
    // Facade and gable ids are canonical (front = s); a shop turned east carries its gables on e and w.
    const list = fixtures.shopDecals.map((d: { slot: string }) => front === 'e' && d.slot === 'gable-s' ? { ...d, slot: 'gable-e' } : d);
    const { root, baked } = building(w, 'core/shop@1', { front, decals: list });
    const decals = faces(root, 'building-decal');
    assert.equal(decals.length, 2, front);
    for (const [i, d] of list.entries()) {
      const slot = baked.slots.find(s => s.id === d.slot)!, mesh = decals[i], n = new THREE.Vector3(Math.sin(slot.yaw), 0, Math.cos(slot.yaw));
      const want = new THREE.Vector3(...slot.p).add(new THREE.Vector3(0, d.at[1], 0)).addScaledVector(n, 0.006);
      assert.ok(centre(mesh).distanceTo(want) < 1e-4, `${front} ${d.slot}: ${centre(mesh).toArray()} vs ${want.toArray()}`);
      assert.ok(windsOutward(mesh).distanceTo(n) < 1e-6);
      assert.equal(mesh.parent?.name, `level-${slot.floor}`);
    }
  }
  assert.deepEqual(decalGroups([{ slot: 'ridge', w: 1, h: 1, text: 'X' }, { slot: 'nowhere', w: 1, h: 1, text: 'X' }, { bogus: true }], w.bake(def, {}, 7).slots, 0), [], 'roof slots, unknown slots and bad entries draw nothing');
});

test('decals never reshuffle the building: adding one or editing its text leaves every other mesh identical', () => {
  const w = coreWorld('reshuffle');
  /** Every mesh but the decals, as name, positions and colours (traversal order is the build order). */
  const body = (root: THREE.Object3D) => { const out: string[] = []; root.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh || m.name === 'building-decal') return; const g = m.geometry; out.push(`${m.parent?.name}/${m.name}:${createHash('sha256').update(new Uint8Array((g.attributes.position.array as Float32Array).buffer)).update(g.attributes.color ? new Uint8Array((g.attributes.color.array as Float32Array).buffer) : new Uint8Array()).digest('hex')}`); }); return out; };
  for (const ref of ['core/shop@1', 'core/house@1', 'core/cottage@1']) {
    const slot = ref === 'core/shop@1' ? 'opening-front-door' : building(w, ref).baked.slots.find(s => s.id.startsWith('facade-f0-'))!.id;
    const sign = (text: string) => [{ slot, w: 1.2, h: 0.3, at: [0, slot.startsWith('opening-') ? 3.05 : 0.9], text, bg: 'none' }];
    const plain = building(w, ref), signed = building(w, ref, { decals: sign('BAKERY') }), edited = building(w, ref, { decals: sign('BAKERX') });
    assert.equal(faces(signed.root, 'building-decal').length, 1, ref); assert.equal(faces(plain.root, 'building-decal').length, 0, ref);
    const base = body(plain.root);
    assert.ok(base.length > 5, ref);
    assert.deepEqual(body(signed.root), base, `${ref}: a decal changed other meshes`);
    assert.deepEqual(body(edited.root), base, `${ref}: editing decal text changed other meshes`);
    assert.deepEqual(body(building(w, ref, { decals: [] }).root), base, `${ref}: an empty decal list changed the building`);
  }
});

test('face textures are budgeted by bytes, least recently used first; only the evicted texture and its materials go', () => {
  const box = sandbox();
  try {
    const board = (text: string) => shapeFaceMeshes({ kind: 'box', at: [0, 0, 0], size: [1, 0.5, 0.05], faces: [{ text }] } as never, 0)[0].material as THREE.MeshStandardMaterial;
    const first = board('lru-0'), drawn = board('lru-drawn'), disposed: string[] = [];
    assert.equal(board('lru-0').map, first.map, 'same content, same texture');
    first.map!.addEventListener('dispose', () => disposed.push('first')); first.addEventListener('dispose', () => disposed.push('first material'));
    drawn.map!.addEventListener('dispose', () => disposed.push('drawn'));
    // 512×256 canvases (~0.7 MB with mipmaps): 400 of them overflow the budget; `drawn` is asked for now and then.
    for (let i = 1; i < 400; i++) { board(`lru-${i}`); if (i % 40 === 0) board('lru-drawn'); assert.ok(faceTextureCache().bytes <= FACE_TEXTURE_BUDGET.bytes, `${faceTextureCache().bytes} bytes`); }
    assert.deepEqual(disposed.sort(), ['first', 'first material'], 'the least recently used went, with its material; the one in use stayed');
    assert.equal(board('lru-drawn').map, drawn.map);
    assert.notEqual(board('lru-0').map, first.map, 'and is rebuilt on demand');
    assert.ok(faceTextureCache().textures < 400);
  } finally { box.restore(); }
  // Text canvases follow the face's size and aspect, at most 1024 wide: a 20 m banner gets a short canvas, not 2048.
  assert.deepEqual(textCanvasSize(1, 1.05, 0.2), [672, 128]);
  assert.deepEqual(textCanvasSize(1, 20, 0.36), [1024, 18]);
  assert.deepEqual(textCanvasSize(6, 1, 1), [512, 512]);
  assert.deepEqual(textCanvasSize(1, 0.3, 0.05), [384, 64]);
});

test('decals hide with their storey in the interior view, and a building decides that once per frame', () => {
  const { root } = building(coreWorld('interior'), 'core/shop@1', { decals: [...fixtures.shopDecals, { slot: 'facade-f1-s-1', w: 1, h: 0.5, text: 'ROOMS' }] });
  const decals = faces(root, 'building-decal'), upper = decals.find(d => d.parent?.name === 'level-1')!, sign = decals.find(d => d.parent?.name === 'level-0')!;
  assert.ok(upper && sign);
  const camera = new THREE.PerspectiveCamera(), matrix = camera.matrixWorld; let reads = 0;
  Object.defineProperty(camera, 'matrixWorld', { get: () => { reads++; return matrix; } });
  const meshes: THREE.Mesh[] = []; root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  assert.ok(meshes.length > 10);
  const frame = (n: number, eye: [number, number, number]) => {
    matrix.makeTranslation(...eye); reads = 0;
    const renderer = { info: { render: { frame: n } } } as unknown as THREE.WebGLRenderer, shown = new Map<THREE.Mesh, boolean>();
    for (const m of meshes) { m.onBeforeRender(renderer, new THREE.Scene(), camera, m.geometry, m.material as THREE.Material, null as never); shown.set(m, m.geometry.drawRange.count > 0); m.onAfterRender(renderer, new THREE.Scene(), camera, m.geometry, m.material as THREE.Material, null as never); }
    return { reads, upper: shown.get(upper), sign: shown.get(sign) };
  };
  assert.deepEqual(frame(1, [0, 1.6, 2]), { reads: 1, upper: false, sign: true }, 'inside on the ground floor: the upper storey and its decal hide');
  assert.deepEqual(frame(2, [0, 3, 20]), { reads: 1, upper: true, sign: true }, 'from the street everything shows');
});
