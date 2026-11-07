import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Db } from './db.ts';
import { migrate } from './migrations.ts';
import { LifecycleJournal, type LifecycleScope } from './lifecycle-journal.ts';
import type { LogEvent } from '@souls/protocol';
const requestId='lc_'+'a'.repeat(32),retireId='lc_'+'b'.repeat(32),scope={worldId:'world',soulId:'s_A',entityId:'h_A',owner:'owner'};
const input={name:'Alice',description:'PRIVATE_LIFECYCLE_DESCRIPTION',native:false};
const birth:LogEvent={seq:1,tick:0,kind:'birth',author:'soul:s_A',at:1,payload:{soulId:'s_A',entityId:'h_A',owner:'owner',name:input.name,description:input.description}};
function fixture(t:TestContext){const db=new Db(':memory:');t.after(()=>db.close());for(const id of ['owner','other'])db.upsertUser({id,role:'user',email:null,wallet:null});for(const id of ['world','elsewhere'])db.createWorld({id,schema:'storage-fixture',rules_version:'storage/1',dt:.05,seed:'fixture'});return {db,journal:new LifecycleJournal(db)};}
function accepted(t:TestContext){const f=fixture(t);f.journal.acceptCreate(scope,requestId,input,()=>true);return f;}

test('private owned-row/request acceptance is atomic, stable and uses current acceptance guard',t=>{
  const {db,journal}=fixture(t);let guarded=false;
  assert.throws(()=>journal.acceptCreate(scope,requestId,input,()=>false),/authority changed/);assert.equal(db.soul('s_A'),undefined);
  const op=journal.acceptCreate(scope,requestId,input,()=>{guarded=true;return true;});assert.equal(guarded,true);assert.equal(op.state,'pending');assert.equal(op.revision,1);assert.equal(db.soulsOf('owner').length,1);assert.equal(db.events('world').length,0);
  assert.deepEqual(journal.acceptCreate(scope,requestId,input,()=>true),op);assert.equal(db.soulsOf('owner').length,1);
  assert.throws(()=>journal.acceptCreate(scope,requestId,{...input,name:'Other'},()=>true),/identity conflict/);assert.deepEqual(journal.get(scope,requestId),op);
});

test('failed journal insertion rolls the actual owned-row write back',t=>{
  const {db,journal}=fixture(t);db.db.exec("CREATE TRIGGER reject_lifecycle BEFORE INSERT ON lifecycle_operations_v1 BEGIN SELECT RAISE(ABORT,'isolated journal refusal'); END");
  assert.throws(()=>journal.acceptCreate(scope,requestId,input,()=>true),/isolated journal refusal/);assert.equal(db.soul('s_A'),undefined);assert.deepEqual(journal.recover('world'),[]);
});

test('birth log record and private reference commit together; failed reference update retains pending request',t=>{
  const {db,journal}=accepted(t);db.db.exec("CREATE TRIGGER reject_reference BEFORE UPDATE ON lifecycle_operations_v1 WHEN NEW.state='recorded' BEGIN SELECT RAISE(ABORT,'isolated reference refusal'); END");
  assert.throws(()=>journal.record(scope,requestId,birth,()=>true),/isolated reference refusal/);assert.equal(db.events('world').length,0);assert.equal(journal.get(scope,requestId)!.state,'pending');
  db.db.exec('DROP TRIGGER reject_reference');const op=journal.record(scope,requestId,birth,()=>true);assert.equal(op.state,'recorded');assert.equal(op.fact!.seq,1);assert.equal(db.events('world').length,1);
  assert.deepEqual(journal.record(scope,requestId,birth,()=>true),op);assert.equal(db.events('world').length,1);
  assert.throws(()=>journal.record(scope,requestId,{...birth,at:2},()=>true),/retry conflict/);
  assert.throws(()=>journal.complete(scope,requestId,()=>false),/authority changed/);assert.equal(journal.get(scope,requestId)!.state,'recorded');
  assert.equal(journal.complete(scope,requestId,()=>true).revision,3);assert.deepEqual(journal.recover('world'),[]);
});

test('normal arrival refusal releases logical name/count atomically but retains private operation and no physical birth',t=>{
  const {db,journal}=accepted(t);assert.ok(db.soulByName('world','alice'));assert.equal(db.soulsOf('owner').length,1);
  const refused=journal.refuseArrival(scope,requestId,()=>true);assert.equal(refused.state,'refused');assert.equal(refused.fact,null);assert.equal(refused.revision,2);
  assert.equal(db.soulByName('world','alice'),undefined);assert.equal(db.soulsOf('owner').length,0);assert.equal(db.events('world').length,0);
  const next:LifecycleScope={...scope,soulId:'s_new',entityId:'h_new'};
  journal.acceptCreate(next,'lc_'+'c'.repeat(32),{...input,name:'alice'},()=>true);assert.equal(db.soulByName('world','Alice')!.id,'s_new');assert.notEqual(next.entityId,scope.entityId);
  assert.deepEqual(journal.get(scope,requestId),refused);assert.equal(journal.ownerPage('world','owner').operations.length,2);
});

