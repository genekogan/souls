import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { marsCommonsTransitionFactory,GREEN_FIELD_WORLD,marsFactory,EDEN_COMMONS_WORLD } from '@souls/engine-mars';
import { fixture,invite,accept } from '../test/native-owner-fixture.ts';
import { WorldHost } from './world.ts';
import { kernelHash } from '@souls/kernel';
import { CandidateStationV1 } from './station.ts';
import { CandidateStationV2 } from './station-v2.ts';
import { ClockFrontiers } from './clock-frontier.ts';
import { hashOf } from '@souls/engine-contract';
import { LifecycleRunner } from './lifecycle-runner.ts';
import { LifecycleJournal } from './lifecycle-journal.ts';

async function create(f:ReturnType<typeof fixture>,owner:string,name:string){
  const r=await f.app.request('/v1/souls',{method:'POST',headers:{authorization:`Bearer dev:${owner}`,'content-type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name,description:'Local native arrival fixture'})});
  assert.equal(r.status,202,await r.clone().text());const {lifecycle}=await r.json() as {lifecycle:{requestId:string;soulId:string;entityId:string}};
  f.host.drainInputs();await setImmediate();f.host.drainInputs();
  const receipt=await f.request('/v1/lifecycle/'+lifecycle.requestId,undefined,owner);
  const value=await receipt.json() as {lifecycle:{state:string;ready:boolean}};
  assert.equal(receipt.status,200);assert.equal(value.lifecycle.state,'admitted');assert.equal(value.lifecycle.ready,true);return lifecycle;
}

test('ordinary invited owners create 24 actual Souls after a logged corrected commons checkpoint; elapsed bodies/cue/ownership replay without models',async t=>{
  const factory=await marsCommonsTransitionFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true},{safeArrivalV1:true}),f=fixture(':memory:',factory,{durableClockV1:true});
  t.after(()=>{f.host.stop();f.db.close();});f.souls.enableLifecycle();
  for(let i=0;i<6;i++)await invite(f,'arrival'+i);
  const existing=await create(f,'arrival0','Existing');
  const oldRules=f.host.engine.rulesVersion,body=structuredClone(f.host.engine.world.entities[existing.entityId]);
  const station=new CandidateStationV1(f.host),record=await accept(f.host,station.record());
  for(let i=0;i<37;i++)f.host.tickOnce();f.host.saveSnapshot();
  const checkpoint=await accept(f.host,f.host.adoptCommons('world:checkpoint',{stationEraV1:true}));
  assert.equal(checkpoint.tick,37);assert.equal(f.host.engine.rulesVersion,oldRules+'+commons/1+arrival-clearance/1');
  assert.deepEqual(f.host.engine.world.entities[existing.entityId],body);
  const carried=await accept(f.host,new CandidateStationV2(f.host).record());assert.equal(carried.cue!.cueId,record.cue!.cueId);
  const arrivals=[{...existing,owner:'arrival0'}];
  for(let i=1;i<24;i++){const owner='arrival'+Math.floor(i/4);arrivals.push({...await create(f,owner,'Resident '+i),owner});}
  assert.equal(f.host.minds.size,24);assert.equal(f.db.liveSouls(f.host.worldId).length,24);assert.equal(f.souls.lifecycle!.faults.size,0);
  for(const a of arrivals){assert.equal(f.db.soul(a.soulId)!.owner,'dev:'+a.owner);assert.equal(f.souls.controlReady(f.db.soul(a.soulId)!),true);}
  const foreign=await f.request('/v1/lifecycle/'+existing.requestId,undefined,'arrival1');assert.equal(foreign.status,404);assert.equal(foreign.headers.get('cache-control'),'no-store');
  await accept(f.host,f.host.enqueue('rules','fixture',{dayConfig:{origin:0,dayTicks:72000,customs:[]}}));
  for(let i=0;i<140;i++)f.host.tickOnce();assert.deepEqual(f.host.engine.runtime.violations,[]);
  const head={tick:f.host.engine.world.tick,engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel),station:hashOf(f.host.stationHistoryV2()),
    minds:JSON.stringify([...f.host.minds.values()])};assert.equal(head.tick,177);
  const make=()=>new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});
  const saved=make();assert.equal(saved.boot().from,'snapshot');assert.equal(saved.engine.stateHash(),head.engine);assert.equal(kernelHash(saved.kernel),head.kernel);
  f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
  const complete=make();assert.equal(complete.boot().from,'genesis');assert.equal(complete.engine.world.tick,head.tick);
  assert.equal(complete.engine.stateHash(),head.engine);assert.equal(kernelHash(complete.kernel),head.kernel);
  const resumed=new LifecycleRunner(complete,new LifecycleJournal(f.db),()=>true);assert.equal(resumed.faults.size,0);
  assert.equal(hashOf(complete.stationHistoryV2()),head.station);assert.equal(JSON.stringify([...complete.minds.values()]),head.minds);
  assert.equal(new ClockFrontiers(f.db).read(f.host.worldId)!.tick,head.tick);assert.equal(f.db.paidCost(),0);assert.equal(f.db.brainCalls(10000).length,0);
  const legacyReader=await marsCommonsTransitionFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
  assert.throws(()=>new WorldHost(f.db,legacyReader,f.host.seed,1e9,f.host.worldId,{durableClockV1:true}).boot(),/incompatible/);
});

