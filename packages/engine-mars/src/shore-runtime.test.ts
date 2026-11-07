import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeShoreFixture } from './shore-runtime.ts';
import { TakeRecorder } from '../../../mars/viewer/engine/take/recorder.ts';
import { sampleTake } from '../../../mars/viewer/engine/take/replay.ts';
import { hashOf } from '@souls/engine-contract';
import { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import { createRegistry } from '../../../mars/viewer/engine/api/registry.ts';
import { SHORE_POLICY } from '../../../mars/viewer/engine/locomotion/shore.ts';

async function setup(x=2,z=-6) {
  const f=await nativeShoreFixture(),w=f.genesis('shore-proof');w.entities.h=f.human('h',x,z);
  return {f,rt:f.create(w)};
}
function until(rt:Runtime,id:string,limit=900) {
  for(let i=0;i<limit&&rt.isActive(id);i++)rt.step();
  assert.equal(rt.records.get(id)!.status,'completed',JSON.stringify(rt.records.get(id)));
}

test('actual native slope → wade → swim → tread → bank is continuous, finite and recorded',async()=>{
  const {f,rt}=await setup();const recorder=new TakeRecorder(rt,{rulesVersion:f.rulesVersion});
  const frames: {tick:number;p:number[];activity:string;shore:unknown}[]=[];
  const start=rt.submit('shore_travel',{actor:'h',x:-8,z:-6});assert.equal(start.status,'executing');
  const activities=new Set<string>();let maxStep=0,previous=[...rt.world.entities.h.pose.p];
  for(let i=0;i<600&&rt.isActive(start.id);i++){
    rt.step();const e=rt.world.entities.h;activities.add(e.human!.activity);
    maxStep=Math.max(maxStep,Math.hypot(...e.pose.p.map((v,k)=>v-previous[k])));previous=[...e.pose.p];
    frames.push({tick:rt.tick,p:[...e.pose.p],activity:e.human!.activity,shore:structuredClone(e.human!.shore)});
  }
  assert.equal(start.status,'completed');assert.deepEqual(rt.world.entities.h.pose.p,[-8,-1.2,-6]);
  assert.deepEqual([...activities].sort(),['idle','swim','tread','wade','walk']);assert.ok(maxStep<=.04500001);
  assert.equal(rt.world.entities.h.human!.shore!.depthMetres,1.5);
  assert.equal(rt.world.entities.h.human!.shore!.submergedHeightMetres,1.2);
  const t=rt.submit('shore_tread',{actor:'h',ticks:40});until(rt,t.id);
  assert.equal(rt.world.entities.h.human!.activity,'tread');
  const back=rt.submit('shore_travel',{actor:'h',x:4,z:-6});until(rt,back.id);
  assert.deepEqual(rt.world.entities.h.pose.p,[4,.52,-6]);assert.equal(rt.world.entities.h.human!.shore!.depthMetres,0);
  assert.equal(rt.world.entities.h.human!.activity,'idle');assert.deepEqual(rt.violations,[]);
  const take=recorder.finish(),before=rt.stateHash(),address=hashOf(take);
  for(const frame of frames){const sample=sampleTake(take,frame.tick*take.dt).entities.h;
    assert.equal(sample.activity,frame.activity);assert.deepEqual(sample.state.shore,frame.shore);
    for(let k=0;k<3;k++)assert.ok(Math.abs(sample.p[k]-frame.p[k])<=.0045001);}
  assert.equal(rt.stateHash(),before);assert.equal(hashOf(take),address);
  assert.equal(take.finalStateHash,rt.stateHash());
});

test('walking, wading, swimming and treading restore the actual native graph tick for tick',async()=>{
  const {f,rt}=await setup();const action=rt.submit('shore_travel',{actor:'h',x:-8,z:-6});
  const copies:Runtime[]=[];const captured=new Set<string>();
  while(rt.isActive(action.id)){
    rt.step();for(const copy of copies){copy.step();assert.equal(copy.stateHash(),rt.stateHash());}
    const activity=rt.world.entities.h.human!.activity;
    if(['walk','wade','swim'].includes(activity)&&!captured.has(activity)){
      captured.add(activity);const copy=f.restore(JSON.parse(JSON.stringify(rt.snapshot())));assert.equal(copy.stateHash(),rt.stateHash());copies.push(copy);
    }
  }
  assert.deepEqual([...captured].sort(),['swim','wade','walk']);
  const tread=rt.submit('shore_tread',{actor:'h',ticks:20});rt.step();const copy=f.restore(JSON.parse(JSON.stringify(rt.snapshot())));
  while(rt.isActive(tread.id)){rt.step();copy.step();assert.equal(copy.stateHash(),rt.stateHash());}
  assert.equal(copy.records.get(tread.id)!.status,'completed');assert.deepEqual(rt.violations,[]);assert.deepEqual(copy.violations,[]);
});

test('deep-water interruption releases ownership without snapping, idling or losing buoyancy',async()=>{
  const {rt}=await setup();const a=rt.submit('shore_travel',{actor:'h',x:-8,z:-6});
  while(rt.world.entities.h.human!.activity!=='swim')rt.step();
  const at=[...rt.world.entities.h.pose.p];assert.equal(rt.cancel(a.id).status,'cancelled');
  assert.equal(a.status,'cancelled');assert.equal(rt.world.entities.h.human!.activity,'tread');
  assert.equal(rt.world.entities.h.human!.task,undefined);assert.deepEqual(rt.holder('actor:h'),[]);
  for(let i=0;i<30;i++)rt.step();assert.deepEqual(rt.world.entities.h.pose.p,at);assert.deepEqual(rt.violations,[]);
  const b=rt.submit('shore_travel',{actor:'h',x:2,z:-6});until(rt,b.id);assert.equal(rt.world.entities.h.human!.activity,'idle');
});

test('full swept disc, family, free hands, supported root and exclusive actor are admission boundaries',async()=>{
  const {rt}=await setup();
  for(const [x,z] of [[-15.9,-6],[-8,-11.9],[17,-6]]){
    const no=rt.submit('shore_travel',{actor:'h',x,z});assert.equal(no.status,'failed');assert.equal(no.diagnostic?.code,'shore.outside-terrain');
  }
  const e=rt.world.entities.h;e.body={family:'floater',radius:.3};
  assert.equal(rt.submit('shore_travel',{actor:'h',x:-8,z:-6}).diagnostic?.code,'floater.unknown-verb');delete e.body;
  e.human!.hands={left:[2,1,-6]};assert.equal(rt.submit('shore_travel',{actor:'h',x:-8,z:-6}).diagnostic?.code,'shore.occupied-body');delete e.human!.hands;
  e.pose.p[1]=0;assert.equal(rt.submit('shore_travel',{actor:'h',x:-8,z:-6}).diagnostic?.code,'shore.unsupported-root');e.pose.p[1]=.26;
  assert.equal(rt.submit('shore_tread',{actor:'h',ticks:20}).diagnostic?.code,'shore.not-deep-water');
  const a=rt.submit('shore_travel',{actor:'h',x:-8,z:-6});
  const conflict=rt.submit('shore_travel',{actor:'h',x:4,z:-6});assert.equal(conflict.status,'failed');assert.equal(conflict.diagnostic?.code,'reservation.conflict');
  until(rt,a.id);assert.deepEqual(rt.violations,[]);
});

test('current human and object capsules block a direct route; newly arrived human stops an active mover',async()=>{
  const {f,rt}=await setup();rt.world.entities.other=f.human('other',1,-6);
  assert.equal(rt.submit('shore_travel',{actor:'h',x:-8,z:-6}).diagnostic?.code,'shore.occupied-route');delete rt.world.entities.other;
  rt.world.entities.chair={id:'chair',def:'camp-chair',kind:'fixture',pose:{p:[1,.13,-6],yaw:.4},provenance:{origin:'test-fixture',confidence:'hypothetical'}};
  assert.equal(rt.submit('shore_travel',{actor:'h',x:-8,z:-6}).diagnostic?.code,'shore.occupied-route');delete rt.world.entities.chair;
  rt.world.entities.box={id:'box',def:'unknown-shore-load',kind:'component',pose:{p:[1,0,-6],yaw:0},provenance:{origin:'test-fixture',confidence:'hypothetical'},support:{kind:'ground'}};
  assert.equal(rt.submit('shore_travel',{actor:'h',x:-8,z:-6}).diagnostic?.code,'shore.unknown-envelope');delete rt.world.entities.box;
  const a=rt.submit('shore_travel',{actor:'h',x:-8,z:-6});for(let i=0;i<25;i++)rt.step();
  const p=rt.world.entities.h.pose.p;const x=p[0]-.59;rt.world.entities.other=f.human('other',x,-6);
  let blocked=false;for(let i=0;i<30;i++){rt.step();if(a.status==='blocked'){blocked=true;break;}}
  assert.equal(blocked,true);assert.equal(a.diagnostic?.code,'shore.occupied-route');assert.equal(rt.world.entities.h.human!.speed,0);
  assert.deepEqual(rt.violations,[]);delete rt.world.entities.other;until(rt,a.id);assert.deepEqual(rt.violations,[]);
});

test('shoreDepartV1: a body already touching the mover blocks only steps toward it, never a step away',async()=>{
  // Gate deadlock (Modal r13 a34d4b8d9): two Souls stopped touching a third at the dry gate; every step away from them was
  // "occupied" for good, so all waited out their budget and failed. Off by default: recorded histories replay unchanged.
  for(const policy of [false,true]){
    const {f,rt}=await setup();if(policy)rt.services.shoreDepartV1=true;
    rt.world.entities.behind=f.human('behind',2.55,-6);
    const away=rt.submit('shore_travel',{actor:'h',x:-8,z:-6});
    if(!policy){assert.equal(away.diagnostic?.code,'shore.occupied-route');continue;}
    until(rt,away.id);assert.equal(rt.world.entities.h.human!.activity,'tread');assert.deepEqual(rt.violations,[]);
    const back=rt.submit('shore_travel',{actor:'h',x:2,z:-6});assert.equal(back.diagnostic?.code,'shore.occupied-route');
  }
  const {f,rt}=await setup();rt.services.shoreDepartV1=true;rt.world.entities.ahead=f.human('ahead',1.45,-6);
  assert.equal(rt.submit('shore_travel',{actor:'h',x:-8,z:-6}).diagnostic?.code,'shore.occupied-route');
});

test('two actual native swimmers keep separate body occupancy and another swimmer can clear the route',async()=>{
  const {f,rt}=await setup();rt.world.entities.other=f.human('other',2,-4);
  const first=rt.submit('shore_travel',{actor:'other',x:-8,z:-4});until(rt,first.id);
  const cross=rt.submit('shore_travel',{actor:'other',x:-4,z:-6});until(rt,cross.id);
  assert.equal(rt.world.entities.other.human!.activity,'tread');
  const denied=rt.submit('shore_travel',{actor:'h',x:-8,z:-6});assert.equal(denied.status,'failed');
  assert.equal(denied.diagnostic?.code,'shore.occupied-route');
  const leave=rt.submit('shore_travel',{actor:'other',x:2,z:-4});until(rt,leave.id);
  const go=rt.submit('shore_travel',{actor:'h',x:-8,z:-6});until(rt,go.id);
  assert.equal(rt.world.entities.h.human!.activity,'tread');assert.deepEqual(rt.violations,[]);
});

test('fixture installation rejects foreign base snapshots and does not enable legacy flat walk or change the default registry',async()=>{
  const {f,rt}=await setup();const before=rt.stateHash();const a=rt.submit('walk_to',{actor:'h',x:-8,z:-6});
  assert.equal(a.status,'failed');assert.equal(rt.stateHash(),before);
  assert.equal(createRegistry().has('shore_travel'),false);
  const world=f.genesis();world.base.staticHash='0'.repeat(64);assert.throws(()=>f.create(world),/physical base/);
  const snap=rt.snapshot();const other=await nativeShoreFixture();const changed=other.genesis();changed.base.campus='greenfield';
  assert.throws(()=>other.create(changed),/physical base/);
  const foreign=new Runtime(changed,new Map(),{},[]).snapshot();assert.throws(()=>f.restore(foreign),/physical base/);
  assert.equal(f.restore(snap).stateHash(),rt.stateHash());
  const publicCopy=f.fixture;publicCopy.terrain.heightMetres[0][0]=99;
  assert.equal(f.geometry.point([-16,-12])!.point[1],-1.5);
  assert.throws(()=>Object.assign(f.geometry,{datumY:100}),TypeError);
  assert.throws(()=>Object.assign(SHORE_POLICY,{travelSpeed:100}),TypeError);
});
