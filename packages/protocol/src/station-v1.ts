// Isolated G003 checkpoint. No audio, renderer, model or wall-clock side effects.
import { z } from 'zod';
import { hashOf, nativeGatheringObservationV1Schema } from '@souls/engine-contract';

export const STATION_PINS_V1 = Object.freeze({
  score:'3b806f2084d5dcefcf9a2282828765657bd74220',
  adapter:'154dda2dd66558394ebf43798845eea5676fade9', tone:'15.1.22',
  catalog:'score/3b806f2084d5dcefcf9a2282828765657bd74220/starfield-zoning/1',
  policy:'two-piece-public-gathering/1',
});
export const stationPinsV1Schema=z.object({score:z.literal(STATION_PINS_V1.score),adapter:z.literal(STATION_PINS_V1.adapter),
  tone:z.literal(STATION_PINS_V1.tone),catalog:z.literal(STATION_PINS_V1.catalog),policy:z.literal(STATION_PINS_V1.policy)}).strict();
const tick=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const drawnTick=z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id=z.string().regex(/^[a-f0-9]{64}$/);
const worldId=z.string().min(1).max(128).refine(s=>s.trim()===s);
const rulesVersion=z.string().min(1).max(200);
const dt=z.number().finite().positive().max(1);
const scope={worldId,epoch:id,rulesVersion,dtSeconds:dt,pins:stationPinsV1Schema};
export const stationEpochV1Schema=z.object({contract:z.literal('station-epoch/1'),...scope,
  genesisId:id,createdTick:tick}).strict().superRefine((p,ctx)=>{
    if(p.epoch!==stationEpochId(p.worldId,p.genesisId))ctx.addIssue({code:'custom',message:'station epoch genesis identity differs'});
  });
export type StationEpochV1=z.infer<typeof stationEpochV1Schema>;
export function stationEpochId(world:string,genesisId:string){return hashOf({contract:'station-epoch/1',worldId:world,genesisId});}
const transition=z.object({previousCueId:id,previousEndTick:drawnTick,nextStartTick:tick,
  fadeOutBeats:z.literal(0),fadeInBeats:z.literal(0)}).strict();
const cueBodySchema=z.object({contract:z.literal('station-cue/1'),...scope,sequence:tick.positive(),
  pieceId:z.enum(['starfield','zoning-board']),bpm:z.union([z.literal(60),z.literal(108)]),
  seed:z.number().int().nonnegative().max(0xffffffff),startTick:tick,cycleCount:z.literal(4),energy:z.literal(0),
  observation:nativeGatheringObservationV1Schema,transition:transition.nullable()}).strict();
export const stationCueV1Schema=cueBodySchema.extend({cueId:id}).strict().superRefine((cue,ctx)=>{
  const {cueId,...body}=cue;
  if(hashOf(body)!==cueId)ctx.addIssue({code:'custom',message:'station cue content address differs'});
  if(cue.bpm!==(cue.pieceId==='starfield'?60:108))ctx.addIssue({code:'custom',message:'piece tempo differs'});
  if(cue.observation.tick!==cue.startTick||cue.observation.dtSeconds!==cue.dtSeconds||cue.observation.rulesVersion!==cue.rulesVersion)
    ctx.addIssue({code:'custom',message:'cue observation is mixed'});
  if((cue.pieceId==='zoning-board')!==(cue.observation.situation==='gathering'))ctx.addIssue({code:'custom',message:'piece differs from public situation'});
  if(cue.sequence===1 ? cue.transition!==null : cue.transition===null)ctx.addIssue({code:'custom',message:'transition sequence differs'});
  if(cue.transition&&(cue.transition.nextStartTick!==cue.startTick||cue.transition.previousEndTick>cue.startTick))
    ctx.addIssue({code:'custom',message:'transition overlaps or is mixed'});
  if(!Number.isSafeInteger(stationExpiryTick(cue)))ctx.addIssue({code:'custom',message:'cue expiry exceeds safe tick range'});
});
export type StationCueV1=z.infer<typeof stationCueV1Schema>;
export function makeStationCueV1(body:z.infer<typeof cueBodySchema>):StationCueV1 {
  const parsed=cueBodySchema.parse(body);return stationCueV1Schema.parse({...parsed,cueId:hashOf(parsed)});
}
export const stationAnchorV1Schema=z.object({contract:z.literal('station-anchor/1'),...scope,revision:tick.positive(),
  cueId:id.nullable(),sourceTick:tick,serverTimeMs:tick,beat:z.number().finite().nonnegative().nullable(),
  clockRate:z.number().finite().nonnegative().max(64),paused:z.boolean(),
  availability:z.enum(['supported','unsupported'])}).strict();
