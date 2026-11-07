import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJournal} from './journal.mjs';
import {runManaged} from './managed.mjs';
import {runSupervisor} from './supervisor.mjs';
import {abortableSleep} from './receiver.mjs';

// Deterministic injected durations, independent of production defaults or SLA.
// The original unchanged-base RED proof is retained in the scoped scratch receipt.
const activeDecisionMs=2000,interruptTerminalMs=500;
const origin=Date.parse('2026-10-30T12:00:00.000Z');
const flush=async()=>{for(let n=0;n<20;n++)await new Promise(setImmediate);};
class PendingHost extends EventEmitter{
 constructor(){super();this.threadId='original-durable-thread';this.activeTurnId=null;this.calls=[];this.steers=[];this.interrupts=[];this.turns=new Map();}
 async connect({threadId}){assert.equal(threadId,this.threadId);}
 async begin(text){
  assert.equal(this.activeTurnId,null,'a fresh decision requires exact old terminal proof');
  const turnId='turn-'+(this.calls.length+1);this.calls.push(JSON.parse(text));this.activeTurnId=turnId;
  let resolve;const completed=new Promise(r=>resolve=r);this.turns.set(turnId,{resolve,completed});return {turnId,completed};
 }
 async steer(text,turnId){assert.equal(turnId,this.activeTurnId);this.steers.push({turnId,text:JSON.parse(text),at:Date.now()});return {accepted:true};}
 async interrupt(turnId){assert.equal(turnId,this.activeTurnId);this.interrupts.push({turnId,at:Date.now()});return this.turns.get(turnId).completed;}
 finish(turnId,status='interrupted',text){assert.equal(turnId,this.activeTurnId);this.activeTurnId=null;this.turns.get(turnId).resolve({turnId,status,...(text?{text}: {})});}
 async close(){this.closed=true;if(this.activeTurnId)this.finish(this.activeTurnId);}
}
function fixture(t,{idle=false,startRun=true,urgentMs=1000}={}){
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:origin});
 const directory=mkdtempSync(join(tmpdir(),'souls-active-progress-')),journal=openJournal(directory,{worldId:'w',soulId:'s'}),host=new PendingHost(),stop=new AbortController(),commands=[],states=[];
 const plan='Preserve the original goal, unfinished errand and observations',instruction='Carry out the original owner request using observed facts.';
 journal.ingest({source:'owner',after:null,cursor:'original-owner',events:[{id:'original-owner',text:instruction}]});journal.handled('owner','original-owner','notification incorporated; task still open');
 journal.ingest({source:'world',after:null,cursor:'activity-at-start',events:[{id:'ambient-at-start',kind:'speech.ambient',raw:'speech',salience:1,text:'An already observed ambient remark.'},{id:'activity-at-start',kind:'activity.observed',salience:2,data:{body:{activity:'read'}}}]});
 const fence=journal.control.claim('prior');journal.control.save(fence,0,{threadId:host.threadId,initialInstruction:instruction,plan,wakeAt:null,listenTo:[]});journal.control.release(fence);
 if(idle){const begin=host.begin.bind(host);host.begin=async(...args)=>{const active=await begin(...args);host.finish(active.turnId,'completed',JSON.stringify({plan,call:{type:'wait',command:'wait',arguments:'{}'},wakeAt:null}));return active;};}
 const world={read:async command=>{commands.push(['read',command]);return {here:'observed native place'};},write:async command=>{commands.push(['write',command]);return {accepted:true};}};
 for(const method of ['worldPage','ownerPage'])world[method]=async({after,signal})=>{await abortableSleep(10000,signal);return {cursor:after,events:[]};};
 const options={journal,host,world,signal:stop.signal,onState:s=>states.push(s),activeDecisionMs,interruptTerminalMs,urgentInterruptMs:urgentMs};
 const running=startRun?runSupervisor(options):null;running?.catch(()=>{});
 const retained=()=>{const saved=journal.control.checkpoint().value;assert.equal(saved.plan,plan);assert.equal(saved.initialInstruction,instruction);assert.equal(saved.threadId,host.threadId);assert.equal(saved.wakeAt,null);assert.deepEqual(saved.listenTo,[]);assert.ok(!saved.pendingDecision);assert.equal(journal.control.operations().length,0);assert.deepEqual(commands,[['read','observe']]);assert.ok(journal.openOwnerTasks().tasks.some(task=>task.id==='original-owner'&&task.text===instruction));};
 const cleanup=async()=>{stop.abort();await running?.catch(()=>{});try{journal.close();}catch{}rmSync(directory,{recursive:true,force:true});};
 return {journal,host,world,commands,stop,directory,options,states,running,retained,cleanup};
}
test('ordinary receipt ACK cannot strand a known active decision beyond its injected wall budget',async t=>{
 const f=fixture(t);
 try{
  await flush();assert.equal(f.host.calls.length,1);assert.equal(f.host.activeTurnId,'turn-1');assert.equal(f.host.calls[0].scheduledWakeAt,null);assert.deepEqual(f.host.calls[0].pending.map(x=>x.event.id),['activity-at-start','ambient-at-start']);
  t.mock.timers.tick(1000);f.journal.ingest({source:'world',after:f.journal.cursor('world'),cursor:'ordinary-completion',events:[{id:'ordinary-completion',kind:'receipt',salience:3,receipt:{id:'original-native-receipt',phase:'completed'}}]});t.mock.timers.tick(100);await flush();
  assert.equal(f.host.steers.length,1);assert.ok(f.states.some(s=>s.state==='host-notified'&&s.mode==='steer'));assert.equal(f.host.interrupts.length,0);f.retained();
  // Metadata and successful steer ACKs are not a committed decision and must
  // neither satisfy progress nor replenish the absolute active-turn budget.
  f.host.emit('event',{method:'thread/tokenUsage/updated',params:{threadId:f.host.threadId,turnId:'turn-1',tokenUsage:{total:{totalTokens:123}}}});
  t.mock.timers.tick(activeDecisionMs-1100-1);await flush();assert.equal(f.host.interrupts.length,0);
  t.mock.timers.tick(1);await flush();assert.equal(f.host.interrupts.length,1,'an exact known active turn needs bounded supervision without a fresh owner/direct/deadline trigger');assert.equal(f.host.interrupts[0].turnId,'turn-1');assert.equal(f.host.interrupts[0].at,origin+activeDecisionMs);assert.equal(f.host.calls.length,1,'interrupt ACK is not terminal proof');f.retained();
  f.host.finish('turn-1','completed',JSON.stringify({plan:'Stale choice must not replace retained intent',call:{type:'write',command:'say',arguments:'{"text":"stale"}'},wakeAt:null}));await flush();assert.equal(f.host.calls.length,2);f.retained();assert.equal(f.host.threadId,'original-durable-thread');
 }finally{await f.cleanup();}
});
test('a committed idle wait does not create budget polling inference or interrupt native activity',async t=>{
 const f=fixture(t,{idle:true});
 try{
  await flush();assert.equal(f.host.calls.length,1);assert.equal(f.host.activeTurnId,null);assert.ok(f.states.some(s=>s.state==='decision'&&s.call==='wait'));assert.equal(f.journal.control.checkpoint().value.wakeAt,null);
  t.mock.timers.tick(activeDecisionMs*5);await flush();assert.equal(f.host.calls.length,1);assert.equal(f.host.interrupts.length,0);assert.equal(f.host.steers.length,0);f.retained();
 }finally{await f.cleanup();}
});

