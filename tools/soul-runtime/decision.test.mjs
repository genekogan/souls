import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openJournal} from './journal.mjs';
import {DECISION_SCHEMA,parseDecision,retainDecision,applyPendingDecision,decisionProgress,saveRecoveryCheckpoint,RECOVERY_METADATA_BYTES} from './decision.mjs';
import {boundedFacts} from './context.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'souls-decision-'));const j=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>{j.close();rmSync(dir,{recursive:true,force:true})});return {j,dir,fence:j.control.claim('test')};}
const decision=()=>parseDecision(JSON.stringify({plan:'Go read, then return. Still pending.',call:{type:'write',command:'act',arguments:'{"capability":"read:here"}'},wakeAt:null}));
test('urgent fallback budget survives uncertain effects and clears only with committed finalization',async t=>{
 const {j,fence}=fixture(t),marker={id:'episode-1',triggerAt:1000,reason:'owner',turnId:'old-turn',fallbackUsed:true,worldReplans:2};
 j.control.save(fence,0,{initialInstruction:'Original goal',urgentRecoveryV1:marker});const id=retainDecision(j,fence,decision());let writes=0;
 await assert.rejects(applyPendingDecision(j,fence,{write:async()=>{writes++;throw Error('uncertain response');}}),{code:'OPERATION_UNCERTAIN'});
 assert.deepEqual(j.control.checkpoint().value.urgentRecoveryV1,marker);assert.equal(j.control.operation(id).status,'uncertain');
 const save=j.control.save;j.control.save=(...args)=>{if(args[2].pendingDecision===null)throw Error('simulated final checkpoint failure');return save(...args);};
 await assert.rejects(applyPendingDecision(j,fence,{reconcile:async()=>({state:'recorded',status:200,response:{accepted:true,receipt:{id:'native-existing'}}})}),/final checkpoint failure/);
 assert.deepEqual(j.control.checkpoint().value.urgentRecoveryV1,marker);assert.equal(j.control.operation(id).status,'settled');
 j.control.save=save;await applyPendingDecision(j,fence,{write:async()=>{writes++;throw Error('duplicate effect');}});
 assert.equal(writes,1);assert.equal(j.control.checkpoint().value.urgentRecoveryV1,undefined);assert.equal(j.control.checkpoint().value.pendingDecision,null);
});
test('retained urgent fallback budget survives journal reopen until an actual local decision applies',async t=>{
 const {j,dir,fence}=fixture(t),marker={id:'retained-episode',triggerAt:1000,reason:'deadline',turnId:'old-turn',fallbackUsed:true,worldReplans:1};j.control.save(fence,0,{urgentRecoveryV1:marker});
 retainDecision(j,fence,parseDecision(JSON.stringify({plan:'Continue original work',call:{type:'wait',command:'wait',arguments:'{}'},wakeAt:null})));j.control.release(fence);
 const recovered=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>recovered.close());const next=recovered.control.claim('next');assert.deepEqual(recovered.control.checkpoint().value.urgentRecoveryV1,marker);
 await applyPendingDecision(recovered,next,{});assert.equal(recovered.control.checkpoint().value.urgentRecoveryV1,undefined);
});
test('retained decision survives before execution and replay of settled result does not repeat effect',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Read then return'}]});const events=j.pending();const id=retainDecision(j,fence,decision(),{events,initialInstruction:'Read then return'});
 j.control.prepare(fence,id,decision().call);j.control.dispatch(fence,id);j.control.settle(fence,id,{accepted:true,receipt:{id:'r_1',phase:'started'}});
 let calls=0;const r=await applyPendingDecision(j,fence,{write:async()=>{calls++;throw Error('duplicate')}});assert.equal(calls,0);assert.equal(r.response.receipt.id,'r_1');assert.equal(j.pending().length,0);assert.equal(j.control.checkpoint().value.pendingDecision,null);assert.match(j.control.checkpoint().value.plan,/Still pending/);
});
test('lost write response leaves original task and operation pending rather than retrying',async t=>{
 const {j,fence}=fixture(t);retainDecision(j,fence,decision());let calls=0;const world={write:async()=>{calls++;throw Error('response dropped')}};
 await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});assert.equal(calls,1);assert.equal(j.control.operations()[0].status,'uncertain');assert.ok(j.control.checkpoint().value.pendingDecision);
});
test('crash after event handling but before final checkpoint can finish idempotently',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'world',after:null,cursor:'c_1',events:[{id:'c_1'}]});const d={plan:'Wait for appointment',call:{type:'wait',command:'',args:{}},wakeAt:'2026-10-30T10:00:00Z'};const id=retainDecision(j,fence,d,{events:j.pending()});j.handled('world','c_1','incorporated:'+id);
 await applyPendingDecision(j,fence,{});assert.equal(j.control.checkpoint().value.wakeAt,d.wakeAt);assert.equal(j.pending().length,0);
});
test('decision rejects arbitrary commands and timezone-free deadlines',()=>{
 assert.throws(()=>parseDecision(JSON.stringify({plan:'',call:{type:'write',command:'shell',arguments:'{}'},wakeAt:null})),/Unsupported/);
 assert.throws(()=>parseDecision(JSON.stringify({plan:'',call:{type:'wait',command:'',arguments:'{}'},wakeAt:'2026-10-30T10:00:00'})),/timezone/);
});
test('decision text budgets count encoded Unicode and escapes before durable retention',()=>{
 const payload={plan:'界'.repeat(5332),call:{type:'wait',command:'wait',arguments:'{}'},wakeAt:null};
 assert.equal(parseDecision(JSON.stringify(payload)).plan,payload.plan);
 assert.throws(()=>parseDecision(JSON.stringify({...payload,plan:'界'.repeat(5333)})),/durable plan.*JSON-encoded/);
 assert.throws(()=>parseDecision(JSON.stringify({...payload,plan:'\n'.repeat(8000)})),/durable plan.*JSON-encoded/);
 const allowed=JSON.stringify({text:'界'.repeat(5300)}),oversized=JSON.stringify({text:'界'.repeat(5333)});
 assert.equal(parseDecision(JSON.stringify({...payload,call:{...payload.call,arguments:allowed}})).call.args.text,'界'.repeat(5300));
 assert.throws(()=>parseDecision(JSON.stringify({...payload,call:{...payload.call,arguments:oversized}})),/call arguments.*JSON-encoded/);
});
test('explicit refusal is observed and recoverable without replaying the operation',async t=>{
 const {j,fence}=fixture(t);retainDecision(j,fence,decision());let calls=0;
 const r=await applyPendingDecision(j,fence,{write:async()=>{calls++;throw Object.assign(Error('Seat occupied'),{code:'seat.occupied',status:409,uncertain:false});}});
 assert.equal(r.response.accepted,false);assert.equal(r.response.error.code,'seat.occupied');assert.equal(j.control.operations().length,0);assert.equal(j.control.checkpoint().value.pendingDecision,null);assert.equal(calls,1);
});
test('restart recovers a lost response from authoritative lookup without a second write',async t=>{
 const {j,fence}=fixture(t);const id=retainDecision(j,fence,decision());let calls=0;
 const world={write:async()=>{calls++;throw Error('response dropped')},reconcile:async(call,key)=>{assert.equal(key,id);return {state:'recorded',status:200,response:{accepted:true,receipt:{id:'r_recovered',phase:'completed'}}}}};
 await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});
 const result=await applyPendingDecision(j,fence,world);assert.equal(result.response.receipt.id,'r_recovered');assert.equal(calls,1);assert.equal(j.control.operations().length,0);
});
test('unknown lookup does not cause a retry or erase pending intent',async t=>{
 const {j,fence}=fixture(t);retainDecision(j,fence,decision());const world={write:async()=>{throw Error('lost')},reconcile:async()=>({state:'unknown'})};
 await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});assert.ok(j.control.checkpoint().value.pendingDecision);
});
test('retention gap prevents writes until explicit resync, without claiming lost history was recovered',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'world',after:null,cursor:'c_50',events:[],gap:true});let writes=0;
 const world={write:async()=>{writes++;return {}},read:async command=>{assert.equal(command,'resync');return {historyIncomplete:true,observation:{place:'library'},conversations:[]};}};
 retainDecision(j,fence,decision());const blocked=await applyPendingDecision(j,fence,world);assert.equal(blocked.response.error.code,'continuity.resync-required');assert.equal(writes,0);assert.equal(j.gaps().length,1);
 retainDecision(j,fence,{plan:'Reobserve; past speech may be missing',call:{type:'read',command:'resync',args:{}},wakeAt:null});const fresh=await applyPendingDecision(j,fence,world);assert.equal(fresh.response.historyIncomplete,true);assert.equal(j.gaps().length,0);
});
test('a new event gap cannot erase an already-dispatched operation awaiting reconciliation',async t=>{
 const {j,fence}=fixture(t);const id=retainDecision(j,fence,decision());j.control.prepare(fence,id,decision().call);j.control.dispatch(fence,id);
 j.ingest({source:'world',after:null,cursor:'c_50',events:[],gap:true});
 const result=await applyPendingDecision(j,fence,{reconcile:async()=>({state:'recorded',status:200,response:{accepted:true,receipt:{id:'r1'}}})});assert.equal(result.response.receipt.id,'r1');assert.equal(j.gaps().length,1);assert.equal(j.control.operations().length,0);
});
test('relative activity waits calculate a durable UTC deadline and preserve an earlier appointment',()=>{
 const now=()=>Date.parse('2026-10-29T20:00:00Z');const payload={plan:'Read briefly',call:{type:'wait',command:'wait',arguments:'{"seconds":30}'},wakeAt:null};
 assert.equal(parseDecision(JSON.stringify(payload),{now}).wakeAt,'2026-10-29T20:00:30.000Z');
 assert.equal(parseDecision(JSON.stringify({...payload,wakeAt:'2026-10-29T16:00:10-04:00'}),{now}).wakeAt,'2026-10-29T20:00:10.000Z');
 assert.throws(()=>parseDecision(JSON.stringify({...payload,call:{...payload.call,arguments:'{"seconds":-1}'}})),/Relative wait/);
});
test('conversation and reobservation retain a future activity wake across checkpoint recovery',async t=>{
 const {j,fence}=fixture(t),wakeAt=new Date(Date.now()+60000).toISOString();
 retainDecision(j,fence,{plan:'Read then leave',call:{type:'wait',command:'wait',args:{}},wakeAt});await applyPendingDecision(j,fence,{});
 retainDecision(j,fence,{plan:'Reply briefly then resume reading',call:{type:'write',command:'say',args:{text:'Hello'}},wakeAt:null});
 await applyPendingDecision(j,fence,{write:async()=>({said:{id:'s1'}})});assert.equal(j.control.checkpoint().value.wakeAt,wakeAt);
 retainDecision(j,fence,{plan:'Reobserve after greeting',call:{type:'read',command:'here',args:{}},wakeAt:null});
 await applyPendingDecision(j,fence,{read:async()=>({activity:'read'})});assert.equal(j.control.checkpoint().value.wakeAt,wakeAt);
 retainDecision(j,fence,{plan:'Owner cancelled the errand',call:{type:'wait',command:'wait',args:{cancelWake:true}},wakeAt:null});
 await applyPendingDecision(j,fence,{});assert.equal(j.control.checkpoint().value.wakeAt,null);
});
test('a due wake survives an earlier retained decision but is consumed by a later decision',async t=>{
 const {j,fence}=fixture(t),wakeAt=new Date(Date.now()-1000).toISOString();
 j.control.save(fence,0,{wakeAt});retainDecision(j,fence,{plan:'Handle due appointment',call:{type:'wait',command:'wait',args:{}},wakeAt:null});
 const c=j.control.checkpoint();j.control.save(fence,c.revision,{...c.value,pendingDecision:{...c.value.pendingDecision,retainedAt:Date.now()-2000}});
 await applyPendingDecision(j,fence,{});assert.equal(j.control.checkpoint().value.wakeAt,wakeAt);
 retainDecision(j,fence,{plan:'Due wake handled',call:{type:'wait',command:'wait',args:{}},wakeAt:null});await applyPendingDecision(j,fence,{});assert.equal(j.control.checkpoint().value.wakeAt,null);
});
const report=(id='m1')=>({plan:'Report actual outcome',call:{type:'write',command:'result',args:{id,outcome:'failed',text:'Could not complete before the appointment ended'}},wakeAt:null});
const reportResponse=d=>({inbox:{latest:{id:d.call.args.id,state:'acknowledged',result:d.call.args.text,outcome:d.call.args.outcome,resultAt:123}}});
test('rejected owner result and later plan loss do not erase original task; exact native result closes it',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Read then return and report',sentAt:42}]});
 retainDecision(j,fence,report(),{events:j.pending()});await applyPendingDecision(j,fence,{write:async()=>{throw Object.assign(Error('result must be <=140 characters'),{status:400,uncertain:false});}});
 assert.equal(j.pending().length,0);assert.equal(j.openOwnerTasks().tasks[0].id,'m1');
 retainDecision(j,fence,{plan:'No task ID in my remembered plan',call:{type:'wait',command:'wait',args:{}},wakeAt:null});await applyPendingDecision(j,fence,{});
 assert.equal(j.openOwnerTasks().tasks[0].text,'Read then return and report');
 retainDecision(j,fence,report());await applyPendingDecision(j,fence,{write:async()=>reportResponse(report())});assert.equal(j.openOwnerTasks().totalOpen,0);
});
test('local owner task reads never reach the world and cannot close a task',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Private intent',sentAt:1}]});let network=0;
 const world={read:async()=>{network++;throw Error('must stay local')}};
 for(const [command,args] of [['tasks',{after:0,limit:20}],['task',{id:'m1',offset:0}]]){
  const parsed=parseDecision(JSON.stringify({plan:'Inspect local outstanding owner intent',call:{type:'read',command,arguments:JSON.stringify(args)},wakeAt:null}));retainDecision(j,fence,parsed);const applied=await applyPendingDecision(j,fence,world);assert.equal(command==='tasks'?applied.response.tasks[0].text:applied.response.task.text,'Private intent');
 }
 assert.equal(network,0);assert.equal(j.openOwnerTasks().totalOpen,1);
 for(const [command,args] of [['tasks',{limit:21}],['tasks',{after:-1}],['task',{id:'m1',offset:-1}],['task',{}],['tasks',{unexpected:'field'}]])assert.throws(()=>parseDecision(JSON.stringify({plan:'',call:{type:'read',command,arguments:JSON.stringify(args)},wakeAt:null})),/Local|local/);
});
test('a maximum local text chunk can be incorporated with full instruction and plan budgets across restart',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-decision-budget-'));let j=openJournal(dir,{worldId:'w',soulId:'s'});
 t.after(()=>{j.close();rmSync(dir,{recursive:true,force:true})});
 let fence=j.control.claim('test');const initialInstruction='i'.repeat(15998),plan='p'.repeat(15998);
 j.ingest({source:'owner',after:null,cursor:'large',events:[{id:'large',text:'x'.repeat(60000),sentAt:1}]});
 const read=parseDecision(JSON.stringify({plan,call:{type:'read',command:'task',arguments:'{"id":"large"}'},wakeAt:null}));
 retainDecision(j,fence,read,{events:j.pending(),initialInstruction});const observed=await applyPendingDecision(j,fence,{});
 assert.equal(Buffer.byteLength(JSON.stringify(observed.response)),32768);assert.equal(j.control.checkpoint().value.lastResult.responseOmitted,true);assert.equal(j.control.checkpoint().value.lastResult.responseRef.id,observed.id);assert.deepEqual(j.control.readResult(observed.id).response,observed.response);assert.equal(observed.response.task.nextOffset!==null,true);
 const report=parseDecision(JSON.stringify({plan,call:{type:'write',command:'result',arguments:'{"id":"large","outcome":"failed","text":"Owner cancelled this request"}'},wakeAt:null}));
 const id=retainDecision(j,fence,report);const retained=j.control.checkpoint().value;
 assert.equal(retained.lastResult,undefined);assert.equal(retained.plan,plan);assert.equal(retained.pendingDecision.decision.plan,undefined);
 j.control.prepare(fence,id,report.call);j.control.dispatch(fence,id);j.control.settle(fence,id,{inbox:{latest:{id:'large',state:'acknowledged',outcome:'failed',result:report.call.args.text,resultAt:123}}});
 j.control.release(fence);j.close();j=openJournal(dir,{worldId:'w',soulId:'s'});fence=j.control.claim('recovery');
 let writes=0;await applyPendingDecision(j,fence,{write:async()=>{writes++;throw Error('must not reissue settled result')}});
 assert.equal(writes,0);assert.equal(j.openOwnerTasks().totalOpen,0);assert.equal(j.control.checkpoint().value.initialInstruction,initialInstruction);assert.equal(j.control.checkpoint().value.plan,plan);assert.equal(j.control.checkpoint().value.pendingDecision,null);
});
test('settled result recovery closes owner task before checkpoint without reissuing public write',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Read',sentAt:1}]});const d=report(),id=retainDecision(j,fence,d,{events:j.pending()});
 j.control.prepare(fence,id,d.call);j.control.dispatch(fence,id);j.control.settle(fence,id,reportResponse(d));
 const save=j.control.save;j.control.save=()=>{throw Error('crash before checkpoint')};let writes=0;
 await assert.rejects(applyPendingDecision(j,fence,{write:async()=>{writes++}}),/crash before checkpoint/);assert.equal(j.openOwnerTasks().totalOpen,0);assert.ok(j.control.checkpoint().value.pendingDecision);
 j.control.save=save;await applyPendingDecision(j,fence,{write:async()=>{writes++}});assert.equal(writes,0);assert.equal(j.openOwnerTasks().totalOpen,0);assert.equal(j.control.checkpoint().value.pendingDecision,null);
});
test('unknown lost result preserves task and native readback closes only when authoritatively satisfied',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Read',sentAt:1}]});const d=report();retainDecision(j,fence,d);let writes=0,known=false;
 const world={write:async()=>{writes++;throw Error('lost')},reconcile:async()=>known?{state:'recorded',status:200,response:{...reportResponse(d),reconciliation:{evidence:'observed-native-state'}}}:{state:'unknown'}};
 await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});assert.equal(j.openOwnerTasks().totalOpen,1);await assert.rejects(applyPendingDecision(j,fence,world),{code:'OPERATION_UNCERTAIN'});assert.equal(j.openOwnerTasks().totalOpen,1);
 known=true;await applyPendingDecision(j,fence,world);assert.equal(writes,1);assert.equal(j.openOwnerTasks().totalOpen,0);
});
test('large native write response survives checkpoint crash and restart without another POST',async t=>{
 const {j,dir,fence}=fixture(t);j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Report the observed result'}]});
 const d=report(),id=retainDecision(j,fence,d,{events:j.pending()}),native={...reportResponse(d),receipt:{id:'r_1',phase:'completed',content:'界'.repeat(30000)}};
 const save=j.control.save;j.control.save=()=>{throw Error('crash after native response retained')};let writes=0;
 await assert.rejects(applyPendingDecision(j,fence,{write:async()=>{writes++;return native}}),/crash after native/);
 assert.deepEqual(j.control.operation(id).response,native);assert.equal(j.openOwnerTasks().totalOpen,0,'closure inspects complete native proof');j.control.save=save;j.control.release(fence);
 const recovered=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>recovered.close());const next=recovered.control.claim('recovered');
 const applied=await applyPendingDecision(recovered,next,{write:async()=>{writes++;throw Error('duplicate POST')}});
 assert.equal(writes,1);assert.deepEqual(applied.response,native);const checkpoint=recovered.control.checkpoint().value;
 assert.equal(checkpoint.pendingDecision,null);assert.equal(checkpoint.lastResult.responseOmitted,true);assert.equal(checkpoint.lastResult.responseRef.kind,'operation');assert.equal(checkpoint.lastResult.responseRef.id,id);assert.equal(checkpoint.lastResult.accepted,undefined);assert.equal(checkpoint.lastReceipt.detailsOmitted,true);assert.equal(checkpoint.lastReceipt.id,'r_1');
 assert.ok(Buffer.byteLength(JSON.stringify(checkpoint))<65536);
});
test('large read response survives restart and local chunk decisions never overwrite its saved slot',async t=>{
 const {j,dir,fence}=fixture(t),native={text:'🌎\\\n'.repeat(10000),source:'first native read'};
 const d=parseDecision(JSON.stringify({plan:'Inspect the complete native response',call:{type:'read',command:'observe',arguments:'{}'},wakeAt:null})),id=retainDecision(j,fence,d);
 const save=j.control.save;j.control.save=()=>{throw Error('crash after read retained')};let nativeReads=0;
 await assert.rejects(applyPendingDecision(j,fence,{read:async()=>{nativeReads++;return native}}),/crash after read/);j.control.save=save;j.control.release(fence);
 const recovered=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>recovered.close());const next=recovered.control.claim('recovered');
 const world={read:async()=>{nativeReads++;throw Error('must reuse durable read')}};await applyPendingDecision(recovered,next,world);assert.equal(nativeReads,1);
 const reference=recovered.control.checkpoint().value.lastResult.responseRef;assert.equal(reference.kind,'read');assert.equal(reference.id,id);
 let offset=0,raw='';do{
  const chunkDecision=parseDecision(JSON.stringify({plan:'Read saved native JSON chunks',call:{type:'read',command:'response',arguments:JSON.stringify({kind:'read',id,offset})},wakeAt:null}));
  retainDecision(recovered,next,chunkDecision);const applied=await applyPendingDecision(recovered,next,world);assert.ok(Buffer.byteLength(JSON.stringify(applied.response))<=24576);raw+=applied.response.text;offset=applied.response.nextOffset;
 }while(offset!==null);
 assert.equal(nativeReads,1);assert.deepEqual(JSON.parse(raw),native);assert.deepEqual(recovered.control.readResult(id).response,native);
 retainDecision(recovered,next,{plan:'Get a new observation',call:{type:'read',command:'here',args:{}},wakeAt:null});await applyPendingDecision(recovered,next,{read:async()=>({place:'garden'})});
 assert.equal(recovered.control.response({kind:'read',id}).responseUnavailable,true);
});
test('saved resync observation does not reconcile gaps received after its native snapshot',async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'world',after:null,cursor:'c_1',events:[],gap:true});retainDecision(j,fence,{plan:'Refresh current facts',call:{type:'read',command:'resync',args:{}},wakeAt:null});
 const reconcile=j.reconcileGap;j.reconcileGap=()=>{throw Error('crash before reconciling gap')};let reads=0;
 await assert.rejects(applyPendingDecision(j,fence,{read:async()=>{reads++;return {historyIncomplete:true,observation:{place:'library'}}}}),/crash before reconciling/);
 j.reconcileGap=reconcile;j.ingest({source:'world',after:'c_1',cursor:'c_2',events:[],gap:true});
 await applyPendingDecision(j,fence,{read:async()=>{reads++;throw Error('must reuse saved resync')}});assert.equal(reads,1);assert.deepEqual(j.gaps().map(g=>g.after_cursor),['c_2']);
});
test('an old pending object read observes native 404 after restart and can replan instead of exiting',async t=>{
 const {j,dir,fence}=fixture(t);j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Read and report'}]});
 retainDecision(j,fence,{plan:'Inspect object',call:{type:'read',command:'object',args:{id:'e_27c5567d'}},wakeAt:null},{events:j.pending()});j.control.release(fence);
 const recovered=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>recovered.close());const next=recovered.control.claim('recovery');let reads=0;
 const applied=await applyPendingDecision(recovered,next,{read:async()=>{reads++;throw Object.assign(Error('no such object here'),{code:'not-found',status:404,uncertain:false})}});
 assert.equal(reads,1);assert.deepEqual(applied.response,{accepted:false,error:{code:'not-found',message:'no such object here',status:404}});assert.equal(recovered.control.checkpoint().value.pendingDecision,null);assert.deepEqual(recovered.control.checkpoint().value.lastResult,applied.response);assert.equal(recovered.pending().length,0);assert.equal(recovered.openOwnerTasks().totalOpen,1);
 retainDecision(recovered,next,{plan:'Reobserve after object refusal',call:{type:'read',command:'here',args:{}},wakeAt:null});await applyPendingDecision(recovered,next,{read:async()=>({place:'library'})});assert.equal(recovered.control.checkpoint().value.lastResult.place,'library');
});
test('read validation conflicts are observations, while auth and transport keep the pending decision',async t=>{
 for(const status of [400,409,422]){
  const {j,fence}=fixture(t);j.ingest({source:'world',after:null,cursor:'c_1',events:[],gap:true});retainDecision(j,fence,{plan:'Resync',call:{type:'read',command:'resync',args:{}},wakeAt:null});
  const result=await applyPendingDecision(j,fence,{read:async()=>{throw Object.assign(Error('Read refused'),{code:'invalid',status,uncertain:false})}});assert.equal(result.response.accepted,false);assert.equal(result.response.error.status,status);assert.equal(j.gaps().length,1,'a refused resync cannot clear gaps');
 }
 for(const status of [401,403,500]){
  const {j,fence}=fixture(t);retainDecision(j,fence,{plan:'Read',call:{type:'read',command:'here',args:{}},wakeAt:null});
  await assert.rejects(applyPendingDecision(j,fence,{read:async()=>{throw Object.assign(Error('Read failed'),{status,uncertain:false})}}),/Read failed/);assert.ok(j.control.checkpoint().value.pendingDecision);
 }
});
test('full encoded instruction, plan and call arguments fit consecutive durable decisions',async t=>{
 const {j,fence}=fixture(t),initialInstruction='i'.repeat(15998),plan='p'.repeat(15998),args=JSON.stringify({text:'x'.repeat(15983)});
 assert.equal(Buffer.byteLength(JSON.stringify(args)),16000);
 const d=parseDecision(JSON.stringify({plan,call:{type:'write',command:'say',arguments:args},wakeAt:null}));
 retainDecision(j,fence,d,{initialInstruction});await applyPendingDecision(j,fence,{write:async()=>({accepted:true,text:'界'.repeat(10000)})});
 assert.equal(j.control.checkpoint().value.lastResult.responseOmitted,true);
 retainDecision(j,fence,d);assert.equal(j.control.checkpoint().value.lastCall,undefined);assert.equal(j.control.checkpoint().value.lastResult,undefined);
 await applyPendingDecision(j,fence,{write:async()=>({accepted:true})});assert.equal(j.control.checkpoint().value.lastResult.accepted,true);assert.equal(j.control.checkpoint().value.plan,plan);assert.equal(j.control.checkpoint().value.initialInstruction,initialInstruction);
});
test('uncertain write 404 remains uncertain and local response arguments are strict',async t=>{
 const {j,fence}=fixture(t);retainDecision(j,fence,decision());
 await assert.rejects(applyPendingDecision(j,fence,{write:async()=>{throw Object.assign(Error('Lost write response'),{status:404,uncertain:true})}}),{code:'OPERATION_UNCERTAIN'});assert.ok(j.control.checkpoint().value.pendingDecision);assert.equal(j.control.operations()[0].status,'uncertain');
 for(const args of [{kind:'read',id:'abc',offset:-1},{kind:'read',id:'abc',offset:1.5},{kind:'bad',id:'abc'},{kind:'read'},{kind:'read',id:'abc',unexpected:true}])assert.throws(()=>parseDecision(JSON.stringify({plan:'Inspect',call:{type:'read',command:'response',arguments:JSON.stringify(args)},wakeAt:null})),/Local response/);
});
test('actual checkpoint budget fits whole observations and 24KiB chunks with full instruction, plan and argument limits',async t=>{
 const {j,fence}=fixture(t),initialInstruction='i'.repeat(15998),plan='p'.repeat(15998),args=JSON.stringify({text:'x'.repeat(15983)}),receipt={id:'r-budget',detail:'r'.repeat(980)};
 const d=parseDecision(JSON.stringify({plan,call:{type:'write',command:'say',arguments:args},wakeAt:null})),small={accepted:true,text:'x'.repeat(12000),receipt};
 retainDecision(j,fence,d,{initialInstruction});await applyPendingDecision(j,fence,{write:async()=>small});assert.deepEqual(j.control.checkpoint().value.lastResult,small);assert.ok(Buffer.byteLength(JSON.stringify(j.control.checkpoint().value))<=65536-128);
 const large={accepted:true,text:'x'.repeat(24000),receipt},id=retainDecision(j,fence,d);await applyPendingDecision(j,fence,{write:async()=>large});
 assert.equal(j.control.checkpoint().value.lastResult.responseOmitted,true);assert.ok(Buffer.byteLength(JSON.stringify(j.control.checkpoint().value))<=65536-128);
 let offset=0,raw='',chunks=0;do{
  const read=parseDecision(JSON.stringify({plan,call:{type:'read',command:'response',arguments:JSON.stringify({kind:'operation',id,offset})},wakeAt:null}));
  retainDecision(j,fence,read);const applied=await applyPendingDecision(j,fence,{}),checkpoint=j.control.checkpoint().value;
  assert.deepEqual(checkpoint.lastResult,applied.response);assert.ok(Buffer.byteLength(JSON.stringify(checkpoint))<=65536-128);assert.ok(Buffer.byteLength(JSON.stringify(applied.response))<=24576);
  if(chunks===0)assert.ok(Buffer.byteLength(JSON.stringify(applied.response))>24000,'use the larger chunk instead of another 8KiB turn');raw+=applied.response.text;offset=applied.response.nextOffset;chunks++;
 }while(offset!==null);
 assert.deepEqual(JSON.parse(raw),large);assert.equal(chunks,2);assert.equal(j.control.checkpoint().value.initialInstruction,initialInstruction);assert.equal(j.control.checkpoint().value.plan,plan);
});
test('100 maximum-length event identities drain in bounded pages with full retained decision budgets',async t=>{
 const {j,fence}=fixture(t),source='界'.repeat(100),initialInstruction='i'.repeat(15998),plan='p'.repeat(15998),args=JSON.stringify({text:'x'.repeat(15983)});
 const events=Array.from({length:100},(_,i)=>({id:'\ud800'.repeat(197)+String(i).padStart(3,'0'),text:'Preserve the whole observation '+i}));
 j.ingest({source,after:null,cursor:'c_100',events});assert.equal(j.pending(100).length,100);
 const d=parseDecision(JSON.stringify({plan,call:{type:'write',command:'say',arguments:args},wakeAt:null})),receipt={id:'r-budget',detail:'r'.repeat(980)};let pages=0,handled=0;
 while(j.pending(1).length){
  const page=boundedFacts(j.attention(100));assert.ok(page.length>0&&page.length<100);assert.ok(Buffer.byteLength(JSON.stringify(page.map(f=>({source:f.source,id:f.event.id}))))<=8192);
  retainDecision(j,fence,d,{events:page,initialInstruction});assert.ok(Buffer.byteLength(JSON.stringify(j.control.checkpoint().value))<=65536);assert.equal(j.control.checkpoint().value.pendingDecision.eventIds.length,page.length);
  await applyPendingDecision(j,fence,{write:async()=>({accepted:true,receipt})});handled+=page.length;pages++;assert.ok(Buffer.byteLength(JSON.stringify(j.control.checkpoint().value))<=65536);
  assert.equal(j.pending(100).length,100-handled);assert.ok(pages<=100);
 }
 assert.equal(handled,100);assert.ok(pages>1);assert.equal(j.control.checkpoint().value.plan,plan);assert.equal(j.control.checkpoint().value.initialInstruction,initialInstruction);
});
test('model-chosen listening persists across reads, replies and restart independently of the deadline',async t=>{
 const {j,dir,fence}=fixture(t),wakeAt=new Date(Date.now()+60000).toISOString();
 const wait=listenTo=>parseDecision(JSON.stringify({plan:'Attend to observed participants without losing departure',call:{type:'wait',command:'wait',arguments:JSON.stringify({listenTo})},wakeAt:null}));
 retainDecision(j,fence,{...wait(['s_second','s_first','s_first']),wakeAt});await applyPendingDecision(j,fence,{});assert.deepEqual(j.control.checkpoint().value.listenTo,['s_first','s_second']);j.control.release(fence);
 const recovered=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>recovered.close());const next=recovered.control.claim('recovered');assert.deepEqual(recovered.control.checkpoint().value.listenTo,['s_first','s_second']);assert.equal(recovered.control.checkpoint().value.wakeAt,wakeAt);
 const help=parseDecision(JSON.stringify({plan:'Inspect the actual conversation API',call:{type:'read',command:'help',arguments:'{"command":"converse"}'},wakeAt:null}));retainDecision(recovered,next,help);await applyPendingDecision(recovered,next,{read:async(command,args)=>{assert.equal(command,'help');assert.deepEqual(args,{command:'converse'});return {command:'converse',ops:['start','accept','say']}}});
 retainDecision(recovered,next,{plan:'Reply briefly then resume attention',call:{type:'write',command:'say',args:{text:'Hello'}},wakeAt:null});await applyPendingDecision(recovered,next,{write:async()=>({said:{id:'sp_reply'}})});
 assert.deepEqual(recovered.control.checkpoint().value.listenTo,['s_first','s_second']);assert.equal(recovered.control.checkpoint().value.wakeAt,wakeAt);
 retainDecision(recovered,next,wait([]));await applyPendingDecision(recovered,next,{});assert.deepEqual(recovered.control.checkpoint().value.listenTo,[]);assert.equal(recovered.control.checkpoint().value.wakeAt,wakeAt);
 retainDecision(recovered,next,{...wait('nearby'),call:{...wait('nearby').call,args:{listenTo:'nearby',cancelWake:true}}});await applyPendingDecision(recovered,next,{});assert.equal(recovered.control.checkpoint().value.listenTo,'nearby');assert.equal(recovered.control.checkpoint().value.wakeAt,null);
});
test('listening arguments are explicit and bounded; pending listening choice recovers after restart',async t=>{
 const payload=listenTo=>JSON.stringify({plan:'Choose attention',call:{type:'wait',command:'wait',arguments:JSON.stringify({listenTo})},wakeAt:null});
 for(const scope of [null,true,'all',['unknown'],Array.from({length:13},(_,i)=>'s_'+i),['s_'+'x'.repeat(199)]])assert.throws(()=>parseDecision(payload(scope)),/listenTo/);
 assert.throws(()=>parseDecision(JSON.stringify({plan:'Wrong scope location',call:{type:'read',command:'here',arguments:'{"listenTo":"nearby"}'},wakeAt:null})),/Only wait/);
 const {j,dir,fence}=fixture(t);retainDecision(j,fence,parseDecision(payload('nearby')));j.control.release(fence);const recovered=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>recovered.close());const next=recovered.control.claim('recovery');await applyPendingDecision(recovered,next,{});assert.equal(recovered.control.checkpoint().value.listenTo,'nearby');assert.equal(recovered.control.checkpoint().value.pendingDecision,null);
});
const listenDecision=listenTo=>parseDecision(JSON.stringify({plan:'Configure attention, then continue the original errand',call:{type:'listen',command:'listen',arguments:JSON.stringify({listenTo})},wakeAt:null}));
test('nonblocking listen is an explicit local command with exactly one bounded scope argument',()=>{
 assert.ok(DECISION_SCHEMA.properties.call.properties.type.enum.includes('listen'));
 assert.deepEqual(listenDecision(['s_second','s_first','s_first']).call,{type:'listen',command:'listen',args:{listenTo:['s_first','s_second']}});
 const value={plan:'Configure only',call:{type:'listen',command:'listen',arguments:'{"listenTo":[]}'},wakeAt:null};
 for(const args of [{},{listenTo:[],seconds:1},{listenTo:[],cancelWake:true},{listenTo:[],text:'say this'}])assert.throws(()=>parseDecision(JSON.stringify({...value,call:{...value.call,arguments:JSON.stringify(args)}})),/exactly listenTo/);
 assert.throws(()=>parseDecision(JSON.stringify({...value,call:{...value.call,command:'say'}})),/Unsupported/);
 assert.throws(()=>listenDecision('all'),/listenTo/);
});
test('pending local listening configuration reconciles after a checkpoint crash without world calls or owner acknowledgement',async t=>{
 const {j,dir,fence}=fixture(t),wakeAt=new Date(Date.now()+60000).toISOString();j.control.save(fence,0,{listenTo:['s_old'],wakeAt});
 j.ingest({source:'owner',after:null,cursor:'m_original',events:[{id:'m_original',text:'Return and report the actual outcome'}]});
 const id=retainDecision(j,fence,listenDecision('nearby'),{events:j.pending()});
 const save=j.control.save.bind(j.control);j.control.save=(...args)=>{if(args[2].pendingDecision===null)throw Error('crash before local configuration checkpoint');return save(...args);};
 let nativeCalls=0;const world={read:async()=>{nativeCalls++;throw Error('unexpected read');},write:async()=>{nativeCalls++;throw Error('unexpected write or ack');}};
 await assert.rejects(applyPendingDecision(j,fence,world),/crash before local configuration/);assert.equal(nativeCalls,0);assert.equal(j.control.checkpoint().value.pendingDecision.id,id);assert.deepEqual(j.control.checkpoint().value.listenTo,['s_old']);assert.equal(j.openOwnerTasks().totalOpen,1);
 j.control.save=save;j.control.release(fence);const recovered=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>recovered.close());const next=recovered.control.claim('recovery');
 const result=await applyPendingDecision(recovered,next,world);assert.deepEqual(result.response,{local:true,listenTo:'nearby'});assert.equal(result.call.type,'listen');assert.equal(recovered.control.checkpoint().value.listenTo,'nearby');assert.equal(recovered.control.checkpoint().value.wakeAt,wakeAt);assert.equal(recovered.control.checkpoint().value.pendingDecision,null);assert.equal(recovered.control.operations().length,0);assert.equal(recovered.openOwnerTasks().totalOpen,1);assert.equal(nativeCalls,0);
 recovered.control.release(next);const reopened=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>reopened.close());assert.equal(reopened.control.checkpoint().value.listenTo,'nearby');assert.equal(reopened.control.checkpoint().value.wakeAt,wakeAt);
});
test('local listening configuration preserves a due wake for the immediate next action',async t=>{
 const {j,fence}=fixture(t),wakeAt=new Date(Date.now()-1000).toISOString();j.control.save(fence,0,{listenTo:'nearby',wakeAt});
 retainDecision(j,fence,listenDecision([]));await applyPendingDecision(j,fence,{});assert.deepEqual(j.control.checkpoint().value.listenTo,[]);assert.equal(j.control.checkpoint().value.wakeAt,wakeAt);
 retainDecision(j,fence,{plan:'Handle the due departure now',call:{type:'write',command:'act',args:{capability:'observed_departure'}},wakeAt:null});await applyPendingDecision(j,fence,{write:async()=>({accepted:true})});assert.equal(j.control.checkpoint().value.wakeAt,null);
});

