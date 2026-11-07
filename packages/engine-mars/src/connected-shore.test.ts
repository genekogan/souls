import test from 'node:test';
import assert from 'node:assert/strict';
import {connectedCommonsShoreFixture} from './connected-shore.ts';
import {nativeShoreFixture} from './shore-runtime.ts';
import {SHORE_POLICY} from '../../../mars/viewer/engine/locomotion/shore.ts';
import {TakeRecorder} from '../../../mars/viewer/engine/take/recorder.ts';
import {sampleTake} from '../../../mars/viewer/engine/take/replay.ts';
import {captureRenderScene,hashOf} from '@souls/engine-contract';

test('fresh connection preserves original commons and transformed reviewed shore depth, with a real shared supported disc',async()=>{
  const f=await connectedCommonsShoreFixture(),old=await nativeShoreFixture();
  assert.equal(f.geometry.sweep([-29,0],[-29,0],SHORE_POLICY.radius,SHORE_POLICY.maxGrade).ok,true);
  for(const [x,z] of [[2,-6],[-8,-6],[16,0]]){
    const p=old.geometry.point([x,z])!,q=f.geometry.point([x-46,z])!;
    assert.deepEqual(q.point,[p.point[0]-46,p.point[1]-2,p.point[2]]);assert.equal(q.depth,p.depth);if(x<16)assert.ok(q.normal.every((v,i)=>Math.abs(v-p.normal[i])<1e-12));else assert.deepEqual(q.normal,[0,1,0],'new flat shoulder changes the top edge normal intentionally');
  }
  const w=f.genesis();assert.deepEqual(w.entities['commons-platform'].pose.p,[9,0,-1.8]);assert.deepEqual(f.scene.surfaces.find(s=>s.id==='commons-deck')?.y,.24);
  assert.equal(f.geometry.point([-29,0])!.point[1],0);
  assert.throws(()=>f.create(old.genesis()),/physical base differs/);assert.throws(()=>old.create(w),/physical base\/rules differ/);
});

test('one actual native action walks from commons, wades, swims, becomes buoyant at rest and returns through the same gate',async()=>{
  const f=await connectedCommonsShoreFixture(),w=f.genesis('actual-connected');w.entities.h=f.human('h',14,4);const rt=f.create(w);
  const capture=captureRenderScene(f.rulesVersion,f.renderScene()),recorder=new TakeRecorder(rt,{rulesVersion:f.rulesVersion,renderSceneRef:capture.ref});
  const a=rt.submit('commons_shore_travel',{actor:'h',x:-54,z:-6});assert.equal(a.status,'executing',JSON.stringify(a));
  const modes=new Set<string>(),copies:ReturnType<typeof f.create>[]=[],seen=new Set<string>();
  let maxStep=0,previous=[...rt.world.entities.h.pose.p];
  for(let i=0;i<2400&&rt.isActive(a.id);i++){
    rt.step();for(const c of copies){c.step();assert.equal(c.stateHash(),rt.stateHash());assert.equal(hashOf(c.snapshot().data),hashOf(rt.snapshot().data));}
    const e=rt.world.entities.h;modes.add(e.human!.activity);
    maxStep=Math.max(maxStep,Math.hypot(...e.pose.p.map((v,i)=>v-previous[i])));previous=[...e.pose.p];
    if(['walk','wade','swim'].includes(e.human!.activity)&&!seen.has(e.human!.activity)){seen.add(e.human!.activity);const copy=f.restore(JSON.parse(JSON.stringify(rt.snapshot())));assert.equal(copy.stateHash(),rt.stateHash());copies.push(copy);}
  }
  assert.equal(a.status,'completed',JSON.stringify(a));assert.ok(modes.has('walk'));assert.ok(modes.has('wade'));assert.ok(modes.has('swim'));assert.ok(maxStep<=.071);
  assert.deepEqual(rt.world.entities.h.pose.p,[-54,-3.2,-6]);assert.equal(rt.world.entities.h.human!.activity,'tread');
  assert.equal(rt.submit('walk_to',{actor:'h',x:9,z:5}).diagnostic?.code,'connected.use-shore-controller');
  const supported=[...rt.world.entities.h.pose.p];assert.equal(rt.submit('face',{actor:'h',target:{point:[9,5]}}).diagnostic?.code,'connected.unqualified-shore-action');assert.deepEqual(rt.world.entities.h.pose.p,supported);assert.equal(rt.world.entities.h.human!.activity,'tread');
  const back=rt.submit('commons_shore_travel',{actor:'h',x:9,z:5});assert.equal(back.status,'executing',JSON.stringify(back));
  for(let i=0;i<2200&&rt.isActive(back.id);i++)rt.step();assert.equal(back.status,'completed',JSON.stringify(back));
  assert.deepEqual(rt.world.entities.h.pose.p,[9,0,5]);assert.equal(rt.world.entities.h.human!.shore,undefined);assert.deepEqual(rt.violations,[]);
  const take=recorder.finish();assert.equal(take.renderSceneRef!.hash,capture.ref.hash);assert.equal(take.finalStateHash,rt.stateHash());
  assert.deepEqual(sampleTake(take,rt.tick*take.dt).entities.h.p,[9,0,5]);assert.ok(hashOf(take));
});

