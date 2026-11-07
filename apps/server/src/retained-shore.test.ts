import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory,COMMONS_PERSONAL_RESOURCES,COMMONS_KITCHENS} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {installCommonsProvisionCards} from './commons-provisions.ts';
import {installCommonsKitchenCards} from './commons-kitchen.ts';
import {LivingWorld} from './living.ts';
import {WorldHost} from './world.ts';
import {setImmediate} from 'node:timers/promises';
import {kernelHash} from '@souls/kernel';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
const factory=await retainedCommonsShoreFactory();
test('eight canonical human owners retain resources/history at shore checkpoint; ordinary owner swim/return and snapshot/genesis agree',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});
  await accept<unknown>(f.host,new LivingWorld(f.host).install(['People may eat, explore the supported shore, swim and meet.']));for(let i=0;i<4;i++)f.host.tickOnce();f.host.drainInputs();
  const rows:Awaited<ReturnType<typeof f.souls.create>>[]=[];
  for(let i=0;i<8;i++){const owner='owner'+i;await invite(f,owner);rows.push(await accept(f.host,f.souls.create('dev:'+owner,{name:'Friend '+i,description:'Synthetic invited retained-shore owner'})));}
  await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installCommonsKitchenV1());await installCommonsProvisionCards(f.host,f.brain);await installCommonsKitchenCards(f.host,f.brain);
  const entities=structuredClone(f.host.engine.world.entities),regions=structuredClone(f.host.engine.world.regions),prefix=JSON.stringify(f.db.events(f.host.worldId)),owners=JSON.stringify(rows.map(r=>f.db.soul(r.id)));
  await accept(f.host,f.host.installRetainedCommonsShoreV1());assert.equal(JSON.stringify(rows.map(r=>f.db.soul(r.id))),owners);assert.equal(JSON.stringify(f.db.events(f.host.worldId).slice(0,JSON.parse(prefix).length)),prefix);
  for(const [id,v] of Object.entries(entities))assert.deepEqual(f.host.engine.world.entities[id],v);for(const [id,v] of Object.entries(regions))assert.deepEqual(f.host.engine.world.regions[id],v);assert.ok(f.host.kernel.things['shore-water']);
  const row=rows[0];async function journey(target:string){const response=await accept(f.host,f.request('/v1/souls/'+row.id+'/intent',{intent:{agenda:[{card:'go to',target}],note:'Visit '+target}},'owner0'));assert.equal(response.status,200);let reached=false;const phases=new Set<string>();for(let i=0;i<3500;i++){f.host.tickOnce();if(i%10===0)await setImmediate();phases.add(f.host.engine.world.entities[row.entity_id].human!.activity);assert.deepEqual(f.host.engine.runtime.violations,[]);if(f.host.kernel.things[row.id].at===target&&!f.host.minds.get(row.id)!.pending){reached=true;break;}}assert.ok(reached,target);return phases;}
  const phases=await journey('shore-water');assert.ok(phases.has('walk')&&phases.has('wade')&&phases.has('swim'));assert.equal(f.host.engine.world.entities[row.entity_id].human!.activity,'tread');await journey('commons');
  const w=(f.host.engine.world as NativeWorld).entities;for(const r of COMMONS_PERSONAL_RESOURCES)assert.equal(w[r.bowl].contents?.fraction,1);for(const r of COMMONS_KITCHENS)assert.equal(w[r.beans].contents?.fraction,1);
  f.brain.quiesce();f.host.drainInputs();f.host.saveSnapshot(true);const head={native:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)},life=JSON.stringify([...f.host.minds.values()].map(m=>m.life));
  let h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'snapshot');assert.deepEqual({native:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head);assert.equal(JSON.stringify([...h.minds.values()].map(m=>m.life)),life);h.stop();
  f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.deepEqual({native:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head);assert.equal(JSON.stringify([...h.minds.values()].map(m=>m.life)),life);h.stop();assert.equal(f.db.paidCost(),0);
});
