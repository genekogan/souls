// Offline: node --test --test-concurrency=1 apps/web/src/WorldBuildSites.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { WorldModel, type Entity, type OBB } from '@souls/world-compiler';
import { WorldBuildSites, parseBuildFeed, SITE_REFINEMENT, thingEnvelope, type PublicSite, type SiteDelta, type SiteModel } from './WorldBuildSites.ts';

const SERVER_NOW = 1_800_000_000_000;
function site(overrides: Partial<PublicSite> = {}): PublicSite {
  return { id: 'church', title: 'Black stone church', rev: 1, status: 'active', lastAt: SERVER_NOW, pauseAfterMs: 600_000, closed: true,
    step: { n: 2, label: 'shell', of: 6 }, site: { at: [103, 19], size: [26, 14], yaw: -Math.PI / 2 }, roots: [], claims: [],
    massing: [{ name: 'nave', at: [0, 0], size: [24, 12], h: 9, roof: 'gable' }, { name: 'tower-a', at: [-10, -4], size: [4, 4], h: 20, roof: 'pyramid' }, { name: 'tower-b', at: [-10, 4], size: [4, 4], h: 20, roof: 'pyramid' }], ...overrides };
}
function entity(id: string, parent = 'world', p: [number, number] = [103, 19]): Entity { return { id, def: 'fixture@1', in: { parent }, p, by: 'god', born: 0, v: 1 }; }
function fakeModel(): SiteModel & { boxes: Map<string, OBB[]> } {
  const entities = new Map<string, Entity>(), boxes = new Map<string, OBB[]>();
  return { entities, boxes, subtree(id) { const ids = [id]; for (let i = 0; i < ids.length; i++) for (const e of entities.values()) if (e.in.parent === ids[i]) ids.push(e.id); return ids; }, worldPose(e) { return { x: e.p?.[0] ?? 0, y: 0, z: e.p?.at(-1) ?? 0, yaw: 0, s: 1 }; }, footprintsOf(id) { return boxes.get(id) ?? []; } };
}
function fakeCanvas(paint = () => {}) {
  const context = { font: '', fillStyle: '', textBaseline: '', measureText: (s: string) => ({ width: s.length * 14 }), beginPath() {}, roundRect() {}, fill() {}, moveTo() {}, lineTo() {}, arc() {}, closePath() {}, fillText: paint };
  return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
}
function harness(style = 'ring,label', more: { fetchBuilds?: () => Promise<unknown>; groundAt?: (x: number, z: number) => number | null } = {}) {
  const model = fakeModel(); let mono = 1000, canvases = 0, paints = 0;
  const canvas = () => { canvases++; return fakeCanvas(() => { paints++; }); };
  const sites = new WorldBuildSites({ model: () => model, groundAt: () => 0, now: () => mono, createCanvas: canvas, search: `?sites=${style}`, ...more });
  return { sites, model, advance(ms: number) { mono += ms; sites.update(mono); }, now: () => mono, get canvases() { return canvases; }, get paints() { return paints; } };
}
function delta(rev: number, overrides: Partial<SiteDelta> = {}): SiteDelta { return { id: 'church', rev, status: 'active', lastAt: SERVER_NOW, ...overrides }; }
function edge(d: SiteDelta, now = SERVER_NOW) { return { type: 'edge', kind: 'world-build', rev: d.rev, now, event: 'alive', delta: d }; }
function start(b = site()) { return { type: 'edge', kind: 'world-build', rev: b.rev, now: SERVER_NOW, event: 'started', site: b }; }
function diff(d: SiteDelta[], upserts: Entity[] = [], removes: string[] = []) { return { type: 'edge', kind: 'world-diff', seq: 1, now: SERVER_NOW, builds: d, diff: { upserts, removes, defs: [], tiles: [] } }; }
function group(h: ReturnType<typeof harness>) { return h.sites.group.children[0] as THREE.Group; }
function marker(h: ReturnType<typeof harness>) { return group(h).children[0] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>; }
function ground(h: ReturnType<typeof harness>) { return group(h).children[2] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>; }
function faces(h: ReturnType<typeof harness>) { return group(h).children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; }
function label(h: ReturnType<typeof harness>) { return group(h).children.find(o => o instanceof THREE.Sprite) as THREE.Sprite; }
function wheel(h: ReturnType<typeof harness>) { return group(h).children.find(o => o instanceof THREE.Mesh && o !== faces(h) && o.material instanceof THREE.MeshBasicMaterial) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; }
function sheen(h: ReturnType<typeof harness>) { return group(h).children.find(o => o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>; }

function compiled(material: THREE.Material, kind: 'basic' | 'sprite' = 'basic') {
  const lib = THREE.ShaderLib[kind];
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} } as Parameters<THREE.Material['onBeforeCompile']>[0];
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer); return shader;
}

test('contract narration fields survive full/singular/delta feeds; malformed optional shapes are ignored', () => {
  const fields = { say: { text: 'shaping the nave', at: SERVER_NOW }, designing: ['nave'], note: { text: 'roof committed', at: SERVER_NOW }, reopensAt: SERVER_NOW + 30 * 60_000 };
  assert.deepEqual(parseBuildFeed(start(site(fields)))?.records[0], site(fields));
  assert.deepEqual(parseBuildFeed({ kind: 'world-diff', build: delta(2, fields), now: SERVER_NOW })?.records[0], delta(2, fields));
  for (const bad of [{ say: { text: 'bad', at: NaN } }, { note: 'bad' }, { designing: ['nave', 1] }, { designing: Array(9).fill('nave') }, { reopensAt: Infinity }]) {
    assert.equal(parseBuildFeed({ ...start(), site: { ...site(), ...bad } }), null);
  }
});

for (const skew of [-600_000, 600_000]) test(`narration lasts exactly eight minutes and suppresses quiet with ${skew / 60_000} min clock skew`, () => {
  const original = Date.now; Date.now = () => SERVER_NOW + skew;
  const h = harness();
  try {
    h.sites.apply(start(site({ lastAt: SERVER_NOW - 4 * 60_000, pauseAfterMs: 30 * 60_000, say: { text: 'shaping the nave', at: SERVER_NOW }, designing: ['nave'] })));
    const text = () => h.sites.inspect().sites[0].text;
    assert.equal(text().split('\n')[1], 'designing: shaping the nave'); assert.doesNotMatch(text(), /quiet/);
    const redraws = h.sites.stats.labelRedraws;
    h.advance(8 * 60_000 - 1); assert.doesNotMatch(text(), /quiet/); assert.equal(h.sites.stats.labelRedraws, redraws);
    h.advance(1); assert.doesNotMatch(text(), /designing:/); assert.match(text(), /quiet 12 min/);
    assert.ok(Array.from(faces(h).geometry.getAttribute('buildDesigning').array).every(n => n === 0));
  } finally { h.sites.dispose(); Date.now = original; }
});

test('step deltas replace narration/designing; unrelated deltas retain it and snapshots honor its original age', () => {
  const h = harness(); h.sites.apply(start());
  h.sites.apply(edge(delta(2, { say: { text: 'raising towers', at: SERVER_NOW }, designing: ['tower-b'] })));
  assert.match(h.sites.inspect().sites[0].text, /\ndesigning: raising towers$/);
  h.advance(1000); h.sites.apply(edge(delta(3), SERVER_NOW + 1000));
  assert.match(h.sites.inspect().sites[0].text, /raising towers/);
  h.sites.apply(edge(delta(4, { say: { text: 'finishing', at: SERVER_NOW + 1000 }, designing: [] }), SERVER_NOW + 1000));
  assert.match(h.sites.inspect().sites[0].text, /finishing/);
  assert.ok(Array.from(faces(h).geometry.getAttribute('buildDesigning').array).every(n => n === 0));
  const redraws = h.sites.stats.labelRedraws; h.sites.apply(edge(delta(4, { say: { text: 'stale', at: SERVER_NOW } })));
  assert.equal(h.sites.stats.labelRedraws, redraws);
  h.sites.reset([site({ rev: 10, lastAt: SERVER_NOW - 9 * 60_000, pauseAfterMs: 30 * 60_000, say: { text: 'old snapshot', at: SERVER_NOW - 8 * 60_000 } })], 10, SERVER_NOW);
  assert.doesNotMatch(h.sites.inspect().sites[0].text, /designing:/); assert.match(h.sites.inspect().sites[0].text, /quiet 9 min/);
  h.sites.dispose();
});

