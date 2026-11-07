import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { hashOf } from '@souls/engine-contract';
import { marsFactory } from '@souls/engine-mars';
import { INTENT_V2, publicEvent, type IntentControllerPayloadV2 } from '@souls/protocol';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { IntentPublisher } from './intent-publisher.ts';
import { IntentRequests, type IntentRequestScope } from './intent-requests.ts';
import { IntentObservations } from './intent-observations.ts';
import { migrate } from './migrations.ts';

const factory = await marsFactory({scene:'eden-camp',arrival:[16,-10],arrivalPlace:'bunkhouse',reference:[16,-9],grounds:{id:'grounds',name:'grounds'}});
async function accept<T>(host:WorldHost, pending:Promise<T>) { host.drainInputs(); return pending; }
async function fixture(t:TestContext) {
  const dir=mkdtempSync(join(tmpdir(),'core-observations-')),db=new Db(join(dir,'world.db'));
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  db.upsertUser({id:'owner',role:'user',email:null,wallet:null});db.setInvited('owner','fixture');
  const host=new WorldHost(db,factory,'admission-fixture',1e9,'admission-world');host.boot();
  db.createSoul({id:'s_A',entityId:'h_A',worldId:host.worldId,owner:'owner',name:'Alice',description:'fixture',native:false});
  await accept(host,host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',owner:'owner',name:'Alice',description:'fixture'}));
  const scope:IntentRequestScope={worldId:host.worldId,soulId:'s_A',source:{kind:'owner',ownerId:'owner',principalId:'PRIVATE_PRINCIPAL',channel:'web'},currentAuthority:()=>true};
  const publisher=new IntentPublisher(host,new IntentRequests(db));
  const received=await accept(host,publisher.receive(scope,{contract:INTENT_V2,op:'upsert',requestId:'purpose',words:'PRIVATE_WORDS go to the campfire'}));assert.ok(received.reservation.created);
  const result=await accept(host,publisher.publish(scope,received.reservation,{summary:'PRIVATE_MEANING Walk to the fire.',agenda:[{card:'go to',target:'campfire'}],trigger:{kind:'now'}}));assert.equal(result.receipt?.phase,'understood');
  assert.ok(result.receipt?.phase==='understood');const ref={intentId:result.receipt.revision.intentId,version:1};
  await accept(host,host.enqueueIntentDecision('brain:reflex',{soulId:'s_A',entityId:'h_A',option:'go:campfire',label:'go to campfire',steps:[{verb:'walk_to',params:{to:'campfire',standoff:1.5}}],card:'go to',target:'campfire',approachLen:1,reevalTicks:1e9,fallback:false,trigger:'new-intent-v2'},ref,()=>true));
  return {db,host,ref};
}

test('a durably captured terminal survives canonical append failure and a post-terminal snapshot restart',async t=>{
  const f=await fixture(t);f.host.tickOnce();
  const append=f.db.appendEvent.bind(f.db),error=console.error;t.after(()=>{f.db.appendEvent=append;console.error=error;});console.error=()=>{};
  f.db.appendEvent=(world,event)=>{if(event.kind==='intent-controller-v2' && event.payload.phase==='completed')throw new Error('PRIVATE_WRITER_DETAIL');append(world,event);};
  for(let i=0;i<2000 && f.host.engine.programOf('h_A');i++)f.host.tickOnce();
  assert.equal(f.host.engine.programOf('h_A'),null);assert.equal(Object.values(f.host.intentHistoryOf('s_A').attempts)[0].phase,'started');
  f.host.drainInputs();f.host.saveSnapshot(true);f.db.appendEvent=append;
  const resumed=new WorldHost(f.db,factory,'admission-fixture',1e9,f.host.worldId);assert.equal(resumed.boot().from,'snapshot');
  const hash=resumed.engine.stateHash(),tick=resumed.engine.world.tick;
  assert.equal(resumed.reconcileIntentObservations(),1,'paused reconciliation publishes captured evidence without stepping');
  assert.equal(resumed.engine.stateHash(),hash);assert.equal(resumed.engine.world.tick,tick);
  assert.equal(Object.values(resumed.intentHistoryOf('s_A').attempts)[0].phase,'completed');
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,1,'reconciliation does not repeat the accepted choice');
  assert.equal(resumed.intentHistoryOf('s_A').intents[f.ref.intentId].status,'active','program completion is not purpose fulfilment');
  assert.equal(resumed.reconcileIntentObservations(),0,'repeated reconciliation does not duplicate a fact');
  const facts=f.db.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2');assert.deepEqual(facts.map(e=>e.payload.phase),['started','completed']);
  const raw=JSON.stringify(f.db.db.prepare('SELECT * FROM intent_observations_v2').all());
  resumed.saveSnapshot(true);const snapshotRestart=new WorldHost(f.db,factory,'admission-fixture',1e9,f.host.worldId);assert.equal(snapshotRestart.boot().from,'snapshot');
  f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
  const genesisRestart=new WorldHost(f.db,factory,'admission-fixture',1e9,f.host.worldId);assert.equal(genesisRestart.boot().from,'genesis');
  for(const h of [snapshotRestart,genesisRestart]) {assert.deepEqual(h.intentHistoryOf('s_A'),resumed.intentHistoryOf('s_A'));assert.equal(h.engine.stateHash(),hash);assert.equal(h.reconcileIntentObservations(),0);}
  assert.equal(JSON.stringify(f.db.db.prepare('SELECT * FROM intent_observations_v2').all()),raw);
  assert.equal(f.db.paidCost(),0);
  t.diagnostic(`native terminal tick=${facts[1].payload.observation.tick}; snapshot/genesis agree; no new decision/model`);
});

