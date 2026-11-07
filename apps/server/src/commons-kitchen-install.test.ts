import test from 'node:test';
import assert from 'node:assert/strict';
import {commonsKitchenFactory,COMMONS_PERSONAL_RESOURCES} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import type {Card} from '@souls/kernel';
import {LivingWorld} from './living.ts';
import {installCommonsProvisionCards} from './commons-provisions.ts';
import {scheduleCommonsKitchenInstallation} from './commons-kitchen-install.ts';
import {setImmediate} from 'node:timers/promises';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
const factory=await commonsKitchenFactory({version:'commons-kitchen/2'});
test('API and clock stay usable while non-resumable ground sleep delays kitchen; passive safe-boundary installation preserves the original activity',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();
  await accept<unknown>(f.host,new LivingWorld(f.host).install(['People can eat finite food and meet.']));for(let i=0;i<4;i++)f.host.tickOnce();f.host.drainInputs();
  await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic kitchen-readiness owner'}));await accept(f.host,f.host.installCommonsProvisionsV1());await installCommonsProvisionCards(f.host,f.brain);
  const r=COMMONS_PERSONAL_RESOURCES[0],name='brief ground sleep '+row.id.slice(2);
  const card:Card={name,summary:'A short synthetic ground sleep for readiness evidence.',good_when:'Synthetic finite ground rest.',target:null,when:[],then:[{set:['$actor','doing','sleeping']}],approach:[],during:[{verb:'mars:sleep',params:{mat:r.mat,duration:2,returnTo:r.sleepReturn}}],takes:'seconds'};
  const minted=await accept(f.host,f.brain.mint(f.host.minds.get(row.id)!,[card],undefined,undefined,'compiled'));assert.ok(minted[0].ok);
  const response=await accept(f.host,f.request('/v1/souls/'+row.id+'/intent',{intent:{agenda:[{card:name,target:null}],note:'Take the finite ground rest.'}},'alice'));assert.equal(response.status,200);
  for(let i=0;i<1500&&f.host.engine.canSnapshot!();i++){f.host.tickOnce();if(i%5===0)await setImmediate();}
  assert.equal(f.host.engine.canSnapshot!(),false,'actual ground sleep is non-resumable');f.brain.quiesce();
  const originalProgram=f.host.engine.programOf(row.entity_id),hash=f.host.engine.stateHash(),prefix=JSON.stringify(f.db.events(f.host.worldId)),tick=f.host.engine.world.tick;
  const install=scheduleCommonsKitchenInstallation(f.host,f.brain);t.after(()=>{install.close();f.host.stop();f.db.close();});
  assert.deepEqual(install.status(),{phase:'waiting',reason:'commons-kitchen.resumable-boundary-required'});assert.equal(f.host.engine.stateHash(),hash);assert.equal(f.host.engine.programOf(row.entity_id),originalProgram);
  assert.equal((await f.app.request('/healthz')).status,200);
  for(let i=0;i<4500&&install.status().phase!=='installed';i++){f.host.tickOnce();if(i%5===0)await setImmediate();}
  await accept(f.host,install.settled());assert.equal(install.status().phase,'installed');assert.ok(f.host.engine.world.tick>tick);assert.ok(f.host.engine.rulesVersion.endsWith('+commons-kitchen/2'));assert.equal(JSON.stringify(f.db.events(f.host.worldId).slice(0,JSON.parse(prefix).length)),prefix);
  const native=(f.host.engine.world as NativeWorld).entities;
  for(let i=0;i<4500&&f.host.engine.programOf(row.entity_id);i++){f.host.tickOnce();if(i%5===0)await setImmediate();}
  assert.equal(native[r.bowl].contents?.fraction,1);assert.ok(!native[row.entity_id].human!.grip);assert.deepEqual(f.host.engine.runtime.violations,[]);
  const facts=f.db.events(f.host.worldId);assert.equal(facts.filter(e=>e.kind==='rules'&&e.payload.commonsKitchen).length,1);assert.equal(facts.filter(e=>e.kind==='decision'&&e.payload.card===name).length,1);assert.ok(f.host.kernel.decks[row.id].cards.includes('prepare shared dish '+row.id.slice(2)));assert.equal(f.db.paidCost(),0);
});
