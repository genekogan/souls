import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {setImmediate} from 'node:timers/promises';
import {WorldHost} from './world.ts';
const factory=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
test('enacted raised-deck arrival exposes old ground-fixture refusal; prospective policy admits and executes the requested ground walk with exact replay',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic invited floor-goal owner'}));f.brain.quiesce();
  await accept(f.host,f.host.enqueue('decision','soul:'+row.id,{soulId:row.id,entityId:row.entity_id,option:'deck-walk',label:'approach deck',steps:[{verb:'walk_to',params:{to:'commons-deck',standoff:0}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
  for(let i=0;i<500&&f.host.engine.programOf(row.entity_id);i++){f.host.tickOnce();if(i%10===0)await setImmediate();}assert.equal(f.host.engine.world.entities[row.entity_id].human!.level,1);
  const program={actor:row.entity_id,label:'walk to ground bench',steps:[{verb:'walk_to',params:{to:'commons-bench-east',standoff:1.2}}]};assert.ok(f.host.engine.canPerform(program),'legacy level inference refuses the ground target from deck');
  const start=[...f.host.engine.world.entities[row.entity_id].pose.p];await accept(f.host,f.host.enableGroundFixtureGoalsV1());assert.equal(f.host.engine.canPerform(program),null);
  await accept(f.host,f.host.enqueue('decision','soul:'+row.id,{soulId:row.id,entityId:row.entity_id,option:'bench-walk',label:program.label,steps:program.steps,reevalTicks:1e9,fallback:false,trigger:'fixture'}));
  for(let i=0;i<500&&f.host.engine.programOf(row.entity_id);i++){f.host.tickOnce();if(i%10===0)await setImmediate();}const body=f.host.engine.world.entities[row.entity_id];assert.equal(body.human!.level,0);assert.ok(Math.hypot(body.pose.p[0]-start[0],body.pose.p[2]-start[2])>.05);assert.deepEqual(f.host.engine.runtime.violations,[]);
  f.host.saveSnapshot(true);const hash=f.host.engine.stateHash();let h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'snapshot');assert.equal(h.engine.stateHash(),hash);h.stop();f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.equal(h.engine.stateHash(),hash);h.stop();assert.equal(f.db.paidCost(),0);
});
