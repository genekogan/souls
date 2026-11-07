import test from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory,marsCommonsTransitionFactory,EDEN_COMMONS_WORLD } from '@souls/engine-mars';
import { kernelHash } from '@souls/kernel';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { ClockFrontiers,clockFrontierV1Schema } from './clock-frontier.ts';
import { hashOf,captureRenderScene } from '@souls/engine-contract';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { CandidateStationV1 } from './station.ts';
import { CandidateStationV2 } from './station-v2.ts';
import { stationPhaseAtTickV2,stationLivePhaseV2 } from '@souls/protocol';

test('durable quiet tick destination restores native elapsed time beyond the last input without snapshot or model',async t=>{
  const db=new Db(':memory:');t.after(()=>db.close());const factory=await marsFactory(EDEN_COMMONS_WORLD);
  const make=()=>new WorldHost(db,factory,'quiet-clock',1e9,'clock-commons',{durableClockV1:true});
  const host=make();host.boot();host.drainInputs();
  const p=host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',name:'Alice',owner:'human:alice',description:'private fixture'});
  host.drainInputs();await p;
  for(let i=0;i<37;i++)host.tickOnce();
  const tick=host.engine.world.tick,body=host.engine.stateHash(),meaning=kernelHash(host.kernel);
  assert.equal(db.latestSnapshot(host.worldId),null);
  const next=make();assert.equal(next.boot().from,'genesis');
  assert.equal(next.engine.world.tick,tick);assert.equal(next.engine.stateHash(),body);assert.equal(kernelHash(next.kernel),meaning);
  assert.equal(next.minds.get('s_A')!.owner,'human:alice');assert.deepEqual(next.engine.runtime.violations,[]);assert.equal(db.paidCost(),0);
});

