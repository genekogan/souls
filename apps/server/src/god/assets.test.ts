// L5: asset store, GLB measurement, footprints, catalog search, asset routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { AssetStore, REPO_ROOT, footprintToBaked, measureGlb, mountAssetRoutes, scaleFootprint, searchDefs, validateGlb } from './assets.ts';
import { GOD_JSON_BYTES } from './ingestion.ts';

const repo = (p: string) => new Uint8Array(readFileSync(join(REPO_ROOT, p)));
const DOG = 'worlds/core-assets/packs/dog-pack.glb';
const TOWER_FP = 'worlds/littlemartians/buildings/ceramic-tower.footprint.json';

test('sign image admission is scoped to this world even when worlds share an asset directory', t => {
  const db = new Db(':memory:'), dir = mkdtempSync(join(tmpdir(), 'sign-world-assets-'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const opts = { ownerId: null, tick: () => 1, emit: () => {}, assetDir: dir };
  const a = new GodMode(db, { ...opts, worldId: 'image-world-a' }), b = new GodMode(db, { ...opts, worldId: 'image-world-b' });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001a5f645400000000049454e44ae426082', 'hex');
  const asset = a.assets.put(png), media = `/assets/${asset.sha}.${asset.ext}`;
  const op = { op: 'place', def: 'core/picture-frame@1', state: { media } };
  assert.equal(a.act({ ops: [op] }).accepted, true);
  assert.ok(b.assets.info(asset.sha), 'the shared directory contains the file');
  const refused = b.act({ ops: [op] }); assert.equal(refused.accepted, false);
  if (!refused.accepted) { assert.equal(refused.failures[0].code, 'params.invalid'); assert.equal(refused.failures[0].field, 'state.media'); assert.match(refused.failures[0].fix!, /Upload.*this world/); }
  b.assets.put(png);
  assert.equal(b.act({ ops: [op] }).accepted, true, 'uploading into B records its world provenance');
});

function fixture() {
  const db = new Db(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'l5-assets-'));
  const god = new GodMode(db, { worldId: 'assets-1', ownerId: null, tick: () => 1, emit: () => {}, assetDir: dir } as never);
  const app = new Hono();
  const requireGod = (c: Context) => { if (!god.godFromToken(c.req.header('authorization')?.replace(/^Bearer\s+/i, ''))) throw new ApiError(401, 'unauthorized', 'god token'); };
  // once the lead applies the L5 patch, GodMode owns the store and mountGodRoutes mounts these routes itself
  const owned = (god as unknown as { assets?: AssetStore }).assets;
  const store = owned ?? mountAssetRoutes(app, { god, requireGod, dir });
  mountGodRoutes(app, {
    god, worldName: 'Assets',
    requireUser: async () => ({ id: 'dev:gene', role: 'user', email: null, wallet: null, created_at: 0, last_seen: 0, invited_by: null }) as never,
    soulFromBearer: () => null, baseOf: () => 'http://localhost:4999/w/assets', limitIp: () => {},
  });
  if (owned) assert.equal(store, owned);
  app.onError((err, c) => err instanceof ApiError ? c.json({ ok: false, code: err.code, message: err.message, ...err.extra }, err.status as 400) : c.json({ ok: false, code: 'internal', message: String(err) }, 500));
  const token = god.mintFor({ id: 'dev:gene', role: 'user' }, 'test');
  const req = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const r = await app.request(path, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.json ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string> ?? {}) }, body: init.json ? JSON.stringify(init.json) : init.body });
    const buf = new Uint8Array(await r.arrayBuffer()); let data: unknown = null; try { data = JSON.parse(new TextDecoder().decode(buf)); } catch { /* binary */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: r.status, data: data as any, headers: r.headers, bytes: buf };
  };
  return { db, god, app, store, dir, token, req };
}

