// Mesh halves of the desert near-field (lane MARSLAND-NEAR): tire/1, tire-line/1, tire-ring/1,
// creosote/1, desert-scrub/1, tire-tracks/1. Rounded low-poly with vertex colours: a tyre is a
// squarish-section torus with tread blocks (216 tris), a creosote is a few lumpy leaf clusters on
// thin stems (≈ 120 tris), a tuft is a fan of thin blades (≤ 30 tris). Lines, rings and scrub are one
// InstancedMesh per kind (a 500 m tyre ring = 1 draw call, a 1.2 km scrub field = 5).
import { installScrubVerdicts, offsetAlong, scrubPoints, tireLine, tireRingPath, trackLines, type TirePose } from '@souls/generators';
import type { Entity } from '@souls/world-compiler';
import * as THREE from 'three';
import { BLOCK_CELL, blockCellsOf, blockedBy } from './ecology.mesh.ts';
import { terrainColorFor } from './ground-palette.ts';
import { registerMesh, type MeshCtx } from './registry.ts';
import { Soup, h01, mix, rgb, scale, vertexMaterial, type RGB, type V3 } from './soup.ts';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d);
function hashSeed(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0) % 100000; }
const seedOf = (e: Entity) => e.seed ?? hashSeed(e.id);

// ---------------------------------------------------------------- tyre geometry

/** Unit tyre (outer diameter 1), centred at the origin, rolling plane = local x-y, axle along z. */
const tireCache = new Map<string, THREE.BufferGeometry>();
export function tireGeometry(color: string): THREE.BufferGeometry {
  const hit = tireCache.get(color); if (hit) return hit;
  const s = new Soup(), base = rgb(color), tread = scale(base, 0.78), wall = scale(base, 1.18);
  const N = 18, M = 6, Rc = 0.405, a = 0.095, b = 0.165;   // ring segments, tube segments, tube centre radius, radial and axial half-sizes
  // squarish tyre section: θ = 0 is the tread (outermost), ±π/2 the sidewalls, π the bead (inner)
  const sec = (th: number) => { const c = Math.cos(th), si = Math.sin(th); return { r: Math.sign(c) * Math.pow(Math.abs(c), 0.55) * a, y: Math.sign(si) * Math.pow(Math.abs(si), 0.7) * b, nr: c / a, ny: si / b }; };
  const P = (i: number, j: number): { p: V3; n: V3; c: RGB } => {
    const phi = (i / N) * Math.PI * 2, th = (j / M) * Math.PI * 2, q = sec(th);
    const bump = j === 0 && i % 2 === 0 ? 0.012 : 0;          // tread blocks
    const R = Rc + q.r + bump, cp = Math.cos(phi), sp = Math.sin(phi);
    const nl = Math.hypot(q.nr, q.ny) || 1;
    const c = j === 0 ? (i % 2 ? tread : base) : Math.abs(Math.sin(th)) > 0.7 ? wall : base;
    return { p: [cp * R, sp * R, q.y], n: [cp * (q.nr / nl), sp * (q.nr / nl), q.ny / nl], c };
  };
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const A = P(i, j), B = P(i + 1, j), C = P(i + 1, j + 1), D = P(i, j + 1);
    s.tri(A.p, B.p, C.p, [A.c, B.c, C.c], [A.n, B.n, C.n]); s.tri(A.p, C.p, D.p, [A.c, C.c, D.c], [A.n, C.n, D.n]);
  }
  const g = s.geometry(); tireCache.set(color, g); return g;
}

const tint = new THREE.Color(), up = new THREE.Vector3(0, 1, 0), ax = new THREE.Vector3(1, 0, 0);
/** One InstancedMesh for a set of tyres (world frame), each sunk into the ground by its own amount. */
function tireInstances(tires: TirePose[], D: number, color: string, ground: (x: number, z: number) => number, name: string): THREE.InstancedMesh | null {
  if (!tires.length) return null;
  const im = new THREE.InstancedMesh(tireGeometry(color), vertexMaterial(), tires.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), ql = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  tires.forEach((t, i) => {
    const d = D * t.s, half = 0.165 * d;
    q.setFromAxisAngle(up, t.yaw);
    let y: number;
    if (t.pose === 1) { ql.setFromAxisAngle(ax, Math.PI / 2 + t.lean * 0.3); y = half - t.sink; }
    else { ql.setFromAxisAngle(ax, t.lean); y = (d / 2) * Math.cos(t.lean) - t.sink; }
    q.multiply(ql);
    p.set(t.x, ground(t.x, t.z) + y, t.z); sc.setScalar(d);
    m.compose(p, q, sc); im.setMatrixAt(i, m);
    const k = 0.85 + t.tone * 0.6; tint.setRGB(k, k * 0.98, k * 0.95); im.setColorAt(i, tint);   // sun-faded to near-black rubber
  });
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = true; im.receiveShadow = true; im.name = name; im.computeBoundingSphere(); im.userData.cameraTransparent = true;
  return im;
}

