import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContinuityDisturbances} from './continuity-disturbances.mjs';

const fixtures=JSON.parse(readFileSync(new URL('../scenarios/continuity/fixtures.json',import.meta.url)));
const T0=1793400000000;
function fixture(name,{send,fixtureVersion}={}){
 const scenario=structuredClone(fixtures.scenarios.find(s=>s.id===name)),actors=scenario.actors.map(a=>({actorId:a.id,soulId:'s_'+a.id})),sent=[],records=[];let now=T0;
 // Callers declare a versioned fixture explicitly (eden-walk-three garden-pool-v2 and eden-bandstand-five are 2).
 fixtureVersion??=scenario.fixtureVersion;
 const api=createContinuityDisturbances({scenario,fixtureVersion,t0:T0,cutoffAt:T0+scenario.timing.endOffsetSec*1000,worldId:'world_test',actors,evidence:['fixtures.json#'+name]}, {now:()=>now,send:async r=>{sent.push(r);return send?send(r):{status:'accepted',effectId:'native_'+r.id,evidence:['send.json#'+r.id]};},onRecord:r=>records.push(r)});
 const scope=actorId=>({worldId:'world_test',actorId,soulId:'s_'+actorId,evidence:['native.json#'+actorId+'-'+now]});
 const body=(actorId,at,p=[0,0],extra={})=>{now=Math.max(now,at);api.observeBody({...scope(actorId),at,receivedAt:at,pos:p,source:'here',currentBody:true,...extra});};
 const receipt=(actorId,id,acceptedAt,extra={})=>api.observeReceipt({...scope(actorId),observedAt:now,receipt:{id,capability:'walk:library',acceptedAtUtc:acceptedAt,...extra}});
 const row=id=>api.snapshot().disturbances[id];
 return {api,scenario,actors,sent,records,scope,body,receipt,row,setNow:v=>{now=v;},get now(){return now;}};
}

test('scheduled sends frozen text once, preserving ACK versus native delivery',async()=>{
 const f=fixture('mars-presentation-four');const frozen=f.scenario.disturbances.find(d=>d.id==='prestart-interruption').text;f.scenario.disturbances.find(d=>d.id==='prestart-interruption').text='changed';
 f.setNow(T0+279999);await f.api.tick();assert.equal(f.sent.length,0);
 f.setNow(T0+280000);await Promise.all([f.api.tick(),f.api.tick()]);await f.api.tick();
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].text,frozen);assert.deepEqual(f.sent[0].recipients,[{actorId:'presenter',soulId:'s_presenter'}]);
 let r=f.row('prestart-interruption');assert.equal(r.dispatch.status,'accepted');assert.equal(r.delivered,false);assert.equal(r.deliveredAt,null);
 const delivery={...f.scope('presenter'),disturbanceId:r.id,dispatchId:r.dispatch.id,eventId:'c_9',source:'world',createdAt:T0+280000,effectId:'wrong',linkageEvidence:['native-speech#said-id']};
 assert.throws(()=>f.api.observeDelivery(delivery),{code:'DISTURBANCE_DELIVERY_UNLINKED'});
 delivery.effectId=r.dispatch.effectId;f.api.observeDelivery(delivery);f.api.observeDelivery(delivery);r=f.row(r.id);
 assert.equal(r.delivered,true);assert.equal(r.status,'delivered');assert.equal(r.deliveryEvents.length,1);f.api.finish();await f.api.tick();assert.equal(f.sent.length,1);
});

test('missed fixed schedule and cutoff never dispatch a later replacement',async()=>{
 const late=fixture('mars-presentation-four');late.setNow(T0+282001);await late.api.tick();assert.equal(late.row('prestart-interruption').status,'unmet');assert.equal(late.sent.length,0);late.setNow(T0+283000);await late.api.tick();assert.equal(late.sent.length,0);
 const cutoff=fixture('eden-bandstand-five');cutoff.setNow(T0+900000);await cutoff.api.tick();assert.equal(cutoff.sent.length,0);assert.equal(cutoff.row('unrelated-waiting-conversation').status,'unmet');
});

