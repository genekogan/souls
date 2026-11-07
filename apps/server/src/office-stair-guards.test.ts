import test from 'node:test';import assert from 'node:assert/strict';
import {officeStairGuardsDeclarationV1Schema,captureRenderScene,parseRenderSceneCapture} from '@souls/engine-contract';
import {kernelHash} from '@souls/kernel';import {fixture,accept,factory} from '../test/native-owner-fixture.ts';import {WorldHost} from './world.ts';
import {officeStairGuardBoxes,OFFICE_STAIR_GUARD_VERSION} from '../../../mars/viewer/lib/office-stair-guards.ts';
const declaration=officeStairGuardsDeclarationV1Schema.parse({version:OFFICE_STAIR_GUARD_VERSION,guards:officeStairGuardBoxes()});
void test('office guard fact is explicit, exact, captured, resumable and idempotent; absent old captures keep their hash',async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 const e=f.host.engine,beforeSnapshot=e.snapshot(),old=captureRenderScene(e.rulesVersion,e.renderScene!()),oldBytes=JSON.stringify(old),initialHash=e.stateHash();
 assert.equal(e.officeStairGuardsV1!(),undefined);assert.equal('officeStairGuardsV1' in e.world,false);assert.equal('officeStairGuardsV1' in beforeSnapshot,false);
 for(let i=0;i<25;i++)f.host.tickOnce();const prior=e.stateHash();f.host.saveSnapshot(true);
 assert.deepEqual(await accept(f.host,f.host.installOfficeStairGuardsV1(declaration)),{installed:true});assert.notEqual(e.stateHash(),prior);
 const fact=e.officeStairGuardsV1!()!;assert.equal(fact.acceptedAtTick,25);assert.deepEqual(fact.guards,declaration.guards);
 const captured=captureRenderScene(e.rulesVersion,e.renderScene!());assert.deepEqual((captured.body.scene as Record<string,unknown>).officeStairGuards,fact);assert.notEqual(captured.ref.hash,old.ref.hash);
 assert.equal(JSON.stringify(parseRenderSceneCapture(old)),oldBytes);assert.equal((old.body.scene as Record<string,unknown>).officeStairGuards,undefined);
 const seq=f.host.seq,hash=e.stateHash(),physical=e.physicalHash(),kernel=kernelHash(f.host.kernel);assert.deepEqual(await accept(f.host,f.host.installOfficeStairGuardsV1(declaration)),{installed:false});assert.equal(f.host.seq,seq);assert.equal(e.stateHash(),hash);assert.equal(f.db.events(f.host.worldId).filter(x=>x.payload?.officeStairGuardsV1).length,1);
 f.host.saveSnapshot(true);
 for(const mode of ['snapshot','genesis']){
  if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
  const h=new WorldHost(f.db,f.host.factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});try{assert.equal(h.boot().from,mode);assert.equal(h.seq,seq);assert.equal(h.engine.stateHash(),hash);assert.equal(h.engine.physicalHash(),physical);assert.equal(kernelHash(h.kernel),kernel);assert.deepEqual(h.engine.officeStairGuardsV1!(),fact);assert.equal(captureRenderScene(h.engine.rulesVersion,h.engine.renderScene!()).ref.hash,captured.ref.hash);assert.deepEqual(await accept(h,h.installOfficeStairGuardsV1(declaration)),{installed:false});assert.equal(h.seq,seq);}finally{h.stop();}
 }
 assert.equal(factory.restore(beforeSnapshot).stateHash(),initialHash,'absent-field snapshots retain their original hash');assert.equal(f.db.paidCost(),0);
});
void test('guard revision rejects nonfinite, changed height, missing/extra/reordered bands and timestamp injection before admission',()=>{
 assert.equal(officeStairGuardsDeclarationV1Schema.safeParse(declaration).success,true);
 const changed=structuredClone(declaration);changed.guards[0].max[1]=99;
 const nan=structuredClone(declaration);nan.guards[0].min[0]=NaN;
 for(const bad of [changed,nan,{...declaration,acceptedAtTick:1},{...declaration,version:'office-stair-guards/2'},{...declaration,guards:declaration.guards.slice(1)},{...declaration,guards:[...declaration.guards,declaration.guards[0]]},{...declaration,guards:[...declaration.guards].reverse()}])assert.equal(officeStairGuardsDeclarationV1Schema.safeParse(bad).success,false);
});
