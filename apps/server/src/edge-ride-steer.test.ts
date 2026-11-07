// VEHICLE-STEER (Gene 2026-10-23, #12): one generic `steer` on ride objects. A seated rider sets a destination (a place, or a
// direction + distance), can land or stop; nobody steering = the ride keeps its own route; honest refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {Hono} from 'hono';
import {kernelHash} from '@souls/kernel';
import {WorldHost} from './world.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {hashToken} from './auth.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import {installPuntActivities} from './punt-install.ts';
import {centroid} from './edge/ledger/places.ts';

async function world(t:any,opts:{balloon?:boolean;punt?:boolean}){
 const f=fixture(':memory:',await retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 for(const p of [f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2(),f.host.enableReflexTimeoutV1(),f.host.enableContinuousDayV1(),f.host.enableEdgeMotionV1()])await accept<unknown>(f.host,p);
 const rows:any[]=[];for(const n of ['ana','ben','cy']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'rider'})));}
 const tokens=rows.map((r,i)=>{const tok='sim_STEER_TEST_TOKEN_'+i;f.db.setSoulToken(r.id,hashToken(tok),'synthetic');return tok;});
 if(opts.balloon)await accept<unknown>(f.host,f.host.installCarrierV1({id:'eden-balloon',def:'hot-air-balloon',label:'Red balloon',at:[-20,-9],yaw:Math.PI,route:'commons-hop',waitSeconds:60}));
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:true}),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger});t.after(()=>comms.close());
 if(opts.balloon)comms.objects.create({id:'ride-eden-balloon',kind:'ride',name:'Red balloon',placeId:'world',params:{carrier:'eden-balloon'}});
 if(opts.punt){const installer=installPuntActivities(f.host,ledger);t.after(()=>installer.close());}
 const pump=async<T>(p:Promise<T>|T)=>{const q=Promise.resolve(p);let done=false;q.then(()=>done=true,()=>done=true);for(let i=0;i<400&&!done;i++){await setImmediate();f.host.drainInputs();}assert.ok(done,'request settled');return q;};
 const call=async(i:number,method:string,path:string,body?:unknown)=>{const res=await pump(app.request(path,{method,headers:{authorization:'Bearer '+tokens[i],'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}) as Promise<Response>);return await res.json() as any;};
 const run=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){f.host.tickOnce();if(i%20===0){await setImmediate();f.host.drainInputs();}}return until();};
 const W=f.host.engine.world as any,ent=(i:number)=>W.entities[rows[i].entity_id],car=(id:string)=>W.entities[id];
 const steer=(i:number,ride:string,params:Record<string,unknown>)=>call(i,'POST',`/v1/edge/objects/${ride}/act`,{action:'steer',params});
 return {f,rows,ledger,comms,call,run,ent,car,steer};
}
// a fresh replay of the log from genesis reaches the same world (the steer is a logged decision like any other)
async function replayExact(w:any){const f=w.f;f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};
 f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
 const h=new WorldHost(f.db,await retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1),f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head,'replay exact');h.stop();}
const flat=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[2]-b[2]);

