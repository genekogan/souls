// Observation only: Toy retains its rules, hashes and checkpoint format.
// A separate bounded event buffer feeds the recorder; no Mars Runtime is constructed.
import {captureRenderScene,type Engine,type EngineFactory} from '@souls/engine-contract';
import { toyFactory } from '@souls/engine-toy';
import { TakeRecorder, type TakeSource } from '../../../mars/viewer/engine/take/recorder.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';

export function recordToy(engine: Engine): Engine {
  engine.renderScene = () => ({ scene: {
    bounds: [-50, -50, 50, 50], levels: [{ id: 0, y: 0 }],
    surfaces: [{ id: 'toy-ground', level: 0, y: 0, obb: { c: [0, 0], half: [50, 50], yaw: 0 } }],
    obstacles: [], links: [],
  } });
  const captured=captureRenderScene(engine.rulesVersion,engine.renderScene());
  engine.takeScene=hash=>hash===captured.ref.hash?structuredClone(captured):undefined;
  const source: TakeSource = {
    // The take codec types its original Mars schema literal. Recording reads the common
    // entity/pose shape and preserves Toy's actual schema and every original field.
    get world() { return engine.world as TakeSource['world']; },
    get tick() { return engine.world.tick; },
    stateHash: () => engine.stateHash(), events: [], observers: [],
  };
  let recorder = new TakeRecorder(source, { rulesVersion: engine.rulesVersion,renderSceneRef:structuredClone(captured.ref) });
  const chunks: { fromTick: number; toTick: number; take: Take }[] = [];
  const step = engine.step.bind(engine);
  engine.step = () => {
    const out = step(); source.events.push(...out.events); recorder.onTick();
    if (source.tick - recorder.startTick >= 20) {
      const take = recorder.finish();
      chunks.push({ fromTick: take.startTick, toTick: source.tick, take });
      if (chunks.length > 12) chunks.shift();
      source.events.length = 0;
      recorder = new TakeRecorder(source, { rulesVersion: engine.rulesVersion,renderSceneRef:structuredClone(captured.ref) });
    }
    return out;
  };
  engine.takeChunks = after => chunks.filter(c => c.toTick > after);
  return engine;
}
export const recordedToyFactory: EngineFactory = {
  ...toyFactory,
  create: world => recordToy(toyFactory.create(world)),
  restore: snapshot => recordToy(toyFactory.restore(snapshot)),
};