export type StationAnchorV1=z.infer<typeof stationAnchorV1Schema>;
export type StationFactKindV1='station-epoch-v1'|'station-cue-v1'|'station-anchor-v1';
export function isStationFactV1(kind:string):kind is StationFactKindV1{return ['station-epoch-v1','station-cue-v1','station-anchor-v1'].includes(kind);}
export function parseStationFactV1(kind:StationFactKindV1,payload:unknown){
  return kind==='station-epoch-v1'?stationEpochV1Schema.parse(payload):kind==='station-cue-v1'?stationCueV1Schema.parse(payload):stationAnchorV1Schema.parse(payload);
}
type Interval={startTick:number;dtSeconds:number;bpm:number};
export function stationEndTick(cue:Interval){return cue.startTick+128*60/(cue.bpm*cue.dtSeconds);}
export function stationExpiryTick(cue:Interval){return cue.startTick+Math.ceil(128*60/(cue.bpm*cue.dtSeconds));}
export function stationPhaseAtTick(cue:StationCueV1,at:number){
  stationCueV1Schema.parse(cue);drawnTick.parse(at);
  if(at<cue.startTick||at>=stationEndTick(cue))return null;
  // A valid representable tick immediately before the end can round its beat
  // to 128. Keep the half-open display interval rather than inventing cycle 4.
  const beat=Math.min((at-cue.startTick)*cue.dtSeconds*cue.bpm/60,128-Number.EPSILON*128);
  return {beat,cycle:Math.floor(beat/32),beatInCycle:beat%32};
}
export const stationLiveV1Schema=z.object({contract:z.literal('station-live/1'),worldId,
  station:stationEpochV1Schema.nullable(),cue:stationCueV1Schema.nullable(),anchor:stationAnchorV1Schema.nullable(),fresh:z.boolean()}).strict().superRefine((v,ctx)=>{
    if(v.station===null){if(v.cue||v.anchor||v.fresh)ctx.addIssue({code:'custom',message:'live station has no epoch'});return;}
    if(v.worldId!==v.station.worldId||v.cue&&!sameStationScopeV1(v.station,v.cue)||v.anchor&&!sameStationScopeV1(v.station,v.anchor))
      ctx.addIssue({code:'custom',message:'mixed live station scope'});
    if(v.anchor){try{acceptStationAnchorV1(null,v.anchor,v.cue);}catch{ctx.addIssue({code:'custom',message:'mixed live anchor'});}}
    if(v.fresh&&!v.anchor)ctx.addIssue({code:'custom',message:'fresh live station has no anchor'});
  });
export type StationLiveV1=z.infer<typeof stationLiveV1Schema>;
type StationScopeV1=Pick<StationEpochV1,'worldId'|'epoch'|'rulesVersion'|'dtSeconds'|'pins'>;
export function sameStationScopeV1(a:StationScopeV1,b:StationScopeV1){
  return a.worldId===b.worldId&&a.epoch===b.epoch&&a.rulesVersion===b.rulesVersion&&a.dtSeconds===b.dtSeconds&&hashOf(a.pins)===hashOf(b.pins);
}
export function acceptStationAnchorV1(previous:StationAnchorV1|null,incoming:unknown,cue:StationCueV1|null){
  const next=stationAnchorV1Schema.parse(incoming);
  if(previous){stationAnchorV1Schema.parse(previous);
    if(!sameStationScopeV1(previous,next)||next.revision<=previous.revision||next.sourceTick<previous.sourceTick)throw new Error('stale or mixed station anchor');}
  if(cue){stationCueV1Schema.parse(cue);
    if(!sameStationScopeV1(cue,next)||next.cueId!==cue.cueId||next.beat!==(stationPhaseAtTick(cue,next.sourceTick)?.beat??null))throw new Error('mixed station cue anchor');
  }else if(next.cueId!==null||next.beat!==null)throw new Error('anchor has no recorded cue');
  return next;
}
/** Scheduling projection only: estimated future tick is never an observed tick.
 * Pause/unsupported rate/recovered stale anchor stops; no finite interval repeats. */
export function stationLivePhaseV1(raw:unknown,serverNowMs:number){
  const view=stationLiveV1Schema.parse(raw);tick.parse(serverNowMs);
  const {station,cue,anchor}=view;
  if(!station||!cue||!anchor||!view.fresh||view.worldId!==station.worldId||!sameStationScopeV1(station,cue)||!sameStationScopeV1(cue,anchor))return null;
  acceptStationAnchorV1(null,anchor,cue);
  if(anchor.availability!=='supported'||anchor.paused||anchor.clockRate!==1||serverNowMs<anchor.serverTimeMs)return null;
  const estimatedTick=anchor.sourceTick+(serverNowMs-anchor.serverTimeMs)/(1000*anchor.dtSeconds);
  return stationPhaseAtTick(cue,estimatedTick);
}
const phaseSchema=z.object({beat:z.number().finite().nonnegative().lt(128),cycle:z.number().int().min(0).max(3),
  beatInCycle:z.number().finite().nonnegative().lt(32)}).strict();
export const stationHistoricalV1Schema=z.object({contract:z.literal('station-history/1'),worldId,epoch:id,rulesVersion,
  tick:drawnTick,cue:stationCueV1Schema.nullable(),anchor:stationAnchorV1Schema.nullable(),phase:phaseSchema.nullable()}).strict().superRefine((v,ctx)=>{
    if(!v.cue){if(v.anchor||v.phase)ctx.addIssue({code:'custom',message:'history filled a silent gap'});return;}
    if(v.phase===null||v.cue.worldId!==v.worldId||v.cue.epoch!==v.epoch||v.cue.rulesVersion!==v.rulesVersion||hashOf(v.phase)!==hashOf(stationPhaseAtTick(v.cue,v.tick)))
      ctx.addIssue({code:'custom',message:'mixed or out-of-interval station history'});
    if(v.anchor){try{acceptStationAnchorV1(null,v.anchor,v.cue);if(v.anchor.sourceTick>v.tick)throw new Error('future');}
      catch{ctx.addIssue({code:'custom',message:'future or mixed historical anchor'});}}
  });
