// Candidate G006 source/head codec and fold. No journal, timer, cue selection,
// network, model, producer installation or V1 parser relaxation.
import { z } from 'zod';
import { commonsTransitionV1Schema,campExpansionV1Schema,hashOf } from '@souls/engine-contract';
import { stationEpochV1Schema,stationEpochId,type StationEpochV1 } from './station-v1.ts';
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const worldId=z.string().min(1).max(128).refine(s=>s.trim()===s);
const rules=z.string().min(1).max(200);
const dt=z.number().finite().positive().max(1);
export const stationLiveContractSchema=z.enum(['station-live/1','station-live/2']);
export type StationLiveContract=z.infer<typeof stationLiveContractSchema>;
const contracts=z.array(stationLiveContractSchema).max(2).superRefine((p,ctx)=>{
  if(new Set(p).size!==p.length)ctx.addIssue({code:'custom',message:'station capabilities repeat'});
});
export const stationHelloCapabilitiesV1Schema=z.object({stationContracts:contracts.min(1).optional()}).strict();
/** Explicit isolated capability selection, not an installed hello handler.
 * Absent client capability is V1. Server order is fixed V2, then V1. */
export function negotiateStationContractV1(rawHelloCapabilities:unknown,rawServerContracts:unknown):StationLiveContract|null {
  const offered=stationHelloCapabilitiesV1Schema.parse(rawHelloCapabilities).stationContracts??['station-live/1'];
  const supported=contracts.parse(rawServerContracts);
  return (['station-live/2','station-live/1'] as const).find(c=>offered.includes(c)&&supported.includes(c))??null;
}

/** Public projection of the exact physical source. Its selected-world DB
 * binding is explicit; no author, wall time, private rules or owner payload. */
export const stationCommonsSourceV1Schema=z.object({
  worldId,seq:integer.max(Number.MAX_SAFE_INTEGER-1),tick:integer,commonsTransition:commonsTransitionV1Schema,
}).strict().superRefine((s,ctx)=>{
  if(s.tick!==s.commonsTransition.tick)ctx.addIssue({code:'custom',message:'physical source tick differs'});
});
export type StationCommonsSourceV1=z.infer<typeof stationCommonsSourceV1Schema>;
/** Separate exact source case; the original commons parser stays unchanged. */
export const stationCampSourceV1Schema=z.object({worldId,seq:integer.max(Number.MAX_SAFE_INTEGER-1),tick:integer,campExpansion:campExpansionV1Schema})
  .strict().superRefine((s,ctx)=>{if(s.tick!==s.campExpansion.tick)ctx.addIssue({code:'custom',message:'camp physical source tick differs'});});
export const stationPhysicalSourceV1Schema=z.union([stationCommonsSourceV1Schema,stationCampSourceV1Schema]);
export type StationPhysicalSourceV1=z.infer<typeof stationPhysicalSourceV1Schema>;
export const stationPhysicalTransitionV1=(source:StationPhysicalSourceV1)=>'commonsTransition' in source?source.commonsTransition:source.campExpansion;
export function stationSourceFromRulesV1(worldId:string,event:{seq:number;tick:number;payload:unknown}):StationPhysicalSourceV1{
  if(!event.payload||typeof event.payload!=='object'||Array.isArray(event.payload))throw new Error('station physical source lacks strict rules payload');
  const keys=Object.keys(event.payload);if(keys.length!==1||!['commonsTransition','campExpansion'].includes(keys[0]))throw new Error('station physical source requires one declared transition');
  return stationPhysicalSourceV1Schema.parse({worldId,seq:event.seq,tick:event.tick,...event.payload});
}

export const stationRulesEraV1Schema=z.object({
  contract:z.literal('station-rules-era/1'),worldId,epoch:digest,
  revision:integer.positive(),previousRevision:integer.max(Number.MAX_SAFE_INTEGER-1),
  fromRulesVersion:rules,toRulesVersion:rules,dtSeconds:dt,effectiveTick:integer,
  source:z.object({seq:integer.max(Number.MAX_SAFE_INTEGER-1),tick:integer,transitionHash:digest}).strict(),
}).strict().superRefine((p,ctx)=>{
  if(p.revision!==p.previousRevision+1||p.effectiveTick!==p.source.tick||p.fromRulesVersion===p.toRulesVersion)
    ctx.addIssue({code:'custom',message:'era revision, tick or unchanged rules differ'});
});
export type StationRulesEraV1=z.infer<typeof stationRulesEraV1Schema>;
/** Author-free fact projection. Live LogEvent/EventKind are not expanded yet. */
export const stationRulesEraFactV1Schema=z.object({seq:integer.positive(),tick:integer,payload:stationRulesEraV1Schema}).strict()
  .superRefine((e,ctx)=>{if(e.seq!==e.payload.source.seq+1||e.tick!==e.payload.effectiveTick)
    ctx.addIssue({code:'custom',message:'era fact is not adjacent to its physical source'});});
export type StationRulesEraFactV1=z.infer<typeof stationRulesEraFactV1Schema>;

