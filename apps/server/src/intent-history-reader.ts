// Private optional read projection. No interpretation, new canonical facts or
// physical outcome inference. Cursor rows are bounded read bookkeeping.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hashOf } from '@souls/engine-contract';
import { INTENT_V2,INTENT_HISTORY_V1,INTENT_HISTORY_PAGE_LIMIT,INTENT_HISTORY_SCAN_LIMIT,INTENT_HISTORY_CURSOR_TTL_MS,
  intentHistoryQueryV1Schema,intentHistoryPageV1Schema,intentHistoryCapabilityV1Schema,
  intentHistoryFactV2,intentAdmissionFactV2,intentControllerFactV2,
  type IntentHistoryEventV2,type IntentHistoryPageV1,type LogEvent } from '@souls/protocol';
import type { IntentControlV2 } from './intent-control.ts';
import type { IntentRequestScope } from './intent-requests.ts';

type Raw={seq:number;tick:number;kind:string;author:string;payload:string;at:number;soul_id:string|null};
const uint=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),digest=z.string().regex(/^[a-f0-9]{64}$/);
const cursorBody=z.strictObject({mode:z.enum(['page','resume']),genesis:digest,afterSeq:uint,afterHash:digest,
  frontier:z.strictObject({seq:uint,tick:uint}),headHash:digest});
