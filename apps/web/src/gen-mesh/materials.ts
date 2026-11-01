// The shared material library: one cached material per (kind, colour, flags). Owner: L1; L4 may
// add procedural textures (triplanar wood/stone/plaster) behind the same `get` signature.
import * as THREE from 'three';
import type { Material } from '@sim/generators';
import { KitSurfaceMaterial, type KitSurface } from './kit-surfaces.ts'; // Y1 / XP7 hook

type Look = { color: string; roughness: number; metalness: number; transparent?: boolean; opacity?: number; emissive?: boolean };
export const MATERIAL_LOOKS: Record<Material, Look> = {
  wood: { color: '#9a6b43', roughness: 0.8, metalness: 0 }, stone: { color: '#b9b3a6', roughness: 0.92, metalness: 0 },
  plaster: { color: '#efe6d4', roughness: 0.95, metalness: 0 }, brick: { color: '#a8553f', roughness: 0.9, metalness: 0 },
  glass: { color: '#bcd8e6', roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.38 }, metal: { color: '#8c9196', roughness: 0.35, metalness: 0.8 },
  fabric: { color: '#c46a5a', roughness: 1, metalness: 0 }, thatch: { color: '#c9a45c', roughness: 1, metalness: 0 },
  tile: { color: '#9b4a35', roughness: 0.7, metalness: 0 }, ceramic: { color: '#e8e2d6', roughness: 0.35, metalness: 0 },
  grass: { color: '#5f9a4c', roughness: 1, metalness: 0 }, water: { color: '#3a7ca8', roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.78 },
  sand: { color: '#d9c38f', roughness: 1, metalness: 0 }, gravel: { color: '#a9a397', roughness: 1, metalness: 0 },
  asphalt: { color: '#4b4d50', roughness: 0.95, metalness: 0 }, cobble: { color: '#9e968a', roughness: 0.95, metalness: 0 },
  dirt: { color: '#8a6a48', roughness: 1, metalness: 0 }, rock: { color: '#8d8a84', roughness: 0.95, metalness: 0 },
  moss: { color: '#5d7a3a', roughness: 1, metalness: 0 }, mud: { color: '#6a5136', roughness: 1, metalness: 0 },
  snow: { color: '#f2f4f6', roughness: 0.8, metalness: 0 }, leaf: { color: '#4b8a3c', roughness: 0.9, metalness: 0 },
  bark: { color: '#5a3d22', roughness: 1, metalness: 0 }, fur: { color: '#b07a45', roughness: 1, metalness: 0 },
  feather: { color: '#f2f0e6', roughness: 0.9, metalness: 0 }, paint: { color: '#e9e2d0', roughness: 0.6, metalness: 0 },
  plastic: { color: '#d94f4f', roughness: 0.5, metalness: 0 }, paper: { color: '#f4efe3', roughness: 1, metalness: 0 },
  rubber: { color: '#2b2b2b', roughness: 0.9, metalness: 0 }, emissive: { color: '#ffe9c4', roughness: 0.5, metalness: 0, emissive: true },
};

/** A subclass keeps the shader on material clones made by lights/state/look overrides. three ≥ r15x declares
 *  `varying vec4 vColor`, so the vec3 radiance takes its `.rgb`: a bare `vColor` failed to compile and every kit glow
 *  part (a lantern's lit body) silently drew nothing (r2.1 walk, walk-lantern@1). */
class VertexGlowMaterial extends THREE.MeshStandardMaterial {
  override onBeforeCompile(shader: Parameters<THREE.Material['onBeforeCompile']>[0]) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif');
  }
  override customProgramCacheKey() { return 'kit-vertex-glow/3'; }
}

export class MaterialLib {
  private cache = new Map<string, THREE.Material>();
  /** A material for a kind and colour. `vertexColors` materials ignore `color` (the geometry carries it). */
  get(kind: Material | undefined, color?: string, opts: { vertexColors?: boolean; glow?: number; side?: THREE.Side; finish?: 'kit-metal'; vertexGlow?: boolean; surface?: KitSurface | null; /** W2b: a building kit finish (its own cached material) */ buildingFinish?: string } = {}): THREE.Material {
    const look = MATERIAL_LOOKS[kind ?? 'paint'] ?? MATERIAL_LOOKS.paint;
    const c = color ?? look.color;
    const key = `${kind ?? 'paint'}|${opts.vertexColors ? 'vc' : c}|${opts.glow ?? 0}|${opts.side ?? 0}${opts.finish ? '|' + opts.finish : ''}${opts.vertexGlow ? '|vertex-glow' : ''}${opts.surface ? `|surface:${opts.surface.cls}:${opts.surface.pattern}` : ''}${opts.buildingFinish ? '|building:' + opts.buildingFinish : ''}`;
    let m = this.cache.get(key);
    if (!m) {
      const glow = opts.glow ?? (look.emissive ? 1 : 0);
      const Mat = opts.surface ? KitSurfaceMaterial : opts.vertexGlow && opts.vertexColors && glow > 0 ? VertexGlowMaterial : THREE.MeshStandardMaterial;
      const mat = new Mat({ color: opts.vertexColors ? '#ffffff' : c, roughness: opts.finish === 'kit-metal' ? 0.32 : look.roughness, metalness: opts.finish === 'kit-metal' ? 0.25 : look.metalness, vertexColors: !!opts.vertexColors, transparent: !!look.transparent, opacity: look.opacity ?? 1, depthWrite: !look.transparent, side: opts.side ?? THREE.FrontSide });
      if (opts.surface) { mat.userData.kitSurface = { ...opts.surface }; // Y1: kept by clones (userData is copied)
        // PERF-BATCH: the god surface shades in the shape's own metres (the per-vertex edenSurf attribute), so meshes
        // sharing this material merge without change; only its foliage class seeds a hue from the object origin.
        mat.userData.batchSafeShader = opts.surface.cls !== 'foliage'; }
      if (glow > 0) {
        mat.emissive = new THREE.Color(opts.vertexGlow && opts.vertexColors ? '#ffffff' : c); mat.emissiveIntensity = glow;
        if (opts.vertexGlow) mat.userData.kitGlowIntensity = glow;
      }
      m = mat; this.cache.set(key, m);
    }
    return m;
  }
  /** Default colour for a material kind. */
  colorOf(kind: Material | undefined): string { return (MATERIAL_LOOKS[kind ?? 'paint'] ?? MATERIAL_LOOKS.paint).color; }
  dispose() { for (const m of this.cache.values()) m.dispose(); this.cache.clear(); }
}
