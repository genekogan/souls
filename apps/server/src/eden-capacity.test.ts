// Bounded local admission/workload measurement, not a cohort or release claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { setImmediate,setTimeout as delay } from 'node:timers/promises';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { kernelHash } from '@souls/kernel';
import { WorldHost,replayFromGenesis } from './world.ts';
import { LivingWorld } from './living.ts';
import { fixture,invite,accept } from '../test/native-owner-fixture.ts';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
const definitionPath=new URL('../../../worlds/eden/world.json',import.meta.url);
const definitionBytes=readFileSync(definitionPath),definition=JSON.parse(definitionBytes.toString());
const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
test('selected existing Eden greenfield admits bounded owner waves with measured fake workload and exact restart',async t=>{
  assert.equal(definition.scene,'greenfield');assert.equal(definition.cast.length,1);
  const f=fixture(':memory:',factory);t.after(()=>f.db.close());f.souls.enableLifecycle();
  const living=new LivingWorld(f.host);await accept<unknown>(f.host,living.install(definition.customs));
  await accept(f.host,f.host.enqueue('rules','fixture',{runtimePolicy:{sleepBlockTicks:1200,quietSeatCourtesy:true}}));
  await invite(f,'steward');
  const create=async(owner:string,name:string,description='local capacity fixture')=>{
    const start=performance.now();const r=await f.app.request('/v1/souls',{method:'POST',headers:{authorization:`Bearer dev:${owner}`,'content-type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name,description})});
    assert.equal(r.status,202);const data=await r.json() as {lifecycle:{requestId:string;soulId:string}};return {owner,start,...data.lifecycle};
  };
  const seeded=await create('steward',definition.cast[0].name,definition.cast[0].description);f.host.drainInputs();await delay(0);
  const owners=[seeded],phases:Record<string,number>[]=[];let accepted=0;
  for(let wave=0;wave<7;wave++){
    const fresh=[];
    for(let j=0;j<4;j++){const index=wave*4+j+1,owner=`capacity${index}`;await invite(f,owner);fresh.push(create(owner,`Friend ${index}`));}
    const arrivals=await Promise.all(fresh);owners.push(...arrivals);
    // Births are admitted one per macrotask (lane srv-join-stall: one detached probe per tick), so a wave of four
    // needs several drains; one drainInputs no longer admits the whole wave.
    const admitted=()=>arrivals.every(o=>{const l=f.souls.lifecycleReceipt('dev:'+o.owner,o.requestId);return l.state==='admitted'&&l.ready;});
    for(let i=0;i<50&&!admitted();i++){f.host.drainInputs();await delay(0);}
    const admissionMs=[];
    for(const o of arrivals){const r=await f.request(`/v1/lifecycle/${o.requestId}`,undefined,o.owner),receipt=await r.json() as {lifecycle:{state:string;ready:boolean}};assert.equal(r.status,200);assert.equal(receipt.lifecycle.state,'admitted');assert.equal(receipt.lifecycle.ready,true);admissionMs.push(performance.now()-o.start);accepted++;}
    const directed=owners.map(o=>f.request(`/v1/souls/${o.soulId}/intent`,{intent:{goal:'wander',text:'wander in this green field'}},o.owner));
    for(const r of await accept(f.host,Promise.all(directed)))assert.equal(r.status,200);
    const starts=new Map(owners.map(o=>[o.soulId,[...f.host.engine.world.entities[f.db.soul(o.soulId)!.entity_id].pose.p]]));
    const samples:number[]=[];const started=performance.now(),heapStart=process.memoryUsage().heapUsed;
    for(let i=0;i<1200;i++){const at=performance.now();f.host.tickOnce();samples.push(performance.now()-at);if(i%20===0)await setImmediate();}
    let moved=0;
    for(const o of owners){const row=f.db.soul(o.soulId)!;assert.equal(f.souls.controlReady(row),true);const p=f.host.engine.world.entities[row.entity_id].pose.p,q=starts.get(o.soulId)!;if(Math.hypot(p[0]-q[0],p[2]-q[2])>.05)moved++;}
    assert.ok(moved>0,'actual native movement, not only admitted rows');assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.souls.lifecycle!.faults.size,0);
    phases.push({owners:owners.length,ticks:1200,simSeconds:60,moved,wallMs:performance.now()-started,tickP50Ms:percentile(samples,.5),tickP95Ms:percentile(samples,.95),tickMaxMs:Math.max(...samples),admissionP95Ms:percentile(admissionMs,.95),heapDeltaBytes:process.memoryUsage().heapUsed-heapStart,heapUsedBytes:process.memoryUsage().heapUsed,events:f.db.events(f.host.worldId,0,10000).length,brainCalls:f.db.brainCalls(10000).length});
  }
  assert.equal(accepted,28);assert.equal(f.host.minds.size,29);assert.equal(f.db.liveSouls(f.host.worldId).length,29);assert.equal(f.db.paidCost(),0);
  await accept(f.host,f.host.enqueue('rules','fixture',{checkpoint:'bounded capacity workload ended'}));
  // Drain through the native resumability contract; no force-capture/cancellation.
  for(const m of f.host.minds.values())m.nextEvalTick=1e9;
  for(let i=0;i<1200&&f.host.engine.canSnapshot?.()===false;i++){f.host.tickOnce();if(i%20===0)await setImmediate();}
  assert.notEqual(f.host.engine.canSnapshot?.(),false);f.host.saveSnapshot(true);
  const hash=f.host.engine.stateHash(),kh=kernelHash(f.host.kernel),restart=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId);assert.equal(restart.boot().from,'snapshot');assert.equal(restart.engine.stateHash(),hash);assert.equal(kernelHash(restart.kernel),kh);
  const replay=replayFromGenesis(factory,f.host.seed,f.db.events(f.host.worldId,0,10000),f.host.engine.world.tick,{includeHeadEvents:true});assert.equal(replay.engine.stateHash(),hash);assert.equal(kernelHash(replay.kernel),kh);
  const report={contract:'local-eden-capacity-measurement/1',producerBaseCommit:'96ca22cce4c9b6b942d94c1546bcc05d6d5c1850',renderClockProjectionCommit:'5b10be13ff35fba7447a27840c15aba2af3c4100',testSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),definitionSha256:createHash('sha256').update(definitionBytes).digest('hex'),scene:definition.scene,fixtureWorldId:f.host.worldId,rulesVersion:factory.rulesVersion,seed:f.host.seed,phases,admittedFriends:accepted,totalBodies:29,headTick:f.host.engine.world.tick,stateHash:hash,kernelHash:kh,paidUsd:0,scope:'in-process actual HTTP, native/living/fake minds; no network/archive/Privy/providers/browser/expanded landscape/day-long or capacity ceiling proof'};
  if(process.env.SIM_CAPACITY_PROOF)writeFileSync(process.env.SIM_CAPACITY_PROOF,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
});