test('failed start publication retains its first actual frame and publishes it before a later terminal',async t=>{
  const f=await fixture(t),append=f.db.appendEvent.bind(f.db),error=console.error,messages:string[]=[];
  t.after(()=>{f.db.appendEvent=append;console.error=error;});console.error=(...args)=>messages.push(args.map(String).join(' '));
  f.db.appendEvent=(world,event)=>{if(event.kind==='intent-controller-v2')throw new Error('PRIVATE_WRITER_DETAIL');append(world,event);};
  for(let i=0;i<2000 && f.host.engine.programOf('h_A');i++)f.host.tickOnce();
  assert.equal(Object.values(f.host.intentHistoryOf('s_A').attempts)[0].phase,'accepted');
  const pending=f.db.db.prepare('SELECT phase,observation_tick,published_seq FROM intent_observations_v2 ORDER BY observation_tick').all();
  assert.deepEqual(pending.map(r=>r.phase),['started','completed']);assert.equal(pending[0].observation_tick,1);assert.ok(pending.every(r=>r.published_seq===null));
  assert.equal(messages.length,1);assert.ok(!messages[0].includes('PRIVATE_WRITER_DETAIL'));
  f.db.appendEvent=append;const hash=f.host.engine.stateHash();assert.equal(f.host.reconcileIntentObservations(),2);assert.equal(f.host.engine.stateHash(),hash);
  const facts=f.db.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2');assert.deepEqual(facts.map(e=>e.payload.phase),['started','completed']);
  assert.equal(facts[0].payload.observation.tick,1);assert.ok(facts[0].tick>1,'later publication preserves earlier physical evidence time');
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,1);assert.deepEqual(f.host.engine.runtime.violations,[]);
  for(const marker of ['PRIVATE_WORDS','PRIVATE_MEANING','PRIVATE_PRINCIPAL',f.ref.intentId])assert.ok(!JSON.stringify(f.db.events(f.host.worldId).map(publicEvent)).includes(marker));
});

