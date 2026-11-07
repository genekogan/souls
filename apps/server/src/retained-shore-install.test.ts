import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {scheduleRetainedCommonsShoreInstallation} from './retained-shore-install.ts';
import {setImmediate} from 'node:timers/promises';
const factory=await retainedCommonsShoreFactory();
test('passive shore installation keeps HTTP/clock and existing rest live, commits once after natural quiet',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic quiet-boundary owner'}));
  await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installCommonsKitchenV1());f.brain.quiesce();
  await accept(f.host,f.host.enqueue('decision','soul:'+row.id,{soulId:row.id,entityId:row.entity_id,option:'finite-rest',label:'ordinary finite native rest',steps:[{verb:'rest',params:{seconds:2}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
  const original=f.host.engine.programOf(row.entity_id),bodies=structuredClone(f.host.engine.world.entities),tick=f.host.engine.world.tick;
  const install=scheduleRetainedCommonsShoreInstallation(f.host);t.after(()=>{install.close();f.host.stop();f.db.close();});
  assert.deepEqual(install.status(),{phase:'waiting',reason:'retained-shore.not-quiet-commons'});assert.equal(f.host.engine.programOf(row.entity_id),original);assert.equal((await f.app.request('/healthz')).status,200);
  for(let i=0;i<200&&install.status().phase!=='installed';i++){f.host.tickOnce();await setImmediate();}
  await accept(f.host,install.settled());assert.equal(install.status().phase,'installed');assert.ok(f.host.engine.world.tick>tick);assert.deepEqual(f.host.engine.world.entities,bodies);assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='rules'&&e.payload.retainedCommonsShore).length,1);assert.equal(f.db.paidCost(),0);
});

test('natural daily compact window is observed between cadence probes, without adding another quiet or stopping programmes',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic daily checkpoint owner'}));f.brain.quiesce();
  await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installCommonsKitchenV1());
  const {LivingWorld}=await import('./living.ts');const life=new LivingWorld(f.host);await accept<unknown>(f.host,life.install(['People can rest.']));
  const rest=await accept(f.host,f.host.enqueue('decision','soul:'+row.id,{soulId:row.id,entityId:row.entity_id,option:'short-rest',label:'ordinary short rest',steps:[{verb:'rest',params:{seconds:.3}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
  const install=scheduleRetainedCommonsShoreInstallation(f.host);t.after(()=>{install.close();f.host.stop();f.db.close();});
  for(let i=0;i<18&&install.status().phase!=='installed';i++){f.host.tickOnce();await setImmediate();}
  await accept(f.host,install.settled());assert.equal(install.status().phase,'installed');assert.ok(f.host.engine.world.tick<20,'observed short natural quiet window before next ordinary polling cadence');
  const facts=f.db.events(f.host.worldId);assert.equal(facts.filter(e=>e.kind==='rules'&&e.payload.quiet).length,1);assert.equal(facts.filter(e=>e.kind==='decision').length,1);assert.equal(facts.find(e=>e.kind==='decision')!.seq,rest.seq);assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
});
