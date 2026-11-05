import {z} from 'zod';
import {bodyMotionProblem,type BodyMotion} from '../../../mars/viewer/engine/bodies/motion.ts';

import {ROLLING_GRIPPER,QUADRUPED_TORSO} from '../../../mars/viewer/engine/bodies/action-profile.ts';
const id=z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const url=z.string().regex(/^\/(?:w\/[a-z0-9-]+\/)?(?:v1\/edge\/body\/assets\/body_[a-f0-9]{64}\.glb|world-assets\/littlemartians\/characters\/[a-z0-9-]+\.glb)$/);
/** core/humanoid@2 look params (compact: only non-default keys). Values are checked against the def by the
 *  server (apps/web/src/humanoid/look.ts); here only their shape. `model` is then the look's template key. */
const lookParams=z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/),z.union([z.string().max(32),z.number().finite()])).refine(p=>Object.keys(p).length<=48,'at most 48 look params');
const LOOK_MODEL=/^humanoid2-[0-9a-f]{16}$/;
/** Creature species (mars/viewer/engine/bodies/creatures.ts CREATURE_IDS): drawn procedurally, eye height as hoverHeight. */
export const CREATURE_MODELS=['duck','snail','dog'] as const;
export const bodyV1Schema=z.strictObject({
  family:z.enum(['humanoid','floater']),type:z.enum(['humanoid','ceramic','floater','creature']).optional(),
  model:z.string().regex(/^(?:[a-z0-9-]{1,64}|body_[a-f0-9]{64})$/).optional(),modelUrl:url.optional(),
  avatar:z.strictObject({kind:z.literal('body'),modelUrl:url,bodyType:z.enum(['humanoid','ceramic','floater'])}).optional(),
  radius:z.number().min(.15).max(.9).optional(),hoverHeight:z.number().min(.1).max(3).optional(),
  actionProfile:z.enum([ROLLING_GRIPPER,QUADRUPED_TORSO]).optional(),params:lookParams.optional(),motion:z.custom<BodyMotion>(x=>bodyMotionProblem(x)===null).optional(),
}).refine(b=>b.actionProfile===undefined||(b.family==='humanoid'&&b.modelUrl!==undefined&&b.params===undefined))
 .refine(b=>b.motion===undefined||(b.family==='floater'&&b.type!=='creature'))
 .refine(b=>b.type===undefined||(b.family==='humanoid'?b.type==='humanoid':b.type==='ceramic'||b.type==='floater'||b.type==='creature'))
 .refine(b=>b.type==='creature'?(CREATURE_MODELS as readonly string[]).includes(b.model??'')&&b.modelUrl===undefined&&b.avatar===undefined&&b.params===undefined&&(b.hoverHeight===undefined||b.hoverHeight<=1.2):(b.hoverHeight===undefined||b.hoverHeight>=.4))
 .refine(b=>b.family!=='humanoid'||(b.radius===undefined&&b.hoverHeight===undefined&&(b.model===undefined||b.modelUrl!==undefined||b.params!==undefined)))
 .refine(b=>b.params===undefined||(b.family==='humanoid'&&b.modelUrl===undefined&&b.avatar===undefined&&typeof b.model==='string'&&LOOK_MODEL.test(b.model)))
 .refine(b=>b.avatar===undefined||(b.avatar.modelUrl===b.modelUrl&&b.avatar.bodyType===(b.type??b.family)));
/** A durable body assignment contains the resolved admitted body, never a path from the upload form. */
export const bodyAssignmentV1Schema=z.strictObject({contract:z.literal('body-assignment/1'),worldId:id,soulId:id,entityId:id,body:bodyV1Schema.nullable()});
export type BodyAssignmentV1=z.infer<typeof bodyAssignmentV1Schema>;