test('append and publication marker are atomic to another SQLite reader, including a marker-write failure',async t=>{
  const f=await fixture(t),observer=new Db(f.db.path);t.after(()=>observer.close());
  f.db.db.exec(`CREATE TRIGGER reject_observation_publication BEFORE UPDATE OF published_seq ON intent_observations_v2 BEGIN SELECT RAISE(ABORT,'PRIVATE_MARKER_ERROR'); END`);
  const append=f.db.appendEvent.bind(f.db),error=console.error;t.after(()=>{f.db.appendEvent=append;console.error=error;});console.error=()=>{};
  let during=0;f.db.appendEvent=(world,event)=>{append(world,event);if(event.kind==='intent-controller-v2'){
    during++;assert.equal(observer.events(world).filter(e=>e.kind==='intent-controller-v2').length,0);
    assert.equal(observer.db.prepare('SELECT published_seq FROM intent_observations_v2').get()!.published_seq,null);
  }};
  f.host.tickOnce();assert.equal(during,1);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2').length,0);
  assert.equal(Object.values(f.host.intentHistoryOf('s_A').attempts)[0].phase,'accepted');
  assert.equal(f.db.db.prepare('SELECT published_seq FROM intent_observations_v2').get()!.published_seq,null);
  f.db.db.exec('DROP TRIGGER reject_observation_publication');let after=0;
  f.host.listeners.push({onApplied:e=>{if(e.kind==='intent-controller-v2'){
    after++;const row=observer.db.prepare('SELECT published_seq,published_hash FROM intent_observations_v2').get()!;
    assert.equal(row.published_seq,e.seq);assert.equal(row.published_hash,hashOf(e));assert.equal(observer.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2').length,1);
  }}});
  assert.equal(f.host.reconcileIntentObservations(),1);assert.equal(after,1);assert.equal(during,2);
});

test('missing capture is uncertainty even when a completed native body is idle after restart',async t=>{
  const f=await fixture(t);f.host.tickOnce();
  f.db.db.exec(`CREATE TRIGGER reject_terminal_capture BEFORE INSERT ON intent_observations_v2 WHEN NEW.phase='completed' BEGIN SELECT RAISE(ABORT,'PRIVATE_CAPTURE_ERROR'); END`);
  const error=console.error;t.after(()=>{console.error=error;});console.error=()=>{};
  for(let i=0;i<2000 && f.host.engine.programOf('h_A');i++)f.host.tickOnce();f.host.drainInputs();f.host.saveSnapshot(true);
  f.db.db.exec('DROP TRIGGER reject_terminal_capture');const restarted=new WorldHost(f.db,factory,'admission-fixture',1e9,f.host.worldId);restarted.boot();
  assert.equal(restarted.engine.programOf('h_A'),null);assert.equal(restarted.reconcileIntentObservations(),0);restarted.tickOnce();
  assert.equal(Object.values(restarted.intentHistoryOf('s_A').attempts)[0].phase,'started');
  assert.equal(f.db.db.prepare("SELECT COUNT(*) AS n FROM intent_observations_v2 WHERE phase='completed'").get()!.n,0);
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,1);
});

test('damaged pending evidence fails closed without rewriting rows, state, or exposing details',async t=>{
  for(const damage of ['body','admission-hash','scope'] as const)await t.test(damage,async child=>{
    const f=await fixture(child),append=f.db.appendEvent.bind(f.db),error=console.error,messages:string[]=[];
    child.after(()=>{f.db.appendEvent=append;console.error=error;});console.error=(...args)=>messages.push(args.map(String).join(' '));
    f.db.appendEvent=(world,event)=>{if(event.kind==='intent-controller-v2')throw new Error('fixture');append(world,event);};f.host.tickOnce();f.db.appendEvent=append;
    const row=f.db.db.prepare('SELECT * FROM intent_observations_v2').get()!;
    if(damage==='admission-hash')f.db.db.prepare('UPDATE intent_observations_v2 SET admission_hash=?').run('damaged');
    else {const p=JSON.parse(row.body as string);if(damage==='body')p.observation.action.id='PRIVATE_CORRUPTION';else p.worldId='foreign';f.db.db.prepare('UPDATE intent_observations_v2 SET body=?').run(JSON.stringify(p));}
    const raw=JSON.stringify(f.db.db.prepare('SELECT * FROM intent_observations_v2').all()),history=f.host.intentHistoryOf('s_A'),hash=f.host.engine.stateHash(),seq=f.host.seq;
    assert.equal(f.host.reconcileIntentObservations(),0);assert.equal(f.host.reconcileIntentObservations(),0);
    assert.equal(f.host.seq,seq);assert.equal(f.host.engine.stateHash(),hash);assert.deepEqual(f.host.intentHistoryOf('s_A'),history);
    assert.equal(JSON.stringify(f.db.db.prepare('SELECT * FROM intent_observations_v2').all()),raw);
    assert.ok(messages.every(m=>!m.includes('PRIVATE_CORRUPTION')));assert.equal(f.db.paidCost(),0);
  });
});