test('refusal cannot rewrite a recorded birth; retired-row mutations cannot masquerade as unavailable arrival',t=>{
  const f=accepted(t);f.journal.record(scope,requestId,birth,()=>true);assert.throws(()=>f.journal.refuseArrival(scope,requestId,()=>true),/accepted fact/);assert.equal(f.db.soulsOf('owner').length,1);
  const g=fixture(t);g.journal.acceptCreate(scope,requestId,input,()=>true);g.db.retireSoul('s_A');assert.throws(()=>g.journal.refuseArrival(scope,requestId,()=>true),/retirement is not/);assert.equal(g.journal.get(scope,requestId)!.state,'pending');
});

test('retirement revocation and durable removal request are atomic; logical release is separate from completion',t=>{
  const {db,journal}=accepted(t);journal.record(scope,requestId,birth,()=>true);journal.complete(scope,requestId,()=>true);db.setSoulToken('s_A','fixture-hash');
  const retiring=journal.acceptRetire(scope,retireId,()=>true);assert.equal(retiring.state,'pending');assert.equal(db.soul('s_A')!.token_hash,null);assert.notEqual(db.soul('s_A')!.retired_at,null);
  assert.equal(db.soulsOf('owner').length,0);assert.equal(db.soulByName('world','alice'),undefined);assert.equal(journal.recover('world')[0].operation,'retire');
  assert.throws(()=>journal.complete(scope,retireId,()=>true),/physical fact missing/);
  const event:LogEvent={seq:2,tick:20,kind:'retire',author:'soul:s_A',at:2,payload:{soulId:'s_A',entityId:'h_A'}};
  journal.record(scope,retireId,event,()=>true);
  assert.throws(()=>journal.complete(scope,retireId,()=>true),/exact terminal checkpoint/);
  const checkpoint:LogEvent={seq:3,tick:90,kind:'rules',author:'world',at:3,payload:{checkpoint:'lifecycle-removal-confirmed'}};
  const completed=journal.complete(scope,retireId,()=>true,checkpoint);assert.equal(completed.state,'complete');assert.equal(completed.terminal!.seq,3);assert.equal(completed.terminal!.tick,90);assert.equal(db.events('world').length,3);
  const old=journal.get(scope,requestId)!;assert.equal(old.revision,4);assert.equal(old.retirementAccepted,true);assert.equal(old.terminal!.seq,1);assert.equal(old.name,'Alice');
});

test('pending creation cannot accept retirement; failed retiring insertion keeps authority and old receipt revision unchanged',t=>{
  const {db,journal}=accepted(t);assert.throws(()=>journal.acceptRetire(scope,retireId,()=>true),/not admitted/);
  assert.equal(db.soul('s_A')!.retired_at,null);assert.equal(journal.get(scope,requestId)!.revision,1);assert.equal(journal.ownerPage('world','owner').operations.length,1);
  journal.record(scope,requestId,birth,()=>true);journal.complete(scope,requestId,()=>true);db.setSoulToken('s_A','fixture-hash');const before=journal.get(scope,requestId);
  db.db.exec("CREATE TRIGGER reject_retire BEFORE INSERT ON lifecycle_operations_v1 WHEN NEW.operation='retire' BEGIN SELECT RAISE(ABORT,'isolated retirement refusal'); END");
  assert.throws(()=>journal.acceptRetire(scope,retireId,()=>true),/isolated retirement refusal/);assert.equal(db.soul('s_A')!.retired_at,null);assert.equal(db.soul('s_A')!.token_hash,'fixture-hash');assert.deepEqual(journal.get(scope,requestId),before);
});

test('private world/owner/body binding, fresh row authority and immutable event hash reject stale/tampered operations',t=>{
  const {db,journal}=accepted(t);
  for(const change of [{owner:'other'},{worldId:'elsewhere'},{entityId:'h_else'}])assert.equal(journal.get({...scope,...change},requestId),undefined);
  assert.throws(()=>journal.record(scope,requestId,{...birth,payload:{...birth.payload,owner:'other'}},()=>true),/does not match/);assert.equal(db.events('world').length,0);
  journal.record(scope,requestId,birth,()=>true);db.db.prepare("UPDATE events SET at=2 WHERE world_id='world' AND seq=1").run();assert.throws(()=>journal.recover('world'),/fact changed/);
  db.db.prepare("UPDATE souls SET owner='other' WHERE id='s_A'").run();assert.equal(journal.get(scope,requestId),undefined);assert.deepEqual(journal.ownerPage('world','owner').operations,[]);
});