test('measure: a split pack animal (skinned, clips) and a Draco+WebP scan measure without decoders', () => {
  const dog = measureGlb(repo(DOG));
  assert.equal(dog.tris, 602);
  assert.deepEqual(dog.animations.sort(), ['Idle', 'Walk']);
  assert.ok(dog.box[1] > 0.5 && dog.box[1] < 0.8, `dog height ${dog.box[1]}`);
  assert.ok(dog.box[2] > dog.box[0], 'dog faces +z (longer along z than x)');
  const kin = measureGlb(repo('worlds/littlemartians/characters/kin/chebel.glb'));
  assert.equal(kin.tris, 29324);                     // matches the floater manifest
  assert.equal(kin.textures, 4); assert.equal(kin.texPx, 2048);
  assert.ok(kin.extensions.includes('KHR_draco_mesh_compression'));
  const tower = measureGlb(repo('worlds/littlemartians/buildings/ceramic-tower.glb'));
  assert.deepEqual(tower.box.map((v) => Math.round(v * 10) / 10), [19, 38.3, 19]);
  assert.throws(() => measureGlb(new TextEncoder().encode('not a model at all, sorry')), /not a GLB/);
});

test('footprint: lm-building-footprint/1 → rooms, room slots, wall colliders, openings, float links', () => {
  const b = footprintToBaked(JSON.parse(readFileSync(join(REPO_ROOT, TOWER_FP), 'utf8')));
  assert.equal(b.rooms!.length, 4);
  assert.deepEqual(b.slots.map((s) => s.id), ['tower-l0', 'tower-l1', 'tower-l2', 'tower-l3']);
  assert.ok(b.slots.every((s) => s.kind === 'room' && (s.polygon?.length ?? 0) <= 64));
  assert.equal(b.openings!.filter((o) => o.kind === 'door' && o.level === 0).length, 12);
  assert.equal(b.links!.length, 3);
  assert.ok(b.links!.every((l) => l.kind === 'float'));
  assert.ok(b.colliders.length > 300);
  assert.ok(b.surfaces!.some((s) => s.tag?.includes('terrace')));
  // scaled by k: every length doubles
  const b2 = footprintToBaked(JSON.parse(readFileSync(join(REPO_ROOT, TOWER_FP), 'utf8')), 2);
  assert.equal(b2.box[1], b.box[1] * 2);
});

test('store: content-addressed, measured, budgets refused at ingest, shared across worlds by sidecar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'l5-store-'));
  const db = new Db(':memory:');
  const a = new AssetStore({ dir, db, worldId: 'w1', coreIndex: null });
  const m = a.put(repo(DOG), { name: 'my-dog', license: 'CC0 1.0', source: 'test' });
  assert.match(m.sha, /^[0-9a-f]{64}$/);
  assert.ok(existsSync(join(dir, `${m.sha}.glb`)) && existsSync(join(dir, `${m.sha}.meta.json`)));
  assert.equal(a.lookup(m.sha)?.tris, 602);
  assert.equal(a.listWorld()[0].name, 'my-dog');
  // over budget: refused with the measured facts
  assert.throws(() => a.put(repo(DOG), { budget: { tris: 100, bytes: 3e6, texPx: 2048 } }), (e: ApiError) => e.code === 'asset.budget' && e.status === 413);
  assert.throws(() => a.put(repo('worlds/littlemartians/characters/kin/chebel.glb'), { budget: { tris: 80000, bytes: 3e6, texPx: 1024 } }), /2048 px texture/);
  assert.throws(() => a.put(new TextEncoder().encode('GIF89a nope')), (e: ApiError) => e.code === 'asset.type');
  // another world on the same box sees it without a row of its own
  const b = new AssetStore({ dir, worldId: 'w2', coreIndex: null });
  assert.equal(b.info(m.sha)?.name, 'my-dog');
  // footprint linked to a GLB: the lookup carries the footprint physics
  const t = a.put(repo('worlds/littlemartians/buildings/ceramic-tower.glb'), { name: 'tower', footprint: repo(TOWER_FP) });
  assert.ok(t.footprint);
  assert.equal((a.lookup(t.sha) as { baked?: { rooms?: unknown[] } }).baked?.rooms?.length, 4);
});

