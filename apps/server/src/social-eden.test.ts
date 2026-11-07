import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory,COMMONS_PERSONAL_RESOURCES} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {installSocialEdenCardsV1} from './social-eden.ts';
import {WorldHost} from './world.ts';
import {kernelHash} from '@souls/kernel';
import {setImmediate} from 'node:timers/promises';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
const factory=await retainedCommonsShoreFactory({socialEdenV1:true,foodDeliveryV1:true});
test('eight ordinary invited owners keep history and obtain discoverable native social cards; private owner meal actually eats seated and SQLite replays exactly',async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});await accept<unknown>(f.host,new LivingWorld(f.host).install(['People may eat, rest and meet.']));for(let i=0;i<4;i++)f.host.tickOnce();
 const rows=[];for(let i=0;i<8;i++){await invite(f,'social'+i);rows.push(await accept(f.host,f.souls.create('dev:social'+i,{name:'Social Friend '+i,description:'Synthetic owner social fixture'})));}
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installCommonsKitchenV1());
 const original=structuredClone(f.host.engine.world.entities),prefix=JSON.stringify(f.db.events(f.host.worldId));await accept(f.host,f.host.installSocialEdenV1());for(const [id,v] of Object.entries(original))assert.deepEqual(f.host.engine.world.entities[id],v);assert.equal(JSON.stringify(f.db.events(f.host.worldId).slice(0,JSON.parse(prefix).length)),prefix);
 assert.equal((await installSocialEdenCardsV1(f.host,f.brain)).filter(v=>v.ok).length,32);
 for(const row of rows){assert.ok(f.host.kernel.decks[row.id].cards.includes('sit at a social seat'));assert.ok(f.host.kernel.decks[row.id].cards.includes('warm by the eden fire'));}assert.equal(f.host.kernel.things['social-eden-dining-chair-west'].states.socialDiningSeat,true);
 const row=rows[0],card='dine with meal 0 '+row.id.slice(2),chair='social-eden-dining-chair-west';assert.equal((await f.request('/v1/souls/'+row.id+'/intent',{intent:{agenda:[{card,target:chair}]}},'social1')).status,403);const response=await accept(f.host,f.request('/v1/souls/'+row.id+'/intent',{intent:{agenda:[{card,target:chair}]}},'social0'));assert.equal(response.status,200);
 const bowl=COMMONS_PERSONAL_RESOURCES[0].bowl;let seated=false,finished=false;for(let i=0;i<4500&&!finished;i++){f.host.tickOnce();if(i%10===0)await setImmediate();seated ||=f.host.engine.world.entities[row.entity_id].human!.activity==='sit';finished=(f.host.engine.world as NativeWorld).entities[bowl].contents?.fraction===0&&!f.host.minds.get(row.id)!.pending;assert.deepEqual(f.host.engine.runtime.violations,[]);}assert.ok(seated&&finished,'actual own meal seated and completed');assert.equal((f.host.engine.world as NativeWorld).entities[COMMONS_PERSONAL_RESOURCES[1].bowl].contents?.fraction,1);
 f.brain.quiesce();f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)},life=JSON.stringify([...f.host.minds.values()].map(m=>m.life));let h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'snapshot');assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head);h.stop();
 f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head);assert.equal(JSON.stringify([...h.minds.values()].map(m=>m.life)),life);h.stop();assert.equal(f.db.paidCost(),0);
});

test('passive social hook waits existing kitchen, commits once and catches up after compatible restart without starting any programme',async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});const {scheduleSocialEdenInstallationV1}=await import('./social-eden-install.ts');
 const hook=scheduleSocialEdenInstallationV1(f.host,f.brain);assert.equal(hook.status().reason,'social-eden.kitchen-prerequisite');await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installCommonsKitchenV1());
 for(let i=0;i<60&&hook.status().phase!=='installed';i++){f.host.tickOnce();await setImmediate();}await accept(f.host,hook.settled());assert.equal(hook.status().phase,'installed');assert.equal(f.db.events(f.host.worldId).filter(e=>e.payload?.socialEden).length,1);assert.equal(f.host.engine.programOf('absent'),null);hook.close();f.brain.quiesce();f.host.saveSnapshot(true);
 const h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});h.boot();const noMindsBrain={host:h} as any;const resumed=scheduleSocialEdenInstallationV1(h,noMindsBrain);await accept(h,resumed.settled());assert.equal(resumed.status().phase,'installed');assert.equal(f.db.events(h.worldId).filter(e=>e.payload?.socialEden).length,1);resumed.close();h.stop();assert.equal(f.db.paidCost(),0);
});
