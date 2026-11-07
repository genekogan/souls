import {hashOf} from '@souls/engine-contract';
import {whyNot} from '@souls/kernel';
import {intentArrivalPayloadV1Schema,intentArrivalFactV1,intentArrivalPageV1Schema,intentControllerPayloadV2Schema,type IntentArrivalPayloadV1,type LogEvent} from '@souls/protocol';
import type {WorldHost} from './world.ts';
import type {IntentControlV2} from './intent-control.ts';
import type {IntentRequestScope} from './intent-requests.ts';

type Binding={admissionSeq:number;payload:any};
const event=(host:WorldHost,seq:number)=>host.db.events(host.worldId,seq-1,1)[0];
/** Captures only a completed native navigation controller belonging to this
 * actual go-to play. No proximity-only or historic current-state inference. */
export function captureIntentArrivalV1(host:WorldHost,play:LogEvent):LogEvent|undefined{
  if(play.kind!=='play'||play.payload.card!=='go to'||!play.payload.target)return;
  const sid=play.payload.soulId,m=host.minds.get(sid),row=host.db.soul(sid),card=host.kernel.vocab.cards['go to'];
  if(!m||!row||row.retired_at!==null||row.owner!==m.owner||row.entity_id!==m.entityId||play.author!=='soul:'+sid||!card||card.hash!==play.payload.hash||card.origin!=='base'||card.approach.length!==1||card.approach[0].verb!=='walk_to'||card.approach[0].params.to!=='$target'||whyNot(host.kernel,card,sid,play.payload.target))return;
  const raw=host.db.db.prepare("SELECT seq,payload FROM events WHERE world_id=? AND soul_id=? AND kind='decision' AND seq<? ORDER BY seq DESC LIMIT 1").get(host.worldId,sid,play.seq) as {seq:number;payload:string}|undefined;
  if(!raw)return;const choice=JSON.parse(raw.payload);if(choice.continue||choice.card!==play.payload.card||choice.target!==play.payload.target||choice.entityId!==m.entityId)return;
  const binding=Object.values(host.extra.intentActivityBindingsV2 as Record<string,Binding>??{}).find(b=>b.payload.decision.seq===raw.seq&&b.payload.soulId===sid&&b.payload.decision.entityId===m.entityId);if(!binding)return;
  const attempt=host.intentHistoryOf(sid).attempts[binding.payload.attemptId];if(!attempt||attempt.phase!=='started')return;
  if(host.db.db.prepare('SELECT 1 FROM intent_arrivals_v1 WHERE world_id=? AND attempt_id=?').get(host.worldId,binding.payload.attemptId))return;
  const start=event(host,attempt.evidence.seq);if(!start||start.kind!=='intent-controller-v2')return;
  const started=intentControllerPayloadV2Schema.parse(start.payload);if(started.phase!=='started'||started.attemptId!==binding.payload.attemptId||started.activityId!==binding.payload.activityId||started.observation.actor!==m.entityId)return;
  const action=host.engine.runtime.records.get(started.observation.action.id),a=action?.params as {actor?:string;x?:number;z?:number;level?:number}|undefined;
  if(!action||!['walk_to','commons_shore_travel'].includes(action.verb)||action.status!=='completed'||action.endedTick===undefined||action.endedTick>play.tick||a?.actor!==m.entityId||!Number.isFinite(a.x)||!Number.isFinite(a.z))return;
  const output=action.outputs as {arrivalEndpoint?:{position?:number[];level?:number};position?:number[]}|undefined;
  const endpoint=action.verb==='walk_to'?output?.arrivalEndpoint?.position:output?.position;
  if(!endpoint||endpoint.length!==3||!endpoint.every(Number.isFinite))return;
  const entity=host.engine.world.entities[m.entityId];if(!entity?.human||Math.hypot(entity.pose.p[0]-endpoint[0],entity.pose.p[2]-endpoint[2])>.002)return;
  const admission=event(host,binding.admissionSeq),decision=event(host,raw.seq);if(!admission||!decision)return;
  const publication=host.db.db.prepare("SELECT payload FROM events WHERE world_id=? AND soul_id=? AND kind='intent-v2' AND json_extract(payload,'$.op')='upsert' AND json_extract(payload,'$.revision.intentId')=? AND json_extract(payload,'$.revision.version')=? ORDER BY seq LIMIT 1").get(host.worldId,sid,binding.payload.intent.intentId,binding.payload.intent.version) as {payload:string}|undefined;
  if(!publication||JSON.parse(publication.payload).revision.source.ownerId!==row.owner)return;
  const payload=intentArrivalPayloadV1Schema.parse({contract:'private-intent-arrival/1',worldId:host.worldId,soulId:sid,ownerId:row.owner,entityId:m.entityId,intent:binding.payload.intent,attemptId:binding.payload.attemptId,activityId:binding.payload.activityId,
    admissionSeq:admission.seq,admissionHash:hashOf(admission),decisionSeq:decision.seq,decisionHash:hashOf(decision),controllerStartSeq:start.seq,controllerStartHash:hashOf(start),
    play:{seq:play.seq,tick:play.tick,hash:hashOf(play),card:'go to',target:play.payload.target},
    navigation:{id:action.id,verb:action.verb,status:'completed',endedTick:action.endedTick,requestedGoal:{x:a.x,z:a.z,level:a.level??entity.human.level},goal:{x:endpoint[0],z:endpoint[2],level:output?.arrivalEndpoint?.level??entity.human.level}},
    observation:{tick:play.tick,position:[...entity.pose.p],level:entity.human.level,rulesVersion:host.engine.rulesVersion}});
  return {kind:'intent-arrival-v1',author:'world:intent-arrival',seq:play.seq+1,tick:play.tick,at:play.at,payload};
}
export function journalIntentArrivalV1(host:WorldHost,arrival:LogEvent){
  const p=intentArrivalFactV1(arrival);host.db.db.prepare('INSERT INTO intent_arrivals_v1(world_id,soul_id,owner_id,attempt_id,seq,event_hash,body_hash) VALUES(?,?,?,?,?,?,?)').run(host.worldId,p.soulId,p.ownerId,p.attemptId,arrival.seq,hashOf(arrival),hashOf(arrival.payload));
}
/** Validate only recorded sources during replay. The current scene is not
 * historical evidence and cannot fill an absent arrival. */
