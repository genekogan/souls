// Paired actual native public input for World; hypothetical low-level bodies,
// with an explicit fixture pilot capability rather than ownerless product Souls.
import {hashOf,captureRenderScene} from '@souls/engine-contract';
import {connectedCommonsBoatFixture} from './connected-boat.ts';
import {TakeRecorder} from '../../../mars/viewer/engine/take/recorder.ts';
export async function nativeConnectedBoatTake(){
  const f=await connectedCommonsBoatFixture(),w=f.genesis('native-connected-boat-capture/1');
  w.entities.pilot=f.human('pilot',14,4);w.entities.guest=f.human('guest',15,4);w.entities[f.policy.boatId].boat!.pilotIds=['pilot'];const genesis=structuredClone(w);
  const rt=f.create(w),capture=captureRenderScene(f.rulesVersion,f.renderScene()),recorder=new TakeRecorder(rt,{rulesVersion:f.rulesVersion,renderSceneRef:capture.ref});
  const requests=[
    {verb:'commons_shore_travel',params:{actor:'pilot',x:f.layout.bank[0],z:f.layout.bank[2]}},
    {verb:'boat_board',params:{actor:'pilot',slot:'seat0'}},
    {verb:'commons_shore_travel',params:{actor:'guest',x:f.layout.bank[0],z:f.layout.bank[2]}},
    {verb:'boat_board',params:{actor:'guest',slot:'seat1'}},
    {verb:'boat_travel',params:{actor:'pilot',x:-56,z:8}},
    {verb:'boat_travel',params:{actor:'pilot',x:-50,z:7}},
    {verb:'boat_leave',params:{actor:'guest',slot:'seat1'}},
    {verb:'commons_shore_travel',params:{actor:'guest',x:9,z:6}},
    {verb:'boat_leave',params:{actor:'pilot',slot:'seat0'}},
    {verb:'commons_shore_travel',params:{actor:'pilot',x:9,z:5}},
  ];
  const inputs:unknown[]=[],trace:unknown[]=[];
  for(const request of requests){const a=rt.submit(request.verb,request.params);inputs.push({tick:rt.tick,id:a.id,...request});for(let i=0;i<3500&&rt.isActive(a.id);i++)rt.step();if(a.status!=='completed')throw Error('native connected boat did not complete: '+JSON.stringify(a));trace.push({id:a.id,verb:a.verb,requestedTick:a.requestedTick,endedTick:a.endedTick,roots:{pilot:[...rt.world.entities.pilot.pose.p],guest:[...rt.world.entities.guest.pose.p]},boat:[...rt.world.entities[f.policy.boatId].pose.p],passengers:{...rt.world.entities[f.policy.boatId].boat!.passengers}});}
  if(rt.violations.length)throw Error('native connected boat violated physical invariants');const take=recorder.finish();
  return {contract:'native-connected-commons-boat-take/1',rulesVersion:f.rulesVersion,physicalBase:rt.world.base,genesis,inputs,trace,take,capture,takeHash:hashOf(take),captureHash:capture.ref.hash,finalStateHash:rt.stateHash(),nativeViolations:rt.violations,paidUsd:0,
    limits:['hypothetical-low-level-body-and-pilot-fixture','not-owned-Soul-or-living-boat-factory','two-upright-seats-fixed-yaw-straight-calm-route','no-implicit-pilot-permission','no-old-world-transition-default-or-release','World-combined-boat-rendering-pending']};
}