const kinds=new Set(['intent-v2','intent-admission-v2','intent-controller-v2']);
export class IntentHistoryCursorUnavailable extends Error{readonly expired:boolean;constructor(expired=false){super('history cursor unavailable');this.expired=expired;}}
export class IntentHistoryReaderV1 {
  readonly service:IntentControlV2;
  constructor(service:IntentControlV2){this.service=service;}
  private get host(){return this.service.host;}
  private get db(){return this.host.db;}
  capability(scope:IntentRequestScope){this.service.guard(scope);return intentHistoryCapabilityV1Schema.parse({contract:INTENT_HISTORY_V1,
    worldId:scope.worldId,soulId:scope.soulId,pageLimit:INTENT_HISTORY_PAGE_LIMIT,scanLimit:INTENT_HISTORY_SCAN_LIMIT,cursorTtlMs:INTENT_HISTORY_CURSOR_TTL_MS});}
  private raw(seq:number):Raw|undefined{return this.db.db.prepare('SELECT seq,tick,kind,author,payload,at,soul_id FROM events WHERE world_id=? AND seq=?').get(this.host.worldId,seq) as Raw|undefined;}
  private genesis(){const w=this.db.world(this.host.worldId)!;return hashOf({worldId:this.host.worldId,schema:w.schema,seed:w.seed,dt:w.dt});}
  private anchor(seq:number){if(!seq)return hashOf({worldId:this.host.worldId,seq:0});const row=this.raw(seq);return row?hashOf(row):undefined;}
  private event(r:Raw):LogEvent{return {seq:r.seq,tick:r.tick,kind:r.kind as LogEvent['kind'],author:r.author,payload:JSON.parse(r.payload),at:r.at};}
  private publication(e:LogEvent):Extract<IntentHistoryEventV2,{op:'upsert'|'withdraw'}>{
    const fact=intentHistoryFactV2(e),source=fact.op==='upsert'?fact.revision.source:fact.source;
    if(e.author!==`soul:${fact.soulId}`)throw new Error('history publication author differs');
    const ref=this.db.db.prepare('SELECT event_hash,tick,kind FROM intent_request_events_v2 WHERE world_id=? AND soul_id=? AND principal_id=? AND request_id=? AND seq=?')
      .get(fact.worldId,fact.soulId,source.principalId,fact.op==='upsert'?fact.revision.requestId:fact.requestId,e.seq);
    if(!ref||ref.event_hash!==hashOf(e)||ref.tick!==e.tick||ref.kind!==e.kind)throw new Error('history publication reference differs');
    return fact;
  }
  private purpose(scope:IntentRequestScope,ref:{intentId:string;version:number},through:number){
    const rows=this.db.db.prepare(`SELECT seq,tick,kind,author,payload,at,soul_id FROM events
      WHERE world_id=? AND soul_id=? AND kind='intent-v2' AND seq<=?
      AND json_extract(payload,'$.op')='upsert' AND json_extract(payload,'$.revision.intentId')=?
      AND json_extract(payload,'$.revision.version')=? ORDER BY seq LIMIT 2`).all(scope.worldId,scope.soulId,through,ref.intentId,ref.version) as Raw[];
    if(rows.length!==1)throw new Error('history purpose origin unavailable');
    const fact=this.publication(this.event(rows[0]));if(fact.op!=='upsert')throw new Error('history purpose origin differs');
    return fact.revision;
  }
  private fact(scope:IntentRequestScope,r:Raw):IntentHistoryEventV2|undefined {
    // Never decode another Soul's private payload, including damaged bytes.
    if(!kinds.has(r.kind)||r.soul_id!==scope.soulId)return undefined;
    const e=this.event(r);let fact:IntentHistoryEventV2,owner:string;
    if(e.kind==='intent-v2'){
      fact=this.publication(e);owner=(fact.op==='upsert'?fact.revision.source:fact.source).ownerId;
    }else if(e.kind==='intent-admission-v2'){
      fact=intentAdmissionFactV2(e);if(e.author!=='world:intent-admission')throw new Error('history admission author differs');
      const p=e.payload,decision=this.raw(p.decision.seq);
      if(!decision||decision.kind!=='decision'||decision.tick!==p.decision.tick||decision.soul_id!==scope.soulId)throw new Error('history decision origin unavailable');
      const d=this.event(decision).payload;
      if(d.entityId!==p.decision.entityId||d.continue||p.attemptId!==`a_${decision.seq}`)throw new Error('history admission association differs');
      owner=this.purpose(scope,p.intent,e.seq).source.ownerId;
    }else{
      fact=intentControllerFactV2(e);if(e.author!=='world:intent-controller')throw new Error('history controller author differs');
      const p=e.payload,admission=this.raw(p.admissionSeq);
      if(!admission||admission.soul_id!==scope.soulId)throw new Error('history admission origin unavailable');
      const a=this.event(admission);intentAdmissionFactV2(a);
      if(a.author!=='world:intent-admission'||a.payload.phase!=='accepted'||a.payload.activityId!==p.activityId
        ||a.payload.attemptId!==p.attemptId||hashOf(a.payload.intent)!==hashOf(p.intent)||a.payload.decision.entityId!==p.observation.actor)
        throw new Error('history controller admission differs');
      const captured=this.db.db.prepare('SELECT published_seq,published_hash,admission_hash,body,body_hash FROM intent_observations_v2 WHERE world_id=? AND attempt_id=? AND phase=?')
        .get(scope.worldId,p.attemptId,p.phase);
      if(!captured||captured.published_seq!==e.seq||captured.published_hash!==hashOf(e)||captured.admission_hash!==hashOf(a)
        ||captured.body_hash!==hashOf(p)||hashOf(JSON.parse(String(captured.body)))!==hashOf(p))throw new Error('history controller evidence differs');
      owner=this.purpose(scope,p.intent,e.seq).source.ownerId;
    }
    if(fact.worldId!==scope.worldId||fact.soulId!==scope.soulId)throw new Error('history fact scope differs');
    // A changed ownership record never grants another person's old words.
    if(owner!==scope.source.ownerId)return undefined;
    return fact;
  }
  private args(scope:IntentRequestScope){return [scope.worldId,scope.soulId,scope.source.ownerId,scope.source.principalId,scope.source.kind];}
  private issue(scope:IntentRequestScope,body:z.infer<typeof cursorBody>,now:number){
    const cursor=`ih1_${randomBytes(24).toString('hex')}`;
    this.db.db.prepare('INSERT INTO intent_history_cursors_v1(cursor,world_id,soul_id,owner_id,principal_id,source_kind,created_at,expires_at,body,body_hash) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(cursor,...this.args(scope),now,now+INTENT_HISTORY_CURSOR_TTL_MS,JSON.stringify(body),hashOf(body));
    return cursor;
  }
  page(scope:IntentRequestScope,raw:unknown={}):IntentHistoryPageV1 {
    this.host.assertClockReady();this.service.guard(scope);const query=intentHistoryQueryV1Schema.parse(raw),now=Date.now();
    this.db.db.exec('BEGIN IMMEDIATE');
    try{
      this.service.guard(scope);
      if(this.host.seq!==this.db.lastSeq(scope.worldId))throw new Error('history source head moved');
      const current={seq:this.host.seq,tick:this.host.engine.world.tick};
      let afterSeq=0,frontier=current,stored:z.infer<typeof cursorBody>|undefined;
      if(query.cursor){
        // Scope predicates precede any body decode or error classification.
        const row=this.db.db.prepare('SELECT expires_at,body,body_hash FROM intent_history_cursors_v1 WHERE cursor=? AND world_id=? AND soul_id=? AND owner_id=? AND principal_id=? AND source_kind=?')
          .get(query.cursor,...this.args(scope));
        if(!row)throw new IntentHistoryCursorUnavailable();
        if(Number(row.expires_at)<=now)throw new IntentHistoryCursorUnavailable(true);
        stored=cursorBody.parse(JSON.parse(String(row.body)));if(hashOf(stored)!==row.body_hash)throw new Error('history cursor bytes differ');
        afterSeq=stored.afterSeq;frontier=stored.mode==='page'?stored.frontier:current;
      }
      const base={contract:INTENT_HISTORY_V1,intentContract:INTENT_V2,worldId:scope.worldId,soulId:scope.soulId,
        ownerId:scope.source.ownerId,frontier,fromSeq:afterSeq};
      const gap=(reason:'prefix-missing'|'source-changed',expectedSeq:number)=>intentHistoryPageV1Schema.parse({...base,state:'gap',reason,expectedSeq});
      let result:IntentHistoryPageV1;
      if(stored&&(stored.genesis!==this.genesis()||stored.frontier.seq>current.seq||stored.frontier.tick>current.tick
        ||this.anchor(stored.frontier.seq)!==stored.headHash||this.anchor(afterSeq)!==stored.afterHash))result=gap('source-changed',afterSeq);
      else if(!this.anchor(frontier.seq))result=gap('prefix-missing',frontier.seq);
      else{
        const rows=this.db.db.prepare('SELECT seq,tick,kind,author,payload,at,soul_id FROM events WHERE world_id=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?')
          .all(scope.worldId,afterSeq,frontier.seq,INTENT_HISTORY_SCAN_LIMIT) as Raw[];
        const events:IntentHistoryEventV2[]=[];let through=afterSeq,missing:number|undefined;
        for(const row of rows){
          if(row.seq!==through+1){missing=through+1;break;}
          if(row.tick>frontier.tick)throw new Error('history event tick exceeds frontier');
          const fact=this.fact(scope,row);if(fact)events.push(fact);through=row.seq;
          if(events.length===INTENT_HISTORY_PAGE_LIMIT)break;
        }
        if(missing!==undefined)result=gap('prefix-missing',missing);
        else if(through<frontier.seq&&rows.length===0)result=gap('prefix-missing',through+1);
        else{
          const complete=through===frontier.seq,body={mode:complete?'resume' as const:'page' as const,genesis:this.genesis(),afterSeq:through,
            afterHash:this.anchor(through)!,frontier,headHash:this.anchor(frontier.seq)!};
          const cursor=this.issue(scope,body,now);
          result=intentHistoryPageV1Schema.parse({...base,state:'page',throughSeq:through,events,complete,
            nextCursor:complete?null:cursor,resumeCursor:complete?cursor:null,visibility:'current-owner'});
        }
      }
      this.service.guard(scope);
      // At most64 per Soul/current owner across credential generations and2048
      // per world. Evicted/unknown tokens explicitly become unavailable.
      this.db.db.prepare('DELETE FROM intent_history_cursors_v1 WHERE world_id=? AND expires_at<?').run(scope.worldId,now);
      this.db.db.prepare(`DELETE FROM intent_history_cursors_v1 WHERE world_id=? AND soul_id=? AND owner_id=? AND cursor NOT IN
        (SELECT cursor FROM intent_history_cursors_v1 WHERE world_id=? AND soul_id=? AND owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 64)`)
        .run(scope.worldId,scope.soulId,scope.source.ownerId,scope.worldId,scope.soulId,scope.source.ownerId);
      this.db.db.prepare(`DELETE FROM intent_history_cursors_v1 WHERE world_id=? AND cursor NOT IN
        (SELECT cursor FROM intent_history_cursors_v1 WHERE world_id=? ORDER BY created_at DESC,rowid DESC LIMIT 2048)`).run(scope.worldId,scope.worldId);
      this.db.db.exec('COMMIT');return result;
    }catch(error){this.db.db.exec('ROLLBACK');throw error;}
  }
}
