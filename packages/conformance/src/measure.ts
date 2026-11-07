// Measured budgets (G2): never typed in. kit/2 defs are built with the viewer's own kit builder (three.js geometry, the
// same code that draws them), counting triangles, draws (meshes after the per-material merge) and materials. Mesh defs
// use the asset store's measured facts (def.budget, filled by the compiler from the GLB at define time). Generator defs
// fall back to the physics bake's triangle estimate.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { StoredDef, AssetLookup, DefLibrary } from '@souls/world-compiler';
import { WorldModel, coreLibrary } from '@souls/world-compiler';

export type Measured = { tris: number; draws: number; materials: number; assetBytes: number; textures: number; texturePx: number; box?: { min: [number, number, number]; max: [number, number, number] }; how: 'kit' | 'asset-meta' | 'estimate' };

type Kit = { buildKit: (args: unknown, ctx: unknown) => { traverse(fn: (o: unknown) => void): void }; MaterialLib: new () => unknown; kitArgs: { parse(a: unknown): unknown }; THREE: { Box3: new () => { setFromObject(o: unknown): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number }; isEmpty(): boolean } } } };
let kit: Kit | null | undefined;
/** The viewer's kit builder, loaded lazily (it pulls three.js); null when the web app is not next to this package. */
export async function loadKitBuilder(): Promise<Kit | null> {
  if (kit !== undefined) return kit;
  try {
    const web = new URL('../../../apps/web/src/gen-mesh/', import.meta.url);
    const [{ buildKit }, { MaterialLib }, { kitArgs }, THREE] = await Promise.all([
      import(new URL('kit.mesh.ts', web).href), import(new URL('materials.ts', web).href),
      import('@souls/generators'), import(new URL('../../node_modules/three/build/three.module.js', web).href),
    ]);
    kit = { buildKit, MaterialLib, kitArgs, THREE } as Kit;
  } catch (e) { kit = null; process.env.CATALOG_DEBUG && console.error('kit builder unavailable:', e); }
  return kit;
}

type AssetMeta = { kind: string; ext: string; bytes: number; tris: number; textures: number; box: [number, number, number]; min?: [number, number, number]; texPx?: number; license?: string; source?: string; baked?: unknown };
let assetIndex: Map<string, AssetMeta> | null = null;
/** Measured GLB facts from the repo's core asset indexes (worlds/core-assets/*.json, the same files the server reads). */
export function assetMeta(sha: string): AssetMeta | undefined {
  if (!assetIndex) {
    assetIndex = new Map();
    const dir = new URL('../../../worlds/core-assets/', import.meta.url);
    if (existsSync(dir)) for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      try { for (const [k, v] of Object.entries((JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { assets?: Record<string, AssetMeta> }).assets ?? {})) if (!assetIndex.has(k)) assetIndex.set(k, v); } catch { /* skip a broken index */ }
    }
  }
  return assetIndex.get(sha);
}

/** The compiler's asset lookup over the same indexes (footprint sidecars give buildings their walls and rooms). */
export const assetLookup: AssetLookup = (sha: string) => { const m = assetMeta(sha); return m ? ({ tris: m.tris, bytes: m.bytes, textures: m.textures, box: m.box, ...(m.baked ? { baked: m.baked } : {}) } as ReturnType<AssetLookup>) : undefined; };

let probe: WorldModel | null = null;
function measurementWorld() {
  if (!probe) {
    probe = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'measure', assets: assetLookup });
    probe.library = coreLibrary();
  }
  return probe;
}

export async function measure(d: StoredDef, params?: Record<string, unknown>, library?: DefLibrary): Promise<Measured> {
  const world = measurementWorld().fork();
  if (library) world.library = library;
  world.defs.set(d.ref, d); // Measure this revision, including custom defs, rather than an older seed revision.
  const r = world.resolvedDef(d.ref) ?? d;
  const defaults = Object.fromEntries(Object.entries(r.params ?? {}).filter(([, f]) => (f as { default?: unknown }).default !== undefined).map(([k, f]) => [k, (f as { default: unknown }).default]));
  const p = { ...defaults, ...(params ?? {}) };
  if (r.make.kind === 'gen' && r.make.gen === 'kit/2') {
    const k = await loadKitBuilder();
    if (k) {
      const lib = new k.MaterialLib();
      const palette = (r.palette ?? {}) as Record<string, string>;
      const g = k.buildKit(k.kitArgs.parse(r.make.args), { materials: lib, tint: (key: string | undefined, f: string) => (key && (p[key] as string)) || (key && palette[key]) || f, params: p, state: {} });
      let tris = 0, draws = 0; const mats = new Set<unknown>();
      g.traverse((o) => { const m = o as { isMesh?: boolean; geometry: { index: { count: number } | null; attributes: { position: { count: number } } }; material: unknown }; if (m.isMesh) { draws++; mats.add(m.material); tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; } });
      const b = new k.THREE.Box3().setFromObject(g);
      return { tris: Math.round(tris), draws, materials: mats.size, assetBytes: 0, textures: 0, texturePx: 0, how: 'kit', ...(b.isEmpty() ? {} : { box: { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] } }) };
    }
  }
  if (r.make.kind === 'mesh') {
    const m = assetMeta(r.make.asset);
    return { tris: m?.tris ?? r.budget?.tris ?? 0, draws: 0, materials: 0, assetBytes: m?.bytes ?? r.budget?.bytes ?? 0, textures: m?.textures ?? r.budget?.textures ?? 0, texturePx: m?.texPx ?? 0, how: m ? 'asset-meta' : 'estimate', ...(m?.min ? { box: { min: m.min, max: [m.min[0] + m.box[0], m.min[1] + m.box[1], m.min[2] + m.box[2]] as [number, number, number] } } : {}) };
  }
  let tris = 0; try { tris = world.bake(r, p as never, 0, r.form === 'point' ? undefined : shapeFor(r)).tris; } catch { /* a bake that needs a world; G3 reports it */ }
  return { tris, draws: 0, materials: 0, assetBytes: 0, textures: 0, texturePx: 0, how: 'estimate' };
}

/** A default shape for path/area defs (what exampleOp uses): a straight path or a square around the origin. */
export function shapeFor(d: Pick<StoredDef, 'form' | 'size'>): { path: [number, number][]; width?: number } | { area: [number, number][] } | undefined {
  const [w, , dd] = d.size.box, hw = Math.max(2, Math.min(40, w / 2)), hd = Math.max(2, Math.min(40, dd / 2));
  if (d.form === 'path') return { path: [[-hw, 0], [hw, 0]], width: Math.max(1, Math.min(8, dd)) };
  if (d.form === 'area') return { area: [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] };
  return undefined;
}