export function verifyIntentArrivalV1(host:WorldHost,arrival:LogEvent){
  const p=intentArrivalFactV1(arrival);if(p.worldId!==host.worldId)throw Error('arrival world differs');
  const d=event(host,p.decisionSeq),a=event(host,p.admissionSeq),c=event(host,p.controllerStartSeq),play=event(host,p.play.seq);
  if(!d||!a||!c||!play||hashOf(d)!==p.decisionHash||hashOf(a)!==p.admissionHash||hashOf(c)!==p.controllerStartHash||hashOf(play)!==p.play.hash)throw Error('arrival recorded prefix differs');
  if(d.kind!=='decision'||d.payload.soulId!==p.soulId||d.payload.entityId!==p.entityId||d.payload.card!=='go to'||d.payload.target!==p.play.target||a.kind!=='intent-admission-v2'||a.payload.phase!=='accepted'||a.payload.attemptId!==p.attemptId||a.payload.activityId!==p.activityId||a.payload.decision.seq!==d.seq||a.payload.decision.entityId!==p.entityId||hashOf(a.payload.intent)!==hashOf(p.intent)||c.kind!=='intent-controller-v2'||c.payload.phase!=='started'||c.payload.admissionSeq!==a.seq||c.payload.attemptId!==p.attemptId||c.payload.observation.actor!==p.entityId||c.payload.observation.action.id!==p.navigation.id||c.payload.observation.action.verb!==p.navigation.verb||play.kind!=='play'||play.payload.soulId!==p.soulId||play.payload.card!=='go to'||play.payload.target!==p.play.target)throw Error('arrival source association differs');
  if(a.author!=='world:intent-admission'||c.author!=='world:intent-controller'||c.payload.soulId!==p.soulId||c.payload.activityId!==p.activityId||hashOf(c.payload.intent)!==hashOf(p.intent)||play.author!=='soul:'+p.soulId||play.tick!==p.play.tick)throw Error('arrival source authority differs');
  const publication=host.db.db.prepare("SELECT json_extract(payload,'$.revision.source.ownerId') AS owner FROM events WHERE world_id=? AND soul_id=? AND kind='intent-v2' AND json_extract(payload,'$.op')='upsert' AND json_extract(payload,'$.revision.intentId')=? AND json_extract(payload,'$.revision.version')=? AND seq<? ORDER BY seq LIMIT 1").get(host.worldId,p.soulId,p.intent.intentId,p.intent.version,p.decisionSeq) as {owner:string}|undefined;
  if(publication?.owner!==p.ownerId)throw Error('arrival original owner differs');
  const ref=host.db.db.prepare('SELECT owner_id,soul_id,event_hash,body_hash FROM intent_arrivals_v1 WHERE world_id=? AND attempt_id=?').get(host.worldId,p.attemptId) as any;
  if(!ref||ref.owner_id!==p.ownerId||ref.soul_id!==p.soulId||ref.event_hash!==hashOf(arrival)||ref.body_hash!==hashOf(arrival.payload))throw Error('arrival publication reference differs');return p;
}
export function readIntentArrivalsV1(service:IntentControlV2,scope:IntentRequestScope,afterSeq=0,throughSeq=service.host.seq){
  service.guard(scope);if(!service.host.extra.intentArrivalV1)throw Error('arrival feature unavailable');if(!Number.isSafeInteger(afterSeq)||afterSeq<0||!Number.isSafeInteger(throughSeq)||throughSeq<afterSeq||throughSeq>service.host.seq)throw Error('arrival query differs');
  const head=throughSeq?event(service.host,throughSeq):undefined;if(throughSeq&&!head)throw Error('arrival frontier unavailable');
  const rows=service.host.db.db.prepare('SELECT seq FROM intent_arrivals_v1 WHERE world_id=? AND soul_id=? AND owner_id=? AND seq>? AND seq<=? ORDER BY seq LIMIT 51').all(scope.worldId,scope.soulId,scope.source.ownerId,afterSeq,throughSeq) as {seq:number}[];
  const arrivals=rows.slice(0,50).map(r=>{const e=event(service.host,r.seq);if(!e)throw Error('arrival history prefix missing');return verifyIntentArrivalV1(service.host,e);});service.guard(scope);
  const complete=rows.length<=50,through=complete?throughSeq:arrivals.at(-1)!.seq;
  return intentArrivalPageV1Schema.parse({contract:'private-intent-arrival/1',worldId:scope.worldId,soulId:scope.soulId,ownerId:scope.source.ownerId,frontier:{seq:throughSeq,tick:head?.tick??0},afterSeq,throughSeq:through,complete,nextAfterSeq:complete?null:through,visibility:'current-owner',arrivals});
}