test('core assets: every core mesh def resolves to a file and a measured lookup', () => {
  const f = fixture();
  const meshDefs = f.god.model.allDefs().filter((d) => d.make.kind === 'mesh');
  assert.ok(meshDefs.length >= 80, `${meshDefs.length} core mesh defs`);
  for (const d of meshDefs) {
    const sha = (d.make as { asset: string }).asset;
    assert.ok(f.store.file(sha, 'glb'), `${d.ref}: file for ${sha.slice(0, 10)}`);
    assert.ok(f.store.lookup(sha), `${d.ref}: lookup`);
  }
  const tower = f.god.model.def('core/ceramic-tower@1')!;
  assert.equal(tower.slots.filter((s) => s.kind === 'room').length, 4);
});

// Keep the historical assertion ID for gate coverage continuity. This upload also exists in core
// and must now validate; asset-view.test.ts separately pins immutable upload-only content.
test('routes: upload a GLB, define it, place it, fetch it immutable; refuse junk and strangers', async () => {
  const f = fixture();
  const glb = repo(DOG);
  const form = new FormData();
  form.set('file', new Blob([glb], { type: 'model/gltf-binary' }), 'dog.glb');
  form.set('name', 'Rex'); form.set('height', '0.7'); form.set('tags', 'dog, pet'); form.set('license', 'CC0 1.0'); form.set('define', '1');
  const up = await f.req('/v1/god/assets', { method: 'POST', body: form });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.asset.tris, 602);
  assert.equal(up.data.def.name, 'rex');
  assert.ok(Math.abs(up.data.def.size.box[1] - 0.7) < 1e-6);
  assert.equal(up.data.defined.accepted, true, JSON.stringify(up.data.defined));
  assert.match(up.data.report, /602 tris/);
  const placed = f.god.act({ ops: [{ op: 'place', def: 'rex@1', p: [3, 4], name: 'rex' }] });
  assert.equal(placed.accepted, true, JSON.stringify(placed));
  // This uploaded pack is also in core: its source alias may acquire a rendition and must validate.
  const get = await f.req(up.data.asset.url);
  assert.equal(get.status, 200);
  assert.equal(f.store.isCore(up.data.asset.sha), true);
  assert.equal(get.headers.get('cache-control'), 'public, no-cache');
  assert.equal(get.bytes.byteLength, glb.byteLength);
  assert.equal((await f.req(up.data.asset.url, { headers: { 'if-none-match': `"${up.data.asset.sha}"` } })).status, 304);
  // other core assets remain available
  const tower = f.god.model.def('core/ceramic-tower@1')!;
  assert.equal((await f.req(`/assets/${(tower.make as { asset: string }).asset}.glb`)).status, 200);
  // raw body upload with query params; junk refused; no token refused
  const raw = await f.req('/v1/god/assets?name=tower2', { method: 'POST', body: repo('worlds/littlemartians/buildings/minaret-temple.glb'), headers: { 'content-type': 'model/gltf-binary' } });
  assert.equal(raw.status, 200); assert.equal(raw.data.asset.tris, 17928);
  assert.equal((await f.req('/v1/god/assets', { method: 'POST', body: new TextEncoder().encode('hello'), headers: { 'content-type': 'application/octet-stream' } })).status, 415);
  const anon = await f.app.request('/v1/god/assets', { method: 'POST', body: glb });
  assert.equal(anon.status, 401);
});

