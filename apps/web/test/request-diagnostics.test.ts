import {test} from 'node:test';
import assert from 'node:assert/strict';
import {intentRequestV2Schema} from '@souls/protocol';
import {intentLookupResponse,intentResponse} from '../src/intent-response.ts';
import {OWN_REQUEST_DIAGNOSTICS,ownRequestDiagnostics,ownRequestDiagnosticsPath,requestCause,requestDiagnostics,requestNeedsDiagnostics} from '../src/request-diagnostics.ts';
// Exact saved Alice receipts (team/pm-integration/p0-interaction-broadcast-20261006/EXACT-SAVED-REQUESTS.json).
const source={channel:'web',kind:'owner',ownerId:'dev:admin',principalId:'dev:admin'};
const aliceScope={entityId:'h_4158faee14',soulId:'s_4158faee14',source,worldId:'pm-preview-eden-20261005'};
const classroom={code:'state-blocked.program.safe-stop-required',contract:'soul-intent/2',outcome:{code:'program.safe-stop-required',explanation:'That goal is supported, but its current physical binding is unavailable.',goal:{bindingId:'walk:eden-classroom-1',goal:'walk'},kind:'state_blocked'},phase:'refused',reason:'That goal is supported, but its current physical binding is unavailable.',requestId:'7d411406-a83c-4a69-a0f9-0baf94082190',scope:aliceScope};
const swim={code:'compilation-failure.schema',contract:'soul-intent/2',outcome:{code:'schema',explanation:'The language service returned an invalid goal plan.',kind:'compilation_failure'},phase:'refused',reason:'The language service returned an invalid goal plan.',requestId:'58b0106a-55df-400f-9e0c-330eb81ec1b1',scope:aliceScope};
const classroomRequest=intentRequestV2Schema.parse({contract:'soul-intent/2',importance:0.5,op:'upsert',requestId:classroom.requestId,strict:false,words:'go to the classroom'});
const swimRequest=intentRequestV2Schema.parse({contract:'soul-intent/2',importance:0.5,op:'upsert',requestId:swim.requestId,strict:false,words:'go for a swim in the pond'});
const scope=(requestId:string)=>({worldId:aliceScope.worldId,soulId:aliceScope.soulId,ownerId:'dev:admin',entityId:aliceScope.entityId,requestId});
const context={worldId:aliceScope.worldId,soulId:aliceScope.soulId,entityId:aliceScope.entityId,backendBuild:'local-classroom-readiness-mvp-20261006',sentAt:'2026-10-06T19:17:01.383Z',observedAt:'2026-10-06T19:17:01.600Z',responseStatus:200,body:{activity:'sleeping',tick:1953448}};
const dto=(over:Record<string,unknown>={})=>({contract:OWN_REQUEST_DIAGNOSTICS,requestId:classroom.requestId,worldId:aliceScope.worldId,soulId:aliceScope.soulId,entityId:aliceScope.entityId,source,
 server:{createdAt:1791314221383,updatedAt:1791314221547,build:'local-classroom-readiness-mvp-20261006'},stage:'refused',code:'state-blocked.program.safe-stop-required',
 resolution:{goal:'walk',bindingId:'walk:eden-classroom-1',destination:'Eden classroom',available:false,failedCondition:'program.safe-stop-required',conditionExplanation:'Current sleep programme has no safe stop yet.'},
 body:{tick:1953448,activity:'sleeping',controller:'native-sleep',programme:'sleep-night',sleep:'asleep',busy:true,busyReason:'Sleeping through the night programme.',queue:{position:0,length:0}},
 attempts:[],unavailable:[{field:'completed',reason:'No attempt was admitted for this refused request.'}],...over});