test('first native moving journey needs actual motion at onset and the frozen due time',async()=>{
 const f=fixture('eden-reading-duo');f.receipt('reader-a','r_first',T0);
 f.body('reader-a',T0,[0,0]);f.body('reader-a',T0+1000,[1,0]);
 for(let i=2;i<=5;i++)f.body('reader-a',T0+i*1000,[i,0]);await f.api.tick();assert.equal(f.sent.length,0);
 f.body('reader-a',T0+6000,[6,0]);await f.api.tick();const r=f.row('travel-greeting');
 assert.equal(f.sent.length,1);assert.equal(r.triggerProof.receiptId,'r_first');assert.equal(r.triggerProof.motionOnsetAt,T0+1000);assert.equal(r.scheduledAt,T0+6000);assert.equal(r.triggerProof.motionToAt,T0+6000);assert.equal(r.delivered,false);
});

test('no motion, an old receipt, receipt end, or a sample gap cannot manufacture motion',async()=>{
 for(const kind of ['stationary','gap','pretrial','ended']){
  const f=fixture('eden-reading-duo');f.receipt('reader-a','r_one',kind==='pretrial'?T0-1:T0,kind==='ended'?{endedAtUtc:T0}:{});
  f.body('reader-a',T0,[0,0]);f.body('reader-a',T0+(kind==='gap'?3000:1000),kind==='stationary'?[0,0]:[1,0]);f.setNow(T0+181000);await f.api.tick();
  assert.equal(f.sent.length,0,kind);assert.equal(f.row('travel-greeting').status,'unmet',kind);
 }
});

test('missed first motion trigger is never replaced by another journey',async()=>{
 const f=fixture('eden-reading-duo');f.receipt('reader-a','r_one',T0);f.body('reader-a',T0,[0,0]);f.body('reader-a',T0+1000,[1,0]);
 f.setNow(T0+9000);await f.api.tick();assert.equal(f.row('travel-greeting').status,'unmet');
 f.receipt('reader-a','r_two',T0+9000);f.body('reader-a',T0+9000,[9,0]);f.body('reader-a',T0+10000,[10,0]);f.body('reader-a',T0+15000,[15,0]);await f.api.tick();assert.equal(f.sent.length,0);
});

test('garden trigger uses all three postmeeting intervals and retains asynchronous native times',async()=>{
 const f=fixture('eden-walk-three');
 for(let i=0;i<=11;i++)for(const [j,actor]of ['walker-1','walker-2','walker-3'].entries())f.body(actor,T0+270000+i*1000+j*100,[57,-10]);
 await f.api.tick();assert.equal(f.sent.length,1);const r=f.row('independent-errand');
 assert.equal(r.triggerProof.overlapFrom,T0+270200);assert.equal(r.scheduledAt,T0+280200);assert.equal(r.triggerProof.observedAt,T0+280200);assert.ok(r.triggerProof.proofAvailableAt>r.triggerProof.observedAt);
 assert.equal(new Set(r.triggerProof.bodyIntervals.map(x=>x.to)).size,3);assert.equal(r.triggerProof.bodyIntervals.length,3);assert.equal(f.sent[0].deliveryKind,'owner');assert.deepEqual(f.sent[0].recipients,[{actorId:'walker-2',soulId:'s_walker-2'}]);
});

test('garden gaps and contrary body samples break overlap; missing third body never triggers',async()=>{
 const f=fixture('eden-walk-three');
 for(let i=0;i<=9;i++)for(const actor of ['walker-1','walker-2','walker-3'])f.body(actor,T0+270000+i*1000,[57,-10]);
 f.body('walker-2',T0+280000,[0,0]);f.body('walker-1',T0+283000,[57,-10]);f.body('walker-3',T0+283000,[57,-10]);await f.api.tick();assert.equal(f.sent.length,0);
 f.setNow(T0+960000);await f.api.tick();assert.equal(f.row('independent-errand').status,'unmet');assert.equal(f.sent.length,0);
});

