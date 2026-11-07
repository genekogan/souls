// Candidate G006 codecs. No network installation, clock, models or audio.
import { z } from 'zod';
import { hashOf,nativeGatheringObservationV1Schema } from '@souls/engine-contract';
import { stationEpochV1Schema,stationCueV1Schema,stationAnchorV1Schema,stationPinsV1Schema,
  stationEndTick,stationExpiryTick,type StationCueV1,type StationAnchorV1 } from './station-v1.ts';
import { stationPhysicalHeadV1Schema,acceptStationPhysicalHeadV1,foldStationRulesEraV1,type StationPhysicalHeadV1 } from './station-era-v1.ts';
const tick=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const drawnTick=z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id=z.string().regex(/^[a-f0-9]{64}$/);
const rules=z.string().min(1).max(200);
const scope={worldId:z.string().min(1).max(128).refine(s=>s.trim()===s),epoch:id,
  dtSeconds:z.number().finite().positive().max(1),pins:stationPinsV1Schema};
const cueBody=z.object({contract:z.literal('station-cue/2'),...scope,rulesVersion:rules,eraRevision:tick,sequence:tick.positive(),
  pieceId:z.enum(['starfield','zoning-board']),bpm:z.union([z.literal(60),z.literal(108)]),
  seed:z.number().int().nonnegative().max(0xffffffff),startTick:tick,cycleCount:z.literal(4),energy:z.literal(0),
  observation:nativeGatheringObservationV1Schema,
  transition:z.object({previousCueId:id,previousEndTick:drawnTick,nextStartTick:tick,fadeOutBeats:z.literal(0),fadeInBeats:z.literal(0)}).strict().nullable(),
}).strict();
export const stationCueV2Schema=cueBody.extend({cueId:id}).strict().superRefine((c,ctx)=>{
  const no=()=>ctx.addIssue({code:'custom',message:'V2 cue hash, observation, interval or transition differs'});
  const {cueId,...body}=c;
  if(hashOf(body)!==cueId||c.bpm!==(c.pieceId==='starfield'?60:108)
    ||c.observation.tick!==c.startTick||c.observation.rulesVersion!==c.rulesVersion||c.observation.dtSeconds!==c.dtSeconds
    ||(c.pieceId==='zoning-board')!==(c.observation.situation==='gathering')
    ||(c.sequence===1?c.transition!==null:c.transition===null)
    ||c.transition&&(c.transition.nextStartTick!==c.startTick||c.transition.previousEndTick>c.startTick)
    ||!Number.isSafeInteger(stationExpiryTick(c)))no();
});
export type StationCueV2=z.infer<typeof stationCueV2Schema>;
export function makeStationCueV2(raw:z.infer<typeof cueBody>):StationCueV2 {
  const body=cueBody.parse(raw);return stationCueV2Schema.parse({...body,cueId:hashOf(body)});
}
export const stationCueVariantSchema=z.union([stationCueV1Schema,stationCueV2Schema]);
export type StationCueVariant=StationCueV1|StationCueV2;
export const stationCueEraRevision=(cue:StationCueVariant)=>cue.contract==='station-cue/1'?0:cue.eraRevision;
/** Explicit variant arithmetic; no V1 relabeling or replayed selection. */
export function stationPhaseAtTickV2(raw:unknown,at:number){
  const cue=stationCueVariantSchema.parse(raw);drawnTick.parse(at);
  if(at<cue.startTick||at>=stationEndTick(cue))return null;
  const beat=Math.min((at-cue.startTick)*cue.dtSeconds*cue.bpm/60,128-Number.EPSILON*128);
  return {beat,cycle:Math.floor(beat/32),beatInCycle:beat%32};
}
export const stationAnchorV2Schema=z.object({contract:z.literal('station-anchor/2'),...scope,revision:tick.positive(),
  physicalRulesVersion:rules,physicalEraRevision:tick,cueId:id.nullable(),cueRulesVersion:rules.nullable(),cueEraRevision:tick.nullable(),
  sourceTick:tick,serverTimeMs:tick,beat:z.number().finite().nonnegative().lt(128).nullable(),
  clockRate:z.number().finite().nonnegative().max(64),paused:z.boolean(),availability:z.enum(['supported','unsupported']),
}).strict().superRefine((a,ctx)=>{
  if(a.cueId===null?(a.cueRulesVersion!==null||a.cueEraRevision!==null||a.beat!==null):(a.cueRulesVersion===null||a.cueEraRevision===null))
    ctx.addIssue({code:'custom',message:'V2 anchor cue origin differs'});
});
export type StationAnchorV2=z.infer<typeof stationAnchorV2Schema>;
export const stationAnchorVariantSchema=z.union([stationAnchorV1Schema,stationAnchorV2Schema]);
export type StationAnchorVariant=StationAnchorV1|StationAnchorV2;
const sameOrigin=(a:z.infer<typeof stationEpochV1Schema>,b:z.infer<typeof stationAnchorV2Schema>|StationCueVariant|StationAnchorV1)=>
  a.worldId===b.worldId&&a.epoch===b.epoch&&a.dtSeconds===b.dtSeconds&&hashOf(a.pins)===hashOf(b.pins);
