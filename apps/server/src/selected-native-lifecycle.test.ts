import test from 'node:test';import assert from 'node:assert/strict';import {setImmediate} from 'node:timers/promises';
import {hashOf} from '@souls/engine-contract';import {kernelHash} from '@souls/kernel';
import {marsFactory,MARS_2026_MAP,LITTLE_MARTIANS_WORLD,type MarsWorldConfig} from '@souls/engine-mars';
import {selectedNativeCrewRemovalFactoryV1} from '../../../packages/engine-native/src/selected-crew-removal.ts';
import {fixture,accept,invite} from '../test/native-owner-fixture.ts';import {WorldHost} from './world.ts';
const mars:MarsWorldConfig={scene:'eden-camp',arrival:[-3,18],arrivalPlace:'arrival',reference:[-1,17],grounds:{id:'grounds',name:'Mars camp'},map:MARS_2026_MAP,disassemblyV1:true};
const cases=[['mars',mars],['littlemartians',LITTLE_MARTIANS_WORLD]] as const;
for(const [name,cfg]of cases){const old=await marsFactory(cfg),reader=await selectedNativeCrewRemovalFactoryV1(cfg);
 test(name+': old native bytes unchanged until accepted policy; normal lifecycle creation and snapshot/genesis prefix replay',async t=>{
  const f=fixture(':memory:',reader,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
  const plain=old.create(old.genesis(f.host.seed)),actual=f.host.engine;assert.equal(JSON.stringify(actual.snapshot()),JSON.stringify(plain.snapshot()));
  await invite(f,'legacy');const retained=await accept(f.host,f.souls.create('dev:legacy',{name:'Legacy '+name,description:'Existing ordinary legacy owner retained'}));const retainedRow=JSON.stringify(f.db.soul(retained.id));
  const originalBodies=JSON.stringify(actual.world.entities),prefix=JSON.stringify(f.db.events(f.host.worldId)),before=actual.stateHash(),kernel=kernelHash(f.host.kernel),scene=hashOf(actual.renderScene!());
  assert.throws(()=>f.souls.enableLifecycle(),/qualified crew-removal/);
  const event=await accept(f.host,f.host.adoptCrewRemovalPolicyV1('operator:selected-native-test'));
  assert.equal(event.payload.crewRemovalTransition.fromStateHash,before);assert.equal(actual.rulesVersion,(await marsFactory({...cfg,safeCrewRemoval:true})).rulesVersion);
  assert.equal(JSON.stringify(actual.world.entities),originalBodies);assert.equal(kernelHash(f.host.kernel),kernel);assert.equal(JSON.stringify(f.db.events(f.host.worldId).slice(0,JSON.parse(prefix).length)),prefix);assert.equal(hashOf(actual.renderScene!()),scene);assert.equal(JSON.stringify(f.db.soul(retained.id)),retainedRow);
  f.souls.enableLifecycle();assert.equal(f.souls.controlReady(f.db.soul(retained.id)!),true);await invite(f,'alder');
  const response=await f.app.request('/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:alder','Content-Type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name:'Alder '+name,description:'Normal selected native lifecycle fixture'})});assert.equal(response.status,202);
  for(let i=0;i<8;i++){f.host.drainInputs();await setImmediate();}const rows=f.db.liveSouls(f.host.worldId).filter(r=>r.name==='Alder '+name);assert.equal(rows.length,1);assert.equal(f.souls.controlReady(rows[0]!),true);assert.equal(f.souls.lifecycle!.faults.size,0);assert.deepEqual(actual.runtime.violations,[]);
  const head={engine:actual.stateHash(),kernel:kernelHash(f.host.kernel),seq:f.host.seq,rows:JSON.stringify(f.db.liveSouls(f.host.worldId))};f.host.saveSnapshot(true);
  for(const mode of ['snapshot','genesis']){if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const h=new WorldHost(f.db,reader,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});try{assert.equal(h.boot().from,mode);assert.equal(h.engine.stateHash(),head.engine);assert.equal(kernelHash(h.kernel),head.kernel);assert.equal(h.seq,head.seq);}finally{h.stop();}}
  assert.equal(JSON.stringify(f.db.liveSouls(f.host.worldId)),head.rows);assert.equal(f.db.events(f.host.worldId).filter(e=>e.payload?.crewRemovalTransition).length,1);assert.equal(f.db.paidCost(),0);
  assert.equal(old.canReplayHistory!(actual.rulesVersion),false);assert.throws(()=>old.restore(actual.snapshot()),/snapshot removal policy/);
 });
}
test('selected world base and exact policy headers cannot cross another native scene',async()=>{
 const M=await selectedNativeCrewRemovalFactoryV1(mars),L=await selectedNativeCrewRemovalFactoryV1(LITTLE_MARTIANS_WORLD),oldL=await marsFactory(LITTLE_MARTIANS_WORLD),e=oldL.create(oldL.genesis('isolated'));
 assert.throws(()=>M.restore(e.snapshot()),/snapshot-base/);assert.throws(()=>M.create(e.world),/genesis-base/);assert.equal(L.canReplayHistory!(L.rulesVersion+'+crew-removal/2'),false);assert.equal(L.canRestoreSnapshot!(L.rulesVersion+'+crew-removal/1+crew-removal/1'),false);
 const snapshot=e.snapshot() as ReturnType<typeof e.snapshot>&{cfg:MarsWorldConfig};const malformed={...snapshot,cfg:{...snapshot.cfg,safeCrewRemoval:'future' as unknown as boolean}};assert.throws(()=>L.restore(malformed),/snapshot-policy/);await assert.rejects(()=>selectedNativeCrewRemovalFactoryV1({...mars,safeCrewRemoval:true}),/legacy-config-required/);
});
test('active native programme and moved/forged source refuse before accepted policy; work naturally finishes',async t=>{
 const reader=await selectedNativeCrewRemovalFactoryV1(LITTLE_MARTIANS_WORLD),f=fixture(':memory:',reader,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});const e=f.host.engine,actor=e.spawnHuman({id:'quiet-body-fixture',label:'Quiet body fixture',soul:'quiet-fixture-soul'});
 const p=e.previewCrewRemovalTransitionV1!();assert.equal(p.ok,true);if(!p.ok)return;
 const before={hash:e.stateHash(),seq:f.host.seq,events:hashOf(f.db.events(f.host.worldId)),header:f.db.world(f.host.worldId)};assert.throws(()=>e.adoptCrewRemovalTransitionV1!({...p.transition,tick:p.transition.tick+1}),/stale-or-forged/);assert.deepEqual({hash:e.stateHash(),seq:f.host.seq,events:hashOf(f.db.events(f.host.worldId)),header:f.db.world(f.host.worldId)},before);
 const pending=f.host.adoptCrewRemovalPolicyV1('operator:selected-native-test'),r=e.perform({actor,label:'Actual finite native rest',steps:[{verb:'rest',params:{seconds:2}}]});assert.equal(r.ok,true);await assert.rejects(()=>accept(f.host,pending),/source-moved/);await assert.rejects(()=>accept(f.host,f.host.adoptCrewRemovalPolicyV1('operator:selected-native-test')),/not-quiet/);assert.equal(f.host.seq,before.seq);assert.equal(hashOf(f.db.events(f.host.worldId)),before.events);assert.deepEqual(f.db.world(f.host.worldId),before.header);
 for(let i=0;i<60&&!e.isQuiet!();i++)f.host.tickOnce();assert.equal(e.isQuiet!(),true);assert.equal(e.programOf(actor),null);assert.deepEqual(e.runtime.violations,[]);
});
test('selected Mars append/header failures preserve native, kernel and accepted prefix',async t=>{
 const reader=await selectedNativeCrewRemovalFactoryV1(mars);for(const kind of ['append','header']){const f=fixture(':memory:',reader,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});const before={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel),events:hashOf(f.db.events(f.host.worldId)),header:f.db.world(f.host.worldId),seq:f.host.seq};
 if(kind==='append')t.mock.method(f.db,'appendEvent',()=>{throw Error('fixture append refusal');});else f.db.db.exec("CREATE TEMP TRIGGER reject_selected_crew BEFORE UPDATE OF rules_version ON worlds BEGIN SELECT RAISE(ABORT,'fixture header refusal'); END");
 await assert.rejects(()=>accept(f.host,f.host.adoptCrewRemovalPolicyV1('operator:selected-native-test')),/fixture/);assert.deepEqual({engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel),events:hashOf(f.db.events(f.host.worldId)),header:f.db.world(f.host.worldId),seq:f.host.seq},before);}
});
test('internal bootstrap admits only quiet accepted policy once and cold-starts lifecycle without a second fact',async t=>{
 const {installSelectedNativeLifecycleV1}=await import('../../../packages/engine-native/src/selected-lifecycle-bootstrap.ts'),reader=await selectedNativeCrewRemovalFactoryV1(LITTLE_MARTIANS_WORLD),f=fixture(':memory:',reader,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});const drive=<T>(p:Promise<T>)=>accept(f.host,p),first=await installSelectedNativeLifecycleV1(f.host,f.souls,drive);
 assert.equal(first.lifecycleReady,true);assert.equal(first.alreadyAccepted,false);const seq=f.host.seq,state=f.host.engine.stateHash();const second=await installSelectedNativeLifecycleV1(f.host,f.souls,drive);assert.equal(second.alreadyAccepted,true);assert.equal(second.seq,first.seq);assert.equal(f.host.seq,seq);assert.equal(f.host.engine.stateHash(),state);
 f.host.saveSnapshot(true);const h=new WorldHost(f.db,reader,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});h.boot();t.after(()=>h.stop());const {Souls}=await import('./souls.ts'),souls=new Souls(h,f.db,f.brain,{...f.souls.cfg});const cold=await installSelectedNativeLifecycleV1(h,souls,<T>(p:Promise<T>)=>accept(h,p));assert.equal(cold.alreadyAccepted,true);assert.equal(cold.seq,first.seq);assert.equal(cold.lifecycleReady,true);assert.equal(f.db.events(f.host.worldId).filter(e=>e.payload?.crewRemovalTransition).length,1);
});
test('internal bootstrap refuses nonquiet work before any policy/lifecycle acceptance',async t=>{
 const {installSelectedNativeLifecycleV1}=await import('../../../packages/engine-native/src/selected-lifecycle-bootstrap.ts'),reader=await selectedNativeCrewRemovalFactoryV1(LITTLE_MARTIANS_WORLD),f=fixture(':memory:',reader,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});const actor=f.host.engine.spawnHuman({id:'bootstrap-quiet-body',label:'Bootstrap finite work',soul:'bootstrap-quiet-soul'});f.host.engine.perform({actor,label:'Retained finite work',steps:[{verb:'rest',params:{seconds:2}}]});const before={seq:f.host.seq,events:hashOf(f.db.events(f.host.worldId)),engine:f.host.engine.stateHash()};await assert.rejects(()=>installSelectedNativeLifecycleV1(f.host,f.souls,<T>(p:Promise<T>)=>accept(f.host,p)),/not-quiet/);assert.equal(f.souls.lifecycle,undefined);assert.deepEqual({seq:f.host.seq,events:hashOf(f.db.events(f.host.worldId)),engine:f.host.engine.stateHash()},before);
});
