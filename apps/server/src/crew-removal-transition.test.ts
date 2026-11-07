import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {marsFactory,marsCrewRemovalTransitionFactory,GREEN_FIELD_WORLD,MarsEngine} from '@souls/engine-mars';
import {hashOf} from '@souls/engine-contract';
import {kernelHash} from '@souls/kernel';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {WorldHost} from './world.ts';
import {LivingWorld} from './living.ts';
import {CandidateStationV1} from './station.ts';
const legacy=await marsFactory(GREEN_FIELD_WORLD),reader=await marsCrewRemovalTransitionFactory();
function values(f:ReturnType<typeof fixture>){return {rules:f.db.world(f.host.worldId)!.rules_version,events:JSON.stringify(f.db.events(f.host.worldId)),engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};}

test('actual legacy owner keeps original history/identity through prospective policy, five owned commons admissions and snapshot/genesis replay',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'core-crew-policy-')),path=join(dir,'sim.db');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const old=fixture(path,legacy,{durableClockV1:true});t.mock.method(old.brain,'evaluate',async()=>{});await invite(old,'alice');
  const original=await accept(old.host,old.souls.create('dev:alice',{name:'Alice',description:'Synthetic invited legacy owner'}));
  await accept<unknown>(old.host,new LivingWorld(old.host).install(['People explore or rest when they choose.']));
  await accept(old.host,old.souls.setIntent(original,{goal:'rest',note:'Synthetic legacy intention retained'},'web'));
  for(let i=0;i<250;i++)old.host.tickOnce();old.host.saveSnapshot(true);
  const before=values(old),body=structuredClone(old.host.engine.world.entities[original.entity_id]),row={...old.db.soul(original.id)!},life=structuredClone(old.host.minds.get(original.id)!.life);
  assert.ok(body?.human);assert.ok(life);
  const pairs=old.host.engine.takeChunks!(-1).map(c=>{const capture=old.host.engine.takeScene!((c.take as any).renderSceneRef.hash);old.db.saveTake(old.host.worldId,c,capture);return {take:c.take,capture};});assert.ok(pairs.length);
  old.host.stop();old.db.close();
  const f=fixture(path,reader,{durableClockV1:true});t.mock.method(f.brain,'evaluate',async()=>{});t.after(()=>{f.host.stop();f.db.close();});assert.deepEqual(values(f),before);
  assert.throws(()=>f.souls.enableLifecycle(),/qualified crew-removal/);
  const policy=await accept(f.host,f.host.adoptCrewRemovalPolicyV1('operator:local-test'));
  assert.equal(policy.tick,250);assert.equal(policy.payload.crewRemovalTransition.fromStateHash,before.engine);
  assert.equal(f.host.engine.rulesVersion,before.rules+'+crew-removal/1');
  assert.deepEqual(f.host.engine.world.entities[original.entity_id],body);assert.deepEqual({...f.db.soul(original.id)!},row);assert.deepEqual(f.host.minds.get(original.id)!.life,life);
  assert.equal(kernelHash(f.host.kernel),before.kernel);assert.equal(JSON.stringify(f.db.events(f.host.worldId).slice(0,JSON.parse(before.events).length)),before.events);
  const adopted=values(f);await assert.rejects(accept(f.host,f.host.adoptCrewRemovalPolicyV1('operator:duplicate')),/already-adopted/);assert.deepEqual(values(f),adopted);
  f.souls.enableLifecycle();assert.equal(f.souls.controlReady(row),true);
  const physical=await accept(f.host,f.host.adoptCommons('operator:local-test'));assert.equal(physical.payload.commonsTransition.fromRulesVersion,f.host.engine.rulesVersion.replace('+commons/1+arrival-clearance/1',''));
  assert.deepEqual(f.host.engine.world.entities[original.entity_id],body);
  for(const owner of ['bob','cedar','dara','eli']){
    await invite(f,owner);const created=await f.app.request('/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:'+owner,'Content-Type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name:owner,description:'Synthetic ordinary invited owner'})});
    assert.equal(created.status,202);const {lifecycle}=await created.json() as any;
    for(let i=0;i<4;i++){f.host.drainInputs();await setImmediate();}
    assert.equal(f.souls.controlReady(f.db.soul(lifecycle.soulId)!),true);
  }
  assert.equal(f.host.minds.size,5);assert.equal(f.souls.lifecycle!.faults.size,0);assert.deepEqual(f.host.engine.runtime.violations,[]);
  for(let i=0;i<80;i++)f.host.tickOnce();f.host.saveSnapshot(true);
  const head=values(f),minds=JSON.stringify([...f.host.minds.values()]);
  const make=()=>new WorldHost(f.db,reader,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});
  let h=make();assert.equal(h.boot().from,'snapshot');assert.equal(h.engine.stateHash(),head.engine);assert.equal(kernelHash(h.kernel),head.kernel);assert.equal(JSON.stringify([...h.minds.values()]),minds);h.stop();
  f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
  h=make();assert.equal(h.boot().from,'genesis');assert.equal(h.engine.stateHash(),head.engine);assert.equal(kernelHash(h.kernel),head.kernel);assert.equal(JSON.stringify([...h.minds.values()]),minds);h.stop();
  // Original addressable recordings remain in durable storage with their bytes.
  for(const p of pairs){assert.equal(hashOf(f.db.renderSceneCapture(f.host.worldId,(p.take as any).renderSceneRef.hash)),hashOf(p.capture));}
  assert.equal(f.db.paidCost(),0);assert.equal(f.db.liveSouls(f.host.worldId).find(s=>s.id===original.id)!.owner,'dev:alice');
  const out=new URL('../../../.e2e/crew-policy/',import.meta.url);mkdirSync(out,{recursive:true});const file=new URL(new Date().toISOString().replaceAll(':','-')+'.json',out);
  writeFileSync(file,JSON.stringify({contract:'owned-crew-removal-transition-proof/1',status:'PASS',sourceRules:before.rules,oldStateHash:before.engine,oldKernelHash:before.kernel,
    originalHistoryHash:hashOf(JSON.parse(before.events)),policy,physical,originalBody:body,originalLifeHash:hashOf(life),originalTakeIds:pairs.map(p=>(p.take as any).id),originalCaptureRefs:pairs.map(p=>(p.take as any).renderSceneRef),
    current:{rules:f.host.engine.rulesVersion,tick:f.host.engine.world.tick,engine:head.engine,kernel:head.kernel,mindsHash:hashOf([...f.host.minds.values()])},
    owners:f.db.liveSouls(f.host.worldId).map(s=>({soulId:s.id,entityId:s.entity_id,owner:s.owner,ready:f.souls.controlReady(s)})),snapshotExact:true,genesisExact:true,paidUSD:0,
    limits:['Actual native/SQLite/in-process HTTP invited synthetic owners, no production/realAuth/browser/agent host claim','Fake decision evaluation held by test seam; retained legacy purpose and life, not autonomous activity or circulation proof','Exact activities31 Greenfield policy boundary, subsequent corrected commons only; station migration and other old policies remain refused']},null,2)+'\n',{flag:'wx'});t.diagnostic('Synthetic owned policy proof '+file.pathname);
});

