import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openJournal} from './journal.mjs';
import {retainDecision,applyPendingDecision,deadlineLeadMs,ownerCommitmentTimes,deadlineWake} from './decision.mjs';

function fixture(t,initialInstruction){
 const dir=mkdtempSync(join(tmpdir(),'souls-deadline-wake-'));const j=openJournal(dir,{worldId:'w',soulId:'s'});
 t.after(()=>{j.close();rmSync(dir,{recursive:true,force:true})});
 const fence=j.control.claim('test');if(initialInstruction!==undefined)j.control.save(fence,0,{initialInstruction});
 return {j,dir,fence};
}
const iso=ms=>new Date(ms).toISOString();
const wait=(wakeAt,args={})=>({plan:'Wait',call:{type:'wait',command:'wait',args},wakeAt});
const read=wakeAt=>({plan:'Look',call:{type:'read',command:'here',args:{}},wakeAt});
async function decide(j,fence,d,{retainedAt}={}){
 retainDecision(j,fence,d);
 if(retainedAt!==undefined){const c=j.control.checkpoint();j.control.save(fence,c.revision,{...c.value,pendingDecision:{...c.value.pendingDecision,retainedAt}});}
 await applyPendingDecision(j,fence,{read:async()=>({here:true}),write:async()=>({said:{id:'sp_1'}})});
 return j.control.checkpoint().value;
}

test('lead is 10% of the remaining time, bounded to 120..600 s',()=>{
 assert.equal(deadlineLeadMs(531000),120000);
 assert.equal(deadlineLeadMs(3000000),300000);
 assert.equal(deadlineLeadMs(86400000),600000);
 assert.deepEqual(ownerCommitmentTimes(['Meet at 2026-10-31T08:30:29.255Z; finish by 2026-10-31T04:42:29-04:00.','No time here',null,'again 2026-10-31T08:30:29.255Z']),[Date.parse('2026-10-31T08:30:29.255Z'),Date.parse('2026-10-31T08:42:29Z')]);
 assert.deepEqual(ownerCommitmentTimes(['local 2026-10-31T08:30:29 has no zone']),[]);
});

test('a wait whose wake equals a retained deadline is woken ahead by the lead (garden r3 C1 walker-1)',async t=>{
 const now=Date.now(),deadline=now+531000;
 const {j,fence}=fixture(t,`Finish the gathering and your original errand by ${iso(deadline)}.`);
 const v=await decide(j,fence,wait(iso(deadline),{listenTo:'nearby'}),{retainedAt:now});
 assert.equal(v.wakeAt,iso(deadline-120000));
 assert.deepEqual(v.deadlineWakeV1,{wakeAt:iso(deadline-120000),deadlineAt:iso(deadline),requestedWakeAt:iso(deadline)});
 // Sleeping past the deadline is equally too late; a millisecond-free copy too.
 const past=await decide(j,fence,wait(iso(deadline+60000)),{retainedAt:now});assert.equal(past.wakeAt,iso(deadline-120000));
 const zone=new Date(deadline);zone.setUTCMilliseconds(0);
 const rounded=await decide(j,fence,wait(zone.toISOString().replace('.000','')),{retainedAt:now});assert.equal(rounded.wakeAt,iso(deadline-120000));
});

test('a wait well before the deadline, null waits and Souls without deadlines are unchanged',async t=>{
 const now=Date.now(),deadline=now+531000;
 const {j,fence}=fixture(t,`Finish by ${iso(deadline)}.`);
 const early=await decide(j,fence,wait(iso(deadline-120000)),{retainedAt:now});assert.equal(early.wakeAt,iso(deadline-120000));assert.equal(early.deadlineWakeV1,undefined);
 const sooner=await decide(j,fence,wait(iso(now+30000)),{retainedAt:now});assert.equal(sooner.wakeAt,iso(now+30000));assert.equal(sooner.deadlineWakeV1,undefined);
 const events=await decide(j,fence,wait(null,{cancelWake:true}),{retainedAt:now});assert.equal(events.wakeAt,null);
 const none=await decide(j,fence,wait(null),{retainedAt:now});assert.equal(none.wakeAt,null);
 // No timestamp in owner intent: the requested wake is exactly what is saved.
 const plain=fixture(t,'Walk to the garden, then report one observation.');
 const v=await decide(plain.j,plain.fence,wait(iso(deadline)),{retainedAt:now});assert.equal(v.wakeAt,iso(deadline));assert.equal(v.deadlineWakeV1,undefined);
 // A past commitment never schedules an early wake.
 const old=fixture(t,`The meeting was at ${iso(now-60000)}.`);
 assert.equal((await decide(old.j,old.fence,wait(iso(deadline)),{retainedAt:now})).wakeAt,iso(deadline));
 // Within the lead window the Soul is already awake with the time in view.
 const close=fixture(t,`Finish by ${iso(now+90000)}.`);
 assert.equal((await decide(close.j,close.fence,wait(iso(now+90000)),{retainedAt:now})).wakeAt,iso(now+90000));
});