registerMesh({
  gen: 'tire/1',
  build(ctx) {
    const D = num(ctx.params.diameter, 0.62), pose = str(ctx.params.pose, 'upright'), b = num(ctx.params.burial, 0.35);
    const mesh = new THREE.Mesh(tireGeometry(str(ctx.params.color, '#1d1c1b')), vertexMaterial());
    mesh.scale.setScalar(D);
    if (pose === 'flat') { mesh.rotation.x = Math.PI / 2; mesh.position.y = 0.165 * D - 0.07; }
    else if (pose === 'leaning') { mesh.rotation.x = 0.5; mesh.position.y = (D / 2) * Math.cos(0.5) - D * b * 0.6; }
    else mesh.position.y = D / 2 - D * b;
    mesh.castShadow = true; mesh.receiveShadow = true;
    const g = new THREE.Group(); g.add(mesh); return g;
  },
  instanceKey(ctx) { return `${ctx.params.diameter}|${ctx.params.pose}|${ctx.params.burial}|${ctx.params.color}`; },
});

function lineMesh(ctx: MeshCtx, path: [number, number][], params: Record<string, unknown>, name: string) {
  const tires = tireLine(path, params as never, seedOf(ctx.entity));
  const im = tireInstances(tires, num(params.diameter, 0.62), str(params.color, '#1d1c1b'), (x, z) => ctx.model.terrain.sample(x, z), name);
  if (im) im.userData.tires = tires.length;
  return im;
}
registerMesh({
  gen: 'tire-line/1', world: true,
  build(ctx) { const e = ctx.entity; if (!e.shape || !('path' in e.shape)) return null; return lineMesh(ctx, e.shape.path as [number, number][], ctx.params, `tire-line ${e.name ?? e.id}`); },
});
registerMesh({
  gen: 'tire-ring/1', world: true,
  build(ctx) { const wp = ctx.model.worldPose(ctx.entity); return lineMesh(ctx, tireRingPath(wp.x, wp.z, wp.yaw, ctx.params), { ...ctx.params, closed: true }, `tire-ring ${ctx.entity.name ?? ctx.entity.id}`); },
});

// ---------------------------------------------------------------- creosote and grass

const STEM = rgb('#6f675b');
/** Unit-height scrub geometries: 0–2 creosote shapes, 3 straw tuft, 4 sage tuft. */
const scrubCache = new Map<string, THREE.BufferGeometry>();
export function scrubGeometry(kind: number, leaf = '#56603f'): THREE.BufferGeometry {
  const key = `${kind}|${leaf}`, hit = scrubCache.get(key); if (hit) return hit;
  const s = new Soup(), L = rgb(leaf), dark = scale(L, 0.78), light = mix(L, rgb('#8a9160'), 0.35);
  if (kind <= 2) {
    // a low open dome of small leaf clusters, from near the ground up, on short thin stems (creosote is airy, never a ball on a stick)
    const [w, top] = ([[0.5, 0.85], [0.66, 0.62], [0.38, 1.0]] as const)[kind];
    const cl: [number, number, number, number][] = [[0, top - 0.17, 0, 0.21]];                                   // crown
    for (let i = 0; i < 4; i++) { const a = i * 1.571 + 0.4 + kind; cl.push([Math.cos(a) * w * 0.55, top * 0.58, Math.sin(a) * w * 0.55, 0.2]); }      // middle ring
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + 1.1 + kind; cl.push([Math.cos(a) * w * 0.85, top * 0.3, Math.sin(a) * w * 0.85, 0.17]); }      // low skirt
    cl.forEach(([x0, y, z0, r0], i) => {
      const j = h01(i, kind, 7) - 0.5, x = x0 * (1 + j * 0.3), z = z0 * (1 - j * 0.3), r = r0 * (0.85 + 0.35 * h01(i, kind, 3)) * (kind === 1 ? 1.12 : 1);
      s.rod([x * 0.1, 0, z * 0.1], [x * 0.8, Math.max(0.05, y - r * 0.6), z * 0.8], 0.018, STEM, 3);
      s.blob([x, y, z], [r * 1.2, r * 0.95, r * 1.15], i % 3 === 1 ? dark : i % 3 === 2 ? light : L, 0, 0.32, kind * 13 + i);
    });
  } else {
    const straw = kind === 3, c0 = rgb(straw ? '#c2b183' : '#8e9470'), c1 = rgb(straw ? '#9f8c62' : '#737a58');
    for (let k = 0; k < 7; k++) {
      const a = k * 0.9 + h01(k, kind) * 0.5, lean = 0.25 + h01(k, kind, 3) * 0.35, h = 0.7 + h01(k, kind, 5) * 0.35, bx = Math.cos(a) * 0.06, bz = Math.sin(a) * 0.06;
      const tip: V3 = [bx + Math.cos(a) * lean, h, bz + Math.sin(a) * lean], w = 0.05, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      s.tri([bx - px, 0, bz - pz], [bx + px, 0, bz + pz], tip, [c1, c1, c0]);
      s.tri([bx, 0, bz], [bx + px * 0.5, h * 0.5, bz + pz * 0.5], [bx + Math.cos(a) * lean * 0.6, h * 0.8, bz + Math.sin(a) * lean * 0.6], [c1, c0, c0]);
    }
  }
  const g = s.geometry(); scrubCache.set(key, g); return g;
}