test('actual native movement, derived card effects, retained owner purpose and snapshot/genesis both continue at the durable head',async t=>{
  const db=new Db(':memory:');t.after(()=>db.close());const factory=await marsFactory(EDEN_COMMONS_WORLD);
  const make=()=>new WorldHost(db,factory,'moving-clock',1e9,'clock-motion',{durableClockV1:true});
  const host=make();host.boot();host.drainInputs();
  db.upsertUser({id:'human:alice',role:'user',email:null,wallet:null});
  db.createSoul({id:'s_A',worldId:host.worldId,owner:'human:alice',entityId:'h_A',name:'Alice',description:'fixture',native:false});
  const accept=async(p:Promise<unknown>)=>{host.drainInputs();await p;};
  await accept(host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',name:'Alice',owner:'human:alice',description:'fixture'}));
  await accept(host.enqueue('intent','human:alice',{soulId:'s_A',intent:{text:'PRIVATE_OWNER_PROMISE',agenda:[{card:'rest'}]}}));
  await accept(host.enqueue('decision','soul:s_A',{soulId:'s_A',entityId:'h_A',card:'rest',target:null,option:'rest-after-walk',
    label:'walk then rest',steps:[{verb:'walk_to',params:{to:[20,10],standoff:0}},{verb:'rest',params:{seconds:1}}],
    approachLen:1,reevalTicks:10000,trigger:'fixture',fallback:false}));
  for(let i=0;i<37;i++)host.tickOnce();
  assert.ok(host.engine.programOf('h_A'));host.saveSnapshot();
  const savedTick=host.engine.world.tick;
  for(let i=0;i<71;i++)host.tickOnce();
  const checkpoint={tick:host.engine.world.tick,engine:host.engine.stateHash(),kernel:kernelHash(host.kernel),mind:JSON.parse(JSON.stringify(host.minds.get('s_A')))};
  assert.equal(db.latestSnapshot(host.worldId)!.tick,savedTick);
  const fromSnapshot=make();assert.equal(fromSnapshot.boot().from,'snapshot');
  assert.equal(fromSnapshot.engine.world.tick,checkpoint.tick);assert.equal(fromSnapshot.engine.stateHash(),checkpoint.engine);
  assert.equal(kernelHash(fromSnapshot.kernel),checkpoint.kernel);assert.deepEqual(JSON.parse(JSON.stringify(fromSnapshot.minds.get('s_A'))),checkpoint.mind);
  db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(host.worldId);
  const fromGenesis=make();assert.equal(fromGenesis.boot().from,'genesis');
  assert.equal(fromGenesis.engine.stateHash(),checkpoint.engine);assert.equal(kernelHash(fromGenesis.kernel),checkpoint.kernel);
  assert.deepEqual(JSON.parse(JSON.stringify(fromGenesis.minds.get('s_A'))),checkpoint.mind);
  // One authoritative DB writer; detached native adapters compare continuation.
  const continuations=[factory.restore(fromSnapshot.engine.snapshot()),factory.restore(fromGenesis.engine.snapshot())];
  for(let i=0;i<260;i++){host.tickOnce();for(const engine of continuations)engine.step();}
  for(const engine of continuations)assert.equal(engine.stateHash(),host.engine.stateHash());
  assert.equal(host.counts.rest,1);
  assert.deepEqual(host.engine.world.entities.h_A.pose.p,[20,0,10]);assert.equal(db.soul('s_A')!.owner,'human:alice');
  assert.equal(host.minds.get('s_A')!.intent!.text,'PRIVATE_OWNER_PROMISE');assert.equal(db.paidCost(),0);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM clock_frontiers_v1').get()!.n,1);
  assert.ok(db.events(host.worldId).length<10,'elapsed ticks do not inflate the canonical input log');
});

test('later same-tick events validate the earlier private clock prefix before advancing, and reader omission fails closed',async t=>{
  const db=new Db(':memory:');t.after(()=>db.close());const factory=await marsFactory(EDEN_COMMONS_WORLD);
  const host=new WorldHost(db,factory,'later-clock',1e9,'clock-later',{durableClockV1:true});host.boot();
  for(let i=0;i<17;i++)host.tickOnce();
  const old=new ClockFrontiers(db).read(host.worldId)!;
  const p=host.enqueue('admin','fixture',{action:'same-tick accepted input'});host.drainInputs();await p;
  assert.ok(host.seq>old.throughSeq);
  const next=new WorldHost(db,factory,'later-clock',1e9,host.worldId,{durableClockV1:true});next.boot();
  assert.equal(next.engine.world.tick,17);assert.equal(next.seq,host.seq);assert.equal(next.engine.stateHash(),host.engine.stateHash());
  assert.throws(()=>new WorldHost(db,factory,'later-clock',1e9,host.worldId).boot(),/reader-required/);
});

test('logged physical checkpoint after a clock frontier keeps old/new rules, bodies and deterministic destination',async t=>{
  const db=new Db(':memory:');t.after(()=>db.close());const factory=await marsCommonsTransitionFactory();
  const make=()=>new WorldHost(db,factory,'clock-era',1e9,'clock-era',{durableClockV1:true});
  const host=make();host.boot();for(let i=0;i<37;i++)host.tickOnce();
  const old=new ClockFrontiers(db).read(host.worldId)!;
  const adoption=host.adoptCommons('world:checkpoint');host.drainInputs();await adoption;
  const partial=make();partial.boot();assert.equal(partial.engine.world.tick,37);assert.equal(partial.engine.stateHash(),host.engine.stateHash());
  assert.notEqual(partial.engine.rulesVersion,old.rulesVersion);
  for(let i=0;i<22;i++)host.tickOnce();
  const next=make();next.boot();assert.equal(next.engine.world.tick,59);assert.equal(next.engine.stateHash(),host.engine.stateHash());
  assert.equal(kernelHash(next.kernel),kernelHash(host.kernel));assert.deepEqual(next.engine.runtime.violations,[]);
});

test('private clock rejects changed source, malformed bytes, regressed heads and changed replay hashes without repairing history',async t=>{
  const db=new Db(':memory:');t.after(()=>db.close());const factory=await marsFactory(EDEN_COMMONS_WORLD);
  const make=()=>new WorldHost(db,factory,'clock-negative',1e9,'clock-negative',{durableClockV1:true});
  const host=make();host.boot();for(let i=0;i<8;i++)host.tickOnce();
  const clock=new ClockFrontiers(db),old=clock.read(host.worldId)!;
  assert.equal(clockFrontierV1Schema.safeParse({...old,privateOwner:'PRIVATE'}).success,false);
  assert.throws(()=>clock.write({...old,tick:7}),/regression/);
  assert.throws(()=>clock.write({...old,engineHash:'0'.repeat(64)}),/changed-same-head/);
  assert.throws(()=>clock.write({...old,seedHash:'0'.repeat(64)}),/source-differs/);
  assert.deepEqual(clock.read(host.worldId),old);
  const patch=(v:unknown,h?:string)=>db.db.prepare('UPDATE clock_frontiers_v1 SET body=?,body_hash=? WHERE world_id=?').run(JSON.stringify(v),h??hashOf(v),host.worldId);
  patch({...old,engineHash:'0'.repeat(64)});assert.throws(()=>make().boot(),/replay-differs/);patch(old);
  patch(old,'0'.repeat(64));assert.throws(()=>make().boot(),/corrupt/);patch(old);
  const prefix=db.events(host.worldId,old.throughSeq-1,1)[0];
  db.db.prepare('UPDATE events SET author=? WHERE world_id=? AND seq=?').run('changed-source',host.worldId,prefix.seq);
  assert.throws(()=>make().boot(),/source-differs/);
});

test('writer refusal halts further stepping, views and callbacks while the last acknowledged quiet clock remains restartable',async t=>{
  const db=new Db(':memory:');t.after(()=>db.close());const factory=await marsFactory(EDEN_COMMONS_WORLD);
  const make=()=>new WorldHost(db,factory,'clock-write-fault',1e9,'clock-write-fault',{durableClockV1:true});
  const host=make();host.boot();for(let i=0;i<9;i++)host.tickOnce();const old=new ClockFrontiers(db).read(host.worldId)!;
  let published=0;host.listeners.push({afterTick(){published++;},onBatch(){published++;},onHeartbeat(){published++;}});
  db.db.exec("CREATE TEMP TRIGGER refuse_clock BEFORE UPDATE ON clock_frontiers_v1 BEGIN SELECT RAISE(ABORT,'private clock writer refusal'); END");
  assert.throws(()=>host.tickOnce(),/private clock writer refusal/);assert.equal(host.paused,true);assert.equal(published,0);
  assert.throws(()=>host.tickOnce(),/unavailable/);assert.throws(()=>host.snapshotView(),/unavailable/);assert.throws(()=>host.saveSnapshot(),/unavailable/);
  assert.deepEqual(new ClockFrontiers(db).read(host.worldId),old);
  const next=make();next.boot();assert.equal(next.engine.world.tick,9);assert.equal(next.engine.stateHash(),old.engineHash);
});

for(const phase of ['after-step','after-write','after-commit'])test(`actual native process exit ${phase} recovers the last committed body tick without a model`,async t=>{
  const dir=mkdtempSync(join(tmpdir(),'souls-clock-crash-')),db=new Db(join(dir,'world.db'));
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  const factory=await marsFactory(EDEN_COMMONS_WORLD),make=()=>new WorldHost(db,factory,'clock-crash',1e9,'clock-crash',{durableClockV1:true});
  const host=make();host.boot();host.drainInputs();
  const birth=host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',name:'Alice',owner:'human:alice',description:'fixture'});host.drainInputs();await birth;
  const decision=host.enqueue('decision','soul:s_A',{soulId:'s_A',entityId:'h_A',option:'walk',label:'walk',
    steps:[{verb:'walk_to',params:{to:[20,10],standoff:0}}],reevalTicks:10000,trigger:'fixture',fallback:false});host.drainInputs();await decision;
  for(let i=0;i<7;i++)host.tickOnce();
  const old=new ClockFrontiers(db).read(host.worldId)!,forward=factory.restore(host.engine.snapshot());forward.step();
  const worker=new Worker(new URL('../test/fixtures/clock-frontier-worker.ts',import.meta.url),{workerData:{path:db.path,phase},execArgv:[]});
  t.after(()=>worker.terminate());assert.equal((await once(worker,'exit'))[0],23);
  const committed=phase==='after-commit',row=new ClockFrontiers(db).read(host.worldId)!;
  assert.equal(row.tick,committed?8:7);assert.equal(row.engineHash,committed?forward.stateHash():old.engineHash);
  const next=make();assert.equal(next.boot().from,'genesis');assert.equal(next.engine.world.tick,row.tick);
  assert.equal(next.engine.stateHash(),row.engineHash);assert.equal(kernelHash(next.kernel),row.kernelHash);
  assert.deepEqual(next.engine.runtime.violations,[]);assert.equal(db.paidCost(),0);
});

test('recorded station cue and captured physical era stay bound to the recovered elapsed native head',async t=>{
  const db=new Db(':memory:');t.after(()=>db.close());const factory=await marsCommonsTransitionFactory();
  const make=()=>new WorldHost(db,factory,'clock-station',1e9,'clock-station',{durableClockV1:true});
  const host=make();host.boot();host.drainInputs();
  async function accept<T>(p:Promise<T>):Promise<T>{let done=false;p.finally(()=>{done=true;});while(!done){host.drainInputs();await setImmediate();}return p;}
  const original=await accept(new CandidateStationV1(host).record());
  for(let i=0;i<37;i++)host.tickOnce();
  await accept(host.adoptCommons('world:checkpoint',{stationEraV1:true}));
  const v2=new CandidateStationV2(host),carried=await accept(v2.record());
  assert.equal(carried.cue!.cueId,original.cue!.cueId);
  for(let i=0;i<41;i++)host.tickOnce();
  const old=host.stationPhysicalHeadV1()!,history=hashOf(host.stationHistoryV2()),
    capture=captureRenderScene(host.engine.rulesVersion,host.engine.renderScene!()).ref;
  assert.deepEqual((host.engine.takeChunks!(-1).at(-1)!.take as any).renderSceneRef,capture);
  const next=make();next.boot();assert.equal(next.engine.world.tick,78);
  assert.deepEqual(next.stationPhysicalHeadV1(),old);assert.equal(hashOf(next.stationHistoryV2()),history);
  assert.deepEqual(captureRenderScene(next.engine.rulesVersion,next.engine.renderScene!()).ref,capture);
  const newStation=new CandidateStationV2(next);assert.equal(newStation.view().fresh,false,'a recovered old real-time anchor is not live');
  let done=false;const anchored=newStation.record().finally(()=>{done=true;});while(!done){next.drainInputs();await setImmediate();}
  const fresh=await anchored;assert.equal(fresh.cue!.cueId,original.cue!.cueId);
  assert.deepEqual(stationLivePhaseV2(fresh,fresh.anchor!.serverTimeMs),stationPhaseAtTickV2(fresh.cue!,78));
  assert.equal(fresh.physical!.revision,1);assert.deepEqual(next.engine.runtime.violations,[]);assert.equal(db.paidCost(),0);
});

for(const interrupted of [false,true])test(`explicit logged native repair ${interrupted?'before clock write':'with clock write'} supersedes its old clock prefix`,async t=>{
  const db=new Db(':memory:');t.after(()=>db.close());const factory=await marsFactory(EDEN_COMMONS_WORLD);
  const make=()=>new WorldHost(db,factory,'clock-repair',1e9,'clock-repair',{durableClockV1:true});
  const host=make();host.boot();host.drainInputs();
  const birth=host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',name:'Alice',owner:'human:alice',description:'fixture'});host.drainInputs();await birth;
  const decision=host.enqueue('decision','soul:s_A',{soulId:'s_A',entityId:'h_A',card:'rest',target:null,option:'rest',label:'rest',
    steps:[{verb:'rest',params:{seconds:90}}],approachLen:0,reevalTicks:10000,trigger:'fixture',fallback:false});host.drainInputs();await decision;
  for(let i=0;i<37;i++)host.tickOnce();const old=new ClockFrontiers(db).read(host.worldId)!;
  if(interrupted){const append=db.appendEvent.bind(db);t.mock.method(db,'appendEvent',(world:string,event:import('@souls/protocol').LogEvent)=>{
    append(world,event);if(event.payload?.recovery)throw new Error('fixture interruption after durable repair');
  });}
  host.engine.step=()=>{throw new Error('fixture attributed native rest failure');};
  if(interrupted)assert.throws(()=>host.tickOnce(),/interruption after durable repair/);else host.tickOnce();
  const repair=db.events(host.worldId).at(-1)!;assert.ok(repair.payload.recovery);assert.ok(repair.seq>old.throughSeq);
  if(interrupted)assert.deepEqual(new ClockFrontiers(db).read(host.worldId),old);
  const next=make();next.boot();assert.equal(next.engine.world.tick,37);assert.equal(next.seq,repair.seq);
  assert.equal(next.engine.programOf('h_A'),null);assert.deepEqual(next.engine.runtime.violations,[]);
  assert.equal((next.extra.cardFaults as any).rest,1);assert.equal(db.paidCost(),0);
  if(!interrupted){assert.equal(next.engine.stateHash(),host.engine.stateHash());assert.equal(kernelHash(next.kernel),kernelHash(host.kernel));}
  next.tickOnce();assert.equal(new ClockFrontiers(db).read(next.worldId)!.tick,38);
});
