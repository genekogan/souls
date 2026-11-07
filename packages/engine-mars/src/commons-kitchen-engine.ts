import type {EngineFactory,EngineSnapshot} from '@souls/engine-contract';
import {MarsEngine} from './engine.ts';
import {commonsProvisionsFactory} from './commons-provisions-engine.ts';
import {commonsKitchen,type CommonsKitchenVersion} from './commons-kitchen.ts';
export async function commonsKitchenFactory(options?:{version?:CommonsKitchenVersion}):Promise<EngineFactory>{
  const old=await commonsProvisionsFactory(),provisionVersion=old.rulesVersion+'+commons-provisions/1',versions=[provisionVersion+'+commons-kitchen/1',provisionVersion+'+commons-kitchen/2'];
  const install=(e:ReturnType<EngineFactory['create']>,active=false,version:CommonsKitchenVersion=options?.version??'commons-kitchen/1')=>{if(!(e instanceof MarsEngine))throw Error('commons-kitchen.native-required');e.enableCommonsKitchenReaderV1(active,version);return e;};
  return {rulesVersion:old.rulesVersion,genesis:old.genesis,create:w=>install(old.create(w)),
    canReplayHistory:v=>old.canReplayHistory?.(v)===true||versions.includes(v),canRestoreSnapshot:v=>old.canRestoreSnapshot?.(v)===true||versions.includes(v),
    restore(snap:EngineSnapshot){const s=structuredClone(snap) as EngineSnapshot&{commonsKitchenV1?:boolean;commonsKitchenVersion?:CommonsKitchenVersion};const active=s.commonsKitchenV1===true;if(!active&&s.commonsKitchenVersion!==undefined)throw Error('commons-kitchen.snapshot-version');const version=s.commonsKitchenVersion??'commons-kitchen/1';if(version!=='commons-kitchen/1'&&version!=='commons-kitchen/2')throw Error('commons-kitchen.snapshot-version');delete s.commonsKitchenV1;delete s.commonsKitchenVersion;
      const e=install(old.restore(s),active,active?version:options?.version);if(active&&!Object.keys(commonsKitchen(version).entities).every(id=>e.world.entities[id]))throw Error('commons-kitchen.snapshot-incomplete');return e;},
    validateHistoryHead(e,recorded){if(e.rulesVersion!==recorded)throw Error('commons-kitchen.history-head-differs');}};
}