test('an open owner task deadline counts; its accepted result removes it',async t=>{
 const now=Date.now(),deadline=now+400000;
 const {j,fence}=fixture(t,'Help your owner.');
 j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:`Bring the lantern to the pavilion by ${iso(deadline)}`,sentAt:now}]});
 assert.equal((await decide(j,fence,wait(iso(deadline)),{retainedAt:now})).wakeAt,iso(deadline-120000));
 retainDecision(j,fence,{plan:'Report',call:{type:'write',command:'result',args:{id:'m1',outcome:'done',text:'Lantern delivered'}},wakeAt:null});
 await applyPendingDecision(j,fence,{write:async()=>({inbox:{latest:{id:'m1',state:'acknowledged',result:'Lantern delivered',outcome:'done',resultAt:now}}})});
 assert.equal(j.openOwnerTasks().totalOpen,0);
 assert.equal((await decide(j,fence,wait(iso(deadline)),{retainedAt:now})).wakeAt,iso(deadline));
});

test('closing the dated owner task drops a kept early wake and restores the requested wake',async t=>{
 const now=Date.now(),deadline=now+400000,requested=iso(deadline+60000);
 const {j,fence}=fixture(t,'Help your owner.');
 j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:`Bring the lantern to the pavilion by ${iso(deadline)}`,sentAt:now}]});
 const v=await decide(j,fence,wait(requested),{retainedAt:now});assert.equal(v.wakeAt,iso(deadline-120000));assert.equal(v.deadlineWakeV1.deadlineAt,iso(deadline));
 retainDecision(j,fence,{plan:'Report',call:{type:'write',command:'result',args:{id:'m1',outcome:'done',text:'Lantern delivered'}},wakeAt:null});
 await applyPendingDecision(j,fence,{write:async()=>({inbox:{latest:{id:'m1',state:'acknowledged',result:'Lantern delivered',outcome:'done',resultAt:now}}})});
 const after=j.control.checkpoint().value;assert.equal(j.openOwnerTasks().totalOpen,0);
 assert.equal(after.wakeAt,requested);assert.equal(after.deadlineWakeV1,undefined);
});

test('the early wake survives replies, is consumed once, then restores the requested wake without re-firing',async t=>{
 const now=Date.now(),deadline=now+531000,lead=deadline-120000;
 const {j,fence}=fixture(t,`Finish by ${iso(deadline)}.`);
 await decide(j,fence,wait(iso(deadline)),{retainedAt:now});
 const reply=await decide(j,fence,{plan:'Reply',call:{type:'write',command:'say',args:{text:'Hi'}},wakeAt:null},{retainedAt:now+1000});
 assert.equal(reply.wakeAt,iso(lead));assert.equal(reply.deadlineWakeV1.wakeAt,iso(lead));
 // Woken at the lead: the next committed decision consumes it and keeps the asked-for deadline wake.
 const after=await decide(j,fence,read(null),{retainedAt:lead+500});
 assert.equal(after.wakeAt,iso(deadline));assert.equal(after.deadlineWakeV1,undefined);
 // Re-requesting the deadline inside the lead window does not create another early wake.
 assert.equal((await decide(j,fence,wait(iso(deadline)),{retainedAt:lead+2000})).wakeAt,iso(deadline));
 // Explicit cancel still cancels both.
 const cancelled=await decide(j,fence,wait(null,{cancelWake:true}),{retainedAt:lead+3000});assert.equal(cancelled.wakeAt,null);assert.equal(cancelled.deadlineWakeV1,undefined);
});

test('a far deadline gets at most two early wakes',()=>{
 const now=0,deadline=3600000,c=[deadline];
 const first=deadlineWake(iso(deadline),c,now);assert.equal(first.wakeAt,iso(deadline-360000));
 const t1=Date.parse(first.wakeAt),second=deadlineWake(iso(deadline),c,t1);assert.equal(second.wakeAt,iso(deadline-120000));
 assert.equal(deadlineWake(iso(deadline),c,deadline-120000).lead,null);
});

