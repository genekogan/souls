// /v1/god/schema: everything a god agent needs to know about the vocabulary, generated from
// the code so it never drifts (spec 33 §2 row 1, §3.4). Owner: L1.
import { z } from 'zod';
import { CREATION_LIMITS, describeGenerators, KIT_PRIMITIVES, KIT_ROLES, kitArgs, materialEnum, slotKind } from '@souls/generators';
import { clientOpSchema, componentsSchema, constraintSchema, defSchema, refusalCodes, type WorldConstants } from '@souls/world-compiler';
import { godVersions } from './versions.ts';
import { submissionSchema } from './submission.ts';
import {verifyCodes, verifyUseSchema} from './verify-use.ts';
import { buildCodes, buildFailure, buildStartSchema, buildFieldSchema, buildActionSchemas, BUILD_LIMITS } from './builds.ts';
import { DISTRICT_LIMITS, districtChapterSchema, districtCodes, districtFailure, districtPlanSchema } from './districts.ts'; // Y3 districts

let cached: Record<string, unknown> | null = null;
const limitsFor = (limits?: WorldConstants['limits']) => ({ ...CREATION_LIMITS,
  ...(limits ? { worldEntities: Math.min(CREATION_LIMITS.worldEntities, limits.entities), defSizeMaxM: limits.sizeMax, defSizeMinM: limits.sizeMin,
    defTris: limits.budget.tris, assetBytes: limits.budget.bytes, texturePx: limits.budget.texPx } : {}) });
export function godSchema(limits?: WorldConstants['limits']): Record<string, unknown> {
  if (cached) return { ...cached, limits: limitsFor(limits) };
  const js = (s: z.ZodType) => { try { return z.toJSONSchema(s, { unrepresentable: 'any', io: 'input' }); } catch (e) { return { error: String(e) }; } };
  cached = {
    contract: 'god-schema/1',
    versions: godVersions,
    conventions: {
      units: 'metres, radians; +x east, +z south, +y up; origin at the world centre',
      yaw: 'rotation about +y; a thing\'s front faces +z at yaw 0 (buildings: the `front` side); facing a point (dx, dz) is yaw = atan2(dx, dz)',
      position: 'p: [x, z] rests on whatever is below (ground, floor, water for anchor float); [x, y, z] keeps y (local to the parent frame)',
      forms: 'point defs take p; path defs take shape.path (+ width); area defs take shape.area',
      addressing: 'ids (e_…), paths of names (cottage/kitchen/chair-1), flag:<name>; in a batch, tmp ids ($c) refer to things placed earlier in it',
      layers: 'solid collides with solid and bodies; surface drapes (roads, lawns); volume is inside-able (water); decor never collides',
      rooms: 'buildings expose each room as a slot of kind room: in: {parent: house, slot: "kitchen"}, p local to the room origin',
      library: 'search the library first (GET /v1/god/defs?q=duck); define only what is missing; prefer params and presets over new kinds',
    },
    ops: js(clientOpSchema),
    submission: js(submissionSchema),
    verifyUse: js(verifyUseSchema),
    builds: { start: js(buildStartSchema), field: js(buildFieldSchema), actions: Object.fromEntries(Object.entries(buildActionSchemas).map(([k, v]) => [k, js(v)])), limits: BUILD_LIMITS, refusals: buildCodes.map(code => ({ code, fix: buildFailure(code, '').fix })) },
    districts: { plan: js(districtPlanSchema), chapter: js(districtChapterSchema), request: 'A chapter is POST /v1/god/builds {id, district: {id, plots?}, brief?, asks?, include?, title?, steps?}; omit site, massing and root: the server fills site, massing, title and steps from the plan. builds.start shows the filled shape.', limits: DISTRICT_LIMITS, refusals: districtCodes.map(code => ({ code, fix: districtFailure(code, '').fix })) }, // Y3
    def: js(defSchema),
    components: Object.keys((componentsSchema as unknown as { shape: Record<string, unknown> }).shape),
    constraints: js(constraintSchema),
    slotKinds: slotKind.options,
    materials: materialEnum.options,
    kit: { primitives: KIT_PRIMITIVES, roles: KIT_ROLES, args: js(kitArgs) },
    generators: describeGenerators(),
    refusals: [...refusalCodes, ...verifyCodes, ...buildCodes, ...districtCodes, 'site.under-construction'],
    endpoints: {
      read: ['GET /v1/world/builds', 'GET /v1/world/seq', 'GET /god/kit-primitives.png', 'GET /assets/<sha>.<ext>', 'GET /v1/god/assets/<sha>', 'GET /v1/god/defs/<ref>/thumb.png', 'GET /v1/world/snapshot', 'GET /v1/world/ground', 'GET /v1/world/tiles/:tx/:tz', 'GET /v1/world/entities/:path', 'GET /v1/god/schema', 'POST /v1/god/query'],
      god: ['GET /v1/god/contained', 'POST /v1/god/look', 'GET /v1/god/parts?q=', 'POST /v1/god/kit/render', 'GET /v1/god/defs/unused', 'POST /v1/god/defs/unused/remove', 'GET /v1/god/doctor', 'POST /v1/god/doctor (fix: true)', 'POST /v1/god/builds', 'GET /v1/god/builds', 'GET /v1/god/builds/:id', 'POST /v1/god/builds/:id/step', 'POST /v1/god/builds/:id/check', 'POST /v1/god/builds/:id/pause', 'POST /v1/god/builds/:id/resume', 'POST /v1/god/builds/:id/done', 'POST /v1/god/builds/:id/abandon', 'POST /v1/god/builds/:id/rewind', 'POST /v1/god/builds/:id/attention {lease?, at, eye?} (lead look hint; public reticle)', 'POST /v1/god/builds/:id/claims', 'POST /v1/god/builds/:id/claims/:cid/release', 'POST /v1/god/districts', 'GET /v1/god/districts', 'GET /v1/god/districts/:id', 'DELETE /v1/god/districts/:id', 'POST /v1/god/verify-use', 'GET /v1/god/snapshot', 'GET /v1/god/defs?q=&tag=', 'GET /v1/god/defs/<ref>', 'POST /v1/god/assets (multipart: file, footprint?, name, height?, tags?, license?, source?, define?)', 'GET /v1/god/assets[?core=1]', 'POST /v1/god/dryrun', 'POST /v1/god/preview', 'POST /v1/god/act (ops and/or preview, expect?, clientRef?)', 'GET /v1/god/requests/:clientRef', 'POST /v1/god/undo[?group=]', 'POST /v1/god/redo', 'GET /v1/god/edits', 'GET /v1/god/stream (SSE)', 'GET /v1/god/prayers', 'POST /v1/god/answer'],
    },
  };
  return { ...cached, limits: limitsFor(limits) };
}
