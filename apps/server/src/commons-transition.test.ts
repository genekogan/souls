import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { marsFactory,marsCommonsTransitionFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { kernelHash } from '@souls/kernel';
import { hashOf } from '@souls/engine-contract';
import { Db } from './db.ts';
import { WorldHost,replayFromGenesis } from './world.ts';
import { CandidateStationV1 } from './station.ts';
import { existingCommonsFixture } from '../test/fixtures/commons-transition/fixture.ts';
import { sampleTake } from '../../../mars/viewer/engine/take/replay.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';

async function setup(t:any){
  const dir=mkdtempSync(join(tmpdir(),'core-commons-transition-')),path=join(dir,'world.sqlite');
  let db=new Db(path);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  const legacy=await marsFactory(GREEN_FIELD_WORLD),factory=await marsCommonsTransitionFactory();
  let host=new WorldHost(db,legacy,'existing-commons',1e9,'existing-commons');host.boot();
  db.upsertUser({id:'PRIVATE_OWNER_A',email:null,wallet:null,role:'user'});
  db.createSoul({id:'s_A',entityId:'h_A',worldId:host.worldId,owner:'PRIVATE_OWNER_A',name:'Alice',description:'A resident',native:false});
  void host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',owner:'PRIVATE_OWNER_A',name:'Alice',description:'A resident'});host.tickOnce();
  host.saveSnapshot();host=new WorldHost(db,factory,'existing-commons',1e9,host.worldId);host.boot();
  return {factory,legacy,get host(){return host;},get db(){return db;},
    reopen(){db.close();db=new Db(path);host=new WorldHost(db,factory,'existing-commons',1e9,host.worldId);return host.boot();}};
}

test('existing ordinary-owner world installs a logged commons checkpoint atomically and replays/restores both histories',async t=>{
  const f=await setup(t),h=f.host;
  while(h.engine.world.tick<37)h.tickOnce();const oldBody=structuredClone(h.engine.world.entities.h_A),mindOwner=h.minds.get('s_A')!.owner;
  const oldChunks=h.engine.takeChunks!(-1);for(const chunk of oldChunks){const ref=(chunk.take as {renderSceneRef:{hash:string}}).renderSceneRef;f.db.saveTake(h.worldId,chunk,h.engine.takeScene!(ref.hash));}
  const before=f.db.db.prepare('SELECT rules_version FROM worlds WHERE id=?').get(h.worldId);
  const request=h.adoptCommons('world:checkpoint');h.drainInputs();const accepted=await request;
  assert.equal(accepted.tick,37);assert.equal(accepted.payload.commonsTransition.contract,'commons-transition/1');
  assert.deepEqual(h.engine.world.entities.h_A,oldBody);assert.equal(h.minds.get('s_A')!.owner,mindOwner);
  assert.notDeepEqual(f.db.world(h.worldId)!.rules_version,(before as {rules_version:string}).rules_version);
  assert.equal(f.db.world(h.worldId)!.rules_version,h.engine.rulesVersion);
  for(const id of ['commons','commons-deck','commons-table','commons-bench-west'])assert.ok(h.kernel.things[id]);
  const replay=replayFromGenesis(f.factory,'existing-commons',f.db.events(h.worldId),37,{includeHeadEvents:true});
  assert.equal(replay.engine.stateHash(),h.engine.stateHash());assert.equal(kernelHash(replay.kernel),kernelHash(h.kernel));
  assert.throws(()=>new WorldHost(f.db,f.legacy,'existing-commons',1e9,h.worldId).boot(),/history rules are incompatible/);
  h.saveSnapshot();assert.equal(f.reopen().from,'snapshot');assert.equal(f.host.engine.stateHash(),h.engine.stateHash());
  assert.equal(kernelHash(f.host.kernel),kernelHash(h.kernel));assert.equal(f.db.soul('s_A')!.owner,mindOwner);
  // Preserve stored original geometry; new native movement uses actual commons.
  assert.deepEqual(f.db.takes(h.worldId,0,40,10).chunks,oldChunks);
  void f.host.enqueue('decision','soul:s_A',{soulId:'s_A',entityId:'h_A',card:'go to',target:'commons',option:'go to@commons',label:'walk to commons',
    steps:[{verb:'walk_to',params:{to:'commons',standoff:0}}],approachLen:1,reevalTicks:10000,trigger:'fixture',fallback:false});
  for(let i=0;i<260;i++)f.host.tickOnce();assert.deepEqual(f.host.engine.world.entities.h_A.pose.p,[9,0,5]);assert.deepEqual(f.host.engine.runtime.violations,[]);
  assert.equal(f.host.kernel.things.s_A.at,'commons');assert.equal(f.host.counts['go to'],1);
  assert.equal(f.db.paidCost(),0);
  const publicPart=JSON.stringify({scene:f.host.engine.renderScene!(),takes:f.host.engine.takeChunks!(-1),transition:accepted.payload});
  assert.equal(publicPart.includes('PRIVATE_OWNER_A'),false);
});

test('event and rules header are one SQLite transaction: writer failure retains old history and no physical adoption',async t=>{
  const f=await setup(t),h=f.host,seq=h.seq,before=h.engine.stateHash(),version=f.db.world(h.worldId)!.rules_version;
  f.db.db.exec("CREATE TEMP TRIGGER refuse_header BEFORE UPDATE OF rules_version ON worlds BEGIN SELECT RAISE(ABORT,'fixture header refusal'); END");
  const p=h.adoptCommons('world:checkpoint'),reject=assert.rejects(p,/fixture header refusal/);h.drainInputs();await reject;
  assert.equal(h.seq,seq);assert.equal(h.engine.stateHash(),before);assert.equal(f.db.world(h.worldId)!.rules_version,version);
  assert.equal(f.db.events(h.worldId).some(e=>e.payload?.commonsTransition),false);
  f.db.db.exec('DROP TRIGGER refuse_header');const again=h.adoptCommons('world:checkpoint');h.drainInputs();await again;
  assert.equal(f.db.world(h.worldId)!.rules_version,h.engine.rulesVersion);
});

test('changed queued source is refused before any event/header and the original body remains in the old world',async t=>{
  const f=await setup(t),h=f.host,seq=h.seq,version=f.db.world(h.worldId)!.rules_version;
  const p=h.adoptCommons('world:checkpoint'),reject=assert.rejects(p,/source-moved/);
  h.engine.step();h.drainInputs();await reject;
  assert.equal(h.seq,seq);assert.equal(f.db.world(h.worldId)!.rules_version,version);assert.equal(h.engine.world.base.campus,'greenfield');
});

test('snapshot and complete genesis boot agree at the committed checkpoint, while a missing transition fails closed',async t=>{
  const f=await setup(t),h=f.host;while(h.engine.world.tick<37)h.tickOnce();
  const p=h.adoptCommons('world:checkpoint');h.drainInputs();const accepted=await p;
  const before=h.engine.stateHash(),kernel=kernelHash(h.kernel);f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(h.worldId);
  assert.equal(f.reopen().from,'genesis');assert.equal(f.host.engine.stateHash(),before);assert.equal(kernelHash(f.host.kernel),kernel);
  f.db.db.prepare('DELETE FROM events WHERE world_id=? AND seq=?').run(h.worldId,accepted.seq);
  assert.throws(()=>new WorldHost(f.db,f.factory,'existing-commons',1e9,h.worldId).boot(),/history-head-differs/);
});

test('a station era remains unchanged and blocks adoption until explicit version carry-forward is implemented',async t=>{
  const f=await setup(t),h=f.host,station=new CandidateStationV1(h);let done=false;
  const record=station.record().finally(()=>{done=true;});while(!done){h.drainInputs();await setImmediate();}await record;
  const before=hashOf(h.stationHistoryV1()),seq=h.seq,version=h.engine.rulesVersion;
  await assert.rejects(h.adoptCommons('world:checkpoint'),/station-carry-forward-required/);
  assert.equal(hashOf(h.stationHistoryV1()),before);assert.equal(h.seq,seq);assert.equal(h.engine.rulesVersion,version);assert.equal(f.db.paidCost(),0);
});

for(const phase of ['after-event','after-header','after-commit'])
test(`real worker exit ${phase} leaves the event/header atomic and recoverable without a model`,async t=>{
  const f=await setup(t),body=structuredClone(f.host.engine.world.entities.h_A),oldRules=f.host.engine.rulesVersion,seq=f.host.seq;
  const worker=new Worker(new URL('../test/fixtures/commons-transition-worker.ts',import.meta.url),{workerData:{path:f.db.path,phase},execArgv:[]});
  t.after(()=>worker.terminate());assert.equal((await once(worker,'exit'))[0],23);
  const committed=phase==='after-commit';assert.equal(f.db.events(f.host.worldId).filter(e=>e.payload?.commonsTransition).length,committed?1:0);
  assert.equal(f.db.events(f.host.worldId).at(-1)!.seq,seq+(committed?1:0));
  assert.equal(f.db.world(f.host.worldId)!.rules_version,oldRules+(committed?'+commons/1':''));
  f.reopen();assert.equal(f.host.engine.world.base.campus,committed?'eden-commons':'greenfield');
  assert.deepEqual(f.host.engine.world.entities.h_A,body);assert.equal(f.host.engine.rulesVersion,f.db.world(f.host.worldId)!.rules_version);
  assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
});

test('a new physical anchor cannot silently reuse an existing canonical Thing identity',async t=>{
  const f=await setup(t),h=f.host,before=h.engine.stateHash(),seq=h.seq;
  h.kernel.things.commons={id:'commons',kind:'place',name:'Existing unrelated place',at:null,traits:{privatePurpose:'PRIVATE_EXISTING_THING'},states:{},born:h.engine.world.tick,by:'fixture'};
  const old=structuredClone(h.kernel.things.commons);
  await assert.rejects(h.adoptCommons('world:checkpoint'),/kernel-collision:commons/);
  assert.equal(h.engine.stateHash(),before);assert.equal(h.seq,seq);assert.deepEqual(h.kernel.things.commons,old);
});

test('published same-world old/new captures and partial takes come from actual SQLite transition, native arrival and model-free restart',async()=>{
  const out=await existingCommonsFixture(),published=JSON.parse(readFileSync(new URL('../test/fixtures/commons-transition/journey.v1.json',import.meta.url),'utf8'));
  assert.deepEqual(out,published);
  assert.deepEqual(out.chunks.slice(0,3).map(c=>[c.fromTick,c.toTick]),[[1,21],[21,37],[37,57]]);
  const refs=new Set(out.scenes.map(s=>s.ref.hash));
  for(const c of out.chunks){const take=c.take as Take;assert.equal(refs.has(take.renderSceneRef!.hash),true);
    const first=sampleTake(take,0),last=sampleTake(take,take.ticks*take.dt);assert.ok(first.entities.h_A);assert.ok(last.entities.h_A);
  }
  assert.deepEqual(out.bodyBefore,out.bodyAfter);assert.deepEqual(out.finalRoot,[9,0,5]);assert.equal(out.evidence.paidSpendUSD,0);
});
