// Actual native producer output, no World helper or fabricated segment boundary.
import {marsFactory} from '@souls/engine-mars';
import type {RenderSceneRefV1} from '@souls/engine-contract';

export const CAMP_SCENE_PRODUCER_PIN='3ab5daaddf949104651f93cc15afabfa21be6d3b';
export async function campSceneFixture() {
  const factory=await marsFactory(),engine=factory.create(factory.genesis('core-camp-transition-fixture'));
  engine.spawnHuman({id:'fixture-person',label:'Alice',soul:'fixture-soul'});
  for(let i=0;i<7;i++)engine.step();
  engine.adoptCamp!();
  for(let i=0;i<20;i++)engine.step();
  const chunks=engine.takeChunks!(-1),worldId='core-camp-transition-fixture';
  const refs=chunks.map(c=>(c.take as {renderSceneRef:RenderSceneRefV1}).renderSceneRef);
  const captures=refs.map(ref=>({worldId,...engine.takeScene!(ref.hash)!}));
  return JSON.parse(JSON.stringify({contract:'core-camp-scene-fixture/1',worldId,
    producer:{commit:CAMP_SCENE_PRODUCER_PIN,kind:'actual-native-engine',seed:'core-camp-transition-fixture'},
    serverTick:engine.world.tick,chunks,captures,
    violations:engine.runtime.violations,paid:0}));
}
