import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {observedHolds,scoreContinuity,scoreDisturbance,fieldReturnLocation} from './oracle.mjs';
import {insidePolygon} from '../../review/journey-oracles.mjs';
const bindings={chair:{entityId:'e_chair',slot:'seat',capabilities:{read:['read:read.e_chair']}}};
const phase={region:{pos:[0,0],radiusM:2},holdSec:30,postures:['seated'],activities:['read'],requireSeatRefs:['chair'],receipt:{verb:'read',targetRefs:['chair']}};
const receipt={id:'r1',capability:'read:read.e_chair',acceptedAtUtc:0,phase:'started'};
const samples=Array.from({length:31},(_,i)=>({t:i*1000,pos:{x:0,z:0,src:'here'},posture:'seated',activity:{kind:'read'},seat:'e_chair#seat'}));
test('accepted activity and elapsed receipt time cannot substitute for sustained body evidence',()=>{
 assert.equal(observedHolds({receipts:[receipt],bindings,phase}).status,'unknown');
 assert.equal(observedHolds({receipts:[receipt],samples:[samples[0],samples.at(-1)],bindings,phase}).status,'unknown');
 assert.equal(observedHolds({receipts:[receipt],samples:[samples[0],samples.at(-1)],bindings,phase,coverageComplete:true}).status,'unknown');
 assert.equal(observedHolds({receipts:[receipt],samples:samples.map(s=>({...s,pos:{...s.pos,src:'lastReceipt'}})),bindings,phase}).status,'unknown');
});
test('current body hold must span duration with same exact seat and no gaps or intervening activity',()=>{
 assert.equal(observedHolds({receipts:[receipt],samples,bindings,phase}).status,'pass');
 assert.equal(observedHolds({receipts:[receipt],samples:samples.map((s,i)=>i===15?{...s,activity:'standing'}:s),bindings,phase}).status,'unknown');
 assert.equal(observedHolds({receipts:[receipt],samples:samples.map((s,i)=>i===15?{...s,seat:'e_chair-other#seat'}:s),bindings,phase}).status,'unknown');
 assert.equal(observedHolds({receipts:[{...receipt,phase:'completed',endedAtUtc:20000}],samples,bindings,phase}).status,'unknown');
});
test('complete coverage can report physical failure while missing bindings remain unknown',()=>{
 assert.equal(observedHolds({receipts:[],samples,bindings,phase,coverageComplete:true}).status,'fail');
 assert.equal(observedHolds({receipts:[receipt],samples,bindings:{},phase,coverageComplete:true}).status,'unknown');
});
test('complete position coverage cannot establish missing native activity or instrument',()=>{
 const unknown=samples.map(s=>({...s,activity:null,reportedIntentActivity:'read'}));
 assert.equal(observedHolds({receipts:[receipt],samples:unknown,bindings,phase,coverageComplete:true}).status,'unknown');
 const music={...phase,activities:['play-music'],instruments:['violin']};
 const playing=samples.map(s=>({...s,activity:'play-music'}));
 assert.equal(observedHolds({receipts:[receipt],samples:playing,bindings,phase:music,coverageComplete:true}).status,'unknown');
 assert.equal(observedHolds({receipts:[receipt],samples:playing.map(s=>({...s,instrument:'violin'})),bindings,phase:music,coverageComplete:true}).status,'pass');
 assert.equal(observedHolds({receipts:[receipt],samples:playing.map(s=>({...s,instrument:'drums'})),bindings,phase:music,coverageComplete:true}).status,'fail');
});
test('local read:here needs an audited bounded lifecycle and the unchanged physical read hold',()=>{
 const p=structuredClone(phase);p.receipt.localCapabilities=['read:here'];
 const r={id:'local',capability:'read:here',acceptedAtUtc:0,endedAtUtc:31000,phase:'completed'};
 const run=(changes={})=>observedHolds({samples,receipts:[r],bindings,phase:p,from:0,to:31000,coverageComplete:true,...changes});
 assert.equal(run().status,'pass','generic local target is established by actual permitted held seat, not invented chosen target');
 assert.equal(run({coverageComplete:false}).status,'unknown','body samples do not certify full native receipt enumeration');
 assert.equal(run({coverageComplete:false,bindings:{chair:{...bindings.chair,capabilities:{read:['read:here']}}}}).status,'unknown','a generic capability in a binding cannot bypass the local lifecycle audit');
 for(const change of [{endedAtUtc:undefined},{acceptedAtUtc:undefined},{id:undefined}])assert.equal(run({receipts:[{...r,...change}]}).status,'unknown');
 assert.equal(run({from:-Infinity}).status,'unknown','local receipt must belong to a bounded observation interval');
 assert.equal(run({receipts:[{...r,capability:'read:remote'}]}).status,'fail');
 assert.equal(run({receipts:[{...r,phase:'replaced',endedAtUtc:15000}]}).status,'fail');
 assert.equal(run({receipts:[{...r,phase:'started',endedAtUtc:undefined},{id:'replacement',capability:'walk:field',acceptedAtUtc:15000,phase:'started'}]}).status,'fail','a missing old terminal cannot bridge a newer accepted native action');
 assert.equal(run({receipts:[{...r,phase:'started',endedAtUtc:undefined},{...r,id:'new-read',acceptedAtUtc:15000}]}).status,'fail','unchanged pose cannot stitch two individually short receipt lifetimes');
 assert.equal(run({receipts:[r,{id:'same-ms',capability:'walk:field',acceptedAtUtc:0,phase:'started'}]}).status,'unknown','ambiguous same-clock receipt ordering is not invented');
 assert.equal(run({samples:samples.map((s,i)=>i===15?{...s,activity:'walk'}:s)}).status,'fail');
 assert.equal(run({samples:samples.map((s,i)=>i===15?{...s,pos:{x:20,z:0,src:'here'}}:s)}).status,'fail');
 assert.equal(run({samples:samples.map((s,i)=>i===15?{...s,seat:undefined}:s)}).status,'unknown');
 const two={...bindings,other:{entityId:'e_other',slot:'seat',capabilities:{read:['read:other']}}},twoPhase={...p,requireSeatRefs:['chair','other'],receipt:{...p.receipt,targetRefs:['chair','other']}};
 assert.equal(run({bindings:two,phase:twoPhase,samples:samples.map((s,i)=>i>=15?{...s,seat:'e_other#seat'}:s)}).status,'fail','two short holds cannot be stitched across a seat switch');
 assert.equal(run({bindings:two,phase:twoPhase,receipts:[receipt],samples:samples.map(s=>({...s,seat:'e_other#seat'}))}).status,'fail','an unrelated named-seat receipt cannot support a different permitted seat');
});
test('empty proposal evidence cannot pass fixture, semantic, notification or duplicate-effect checks',()=>{
 const fixtures=JSON.parse(readFileSync(new URL('./fixtures.json',import.meta.url))),oracles=JSON.parse(readFileSync(new URL('./oracles.json',import.meta.url)));
 const result=scoreContinuity({fixtures,oracles,evidence:{scenarioId:'eden-reading-duo',t0:'2026-10-29T00:00:00Z'}});
 assert.equal(result.status,'unknown');
 for(const id of ['fixture-readiness','simultaneous-distinct-seat-reading','notification-latency','duplicate-public-effects','semantic:reading-reciprocity'])assert.equal(result.rows.find(r=>r.id===id).status,'unknown');
});
const frozenFixtures=JSON.parse(readFileSync(new URL('./fixtures.json',import.meta.url))),frozenOracles=JSON.parse(readFileSync(new URL('./oracles.json',import.meta.url)));
const score=evidence=>scoreContinuity({fixtures:frozenFixtures,oracles:frozenOracles,evidence:{t0:0,fixtureVerified:true,...evidence}});
const resultRow=(result,id)=>{const r=result.rows.find(r=>r.id===id);assert.ok(r,'missing '+id);return r;};
const fieldPolygon=[[-30,-30],[30,-30],[30,30],[-30,30]];
const fieldBinding=()=>({ref:'field',worldId:'world-test',boundAt:-1000,polygon:structuredClone(fieldPolygon),level:0,places:[{ref:'field',placeId:'field',polygon:structuredClone(fieldPolygon),level:0,kind:'walkable',enclosed:false}],navigation:[{capability:'walk:field',targetPlaceId:'field'}],evidence:['preflight.json#native-field-before-T0']});
function readingEvidence({returnAcceptedSec=200,a=[0,60],b=[0,60]}={}){
 const scenario=frozenFixtures.scenarios.find(s=>s.id==='eden-reading-duo'),bindings=Object.fromEntries(scenario.seatPool.map((s,i)=>[s.ref,{entityId:'chair-'+i,slot:'seat',capabilities:{read:['read:chair-'+i]}}]));
 bindings['eden-library-1']={entityId:'library',capabilities:{walk:['walk:library']}};bindings['place-field']={entityId:'field',capabilities:{walk:['walk:field']}};
 const participants={};
 for(const [actor,window,chair]of [['reader-a',a,1],['reader-b',b,2]]){
  const [start,end]=window;
  participants[actor]={coverageComplete:true,samples:Array.from({length:721},(_,i)=>({t:i*1000,pos:{x:i>=start&&i<=end?74:0,z:i>=start&&i<=end?-7:0,src:'here'},place:i>=start&&i<=end?'library':'field',placeProvenance:'explicit-native-most-specific-place',level:0,posture:i>=start&&i<=end?'seated':'standing',activity:i>=start&&i<=end?'read':'idle',seat:i>=start&&i<=end?'chair-'+chair+'#seat':null})),receipts:[{id:actor+'-arrive',capability:'walk:library',acceptedAtUtc:0,endedAtUtc:0,phase:'completed'},{id:actor+'-read',capability:'read:chair-'+chair,acceptedAtUtc:start*1000,endedAtUtc:end*1000,phase:'completed'},{id:actor+'-return',capability:'walk:field',chosen:{target:'field',place:'field'},acceptedAtUtc:returnAcceptedSec*1000,endedAtUtc:201000,phase:'completed'}],reads:[{command:'here',origin:'agent',requestedAt:201500,at:202000,evidence:['agent here after return']}]};
 }
 return {scenarioId:scenario.id,worldId:'world-test',fieldReturnBinding:fieldBinding(),bindings,participants,semantic:{closureAt:25000}};
}
test('prospective fixture permits local read:here only with complete native lifecycle evidence',()=>{
 const e=readingEvidence({a:[250,300],b:[250,300]});e.participants['reader-b'].receipts[1].capability='read:here';
 assert.equal(resultRow(score(e),'reader-b:sustained seated reading').status,'pass');assert.equal(resultRow(score(e),'simultaneous-distinct-seat-reading').status,'pass');
 e.participants['reader-b'].coverageComplete=false;assert.equal(resultRow(score(e),'reader-b:sustained seated reading').status,'unknown');assert.equal(resultRow(score(e),'simultaneous-distinct-seat-reading').status,'unknown');
});
test('fresh local explore inspection requires agent provenance and current destination body bracketing',()=>{
 const make=()=>{const e=readingEvidence();e.participants['reader-a'].reads=[{command:'explore',origin:'agent',requestedAt:201500,at:202500,inspection:{kind:'native-local-around',tick:99,facts:[{kind:'things',text:'podium · 9m ahead'}],evidence:['agent evidence#/response/around']},evidence:['agent evidence']}];return e;};
 const id='reader-a:errand-read',e=make();assert.equal(resultRow(score(e),id).status,'pass');
 for(const command of ['here','observe']){const x=make();x.participants['reader-a'].reads[0].command=command;assert.equal(resultRow(score(x),id).status,'pass');x.participants['reader-a'].samples.find(s=>s.t===202000).pos.x=74;assert.equal(resultRow(score(x),id).status,'unknown','an unrelated current read after leaving the destination cannot count');}
 for(const change of [{origin:'observer'},{inspection:undefined},{requestedAt:200000},{at:721000},{inspection:{kind:'native-local-around',facts:[],evidence:['source']}},{inspection:{kind:'remote-view',facts:['route'],evidence:['source']}}]){
  const x=make();Object.assign(x.participants['reader-a'].reads[0],change);assert.equal(resultRow(score(x),id).status,'unknown');
 }
 const contrary=make();contrary.participants['reader-a'].samples.find(s=>s.t===202000).pos.x=74;assert.equal(resultRow(score(contrary),id).status,'unknown','physical return receipt cannot replace current location during inspection');
 const gap=make();gap.participants['reader-a'].samples=gap.participants['reader-a'].samples.filter(s=>s.t<202000||s.t>204000);assert.equal(resultRow(score(gap),id).status,'unknown');
 const oldManifest=structuredClone(frozenFixtures);oldManifest.scenarios[0].actors[0].originalErrand.requiresReadAfterReturn=['here','observe'];assert.equal(resultRow(scoreContinuity({fixtures:oldManifest,oracles:frozenOracles,evidence:{t0:0,...e}}),id).status,'unknown','explore permission is an explicit prospective fixture declaration');
 for(const command of ['here','observe']){const observer=make();Object.assign(observer.participants['reader-a'].reads[0],{command,origin:'observer'});assert.equal(resultRow(score(observer),id).status,'unknown','observer read is not the agent inspecting');const stale=make();Object.assign(stale.participants['reader-a'].reads[0],{command,requestedAt:200000});assert.equal(resultRow(score(stale),id).status,'unknown','a request before return cannot become fresh by a late response');}
});
test('phase ordering uses observed hold/completion, allowing compound acceptance before arrival',()=>{
 const evidence=readingEvidence({returnAcceptedSec:10});for(const ev of Object.values(evidence.participants))ev.receipts.at(-1).endedAtUtc=26000;
 const early=score(evidence);assert.equal(resultRow(early,'reader-a:original errand return').status,'fail');
 const valid=score(readingEvidence({returnAcceptedSec:10}));assert.equal(resultRow(valid,'reader-a:original errand return').status,'pass','early acceptance is valid when native completion follows the prerequisite');
 const compound=readingEvidence({a:[10,60],b:[10,60]});for(const ev of Object.values(compound.participants)){ev.receipts=ev.receipts.filter(r=>!r.id.endsWith('-arrive'));ev.receipts[0].acceptedAtUtc=0;}
 const arrived=score(compound);assert.equal(resultRow(arrived,'reader-a:library arrival').status,'pass');assert.equal(resultRow(arrived,'reader-a:sustained seated reading').status,'pass','one native read may approach, seat and read without a separate walk');
 compound.participants['reader-a'].receipts[0].endedAtUtc=5000;assert.equal(resultRow(score(compound),'reader-a:sustained seated reading').status,'fail','an earlier ended activity does not prove a later hold');
});
test('complete non-overlapping reading windows fail; missing body coverage remains unknown',()=>{
 const evidence=readingEvidence({a:[0,40],b:[60,100]});
 assert.equal(resultRow(score(evidence),'simultaneous-distinct-seat-reading').status,'fail');
 evidence.participants['reader-b'].coverageComplete=false;assert.equal(resultRow(score(evidence),'simultaneous-distinct-seat-reading').status,'unknown');
 evidence.participants['reader-b'].coverageComplete=true;delete evidence.bindings[frozenFixtures.scenarios[0].seatPool[1].ref];assert.equal(resultRow(score(evidence),'simultaneous-distinct-seat-reading').status,'unknown','missing native binding is not complete contradictory evidence');
});
test('appointment reading counts only the shared duration at or after meeting, retaining early arrival and cutoff',()=>{
 const id='simultaneous-distinct-seat-reading',early=readingEvidence({a:[0,60],b:[0,60]}),result=score(early);
 assert.equal(resultRow(result,'reader-a:arrival').status,'pass');assert.equal(resultRow(result,'reader-a:sustained seated reading').status,'pass');assert.equal(resultRow(result,id).status,'fail','early arrival and a complete early read cannot wholly satisfy the later appointment');
 early.participants['reader-b'].coverageComplete=false;assert.equal(resultRow(score(early),id).status,'unknown','missing coverage remains unknown rather than invented failure');
 assert.equal(resultRow(score(readingEvidence({a:[180,259],b:[200,259]})),id).status,'fail','long straddling holds have only 19 seconds after meeting');
 const exact=resultRow(score(readingEvidence({a:[180,270],b:[200,280]})),id);assert.equal(exact.status,'pass');assert.equal(exact.evidence[0].from,240000);assert.equal(exact.evidence[0].to,270000);assert.ok(exact.evidence[0].windows.every(w=>w.from>=240000));
 assert.ok(exact.evidence[0].windows.every(w=>w.completedAt>=w.from+30000),'credited completion belongs to the postmeeting window');
 assert.equal(resultRow(score(readingEvidence({a:[180,269],b:[200,300]})),id).status,'fail','29 postmeeting seconds is insufficient even with much earlier reading');
 const jitter=readingEvidence({a:[180,270],b:[200,270]});for(const ev of Object.values(jitter.participants))ev.samples.find(s=>s.t===240000).t=240500;assert.equal(resultRow(score(jitter),id).status,'fail','the first native sample after meeting starts the credited interval; do not invent a boundary sample');
 const cutoff=resultRow(score(readingEvidence({a:[690,721],b:[690,721]})),id);assert.equal(cutoff.status,'pass');assert.equal(cutoff.evidence[0].to,720000);
 assert.equal(resultRow(score(readingEvidence({a:[691,730],b:[691,730]})),id).status,'fail','after-cutoff time cannot fill a short appointment hold');
});
const notification={eventId:'event-1',actor:'reader-a',createdAt:0,persistedAt:100,notifiedAt:200,firstRelevantEffectAt:300,relevantEffectId:'speech-1',relevanceEvidence:['native speech-1 answers event-1'],healthyRunning:true};
const effect={id:'speech-1',operationId:'op-1',actor:'reader-a',type:'speech',at:300,respondsToEventId:'event-1'};
const notificationScore=(n=notification,e=effect)=>score({scenarioId:'eden-reading-duo',notifications:[n],effects:[e]});
test('visible response requires actor/event linkage, source-cited relevance and causal timestamps',()=>{
 const id='notification:event-1:visible-response';
 assert.equal(resultRow(notificationScore(),id).status,'pass');
 for(const n of [{...notification,persistedAt:null,notifiedAt:null},{...notification,notifiedAt:null}])assert.equal(resultRow(notificationScore(n),id).status,'pass','native response is measurable without managed persistence or host-stage telemetry');
 assert.equal(resultRow(notificationScore({...notification,persistedAt:null,notifiedAt:null,firstRelevantEffectAt:20000},{...effect,at:20000}),id).status,'fail','missing client stages cannot hide a slow native response');
 for(const n of [{...notification,actor:undefined},{...notification,relevanceEvidence:[]}])assert.equal(resultRow(notificationScore(n),id).status,'unknown');
 for(const e of [{...effect,actor:undefined},{...effect,respondsToEventId:undefined}])assert.equal(resultRow(notificationScore(notification,e),id).status,'unknown');
 for(const e of [{...effect,actor:'reader-b'},{...effect,respondsToEventId:'other-event'},{...effect,at:301}])assert.equal(resultRow(notificationScore(notification,e),id).status,'fail');
 const early={...notification,firstRelevantEffectAt:50};assert.equal(resultRow(notificationScore(early,{...effect,at:50}),id).status,'fail','an unrelated earlier effect cannot count as a response');
 assert.equal(resultRow(notificationScore({...early,notifiedAt:null},{...effect,at:50}),id).status,'fail','a missing middle timestamp cannot hide an observed causal inversion');
 const backwards=notificationScore({...notification,persistedAt:-1});assert.equal(resultRow(backwards,'notification:event-1:receive').status,'fail');
});
function presentationEvidence(){
 const scenario=frozenFixtures.scenarios.find(s=>s.id==='mars-presentation-four'),refs=['presenter-timber-box','tier-2','tier-3','tier-4'],bindings=Object.fromEntries(refs.map(ref=>[ref,{entityId:ref,slot:'seat',capabilities:{sit:['sit:'+ref]}}]));bindings.field={entityId:'field',capabilities:{walk:['walk:field']}};
 for(const seat of scenario.audienceSeats)if(seat.entityRef)bindings[seat.ref]={entityId:seat.entityRef,slot:seat.slot,capabilities:{sit:['sit:'+seat.entityRef]}};
 const participants={};
 for(const [index,actor]of scenario.actors.entries()){
  const start=index===3?400:320,ref=refs[index];
  participants[actor.id]={coverageComplete:true,samples:Array.from({length:1081-actor.releaseOffsetSec},(_,n)=>{const i=n+actor.releaseOffsetSec,seated=i>=start&&i<=450;return {t:i*1000,pos:{x:seated?-14.412:0,z:seated?-18.447:0,src:'world'},place:seated?'chiba':'field',placeProvenance:'explicit-native-most-specific-place',level:0,posture:seated?'seated':'standing',seat:seated?ref+'#seat':null};}),receipts:[{id:actor.id+'-sit',capability:'sit:'+ref,acceptedAtUtc:start*1000,phase:'started'},{id:actor.id+'-return',capability:'walk:field',chosen:{target:'field',place:'field'},acceptedAtUtc:500000,endedAtUtc:550000,phase:'completed'}],reads:[{command:'here',origin:'agent',requestedAt:550500,at:551000,evidence:['agent here after return']}]};
 }
 return {scenarioId:scenario.id,worldId:'world-test',fieldReturnBinding:fieldBinding(),bindings,participants,marsReturnTargetRefs:['field'],semantic:{closureAt:440000},effects:[{id:'talk-1',actor:'presenter',type:'speech',at:410000},{id:'talk-2',actor:'presenter',type:'speech',at:430000}],presentation:{startedAt:400000,endedAt:440000,speechIds:['talk-1','talk-2'],evidence:['native speech timeline'],coverageComplete:true}};
}
test('Mars attendance needs all four distinct seats during actual source-cited talk',()=>{
 const id='presentation-simultaneous-distinct-seat-attendance',evidence=presentationEvidence();
 assert.equal(resultRow(score(evidence),id).status,'pass');
 const missing=structuredClone(evidence);delete missing.presentation;assert.equal(resultRow(score(missing),id).status,'unknown');
 const absentSpeech=structuredClone(evidence);absentSpeech.presentation.speechIds.push('missing');assert.equal(resultRow(score(absentSpeech),id).status,'unknown');
 const wrongSpeaker=structuredClone(evidence);wrongSpeaker.effects[0].actor='attendee-1';assert.equal(resultRow(score(wrongSpeaker),id).status,'fail');
 const duplicateSeat=structuredClone(evidence);duplicateSeat.participants['attendee-2'].samples=duplicateSeat.participants['attendee-2'].samples.map(s=>s.seat?{...s,seat:'tier-2#seat'}:s);assert.equal(resultRow(score(duplicateSeat),id).status,'fail');
 const missingBinding=structuredClone(evidence);delete missingBinding.bindings['tier-4'];assert.equal(resultRow(score(missingBinding),id).status,'unknown');
 const afterTalk=structuredClone(evidence),late=afterTalk.participants['attendee-3'];late.samples=late.samples.map(s=>s.seat?{...s,pos:{x:0,z:0,src:'world'},seat:null,posture:'standing'}:s);for(const s of late.samples)if(s.t>=500000&&s.t<=540000)Object.assign(s,{pos:{x:-14.412,z:-18.447,src:'world'},posture:'seated',seat:'tier-4#seat'});
 assert.equal(resultRow(score(afterTalk),id).status,'fail','an individually sufficient seat hold after the talk is not attendance');
 late.coverageComplete=false;assert.equal(resultRow(score(afterTalk),id).status,'unknown');
});
test('authored Navy Sofa subslots qualify without collapsing distinct slots or allowing occupied first tier',()=>{
 const e=presentationEvidence(),id='presentation-simultaneous-distinct-seat-attendance';
 for(const [actor,slot]of [['attendee-1','seat-1'],['attendee-2','seat-2']]){
  const p=e.participants[actor];p.samples=p.samples.map(s=>s.seat?{...s,seat:'navy-sofa#'+slot}:s);p.receipts[0]={...p.receipts[0],capability:'sit:navy-sofa',chosen:{target:'navy-sofa',slot:'navy-sofa#'+slot}};
 }
 assert.equal(resultRow(score(e),id).status,'pass');
 const aliases=structuredClone(e);aliases.bindings={sofaAlias:{entityId:'navy-sofa'},...aliases.bindings};assert.equal(resultRow(score(aliases),id).status,'pass','an entity alias cannot shadow the exact permitted subslot binding');
 const bare=structuredClone(e);for(const actor of ['attendee-1','attendee-2'])bare.participants[actor].samples.forEach(s=>{if(s.seat)s.seat='navy-sofa'});assert.equal(resultRow(score(bare),id).status,'unknown','a bare multi-seat entity cannot invent its held subslot');
 const same=structuredClone(e);same.participants['attendee-2'].samples.forEach(s=>{if(s.seat)s.seat='navy-sofa#seat-1'});same.participants['attendee-2'].receipts[0].chosen.slot='navy-sofa#seat-1';assert.equal(resultRow(score(same),id).status,'fail');
 const wrongReceipt=structuredClone(e);wrongReceipt.participants['attendee-2'].receipts[0].chosen.slot='navy-sofa#seat-3';assert.equal(resultRow(score(wrongReceipt),id).status,'fail','explicit native chosen slot cannot be ignored');
 const occupied=structuredClone(e);occupied.participants['attendee-1'].samples.forEach(s=>{if(s.seat)s.seat='tier#seat'});assert.equal(resultRow(score(occupied),id).status,'fail');
 const tooFar=structuredClone(e);tooFar.participants['attendee-1'].samples.forEach(s=>{if(s.seat)s.pos={x:0,z:0,src:'here'}});assert.equal(resultRow(score(tooFar),id).status,'fail','sofa addition does not change venue radius');
});
test('prospective sofa pool matches all authored capacity-one slots and final poses without changing numeric thresholds',()=>{
 const scenario=frozenFixtures.scenarios.find(s=>s.id==='mars-presentation-four'),sofas=scenario.audienceSeats.filter(s=>s.entityRef),template=JSON.parse(readFileSync(new URL('../../../../worlds/templates/mars-two.json',import.meta.url))),historical=JSON.parse(readFileSync(new URL('../../../../worlds/templates/unified-mars-live-proof-20261027.json',import.meta.url)));
 const flatten=v=>Array.isArray(v)?v.flatMap(flatten):v&&typeof v==='object'?[v,...Object.values(v).flatMap(flatten)]:[];
 const ops=flatten(template),definition=flatten(historical).find(v=>v.name==='core-mars-navy-sofa'&&v.version===2);
 assert.equal(sofas.length,6);assert.deepEqual(new Set(sofas.map(s=>s.entityRef)),new Set(['navy-sofa','navy-sofa-2']));
 for(const seat of sofas){const pose=ops.filter(o=>o.op==='move'&&o.id===seat.entityRef).at(-1),slot=definition.slots.find(s=>s.id===seat.slot);assert.equal(slot.capacity,1);assert.deepEqual(seat.localSeatPos,slot.p);assert.deepEqual(seat.entityWorldPose,pose.p);assert.equal(seat.entityAuthoredRotation,pose.r);const [x,,z]=slot.p;assert.ok(Math.abs(seat.worldXZCandidate[0]-(pose.p[0]+x*Math.cos(pose.r)+z*Math.sin(pose.r)))<1e-9);assert.ok(Math.abs(seat.worldXZCandidate[1]-(pose.p[2]-x*Math.sin(pose.r)+z*Math.cos(pose.r)))<1e-9);}
 assert.equal(scenario.venue.region.radiusM,9);assert.equal(scenario.timing.minimumAudienceHoldSec,30);assert.equal(scenario.timing.minimumPresenterHoldSec,30);assert.equal(scenario.occupiedSeat.ref,'tier');assert.ok(!scenario.journeyTemplates.audience[0].receipt.targetRefs.includes('tier'));for(const actor of scenario.actors)assert.deepEqual(actor.originalErrand.returnRegion,{includePolygon:fieldPolygon});
});
test('complete audience attendance outside actual native performance fails instead of unknown',()=>{
 const scenario=frozenFixtures.scenarios.find(s=>s.id==='eden-bandstand-five'),bindings={'bandstand-violin-1':{entityId:'violin',capabilities:{'play-music':['play-music:violin']}},'eden-bandstand':{entityId:'bandstand',capabilities:{walk:['walk:bandstand']}},'place-field':{entityId:'field',capabilities:{walk:['walk:field']}}},participants={};
 for(const actor of scenario.actors){
  const performer=actor.role==='performer',start=performer?300:400,end=performer?340:430;
  participants[actor.id]={coverageComplete:true,samples:Array.from({length:901-actor.releaseOffsetSec},(_,n)=>{const i=n+actor.releaseOffsetSec,present=i>=start&&i<=end;return {t:i*1000,pos:{x:present?performer?37.6:40:0,z:present?performer?-25.4:-30:0,src:'here'},posture:present&&performer?'busy':'standing',activity:present&&performer?'play-music':'idle',instrument:present&&performer?'violin':null};}),receipts:[performer?{id:actor.id+'-play',capability:'play-music:violin',acceptedAtUtc:300000,endedAtUtc:340000,phase:'completed'}:{id:actor.id+'-arrive',capability:'walk:bandstand',acceptedAtUtc:300000,endedAtUtc:350000,phase:'completed'},{id:actor.id+'-return',capability:'walk:field',acceptedAtUtc:500000,endedAtUtc:550000,phase:'completed'}]};
 }
 const evidence={scenarioId:scenario.id,fixtureVersion:scenario.fixtureVersion,bindings,participants,semantic:{closureAt:450000}};
 assert.equal(resultRow(score(evidence),'guest-1:actual-performance-overlap').status,'fail');
 delete bindings['bandstand-violin-1'];assert.equal(resultRow(score(evidence),'guest-1:actual-performance-overlap').status,'unknown');
});
function disturbanceScore(scenarioId,id,evidence){
 const scenario=frozenFixtures.scenarios.find(s=>s.id===scenarioId),disturbance=scenario.disturbances.find(d=>d.id===id);
 return scoreDisturbance({scenario,disturbance,evidence,t0:0,cutoff:scenario.timing.endOffsetSec*1000,maxGapSec:2,bindings:evidence.bindings??{}});
}
const nativeDelivery=(actor,source,time)=>({actor,eventId:'native-event',source,createdAt:time,evidence:['native per-Soul event record']});
const deliveredDisturbance=(kind,recipients,scheduled,delivered,typed={})=>({delivered:true,recipients,scheduledAt:scheduled,deliveredAt:delivered,evidence:['native delivery source'],triggerProof:{kind,observedAt:scheduled,evidence:['native trigger source'],...typed}});
function motionEvidence(){
 const d=deliveredDisturbance('moving-body-journey',['reader-a'],6000,6000,{receiptId:'journey',motionOnsetFromAt:0,motionOnsetAt:1000,motionFromAt:5000,motionToAt:6000});d.deliveryEvents=[nativeDelivery('reader-a','world',6000)];
 return {participants:{'reader-a':{samples:[0,1000,5000,6000].map(t=>({t,pos:{x:t/1000,z:0,src:'here'}})),receipts:[{id:'journey',capability:'read:library',acceptedAtUtc:0,endedAtUtc:10000,phase:'completed'}]}},disturbances:{'travel-greeting':d},notifications:[{eventId:'native-event',actor:'reader-a',source:'world',createdAt:6000}]};
}
test('travel disturbance requires native heard-recipient proof under a current moving compound journey',()=>{
 const e=motionEvidence(),run=e=>disturbanceScore('eden-reading-duo','travel-greeting',e);assert.equal(run(e).status,'pass');
 const acceptedOnly=structuredClone(e);delete acceptedOnly.disturbances['travel-greeting'].deliveryEvents;acceptedOnly.disturbances['travel-greeting'].actionAcceptedAt=6000;assert.equal(run(acceptedOnly).status,'unknown');
 const wrongRecipient=structuredClone(e);wrongRecipient.disturbances['travel-greeting'].deliveryEvents[0].actor='reader-b';assert.equal(run(wrongRecipient).status,'fail');
 const late=structuredClone(e);late.disturbances['travel-greeting'].deliveredAt=9000;late.disturbances['travel-greeting'].deliveryEvents[0].createdAt=9000;late.notifications[0].createdAt=9000;assert.equal(run(late).status,'fail');
 const stationary=structuredClone(e);stationary.participants['reader-a'].samples.at(-1).pos.x=5;assert.equal(run(stationary).status,'fail');
 const missingSource=structuredClone(e);missingSource.disturbances['travel-greeting'].triggerProof.evidence=[];assert.equal(run(missingSource).status,'unknown');
});
test('fixed disturbances and initial releases enforce frozen schedules and exact recipients',()=>{
 const d=deliveredDisturbance('scheduled-event',['presenter'],280000,280500);d.deliveryEvents=[nativeDelivery('presenter','world',280500)];
 const e={disturbances:{'prestart-interruption':d},notifications:[{actor:'presenter',source:'world',eventId:'native-event',createdAt:280500}]},run=e=>disturbanceScore('mars-presentation-four','prestart-interruption',e);
 assert.equal(run(e).status,'pass');const early=structuredClone(e);early.disturbances['prestart-interruption'].scheduledAt=279000;assert.equal(run(early).status,'fail');
 const wrong=structuredClone(e);wrong.disturbances['prestart-interruption'].recipients=['attendee-1'];assert.equal(run(wrong).status,'fail');
 const missing=structuredClone(e);delete missing.disturbances['prestart-interruption'].scheduledAt;assert.equal(run(missing).status,'unknown');
 const release=deliveredDisturbance('scheduled-release',['attendee-3'],330000,330500,{releasedAt:330500,initialInstructionId:'initial-attendee-3'});
 assert.equal(disturbanceScore('mars-presentation-four','late-attendee',{disturbances:{'late-attendee':release}}).status,'pass','controller initial release does not pretend to be native world speech');
 const supplement=deliveredDisturbance('initial-supplement',['walker-3'],270000,270100,{releasedAt:270100,initialInstructionId:'initial-walker-3'});
 assert.equal(disturbanceScore('eden-walk-three','revised-endpoint-proposal',{disturbances:{'revised-endpoint-proposal':supplement}}).status,'pass');
});
test('staggered releases prove every actor schedule without imposing a dialogue order',()=>{
 const scenario=frozenFixtures.scenarios.find(s=>s.id==='eden-bandstand-five'),releases=scenario.actors.map(a=>({actor:a.id,scheduledAt:a.releaseOffsetSec*1000,deliveredAt:a.releaseOffsetSec*1000+500,initialInstructionId:'initial-'+a.id,evidence:['controller release '+a.id]}));
 const d=deliveredDisturbance('staggered-releases',scenario.actors.map(a=>a.id),0,270500,{observedAt:270500,releases}),e={disturbances:{'staggered-starts':d}};
 assert.equal(disturbanceScore(scenario.id,'staggered-starts',e).status,'pass');releases[2].deliveredAt=releases[2].scheduledAt-1000;assert.equal(disturbanceScore(scenario.id,'staggered-starts',e).status,'fail');
});
test('garden errand trigger requires a timestamped actual three-body overlap before owner delivery',()=>{
 const participants=Object.fromEntries(['walker-1','walker-2','walker-3'].map(id=>[id,{coverageComplete:true,samples:Array.from({length:11},(_,n)=>({t:300000+n*1000,pos:{x:57,z:-10,src:'world'}}))}]));
 const d=deliveredDisturbance('garden-group-overlap',['walker-2'],310000,310500,{gardenRef:'place-eden-stone-garden',overlapFrom:300000,overlapTo:310000});d.deliveryEvents=[nativeDelivery('walker-2','owner',310500)];
 const e={participants,disturbances:{'independent-errand':d},notifications:[{actor:'walker-2',eventId:'native-event',source:'owner',createdAt:310500}]},run=e=>disturbanceScore('eden-walk-three','independent-errand',e);
 assert.equal(run(e).status,'pass');
 const skewed=structuredClone(e);Object.values(skewed.participants).forEach((p,i)=>{p.samples=Array.from({length:12},(_,n)=>({t:300000+i*300+n*1000,pos:{x:57,z:-10,src:'world'}}));});
 const sd=skewed.disturbances['independent-errand'];Object.assign(sd,{scheduledAt:310600,deliveredAt:311500});Object.assign(sd.triggerProof,{observedAt:310600,overlapFrom:300600,overlapTo:310600});sd.deliveryEvents[0].createdAt=311500;skewed.notifications[0].createdAt=311500;
 assert.equal(run(skewed).status,'pass','actual independently sampled bracketing intervals establish the same ten-second shared hold');
 const future=structuredClone(e);for(const p of Object.values(future.participants))p.samples=[...p.samples.filter(s=>s.t<310000),{t:311000,pos:{x:57,z:-10,src:'world'}}];future.disturbances['independent-errand'].triggerProof.proofAvailableAt=311000;assert.equal(run(future).status,'fail','later bracketing samples cannot prove a trigger was known before delivery');
 const gap=structuredClone(skewed);gap.participants['walker-1'].samples=gap.participants['walker-1'].samples.filter(s=>s.t<304000||s.t>307000);assert.notEqual(run(gap).status,'pass','asynchronous boundaries cannot fill a real observation gap');
 const absent=structuredClone(e);delete absent.participants['walker-3'];assert.equal(run(absent).status,'unknown');
 const apart=structuredClone(e);apart.participants['walker-3'].samples.forEach(s=>s.pos.x=0);assert.equal(run(apart).status,'fail');
 const premature=structuredClone(e);premature.disturbances['independent-errand'].triggerProof.overlapTo=305000;assert.equal(run(premature).status,'fail');
 const postponed=structuredClone(e);for(const ev of Object.values(postponed.participants))ev.samples=Array.from({length:31},(_,n)=>({t:300000+n*1000,pos:{x:57,z:-10,src:'world'}}));const later=postponed.disturbances['independent-errand'];Object.assign(later,{scheduledAt:320000,deliveredAt:320500});Object.assign(later.triggerProof,{observedAt:320000,overlapFrom:310000,overlapTo:320000});later.deliveryEvents[0].createdAt=320500;postponed.notifications[0].createdAt=320500;assert.equal(run(postponed).status,'fail','cannot postpone a frozen first-observed trigger to a convenient later window');
});
function occupiedEvidence(){
 const scenario=frozenFixtures.scenarios[0],seat=scenario.occupiedSeat.ref,binding={entityId:'occupied',slot:'seat',capabilities:{sit:['sit:occupied']}};
 const fixture={coverageComplete:true,receipts:[{id:'occupy',capability:'sit:occupied',acceptedAtUtc:-2000,endedAtUtc:-1000,phase:'completed'}],samples:Array.from({length:722},(_,n)=>({t:(n-1)*1000,pos:{x:74,z:-7,src:'here'},posture:'seated',seat:'occupied#seat'}))};
 const d=deliveredDisturbance('occupied-seat',scenario.actors.map(a=>a.id),-2000,-1000,{observedAt:-1000,receiptId:'occupy',seatRef:seat});return {bindings:{[seat]:binding},fixtureActors:{'seat-occupant':fixture},disturbances:{'occupied-seat':d}};
}
test('occupied-seat disturbance uses a fixture-only native body and continuous exact seat proof',()=>{
 const e=occupiedEvidence(),run=e=>disturbanceScore('eden-reading-duo','occupied-seat',e);
 assert.equal(run(e).status,'pass','no model thread is required for the fixture occupant');
 const left=structuredClone(e);left.fixtureActors['seat-occupant'].samples[300].seat='different#seat';assert.equal(run(left).status,'fail');
 const oldPose=structuredClone(e);oldPose.fixtureActors['seat-occupant'].samples.forEach(s=>s.pos.src='lastReceipt');assert.equal(run(oldPose).status,'unknown');
});
test('occupied seat brackets a jittered cutoff with fixture-only post-cutoff verification',()=>{
 const e=occupiedEvidence(),fixture=e.fixtureActors['seat-occupant'],run=e=>disturbanceScore('eden-reading-duo','occupied-seat',e);
 fixture.samples.forEach((s,i)=>{if(i)s.t+=250});assert.equal(fixture.samples.at(-1).t,720250);assert.equal(run(e).status,'pass','same seat on both sides proves sampled continuity without an exact-cutoff timestamp');
 const missingEnd=structuredClone(e);missingEnd.fixtureActors['seat-occupant'].samples.pop();assert.equal(run(missingEnd).status,'unknown','a coverageComplete flag cannot replace an actual cutoff bracket');
 const tooLate=structuredClone(e);tooLate.fixtureActors['seat-occupant'].samples.at(-1).t+=2000;assert.equal(run(tooLate).status,'unknown','a late verification sample cannot fill an excessive cutoff gap');
 const missingStart=structuredClone(e);missingStart.fixtureActors['seat-occupant'].samples[0].t++;assert.equal(run(missingStart).status,'unknown','setup timestamp must bind an actual current seat sample');
 const afterOnly=structuredClone(e);afterOnly.fixtureActors['seat-occupant'].samples=afterOnly.fixtureActors['seat-occupant'].samples.filter(s=>s.t>720000);assert.equal(run(afterOnly).status,'unknown','a post-cutoff witness alone cannot prove the trial interval');
});
test('occupied-seat gaps stay unknown and contrary in-trial native states fail without post-cutoff overreach',()=>{
 const e=occupiedEvidence(),run=e=>disturbanceScore('eden-reading-duo','occupied-seat',e);e.fixtureActors['seat-occupant'].samples.forEach((s,i)=>{if(i)s.t+=250});
 const gap=structuredClone(e);gap.fixtureActors['seat-occupant'].samples=gap.fixtureActors['seat-occupant'].samples.filter(s=>s.t<200250||s.t>201250);assert.equal(run(gap).status,'unknown','a 3s internal gap is not continuous occupancy');
 const missingState=structuredClone(e);delete missingState.fixtureActors['seat-occupant'].samples[300].seat;assert.equal(run(missingState).status,'unknown','missing seat state is not proof of departure');
 for(const change of [{seat:null},{seat:'other#seat'},{posture:'standing'},{pos:{x:0,z:0,src:'here'}}]){const contrary=structuredClone(e);Object.assign(contrary.fixtureActors['seat-occupant'].samples[300],change);contrary.fixtureActors['seat-occupant'].coverageComplete=false;assert.equal(run(contrary).status,'fail','native contrary occupancy disproves the interval even if another observation is absent');}
 const after=structuredClone(e);after.fixtureActors['seat-occupant'].samples.at(-1).seat=null;assert.equal(run(after).status,'unknown','departure first seen after cutoff does not prove departure during trial');
 const exact=occupiedEvidence();exact.fixtureActors['seat-occupant'].samples.push({t:720250,pos:{x:0,z:0,src:'here'},posture:'standing',seat:null});assert.equal(run(exact).status,'pass','an exact cutoff witness remains valid when fixture cleanup occurs later');
});
function restartEvidence(){
 const restart={actor:'reader-b',setupId:'setup-1',worldId:'world-1',soulId:'soul-b',journalBefore:'journal-b',journalAfter:'journal-b',threadBefore:'thread-b',threadAfter:'thread-b',threadResumed:true,wholeControllerKilled:true,deathAt:2000,recoveredAt:16000,sameJournal:true,originalIntentRetained:true,operationReconciled:true,evidence:['process and scoped recovery sources']};
 const d=deliveredDisturbance('checkpoint-future-wake',['reader-b'],1000,2000,{checkpointId:'checkpoint-1',checkpointAt:500,wakeAt:25000});
 return {scenarioId:'eden-reading-duo',setup:{id:'setup-1',worldId:'world-1',actors:{'reader-b':{soulId:'soul-b',journalId:'journal-b',threadId:'thread-b'}},evidence:['original setup sources']},restart,disturbances:{'controller-restart':d}};
}
test('restart proof binds original setup, world/Soul/journal and actual same-thread versus fresh-thread recovery',()=>{
 const e=restartEvidence(),run=e=>disturbanceScore(e.scenarioId,'controller-restart',e);assert.equal(run(e).status,'pass');
 assert.match(resultRow(score(e),'whole-controller-recovery').detail,/resumed host thread/);
 const fresh=structuredClone(e);fresh.restart.threadAfter='new-thread';fresh.restart.threadResumed=false;assert.equal(run(fresh).status,'pass');assert.match(resultRow(score(fresh),'whole-controller-recovery').detail,/fresh host thread/);
 for(const key of ['worldId','soulId','journalAfter','setupId']){const wrong=structuredClone(e);wrong.restart[key]='different';assert.equal(run(wrong).status,'fail');}
 const falseResume=structuredClone(e);falseResume.restart.threadResumed=false;assert.equal(run(falseResume).status,'fail');
 const missing=structuredClone(e);delete missing.setup;assert.equal(run(missing).status,'unknown');
 const tooLate=structuredClone(e);tooLate.disturbances['controller-restart'].triggerProof.wakeAt=20000;assert.equal(run(tooLate).status,'fail');
});
test('field return binding is source-frozen exact open ground, never a convenient ancestor',()=>{
 const scenario=frozenFixtures.scenarios.find(s=>s.id==='mars-presentation-four');
 const run=(binding=fieldBinding(),worldId='world-test')=>fieldReturnLocation({scenario,evidence:{worldId,fieldReturnBinding:binding},t0:0});
 assert.equal(run().status,'pass');
 const reversed=fieldBinding();reversed.polygon.reverse();assert.equal(run(reversed).status,'pass');
 for(const key of ['evidence','worldId','boundAt','level','places','navigation']){const x=fieldBinding();delete x[key];assert.equal(run(x).status,'unknown',key);}
 for(const mutate of [b=>b.worldId='other',b=>b.boundAt=1,b=>b.level=1,b=>b.polygon[0][0]=-31,b=>b.places[0].ref='chiba',b=>b.places[0].kind='building',b=>b.places[0].enclosed=true,b=>b.places[0].level=1,b=>b.navigation[0].targetPlaceId='mimos',b=>b.navigation[0].capability='stroll:field']){const x=fieldBinding();mutate(x);assert.equal(run(x).status,'fail');}
 assert.equal(fieldReturnLocation({scenario,evidence:{fieldReturnBinding:fieldBinding()},t0:0}).status,'unknown');
 const incomplete=fieldBinding();delete incomplete.places[0].placeId;assert.equal(run(incomplete).status,'unknown');
 const x=fieldBinding();x.places[0].polygon[0][0]=-29;assert.equal(run(x).status,'fail');
});
test('native field edge return requires completed exact walk, current most-specific field and physical level',()=>{
 const id='presenter:original errand return',make=()=>{const e=presentationEvidence();e.participants.presenter.samples.forEach(s=>{if(s.t>=550000){s.pos={x:-29.6,z:15.3,src:'here'};s.place='field';delete s.level;}});return e;};
 assert.equal(resultRow(score(make()),id).status,'pass','source-frozen native membership proves the level when here omits its numeric level');
 for(const change of [{place:'chiba'},{place:'mimos'},{level:1},{pos:{x:-30.1,z:15.3,src:'here'}}]){const e=make();e.participants.presenter.samples.forEach(s=>{if(s.t>=550000)Object.assign(s,change);});assert.equal(resultRow(score(e),id).status,'fail');}
 for(const change of [{place:undefined},{placeProvenance:'unknown'}]){const e=make();e.participants.presenter.samples.forEach(s=>{if(s.t>=550000)Object.assign(s,change);});assert.equal(resultRow(score(e),id).status,'unknown');}
 for(const change of [{phase:'started'},{capability:'walk:mimos'},{chosen:{target:'mimos',place:'field'}}]){const e=make();Object.assign(e.participants.presenter.receipts[1],change);assert.equal(resultRow(score(e),id).status,'fail');}
 for(const change of [{endedAtUtc:undefined},{chosen:undefined},{acceptedAtUtc:undefined}]){const e=make();Object.assign(e.participants.presenter.receipts[1],change);assert.equal(resultRow(score(e),id).status,'unknown');}
 const unbound=make();delete unbound.fieldReturnBinding;assert.equal(resultRow(score(unbound),id).status,'unknown');
 const left=make();left.participants.presenter.samples.find(s=>s.t===551000).place='mimos';assert.equal(resultRow(score(left),'presenter:errand-read').status,'unknown','polygon ancestry cannot substitute for current field membership during inspection');
});
test('field errand report needs an exact reviewed inspection to native public effect link',()=>{
 const id='presenter:errand-report',make=()=>{const e=presentationEvidence();e.effects.push({id:'field-report',actor:'presenter',type:'speech',at:551500,evidence:['native-public.json#/field-report']});e.errandReports=[{actor:'presenter',readSource:'agent here after return',effectId:'field-report',grounded:true,evidence:['review.json#/field-report-grounding']}];return e;};
 assert.equal(resultRow(score(make()),id).status,'pass');
 for(const mutate of [e=>delete e.errandReports,e=>delete e.effects.at(-1).at,e=>e.errandReports[0].readSource='unrelated read',e=>e.errandReports[0].evidence=[]]){const e=make();mutate(e);assert.equal(resultRow(score(e),id).status,'unknown');}
 for(const mutate of [e=>e.effects.at(-1).actor='attendee-1',e=>e.effects.at(-1).at=550999,e=>e.errandReports[0].grounded=false,e=>e.effects.at(-1).type='narration']){const e=make();mutate(e);assert.equal(resultRow(score(e),id).status,'fail');}
});
test('initial Mars task facts expose genuine participation constraints without assigning a speaking order',()=>{
 const s=frozenFixtures.scenarios.find(s=>s.id==='mars-presentation-four');
 assert.equal(s.initialTaskFacts.invitedGuestCount,3);assert.equal(s.initialTaskFacts.minimumSharedRealSeconds,30);assert.equal(s.initialTaskFacts.distinctGuestQuestioners,2);assert.equal(s.initialTaskFacts.fixtureOccupantCountsAsGuest,false);
 for(const phrase of ['three invited guests','One guest may arrive late','at least 30 real seconds','two different guests','no assigned speaking order'])assert.ok(s.initialConstraintSupplement.includes(phrase),phrase);
});