registerMesh({
  gen: 'creosote/1',
  build(ctx) {
    const h = num(ctx.params.height, 1), v = Math.min(2, Math.max(0, Math.round(num(ctx.params.variant, 0))));
    const mesh = new THREE.Mesh(scrubGeometry(v, str(ctx.params.color, '#56603f')), vertexMaterial());
    mesh.scale.setScalar(h); mesh.position.y = -0.03 * h; mesh.castShadow = true; mesh.receiveShadow = true;
    const g = new THREE.Group(); g.add(mesh); return g;
  },
  instanceKey(ctx) { return `${ctx.params.height}|${ctx.params.variant}|${ctx.params.color}`; },
});

// Phone arrival (lane L3): desert scrub comes from a worker (scrub.worker.ts) and fills in when it answers (well before the
// arrival card lifts). Where no water can reach the area, the worker scatters it whole with the same blocked-ground cells
// (block-test.ts); otherwise it sends the noise verdicts and this thread replays them with `blocked` and the water test.
// Same points either way. No Worker (tests, old browsers) or `?scrubWorker=0`: computed in place, as before.
type Verdicts = { key: string; marks: Uint8Array[] };
type Answer = { v?: Verdicts | null; pts?: Float64Array | null } | null;
type ScrubPt = { x: number; z: number; k: number; s: number; yaw: number; tone: number };
let scrubWorker: Worker | null | undefined;
const scrubWaits = new Map<number, (a: Answer) => void>();
let scrubId = 0;
function inWorker(msg: Record<string, unknown>): Promise<Answer> | null {
  if (scrubWorker === undefined) {
    try {
      const off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('scrubWorker') === '0';
      scrubWorker = off || typeof Worker === 'undefined' ? null : new Worker(new URL('./scrub.worker.ts', import.meta.url), { type: 'module' });
    } catch { scrubWorker = null; }
    if (scrubWorker) {
      scrubWorker.onmessage = (ev: MessageEvent<{ id: number } & NonNullable<Answer>>) => { const f = scrubWaits.get(ev.data.id); scrubWaits.delete(ev.data.id); f?.(ev.data); };
      scrubWorker.onerror = () => { for (const f of scrubWaits.values()) f(null); scrubWaits.clear(); scrubWorker?.terminate(); scrubWorker = null; };
    }
  }
  const w = scrubWorker; if (!w) return null;
  return new Promise((resolve) => {
    const id = ++scrubId; scrubWaits.set(id, resolve);
    try { w.postMessage({ id, ...msg }); } catch { scrubWaits.delete(id); resolve(null); }
  });
}
const bbox = (p: [number, number][]) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of p) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; };