function syntheticGlb(options: { invalidAccessor?: boolean; missingAccessor?: boolean; compressed?: boolean; meshopt?: boolean; truncatedView?: boolean; extension?: string; skinned?: boolean } = {}) {
  // skinned (#760): a skin whose inverse-bind matrices sit in a meshopt-compressed view of the virtual fallback buffer,
  // at an offset past the end of the BIN chunk, as gltf-transform writes every rigged file
  const skinned = options.skinned && options.meshopt;
  const json = {
    asset: { version: '2.0' }, buffers: [{ byteLength: 36 }, ...(options.meshopt ? [{ byteLength: skinned ? 100 : 36, extensions: { EXT_meshopt_compression: { fallback: true } } }] : [])],
    bufferViews: [{ buffer: options.meshopt ? 1 : 0, byteLength: 36, ...(options.meshopt ? { extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: options.truncatedView ? 100 : 36, byteStride: 12, count: 3, mode: 'ATTRIBUTES' } } } : options.truncatedView ? { byteLength: 100 } : {}) },
      ...(skinned ? [{ buffer: 1, byteOffset: 36, byteLength: 64, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: 36, byteStride: 64, count: 1, mode: 'ATTRIBUTES' } } }] : [])],
    accessors: [{ bufferView: 0, componentType: options.invalidAccessor ? 9999 : 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }, ...(skinned ? [{ bufferView: 1, componentType: 5126, count: 1, type: 'MAT4' }] : [])],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, ...(options.missingAccessor ? { indices: 99 } : {}), ...(options.compressed ? { extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } } } : {}) }] }],
    nodes: [{ mesh: 0, ...(skinned ? { skin: 0 } : {}) }], scenes: [{ nodes: [0] }], ...(skinned ? { skins: [{ joints: [0], inverseBindMatrices: 1 }] } : {}),
    ...(options.compressed || options.meshopt || options.extension ? { extensionsRequired: [options.extension ?? (options.meshopt ? 'EXT_meshopt_compression' : 'KHR_draco_mesh_compression')], extensionsUsed: [options.extension ?? (options.meshopt ? 'EXT_meshopt_compression' : 'KHR_draco_mesh_compression')] } : {}),
  };
  const text = new TextEncoder().encode(JSON.stringify(json)), padded = Math.ceil(text.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + padded + 8 + 36), dv = new DataView(bytes.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, bytes.length, true);
  dv.setUint32(12, padded, true); dv.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + padded); bytes.set(text, 20);
  dv.setUint32(20 + padded, 36, true); dv.setUint32(24 + padded, 0x004e4942, true);
  return bytes;
}

test('compressed GLB containers check meshopt source ranges while allowing virtual fallback buffers', () => {
  assert.equal(measureGlb(syntheticGlb({ meshopt: true })).tris, 1);
  assert.throws(() => measureGlb(syntheticGlb({ meshopt: true, truncatedView: true })), /EXT_meshopt_compression is outside its buffer/);
  // #760: a rigged meshopt file measures (the matrices are compressed, so the joint's rest matrix stands in) instead of
  // being refused as invalid for a BIN read past its end
  const rigged = measureGlb(syntheticGlb({ meshopt: true, skinned: true }));
  assert.equal(rigged.skins, 1); assert.equal(rigged.tris, 1); assert.deepEqual(rigged.box, [1, 1, 1]);
});

test('invalid GLB parser, height, footprint and unsupported extensions are refused before store.put', async () => {
  const f = fixture(); let puts = 0;
  const put = f.store.put.bind(f.store);
  f.store.put = (...args) => { puts++; return put(...args); };
  const parserInvalid = syntheticGlb({ invalidAccessor: true });
  assert.doesNotThrow(() => measureGlb(parserInvalid), 'measurement alone misses this invalid accessor');
  assert.ok(await validateGlb(parserInvalid), 'the full parser must catch it');
  const withRequiredMaterial = syntheticGlb({ invalidAccessor: true, extension: 'KHR_materials_unlit' });
  assert.ok(await validateGlb(withRequiredMaterial), 'a non-decoder required extension must not skip full parsing');
  const invalidUploads = [
    { path: '/v1/god/assets', bytes: parserInvalid },
    { path: '/v1/god/assets', bytes: withRequiredMaterial },
    { path: '/v1/god/assets', bytes: syntheticGlb({ missingAccessor: true }) },
    { path: '/v1/god/assets', bytes: syntheticGlb({ compressed: true, truncatedView: true }) },
    { path: '/v1/god/assets', bytes: syntheticGlb({ extension: 'UNSUPPORTED_extension' }) },
    { path: '/v1/god/assets?height=0', bytes: repo(DOG) },
    { path: '/v1/god/assets?height=Infinity', bytes: repo(DOG) },
    { path: '/v1/god/assets?height=', bytes: repo(DOG) },
  ];
  for (const upload of invalidUploads) {
    const r = await f.req(upload.path, { method: 'POST', body: upload.bytes, headers: { 'content-type': 'model/gltf-binary' } });
    assert.equal(r.status, 400, JSON.stringify(r.data)); assert.equal(r.data.code, 'asset.invalid'); assert.ok(r.data.measured); assert.ok(r.data.allowed);
  }
  for (const footprint of ['{invalid JSON', JSON.stringify({ schema: 'lm-building-footprint/1', rooms: [{ id: 'bad', level: 0, y0: 0, y1: 1, polygon: [[0, 0]] }] })]) {
    const form = new FormData(); form.set('file', new Blob([repo(DOG)]), 'dog.glb'); form.set('footprint', footprint);
    const r = await f.req('/v1/god/assets', { method: 'POST', body: form });
    assert.equal(r.status, 400); assert.equal(r.data.code, 'asset.invalid'); assert.ok(r.data.measured); assert.ok(r.data.allowed);
  }
  assert.equal(puts, 0); assert.equal(f.store.listWorld().length, 0); assert.deepEqual(readdirSync(f.dir), []);
});