test('releases/supplements record existing mechanics; occupancy and restart remain external',async()=>{
 const f=fixture('mars-presentation-four');f.setNow(T0+330000);
 f.api.observeRelease({...f.scope('attendee-3'),scheduledAt:T0+330000,releasedAt:T0+330000,initialInstructionId:'instruction-sha'});
 assert.equal(f.row('late-attendee').releaseEvents.length,1);assert.equal(f.row('late-attendee').status,'release-recorded');assert.equal(f.row('late-attendee').triggerProof.initialInstructionId,'instruction-sha');assert.equal(f.row('late-attendee').delivered,true);assert.equal(f.row('occupied-seat').status,'external');assert.equal(f.sent.length,0);
 const reading=fixture('eden-reading-duo');assert.equal(reading.row('controller-restart').status,'external');
});

test('uncertain ACK never retries, but exact native operation proof can later establish delivery',async()=>{
 const f=fixture('eden-bandstand-five',{send:()=>({status:'uncertain',operationId:'op_exact',evidence:['send#op_exact']})});f.setNow(T0+150000);await f.api.tick();const r=f.row('unrelated-waiting-conversation');
 assert.equal(r.delivered,false);assert.equal(r.dispatch.status,'uncertain');await f.api.tick();assert.equal(f.sent.length,1);
 f.api.observeDelivery({...f.scope('guest-2'),disturbanceId:r.id,dispatchId:r.dispatch.id,eventId:'c_5',source:'world',createdAt:T0+150000,operationId:'op_exact',linkageEvidence:['native-key#op_exact']});assert.equal(f.row(r.id).delivered,true);
});

test('native delivery during send waits for ACK linkage; refusal/error cannot cause another send',async()=>{
 let current;const f=fixture('mars-presentation-four',{send:request=>{
  current=f.row(request.id);f.api.observeDelivery({...f.scope('presenter'),disturbanceId:request.id,dispatchId:request.dispatchId,eventId:'c_7',source:'world',createdAt:T0+280000,effectId:'said_exact',linkageEvidence:['native#said_exact']});assert.equal(f.row(request.id).delivered,false);
  return {status:'accepted',effectId:'said_exact',evidence:['send#said_exact']};
 }});f.setNow(T0+280000);await f.api.tick();assert.equal(current.dispatch.status,'pending');assert.equal(f.row('prestart-interruption').delivered,true);
 for(const send of [()=>({status:'refused',evidence:['send#refusal']}),()=>{throw Error('private failure detail');}]){const x=fixture('mars-presentation-four',{send});x.setNow(T0+280000);await x.api.tick();await x.api.tick();assert.equal(x.sent.length,1);assert.equal(x.row('prestart-interruption').delivered,false);assert.ok(!JSON.stringify(x.api.snapshot()).includes('private failure detail'));}
});

test('late actual native delivery is retained as late, not replaced or hidden',async()=>{
 const f=fixture('mars-presentation-four');f.setNow(T0+280000);await f.api.tick();const r=f.row('prestart-interruption');f.setNow(T0+283000);
 f.api.observeDelivery({...f.scope('presenter'),disturbanceId:r.id,dispatchId:r.dispatch.id,eventId:'c_8',source:'world',createdAt:T0+283000,effectId:r.dispatch.effectId,linkageEvidence:['native#late']});assert.equal(f.row(r.id).status,'delivered-late');await f.api.tick();assert.equal(f.sent.length,1);
});

test('wrong identity, unverified timestamps and unsafe history loss fail conservatively',async()=>{
 const f=fixture('eden-reading-duo');assert.throws(()=>f.api.observeBody({...f.scope('reader-a'),soulId:'another',at:T0,receivedAt:T0,source:'here',currentBody:true,pos:[0,0]}),{code:'DISTURBANCE_SCOPE_MISMATCH'});
 assert.throws(()=>f.receipt('reader-a','r_bad',100,{acceptedAtUtc:undefined,accepted_tick:100}),{code:'INVALID_DISTURBANCE_RECEIPT'});
 assert.throws(()=>f.receipt('reader-a','r_bad',100,{acceptedAtUtc:undefined,acceptedAt:T0}),{code:'INVALID_DISTURBANCE_RECEIPT'});
 assert.throws(()=>f.receipt('reader-a','r_terminal',T0,{phase:'completed'}),{code:'INVALID_DISTURBANCE_RECEIPT'});
 for(let i=0;i<65;i++)f.body('reader-a',T0+i*1000,[i,0]);f.receipt('reader-a','r_late',T0);await f.api.tick();assert.equal(f.sent.length,0);assert.equal(f.row('travel-greeting').reason,'first-motion-history-unavailable');
});

