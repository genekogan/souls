import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJournal} from './journal.mjs';
import {runSupervisor} from './supervisor.mjs';
import {runManaged} from './managed.mjs';
import {decisionProgress} from './decision.mjs';
import {abortableSleep} from './receiver.mjs';

const origin=Date.parse('2026-10-30T12:00:00Z');
const urgentInterruptMs=1000,interruptTerminalMs=500,activeDecisionMs=10000;
const flush=async()=>{for(let n=0;n<20;n++)await new Promise(setImmediate);};
const choice=(type='wait',command='wait',args={})=>JSON.stringify({plan:'Retain original errand and appointment',call:{type,command,arguments:JSON.stringify(args)},wakeAt:null});
class Host extends EventEmitter{
 constructor({idleFirst=true}={}){super();this.idleFirst=idleFirst;this.threadId='original-thread';this.activeTurnId=null;this.calls=[];this.turns=new Map();this.interrupts=[];this.steers=[];}
 async connect({threadId}){assert.equal(threadId,this.threadId);}
 async begin(text){
  assert.equal(this.activeTurnId,null);const turnId='turn-'+(this.calls.length+1);this.calls.push(JSON.parse(text));this.activeTurnId=turnId;
  let resolve;const completed=new Promise(r=>resolve=r);this.turns.set(turnId,{resolve,completed});
  if(this.idleFirst&&this.calls.length===1)this.finish(turnId,'completed',choice());
  return {turnId,completed};
 }
 async steer(text,turnId){assert.equal(turnId,this.activeTurnId);this.steers.push({turnId,at:Date.now()});return {accepted:true};}
 async interrupt(turnId){assert.equal(turnId,this.activeTurnId);this.interrupts.push({turnId,at:Date.now()});return this.turns.get(turnId).completed;}
 finish(turnId,status='interrupted',text){assert.equal(turnId,this.activeTurnId);this.activeTurnId=null;this.turns.get(turnId).resolve({turnId,status,...(text?{text}:{})});}
 async close(){this.closed=true;if(this.activeTurnId)this.finish(this.activeTurnId);}
}
function fixture(t,{startRun=true,budget=activeDecisionMs,wakeOffset=null}={}){
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:origin});
 const directory=mkdtempSync(join(tmpdir(),'souls-included-urgent-')),journal=openJournal(directory,{worldId:'world',soulId:'s_me'}),host=new Host(),stop=new AbortController(),commands=[],states=[];
 const fence=journal.control.claim('seed');journal.control.save(fence,0,{threadId:host.threadId,initialInstruction:'Finish the original owner errand',plan:'Retain original errand and appointment',wakeAt:wakeOffset===null?null:new Date(origin+wakeOffset).toISOString(),listenTo:[]});journal.control.release(fence);
 const world={read:async command=>{commands.push(['read',command]);return {here:'native current place'};},write:async command=>{commands.push(['write',command]);return {accepted:true};}};
 for(const method of ['worldPage','ownerPage'])world[method]=async({after,signal})=>{await abortableSleep(1000000000,signal);return {cursor:after,events:[]};};
 const options={journal,host,world,signal:stop.signal,onState:s=>states.push(s),urgentInterruptMs,interruptTerminalMs,activeDecisionMs:budget};
 const running=startRun?runSupervisor(options):null;running?.catch(()=>{});
 const ingest=(id='native-direct',kind='speech.to-me',source='world')=>journal.ingest({source,after:journal.cursor(source),cursor:id,events:[{id,kind,salience:3,text:'Observed native direct speech'}]});
 const cleanup=async()=>{stop.abort();await running?.catch(()=>{});try{journal.close();}catch{}rmSync(directory,{recursive:true,force:true});};
 return {directory,journal,host,world,stop,states,commands,options,running,ingest,cleanup};
}
test('fresh idle direct alert has a bounded exact-turn response attempt without a post-prompt event',async t=>{
 const f=fixture(t);
 try{
  await flush();assert.equal(f.host.calls.length,1);assert.equal(f.host.activeTurnId,null);assert.equal(f.journal.control.checkpoint().value.lastCall.type,'wait');
  f.ingest();t.mock.timers.tick(100);await flush();assert.equal(f.host.calls.length,2);assert.equal(f.host.calls[1].pending[0].event.id,'native-direct');
  const deadline=f.journal.control.checkpoint().value.decisionProgressV1.deadlineAt;
  t.mock.timers.tick(urgentInterruptMs-1);await flush();assert.equal(f.host.interrupts.length,0,'fresh prompt is valid during grace');
  t.mock.timers.tick(1);await flush();assert.equal(f.host.interrupts.length,1,'included direct alert must not await the ordinary window');assert.equal(f.host.interrupts[0].turnId,'turn-2');
  assert.equal(f.host.calls.length,2,'ACK alone is not terminal');assert.equal(f.journal.control.checkpoint().value.decisionProgressV1.deadlineAt,deadline);assert.equal(f.journal.control.operations().length,0);assert.deepEqual(f.commands,[['read','observe']]);
  f.host.finish('turn-2');await flush();assert.equal(f.host.calls.length,3);
  const p=decisionProgress(f.journal.control.checkpoint().value);assert.equal(p.includedUrgency.spent,true);assert.equal(p.worldReplans,1);assert.equal(p.deadlineAt,deadline);assert.equal(p.softUsed,false);assert.equal(p.fallbackUsed,false);
  t.mock.timers.tick(urgentInterruptMs+interruptTerminalMs);await flush();assert.equal(f.host.interrupts.length,1,'same included fact cannot rearm the replacement');
 }finally{await f.cleanup();}
});
for(const source of ['world','owner'])test('a fresh included '+source+' choice completed during grace stays valid and spends no credit',async t=>{
 const f=fixture(t);
 try{
  await flush();f.ingest('direct-fast','speech.to-me',source);t.mock.timers.tick(100);await flush();
  t.mock.timers.tick(urgentInterruptMs-1);f.host.finish('turn-2','completed',choice('write','say',{text:'Agent chosen valid response'}));await flush();
  assert.deepEqual(f.commands,[['read','observe'],['write','say']]);assert.equal(f.host.interrupts.length,0);assert.equal(f.journal.pending().length,0);assert.equal(f.journal.control.checkpoint().value.urgentRecoveryV1,undefined);
  const next=decisionProgress(f.journal.control.checkpoint().value);assert.equal(next.worldReplans,0);assert.equal(next.includedUrgency,undefined);assert.equal(next.softUsed,false);assert.equal(next.fallbackUsed,false);
 }finally{await f.cleanup();}
});
for(const kind of ['receipt.completed','activity.observed','speech.ambient'])test('fresh ordinary '+kind+' does not acquire an included-alert timer',async t=>{
 const f=fixture(t);
 try{
  await flush();f.ingest('ordinary',kind);t.mock.timers.tick(100);await flush();assert.equal(f.host.calls.length,2);assert.equal(decisionProgress(f.journal.control.checkpoint().value).includedUrgency,undefined);
  t.mock.timers.tick(urgentInterruptMs+interruptTerminalMs);await flush();assert.equal(f.host.interrupts.length,0);assert.deepEqual(f.commands,[['read','observe']]);
 }finally{await f.cleanup();}
});
test('natural terminal at the included deadline consumes exactly one direct replan without a guessed interrupt',async t=>{
 const f=fixture(t);
 try{
  await flush();f.ingest();t.mock.timers.tick(100);await flush();const p=decisionProgress(f.journal.control.checkpoint().value);
  t.mock.timers.setTime(p.includedUrgency.deadlineAt);f.host.finish('turn-2','completed',choice('write','say',{text:'Expired choice must not write'}));await flush();
  assert.equal(f.host.interrupts.length,0,'exact terminal needs no interrupt RPC');assert.equal(f.host.calls.length,3);assert.deepEqual(f.commands,[['read','observe']]);
  const next=decisionProgress(f.journal.control.checkpoint().value);assert.equal(next.includedUrgency.spent,true);assert.equal(next.worldReplans,1);assert.equal(next.deadlineAt,p.deadlineAt);
 }finally{await f.cleanup();}
});
test('final admission crossing the included deadline consumes its direct credit durably exactly once',async t=>{
 const f=fixture(t),save=f.journal.control.save,checkpoint=f.journal.control.checkpoint;let ended=false,crossed=false,reads=0,deadline;
 f.journal.control.save=(...args)=>{const r=save(...args);if(args[2].decisionProgressV1?.phase==='ready'&&args[2].decisionProgressV1.includedUrgency&&!args[2].decisionProgressV1.includedUrgency.spent)ended=true;return r;};
 f.journal.control.checkpoint=()=>{const r=checkpoint();if(ended&&!crossed&&++reads===2){crossed=true;t.mock.timers.setTime(deadline);}return r;};
 try{
  await flush();f.ingest();t.mock.timers.tick(100);await flush();deadline=decisionProgress(checkpoint().value).includedUrgency.deadlineAt;
  t.mock.timers.setTime(deadline-1);f.host.finish('turn-2','completed',choice('write','say',{text:'No expired retention'}));await flush();
  assert.equal(crossed,true);assert.equal(f.host.calls.length,3);assert.equal(f.host.interrupts.length,0);assert.deepEqual(f.commands,[['read','observe']]);
  const p=decisionProgress(checkpoint().value);assert.equal(p.includedUrgency.spent,true);assert.equal(p.worldReplans,1);assert.equal(p.softUsed,false);assert.equal(p.window,1);
  t.mock.timers.tick(urgentInterruptMs+interruptTerminalMs);await flush();assert.equal(f.host.calls.length,3);assert.equal(decisionProgress(checkpoint().value).worldReplans,1);
 }finally{await f.cleanup();}
});
test('ordinary expiry coalesces the included attempt without a second timer or a new urgency credit',async t=>{
 const f=fixture(t,{budget:500});
 try{
  await flush();f.ingest();t.mock.timers.tick(100);await flush();t.mock.timers.tick(500);await flush();assert.equal(f.host.interrupts.length,1);assert.equal(f.states.filter(s=>s.state==='host-interrupting')[0].reason,'decision-budget');
  f.host.finish('turn-2');await flush();const p=decisionProgress(f.journal.control.checkpoint().value);assert.equal(p.includedUrgency.spent,true);assert.equal(p.worldReplans,0);assert.equal(p.softUsed,true);assert.equal(p.window,2);
  t.mock.timers.tick(499);await flush();assert.equal(f.host.interrupts.length,1);
 }finally{await f.cleanup();}
});
test('post-prompt owner urgency and included direct grace share one earliest interruption and retain ordinary deadline',async t=>{
 const f=fixture(t);
 try{
  await flush();f.ingest();t.mock.timers.tick(100);await flush();const deadline=decisionProgress(f.journal.control.checkpoint().value).deadlineAt;
  t.mock.timers.tick(200);f.ingest('new-owner','owner','owner');t.mock.timers.tick(100);await flush();
  t.mock.timers.tick(700);await flush();assert.equal(f.host.interrupts.length,1);assert.equal(f.host.interrupts[0].at,origin+1100);
  f.host.finish('turn-2');await flush();const p=decisionProgress(f.journal.control.checkpoint().value);assert.equal(p.includedUrgency.spent,true);assert.equal(p.deadlineAt,deadline);assert.equal(p.worldReplans,0,'owner precedence does not mint or consume a direct credit');
  t.mock.timers.tick(urgentInterruptMs+interruptTerminalMs);await flush();assert.equal(f.host.interrupts.length,1);
 }finally{await f.cleanup();}
});
test('a verified same-thread fallback retains the spent attempt and shares the existing fallback budget',async t=>{
 const f=fixture(t,{startRun:false}),hosts=[];
 const running=runManaged({...f.options,sleep:async()=>{},createHost:()=>{
  const host=new Host({idleFirst:hosts.length===0});host.pid=4000+hosts.length;
  host.interrupt=async function(turnId){assert.equal(turnId,this.activeTurnId);this.interrupts.push({turnId,at:Date.now()});return new Promise(()=>{});};
  host.close=async function(){this.closed=true;if(this.activeTurnId)this.finish(this.activeTurnId);return this.closeProof={hostPid:this.pid,threadId:this.threadId,groupClosed:true,groupVerification:'absent'};};hosts.push(host);return host;
 }});running.catch(()=>{});
 try{
  await flush();f.ingest();t.mock.timers.tick(100);await flush();t.mock.timers.tick(urgentInterruptMs);await flush();assert.equal(hosts[0].interrupts.length,1);
  t.mock.timers.tick(interruptTerminalMs);await flush();assert.equal(hosts.length,2);const p=decisionProgress(f.journal.control.checkpoint().value);assert.equal(p.includedUrgency.spent,true);assert.equal(p.worldReplans,1);assert.equal(p.softUsed,false);assert.equal(p.fallbackUsed,true);assert.equal(p.window,2);assert.equal(hosts[1].calls[0].pending[0].event.id,'native-direct');
  t.mock.timers.tick(urgentInterruptMs+interruptTerminalMs);await flush();assert.equal(hosts[1].interrupts.length,0);assert.equal(hosts.length,2);assert.deepEqual(f.commands,[['read','observe'],['read','observe']]);
 }finally{f.stop.abort();await running.catch(()=>{});await f.cleanup();}
});
test('an included alert never interrupts or replays an already retained uncertain write',async t=>{
 const f=fixture(t);let rejectWrite,writes=0;
 f.world.write=async()=>{writes++;return new Promise((resolve,reject)=>{rejectWrite=reject;});};
 try{
  await flush();f.ingest();t.mock.timers.tick(100);await flush();f.host.finish('turn-2','completed',choice('write','act',{capability:'native-observed'}));await flush();assert.equal(writes,1);const before=decisionProgress(f.journal.control.checkpoint().value);assert.ok(f.journal.control.checkpoint().value.pendingDecision);
  for(let n=0;n<6;n++){t.mock.timers.tick(5000);await flush();}assert.equal(writes,1);assert.equal(f.host.interrupts.length,0);assert.equal(f.host.calls.length,2);rejectWrite(Error('accepted reply lost'));await flush();await assert.rejects(f.running,{code:'OPERATION_UNCERTAIN'});assert.deepEqual(decisionProgress(f.journal.control.checkpoint().value),before);assert.equal(f.journal.control.operations()[0].status,'uncertain');
 }finally{await f.cleanup();}
});
test('committed idle silence has no response timer or extra inference',async t=>{
 const f=fixture(t);
 try{
  await flush();t.mock.timers.tick(urgentInterruptMs+interruptTerminalMs);await flush();assert.equal(f.host.calls.length,1);assert.equal(f.host.activeTurnId,null);assert.equal(f.host.interrupts.length,0);assert.equal(f.journal.control.checkpoint().value.decisionProgressV1,undefined);
 }finally{await f.cleanup();}
});
test('the spent attempt survives actual journal reopen without granting unproven active reentry',async t=>{
 const f=fixture(t);let reopened;
 try{
  await flush();f.ingest();t.mock.timers.tick(100);await flush();t.mock.timers.tick(urgentInterruptMs);await flush();f.host.finish('turn-2');await flush();const prior=decisionProgress(f.journal.control.checkpoint().value);
  f.stop.abort();await f.running;f.journal.close();reopened=openJournal(f.directory,{worldId:'world',soulId:'s_me'});assert.deepEqual(decisionProgress(reopened.control.checkpoint().value),prior);
  const host=new Host({idleFirst:false});await assert.rejects(runSupervisor({...f.options,journal:reopened,host,signal:new AbortController().signal}),{code:'DECISION_PROGRESS_RESTART_UNCONFIRMED'});assert.equal(host.calls.length,0);assert.deepEqual(decisionProgress(reopened.control.checkpoint().value),prior);
 }finally{reopened?.close();await f.cleanup();}
});
for(const completes of [true,false])test('two actual world replans disable included-direct expiry before the cap-limited prompt: '+completes,async t=>{
 const f=fixture(t);
 try{
  await flush();f.ingest();t.mock.timers.tick(100);await flush();const original=decisionProgress(f.journal.control.checkpoint().value);
  for(let n=0;n<2;n++){
   f.ingest('receipt-'+n,'receipt.completed');t.mock.timers.tick(100);await flush();f.host.finish('turn-'+(n+2),'completed',choice('write','say',{text:'Old observation revision'}));await flush();assert.equal(f.host.calls.length,n+3);assert.equal(decisionProgress(f.journal.control.checkpoint().value).worldReplans,n+1);
  }
  const capped=decisionProgress(f.journal.control.checkpoint().value);assert.equal(capped.includedUrgency.spent,true);assert.equal(capped.deadlineAt,original.deadlineAt);assert.equal(capped.window,1);assert.equal(capped.softUsed,false);assert.equal(capped.fallbackUsed,false);assert.equal(f.states.filter(x=>x.state==='included-alert-unavailable'&&x.reason==='world-replan-cap').length,1);
  t.mock.timers.tick(original.includedUrgency.deadlineAt-Date.now());await flush();assert.equal(f.host.interrupts.length,0);assert.equal(f.host.calls.length,4);assert.equal(f.journal.pending().length,3);
  if(completes){f.host.finish('turn-4','completed',choice('write','say',{text:'Valid current cap-limited decision'}));await flush();assert.deepEqual(f.commands,[['read','observe'],['write','say']]);assert.equal(f.journal.pending().length,0);}
  else{for(let n=0;Date.now()<original.deadlineAt;n++){t.mock.timers.tick(Math.min(1000,original.deadlineAt-Date.now()));await flush();}assert.equal(f.host.interrupts.length,1);assert.equal(f.states.filter(x=>x.state==='host-interrupting').at(-1).reason,'decision-budget');assert.equal(f.host.interrupts[0].at,original.deadlineAt);assert.equal(decisionProgress(f.journal.control.checkpoint().value).worldReplans,2);}
 }finally{await f.cleanup();}
});
test('a saved wake and included response deadline coalesce at the earlier response boundary without rearming the due wake',async t=>{
 const f=fixture(t,{wakeOffset:500});
 try{
  await flush();f.ingest();t.mock.timers.tick(100);await flush();const deadline=decisionProgress(f.journal.control.checkpoint().value).deadlineAt;
  t.mock.timers.tick(400);await flush();assert.ok(f.host.steers.length);t.mock.timers.tick(600);await flush();assert.equal(f.host.interrupts.length,1);assert.equal(f.host.interrupts[0].at,origin+1100);
  f.host.finish('turn-2');await flush();const p=decisionProgress(f.journal.control.checkpoint().value);assert.equal(p.includedUrgency.spent,true);assert.equal(p.deadlineAt,deadline);assert.equal(p.worldReplans,0);assert.equal(f.journal.control.checkpoint().value.wakeAt,new Date(origin+500).toISOString());
  t.mock.timers.tick(urgentInterruptMs+interruptTerminalMs);await flush();assert.equal(f.host.interrupts.length,1);assert.equal(f.host.calls.length,3);
 }finally{await f.cleanup();}
});
test('known terminal plus stalled ordinary control ACK stays inside the included confirmation bound',async t=>{
 const f=fixture(t);f.host.steer=async()=>new Promise(()=>{});
 try{
  await flush();f.ingest();t.mock.timers.tick(100);await flush();f.ingest('ordinary-control','receipt.completed');t.mock.timers.tick(100);await flush();
  f.host.finish('turn-2','completed',choice('write','say',{text:'Still awaiting control confirmation'}));await flush();
  t.mock.timers.tick(900);await flush();assert.equal(f.host.interrupts.length,0);assert.equal(f.host.calls.length,2);
  t.mock.timers.tick(interruptTerminalMs);await flush();await assert.rejects(f.running,{code:'HOST_URGENT_TURN_TIMEOUT'});assert.equal(f.host.calls.length,2);assert.deepEqual(f.commands,[['read','observe']]);const p=decisionProgress(f.journal.control.checkpoint().value);assert.equal(p.includedUrgency.spent,true);assert.equal(p.worldReplans,1);assert.equal(p.fallbackUsed,true);
 }finally{await f.cleanup();}
});
test('an expired response grace cannot invent exact-turn authority while begin ACK is pending',async t=>{
 const f=fixture(t),begin=f.host.begin.bind(f.host);let release;
 f.host.begin=async text=>{const result=await begin(text);if(f.host.calls.length===2)await new Promise(resolve=>{release=resolve;});return result;};
 try{
  await flush();f.ingest();t.mock.timers.tick(100);await flush();t.mock.timers.tick(urgentInterruptMs+100);await flush();assert.equal(f.host.interrupts.length,0,'no acknowledged turn ID exists in supervisor');
  release();await flush();assert.equal(f.host.interrupts.length,1);assert.equal(f.host.interrupts[0].turnId,'turn-2');assert.equal(f.host.interrupts[0].at,Date.now());assert.equal(f.host.calls.length,2);
 }finally{await f.cleanup();}
});
