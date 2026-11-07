import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {WorldHost} from './world.ts';
const factory=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
test('humanoid native rest recovers energy only after its logged prospective policy; snapshot and genesis retain exact needs',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});f.brain.quiesce();
  await accept<unknown>(f.host,new LivingWorld(f.host).install(['Residents rest and explore.']));for(let i=0;i<4;i++)f.host.tickOnce();f.host.drainInputs();
  await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic invited owner rest-recovery fixture'})),m=f.host.minds.get(row.id)!;
  await accept(f.host,f.host.enqueue('decision','soul:'+row.id,{soulId:row.id,entityId:row.entity_id,option:'rest',label:'rest',steps:[{verb:'rest',params:{seconds:90}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
  const initial=m.life!.needs.energy;for(let i=0;i<100;i++)f.host.tickOnce();const before=m.life!.needs.energy;assert.ok(before<initial);assert.equal(f.host.engine.bodyResting!(row.entity_id),true);
  const source=await accept(f.host,f.host.enableHumanRestNeedsV1());for(let i=0;i<100;i++)f.host.tickOnce();assert.ok(m.life!.needs.energy>before);assert.equal(source.payload.runtimePolicy.humanRestNeedsV1,true);assert.deepEqual(f.host.engine.runtime.violations,[]);
  f.host.saveSnapshot(true);const needs=structuredClone(m.life),hash=f.host.engine.stateHash();let boot=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(boot.boot().from,'snapshot');assert.deepEqual(boot.minds.get(row.id)!.life,needs);assert.equal(boot.engine.stateHash(),hash);boot.stop();
  f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);boot=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(boot.boot().from,'genesis');assert.deepEqual(boot.minds.get(row.id)!.life,needs);assert.equal(boot.engine.stateHash(),hash);boot.stop();assert.equal(f.db.paidCost(),0);
});