test('the computed early wake persists in the journal across restart and pending re-application',async t=>{
 const now=Date.now(),deadline=now+531000,lead=deadline-120000;
 const {j,dir,fence}=fixture(t,`Finish by ${iso(deadline)}.`);
 retainDecision(j,fence,wait(iso(deadline),{listenTo:'nearby'}));
 const c=j.control.checkpoint();j.control.save(fence,c.revision,{...c.value,pendingDecision:{...c.value.pendingDecision,retainedAt:now}});
 j.control.release(fence);
 // Crash before application: the restarted controller applies the same decision to the same wake.
 const recovered=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>recovered.close());const next=recovered.control.claim('recovered');
 await applyPendingDecision(recovered,next,{});
 assert.equal(recovered.control.checkpoint().value.wakeAt,iso(lead));recovered.control.release(next);
 const again=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>again.close());const third=again.control.claim('again');
 const v=again.control.checkpoint().value;assert.equal(v.wakeAt,iso(lead));assert.deepEqual(v.deadlineWakeV1,{wakeAt:iso(lead),deadlineAt:iso(deadline),requestedWakeAt:iso(deadline)});
 assert.equal((await decide(again,third,read(null),{retainedAt:lead+10})).wakeAt,iso(deadline));
});

// Whole controller: an idle wait on the deadline itself is prompted at the lead,
// and a Soul without a dated commitment is prompted exactly at its own wake.
import {EventEmitter} from 'node:events';
import {runSupervisor} from './supervisor.mjs';
import {abortableSleep} from './receiver.mjs';
const flush=async()=>{for(let i=0;i<20;i++)await new Promise(setImmediate);};
class Host extends EventEmitter{
 constructor(){super();this.threadId='thread';this.calls=[];this.steers=[];this.activeTurnId=null;}
 async connect(){}
 async begin(text){this.calls.push(JSON.parse(text));this.activeTurnId='turn-'+this.calls.length;let resolve;const completed=new Promise(r=>resolve=r);this.finish=d=>{this.activeTurnId=null;resolve({status:'completed',text:JSON.stringify(d)});};return {turnId:this.activeTurnId,completed};}
 async steer(text){this.steers.push(JSON.parse(text));return {accepted:true};}
 async interrupt(){}
 async close(){if(this.activeTurnId){this.activeTurnId=null;this.finish({plan:'stop',call:{type:'wait',command:'wait',arguments:'{}'},wakeAt:null});}}
}
for(const dated of [true,false])test('an idle controller waiting on '+(dated?'a retained deadline wakes at the lead':'its own undated wake adds no early prompt'),async t=>{
 const origin=Date.parse('2026-10-31T08:33:38.000Z'),deadline=origin+531000;
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:origin});
 const dir=mkdtempSync(join(tmpdir(),'souls-deadline-supervisor-')),journal=openJournal(dir,{worldId:'world',soulId:'s_subject'});
 const f=journal.control.claim('setup');journal.control.save(f,0,{listenTo:'nearby',initialInstruction:dated?`Finish your errand by ${iso(deadline)}.`:'Finish your errand, then report.'});journal.control.release(f);
 const host=new Host(),stop=new AbortController();
 const world={read:async()=>({here:'native'}),write:async()=>({accepted:true})};
 for(const m of ['ownerPage','worldPage'])world[m]=async({after,signal})=>{await abortableSleep(24*3600000,signal);return {cursor:after,events:[]};};
 const running=runSupervisor({journal,host,world,signal:stop.signal});running.catch(()=>{});
 try{
  await flush();assert.equal(host.calls.length,1);
  host.finish({plan:'Wait for the others; finish by the deadline',call:{type:'wait',command:'wait',arguments:'{"listenTo":"nearby"}'},wakeAt:iso(deadline)});await flush();
  const due=dated?deadline-120000:deadline;
  assert.equal(journal.control.checkpoint().value.wakeAt,iso(due));
  while(Date.now()<due-1200){t.mock.timers.tick(1000);await flush();}t.mock.timers.tick(due-200-Date.now());await flush();assert.equal(host.calls.length,1,'no prompt before the scheduled wake');
  for(let i=0;i<6;i++){t.mock.timers.tick(100);await flush();}assert.equal(host.calls.length,2);assert.equal(host.calls[1].scheduledWakeAt,iso(due));assert.equal(host.steers.length,0);
 }finally{stop.abort();await running.catch(()=>{});journal.close();rmSync(dir,{recursive:true,force:true});}
});
