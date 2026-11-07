// W-001: validate recorded wire structure without importing a Runtime or viewer.
// This does not validate physics, content hashes, authority or privacy; producers
// and consumers must prove those separately. Additive fields are preserved.
import { z } from 'zod';
import { renderSceneRefV1Schema } from '@souls/engine-contract/scene-capture';
export {decodeSceneCapturePublication,type SceneCapturePublication} from './scene-capture.ts';

const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const pose = z.array(finite).refine(x => x.length === 5 || x.length === 7, 'pose sample must have five or seven quanta');
export const recordedTakeSchema = z.object({
  schema: z.enum(['mars-take/1', 'mars-take/2', 'mars-take/3', 'mars-take/4']),
  id: z.string().min(1), baselineStateHash: z.string().min(1), finalStateHash: z.string().min(1), rulesVersion: z.string().min(1),
  dt: finite.positive(), startTick: tick, ticks: tick, keyframeEvery: tick.positive(),
  tracks: z.record(z.string(), z.array(pose)),
  changes: z.array(z.tuple([tick, z.string(), z.string(), z.unknown()])),
  events: z.array(z.object({ t: tick, type: z.string() }).passthrough()),
  finalState: z.object({ entities: z.record(z.string(), z.unknown()) }).passthrough(),
  entities0: z.record(z.string(), z.unknown()).optional(),
  removed: z.array(z.object({ id: z.string(), t: tick }).passthrough()).optional(),
  renderSceneRef: renderSceneRefV1Schema.optional(),
}).passthrough().superRefine((take,ctx)=>{
  if(take.renderSceneRef && take.renderSceneRef.rulesVersion!==take.rulesVersion)
    ctx.addIssue({code:'custom',message:'take and render scene rules versions differ'});
});
export type RecordedTake = z.infer<typeof recordedTakeSchema>;

export const recordedTakeChunkSchema = z.object({
  fromTick: tick, toTick: tick, take: recordedTakeSchema,
}).passthrough().superRefine((chunk, ctx) => {
  if (chunk.fromTick !== chunk.take.startTick || chunk.toTick - chunk.fromTick !== chunk.take.ticks) {
    ctx.addIssue({ code: 'custom', message: 'chunk absolute interval must match take origin and duration' });
  }
});
export const recordedTakeStreamSchema = z.object({ serverTick: tick, chunks: z.array(recordedTakeChunkSchema) }).passthrough();
export const recordedTakeHistorySchema = recordedTakeStreamSchema.extend({ next: tick.nullable() });
export type RecordedTakeChunk = z.infer<typeof recordedTakeChunkSchema>;

/** Current static-on-load /v1/scene envelope; not W-002's future geometry codec. */
export const scenePublicationSchema = z.object({
  scene: z.object({
    bounds: z.tuple([finite, finite, finite, finite]),
    levels: z.array(z.unknown()), surfaces: z.array(z.unknown()), obstacles: z.array(z.unknown()), links: z.array(z.unknown()),
  }).passthrough().nullable(),
  buildings: z.array(z.object({ file: z.string(), p: vec3, yaw: finite.optional() }).passthrough()).optional(),
  kin: z.array(z.object({ model: z.string(), p: vec3, yaw: finite.optional(), radius: finite.positive().optional(), hoverHeight: finite.optional() }).passthrough()).optional(),
  clock: z.object({ origin: z.number().int().safe() /* negative on a god world whose time of day was set early (R4-LIVE) */, dayTicks: tick.positive() }).nullable().optional(),
  ground: z.literal('grass').optional(),
}).passthrough();
export type ScenePublication = z.infer<typeof scenePublicationSchema>;