test('send boundary has a bounded wait and late completion does not retry or invent delivery',async()=>{
 let signal,resolve;const f=fixture('mars-presentation-four',{send:r=>{signal=r.signal;return new Promise(done=>{resolve=done;});}});
 f.setNow(T0+282000);await f.api.tick();assert.equal(signal.aborted,true);assert.equal(f.row('prestart-interruption').dispatch.status,'uncertain');assert.equal(f.row('prestart-interruption').delivered,false);
 resolve({status:'accepted',effectId:'late_ack',evidence:['late#ack']});await f.api.tick();assert.equal(f.sent.length,1);assert.equal(f.row('prestart-interruption').dispatch.effectId,null);f.api.finish();
});

test('explicit first-observed acceptance is retained without converting ticks or calling it native time',async()=>{
 const f=fixture('eden-reading-duo');f.receipt('reader-a','r_one',T0,{acceptedAtUtc:undefined,observedAcceptedAt:T0});
 for(let i=0;i<=6;i++)f.body('reader-a',T0+i*1000,{x:i,z:0});await f.api.tick();
 assert.equal(f.row('travel-greeting').triggerProof.receiptAcceptanceProvenance,'first-observed-acceptance');assert.equal(f.row('travel-greeting').triggerProof.receiptAcceptedAt,T0);
});

test('garden interval history is bounded without substituting a later overlap',async()=>{
 const f=fixture('eden-walk-three');
 for(let i=0;i<33;i++){f.body('walker-1',T0+270000+i*2000,[57,-10]);f.body('walker-1',T0+271000+i*2000,[0,0]);}
 assert.equal(f.row('independent-errand').reason,'first-overlap-history-unavailable');
 const start=f.now+1000;for(let i=0;i<=10;i++)for(const actor of ['walker-1','walker-2','walker-3'])f.body(actor,start+i*1000,[57,-10]);await f.api.tick();assert.equal(f.sent.length,0);
});

test('a long fully observed stationary wait does not erase a later first moving journey',async()=>{
 const f=fixture('eden-reading-duo');f.receipt('reader-a','r_one',T0);
 for(let i=0;i<=90;i++)f.body('reader-a',T0+i*1000,[0,0]);
 for(let i=1;i<=6;i++)f.body('reader-a',T0+(90+i)*1000,[i,0]);await f.api.tick();
 assert.equal(f.sent.length,1);assert.equal(f.row('travel-greeting').triggerProof.motionOnsetAt,T0+91000);
});


test('an earlier receipt arriving before dispatch preserves the original first-motion window',async()=>{
 const f=fixture('eden-reading-duo');
 for(let i=0;i<=3;i++)f.body('reader-a',T0+i*1000,[i,0]);
 f.receipt('reader-a','r_later',T0+2000);
 for(let i=4;i<=8;i++)f.body('reader-a',T0+i*1000,[i,0]);
 assert.equal(f.row('travel-greeting').triggerProof.receiptId,'r_later');
 // The actual first journey ended before its required five-second delay.
 // Learning it late must not substitute the currently moving second journey.
 f.receipt('reader-a','r_first',T0,{phase:'completed',endedAtUtc:T0+2000});
 assert.equal(f.row('travel-greeting').scheduledAt,T0+6000);assert.equal(f.row('travel-greeting').triggerProof,null);
 f.setNow(T0+8001);await f.api.tick();assert.equal(f.sent.length,0);assert.equal(f.row('travel-greeting').status,'unmet');
});

