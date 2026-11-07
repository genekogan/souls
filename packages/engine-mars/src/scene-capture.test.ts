import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureRenderScene,hashOf,parseRenderSceneCapture} from '@souls/engine-contract';
import {marsFactory,GREEN_FIELD_WORLD,LITTLE_MARTIANS_WORLD} from './engine.ts';
import {takeIdOf} from '../../../mars/viewer/engine/take/recorder.ts';
import {sampleTake} from '../../../mars/viewer/engine/take/replay.ts';
import type {Take} from '../../../mars/viewer/engine/take/types.ts';

test('actual native render bases bind content-addressed takes without changing state/checkpoints on read',async()=>{
  for(const cfg of [undefined,GREEN_FIELD_WORLD,LITTLE_MARTIANS_WORLD]) {
    const factory=await marsFactory(cfg),e=factory.create(factory.genesis('scene-proof'));
    e.spawnHuman({id:'a',label:cfg===LITTLE_MARTIANS_WORLD?'Verdelis':'Alice',soul:'s_a'});
    const capture=captureRenderScene(e.rulesVersion,e.renderScene!()),before=e.snapshot(),physical=e.physicalHash();
    assert.deepEqual(e.takeScene!(capture.ref.hash),capture);
    const detached=e.takeScene!(capture.ref.hash)!;detached.body.scene=null;
    assert.deepEqual(e.takeScene!(capture.ref.hash),capture);assert.deepEqual(e.snapshot(),before);assert.equal(e.physicalHash(),physical);
    e.perform({actor:'a',label:'rest',steps:[{verb:'rest',params:{seconds:1}}]});
    for(let i=0;i<45;i++)e.step();
    for(const chunk of e.takeChunks!(-1)) {
      const take=chunk.take as Take;
      assert.deepEqual(take.renderSceneRef,capture.ref);assert.equal(takeIdOf(take),take.id);
      assert.equal(hashOf(take.finalState),take.finalStateHash);
      assert.ok(sampleTake(take,take.ticks*take.dt).entities.a);
    }
    const restored=factory.restore(e.snapshot());for(let i=0;i<20;i++)restored.step();
    const after=restored.takeChunks!(-1).at(-1)!.take as Take;
    assert.deepEqual(after.renderSceneRef,capture.ref);assert.equal(takeIdOf(after),after.id);
    assert.deepEqual(restored.runtime.violations,[]);
  }
});

test('real camp adoption seals the previous partial segment and preserves its old scene',async()=>{
  const f=await marsFactory(),e=f.create(f.genesis('scene-adoption'));
  e.spawnHuman({id:'a',label:'Alice',soul:'s_a'});for(let i=0;i<7;i++)e.step();
  const old=captureRenderScene(e.rulesVersion,e.renderScene!());assert.ok(e.isQuiet!());
  e.adoptCamp!();const current=captureRenderScene(e.rulesVersion,e.renderScene!());
  assert.notEqual(current.ref.hash,old.ref.hash);
  const prior=e.takeChunks!(-1)[0];assert.equal(prior.fromTick,0);assert.equal(prior.toTick,7);
  assert.deepEqual((prior.take as Take).renderSceneRef,old.ref);assert.equal(takeIdOf(prior.take as Take),(prior.take as Take).id);
  assert.deepEqual(e.takeScene!(old.ref.hash),old);
  assert.notEqual((prior.take as Take).finalState.base.campus,e.world.base.campus);
  for(let i=0;i<20;i++)e.step();
  const next=e.takeChunks!(-1)[1];assert.equal(next.fromTick,7);assert.equal(next.toTick,27);
  assert.deepEqual((next.take as Take).renderSceneRef,current.ref);assert.deepEqual(e.runtime.violations,[]);
});

