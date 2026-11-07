// Ground cover (lane W4): old Eden's field — tall swaying grass, short tufts and wildflowers — drawn by the renderer
// from the world's ground recipe (ground-cover-recipe.ts), never as placed entities. Three instanced draws around
// whichever camera is drawing:
//  - cells of 8 m are dealt once (nearest first, a few milliseconds a frame) and cached; their instances are sorted by
//    a random rank, so a cell contributes a prefix that shrinks with distance (copying, no per-instance work);
//  - in the vertex shader each instance compares its rank with the density its distance allows: the far ones fade out
//    by shrinking (no popping as the camera moves), the survivors grow a little to fill in;
//  - the materials carry `edenWindMode: 'grass'`, so the atmosphere's wind (W2's sway, wind.ts) bends them with the
//    gust waves sweeping over them; flowers keep green stems (instance colour tints only the petals);
//  - nothing from high up, nothing on phones (quality tier) unless `?cover=1`; `?cover=0` turns it off anywhere.
// Edits: the cover index follows the world's areas and footprints; when they change, cached cells are re-dealt in the
// background (nearest first) while the old ones stay drawn.
import * as THREE from 'three';
import type { WorldModel } from '@souls/world-compiler';
import { blockCellsOf, BLOCK_CELL } from './ecology.mesh.ts';
import { browserQuality } from '../quality-tier.ts';
import { COVER_CELL, KINDS, REC, cellKind, cellSites, coverIndex, coverPalette, prefix, type CellSites, type CoverIndex } from './ground-cover-recipe.ts';

/** Per kind: full density within d0 (m), thinning as (d0/d)^exp, gone by dmax; survivors grow by up to maxScale. */
const LOD: Record<(typeof KINDS)[number], { d0: number; dmax: number; exp: number; maxScale: number; cap: number }> = {
  tall: { d0: 16, dmax: 90, exp: 1.45, maxScale: 1.6, cap: 26000 },
  tuft: { d0: 8, dmax: 28, exp: 1.4, maxScale: 1.35, cap: 12000 },
  flower: { d0: 16, dmax: 70, exp: 1.25, maxScale: 1.5, cap: 7000 },
};
const keepAt = (k: (typeof KINDS)[number], d: number) => { const l = LOD[k]; if (d >= l.dmax) return 0; const f = Math.pow(l.d0 / Math.max(d, l.d0), l.exp); const e = (d - l.dmax * 0.75) / (l.dmax * 0.25); return e > 0 ? f * (1 - e * e * (3 - 2 * e)) : f; };
const MAX_D = Math.max(...Object.values(LOD).map((l) => l.dmax));
const MOVE = 2.5, DEAL_MS = 1, KEEP_CELLS = 1400;

/** The page's quality tier; a page without a screen (tests, workers) counts as desktop. */
function pageQuality(): { tier: string; reason: string } { try { return browserQuality(); } catch { return { tier: 'full', reason: 'no screen' }; } }
/** On or off for this page: off on the phone tier (P1's browserQuality), `?cover=0|1` overrides either way. */
export function coverSetting(search = typeof location === 'undefined' ? '' : location.search, tier: { tier: string; reason: string } = pageQuality()): { enabled: boolean; reason: string } {
  const q = new URLSearchParams(search).get('cover');
  if (q === '0' || q === '1') return { enabled: q === '1', reason: `?cover=${q}` };
  return tier.tier === 'phone' ? { enabled: false, reason: `phone tier (${tier.reason})` } : { enabled: true, reason: tier.reason };
}

