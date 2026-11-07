// mars-2026-map/1: the furnished Mars camp placed on the 2026 Mars College campus map
// (the CAD reconstruction served at sim.mars.college). The camp keeps its own frame, ids,
// verbs, construction (the pallet-rack lookout) and cards unchanged; the campus is moved so
// the camp sits on clear desert ground south-west of Chiba. Campus buildings, racks and
// vehicles become static ground-band obstacles; Chiba and the other named campus places
// become destination regions. The campus GLB is a render backdrop at the same offset.
//
// Versioned and opt-in: only an engine configured with `map: MARS_2026_MAP` uses this map,
// and its rules version carries `+mars-2026-map/1`, so an old camp history is never replayed
// on the map (or the reverse). The source scene file is pinned by content hash.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {hashOf} from '@souls/engine-contract';
import type {Mars} from './load.ts';
import type {Obstacle, SpatialScene} from '../../../mars/viewer/engine/spatial/types.ts';
import type {Region, WorldState} from '../../../mars/viewer/engine/world/types.ts';
import type {CampusSceneFile} from '../../../mars/viewer/engine/campus/types.ts';

export const MARS_2026_MAP = 'mars-2026-map/1';
/** Exact tracked JSON bytes, independent of its self-declared contentHash. */
export const MARS_2026_SOURCE_SHA256 = '92b8f7d6b39a2bb92300042aac7d7ba917dca1754070127d44aa8f01f41a2a1c';
/** The exporter's declared content hash, checked in addition to exact bytes. */
export const MARS_2026_SOURCE_HASH = '256ac4954e7e2f00eef5146165933bb6bab52ef53305d35ac918cd5f542de25a';
/** world = campus + OFFSET (x, z); the campus ground (y −0.16) is lifted to the camp ground (y 0). */
export const MARS_2026_OFFSET: readonly [number, number] = Object.freeze([40, -30]) as readonly [number, number];
export const MARS_2026_LIFT = 0.16;
/** Walkable map area in world coordinates: the camp, Chiba, the staging yard, the north workshops and rack building. */
export const MARS_2026_BOUNDS: readonly [number, number, number, number] = Object.freeze([-70, -140, 100, 40]) as readonly [number, number, number, number];
/** The campus GLB the Mars viewer already publishes (allowlisted /browser/ derivative). */
export const MARS_2026_BACKDROP_URL = '/browser/campus.glb?v=20260922b';
export const CAMPUS_OBSTACLE_PREFIX = 'campus:';

const sourceUrl = new URL('../../../mars/viewer/public/engine/campus-2026.json', import.meta.url);
let cached: {file: CampusSceneFile; scene: SpatialScene; regions: Region[]} | undefined;

const provenance = {origin: 'canonical' as const, confidence: 'provisional' as const, note: 'mars-2026-map/1: Mars College 2026 CAD reconstruction region moved onto the camp frame; dimensions not field verified'};

/** The campus ground-band obstacles inside the map bounds, moved into the camp frame. Furnishing inside a covered
 * (interior:*) prism is dropped: the interior prism already blocks that ground. */
function campusObstacles(f: CampusSceneFile): Obstacle[] {
  const [ox, oz] = MARS_2026_OFFSET, [bx0, bz0, bx1, bz1] = MARS_2026_BOUNDS, G = f.groundY;
  const rows = f.obstacles.filter(r => r[8] > G + 0.22 && r[7] < G + 1.8).filter(r => {
    const x = r[2] + ox, z = r[3] + oz, rad = Math.hypot(r[4], r[5]);
    return x + rad > bx0 && x - rad < bx1 && z + rad > bz0 && z - rad < bz1;
  });
  const interiors = rows.filter(r => r[0].startsWith('interior:'));
  const corners = (r: typeof rows[number]) => {const c = Math.cos(r[6]), s = Math.sin(r[6]); return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => [r[2] + c * a * r[4] - s * b * r[5], r[3] + s * a * r[4] + c * b * r[5]]);};
  const inside = (p: number[], r: typeof rows[number]) => {const c = Math.cos(r[6]), s = Math.sin(r[6]), px = p[0] - r[2], pz = p[1] - r[3]; return Math.abs(c * px + s * pz) <= r[4] + 1e-6 && Math.abs(-s * px + c * pz) <= r[5] + 1e-6;};
  const kept = rows.filter(r => r[0].startsWith('interior:') || !interiors.some(i => Math.abs(i[2] - r[2]) < 60 && Math.abs(i[3] - r[3]) < 60 && corners(r).every(p => inside(p, i))));
  return kept.map(r => ({id: CAMPUS_OBSTACLE_PREFIX + r[0], kind: r[1], obb: {c: [round(r[2] + ox), round(r[3] + oz)] as [number, number], half: [r[4], r[5]] as [number, number], yaw: r[6]},
    y0: round(r[7] + MARS_2026_LIFT), y1: round(r[8] + MARS_2026_LIFT), label: f.labels[r[9]]}));
}
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Campus places (Chiba, workshops, rack buildings, compound) that lie in the map, as camp-frame regions. */
function campusRegions(f: CampusSceneFile): Region[] {
  const [ox, oz] = MARS_2026_OFFSET, [bx0, bz0, bx1, bz1] = MARS_2026_BOUNDS;
  return f.regions.filter(r => r.kind === 'place').map(r => ({...r, level: 0, polygon: r.polygon.map(([x, z]) => [round(x + ox), round(z + oz)] as [number, number]), provenance: {...provenance}}))
    .filter(r => r.polygon.some(([x, z]) => x > bx0 && x < bx1 && z > bz0 && z < bz1));
}

