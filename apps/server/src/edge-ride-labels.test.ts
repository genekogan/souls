// RIDE-LABELS (soul tranche 2026-10-23, from LIVE-CHECKS 4 notes): (1) a god ferris wheel or carousel ride offers itself
// by its own name and motion, never as "Board the balloon ... flies"; the balloon and punt wording is unchanged.
// (2) a Soul's nearby objects report a ride where its carrier is now, not its place's centroid (a punt ashore read 32.4 m).
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {Hono} from 'hono';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {hashToken} from './auth.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import {rideKind,vehicleOf,type RideState} from './edge/comms/objects/ride.ts';

const view=(id:string,route:string,def='hot-air-balloon')=>({id,def,capacity:2,phase:'boarding',holding:false,flights:0,seatsFree:2,route:{id:route,seconds:45},door:[0,0],departsInSeconds:null,waitSeconds:30,riders:[]});
const ctx=(v:any)=>({tick:0,now:0,nameOf:()=>'x',carrier:()=>v}) as any;
const label=(s:RideState)=>rideKind.actions.join.labelFor!(s);

test('each attraction ride names itself and what it does; balloon and punt wording unchanged',()=>{
 const car=rideKind.initial({carrier:'resort-carousel',vehicle:'carousel'},ctx(view('resort-carousel','carousel-three-turns')));
 assert.equal(car.vehicle,'carousel');assert.match(label(car),/^Ride the carousel: it starts by itself ~30 s after you are seated, turns for 45 seconds and stops where you boarded/);
 assert.doesNotMatch(label(car),/balloon|flies/);
 const fw=rideKind.initial({carrier:'resort-ferris-wheel',vehicle:'ferris-wheel'},ctx({...view('resort-ferris-wheel','ferris-wheel-once'),route:{id:'ferris-wheel-once',seconds:75}}));
 assert.match(label(fw),/^Ride the ferris wheel: it starts by itself ~30 s after you are seated, goes round for 75 seconds and stops where you boarded/);
 // older objects (no vehicle param) still learn it from the route; a steered route keeps what it was
 const old=rideKind.initial({carrier:'ride-e_1'},ctx(view('ride-e_1','carousel-three-turns')));assert.equal(old.vehicle,'carousel');
 assert.equal(vehicleOf({id:'ride-e_1',route:{id:'steer'}},'carousel'),'carousel');
 assert.match(rideKind.actions.join.apply(car,{},{} as any).bodies![0].label,/^Ride the carousel$/);
 const bal=rideKind.initial({carrier:'eden-balloon'},ctx({...view('eden-balloon','commons-hop'),route:{id:'commons-hop',seconds:360}}));
 assert.equal(bal.vehicle,'balloon');assert.equal(label(bal),'Board the balloon: it lifts off by itself ~30 s after you are seated, flies about 6 minutes and lands where it started; you cannot get off in the air');
 const punt=rideKind.initial({carrier:'p1'},ctx({...view('p1','p1-loop','rowing-punt'),route:{id:'p1-loop',seconds:60}}));
 assert.equal(punt.vehicle,'punt');assert.match(label(punt),/^Board the punt: it pushes off by itself ~30 s after you are aboard, rows 60 seconds on the water/);
});

test('nearby objects report a ride at its carrier, not its place centroid',{timeout:600000},async t=>{
 const f=fixture(':memory:',await retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 for(const p of [f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2(),f.host.enableReflexTimeoutV1(),f.host.enableContinuousDayV1(),f.host.enableEdgeMotionV1()])await accept<unknown>(f.host,p);
 await invite(f,'ana');const row:any=await accept(f.host,f.souls.create('dev:ana',{name:'ana',description:'rider'}));
 const tok='sim_RIDE_LABELS_TEST_TOKEN';f.db.setSoulToken(row.id,hashToken(tok),'synthetic');
 await accept<unknown>(f.host,f.host.installCarrierV1({id:'eden-balloon',def:'hot-air-balloon',label:'Red balloon',at:[-20,-9],yaw:Math.PI,route:'commons-hop',waitSeconds:60}));
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:true}),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger});t.after(()=>comms.close());
 const W=f.host.engine.world as any,me=()=>W.entities[row.entity_id].pose.p,car=W.entities['eden-balloon'].pose.p;
 // placed in the Soul's own innermost place: before the fix it read that place's centroid
 const place=ledger.placePathOf(row.id).at(-1)!.id;
 comms.objects.create({id:'ride-eden-balloon',kind:'ride',name:'Red balloon',placeId:place,params:{carrier:'eden-balloon'}});
 // stand the Soul next to the balloon (the test moves the body directly; the ride's position is what is read)
 const p=me();p[0]=car[0]+3;p[2]=car[2];
 const pump=async<T>(q:Promise<T>)=>{let done=false;q.then(()=>done=true,()=>done=true);for(let i=0;i<400&&!done;i++){await setImmediate();f.host.drainInputs();}return q;};
 const res:any=await pump((app.request('/v1/edge/here',{headers:{authorization:'Bearer '+tok}}) as Promise<Response>).then(r=>r.json()));
 const o=res.here.objects.find((x:any)=>x.id==='ride-eden-balloon');assert.ok(o,JSON.stringify(res.here.objects));
 const want=Math.hypot(me()[0]-car[0],me()[2]-car[2]);assert.ok(Math.abs(o.dist-want)<0.6,`ride at ${o.dist} m, carrier at ${want.toFixed(2)} m`);
});
