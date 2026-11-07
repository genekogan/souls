// LINK BODY (2026-10-24): the body never leaves. Presence drives it: awake -> zombie (no listen for SLEEP_GRACE) -> asleep
// (after ZOMBIE_WANDER); a listen or an accepted action wakes it; a connected Soul left without actions gets the idle reflex.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {registerEdgeComms} from './edge/comms/index.ts';
import {edgeSoulResolver} from './edge/routes.ts';
import type {BodyKnobs} from './edge/ledger/body-rule.ts';

const SEC=1000,MIN=60*SEC;
async function world(names:string[],knobs:Partial<BodyKnobs>={},fixedSoulId?:string){
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 await accept<unknown>(f.host,f.host.enableQuietStallReleaseV1());await accept<unknown>(f.host,f.host.enableYieldTimeoutV1());await accept<unknown>(f.host,f.host.enableShoreDepartV1());
 // A pinned identity freezes body-rule jitter; the native journaled birth remains unchanged.
 const rows:any[]=[];for(const n of names){await invite(f,n);if(fixedSoulId){
  const entityId='h_'+fixedSoulId.slice(2),owner='dev:'+n;f.db.createSoul({id:fixedSoulId,worldId:f.host.worldId,owner,entityId,name:n,description:'body',native:false});
  await accept(f.host,f.host.enqueue('birth','soul:'+fixedSoulId,{soulId:fixedSoulId,entityId,name:n,description:'body',owner}));rows.push(f.db.soul(fixedSoulId));
 }else rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'body'})));}
 const clock={now:Date.now()};const now=()=>clock.now;
 const ledger=new EdgeLedger(f.host,f.db,undefined,{now}),app=new Hono();
 const comms=registerEdgeComms(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,()=>undefined),ledger},{fading:true,now,sweepMs:0});ledger.attachComms(comms as any);
 const pres=new Map<string,{listening:boolean;at:number|null}>(),listens:((id:string)=>void)[]=[],sends:((id:string)=>void)[]=[];
 const rule=ledger.attachPresence({soulPresence:id=>pres.get(id)??{listening:false,at:null},onSoulListen:l=>listens.push(l),onSoulSend:l=>sends.push(l)},knobs)!;
 const spectated:any[]=[];(comms as any).onSpectator((m:any)=>{if(m.kind==='body')spectated.push(m);});
 const souls=rows.map((r,i)=>({soulId:r.id,entityId:r.entity_id,name:names[i],owner:r.owner}));
 const listen=(i:number,open:boolean)=>{pres.set(souls[i].soulId,{listening:open,at:clock.now});if(open)for(const l of listens)l(souls[i].soulId);};
 const send=(i:number)=>{for(const l of sends)l(souls[i].soulId);};
 /** Advance `ms` of rule time in steps of `step` ms per world tick; `each` runs after every tick. */
 const run=(ms:number,step=50,each?:()=>void)=>{for(let t=0;t<ms;t+=step){clock.now+=step;f.host.tickOnce();f.host.drainInputs();each?.();}};
 const ents=()=>(f.host.engine.world as NativeWorld).entities;
 const close=()=>{comms.close();f.host.stop();f.db.close();};
 return {f,ledger,comms,rule,souls,listen,send,run,clock,ents,spectated,close};
}

const stateOf=(w:any,i=0)=>w.rule.view(w.souls[i].soulId);
const shuffles=(w:any,id:string)=>w.f.db.events(w.f.host.worldId).filter((e:any)=>e.kind==='decision'&&e.payload?.soulId===id&&String(e.payload?.option).startsWith('body:')).map((e:any)=>e.payload.option);

