import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory,COMMONS_PERSONAL_RESOURCES,commonsFoodDeliveryItemsV1} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {installCommonsProvisionCards} from './commons-provisions.ts';
import {installFoodDeliveryCardsV1,scheduleFiniteFoodDeliveryV1} from './food-delivery.ts';
import {WorldHost} from './world.ts';
import {kernelHash} from '@souls/kernel';
import {setImmediate} from 'node:timers/promises';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
const factory=await retainedCommonsShoreFactory({foodDeliveryV1:true});
test('eight human owners get one finite new meal each while consumed old bowl/stock/history remain; actual repeat meal and replay exact',async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});await accept<unknown>(f.host,new LivingWorld(f.host).install(['People may eat finite provisions and meet.']));for(let i=0;i<4;i++)f.host.tickOnce();f.host.drainInputs();
 const rows:Awaited<ReturnType<typeof f.souls.create>>[]=[];for(let i=0;i<8;i++){await invite(f,'owner'+i);rows.push(await accept(f.host,f.souls.create('dev:owner'+i,{name:'Friend '+i,description:'Synthetic finite delivery owner'})));}
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installCommonsKitchenV1());await installCommonsProvisionCards(f.host,f.brain);
 const row=rows[0],bowl=COMMONS_PERSONAL_RESOURCES[0].bowl;await accept(f.host,f.request('/v1/souls/'+row.id+'/intent',{intent:{agenda:[{card:'eat prepared meal '+row.id.slice(2),target:null}]}},'owner0'));
 for(let i=0;i<3500&&((f.host.engine.world as NativeWorld).entities[bowl].contents?.fraction!==0||f.host.engine.programOf(row.entity_id));i++){f.host.tickOnce();if(i%10===0)await setImmediate();}assert.equal((f.host.engine.world as NativeWorld).entities[bowl].contents?.fraction,0);
 const old=structuredClone(f.host.engine.world.entities),regions=structuredClone(f.host.engine.world.regions),prefix=JSON.stringify(f.db.events(f.host.worldId));
 await accept(f.host,f.host.installCommonsFoodDeliveryV1('finite-operator-batch-A'));for(const [id,value] of Object.entries(old))assert.deepEqual(f.host.engine.world.entities[id],value);assert.deepEqual(f.host.engine.world.regions,regions);assert.equal(JSON.stringify(f.db.events(f.host.worldId).slice(0,JSON.parse(prefix).length)),prefix);
 const resources=commonsFoodDeliveryItemsV1(1).resources;assert.equal(resources.filter(r=>(f.host.engine.world as NativeWorld).entities[r.bowl].contents?.fraction===1).length,8);assert.equal((await installFoodDeliveryCardsV1(f.host,f.brain)).filter(v=>v.ok).length,16);for(const r of rows)assert.ok(f.host.kernel.decks[r.id].cards.includes('eat delivered meal 1 '+r.id.slice(2)));
 assert.equal(f.host.engine.previewCommonsFoodDeliveryV1!('finite-operator-batch-A').ok,false);await assert.rejects(f.host.installCommonsFoodDeliveryV1('finite-operator-batch-A'),/already-delivered/);
 await accept(f.host,f.request('/v1/souls/'+row.id+'/intent',{intent:{agenda:[{card:'eat delivered meal 1 '+row.id.slice(2),target:null}]}},'owner0'));
 for(let i=0;i<3500&&((f.host.engine.world as NativeWorld).entities[resources[0].bowl].contents?.fraction!==0||f.host.engine.programOf(row.entity_id));i++){f.host.tickOnce();if(i%10===0)await setImmediate();}assert.equal((f.host.engine.world as NativeWorld).entities[resources[0].bowl].contents?.fraction,0);assert.equal((f.host.engine.world as NativeWorld).entities[bowl].contents?.fraction,0);assert.equal(resources.slice(1).filter(r=>(f.host.engine.world as NativeWorld).entities[r.bowl].contents?.fraction===1).length,7);assert.deepEqual(f.host.engine.runtime.violations,[]);
 f.brain.quiesce();f.host.drainInputs();f.host.saveSnapshot(true);const head={native:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)},life=JSON.stringify([...f.host.minds.values()].map(m=>m.life));
 let h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'snapshot');assert.deepEqual({native:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head);assert.equal(JSON.stringify([...h.minds.values()].map(m=>m.life)),life);h.stop();f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.deepEqual({native:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head);assert.equal(JSON.stringify([...h.minds.values()].map(m=>m.life)),life);h.stop();assert.equal(f.db.paidCost(),0);
});

test('delivery composes with accepted shore and consumed canonical resources; cap and duplicate remain finite, passive hook starts no activity',async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic shore-delivery owner'}));f.brain.quiesce();await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installCommonsKitchenV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 const old=structuredClone(f.host.engine.world.entities),pose=[...f.host.engine.world.entities[row.entity_id].pose.p],install=scheduleFiniteFoodDeliveryV1(f.host,f.brain,'shore-finite-A');t.after(()=>install.close());
 await accept(f.host,install.settled());assert.equal(install.status().phase,'installed');assert.deepEqual(f.host.engine.world.entities[row.entity_id].pose.p,pose);for(const [id,v] of Object.entries(old))assert.deepEqual(f.host.engine.world.entities[id],v);assert.ok(f.host.engine.renderScene!().shore);assert.equal(f.host.engine.rulesVersion.endsWith('+fd/1'),true);assert.equal(f.host.engine.programOf(row.entity_id),null);
 for(let i=2;i<=4;i++)await accept(f.host,f.host.installCommonsFoodDeliveryV1('bounded-'+i));const no=f.host.engine.previewCommonsFoodDeliveryV1!('fifth');assert.equal(no.ok,false);if(!no.ok)assert.equal(no.diagnostic.code,'food-delivery.capacity');assert.equal(f.host.engine.commonsFoodDeliveriesV1!().length,4);
 const snapshot=f.host.engine.snapshot(),restored=factory.restore(snapshot);assert.equal(restored.stateHash(),f.host.engine.stateHash());assert.deepEqual(restored.commonsFoodDeliveriesV1!(),f.host.engine.commonsFoodDeliveriesV1!());assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
});
