import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { kernelHash } from '@souls/kernel';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { WorldHost,replayFromGenesis } from './world.ts';
import { LifecycleRunner,projectLifecycle,lifecycleBodyReady } from './lifecycle-runner.ts';
import type { WorldState as NativeWorldState } from '../../../mars/viewer/engine/world/types.ts';
import { fixture,settle,factory,seed,worldId,scope,requestId,retireId,input } from '../test/lifecycle-native-fixture.ts';
const nativeWorld=(host:WorldHost)=>host.engine.world as NativeWorldState;
const r3=(n:number)=>Math.round(n*1000)/1000;

test('actual native producer admits one human-owned body/kernel/Mind and publishes fresh strict private readiness',async t=>{
  const f=fixture();t.after(()=>f.db.close());const op=f.journal.acceptCreate(scope,requestId,input,()=>true);
  assert.equal(projectLifecycle(f.host,op).state,'pending');assert.equal(projectLifecycle(f.host,op).ready,false);
  await settle(f);const admitted=f.journal.get(scope,requestId)!;assert.equal(admitted.state,'complete');assert.equal(f.runner.faults.size,0);
  assert.equal(lifecycleBodyReady(f.host,admitted),true);const view=projectLifecycle(f.host,admitted);assert.equal(view.state,'admitted');assert.equal(view.ready,true);assert.ok(view.fact);
  assert.equal(f.db.events(worldId).filter(e=>e.kind==='birth').length,1);assert.equal(f.runner.ownerPage('owner').requests.length,1);
  assert.equal(f.db.events(worldId).some(e=>JSON.stringify(e).includes(requestId)),false);
  const mind=f.host.minds.get('s_A')!;mind.owner='other';assert.equal(projectLifecycle(f.host,admitted).ready,false);mind.owner='owner';
  const restart=new WorldHost(f.db,factory,seed,1e9,worldId);restart.boot();assert.equal(lifecycleBodyReady(restart,admitted),true);
  assert.equal(restart.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(restart.kernel),kernelHash(f.host.kernel));assert.equal(f.db.paidCost(),0);
});

// arrival-search/1 (lane ARR): refused only when the world has no standing ground at all. The engine's search answers
// null then (arrival-search.test.ts covers the geometry); here the search is held to null on an arrival off the ground.
test('actual native unavailable arrival creates no birth, releases reservation and preserves tick/restart liveness',async t=>{
  const bad=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true,arrival:[500,500],reference:[501,500]});const f=fixture(':memory:',bad);t.after(()=>f.db.close());
  (f.host.engine as unknown as {arrivalSearchV1():null}).arrivalSearchV1=()=>null;
  f.journal.acceptCreate(scope,requestId,input,()=>true);await settle(f);const op=f.journal.get(scope,requestId)!;
  assert.equal(op.state,'refused');assert.equal(f.runner.faults.size,0);assert.equal(projectLifecycle(f.host,op).reason,'arrival-unavailable');
  assert.equal(f.db.events(worldId).some(e=>e.kind==='birth'),false);assert.equal(f.db.soulsOf('owner').length,0);assert.equal(f.db.soulByName(worldId,'alice'),undefined);
  for(let i=0;i<80;i++)f.host.tickOnce();assert.equal(f.host.engine.world.tick,80);
  void f.host.enqueue('rules','world',{checkpoint:'refusal-liveness'});f.host.drainInputs();
  const restart=new WorldHost(f.db,bad,seed,1e9,worldId);restart.boot();assert.equal(restart.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(restart.kernel),kernelHash(f.host.kernel));assert.equal(f.db.paidCost(),0);
});

