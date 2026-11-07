import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJournal} from './journal.mjs';
import {runSupervisor,steerIncorporation} from './supervisor.mjs';
import {abortableSleep} from './receiver.mjs';

// Model-free regressions for the presenter pattern in the Mars r5 candidate1
// diagnosis (turns …4f94 and …9a4c): a fact steered into a turn whose steer
// userMessage item was recorded before the final agentMessage began is already
// incorporated by that choice. Every ambiguity keeps the ordinary replan rule.
const origin=Date.parse('2026-10-30T12:00:00.000Z');
const flush=async()=>{for(let n=0;n<20;n++)await new Promise(setImmediate);};
const say=text=>JSON.stringify({plan:'Keep the original errand; reply once to the presenter',call:{type:'write',command:'say',arguments:JSON.stringify({text})},wakeAt:null});
class SteerHost extends EventEmitter{
 constructor(){super();this.threadId='durable-thread';this.activeTurnId=null;this.calls=[];this.steers=[];this.interrupts=[];this.turns=new Map();}
 async connect(){}
 async begin(text){
  assert.equal(this.activeTurnId,null);const turnId='turn-'+(this.calls.length+1);this.calls.push(JSON.parse(text));this.activeTurnId=turnId;
  let resolve;const completed=new Promise(r=>resolve=r);this.turns.set(turnId,{resolve});return {turnId,completed};
 }
 async steer(text,turnId){assert.equal(turnId,this.activeTurnId);this.steers.push({turnId,text:JSON.parse(text)});return {turnId};}
 async interrupt(turnId){this.interrupts.push(turnId);}
 // inputs mirrors CodexHost item accounting: userMessage items recorded in the
 // turn, agentMessage items, and userMessages recorded before the final one began.
 finish(turnId,{status='completed',text,finalText=text,inputs}={}){assert.equal(turnId,this.activeTurnId);this.activeTurnId=null;this.turns.get(turnId).resolve({turnId,status,text,finalText,...(inputs?{inputs}:{})});}
 async close(){this.closed=true;if(this.activeTurnId)this.finish(this.activeTurnId,{status:'interrupted'});}
}
function fixture(t){
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:origin});
 const directory=mkdtempSync(join(tmpdir(),'souls-steer-incorporation-')),journal=openJournal(directory,{worldId:'w',soulId:'s'}),host=new SteerHost(),stop=new AbortController(),commands=[],states=[];
 const instruction='Reply once to the presenter when the session opens.';
 journal.ingest({source:'owner',after:null,cursor:'original-owner',events:[{id:'original-owner',text:instruction}]});journal.handled('owner','original-owner','notification incorporated; task still open');
 const fence=journal.control.claim('prior');journal.control.save(fence,0,{threadId:host.threadId,initialInstruction:instruction,plan:'Wait for the session to open',wakeAt:null,listenTo:[]});journal.control.release(fence);
 const f={journal,host,commands,states,page:null};
 const world={read:async command=>{commands.push(['read',command]);return {here:'observed native place'};},write:async command=>{commands.push(['write',command]);return {accepted:true};}};
 // The world receiver parks on a controllable page so a test can inject intake pressure.
 world.worldPage=({after,signal})=>new Promise((resolve,reject)=>{f.page={reject};signal?.addEventListener('abort',()=>resolve({cursor:after,events:[]}),{once:true});});
 world.ownerPage=async({after,signal})=>{await abortableSleep(60000,signal);return {cursor:after,events:[]};};
 const running=runSupervisor({journal,host,world,signal:stop.signal,onState:s=>states.push(s)});running.catch(()=>{});
 f.world=(id,extra={})=>journal.ingest({source:'world',after:journal.cursor('world'),cursor:id,events:[{id,kind:'receipt',salience:3,...extra}]});
 f.pending=()=>journal.pending().map(x=>x.event.id);
 f.replans=()=>journal.control.checkpoint().value.decisionProgressV1.worldReplans;
 f.cleanup=async()=>{stop.abort();await running.catch(()=>{});try{journal.close();}catch{}rmSync(directory,{recursive:true,force:true});};
 return f;
}
// Recorded userMessage items as CodexHost reports them: the prompt (no steerId)
// then the steerIds found in each steer item, in recorded order.
const ids=(f,...n)=>[null,...n.map(k=>f.host.steers[k].text.steerId)];
const replanned=(f,id)=>{
 assert.deepEqual(f.commands,[['read','observe']],'a stale choice must never reach the world');assert.equal(f.host.calls.length,2);
 assert.equal(f.host.calls[1].lastCall,null);assert.ok(f.host.calls[1].pending.some(x=>x.event.id===id),'the unincorporated fact is presented again');
 assert.ok(f.pending().includes(id));assert.equal(f.replans(),1,'the ordinary world-replan credit is charged');assert.equal(f.states.some(s=>s.state==='steer-incorporated'),false);
};
test('(a) presenter pattern: a fact steered before the final agent message began is applied without a replan',async t=>{
 const f=fixture(t);
 try{
  await flush();assert.equal(f.host.calls.length,1);assert.deepEqual(f.host.calls[0].pending,[]);
  f.world('c_62');t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,1);assert.deepEqual(f.host.steers[0].text.pending.map(x=>x.event.id),['c_62']);
  assert.match(f.host.steers[0].text.steerId,/^[0-9a-f]{16}$/);f.host.finish('turn-1',{text:say('Welcome, I am here'),inputs:{userMessages:2,agentMessages:1,finalAfter:2,steerIds:ids(f,0)}});await flush();
  assert.deepEqual(f.commands,[['read','observe'],['write','say']],'the prompt-plus-steer informed choice is current');
  assert.equal(f.host.calls.length,2);assert.equal(f.host.calls[1].lastCall.command,'say');assert.equal(f.host.calls[1].pending.some(x=>x.event.id==='c_62'),false,'an incorporated steered fact is not presented twice');
  assert.equal(f.pending().includes('c_62'),false,'the steered fact is retained with the decision');assert.equal(f.replans(),0,'no world-replan credit is charged');
  const proof=f.states.find(s=>s.state==='steer-incorporated');assert.equal(proof.turnId,'turn-1');assert.equal(proof.pulses,1);assert.deepEqual(proof.events,[{source:'world',id:'c_62'}]);
 }finally{await f.cleanup();}
});
test('(a2) a steer recorded before a superseding final agent message applies that final message only',async t=>{
 const f=fixture(t);
 try{
  await flush();f.world('c_63');t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,1);
  const stale=say('stale draft before the steer'),current=say('reply after the steer');
  f.host.finish('turn-1',{text:stale+'\n'+current,finalText:current,inputs:{userMessages:2,agentMessages:2,finalAfter:2,steerIds:ids(f,0)}});await flush();
  assert.deepEqual(f.commands,[['read','observe'],['write','say']]);assert.equal(f.host.calls[1].lastCall.args.text,'reply after the steer');assert.equal(f.pending().includes('c_63'),false);assert.equal(f.replans(),0);
 }finally{await f.cleanup();}
});
test('(b) a steer item recorded after the final agent message started still replans',async t=>{
 const f=fixture(t);
 try{
  await flush();f.world('c_63');t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,1);
  f.host.finish('turn-1',{text:say('decided before the steer'),inputs:{userMessages:2,agentMessages:1,finalAfter:1,steerIds:ids(f,0)}});await flush();replanned(f,'c_63');
 }finally{await f.cleanup();}
});
test('(c) a truncated steer replans even when its item preceded the final message',async t=>{
 const f=fixture(t);
 try{
  await flush();f.journal.ingest({source:'world',after:f.journal.cursor('world'),cursor:'burst',events:Array.from({length:21},(_,i)=>({id:'burst-'+(i+1),kind:'receipt',salience:3}))});t.mock.timers.tick(100);await flush();
  assert.equal(f.host.steers.length,1);assert.equal(f.host.steers[0].text.pending.length,20,'boundedFacts limits the steer');
  f.host.finish('turn-1',{text:say('saw twenty of twenty-one'),inputs:{userMessages:2,agentMessages:1,finalAfter:2,steerIds:ids(f,0)}});await flush();replanned(f,'burst-21');
 }finally{await f.cleanup();}
});
test('(d) an owner revision steered before the final message still invalidates the choice',async t=>{
 const f=fixture(t);
 try{
  await flush();f.journal.ingest({source:'owner',after:f.journal.cursor('owner'),cursor:'cancel',events:[{id:'cancel',text:'Stop; do not speak.'}]});t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,1);
  f.host.finish('turn-1',{text:say('speaking anyway'),inputs:{userMessages:2,agentMessages:1,finalAfter:2,steerIds:ids(f,0)}});await flush();
  assert.deepEqual(f.commands,[['read','observe']]);assert.equal(f.host.calls.length,2);assert.ok(f.pending().includes('cancel'));assert.equal(f.replans(),0,'owner revisions do not use the world-replan credit');assert.equal(f.states.some(s=>s.state==='steer-incorporated'),false);
 }finally{await f.cleanup();}
});
test('(e) an unsteered intake-pressure pulse replans',async t=>{
 const f=fixture(t);
 try{
  await flush();assert.ok(f.page);f.page.reject(Object.assign(Error('Journal world backlog full'),{code:'JOURNAL_BACKLOG_FULL',transient:true}));await flush();assert.equal(f.host.steers.length,0);assert.ok(f.states.some(x=>x.state==='retrying'&&x.code==='JOURNAL_BACKLOG_FULL'));
  f.world('c_64');t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,1);
  f.host.finish('turn-1',{text:say('pressure was never steered'),inputs:{userMessages:2,agentMessages:1,finalAfter:2,steerIds:ids(f,0)}});await flush();replanned(f,'c_64');
 }finally{await f.cleanup();}
});
test('(f) an acknowledged steer without its recorded item replans',async t=>{
 const f=fixture(t);
 try{
  await flush();f.world('c_65');t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,1);
  f.host.finish('turn-1',{text:say('the steer item never appeared'),inputs:{userMessages:1,agentMessages:1,finalAfter:1,steerIds:[null]}});await flush();replanned(f,'c_65');
 }finally{await f.cleanup();}
});
test('(g) steer items are indexed in ACK order: a later steer after the final message replans',async t=>{
 const f=fixture(t);
 try{
  await flush();f.world('c_66');t.mock.timers.tick(100);await flush();f.world('c_67');t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,2);
  f.host.finish('turn-1',{text:say('only the first steer was seen'),inputs:{userMessages:3,agentMessages:1,finalAfter:2,steerIds:ids(f,0,1)}});await flush();replanned(f,'c_67');assert.ok(f.pending().includes('c_66'),'nothing is retained when the choice is stale');
 }finally{await f.cleanup();}
});
test('(h) a host without item accounting keeps the ordinary replan',async t=>{
 const f=fixture(t);
 try{
  await flush();f.world('c_68');t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,1);
  f.host.finish('turn-1',{text:say('legacy host result')});await flush();replanned(f,'c_68');
 }finally{await f.cleanup();}
});
test('(i) matching counts with a foreign recorded steer identity replan',async t=>{
 const f=fixture(t);
 try{
  await flush();f.world('c_69');t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,1);
  // A leftover item from an earlier turn plus a lost steer item cancel out by count.
  f.host.finish('turn-1',{text:say('never saw this turn steer'),inputs:{userMessages:2,agentMessages:1,finalAfter:2,steerIds:[null,'leftover00000001']}});await flush();replanned(f,'c_69');
 }finally{await f.cleanup();}
});
test('(j) steer items recorded out of ACK order replan',async t=>{
 const f=fixture(t);
 try{
  await flush();f.world('c_70');t.mock.timers.tick(100);await flush();f.world('c_71');t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,2);
  f.host.finish('turn-1',{text:say('order is not provable'),inputs:{userMessages:3,agentMessages:1,finalAfter:3,steerIds:ids(f,1,0)}});await flush();replanned(f,'c_70');
 }finally{await f.cleanup();}
});
test('(k) both steers recorded before the final message apply together',async t=>{
 const f=fixture(t);
 try{
  await flush();f.world('c_72');t.mock.timers.tick(100);await flush();f.world('c_73');t.mock.timers.tick(100);await flush();assert.equal(f.host.steers.length,2);
  f.host.finish('turn-1',{text:say('saw both'),inputs:{userMessages:3,agentMessages:1,finalAfter:3,steerIds:ids(f,0,1)}});await flush();
  assert.deepEqual(f.commands,[['read','observe'],['write','say']]);assert.equal(f.pending().some(id=>['c_72','c_73'].includes(id)),false);assert.deepEqual(f.states.find(s=>s.state==='steer-incorporated').events.map(e=>e.id),['c_72','c_73']);
 }finally{await f.cleanup();}
});
test('timer steers occupy item positions and merged references stay within prompt bounds',()=>{
 const fact=n=>({sequence:n,source:'world',event:{id:'f'+n}}),done=(steerIds,finalAfter)=>({status:'completed',finalText:'{}',inputs:{userMessages:steerIds.length,agentMessages:1,finalAfter,steerIds}});
 // A scheduled-wake steer was ACKed first (item 2); the fact steer is item 3.
 const active={steerIds:['wake000000000001','fact000000000002'],pulses:[{carried:{steerId:'fact000000000002',facts:[fact(7)]}}]},items=[null,'wake000000000001','fact000000000002'];
 assert.equal(steerIncorporation(active,done(items,2),[],1),null,'the fact steer item began after the final message');
 assert.deepEqual(steerIncorporation(active,done(items,3),[fact(7)],1),{events:[fact(7)],steered:[]},'prompt and steer duplicates merge by sequence');
 assert.equal(steerIncorporation(active,done([null,'fact000000000002','wake000000000001'],3),[],1),null,'recorded order must equal ACK order');
 assert.equal(steerIncorporation(active,done(['prompt-has-none0',...items.slice(1)],3),[],1),null,'the prompt item carries no steerId');
 assert.equal(steerIncorporation(active,{...done(items,3),inputs:{...done(items,3).inputs,steerIds:undefined}},[],1),null,'counts alone are not identity proof');
 assert.equal(steerIncorporation({...active,steerFailed:true},done(items,3),[],1),null,'a failed steer request leaves item accounting ambiguous');
 assert.equal(steerIncorporation(active,done(items,3),[],2),null,'a pulse not attributed to this turn is unsteered');
 assert.equal(steerIncorporation(active,{...done(items,3),status:'interrupted'},[],1),null);
 const wide={steerIds:['wide000000000001'],pulses:[{carried:{steerId:'wide000000000001',facts:Array.from({length:20},(_,i)=>fact(200+i))}}]};
 assert.equal(steerIncorporation(wide,done([null,'wide000000000001'],2),Array.from({length:90},(_,i)=>fact(i+1)),1),null,'more than the prompt fact bound keeps the replan');
});