test('named mass faces and edges pulse through one shared uniform with no new draws or frame buffer writes', () => {
  const h = harness(); h.sites.apply(start(site({ say: { text: 'nave', at: SERVER_NOW }, designing: ['nave', 'unknown'] })));
  const mesh = faces(h), lines = marker(h), faceSelected = mesh.geometry.getAttribute('buildDesigning'), edgeSelected = lines.geometry.getAttribute('buildDesigning');
  assert.equal(faceSelected.getX(0), 1); assert.equal(faceSelected.getX(faceSelected.count - 1), 0);
  assert.equal(edgeSelected.getX(0), 1); assert.equal(edgeSelected.getX(edgeSelected.count - 1), 0);
  const a = compiled(mesh.material), b = compiled(lines.material);
  assert.equal(a.uniforms.uBuildPulse, b.uniforms.uBuildPulse); assert.match(a.fragmentShader, /diffuseColor.a \*= mix/);
  assert.match(a.vertexShader, /vBuildDesigning = buildDesigning/);
  const initial = a.uniforms.uBuildPulse.value, version = (faceSelected as THREE.BufferAttribute).version, colors = mesh.geometry.getAttribute('color') as THREE.BufferAttribute, colorVersion = colors.version;
  const objects = group(h).children.slice(), geometry = mesh.geometry, material = mesh.material;
  for (let i = 0; i < 120; i++) h.advance(16);
  assert.notEqual(a.uniforms.uBuildPulse.value, initial); assert.ok(a.uniforms.uBuildPulse.value >= 0.6 && a.uniforms.uBuildPulse.value <= 1);
  assert.equal((faceSelected as THREE.BufferAttribute).version, version); assert.equal(colors.version, colorVersion);
  assert.deepEqual(group(h).children, objects); assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material); assert.equal(h.sites.inspect().sites[0].draws, 4);
  h.sites.apply(edge(delta(2, { designing: ['tower-b'] })));
  assert.equal(faceSelected.getX(0), 0); assert.equal(faceSelected.getX(faceSelected.count - 1), 1);
  h.sites.apply(edge(delta(3, { status: 'paused' })));
  assert.ok(Array.from(faceSelected.array).every(n => n === 0));
  h.sites.dispose();
});

test('batch captions fade for six seconds inside the existing label draw without repainting each frame or replaying on alive', () => {
  const h = harness(); h.sites.apply(start(site({ say: { text: 'designing roof', at: SERVER_NOW }, note: { text: 'shell committed', at: SERVER_NOW } })));
  const sprite = label(h), texture = sprite.material.map, canvas = texture!.image as HTMLCanvasElement;
  assert.equal(canvas.height, 132); assert.equal(h.sites.inspect().sites[0].text.split('\n')[2], 'shell committed');
  const shader = compiled(sprite.material, 'sprite'); assert.equal(shader.uniforms.uBuildCaptionTop.value, 1 / 3);
  assert.match(shader.fragmentShader, /vMapUv.y < uBuildCaptionTop/);
  const redraws = h.sites.stats.labelRedraws;
  h.advance(4000); assert.equal(shader.uniforms.uBuildCaptionAlpha.value, 1);
  h.advance(1000); assert.equal(shader.uniforms.uBuildCaptionAlpha.value, 0.5); assert.equal(h.sites.stats.labelRedraws, redraws);
  h.sites.apply(edge(delta(2), SERVER_NOW + 5000)); assert.equal(h.sites.stats.labelRedraws, redraws);
  h.advance(1000); assert.equal(shader.uniforms.uBuildCaptionAlpha.value, 0); assert.doesNotMatch(h.sites.inspect().sites[0].text, /shell committed/);
  // The canvas shrank to two lines: same canvas, a fresh texture (WebGL texture storage keeps its first size).
  assert.equal(h.sites.stats.labelRedraws, redraws + 1); assert.notEqual(sprite.material.map, texture); assert.equal(sprite.material.map!.image, canvas); assert.equal(canvas.height, 88); assert.equal(h.canvases, 1);
  h.sites.apply(edge(delta(3, { note: { text: 'next batch', at: SERVER_NOW + 6000 } }), SERVER_NOW + 6000));
  assert.match(h.sites.inspect().sites[0].text, /next batch$/); assert.equal(shader.uniforms.uBuildCaptionAlpha.value, 1);
  h.sites.siteStyle('ring,label,outline,sheen,wheel'); assert.equal(h.sites.inspect().sites[0].draws, 6);
  h.sites.reset([site({ rev: 10, note: { text: 'stale caption', at: SERVER_NOW } })], 10, SERVER_NOW + 6000);
  assert.doesNotMatch(h.sites.inspect().sites[0].text, /stale caption/); h.sites.dispose();
});

for (const skew of [-600_000, 600_000]) test(`paused closure uses world time and reopens exactly at reopensAt despite ${skew / 60_000} min skew`, () => {
  const original = Date.now; Date.now = () => SERVER_NOW + skew;
  const h = harness();
  try {
    h.sites.setWorldClock('2026-10-15T23:50:00', 24);
    h.sites.apply(start(site({ status: 'paused', reopensAt: SERVER_NOW + 30 * 60_000 })));
    assert.match(h.sites.inspect().sites[0].text, /open again Fri · 11:50 am/);
    h.advance(5 * 60_000);
    h.sites.apply(edge(delta(2, { status: 'paused', lastAt: SERVER_NOW + 5 * 60_000 }), SERVER_NOW + 5 * 60_000));
    assert.match(h.sites.inspect().sites[0].text, /open again Fri · 11:50 am/);
    h.advance(25 * 60_000 - 1); assert.match(h.sites.inspect().sites[0].text, /open again/);
    h.advance(1); assert.match(h.sites.inspect().sites[0].text, /paused · open$/);
    h.sites.apply(edge(delta(3, { status: 'paused', closed: true, reopensAt: SERVER_NOW + 31 * 60_000 }), SERVER_NOW + 30 * 60_000));
    assert.match(h.sites.inspect().sites[0].text, /open again Fri · 12:14 pm/);
    h.sites.apply(edge(delta(4, { status: 'paused', closed: false }), SERVER_NOW + 30 * 60_000));
    assert.match(h.sites.inspect().sites[0].text, /paused · open$/);
  } finally { h.sites.dispose(); Date.now = original; }
});

test('closure label acquires the real world clock after snapshot and follows shared clock/rate edits', () => {
  const h = harness(); h.sites.apply(start(site({ status: 'paused', reopensAt: SERVER_NOW + 60_000 })));
  assert.doesNotMatch(h.sites.inspect().sites[0].text, /open again/);
  h.sites.setWorldClock('2026-10-15T12:00:00', 24); h.advance(0);
  assert.match(h.sites.inspect().sites[0].text, /open again Thu · 12:24 pm/);
  h.sites.setWorldClock('2026-10-15T18:00:00', 1); h.advance(0);
  assert.match(h.sites.inspect().sites[0].text, /open again Thu · 6:01 pm/);
  h.sites.dispose();
});

test('one adapter handles start/resume, deltas, multi-build diffs, snapshot/API rev, and the singular brief alias', () => {
  assert.equal(parseBuildFeed(start())?.records[0].id, 'church');
  assert.equal(parseBuildFeed(edge(delta(2)))?.records[0].rev, 2);
  assert.equal(parseBuildFeed(diff([delta(2), delta(3, { id: 'annex' })]))?.records.length, 2);
  assert.equal(parseBuildFeed({ builds: [site()], buildsRev: 17, now: SERVER_NOW })?.rev, 17);
  assert.equal(parseBuildFeed({ builds: [site()], rev: 17, now: SERVER_NOW })?.reset, true);
  assert.equal(parseBuildFeed({ kind: 'world-diff', build: site(), at: SERVER_NOW })?.now, SERVER_NOW);
  assert.equal(parseBuildFeed({ ...start(), rev: 2 }), null);
  assert.equal(parseBuildFeed({ builds: [delta(2)], rev: 2 }), null);
  assert.equal(parseBuildFeed({ builds: [], buildsRev: NaN }), null);
  assert.equal(parseBuildFeed({ kind: 'something-else' }), null);
});

test('apply/reset are idempotent by world rev and snapshot buildsRev suppresses old edge-buffer messages', () => {
  const h = harness(); h.sites.apply(start());
  const root = group(h), geometry = marker(h).geometry;
  h.sites.apply(start()); h.sites.reset([site({ title: 'stale' })], 1, SERVER_NOW);
  assert.equal(h.sites.stats.applied, 1); assert.equal(group(h), root); assert.equal(marker(h).geometry, geometry); assert.equal(h.paints, 1);
  h.sites.reset([site({ rev: 10, step: { n: 3, of: 6, label: 'roof' } })], 10, SERVER_NOW);
  h.sites.apply(edge(delta(2))); h.sites.apply(start());
  assert.equal(h.sites.maxRev, 10); assert.match(h.sites.inspect().sites[0].text, /roof 3\/6/);
  h.sites.reset([], 9, SERVER_NOW); assert.equal(h.sites.group.children.length, 1);
  h.sites.dispose();
});

test('a missed start (10) followed by 11 coalesces exactly one refetch and replays deltas newer than the fetched snapshot', async () => {
  let resolve!: (v: unknown) => void, calls = 0;
  const h = harness('ring,label', { fetchBuilds: () => { calls++; return new Promise(r => { resolve = r; }); } });
  h.sites.reset([], 9, SERVER_NOW);
  for (let i = 0; i < 5; i++) h.sites.apply(edge(delta(11, { step: { n: 3, label: 'roof', of: 6 } })));
  await Promise.resolve(); assert.equal(calls, 1); assert.equal(h.sites.stats.refetches, 1);
  const request = h.sites.resync(); resolve({ now: SERVER_NOW, rev: 10, builds: [site({ rev: 10 })] }); await request;
  assert.equal(h.sites.maxRev, 11); assert.match(h.sites.inspect().sites[0].text, /roof 3\/6/);
  h.sites.apply(edge(delta(11))); assert.equal(calls, 1); h.sites.dispose();
});