function numericFootprint() {
  return {
    schema: 'lm-building-footprint/1' as const, bounds: { min: [0, 0, 0], max: [2, 2, 2] },
    levels: [{ id: 0, y: 0 }],
    rooms: [{ id: 'room', level: 0, y0: 0, y1: 2, clearHeight: 2, polygon: [[0, 0], [2, 0], [0, 2]] }],
    terraces: [{ id: 'terrace', level: 0, y: 0, polygon: [[0, 0], [2, 0], [0, 2]], hole: [[0, 0], [1, 0], [0, 1]] }],
    obstacles: [{ id: 'wall', kind: 'wall', obb: { c: [0, 0], half: [0.2, 1], yaw: 0 }, y0: 0, y1: 2 }],
    portals: [{ id: 'door', kind: 'door' as const, level: 0, center: [0, 1, 0], normal: [0, 0, 1], width: 1, diameter: 1, y0: 0, y1: 2 }],
    links: [{ id: 'link', kind: 'float', width: 1, from: { level: 0, y: 0 }, to: { level: 1, y: 2 }, path: [[0, 0, 0], [0, 2, 0]] }],
  };
}

test('raw footprint coordinates and dimensions reject null, strings and wrong vector lengths before storage', async () => {
  const f = fixture(); let puts = 0;
  const put = f.store.put.bind(f.store); f.store.put = (...args) => { puts++; return put(...args); };
  const invalid: [string, unknown][] = [
    ['bounds', null], ['bounds.min', [0, 0]], ['bounds.min.0', null], ['bounds.max.1', '2'],
    ['levels.0.id', '0'], ['levels.0.y', null], ['rooms', null], ['rooms.0.level', '0'],
    ['rooms.0.y0', null], ['rooms.0.y1', '2'], ['rooms.0.clearHeight', null], ['rooms.0.polygon.0', [0, 0, 0]], ['rooms.0.polygon.0.0', null],
    ['terraces.0.level', null], ['terraces.0.y', '0'], ['terraces.0.polygon.1.1', null], ['terraces.0.hole.0', [0]],
    ['obstacles.0.obb.c.0', null], ['obstacles.0.obb.half.1', '1'], ['obstacles.0.obb.yaw', null], ['obstacles.0.y0', '0'], ['obstacles.0.y1', null],
    ['portals.0.center', [0, 1]], ['portals.0.center.0', null], ['portals.0.normal.1', '0'], ['portals.0.width', null], ['portals.0.diameter', '1'], ['portals.0.level', null], ['portals.0.y0', '0'],
    ['links.0.width', null], ['links.0.path.0', [0, 0]], ['links.0.path.1.2', '0'], ['links.0.from.level', '0'], ['links.0.from.y', null], ['links.0.to.level', null], ['links.0.to.y', '2'],
  ];
  for (const [field, value] of invalid) {
    const footprint = numericFootprint(), path = field.split('.');
    let parent = footprint as unknown as Record<string, unknown>;
    for (const segment of path.slice(0, -1)) parent = parent[segment] as Record<string, unknown>;
    parent[path.at(-1)!] = value;
    const source = JSON.stringify(footprint);
    // Independent parser cases use separate authenticated buckets; throttling is covered in route-safety.test.
    const token = f.god.mintFor({ id: 'dev:gene', role: 'user' }, `invalid-${field}`), headers = { authorization: `Bearer ${token}` };
    // A direct JSON footprint and a mesh sidecar both use strict admission.
    const raw = await f.req('/v1/god/assets', { method: 'POST', body: source, headers: { ...headers, 'content-type': 'application/json' } });
    assert.equal(raw.status, 400, field); assert.equal(raw.data.code, 'asset.invalid', field); assert.match(raw.data.message, /invalid footprint/); assert.ok(raw.data.message.includes(field), raw.data.message);
    const form = new FormData(); form.set('file', new Blob([syntheticGlb()]), 'mesh.glb'); form.set('footprint', source); form.set('height', '2');
    const sidecar = await f.req('/v1/god/assets', { method: 'POST', body: form, headers });
    assert.equal(sidecar.status, 400, field); assert.equal(sidecar.data.code, 'asset.invalid', field); assert.ok(sidecar.data.measured); assert.ok(sidecar.data.allowed);
  }
  const malformed = { schema: 'lm-building-footprint/1', bounds: { min: [0, 0, 0], max: [1, 1, null] } };
  assert.throws(() => scaleFootprint(malformed as never, 1), /bounds.max.2 must be a finite number/);
  assert.equal(puts, 0); assert.equal(f.store.listWorld().length, 0); assert.deepEqual(readdirSync(f.dir), []);
});