test('deep-water cancellation releases the composite and children while retaining actual buoyant support; recovery and return need no models',async()=>{
  const f=await connectedCommonsShoreFixture(),w=f.genesis('cancel-connected');w.entities.h=f.human('h',-29,0);const rt=f.create(w);
  const a=rt.submit('commons_shore_travel',{actor:'h',x:-54,z:-6});assert.equal(a.status,'executing');
  for(let i=0;i<1000&&rt.world.entities.h.human!.activity!=='swim';i++)rt.step();assert.equal(rt.world.entities.h.human!.activity,'swim');
  const at=[...rt.world.entities.h.pose.p],head=f.restore(JSON.parse(JSON.stringify(rt.snapshot())));assert.equal(head.stateHash(),rt.stateHash());assert.equal(hashOf(head.snapshot().data),hashOf(rt.snapshot().data));
  assert.equal(rt.cancel(a.id).status,'cancelled');assert.equal(head.cancel(a.id).status,'cancelled');
  assert.deepEqual(rt.world.entities.h.pose.p,at);assert.equal(rt.world.entities.h.human!.activity,'tread');assert.deepEqual(rt.holder('actor:h'),[]);
  for(let i=0;i<40;i++){rt.step();head.step();assert.equal(head.stateHash(),rt.stateHash());assert.equal(hashOf(head.snapshot().data),hashOf(rt.snapshot().data));assert.deepEqual(rt.world.entities.h.pose.p,at);}
  const back=rt.submit('commons_shore_travel',{actor:'h',x:9,z:5}),other=head.submit('commons_shore_travel',{actor:'h',x:9,z:5});assert.equal(back.id,other.id);assert.equal(back.status,'executing');
  for(let i=0;i<2200&&rt.isActive(back.id);i++){rt.step();head.step();assert.equal(head.stateHash(),rt.stateHash());assert.equal(hashOf(head.snapshot().data),hashOf(rt.snapshot().data));}
  assert.equal(back.status,'completed');assert.deepEqual(rt.world.entities.h.pose.p,[9,0,5]);assert.deepEqual(rt.violations,[]);assert.deepEqual(head.violations,[]);
});

test('wrong domain, unsupported target and duplicate claim refuse without movement or releasing an existing native owner',async()=>{
  const f=await connectedCommonsShoreFixture(),w=f.genesis('connected-refusals');w.entities.h=f.human('h',14,4);const rt=f.create(w),p=[...w.entities.h.pose.p];
  for(const request of [{x:-80,z:0},{x:-54,z:-12},{x:-54,z:0,level:1}]){const a=rt.submit('commons_shore_travel',{actor:'h',...request});assert.equal(a.status,'failed');assert.deepEqual(rt.world.entities.h.pose.p,p);}
  assert.equal(rt.submit('walk_to',{actor:'h',x:-54,z:0}).diagnostic?.code,'connected.use-shore-controller');
  const active=rt.submit('commons_shore_travel',{actor:'h',x:-54,z:-6});assert.equal(active.status,'executing');
  const collision=rt.submit('commons_shore_travel',{actor:'h',x:-54,z:-5});assert.equal(collision.status,'failed');assert.equal(collision.diagnostic?.code,'reservation.conflict');assert.ok(rt.isActive(active.id));
  rt.cancel(active.id);assert.deepEqual(rt.violations,[]);
});

test('actual native pickup retains the held cup and blocks a shore direction before any movement',async()=>{
  const f=await connectedCommonsShoreFixture(),w=f.genesis('actual-held-cup');w.entities.h=f.human('h',14,4);
  w.entities.cup={id:'cup',def:'cup',kind:'component',pose:{p:[11.6,.75,-5.2],yaw:0},support:{kind:'resting-on',on:'commons-table',slot:'r0c0'},provenance:{origin:'test-fixture',confidence:'hypothetical'}};
  const rt=f.create(w),take=rt.submit('take_item',{actor:'h',item:'cup',hand:'left'});assert.equal(take.status,'executing',JSON.stringify(take));
  for(let i=0;i<1000&&rt.isActive(take.id);i++)rt.step();assert.equal(take.status,'completed',JSON.stringify(take));
  assert.deepEqual(rt.world.entities.cup.support,{kind:'in-hand',by:'h',hand:'left'});const pose=[...rt.world.entities.h.pose.p],before=rt.stateHash();
  const no=rt.submit('commons_shore_travel',{actor:'h',x:-54,z:-6});assert.equal(no.status,'failed');assert.equal(no.diagnostic?.code,'connected.occupied-body');
  assert.deepEqual(rt.world.entities.h.pose.p,pose);assert.deepEqual(rt.world.entities.cup.support,{kind:'in-hand',by:'h',hand:'left'});assert.equal(rt.stateHash(),before);assert.deepEqual(rt.violations,[]);
});

test('detached geometry readouts cannot change the admitted physical base or captured terrain',async()=>{
  const f=await connectedCommonsShoreFixture(),capture=captureRenderScene(f.rulesVersion,f.renderScene()),w=f.genesis();
  f.terrain.heightMetres[0][0]=999;f.water.datumY=99;f.scene.bounds[0]=-999;
  assert.equal(captureRenderScene(f.rulesVersion,f.renderScene()).ref.hash,capture.ref.hash);assert.equal(f.create(w).world.base.staticHash,w.base.staticHash);
  assert.equal(f.geometry.point([-54,-6])!.point[1],-3.5);
});