test('stop listening: zombie within SLEEP_GRACE + one sweep, asleep (lying) after ZOMBIE_WANDER, a listen wakes it at once',{timeout:900000},async t=>{
 // This captured failing identity previously shuffled onto a 0.35m-clear patch, then refused pose.no-room.
 const w=await world(['ana'],{},'s_0add0b2900');t.after(w.close);const id=w.souls[0].soulId,e=w.ents()[w.souls[0].entityId];
 w.listen(0,true);w.run(5*SEC);assert.equal(stateOf(w).state,'awake');
 w.listen(0,false);const closed=w.clock.now;let zombieAt=0;
 w.run(130*SEC,50,()=>{if(!zombieAt&&stateOf(w).state==='zombie')zombieAt=w.clock.now;});
 t.diagnostic(`zombie after ${(zombieAt-closed)/1000} s (SLEEP_GRACE 120 s)`);
 assert.ok(zombieAt>0&&zombieAt-closed>=120*SEC&&zombieAt-closed<=121*SEC,'zombie within SLEEP_GRACE + 1 s');
 assert.equal(stateOf(w).doing,'drifting');
 // half an hour of zombie at one rule-second per tick, the last seconds at real tick rate
 w.run(zombieAt+30*MIN-15*SEC-w.clock.now,1000);let asleepAt=0;w.run(30*SEC,50,()=>{if(!asleepAt&&stateOf(w).state==='asleep')asleepAt=w.clock.now;});
 t.diagnostic(`asleep ${(asleepAt-zombieAt)/1000} s after turning zombie (ZOMBIE_WANDER 1800 s); shuffles ${shuffles(w,id).length}`);
 assert.ok(asleepAt>0&&asleepAt-zombieAt>=30*MIN&&asleepAt-zombieAt<=30*MIN+1*SEC,'asleep after ZOMBIE_WANDER (+1 s)');
 assert.ok(shuffles(w,id).filter((o:string)=>o==='body:zombie-shuffle').length>=3,'the zombie shuffled');
 w.run(20*SEC,50);assert.equal(String((e.human as any).activity),'nap','lies down where it stands');assert.equal(stateOf(w).doing,'dozing');
 const at=e.pose.p.slice();w.run(10*MIN,1000);assert.deepEqual(e.pose.p,at,'asleep is still');assert.equal(stateOf(w).state,'asleep');
 w.listen(0,true);assert.equal(stateOf(w).state,'awake','a listen wakes it at once');
 w.run(3*SEC,50);assert.notEqual(String((e.human as any).activity),'nap','stood up');
 const ev=w.spectated.filter(m=>m.soulId===id).map(m=>`${m.state}/${m.doing}`);t.diagnostic('spectator body events '+JSON.stringify(ev));
 assert.deepEqual(ev,['awake/null','zombie/drifting','asleep/standing','asleep/dozing','awake/null']);
 for(const m of w.spectated)for(const k of ['kind','soulId','state','doing','since'])assert.ok(k in m,'contract field '+k);
 assert.deepEqual((w.ledger.publicSoul(id) as any).body,stateOf(w),'public record carries body');
 assert.equal((w.ledger.publicSoul(id) as any).fade.colour,'green','fade stays readable and green');
 assert.deepEqual(w.f.host.engine.runtime.violations,[]);
});

test('asleep posture remains standing when the native nap refuses a narrow starting point',async t=>{
 const w=await world(['ana'],{zombieWanderMs:MIN},'s_sleepnarrow');t.after(w.close);
 const s=w.souls[0],e=w.ents()[s.entityId],eng=w.f.host.engine as any,results:any[]=[];
 w.f.host.listeners.push({onDecision:(ev,r)=>{if((ev.payload as any).option==='body:asleep')results.push(r);}});
 await accept(w.f.host,w.f.host.enqueue('edge-relocate','edge:'+s.soulId,{soulId:s.soulId,entityId:s.entityId,to:[10.25,-0.45]}));
 w.run(SEC);const start=e.pose.p.slice();
 assert.equal(eng.canPerform({actor:s.entityId,label:'narrow nap',steps:[{verb:'mars:pose_v1',params:{activity:'nap',seconds:3600}}]}).code,'pose.no-room');
 w.listen(0,true);w.run(5*SEC);w.listen(0,false);w.run(4*MIN,50);
 assert.deepEqual([stateOf(w).state,stateOf(w).doing],['asleep','standing']);assert.equal(e.human!.activity,'idle');
 assert.deepEqual(e.pose.p,start,'a narrow starting point is not silently relocated');
 assert.ok(results.length>=1&&results.length<=2,'refusal retries retain the one-minute bound');
 assert.ok(results.every(r=>r.programOk===false&&r.programCode==='pose.no-room'),'the native refusal is preserved');
 w.listen(0,true);assert.equal(stateOf(w).state,'awake');assert.deepEqual(eng.runtime.violations,[]);
});

