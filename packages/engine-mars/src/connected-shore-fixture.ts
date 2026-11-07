// Public captured physical demonstration for World. Low-level hypothetical
// bodies only; no product Souls, account, mind, compiler or live-world adoption.
import {captureRenderScene,hashOf} from '@souls/engine-contract';
import {connectedCommonsShoreFixture,CONNECTED_SHORE_TRANSFORM} from './connected-shore.ts';
import {TakeRecorder} from '../../../mars/viewer/engine/take/recorder.ts';
export async function nativeConnectedCommonsShoreTake(){
  const f=await connectedCommonsShoreFixture(),w=f.genesis('connected-capture/1');w.entities['connected-resident']=f.human('connected-resident',14,4);
  const rt=f.create(w),capture=captureRenderScene(f.rulesVersion,f.renderScene()),recorder=new TakeRecorder(rt,{rulesVersion:f.rulesVersion,renderSceneRef:capture.ref});
  const requests=[{verb:'commons_shore_travel',params:{actor:'connected-resident',x:-54,z:-6}},
    {verb:'shore_tread',params:{actor:'connected-resident',ticks:40}},
    {verb:'commons_shore_travel',params:{actor:'connected-resident',x:9,z:5}}];
  const inputs:unknown[]=[],trace:unknown[]=[];
  for(const r of requests){const a=rt.submit(r.verb,r.params);inputs.push({tick:rt.tick,id:a.id,verb:r.verb,params:r.params});
    for(let i=0;i<2500&&rt.isActive(a.id);i++)rt.step();if(a.status!=='completed')throw new Error('connected capture did not complete: '+JSON.stringify(a));
    trace.push({id:a.id,requestedTick:a.requestedTick,endedTick:a.endedTick,phase:a.phase,position:[...rt.world.entities['connected-resident'].pose.p],activity:rt.world.entities['connected-resident'].human!.activity});}
  if(rt.violations.length)throw new Error('connected capture violated native physical invariants');
  const take=recorder.finish();return {contract:'native-connected-commons-shore-take/1',rulesVersion:f.rulesVersion,
    stage:'installed-native-fixture',transform:CONNECTED_SHORE_TRANSFORM,sourceHash:f.sourceHash,physicalBase:rt.world.base,
    inputs,trace,take,capture,takeHash:hashOf(take),finalStateHash:rt.stateHash(),nativeViolations:rt.violations,paidUsd:0,
    limits:['low-level-hypothetical-human-fixture','not-owned-Soul-WorldHost-factory','no-old-world-transition','no-boats-or-dock','direct-shore-routes','World-transformed-layout-and-combined-draw-review-pending']};
}