export function readMars2026Source(bytes: Uint8Array = readFileSync(sourceUrl)): CampusSceneFile {
  const sha256=createHash('sha256').update(bytes).digest('hex');
  if(sha256!==MARS_2026_SOURCE_SHA256)throw new Error('mars-2026-map.source-bytes-changed: an exact new source requires a new map version');
  const f = JSON.parse(Buffer.from(bytes).toString('utf8')) as CampusSceneFile;
  if (f.contentHash !== MARS_2026_SOURCE_HASH) throw new Error(`mars-2026-map.source-changed: campus-2026.json ${f.contentHash.slice(0, 12)} is not the pinned ${MARS_2026_SOURCE_HASH.slice(0, 12)}; a new map version is required`);
  return f;
}

/** The camp scene with the campus around it (one level-0 ground surface over the map bounds). */
export function mars2026Map(campScene: SpatialScene) {
  if (cached) return cached;
  const file = readMars2026Source();
  const [x0, z0, x1, z1] = MARS_2026_BOUNDS;
  const scene: SpatialScene & {backdrop?: unknown} = structuredClone(campScene);
  scene.bounds = [x0, z0, x1, z1];
  const ground = scene.surfaces.find(s => s.id === 'camp-ground');
  if (!ground) throw new Error('mars-2026-map.camp-ground-missing');
  ground.obb = {c: [(x0 + x1) / 2, (z0 + z1) / 2], half: [(x1 - x0) / 2, (z1 - z0) / 2], yaw: 0};
  ground.label = 'camp ground and the 2026 campus (flat desert ground)';
  const extra = campusObstacles(file);
  for (const o of extra) if (scene.obstacles.some(c => c.id === o.id)) throw new Error('mars-2026-map.obstacle-collision:' + o.id);
  scene.obstacles = [...scene.obstacles, ...extra];
  // Render-only metadata, ignored by navigation: the viewer draws the campus GLB here and skips campus:* prisms.
  scene.backdrop = {contract: 'mars-campus-backdrop/1', map: MARS_2026_MAP, url: MARS_2026_BACKDROP_URL, at: [MARS_2026_OFFSET[0], MARS_2026_LIFT, MARS_2026_OFFSET[1]],
    obstaclePrefix: CAMPUS_OBSTACLE_PREFIX, sourceHash: file.contentHash, hide: {kind: ['context_person', 'context_group', 'reference'], assembly: ['people', 'reference-ground'], layer: ['Aerial reference']}};
  cached = {file, scene, regions: campusRegions(file)};
  return cached;
}

/** A Mars engine binding whose camp lies on the 2026 map. Everything else (verbs, invariants, other scenes) is unchanged. */
export function withMars2026Map(m: Mars): Mars {
  const map = mars2026Map(m.scenes['eden-camp']);
  const staticHash = hashOf({scene: map.scene, regions: map.regions, map: MARS_2026_MAP});
  const edenCampWorld = (seed?: string): WorldState => {
    const w = m.edenCampWorld(seed) as WorldState;
    w.base = {...w.base, staticHash};
    for (const r of map.regions) {if (w.regions[r.id]) throw new Error('mars-2026-map.region-collision:' + r.id); w.regions[r.id] = structuredClone(r);}
    return w;
  };
  return {...m, scenes: {...m.scenes, 'eden-camp': map.scene}, edenCampWorld};
}
