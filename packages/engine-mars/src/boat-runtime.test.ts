import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeBoatFixture } from './boat-runtime.ts';
import { TakeRecorder } from '../../../mars/viewer/engine/take/recorder.ts';
import { sampleTake } from '../../../mars/viewer/engine/take/replay.ts';
import type { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import { boatStateV1Schema, boatPassengerV1Schema } from '@souls/engine-contract';
import { BOAT_LAYOUT, BOAT_POLICY } from '../../../mars/viewer/engine/vehicles/boat.ts';
import { nativeShoreFixture } from './shore-runtime.ts';

async function setup() {
  const f=await nativeBoatFixture(),w=f.genesis('boat-proof');w.entities.pilot=f.human('pilot',4,5);w.entities.guest=f.human('guest',6,5);
  return {f,rt:f.create(w)};
}
function finish(rt:Runtime,id:string,limit=1600) {
  for(let i=0;i<limit&&rt.isActive(id);i++)rt.step();
  assert.equal(rt.records.get(id)!.status,'completed',JSON.stringify(rt.records.get(id)));
}
function boardBoth(rt:Runtime) {
  const a=rt.submit('boat_board',{actor:'pilot',slot:'seat0'});finish(rt,a.id);
  const approach=rt.submit('shore_travel',{actor:'guest',x:4,z:5});finish(rt,approach.id);
  const b=rt.submit('boat_board',{actor:'guest',slot:'seat1'});finish(rt,b.id);
}

test('actual supported boarding → two occupied seats → route → stopped dock → supported exit',async()=>{
  const {f,rt}=await setup(),recorder=new TakeRecorder(rt,{rulesVersion:f.rulesVersion});
  boardBoth(rt);
  assert.deepEqual(rt.world.entities['eden-boat-prototype'].boat!.passengers,{seat0:'pilot',seat1:'guest'});
  assert.deepEqual(rt.world.entities.pilot.pose.p,[-4.65,.5,7]);assert.deepEqual(rt.world.entities.guest.pose.p,[-3.35,.5,7]);
  const out=rt.submit('boat_travel',{actor:'pilot',x:-10,z:8});assert.equal(out.status,'executing');
  assert.equal(rt.world.entities['eden-boat-prototype'].boat!.connectorOpen,false);finish(rt,out.id);
  assert.deepEqual(rt.world.entities.pilot.pose.p,[-10.65,.5,8]);assert.deepEqual(rt.world.entities.guest.pose.p,[-9.35,.5,8]);
  const denied=rt.submit('boat_leave',{actor:'guest',slot:'seat1'});assert.equal(denied.diagnostic?.code,'boat.not-docked');
  const back=rt.submit('boat_travel',{actor:'pilot',x:-4,z:7});finish(rt,back.id);
  assert.equal(rt.world.entities['eden-boat-prototype'].boat!.connectorOpen,true);
  const leave=rt.submit('boat_leave',{actor:'pilot',slot:'seat0'});finish(rt,leave.id);
  assert.deepEqual(rt.world.entities.pilot.pose.p,[4,.52,5]);assert.equal(rt.world.entities.pilot.human!.boatPassenger,undefined);
  assert.deepEqual(rt.world.entities['eden-boat-prototype'].boat!.passengers,{seat1:'guest'});assert.deepEqual(rt.violations,[]);
  const take=recorder.finish(),at=sampleTake(take,out.endedTick!*take.dt);
  assert.equal(boatPassengerV1Schema.parse(at.entities.guest.state.boatPassenger).phase,'seated');
  assert.equal(boatStateV1Schema.parse(at.entities['eden-boat-prototype'].state.boat).connectorOpen,false);
});

test('boarding and underway passenger graphs restore tick-exact without models',async()=>{
  const {f,rt}=await setup();const board=rt.submit('boat_board',{actor:'pilot',slot:'seat0'});for(let i=0;i<100;i++)rt.step();
  let copy=f.restore(JSON.parse(JSON.stringify(rt.snapshot())));while(rt.isActive(board.id)){rt.step();copy.step();assert.equal(copy.stateHash(),rt.stateHash());}
  const go=rt.submit('boat_travel',{actor:'pilot',x:-10,z:8});for(let i=0;i<40;i++)rt.step();
  copy=f.restore(JSON.parse(JSON.stringify(rt.snapshot())));while(rt.isActive(go.id)){rt.step();copy.step();assert.equal(copy.stateHash(),rt.stateHash());}
  assert.deepEqual(rt.violations,[]);assert.deepEqual(copy.violations,[]);
});

test('boarding occupancy blocks departure and cancellation drains to a supported occupied seat',async()=>{
  const {rt}=await setup();const a=rt.submit('boat_board',{actor:'pilot',slot:'seat0'});for(let i=0;i<40;i++)rt.step();
  assert.equal(rt.submit('boat_travel',{actor:'pilot',x:-10,z:8}).status,'failed');
  assert.equal(rt.submit('boat_board',{actor:'guest',slot:'seat1'}).diagnostic?.code,'boat.occupied-connector');
  rt.cancel(a.id);assert.equal(rt.isActive(a.id),true);for(let i=0;i<1600&&rt.isActive(a.id);i++)rt.step();
  assert.equal(a.status,'cancelled');assert.equal(rt.world.entities.pilot.human!.activity,'sit');
  assert.equal(rt.world.entities.pilot.human!.boatPassenger!.phase,'seated');assert.deepEqual(rt.holder('actor:pilot'),[]);assert.deepEqual(rt.violations,[]);
});

test('a passenger seat grants no pilot permission; draft and load/body constraints remain explicit',async()=>{
  const {rt}=await setup();boardBoth(rt);
  assert.equal(rt.submit('boat_travel',{actor:'guest',x:-10,z:8}).diagnostic?.code,'boat.pilot-not-authorized');
  assert.equal(rt.submit('shore_travel',{actor:'guest',x:4,z:5}).diagnostic?.code,'shore.occupied-body');
  assert.equal(rt.submit('boat_travel',{actor:'pilot',x:-1,z:7}).diagnostic?.code,'boat.draft-clearance');
  assert.equal(rt.submit('boat_board',{actor:'guest',slot:'seat0'}).diagnostic?.code,'boat.seat-occupied');
  const go=rt.submit('boat_travel',{actor:'pilot',x:-10,z:8});for(let i=0;i<30;i++)rt.step();rt.cancel(go.id);
  const at=[...rt.world.entities['eden-boat-prototype'].pose.p];for(let i=0;i<20;i++)rt.step();
  assert.deepEqual(rt.world.entities['eden-boat-prototype'].pose.p,at);assert.equal(rt.world.entities.guest.human!.activity,'sit');assert.deepEqual(rt.violations,[]);
});

test('an actual native swimmer stops an underway boat, then clears its route without another controller',async()=>{
  const {f,rt}=await setup();boardBoth(rt);rt.world.entities.swimmer=f.human('swimmer',2,10);
  finish(rt,rt.submit('shore_travel',{actor:'swimmer',x:-8,z:10}).id);
  const go=rt.submit('boat_travel',{actor:'pilot',x:-10,z:8});assert.equal(go.status,'executing');
  finish(rt,rt.submit('shore_travel',{actor:'swimmer',x:-8,z:7.6}).id);
  for(let i=0;i<300&&rt.records.get(go.id)!.status!=='blocked';i++)rt.step();
  assert.equal(go.status,'blocked');assert.equal(go.diagnostic?.code,'boat.occupied-route');
  const p=[...rt.world.entities['eden-boat-prototype'].pose.p];
  for(let i=0;i<20;i++)rt.step();assert.deepEqual(rt.world.entities['eden-boat-prototype'].pose.p,p);
  assert.equal(rt.world.entities['eden-boat-prototype'].boat!.speed,0);assert.deepEqual(rt.violations,[]);
  finish(rt,rt.submit('shore_travel',{actor:'swimmer',x:-8,z:10}).id);finish(rt,go.id);
  assert.deepEqual(rt.violations,[]);assert.equal(rt.world.entities.swimmer.human!.activity,'tread');
});

test('a supported exit restores and deferred cancellation finishes ashore with no retained passenger claim',async()=>{
  const {f,rt}=await setup();boardBoth(rt);
  const leave=rt.submit('boat_leave',{actor:'guest',slot:'seat1'});for(let i=0;i<60;i++)rt.step();
  rt.cancel(leave.id);const copy=f.restore(JSON.parse(JSON.stringify(rt.snapshot())));
  while(rt.isActive(leave.id)){rt.step();copy.step();assert.equal(copy.stateHash(),rt.stateHash());}
  assert.equal(leave.status,'cancelled');assert.deepEqual(rt.world.entities.guest.pose.p,[4,.52,5]);
  assert.equal(rt.world.entities.guest.human!.boatPassenger,undefined);assert.equal(rt.world.entities.guest.human!.boatTransit,undefined);
  assert.equal(rt.world.entities.guest.human!.activity,'idle');assert.deepEqual(rt.holder('actor:guest'),[]);
  assert.deepEqual(rt.world.entities['eden-boat-prototype'].boat!.passengers,{seat0:'pilot'});assert.deepEqual(rt.violations,[]);
  assert.deepEqual(copy.violations,[]);
});

test('missing dock, held hands, actual boarding obstruction and foreign physical snapshots refuse explicitly',async()=>{
  const {f,rt}=await setup(),dock=rt.world.entities['eden-dock'];delete rt.world.entities['eden-dock'];
  assert.equal(rt.submit('boat_board',{actor:'pilot',slot:'seat0'}).diagnostic?.code,'boat.dock-gone');rt.world.entities[dock.id]=dock;
  rt.world.entities.pilot.human!.hands={left:[4,1,5]};
  assert.equal(rt.submit('boat_board',{actor:'pilot',slot:'seat0'}).diagnostic?.code,'boat.occupied-body');delete rt.world.entities.pilot.human!.hands;
  rt.world.entities.chair={id:'chair',def:'camp-chair',kind:'fixture',pose:{p:[2,.61,5],yaw:0},provenance:{origin:'test-fixture',confidence:'hypothetical'}};
  assert.equal(rt.submit('boat_board',{actor:'pilot',slot:'seat0'}).diagnostic?.code,'shore.occupied-route');delete rt.world.entities.chair;
  const shore=await nativeShoreFixture();assert.throws(()=>f.create(shore.genesis()),/physical base/);
  const other=shore.create(shore.genesis());assert.throws(()=>f.restore(other.snapshot()),/physical base/);
  assert.throws(()=>shore.restore(rt.snapshot()),/physical base/);
  assert.throws(()=>Object.assign(BOAT_POLICY,{travelSpeed:99}),TypeError);
  assert.throws(()=>BOAT_LAYOUT.seats.seat0.root.splice(1,1,99),TypeError);
  assert.deepEqual(rt.violations,[]);
});

test('an externally lost passenger stays a visible diagnostic instead of throwing or moving a missing body',async()=>{
  const {rt}=await setup();boardBoth(rt);const go=rt.submit('boat_travel',{actor:'pilot',x:-10,z:8});rt.step();
  const before=[...rt.world.entities['eden-boat-prototype'].pose.p],guest=rt.world.entities.guest;
  delete rt.world.entities.guest;assert.doesNotThrow(()=>rt.step());
  assert.equal(go.status,'blocked');assert.equal(go.diagnostic?.code,'boat.passenger-mismatch');
  assert.deepEqual(rt.world.entities['eden-boat-prototype'].pose.p,before);
  assert.ok(rt.violations.some(d=>d.code==='boat.passenger-mismatch'));
  rt.world.entities.guest=guest;rt.cancel(go.id);
});
