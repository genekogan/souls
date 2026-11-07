import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJournal} from './journal.mjs';
import {runSupervisor,attentionPriority,presenceCooldown,PRESENCE_COOLDOWN_MS,PRESENCE_COOLDOWN_SUBJECTS} from './supervisor.mjs';
import {abortableSleep} from './receiver.mjs';
import {parseDecision,retainDecision,applyPendingDecision} from './decision.mjs';
const waitDecision={plan:'Resume the reading appointment after interruption',call:{type:'wait',command:'',arguments:'{}'},wakeAt:null};
class Host extends EventEmitter{
 constructor(){super();this.threadId='thread';this.calls=[];this.steers=[];this.closed=false;}
 async connect(){}
 async begin(prompt){this.calls.push(JSON.parse(prompt));this.activeTurnId='t'+this.calls.length;let resolve;const completed=new Promise(r=>resolve=r);this.finish=decision=>{this.activeTurnId=null;resolve({status:'completed',text:JSON.stringify(decision)});};this.rejectTurn=()=>resolve({status:'interrupted'});return {turnId:this.activeTurnId,completed};}
 async steer(text){this.steers.push(JSON.parse(text));}
 async close(){this.closed=true;this.rejectTurn?.();}
}
async function until(fn){for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Condition timed out');}
// Drain asynchronous receiver/host continuations without advancing mocked time.
async function flushTurns(){for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));}
function setup(t,options={}){const dir=mkdtempSync(join(tmpdir(),'souls-supervisor-'));const journal=openJournal(dir,{worldId:'w',soulId:'s',...options});const host=new Host(),stop=new AbortController();t.after(()=>{journal.close();rmSync(dir,{recursive:true,force:true});});let reads=0;const world={read:async()=>({here:'library'}),worldPage:async({after,signal})=>{reads++;await abortableSleep(10000,signal);return {cursor:after,events:[]};},ownerPage:async({after,signal})=>{await abortableSleep(10000,signal);return {cursor:after,events:[]};}};return {dir,journal,host,stop,world,reads:()=>reads};}
test('event during inference is durably steered and obsolete action is discarded',async t=>{
 const f=setup(t);let effects=0;f.world.write=async()=>{effects++;return {accepted:true};};
 const running=runSupervisor({...f,instruction:'Read then attend appointment',signal:f.stop.signal});
 await until(()=>f.host.calls.length===1);
 f.journal.ingest({source:'world',after:null,cursor:'c_1',events:[{id:'c_1',kind:'conversation.turn',text:'Hello'}]});
 await until(()=>f.host.steers.length===1);
 assert.equal(f.journal.pending().length,1);
 f.host.finish({...waitDecision,call:{type:'write',command:'say',arguments:'{"text":"obsolete"}'}});
 await until(()=>f.host.calls.length===2);assert.equal(effects,0);assert.equal(f.host.calls[1].pending.length,1);
 f.host.finish(waitDecision);await until(()=>f.journal.pending().length===0);
 assert.equal(f.journal.control.checkpoint().value.initialInstruction,'Read then attend appointment');
 await new Promise(r=>setTimeout(r,150));assert.equal(f.host.calls.length,2,'waiting must not poll the model');
 f.stop.abort();await running;assert.equal(f.host.closed,true);
});
test('host failure stops intake and releases the local controller',async t=>{
 const f=setup(t);const running=runSupervisor({...f,instruction:'Read',signal:f.stop.signal});
 await until(()=>f.host.calls.length===1);f.host.emit('fault',Error('inference unavailable'));
 await assert.rejects(running,/inference unavailable/);assert.equal(f.host.closed,true);
 const next=f.journal.control.claim('successor');assert.ok(next.generation>1);
});
test('external stop interrupts a pending model turn instead of waiting indefinitely',async t=>{
 const f=setup(t);const running=runSupervisor({...f,instruction:'Read',signal:f.stop.signal});
 await until(()=>f.host.calls.length===1);f.stop.abort();await running;assert.equal(f.host.closed,true);
});
test('fresh adoption starts at observed head rather than replying to old historical speech',async t=>{
 const f=setup(t);f.world.read=async()=>({streamCursor:'c_88'});let firstCursor;
 f.world.worldPage=async({after,signal})=>{firstCursor=after;await abortableSleep(10000,signal);return {cursor:after,events:[]};};
 const running=runSupervisor({...f,instruction:'Read',signal:f.stop.signal});await until(()=>f.host.calls.length===1);assert.equal(firstCursor,'c_88');f.stop.abort();await running;
});

test('startup reconciliation proof binds the live fence and retained state without exposing private task text',async t=>{
 const f=setup(t),states=[],instruction='PRIVATE_INSTRUCTION_CANARY';let reconciledCheckpoint;
 const running=runSupervisor({...f,instruction,signal:f.stop.signal,onState:s=>{states.push(s);if(s.state==='startup-reconciled')reconciledCheckpoint=f.journal.control.checkpoint();}});
 try{
  await until(()=>f.host.calls.length===1);const proof=states.find(s=>s.state==='startup-reconciled'),checkpoint=f.journal.control.checkpoint();
  assert.equal(proof.initialInstructionSha256,createHash('sha256').update(instruction).digest('hex'));assert.equal(proof.threadId,'thread');assert.equal(proof.checkpointRevision,reconciledCheckpoint.revision);assert.ok(checkpoint.revision>proof.checkpointRevision);assert.equal(checkpoint.value.decisionProgressV1.phase,'active');assert.equal(proof.generation,1);assert.equal(proof.pendingDecision,false);assert.equal(proof.unreconciledOperations,0);assert.equal(proof.wakeAt,null);assert.deepEqual(JSON.parse(f.journal.control.response({kind:'startup',id:proof.startupResponseId}).text),f.host.calls[0].observation);assert(!JSON.stringify(proof).includes(instruction));assert(states.indexOf(proof)<states.findIndex(s=>s.state==='running'));
 }finally{f.stop.abort();await running;}
});

