// Small public historical-render codec. No engine, storage or private-intent import.
import {z} from 'zod';
import {renderSceneRefV1Schema,parseRenderSceneCapture,type RenderSceneCaptureV1} from '@souls/engine-contract/scene-capture';

/** Caller verifies selected world/requested hash. This decoder verifies bounded
 * structure/content; capture input is the trusted public render projection. */
export type SceneCapturePublication=RenderSceneCaptureV1 & {worldId:string};
export function decodeSceneCapturePublication(raw:unknown):SceneCapturePublication {
  const envelope=z.object({worldId:z.string().min(1).max(96),contract:z.literal('render-scene-capture/1'),
    ref:renderSceneRefV1Schema,body:z.unknown()}).strict().parse(raw);
  const {worldId,...capture}=envelope;
  return {worldId,...parseRenderSceneCapture(capture)};
}