// ---------------------------------------------------------------- geometry (root at the origin, up = +y, normals up)
function geo(p: number[], c: number[], petal?: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  const n = new Float32Array(p.length); for (let i = 1; i < n.length; i += 3) n[i] = 1; g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  if (petal) g.setAttribute('coverPetal', new THREE.Float32BufferAttribute(petal, 1));
  g.computeBoundingSphere(); return g;
}
/** Tall grass clump, unit height: seven tapered, curving blades (3 triangles each), two of them seed stems with a head. */
export function tallGeometry() {
  const p: number[] = [], c: number[] = [];
  const root = [0.45, 0.55, 0.38], mid = [0.78, 0.88, 0.66], tip = [1.02, 1.06, 0.78], seed = [1.05, 0.95, 0.62];
  for (let k = 0; k < 7; k++) {
    const a = k * 2.39 + 0.4, lean = 0.12 + 0.2 * ((k * 5) % 7) / 6, hf = 0.62 + 0.38 * ((k * 3) % 7) / 6, w = k % 3 === 2 ? 0.012 : 0.026, ca = Math.cos(a), sa = Math.sin(a);
    const ox = ca * 0.05, oz = sa * 0.05, px = -sa * w, pz = ca * w;
    const B1 = [ox - px, 0, oz - pz], B2 = [ox + px, 0, oz + pz];
    const mx = ox + ca * lean * 0.3 * hf, mz = oz + sa * lean * 0.3 * hf, M1 = [mx - px * 0.7, 0.55 * hf, mz - pz * 0.7], M2 = [mx + px * 0.7, 0.55 * hf, mz + pz * 0.7];
    const T = [ox + ca * lean * hf, hf, oz + sa * lean * hf];
    p.push(...B1, ...B2, ...M2, ...B1, ...M2, ...M1, ...M1, ...M2, ...T);
    c.push(...root, ...root, ...mid, ...root, ...mid, ...mid, ...mid, ...mid, ...tip);
    if (k % 3 === 2) {   // a seed head: a slim diamond above the stem's tip
      const hx = T[0] + ca * 0.02, hz = T[2] + sa * 0.02, top = hf + 0.14, hw = 0.022;
      const L = [hx - sa * hw, hf + 0.06, hz + ca * hw], R = [hx + sa * hw, hf + 0.06, hz - ca * hw], U = [hx + ca * 0.03, top, hz + sa * 0.03];
      p.push(...T, ...R, ...U, ...T, ...U, ...L); for (let i = 0; i < 6; i++) c.push(...seed);
    }
  }
  return geo(p, c);
}
/** Old Eden's short tuft (WorldGroundDetails.ts): eight leaning blades, one triangle each, darker at the base; metres. */
export function tuftGeometry() {
  const p: number[] = [], c: number[] = [], base = [0.55, 0.65, 0.46], tip = [1.0, 1.06, 0.8];
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9 + 0.3 * (k % 3), lean = 0.05 + 0.05 * (k % 3) / 2, h = 0.16 + 0.12 * ((k * 7) % 5) / 4, w = 0.026;
    const ox = Math.cos(a) * 0.035, oz = Math.sin(a) * 0.035, tx = Math.cos(a) * lean, tz = Math.sin(a) * lean, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    p.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, ox + tx, h, oz + tz); c.push(...base, ...base, ...tip);
  }
  return geo(p, c);
}
/** A wildflower, metres: a stem with two leaves and a five-petal head tilted to the side (petals take the instance colour). */
export function flowerGeometry() {
  const p: number[] = [], c: number[] = [], f: number[] = [], stem = [0.32, 0.5, 0.24], leaf = [0.4, 0.62, 0.3], eye = [0.95, 0.68, 0.14], white = [1, 1, 1];
  const H = 0.42, tri = (a: number[], b: number[], d: number[], col: number[], petal = 0) => { p.push(...a, ...b, ...d); for (let i = 0; i < 3; i++) { c.push(...col); f.push(petal); } };
  // stem: two crossed slivers, gently bent towards the head
  for (const [ax, az] of [[1, 0], [0, 1]]) { const w = 0.007; tri([-w * ax, 0, -w * az], [w * ax, 0, w * az], [0.03, H, 0], stem); }
  tri([0, 0.08, 0], [0.09, 0.16, 0.03], [0.012, 0.14, 0], leaf); tri([0.005, 0.15, 0], [-0.08, 0.24, -0.03], [0.01, 0.21, 0], leaf);
  // head: centre at the top of the stem, its face tilted 35° towards +x
  const cx = 0.03, cy = H, tilt = 0.61, ct = Math.cos(tilt), st = Math.sin(tilt);
  const P = (u: number, v: number, lift = 0) => [cx + u * ct - lift * st, cy + u * st + lift * ct, v];
  for (let k = 0; k < 5; k++) {
    const a0 = (k / 5) * Math.PI * 2, a1 = a0 + 0.55, a2 = a0 - 0.55, r = 0.075, ri = 0.012;
    tri(P(Math.cos(a0) * ri, Math.sin(a0) * ri), P(Math.cos(a2) * r, Math.sin(a2) * r), P(Math.cos(a1) * r, Math.sin(a1) * r), white, 1);
  }
  for (let k = 0; k < 5; k++) { const a0 = (k / 5) * Math.PI * 2, a1 = ((k + 1) / 5) * Math.PI * 2, r = 0.02; tri(P(0, 0, 0.004), P(Math.cos(a0) * r, Math.sin(a0) * r, 0.004), P(Math.cos(a1) * r, Math.sin(a1) * r, 0.004), eye); }
  return geo(p, c, f);
}

