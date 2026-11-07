import {commonsNewcomerResourcesV1Schema,hashOf,type CommonsNewcomerResourcesV1,type Engine,type EngineFactory,type EngineSnapshot} from '@souls/engine-contract';
import {MarsEngine} from './engine.ts';
import {commonsNewcomerResourcesV1} from './newcomer-resources.ts';
/** Explicit opt-in reader over the exact existing origin, never a fresh genesis. */
export function commonsNewcomerResourcesFactory(origin:EngineFactory):EngineFactory{
 const bare=(v:string)=>v.replace('+cp/2','+commons-provisions/1'),install=(e:Engine,records:CommonsNewcomerResourcesV1[]=[] )=>{if(!(e instanceof MarsEngine))throw Error('newcomer-resources.native-required');e.enableCommonsNewcomerReaderV1(records);return e;};
 return {rulesVersion:origin.rulesVersion,genesis:origin.genesis,create:w=>install(origin.create(w)),canReplayHistory:v=>origin.canReplayHistory?.(bare(v))===true,canRestoreSnapshot:v=>origin.canRestoreSnapshot?.(bare(v))===true,
  restore(raw:EngineSnapshot){
   if('nativeSleepSnapshotV1' in raw)throw Error('sleep-snapshot.outer-reader-required');
   const s=structuredClone(raw) as EngineSnapshot&{commonsNewcomerResourcesV1?:CommonsNewcomerResourcesV1[];newcomerBaseStateHash?:string};const facts=(s.commonsNewcomerResourcesV1??[]).map(f=>commonsNewcomerResourcesV1Schema.parse(f));
   if(facts.length&&!/^[a-f0-9]{64}$/.test(s.newcomerBaseStateHash??''))throw Error('newcomer-resources.snapshot-base-hash');if(!facts.length&&(s.newcomerBaseStateHash!==undefined||s.commonsNewcomerResourcesV1!==undefined))throw Error('newcomer-resources.snapshot-policy');
   if(facts.length)s.stateHash=s.newcomerBaseStateHash!;delete s.commonsNewcomerResourcesV1;delete s.newcomerBaseStateHash;
   const e=install(origin.restore(s),facts);
   for(const f of facts){const add=commonsNewcomerResourcesV1(f.firstSlot,f.placements);if(add.hash!==f.additionsHash||Object.keys(add.entities).some(id=>!e.world.entities[id])||Object.entries(add.regions).some(([id,r])=>hashOf(e.world.regions[id])!==hashOf(r)))throw Error('newcomer-resources.snapshot-incomplete');}
   if(e.stateHash()!==raw.stateHash)throw Error('newcomer-resources.snapshot-state');return e;
  },validateHistoryHead(e,recorded){if(e.rulesVersion!==recorded||origin.canReplayHistory?.(bare(recorded))!==true)throw Error('newcomer-resources.history-head');},
 };
}