test('the seq poll repairs a lost last message; failed refetches back off, disposal prevents late resurrection', async () => {
  let calls = 0;
  const h = harness('ring', { fetchBuilds: async () => { calls++; if (calls === 1) throw Error('offline fixture'); return { rev: 4, now: SERVER_NOW, builds: [site({ rev: 4 })] }; } });
  h.sites.reset([], 0, SERVER_NOW); h.sites.checkRevision(4); await h.sites.resync();
  for (let i = 0; i < 10; i++) h.sites.checkRevision(4);
  await Promise.resolve(); assert.equal(calls, 1);
  h.advance(20_001); h.sites.checkRevision(4); await h.sites.resync(); assert.equal(h.sites.maxRev, 4);
  h.sites.checkRevision(3); assert.equal(calls, 2); h.sites.dispose();
  let finish!: (v: unknown) => void;
  const late = harness('ring', { fetchBuilds: () => new Promise(r => { finish = r; }) });
  late.sites.checkRevision(5); await Promise.resolve(); const p = late.sites.resync(); late.sites.dispose();
  finish({ rev: 5, now: SERVER_NOW, builds: [site({ rev: 5 })] }); await p; assert.equal(late.sites.group.children.length, 0);
});

test('gap recovery recounts buffered roots against installed geometry and preserves the original deadline', async () => {
  let resolve!: (v: unknown) => void;
  const h = harness('ring', { fetchBuilds: () => new Promise(r => { resolve = r; }) });
  const e = entity('e_root'); h.model.entities.set(e.id, e); h.model.boxes.set(e.id, [{ c: [103, 19], half: [1, 1], yaw: 0, y0: 0, y1: 1 }]);
  h.sites.reset([], 9, SERVER_NOW);
  h.sites.apply(diff([delta(11, { rootsAdded: [e.id] })], [e]));
  await Promise.resolve(); const request = h.sites.resync(); h.advance(30_000);
  h.sites.apply(diff([delta(11, { rootsAdded: [e.id] })], [e])); // repeated edge buffer must not reset receipt time
  resolve({ builds: [site({ rev: 10 })], rev: 10, now: SERVER_NOW + 30_000 }); await request;
  assert.deepEqual(h.sites.inspect().sites[0].parts, [1, 0, 0]);
  h.advance(569_999); assert.equal(h.sites.inspect().sites[0].paused, false);
  h.advance(1); assert.equal(h.sites.inspect().sites[0].paused, true);
  h.sites.dispose();
});

for (const skew of [-600_000, 600_000]) test(`pause and alive deadline use server now with ${skew / 60_000} min wall-clock skew`, () => {
  const realDateNow = Date.now; Date.now = () => SERVER_NOW + skew;
  const h = harness();
  try {
    h.sites.apply(start()); const color = marker(h).geometry.getAttribute('color').getX(0);
    h.advance(599_999); assert.equal(h.sites.inspect().sites[0].paused, false);
    h.sites.apply(edge(delta(2, { lastAt: SERVER_NOW + 599_999 }), SERVER_NOW + 599_999));
    h.advance(599_999); assert.equal(h.sites.inspect().sites[0].paused, false);
    h.advance(1); assert.equal(h.sites.inspect().sites[0].paused, true); assert.match(h.sites.inspect().sites[0].text, /paused 0 min/);
    assert.notEqual(marker(h).geometry.getAttribute('color').getX(0), color);
    h.advance(12 * 60_000); assert.match(h.sites.inspect().sites[0].text, /paused 12 min/);
    h.sites.apply(edge(delta(3, { status: 'paused', closed: false }), SERVER_NOW + 2_000_000)); assert.match(h.sites.inspect().sites[0].text, /paused · open/);
  } finally { h.sites.dispose(); Date.now = realDateNow; }
});

// Release 1.1 walk: after `build step --say` the label grew to two lines on the same CanvasTexture; Chrome refused the
// upload (glCopySubTextureCHROMIUM: Offset overflow) and a visitor kept the old one-line "paused" label, stretched.
test('a label that changes size gets a fresh texture (the old one disposed once) carrying exactly the new text', () => {
  const painted: string[][] = []; let frame: string[] = [];
  const canvas = fakeCanvas(((text: string) => { frame.push(text); }) as () => void);
  const context = canvas.getContext('2d')! as unknown as { roundRect: () => void };
  context.roundRect = () => { frame = []; painted.push(frame); };
  const sites = new WorldBuildSites({ model: () => fakeModel(), groundAt: () => 0, now: () => 1000, createCanvas: () => canvas, search: '?sites=ring,label' });
  const sprite = () => sites.group.children[0].children.find(o => o instanceof THREE.Sprite) as THREE.Sprite;
  sites.apply(start(site({ title: 'Release walk lighthouse', step: { n: 1, label: 'massing', of: 3 } })));
  const first = sprite().material.map!; let disposed = 0; first.addEventListener('dispose', () => disposed++);
  assert.deepEqual(painted.at(-1), ['Release walk lighthouse · massing 1/3']); assert.equal(canvas.height, 44);
  sites.apply(edge(delta(2, { step: { n: 1, label: 'massing', of: 3 }, say: { text: 'raising the lighthouse tower', at: SERVER_NOW }, designing: ['nave'] })));
  const second = sprite().material.map!;
  assert.notEqual(second, first); assert.equal(disposed, 1); assert.equal(second.image, canvas); assert.equal(second.colorSpace, THREE.SRGBColorSpace);
  assert.ok(second.version > 0, 'the fresh texture uploads the new canvas'); assert.equal(canvas.height, 88);
  assert.deepEqual(painted.at(-1), ['Release walk lighthouse · massing 1/3', 'designing: raising the lighthouse tower']);
  assert.deepEqual(painted.at(-1), sites.inspect().sites[0].text.split('\n'));
  // same size again (another narration of equal length): the texture is reused, only re-uploaded
  const version = second.version;
  sites.apply(edge(delta(3, { say: { text: 'raising the lighthouse lamps', at: SERVER_NOW } })));
  assert.equal(sprite().material.map, second); assert.ok(second.version > version); assert.match(painted.at(-1)![1], /lamps$/);
  sites.dispose(); assert.equal(disposed, 1);
});

const walkFeed = () => JSON.parse(readFileSync(new URL('../../server/src/god/fixtures/build-messages.json', import.meta.url), 'utf8')).walk as { type: string; kind: string; event?: string; now: number; rev?: number; seq?: number }[];
// R2F: the server's own feed for the walk (apps/server/src/god/builds.test.ts "R2F", fixtures/build-messages.json `walk`):
// started, paused after a 12-minute look, the lead's step --say (resumed + step), reads (alive) and more steps, a committed
// batch with a note, a step. Production defaults: 10 min pause, 30 min closure. Delivered in order at server time, no reload.
test('visitors apply the real step feed live: narration and pulse appear, "paused" never shows while narrating, and the batch moves reopensAt', () => {
  const walk = walkFeed(), T0 = walk[0].now; let mono = 1000;
  const sites = new WorldBuildSites({ model: () => fakeModel(), groundAt: () => 0, now: () => mono, createCanvas: () => fakeCanvas(), search: '?sites=ring,label' });
  const at = (serverMs: number) => { mono = 1000 + serverMs - T0; sites.update(mono); };
  const text = () => sites.inspect().sites[0]?.text ?? '';
  const pulse = () => { const faces = sites.group.children[0].children[1] as THREE.Mesh; return Array.from(faces.geometry.getAttribute('buildDesigning').array).some(n => n === 1); };
  sites.setWorldClock('2026-10-15T21:00:00', 1); // the world's clock at the build's start (T0)
  const seen: string[] = []; let narrating = false;
  for (const m of walk) {
    // between messages the viewer runs on its own clock, sampled every 10 s of real time
    for (let t = mono - 1000 + T0 + 10_000; t < m.now; t += 10_000) {
      at(t);
      if (narrating) { assert.doesNotMatch(text(), /paused|quiet/, `while narrating at +${(t - T0) / 1000}s: ${text()}`); assert.match(text().split('\n')[1], /^designing: /); assert.ok(pulse() || !/Raising/.test(text())); }
    }
    at(m.now); sites.apply(m); seen.push(`${m.kind === 'world-diff' ? 'diff' : m.event}: ${text()}`);
    if (m.event === 'step') narrating = true;
    if (m.event === 'paused') assert.match(text(), /^Release walk lighthouse · massing 1\/3 · paused 2 min · open again Thu · 9:30 pm$/, 'what the walk saw, legitimately: the build was paused');
    if (m.event === 'step' && /Raising/.test(JSON.stringify(m))) {
      assert.equal(text(), 'Release walk lighthouse · massing 1/3\ndesigning: Raising the lighthouse tower'); assert.equal(pulse(), true, 'the tower mass pulses');
    }
    if (m.kind === 'world-diff') { assert.equal(text().split('\n').at(-1), 'Placed the lighthouse'); assert.match(text(), /\ndesigning: Designing course 2\n/); }
  }
  assert.deepEqual(seen.map(line => line.split(':')[0]), ['started', 'paused', 'resumed', 'step', 'alive', 'step', 'alive', 'step', 'alive', 'step', 'diff', 'step']);
  assert.equal(sites.maxRev, 12); assert.equal(sites.stats.refetches, 0, 'contiguous revisions: no snapshot refetch, no reload');
  // the lead stops: narration (8 min) ends before the pause (10 min after the last activity) — then paused, closed until
  // the committed batch's deadline (T0 + 25 min + 30 min = 9:55 pm world time), not the start's 9:30 pm
  const lastStep = walk.at(-1)!.now;
  at(lastStep + 8 * 60_000 - 1); assert.doesNotMatch(text(), /paused/); assert.match(text(), /designing: Shaping the lantern/);
  at(lastStep + 10 * 60_000); assert.equal(text(), 'Release walk lighthouse · tower 2/3 · paused 0 min · open again Thu · 9:55 pm');
  sites.dispose();
});