function compoundReceipt({id='club',seat='e_chair#seat',at=0}={}){
 const capability='book-club:book-club.chair';
 return {id,worldId:'world-test',soulId:'soul-test',programId:'p1',capability,acceptedAtUtc:0,endedAtUtc:35000,phase:'completed',nativeReadLifecycles:[{schema:'native-read-lifecycle/1',evidence:['native-capture.jsonl#L2'],receiptEvidence:['native-snapshots.jsonl#L1'],event:{id:'c_2',kind:'activity.observed',tick:10,at,observedAt:at,worldId:'world-test',soulId:'soul-test',bodyId:'body-test',observation:'native-current-body',untrusted:false,receipt:{id,capability,phase:'started'},programId:'p1',action:{id:'a1',verb:'pose_v1',status:'executing'},body:{activity:'read',posture:'seated',occupiedSeats:[seat]}}}]};
}
test('source-backed compound lifecycle supports only its actual exact-slot read hold without aliasing the native capability',()=>{
 const r=compoundReceipt(),run=(changes={})=>observedHolds({samples,receipts:[r],bindings,phase,from:0,to:35000,coverageComplete:true,...changes});
 assert.equal(run().status,'pass');assert.equal(run().windows[0].receiptId,'club');assert.equal(r.capability,'book-club:book-club.chair');
 assert.equal(run({coverageComplete:false}).status,'unknown');assert.equal(run({from:-Infinity}).status,'unknown');
 for(const mutate of [p=>p.evidence=[],p=>p.receiptEvidence=[],p=>p.event.receipt.id='other',p=>p.event.receipt.capability='read:chair',p=>p.event.programId='other',p=>p.event.body.activity='sit',p=>p.event.body.occupiedSeats=['other#seat'],p=>p.event.body.occupiedSeats=['e_chair'],p=>p.event.soulId='other',p=>p.event.worldId='other',p=>p.event.untrusted=true,p=>p.event.action.verb='say']){
  const wrong=structuredClone(r);mutate(wrong.nativeReadLifecycles[0]);assert.equal(run({receipts:[wrong]}).status,'fail');
 }
 assert.equal(run({receipts:[{...r,nativeReadLifecycles:[]}],bindings:{chair:{...bindings.chair,capabilities:{read:[r.capability]}}}}).status,'fail','a caller capability alias alone cannot convert book-club to read');
 assert.equal(run({receipts:[compoundReceipt({at:1000})]}).status,'fail','a transition after the first sample cannot backdate a 30-second hold');
 assert.equal(run({receipts:[r,{id:'later',capability:'walk:field',acceptedAtUtc:15000,phase:'started'}]}).status,'fail');
 assert.equal(run({receipts:[r,{id:'same',capability:'walk:field',acceptedAtUtc:0,phase:'started'}]}).status,'unknown');
 assert.equal(run({receipts:[{...r,endedAtUtc:20000}]}).status,'fail');
 assert.equal(run({samples:samples.filter((s,i)=>i<14||i>17)}).status,'unknown','unchanged two-second maximum gap still applies');
 assert.equal(run({samples:samples.map((s,i)=>i===15?{...s,activity:'sit'}:s)}).status,'fail');
 const two={...bindings,other:{entityId:'e_other',slot:'seat'}},twoPhase={...phase,requireSeatRefs:['chair','other'],receipt:{verb:'read',targetRefs:['chair','other']}};
 assert.equal(run({bindings:two,phase:twoPhase,samples:samples.map(s=>({...s,seat:'e_other#seat'}))}).status,'fail','another permitted seat does not match this native lifecycle');
});
test('compound native reading retains simultaneous distinct-seat overlap requirement and explicit matcher version',()=>{
 const e=readingEvidence({a:[250,285],b:[251,286]});
 for(const [i,actor]of ['reader-a','reader-b'].entries()){
  const ev=e.participants[actor],old=ev.receipts[1],r=compoundReceipt({id:old.id,seat:'chair-'+(i+1)+'#seat',at:old.acceptedAtUtc});
  ev.receipts=ev.receipts.filter(r=>!r.id.endsWith('-return'));ev.receipts[1]={...r,acceptedAtUtc:old.acceptedAtUtc,endedAtUtc:old.endedAtUtc};
 }
 const result=score(e);assert.equal(result.readingMatchVersion,'native-reading-lifecycle/2');assert.equal(resultRow(result,'simultaneous-distinct-seat-reading').status,'pass');
 e.participants['reader-b'].receipts[1].nativeReadLifecycles[0].event.at=260000;e.participants['reader-b'].receipts[1].nativeReadLifecycles[0].event.observedAt=260000;
 assert.equal(resultRow(score(e),'simultaneous-distinct-seat-reading').status,'fail','late actual read transition cannot manufacture thirty seconds overlap');
});

test('#479: the bandstand walk ends outside every exclusion zone',()=>{
 // Measured: a Soul's native walk:eden-bandstand on eden-2026 ends at this position. A geometry fact about the world, not a target.
 const walkEnd=[38.4,-26.3],scenario=frozenFixtures.scenarios.find(s=>s.id==='eden-bandstand-five'),{audienceRegion}=scenario.venue;
 assert.equal(scenario.fixtureVersion,2);assert.match(scenario.fixtureVersionNote,/#479/);
 assert.equal(insidePolygon(walkEnd,audienceRegion.excludePolygon),false);
 assert.equal(insidePolygon([37.6,-25.4],audienceRegion.excludePolygon),true,'the instrument\'s own region stays excluded');
});