test('default reader, forged transition, active native program, moved source and station binding refuse without policy change',async t=>{
  const plain=fixture(':memory:',legacy);t.after(()=>plain.db.close());await assert.rejects(accept(plain.host,plain.host.adoptCrewRemovalPolicyV1('fixture')),/reader-unavailable/);
  const f=fixture(':memory:',reader);t.after(()=>f.db.close());await invite(f,'alice');const s=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'local fixture'}));f.host.minds.get(s.id)!.nextEvalTick=1e9;
  const initial=values(f),p=f.host.engine.previewCrewRemovalTransitionV1!();assert.ok(p.ok);
  if(!p.ok)return;assert.throws(()=>f.host.engine.adoptCrewRemovalTransitionV1!({...p.transition,tick:p.transition.tick+1}),/stale-or-forged/);assert.deepEqual(values(f),initial);
  const queued=f.host.adoptCrewRemovalPolicyV1('fixture');
  const walk=f.host.engine.perform({actor:s.entity_id,label:'actual bounded rest',steps:[{verb:'rest',params:{seconds:2}}]});assert.equal(walk.ok,true,JSON.stringify(walk));
  await assert.rejects(accept(f.host,queued),/source-moved/);assert.equal(f.db.world(f.host.worldId)!.rules_version,initial.rules);
  await assert.rejects(accept(f.host,f.host.adoptCrewRemovalPolicyV1('fixture')),/not-quiet/);
  f.host.engine.stop(walk.id);for(let i=0;i<50&&!f.host.engine.isQuiet!();i++)f.host.tickOnce();
  await accept(f.host,new CandidateStationV1(f.host).record());await assert.rejects(accept(f.host,f.host.adoptCrewRemovalPolicyV1('fixture')),/station-carry-required/);
  for(const version of [initial.rules+'+crew-removal/2',initial.rules+'+crew-removal/1+crew-removal/1'])assert.equal(reader.canReplayHistory!(version),false);
  const snapshot=f.host.engine.snapshot() as any;assert.throws(()=>reader.restore({...snapshot,cfg:{...snapshot.cfg,safeCrewRemoval:'future'}}),/snapshot-policy/);
});

test('append/header failure rolls back the policy fact and actual engine state',async t=>{
  for(const fault of ['append','header']){
    const f=fixture(':memory:',reader);t.after(()=>f.db.close());const before=values(f),method=fault==='append'?'appendEvent':null;
    if(method)t.mock.method(f.db,'appendEvent',()=>{throw Error('synthetic append failure');});
    else f.db.db.exec("CREATE TEMP TRIGGER fail_policy_header BEFORE UPDATE OF rules_version ON worlds BEGIN SELECT RAISE(ABORT,'synthetic header failure'); END");
    await assert.rejects(accept(f.host,f.host.adoptCrewRemovalPolicyV1('fixture')),/synthetic/);assert.deepEqual(values(f),before);
  }
});

test('committed policy application fault reboots exact persisted history rather than filtering a card or fabricating rollback',async t=>{
  const f=fixture(':memory:',reader,{durableClockV1:true});t.after(()=>f.db.close());const original=f.host.engine;
  assert.ok(original instanceof MarsEngine);t.mock.method(original,'adoptCrewRemovalTransitionV1',()=>{throw Error('synthetic committed fold failure');});
  const event=await accept(f.host,f.host.adoptCrewRemovalPolicyV1('fixture'));
  assert.notEqual(f.host.engine,original);assert.equal(f.host.engine.rulesVersion,reader.rulesVersion+'+crew-removal/1');
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.payload?.crewRemovalTransition).length,1);
  assert.equal(f.host.seq,event.seq);assert.ok(!f.db.events(f.host.worldId).some(e=>e.payload?.recovery));assert.equal(f.db.world(f.host.worldId)!.rules_version,f.host.engine.rulesVersion);
});