test('pending effect reconciliation must complete before startup proof or inference; receiver metadata does not wake inference',async t=>{
 const f=setup(t),states=[],fence=f.journal.control.claim('old');
 const decision=parseDecision(JSON.stringify({plan:'Preserve suspended task',call:{type:'write',command:'say',arguments:'{"text":"one effect"}'},wakeAt:new Date(Date.now()+60000).toISOString()}));
 const operationId=retainDecision(f.journal,fence,decision,{threadId:'thread',initialInstruction:'Original mission'});f.journal.control.prepare(fence,operationId,decision.call);f.journal.control.dispatch(fence,operationId);f.journal.control.uncertain(fence,operationId);f.journal.control.release(fence);
 let entered,release;const reconciling=new Promise(r=>entered=r),gate=new Promise(r=>release=r);f.world.reconcile=async()=>{entered();await gate;return {state:'recorded',response:{said:{id:'speech-original'}}};};
 for(const method of ['worldPage','ownerPage']){let first=true;f.world[method]=async({after,signal})=>{if(first){first=false;return {cursor:after,events:[]};}await abortableSleep(10000,signal);return {cursor:after,events:[]};};}
 const running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s)});
 try{
  await reconciling;assert.equal(states.some(s=>s.state==='startup-reconciled'),false);assert.equal(f.host.calls.length,0);release();await until(()=>f.host.calls.length===1);
  const proof=states.find(s=>s.state==='startup-reconciled');assert.equal(proof.generation,2);assert.equal(proof.pendingDecision,false);assert.equal(proof.unreconciledOperations,0);assert.equal(f.journal.control.operation(operationId).status,'settled');await until(()=>states.filter(s=>s.state==='receiver-ready').length===2);
  f.host.finish(waitDecision);await until(()=>f.journal.control.checkpoint().value.lastCall?.type==='wait');await new Promise(r=>setTimeout(r,150));assert.equal(f.host.calls.length,1,'empty receiver adoption metadata must not trigger model inference');
 }finally{release();f.stop.abort();await running;}
});
test('continuing world chatter cannot starve effects, but a new owner cancellation always invalidates them',async t=>{
 const f=setup(t);let effects=0;f.world.write=async()=>{effects++;return {accepted:true}};
 const running=runSupervisor({...f,instruction:'Reply then leave',signal:f.stop.signal});
 const say={...waitDecision,call:{type:'write',command:'say',arguments:'{"text":"I must go now"}'}};
 for(let n=1;n<=2;n++){
  await until(()=>f.host.calls.length===n);f.journal.ingest({source:'world',after:n===1?null:'c_'+(n-1),cursor:'c_'+n,events:[{id:'c_'+n,kind:'speech.to-me',salience:3}]});
  await until(()=>f.host.steers.length===n);f.host.finish(say);
 }
 await until(()=>f.host.calls.length===3);f.journal.ingest({source:'owner',after:null,cursor:'cancel',events:[{id:'cancel',text:'Stop; do not speak'}]});
 await until(()=>f.host.steers.length===3);f.host.finish(say);await until(()=>f.host.calls.length===4);assert.equal(effects,0);
 f.journal.ingest({source:'world',after:'c_2',cursor:'c_3',events:[{id:'c_3',kind:'speech.to-me',salience:3}]});await until(()=>f.host.steers.length===4);
 // The fourth turn includes cancellation and chooses a read, which may proceed
 // despite continuing chatter. The late chatter remains pending for next turn.
 f.host.finish({...waitDecision,call:{type:'read',command:'here',arguments:'{}'}});await until(()=>f.host.calls.length===5);
 assert.equal(f.host.calls[4].lastCall.command,'here');assert.equal(f.host.calls[4].pending.some(e=>e.event.id==='c_3'),true);assert.equal(effects,0);
 f.stop.abort();await running;
});
test('handled original owner identity reaches every recovery prompt even when saved plan forgot it',async t=>{
 const f=setup(t),id='msg_original';f.journal.ingest({source:'owner',after:null,cursor:id,events:[{id,text:'Read, return, and report the outcome',sentAt:42}]});f.journal.handled('owner',id,'incorporated:old-decision');
 const fence=f.journal.control.claim('old');f.journal.control.save(fence,0,{plan:'I cannot see a reportable request ID',threadId:'thread'});f.journal.control.release(fence);
 const running=runSupervisor({...f,signal:f.stop.signal});
 try{
  await until(()=>f.host.calls.length===1);const prompt=f.host.calls[0];assert.equal(prompt.pending.length,0);assert.equal(prompt.openOwnerTasks.tasks[0].id,id);assert.equal(prompt.openOwnerTasks.tasks[0].text,'Read, return, and report the outcome');assert.match(prompt.plan,/cannot see/);
  f.host.finish({...waitDecision,call:{type:'read',command:'tasks',arguments:'{}'}});await until(()=>f.host.calls.length===2);assert.equal(f.host.calls[1].lastResult.tasks[0].id,id);assert.equal(f.host.calls[1].openOwnerTasks.tasks[0].id,id);
 }finally{f.stop.abort();await running;}
});
test('host-notified start and steer are emitted only after acknowledgement and list exactly bounded delivered facts',async t=>{
 const f=setup(t),states=[];f.journal.ingest({source:'world',after:null,cursor:'old30',events:Array.from({length:30},(_,i)=>({id:'old'+(i+1),text:'x'.repeat(3000),salience:3}))});
 const begin=f.host.begin.bind(f.host),steer=f.host.steer.bind(f.host);let acceptStart,acceptSteer;
 const startGate=new Promise(r=>acceptStart=r),steerGate=new Promise(r=>acceptSteer=r);
 f.host.begin=async(...args)=>{const turn=await begin(...args);await startGate;return turn;};f.host.steer=async(...args)=>{await steer(...args);await steerGate;};
 const running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s)});
 try{
  await until(()=>f.host.calls.length===1);assert.equal(states.some(s=>s.state==='host-notified'),false);acceptStart();await until(()=>states.some(s=>s.state==='host-notified'));
  const started=states.find(s=>s.state==='host-notified');assert.equal(started.mode,'start');assert.deepEqual(started.events,f.host.calls[0].pending.map(p=>({source:p.source,id:p.event.id})));assert.ok(started.events.length<30);assert.equal(started.turnId,'t1');assert.equal(started.threadId,'thread');assert.ok(Number.isFinite(started.at));
  f.journal.ingest({source:'world',after:'old30',cursor:'new30',events:Array.from({length:30},(_,i)=>({id:'new'+(i+1),text:'x'.repeat(3000),salience:3}))});await until(()=>f.host.steers.length===1);assert.equal(states.filter(s=>s.state==='host-notified').length,1);
  acceptSteer();await until(()=>states.filter(s=>s.state==='host-notified').length===2);const steered=states.filter(s=>s.state==='host-notified')[1];assert.equal(steered.mode,'steer');assert.deepEqual(steered.events,f.host.steers[0].pending.map(p=>({source:p.source,id:p.event.id})));assert.ok(steered.events.length<30);assert.equal(f.journal.pending().length,60,'delivery telemetry never marks incorporation');
 }finally{acceptStart();acceptSteer();f.stop.abort();await running;}
});
test('failed steer acknowledgement never claims host delivery',async t=>{
 const f=setup(t),states=[];f.host.steer=async()=>{throw Error('stale turn')};const running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s)});
 try{
  await until(()=>f.host.calls.length===1);f.journal.ingest({source:'world',after:null,cursor:'c1',events:[{id:'c1',kind:'conversation.turn'}]});await new Promise(r=>setTimeout(r,150));assert.equal(states.some(s=>s.state==='host-notified'&&s.mode==='steer'),false);assert.equal(f.journal.pending().length,1);
 }finally{f.stop.abort();await running;}
});
test('large startup observation is persisted separately and delivered as a bounded retrievable reference',async t=>{
 const f=setup(t),owner=f.journal.control.claim('previous'),prior={text:'saved native read '.repeat(3000)};
 const read=parseDecision(JSON.stringify({...waitDecision,call:{type:'read',command:'observe',arguments:'{}'}}));
 const readId=retainDecision(f.journal,owner,read);await applyPendingDecision(f.journal,owner,{read:async()=>prior});f.journal.control.release(owner);
 const native={streamCursor:'c_88',description:'界'.repeat(50000)};let reads=0;
 f.world.read=async command=>{reads++;assert.equal(command,'observe');return native;};
 const running=runSupervisor({...f,signal:f.stop.signal});
 try{
  await until(()=>f.host.calls.length===1);const prompt=f.host.calls[0];assert.ok(Buffer.byteLength(JSON.stringify(prompt))<16384);assert.equal(prompt.observation.responseOmitted,true);assert.equal(prompt.observation.responseRef.kind,'startup');assert.equal(prompt.lastResult.responseRef.id,readId);assert.deepEqual(f.journal.control.readResult(readId).response,prior);assert.equal(f.journal.cursor('world'),'c_88');
  f.host.finish({...waitDecision,call:{type:'read',command:'response',arguments:JSON.stringify(prompt.observation.retrieve.args)}});
  await until(()=>f.host.calls.length===2);const chunk=f.host.calls[1].lastResult;assert.equal(chunk.responseRef.id,prompt.observation.responseRef.id);assert.ok(Buffer.byteLength(JSON.stringify(chunk))<=24576);assert.ok(JSON.stringify(native).startsWith(chunk.text));assert.equal(reads,1);assert.deepEqual(f.journal.control.readResult(readId).response,prior);
 }finally{f.stop.abort();await running;}
});
test('startup recovery gives the model a pending read refusal instead of terminating the controller',async t=>{
 const f=setup(t),owner=f.journal.control.claim('previous');retainDecision(f.journal,owner,{plan:'Inspect a remembered object',call:{type:'read',command:'object',args:{id:'missing'}},wakeAt:null});f.journal.control.release(owner);
 f.world.read=async command=>{if(command==='object')throw Object.assign(Error('no such object here'),{code:'not-found',status:404,uncertain:false});return {here:'library'};};
 const running=runSupervisor({...f,signal:f.stop.signal});
 try{await until(()=>f.host.calls.length===1);assert.equal(f.host.calls[0].lastCall.command,'object');assert.deepEqual(f.host.calls[0].lastResult,{accepted:false,error:{code:'not-found',message:'no such object here',status:404}});assert.equal(f.journal.control.checkpoint().value.pendingDecision,null);}
 finally{f.stop.abort();await running;}
});
test('ordinary 35984-byte startup observation arrives whole in the first model prompt',async t=>{
 const f=setup(t),empty={streamCursor:'c_88',description:''},native={...empty,description:'x'.repeat(35984-Buffer.byteLength(JSON.stringify(empty)))};let reads=0;
 f.world.read=async command=>{reads++;assert.equal(command,'observe');return native;};const running=runSupervisor({...f,signal:f.stop.signal});
 try{await until(()=>f.host.calls.length===1);assert.equal(Buffer.byteLength(JSON.stringify(native)),35984);assert.deepEqual(f.host.calls[0].observation,native);assert.equal(reads,1);assert.equal(f.journal.cursor('world'),'c_88');}
 finally{f.stop.abort();await running;}
});
const ambient=(id,speaker='s_presenter')=>({id,kind:'speech.ambient',raw:'speech',salience:1,about:{soulId:speaker,name:'Observed participant'},data:{from:{soulId:speaker,name:'Observed participant'},text:'Untrusted native public speech'}});
const listeningWait=(listenTo,wakeAt=null)=>({...waitDecision,call:{type:'wait',command:'wait',arguments:JSON.stringify({listenTo})},wakeAt});
test('a preexisting latest owner cancellation survives prompt byte bounds without consuming omitted older intent',async t=>{
 const f=setup(t);let writes=0;f.world.write=async()=>{writes++;return {accepted:true}};
 const messages=[...Array.from({length:100},(_,i)=>({id:'old'+i,text:'Continue the original errand. '+ 'x'.repeat(900)})),{id:'latest-cancel',text:'Cancel the original errand now. Stay here.'}];
 f.journal.ingest({source:'owner',after:null,cursor:'latest-cancel',events:messages});
 const running=runSupervisor({...f,signal:f.stop.signal});
 try{
  await until(()=>f.host.calls.length===1);const prompt=f.host.calls[0];
  assert.equal(prompt.pending[0].event.id,'latest-cancel');assert.equal(prompt.pending[0].sequence,101);
  assert.ok(prompt.pending.length<messages.length,'bounded prompt retains omissions');assert.equal(prompt.openOwnerTasks.totalOpen,101);
  f.host.finish(prompt.pending.some(p=>p.event.id==='latest-cancel')?waitDecision:{...waitDecision,call:{type:'write',command:'say',arguments:'{"text":"obsolete errand"}'}});
  await until(()=>f.host.calls.length===2);assert.equal(writes,0);
  const remaining=f.journal.pending(1000);assert.ok(remaining.length>0);assert.equal(remaining.length,messages.length-prompt.pending.length);
  assert.ok(!remaining.some(p=>p.event.id==='latest-cancel'));assert.equal(f.journal.openOwnerTasks().totalOpen,101,'incorporation never closes owner tasks');
 }finally{f.stop.abort();await running;}
});
test('a busy bounded steer includes the newest owner update ahead of a large older backlog',async t=>{
 const f=setup(t),running=runSupervisor({...f,signal:f.stop.signal});
 try{
  await until(()=>f.host.calls.length===1);
  f.journal.ingest({source:'owner',after:null,cursor:'cancel',events:[...Array.from({length:100},(_,i)=>({id:'older'+i,text:'Keep the previous plan. '+ 'x'.repeat(900)})),{id:'cancel',text:'Stop the previous plan now.'}]});
  await until(()=>f.host.steers.length===1);assert.equal(f.host.steers[0].pending[0].event.id,'cancel');
  assert.ok(f.host.steers[0].pending.length<=20);assert.equal(f.journal.pending(1000).length,101,'steering alone does not mark handling');
 }finally{f.stop.abort();await running;}
});
test('immediate replan reads latest owner authority before the dispatcher hint cache catches up',async t=>{
 const f=setup(t);let writes=0;f.world.write=async()=>{writes++;return {accepted:true}};
 f.journal.ingest({source:'owner',after:null,cursor:'old99',events:Array.from({length:100},(_,i)=>({id:'old'+i,text:'Continue previous errand. '+ 'x'.repeat(900)}))});
 const begin=f.host.begin.bind(f.host);let count=0;
 f.host.begin=async(...args)=>{const turn=await begin(...args);if(++count===1)f.journal.ingest({source:'owner',after:'old99',cursor:'cancel',events:[{id:'cancel',text:'Cancel the previous errand now.'}]});
  if(count<=2)f.host.finish(count===2&&!f.host.calls.at(-1).pending.some(p=>p.event.id==='cancel')?{...waitDecision,call:{type:'write',command:'say',arguments:'{"text":"obsolete"}'}}:waitDecision);return turn;};
 const running=runSupervisor({...f,signal:f.stop.signal});
 try{await until(()=>f.host.calls.length>=3);assert.equal(f.host.calls[1].pending[0].event.id,'cancel');assert.equal(writes,0);assert.ok(f.journal.pendingOwner(1000).length>0,'undelivered older intent remains pending');}
 finally{f.stop.abort();await running;}
});
test('listening matches exact native ambient speaker identities without inferring relevance from text',()=>{
 const event=ambient('c_1'),fact={source:'world',event};assert.equal(attentionPriority(fact,['s_presenter']),1);assert.equal(attentionPriority(fact,[]),0);assert.equal(attentionPriority(fact,['s_other']),0);assert.equal(attentionPriority(fact,'nearby'),1);
 assert.equal(attentionPriority({source:'world',event:{...event,raw:'receipt'}},'nearby'),0);assert.equal(attentionPriority({source:'world',event:{...event,data:{from:{soulId:'s_other'},text:'s_presenter'}}},['s_presenter']),0);assert.equal(attentionPriority({source:'world',event:{...event,kind:'world.narration'}},'nearby'),0);assert.equal(attentionPriority({source:'world',event:{id:'direct',salience:3}},[]),3);assert.equal(attentionPriority({source:'owner',event:{id:'m1',salience:0}},[]),4);
});
test('presence cooldown is per subject, uses receipt time, and its in-memory map stays bounded',()=>{
 const fact=(soulId,receivedAt,kind='arrive.here')=>({source:'world',receivedAt,event:{id:soulId+receivedAt,kind,raw:kind==='arrive.here'?'arrival':'departure',salience:1,about:{soulId,name:'Observed'},data:{soul:{soulId,name:'Observed'}}}});
 assert.equal(PRESENCE_COOLDOWN_MS,300000);assert.ok(PRESENCE_COOLDOWN_SUBJECTS>=16);
 const c=presenceCooldown({limit:2});assert.equal(c.priority(fact('s_a',0),'nearby'),1);c.delivered([fact('s_a',0)],'nearby',1000);
 assert.equal(c.priority(fact('s_a',1000+PRESENCE_COOLDOWN_MS-1,'leave.here'),'nearby'),0);assert.equal(c.priority(fact('s_a',1000+PRESENCE_COOLDOWN_MS),'nearby'),1);assert.equal(c.priority(fact('s_b',2000),'nearby'),1);
 c.delivered([fact('s_a',5000)],'nearby',6000);assert.equal(c.priority(fact('s_a',1000+PRESENCE_COOLDOWN_MS),'nearby'),1,'a cooled delivery does not extend the cooldown');
 assert.equal(c.priority(fact('s_a',2000),[]),0,'unattended presence stays priority 0');assert.equal(c.priority({source:'owner',event:{id:'m'}},[]),4);
 c.delivered([fact('s_b',2000),fact('s_c',2000)],'nearby',3000);assert.equal(c.size,2);assert.equal(c.priority(fact('s_a',4000),'nearby'),1,'the least recently delivered subject is evicted first');assert.equal(c.priority(fact('s_c',4000),'nearby'),0);
 const big=presenceCooldown();for(let i=0;i<PRESENCE_COOLDOWN_SUBJECTS*3;i++)big.delivered([fact('s_'+i,i)],'nearby',i);assert.equal(big.size,PRESENCE_COOLDOWN_SUBJECTS);
});
test('native arrival/departure of an attended Soul is ambient priority; unattended presence and closures stay quiet',()=>{
 const presence=(kind,soulId='s_presenter')=>({id:'p_1',kind,raw:kind==='arrive.here'?'arrival':'departure',salience:1,about:{soulId,name:'Observed participant'},data:{placeId:'p_place',soul:{soulId,name:'Observed participant'},untrusted:true},text:'Observed participant moved'});
 for(const kind of ['arrive.here','leave.here']){
  const event=presence(kind),fact={source:'world',event};
  assert.equal(attentionPriority(fact,'nearby'),1);assert.equal(attentionPriority(fact,['s_presenter']),1);assert.equal(attentionPriority(fact,[]),0);assert.equal(attentionPriority(fact,['s_other']),0);assert.equal(attentionPriority(fact),0);
  assert.equal(attentionPriority({source:'world',event:{...event,raw:'speech'}},'nearby'),0);assert.equal(attentionPriority({source:'world',event:{...event,about:undefined}},'nearby'),0);assert.equal(attentionPriority({source:'world',event:{...event,data:{...event.data,soul:{soulId:'s_other'}}}},['s_presenter']),0);assert.equal(attentionPriority({source:'owner',event},[]),4);
 }
 assert.equal(attentionPriority({source:'world',event:{id:'c',kind:'conversation.closed',raw:'conversation.closed',salience:1,data:{conversation:'cv_1',reason:'ended'}}},'nearby'),0);
 assert.equal(attentionPriority({source:'world',event:{id:'r',kind:'receipt.started',raw:'receipt',salience:1,about:{soulId:'s_presenter'}}},'nearby'),0);
});
test('saved mute remains quiet and is delivered with the next urgent owner prompt',async t=>{
 const f=setup(t),owner=f.journal.control.claim('setup');f.journal.control.save(owner,0,{listenTo:[]});f.journal.control.release(owner);
 const states=[],running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s),ambientWakeMs:30});
 try{
  await until(()=>f.host.calls.length===1);f.host.finish(waitDecision);await until(()=>f.journal.control.checkpoint().value.lastCall?.type==='wait');
  f.journal.ingest({source:'world',after:null,cursor:'ambient',events:[ambient('ambient')]});await new Promise(r=>setTimeout(r,180));assert.equal(f.host.calls.length,1);assert.equal(f.host.steers.length,0);assert.equal(f.journal.pending().length,1);
  f.journal.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Reconsider the current plan'}]});await until(()=>f.host.calls.length===2);assert.equal(f.host.calls[1].pending[0].event.id,'m1');assert.ok(f.host.calls[1].pending.some(f=>f.event.id==='ambient'));assert.deepEqual(f.host.calls[1].listenTo,[]);assert.ok(states.some(s=>s.state==='host-notified'&&s.events.some(e=>e.id==='m1')));
 }finally{f.stop.abort();await running;}
});
test('a newly chosen listening scope finds ambient speech behind quiet rows and retains the departure deadline',async t=>{
 const f=setup(t),states=[],wakeAt=new Date(Date.now()+60000).toISOString(),owner=f.journal.control.claim('setup');f.journal.control.save(owner,0,{listenTo:[]});f.journal.control.release(owner);
 f.journal.ingest({source:'world',after:null,cursor:'speech',events:[...Array.from({length:200},(_,i)=>({id:'quiet'+i,kind:'receipt.started',salience:1,text:'Quiet bookkeeping'})),ambient('speech')]});
 const running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s),ambientWakeMs:30});
 try{
  await until(()=>f.host.calls.length===1);assert.ok(!f.host.calls[0].pending.some(e=>e.event.id==='speech'));f.host.finish(listeningWait(['s_presenter'],wakeAt));
  await until(()=>f.host.calls.length===2);const prompt=f.host.calls[1];assert.equal(prompt.pending[0].event.id,'speech');assert.deepEqual(prompt.listenTo,['s_presenter']);assert.equal(prompt.scheduledWakeAt,wakeAt);assert.equal(f.journal.control.checkpoint().value.wakeAt,wakeAt);assert.ok(Number.isFinite(f.journal.control.checkpoint().value.lastAmbientDeliveryAt));
  const delivery=states.filter(s=>s.state==='host-notified'&&s.mode==='start')[1];assert.deepEqual(delivery.events,prompt.pending.map(f=>({source:f.source,id:f.event.id})));
 }finally{f.stop.abort();await running;}
});
test('busy ambient input never restarts inference; idle bursts are coalesced and empty listening never polls the model',async t=>{
 const f=setup(t),owner=f.journal.control.claim('setup');f.journal.control.save(owner,0,{listenTo:['s_presenter']});f.journal.control.release(owner);let writes=0;f.world.write=async()=>{writes++;return {accepted:true}};
 const running=runSupervisor({...f,signal:f.stop.signal,ambientWakeMs:300});
 try{
  await until(()=>f.host.calls.length===1);f.journal.ingest({source:'world',after:null,cursor:'a9',events:Array.from({length:10},(_,i)=>ambient('a'+i))});await new Promise(r=>setTimeout(r,150));assert.equal(f.host.calls.length,1);assert.equal(f.host.steers.length,0);
  f.host.finish({...waitDecision,call:{type:'write',command:'say',arguments:'{"text":"A freely chosen reply"}'}});await until(()=>f.host.calls.length===2);assert.equal(writes,1);assert.equal(f.host.calls[1].pending.filter(f=>f.event.kind==='speech.ambient').length,10);
  f.host.finish(waitDecision);await until(()=>f.journal.pending().length===0);f.journal.ingest({source:'world',after:'a9',cursor:'b49',events:Array.from({length:50},(_,i)=>ambient('b'+i))});await new Promise(r=>setTimeout(r,100));assert.equal(f.host.calls.length,2);
  await until(()=>f.host.calls.length===3);assert.equal(f.host.calls[2].pending.filter(f=>f.event.kind==='speech.ambient').length,50);assert.equal(f.host.steers.length,0);f.host.finish(waitDecision);await until(()=>f.journal.pending().length===0);await new Promise(r=>setTimeout(r,350));assert.equal(f.host.calls.length,3);
 }finally{f.stop.abort();await running;}
});
test('owner/direct events steer first after a delayed begin acknowledgement, with exact delivered IDs',async t=>{
 const f=setup(t),states=[],owner=f.journal.control.claim('setup');f.journal.control.save(owner,0,{listenTo:'nearby'});f.journal.control.release(owner);let accept;const gate=new Promise(r=>accept=r),begin=f.host.begin.bind(f.host);f.host.begin=async(...args)=>{const turn=await begin(...args);await gate;return turn;};let writes=0;f.world.write=async()=>{writes++;return {accepted:true}};
 const running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s),ambientWakeMs:300});
 try{
  await until(()=>f.host.calls.length===1);f.journal.ingest({source:'world',after:null,cursor:'direct',events:[...Array.from({length:30},(_,i)=>({id:'quiet'+i,kind:'receipt.started',salience:1,text:'x'.repeat(1000)})),ambient('ambient'),{id:'direct',kind:'speech.to-me',raw:'speech',salience:3}]});f.journal.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'New owner instruction'}]});await new Promise(r=>setTimeout(r,150));assert.equal(f.host.steers.length,0);assert.equal(states.some(s=>s.state==='host-notified'),false);
  accept();await until(()=>f.host.steers.length===1);assert.deepEqual(f.host.steers[0].pending.map(f=>f.event.id),['m1','direct']);const proof=states.find(s=>s.state==='host-notified'&&s.mode==='steer');assert.deepEqual(proof.events,[{source:'owner',id:'m1'},{source:'world',id:'direct'}]);
  f.host.finish({...waitDecision,call:{type:'write',command:'say',arguments:'{"text":"obsolete"}'}});await until(()=>f.host.calls.length===2);assert.equal(writes,0);assert.equal(f.host.calls[1].pending[0].event.id,'m1');assert.equal(f.host.calls[1].pending[1].event.id,'direct');assert.equal(f.host.calls[1].pending[2].event.id,'ambient');
 }finally{accept();f.stop.abort();await running;}
});
test('listening scope and batch timestamp survive connection restart; explicit clear stops ambient wakes',async t=>{
 const f=setup(t),owner=f.journal.control.claim('previous'),wakeAt=new Date(Date.now()+60000).toISOString(),lastAmbientDeliveryAt=Date.now();f.journal.control.save(owner,0,{listenTo:['s_presenter'],wakeAt,lastAmbientDeliveryAt});f.journal.control.release(owner);
 const reopened=openJournal(f.dir,{worldId:'w',soulId:'s'});t.after(()=>reopened.close());const running=runSupervisor({...f,journal:reopened,signal:f.stop.signal,ambientWakeMs:30});
 try{
  await until(()=>f.host.calls.length===1);assert.deepEqual(f.host.calls[0].listenTo,['s_presenter']);assert.equal(f.host.calls[0].scheduledWakeAt,wakeAt);assert.equal(reopened.control.checkpoint().value.lastAmbientDeliveryAt,lastAmbientDeliveryAt);f.host.finish(waitDecision);await until(()=>reopened.control.checkpoint().value.lastCall?.type==='wait');
  reopened.ingest({source:'world',after:null,cursor:'first',events:[ambient('first')]});await until(()=>f.host.calls.length===2);f.host.finish(listeningWait([]));await until(()=>reopened.control.checkpoint().value.listenTo?.length===0);assert.equal(reopened.control.checkpoint().value.wakeAt,wakeAt);
  reopened.ingest({source:'world',after:'first',cursor:'second',events:[ambient('second')]});await new Promise(r=>setTimeout(r,200));assert.equal(f.host.calls.length,2);
 }finally{f.stop.abort();await running;}
});
test('coalesced journal pressure drains quiet capacity and admits the later urgent event',async t=>{
 const f=setup(t,{retention:{worldPendingEvents:1}}),states=[];f.journal.ingest({source:'world',after:null,cursor:'quiet',events:[{id:'quiet',kind:'receipt.started',salience:1}]});
 f.world.worldPage=async({after,signal})=>{if(after==='quiet')return {cursor:'urgent',events:[{id:'urgent',kind:'conversation.turn',salience:3}]};await abortableSleep(10000,signal);return {cursor:after,events:[]};};
 const running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s),receiverSleep:(_ms,signal)=>abortableSleep(15,signal)});
 try{
  await until(()=>f.host.calls.length===1);await until(()=>states.some(s=>s.code==='JOURNAL_BACKLOG_FULL'));assert.equal(f.journal.cursor('world'),'quiet');f.host.finish(waitDecision);await until(()=>f.host.calls.length===2);f.host.finish(waitDecision);await until(()=>f.journal.cursor('world')==='urgent');await until(()=>f.host.calls.length===3);assert.ok(f.host.calls[2].pending.some(f=>f.event.id==='urgent'));f.host.finish(waitDecision);await until(()=>f.journal.pending().length===0);assert.equal(f.host.calls.length,3);
 }finally{f.stop.abort();await running;}
});
test('repeated pressure without incorporation progress cannot create an inference loop',async t=>{
 const f=setup(t),states=[];f.world.worldPage=async()=>{throw Object.assign(Error('Synthetic full journal'),{code:'JOURNAL_BACKLOG_FULL',transient:true})};const running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s),receiverSleep:(_ms,signal)=>abortableSleep(10,signal)});
 try{
  await until(()=>f.host.calls.length===1);await until(()=>states.filter(s=>s.code==='JOURNAL_BACKLOG_FULL').length>=3);f.host.finish(waitDecision);await until(()=>f.host.calls.length===2||f.journal.control.checkpoint().value.lastCall?.type==='wait');if(f.host.calls.length===2)f.host.finish(waitDecision);await until(()=>f.journal.control.checkpoint().value.lastCall?.type==='wait');const calls=f.host.calls.length;await new Promise(r=>setTimeout(r,150));assert.equal(f.host.calls.length,calls);assert.ok(calls<=2);assert.ok(states.filter(s=>s.code==='JOURNAL_BACKLOG_FULL').length>3);
 }finally{f.stop.abort();await running;}
});
test('unselected speakers stay quiet until the model explicitly chooses nearby speech',async t=>{
 const f=setup(t),running=runSupervisor({...f,signal:f.stop.signal,ambientWakeMs:30});
 try{
  await until(()=>f.host.calls.length===1);f.host.finish(listeningWait(['s_presenter']));await until(()=>Array.isArray(f.journal.control.checkpoint().value.listenTo)&&f.journal.control.checkpoint().value.listenTo.length===1);
  const unrelated=ambient('other','s_other');unrelated.data.text='A phrase mentioning s_presenter cannot change its native speaker';f.journal.ingest({source:'world',after:null,cursor:'other',events:[unrelated]});await new Promise(r=>setTimeout(r,180));assert.equal(f.host.calls.length,1);
  f.journal.ingest({source:'world',after:'other',cursor:'selected',events:[ambient('selected')]});await until(()=>f.host.calls.length===2);assert.equal(f.host.calls[1].pending[0].event.id,'selected');f.host.finish(listeningWait('nearby'));await until(()=>f.journal.control.checkpoint().value.listenTo==='nearby');
  f.journal.ingest({source:'world',after:'selected',cursor:'now-selected',events:[ambient('now-selected','s_other')]});await until(()=>f.host.calls.length===3);assert.equal(f.host.calls[2].pending[0].event.id,'now-selected');assert.equal(f.host.calls[2].listenTo,'nearby');assert.equal(f.host.steers.length,0);
 }finally{f.stop.abort();await running;}
});
test('the earlier deadline wakes a listener before its ambient batch cadence',async t=>{
 const f=setup(t),owner=f.journal.control.claim('setup'),started=Date.now(),wakeAt=new Date(started+200).toISOString();f.journal.control.save(owner,0,{listenTo:['s_presenter'],wakeAt,lastAmbientDeliveryAt:started});f.journal.control.release(owner);
 const running=runSupervisor({...f,signal:f.stop.signal,ambientWakeMs:1000});
 try{
  await until(()=>f.host.calls.length===1);f.host.finish(waitDecision);await until(()=>f.journal.control.checkpoint().value.lastCall?.type==='wait');f.journal.ingest({source:'world',after:null,cursor:'ambient',events:[ambient('ambient')]});await until(()=>f.host.calls.length===2);assert.ok(Date.now()-started<800);assert.equal(f.host.calls[1].scheduledWakeAt,wakeAt);assert.ok(f.host.calls[1].pending.some(f=>f.event.id==='ambient'));assert.deepEqual(f.host.calls[1].listenTo,['s_presenter']);
 }finally{f.stop.abort();await running;}
});
test('saved future deadline steers active inference before completion without replacing owner intent',async t=>{
 const start=Date.parse('2026-10-30T05:00:00.000Z');
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:start});
 const f=setup(t),states=[],commands=[],wakeAt=new Date(start+2000).toISOString(),plan='Keep the original errand and reconsider it at its saved deadline';
 f.journal.ingest({source:'owner',after:null,cursor:'original-task',events:[{id:'original-task',text:'Finish the original errand before its deadline.'}]});
 f.journal.handled('owner','original-task','Initial instruction incorporated; task remains open');
 const previous=f.journal.control.claim('previous');f.journal.control.save(previous,0,{initialInstruction:'Original authenticated owner errand',plan,wakeAt,listenTo:['s_observed']});f.journal.control.release(previous);
 f.world.read=async command=>{commands.push(['read',command]);return {here:'current place'};};
 f.world.write=async command=>{commands.push(['write',command]);return {accepted:true};};
 const running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s)});
 try{
  await flushTurns();assert.equal(f.host.calls.length,1);assert.equal(f.host.activeTurnId,'t1');assert.equal(f.host.calls[0].scheduledWakeAt,wakeAt);
  t.mock.timers.tick(1999);await flushTurns();assert.equal(f.host.steers.length,0,'a future wake must not steer early');
  t.mock.timers.tick(101);await flushTurns();
  assert.equal(f.host.steers.length,1,'saved wake must reach the still-active host without waiting for inference completion');
  const notice=f.host.steers[0];assert.equal(notice.scheduledWakeAt,wakeAt);assert.ok(Date.parse(notice.now)>=Date.parse(wakeAt),'deadline notice carries fresh authoritative UTC');assert.deepEqual(notice.timer,{kind:'scheduled-wake',wakeAt});
  assert.equal(f.host.activeTurnId,'t1');assert.equal(f.host.calls.length,1,'deadline notice does not start a competing model turn');
  assert.deepEqual(commands,[['read','observe']],'notifying a deadline makes no world call or extra perception poll');
  const saved=f.journal.control.checkpoint().value;assert.equal(saved.plan,plan);assert.equal(saved.wakeAt,wakeAt);assert.equal(saved.pendingDecision,undefined);assert.deepEqual(saved.listenTo,['s_observed']);
  const proof=states.filter(s=>s.state==='host-notified'&&s.timer);assert.equal(proof.length,1);assert.deepEqual(proof[0].events,[]);assert.deepEqual(proof[0].timer,notice.timer);assert.ok(proof[0].at>=Date.parse(wakeAt));
  assert.deepEqual(f.journal.openOwnerTasks().tasks.map(({id,text})=>({id,text})),[{id:'original-task',text:'Finish the original errand before its deadline.'}]);
  t.mock.timers.tick(1000);await flushTurns();assert.equal(f.host.steers.length,1,'same deadline is coalesced for this active turn');
  f.host.finish({...waitDecision,plan:'Obsolete pre-deadline choice',call:{type:'write',command:'say',arguments:'{"text":"obsolete action"}'}});
  await flushTurns();assert.equal(f.host.calls.length,2,'a stale pre-deadline result replans after completion');assert.deepEqual(commands,[['read','observe']],'stale inference cannot publish a write after the deadline');
  assert.equal(f.host.calls[1].plan,plan);assert.equal(f.host.calls[1].scheduledWakeAt,wakeAt);assert.equal(f.journal.openOwnerTasks().totalOpen,1);
 }finally{f.stop.abort();await running;}
});
test('crossed deadline discards completion even when its timer callback has not run',async t=>{
 const start=Date.parse('2026-10-30T06:00:00.000Z');t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:start});
 const f=setup(t),owner=f.journal.control.claim('previous'),wakeAt=new Date(start+2000).toISOString();f.journal.control.save(owner,0,{plan:'Original timed errand',wakeAt});f.journal.control.release(owner);
 let writes=0;f.world.write=async()=>{writes++;return {accepted:true};};const running=runSupervisor({...f,signal:f.stop.signal});
 try{
  await flushTurns();assert.equal(f.host.calls.length,1);
  // setTime moves Date without executing scheduled timer callbacks. The model
  // completion wins that race; freshness must still be checked synchronously.
  t.mock.timers.setTime(start+2100);f.host.finish({...waitDecision,call:{type:'write',command:'say',arguments:'{"text":"obsolete"}'}});
  await flushTurns();assert.equal(f.host.steers.length,0);assert.equal(writes,0);assert.equal(f.host.calls.length,2);assert.equal(f.host.calls[1].plan,'Original timed errand');assert.equal(f.host.calls[1].scheduledWakeAt,wakeAt);
  f.host.finish(waitDecision);await flushTurns();assert.equal(f.journal.control.checkpoint().value.wakeAt,null);
  t.mock.timers.tick(1000);await flushTurns();assert.equal(f.host.calls.length,2,'due-time prompt must not rearm the same deadline or spin');assert.equal(f.host.steers.length,0,'finished turn timer was removed');
 }finally{f.stop.abort();await running;}
});
test('deadline freshness overrides the world replan cap even when deadline steer is rejected',async t=>{
 const start=Date.parse('2026-10-30T07:00:00.000Z');t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:start});
 const f=setup(t),states=[],owner=f.journal.control.claim('previous'),wakeAt=new Date(start+5000).toISOString();f.journal.control.save(owner,0,{plan:'Preserve timed owner work',wakeAt});f.journal.control.release(owner);
 let writes=0,attempts=0;f.world.write=async()=>{writes++;return {accepted:true};};const steer=f.host.steer.bind(f.host);f.host.steer=async text=>{if(JSON.parse(text).timer){attempts++;throw Error('stale steer acknowledgement');}return steer(text);};
 const running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s)});
 try{
  await flushTurns();
  for(let i=1;i<=2;i++){
   f.journal.ingest({source:'world',after:i===1?null:'c1',cursor:'c'+i,events:[{id:'c'+i,kind:'conversation.turn',salience:3}]});t.mock.timers.tick(100);await flushTurns();assert.equal(f.host.steers.length,i);
   f.host.finish(waitDecision);await flushTurns();assert.equal(f.host.calls.length,i+1);
  }
  t.mock.timers.tick(4801);await flushTurns();assert.equal(attempts,1);assert.equal(states.some(s=>s.state==='host-notified'&&s.timer),false,'rejected steer is not host-delivery proof');
  f.host.finish({...waitDecision,call:{type:'write',command:'say',arguments:'{"text":"obsolete after capped replans"}'}});await flushTurns();assert.equal(writes,0);assert.equal(f.host.calls.length,4,'deadline causes a mandatory fresh prompt after the two ordinary replans');
  assert.equal(f.host.calls[3].plan,'Preserve timed owner work');assert.equal(f.host.calls[3].scheduledWakeAt,wakeAt);assert.equal(f.journal.pending().length,2,'deadline notice does not handle native events');
  f.host.finish(waitDecision);await flushTurns();t.mock.timers.tick(1000);await flushTurns();assert.equal(f.host.calls.length,4);assert.equal(attempts,1);
 }finally{f.stop.abort();await running;}
});
test('deadline waits for begin acknowledgement and abort removes a pending-begin timer',async t=>{
 const start=Date.parse('2026-10-30T08:00:00.000Z');t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:start});
 const f=setup(t),states=[],owner=f.journal.control.claim('previous'),wakeAt=new Date(start+2000).toISOString();f.journal.control.save(owner,0,{plan:'Retained intent',wakeAt});f.journal.control.release(owner);
 let release;const gate=new Promise(resolve=>{release=resolve;}),begin=f.host.begin.bind(f.host);f.host.begin=async(...args)=>{const active=await begin(...args);await gate;return active;};
 const running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s)});
 try{
  await flushTurns();assert.equal(f.host.calls.length,1);t.mock.timers.tick(2100);await flushTurns();assert.equal(f.host.steers.length,0,'deadline may not target an unacknowledged begin');
  f.stop.abort();t.mock.timers.tick(1000);await flushTurns();release();await running;assert.equal(f.host.steers.length,0);assert.equal(states.some(s=>s.state==='host-notified'),false,'abort while begin is pending acknowledges no host delivery');assert.equal(f.journal.control.checkpoint().value.wakeAt,wakeAt);
 }finally{release();f.stop.abort();await running;}
});
test('a deadline crossed during pending begin is delivered after its acknowledgement',async t=>{
 const start=Date.parse('2026-10-30T09:00:00.000Z');t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:start});
 const f=setup(t),owner=f.journal.control.claim('previous'),wakeAt=new Date(start+2000).toISOString();f.journal.control.save(owner,0,{wakeAt});f.journal.control.release(owner);
 let release;const gate=new Promise(resolve=>{release=resolve;}),begin=f.host.begin.bind(f.host);f.host.begin=async(...args)=>{const active=await begin(...args);await gate;return active;};
 const running=runSupervisor({...f,signal:f.stop.signal});
 try{
  await flushTurns();t.mock.timers.tick(2100);await flushTurns();assert.equal(f.host.steers.length,0);
  release();await flushTurns();assert.equal(f.host.calls.length,1);assert.equal(f.host.steers.length,1);assert.equal(f.host.steers[0].scheduledWakeAt,wakeAt);assert.equal(f.host.steers[0].now,new Date(start+2100).toISOString());
 }finally{release();f.stop.abort();await running;}
});
test('deadline steer serializes behind observations and timestamps actual host send',async t=>{
 const start=Date.parse('2026-10-30T10:00:00.000Z');t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:start});
 const f=setup(t),states=[],owner=f.journal.control.claim('previous'),wakeAt=new Date(start+2000).toISOString();f.journal.control.save(owner,0,{wakeAt});f.journal.control.release(owner);
 let release;const gate=new Promise(resolve=>{release=resolve;}),steer=f.host.steer.bind(f.host);f.host.steer=async text=>{await steer(text);if(!JSON.parse(text).timer)await gate;};
 const running=runSupervisor({...f,signal:f.stop.signal,onState:s=>states.push(s)});
 try{
  await flushTurns();f.journal.ingest({source:'world',after:null,cursor:'direct',events:[{id:'direct',kind:'conversation.turn',salience:3}]});t.mock.timers.tick(100);await flushTurns();assert.equal(f.host.steers.length,1);
  t.mock.timers.tick(2000);await flushTurns();assert.equal(f.host.steers.length,1,'deadline must wait for the preceding observation delivery acknowledgement');assert.equal(states.some(s=>s.state==='host-notified'&&s.mode==='steer'),false);
  t.mock.timers.tick(500);release();await flushTurns();assert.equal(f.host.steers.length,2);assert.equal(f.host.steers[1].now,new Date(start+2600).toISOString(),'time is sampled at actual send, not when the deadline queued');
  const proofs=states.filter(s=>s.state==='host-notified'&&s.mode==='steer');assert.deepEqual(proofs.map(s=>s.events),[[{source:'world',id:'direct'}],[]]);assert.equal(proofs[1].timer.wakeAt,wakeAt);assert.equal(f.journal.pending().length,1);
 }finally{release();f.stop.abort();await running;}
});
test('nonblocking listen clear immediately reaches the next action while retaining the saved deadline and owner task',async t=>{
 const f=setup(t),owner=f.journal.control.claim('setup'),wakeAt=new Date(Date.now()+60000).toISOString(),commands=[];
 f.journal.control.save(owner,0,{listenTo:'nearby',wakeAt});f.journal.control.release(owner);
 f.journal.ingest({source:'owner',after:null,cursor:'original',events:[{id:'original',text:'Return and report the outcome'}]});f.journal.handled('owner','original','incorporated:previous');
 f.world.write=async command=>{commands.push(command);return {accepted:true,receipt:{id:'r_departure',phase:'started'}};};
 const running=runSupervisor({...f,signal:f.stop.signal,ambientWakeMs:30});
 try{
  await until(()=>f.host.calls.length===1);f.host.finish({plan:'Stop attending; depart immediately and keep the report deadline',call:{type:'listen',command:'listen',arguments:'{"listenTo":[]}'},wakeAt:null});
  await until(()=>f.host.calls.length===2);assert.deepEqual(f.host.calls[1].listenTo,[]);assert.deepEqual(f.host.calls[1].lastResult,{local:true,listenTo:[]});assert.equal(f.host.calls[1].scheduledWakeAt,wakeAt);assert.equal(f.host.calls[1].openOwnerTasks.tasks[0].id,'original');assert.deepEqual(commands,[]);
  f.host.finish({plan:'Depart via the observed capability; report still pending',call:{type:'write',command:'act',arguments:'{"capability":"observed_departure"}'},wakeAt:null});
  await until(()=>f.host.calls.length===3);assert.deepEqual(commands,['act']);assert.equal(f.host.calls[2].scheduledWakeAt,wakeAt);assert.equal(f.journal.openOwnerTasks().totalOpen,1);
  f.host.finish(waitDecision);await until(()=>f.journal.control.checkpoint().value.lastCall?.type==='wait');
  f.journal.ingest({source:'world',after:null,cursor:'ignored',events:[ambient('ignored')]});await new Promise(r=>setTimeout(r,180));assert.equal(f.host.calls.length,3,'cleared listening and an ordinary wait must not poll the model');assert.deepEqual(commands,['act'],'configuration never acknowledges the owner or writes to the world');
 }finally{f.stop.abort();await running;}
});
test('actual native activity observation wakes a waiting host without model polling or declaring terminal completion',async t=>{
 const f=setup(t),states=[];let worldReads=0,published=false,release;const gate=new Promise(r=>release=r);
 const event={id:'c_activity',kind:'activity.observed',raw:'activity.observed',salience:2,data:{receipt:{id:'r',capability:'sit:chair',phase:'started'},body:{posture:'seated',activity:'sit',occupiedSeats:['chair#seat']}}};
 f.world.read=async()=>{worldReads++;return {self:{state:'walking'}};};
 f.world.eventPage=async({after,signal})=>{if(!published){await Promise.race([gate,abortableSleep(10000,signal)]);published=true;return {cursor:event.id,events:[event]};}await abortableSleep(10000,signal);return {cursor:after,events:[]};};
 const running=runSupervisor({...f,instruction:'Use observed native activity state',signal:f.stop.signal,onState:s=>states.push(s)});
 try{
  await until(()=>f.host.calls.length===1);f.host.finish(waitDecision);await new Promise(r=>setTimeout(r,150));assert.equal(f.host.calls.length,1);
  assert.equal(attentionPriority({source:'world',event}),2);release();
  await until(()=>f.host.calls.length===2);const fact=f.host.calls[1].pending[0].event;assert.deepEqual(fact.data,event.data);assert.equal(fact.data.receipt.phase,'started');assert.equal(f.journal.pending().length,1,'host notification does not mark incorporation');assert.equal(worldReads,1,'native event needs no here/receipt polling');assert.equal(f.journal.cursor('world'),event.id);assert.ok(states.some(s=>s.state==='events-persisted'&&s.events.some(e=>e.id===event.id)));assert.ok(states.some(s=>s.state==='host-notified'&&s.events.some(e=>e.id===event.id)));
  f.host.finish(waitDecision);await until(()=>f.journal.pending().length===0);await new Promise(r=>setTimeout(r,150));assert.equal(f.host.calls.length,2,'unchanged activity does not poll the model');
 }finally{release();f.stop.abort();await running;}
});

test('decision timing evidence comes from the committed checkpoint without exposing private plans',async t=>{
 const f=setup(t),states=[],running=runSupervisor({...f,instruction:'Private mission',signal:f.stop.signal,onState:s=>states.push(s)});
 try{
  await until(()=>f.host.calls.length===1);const wakeAt=new Date(Date.now()+60000).toISOString();
  f.host.finish({...waitDecision,plan:'PRIVATE_PLAN_CANARY',call:{type:'wait',command:'wait',arguments:'{"listenTo":"nearby"}'},wakeAt});
  await until(()=>states.some(s=>s.state==='decision'));const row=states.find(s=>s.state==='decision'),checkpoint=f.journal.control.checkpoint();
  assert.equal(row.call,'wait');assert.equal(row.checkpointRevision,checkpoint.revision);assert.equal(row.committedAt,checkpoint.at);assert.equal(row.decisionId,checkpoint.value.lastDecisionId);assert.equal(row.wakeAt,wakeAt);assert.equal(row.listenTo,'nearby');assert(!JSON.stringify(row).includes('PRIVATE_PLAN_CANARY'));assert.equal(row.arguments,undefined);assert.equal(f.host.calls.length,1);
 }finally{f.stop.abort();await running;}
});
