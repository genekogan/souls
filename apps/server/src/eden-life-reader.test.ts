import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,GREEN_FIELD_WORLD,marsCrewRemovalTransitionFactory} from '@souls/engine-mars';
import {commonsLifeReaderFactory} from '../../../packages/engine-mars/src/commons-life-engine.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {WorldHost} from './world.ts';
import {installEdenCore} from './eden-bootstrap.ts';
import {kernelHash} from '@souls/kernel';
test('C208 original owned SQLite history composes finite life resources and restores both snapshot and genesis without owner reseeding',async t=>{
 const legacy=await marsFactory(GREEN_FIELD_WORLD),f=fixture(':memory:',legacy);t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});await invite(f,'original');const row=await accept(f.host,f.souls.create('dev:original',{name:'Original',description:'Synthetic retained bootstrap owner'}));f.brain.quiesce();f.host.saveSnapshot(true);f.host.stop();const prefix=JSON.stringify(f.db.events(f.host.worldId));
 const reader=commonsLifeReaderFactory(await marsCrewRemovalTransitionFactory()),h=new WorldHost(f.db,reader,f.host.seed,1e9,f.host.worldId);h.boot();await installEdenCore(h,{applyCrew:true,applyCommons:true});await accept(h,h.installCommonsProvisionsV1());await accept(h,h.installCommonsKitchenV1());await accept(h,h.installCommonsFoodDeliveryV1('portable-explicit-A'));assert.equal(JSON.stringify(f.db.events(h.worldId).slice(0,JSON.parse(prefix).length)),prefix);assert.deepEqual(f.db.soul(row.id),row);assert.equal(h.minds.get(row.id)!.entityId,row.entity_id);
 h.saveSnapshot(true);const head={engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)};let again=new WorldHost(f.db,reader,h.seed,1e9,h.worldId);assert.equal(again.boot().from,'snapshot');assert.deepEqual({engine:again.engine.stateHash(),kernel:kernelHash(again.kernel)},head);again.stop();f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(h.worldId);again=new WorldHost(f.db,reader,h.seed,1e9,h.worldId);assert.equal(again.boot().from,'genesis');assert.deepEqual({engine:again.engine.stateHash(),kernel:kernelHash(again.kernel)},head);assert.deepEqual(f.db.soul(row.id),row);again.stop();h.stop();assert.equal(f.db.paidCost(),0);
});