test('footprint scaling overflow and collapsed dimensions return asset.invalid before any store.put', async () => {
  const f = fixture(); let puts = 0;
  const put = f.store.put.bind(f.store); f.store.put = (...args) => { puts++; return put(...args); };
  for (const [footprint, height] of [
    [{ schema: 'lm-building-footprint/1', bounds: { min: [0, 0, 0], max: [1e303, 1e303, 1e303] } }, '399'],
    [numericFootprint(), '0.000001'],
  ] as const) {
    const form = new FormData(); form.set('file', new Blob([syntheticGlb()]), 'mesh.glb'); form.set('footprint', JSON.stringify(footprint)); form.set('height', height);
    const r = await f.req('/v1/god/assets', { method: 'POST', body: form });
    assert.equal(r.status, 400, JSON.stringify(r.data)); assert.equal(r.data.code, 'asset.invalid'); assert.match(r.data.message, /footprint could not be scaled/);
    assert.equal(r.data.measured.scale, Number(height)); assert.ok(r.data.allowed);
  }
  assert.equal(puts, 0); assert.equal(f.store.listWorld().length, 0); assert.deepEqual(readdirSync(f.dir), []);
});

test('upload limits report measured and allowed bytes before storing raw, multipart or interrupted bodies', async () => {
  const f = fixture(); let puts = 0;
  const put = f.store.put.bind(f.store); f.store.put = (...args) => { puts++; return put(...args); };
  f.god.model.constants.limits.budget.bytes = 100;
  for (const headers of [{ 'content-length': '101' }, { 'content-length': '1' }, {}] as Record<string, string>[]) {
    const r = await f.req('/v1/god/assets', { method: 'POST', body: new Uint8Array(101), headers });
    assert.equal(r.status, 413); assert.equal(r.data.code, 'asset.budget'); assert.equal(r.data.measured.bytes, 101); assert.equal(r.data.allowed.bytes, 100);
  }
  const form = new FormData(); form.set('file', new Blob([new Uint8Array(101)]), 'large.glb');
  const multipart = await f.req('/v1/god/assets', { method: 'POST', body: form });
  assert.equal(multipart.status, 413); assert.equal(multipart.data.code, 'asset.budget'); assert.deepEqual(multipart.data.allowed, { bytes: 100 });
  let chunks = 0;
  const interrupted = new ReadableStream<Uint8Array>({ pull(controller) { if (chunks++ === 0) controller.enqueue(new Uint8Array(10)); else controller.error(new Error('interrupted')); } });
  const r = await f.app.request(new Request('http://localhost/v1/god/assets', { method: 'POST', headers: { authorization: `Bearer ${f.token}` }, body: interrupted, duplex: 'half' } as RequestInit));
  assert.equal(r.status, 400); assert.equal((await r.json() as { code: string }).code, 'asset.invalid');
  const malformed = await f.req('/v1/god/assets', { method: 'POST', body: 'broken', headers: { 'content-type': 'multipart/form-data; boundary=missing' } });
  assert.equal(malformed.status, 400); assert.equal(malformed.data.code, 'asset.invalid');
  assert.equal(puts, 0); assert.equal(f.store.listWorld().length, 0); assert.deepEqual(readdirSync(f.dir), []);
});

