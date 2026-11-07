import test from 'node:test';
import assert from 'node:assert/strict';
import {commonsKitchenFactory,COMMONS_KITCHENS,COMMONS_PERSONAL_RESOURCES} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {installCommonsProvisionCards,followCommonsProvisionBirths} from './commons-provisions.ts';
import {installCommonsKitchenCards,followCommonsKitchenBirths} from './commons-kitchen.ts';
import {LivingWorld} from './living.ts';
import {setImmediate} from 'node:timers/promises';
import {WorldHost} from './world.ts';
import {kernelHash} from '@souls/kernel';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
const factory=await commonsKitchenFactory({version:'commons-kitchen/2'});
test('ordinary two-owner meal/preparation/serving conserves finite shared stock and exact snapshot/genesis; checkpoint preserves old state',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});
  await accept<unknown>(f.host,new LivingWorld(f.host).install(['People may prepare finite shared food, eat, rest and meet.']));for(let i=0;i<4;i++)f.host.tickOnce();f.host.drainInputs();
  const rows:Awaited<ReturnType<typeof f.souls.create>>[]=[];for(const owner of ['alice','bob']){await invite(f,owner);rows.push(await accept(f.host,f.souls.create('dev:'+owner,{name:owner,description:'Synthetic invited kitchen owner'})));}
  await accept(f.host,f.host.installCommonsProvisionsV1());await installCommonsProvisionCards(f.host,f.brain);
  const bodies=JSON.stringify(rows.map(r=>f.host.engine.world.entities[r.entity_id])),prefix=JSON.stringify(f.db.events(f.host.worldId)),before=structuredClone(f.host.engine.world.entities);
  await accept(f.host,f.host.installCommonsKitchenV1());assert.equal(JSON.stringify(rows.map(r=>f.host.engine.world.entities[r.entity_id])),bodies);assert.equal(JSON.stringify(f.db.events(f.host.worldId).slice(0,JSON.parse(prefix).length)),prefix);
  for(const [id,v] of Object.entries(before))assert.deepEqual(f.host.engine.world.entities[id],v);assert.equal((await installCommonsKitchenCards(f.host,f.brain)).filter(v=>v.ok).length,4);
  async function intent(i:number,kind:string,done:()=>boolean){const row=rows[i],card=kind+' '+row.id.slice(2);const response=await accept(f.host,f.request('/v1/souls/'+row.id+'/intent',{intent:{agenda:[{card,target:null}],note:kind}},i?'bob':'alice'));assert.equal(response.status,200);let completed=false;for(let j=0;j<6000;j++){f.host.tickOnce();if(j%10===0)await setImmediate();assert.deepEqual(f.host.engine.runtime.violations,[]);if(done()&&!f.host.minds.get(row.id)!.pending){completed=true;break;}}assert.ok(completed,kind);}
  const w=(f.host.engine.world as NativeWorld).entities,r=COMMONS_KITCHENS[0];
  for(let i=0;i<2;i++)await intent(i,'eat prepared meal',()=>w[COMMONS_PERSONAL_RESOURCES[i].bowl].contents?.fraction===0);
  await intent(0,'prepare shared dish',()=>w[r.pot].foodPreparation?.complete===true);assert.equal(w[r.beans].contents?.fraction,0);assert.equal(w[r.greens].contents?.fraction,0);assert.equal(w[r.pot].contents?.fraction,.5);
  for(let i=0;i<2;i++)await intent(i,'eat shared dish',()=>w[r.pot].contents?.fraction===(i===0?.25:0));
  assert.equal(w[r.pot].contents?.fraction,0);assert.equal(f.host.engine.canPerform({actor:rows[0].entity_id,label:'exhausted shared meal',steps:[{verb:'mars:take_item',params:{item:COMMONS_PERSONAL_RESOURCES[0].bowl,hand:'left'}},{verb:'mars:serve',params:{pot:r.pot,bowl:COMMONS_PERSONAL_RESOURCES[0].bowl}}]})?.code,'food.unavailable');
  for(const other of COMMONS_KITCHENS.slice(1)){assert.equal(w[other.beans].contents?.fraction,1);assert.equal(w[other.greens].contents?.fraction,1);assert.equal(w[other.pot].contents?.fraction,0);}
  f.brain.quiesce();f.host.drainInputs();f.host.saveSnapshot(true);const head={native:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)},life=JSON.stringify([...f.host.minds.values()].map(m=>m.life));
  let h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'snapshot');assert.deepEqual({native:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head);assert.equal(JSON.stringify([...h.minds.values()].map(m=>m.life)),life);h.stop();
  f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.deepEqual({native:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head);assert.equal(JSON.stringify([...h.minds.values()].map(m=>m.life)),life);h.stop();assert.equal(f.db.paidCost(),0);
});

test('future ordinary lifecycle birth receives both existing utensils/rest and kitchen cards without creating stock',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();
  await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installCommonsKitchenV1());
  const provisions=await followCommonsProvisionBirths(f.host,f.brain),kitchen=await followCommonsKitchenBirths(f.host,f.brain);
  t.after(()=>{provisions.close();kitchen.close();f.brain.quiesce();f.host.stop();f.db.close();});await invite(f,'alice');
  const response=await f.app.request('/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:alice','content-type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name:'Alice',description:'Synthetic future kitchen owner'})});assert.equal(response.status,202);
  const {lifecycle}=await response.json() as any;
  // HTTP202 is acceptance, not an applied birth. Drive the actual sequencer
  // until that birth before waiting for its subscriber work.
  for(let i=0;i<50&&!f.host.minds.has(lifecycle.soulId);i++){f.host.drainInputs();await setImmediate();}
  assert.ok(f.host.minds.has(lifecycle.soulId));await accept(f.host,Promise.all([provisions.settled(),kitchen.settled()]));
  const row=f.db.soul(lifecycle.soulId)!,deck=f.host.kernel.decks[row.id].cards;
  for(const prefix of ['eat prepared meal','sleep on ground mat','prepare shared dish','eat shared dish'])assert.ok(deck.includes(prefix+' '+row.id.slice(2)));
  const w=(f.host.engine.world as NativeWorld).entities;for(const r of COMMONS_KITCHENS){assert.equal(w[r.beans].contents?.fraction,1);assert.equal(w[r.greens].contents?.fraction,1);assert.equal(w[r.pot].contents?.fraction,0);}assert.equal(f.db.paidCost(),0);
});
