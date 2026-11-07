import test from 'node:test';
import assert from 'node:assert/strict';
import {hashOf,captureRenderScene,nativeBoatLayoutV1Schema} from '@souls/engine-contract';
import {connectedCommonsBoatFixture} from './connected-boat.ts';
import {connectedCommonsShoreFixture} from './connected-shore.ts';
import {nativeBoatFixture} from './boat-runtime.ts';
import {BOAT_LAYOUT,BOAT_POLICY,translatedBoatControllers} from '../../../mars/viewer/engine/vehicles/boat.ts';
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import {TakeRecorder} from '../../../mars/viewer/engine/take/recorder.ts';
function finish(rt:Runtime,id:string,limit=3000,copy?:Runtime){for(let i=0;i<limit&&rt.isActive(id);i++){rt.step();if(copy){copy.step();assert.equal(copy.stateHash(),rt.stateHash());assert.equal(hashOf(copy.snapshot().data),hashOf(rt.snapshot().data));}}assert.equal(rt.records.get(id)!.status,'completed',JSON.stringify(rt.records.get(id)));}
async function setup(){const f=await connectedCommonsBoatFixture(),w=f.genesis('connected-boat-proof');w.entities.pilot=f.human('pilot',14,4);w.entities.guest=f.human('guest',15,4);w.entities[f.policy.boatId].boat!.pilotIds=['pilot'];return {f,rt:f.create(w)};}
const travel=(rt:Runtime,actor:string,x:number,z:number)=>rt.submit('commons_shore_travel',{actor,x,z});
async function boarded(){const {f,rt}=await setup();finish(rt,travel(rt,'pilot',f.layout.bank[0],f.layout.bank[2]).id);finish(rt,rt.submit('boat_board',{actor:'pilot',slot:'seat0'}).id);finish(rt,travel(rt,'guest',f.layout.bank[0],f.layout.bank[2]).id);finish(rt,rt.submit('boat_board',{actor:'guest',slot:'seat1'}).id);return {f,rt};}

test('rigid translated controller keeps relative seats/frame/draft and immutable old fixture constants',()=>{
  const c=translatedBoatControllers({x:-46,y:-2,z:0}),l=nativeBoatLayoutV1Schema.parse(c.layout);assert.deepEqual(l.boatDockPosition,[-50,-2.3,7]);assert.deepEqual(l.bank,[-42,-1.48,5]);assert.deepEqual(l.seats,BOAT_LAYOUT.seats);assert.deepEqual(l.authoredFrameOffset,BOAT_LAYOUT.authoredFrameOffset);assert.equal(c.policy.draft,BOAT_POLICY.draft);assert.equal(c.policy.keelY,-2.3);assert.deepEqual(BOAT_LAYOUT.boatDockPosition,[-4,-.3,7]);assert.equal(BOAT_POLICY.keelY,-.3);assert.throws(()=>translatedBoatControllers({x:0,y:Infinity,z:0}));assert.throws(()=>{c.layout.bank[0]=0;},TypeError);
});

test('one connected Runtime walks from commons, boards two physical passengers, sails, docks, leaves and returns ashore without teleport',async()=>{
  const {f,rt}=await setup(),capture=captureRenderScene(f.rulesVersion,f.renderScene()),recorder=new TakeRecorder(rt,{rulesVersion:f.rulesVersion,renderSceneRef:capture.ref});
  finish(rt,travel(rt,'pilot',f.layout.bank[0],f.layout.bank[2]).id);assert.deepEqual(rt.world.entities.pilot.pose.p,f.layout.bank);
  const board=rt.submit('boat_board',{actor:'pilot',slot:'seat0'});for(let i=0;i<100;i++)rt.step();const copy=f.restore(rt.snapshot());finish(rt,board.id,3000,copy);
  finish(rt,travel(rt,'guest',f.layout.bank[0],f.layout.bank[2]).id);finish(rt,rt.submit('boat_board',{actor:'guest',slot:'seat1'}).id);
  assert.deepEqual(rt.world.entities[f.policy.boatId].boat!.passengers,{seat0:'pilot',seat1:'guest'});
  assert.equal(rt.submit('boat_travel',{actor:'guest',x:-56,z:8}).diagnostic?.code,'boat.pilot-not-authorized');
  const go=rt.submit('boat_travel',{actor:'pilot',x:-56,z:8});assert.equal(go.status,'executing',JSON.stringify(go));for(let i=0;i<40;i++)rt.step();finish(rt,go.id,3000,f.restore(rt.snapshot()));
  for(const [id,want] of [['pilot',[-56.65,-1.5,8]],['guest',[-55.35,-1.5,8]]] as [string,number[]][])assert.ok(rt.world.entities[id].pose.p.every((v,i)=>Math.abs(v-want[i])<1e-12));assert.equal(rt.submit('boat_leave',{actor:'guest',slot:'seat1'}).diagnostic?.code,'boat.not-docked');
  finish(rt,rt.submit('boat_travel',{actor:'pilot',x:-50,z:7}).id);finish(rt,rt.submit('boat_leave',{actor:'guest',slot:'seat1'}).id);finish(rt,travel(rt,'guest',9,6).id);finish(rt,rt.submit('boat_leave',{actor:'pilot',slot:'seat0'}).id);finish(rt,travel(rt,'pilot',9,5).id);
  assert.deepEqual(rt.world.entities.pilot.pose.p,[9,0,5]);assert.deepEqual(rt.world.entities.guest.pose.p,[9,0,6]);assert.deepEqual(rt.world.entities[f.policy.boatId].boat!.passengers,{});assert.deepEqual(rt.violations,[]);
  const take=recorder.finish();assert.equal(take.finalStateHash,rt.stateHash());assert.equal(take.renderSceneRef!.hash,capture.ref.hash);
});