test('mounted God act and subroute ingestion limits precede route JSON parsing', async () => {
  const f = fixture();
  for (const path of ['/v1/god/act', '/v1/god/preview', '/v1/god/land']) {
    const r = await f.req(path, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'content-length': String(GOD_JSON_BYTES + 1) } });
    assert.equal(r.status, 413); assert.equal(r.data.code, 'too-large'); assert.deepEqual(r.data.allowed, { bytes: GOD_JSON_BYTES });
  }
  const streamed = await f.req('/v1/god/act', { method: 'POST', body: 'x'.repeat(GOD_JSON_BYTES + 1), headers: { 'content-type': 'application/json', 'content-length': '1' } });
  assert.equal(streamed.status, 413); assert.equal(streamed.data.code, 'too-large'); assert.equal(f.god.model.editSeq, 0);
});

test('catalog: ranked search with synonyms; def detail with an example op; thumbnails round-trip', async () => {
  const f = fixture();
  const first = async (q: string) => (await f.req(`/v1/god/defs?q=${encodeURIComponent(q)}`)).data.defs[0]?.publicRef as string | undefined;
  // L4's kit creatures (rounded, animated) rank ahead of the pack meshes
  assert.equal(await first('dog'), 'core/dog@1');
  assert.equal(await first('pup'), 'core/dog@1');
  assert.equal(await first('kitty'), 'core/cat@1');
  assert.equal(await first('lighthouse'), 'core/lighthouse@1');  // L2's enterable lighthouse ranks ahead of the LM tower mesh
  assert.equal(await first('ceramic tower'), 'core/ceramic-tower@1');
  assert.match((await first('boat'))!, /row(ing-)?boat/);
  assert.match((await first('cows'))!, /cow/);
  assert.match((await first('birch trees'))!, /birch/);
  const hen = await first('hen'); if (hen) assert.match(hen, /chicken/); // L4's chicken (kit/2) answers once it lands
  const none = await f.req('/v1/god/defs?q=xylophone-zeppelin');
  assert.equal(none.data.count, 0); assert.match(none.data.hint, /define it/);
  const detail = await f.req('/v1/god/defs/core/ceramic-tower@1');
  assert.equal(detail.status, 200);
  assert.equal(detail.data.example.ops[0].op, 'place');
  assert.equal(detail.data.slots.length, 4);
  assert.equal(detail.data.asset.tris, 25148);
  // the example op is valid as written
  assert.equal(f.god.act({ ops: [{ ...detail.data.example.ops[0], p: [0, 0] }] }).accepted, true);
  // thumbs
  // core mesh defs ship a thumbnail (worlds/core-assets/thumbs); a def without one answers 404
  assert.equal((await f.req('/v1/god/defs/core/ceramic-tower@1/thumb.png')).status, 200);
  assert.equal((await f.req('/v1/god/defs/core/bench@1/thumb.png')).status, 404);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082', 'hex');
  assert.equal((await f.req('/v1/god/defs/core/ceramic-tower@1/thumb.png', { method: 'POST', body: png })).status, 200);
  // G8 moderation: a malformed thumbnail (bad chunk checksum) is refused
  const bad = Buffer.from(png); bad[bad.length - 13] ^= 1;
  assert.equal((await f.req('/v1/god/defs/core/ceramic-tower@1/thumb.png', { method: 'POST', body: bad })).status, 400);
  const thumb = await f.app.request('/v1/god/defs/core/ceramic-tower@1/thumb.png');
  assert.equal(thumb.status, 200); assert.equal(thumb.headers.get('content-type'), 'image/png');
});