// R2F: a visitor receives that feed through WorldEntityLayer.applyEdge, which LiveWorld calls every frame with the whole
// edge buffer: world-build messages pass only when rev > maxRev, the diff (and its build delta) only in seq order.
test('the walk feed through the visitor entry point (applyEdge, the buffer re-sent every frame) gives the same labels, maxRev 12, no resync', async () => {
  const { WorldEntityLayer } = await entityLayerFixture();
  const walk = walkFeed(), T0 = walk[0].now; let mono = 1000;
  const direct = new WorldBuildSites({ model: () => fakeModel(), groundAt: () => 0, now: () => mono, createCanvas: () => fakeCanvas(), search: '?sites=ring,label' });
  const layer = new WorldEntityLayer(p => p); layer.sites.siteStyle('ring,label');
  const internals = layer as unknown as { model: WorldModel; seq: number; now: number; sites: { clock: () => number; options: { createCanvas: () => HTMLCanvasElement } } };
  internals.model = new WorldModel({ constants: { ground: 'land' }, seed: 'offline-walk-feed' }); internals.seq = 0; internals.now = 1000; layer.active = true;
  internals.sites.clock = () => mono; internals.sites.options.createCanvas = () => fakeCanvas();
  let resyncs = 0; layer.resync = async () => { resyncs++; };
  for (const s of [direct, layer.sites]) s.setWorldClock('2026-10-15T21:00:00', 1);
  const labels = { direct: [] as string[], layer: [] as string[] };
  for (const [i, m] of walk.entries()) {
    mono = 1000 + m.now - T0; direct.update(mono); layer.update(0, mono);
    direct.apply(m); labels.direct.push(direct.inspect().sites[0]?.text ?? '');
    const buffer = walk.slice(0, i + 1);
    layer.applyEdge(buffer); const text = layer.sites.inspect().sites[0]?.text ?? ''; labels.layer.push(text);
    layer.applyEdge(buffer); assert.equal(layer.sites.inspect().sites[0]?.text, text, `re-sending the buffer after ${m.kind === 'world-diff' ? 'the diff' : m.event} changes nothing`);
  }
  assert.deepEqual(labels.layer, labels.direct);
  assert.equal(labels.layer[3], 'Release walk lighthouse · massing 1/3\ndesigning: Raising the lighthouse tower'); assert.equal(labels.layer[10].split('\n').at(-1), 'Placed the lighthouse');
  assert.equal(layer.sites.maxRev, 12); assert.equal(layer.sites.stats.refetches, 0); assert.equal(resyncs, 0, 'no world resync');
  assert.equal(layer.stats.edgeSeen, 1); assert.equal(layer.stats.applied, 1); assert.equal(layer.stats.lastError, null);
  assert.ok(internals.model.entities.has('e_0df38658'), 'the diff\'s upsert reached the model');
  direct.dispose(); layer.dispose();
});

test('one canvas per site, one texture per label size; ordinary frames and alive/claim updates do not repaint unchanged text', () => {
  const h = harness(); h.sites.apply(start());
  const sprite = group(h).children.find(o => o instanceof THREE.Sprite) as THREE.Sprite, texture = sprite.material.map;
  for (let i = 0; i < 1000; i++) h.advance(16);
  h.sites.apply(edge(delta(2))); h.sites.apply(edge(delta(3, { claim: { part: 'tower', status: 'held' } })));
  assert.equal(h.canvases, 1); assert.equal(h.paints, 1); assert.equal(sprite.material.map, texture);
  h.advance(180_000); assert.match(h.sites.inspect().sites[0].text, /quiet 3 min/); assert.equal(h.paints, 2);
  const wider = sprite.material.map; assert.notEqual(wider, texture, 'a wider label gets its own texture');
  h.advance(60_000); assert.match(h.sites.inspect().sites[0].text, /quiet 4 min/); assert.equal(h.paints, 3);
  assert.equal(sprite.material.map, wider, 'a same-size repaint reuses the texture');
  h.sites.apply(edge(delta(4, { step: { n: 3, of: 6, label: 'roof' } })));
  assert.equal(h.paints, 4); assert.equal(h.canvases, 1); assert.equal(sprite.material.map!.image, texture!.image);
  h.sites.dispose();
});

test('label clears the tallest roof, stays above ghosts, and follows real roots even when massing was declared', () => {
  const h = harness(); h.sites.apply(start());
  const sprite = label(h); faces(h).geometry.computeBoundingBox();
  assert.ok(sprite.position.y > faces(h).geometry.boundingBox!.max.y + 0.7);
  assert.equal(sprite.center.y, 0, 'screen-size growth must go upward from the content top');
  assert.equal(sprite.material.depthTest, false); assert.ok(sprite.renderOrder > faces(h).renderOrder);
  const root = entity('e_root'); h.model.entities.set(root.id, root);
  h.model.boxes.set(root.id, [{ c: [103, 19], half: [2, 2], yaw: 0.3, y0: 2, y1: 31 }]);
  const d = diff([delta(2, { rootsAdded: [root.id] })], [root]); h.sites.apply(d); h.sites.refitDiff(d);
  assert.equal(label(h), sprite); assert.equal(sprite.position.y, 31.75); assert.equal(h.paints, 1);
  h.model.entities.delete(root.id); h.model.boxes.delete(root.id);
  const removed = diff([delta(3, { rootsRemoved: [root.id] })], [], [root.id]); h.sites.apply(removed); h.sites.refitDiff(removed);
  assert.ok(Math.abs(sprite.position.y - 22.83) < 1e-5, 'last part removal restores the massing roof anchor');
  h.sites.dispose();
});

test('label text has a 14 CSS px floor across camera distance, zoom, and viewport height without frame resource churn', () => {
  const h = harness(); h.sites.apply(start()); const sprite = label(h), texture = sprite.material.map, scene = new THREE.Scene();
  const geometries = group(h).children.map(o => (o as THREE.Mesh).geometry), material = sprite.material;
  let height = 800, target: THREE.Vector2 | undefined;
  const renderer = { getSize(v: THREE.Vector2) { if (target) assert.equal(v, target, 'reuses one scratch viewport'); target = v; return v.set(1352, height); } } as unknown as THREE.WebGLRenderer;
  for (const camera of [new THREE.PerspectiveCamera(45, 1352 / 800, 0.1, 10000), new THREE.OrthographicCamera(-60, 60, 40, -40, 0.1, 10000)]) {
    for (height of [400, 800, 1600]) for (const zoom of [0.5, 1, 2]) for (const distance of [2, 100, 1000]) {
      camera.zoom = zoom; camera.updateProjectionMatrix(); camera.position.set(sprite.position.x, sprite.position.y, sprite.position.z + distance); camera.lookAt(sprite.position); camera.updateMatrixWorld(true);
      sprite.updateMatrixWorld(true); sprite.onBeforeRender(renderer, scene, camera, sprite.geometry, sprite.material, null!);
      const pixels = sprite.scale.y * camera.projectionMatrix.elements[5] * height / (2 * (camera instanceof THREE.PerspectiveCamera ? distance : 1)) * 28 / 44;
      assert.ok(pixels >= 14 - 1e-6, `${distance}m / ${height}px / zoom ${zoom}: ${pixels}px text`);
      assert.ok(sprite.scale.y >= 1.2); assert.equal(sprite.position.y, 22.83);
    }
  }
  assert.equal(h.canvases, 1); assert.equal(h.paints, 1); assert.equal(sprite.material, material); assert.equal(sprite.material.map, texture);
  group(h).children.forEach((o, i) => assert.equal((o as THREE.Mesh).geometry, geometries[i]));
  h.sites.dispose();
});

test('explicit pause greys immediately and alive restores amber without editing any entity', () => {
  const h = harness(); h.sites.apply(start());
  const amber = marker(h).geometry.getAttribute('color').getX(0);
  h.sites.apply(edge(delta(2, { status: 'paused' }))); assert.notEqual(marker(h).geometry.getAttribute('color').getX(0), amber);
  h.sites.apply(edge(delta(3, { lastAt: SERVER_NOW + 1 }), SERVER_NOW + 1)); assert.equal(marker(h).geometry.getAttribute('color').getX(0), amber);
  h.sites.dispose();
});

