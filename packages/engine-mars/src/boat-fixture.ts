import { nativeBoatFixture } from './boat-runtime.ts';
import { boatStateV1Schema, boatPassengerV1Schema, boatTransitV1Schema, nativeBoatLayoutV1Schema, hashOf,captureRenderScene } from '@souls/engine-contract';
import { TakeRecorder } from '../../../mars/viewer/engine/take/recorder.ts';
import { BOAT_LAYOUT, BOAT_POLICY } from '../../../mars/viewer/engine/vehicles/boat.ts';

/** An actual native two-person journey. No scripted roots, model outcomes,
 * owners, credentials, server, database, viewer or paid provider. */
export async function nativeBoatTake(captureScene=false) {
  nativeBoatLayoutV1Schema.parse(BOAT_LAYOUT);
  const f=await nativeBoatFixture(),w=f.genesis('public-native-boat-1');
  // Anonymous fixture identities, including an explicit hypothetical physical
  // pilot capability. They are not Souls admitted to a living owner-world.
  w.entities.pilot=f.human('pilot',4,5);w.entities.guest=f.human('guest',6,5);
  const genesis=structuredClone(w),rt=f.create(w),capture=captureScene?captureRenderScene(f.rulesVersion,f.renderScene()):undefined,
    recorder=new TakeRecorder(rt,{rulesVersion:f.rulesVersion,...(capture?{renderSceneRef:capture.ref}:{})});
  const requests=[
    {verb:'boat_board',params:{actor:'pilot',slot:'seat0'}},
    {verb:'shore_travel',params:{actor:'guest',x:4,z:5}},
    {verb:'boat_board',params:{actor:'guest',slot:'seat1'}},
    {verb:'boat_travel',params:{actor:'pilot',x:-10,z:8}},
    {verb:'boat_travel',params:{actor:'pilot',x:-4,z:7}},
    {verb:'boat_leave',params:{actor:'guest',slot:'seat1'}},
    {verb:'shore_travel',params:{actor:'guest',x:6,z:5}},
    {verb:'boat_leave',params:{actor:'pilot',slot:'seat0'}},
  ];
  const inputs:{tick:number;id:string;verb:string;params:unknown}[]=[],
    trace:{id:string;verb:string;requestedTick:number;endedTick:number;boatPosition:number[];passengers:Record<string,string>;roots:Record<string,number[]>}[]=[];
  for(const request of requests) {
    const a=rt.submit(request.verb,request.params);
    inputs.push({tick:rt.tick,id:a.id,verb:request.verb,params:structuredClone(request.params)});
    for(let i=0;i<1800&&rt.isActive(a.id);i++)rt.step();
    if(a.status!=='completed')throw new Error(`native boat fixture did not finish ${request.verb}: ${a.diagnostic?.code}`);
    const v=rt.world.entities[BOAT_POLICY.boatId];boatStateV1Schema.parse(v.boat);
    trace.push({id:a.id,verb:a.verb,requestedTick:a.requestedTick,endedTick:a.endedTick!,boatPosition:[...v.pose.p],
      passengers:{...v.boat!.passengers},roots:Object.fromEntries(['pilot','guest'].map(id=>[id,[...rt.world.entities[id].pose.p]]))});
  }
  if(rt.violations.length)throw new Error('native boat fixture violated invariants');
  const take=recorder.finish(),schemas={boat:boatStateV1Schema,boatPassenger:boatPassengerV1Schema,boatTransit:boatTransitV1Schema};
  for(const change of take.changes)if(Object.hasOwn(schemas,change[2])&&change[3]!==null)
    schemas[change[2] as keyof typeof schemas].parse(change[3]);
  return {contract:'native-boat-take-fixture/1',stage:'installed-native-fixture',
    rulesVersion:f.rulesVersion,physicalBase:structuredClone(rt.world.base),genesis,
    geometry:f.fixture,layout:structuredClone(BOAT_LAYOUT),policy:BOAT_POLICY,inputs,trace,take,
    limits:['isolated-native-runtime','fixed-yaw-straight-translation','two-finite-upright-human-seats','prescribed-calm-draft-no-hydrostatics',
      'single-stopped-dock-and-finite-supported-connector','no-living-world-factory-or-history-transition',
      'no-body-rig-leg-contact-or-render-proof','no-seat-derived-pilot-or-owner-permission'],
    finalStateHash:rt.stateHash(),takeHash:hashOf(take),paidSpendUSD:0,...(capture?{capture}:{})};
}