test('migration13 is empty, additive and idempotent over retained world/private history',async t=>{
  const f=await fixture(t),events=JSON.stringify(f.db.events(f.host.worldId)),snapshots=JSON.stringify(f.db.db.prepare('SELECT * FROM snapshots').all()),requests=JSON.stringify(f.db.db.prepare('SELECT * FROM intent_requests_v2').all());
  f.db.db.exec('DROP TABLE intent_observations_v2; DELETE FROM schema_migrations WHERE id=13');assert.deepEqual(migrate(f.db.db),[13]);assert.deepEqual(migrate(f.db.db),[]);
  assert.equal(f.db.db.prepare('SELECT COUNT(*) AS n FROM intent_observations_v2').get()!.n,0);assert.equal(JSON.stringify(f.db.events(f.host.worldId)),events);
  assert.equal(JSON.stringify(f.db.db.prepare('SELECT * FROM snapshots').all()),snapshots);assert.equal(JSON.stringify(f.db.db.prepare('SELECT * FROM intent_requests_v2').all()),requests);
});

test('22 actual replaced/current programs drain captured evidence in bounded 20 then 2 batches',async t=>{
  const f=await fixture(t),decision=f.db.events(f.host.worldId).find(e=>e.kind==='decision')!.payload;
  for(let i=0;i<21;i++)await accept(f.host,f.host.enqueueIntentDecision('brain:reflex',structuredClone(decision),f.ref,()=>true));
  const append=f.db.appendEvent.bind(f.db),error=console.error;t.after(()=>{f.db.appendEvent=append;console.error=error;});console.error=()=>{};
  f.db.appendEvent=(world,event)=>{if(event.kind==='intent-controller-v2')throw new Error('fixture');append(world,event);};f.host.tickOnce();f.db.appendEvent=append;
  assert.equal(f.db.db.prepare('SELECT COUNT(*) AS n FROM intent_observations_v2 WHERE published_seq IS NULL').get()!.n,22);
  const hash=f.host.engine.stateHash();assert.equal(f.host.reconcileIntentObservations(),20);assert.equal(f.host.reconcileIntentObservations(),2);assert.equal(f.host.reconcileIntentObservations(),0);assert.equal(f.host.engine.stateHash(),hash);
  const facts=f.db.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2');assert.equal(facts.length,22);assert.equal(facts.filter(e=>e.payload.phase==='interrupted').length,21);assert.equal(facts.filter(e=>e.payload.phase==='started').length,1);
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,22,'only the explicit fixture choices');assert.deepEqual(f.host.engine.runtime.violations,[]);
});

test('capture rejects another world, actor or program against the actual canonical admission',async t=>{
  const f=await fixture(t);f.host.tickOnce();const payload=f.db.events(f.host.worldId).find(e=>e.kind==='intent-controller-v2')!.payload as IntentControllerPayloadV2;
  const store=new IntentObservations(f.db,f.host.worldId),before=JSON.stringify(f.db.db.prepare('SELECT * FROM intent_observations_v2').all());
  for(const bad of [{...payload,worldId:'other'},{...payload,activityId:'forged'},{...payload,observation:{...payload.observation,actor:'other'}}] as IntentControllerPayloadV2[])assert.throws(()=>store.capture(bad),/world|association/);
  assert.equal(JSON.stringify(f.db.db.prepare('SELECT * FROM intent_observations_v2').all()),before);
});

