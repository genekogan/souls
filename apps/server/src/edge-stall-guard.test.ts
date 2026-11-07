// STALL-GUARD (Gene's review 2026-10-23, #19: "Mickey can't move at all. this needs to be prevented."). Deterministic stalls
// of a carrier step-out (door taken), a seat (claim left by an action that is gone) and a restored held body: the world
// releases each within LIMIT_S (30 s) with a stall:released receipt; stand:here from the owner releases at once.
// BEFORE: SIM_STALL_GUARD=off node --test src/edge-stall-guard.test.ts (the bodies stay held).
import test from 'node:test';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {Hono} from 'hono';import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';import {hashToken} from './auth.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
const common=await retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1);
async function setup(t:{after(fn:()=>void):void},path=':memory:',reopen?:{id:string;entity_id:string}){
 const f=fixture(path,common,{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();
 const token='sim_STALL_GUARD_TEST_TOKEN';let row=reopen!;
 if(!reopen){
  await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));await invite(f,'stuck');
  row=await accept<{id:string;entity_id:string}>(f.host,f.souls.create('dev:stuck',{name:'Stuck',description:'stall-guard fixture'}));
  await accept<unknown>(f.host,f.host.installCarrierV1({id:'eden-balloon',def:'hot-air-balloon',label:'Balloon',at:[-20,-9],yaw:Math.PI,route:'commons-hop',waitSeconds:15}));
  f.db.setSoulToken(row.id,hashToken(token),'synthetic');}
 const ledger=new EdgeLedger(f.host,f.db),app=new Hono();let closed=false;const close=()=>{if(closed)return;closed=true;comms.close();f.host.stop();f.db.close();};
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'')),ledger});t.after(close);
 if(!reopen)comms.objects.create({id:'ride-test',kind:'ride',name:'Balloon',placeId:'world',params:{carrier:'eden-balloon'}});
 const post=async(path:string,body:unknown)=>{const r=await accept(f.host,Promise.resolve(app.request(path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})));return await r.json() as {accepted:boolean;code?:string;reason?:string;receipt?:{id:string;phase:string}}};
 const caps=async()=>{const r=await accept(f.host,Promise.resolve(app.request('/v1/edge/capabilities',{headers:{authorization:'Bearer '+token}})));return (await r.json() as {capabilities:{id:string;available:boolean}[]}).capabilities;};
 const ent=()=>(f.host.engine.world.entities as Record<string,any>),balloon=()=>ent()['eden-balloon'].carrier,tick=(n:number,until?:()=>boolean)=>{for(let i=0;i<n&&!until?.();i++)f.host.tickOnce();};
 const stalls=()=>f.db.db.prepare("SELECT capability,phase,code,reason,detail FROM edge_receipts_v1 WHERE soul_id=? AND capability='stall:released'").all(row.id) as {capability:string;phase:string;code:string;reason:string;detail:string}[];
 const free=()=>{const h=ent()[row.entity_id].human;return !h.carrier&&!h.task&&(f.host.engine as any).rt.holder('actor:'+row.entity_id).length===0;};
 return {f,row,ledger,comms,post,caps,ent,balloon,tick,close,actor:row.entity_id,stalls,free};
}
type Q=Awaited<ReturnType<typeof setup>>;
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
/** Ride, land, and take the basket door so the engine's step-out cannot proceed (the live 3.65 stall). */
async function landedAndStuck(q:Q){
 const joined=await q.post('/v1/edge/act',{capability:'object:ride-test:join',clientRef:'join'});assert.equal(joined.accepted,true,JSON.stringify(joined));
 q.tick(3000,()=>q.ledger.aboard(q.actor)?.riderPhase==='seated');assert.equal(q.ledger.aboard(q.actor)?.riderPhase,'seated');
 q.balloon().departAtTick=q.f.host.engine.world.tick;q.tick(200,()=>q.balloon().phase==='aloft');assert.equal(q.balloon().phase,'aloft');
 // aloft is a steady hold: the guard never touches it (held flight, as over a busy landing spot)
 q.balloon().holding=true;const el=q.balloon().elapsed;q.tick(5);
 q.balloon().elapsed=1e9;q.tick(200,()=>q.balloon().phase==='landed');assert.equal(q.balloon().phase,'landed');
 q.balloon().doorBy='someone-at-the-door';q.tick(20);
 // RIDE-EXIT's own step-out limit (if merged) would also end this; hold the rider's limit off so this tests the general guard
 const c=q.ent()[q.actor].human.carrier;if(c)Object.defineProperty(c,'outBy',{get:()=>Number.MAX_SAFE_INTEGER,set:()=>{},configurable:true});
 return q.f.host.engine.world.tick;
}
test('a carrier step-out stalled behind a taken door is released within 30 s with a stall:released receipt',{timeout:180000},async t=>{
 const q=await setup(t);const stuckAt=await landedAndStuck(q);
 q.tick(1200,()=>q.free());const seconds=(q.f.host.engine.world.tick-stuckAt)/20;
 t.diagnostic(`carrier released after ${seconds} s`);
 assert.ok(q.free(),'body released');assert.ok(seconds<=30,`released ${seconds} s after the stall began`);
 const h=q.ent()[q.actor].human;assert.equal(h.activity,'idle');assert.equal(q.f.host.engine.programOf(q.actor),null);
 assert.ok(!Object.values(q.balloon().seats).includes(q.actor),'seat freed');
 await flush();const s=q.stalls();assert.equal(s.length,1);assert.equal(s[0].phase,'completed');assert.equal(s[0].code,'stall.released');
 assert.match(s[0].reason,/Stuck was stuck stepping out of a ride for \d+ s; the world ended it/);assert.equal(JSON.parse(s[0].detail).stallV1.trigger,'limit');
 q.tick(40);const after=await q.post('/v1/edge/act',{capability:'stand:here',clientRef:'after'});assert.equal(after.accepted,true,JSON.stringify(after));
});
test('stand:here from the owner wins over a stalled carrier at once',{timeout:180000},async t=>{
 const q=await setup(t);await landedAndStuck(q);q.tick(60);
 const stand=await q.post('/v1/edge/act',{capability:'stand:here',clientRef:'stand'});
 // RIDE-EXIT (if merged) refuses stand:here during its own short landing window; the guard still frees the body
 q.tick(40,()=>q.free());assert.ok(q.free(),'released by the owner\'s stand: '+JSON.stringify(stand));
 assert.equal(JSON.parse(q.stalls()[0].detail).stallV1.trigger,'stand');
});
test('a seat claim left by an action that is gone is released within 30 s',{timeout:180000},async t=>{
 const q=await setup(t);q.tick(40);
 const rt=(q.f.host.engine as any).rt,a=q.actor;
 // the stall: a seat action's claim on the body outlives the action (no live def can let go)
 // the stall: a seat claim on the body outlives the action that made it (nothing live can let go; requests fail actor.busy)
 rt.owners.set('actor:'+a,[{action:'a-gone-seat',mode:'exclusive'}]);Object.assign(q.ent()[a].human,{activity:'sit',baseActivity:'sit',task:'a-gone-seat'});
 assert.deepEqual(rt.holder('actor:'+a),['a-gone-seat']);
 const stuckAt=q.f.host.engine.world.tick;
 q.tick(1200,()=>q.free());const seconds=(q.f.host.engine.world.tick-stuckAt)/20;t.diagnostic(`seat released after ${seconds} s`);
 assert.ok(q.free(),'released');assert.ok(seconds<=30,`${seconds} s`);assert.equal(q.ent()[a].human.activity,'idle');
 await flush();assert.equal(q.stalls().length,1);
});
test('a held body restored from a snapshot is released within 30 s of boot',{timeout:180000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'stall-guard-restore-')),path=join(dir,'world.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const q=await setup(t,path);await landedAndStuck(q);q.tick(40);
 delete q.ent()[q.actor].human.carrier.outBy;q.tick(1);assert.ok(q.f.host.saveSnapshot(true));const row=q.row;q.close();
 const r=await setup(t,path,row),boot=r.f.host.engine.world.tick;
 assert.ok(r.ent()[r.actor].human.carrier,'restored held');
 const c=r.ent()[r.actor].human.carrier;Object.defineProperty(c,'outBy',{get:()=>Number.MAX_SAFE_INTEGER,set:()=>{},configurable:true});
 r.balloon().doorBy='someone-at-the-door';
 r.tick(1200,()=>r.free());const seconds=(r.f.host.engine.world.tick-boot)/20;t.diagnostic(`restored body released ${seconds} s after boot`);
 assert.ok(r.free(),'released after the restore');assert.ok(seconds<=30,`${seconds} s`);await flush();assert.equal(r.stalls().length,1);
});
