import type {EngineFactory,EngineSnapshot} from '@souls/engine-contract';
import {MarsEngine,marsFactory,EDEN_SAFE_COMMONS_WORLD} from './engine.ts';
import {commonsProvisions} from './commons-provisions.ts';
export async function commonsProvisionsFactory():Promise<EngineFactory>{
  const old=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true}),version=old.rulesVersion+'+commons-provisions/1';
  const install=(e:ReturnType<EngineFactory['create']>,active=false)=>{if(!(e instanceof MarsEngine))throw Error('commons-provisions.native-required');e.enableCommonsProvisionsReaderV1(active);return e;};
  return {rulesVersion:old.rulesVersion,genesis:old.genesis,create:w=>install(old.create(w)),
    canReplayHistory:v=>v===old.rulesVersion||v===version,canRestoreSnapshot:v=>v===old.rulesVersion||v===version,
    restore(snap:EngineSnapshot){const s=structuredClone(snap) as EngineSnapshot&{commonsProvisionsV1?:boolean};const active=s.commonsProvisionsV1===true;delete s.commonsProvisionsV1;
      const e=install(old.restore(s),active);if(active){const p=commonsProvisions();if(!Object.keys(p.entities).every(id=>e.world.entities[id])||!Object.keys(p.regions).every(id=>e.world.regions[id]))throw Error('commons-provisions.snapshot-incomplete');}return e;},
    validateHistoryHead(e,recorded){if(e.rulesVersion!==recorded)throw Error('commons-provisions.history-head-differs');}};
}
