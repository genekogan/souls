import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {marsFactory,type MarsWorldConfig} from '@souls/engine-mars';
import {hashOf} from '@souls/engine-contract';
import {kernelHash} from '@souls/kernel';
import {fixture,invite} from '../test/native-owner-fixture.ts';
import {CampCards} from './camp.ts';
import {campResourceBindings,LEGACY_CAMP_RESOURCES} from './camp-resources.ts';
import {WorldHost} from './world.ts';
import type {Entity as NativeEntity} from '../../../mars/viewer/engine/world/types.ts';
const cfg:MarsWorldConfig={scene:'eden-camp',safeArrivalV1:true,safeCrewRemoval:true,arrival:[-3,18],arrivalPlace:'arrival',reference:[-1,17],grounds:{id:'grounds',name:'Camp grounds'}};
const factory=await marsFactory(cfg);
async function setup(){const f=fixture(':memory:',factory);f.souls.enableLifecycle();return f;}
async function birth(f:Awaited<ReturnType<typeof setup>>,name:string){await invite(f,name.toLowerCase());const op=f.souls.acceptLifecycleCreate('dev:'+name.toLowerCase(),{name,description:'Local invited human-owned camp resident'});for(let i=0;i<3;i++){f.host.drainInputs();await setImmediate();}const m=f.host.minds.get(op.scope.soulId)!;assert.ok(m);assert.equal(f.souls.controlReady(f.db.soul(m.soulId)!),true);assert.equal(m.owner,'dev:'+name.toLowerCase());m.nextEvalTick=1e9;return m;}
const drain=async(f:Awaited<ReturnType<typeof setup>>)=>{f.host.drainInputs();await setImmediate();f.host.drainInputs();};
test('current legacy pack actually duplicates Alice mat/bowl for an earlier-sorting newcomer',async t=>{
  const {CampCards:Old}=await import('../test/fixtures/camp-resources/legacy-camp.ts');const f=await setup();try{await birth(f,'Alice');await birth(f,'Bob');const pack=new Old(f.host);await drain(f);await birth(f,'Aaron');pack.install();await drain(f);
    const alice=f.host.kernel.vocab.cards['eat a bowl of stew alice'],aaron=f.host.kernel.vocab.cards['eat a bowl of stew aaron'];assert.equal(alice.approach[0].params.item,'bowl-1');assert.equal(aaron.approach[0].params.item,'bowl-1');assert.ok(f.host.kernel.vocab.cards['bunk sleep mat 1 aaron']);t.diagnostic('Confirmed old source duplicate resource affinity; no physical success/ownership inferred.');
    const observed=campResourceBindings(f.host,[...f.host.minds.values()]);assert.ok(observed.issues.size>=2);assert.equal(observed.bySoul.size,3,'historical evidence is retained, not silently reassigned');
  }finally{f.host.stop();f.db.close();}
});
test('new newcomer gets an unbound installed set; historical cards and cross-supper self/host resources stay stable across reconstruction',async()=>{
  const f=await setup();try{const alice=await birth(f,'Alice'),bob=await birth(f,'Bob'),pack=new CampCards(f.host);await drain(f);const oldCards=Object.fromEntries(Object.entries(f.host.kernel.vocab.cards).map(([id,c])=>[id,hashOf(c)]));const aaron=await birth(f,'Aaron');pack.install();await drain(f);
    const bindings=campResourceBindings(f.host,[aaron,bob,alice]);assert.equal(bindings.bySoul.get(alice.soulId)!.id,'camp-personal-1');assert.equal(bindings.bySoul.get(bob.soulId)!.id,'camp-personal-2');assert.equal(bindings.bySoul.get(aaron.soulId)!.id,'camp-personal-3');assert.equal(bindings.issues.size,0);
    for(const [id,hash] of Object.entries(oldCards))assert.equal(hashOf(f.host.kernel.vocab.cards[id]),hash);assert.equal(f.host.kernel.vocab.cards['eat a bowl of stew aaron'].approach[0].params.item,'bowl-3');assert.ok(f.host.kernel.vocab.cards['bunk sleep mat 3 aaron']);assert.equal(f.host.kernel.vocab.cards['bunk sleep mat 1 aaron'],undefined);
    const join=f.host.kernel.vocab.cards['join alice supper aaron'].during[0].params as any;assert.equal(join.participants[0].bowl,'bowl-3');assert.equal(join.participants[1].bowl,'bowl-1');const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};f.host.saveSnapshot(true);
    const boot=new WorldHost(f.db,factory,'native-owner-lifecycle',1e9,f.host.worldId);boot.boot();const restored=new CampCards(boot);boot.drainInputs();await setImmediate();boot.drainInputs();assert.deepEqual({engine:boot.engine.stateHash(),kernel:kernelHash(boot.kernel)},head);assert.equal(restored.resourceIssues.size,0);assert.equal(campResourceBindings(boot,[...boot.minds.values()]).bySoul.get(aaron.soulId)!.id,'camp-personal-3');f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const genesis=new WorldHost(f.db,factory,'native-owner-lifecycle',1e9,f.host.worldId);assert.equal(genesis.boot().from,'genesis');assert.deepEqual({engine:genesis.engine.stateHash(),kernel:kernelHash(genesis.kernel)},head);assert.equal(campResourceBindings(genesis,[...genesis.minds.values()]).bySoul.get(aaron.soulId)!.id,'camp-personal-3');assert.equal(f.db.paidCost(),0);boot.stop();genesis.stop();
  }finally{f.host.stop();f.db.close();}
});
test('five residents do not invent a fifth installed resource set or reuse a bound one; general activity keeps running',async()=>{
  const f=await setup();try{const pack=new CampCards(f.host);for(const name of ['Alice','Bob','Carol','David']){await birth(f,name);pack.install();await drain(f);}const newcomer=await birth(f,'Aaron');pack.install();await drain(f);assert.ok(pack.resourceIssues.has(newcomer.soulId));assert.equal(f.host.kernel.vocab.cards['eat a bowl of stew aaron'],undefined);assert.ok(f.host.kernel.vocab.cards['build lookout stage aaron']);assert.ok(f.host.kernel.vocab.cards['host supper aaron']);assert.equal(campResourceBindings(f.host,[...f.host.minds.values()]).bySoul.has(newcomer.soulId),false);assert.deepEqual(LEGACY_CAMP_RESOURCES.map(r=>r.id),['camp-personal-1','camp-personal-2','camp-personal-3','camp-personal-4']);
  }finally{f.host.stop();f.db.close();}
});
test('removing a personal card does not reassign its historical resource when a new resident arrives',async()=>{
  const f=await setup();try{const alice=await birth(f,'Alice');await birth(f,'Bob');const pack=new CampCards(f.host);await drain(f);const card='bunk sleep mat 1 alice';void f.host.enqueue('deck','fixture',{soulId:alice.soulId,remove:[card]});await drain(f);assert.ok(!f.host.kernel.decks[alice.soulId].cards.includes(card));await birth(f,'Aaron');pack.install();await drain(f);assert.equal(campResourceBindings(f.host,[...f.host.minds.values()]).bySoul.get(alice.soulId)!.id,'camp-personal-1');assert.ok(!f.host.kernel.decks[alice.soulId].cards.includes(card),'ordinary population refresh does not redeal a removed existing card');assert.ok(f.host.kernel.vocab.cards['bunk sleep mat 3 aaron']);
  }finally{f.host.stop();f.db.close();}
});
test('personal resource evidence follows canonical Soul/world IDs rather than a display-name hint',async()=>{
  const f=await setup();try{const alice=await birth(f,'Alice');await birth(f,'Bob');new CampCards(f.host);await drain(f);const changed={...alice,name:'A different display hint'};assert.equal(campResourceBindings(f.host,[changed]).bySoul.get(alice.soulId)!.id,'camp-personal-1');assert.equal(f.db.campPersonalCards('foreign-world',alice.soulId).length,0);assert.equal(f.db.campPersonalCards(f.host.worldId,'foreign-soul').length,0);
  }finally{f.host.stop();f.db.close();}
});
test('owned native bodies use their distinct derived mat references without invented outcome, and the accepted physical decisions replay',async()=>{
  const f=await setup();try{const alice=await birth(f,'Alice');await birth(f,'Bob');const pack=new CampCards(f.host);await drain(f);const aaron=await birth(f,'Aaron');pack.install();await drain(f);const bindings=campResourceBindings(f.host,[...f.host.minds.values()]),seen=new Map<string,string>();
    for(const m of [alice,aaron]){const mat=bindings.bySoul.get(m.soulId)!.mat;void f.host.enqueue('decision','fixture',{soulId:m.soulId,entityId:m.entityId,option:'native-resource-probe',label:'Explicit trusted native binding probe',steps:[{verb:'mars:sleep',params:{actor:m.entityId,mat,duration:.2}}],continue:false,mood:'content',reevalTicks:1e9,fallback:true,trigger:'fixture'});}await drain(f);
    for(let i=0;i<2600&&(f.host.engine.programOf(alice.entityId)||f.host.engine.programOf(aaron.entityId));i++){for(const m of f.host.minds.values())m.nextEvalTick=1e9;f.host.tickOnce();await setImmediate();for(const m of [alice,aaron]){const pose=(f.host.engine.world.entities[m.entityId] as unknown as NativeEntity).human!.sleepPose;if(pose)seen.set(m.soulId,pose.mat);}}
    assert.equal(f.host.engine.programOf(alice.entityId),null);assert.equal(f.host.engine.programOf(aaron.entityId),null);assert.equal(seen.get(alice.soulId),'mat-1');assert.equal(seen.get(aaron.soulId),'mat-3');assert.deepEqual(f.host.engine.runtime.violations,[]);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};f.host.saveSnapshot(true);const boot=new WorldHost(f.db,factory,'native-owner-lifecycle',1e9,f.host.worldId);boot.boot();assert.deepEqual({engine:boot.engine.stateHash(),kernel:kernelHash(boot.kernel)},head);boot.stop();assert.equal(f.db.paidCost(),0);
  }finally{f.host.stop();f.db.close();}
});