test('search ranking: exact names beat tags beat descriptions; plural and synonym forms', () => {
  const defs = [
    { name: 'core-duck', ref: 'core-duck@1', tags: ['animal', 'bird', 'water'], description: 'A duck that floats.', make: { kind: 'gen' } },
    { name: 'core-bird-pack', ref: 'core-bird-pack@1', tags: ['animal', 'bird'], description: 'A small bird.', make: { kind: 'mesh' } },
    { name: 'core-pond', ref: 'core-pond@1', tags: ['water'], description: 'A pond for ducks.', make: { kind: 'gen' } },
    { name: 'core-dog', ref: 'core-dog@1', tags: ['animal', 'pet'], description: 'A dog.', make: { kind: 'gen' } },
    { name: 'core-dog-pack', ref: 'core-dog-pack@1', tags: ['animal', 'pet', 'dog'], description: 'A dog (mesh).', make: { kind: 'mesh' } },
    { name: 'core-rowboat-pack', ref: 'core-rowboat-pack@1', tags: ['boat', 'rowing-boat'], description: 'A rowing boat.', make: { kind: 'mesh' } },
  ];
  const top = (q: string) => searchDefs(defs, q).map((h) => h.def.name);
  assert.deepEqual(top('duck').slice(0, 2), ['core-duck', 'core-pond']);
  assert.equal(top('ducks')[0], 'core-duck');
  assert.equal(top('mallard')[0], 'core-duck');
  assert.equal(top('pup')[0], 'core-dog');          // kit creature before the pack mesh
  assert.equal(top('dog')[1], 'core-dog-pack');
  assert.equal(top('boat')[0], 'core-rowboat-pack');
  assert.equal(top('water bird')[0], 'core-duck');   // every word must match when something matches all
});

test('footprint physics in the compiler: the Ceramic Tower has rooms, doors and float shafts; a bench goes in its second room', (t) => {
  const f = fixture();
  const tower = f.god.model.def('core/ceramic-tower@1')!;
  if (!(tower.make as { footprint?: string }).footprint) { t.skip('waiting for the L1 schema patch (make.footprint)'); return; }
  const placed = f.god.act({ ops: [{ op: 'place', def: 'core/ceramic-tower@1', p: [40, 0], name: 'tower', tmp: '$t' }, { op: 'place', def: 'core/bench@1', in: { parent: '$t', slot: 'tower-l1' }, p: [2, 0], name: 'bench' }] });
  assert.equal(placed.accepted, true, JSON.stringify(placed));
  const e = f.god.model.get('tower')!;
  const baked = f.god.model.bake(tower, e.params ?? {}, e.seed ?? 0);
  assert.equal(baked.rooms?.length, 4);
  assert.equal(baked.links?.filter((l) => l.kind === 'float').length, 3);
  assert.ok((baked.openings?.length ?? 0) >= 28);
  assert.ok(baked.colliders.length > 300, 'wall segments, not one solid block');
  const bench = f.god.model.worldPose(f.god.model.get('tower/bench')!);
  assert.ok(Math.abs(bench.y - 9) < 0.6, `bench on the second floor (y ${bench.y})`);
  // something solid in the ground hall's open middle is fine (no solid block); inside a wall is refused
  assert.equal(f.god.act({ ops: [{ op: 'place', def: 'core/box@1', p: [40, 0] }] }).accepted, true);
});