test('held removals use PRE-batch ancestry/roots, and post-batch added members receive refinement', () => {
  const h = harness();
  const root = entity('e_root'), child = entity('e_child', root.id), deep = entity('e_deep', child.id), outside = entity('e_outside');
  for (const e of [root, child, deep, outside]) h.model.entities.set(e.id, e);
  h.sites.apply(start(site({ roots: [root.id] })));
  const d = diff([delta(2, { rootsRemoved: [root.id], rootsAdded: ['e_new'] })], [entity('e_new')], [root.id, child.id, deep.id, outside.id]);
  assert.deepEqual(h.sites.heldRemovals(d, h.model), new Set([root.id, child.id, deep.id]));
  assert.equal(h.sites.heldRemovals(diff([], [], [child.id]), h.model).size, 0);
  h.sites.apply(d);
  for (const id of d.diff.removes) h.model.entities.delete(id);
  for (const e of d.diff.upserts) h.model.entities.set(e.id, e);
  assert.equal(h.sites.memberOf(d.diff.upserts[0], h.model)?.id, 'church');
  assert.deepEqual(h.sites.refinement(d.diff.upserts[0], h.model), { scale: 0.9, seconds: 1.2, removalDelaySeconds: 1.5 });
  assert.equal(h.sites.memberOf(child, h.model), null);
  h.sites.apply(edge(delta(3, { status: 'paused' }))); assert.equal(h.sites.refinement(d.diff.upserts[0], h.model), null);
  h.sites.dispose();
});

test('massing is merged at start/snapshot; per-mass coverage fades faces and restores them on removal', () => {
  const h = harness(); h.model.entities.set('e_root', entity('e_root'));
  const masses = site().massing; masses[0] = { at: [0, 0], size: [16, 8], h: 10, roof: 'gable' };
  h.sites.reset([site({ roots: ['e_root'], massing: masses })], 1, SERVER_NOW);
  const mesh = faces(h), geometry = mesh.geometry, colors = geometry.getAttribute('color');
  assert.equal(mesh.material.depthWrite, false); assert.equal(colors.itemSize, 4); assert.ok(Math.abs(colors.getW(0) - 0.35) < 1e-6);
  geometry.computeBoundingBox(); assert.ok(Math.abs(geometry.boundingBox!.max.y - 22.08) < 1e-4);
  assert.equal(h.sites.inspect().sites[0].draws, 4);
  for (let i = 1; i <= 4; i++) {
    const e = entity(`e_part${i}`, 'e_root'); h.model.entities.set(e.id, e); h.model.boxes.set(e.id, [{ c: [103, 11 + i * 4 - 2], half: [2, 4], yaw: -Math.PI / 2, y0: 0, y1: 14 }]);
    const d = diff([delta(i + 1)], [e]); h.sites.apply(d); h.sites.refitDiff(d);
    assert.equal(h.sites.inspect().sites[0].coverage[0], i / 4);
    assert.ok(Math.abs(colors.getW(0) - 0.35 * Math.max(0, 1 - i / 4 / 0.6)) < 1e-6);
    assert.equal(faces(h).geometry, geometry);
  }
  assert.equal(mesh.visible, true, 'towers still have ghost faces');
  assert.deepEqual(h.sites.inspect().sites[0].parts, [4, 0, 0]);
  assert.deepEqual(h.sites.inspect().sites[0].coverage, [1, 0, 0]);
  assert.ok(marker(h).geometry.getAttribute('position').count > 64, 'massing edges persist after nave faces reach zero');
  const removed = ['e_part2', 'e_part3', 'e_part4']; for (const id of removed) { h.model.entities.delete(id); h.model.boxes.delete(id); }
  const d = diff([delta(6)], [], removed); h.sites.apply(d); h.sites.refitDiff(d); assert.ok(colors.getW(0) > 0);
  assert.deepEqual(h.sites.inspect().sites[0].coverage, [0.25, 0, 0]);
  h.sites.dispose();
});

test('coverage respects site/mass/OBB yaws; frames, alive messages and unrelated diffs do not resample it', () => {
  const h = harness(); const root = entity('e_root'); h.model.entities.set(root.id, root);
  h.model.boxes.set(root.id, [{ c: [103, 23], half: [1, 3], yaw: 0, y0: 0, y1: 3 }]);
  h.sites.apply(start(site({ roots: [root.id], massing: [{ at: [4, 0], size: [2, 6], yaw: Math.PI / 2, h: 3 }] })));
  assert.deepEqual(h.sites.inspect().sites[0].parts, [1]);
  assert.deepEqual(h.sites.inspect().sites[0].coverage, [1]);
  let reads = 0; const footprints = h.model.footprintsOf; h.model.footprintsOf = id => { reads++; return footprints(id); };
  const faceGeometry = faces(h).geometry, markerGeometry = marker(h).geometry;
  h.model.boxes.set(root.id, [{ c: [120, 23], half: [0.2, 0.2], yaw: 0, y0: 0, y1: 1 }]);
  h.sites.apply(edge(delta(2))); assert.deepEqual(h.sites.inspect().sites[0].parts, [1]);
  for (let i = 0; i < 100; i++) h.advance(16);
  h.sites.refitDiff(diff([], [root]));
  assert.equal(reads, 0); assert.equal(faces(h).geometry, faceGeometry); assert.equal(marker(h).geometry, markerGeometry);
  assert.deepEqual(h.sites.inspect().sites[0].coverage, [1]);
  const d = diff([delta(3)], [root]); h.sites.apply(d); h.sites.refitDiff(d); assert.deepEqual(h.sites.inspect().sites[0].parts, [0]);
  assert.deepEqual(h.sites.inspect().sites[0].coverage, [0]);
  h.sites.dispose();
});

test('one real 31 m tower fills its 28 m pyramid mass while an empty mass survives later build steps', () => {
  const h = harness(); const root = entity('e_tower'); h.model.entities.set(root.id, root);
  h.sites.apply(start(site({ roots: [root.id], massing: [{ at: [0, 0], size: [4, 4], h: 28, roof: 'pyramid' }, { at: [8, 0], size: [4, 4], h: 12 }] })));
  h.model.boxes.set(root.id, [{ c: [103, 19], half: [2, 2], yaw: -Math.PI / 2, y0: 0, y1: 31 }]);
  const d = diff([delta(2, { step: { n: 6, of: 6, label: 'details' } })], [root]); h.sites.apply(d); h.sites.refitDiff(d);
  assert.deepEqual(h.sites.inspect().sites[0].coverage, [1, 0]);
  const colors = faces(h).geometry.getAttribute('color'), lines = marker(h).geometry.getAttribute('color');
  assert.equal(colors.getW(0), 0); assert.ok(Math.abs(colors.getW(colors.count - 1) - 0.35) < 1e-6);
  assert.equal(lines.itemSize, 4); assert.equal(ground(h).geometry.getAttribute('color').itemSize, 4); assert.equal(marker(h).material.opacity, 1);
  assert.ok(Math.abs(ground(h).geometry.getAttribute('color').getW(0) - 0.95) < 1e-6, 'plot marker stays bright');
  assert.ok(Math.abs(lines.getW(0) - 0.06) < 1e-6, 'filled tower edges are faint in the same draw');
  assert.ok(Math.abs(lines.getW(lines.count - 1) - 0.95) < 1e-6, 'empty plan stays bright');
  const alphas = Array.from({ length: lines.count }, (_, i) => lines.getW(i));
  h.sites.apply(edge(delta(3, { status: 'paused' })));
  assert.deepEqual(Array.from({ length: lines.count }, (_, i) => lines.getW(i)), alphas, 'pause only changes the tint');
  assert.equal(h.sites.inspect().sites[0].draws, 4); h.sites.dispose();
});

test('a low nave in a taller gabled plan retains only faint faces and an outline', () => {
  const h = harness(); const root = entity('e_nave'); h.model.entities.set(root.id, root);
  h.model.boxes.set(root.id, [{ c: [103, 19], half: [13, 6], yaw: -Math.PI / 2, y0: 0, y1: 9 }]);
  h.sites.apply(start(site({ roots: [root.id], massing: [{ at: [0, 0], size: [26, 12], h: 15, roof: 'gable' }] })));
  assert.deepEqual(h.sites.inspect().sites[0].coverage, [0.5], 'roof volume contributes to the denominator');
  assert.ok(Math.abs(faces(h).geometry.getAttribute('color').getW(0) - 0.05833333) < 1e-6);
  assert.ok(Math.abs(marker(h).geometry.getAttribute('color').getW(0) - 0.18515625) < 1e-6);
  assert.equal(h.sites.inspect().sites[0].draws, 4); h.sites.dispose();
});