/** A cue's physical head is independently supplied when its origin precedes
 * the current head. Two bounded heads, not an unbounded chain or guessed rules. */
export function acceptStationCuePhysicalV2(rawCue:unknown,rawHead:unknown,rawStation:unknown,current:StationPhysicalHeadV1){
  const cue=stationCueVariantSchema.parse(rawCue),station=stationEpochV1Schema.parse(rawStation);
  current=acceptStationPhysicalHeadV1(current,station,{worldId:station.worldId,rulesVersion:current.rulesVersion,dtSeconds:station.dtSeconds});
  const head=acceptStationPhysicalHeadV1(rawHead,station,{worldId:station.worldId,rulesVersion:cue.rulesVersion,dtSeconds:cue.dtSeconds});
  if(!sameOrigin(station,cue)||head.revision!==stationCueEraRevision(cue)||head.revision>current.revision
    ||cue.startTick<head.effectiveTick||cue.startTick<station.createdTick
    ||head.revision===current.revision&&hashOf(head)!==hashOf(current)
    ||head.era&&current.era&&head.revision<current.revision&&head.era.seq>=current.era.payload.source.seq
    ||head.revision<current.revision&&cue.startTick>current.effectiveTick)
    throw new Error('station cue originating physical head differs');
  return cue;
}
export function acceptStationAnchorV2(previous:StationAnchorVariant|null,raw:unknown,rawCue:StationCueVariant|null,
  rawHead:unknown,rawStation:unknown){
  const next=stationAnchorVariantSchema.parse(raw),station=stationEpochV1Schema.parse(rawStation),head=stationPhysicalHeadV1Schema.parse(rawHead);
  acceptStationPhysicalHeadV1(head,station,{worldId:station.worldId,rulesVersion:head.rulesVersion,dtSeconds:station.dtSeconds});
  if(!sameOrigin(station,next)||next.sourceTick<head.effectiveTick)throw new Error('station anchor physical origin differs');
  if(next.contract==='station-anchor/1'){
    if(head.revision!==0||next.rulesVersion!==head.rulesVersion)throw new Error('V1 anchor is unavailable in a later physical era');
  }else if(next.physicalEraRevision!==head.revision||next.physicalRulesVersion!==head.rulesVersion)
    throw new Error('V2 anchor physical era differs');
  if(previous){const prev=stationAnchorVariantSchema.parse(previous);
    if(!sameOrigin(station,prev)||next.revision<=prev.revision||next.sourceTick<prev.sourceTick
      ||prev.contract==='station-anchor/2'&&(next.contract==='station-anchor/1'||next.physicalEraRevision<prev.physicalEraRevision))
      throw new Error('station anchor revision, source or physical era regressed');}
  const cue=rawCue?stationCueVariantSchema.parse(rawCue):null;
  if(cue){
    if(!sameOrigin(station,cue)||next.sourceTick<cue.startTick||next.cueId!==cue.cueId||next.beat!==(stationPhaseAtTickV2(cue,next.sourceTick)?.beat??null)
      ||next.contract==='station-anchor/1'&&(stationCueEraRevision(cue)!==0||next.rulesVersion!==cue.rulesVersion)
      ||next.contract==='station-anchor/2'&&(next.cueRulesVersion!==cue.rulesVersion||next.cueEraRevision!==stationCueEraRevision(cue)))
      throw new Error('station anchor musical origin differs');
  }else if(next.cueId!==null||next.beat!==null)throw new Error('station anchor has no recorded cue');
  return next;
}
const viewBody={worldId:scope.worldId,station:stationEpochV1Schema.nullable(),physical:stationPhysicalHeadV1Schema.nullable(),
  cue:stationCueVariantSchema.nullable(),cuePhysical:stationPhysicalHeadV1Schema.nullable(),anchor:stationAnchorVariantSchema.nullable()};
function checkView(v:z.infer<typeof liveBody>,ctx:z.RefinementCtx){
  const no=()=>ctx.addIssue({code:'custom',message:'V2 station view contains mixed or missing provenance'});
  if(!v.station){if(v.physical||v.cue||v.cuePhysical||v.anchor||v.fresh)no();return;}
  if(!v.physical||v.worldId!==v.station.worldId){no();return;}
  try{
    acceptStationPhysicalHeadV1(v.physical,v.station,{worldId:v.worldId,rulesVersion:v.physical.rulesVersion,dtSeconds:v.station.dtSeconds});
    if(v.cue){if(!v.cuePhysical)throw new Error('missing cue head');acceptStationCuePhysicalV2(v.cue,v.cuePhysical,v.station,v.physical);}
    else if(v.cuePhysical)throw new Error('head without cue');
    if(v.anchor)acceptStationAnchorV2(null,v.anchor,v.cue,v.physical,v.station);
    if(v.fresh&&!v.anchor)throw new Error('missing fresh anchor');
  }catch{no();}
}
const liveBody=z.object({contract:z.literal('station-live/2'),...viewBody,fresh:z.boolean()}).strict();
export const stationLiveV2Schema=liveBody.superRefine(checkView);
export type StationLiveV2=z.infer<typeof stationLiveV2Schema>;
export const stationV2MessageSchema=z.object({t:z.literal('station-v2'),view:stationLiveV2Schema}).strict();
/** First authoritative view binds the actual selected-world welcome. Later
 * physical changes keep that socket/clock and require the exact adjacent era.
 * A dropped era/cue requires a fresh welcome, never guessed intermediate facts. */