// arrival-search/1 (lane ARR, 2026-10-20). This test used to expect the 13th Soul refused: the legacy placer's six rings
// round the commons arrival (<= 4.5 m) were full and its last candidate overlapped commons-bench-east, so the native
// safety check refused it. That refusal guarded no capacity or anti-flood rule (the only real limit is maxSoulsPerUser,
// 409 'too-many'), so the 13th is now born on the nearest open ground instead, recorded as birth-near/1 {at, first:true}.
// The refusal path itself (no birth, reservation released, liveness) is lifecycle-runner.test.ts's unavailable test.
// The title below is kept verbatim so the release gate's test ids stay stable (decision 2026-10-20: no rename); what the
// test now proves is: a crowded legacy commons arrival admits the 13th Soul on the nearest open ground, and never faults
// the standing population.
test('unsafe legacy commons HTTP admission refuses before birth, releases reservation and never faults the healthy standing population',async t=>{
  const factory=await marsFactory({...EDEN_COMMONS_WORLD,safeCrewRemoval:true}),f=fixture(':memory:',factory);t.after(()=>f.db.close());f.souls.enableLifecycle();
  for(let i=0;i<4;i++)await invite(f,'legacy'+i);
  for(let i=0;i<12;i++)await create(f,'legacy'+Math.floor(i/4),'Resident '+i);
  const before=f.db.events(f.host.worldId).filter(e=>e.kind==='birth');assert.equal(before.some(e=>'near' in e.payload),false,'the twelve keep the default placement');
  const born=await create(f,'legacy3','Thirteenth'),body=f.host.engine.world.entities[born.entityId]!;
  const birth=f.db.events(f.host.worldId).find(e=>e.kind==='birth'&&e.payload.soulId===born.soulId)!;
  assert.equal(birth.payload.near?.first,true);assert.deepEqual(birth.payload.near.at,[Math.round(body.pose.p[0]*1000)/1000,Math.round(body.pose.p[2]*1000)/1000]);
  const [ax,az]=EDEN_COMMONS_WORLD.arrival;assert.ok(Math.hypot(body.pose.p[0]-ax,body.pose.p[2]-az)<12,'nearby');
  for(const e of Object.values(f.host.engine.world.entities))if(e.kind==='human'&&e.id!==body.id)assert.ok(Math.hypot(e.pose.p[0]-body.pose.p[0],e.pose.p[2]-body.pose.p[2])>=0.8);
  for(let i=0;i<20;i++)f.host.tickOnce();assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
});