registerMesh({
  gen: 'desert-scrub/1', world: true,
  build(ctx) {
    const e = ctx.entity; if (!e.shape || !('area' in e.shape)) return null;
    const area = e.shape.area as [number, number][], seed = seedOf(e);
    const group = new THREE.Group(); group.name = `desert-scrub ${e.name ?? e.id}`;
    const water = (x: number, z: number) => { const g = ctx.model.ground(); for (const w of g.waters) if (w.area && w.level > ctx.model.terrain.sample(x, z) && inside(x, z, w.area as [number, number][])) return true; return false; };
    const scatter = () => { const blocked = blockedBy(ctx.model, e); return scrubPoints(area, ctx.params as never, seed, (x, z) => blocked(x, z) || water(x, z)); };
    const fill = (pts: ScrubPt[]) => {
      const byK: ScrubPt[][] = [[], [], [], [], []];
      for (const p of pts) byK[p.k].push(p);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
      byK.forEach((list, k) => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(scrubGeometry(k), vertexMaterial(), list.length);
        list.forEach((p, i) => {
          q.setFromAxisAngle(up, p.yaw); const wide = 0.9 + p.tone * 0.35;
          pos.set(p.x, ctx.model.terrain.sample(p.x, p.z) - 0.03 * p.s, p.z); sc.set(p.s * wide, p.s, p.s * wide);
          m.compose(pos, q, sc); im.setMatrixAt(i, m);
          const t = 0.82 + p.tone * 0.3; tint.setRGB(t, t * (0.98 + p.tone * 0.04), t * 0.94); im.setColorAt(i, tint);
        });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = k <= 2; im.receiveShadow = true; im.name = `scrub:${k}`; im.computeBoundingSphere(); im.userData.cameraTransparent = true;
        group.add(im);
      });
      group.userData.points = pts.length;
    };
    // no water's bounds touch the area: water() is false for every candidate, so the worker's scatter is the whole answer
    const [ax0, az0, ax1, az1] = bbox(area);
    const dry = ctx.model.ground().waters.every((w) => { if (!w.area) return true; const [x0, z0, x1, z1] = bbox(w.area as [number, number][]); return x1 < ax0 || x0 > ax1 || z1 < az0 || z0 > az1; });
    const job = inWorker(dry ? { kind: 'points', area, params: ctx.params, seed, cells: blockCellsOf(ctx.model, 0.6, [Math.min(...area.map((q) => q[0])), Math.min(...area.map((q) => q[1])), Math.max(...area.map((q) => q[0])), Math.max(...area.map((q) => q[1]))]), C: BLOCK_CELL, selfId: e.id } : { area, params: ctx.params, seed });
    if (!job) { fill(scatter()); return group.children.length ? group : null; }
    let gone = false;
    group.addEventListener('removed', () => { gone = true; });
    void job.then((a) => {
      if (gone) return;
      if (a?.pts) { const f = a.pts, pts: ScrubPt[] = []; for (let i = 0; i < f.length; i += 6) pts.push({ x: f[i], z: f[i + 1], k: f[i + 2], s: f[i + 3], yaw: f[i + 4], tone: f[i + 5] }); fill(pts); return; }
      if (a?.v) installScrubVerdicts(a.v);
      fill(scatter());
    });
    return group;
  },
});
function inside(px: number, pz: number, poly: [number, number][]) { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) r = !r; } return r; }

// ---------------------------------------------------------------- tyre tracks

let trackMat: THREE.MeshStandardMaterial | null = null;
const REF = rgb('#b2b2b3');   // the playa base: a track darkens whatever ground it crosses by color / REF
registerMesh({
  gen: 'tire-tracks/1', world: true,
  build(ctx) {
    const e = ctx.entity; if (!e.shape || !('area' in e.shape)) return null;
    const lines = trackLines(e.shape.area as [number, number][], ctx.params as never, seedOf(e));
    const gauge = num(ctx.params.gauge, 1.6), w = num(ctx.params.lineWidth, 0.24) / 2, col = rgb(str(ctx.params.color, '#b3a080'));
    const palette = (ctx.model.state as { ground?: { palette?: string } }).ground?.palette, groundCol = terrainColorFor(palette), c = new THREE.Color();
    const base = ctx.model.constants.base, g = (x: number, z: number) => ctx.model.terrain.sample(x, z);
    const s = new Soup();
    lines.forEach((line, li) => {
      for (const side of [-gauge / 2, gauge / 2]) {
        const wheel = offsetAlong(line, side) as [number, number][], lo = offsetAlong(wheel, -w) as [number, number][], hi = offsetAlong(wheel, w) as [number, number][];
        const colAt = (i: number): RGB => {
          const [x, z] = wheel[i]; groundCol(c, g(x, z), 0, base, x, z);
          const fadeEnds = Math.min(1, i / 6, (wheel.length - 1 - i) / 6), fade = fadeEnds * (0.3 + 0.6 * h01(li, Math.floor(i / 7)));   // tracks fade in and out
          return mix([c.r, c.g, c.b], [c.r * (col[0] / REF[0]), c.g * (col[1] / REF[1]), c.b * (col[2] / REF[2])], Math.max(0, Math.min(1, fade)));
        };
        for (let i = 1; i < wheel.length; i++) {
          const A: V3 = [lo[i - 1][0], g(lo[i - 1][0], lo[i - 1][1]) + 0.025, lo[i - 1][1]], B: V3 = [hi[i - 1][0], g(hi[i - 1][0], hi[i - 1][1]) + 0.025, hi[i - 1][1]];
          const C: V3 = [hi[i][0], g(hi[i][0], hi[i][1]) + 0.025, hi[i][1]], D: V3 = [lo[i][0], g(lo[i][0], lo[i][1]) + 0.025, lo[i][1]];
          const c0 = colAt(i - 1), c1 = colAt(i);
          s.topQuad(A, B, C, D, [c0, c0, c1, c1]);
        }
      }
    });
    if (!s.pos.length) return null;
    trackMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(s.geometry(), trackMat);
    mesh.name = `tire-tracks ${e.name ?? e.id}`; mesh.receiveShadow = true; mesh.castShadow = false;
    return mesh;
  },
});