const boardAndLift=async(w:any)=>{
 const ja=await w.call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:join'});assert.equal(ja.accepted,true,JSON.stringify(ja));
 const jb=await w.call(1,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:join'});assert.equal(jb.accepted,true,JSON.stringify(jb));
 assert.ok(await w.run(3000,()=>w.ent(0).human.carrier?.phase==='seated'&&w.ent(1).human.carrier?.phase==='seated'),'both seated');
 const st=await w.call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:start'});assert.equal(st.accepted,true,JSON.stringify(st));
 assert.ok(await w.run(400,()=>w.car('eden-balloon').carrier.phase==='aloft'&&w.car('eden-balloon').pose.p[1]>3),'lifted off');
};

test('steer the balloon to a named place and land there; the other rider is refused; the empty balloon flies itself home',{timeout:600000},async t=>{
 const w=await world(t,{balloon:true}),b=()=>w.car('eden-balloon'),home=[...b().carrier.home];
 // only a seated rider can steer
 const early=await w.steer(2,'ride-eden-balloon',{to:'Presentation deck'});assert.equal(early.accepted,false);assert.match(early.code,/object.role|ride.not-aboard/);
 await boardAndLift(w);
 // honest refusals before anything moves: an unknown place, a bad mix of params
 const unk=await w.steer(0,'ride-eden-balloon',{to:'the moon'});assert.equal(unk.accepted,false);assert.equal(unk.code,'steer.unknown-place',JSON.stringify(unk));
 const mix=await w.steer(0,'ride-eden-balloon',{to:'Presentation deck',stop:true});assert.equal(mix.accepted,false);assert.equal(mix.code,'ride.steer-params');
 // the Soul's own words: "fly the balloon to the presentation deck and land there" is the steer with to + land
 const go=await w.call(0,'POST','/v1/edge/act',{capability:'fly the balloon to the presentation deck and land there'});assert.equal(go.accepted,true,JSON.stringify(go));assert.equal(go.resolved?.to,'object:ride-eden-balloon:steer',JSON.stringify(go.resolved));
 assert.ok(await w.run(40,()=>!!b().carrier.steer),'the engine takes the steer');
 // ben is a rider too, but ana is steering
 const other=await w.steer(1,'ride-eden-balloon',{direction:'N',distance:50});assert.equal(other.accepted,false,JSON.stringify(other));assert.equal(other.code,'ride.steered');assert.match(other.reason,/ana/);
 const deck=[9,0,-2];let flewOver=0;
 assert.ok(await w.run(6000,()=>{flewOver=Math.max(flewOver,b().pose.p[1]);return b().carrier.phase==='landed'||b().carrier.phase==='parked';}),'came down: '+JSON.stringify(b().carrier.phase));
 assert.ok(flat(b().pose.p,deck)<30,`landed near the deck: ${b().pose.p.map((v:number)=>v.toFixed(1))}`);assert.ok(flat(b().pose.p,home)>15,'not at home');
 assert.ok(await w.run(600,()=>!w.ent(0).human.carrier&&!w.ent(1).human.carrier),'riders stepped out at the deck');
 for(const i of [0,1])assert.ok(flat(w.ent(i).pose.p,deck)<32&&Math.abs(w.ent(i).pose.p[1])<1.5,`rider ${i} on the ground near the deck: ${w.ent(i).pose.p}`);
 // empty, it flies itself home and parks
 assert.ok(await w.run(6000,()=>b().carrier.phase==='parked'),'flew home empty: '+b().carrier.phase);
 assert.ok(flat(b().pose.p,home)<.5,`parked at home ${b().pose.p}`);assert.equal(b().carrier.steer,undefined);
 assert.ok(!String(b().carrier.route.id).startsWith('steer'),'its own route is back after a steered trip: '+b().carrier.route.id);
 assert.deepEqual(w.f.host.engine.runtime.violations,[]);assert.equal(w.f.db.paidCost(),0);
 await replayExact(w);
});

test('stop holds the balloon in the air, then with nobody steering it rejoins its own route and lands at home; out of bounds is refused',{timeout:600000},async t=>{
 const w=await world(t,{balloon:true}),b=()=>w.car('eden-balloon'),home=[...b().carrier.home];
 await boardAndLift(w);
 // out of bounds: the engine's refusal reaches the Soul as a ride.* code with a readable reason (this fixture has no ground
 // field, so the bound here is the ride's range from home)
 const far=w.ledger.steerCheck(w.rows[0].entity_id,'eden-balloon',{x:home[0]+5000,z:home[2]});assert.equal(far?.code,'ride.out-of-bounds',JSON.stringify(far));assert.match(String(far?.reason),/outside the world/);
 const stop=await w.call(0,'POST','/v1/edge/act',{capability:'hover here'});assert.equal(stop.resolved?.to,'object:ride-eden-balloon:steer',JSON.stringify(stop));assert.equal(stop.accepted,true,JSON.stringify(stop));
 assert.ok(await w.run(60,()=>!!b().carrier.steer),'holding');
 const at=[...b().pose.p];assert.ok(await w.run(1200,()=>false)===false);
 assert.ok(flat(b().pose.p,at)<2&&b().pose.p[1]>3,`hovers where it stopped: ${at} -> ${b().pose.p}`);
 // after the 2-minute hold it rejoins its own route, lands at home and lets everyone off
 assert.ok(await w.run(12000,()=>b().carrier.phase==='parked'||(b().carrier.phase==='landed'&&flat(b().pose.p,home)<.5)),'back home: '+b().carrier.phase+' '+b().pose.p);
 assert.ok(flat(b().pose.p,home)<.5);
 assert.ok(await w.run(800,()=>!w.ent(0).human.carrier&&!w.ent(1).human.carrier),'riders off at home');
 assert.ok(!String(b().carrier.route.id).startsWith('steer'),'its own route is back after the rejoin: '+b().carrier.route.id);
 assert.deepEqual(w.f.host.engine.runtime.violations,[]);
});

test('row the punt: steering out over open water is fine, a land target off its bank is refused, land rows it back to its bank',{timeout:600000},async t=>{
 const w=await world(t,{punt:true}),p=()=>w.car('eden-punt');
 assert.ok(await w.run(80,()=>!!p()?.carrier&&w.comms.objects.all().some((o:any)=>o.id==='ride-eden-punt')),'punt installed');
 const home=[...p().carrier.home];
 const j=await w.call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-punt:join'});assert.equal(j.accepted,true,JSON.stringify(j));
 assert.ok(await w.run(3000,()=>w.ent(0).human.carrier?.phase==='seated'),'seated');
 assert.ok(await w.run(2000,()=>p().carrier.phase==='aloft'),'pushed off: '+p().carrier.phase);
 const ashore=await w.steer(0,'ride-eden-punt',{to:'Presentation deck',land:true});assert.equal(ashore.accepted,false,JSON.stringify(ashore));
 const water=await w.call(0,'POST','/v1/edge/act',{capability:'row to the connected calm water'});assert.equal(water.resolved?.to,'object:ride-eden-punt:steer',JSON.stringify(water));assert.equal(water.accepted,true,JSON.stringify(water));
 assert.ok(await w.run(40,()=>!!p().carrier.steer),'steering: '+JSON.stringify(w.ledger.receipt(w.rows[0].id,water.receipt.id))+' phase '+p().carrier.phase+' ground '+!!(w.f.host.engine as any).rt?.services?.spatial?.ground);
 assert.ok(await w.run(1200,()=>false)===false);
 const land=await w.call(0,'POST','/v1/edge/act',{capability:'row back'});assert.equal(land.resolved?.to,'object:ride-eden-punt:steer',JSON.stringify(land));assert.equal(land.accepted,true,JSON.stringify(land));
 assert.ok(await w.run(8000,()=>!w.ent(0).human.carrier),'rowed back and stepped out: '+p().carrier.phase+' '+p().pose.p);
 assert.ok(flat(p().pose.p,home)<1.5,`back at its bank: ${p().pose.p} vs ${home}`);
 assert.equal(w.ent(0).human.shore?.depthMetres??0,0,'rower on dry ground');
 assert.ok(await w.run(2000,()=>p().carrier.phase==='parked'),'parked again: '+p().carrier.phase);
 assert.ok(!String(p().carrier.route.id).startsWith('steer'),'its own loop is back after a steered trip: '+p().carrier.route.id);
 const again=await w.call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-punt:join'});assert.equal(again.accepted,true,'boards again after a steered trip: '+JSON.stringify(again));
 assert.deepEqual(w.f.host.engine.runtime.violations,[]);
});
