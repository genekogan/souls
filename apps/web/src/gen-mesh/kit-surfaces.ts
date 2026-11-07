// Y1 / XP7: procedural surfaces for god kit/2 contract-2 shapes. Presentation only. A kit opts in with `surfaces: true`:
// its opaque shapes then take the native Eden realism shader (WorldEdenRealism.ts) by material class. A shape's
// `pattern` (marble, ashlar, planks, shingles, stripes) opts that shape in on its own. Without either, v2 shapes draw
// exactly as before, and contract-1 kits, library generators and glass/water/emissive/glowing shapes stay as they were.
// Patterns are drawn in each shape's own metres (a per-vertex `edenSurf` attribute), so they follow the shape's yaw,
// pitch and scale, hold still while a thing eases in or moves, and differ per shape by a seed. `?surfaces=0` turns
// every god surface off (plain materials and draws exactly as before) for comparison.
import * as THREE from 'three';
import type { KitShape, Material } from '@souls/generators';
import { GOD_SURFACE_KEY, patchGodSurface, type GodSurface, type RealismClass } from '../WorldEdenRealism.ts';

export type KitSurface = GodSurface;
export const KIT_PATTERN_ID: Readonly<Record<string, number>> = { marble: 1, ashlar: 2, planks: 3, shingles: 4, stripes: 5 };
/** The realism class a contract-2 material gets by default; absent materials (paint, plastic, ceramic…) stay flat. */
export const MATERIAL_SURFACE: Readonly<Partial<Record<Material, RealismClass>>> = {
  wood: 'wood', bark: 'bark', stone: 'stone', rock: 'stone', cobble: 'stone', brick: 'stone', plaster: 'plaster',
  tile: 'roof', thatch: 'roof', metal: 'metal', fabric: 'cloth', sand: 'soil', gravel: 'soil', dirt: 'soil', mud: 'soil',
  leaf: 'foliage', moss: 'foliage', grass: 'foliage',
};
const FLAT = new Set<string>(['glass', 'water', 'emissive']);
const ROUND = new Set<string>(['cyl', 'cone', 'sphere', 'lathe', 'capsule']);
const surfacesOff = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('surfaces') === '0';
const OFF = surfacesOff();

/** The surface of one contract-2 draw class, or null when it stays flat (unlit opaque shapes only). `classes` is the
 *  kit's `surfaces` opt-in; an explicit pattern needs no opt-in. */
export function kitSurface(material: string | undefined, glowLevel: number, pattern?: string, classes = false): KitSurface | null {
  const kind = material ?? 'paint', id = pattern ? KIT_PATTERN_ID[pattern] ?? 0 : 0;
  if (OFF || glowLevel > 0 || FLAT.has(kind) || pattern === 'none' || (!id && !classes)) return null;
  const cls = MATERIAL_SURFACE[kind as Material] ?? null;
  return cls || id ? { cls: cls ?? 'generic', pattern: id } : null;
}
/** Draw-class suffix: a shape draws apart from its material's other shapes only when its pattern changes the surface. */
export function kitSurfaceSuffix(sh: KitShape, classes = false): string {
  if (OFF || !sh.pattern || sh.glow || sh.material === 'emissive') return '';
  return JSON.stringify(kitSurface(sh.material, 0, undefined, classes)) === JSON.stringify(kitSurface(sh.material, 0, sh.pattern, classes)) ? '' : `:${sh.pattern}`;
}
/** Surface for a contract-2 class key `material:glow[:pattern]` (kit.mesh.ts classOf) of a kit with or without `surfaces`. */
export function kitClassSurface(key: string, classes = false): KitSurface | null {
  const [material, level, pattern] = key.split(':');
  return kitSurface(material, Number(level) || 0, pattern, classes);
}

const seedOf = (at: readonly number[]) => { let h = 2166136261; for (const c of at.map(v => v.toFixed(3)).join(',')) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 990) / 1000; };
/** Per-vertex shape-local metres (signed scale applied, before yaw/pitch/roll; x = the longer horizontal side) and
 *  one word: the stripe count around a round shape (0 otherwise) plus a seed in [0, .99). `g` must still be in the
 *  primitive's own frame (before placement); vertex order must match the placed geometry. */
export function kitSurfaceAttribute(sh: KitShape, g: THREE.BufferGeometry): THREE.BufferAttribute {
  const p = g.attributes.position, [sx, sy, sz] = sh.scale ?? [1, 1, 1], n = p.count, out = new Float32Array(n * 4);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = p.getX(i) * sx, z = p.getZ(i) * sz; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const round = ROUND.has(sh.kind), swap = !round && z1 - z0 > x1 - x0 + 1e-6;
  const radius = round ? Math.max(Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1), 0) : 0;
  const word = (round ? Math.max(8, 2 * Math.round(Math.PI * radius / 0.4)) : 0) + seedOf(sh.at);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i) * sx, y = p.getY(i) * sy, z = p.getZ(i) * sz;
    // A quarter turn about y (det +1), never a reflection: the shader's derivative face normal keeps its outward side.
    out[i * 4] = swap ? z : x; out[i * 4 + 1] = y; out[i * 4 + 2] = swap ? -x : z; out[i * 4 + 3] = word;
  }
  return new THREE.BufferAttribute(out, 4);
}

/** A standard material that keeps its god surface on clones (looks, lights and state copy library materials). */
export class KitSurfaceMaterial extends THREE.MeshStandardMaterial {
  override onBeforeCompile(shader: Parameters<THREE.Material['onBeforeCompile']>[0]) {
    const surface = this.userData.kitSurface as KitSurface | undefined;
    if (surface) patchGodSurface(shader, surface);
  }
  override customProgramCacheKey() { return this.userData.kitSurface ? GOD_SURFACE_KEY : ''; }
}