function ownerUpdate(f,id='new-owner'){
 f.journal.ingest({source:'owner',after:f.journal.cursor('owner'),cursor:id,events:[{id,text:'An authenticated revision; preserve unfinished tasks.'}]});
}
for(const timing of ['urgent-first','ordinary-first'])test('ordinary expiry coalesces one in-flight turn interruption: '+timing,async t=>{
 const f=fixture(t);
 try{
  await flush();t.mock.timers.tick(timing==='urgent-first'?800:1500);ownerUpdate(f);t.mock.timers.tick(100);await flush();
  if(timing==='urgent-first'){t.mock.timers.tick(1000);await flush();assert.equal(f.host.interrupts.length,1);t.mock.timers.tick(100);await flush();}
  else{t.mock.timers.tick(400);await flush();}
  assert.equal(Date.now(),origin+activeDecisionMs);assert.equal(f.host.interrupts.length,1);assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.softUsed,true);assert.equal(f.host.calls.length,1);
  f.host.finish('turn-1');await flush();const progress=f.journal.control.checkpoint().value.decisionProgressV1;assert.equal(progress.window,2);assert.equal(progress.deadlineAt,Date.now()+activeDecisionMs);assert.equal(f.host.calls.length,2);
  t.mock.timers.tick(700);await flush();assert.equal(f.host.interrupts.length,1,'late urgent grace cannot issue a second interrupt or refresh the window');f.retained();
 }finally{await f.cleanup();}
});
test('a successful urgent replan retains the exact ordinary deadline and leaves its soft credit unused',async t=>{
 const f=fixture(t);
 try{
  await flush();const deadline=f.journal.control.checkpoint().value.decisionProgressV1.deadlineAt;ownerUpdate(f);t.mock.timers.tick(100);await flush();t.mock.timers.tick(1000);await flush();assert.equal(f.host.interrupts.length,1);f.host.finish('turn-1');await flush();
  const p=f.journal.control.checkpoint().value.decisionProgressV1;assert.equal(p.deadlineAt,deadline);assert.equal(p.softUsed,false);assert.equal(p.window,1);assert.equal(f.host.calls.length,2);
  t.mock.timers.tick(deadline-Date.now());await flush();assert.equal(f.host.interrupts.length,2);assert.equal(f.host.interrupts[1].turnId,'turn-2');assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.softUsed,true);f.retained();
 }finally{await f.cleanup();}
});
test('synchronous expiry rejects a completion when the ordinary timer callback has not run',async t=>{
 const f=fixture(t);
 try{
  await flush();t.mock.timers.setTime(origin+activeDecisionMs);
  f.host.finish('turn-1','completed',JSON.stringify({plan:'expired',call:{type:'write',command:'say',arguments:'{"text":"must not write"}'},wakeAt:null}));await flush();
  assert.equal(f.host.interrupts.length,0,'known exact terminal requires no RPC');assert.equal(f.host.calls.length,2);assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.window,2);f.retained();
 }finally{await f.cleanup();}
});
test('a terminal turn with a stalled ordinary steer remains inside the active budget confirmation bound',async t=>{
 const f=fixture(t);f.host.steer=async function(text,turnId){this.steers.push({turnId});return new Promise(()=>{});};
 try{
  await flush();f.journal.ingest({source:'world',after:f.journal.cursor('world'),cursor:'ordinary',events:[{id:'ordinary',kind:'receipt',salience:3}]});t.mock.timers.tick(100);await flush();f.host.finish('turn-1','completed',JSON.stringify({plan:'expired',call:{type:'wait',command:'wait',arguments:'{}'},wakeAt:null}));await flush();
  t.mock.timers.tick(activeDecisionMs-100);await flush();assert.equal(f.host.interrupts.length,0);assert.equal(f.host.calls.length,1);t.mock.timers.tick(interruptTerminalMs);await flush();await assert.rejects(f.running,{code:'HOST_DECISION_PROGRESS_TIMEOUT'});assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.fallbackUsed,true);f.retained();
 }finally{await f.cleanup();}
});
function managedFixture(t,{hangFirst=false,groupVerified=true}={}){
 const f=fixture(t,{startRun:false}),hosts=[];
 const running=runManaged({...f.options,sleep:async()=>{},createHost:()=>{const host=new PendingHost();host.pid=12000+hosts.length;if(hangFirst&&!hosts.length)host.interrupt=async function(turnId){this.interrupts.push({turnId,at:Date.now()});return new Promise(()=>{});};host.close=async function(){this.closed=true;if(this.activeTurnId)this.finish(this.activeTurnId);return this.closeProof={hostPid:this.pid,threadId:this.threadId,groupClosed:groupVerified,groupVerification:groupVerified?'absent':'unverified'};};hosts.push(host);return host;}});running.catch(()=>{});
 return {...f,hosts,managedRunning:running};
}
test('one soft window and one verified fallback bound a no-commit episode to three windows',async t=>{
 const f=managedFixture(t);
 try{
  await flush();t.mock.timers.tick(activeDecisionMs);await flush();assert.equal(f.hosts[0].interrupts.length,1);f.hosts[0].finish('turn-1');await flush();assert.equal(f.hosts[0].calls.length,2);assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.window,2);
  t.mock.timers.tick(activeDecisionMs);await flush();assert.equal(f.hosts.length,2);assert.equal(f.hosts[0].closed,true);assert.equal(f.hosts[1].calls.length,1);const p=f.journal.control.checkpoint().value.decisionProgressV1;assert.equal(p.window,3);assert.equal(p.softUsed,true);assert.equal(p.fallbackUsed,true);assert.equal(f.hosts[1].threadId,f.hosts[0].threadId);assert.equal(f.hosts[1].calls[0].plan,f.hosts[0].calls[0].plan);
  t.mock.timers.tick(activeDecisionMs);await flush();await assert.rejects(f.managedRunning,{code:'DECISION_PROGRESS_BUDGET_EXHAUSTED'});assert.equal(f.hosts.length,2);assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.phase,'blocked');assert.equal(f.journal.control.operations().length,0);assert.ok(f.commands.every(([kind])=>kind==='read'));
 }finally{f.stop.abort();await f.managedRunning.catch(()=>{});await f.cleanup();}
});
test('external active-controller restart is explicitly blocked without resetting the saved deadline or credits',async t=>{
 const f=fixture(t);let reopened;
 try{
  await flush();t.mock.timers.tick(activeDecisionMs);await flush();const before=f.journal.control.checkpoint().value.decisionProgressV1;assert.equal(before.softUsed,true);assert.equal(before.phase,'soft-pending');f.stop.abort();await f.running;f.journal.close();reopened=openJournal(f.directory,{worldId:'w',soulId:'s'});
  const next=new PendingHost();let connected=false;next.connect=async()=>{connected=true;};
  await assert.rejects(runSupervisor({...f.options,journal:reopened,host:next,signal:new AbortController().signal}),{code:'DECISION_PROGRESS_RESTART_UNCONFIRMED'});assert.equal(connected,false);assert.deepEqual(reopened.control.checkpoint().value.decisionProgressV1,before);assert.equal(next.calls.length,0);
 }finally{reopened?.close();await f.cleanup();}
});