test('queued admission rechecks current invitation and native placement rather than stale preview',async t=>{
  const f=fixture();t.after(()=>f.db.close());f.journal.acceptCreate(scope,requestId,input,()=>true);f.runner.pump();
  f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='owner'").run();f.host.drainInputs();await settle(f);
  assert.equal(f.journal.get(scope,requestId)!.state,'pending');assert.equal(f.host.engine.world.entities.h_A,undefined);assert.equal(f.db.events(worldId).some(e=>e.kind==='birth'),false);assert.equal(f.runner.faults.size,0);
  f.db.setInvited('owner','local-admin');await settle(f);assert.equal(f.journal.get(scope,requestId)!.state,'complete');
  const second={...scope,soulId:'s_B',entityId:'h_B'};f.journal.acceptCreate(second,retireId,{...input,name:'Bob'},()=>true);
  // A canonical preceding birth changes placement after the initial probe.
  const other=f.host.enqueue('birth','world',{soulId:'s_C',entityId:'h_C',owner:'owner',name:'Carol',description:'another canonical body'});
  f.runner.pump();
  f.host.drainInputs();await other;await settle(f);assert.equal(f.journal.get(second,retireId)!.state,'complete');assert.equal(f.runner.faults.size,0);
});

test('atomic host-journal failure rolls back the birth and leaves recoverable native pending work',async t=>{
  const f=fixture();t.after(()=>f.db.close());f.journal.acceptCreate(scope,requestId,input,()=>true);
  assert.throws(()=>f.journal.linkAccepted(scope,requestId,{seq:2,tick:0,at:1,kind:'birth',author:'soul:s_A',payload:{}},()=>true),/host acceptance transaction/);
  f.db.db.exec("CREATE TRIGGER reject_reference BEFORE UPDATE ON lifecycle_operations_v1 WHEN NEW.state='recorded' BEGIN SELECT RAISE(ABORT,'candidate reference failure'); END");
  await settle(f);assert.equal(f.runner.faults.size,1);assert.equal(f.journal.get(scope,requestId)!.state,'pending');assert.equal(f.db.events(worldId).some(e=>e.kind==='birth'),false);assert.equal(f.host.engine.world.entities.h_A,undefined);
  f.db.db.exec('DROP TRIGGER reject_reference');const fresh=new LifecycleRunner(f.host,f.journal,()=>true);fresh.pump();f.host.drainInputs();await settle({...f,runner:fresh});assert.equal(f.journal.get(scope,requestId)!.state,'complete');
});

test('actual walking retirement preserves other actor and historical receipt, logs confirmed cleanup tick and replays',async t=>{
  const f=fixture();t.after(()=>f.db.close());f.journal.acceptCreate(scope,requestId,input,()=>true);await settle(f);
  const other={...scope,soulId:'s_B',entityId:'h_B'};f.journal.acceptCreate(other,'lc_'+'c'.repeat(32),{...input,name:'Bob'},()=>true);await settle(f);
  const decision=f.host.enqueue('decision','soul:s_A',{soulId:'s_A',entityId:'h_A',label:'native walking',steps:[{verb:'walk_to',params:{to:[12,0,5]}}]});f.host.drainInputs();await decision;
  for(let i=0;i<40;i++)f.host.tickOnce();assert.equal(f.host.engine.world.entities.h_A.human!.activity,'walk');
  const old=f.journal.get(scope,requestId)!,birthFact=structuredClone(projectLifecycle(f.host,old).fact);
  assert.deepEqual(birthFact,{seq:old.terminal!.seq,tick:old.terminal!.tick});
  f.db.setSoulToken('s_A','local-token-hash');f.journal.acceptRetire(scope,retireId,()=>true);
  const historical=projectLifecycle(f.host,f.journal.get(scope,requestId)!);assert.equal(historical.ready,false);assert.equal(historical.reason,'retirement-accepted');assert.equal(historical.revision,old.revision+1);assert.deepEqual(historical.fact,birthFact);
  assert.ok(f.host.engine.world.entities.h_A);assert.equal(f.db.soul('s_A')!.token_hash,null);await settle(f);
  const removed=f.journal.get(scope,retireId)!;assert.equal(removed.state,'complete');assert.equal(f.runner.faults.size,0);assert.equal(projectLifecycle(f.host,removed).state,'retired');assert.equal(f.host.engine.world.entities.h_A,undefined);assert.ok(f.host.engine.world.entities.h_B);
  const checkpoint=f.db.events(worldId).at(-1)!;assert.equal(checkpoint.kind,'rules');assert.deepEqual(checkpoint.payload,{checkpoint:'lifecycle-removal-confirmed'});
  const restart=new WorldHost(f.db,factory,seed,1e9,worldId);restart.boot();const replay=replayFromGenesis(factory,seed,f.db.events(worldId),f.host.engine.world.tick,{includeHeadEvents:true});
  assert.equal(restart.engine.stateHash(),f.host.engine.stateHash());assert.equal(replay.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(restart.kernel),kernelHash(f.host.kernel));assert.equal(kernelHash(replay.kernel),kernelHash(f.host.kernel));assert.equal(f.db.paidCost(),0);
});