test('sleep interrupts a native shuffle beside furniture with lying room at the actual stop',async t=>{
 const w=await world(['ana'],{},'s_0add0b2900');t.after(w.close);const s=w.souls[0],e=w.ents()[s.entityId],eng=w.f.host.engine as any;
 await accept(w.f.host,w.f.host.enqueue('edge-relocate','edge:'+s.soulId,{soulId:s.soulId,entityId:s.entityId,to:[11.3,0.3]}));w.run(SEC);
 const start=e.pose.p.slice();assert.ok(eng.clearanceUpToV1(start[0],start[2],2)<1.6,'start beside the actual obstacle');
 assert.ok(eng.lyingRoomAtV1(start[0],start[2],0,0.125),'start has conservative lying clearance');
 w.listen(0,true);w.run(5*SEC);w.listen(0,false);
 let interrupted=false,at:number[]=[];
 for(let n=0;n<6000&&!interrupted;n++){w.run(50);if(stateOf(w).state==='zombie'&&(w.ledger as any).posture(s.entityId)==='moving'&&Math.hypot(e.pose.p[0]-start[0],e.pose.p[2]-start[2])>0.02){
  at=e.pose.p.slice();assert.ok(eng.clearanceUpToV1(at[0],at[2],2)<1.6,'interrupt while still beside furniture');
  w.rule.setKnobs(s.soulId,{zombieWanderMs:w.clock.now-stateOf(w).since});interrupted=true;
 }}
 assert.ok(interrupted,'the native zombie actually moved before sleep');w.run(20*SEC,50);
 assert.equal(e.human!.activity,'nap');assert.deepEqual([stateOf(w).state,stateOf(w).doing],['asleep','dozing']);
 assert.ok(eng.clearanceUpToV1(e.pose.p[0],e.pose.p[2],1)>=0.9,'the actual interrupted stop admits lying');
 const settled=e.pose.p.slice();w.run(MIN,50);assert.deepEqual(e.pose.p,settled);assert.deepEqual(eng.runtime.violations,[]);
 t.diagnostic(JSON.stringify({start,interruptedAt:at,settled}));
});

test('an accepted action wakes a sleeper; an agent acting without listening is awake, then a zombie again after the grace',{timeout:900000},async t=>{
 const w=await world(['ana'],{zombieWanderMs:60*SEC});t.after(w.close);const s=w.souls[0];
 w.run(4*MIN,1000);assert.equal(stateOf(w).state,'asleep','never listened: asleep after grace + wander');
 const r=await accept(w.f.host,w.ledger.act(s,{capability:'wave:here'}));assert.equal(r.accepted,true,JSON.stringify(r));
 assert.equal(stateOf(w).state,'awake','the accepted action woke it');
 w.run(119*SEC,1000);assert.equal(stateOf(w).state,'awake');w.run(3*SEC,50);assert.equal(stateOf(w).state,'zombie');
});

test('2 h of zombie by the shore: never in water, never off its place, never beyond REFLEX_RADIUS',{timeout:1800000},async t=>{
 const w=await world(['ana'],{zombieWanderMs:3*3600*SEC});t.after(w.close);const s=w.souls[0],e=w.ents()[s.entityId],eng=w.f.host.engine as any;
 await accept(w.f.host,w.f.host.enqueue('edge-relocate',`edge:${s.soulId}`,{soulId:s.soulId,entityId:s.entityId,to:[-24,2]}));w.run(2*SEC,50);
 t.diagnostic('start '+JSON.stringify(e.pose.p));
 w.run(150*SEC,1000);assert.equal(stateOf(w).state,"zombie");
 const anchor=[e.pose.p[0],e.pose.p[2]];let far=0,wet=0,moved=0,last=anchor.slice(),minX=Infinity;
 w.run(2*3600*SEC,1000,()=>{const x=e.pose.p[0],z=e.pose.p[2];far=Math.max(far,Math.hypot(x-anchor[0],z-anchor[1]));if(!eng.dryGroundAtV1(x,z))wet++;minX=Math.min(minX,x);if(Math.hypot(x-last[0],z-last[1])>0.01)moved++;last=[x,z];
  assert.ok(!(e.human as any).shore,'never on the shore');});
 const n=shuffles(w,s.soulId).filter((o:string)=>o==='body:zombie-shuffle').length;
 t.diagnostic(`shuffles ${n}, ticks moving ${moved}, farthest ${far.toFixed(2)} m from where it was left, westmost x ${minX.toFixed(2)} (shore water x < -29.5), wet ticks ${wet}`);
 assert.equal(wet,0,'never in water');assert.ok(far<=20.5,'within REFLEX_RADIUS');assert.ok(n>=20,'shuffled');assert.equal(stateOf(w).state,'zombie');
 assert.deepEqual(eng.runtime.violations,[]);
});

