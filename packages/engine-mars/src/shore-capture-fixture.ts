// New public paired recordings. Existing unbound files and generators remain
// unchanged; these capture actual registered geometry before native execution.
import { nativeShoreTake } from './shore-fixture.ts';
import { nativeBoatTake } from './boat-fixture.ts';
import { parseRenderSceneCapture,hashOf } from '@souls/engine-contract';
export async function nativeShoreCaptureFixture(){
  const shore=await nativeShoreTake(true),boat=await nativeBoatTake(true);
  const journeys=[{worldId:'native-shore-capture-1',kind:'shore' as const,recording:shore},
    {worldId:'native-boat-capture-1',kind:'boat' as const,recording:boat}].map(j=>{
      if(!j.recording.capture)throw new Error('native registered scene capture missing');
      const capture=parseRenderSceneCapture(j.recording.capture),take=j.recording.take;
      if(hashOf(take.renderSceneRef)!==hashOf(capture.ref)||take.rulesVersion!==capture.ref.rulesVersion
        ||capture.body.shore!.physicalBase.staticHash!==j.recording.physicalBase.staticHash)
        throw new Error('native take, capture and registered physical base differ');
      const {capture:raw,...recording}=j.recording;
      return {...j,recording,capture:{worldId:j.worldId,...capture},chunk:{fromTick:take.startTick,toTick:take.startTick+take.ticks,take}};
    });
  return {contract:'native-shore-capture-fixture/1',stage:'installed-native-fixture',journeys,paidSpendUSD:0,
    limits:['isolated-native-runtime','anonymous-native-fixture-identities-not-Souls','no-living-WorldHost-adoption',
      'no-commons-overlay-or-new-topology','no-World-consumer-or-body-contact-render-qualification']};
}
