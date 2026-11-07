// MARSLAND-FORK layer 3: the drone surroundings of Mars 2026 around the old-world Mars fork (/worlds/w/mars).
// The old-world view (WorldGeometry + MarsDesert) ends in a flat sand square with a ring of low cliffs; the real campus
// stands on open playa: the tyre ring of the old race track just west, tyre tracks, creosote scrub thickening toward the
// vegetated wash east, the 111 to the north curving south-east above the wash, salt flats and the Salton Sea south,
// mountains N/NE/NW and a big blue desert sky. The mars-two template (worlds/templates/mars-two.json, batch `land`, its
// world constants and sky/weather) already says all that as god ops on core/* defs; this module evaluates exactly those
// ops in a private WorldModel and draws them with the same mesh halves a new world uses (gen-mesh/desert.mesh.ts,
// gen-mesh/scenery.mesh.ts), turned and moved from the mars-two frame into the fork's frame:
//   fork (x, z) = V3 + [40, −30]; V3 = O + N·NORTH + E·EAST (Gene's Mimos plan, v3.mjs); mars-two (x, z) = frame.mjs
//   toWorld(build). Composed: a rotation by ≈64.75° about +y and a shift (FRAME below). The fork's sun uses the same
//   bearing (MARS_2026_NORTH_OFFSET −65 = mars-two BEARING 90 within 0.25°), so the sea is where the sun stands at noon.
// The panorama's shader places its ranges by world axes (camera-following), so it is not turned by the group: its
// compass bearings are shifted by the fork's north offset instead. Loaded lazily (only the fork pays for the kit).
import * as THREE from 'three';
import { WorldModel, applyBatch, type DefInput, type StoredDef, type Entity } from '@souls/world-compiler';
import desertKit from '../../../packages/world-compiler/src/core-kit/desert.json' with { type: 'json' };
import sceneryKit from '../../../packages/world-compiler/src/core-kit/scenery.json' with { type: 'json' };
import template from '../../../worlds/render/mars-fork-land.json' with { type: 'json' };
import { meshFor, type MeshCtx } from './gen-mesh/registry.ts';
import { MaterialLib } from './gen-mesh/materials.ts';
import { terrainColorFor } from './gen-mesh/ground-palette.ts';
import './gen-mesh/desert.mesh.ts';
import './gen-mesh/scenery.mesh.ts';
import type { SetWeather } from './WorldAtmosphere.ts';
import { MARS_2026_NORTH_OFFSET } from './mars-fork.ts';

// Gene's Mimos plan in V3 (tools/god-skill/scripts/mars-two/v3.mjs) and the backdrop's place in the fork (mars-2026-map.ts)
const O = [2.05645, -8.92635], NORTH = [0.4264952019559668, -0.9044898245467106], EAST = [0.9044898245467106, 0.4264952019559668];
const AT = [40, -30];
// mars-two world (x, z) → build (frame.mjs, BEARING 90): build = (z + 78, −x) → (N, E) = (x, z + 30) → V3 → fork
/** The mars-two world → fork transform: fork = R(yaw)·(x, z) + shift (three's rotation.y convention). */
export const FRAME = Object.freeze({ yaw: Math.atan2(EAST[0], NORTH[0]), shift: [O[0] + AT[0] + 30 * EAST[0], O[1] + AT[1] + 30 * EAST[1]] as const });
export const toForkXZ = (x: number, z: number): [number, number] => [O[0] + AT[0] + x * NORTH[0] + (z + 30) * EAST[0], O[1] + AT[1] + x * NORTH[1] + (z + 30) * EAST[1]];

type Template = { constants: Record<string, unknown>; state: { sky?: { palette?: string }; weather?: Record<string, unknown>; ground?: { palette?: string } }; batches: { group?: string; ops: Record<string, unknown>[] }[] };
const T = template as unknown as Template;

/** The land ops in the fork's terms: the panorama's bearings shifted by the fork's north (its shader ignores the group). */
export function forkLandOps(ops = T.batches.find((b) => b.group === 'land')?.ops ?? [], north = MARS_2026_NORTH_OFFSET) {
  return ops.map((op) => {
    if (op.def !== 'core/panorama@1') return op;
    const p = structuredClone(op.params as Record<string, unknown>);
    const turn = (o: Record<string, unknown> | undefined | null) => { if (o && typeof o.from === 'number' && typeof o.to === 'number') { o.from = (o.from as number) + north; o.to = (o.to as number) + north; } };
    for (const r of (p.ranges as Record<string, unknown>[] | undefined) ?? []) turn(r);
    turn(p.water as Record<string, unknown> | undefined);
    return { ...op, params: p };
  });
}

/** The land as a private world: the template's constants and state, the desert and scenery kits, the land batch. */
export function forkLandModel() {
  const w = new WorldModel({ constants: { ...(T.constants as object), ground: 'land' } as never, seed: 'mars-fork-land', state: T.state as never });
  for (const d of [...desertKit, ...sceneryKit] as unknown as DefInput[]) w.defineDef(d, 'core', 0);
  const r = applyBatch(w, { ops: forkLandOps() } as never, 'god', 1);
  if (!r.result.accepted) throw Error('mars fork land refused: ' + JSON.stringify(r.result).slice(0, 300));
  return w;
}

