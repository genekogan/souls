import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJournal} from './journal.mjs';
import {runSupervisor} from './supervisor.mjs';
import {runManaged} from './managed.mjs';
import {abortableSleep} from './receiver.mjs';

// Policy values are explicit test injections, not assertions about defaults.
const urgentInterruptMs=1000,interruptTerminalMs=500;
const origin=Date.parse('2026-10-30T12:00:00.000Z');
const obsolete={plan:'Obsolete turn must never replace retained intent',call:{type:'write',command:'say',arguments:'{"text":"obsolete world write"}'},wakeAt:null};
async function flush(){for(let n=0;n<20;n++)await new Promise(resolve=>setImmediate(resolve));}
class PendingHost extends EventEmitter{
 constructor(){super();this.threadId='same-durable-thread';this.calls=[];this.steers=[];this.interrupts=[];this.turns=new Map();this.closed=false;}
 async connect({threadId}){assert.equal(threadId,this.threadId);}
 async begin(text){
  assert.equal(this.activeTurnId,null,'a second turn requires the exact old terminal');
  const id='turn-'+(this.calls.length+1);this.calls.push(JSON.parse(text));this.activeTurnId=id;
  let resolve;const completed=new Promise(r=>resolve=r);this.turns.set(id,{resolve,completed});return {turnId:id,completed};
 }
 async steer(text,turnId){assert.equal(turnId,this.activeTurnId);this.steers.push({turnId,text:JSON.parse(text),at:Date.now()});return {accepted:true};}
 async interrupt(turnId=this.activeTurnId){assert.equal(turnId,this.activeTurnId);this.interrupts.push({turnId,at:Date.now()});return this.turns.get(turnId).completed;}
 finish(turnId,status='interrupted'){
  const turn=this.turns.get(turnId);assert.ok(turn);if(this.activeTurnId===turnId)this.activeTurnId=null;
  turn.resolve({turnId,status,...(status==='completed'?{text:JSON.stringify(obsolete)}:{})});
 }
 async close(){this.closed=true;if(this.activeTurnId)this.finish(this.activeTurnId);}
}
function fixture(t,{wakeOffset=60000,includedOwner=false,startRun=true}={}){
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:origin});
 const directory=mkdtempSync(join(tmpdir(),'souls-urgent-interrupt-')),journal=openJournal(directory,{worldId:'w',soulId:'s'}),host=new PendingHost(),stop=new AbortController(),commands=[],states=[];
 host.activeTurnId=null;
 journal.ingest({source:'owner',after:null,cursor:'original-owner',events:[{id:'original-owner',text:'Finish the original owner errand.'}]});
 if(!includedOwner)journal.handled('owner','original-owner','notification handled; task remains open');
 const wakeAt=new Date(origin+wakeOffset).toISOString(),plan='Original errand, suspended obligations and exact deadline',instruction='Original authenticated owner intent';
 const previous=journal.control.claim('old');journal.control.save(previous,0,{threadId:host.threadId,initialInstruction:instruction,plan,wakeAt,listenTo:['s_observed']});journal.control.release(previous);
 const world={read:async command=>{commands.push(['read',command]);return {here:'actual place'};},write:async command=>{commands.push(['write',command]);return {accepted:true};}};
 for(const method of ['ownerPage','worldPage'])world[method]=async({after,signal})=>{await abortableSleep(10000,signal);return {cursor:after,events:[]};};
 const running=startRun?runSupervisor({journal,host,world,signal:stop.signal,onState:s=>states.push(s),urgentInterruptMs,interruptTerminalMs}):null;
 const cleanup=async()=>{stop.abort();await running?.catch(()=>{});journal.close();rmSync(directory,{recursive:true,force:true});};
 const retained=()=>{
  const value=journal.control.checkpoint().value;assert.equal(value.threadId,host.threadId);assert.equal(value.initialInstruction,instruction);assert.equal(value.plan,plan);assert.equal(value.wakeAt,wakeAt);assert.deepEqual(value.listenTo,['s_observed']);assert.ok(!value.pendingDecision);assert.equal(journal.control.operations().length,0);assert.deepEqual(commands,[['read','observe']]);assert.ok(journal.openOwnerTasks().tasks.some(x=>x.id==='original-owner'&&x.text==='Finish the original owner errand.'));
 };
 return {journal,host,stop,world,states,commands,wakeAt,plan,instruction,running,cleanup,retained};
}
function owner(f,id='owner-cancellation'){
 const after=f.journal.cursor('owner');f.journal.ingest({source:'owner',after,cursor:id,events:[{id,text:'Stop the prior action; preserve the unfinished errand until reported.'}]});
}
for(const scenario of [{kind:'owner',terminal:'interrupted'},{kind:'timer',terminal:'interrupted'},{kind:'owner completion race',terminal:'completed'}]){
 test('accepted '+scenario.kind+' steer cannot strand a stale turn that never completes',async t=>{
  const f=fixture(t,{wakeOffset:scenario.kind==='timer'?2000:60000});
  try{
   await flush();assert.equal(f.host.calls.length,1);assert.equal(f.host.activeTurnId,'turn-1');
   if(scenario.kind==='timer')t.mock.timers.tick(2000);else{owner(f);t.mock.timers.tick(100);}
   await flush();const ack=f.states.find(s=>s.state==='host-notified'&&s.mode==='steer');assert.ok(ack,'actual steer ACK is a prerequisite, not progress');assert.equal(f.host.steers.length,1);assert.equal(f.host.calls.length,1);f.retained();
   const pending=f.journal.pending().map(x=>({source:x.source,id:x.event.id}));
   t.mock.timers.tick(urgentInterruptMs-1);await flush();assert.equal(f.host.interrupts.length,0,'do not interrupt before the explicitly injected grace');
   t.mock.timers.tick(1);await flush();
   assert.equal(f.host.interrupts.length,1,'after injected grace, stale inference must be interrupted instead of awaiting completed indefinitely');
   assert.equal(f.host.interrupts[0].turnId,'turn-1');assert.equal(f.host.calls.length,1,'interrupt request/ACK is not exact old-turn terminal proof');f.retained();assert.deepEqual(f.journal.pending().map(x=>({source:x.source,id:x.event.id})),pending);
   t.mock.timers.tick(interruptTerminalMs-1);await flush();assert.equal(f.host.calls.length,1);assert.equal(f.host.interrupts.length,1,'one interrupt only for this stale episode');
   // Natural completion may beat interruption. Both terminal outcomes are stale.
   f.host.finish('turn-1',scenario.terminal);await flush();assert.equal(f.host.calls.length,2,'fresh decision begins only after the exact old terminal');f.retained();
   const fresh=f.host.calls[1];assert.equal(fresh.plan,f.plan);assert.equal(fresh.scheduledWakeAt,f.wakeAt);assert.deepEqual(fresh.listenTo,['s_observed']);assert.ok(Date.parse(fresh.now)>=f.host.interrupts[0].at);
   if(scenario.kind!=='timer')assert.ok(fresh.pending.some(x=>x.event.id==='owner-cancellation'));
   t.mock.timers.tick(urgentInterruptMs+interruptTerminalMs);await flush();assert.equal(f.host.interrupts.length,1,'facts/deadline already included in the fresh prompt must not rearm');assert.equal(f.host.calls.length,2);
  }finally{await f.cleanup();}
 });
}
test('owner facts included at prompt start have one finite response attempt',async t=>{
 const f=fixture(t,{includedOwner:true});
 try{
  await flush();assert.ok(f.host.calls[0].pending.some(x=>x.event.id==='original-owner'));
  t.mock.timers.tick(urgentInterruptMs);await flush();assert.equal(f.host.interrupts.length,1);assert.equal(f.host.calls.length,1);assert.equal(f.host.closed,false);f.retained();
  f.host.finish('turn-1');await flush();t.mock.timers.tick(urgentInterruptMs+interruptTerminalMs);await flush();assert.equal(f.host.interrupts.length,1);assert.equal(f.host.calls.length,2);f.retained();
 }finally{await f.cleanup();}
});
for(const verified of [true,false])test('unconfirmed interrupt permits one same-thread fallback only with verified group absence: '+verified,async t=>{
 const f=fixture(t,{startRun:false}),hosts=[];
 const running=runManaged({journal:f.journal,world:f.world,signal:f.stop.signal,onState:s=>f.states.push(s),urgentInterruptMs,interruptTerminalMs,sleep:async()=>{},createHost:()=>{
  const host=new PendingHost();host.activeTurnId=null;host.pid=4000+hosts.length;
  host.interrupt=async function(turnId){assert.equal(turnId,this.activeTurnId);this.interrupts.push({turnId,at:Date.now()});return new Promise(()=>{});};
  host.close=async function(){this.closed=true;if(this.activeTurnId)this.finish(this.activeTurnId);this.closeProof={hostPid:this.pid,threadId:this.threadId,groupClosed:verified,groupVerification:verified?'absent':'unverified'};return this.closeProof;};hosts.push(host);return host;
 }});running.catch(()=>{});
 try{
  await flush();owner(f,'first-cancel');t.mock.timers.tick(100);await flush();t.mock.timers.tick(urgentInterruptMs);await flush();assert.equal(hosts[0].interrupts.length,1);
  t.mock.timers.tick(interruptTerminalMs-1);await flush();assert.equal(hosts.length,1,'neither interrupt ACK nor a pending promise is terminal proof');
  t.mock.timers.tick(1);await flush();
  if(!verified){await assert.rejects(running,{code:'URGENT_RECOVERY_CLEANUP_UNVERIFIED'});assert.equal(hosts.length,1);}
  else{
   assert.equal(hosts.length,2);assert.equal(hosts[0].closed,true);assert.equal(hosts[1].calls[0].plan,f.plan);assert.equal(hosts[1].calls[0].scheduledWakeAt,f.wakeAt);assert.ok(hosts[1].calls[0].pending.some(x=>x.event.id==='first-cancel'));
   const reserved=f.journal.control.checkpoint().value.urgentRecoveryV1;assert.equal(reserved.fallbackUsed,true);assert.equal(f.states.filter(s=>s.state==='recovering'&&s.code==='HOST_URGENT_TURN_TIMEOUT').length,1);
   t.mock.timers.tick(urgentInterruptMs+interruptTerminalMs);await flush();assert.equal(hosts[1].interrupts.length,0,'included facts cannot recycle a slow fresh host');
   owner(f,'second-cancel');t.mock.timers.tick(100);await flush();t.mock.timers.tick(urgentInterruptMs);await flush();assert.equal(hosts[1].interrupts.length,1);t.mock.timers.tick(interruptTerminalMs);await flush();
   await assert.rejects(running,{code:'URGENT_RECOVERY_BUDGET_EXHAUSTED'});assert.equal(hosts.length,2,'ordinary eight-restart path cannot bypass the one-use ticket');
  }
  const saved=f.journal.control.checkpoint().value;assert.equal(saved.plan,f.plan);assert.equal(saved.wakeAt,f.wakeAt);assert.deepEqual(saved.listenTo,['s_observed']);assert.equal(saved.urgentRecoveryV1.fallbackUsed,true);assert.ok(!saved.pendingDecision);assert.equal(f.journal.control.operations().length,0);assert.ok(f.commands.every(([type])=>type==='read'));assert.ok(f.journal.openOwnerTasks().tasks.some(x=>x.id==='original-owner'));
 }finally{f.stop.abort();await running.catch(()=>{});await f.cleanup();}
});
test('urgent timeout cause survives a host close failure instead of becoming a generic retry',async t=>{
 const f=fixture(t);f.host.interrupt=async function(turnId){this.interrupts.push({turnId,at:Date.now()});return new Promise(()=>{});};
 f.host.close=async function(){this.closed=true;if(this.activeTurnId)this.finish(this.activeTurnId);throw Object.assign(Error('close fault'),{code:'HOST_EXITED'});};
 f.running.catch(()=>{});
 try{
  await flush();owner(f);t.mock.timers.tick(100);await flush();t.mock.timers.tick(urgentInterruptMs);await flush();t.mock.timers.tick(interruptTerminalMs);await flush();
  await assert.rejects(f.running,{code:'HOST_URGENT_TURN_TIMEOUT',urgentFallbackGranted:true});assert.equal(f.journal.control.checkpoint().value.urgentRecoveryV1.fallbackUsed,true);f.retained();
 }finally{await f.cleanup();}
});
test('terminal proof alone does not waive the interrupt ACK/control-chain bound',async t=>{
 const f=fixture(t);f.host.interrupt=async function(turnId){this.interrupts.push({turnId,at:Date.now()});return new Promise(()=>{});};
 f.running.catch(()=>{});
 try{
  await flush();owner(f);t.mock.timers.tick(100);await flush();t.mock.timers.tick(urgentInterruptMs);await flush();assert.equal(f.host.interrupts.length,1);
  f.host.finish('turn-1','completed');await flush();assert.equal(f.host.calls.length,1);t.mock.timers.tick(interruptTerminalMs);await flush();
  await assert.rejects(f.running,{code:'HOST_URGENT_TURN_TIMEOUT',urgentFallbackGranted:true});assert.equal(f.journal.control.checkpoint().value.urgentRecoveryV1.fallbackUsed,true);f.retained();
 }finally{await f.cleanup();}
});
test('queued notifications for an old terminal turn do not steer its replacement',async t=>{
 const f=fixture(t);let release;
 f.host.steer=async function(text,turnId){assert.equal(turnId,this.activeTurnId);this.steers.push({turnId,text:JSON.parse(text),at:Date.now()});return new Promise(resolve=>{release=resolve;});};
 try{
  await flush();f.journal.ingest({source:'world',after:f.journal.cursor('world'),cursor:'ordinary-receipt',events:[{id:'ordinary-receipt',kind:'receipt.started',salience:2}]});t.mock.timers.tick(100);await flush();
  owner(f);t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,1);assert.ok(f.journal.control.checkpoint().value.urgentRecoveryV1);
  f.host.finish('turn-1','completed');await flush();release({accepted:true});await flush();
  assert.equal(f.host.calls.length,2);assert.equal(f.host.steers.length,1,'queued owner steer for the finished turn is skipped, not retargeted');
  assert.ok(f.host.calls[1].pending.some(x=>x.event.id==='owner-cancellation'));assert.equal(f.states.filter(x=>x.state==='host-notified'&&x.mode==='steer').length,1,'only the actual ordinary ACK is delivery evidence');
  t.mock.timers.tick(urgentInterruptMs+interruptTerminalMs);await flush();assert.equal(f.host.interrupts.length,0,'included owner cannot arm the replacement');f.retained();
 }finally{await f.cleanup();}
});
test('a stalled ordinary steer cannot hide a later persisted owner urgency',async t=>{
 const f=fixture(t);f.host.steer=async function(text,turnId){this.steers.push({turnId,text:JSON.parse(text),at:Date.now()});return new Promise(()=>{});};
 f.running.catch(()=>{});
 try{
  await flush();f.journal.ingest({source:'world',after:f.journal.cursor('world'),cursor:'ordinary-receipt',events:[{id:'ordinary-receipt',kind:'receipt.started',salience:2}]});t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,1);
  owner(f);t.mock.timers.tick(100);await flush();t.mock.timers.tick(urgentInterruptMs);await flush();
  assert.equal(f.host.interrupts.length,1,'a blocked non-urgent ACK cannot prevent discovery of later owner authority');assert.equal(f.host.calls.length,1);f.retained();
  f.host.finish('turn-1','completed');await flush();t.mock.timers.tick(interruptTerminalMs);await flush();
  await assert.rejects(f.running,{code:'HOST_URGENT_TURN_TIMEOUT',urgentFallbackGranted:true});assert.equal(f.host.calls.length,1);f.retained();
 }finally{await f.cleanup();}
});
test('natural terminal before grace does not leave a pending urgent steer unbounded',async t=>{
 const f=fixture(t);f.host.steer=async function(text,turnId){this.steers.push({turnId,text:JSON.parse(text),at:Date.now()});return new Promise(()=>{});};
 f.running.catch(()=>{});
 try{
  await flush();owner(f);t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,1);
  t.mock.timers.tick(100);f.host.finish('turn-1','completed');await flush();assert.equal(f.host.calls.length,1);f.retained();
  t.mock.timers.tick(urgentInterruptMs-100);await flush();assert.equal(f.host.interrupts.length,0,'a known exact terminal needs no interrupt RPC');
  t.mock.timers.tick(interruptTerminalMs-1);await flush();assert.equal(f.host.closed,false);assert.equal(f.host.calls.length,1);
  t.mock.timers.tick(1);await flush();await assert.rejects(f.running,{code:'HOST_URGENT_TURN_TIMEOUT',urgentFallbackGranted:true});
  assert.equal(f.host.interrupts.length,0);assert.equal(f.host.calls.length,1);assert.equal(f.journal.control.checkpoint().value.urgentRecoveryV1.fallbackUsed,true);f.retained();
 }finally{await f.cleanup();}
});
test('later urgent ACKs do not postpone the first stale episode grace',async t=>{
 const f=fixture(t);
 try{
  await flush();owner(f,'first-update');t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,1);const first=f.host.steers[0].at;
  t.mock.timers.tick(800);owner(f,'later-update');t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,2);
  t.mock.timers.tick(100);await flush();assert.equal(Date.now(),first+urgentInterruptMs);assert.equal(f.host.interrupts.length,1,'later accepted input must not reset the first grace');assert.equal(f.host.calls.length,1);f.retained();
 }finally{await f.cleanup();}
});
test('direct observation interruption consumes ordinary replan credit rather than bypassing its cap',async t=>{
 const f=fixture(t);
 try{
  await flush();
  for(let n=1;n<=2;n++){
   const id='direct-'+n;f.journal.ingest({source:'world',after:f.journal.cursor('world'),cursor:id,events:[{id,kind:'conversation.turn',salience:3,text:'An observed direct turn'}]});t.mock.timers.tick(100);await flush();
   t.mock.timers.tick(urgentInterruptMs);await flush();assert.equal(f.host.interrupts.length,n);f.host.finish('turn-'+n);await flush();assert.equal(f.host.calls.length,n+1);
  }
  f.journal.ingest({source:'world',after:f.journal.cursor('world'),cursor:'direct-3',events:[{id:'direct-3',kind:'conversation.turn',salience:3}]});t.mock.timers.tick(100);await flush();t.mock.timers.tick(urgentInterruptMs+interruptTerminalMs);await flush();
  assert.equal(f.host.interrupts.length,2,'ordinary direct chatter retains the existing two-replan cap');assert.equal(f.host.calls.length,3);f.retained();
 }finally{await f.cleanup();}
});