for(const type of ['future-local-type','read','write','listen'])test('unknown retained decision fails closed without losing intent: '+type,async t=>{
 const {j,fence}=fixture(t);j.ingest({source:'owner',after:null,cursor:'m_future',events:[{id:'m_future',text:'Keep my task pending'}]});
 const id=retainDecision(j,fence,{plan:'Retained by a newer runtime',call:{type,command:'future',args:{}},wakeAt:null},{events:j.pending()});
 let calls=0;await assert.rejects(applyPendingDecision(j,fence,{read:async()=>calls++,write:async()=>calls++}),{code:'UNSUPPORTED_RETAINED_DECISION'});
 assert.equal(calls,0);assert.equal(j.control.checkpoint().value.pendingDecision.id,id);assert.equal(j.pending().length,1);assert.equal(j.openOwnerTasks().totalOpen,1);assert.equal(j.control.operations().length,0);
});

function progressMarker(){return {id:'progress-epoch',phase:'active',window:1,deadlineAt:100000,softUsed:false,fallbackUsed:false,worldReplans:0,turnId:'old-turn',hostPid:1234};}
test('both recovery markers survive uncertain writes and clear only with actual committed finalization',async t=>{
 const {j,fence}=fixture(t),progress={...progressMarker(),softUsed:true,fallbackUsed:true,window:3};j.control.save(fence,0,{decisionProgressV1:progress,urgentRecoveryV1:{id:'urgent',triggerAt:1,reason:'owner',turnId:'old-turn',fallbackUsed:true,worldReplans:2}});retainDecision(j,fence,decision());let writes=0;
 await assert.rejects(applyPendingDecision(j,fence,{write:async()=>{writes++;throw Error('lost accepted reply');}}),{code:'OPERATION_UNCERTAIN'});assert.deepEqual(decisionProgress(j.control.checkpoint().value),progress);
 await assert.rejects(applyPendingDecision(j,fence,{reconcile:async()=>({state:'unknown'})}),{code:'OPERATION_UNCERTAIN'});assert.equal(writes,1);assert.deepEqual(decisionProgress(j.control.checkpoint().value),progress);
 await applyPendingDecision(j,fence,{write:async()=>assert.fail('no replay'),reconcile:async()=>({state:'recorded',status:200,response:{accepted:true}})});assert.equal(writes,1);assert.equal(j.control.checkpoint().value.decisionProgressV1,undefined);assert.equal(j.control.checkpoint().value.urgentRecoveryV1,undefined);
});
test('near-full legacy checkpoint migrates only its exact durable observation and retains room for both markers across restart',async t=>{
 const {j,dir,fence}=fixture(t),call={type:'write',command:'say',args:{text:'x'.repeat(15900)}},body={threadId:'original-thread',initialInstruction:'i'.repeat(15998),plan:'p'.repeat(15998),lastDecisionId:'settled-old',lastCall:call,lastResult:null};
 const response={accepted:true,data:''};body.lastResult=response;response.data='v'.repeat(65536-128-Buffer.byteLength(JSON.stringify(body)));assert.equal(Buffer.byteLength(JSON.stringify(body)),65536-128);
 j.control.prepare(fence,'settled-old',call);j.control.dispatch(fence,'settled-old');j.control.settle(fence,'settled-old',response);j.control.save(fence,0,body);
 const urgent={id:'urgent',triggerAt:1,reason:'owner',turnId:'old-turn',fallbackUsed:false,worldReplans:2},progress={...progressMarker(),includedUrgency:{source:'world',eventId:'native-direct',sequence:1,reason:'direct',triggerAt:1,deadlineAt:5001,spent:true}};saveRecoveryCheckpoint(j,fence,j.control.checkpoint().revision,{...body,urgentRecoveryV1:urgent,decisionProgressV1:progress});
 let saved=j.control.checkpoint().value;assert.equal(saved.lastResult.responseOmitted,true);assert.equal(saved.lastResult.responseRef.kind,'operation');assert.equal(saved.initialInstruction,body.initialInstruction);assert.equal(saved.plan,body.plan);assert.equal(saved.lastCall.args.text,call.args.text);assert.ok(Buffer.byteLength(JSON.stringify(saved))<=65536);
 let raw='',offset=0;for(;;){const part=j.control.response({kind:'operation',id:'settled-old',offset});raw+=part.text;if(part.nextOffset===null)break;offset=part.nextOffset;}assert.deepEqual(JSON.parse(raw),response);
 j.control.release(fence);const reopened=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>reopened.close());const next=reopened.control.claim('next');saved=reopened.control.checkpoint().value;
 saveRecoveryCheckpoint(reopened,next,reopened.control.checkpoint().revision,{...saved,decisionProgressV1:{...progress,phase:'soft-pending',softUsed:true}});assert.equal(decisionProgress(reopened.control.checkpoint().value).softUsed,true);assert.deepEqual(decisionProgress(reopened.control.checkpoint().value).includedUrgency,progress.includedUrgency);assert.ok(Buffer.byteLength(JSON.stringify(reopened.control.checkpoint().value))<=65536);
 retainDecision(reopened,next,{plan:body.plan,call:{type:'wait',command:'wait',args:{}},wakeAt:null});await applyPendingDecision(reopened,next,{write:async()=>assert.fail('settled old world write must not replay')});assert.equal(reopened.control.checkpoint().value.decisionProgressV1,undefined);assert.equal(reopened.control.checkpoint().value.urgentRecoveryV1,undefined);
});
test('unprovable legacy projection and oversized recovery metadata block without dropping intent',t=>{
 const {j,fence}=fixture(t),body={initialInstruction:'i'.repeat(16000),plan:'p'.repeat(16000),lastResult:'x'.repeat(32000)};j.control.save(fence,0,body);const before=j.control.checkpoint();assert.ok(Buffer.byteLength(JSON.stringify(body))>65536-RECOVERY_METADATA_BYTES-128);
 assert.throws(()=>saveRecoveryCheckpoint(j,fence,before.revision,{...body,decisionProgressV1:progressMarker()}),{code:'DECISION_PROGRESS_STATE_INVALID'});assert.deepEqual(j.control.checkpoint(),before);
 assert.throws(()=>saveRecoveryCheckpoint(j,fence,before.revision,{...body,decisionProgressV1:{...progressMarker(),unexpected:'x'.repeat(2048)}}),{code:'DECISION_PROGRESS_STATE_INVALID'});assert.deepEqual(j.control.checkpoint(),before);
});