function build(w: WorldModel, e: Entity, materials: MaterialLib): THREE.Object3D | null {
  const def = w.resolvedDef(e.def) as StoredDef | undefined; if (!def) return null;
  const b = meshFor(def); if (!b) return null;
  const params: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(def.params)) if ((f as { default?: unknown }).default !== undefined) params[k] = (f as { default?: unknown }).default;
  Object.assign(params, e.params ?? {});
  const ctx = { def, entity: e, params, args: def.make.kind === 'gen' ? (def.make as { args?: Record<string, unknown> }).args ?? {} : {}, baked: w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), model: w, materials, tint: (_k: string, f: string) => f } as unknown as MeshCtx;
  const obj = b.build(ctx); if (!obj) return null;
  if (!b.world) { const p = w.worldPose(e); obj.position.set(p.x, p.y, p.z); obj.rotation.y = p.yaw; }
  obj.name ||= def.name;
  return obj;
}

/** The walkable extent's ground (the mars-two terrain: flat playa at base), vertex-painted like the entity terrain. */
function playa(w: WorldModel, step = 10): THREE.Mesh {
  const [x0, z0, x1, z1] = w.ground().extent, base = w.constants.base, nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, base, (z0 + z1) / 2);
  const paint = terrainColorFor(T.state.ground?.palette ?? 'playa'), c = new THREE.Color(), p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { paint(c, base, 0, base, p.getX(i), p.getZ(i)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  m.name = 'mars fork playa'; m.receiveShadow = true; m.userData.cameraTransparent = true; m.raycast = () => {};
  return m;
}

export type ForkLand = {
  group: THREE.Group;
  stats: { entities: number; drawn: string[]; tris: number };
  /** For the atmosphere: the template's set weather (clear desert) and no roofs (the fork's campus has its own). */
  atmosphere(): { weather: SetWeather | null; indoors: (x: number, y: number, z: number) => boolean };
  /** Hide what layer 3 replaces in the old-world view: the sand outside the camp, the old desert dressing and the camp's flat floor. */
  dress(camp: THREE.Object3D): number;
  dispose(): void;
};

export function createForkLand(groundY = 0): ForkLand {
  const w = forkLandModel(), materials = new MaterialLib(), base = w.constants.base;
  const group = new THREE.Group(); group.name = 'mars fork land';
  group.userData.edenSkyPalette = T.state.sky?.palette ?? null;   // read by the atmosphere's scene scan (WorldAtmosphere.ts)
  const turned = new THREE.Group(); turned.name = 'mars fork land (mars-two frame)';
  turned.rotation.y = FRAME.yaw; turned.position.set(FRAME.shift[0], groundY - base - 0.03, FRAME.shift[1]);
  group.add(turned);
  turned.add(playa(w));
  const drawn: string[] = [];
  for (const e of w.entities.values()) {
    const obj = build(w, e, materials); if (!obj) continue;
    drawn.push(e.name ?? e.def);
    if ((w.resolvedDef(e.def)?.make as { gen?: string } | undefined)?.gen === 'panorama/1') {
      group.add(obj);   // camera-following, world axes (bearings already in the fork's compass)
      obj.traverse((o) => { const u = ((o as THREE.Mesh).material as THREE.ShaderMaterial | undefined)?.uniforms; if (u?.uBase) u.uBase.value = groundY; });
    } else turned.add(obj);
  }
  let tris = 0;
  group.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || !m.geometry) return; const n = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position?.count ?? 0) / 3; tris += n * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1); });
  const raw = T.state.weather ?? {}, n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
  const weather: SetWeather | null = typeof raw.kind === 'string' && raw.kind !== 'auto' ? { kind: raw.kind, clouds: n(raw.clouds, 0.1), rain: n(raw.rain, 0), wind: n(raw.wind, 0.1), fog: n(raw.fog, 0), intensity: n(raw.intensity, 1) } : null;
  return {
    group,
    stats: { entities: w.entities.size, drawn, tris: Math.round(tris) },
    atmosphere: () => ({ weather, indoors: () => false }),
    dress(camp) {
      let hidden = 0;
      camp.traverse((o) => {
        const m = o as THREE.Mesh;
        const flatGround = m.isMesh && (m.geometry as THREE.PlaneGeometry)?.type === 'PlaneGeometry' && Math.abs(m.rotation.x + Math.PI / 2) < 1e-6 && m.position.y <= 0.05;
        // the old desert dressing (cliff ring, a 110 m ring of shrubs and stones, water totes, a container) is the old
        // world's fiction; the drone's scrub comes from the template (it keeps 120 m around the campus bare). Its pile
        // pads and build-site stakes ('mars desert marks', added later) stay.
        const oldDressing = o.parent?.name === 'mars desert' && o.name !== 'mars desert marks';
        if (oldDressing || o.name === 'outside-ground' || (flatGround && o.parent === camp)) { o.visible = false; hidden++; }
      });
      return hidden;
    },
    dispose() { group.removeFromParent(); },   // geometry caches are shared with the mesh halves (scrub, tyres): kept
  };
}