test('a Soul left in water floats at the surface: zombie floating (no shuffles), then asleep floating, still',{timeout:900000},async t=>{
 const w=await world(['ana'],{zombieWanderMs:2*MIN});t.after(w.close);const s=w.souls[0],e=w.ents()[s.entityId];
 w.listen(0,true);const r=await accept(w.f.host,w.ledger.act(s,{capability:'swim:shore-water'}));assert.equal(r.accepted,true);
 for(let i=0;i<300&&w.ledger.receipt(s.soulId,(r as any).receipt.id)!.phase!=='completed';i++)w.run(1*SEC,50);
 w.listen(0,false);w.run(2*MIN+25*SEC,1000);assert.deepEqual([stateOf(w).state,stateOf(w).doing],['zombie','floating']);
 w.run(2*MIN+30*SEC,1000);assert.deepEqual([stateOf(w).state,stateOf(w).doing],['asleep','floating']);
 const at=e.pose.p.slice();w.run(10*MIN,1000);
 t.diagnostic('floating at '+JSON.stringify(at)+' activity '+(e.human as any).activity+'; body shuffles '+shuffles(w,s.soulId).length);
 assert.deepEqual(e.pose.p,at,'still');assert.ok(at[1]<-1,'in the water');assert.ok(['tread','swim'].includes(String((e.human as any).activity)));
 assert.equal(shuffles(w,s.soulId).filter((o:string)=>o.includes('shuffle')).length,0,'never shuffles in water');
});

test('idle reflex: a silent connected Soul sits and dozes within 2 h; an owner message ends it at once',{timeout:1800000},async t=>{
 // Test actual idle postures on open ground. Seat approaches and random drifts can otherwise leave the Soul
 // beside furniture where native nap correctly refuses pose.no-room; the separate wander tests cover movement.
 const w=await world(['ana'],{seatRadiusM:0,reflexRadiusM:0});t.after(w.close);const s=w.souls[0],e=w.ents()[s.entityId],eng=w.f.host.engine as any;
 const at=e.pose.p.slice();assert.ok(eng.dryGroundAtV1(at[0],at[2]),'the posture fixture is dry');
 assert.ok(eng.clearanceUpToV1(at[0],at[2],1)>=0.9,'the posture fixture has native nap clearance');
 assert.equal(eng.canPerform({actor:s.entityId,label:'fixture nap',steps:[{verb:'mars:pose_v1',params:{activity:'nap',seconds:5}}]}),null,'native nap is initially admissible');
 w.listen(0,true);w.run(9*MIN,1000);assert.equal(stateOf(w).state,'awake');
 const seen=new Map<string,number>(),body=new Map<string,number>();w.run(2*3600*SEC,1000,()=>{const v=stateOf(w),h=e.human as any;if(v.state==='idle'){seen.set(v.doing,(seen.get(v.doing)??0)+1);
  const k=v.doing==='sitting'&&(String(h.activity).startsWith('sit')||h.baseActivity==='sit')?'seated':v.doing==='dozing'&&h.activity==='nap'?'napping':null;if(k)body.set(k,(body.get(k)??0)+1);}w.listen(0,true);});
 assert.deepEqual(e.pose.p,at,'posture choices stay on the verified open patch');
 t.diagnostic('engine postures while idle '+JSON.stringify(Object.fromEntries(body)));assert.ok((body.get('seated')??0)>0&&(body.get('napping')??0)>0,'the body really sat and napped');
 const moves=shuffles(w,s.soulId);t.diagnostic('idle seconds by posture '+JSON.stringify(Object.fromEntries(seen))+'; moves '+JSON.stringify(moves.reduce((a:any,o:string)=>(a[o]=(a[o]??0)+1,a),{})));
 assert.ok((seen.get('sitting')??0)>0&&(seen.get('dozing')??0)>0,'>= 1 sit and >= 1 doze');
 assert.equal(stateOf(w).state,'idle');
 // dozing at the end of a 2 h idle is the dominant case; force one more doze to test the stand-up
 for(let n=0;n<120&&stateOf(w).doing!=='dozing';n++)w.run(60*SEC,1000,()=>w.listen(0,true));
 assert.equal(stateOf(w).doing,'dozing','the bounded late-idle window reaches a doze');
 w.run(5*SEC,50);w.send(0);assert.equal(stateOf(w).state,'awake','owner message ends the reflex at once');
 w.run(2*SEC,50);assert.notEqual(String((e.human as any).activity),'nap','a doze stands up');
 assert.deepEqual(w.f.host.engine.runtime.violations,[]);
});