test('face fade ends at 60% and edge fade reaches a 0.06 outline at 80%, independent of part count', () => {
  const h = harness(); const root = entity('e_root'); h.model.entities.set(root.id, root);
  h.sites.apply(start(site({ roots: [root.id], massing: [{ at: [0, 0], size: [8, 8], h: 10 }] })));
  const cases = [[0.2, 0.23333333, 0.560625], [0.4, 0.11666667, 0.2825], [0.6, 0, 0.115625], [0.8, 0, 0.06], [1, 0, 0.06]];
  for (let i = 0; i < cases.length; i++) {
    const [coverage, faceAlpha, edgeAlpha] = cases[i];
    h.model.boxes.set(root.id, [{ c: [103, 19], half: [4, 4], yaw: 0, y0: 0, y1: coverage * 10 }]);
    const d = diff([delta(i + 2)], [root]); h.sites.apply(d); h.sites.refitDiff(d);
    assert.ok(Math.abs(h.sites.inspect().sites[0].coverage[0] - coverage) < 1e-12);
    assert.ok(Math.abs(faces(h).geometry.getAttribute('color').getW(0) - faceAlpha) < 1e-6);
    assert.ok(Math.abs(marker(h).geometry.getAttribute('color').getW(0) - edgeAlpha) < 1e-6);
    assert.equal(faces(h).visible, coverage < 0.6); assert.equal(h.sites.inspect().sites[0].draws, coverage < 0.6 ? 4 : 3);
  }
  h.sites.dispose();
});

test('coverage unions overlapping/nested subtree OBBs and clips footprints/heights without bridging vertical gaps', () => {
  const h = harness(); const root = entity('e_prefab'), child = entity('e_member', root.id), unrelated = entity('e_elsewhere');
  for (const e of [root, child, unrelated]) h.model.entities.set(e.id, e);
  const box = { c: [-6, 0] as [number, number], half: [6, 4] as [number, number], yaw: 0 };
  h.model.boxes.set(root.id, [{ ...box, y0: -2, y1: 4 }]);
  h.model.boxes.set(child.id, [{ ...box, y0: 2, y1: 6 }, { ...box, y0: 2, y1: 6 }, { ...box, y0: 8, y1: 12 }, { ...box, c: [6, 0], y0: 10, y1: 20 }]);
  h.model.boxes.set(unrelated.id, [{ c: [0, 0], half: [4, 4], yaw: 0, y0: 0, y1: 10 }]);
  h.sites.apply(start(site({ site: { at: [0, 0], size: [26, 14], yaw: 0 }, roots: [root.id, child.id], massing: [{ at: [0, 0], size: [8, 8], h: 10 }] })));
  // r2.1: one entity's boxes fill their plan hull (x −12..12 here), so the member covers the whole base in [2,6] and
  // [8,10] (its 6–8 gap stays open); the root adds [0,2] on the left half: (8 + 6) / 2 / 10 = 0.7 (was 0.4 box-by-box)
  assert.deepEqual(h.sites.inspect().sites[0].coverage, [0.7], 'hull per entity, vertical gaps unbridged; duplicate roots/OBBs and unrelated geometry add nothing');
  const d = diff([delta(2, { rootsRemoved: [root.id, child.id] })]); h.sites.apply(d); h.sites.refitDiff(d);
  assert.deepEqual(h.sites.inspect().sites[0].coverage, [0]); h.sites.dispose();
});

test('rotated OBB footprint coverage is sampled within the mass base at nonzero terrain height', () => {
  const h = harness('ring,label', { groundAt: () => 7 }); const root = entity('e_root'); h.model.entities.set(root.id, root);
  // A 45° square diamond intersects 40 of the 64 cell centres in an 8×8 base.
  h.model.boxes.set(root.id, [{ c: [103, 19], half: [2 * Math.SQRT2, 2 * Math.SQRT2], yaw: Math.PI / 4, y0: 5, y1: 17 }]);
  h.sites.apply(start(site({ roots: [root.id], massing: [{ at: [0, 0], size: [8, 8], h: 10 }] })));
  assert.deepEqual(h.sites.inspect().sites[0].coverage, [0.625]); h.sites.dispose();
});

test('repeated coverage changes reuse faces/materials, dispose replaced marker geometry and release hidden faces once', () => {
  const h = harness(); const root = entity('e_root'); h.model.entities.set(root.id, root);
  h.sites.apply(start(site({ roots: [root.id], massing: [{ at: [0, 0], size: [4, 4], h: 10 }] })));
  const geometry = faces(h).geometry, material = faces(h).material, lineMaterial = marker(h).material;
  const sprite = label(h), resources = [geometry, material, lineMaterial, sprite.material, sprite.material.map!];
  const counts = resources.map(() => 0); resources.forEach((r, i) => r.addEventListener('dispose', () => counts[i]++));
  for (let i = 0; i < 10; i++) {
    const old = marker(h).geometry; let released = 0; old.addEventListener('dispose', () => released++);
    h.model.boxes.set(root.id, [{ c: [103, 19], half: [2, 2], yaw: 0, y0: 0, y1: i % 2 ? 10 : 2 }]);
    const d = diff([delta(i + 2)], [root]); h.sites.apply(d); h.sites.refitDiff(d);
    assert.equal(released, 1); assert.equal(faces(h).geometry, geometry); assert.equal(faces(h).material, material); assert.equal(marker(h).material, lineMaterial);
    assert.ok(h.sites.inspect().sites[0].draws <= 4);
  }
  assert.equal(faces(h).visible, false); assert.deepEqual(counts, resources.map(() => 0));
  const last = marker(h).geometry; let lastReleased = 0; last.addEventListener('dispose', () => lastReleased++);
  h.sites.apply(edge(delta(12, { status: 'done' }))); h.sites.dispose(); h.sites.dispose();
  assert.deepEqual(counts, resources.map(() => 1)); assert.equal(lastReleased, 1);
});

test('outline without massing uses footprint OBBs under empty prefab roots and instanced children', () => {
  const h = harness('outline'); const root = entity('e_prefab'), child = entity('e_instance', root.id);
  h.model.entities.set(root.id, root); h.model.entities.set(child.id, child);
  h.model.boxes.set(child.id, [{ c: [103, 19], half: [4, 2], yaw: Math.PI / 4, y0: 3, y1: 12 }]);
  h.sites.apply(start(site({ roots: [root.id], massing: [] })));
  assert.equal(marker(h).geometry.getAttribute('position').count, 24); marker(h).geometry.computeBoundingBox();
  assert.equal(marker(h).geometry.boundingBox!.min.y, 3); assert.equal(marker(h).geometry.boundingBox!.max.y, 12);
  assert.equal(h.sites.inspect().sites[0].draws, 1);
  h.sites.dispose();
});

test('sheen fits padded mass/roof union at world coordinates and normalizes a single bottom-to-top sweep', () => {
  const h = harness('ring,label,sheen');
  h.sites.apply(start(site({ site: { at: [100, 19], size: [36, 18], yaw: 0 }, massing: [
    { at: [0, 0], size: [24, 12], h: 5, roof: 'gable' },
    { at: [-10, -4], size: [4, 4], h: 20, roof: 'pyramid' },
    { at: [-10, 4], size: [4, 4], h: 20, roof: 'pyramid' },
  ] })));
  const sweep = sheen(h), pos = sweep.geometry.getAttribute('position'), heights = sweep.geometry.getAttribute('aHeight');
  sweep.geometry.computeBoundingBox(); const bounds = sweep.geometry.boundingBox!;
  assert.deepEqual(sweep.position.toArray(), [0, 0, 0]); assert.deepEqual(sweep.scale.toArray(), [1, 1, 1]);
  for (const [value, expected] of [[bounds.min.x, 87.65], [bounds.max.x, 112.35], [bounds.min.z, 12.65], [bounds.max.z, 25.35], [bounds.min.y, -0.27], [bounds.max.y, 22.43]]) assert.ok(Math.abs(value - expected) < 1e-5);
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 12) assert.ok(pos.getX(i) <= 92.35 + 1e-5, 'no tall box wall floating over the nave');
    assert.ok(Math.abs(heights.getX(i) - (pos.getY(i) - bounds.min.y) / (bounds.max.y - bounds.min.y)) < 1e-6);
  }
  assert.equal(sweep.material.depthWrite, false); assert.equal(sweep.material.side, THREE.FrontSide);
  assert.equal(h.sites.inspect().sites[0].draws, 5);
  const geometry = sweep.geometry; h.advance(1000); assert.equal(sweep.geometry, geometry);
  h.sites.apply(edge(delta(2, { status: 'paused' }))); assert.equal(sweep.material.uniforms.uActive.value, 0);
  assert.match(sweep.material.fragmentShader, /0\.006\+uActive\*band\*0\.055/);
  h.sites.dispose();
});

test('sheen prefers rotated root OBBs once parts exist, and disposes replaced geometry', () => {
  const h = harness('ring,label,outline,sheen'); h.sites.apply(start());
  const sweep = sheen(h), old = sweep.geometry; let disposed = 0; old.addEventListener('dispose', () => disposed++);
  const root = entity('e_root'), child = entity('e_child', root.id);
  h.model.entities.set(root.id, root); h.model.entities.set(child.id, child);
  h.model.boxes.set(child.id, [{ c: [140, 31], half: [4, 2], yaw: Math.PI / 2, y0: 3, y1: 12 }]);
  const d = diff([delta(2, { rootsAdded: [root.id] })], [root, child]); h.sites.apply(d); h.sites.refitDiff(d);
  sweep.geometry.computeBoundingBox(); const bounds = sweep.geometry.boundingBox!;
  assert.equal(disposed, 1); assert.equal(sheen(h), sweep);
  for (const [value, expected] of [[bounds.min.x, 137.65], [bounds.max.x, 142.35], [bounds.min.z, 26.65], [bounds.max.z, 35.35], [bounds.min.y, 2.65], [bounds.max.y, 12.35]]) assert.ok(Math.abs(value - expected) < 1e-5);
  assert.equal(label(h).position.y, 12.75); h.sites.dispose();
  const empty = harness('sheen'); empty.sites.apply(start(site({ massing: [] })));
  assert.equal(sheen(empty).visible, false, 'no invented three-metre box when there is no content'); empty.sites.dispose();
});