test('exact Alice classroom refusal: precise readable cause first, not the misleading generic explanation',()=>{
 const result=intentLookupResponse(200,classroom,scope(classroom.requestId));assert.equal(result.kind,'recorded');assert.ok(requestNeedsDiagnostics(result));
 const cause=requestCause(result,'Alice');
 assert.equal(cause.headline,'Alice cannot go to eden classroom 1 right now');
 assert.match(cause.cause,/cannot be stopped safely/);assert.match(cause.next!,/will not be retried automatically/);
 assert.equal(cause.code,'state-blocked.program.safe-stop-required');
});
test('exact Alice classroom diagnostics: own words/ref/code/binding; missing server fields explicitly unavailable',()=>{
 const result=intentResponse(200,classroom,{...scope(classroom.requestId),request:classroomRequest});assert.equal(result.kind,'recorded');
 const text=requestDiagnostics(classroomRequest,result,context,undefined,{kind:'unavailable',reason:'Not provided by this server (HTTP 404).'}),d=JSON.parse(text);
 assert.equal(d.request.words,'go to the classroom');assert.equal(d.request.reference,classroom.requestId);
 assert.equal(d.response.code,'state-blocked.program.safe-stop-required');assert.equal(d.response.failedCondition,'program.safe-stop-required');
 assert.equal(d.interpretation.binding,'walk:eden-classroom-1');assert.equal(d.versions.backendObservedFromWelcome,'local-classroom-readiness-mvp-20261006');
 for(const k of ['controller','programme','sleepState','busyCondition','queue','admitted','started','completed'])assert.match(d.physical[k],/^Unavailable — server diagnostics: Not provided by this server \(HTTP 404\)\.$/,k);
 assert.match(d.timestamps.serverCreated,/^Unavailable/);assert.equal(d.serverDiagnostics,'Not provided by this server (HTTP 404).');
});
test('exact Alice swim compilation failure: specific schema cause; producer free text not echoed',()=>{
 const result=intentResponse(200,swim,{...scope(swim.requestId),request:swimRequest});assert.equal(result.kind,'recorded');
 const cause=requestCause(result,'Alice');assert.equal(cause.headline,'Could not prepare this direction');assert.match(cause.cause,/format the world does not accept/);assert.match(cause.cause,/not a problem with your words/);
 const text=requestDiagnostics(swimRequest,result,context);assert.doesNotMatch(text,/invalid goal plan/);
 const d=JSON.parse(text);assert.equal(d.request.words,'go for a swim in the pond');assert.equal(d.response.failedCondition,'schema');assert.equal(d.response.typedOutcome,'compilation_failure');
});
test('G414 strict DTO: validated own fields fill controller/programme/sleep/busy/queue/timestamps/attempts',()=>{
 const server=ownRequestDiagnostics(200,dto({attempts:[{attemptId:'att-1',phase:'blocked',seq:16756,tick:1953449,reason:'safe stop pending'}]}),scope(classroom.requestId));assert.equal(server.kind,'available');
 const result=intentLookupResponse(200,classroom,scope(classroom.requestId));
 const d=JSON.parse(requestDiagnostics(null,result,context,classroom.requestId,server));
 assert.equal(d.physical.controller,'native-sleep');assert.equal(d.physical.programme,'sleep-night');assert.equal(d.physical.sleepState,'asleep');
 assert.equal(d.physical.busyCondition,'Sleeping through the night programme.');assert.deepEqual(d.physical.queue,{position:0,length:0});
 assert.deepEqual(d.physical.blocked,[{attempt:'att-1',seq:16756,tick:1953449,reason:'safe stop pending'}]);
 assert.equal(d.physical.completed,'No attempt was admitted for this refused request.');
 assert.equal(d.timestamps.serverCreated,new Date(1791314221383).toISOString());assert.equal(d.interpretation.resolvedDestination,'Eden classroom');
 assert.equal(d.versions.backendFromDiagnostics,'local-classroom-readiness-mvp-20261006');assert.equal(d.request.reference,classroom.requestId);
});
test('G414 refusal: unknown keys, wrong types, foreign scope or oversize never reach the text',()=>{
 const canary='CANARY_RAW_9f3';
 const bad=[dto({extra:canary}),dto({body:{tick:1,controller:'ok',hidden:canary}}),dto({resolution:{reasoning:canary}}),dto({soulId:'s_other'}),dto({requestId:'other'}),dto({entityId:'h_other'}),
  dto({source:{...source,ownerId:'dev:bob'}}),dto({source:{...source,principalId:'dev:bob'}}),dto({source:{...source,kind:'agent'}}),dto({explanation:'x'.repeat(501)}),dto({stage:'running'}),
  dto({attempts:Array.from({length:21},(_,i)=>({attemptId:'a'+i,phase:'started',seq:i,tick:i}))}),dto({server:{createdAt:-1,updatedAt:1}}),dto({code:canary+' with spaces'}),{...dto(),contract:'own-request-diagnostics/2'}];
 for(const body of bad){const s=ownRequestDiagnostics(200,body,scope(classroom.requestId));assert.equal(s.kind,'unavailable',JSON.stringify(body).slice(0,120));
  const text=requestDiagnostics(null,intentLookupResponse(200,classroom,scope(classroom.requestId)),context,classroom.requestId,s);assert.doesNotMatch(text,/CANARY_RAW|s_other|h_other|dev:bob/);}
});
test('G414 absent on this backend: 404, HTML fallback, auth and network reads are explicit unavailable',()=>{
 const s=scope(classroom.requestId);
 assert.deepEqual(ownRequestDiagnostics(404,{message:'not found'},s),{kind:'unavailable',reason:'Not provided by this server (HTTP 404).'});
 assert.match((ownRequestDiagnostics(200,'<!doctype html><title>Sim</title>',s) as {reason:string}).reason,/no own-request-diagnostics\/1 response/);
 assert.match((ownRequestDiagnostics(403,{},s) as {reason:string}).reason,/cannot read diagnostics/);
 assert.match((ownRequestDiagnostics(0,null,s) as {reason:string}).reason,/did not complete/);
 assert.equal(ownRequestDiagnosticsPath('s_4158faee14','7d411406-a83c-4a69-a0f9-0baf94082190'),'/v1/souls/s_4158faee14/intent-v2/requests/7d411406-a83c-4a69-a0f9-0baf94082190/diagnostics');
});
test('unconfirmed or foreign receipt suppresses raw payload; credentials in own words are redacted',()=>{
 const foreign={...classroom,scope:{...aliceScope,source:{...source,ownerId:'dev:bob',principalId:'dev:bob'}},reason:'CANARY_FOREIGN'};
 const result=intentLookupResponse(200,foreign,scope(classroom.requestId));assert.equal(result.kind,'unconfirmed');
 const text=requestDiagnostics(null,result,context,classroom.requestId);assert.doesNotMatch(text,/CANARY_FOREIGN|dev:bob/);assert.match(text,/Raw response suppressed/);
 const words=intentRequestV2Schema.parse({contract:'soul-intent/2',requestId:'r1',op:'upsert',words:'go swim, Bearer abc.def-123 and api_key=sk_live_abcdefghijkl'});
 const own=requestDiagnostics(words,{kind:'unconfirmed',title:'t',detail:'d'},context);
 assert.doesNotMatch(own,/abc\.def-123|sk_live_abcdefghijkl/);assert.match(own,/Bearer \[redacted\]/);
});
test('unknown blocked code stays specific, with the actual code instead of a generic message',()=>{
 const r=intentLookupResponse(200,{...classroom,code:'state-blocked.door.locked',outcome:{...classroom.outcome,code:'door.locked',explanation:'The classroom door is locked.'}},scope(classroom.requestId));
 const c=requestCause(r,'Alice');assert.equal(c.cause,'The classroom door is locked. Blocked condition: door.locked.');
});
test('busy lecture-prep starting state (actor.busy) gets a readable cause and next step',()=>{
 const r=intentLookupResponse(200,{...classroom,code:'state-blocked.actor.busy',outcome:{...classroom.outcome,code:'actor.busy',explanation:'That goal is supported, but its current physical binding is unavailable.'}},scope(classroom.requestId));
 const c=requestCause(r,'Alice');assert.match(c.cause,/busy with another activity/);assert.match(c.next!,/will not be retried automatically/);
});
import {readFileSync} from 'node:fs';
import {ownWords,requestPhase} from '../src/request-diagnostics.ts';
const live=JSON.parse(readFileSync(new URL('./fixtures/g414-live-4970-phases.json',import.meta.url),'utf8'));
const liveScope=(d:any)=>({worldId:d.worldId,soulId:d.soulId,ownerId:d.source.ownerId,entityId:d.entityId,requestId:d.requestId});
const ok=(d:any)=>{const s=ownRequestDiagnostics(200,d,liveScope(d));assert.equal(s.kind,'available');return (s as any).dto;};
test('PM-R041 live 84f87524: native completion shows Completed, not "not confirmed"',()=>{
 const p=requestPhase(ok(live.completed));assert.equal(p.kind,'completed');assert.equal(p.title,'Completed');assert.equal(p.detail,'Done: Eden east classroom.');assert.ok(p.terminal);assert.equal(p.earlier,undefined);
});
test('PM-R041 live 12a2dad7: earlier replaced attempt is reported alongside latest completion',()=>{
 const p=requestPhase(ok(live.interruptedThenCompleted));assert.equal(p.kind,'completed');assert.match(p.earlier!,/newer direction replaced it/);
 const cut={...live.interruptedThenCompleted,attempts:live.interruptedThenCompleted.attempts.slice(0,3)};
 const q=requestPhase(ok(cut));assert.equal(q.kind,'interrupted');assert.equal(q.detail,'A newer direction replaced it before it finished.');assert.ok(q.terminal);
});
test('quiet hours: no attempt yet shows Waiting with the reason (condition or busy body)',()=>{
 const base={...live.completed,attempts:[],unavailable:[]};
 const a=requestPhase(ok({...base,resolution:{...base.resolution,failedCondition:'quiet-renewal'}}));assert.equal(a.kind,'waiting');assert.match(a.detail,/quiet hours/);
 const b=requestPhase(ok({...base,resolution:{...base.resolution,failedCondition:'quiet-renewal',conditionExplanation:'Oda is resting while Eden quietly renews before first light; this starts as soon as renewal finishes.'}}));assert.match(b.detail,/^Oda is resting/);
 const c=requestPhase(ok(base));assert.equal(c.kind,'waiting');assert.match(c.detail,/quietly renewing before first light/);
 const d=requestPhase(ok({...base,body:{tick:1,sleep:'awake',busy:false}}));assert.equal(d.kind,'not-started');
 const e=requestPhase(ok({...base,attempts:[{attemptId:'a1',phase:'accepted',seq:1,tick:1},{attemptId:'a1',phase:'started',seq:2,tick:2}]}));assert.equal(e.kind,'started');assert.equal(e.terminal,false);
});
test('own words: local request, understood receipt, or validated DTO words (refused lookup)',()=>{
 const d=ok({...live.completed,words:'go to the classroom'});assert.equal(d.words,'go to the classroom');
 assert.equal(ownWords(null,{kind:'unconfirmed',title:'t',detail:'d'},{kind:'available',dto:d}),'go to the classroom');
 assert.equal(ownRequestDiagnostics(200,{...live.completed,words:'x'.repeat(2001)},liveScope(live.completed)).kind,'unavailable');
 const refusedText=JSON.parse(requestDiagnostics(null,intentLookupResponse(200,classroom,scope(classroom.requestId)),context,classroom.requestId,{kind:'available',dto:{...dto(),words:'go to the classroom'} as any}));
 assert.equal(refusedText.request.words,'go to the classroom');
});
