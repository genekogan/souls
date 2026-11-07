// Actual invited HTTP owner and lifecycle persistence; physical decisions are
// explicit trusted fixture inputs, not ordinary-language/compiler qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {hashOf} from '@souls/engine-contract';
import {kernelHash} from '@souls/kernel';
import {connectedCommonsBoatFactory} from '@souls/engine-mars';
import {connectedCommonsBoatFixture} from '../../../packages/engine-mars/src/connected-boat.ts';
import {soulLifecycleSchema,ownerLifecycleListSchema} from '@souls/protocol';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';

test('owned docked passenger retirement stays private/pending through real exit and recovers moving WAL/snapshot/genesis exactly',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'eden-owned-boat-')),path=join(dir,'world.sqlite'),factory=await connectedCommonsBoatFactory(),native=await connectedCommonsBoatFixture();t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let f=fixture(path,factory,{durableClockV1:true});t.after(()=>{f.host.stop();f.db.close();});f.souls.enableLifecycle();await invite(f,'alice');await invite(f,'bob');
  await accept(f.host,f.host.enqueue('rules','fixture',{dayConfig:{origin:0,dayTicks:72000,customs:[]}}));
  const created=await f.app.request('/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:alice','content-type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name:'Owned passenger',description:'local human-owned boat proof'})});assert.equal(created.status,202);const birth=soulLifecycleSchema.parse((await created.json() as any).lifecycle);for(let i=0;i<20&&!f.souls.lifecycleReceipt('dev:alice',birth.requestId).ready;i++){await setImmediate();f.host.drainInputs();}assert.equal(f.souls.lifecycleReceipt('dev:alice',birth.requestId).ready,true,JSON.stringify({receipt:f.souls.lifecycleReceipt('dev:alice',birth.requestId),faults:[...f.souls.lifecycle!.faults]}));assert.equal(f.db.soul(birth.soulId)!.owner,'dev:alice');
  const body=()=>f.host.engine.world.entities[birth.entityId] as any,boat=()=>f.host.engine.world.entities[native.policy.boatId] as any;
  async function physical(steps:{verb:string;params:Record<string,unknown>}[],label:string){await accept(f.host,f.host.enqueue('decision','fixture',{soulId:birth.soulId,entityId:birth.entityId,option:'fixture',label,steps,reevalTicks:36000,fallback:true,trigger:'fixture-native-boat'}));assert.ok(f.host.engine.programOf(birth.entityId),'actual decision starts native program');for(let i=0;i<3500&&f.host.engine.programOf(birth.entityId);i++){f.host.tickOnce();if(i%30===0)await setImmediate();}assert.equal(f.host.engine.programOf(birth.entityId),null);}
  await physical([{verb:'walk_to',params:{to:[native.layout.bank[0],native.layout.bank[2]]}}],'approach bank');await physical([{verb:'mars:boat_board',params:{slot:'seat0'}}],'board');assert.equal(body().human.boatPassenger.phase,'seated');assert.deepEqual(boat().boat.pilotIds,[]);
  const foreign=await f.app.request('/v1/souls/'+birth.soulId,{method:'DELETE',headers:{authorization:'Bearer dev:bob','X-Sim-Lifecycle':'1'}});assert.equal(foreign.status,403);assert.ok(body());
  const response=await f.app.request('/v1/souls/'+birth.soulId,{method:'DELETE',headers:{authorization:'Bearer dev:alice','X-Sim-Lifecycle':'1'}});assert.equal(response.status,202);assert.equal(response.headers.get('cache-control'),'no-store');const death=soulLifecycleSchema.parse((await response.json() as any).lifecycle);assert.equal(death.state,'retiring');assert.equal(death.ready,false);assert.ok(body());f.host.drainInputs();for(let i=0;i<50;i++)f.host.tickOnce();assert.ok(body());assert.equal(body().human.boatPassenger.phase,'leaving');assert.equal(f.souls.lifecycleReceipt('dev:alice',death.requestId).state,'retiring');
  const headOf=()=>({tick:f.host.engine.world.tick,seq:f.host.seq,engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel),life:hashOf([...f.host.minds.values()].map(m=>m.life)),receipts:hashOf(f.souls.lifecycleHistory('dev:alice'))}),head=headOf();assert.ok(f.host.saveSnapshot(true));f.host.stop();f.db.close();
  f=fixture(path,factory,{durableClockV1:true});f.souls.enableLifecycle();assert.deepEqual(headOf(),head);assert.equal(body().human.boatPassenger.phase,'leaving');
  f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);f.host.stop();f.db.close();f=fixture(path,factory,{durableClockV1:true});f.souls.enableLifecycle();assert.deepEqual(headOf(),head);assert.equal(body().human.boatPassenger.phase,'leaving');
  for(let i=0;i<1800&&f.souls.lifecycleReceipt('dev:alice',death.requestId).state!=='retired';i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}
  const retired=f.souls.lifecycleReceipt('dev:alice',death.requestId);assert.equal(retired.state,'retired');assert.ok(retired.fact);assert.equal(body(),undefined);assert.deepEqual(boat().boat.passengers,{});assert.equal(f.host.minds.has(birth.soulId),false);assert.equal(f.souls.lifecycle!.faults.size,0);assert.deepEqual(f.host.engine.runtime.violations,[]);
  const refreshed=await f.request('/v1/me'),data=await refreshed.json() as any;assert.equal(refreshed.headers.get('cache-control'),'no-store');assert.deepEqual(data.souls,[]);const page=ownerLifecycleListSchema.parse(data.lifecycleRequests);assert.equal(page.requests.find(r=>r.requestId===death.requestId)!.state,'retired');assert.equal((await f.request('/v1/lifecycle/'+death.requestId,undefined,'bob')).status,404);
  const captures=f.host.engine.takeChunks!(Math.max(0,f.host.engine.world.tick-240)).map(c=>({take:c.take,capture:f.host.engine.takeScene!((c.take as any).renderSceneRef.hash)}));assert.ok(captures.length);assert.ok(!JSON.stringify(captures).includes(death.requestId));assert.equal(f.db.paidCost(),0);
  const trace={contract:'core-owned-connected-boat-retirement-probe/1',rulesVersion:factory.rulesVersion,localInvitedHumans:2,ownedSouls:1,head,terminal:{tick:f.host.engine.world.tick,seq:f.host.seq,retired},captures,nativeViolations:f.host.engine.runtime.violations,paidUSD:0,limits:['trusted-fixture-physical-decisions-not-ordinary-compiler','no-pilot-grant-or-owned-underway-episode','same-process-WAL-connection-reopen-not-OS-crash','no-realAuth/UI/cohort/default/release']};
  const out=process.env.SIM_CONNECTED_BOAT_PROOF;if(out)writeFileSync(out,JSON.stringify(trace),{flag:'wx'});
});
