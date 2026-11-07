import {type Engine,type EngineFactory,type EngineSnapshot,type CommonsFoodDeliveryV1} from '@souls/engine-contract';
import {MarsEngine} from './engine.ts';
import {commonsProvisions} from './commons-provisions.ts';
import {commonsKitchen} from './commons-kitchen.ts';
import {commonsFoodDeliveryItemsV1} from './food-delivery.ts';
/** Compose life resources over C208's actual origin reader; no replacement genesis. */
export function commonsLifeReaderFactory(origin:EngineFactory):EngineFactory {
 const bare=(v:string)=>v.replace(/\+fd\/1$/,'').replace(/\+commons-kitchen\/[12]$/,'').replace(/\+commons-provisions\/1$/,'');
 const allowed=(v:string)=>origin.canReplayHistory?.(bare(v))===true&&/^(?:\+commons-provisions\/1(?:\+commons-kitchen\/[12])?(?:\+fd\/1)?)?$/.test(v.slice(bare(v).length));
 const install=(e:Engine)=>{if(!(e instanceof MarsEngine))throw Error('commons-life.native-required');e.enableCommonsProvisionsReaderV1();e.enableCommonsKitchenReaderV1(false,'commons-kitchen/2');e.enableCommonsFoodDeliveryReaderV1();return e;};
 return {rulesVersion:origin.rulesVersion,genesis:origin.genesis,create:w=>install(origin.create(w)),canReplayHistory:allowed,canRestoreSnapshot:v=>allowed(v)&&origin.canRestoreSnapshot?.(bare(v))===true,
  restore(raw:EngineSnapshot){
   const s=structuredClone(raw) as EngineSnapshot&{commonsProvisionsV1?:boolean;commonsKitchenV1?:boolean;commonsKitchenVersion?:'commons-kitchen/1'|'commons-kitchen/2';foodDeliveriesV1?:CommonsFoodDeliveryV1[];socialEdenV1?:boolean};
   if('physicalBinding' in s||s.socialEdenV1||(s as EngineSnapshot&{cfg?:{nativeArrivalWitnessV1?:boolean}}).cfg?.nativeArrivalWitnessV1)throw Error('commons-life.additional-reader-required');
   for(const key of ['commonsProvisionsV1','commonsKitchenV1'] as const)if(s[key]!==undefined&&typeof s[key]!=='boolean')throw Error('commons-life.snapshot-policy');
   const provisions=s.commonsProvisionsV1===true,kitchen=s.commonsKitchenV1===true,version=s.commonsKitchenVersion??'commons-kitchen/1',deliveries=s.foodDeliveriesV1??[];
   if(version!=='commons-kitchen/1'&&version!=='commons-kitchen/2')throw Error('commons-life.snapshot-policy');
   if(kitchen&&!provisions||deliveries.length&&!provisions||!kitchen&&s.commonsKitchenVersion!==undefined)throw Error('commons-life.snapshot-policy');
   delete s.commonsProvisionsV1;delete s.commonsKitchenV1;delete s.commonsKitchenVersion;delete s.foodDeliveriesV1;
   const e=install(origin.restore(s));e.enableCommonsProvisionsReaderV1(provisions);e.enableCommonsKitchenReaderV1(kitchen,kitchen?version:'commons-kitchen/2');e.enableCommonsFoodDeliveryReaderV1(deliveries);
   if(provisions){const p=commonsProvisions();if(!Object.keys(p.entities).every(id=>e.world.entities[id])||!Object.keys(p.regions).every(id=>e.world.regions[id]))throw Error('commons-life.snapshot-provisions');}
   if(kitchen&&!Object.keys(commonsKitchen(version).entities).every(id=>e.world.entities[id]))throw Error('commons-life.snapshot-kitchen');
   if(deliveries.some(d=>!Object.keys(commonsFoodDeliveryItemsV1(d.batch).entities).every(id=>e.world.entities[id])))throw Error('commons-life.snapshot-delivery');
   if(!allowed(e.rulesVersion)||e.stateHash()!==raw.stateHash)throw Error('commons-life.snapshot-state');return e;
  },validateHistoryHead(e,recorded){if(e instanceof MarsEngine&&e.nativeArrivalWitnessEnabledV1)throw Error('commons-life.additional-reader-required');if(e.rulesVersion!==recorded||!allowed(recorded))throw Error('commons-life.history-head');},
 };
}