test('bounded recovery scan does not starve later operation behind twenty authority-deferred entries',async t=>{
  const f=fixture();t.after(()=>f.db.close());
  for(let i=0;i<21;i++)f.journal.acceptCreate({...scope,soulId:'s_'+i,entityId:'h_'+i},'lc_'+i.toString(16).padStart(32,'0'),{...input,name:'Person '+i},()=>true);
  f.db.db.exec('UPDATE lifecycle_operations_v1 SET requested_at=1');const runner=new LifecycleRunner(f.host,f.journal,op=>op.scope.soulId==='s_20');
  await settle({...f,runner});assert.equal(f.journal.recover(worldId).length,20);assert.equal(f.db.events(worldId).filter(e=>e.kind==='birth').length,1);assert.ok(f.host.engine.world.entities.h_20);assert.equal(runner.faults.size,0);
});

for(const boundary of ['create-commit','birth-write','birth-commit','birth-applied','retire-commit','retire-write','terminal-write','terminal-commit'])test(`actual serialized native exit ${boundary} reconciles the durable operation without duplicate birth`,async t=>{
  const dir=mkdtempSync(join(tmpdir(),'eden-native-journal-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'world.sqlite');
  const result=spawnSync(process.execPath,[new URL('../test/lifecycle-native-exit.ts',import.meta.url).pathname,path,boundary],{encoding:'utf8',timeout:20_000});assert.equal(result.error,undefined);assert.equal(result.status,23,result.stderr);
  const f=fixture(path);t.after(()=>f.db.close());const retiring=['retire-commit','retire-write','terminal-write','terminal-commit'].includes(boundary);
  if(['create-commit','birth-write'].includes(boundary)){assert.equal(f.journal.get(scope,requestId)!.state,'pending');assert.equal(f.host.engine.world.entities.h_A,undefined);}
  if(['birth-commit','birth-applied'].includes(boundary)){assert.equal(f.journal.get(scope,requestId)!.state,'recorded');assert.ok(f.host.engine.world.entities.h_A);assert.equal(f.host.minds.get('s_A')!.owner,'owner');}
  if(retiring){assert.equal(f.db.soul('s_A')!.token_hash,null);assert.equal(projectLifecycle(f.host,f.journal.get(scope,requestId)!).reason,'retirement-accepted');}
  await settle(f);assert.equal(f.runner.faults.size,0);assert.equal(f.journal.get(scope,requestId)!.state,'complete');assert.equal(f.db.events(worldId).filter(e=>e.kind==='birth').length,1);
  if(retiring){assert.equal(f.journal.get(scope,retireId)!.state,'complete');assert.equal(f.host.engine.world.entities.h_A,undefined);assert.equal(f.host.minds.has('s_A'),false);assert.equal(f.db.events(worldId).filter(e=>e.kind==='retire').length,1);}
  else assert.equal(projectLifecycle(f.host,f.journal.get(scope,requestId)!).ready,true);
  const restart=new WorldHost(f.db,factory,seed,1e9,worldId);restart.boot();assert.equal(restart.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(restart.kernel),kernelHash(f.host.kernel));assert.equal(f.db.paidCost(),0);
});

test('actual occupied workstation retirement waits for native stand/exit before publishing retired',async t=>{
  const camp=await marsFactory({scene:'eden-camp',safeCrewRemoval:true,arrival:[-3,18],arrivalPlace:'yard',reference:[-1,18],grounds:{id:'grounds',name:'Camp'}});
  const f=fixture(':memory:',camp);t.after(()=>f.db.close());f.journal.acceptCreate(scope,requestId,input,()=>true);await settle(f);
  const working=f.host.enqueue('decision','soul:s_A',{soulId:'s_A',entityId:'h_A',label:'actual workstation',steps:[{verb:'mars:work_at',params:{station:'computer-1',seat:'computer-1-chair#seat',task:'local lifecycle',duration:120}}]});f.host.drainInputs();await working;
  for(let i=0;i<10000&&nativeWorld(f.host).entities.h_A.human!.baseActivity!=='sit'&&nativeWorld(f.host).entities.h_A.human!.activity!=='sit';i++)f.host.tickOnce();
  const human=nativeWorld(f.host).entities.h_A.human!;assert.ok(human.activity==='sit'||human.baseActivity==='sit','actual seat reached');
  f.journal.acceptRetire(scope,retireId,()=>true);await settle(f);assert.equal(f.journal.get(scope,retireId)!.state,'recorded');assert.ok(f.host.engine.world.entities.h_A,'native body remains during exit');
  let pendingTicks=0;
  for(let i=0;i<3000&&f.journal.get(scope,retireId)!.state!=='complete';i++){f.host.tickOnce();await settle(f,1);if(f.host.engine.world.entities.h_A)pendingTicks++;}
  assert.ok(pendingTicks>0);assert.equal(f.journal.get(scope,retireId)!.state,'complete');assert.equal(f.runner.faults.size,0);assert.deepEqual(f.host.engine.runtime.violations,[]);
  const replay=replayFromGenesis(camp,seed,f.db.events(worldId),f.host.engine.world.tick,{includeHeadEvents:true});assert.equal(replay.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(replay.kernel),kernelHash(f.host.kernel));
});

for(const retireActor of ['leader','borrowed'])test(`actual committed construction ${retireActor} retirement drains held load before terminal receipt`,async t=>{
  const camp=await marsFactory({scene:'eden-camp',safeCrewRemoval:true,arrival:[-3,18],arrivalPlace:'yard',reference:[-1,18],grounds:{id:'grounds',name:'Camp'}});
  const f=fixture(':memory:',camp);t.after(()=>f.db.close());
  const scopes=Array.from({length:4},(_,i)=>({...scope,soulId:'s_'+i,entityId:'h'+i}));
  for(const [i,s] of scopes.entries())f.journal.acceptCreate(s,'lc_'+i.toString(16).padStart(32,'0'),{...input,name:['Alice','Bob','Carol','David'][i]},()=>true);await settle(f);
  const start=async(phase:string)=>{const p=f.host.enqueue('decision','soul:s_0',{soulId:'s_0',entityId:'h0',label:'build '+phase,steps:[{verb:'build_lookout',params:{phase}}]});f.host.drainInputs();await p;};
  await start('stage');for(let i=0;i<90000&&f.host.engine.programOf('h0');i++)f.host.tickOnce();assert.equal(f.host.engine.programOf('h0'),null);
  await start('frame');let held=false;
  for(let i=0;i<90000;i++){f.host.tickOnce();if(['upright-a','upright-b'].every(id=>nativeWorld(f.host).entities[id].support?.kind==='held')){held=true;break;}}
  assert.equal(held,true);assert.equal(f.host.engine.actorBorrowed!('h2'),true);
  const target=scopes[retireActor==='leader'?0:2],rid='lc_'+'f'.repeat(32);f.journal.acceptRetire(target,rid,()=>true);await settle(f);
  assert.equal(f.journal.get(target,rid)!.state,'recorded');assert.ok(f.host.engine.world.entities[target.entityId]);
  for(let i=0;i<90000&&f.journal.get(target,rid)!.state!=='complete';i++){f.host.tickOnce();await settle(f,1);}
  assert.equal(f.journal.get(target,rid)!.state,'complete');assert.equal(f.runner.faults.size,0);assert.deepEqual(f.host.engine.runtime.violations,[]);
  assert.equal(f.host.engine.world.entities[target.entityId],undefined);
  for(const id of ['upright-a','upright-b'])assert.equal(nativeWorld(f.host).entities[id].support?.kind,'connected');
  const restart=new WorldHost(f.db,camp,seed,1e9,worldId);restart.boot();assert.equal(restart.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(restart.kernel),kernelHash(f.host.kernel));
  const replay=replayFromGenesis(camp,seed,f.db.events(worldId),f.host.engine.world.tick,{includeHeadEvents:true});assert.equal(replay.engine.stateHash(),f.host.engine.stateHash());assert.equal(f.db.paidCost(),0);
});

test('inconsistent existing native or kernel identity remains a visible invariant fault, never arrival refusal',async t=>{
  for(const existing of ['body','kernel']){
    const f=fixture();t.after(()=>f.db.close());f.journal.acceptCreate(scope,requestId,input,()=>true);
    if(existing==='body')f.host.engine.spawnHuman({id:'h_A',label:'Wrong identity',soul:'s_foreign'});
    else f.host.kernel.things.s_A={id:'s_A',kind:'soul',name:'Wrong identity',traits:{body:'h_foreign'},states:{},at:null,born:0,by:'world'};
    await settle(f);assert.equal(f.runner.faults.size,1);assert.equal(f.journal.get(scope,requestId)!.state,'pending');assert.equal(f.db.soulsOf('owner').length,1);
    assert.equal(f.db.events(worldId).some(e=>e.kind==='birth'),false);assert.equal(projectLifecycle(f.host,f.journal.get(scope,requestId)!).state,'pending');
  }
});

// Lane PB (hotfix, Gene 2026-10-20): a god built over the arrival point (bench-hamlet: a giant telescope on (0,0)), so
// every approved Soul ended "refused" (arrival-unavailable) right after the person clicked Approve. A lifecycle birth now
// carries birth-near/1: the nearest clear standing ground to the arrival point, as verifier probes already did.
test('a built-over arrival point admits the approved Soul on the nearest clear ground, exactly on replay',async t=>{
  const { EDEN_COMMONS_WORLD } = await import('@souls/engine-mars');
  const built=await marsFactory({...EDEN_COMMONS_WORLD,safeCrewRemoval:true,arrival:[9,-1.8],reference:[10,-1.8]});   // on the commons platform
  const f=fixture(':memory:',built);t.after(()=>f.db.close());
  f.journal.acceptCreate(scope,requestId,input,()=>true);await settle(f);const op=f.journal.get(scope,requestId)!;
  assert.equal(op.state,'complete',`state ${op.state}: ${projectLifecycle(f.host,op).reason}`);assert.equal(f.runner.faults.size,0);
  assert.equal(lifecycleBodyReady(f.host,op),true);
  const body=f.host.engine.world.entities.h_A!;assert.ok(Math.hypot(body.pose.p[0]-9,body.pose.p[2]+1.8)<=12,'landed near the arrival point');
  const birth=f.db.events(worldId).find(e=>e.kind==='birth')!;assert.deepEqual(birth.payload.near,{at:[r3(body.pose.p[0]),r3(body.pose.p[2])],first:true},'arrival-search/1 records the exact spot');
  const restart=new WorldHost(f.db,built,seed,1e9,worldId);restart.boot();assert.equal(lifecycleBodyReady(restart,op),true);
  assert.equal(restart.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(restart.kernel),kernelHash(f.host.kernel));
});

// arrival-search/1 (lane ARR, Gene 2026-10-20: "find a place for them to go and not have spurious refusals").
test('an arrival point off the world\'s ground admits the Soul on the nearest ground of the world, exactly on replay',async t=>{
  const off=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true,arrival:[500,500],reference:[501,500]});const f=fixture(':memory:',off);t.after(()=>f.db.close());
  f.journal.acceptCreate(scope,requestId,input,()=>true);await settle(f);const op=f.journal.get(scope,requestId)!;
  assert.equal(op.state,'complete',`state ${op.state}: ${projectLifecycle(f.host,op).reason}`);assert.equal(f.runner.faults.size,0);
  const body=f.host.engine.world.entities.h_A!,birth=f.db.events(worldId).find(e=>e.kind==='birth')!;
  assert.deepEqual(birth.payload.near,{at:[r3(body.pose.p[0]),r3(body.pose.p[2])],first:true});
  const restart=new WorldHost(f.db,off,seed,1e9,worldId);restart.boot();assert.equal(lifecycleBodyReady(restart,op),true);
  assert.equal(restart.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(restart.kernel),kernelHash(f.host.kernel));
});
test('a clear arrival point keeps the default placement: the birth carries no hint',async t=>{
  const f=fixture(':memory:');t.after(()=>f.db.close());
  f.journal.acceptCreate(scope,requestId,input,()=>true);await settle(f);const op=f.journal.get(scope,requestId)!;
  assert.equal(op.state,'complete');const birth=f.db.events(worldId).find(e=>e.kind==='birth')!;assert.equal('near' in birth.payload,false);
});
test('old histories replay unchanged: a birth with lane PB\'s {at} hint (births without a hint: every replay test above)',async t=>{
  const { EDEN_COMMONS_WORLD } = await import('@souls/engine-mars');
  const built=await marsFactory({...EDEN_COMMONS_WORLD,safeCrewRemoval:true,arrival:[9,-1.8],reference:[10,-1.8]});
  const f=fixture(':memory:',built);t.after(()=>f.db.close());
  const a=f.host.enqueue('birth','scripted:legacy',{soulId:'s_old',entityId:'h_old',name:'Old',description:'pre-ARR birth with the PB hint',owner:'scripted:owner',near:{at:[9,-1.8]}});f.host.drainInputs();await a;
  const restart=new WorldHost(f.db,built,seed,1e9,worldId);restart.boot();
  assert.equal(restart.engine.stateHash(),f.host.engine.stateHash());
  assert.deepEqual(restart.engine.world.entities.h_old?.pose.p,f.host.engine.world.entities.h_old?.pose.p);
});

