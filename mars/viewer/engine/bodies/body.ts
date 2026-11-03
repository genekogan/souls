// Body families (spec: eden4 merge, Little Martians). Every existing person is a humanoid: an entity
// without `body` is one, and nothing here changes how humanoids are planned, hashed or recorded. A
// floater is a static scanned head with no rig: its ground pose (pose.p, on the walkable surface like a
// humanoid's feet) is planned with the engine's ordinary ground collision, and it is drawn hovering
// `hoverHeight` above that pose with a bob, tilt and yaw computed from the sampled tick (pose.ts).
import type { Body, Entity } from '../world/types.ts';
import {bodyMotionProblem,type BodyMotion} from './motion.ts';
import { humanoidParamsProblem } from './humanoid.ts';
import { CREATURE_EYE_RANGE, creatureSpecies } from './creatures.ts';

export type BodyFamily = Body['family'];

/** A floater's body with every default filled in. */
export type FloaterBody = { family: 'floater'; type?: 'ceramic' | 'floater' | 'creature'; model?: string; radius: number; hoverHeight: number; motion?: BodyMotion };

/** Head radius (m): a 0.7 m head clears a 0.9 m door with margin and reads at human scale. */
export const FLOATER_RADIUS = 0.35;
/** Height (m) of the head's centre above its ground pose: face to face with a standing humanoid. */
export const FLOATER_HOVER = 1.45;
export const FLOATER_RADIUS_RANGE: readonly [number, number] = [0.15, 0.9];
export const FLOATER_HOVER_RANGE: readonly [number, number] = [0.4, 3.0];

export const HUMANOID: Readonly<Body> = Object.freeze({ family: 'humanoid' });

/** The entity's body; humans without the field are humanoids. Never mutates or allocates for humanoids. */
export function bodyOf(e: Pick<Entity, 'body'> | undefined): Readonly<Body> {
  return e?.body ?? HUMANOID;
}

export const isFloater = (e: Pick<Entity, 'body'> | undefined): boolean => e?.body?.family === 'floater';

/** Defaults for a floater body; throws on a non-floater (callers check isFloater first). */
export function floaterBody(body: Body | undefined): FloaterBody {
  if (body?.family !== 'floater') throw new Error(`not a floater body: ${JSON.stringify(body)}`);
  return { family: 'floater', ...(body.type === 'creature' ? { type: 'creature' as const } : {}), ...(body.model !== undefined ? { model: body.model } : {}), radius: body.radius ?? FLOATER_RADIUS, hoverHeight: body.hoverHeight ?? FLOATER_HOVER, ...(body.motion?{motion:body.motion}:{}) };
}

/** Structural check of a body value (for world edits / seeds); returns an error code or null. */
export function bodyProblem(body: unknown): string | null {
  if (body === undefined) return null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body.not-object';
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!['family', 'type', 'model', 'modelUrl', 'avatar', 'radius', 'hoverHeight', 'params', 'motion'].includes(k)) return `body.unknown-field:${k}`;
  if(b.motion!==undefined){if(b.family!=='floater'||b.type==='creature')return 'body.motion-family';const p=bodyMotionProblem(b.motion);if(p)return p;}
  if (b.family !== 'humanoid' && b.family !== 'floater') return 'body.family';
  if (b.type !== undefined && !(b.family==='humanoid' ? b.type==='humanoid' : b.type==='ceramic'||b.type==='floater'||b.type==='creature')) return 'body.type';
  // creature bodies (bodies/creatures.ts): a known species, drawn procedurally (no model URL), eye height as hoverHeight
  if (b.type === 'creature' && (!creatureSpecies(b.model) || b.modelUrl !== undefined || b.avatar !== undefined || b.params !== undefined)) return 'body.creature';
  if (b.model !== undefined && (typeof b.model !== 'string' || !/^(?:[a-z0-9-]{1,64}|body_[a-f0-9]{64})$/.test(b.model))) return 'body.model';
  const safeUrl=(v:unknown)=>typeof v==='string' && /^\/(?:w\/[a-z0-9-]+\/)?(?:v1\/edge\/body\/assets\/body_[a-f0-9]{64}\.glb|world-assets\/littlemartians\/characters\/[a-z0-9-]+\.glb)$/.test(v);
  if (b.modelUrl!==undefined && !safeUrl(b.modelUrl)) return 'body.model-url';
  if(b.avatar!==undefined){const a=b.avatar as Record<string,unknown>;if(!a||typeof a!=='object'||Object.keys(a).some(k=>!['kind','modelUrl','bodyType'].includes(k))||a.kind!=='body'||!safeUrl(a.modelUrl)||a.modelUrl!==b.modelUrl||a.bodyType!==(b.type??b.family))return 'body.avatar';}
  const inRange = (v: unknown, [lo, hi]: readonly [number, number]) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (b.radius !== undefined && !inRange(b.radius, FLOATER_RADIUS_RANGE)) return 'body.radius';
  if (b.hoverHeight !== undefined && !inRange(b.hoverHeight, b.type === 'creature' ? CREATURE_EYE_RANGE : FLOATER_HOVER_RANGE)) return 'body.hover-height';
  // core/humanoid@2 look: compact params with model = the look key (bodies/humanoid.ts reads the physical ones)
  if (b.params !== undefined) {
    if (b.family !== 'humanoid' || b.modelUrl !== undefined || b.avatar !== undefined || typeof b.model !== 'string' || !/^humanoid2-[0-9a-f]{16}$/.test(b.model)) return 'body.params';
    const problem = humanoidParamsProblem(b.params); if (problem) return problem;
  }
  if (b.family === 'humanoid' && (b.radius !== undefined || b.hoverHeight !== undefined || (b.model!==undefined && !b.modelUrl && b.params === undefined))) return 'body.humanoid-fields';
  return null;
}

/**
 * A copy of `e` with a floater body (for seeding). The input is not touched; humanoids stay without
 * the field so their hashes are unchanged.
 */
export function withBody<T extends Entity>(e: T, body: Body): T {
  const problem = bodyProblem(body);
  if (problem) throw new Error(`${e.id}: ${problem}`);
  const copy = structuredClone(e);
  if (body.family === 'humanoid' && !body.modelUrl && !body.params) delete copy.body;
  else copy.body = { ...body };
  return copy;
}