test('boarding cancellation retains the actual supported path and finishes in its occupied translated seat',async()=>{
  const {f,rt}=await setup();finish(rt,travel(rt,'pilot',f.layout.bank[0],f.layout.bank[2]).id);const board=rt.submit('boat_board',{actor:'pilot',slot:'seat0'});for(let i=0;i<40;i++)rt.step();const at=[...rt.world.entities.pilot.pose.p];rt.cancel(board.id);assert.ok(rt.isActive(board.id));assert.deepEqual(rt.world.entities.pilot.pose.p,at);const copy=f.restore(rt.snapshot());
  for(let i=0;i<3000&&rt.isActive(board.id);i++){rt.step();copy.step();assert.equal(copy.stateHash(),rt.stateHash());assert.equal(hashOf(copy.snapshot().data),hashOf(rt.snapshot().data));}
  assert.equal(board.status,'cancelled');assert.equal(rt.world.entities.pilot.human!.boatPassenger!.phase,'seated');assert.deepEqual(rt.holder('actor:pilot'),[]);assert.deepEqual(rt.violations,[]);
});

test('translated draft/admission/source boundaries refuse shallow water, occupied bodies and incompatible old physical worlds',async()=>{
  const {f,rt}=await boarded();assert.equal(rt.submit('boat_travel',{actor:'pilot',x:-47,z:7}).diagnostic?.code,'boat.draft-clearance');assert.equal(rt.submit('commons_shore_travel',{actor:'guest',x:9,z:5}).diagnostic?.code,'connected.occupied-body');assert.deepEqual(rt.violations,[]);
  for(const old of [await nativeBoatFixture(),await connectedCommonsShoreFixture()]){assert.throws(()=>f.create(old.genesis()),/physical base differs/);assert.throws(()=>old.create(f.genesis()),/physical base/);assert.throws(()=>old.restore(rt.snapshot()),/physical base/);}
  assert.deepEqual(f.genesis().entities[f.policy.boatId].boat!.pilotIds,[],'unoccupied genesis grants no implicit pilot authority');
});


test('an actual connected swimmer stops the full underway hull; a real shore movement clears it and resumes the same boat',async()=>{
  const {f,rt}=await boarded();rt.world.entities.swimmer=f.human('swimmer',14,4);finish(rt,travel(rt,'swimmer',-40,10).id);finish(rt,travel(rt,'swimmer',-54,10).id);
  const go=rt.submit('boat_travel',{actor:'pilot',x:-56,z:8});assert.equal(go.status,'executing');finish(rt,travel(rt,'swimmer',-54,7.6).id);
  for(let i=0;i<300&&rt.records.get(go.id)!.status!=='blocked';i++)rt.step();assert.equal(go.status,'blocked');assert.equal(go.diagnostic?.code,'boat.occupied-route');const position=[...rt.world.entities[f.policy.boatId].pose.p];
  for(let i=0;i<20;i++)rt.step();assert.deepEqual(rt.world.entities[f.policy.boatId].pose.p,position);assert.equal(rt.world.entities[f.policy.boatId].boat!.speed,0);
  finish(rt,travel(rt,'swimmer',-54,10).id);finish(rt,go.id);assert.equal(rt.world.entities.swimmer.human!.activity,'tread');assert.deepEqual(rt.violations,[]);
});