test('progress wheel is a draped ribbon with an exact n/of arc, including zero, complete, and fractional segments', () => {
  const groundAt = (x: number, z: number) => 0.1 * x + 0.02 * z;
  const h = harness('ring,label,wheel', { groundAt }); h.sites.apply(start());
  let rev = 1;
  for (const [n, of] of [[0, 6], [2, 6], [6, 6], [1, 5]]) {
    h.sites.apply(edge(delta(++rev, { step: { n, of, label: 'shell' } })));
    const ring = wheel(h), pos = ring.geometry.getAttribute('position'), colors = ring.geometry.getAttribute('color');
    const fraction = n / of, count = 96 + (Number.isInteger(fraction * 96) ? 0 : 1);
    let bright = 0, dim = 0;
    for (let i = 0; i < count * 6; i += 6) {
      const angle = (j: number) => (Math.atan2(pos.getX(j) - 103, -(pos.getZ(j) - 19)) + Math.PI * 2) % (Math.PI * 2);
      const a = angle(i), b = angle(i + 2), length = (b - a + Math.PI * 2) % (Math.PI * 2);
      if (colors.getW(i) > 0.9) bright += length; else dim += length;
      const inner = Math.hypot(pos.getX(i) - 103, pos.getZ(i) - 19), outer = Math.hypot(pos.getX(i + 1) - 103, pos.getZ(i + 1) - 19);
      assert.ok(outer - inner > 0.25, 'visible ribbon width, independent of WebGL line width');
    }
    assert.ok(Math.abs(bright / (Math.PI * 2) - fraction) < 1e-6); assert.ok(Math.abs((bright + dim) / (Math.PI * 2) - 1) < 1e-6);
    assert.ok(pos.count > count * 6, 'thick n/of digits in the same mesh');
    for (let i = 0; i < pos.count; i++) assert.ok(Math.abs(pos.getY(i) - groundAt(pos.getX(i), pos.getZ(i)) - 0.14) < 2e-6);
    assert.equal(ring.material.depthTest, false); assert.equal(ring.material.depthWrite, false); assert.equal(ring.material.forceSinglePass, true);
  }
  h.sites.apply(edge(delta(++rev, { status: 'paused' })));
  assert.ok(Math.abs(wheel(h).geometry.getAttribute('color').getX(0) - new THREE.Color('#999fa8').r) < 1e-6);
  h.sites.dispose();
});

test('G2: the ground outline is terrain-draped about every 1.5 m and depth-tested (a building in front hides it), with no depth writes; all overlays carry buildSite hover identity', () => {
  const groundAt = (x: number, z: number) => x * 0.1 + z * 0.02;
  const h = harness('ring,label,sheen,wheel', { groundAt }); h.sites.apply(start(site({ massing: [] })));
  const pos = ground(h).geometry.getAttribute('position'); assert.equal(pos.count, 2 * 2 * (Math.ceil(26 / 1.5) + Math.ceil(14 / 1.5))); assert.equal(ground(h).material.depthTest, true); assert.equal(marker(h).material.depthTest, false); assert.equal(marker(h).geometry.getAttribute('position').count, 0, 'no massing, no edges');
  for (let i = 0; i < pos.count; i++) assert.ok(Math.abs(pos.getY(i) - groundAt(pos.getX(i), pos.getZ(i)) - 0.09) < 2e-6);
  group(h).traverse(o => { assert.equal(o.userData.buildSite, 'church'); assert.equal(o.userData.entity, 'build-site:church'); if ('material' in o) assert.equal((o as THREE.Mesh).material instanceof Array ? false : ((o as THREE.Mesh).material as THREE.Material).depthWrite, false); });
  const target = h.sites.hoverTarget('build-site:church'); assert.equal(target?.name, 'Under construction: Black stone church'); assert.equal(target?.detail, 'shell 2/6');
  assert.equal(h.sites.hoverTarget('other'), null); h.sites.dispose();
});

test('terrain refresh moves ghosts/marker/label together without a new canvas; wheel includes n/of thick stroke digits', () => {
  let height = 0;
  const h = harness('ring,label,wheel', { groundAt: () => height }); h.sites.apply(start());
  const old = faces(h).geometry; let freed = 0; old.addEventListener('dispose', () => freed++);
  const sprite = group(h).children.find(o => o instanceof THREE.Sprite) as THREE.Sprite;
  const ring = wheel(h);
  assert.ok(ring.geometry.getAttribute('position').count > 96 * 6, 'step digits share the wheel draw');
  height = 7; h.sites.refreshAll(true); faces(h).geometry.computeBoundingBox();
  assert.equal(freed, 1); assert.ok(Math.abs(faces(h).geometry.boundingBox!.min.y - 7.08) < 1e-5); assert.ok(Math.abs(sprite.position.y - 29.83) < 1e-5);
  assert.equal(h.canvases, 1); assert.equal(h.paints, 1); h.sites.dispose();
});

test('one runtime switch: default <=3 draws; outline adds zero, sheen/wheel add one each; off is zero', () => {
  const h = harness(); h.sites.apply(start()); assert.equal(h.sites.inspect().sites[0].draws, 4);
  h.sites.siteStyle('ring,label,outline'); assert.equal(h.sites.inspect().sites[0].draws, 4);
  h.sites.siteStyle('ring,label,outline,sheen,wheel'); assert.equal(h.sites.inspect().sites[0].draws, 6);
  const sweep = sheen(h), ring = wheel(h), geometry = ring.geometry, sweepGeometry = sweep.geometry;
  assert.equal(ring.material.forceSinglePass, true, 'transparent double-sided ribbon is one draw');
  h.advance(16); assert.equal(ring.geometry, geometry); assert.equal(sweep.geometry, sweepGeometry); assert.equal(sweep.material.uniforms.uTime.value, h.now() / 1000);
  h.sites.apply(edge(delta(2, { status: 'paused' }))); assert.equal(sweep.material.uniforms.uActive.value, 0);
  h.sites.siteStyle('off'); assert.equal(h.sites.group.visible, false); assert.equal(h.sites.inspect().sites[0].draws, 0); assert.equal(h.sites.hoverTarget('build-site:church'), null);
  h.sites.siteStyle('ring,label'); assert.equal(h.sites.group.visible, true); assert.equal(h.canvases, 1); assert.equal(h.sites.inspect().sites[0].draws, 4);
  h.sites.dispose();
});

test('a client-side pause cannot revive a wheel candidate disabled at runtime', () => {
  const h = harness('ring,label,wheel'); h.sites.apply(start()); h.sites.siteStyle('ring,label');
  h.advance(600_000); assert.equal(h.sites.inspect().sites[0].paused, true); assert.equal(h.sites.inspect().sites[0].draws, 4);
  h.sites.dispose();
});

test('done/abandon/reset dispose each site-owned geometry/material/texture once; shared sheen survives one site', () => {
  const h = harness('ring,label,sheen,wheel'); h.sites.apply(start());
  h.sites.apply(start(site({ id: 'annex', rev: 2 })));
  const first = group(h), disposals = new Map<object, number>();
  first.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !(o instanceof THREE.Sprite)) { disposals.set(mesh.geometry, 0); mesh.geometry.addEventListener('dispose', () => disposals.set(mesh.geometry, disposals.get(mesh.geometry)! + 1)); }
    const material = mesh.material as THREE.Material | undefined;
    if (material && !(material instanceof THREE.ShaderMaterial)) { disposals.set(material, 0); material.addEventListener('dispose', () => disposals.set(material, disposals.get(material)! + 1)); }
    if (o instanceof THREE.Sprite) { const texture = o.material.map!; disposals.set(texture, 0); texture.addEventListener('dispose', () => disposals.set(texture, disposals.get(texture)! + 1)); }
  });
  const shared = (first.children.find(o => o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial) as THREE.Mesh).material as THREE.Material;
  let sharedDisposed = 0; shared.addEventListener('dispose', () => sharedDisposed++);
  h.sites.apply(edge(delta(3, { status: 'done' }))); for (const count of disposals.values()) assert.equal(count, 1);
  assert.equal(sharedDisposed, 0); assert.equal(h.sites.group.children.length, 1);
  h.sites.apply(edge(delta(4, { id: 'annex', status: 'abandoned' }))); assert.equal(h.sites.group.children.length, 0);
  h.sites.dispose(); h.sites.dispose(); assert.equal(sharedDisposed, 1);
  const reset = harness(); reset.sites.apply(start()); reset.sites.reset([], 2, SERVER_NOW); assert.equal(reset.sites.group.children.length, 0); reset.sites.dispose();
});

