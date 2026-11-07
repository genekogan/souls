// together/1 + carrier/1: "go for a balloon ride with X" — the basket keeps X's place and waits for X (who accepts late,
// after the ordinary boarding wait has run out), a stranger cannot take the kept place, both fly, land, step out; exact replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {kernelHash} from '@souls/kernel';
import {Hono} from 'hono';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {WorldHost} from './world.ts';
import {hashToken} from './auth.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';

const factory=()=>retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1);
test('balloon for two: the basket waits for the invited companion, keeps their place, flies both; replay exact',{timeout:600000},async t=>{
 const f=fixture(':memory:',await factory(),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 for(const p of [f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2(),f.host.enableReflexTimeoutV1(),f.host.enableContinuousDayV1(),f.host.enableEdgeMotionV1()])await accept<unknown>(f.host,p);
 const rows:any[]=[];for(const n of ['ana','ben','cy']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'rider'})));}
 const tokens=rows.map((r,i)=>{const tok='sim_RIDE2_TEST_TOKEN_'+i;f.db.setSoulToken(r.id,hashToken(tok),'synthetic');return tok;});
 await accept<unknown>(f.host,f.host.installCarrierV1({id:'eden-balloon',def:'hot-air-balloon',label:'Red balloon',at:[-20,-9],yaw:Math.PI,route:'commons-hop',waitSeconds:15}));
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:true}),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger});t.after(()=>comms.close());
 comms.objects.create({id:'ride-eden-balloon',kind:'ride',name:'Red balloon',placeId:'world',params:{carrier:'eden-balloon'}});
 const pump=async<T>(p:Promise<T>)=>{let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<400&&!done;i++){await setImmediate();f.host.drainInputs();}assert.ok(done,'request settled');return p;};
 const call=async(i:number,method:string,path:string,body?:unknown)=>{const res=await pump(app.request(path,{method,headers:{authorization:'Bearer '+tokens[i],'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}) as Promise<Response>);return await res.json() as any;};
 const run=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){f.host.tickOnce();if(i%20===0){await setImmediate();f.host.drainInputs();}}return until();};
 const W=f.host.engine.world as any,balloon=()=>W.entities['eden-balloon'],ent=(i:number)=>W.entities[rows[i].entity_id];
 const rec=(i:number,id:string)=>ledger.receipt(rows[i].id,id)!;

 // ana: "go for a balloon ride with ben" — joins and keeps a place for ben
 const ja=await call(0,'POST','/v1/edge/act',{capability:'go for a balloon ride with ben'});assert.equal(ja.accepted,true,JSON.stringify(ja));
 assert.equal(ja.resolved?.to,'object:ride-eden-balloon:join',JSON.stringify(ja.resolved));
 const inv=(await call(1,'GET','/v1/edge/observe')).invites?.[0];assert.equal(inv?.what,'ride',JSON.stringify(inv));
 assert.ok(await run(3000,()=>rec(0,ja.receipt.id).phase==='completed'),'ana seated: '+JSON.stringify(rec(0,ja.receipt.id)));
 assert.equal(balloon().carrier.phase,'boarding');assert.equal(balloon().carrier.hold?.seats,1,'one place kept');
 // a stranger cannot take ben's place
 const jc=await call(2,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:join'});assert.equal(jc.accepted,false);assert.equal(jc.code,'ride.full');assert.match(jc.reason,/kept for ben/);
 // the ordinary 15 s boarding wait passes; the basket keeps waiting for ben
 for(let i=0;i<20*25;i++)f.host.tickOnce();
 assert.equal(balloon().carrier.phase,'boarding','still waiting for the companion');
 // r3 quality case 33: the host cannot force a departure that would leave the invited companion behind
 const early=await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:start'});assert.equal(early.accepted,false,JSON.stringify(early));assert.equal(early.code,'ride.keeping-place');assert.match(early.reason,/keeping a place for ben.*leave them behind/);
 assert.equal(balloon().carrier.phase,'boarding','still boarding after the refused start');
 const ride=(await (await app.request('/v1/edge/rides')).json() as any).rides[0];assert.equal(ride.hold?.for?.[0]?.name,'ben');assert.equal(ride.seatsFree,0);
 // ben accepts (plain words) and climbs in; it lifts off soon after
 const jb=await call(1,'POST','/v1/edge/act',{capability:'yes'});assert.equal(jb.accepted,true,JSON.stringify(jb));assert.match(jb.resolved?.to??'',/^accept:/);
 assert.ok(await run(3000,()=>rec(1,jb.receipt.id).phase==='completed'),'ben seated: '+JSON.stringify(rec(1,jb.receipt.id)));
 const seatedAt=f.host.engine.world.tick;
 assert.ok(await run(400,()=>balloon().carrier.phase==='aloft'),'lifted off with both');
 assert.ok(f.host.engine.world.tick-seatedAt<=5*20,'promptly once ben is in');
 assert.deepEqual(Object.values(balloon().carrier.seats).sort(),[rows[0].entity_id,rows[1].entity_id].sort());
 assert.ok(await run(5000,()=>balloon().carrier.phase==='parked'&&!ent(0).human.carrier&&!ent(1).human.carrier),'landed and stepped out');
 assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
 f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};
 f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
 const h=new WorldHost(f.db,await factory(),f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head,'replay exact');h.stop();
});