// ---------------------------------------------------------------- materials
const FADE = /* glsl */`
{
 // W4 ground cover: thin with distance by rank; survivors grow a little; the rest shrink away (no popping)
 vec3 cvO=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;float cvD=length(cameraPosition-cvO);
 float cvK=pow(uCover.x/max(cvD,uCover.x),uCover.z)*(1.-smoothstep(uCover.y*.75,uCover.y,cvD));
 float cvS=cvK>1e-4?(1.-smoothstep(cvK*.7,cvK,coverRank))*min(uCover.w,pow(max(cvK,1e-3),-.3)):0.;
 transformed*=cvS;
}
`;
// flowers: the instance colour tints only the petals (stems, leaves and eyes keep their own colour)
const PETAL_SRC = 'vColor.rgb *= instanceColor.rgb;';
export const PETALS = THREE.ShaderChunk.color_vertex.replace(PETAL_SRC, 'vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, coverPetal );');
function coverMaterial(kind: (typeof KINDS)[number]) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });   // Lambert: a fraction of Standard's fill cost, grass has no highlights
  m.name = `ground cover ${kind === 'tall' ? 'tall grass' : kind === 'tuft' ? 'grass tufts' : 'wildflowers'}`;
  const l = LOD[kind], uCover = { value: new THREE.Vector4(l.d0, l.dmax, l.exp, l.maxScale) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCover = uCover;
    shader.vertexShader = `attribute float coverRank;\nuniform vec4 uCover;\n${kind === 'flower' ? 'attribute float coverPetal;\n' : ''}` + shader.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FADE}`)
      .replace('#include <color_vertex>', kind === 'flower' ? PETALS : '#include <color_vertex>');
    // normals point up so blades light like the turf they stand in, from either side (no back-face flip)
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
  };
  m.customProgramCacheKey = () => `ground-cover-v3:${kind}`;
  return m;
}

// ---------------------------------------------------------------- the layer
type Layer = { kind: (typeof KINDS)[number]; k: number; mesh: THREE.InstancedMesh; rank: THREE.InstancedBufferAttribute };
type CellEntry = { gen: number; sites: CellSites; kinds: (Float32Array | null)[]; used: number };
export type GroundCoverStats = { enabled: boolean; reason: string; cells: number; dealt: number; instances: Record<string, number>; dealMs: number; rebuilds: number; pending: number };

export class GroundCover {
  readonly group = new THREE.Group();
  private readonly layers: Layer[];
  private readonly getModel: () => WorldModel | null;
  private enabled: boolean;
  private readonly reason: string;
  private index: CoverIndex | null = null;
  private indexModel: WorldModel | null = null;
  private indexSeq = NaN;
  private readonly getSeq: () => number;
  private want: ReturnType<GroundCover['wanted']> = [];
  private signature = '';
  private gen = 0;
  private readonly cells = new Map<string, CellEntry>();
  private last = new THREE.Vector3(Infinity, Infinity, Infinity);
  private dirty = true;
  private frame = 0;
  readonly stats: GroundCoverStats;
  private readonly v = new THREE.Vector3();
  private sceneBinding: { scene: THREE.Scene; previous: THREE.Scene['onBeforeRender']; hook: THREE.Scene['onBeforeRender'] } | null = null;

  constructor(getModel: () => WorldModel | null, opts: { enabled: boolean; reason: string }, getSeq: () => number = () => 0) {
    this.getModel = getModel; this.getSeq = getSeq; this.enabled = opts.enabled; this.reason = opts.reason;
    this.group.name = 'ground cover (tall grass, tufts, wildflowers)';
    const geos = { tall: tallGeometry(), tuft: tuftGeometry(), flower: flowerGeometry() };
    this.layers = KINDS.map((kind, k) => {
      const cap = LOD[kind].cap, mesh = new THREE.InstancedMesh(geos[kind], coverMaterial(kind), cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
      const rank = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
      mesh.geometry.setAttribute('coverRank', rank);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true; mesh.raycast = () => {};
      mesh.name = `ground cover: ${kind}`; mesh.userData.cameraTransparent = true; mesh.userData.edenWindMode = 'grass'; mesh.userData.keepDetail = true;
      this.group.add(mesh);
      return { kind, k, mesh, rank };
    });
    this.stats = { enabled: this.enabled, reason: this.reason, cells: 0, dealt: 0, instances: {}, dealMs: 0, rebuilds: 0, pending: 0 };
    this.group.visible = this.enabled;
  }

  setEnabled(on: boolean) { this.enabled = on; this.stats.enabled = on; this.group.visible = on; this.dirty = true; }

  /** Bind the scene used by both the live camera and offscreen world captures. Rebinding releases the old scene. */
  bindScene(scene: THREE.Scene) {
    if (this.sceneBinding?.scene === scene) return;
    this.unbindScene();
    const previous = scene.onBeforeRender;
    const hook: THREE.Scene['onBeforeRender'] = (...args) => {
      previous.call(scene, ...args);
      if (this.sceneBinding?.hook === hook) this.prepare(args[2]);
    };
    this.sceneBinding = { scene, previous, hook }; scene.onBeforeRender = hook;
  }
  private unbindScene() {
    const binding = this.sceneBinding;
    if (binding && binding.scene.onBeforeRender === binding.hook) binding.scene.onBeforeRender = binding.previous;
    this.sceneBinding = null;
  }

  /** The cover index for the current model: checked once per world edit (the layer's seq), rebuilt only when the
   *  ground, areas or footprints actually changed (bodies moving don't count). */
  private ensureIndex(model: WorldModel): boolean {
    const seq = this.getSeq();
    if (this.indexModel === model && this.indexSeq === seq) return !!this.index;
    this.indexModel = model; this.indexSeq = seq;
    const palette = (model.state as { ground?: { palette?: string } }).ground?.palette;
    if (!coverPalette(palette) && !this.hasCoverAreas(model)) { this.index = null; this.cells.clear(); this.signature = ''; return false; }
    // PERF-STREAM: the signature walks every record (JSON per shape); taken again only when the model's records changed
    const key = typeof model.safetyCacheKey === 'function' ? model.safetyCacheKey() : {};
    if (this.index && this.sigKey === key && this.sigSize === model.entities.size) { this.index.model = model; return true; }
    const sig = signatureOf(model); this.sigKey = key; this.sigSize = model.entities.size;
    if (this.index && sig === this.signature) { this.index.model = model; return true; }
    this.signature = sig;
    this.index = coverIndex(model, blockCellsOf(model), BLOCK_CELL);
    this.gen++; this.dirty = true;
    return true;
  }
  private sigKey: object | null = null; private sigSize = -1;
  private hasCoverAreas(model: WorldModel) {
    for (const e of model.entities.values()) { if (!e.shape || !('area' in e.shape)) continue; const d = model.resolvedDef(e.def); if (d && (d.tags ?? []).includes('meadow')) return true; }
    return false;
  }

  /** Prepare this camera's cover from Scene.onBeforeRender, before WebGLRenderer uploads instance buffers.
   * A mesh's onBeforeRender is too late: its newly set count would draw the previous GPU transforms/colours
   * (identity transforms and black colours on the first frame), including inside otherwise blocked floors. */
  prepare(camera: THREE.Camera) {
    if (!this.enabled || !(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
    const model = this.getModel(); this.frame++;
    if (!model || !this.ensureIndex(model)) { this.clear(); return; }
    const ix = this.index!; camera.getWorldPosition(this.v);
    const gy = model.terrain.sample(this.v.x, this.v.z), above = this.v.y - (Number.isFinite(gy) ? gy : 0);
    if (above > MAX_D) { this.clear(); return; }
    // nothing to do on most frames: only when the camera has moved a few metres, the world changed or cells are owed
    const moved = this.v.distanceTo(this.last) >= MOVE;
    if (!moved && !this.dirty && !this.stats.pending) return;
    if (moved || this.dirty) { this.want = this.wanted(this.v, above); this.last.copy(this.v); }
    // deal missing / stale cells, nearest first, within a few milliseconds
    const t0 = performance.now(); let dealt = 0, pending = 0;
    for (const w of this.want) {
      const e = this.cells.get(w.key);
      const fresh = e && e.gen === this.gen && w.kinds.every((k) => e.kinds[k]);
      if (fresh) continue;
      if (performance.now() - t0 > DEAL_MS) { pending++; continue; }
      let entry = e && e.gen === this.gen ? e : undefined;
      if (!entry) entry = { gen: this.gen, sites: cellSites(ix, w.ci, w.cj), kinds: [null, null, null], used: this.frame };
      for (const k of w.kinds) entry.kinds[k] ??= cellKind(ix, w.ci, w.cj, k, entry.sites);
      this.cells.set(w.key, entry); dealt++;
    }
    if (dealt) { this.stats.dealMs = +(performance.now() - t0).toFixed(2); this.stats.dealt += dealt; }
    this.stats.pending = pending;
    if (!moved && !this.dirty && !dealt) return;
    this.dirty = false; this.stats.rebuilds++;
    this.rebuild(this.want);
    if (this.cells.size > KEEP_CELLS) this.evict();
  }

  /** Cells within reach of the camera, nearest first, with the kinds each one needs. */
  private wanted(cam: THREE.Vector3, above: number) {
    const R = Math.sqrt(Math.max(0, MAX_D * MAX_D - above * above)) + COVER_CELL;
    const i0 = Math.floor((cam.x - R) / COVER_CELL), i1 = Math.floor((cam.x + R) / COVER_CELL), j0 = Math.floor((cam.z - R) / COVER_CELL), j1 = Math.floor((cam.z + R) / COVER_CELL);
    const out: { key: string; ci: number; cj: number; d: number; kinds: number[] }[] = [];
    for (let cj = j0; cj <= j1; cj++) for (let ci = i0; ci <= i1; ci++) {
      const nx = Math.max(ci * COVER_CELL, Math.min(cam.x, (ci + 1) * COVER_CELL)), nz = Math.max(cj * COVER_CELL, Math.min(cam.z, (cj + 1) * COVER_CELL));
      const d = Math.max(0, Math.hypot(nx - cam.x, nz - cam.z, above) - MOVE);
      const kinds = KINDS.flatMap((k, i) => (d < LOD[k].dmax ? [i] : []));
      if (kinds.length) out.push({ key: `${ci},${cj}`, ci, cj, d, kinds });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  private rebuild(want: ReturnType<GroundCover['wanted']>) {
    for (const L of this.layers) {
      const cap = LOD[L.kind].cap, mat = L.mesh.instanceMatrix.array as Float32Array, col = L.mesh.instanceColor!.array as Float32Array, rk = L.rank.array as Float32Array;
      let n = 0;
      for (const w of want) {
        const e = this.cells.get(w.key), rec = e?.kinds[L.k]; if (!rec) continue;
        e.used = this.frame;
        const keep = keepAt(L.kind, w.d); if (keep <= 0) continue;
        const cnt = Math.min(prefix(rec, keep), cap - n);
        for (let i = 0; i < cnt; i++, n++) {
          const o = i * REC, x = rec[o], y = rec[o + 1], z = rec[o + 2], c = Math.cos(rec[o + 3]), s = Math.sin(rec[o + 3]), ws = rec[o + 4], hs = rec[o + 5], m = n * 16;
          mat[m] = c * ws; mat[m + 1] = 0; mat[m + 2] = -s * ws; mat[m + 3] = 0; mat[m + 4] = 0; mat[m + 5] = hs; mat[m + 6] = 0; mat[m + 7] = 0;
          mat[m + 8] = s * ws; mat[m + 9] = 0; mat[m + 10] = c * ws; mat[m + 11] = 0; mat[m + 12] = x; mat[m + 13] = y; mat[m + 14] = z; mat[m + 15] = 1;
          col[n * 3] = rec[o + 6]; col[n * 3 + 1] = rec[o + 7]; col[n * 3 + 2] = rec[o + 8]; rk[n] = rec[o + 9];
        }
        if (n >= cap) break;
      }
      L.mesh.count = n; this.stats.instances[L.kind] = n;
      for (const a of [L.mesh.instanceMatrix, L.mesh.instanceColor!, L.rank]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
    }
    this.stats.cells = this.cells.size;
  }

  private evict() {
    const old = [...this.cells].sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < old.length - KEEP_CELLS * 0.8; i++) this.cells.delete(old[i][0]);
  }
  private clear() { for (const L of this.layers) { L.mesh.count = 0; this.stats.instances[L.kind] = 0; } this.last.set(Infinity, Infinity, Infinity); }

  dispose() {
    this.unbindScene();
    this.group.removeFromParent(); this.cells.clear();
    for (const L of this.layers) { L.mesh.geometry.dispose(); (L.mesh.material as THREE.Material).dispose(); L.mesh.dispose(); }
  }
}

/** What the cover depends on: ground and palette, areas and every footprint-bearing thing (bodies moving don't count). */
function signatureOf(model: WorldModel): string {
  let h = 0x811c9dc5;
  const mix = (s: string) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; };
  mix(JSON.stringify((model.state as { ground?: unknown }).ground ?? null)); mix(String(model.ground().landforms.length)); mix(String(model.ground().waters.length));
  for (const e of model.entities.values()) {
    if (e.in.parent !== 'world') continue;
    const d = model.resolvedDef(e.def); if (!d || d.components.body) continue;
    if (e.shape) { mix(e.id); mix(JSON.stringify(e.shape)); mix(JSON.stringify(e.params ?? null)); continue; }
    if (d.layer !== 'solid' && d.layer !== 'surface') continue;
    mix(e.id); mix(e.def); mix(JSON.stringify([e.p ?? null, e.r ?? null, e.s ?? null, e.in.parent]));
  }
  return h.toString(16) + ':' + model.entities.size;
}