test('an earlier first journey discovered after dispatch invalidates proof without rewriting or retrying',async()=>{
 const f=fixture('eden-reading-duo');for(let i=0;i<=3;i++)f.body('reader-a',T0+i*1000,[i,0]);f.receipt('reader-a','r_later',T0+2000);
 for(let i=4;i<=8;i++)f.body('reader-a',T0+i*1000,[i,0]);await f.api.tick();const sent=f.row('travel-greeting');assert.equal(f.sent.length,1);
 f.setNow(T0+9000);f.receipt('reader-a','r_first',T0,{phase:'completed',endedAtUtc:T0+2000});let r=f.row('travel-greeting');
 assert.equal(r.status,'invalid');assert.equal(r.firstMotionContradiction.receiptId,'r_first');assert.equal(r.firstMotionContradiction.at,T0+1000);assert.deepEqual(r.triggerProof,sent.triggerProof);assert.deepEqual(r.dispatch,sent.dispatch);assert.equal(r.scheduledAt,sent.scheduledAt);
 f.api.observeDelivery({...f.scope('reader-a'),disturbanceId:r.id,dispatchId:r.dispatch.id,eventId:'c_7',source:'world',createdAt:T0+8000,effectId:r.dispatch.effectId,linkageEvidence:['native#actual-delivery']});
 await f.api.tick();r=f.row(r.id);assert.equal(f.sent.length,1);assert.equal(r.delivered,true,'actual delivery remains a fact');assert.equal(r.status,'invalid','actual delivery cannot repair a wrong first trigger');assert.equal(r.reason,'earlier-first-motion-discovered-after-dispatch');assert(f.records.some(r=>r.kind==='disturbance-first-trigger-invalid'&&r.firstMotionContradiction.receiptId==='r_first'));
});

test('native delivery rejects every explicit shared-ID contradiction despite another exact match',async()=>{
 const f=fixture('mars-presentation-four',{send:()=>({status:'accepted',effectId:'sp_exact',operationId:'op_exact',evidence:['native#ack']})});f.setNow(T0+280000);await f.api.tick();const r=f.row('prestart-interruption');
 const delivery={...f.scope('presenter'),disturbanceId:r.id,dispatchId:r.dispatch.id,eventId:'c_1',source:'world',createdAt:T0+280000,linkageEvidence:['native#linkage']};
 for(const correlation of [{effectId:'sp_other',operationId:'op_exact'},{effectId:'sp_exact',operationId:'op_other'},{}])assert.throws(()=>f.api.observeDelivery({...delivery,...correlation}),{code:'DISTURBANCE_DELIVERY_UNLINKED'});
 assert.equal(f.row(r.id).delivered,false);f.api.observeDelivery({...delivery,effectId:'sp_exact'});assert.equal(f.row(r.id).delivered,true,'one exact ID suffices when no supplied shared ID contradicts it');
});


test('late native journey end retracts an unsent motion proof instead of substituting another action',async()=>{
 const f=fixture('eden-reading-duo');f.receipt('reader-a','r_first',T0);for(let i=0;i<=6;i++)f.body('reader-a',T0+i*1000,[i,0]);assert.ok(f.row('travel-greeting').triggerProof);
 f.receipt('reader-a','r_first',T0,{phase:'completed',endedAtUtc:T0+5000});assert.equal(f.row('travel-greeting').triggerProof,null);assert.equal(f.row('travel-greeting').scheduledAt,T0+6000);
 f.setNow(T0+8001);await f.api.tick();assert.equal(f.sent.length,0);assert.equal(f.row('travel-greeting').status,'unmet');
});

test('late native journey end invalidates a sent proof without undoing actual delivery or retrying',async()=>{
 const f=fixture('eden-reading-duo');f.receipt('reader-a','r_first',T0);for(let i=0;i<=6;i++)f.body('reader-a',T0+i*1000,[i,0]);await f.api.tick();const sent=f.row('travel-greeting');
 f.api.observeDelivery({...f.scope('reader-a'),disturbanceId:sent.id,dispatchId:sent.dispatch.id,eventId:'c_9',source:'world',createdAt:T0+6000,effectId:sent.dispatch.effectId,linkageEvidence:['native#actual-delivery']});
 f.setNow(T0+7000);f.receipt('reader-a','r_first',T0,{phase:'completed',endedAtUtc:T0+5000});await f.api.tick();const result=f.row(sent.id);
 assert.equal(result.status,'invalid');assert.equal(result.reason,'journey-ended-before-dispatched-motion-proof');assert.equal(result.delivered,true);assert.deepEqual(result.dispatch,sent.dispatch);assert.deepEqual(result.triggerProof,sent.triggerProof);assert.equal(f.sent.length,1);
});
