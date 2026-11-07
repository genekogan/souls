import { nativeShoreFixture } from './shore-runtime.ts';
import { shoreContactV1Schema, hashOf,captureRenderScene } from '@souls/engine-contract';
import { TakeRecorder } from '../../../mars/viewer/engine/take/recorder.ts';
import { SHORE_POLICY } from '../../../mars/viewer/engine/locomotion/shore.ts';

/** Actual native events/tracks, not authored poses or fabricated outcomes. No
 * owner credentials, kernel, mind, compiler, paid provider or viewer is used. */
export async function nativeShoreTake(captureScene=false) {
  const f=await nativeShoreFixture(),w=f.genesis('public-native-shore-1');
  w.entities['shore-resident']=f.human('shore-resident',2,-6);
  const rt=f.create(w),capture=captureScene?captureRenderScene(f.rulesVersion,f.renderScene()):undefined,
    recorder=new TakeRecorder(rt,{rulesVersion:f.rulesVersion,...(capture?{renderSceneRef:capture.ref}:{})});
  const requests=[
    {verb:'shore_travel',params:{actor:'shore-resident',x:-8,z:-6}},
    {verb:'shore_tread',params:{actor:'shore-resident',ticks:60}},
    {verb:'shore_travel',params:{actor:'shore-resident',x:4,z:-6}},
  ];
  const trace: {id:string;verb:string;requestedTick:number;endedTick:number;position:number[];activity:string}[]=[];
  const inputs: {tick:number;id:string;verb:string;params:unknown}[]=[];
  for(const request of requests) {
    const a=rt.submit(request.verb,request.params);
    inputs.push({tick:rt.tick,id:a.id,verb:request.verb,params:structuredClone(request.params)});
    for(let i=0;i<1000&&rt.isActive(a.id);i++)rt.step();
    if(a.status!=='completed')throw new Error(`native shore fixture did not finish ${request.verb}: ${a.diagnostic?.code}`);
    const e=rt.world.entities['shore-resident'];shoreContactV1Schema.parse(e.human!.shore);
    trace.push({id:a.id,verb:a.verb,requestedTick:a.requestedTick,endedTick:a.endedTick!,position:[...e.pose.p],activity:e.human!.activity});
  }
  if(rt.violations.length)throw new Error('native shore fixture violated invariants');
  const take=recorder.finish();
  for(const change of take.changes)if(change[2]==='shore'&&change[3]!==null)shoreContactV1Schema.parse(change[3]);
  return {
    contract:'native-shore-take-fixture/1',stage:'installed-native-fixture',
    rulesVersion:f.rulesVersion,physicalBase:structuredClone(rt.world.base),
    geometry:f.fixture,policy:SHORE_POLICY,inputs,trace,take,
    limits:['isolated-native-runtime','direct-routes-only','upright-human-capsule','prescribed-calm-buoyancy',
      'no-boats-dock-or-passengers','no-living-world-factory-or-history-transition','no-body-rig-or-contact-render-proof'],
    finalStateHash:rt.stateHash(),takeHash:hashOf(take),paidSpendUSD:0,
    ...(capture?{capture}:{}),
  };
}
