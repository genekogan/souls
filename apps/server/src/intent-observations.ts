// Private trusted-native outbox, separate from canonical progress. No client
// handler, authority check or physical retry is supplied by this component.
import { hashOf, stableStringify } from '@souls/engine-contract';
import { intentAdmissionPayloadV2Schema, intentControllerPayloadV2Schema, intentControllerFactV2, type IntentControllerPayloadV2, type LogEvent } from '@souls/protocol';
import type { Db } from './db.ts';

type Row = { world_id:string; attempt_id:string; phase:string; observation_tick:number;
  admission_seq:number; admission_hash:string; body:string; body_hash:string;
  published_seq:number|null; published_hash:string|null };
export class IntentObservations {
  readonly db:Db;
  readonly worldId:string;
  constructor(db:Db,worldId:string) {this.db=db;this.worldId=worldId;}
  private transaction<T>(work:()=>T):T {
    this.db.db.exec('BEGIN IMMEDIATE');
    try { const result=work();this.db.db.exec('COMMIT');return result; }
    catch(error) {this.db.db.exec('ROLLBACK');throw error;}
  }
  private row(attemptId:string,phase:string):Row|undefined {
    return this.db.db.prepare('SELECT * FROM intent_observations_v2 WHERE world_id=? AND attempt_id=? AND phase=?').get(this.worldId,attemptId,phase) as Row|undefined;
  }
  private admission(payload:IntentControllerPayloadV2):LogEvent {
    if(payload.worldId!==this.worldId)throw new Error('observation world changed');
    const event=this.db.events(this.worldId,payload.admissionSeq-1,1)[0];
    if(!event || event.seq!==payload.admissionSeq || event.kind!=='intent-admission-v2' || event.author!=='world:intent-admission')throw new Error('observation lacks canonical admission');
    const p=intentAdmissionPayloadV2Schema.parse(event.payload);
    if(p.phase!=='accepted' || p.worldId!==this.worldId || p.soulId!==payload.soulId
      || p.attemptId!==payload.attemptId || p.activityId!==payload.activityId
      || p.intent.intentId!==payload.intent.intentId || p.intent.version!==payload.intent.version
      || p.decision.entityId!==payload.observation.actor || event.tick>payload.observation.tick)
      throw new Error('observation admission association changed');
    return event;
  }
  private verify(row:Row):IntentControllerPayloadV2 {
    const payload=intentControllerPayloadV2Schema.parse(JSON.parse(row.body));
    if(row.world_id!==this.worldId || payload.worldId!==this.worldId || payload.attemptId!==row.attempt_id
      || payload.phase!==row.phase || payload.observation.tick!==row.observation_tick
      || payload.admissionSeq!==row.admission_seq || hashOf(payload)!==row.body_hash
      || stableStringify(payload)!==row.body || hashOf(this.admission(payload))!==row.admission_hash)
      throw new Error('captured observation failed verification');
    if(row.published_seq!==null) {
      const event=this.db.events(this.worldId,row.published_seq-1,1)[0];
      if(!event || event.seq!==row.published_seq || event.kind!=='intent-controller-v2'
        || event.author!=='world:intent-controller' || hashOf(event)!==row.published_hash
        || stableStringify(event.payload)!==row.body)throw new Error('published observation failed verification');
      intentControllerFactV2(event);
    }else if(row.published_hash!==null)throw new Error('partial observation publication');
    return payload;
  }
  /** Capture only actual metadata passed by the host observer. Repeated capture
   * keeps the first executing observation, not a later invented start tick. */
  capture(raw:IntentControllerPayloadV2):void {
    const payload=intentControllerPayloadV2Schema.parse(raw);
    this.transaction(()=>{
      const admission=this.admission(payload),old=this.row(payload.attemptId,payload.phase);
      if(old) {
        const previous=this.verify(old);
        if(payload.phase==='started' && previous.phase==='started') {
          // Later executing frames may have another step/action. Preserve the
          // first capture only if the exact admitted activity is still named.
          const {observation:before,...a}=previous,{observation:after,...b}=payload;
          if(stableStringify(a)!==stableStringify(b) || after.tick<before.tick)throw new Error('observation capture changed');
        }else if(stableStringify(payload)!==old.body)throw new Error('observation capture changed');
        return;
      }
      this.db.db.prepare('INSERT INTO intent_observations_v2(world_id,attempt_id,phase,observation_tick,admission_seq,admission_hash,body,body_hash) VALUES (?,?,?,?,?,?,?,?)')
        .run(this.worldId,payload.attemptId,payload.phase,payload.observation.tick,payload.admissionSeq,hashOf(admission),stableStringify(payload),hashOf(payload));
    });
  }
  hasCapturedStart(attemptId:string):boolean {
    const row=this.row(attemptId,'started');if(!row)return false;this.verify(row);return true;
  }
  /** Bounded oldest eligible evidence; future evidence waits for world time.
   * No inference from idle state, missing program or newest scene. */
  pending(tick:number):IntentControllerPayloadV2[] {
    const rows=this.db.db.prepare(`SELECT * FROM intent_observations_v2 WHERE world_id=? AND published_seq IS NULL AND observation_tick<=?
      ORDER BY observation_tick,admission_seq,CASE phase WHEN 'started' THEN 0 ELSE 1 END,attempt_id,phase LIMIT 20`).all(this.worldId,tick) as Row[];
    return rows.map(row=>this.verify(row));
  }
  /** Fact and publication reference commit together. Validation is a pure fold
   * under the writer lock; live state/listeners run only after commit. */
  publish(payload:IntentControllerPayloadV2,event:LogEvent,validate:()=>void):void {
    this.transaction(()=>{
      const row=this.row(payload.attemptId,payload.phase);
      if(!row || row.published_seq!==null || stableStringify(this.verify(row))!==stableStringify(payload))throw new Error('observation is not pending');
      if(event.kind!=='intent-controller-v2' || event.author!=='world:intent-controller'
        || event.tick<payload.observation.tick || event.seq!==this.db.lastSeq(this.worldId)+1
        || stableStringify(event.payload)!==row.body)throw new Error('observation publication changed');
      validate();this.db.appendEvent(this.worldId,event);
      this.db.db.prepare('UPDATE intent_observations_v2 SET published_seq=?,published_hash=? WHERE world_id=? AND attempt_id=? AND phase=?')
        .run(event.seq,hashOf(event),this.worldId,payload.attemptId,payload.phase);
    });
  }
}