test('bounded keyset pages handle tied timestamps without duplicates or foreign cursors',t=>{
  const {db,journal}=fixture(t);
  for(let i=0;i<25;i++)journal.acceptCreate({...scope,soulId:'s_'+i,entityId:'h_'+i},'lc_'+i.toString(16).padStart(32,'0'),{...input,name:'Person '+i},()=>true);
  db.db.exec('UPDATE lifecycle_operations_v1 SET requested_at=1');const first=journal.ownerPage('world','owner');assert.equal(first.operations.length,20);assert.ok(first.nextCursor);
  const second=journal.ownerPage('world','owner',first.nextCursor);assert.equal(second.operations.length,5);assert.equal(second.nextCursor,null);
  assert.equal(new Set([...first.operations,...second.operations].map(o=>o.requestId)).size,25);
  assert.throws(()=>journal.ownerPage('elsewhere','owner',first.nextCursor),/cursor not found/);assert.throws(()=>journal.ownerPage('world','other',first.nextCursor),/cursor not found/);assert.throws(()=>journal.ownerPage('world','owner','lc1_invalid'));
  assert.equal(journal.recover('world').length,20);assert.throws(()=>journal.recover('world',21),/page limit/);
});

test('acceptance guard evaluates current count and case-insensitive name under the same transaction',t=>{
  const {db,journal}=fixture(t);const guard=(name:string)=>()=>db.soulsOf('owner').length<2&&!db.soulByName('world',name);
  journal.acceptCreate(scope,requestId,input,guard('Alice'));
  assert.throws(()=>journal.acceptCreate({...scope,soulId:'s_duplicate',entityId:'h_duplicate'},retireId,{...input,name:'alice'},guard('alice')),/authority changed/);
  journal.acceptCreate({...scope,soulId:'s_B',entityId:'h_B'},retireId,{...input,name:'Bob'},guard('Bob'));
  assert.throws(()=>journal.acceptCreate({...scope,soulId:'s_C',entityId:'h_C'},'lc_'+'c'.repeat(32),{...input,name:'Carol'},guard('Carol')),/authority changed/);
  assert.equal(db.soulsOf('owner').length,2);assert.equal(db.soul('s_C'),undefined);
});

test('candidate migration is empty/idempotent and preserves pre12 rows without historical lifecycle backfill',t=>{
  const {db}=fixture(t);db.createSoul({id:'s_old',worldId:'world',owner:'owner',entityId:'h_old',name:'Old orphan',description:'legacy',native:false});const before=db.soul('s_old');
  db.db.exec('DROP TABLE lifecycle_operations_v1; DELETE FROM schema_migrations WHERE id=12');assert.deepEqual(migrate(db.db),[12]);assert.deepEqual(migrate(db.db),[]);
  assert.deepEqual(db.soul('s_old'),before);assert.deepEqual(new LifecycleJournal(db).recover('world'),[]);assert.equal(db.events('world').length,0);
});

for(const boundary of ['create-write','create-commit','event-write','event-commit','retire-write','retire-commit'])test(`real serialized process exit ${boundary} leaves a whole committed storage boundary`,t=>{
  const dir=mkdtempSync(join(tmpdir(),'eden-lifecycle-store-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'world.sqlite');
  const result=spawnSync(process.execPath,[new URL('../test/lifecycle-journal-exit.ts',import.meta.url).pathname,path,boundary],{encoding:'utf8',timeout:20_000});assert.equal(result.error,undefined);assert.equal(result.status,23,result.stderr);
  const db=new Db(path);t.after(()=>db.close());const journal=new LifecycleJournal(db),row=db.soul('s_A'),ops=journal.ownerPage('world','owner').operations,events=db.events('world');
  if(boundary==='create-write'){assert.equal(row,undefined);assert.equal(ops.length,0);assert.equal(events.length,0);}
  if(['create-commit','event-write'].includes(boundary)){assert.ok(row);assert.equal(ops.length,1);assert.equal(ops[0].state,'pending');assert.equal(events.length,0);assert.equal(journal.recover('world').length,1);}
  if(boundary==='event-commit'){assert.ok(row);assert.equal(ops[0].state,'recorded');assert.equal(events.length,1);assert.equal(journal.recover('world')[0].fact!.seq,1);}
  if(boundary==='retire-write'){assert.equal(row!.retired_at,null);assert.equal(row!.token_hash,'fixture-hash');assert.equal(ops.length,1);assert.deepEqual(journal.recover('world'),[]);}
  if(boundary==='retire-commit'){assert.notEqual(row!.retired_at,null);assert.equal(row!.token_hash,null);assert.equal(ops.length,2);assert.equal(journal.recover('world')[0].operation,'retire');assert.equal(events.length,1);}
  assert.equal(db.paidCost(),0);
});