const origin=z.object({worldId,epoch:digest,genesisId:digest,rulesVersion:rules,dtSeconds:dt,createdTick:integer}).strict();
export const stationPhysicalHeadV1Schema=z.object({
  contract:z.literal('station-physical-head/1'),origin,rulesVersion:rules,revision:integer,effectiveTick:integer,
  era:stationRulesEraFactV1Schema.nullable(),source:stationPhysicalSourceV1Schema.nullable(),
}).strict().superRefine((h,ctx)=>{
  const no=()=>ctx.addIssue({code:'custom',message:'physical era head/source/origin binding differs'});
  if(h.origin.epoch!==stationEpochId(h.origin.worldId,h.origin.genesisId))no();
  if(h.revision===0){if(h.era||h.source||h.rulesVersion!==h.origin.rulesVersion||h.effectiveTick!==h.origin.createdTick)no();return;}
  if(!h.era||!h.source){no();return;}
  const e=h.era.payload,s=h.source,c=stationPhysicalTransitionV1(s);
  if(h.revision!==e.revision||h.rulesVersion!==e.toRulesVersion||h.effectiveTick!==e.effectiveTick||h.effectiveTick<h.origin.createdTick
    ||e.worldId!==h.origin.worldId||s.worldId!==h.origin.worldId||e.epoch!==h.origin.epoch||e.dtSeconds!==h.origin.dtSeconds
    ||e.source.seq!==s.seq||e.source.tick!==s.tick||e.source.transitionHash!==hashOf(c)
    ||e.fromRulesVersion!==c.fromRulesVersion||e.toRulesVersion!==c.toRulesVersion)no();
  if(h.revision===1&&e.fromRulesVersion!==h.origin.rulesVersion)no();
});
export type StationPhysicalHeadV1=z.infer<typeof stationPhysicalHeadV1Schema>;
const originOf=(station:StationEpochV1)=>{const {worldId,epoch,genesisId,rulesVersion,dtSeconds,createdTick}=station;return {worldId,epoch,genesisId,rulesVersion,dtSeconds,createdTick};};
export function initialStationPhysicalHeadV1(input:unknown):StationPhysicalHeadV1 {
  const station=stationEpochV1Schema.parse(input);
  return stationPhysicalHeadV1Schema.parse({contract:'station-physical-head/1',origin:originOf(station),
    rulesVersion:station.rulesVersion,revision:0,effectiveTick:station.createdTick,era:null,source:null});
}
/** Validate the authoritative head against original station and selected
 * physical-reader binding: current welcome for live, actual take rules for
 * historical depiction. This does not prove an unseen era chain. */
export function acceptStationPhysicalHeadV1(raw:unknown,original:unknown,binding:{worldId:string;rulesVersion:string;dtSeconds:number}):StationPhysicalHeadV1 {
  const head=stationPhysicalHeadV1Schema.parse(raw),station=stationEpochV1Schema.parse(original);
  if(hashOf(head.origin)!==hashOf(originOf(station))||binding.worldId!==station.worldId
    ||binding.rulesVersion!==head.rulesVersion||binding.dtSeconds!==head.origin.dtSeconds)
    throw new Error('station era head belongs to another original station or current physical reader');
  return head;
}

/** Only the current head is retained here. Immutable fact history belongs to
 * the journal; bounded history projection must use the queried tick's source. */
export type StationEraFoldStateV1={station:StationEpochV1;head:StationPhysicalHeadV1;lastFactSeq:number};
export function foldStationRulesEraV1(state:StationEraFoldStateV1|undefined,rawFact:unknown,rawSource:unknown,original:unknown):StationEraFoldStateV1 {
  const station=stationEpochV1Schema.parse(original),fact=stationRulesEraFactV1Schema.parse(rawFact),source=stationPhysicalSourceV1Schema.parse(rawSource);
  const previous=state?acceptStationPhysicalHeadV1(state.head,state.station,
    {worldId:state.station.worldId,rulesVersion:state.head.rulesVersion,dtSeconds:state.station.dtSeconds}):initialStationPhysicalHeadV1(station);
  if(state&&(hashOf(state.station)!==hashOf(station)||!Number.isSafeInteger(state.lastFactSeq)||source.seq<=state.lastFactSeq))
    throw new Error('station era original identity or fact sequence regressed');
  if(state&&state.head.era?.seq!==state.lastFactSeq)throw new Error('station era folded head sequence differs');
  const p=fact.payload;
  if(p.previousRevision!==previous.revision||p.fromRulesVersion!==previous.rulesVersion||p.effectiveTick<previous.effectiveTick)
    throw new Error('station era previous head differs or history has a gap');
  const head=acceptStationPhysicalHeadV1({contract:'station-physical-head/1',origin:previous.origin,rulesVersion:p.toRulesVersion,
    revision:p.revision,effectiveTick:p.effectiveTick,era:fact,source},station,
    {worldId:station.worldId,rulesVersion:stationPhysicalTransitionV1(source).toRulesVersion,dtSeconds:station.dtSeconds});
  return {station,head,lastFactSeq:fact.seq};
}

/** Explicit requested-tick guard for live/body depiction. Historical queries
 * require that tick's head/source, never the later current head as a repair. */
export function stationPhysicalHeadCoversTickV1(head:unknown,station:unknown,binding:{worldId:string;rulesVersion:string;dtSeconds:number},tick:number):StationPhysicalHeadV1|null {
  const at=z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(tick);
  const accepted=acceptStationPhysicalHeadV1(head,station,binding);
  return at<accepted.effectiveTick?null:accepted;
}