test('included-alert metadata validates exact identity, coherent reason/clock, spent state and shared envelope',t=>{
 const base={source:'world',eventId:'native-direct',sequence:1,reason:'direct',triggerAt:100,deadlineAt:5100,spent:false};
 const validate=a=>decisionProgress({decisionProgressV1:{...progressMarker(),includedUrgency:a}});
 assert.deepEqual(validate(base).includedUrgency,base);assert.equal(validate({...base,eventId:'界'.repeat(200)}).includedUrgency.eventId,'界'.repeat(200));
 for(const bad of [null,{...base,source:'remote'},{...base,source:'owner'},{...base,reason:'deadline'},{...base,eventId:''},{...base,eventId:'control\ncharacter'},{...base,eventId:'x'.repeat(201)},{...base,sequence:0},{...base,triggerAt:-1},{...base,deadlineAt:100},{...base,deadlineAt:60101},{...base,spent:1},{...base,extra:true}])assert.throws(()=>validate(bad),{code:'DECISION_PROGRESS_STATE_INVALID'});
 const {j,fence}=fixture(t),value={decisionProgressV1:{...progressMarker(),includedUrgency:base,other:'x'.repeat(RECOVERY_METADATA_BYTES)}};
 assert.throws(()=>saveRecoveryCheckpoint(j,fence,0,value),{code:'DECISION_PROGRESS_STATE_INVALID'});assert.equal(j.control.checkpoint().revision,0);
});