test('a newer withdrawal prevents delayed start publication; captured evidence remains uncertain without reactivating will',async t=>{
  const f=await fixture(t),append=f.db.appendEvent.bind(f.db),error=console.error;t.after(()=>{f.db.appendEvent=append;console.error=error;});console.error=()=>{};
  f.db.appendEvent=(world,event)=>{if(event.kind==='intent-controller-v2')throw new Error('fixture');append(world,event);};f.host.tickOnce();
  const scope:IntentRequestScope={worldId:f.host.worldId,soulId:'s_A',source:{kind:'owner',ownerId:'owner',principalId:'PRIVATE_PRINCIPAL',channel:'web'},currentAuthority:()=>true};
  const publisher=new IntentPublisher(f.host,new IntentRequests(f.db));
  const r=await accept(f.host,publisher.receive(scope,{contract:INTENT_V2,requestId:'withdraw',op:'withdraw',edit:{intentId:f.ref.intentId,expectedVersion:f.ref.version}}));assert.ok(r.reservation.created);await accept(f.host,publisher.publish(scope,r.reservation));
  f.db.appendEvent=append;assert.equal(f.host.reconcileIntentObservations(),0);
  assert.equal(f.host.intentHistoryOf('s_A').intents[f.ref.intentId].status,'withdrawn');assert.equal(Object.values(f.host.intentHistoryOf('s_A').attempts)[0].phase,'accepted');
  assert.equal(f.db.db.prepare('SELECT published_seq FROM intent_observations_v2').get()!.published_seq,null);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2').length,0);
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,1,'uncertain history cannot reissue withdrawn work');
});

for(const phase of ['before-capture','after-capture','before-fact','after-fact','after-commit'] as const)
test(`real worker exit ${phase} of terminal observation preserves its exact durable boundary`,async t=>{
  const f=await fixture(t);f.host.tickOnce();
  const worker=new Worker(new URL('../test/fixtures/intent-observation-worker.ts',import.meta.url),{workerData:{path:f.db.path,phase},execArgv:[]});t.after(()=>worker.terminate());
  assert.equal(await new Promise<number>((resolve,reject)=>{worker.once('error',reject);worker.once('exit',resolve);}),26);
  const row=f.db.db.prepare("SELECT * FROM intent_observations_v2 WHERE phase='completed'").get();
  if(phase==='before-capture')assert.equal(row,undefined);else {assert.ok(row);assert.equal(row.published_seq!==null,phase==='after-commit');}
  const restarted=new WorldHost(f.db,factory,'admission-fixture',1e9,f.host.worldId);restarted.boot();
  if(phase!=='after-commit')assert.equal(Object.values(restarted.intentHistoryOf('s_A').attempts)[0].phase,'started');
  assert.equal(restarted.reconcileIntentObservations(),0,'future capture cannot be published before world time catches up');
  if(phase==='before-capture'){
    assert.equal(restarted.engine.programOf('h_A'),null,'worker checkpoint exposes completed physical state with no captured terminal');
    restarted.tickOnce();assert.equal(Object.values(restarted.intentHistoryOf('s_A').attempts)[0].phase,'started');
  }else {
    for(let i=0;i<2000 && Object.values(restarted.intentHistoryOf('s_A').attempts)[0].phase!=='completed';i++)restarted.tickOnce();
    assert.equal(Object.values(restarted.intentHistoryOf('s_A').attempts)[0].phase,'completed');
    const facts=f.db.events(f.host.worldId).filter(e=>e.kind==='intent-controller-v2');assert.deepEqual(facts.map(e=>e.payload.phase),['started','completed']);
    assert.equal(facts[1].payload.observation.tick,row!.observation_tick);
    const second=new WorldHost(f.db,factory,'admission-fixture',1e9,f.host.worldId);second.boot();assert.deepEqual(second.intentHistoryOf('s_A'),restarted.intentHistoryOf('s_A'));assert.equal(second.engine.stateHash(),restarted.engine.stateHash());
  }
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='decision').length,1);assert.deepEqual(restarted.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
});