export function acceptStationLiveProgressV2(previous:StationLiveV2|null,raw:unknown,
  binding:{worldId:string;rulesVersion:string;dtSeconds:number},lastAnchor:StationAnchorVariant|null=previous?.anchor??null):StationLiveV2 {
  const next=stationLiveV2Schema.parse(raw);
  if(next.worldId!==binding.worldId)throw new Error('station V2 selected world differs');
  if(!next.station){if(previous?.station)throw new Error('station V2 original epoch disappeared');return next;}
  if(!previous?.station){
    acceptStationPhysicalHeadV1(next.physical,next.station,binding);return next;
  }
  stationLiveV2Schema.parse(previous);
  if(hashOf(previous.station)!==hashOf(next.station))throw new Error('station V2 original epoch changed');
  const before=previous.physical!,after=next.physical!;
  if(hashOf(before)!==hashOf(after)){
    if(!after.era||!after.source)throw new Error('station V2 current physical head reset');
    const state=before.revision===0?undefined:{station:previous.station,head:before,lastFactSeq:before.era!.seq};
    const folded=foldStationRulesEraV1(state,after.era,after.source,next.station);
    if(hashOf(folded.head)!==hashOf(after))throw new Error('station V2 adjacent physical progression differs');
  }
  const oldCue=previous.cue,cue=next.cue;
  if(oldCue){
    if(!cue)throw new Error('station V2 last recorded cue disappeared');
    if(oldCue.cueId===cue.cueId){
      if(hashOf(oldCue)!==hashOf(cue)||hashOf(previous.cuePhysical)!==hashOf(next.cuePhysical))throw new Error('station V2 immutable cue origin changed');
    }else if(cue.sequence!==oldCue.sequence+1||!cue.transition||cue.transition.previousCueId!==oldCue.cueId
      ||cue.transition.previousEndTick!==stationEndTick(oldCue)||cue.seed===oldCue.seed
      ||hashOf(next.cuePhysical)!==hashOf(after))throw new Error('station V2 cue transition has a gap or changed predecessor');
  }else if(cue&&cue.sequence!==1)throw new Error('station V2 initial cue sequence has a gap');
  if(next.anchor&&lastAnchor&&hashOf(next.anchor)!==hashOf(lastAnchor))
    acceptStationAnchorV2(lastAnchor,next.anchor,next.cue,next.physical,next.station);
  return next;
}
export function stationLivePhaseV2(raw:unknown,serverNowMs:number){
  const v=stationLiveV2Schema.parse(raw);tick.parse(serverNowMs);const a=v.anchor;
  if(!v.fresh||!v.cue||!a||a.paused||a.availability!=='supported'||a.clockRate!==1||serverNowMs<a.serverTimeMs)return null;
  return stationPhaseAtTickV2(v.cue,a.sourceTick+(serverNowMs-a.serverTimeMs)/(1000*a.dtSeconds));
}
const phase=z.object({beat:z.number().finite().nonnegative().lt(128),cycle:z.number().int().min(0).max(3),
  beatInCycle:z.number().finite().nonnegative().lt(32)}).strict();
/** Publisher must select the queried native era and its authoritative exclusive
 * upper bound. A last era is only known through the recorded source cutoff. */
export const stationHistoricalV2Schema=z.object({contract:z.literal('station-history/2'),...viewBody,
  tick:drawnTick,physicalUntilTick:tick.nullable(),sourceCutoff:z.object({seq:tick,tick}).strict(),phase:phase.nullable(),
}).strict().superRefine((v,ctx)=>{
  checkView({...v,contract:'station-live/2',fresh:false},ctx);
  const no=()=>ctx.addIssue({code:'custom',message:'station history is outside its physical interval/cutoff or borrowed future facts'});
  if(!v.station||!v.physical||v.tick<v.physical.effectiveTick||v.tick>v.sourceCutoff.tick
    ||v.physicalUntilTick!==null&&(v.physicalUntilTick<=v.physical!.effectiveTick||v.tick>=v.physicalUntilTick)
    ||[v.physical,v.cuePhysical].some(h=>h?.era&&(h.era.seq>v.sourceCutoff.seq||h.era.tick>v.sourceCutoff.tick)))no();
  if(!v.cue){if(v.anchor||v.phase||v.cuePhysical)no();return;}
  if(v.phase===null||hashOf(v.phase)!==hashOf(stationPhaseAtTickV2(v.cue,v.tick)))no();
  if(v.anchor&&v.anchor.sourceTick>v.tick)no();
});
export type StationHistoricalV2=z.infer<typeof stationHistoricalV2Schema>;
