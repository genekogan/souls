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
import {installPuntActivities} from './punt-install.ts';

test('row a pond loop with a companion: ordinary commands, held seat, water refusal, receipt completes only ashore',{timeout:600000},async t=>{
  const factory=await retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1),f=fixture(':memory:',factory,{durableClockV1:true});
  f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
  await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
  await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
  for(const p of [f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2(),f.host.enableReflexTimeoutV1(),f.host.enableContinuousDayV1(),f.host.enableEdgeMotionV1()])await accept<unknown>(f.host,p);
  const rows:any[]=[];for(const n of ['ana','ben','cy']){await invite(f,n);rows.push(await accept(f.host,f.souls.create(`dev:${n}`,{name:n,description:'rower'})));}
  const tokens=rows.map((r,i)=>{const token=`sim_PUNT_TEST_TOKEN_${i}`;f.db.setSoulToken(r.id,hashToken(token),'synthetic');return token;});
  const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:true}),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
  const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger});t.after(()=>comms.close());
  const installer=installPuntActivities(f.host,ledger);t.after(()=>installer.close());
  const pump=async<T>(p:Promise<T>|T)=>{const pending=Promise.resolve(p);let done=false;pending.then(()=>done=true,()=>done=true);for(let i=0;i<400&&!done;i++){await setImmediate();f.host.drainInputs();}assert.ok(done,'request settled');return pending;};
  const call=async(i:number,method:string,path:string,body?:unknown)=>{const response=await pump(app.request(path,{method,headers:{authorization:`Bearer ${tokens[i]}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));return await response.json() as any;};
  const run=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){f.host.tickOnce();if(i%20===0){await setImmediate();f.host.drainInputs();}}return until();};
  const world=f.host.engine.world as any,boat=()=>world.entities['eden-punt'],body=(i:number)=>world.entities[rows[i].entity_id],receipt=(i:number,id:string)=>ledger.receipt(rows[i].id,id)!;
  assert.ok(await run(80,()=>!!boat()?.carrier&&comms.objects.all().some(o=>o.id==='ride-eden-punt')),'admitted native water automatically installs its ordinary ride object');
  const first=await call(0,'POST','/v1/edge/act',{capability:'row a boat on the pond with ben'});
  assert.equal(first.accepted,true,JSON.stringify(first));assert.equal(first.resolved?.to,'object:ride-eden-punt:join');
  assert.equal((await call(1,'GET','/v1/edge/observe')).invites?.[0]?.what,'ride');
  assert.ok(await run(3000,()=>body(0).human.carrier?.phase==='seated'),JSON.stringify(receipt(0,first.receipt.id)));
  assert.equal(receipt(0,first.receipt.id).phase,'started','boarding is progress, not a completed rowing loop');
  assert.equal(boat().carrier.phase,'boarding');assert.equal(boat().carrier.hold?.seats,1);
  const start=await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-punt:start'});assert.equal(start.accepted,false);assert.equal(start.code,'ride.automatic');
  assert.equal(receipt(0,first.receipt.id).phase,'started','unsupported early start must preserve the active rowing receipt');
  assert.equal((await call(0,'GET','/v1/edge/observe')).self.state,'rowing');
  const stranger=await call(2,'POST','/v1/edge/act',{capability:'object:ride-eden-punt:join'});assert.equal(stranger.accepted,false);assert.equal(stranger.code,'ride.full');
  const second=await call(1,'POST','/v1/edge/act',{capability:'yes'});assert.equal(second.accepted,true,JSON.stringify(second));
  assert.ok(await run(3000,()=>body(1).human.carrier?.phase==='seated'),JSON.stringify(receipt(1,second.receipt.id)));
  assert.equal(body(0).human.activity,'row');assert.equal(body(1).human.activity,'row');
  assert.ok(await run(200,()=>boat().carrier.phase==='aloft'));
  assert.equal(ledger.places.carrierPlaces.get('eden-punt')?.enclosed,false,'an open punt does not invent an acoustic enclosure');
  const leave=await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-punt:leave'});assert.equal(leave.accepted,false);assert.equal(leave.code,'ride.aloft');assert.match(leave.reason,/water|bank|loop/i);
  assert.equal(receipt(0,first.receipt.id).phase,'started');
  assert.ok(await run(4000,()=>receipt(0,first.receipt.id).phase==='completed'&&receipt(1,second.receipt.id).phase==='completed'),JSON.stringify([receipt(0,first.receipt.id),receipt(1,second.receipt.id)]));
  for(const i of [0,1]){assert.equal(body(i).human.carrier,undefined);assert.ok(body(i).pose.p[0]>-46);assert.equal(body(i).human.shore?.depthMetres,0);}
  assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
});