test('an urgent fallback shares the one host grant while retaining an ordinary soft window',async t=>{
 const f=managedFixture(t,{hangFirst:true});
 try{
  await flush();ownerUpdate(f);t.mock.timers.tick(100);await flush();t.mock.timers.tick(1000);await flush();assert.equal(f.hosts[0].interrupts.length,1);t.mock.timers.tick(interruptTerminalMs);await flush();assert.equal(f.hosts.length,2);
  let saved=f.journal.control.checkpoint().value;assert.equal(saved.urgentRecoveryV1.fallbackUsed,true);assert.equal(saved.decisionProgressV1.fallbackUsed,true);assert.equal(saved.decisionProgressV1.softUsed,false);assert.equal(saved.decisionProgressV1.window,2);
  t.mock.timers.tick(activeDecisionMs);await flush();assert.equal(f.hosts[1].interrupts.length,1);f.hosts[1].finish('turn-1');await flush();saved=f.journal.control.checkpoint().value;assert.equal(saved.decisionProgressV1.window,3);assert.equal(saved.decisionProgressV1.softUsed,true);
  t.mock.timers.tick(activeDecisionMs);await flush();await assert.rejects(f.managedRunning,{code:'DECISION_PROGRESS_BUDGET_EXHAUSTED'});assert.equal(f.hosts.length,2);assert.equal(f.states.filter(x=>x.state==='recovering').length,1);
 }finally{f.stop.abort();await f.managedRunning.catch(()=>{});await f.cleanup();}
});
test('generic active-host failures cannot bypass the one persisted fallback through eight ordinary retries',async t=>{
 const f=managedFixture(t);
 try{
  await flush();f.hosts[0].emit('fault',Object.assign(Error('first closed transport'),{code:'HOST_EXITED'}));await flush();assert.equal(f.hosts.length,2);assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.fallbackUsed,true);assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.window,2);
  f.hosts[1].emit('fault',Object.assign(Error('second closed transport'),{code:'HOST_EXITED'}));await flush();await assert.rejects(f.managedRunning,{code:'DECISION_PROGRESS_BUDGET_EXHAUSTED'});assert.equal(f.hosts.length,2);assert.equal(f.states.filter(x=>x.state==='recovering').length,1);
 }finally{f.stop.abort();await f.managedRunning.catch(()=>{});await f.cleanup();}
});
test('an unverified ordinary-budget cleanup blocks the reserved fallback',async t=>{
 const f=managedFixture(t,{hangFirst:true,groupVerified:false});
 try{
  await flush();t.mock.timers.tick(activeDecisionMs);await flush();t.mock.timers.tick(interruptTerminalMs);await flush();await assert.rejects(f.managedRunning,{code:'DECISION_PROGRESS_CLEANUP_UNVERIFIED'});assert.equal(f.hosts.length,1);assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.fallbackUsed,true);
 }finally{f.stop.abort();await f.managedRunning.catch(()=>{});await f.cleanup();}
});
test('the active-decision timer never interrupts or replays an applying uncertain world write',async t=>{
 const f=fixture(t,{startRun:false});let rejectWrite,writes=0;
 f.world.write=async()=>{writes++;return new Promise((resolve,reject)=>{rejectWrite=reject;});};
 const running=runSupervisor(f.options);running.catch(()=>{});
 try{
  await flush();f.host.finish('turn-1','completed',JSON.stringify({plan:'Retain the original task during native write reconciliation',call:{type:'write',command:'act',arguments:'{"capability":"observed-native-action"}'},wakeAt:null}));await flush();assert.equal(writes,1);assert.ok(f.journal.control.checkpoint().value.pendingDecision);const progress=f.journal.control.checkpoint().value.decisionProgressV1;
  t.mock.timers.tick(activeDecisionMs*4);await flush();assert.equal(f.host.interrupts.length,0);assert.equal(f.host.calls.length,1);assert.equal(writes,1);rejectWrite(Error('accepted response lost'));await flush();await assert.rejects(running,{code:'OPERATION_UNCERTAIN'});assert.equal(writes,1);assert.deepEqual(f.journal.control.checkpoint().value.decisionProgressV1,progress);assert.equal(f.journal.control.operations()[0].status,'uncertain');
 }finally{f.stop.abort();await running.catch(()=>{});await f.cleanup();}
});
test('a legacy spent urgent fallback is imported conservatively and cannot mint another host grant',async t=>{
 const f=fixture(t,{startRun:false}),fence=f.journal.control.claim('legacy');
 const c=f.journal.control.checkpoint();f.journal.control.save(fence,c.revision,{...c.value,urgentRecoveryV1:{id:'legacy-used',triggerAt:origin-1,reason:'owner',turnId:'legacy-turn',fallbackUsed:true,worldReplans:2}});f.journal.control.release(fence);
 const running=runSupervisor(f.options);running.catch(()=>{});
 try{
  await flush();assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.fallbackUsed,true);assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.worldReplans,2);
  t.mock.timers.tick(activeDecisionMs);await flush();f.host.finish('turn-1');await flush();assert.equal(f.host.calls.length,2);t.mock.timers.tick(activeDecisionMs);await flush();await assert.rejects(running,{code:'DECISION_PROGRESS_BUDGET_EXHAUSTED'});assert.equal(f.host.calls.length,2);assert.equal(f.journal.control.checkpoint().value.urgentRecoveryV1.fallbackUsed,true);
 }finally{f.stop.abort();await running.catch(()=>{});await f.cleanup();}
});
test('the final retention checkpoint read crossing the budget cannot retain the old world choice',async t=>{
 const f=fixture(t),save=f.journal.control.save,checkpoint=f.journal.control.checkpoint;let crossed=false,ended=false,readyReads=0;
 f.journal.control.save=(...args)=>{const result=save(...args);if(args[2].decisionProgressV1?.phase==='ready'&&args[2].decisionProgressV1.turnId===null)ended=true;return result;};
 f.journal.control.checkpoint=()=>{const result=checkpoint();if(ended&&!crossed&&++readyReads===2){crossed=true;t.mock.timers.setTime(origin+activeDecisionMs);}return result;};
 try{
  await flush();t.mock.timers.setTime(origin+activeDecisionMs-1);f.host.finish('turn-1','completed',JSON.stringify({plan:'expired choice',call:{type:'write',command:'say',arguments:'{"text":"must not write"}'},wakeAt:null}));await flush();assert.equal(crossed,true);assert.equal(f.host.calls.length,2);f.retained();assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.window,2);
 }finally{await f.cleanup();}
});

test('pre-prompt checkpoint I/O cannot start an already-expired model window',async t=>{
 const f=fixture(t,{startRun:false}),save=f.journal.control.save;let crossed=false;
 f.journal.control.save=(...args)=>{const result=save(...args);if(!crossed&&args[2].decisionProgressV1?.phase==='active'&&args[2].decisionProgressV1.turnId===null){crossed=true;t.mock.timers.setTime(origin+activeDecisionMs);}return result;};
 const running=runSupervisor(f.options);running.catch(()=>{});
 try{
  await flush();assert.equal(crossed,true);assert.equal(f.host.calls.length,1);assert.equal(Date.parse(f.host.calls[0].now),origin+activeDecisionMs);assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.window,2);assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.softUsed,true);assert.equal(f.host.interrupts.length,0);f.retained();
 }finally{f.stop.abort();await running.catch(()=>{});await f.cleanup();}
});
