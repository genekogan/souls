import {existingGreenLandmarkV1} from './green-landmark.ts';
import {socialEdenV1} from './social-eden.ts';
import {commonsFoodDeliveryItemsV1} from './food-delivery.ts';
import type {CommonsFoodDeliveryV1} from '@souls/engine-contract';
import {hashOf,type EngineFactory,type EngineSnapshot} from '@souls/engine-contract';
import {MarsEngine,EDEN_SAFE_COMMONS_WORLD,type MarsWorldConfig} from './engine.ts';
import {commonsKitchenFactory} from './commons-kitchen-engine.ts';
import {createRetainedCommonsShoreReader} from './retained-shore.ts';
import {loadMars} from './load.ts';
import {commonsProvisions} from './commons-provisions.ts';
import {commonsKitchen} from './commons-kitchen.ts';

/** Old genesis and all prior provisions/kitchen facts remain authoritative. */
export async function retainedCommonsShoreFactory(options?:{foodDeliveryV1?:boolean;socialEdenV1?:boolean;greenLandmarkV1?:boolean;origin?:EngineFactory}):Promise<EngineFactory>{
  const old=options?.origin??await commonsKitchenFactory({version:'commons-kitchen/2'}),reader=await createRetainedCommonsShoreReader(),m=await loadMars();
  const cfg={...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true,walkBlockV1:true};
  const prefix='sim-mars/1+'+reader.rulesVersion+'+crew-removal/1+commons/1+arrival-clearance/1+walk-block/1';
  const nextVersions=new Set([prefix,prefix+'+commons-provisions/1',prefix+'+commons-provisions/1+commons-kitchen/1',prefix+'+commons-provisions/1+commons-kitchen/2']);
  const install=(e:ReturnType<EngineFactory['create']>)=>{if(!(e instanceof MarsEngine))throw Error('retained-shore.native-required');e.installRetainedCommonsShoreReader(reader);if(options?.foodDeliveryV1)e.enableCommonsFoodDeliveryReaderV1();if(options?.socialEdenV1)e.enableSocialEdenReaderV1();if(options?.greenLandmarkV1)e.enableExistingGreenLandmarkReaderV1();return e;};
  const physicalCfg=({clock,sleepBlockTicks,quietSeatCourtesy,fixtureGroundGoalsV1,nativeArrivalWitnessV1,quietLandingCourtesyV1,...rest}:MarsWorldConfig)=>rest;
  const bareVersion=(v:string)=>v.replace(/\+g\/1$/,'').replace(/\+social-eden\/1$/,'').replace(/\+fd\/1$/,'');
  const enabledVersion=(v:string)=>(!v.includes('+g/1')||options?.greenLandmarkV1===true)&&(!v.includes('+social-eden/1')||options?.socialEdenV1===true)&&(!v.includes('+fd/1')||options?.foodDeliveryV1===true);
  return {rulesVersion:old.rulesVersion,genesis:old.genesis,create:w=>install(old.create(w)),
    canReplayHistory:v=>{const bare=bareVersion(v);return enabledVersion(v)&&(old.canReplayHistory?.(bare)===true||nextVersions.has(bare));},
    canRestoreSnapshot:v=>{const bare=bareVersion(v);return enabledVersion(v)&&(old.canRestoreSnapshot?.(bare)===true||nextVersions.has(bare));},
    restore(raw:EngineSnapshot){
      const green=(raw as EngineSnapshot&{greenLandmarkV1?:boolean}).greenLandmarkV1===true;if(green&&!options?.greenLandmarkV1)throw Error('green-landmark.reader-required');
      const social=(raw as EngineSnapshot&{socialEdenV1?:boolean;greenLandmarkV1?:boolean}).socialEdenV1===true;if(social&&!options?.socialEdenV1)throw Error('social-eden.reader-required');
      const deliveries=(raw as EngineSnapshot&{foodDeliveriesV1?:CommonsFoodDeliveryV1[]}).foodDeliveriesV1??[];if(deliveries.length&&!options?.foodDeliveryV1)throw Error('food-delivery.reader-required');
      if(!('physicalBinding' in raw)){const e=install(old.restore(raw));if(options?.foodDeliveryV1||deliveries.length)e.enableCommonsFoodDeliveryReaderV1(deliveries);if(social){const add=socialEdenV1();if(!Object.keys(add.entities).every(id=>e.world.entities[id])||!Object.keys(add.regions).every(id=>e.world.regions[id]))throw Error('social-eden.snapshot-incomplete');e.enableSocialEdenReaderV1(true);}if(green){if(!e.world.regions[existingGreenLandmarkV1().id])throw Error('green-landmark.snapshot-incomplete');e.enableExistingGreenLandmarkReaderV1(true);}if(e.stateHash()!==raw.stateHash)throw Error('food-delivery.snapshot-state');return e;}
      const s=structuredClone(raw) as EngineSnapshot&{physicalBinding:string;mars:any;cfg:MarsWorldConfig;programs:any[];nextProg:number;leaving:string[];quiet?:boolean;commonsVersion?:string;commonsProvisionsV1?:boolean;commonsKitchenV1?:boolean;commonsKitchenVersion?:'commons-kitchen/1'|'commons-kitchen/2'};
      if(s.format!=='sim-mars-snapshot/1'||s.physicalBinding!==reader.rulesVersion||s.commonsVersion!=='commons/1'||hashOf(physicalCfg(s.cfg))!==hashOf(cfg))throw Error('retained-shore.snapshot-binding');
      if(s.commonsKitchenV1&&!s.commonsProvisionsV1)throw Error('retained-shore.snapshot-resource-policy');
      if(!s.commonsKitchenV1&&s.commonsKitchenVersion!==undefined)throw Error('retained-shore.snapshot-resource-policy');
      const e=install(new MarsEngine(m,reader.restore(s.mars),s.cfg,{programs:s.programs,nextProg:s.nextProg,leaving:s.leaving,renderPlatformsV1:(s as any).renderPlatformsV1},reader));
      e.enableCommonsProvisionsReaderV1(s.commonsProvisionsV1===true);e.enableCommonsKitchenReaderV1(s.commonsKitchenV1===true,s.commonsKitchenVersion??'commons-kitchen/1');
      if(s.commonsProvisionsV1){const p=commonsProvisions();if(!Object.keys(p.entities).every(id=>e.world.entities[id])||!Object.keys(p.regions).every(id=>e.world.regions[id]))throw Error('retained-shore.snapshot-resource-policy');}
      if(s.commonsKitchenV1&&!Object.keys(commonsKitchen(s.commonsKitchenVersion??'commons-kitchen/1').entities).every(id=>e.world.entities[id]))throw Error('retained-shore.snapshot-resource-policy');
      if(deliveries.length){if(!deliveries.every(d=>Object.keys(commonsFoodDeliveryItemsV1(d.batch).entities).every(id=>e.world.entities[id])))throw Error('food-delivery.snapshot-incomplete');e.enableCommonsFoodDeliveryReaderV1(deliveries);}
      if(social){const add=socialEdenV1();if(!Object.keys(add.entities).every(id=>e.world.entities[id])||!Object.keys(add.regions).every(id=>e.world.regions[id]))throw Error('social-eden.snapshot-incomplete');e.enableSocialEdenReaderV1(true);}
      if(green){if(!e.world.regions[existingGreenLandmarkV1().id])throw Error('green-landmark.snapshot-incomplete');e.enableExistingGreenLandmarkReaderV1(true);}
      if(s.quiet)e.beginQuiet();
      if(!nextVersions.has(bareVersion(e.rulesVersion))||e.world.tick!==s.tick||e.stateHash()!==s.stateHash)throw Error('retained-shore.snapshot-state');
      return e;
    },
    validateHistoryHead(e,recorded){if(e.rulesVersion!==recorded||!(old.canReplayHistory?.(bareVersion(recorded))||nextVersions.has(bareVersion(recorded))))throw Error('retained-shore.history-head');},
  };
}