// lane srv-join-stall (2026-10-31): each detached birth probe is a full world snapshot + restore on the tick thread
// (eden2 Stage B: ~2 s each, three per Soul, so a 4-Soul join burst held main for 30 s+ and the launcher restarted the
// world as wedged). One admission now probes twice: the plan (pump) and the guard under the write lock; the journal link
// in that same transaction re-checks identity only.
test('one lifecycle admission restores the detached probe engine twice, not three times',async t=>{
  const counted=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});let restores=0;
  const restore=counted.restore.bind(counted);(counted as {restore:typeof restore}).restore=(s:Parameters<typeof restore>[0])=>{restores++;return restore(s);};
  const f=fixture(':memory:',counted);t.after(()=>f.db.close());
  const before=restores;f.journal.acceptCreate(scope,requestId,input,()=>true);await settle(f);
  assert.equal(f.journal.get(scope,requestId)!.state,'complete');assert.equal(f.runner.faults.size,0);
  assert.equal(restores-before,2);
});

test('four pending births are admitted one at a time: no single drainInputs or pump runs more than one detached probe',async t=>{
  const counted=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});let restores=0;
  const restore=counted.restore.bind(counted);(counted as {restore:typeof restore}).restore=(s:Parameters<typeof restore>[0])=>{restores++;return restore(s);};
  const f=fixture(':memory:',counted);t.after(()=>f.db.close());
  const ids=[0,1,2,3].map(i=>({scope:{...scope,soulId:'s_J'+i,entityId:'h_J'+i},requestId:'lc_'+(0xa0+i).toString(16).padStart(32,'0'),name:'Joiner '+i}));
  for(const j of ids)f.journal.acceptCreate(j.scope,j.requestId,{...input,name:j.name},()=>true);
  const perCall:number[]=[];const wrap=(o:{[k:string]:unknown},k:string)=>{const fn=o[k] as ()=>void;o[k]=()=>{const b=restores;try{fn.call(o);}finally{perCall.push(restores-b);}};};
  wrap(f.host as unknown as {[k:string]:unknown},'drainInputs');wrap(f.runner as unknown as {[k:string]:unknown},'pump');
  const before=restores;await settle(f,10);
  assert.equal(f.runner.faults.size,0);
  for(const j of ids)assert.equal(f.journal.get(j.scope,j.requestId)!.state,'complete',j.name);
  assert.equal(f.db.events(worldId).filter(e=>e.kind==='birth').length,4);
  assert.equal(restores-before,8);assert.ok(Math.max(...perCall)<=1,`a single call ran ${Math.max(...perCall)} probes`);
  const births=f.db.events(worldId).filter(e=>e.kind==='birth').map(e=>(e.payload as {soulId:string}).soulId);
  assert.deepEqual(births,ids.map(j=>j.scope.soulId));
});