// Import the real entity layer without Vite's eager mesh-discovery glob. Register a tiny
// local mesh below; no browser, server, remote assets or network are involved in this test.
async function entityLayerFixture() {
  (globalThis as { location?: unknown }).location ??= new URL('http://offline.invalid/w/fixture');
  const index = new URL('./gen-mesh/index.ts', import.meta.url).href;
  const hooks = registerHooks({ load(url, context, next) { return url === index ? { format: 'module', shortCircuit: true, source: "export { meshFor } from './registry.ts';" } : next(url, context); } });
  try { return await import('./WorldEntityLayer.ts'); } finally { hooks.deregister(); }
}

test('real applyDiff holds pre-batch removals 1.5s and gives every upsert (including a child) the 1.2s refinement profile', async () => {
  const { WorldEntityLayer } = await entityLayerFixture();
  const { registerMesh } = await import('./gen-mesh/registry.ts');
  registerMesh({ gen: 'tag:site-test', build: () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()) });
  const layer = new WorldEntityLayer(p => p); layer.sites.siteStyle('ring');
  const model = new WorldModel({ constants: { ground: 'land' }, seed: 'offline-build-sites' });
  model.defineDef({ schema: 'def/1', name: 'fixture', tags: ['site-test'], make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', size: [1, 1, 1], at: [0, 0.5, 0] }] } }, layer: 'decor', size: { box: [1, 1, 1] } }, 'god', 0);
  const root = entity('e_root'), old = entity('e_old', root.id, [0, 0]); model.insert(root); model.insert(old);
  const internals = layer as unknown as { model: WorldModel; seq: number; now: number; draw(e: Entity, ease: boolean): void; drawn: Map<string, { from: { p: THREE.Vector3; s: number }; to: { p: THREE.Vector3 }; t0: number; dur: number; obj: THREE.Object3D }> };
  internals.model = model; internals.seq = 0; internals.now = 1000; layer.active = true;
  layer.sites.apply(start(site({ roots: [root.id], massing: [] })));
  internals.draw(root, false); internals.draw(old, false);
  const newer = entity('e_new', root.id, [1, 0]);
  const d = diff([delta(2)], [root, newer], [old.id]); layer.applyEdge([d]);
  const removed = internals.drawn.get(old.id)!, added = internals.drawn.get(newer.id)!;
  assert.equal(removed.t0, 2500); assert.equal(removed.dur, 0.6);
  assert.equal(added.dur, SITE_REFINEMENT.seconds); assert.equal(added.from.s, 0.9); assert.deepEqual(added.from.p.toArray(), added.to.p.toArray());
  assert.equal(internals.drawn.get(root.id)!.dur, 1.2);
  layer.update(0, 2000); assert.equal(removed.obj.scale.x, 1); assert.equal(removed.obj.position.y, 0);
  layer.update(0, 3100); assert.equal(internals.drawn.has(old.id), false); assert.equal(added.obj.scale.x, 1);
  layer.dispose();
});

test('real applyEdge draws root-subtree OBB outlines alongside declared massing, and moves the label/sheen with root bounds', async () => {
  const { WorldEntityLayer } = await entityLayerFixture();
  const layer = new WorldEntityLayer(p => p); layer.sites.siteStyle('ring,label,outline,sheen');
  const model = new WorldModel({ constants: { ground: 'land' }, seed: 'offline-site-outline' });
  model.defineDef({ schema: 'def/1', name: 'fixture', tags: ['site-test'], make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', size: [8, 6, 4], at: [0, 3, 0] }] } }, layer: 'solid', size: { box: [8, 6, 4] } }, 'god', 0);
  const root: Entity = { ...entity('e_root', 'world', [103, 19]), r: 0.4 };
  const internals = layer as unknown as { model: WorldModel; seq: number; now: number };
  internals.model = model; internals.seq = 0; internals.now = 1000; layer.active = true;
  // Replace only canvas painting; the real layer still consumes and indexes the root diff.
  (layer.sites as unknown as { options: { createCanvas: () => HTMLCanvasElement } }).options.createCanvas = () => fakeCanvas();
  layer.applyEdge([start()]);
  const view = layer.sites.group.children[0] as THREE.Group, marker = view.children[0] as THREE.LineSegments;
  const before = marker.geometry.getAttribute('position').count;
  layer.applyEdge([diff([delta(2, { rootsAdded: [root.id] })], [root])]);
  const boxes = model.footprintsOf(root.id); assert.ok(boxes.length > 0, 'fake root is indexed by applyDiff');
  assert.equal(marker.geometry.getAttribute('position').count, before + 24 * boxes.length, 'OBB edges are added despite existing massing');
  const pos = marker.geometry.getAttribute('position');
  for (const box of boxes) {
    const x = box.c[0] + box.half[0] * Math.cos(box.yaw) + box.half[1] * Math.sin(box.yaw);
    const z = box.c[1] - box.half[0] * Math.sin(box.yaw) + box.half[1] * Math.cos(box.yaw);
    assert.ok(Array.from({ length: pos.count - before }, (_, i) => before + i).some(i => Math.abs(pos.getX(i) - x) < 1e-5 && Math.abs(pos.getY(i) - box.y1) < 1e-5 && Math.abs(pos.getZ(i) - z) < 1e-5), 'rotated root top corner is in the marker draw');
  }
  const sweep = view.children.find(o => o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial) as THREE.Mesh;
  sweep.geometry.computeBoundingBox(); assert.ok(Math.abs(sweep.geometry.boundingBox!.max.y - Math.max(...boxes.map(b => b.y1)) - 0.35) < 1e-5);
  const sprite = view.children.find(o => o instanceof THREE.Sprite) as THREE.Sprite;
  assert.equal(sprite.position.y, Math.max(...boxes.map(b => b.y1)) + 0.75);
  assert.equal(layer.sites.inspect().sites[0].draws, 5); assert.equal(layer.stats.lastError, null);
  layer.sites.siteStyle('ring,label'); assert.equal(marker.geometry.getAttribute('position').count, before);
  assert.equal(layer.sites.inspect().sites[0].draws, 4);
  layer.sites.siteStyle('ring,label,outline,sheen,wheel'); assert.equal(layer.sites.inspect().sites[0].draws, 6);
  layer.dispose();
});

test('r2.1 a finished building of thin walls fills its mass and fades the ghost; separate things are never bridged', () => {
  // A cottage's colliders are four 0.2 m walls round an 8 × 6 plan (the walk measured 0.03–0.05 coverage, faces stayed on).
  const h = harness(); const cottage = entity('e_cottage'), lamp = entity('e_lamp'); h.model.entities.set(cottage.id, cottage); h.model.entities.set(lamp.id, lamp);
  const walls = [{ c: [103, 16.1], half: [4, 0.1] }, { c: [103, 21.9], half: [4, 0.1] }, { c: [99.1, 19], half: [0.1, 3] }, { c: [106.9, 19], half: [0.1, 3] }]
    .map(w => ({ ...w, c: w.c as [number, number], half: w.half as [number, number], yaw: 0, y0: 0, y1: 3 }));
  h.model.boxes.set(cottage.id, walls);
  h.sites.apply(start(site({ site: { at: [103, 19], size: [26, 14], yaw: 0 }, roots: [cottage.id, lamp.id], massing: [{ at: [0, 0], size: [8, 6], h: 3 }, { at: [10, 0], size: [4, 4], h: 3 }] })));
  const [filled, empty] = h.sites.inspect().sites[0].coverage;
  assert.ok(filled > 0.95, `walls enclose the whole mass (coverage ${filled})`); assert.equal(empty, 0);
  assert.equal(faces(h).geometry.getAttribute('color').getW(0), 0, 'the filled mass has no ghost face');
  // a lantern standing in the empty mass covers only its own small box, and never joins the cottage's hull
  h.model.boxes.set(lamp.id, [{ c: [113, 19], half: [0.2, 0.2], yaw: 0, y0: 0, y1: 2 }]);
  const d = diff([delta(2)], [lamp]); h.sites.apply(d); h.sites.refitDiff(d);
  assert.ok(h.sites.inspect().sites[0].coverage[1] < 0.05); h.sites.dispose();
  // rotated walls keep their exact hull in the frame of the largest box; a lone box is returned as is
  const r = Math.PI / 6, rotated = thingEnvelope([{ c: [0, 0], half: [4, 0.1], yaw: r, y0: 0, y1: 3 }, { c: [Math.sin(r) * 2.9, Math.cos(r) * 2.9], half: [4, 0.1], yaw: r, y0: 2.9, y1: 6 }, { c: [0, 0], half: [1, 1], yaw: r, y0: 9, y1: 10 }]);
  assert.equal(rotated.length, 2, 'touching storeys merge; the floating box above keeps its gap');
  assert.ok(Math.abs(rotated[0].half[0] - 4) < 1e-9 && Math.abs(rotated[0].half[1] - 2) < 1e-9 && rotated[0].yaw === r);
  const lone = [{ c: [1, 2] as [number, number], half: [1, 1] as [number, number], yaw: 0.3, y0: 0, y1: 1 }]; assert.equal(thingEnvelope(lone), lone);
});
