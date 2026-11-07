import type {MidContext} from '@souls/brain';
import type {IntentHistoryV2} from './intent-history.ts';
type Entry=IntentHistoryV2['intents'][string];
type Purpose=NonNullable<MidContext['purposes']>[number];
type Attempt=IntentHistoryV2['attempts'][string];
const key=(id:string,version:number)=>JSON.stringify([id,version]);
/** One ephemeral pass per context, rather than sorting all attempts per purpose. */
export function indexPurposeAttemptsV1(history:IntentHistoryV2){
 const result=new Map<string,Attempt>();for(const a of Object.values(history.attempts)){
   const k=key(a.intent.intentId,a.intent.version),previous=result.get(k);if(!previous||previous.seq<a.seq)result.set(k,a);
 }return result;
}
/** Private projection of the current accepted revision and its own evidence.
 * A physical contribution is not a declaration that the broader purpose ended. */
export function purposeContextEvidenceV1(history:IntentHistoryV2,entry:Entry,ownerId:string,progress?:Pick<NonNullable<Purpose['contribution']>,'kind'|'completedSteps'>,index=indexPurposeAttemptsV1(history)):Purpose{
 const r=entry.revision;
 const accepted=history.intents[r.intentId],current=accepted?.revision;
 if(r.worldId!==history.worldId||r.soulId!==history.soulId||r.source.ownerId!==ownerId
   ||current?.version!==r.version||current.submitted.seq!==r.submitted.seq
   ||accepted.status!==entry.status||accepted.statusSeq!==entry.statusSeq
   ||entry.status==='withdrawn'||entry.status==='fulfilled')throw Error('purpose-context.outside-current-owner');
 const last=index.get(key(r.intentId,r.version));
 const completedSteps=progress?.completedSteps;
 if(completedSteps!==undefined&&(!Number.isInteger(completedSteps)||completedSteps<0||completedSteps>r.interpretation.agenda.length))throw Error('purpose-context.invalid-progress');
 return {words:r.words,strict:r.strict,importance:r.importance,understanding:r.interpretation.summary,status:entry.status,
   source:{worldId:r.worldId,soulId:r.soulId,intentId:r.intentId,version:r.version,seq:r.submitted.seq,tick:r.submitted.tick},
   trigger:{...r.interpretation.trigger},
   ...(progress===undefined?{}:{contribution:{kind:progress.kind,completedSteps:progress.completedSteps,totalSteps:r.interpretation.agenda.length,
     ...(r.interpretation.agenda[progress.completedSteps]?{nextCard:r.interpretation.agenda[progress.completedSteps].card}:{})}}),
   ...(last?{lastAttempt:{phase:last.phase,seq:last.seq,tick:last.tick,...('reason' in last?{reason:last.reason}:{}),evidence:{...last.evidence}}}:{})};
}
