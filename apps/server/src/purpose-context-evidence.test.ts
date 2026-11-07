import test from 'node:test';
import assert from 'node:assert/strict';
import {INTENT_V2,type IntentHistoryEventV2} from '@souls/protocol';
import {replayIntentHistoryV2} from './intent-history.ts';
import {purposeContextEvidenceV1} from './purpose-context-evidence.ts';
const scope={contract:INTENT_V2,worldId:'evidence-world',soulId:'s_A'},source={kind:'owner' as const,ownerId:'alice',principalId:'alice',channel:'web' as const};
function upsert(seq:number,version=1):IntentHistoryEventV2{return {...scope,op:'upsert',seq,tick:seq*10,revision:{worldId:scope.worldId,soulId:scope.soulId,intentId:'purpose',version,requestId:'r_'+seq,source,submitted:{seq,tick:seq*10},words:'PRIVATE_CONTEXT_SOURCE_'+version,strict:true,importance:.8,interpretation:{summary:'A retained intention with two steps.',agenda:[{card:'rest',target:null},{card:'go to',target:'campfire'}],trigger:{kind:'none'}}}} as IntentHistoryEventV2;}
function outcome(seq:number,phase:'accepted'|'started'|'completed'):IntentHistoryEventV2{return {...scope,op:'outcome',seq,tick:seq*10,outcome:{...scope,seq,tick:seq*10,intent:{intentId:'purpose',version:1},attemptId:'a_1',activityId:'p1',phase,evidence:{seq:seq-1,tick:seq*10-1,kind:phase==='accepted'?'admission':'controller'}}};}
const events=()=>[upsert(1),outcome(2,'accepted'),outcome(3,'started'),outcome(4,'completed')];
function history(){return replayIntentHistoryV2(scope.worldId,scope.soulId,events());}
test('private context preserves revision origin, qualifier and completed contribution without fulfilling its broader purpose',()=>{
 const h=history(),before=JSON.stringify(h),p=purposeContextEvidenceV1(h,h.intents.purpose,'alice',{kind:'semantic_card_sequence',completedSteps:1});
 assert.deepEqual(p.source,{worldId:scope.worldId,soulId:scope.soulId,intentId:'purpose',version:1,seq:1,tick:10});assert.deepEqual(p.trigger,{kind:'none'});assert.deepEqual(p.contribution,{kind:'semantic_card_sequence',completedSteps:1,totalSteps:2,nextCard:'go to'});assert.equal(p.lastAttempt?.phase,'completed');assert.deepEqual(p.lastAttempt?.evidence,{seq:3,tick:39,kind:'controller'});assert.equal(p.status,'active');assert.equal(JSON.stringify(h),before);
 assert.equal(purposeContextEvidenceV1(h,h.intents.purpose,'alice').contribution,undefined,'unknown progress is not manufactured as zero');
});
test('edited current revision excludes older attempts; foreign owner, stale revision, withdrawal and invented progress refuse',()=>{
 const old=history(),h=replayIntentHistoryV2(scope.worldId,scope.soulId,[...events(),upsert(5,2)]);
 assert.equal(purposeContextEvidenceV1(h,h.intents.purpose,'alice').lastAttempt,undefined);assert.equal(purposeContextEvidenceV1(h,h.intents.purpose,'alice').source?.version,2);assert.throws(()=>purposeContextEvidenceV1(h,old.intents.purpose,'alice'));
 assert.throws(()=>purposeContextEvidenceV1(h,h.intents.purpose,'bob'));for(const n of [-1,.5,3])assert.throws(()=>purposeContextEvidenceV1(h,h.intents.purpose,'alice',{kind:'native_program_sequence',completedSteps:n}));
 const withdrawn={...h,intents:{purpose:{...h.intents.purpose,status:'withdrawn' as const,statusSeq:6}}};assert.throws(()=>purposeContextEvidenceV1(withdrawn,withdrawn.intents.purpose,'alice'));assert.throws(()=>purposeContextEvidenceV1(withdrawn,h.intents.purpose,'alice'),'a stale pre-withdrawal view cannot echo owner words');
});
