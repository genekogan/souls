import type {Engine,EngineFactory,EngineSnapshot} from '@souls/engine-contract';
import {GREEN_FIELD_WORLD,MarsEngine,marsCommonsTransitionFactory,marsFactory} from './engine.ts';

/** Deliberate Eden legacy reader, never a replacement default factory.
 * Replays original Greenfield with its original policy until a named fact.
 * Also reads the existing subsequent commons checkpoint; policy adoption and
 * physical adoption are two independently guarded facts. */
export async function marsCrewRemovalTransitionFactory():Promise<EngineFactory>{
  const old=await marsCommonsTransitionFactory(GREEN_FIELD_WORLD,{safeArrivalV1:true});
  const next=await marsCommonsTransitionFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true},{safeArrivalV1:true});
  const versions=new Set([old.rulesVersion,next.rulesVersion,
    (await marsFactory({...GREEN_FIELD_WORLD,scene:'eden-commons',safeArrivalV1:true})).rulesVersion,
    (await marsFactory({...GREEN_FIELD_WORLD,scene:'eden-commons',safeCrewRemoval:true,safeArrivalV1:true})).rulesVersion]);
  const install=(e:Engine)=>{if(!(e instanceof MarsEngine))throw Error('crew-removal-transition.native-reader-required');e.enableCrewRemovalTransitionReaderV1();return e;};
  return {rulesVersion:old.rulesVersion,genesis:old.genesis,
    canReplayHistory:v=>versions.has(v),canRestoreSnapshot:v=>versions.has(v),
    create:world=>install(old.create(world)),
    restore(snapshot:EngineSnapshot){
      const s=snapshot as EngineSnapshot&{cfg?:{safeCrewRemoval?:boolean}};
      if(s.cfg?.safeCrewRemoval!==undefined&&typeof s.cfg.safeCrewRemoval!=='boolean')throw Error('crew-removal-transition.snapshot-policy');
      const engine=install((s.cfg?.safeCrewRemoval?next:old).restore(snapshot));
      if(!versions.has(engine.rulesVersion))throw Error('crew-removal-transition.snapshot-policy');
      return engine;
    },
    validateHistoryHead(engine,recorded){if(engine.rulesVersion!==recorded)throw Error('crew-removal-transition.history-head-differs');},
  };
}