test('clock changes split native recording, no-op settings do not, and hot captures remain bounded',async()=>{
  const f=await marsFactory(GREEN_FIELD_WORLD),e=f.create(f.genesis('clock-captures'));
  for(let i=0;i<3;i++)e.step();const old=captureRenderScene(e.rulesVersion,e.renderScene!());
  e.configureClock!({origin:0,dayTicks:72000});const first=e.takeChunks!(-1)[0];
  assert.equal(first.toTick,3);assert.deepEqual((first.take as Take).renderSceneRef,old.ref);
  e.configureClock!({origin:0,dayTicks:72000});assert.equal(e.takeChunks!(-1).length,1);
  for(let n=0;n<15;n++){e.step();e.configureClock!({origin:n+1,dayTicks:72000});}
  assert.equal(e.takeChunks!(-1).length,12);assert.equal(e.takeScene!(old.ref.hash),undefined);
  for(const chunk of e.takeChunks!(-1))assert.ok(e.takeScene!((chunk.take as Take).renderSceneRef!.hash));
  const clock=e.renderScene!().clock!;clock.dayTicks=1;assert.equal(e.renderScene!().clock!.dayTicks,72000);
});

test('zero-tick clock boundaries detach old recorders and invalid clocks leave recording intact',async()=>{
  const f=await marsFactory(GREEN_FIELD_WORLD),e=f.create(f.genesis('clock-zero'));
  const observers=(e as any).rt.observers.length;
  for(let origin=0;origin<5;origin++)e.configureClock!({origin,dayTicks:72000});
  assert.equal((e as any).rt.observers.length,observers);assert.equal(e.takeChunks!(-1).length,0);
  const before=e.snapshot();assert.throws(()=>e.configureClock!({origin:-1,dayTicks:0}),/invalid render clock/);assert.deepEqual(e.snapshot(),before);
  for(let i=0;i<20;i++)e.step();assert.equal(e.takeChunks!(-1).length,1);assert.equal((e as any).rt.observers.length,observers);
});

test('render capture codec rejects tampering, unknown top-level claims, invalid JSON numbers and oversized bodies',()=>{
  const capture=captureRenderScene('fixture/1',{scene:{bounds:[0,0,1,1]}});
  assert.deepEqual(parseRenderSceneCapture(JSON.parse(JSON.stringify(capture))),capture);
  assert.throws(()=>parseRenderSceneCapture({...capture,body:{scene:null}}),/hash mismatch/);
  assert.throws(()=>captureRenderScene('fixture/1',{scene:null,owner:'PRIVATE'} as any));
  assert.throws(()=>captureRenderScene('fixture/1',{scene:{x:NaN}}),/non-finite/);
  assert.throws(()=>captureRenderScene('fixture/1',{scene:{payload:'x'.repeat(1024*1024)}}),/1 MiB/);
});

test('canonical dayConfig customs do not enter the public render clock or poison recording',async()=>{
  const f=await marsFactory(GREEN_FIELD_WORLD),e=f.create(f.genesis('living-clock'));
  const dayConfig={origin:0,dayTicks:72000,customs:['SYNTHETIC_WORLD_CUSTOM_MARKER']};
  e.configureClock!(dayConfig);
  const before=e.stateHash(),snapshot=e.snapshot(),capture=captureRenderScene(e.rulesVersion,e.renderScene!());
  assert.deepEqual(capture.body.clock,{origin:0,dayTicks:72000});assert.ok(!JSON.stringify(capture).includes('SYNTHETIC_WORLD_CUSTOM_MARKER'));
  assert.deepEqual((snapshot as any).cfg.clock,dayConfig,'canonical configuration remains intact');assert.equal(e.stateHash(),before);
  const restored=f.restore(snapshot);assert.equal(restored.stateHash(),before);assert.deepEqual(captureRenderScene(restored.rulesVersion,restored.renderScene!()),capture);
  for(let i=0;i<20;i++)restored.step();const take=restored.takeChunks!(-1)[0].take as Take;
  assert.deepEqual(take.renderSceneRef,capture.ref);assert.equal(takeIdOf(take),take.id);assert.deepEqual(restored.runtime.violations,[]);
});
