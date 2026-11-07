import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {edenHistoryFactory,installEdenCore,installEdenLifeV1,settleEmptyEden} from './eden-bootstrap.ts';
import {WorldHost} from './world.ts';
import {Brain} from './brain.ts';
import {Souls} from './souls.ts';
import {marsFactory,GREEN_FIELD_WORLD,EDEN_SAFE_COMMONS_WORLD} from '@souls/engine-mars';
import {kernelHash} from '@souls/kernel';
const sink={clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}};
// The finite delivery installs only at a resumable boundary. Alice's autonomous choice (seeded by her random soul id) can
// hold one off: 22 of 330 seeds walk and reach for 1,341 ticks first (403 and 404 alike); release 404's gate drew a
// longer chain past the old 2,200-tick bound. The loop still ends the tick the delivery lands.
const FD_WAIT_TICKS=7200;
for(const legacy of [false,true])test('production life composition keeps '+(legacy?'legacy':'fresh')+' origin, configured budget/ownership and old history while enabling actual finite meals/rest/autonomy',async t=>{
 const origin=legacy?await marsFactory(GREEN_FIELD_WORLD):await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
 const f=fixture(':memory:',origin);await invite(f,'alice');const row=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic portable-life human owner'}));f.brain.quiesce();f.host.saveSnapshot(true);f.host.stop();const prefix=JSON.stringify(f.db.events(f.host.worldId)),cfg={...f.brain.cfg,budgetUsdPerDay:.37};
 const factory=await edenHistoryFactory(f.db,f.host.worldId,{lifeV1:true}),host=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId);host.boot();await installEdenCore(host,{applyCrew:legacy,applyCommons:legacy});const living=new LivingWorld(host);await settleEmptyEden(host,living,['People may eat and rest.']);const brain=new Brain(host,f.db,cfg,sink,{intentV2Choices:true}),souls=new Souls(host,f.db,brain,cfg);souls.enableLifecycle();const handles=await installEdenLifeV1(host,brain,{foodDeliveryId:'portable-finite-A'});t.after(()=>{handles.close();brain.quiesce();host.stop();f.db.close();});
 let fdTicks=0;for(;fdTicks<FD_WAIT_TICKS&&!host.engine.rulesVersion.includes('+fd/1');fdTicks++){host.tickOnce();await setImmediate();}assert.ok(host.engine.rulesVersion.includes('+fd/1'),`finite delivery not installed after ${fdTicks} of ${FD_WAIT_TICKS} ticks; rules ${host.engine.rulesVersion}`);await accept(host,handles.settled());assert.equal(brain.budget,.37);assert.equal(cfg.ownerId,f.brain.cfg.ownerId);assert.deepEqual(f.db.soul(row.id),row);assert.equal(JSON.stringify(f.db.events(host.worldId).slice(0,JSON.parse(prefix).length)),prefix);assert.ok(host.extra.intentApproachRetentionV1);assert.ok(host.extra.intentSequencesV1);assert.ok(host.engine.rulesVersion.includes('+commons-kitchen/2'));assert.ok(host.engine.rulesVersion.includes('+fd/1'));assert.ok(host.kernel.decks[row.id].cards.includes('eat prepared meal '+row.id.slice(2)));assert.ok(host.kernel.decks[row.id].cards.includes('sleep on ground mat '+row.id.slice(2)));assert.equal(f.db.paidCost(),0);
 brain.quiesce();host.drainInputs();host.saveSnapshot(true);const head={engine:host.engine.stateHash(),kernel:kernelHash(host.kernel)},restartFactory=await edenHistoryFactory(f.db,host.worldId,{lifeV1:true}),restarted=new WorldHost(f.db,restartFactory,host.seed,1e9,host.worldId);restarted.boot();assert.deepEqual({engine:restarted.engine.stateHash(),kernel:kernelHash(restarted.kernel)},head);restarted.stop();
});

test('existing retained shore/social/resource history selects its keeper and is never read as a fresh dry commons',async t=>{
 const {retainedCommonsShoreFactory}=await import('@souls/engine-mars'),factory=await retainedCommonsShoreFactory({foodDeliveryV1:true,socialEdenV1:true}),f=fixture(':memory:',factory);t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installCommonsKitchenV1());await accept(f.host,f.host.installSocialEdenV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());await accept(f.host,f.host.installCommonsFoodDeliveryV1('existing-keeper-finite'));f.brain.quiesce();f.host.saveSnapshot(true);const prefix=JSON.stringify(f.db.events(f.host.worldId)),head=f.host.engine.stateHash(),keeper=await edenHistoryFactory(f.db,f.host.worldId,{lifeV1:true}),h=new WorldHost(f.db,keeper,f.host.seed,1e9,f.host.worldId);h.boot();assert.equal(h.engine.stateHash(),head);assert.deepEqual(await installEdenCore(h,{applyCrew:false,applyCommons:false}),[]);assert.equal(JSON.stringify(f.db.events(f.host.worldId)),prefix);assert.equal(h.engine.world.base.campus,'eden-commons-shore/1');h.stop();
});
