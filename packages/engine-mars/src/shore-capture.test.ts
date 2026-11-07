import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureRenderScene,parseRenderSceneCapture,hashOf,nativeShoreSceneV1Schema,decodeShoreAppearanceSourceV1,
  shoreContactV1Schema,boatStateV1Schema,boatPassengerV1Schema,SHORE_APPEARANCE_SOURCE_V1 } from '@souls/engine-contract';
import { decodeSceneCapturePublication,recordedTakeChunkSchema } from '../../protocol/src/index.ts';
import { nativeShoreFixture } from './shore-runtime.ts';
import { nativeBoatFixture } from './boat-runtime.ts';
import { nativeShoreCaptureFixture } from './shore-capture-fixture.ts';
import { sampleTake } from '../../../mars/viewer/engine/take/replay.ts';
import { takeIdOf } from '../../../mars/viewer/engine/take/recorder.ts';

test('registered native render projections detach and bind actual geometry/base; malformed capture and immutable source refuse',async()=>{
  for(const f of [await nativeShoreFixture(),await nativeBoatFixture()]){
    const rt=f.create(f.genesis('capture-read')),before=rt.stateHash(),scene=f.renderScene(),capture=captureRenderScene(f.rulesVersion,scene);
    assert.deepEqual(capture.body.shore!.physicalBase,rt.world.base);assert.deepEqual(capture.body.shore!.terrain,f.fixture.terrain);
    assert.deepEqual(capture.body.shore!.water,f.fixture.water);assert.deepEqual(parseRenderSceneCapture(capture),capture);
    scene.shore!.terrain.heightMetres[0][0]=99;assert.equal(f.renderScene().shore!.terrain.heightMetres[0][0],-1.5);assert.equal(rt.stateHash(),before);
    assert.throws(()=>captureRenderScene('wrong-rules',f.renderScene()),/rules versions/);
    for(const bad of [{...capture,body:{...capture.body,shore:{...capture.body.shore,owner:'PRIVATE'}}},
      {...capture,body:{...capture.body,shore:{...capture.body.shore,water:{...capture.body.shore!.water,datumY:NaN}}}},
      {...capture,body:{...capture.body,shore:{...capture.body.shore,physicalBase:{...capture.body.shore!.physicalBase,staticHash:'0'.repeat(64)}}}}])
      assert.throws(()=>parseRenderSceneCapture(bad));
    if(capture.body.shore!.boat){
      const shore=capture.body.shore!,boat=shore.boat!;
      assert.equal(boat.appearance.source.sha256,SHORE_APPEARANCE_SOURCE_V1.sha256);
      const design=decodeShoreAppearanceSourceV1(boat.appearance) as any;assert.equal(design.boat.id,boat.layout.boatId);
      for(const patch of [{utf8:boat.appearance.utf8+' '},{utf8:'not JSON'},{source:{...boat.appearance.source,sha256:'0'.repeat(64)}},{owner:'PRIVATE'}])
        assert.equal(nativeShoreSceneV1Schema.safeParse({...shore,boat:{...boat,appearance:{...boat.appearance,...patch}}}).success,false);
      assert.equal(nativeShoreSceneV1Schema.safeParse({...shore,boat:{...boat,layout:{...boat.layout,boatId:'foreign'}}}).success,false);
    }
  }
});
test('new actual captured shore/boat takes preserve legacy physical journey, resolve exact authored bytes and replay through both snapshot and genesis without models',async()=>{
  const out=await nativeShoreCaptureFixture();
  for(const j of out.journeys){
    const {recording:r}=j,f=j.kind==='shore'?await nativeShoreFixture():await nativeBoatFixture();
    const legacy=JSON.parse(readFileSync(new URL('../../../apps/server/test/fixtures/native-'+j.kind+'/journey.v1.json',import.meta.url),'utf8'));
    assert.equal(r.finalStateHash,legacy.finalStateHash);assert.deepEqual(r.inputs,legacy.inputs);assert.deepEqual(r.trace,legacy.trace);
    const {id,renderSceneRef,...body}=r.take,{id:oldId,renderSceneRef:oldRef,...oldBody}=legacy.take;
    assert.deepEqual(body,oldBody);assert.equal(oldRef,undefined);assert.notEqual(id,oldId);assert.equal(takeIdOf(r.take),id);
    recordedTakeChunkSchema.parse(j.chunk);const capture=decodeSceneCapturePublication(j.capture);assert.equal(capture.worldId,j.worldId);
    assert.deepEqual(renderSceneRef,capture.ref);assert.deepEqual(capture.body.shore!.physicalBase,r.physicalBase);
    if(j.kind==='boat')assert.deepEqual(capture.body.shore!.boat!.layout,(r as any).layout);
    const initial=f.genesis(j.kind==='shore'?'public-native-shore-1':'public-native-boat-1');
    if(j.kind==='shore')initial.entities['shore-resident']=f.human('shore-resident',2,-6);
    else {initial.entities.pilot=f.human('pilot',4,5);initial.entities.guest=f.human('guest',6,5);}
    let rt=f.create(initial),cursor=0;const halfway=Math.floor(r.take.ticks/2);
    function to(tick:number){while(rt.tick<tick){while(cursor<r.inputs.length&&r.inputs[cursor].tick===rt.tick){const input=r.inputs[cursor++];rt.submit(input.verb,input.params,{id:input.id});}rt.step();}}
    to(halfway);const snap=rt.snapshot(),halfHash=rt.stateHash();rt=f.restore(snap);assert.equal(rt.stateHash(),halfHash);
    assert.deepEqual(captureRenderScene(f.rulesVersion,f.renderScene()).ref,capture.ref);to(r.take.ticks);assert.equal(rt.stateHash(),r.finalStateHash);assert.deepEqual(rt.violations,[]);
    const before=hashOf(j),activities=new Set<string>(),contactModes=new Set<string>(),phases=new Set<string>();
    for(let tick=0;tick<=r.take.ticks;tick++){
      const frame=sampleTake(r.take,tick*r.take.dt);
      for(const e of Object.values(frame.entities)){
        if(e.activity)activities.add(e.activity);if(e.state.shore)contactModes.add(shoreContactV1Schema.parse(e.state.shore).mode);
        if(e.state.boat)phases.add(boatStateV1Schema.parse(e.state.boat).phase);
        if(e.state.boatPassenger)phases.add(boatPassengerV1Schema.parse(e.state.boatPassenger).phase);
      }
    }
    if(j.kind==='shore'){assert.ok(activities.has('swim'));assert.ok(activities.has('tread'));assert.ok(activities.has('wade'));assert.deepEqual([...contactModes].sort(),['bed','buoyant']);}
    else {assert.ok(phases.has('boarding'));assert.ok(phases.has('seated'));assert.ok(phases.has('underway'));assert.ok(phases.has('leaving'));}
    assert.equal(hashOf(j),before);assert.equal(r.paidSpendUSD,0);
  }
});
