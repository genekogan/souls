import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {setImmediate} from 'node:timers/promises';
const factory=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
test('explicit Eden autonomy uses ordinary decision/native work with no instructions or watchers and keeps the default idle gate',async t=>{
  const f=fixture(':memory:',factory);t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});
  await accept<unknown>(f.host,new LivingWorld(f.host).install(['Residents may explore, rest and meet each other.']));for(let i=0;i<4;i++)f.host.tickOnce();f.host.drainInputs();
  await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic invited human owner autonomy fixture'}));
  const programs:any[]=[];f.host.listeners.push({onProgram:e=>programs.push(e)});
  for(let i=0;i<60;i++){f.host.tickOnce();if(i%10===0)await setImmediate();}assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,0);assert.equal(f.brain.sink.clients(),0);
  await accept(f.host,f.brain.enableEdenAutonomyV1());for(let i=0;i<200&&!programs.some(e=>e.actor===row.entity_id&&e.kind==='step');i++){f.host.tickOnce();if(i%10===0)await setImmediate();}f.host.drainInputs();
  assert.ok(f.db.events(f.host.worldId).some(e=>e.kind==='decision'&&e.payload.entityId===row.entity_id));assert.ok(programs.some(e=>e.actor===row.entity_id&&e.kind==='step'));
  assert.ok(!f.db.events(f.host.worldId).some(e=>e.kind==='intent'||e.kind==='intent-v2'||e.kind==='mandate'));
  assert.equal(f.brain.sink.clients(),0);assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
});
