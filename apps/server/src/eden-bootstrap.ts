// Source-owned installer for the existing Eden control plane. Explicitly
// selected by main; no default factory or environment/config value changes.
import {marsFactory,marsCommonsTransitionFactory,marsCrewRemovalTransitionFactory,GREEN_FIELD_WORLD,EDEN_SAFE_COMMONS_WORLD,commonsLifeReaderFactory,retainedCommonsShoreFactory,commonsNewcomerResourcesFactory,nativeSleepSnapshotFactoryV1,edenLectureFactoryV1,edenGroundFactoryV1} from '@souls/engine-mars';
import {readFileSync} from 'node:fs';
import type {EngineFactory} from '@souls/engine-contract';
import type {Db} from './db.ts';
import type {WorldHost} from './world.ts';
import type {Config} from './config.ts';
import type {LivingWorld} from './living.ts';
import type {Brain} from './brain.ts';
import type {IntentControlV2} from './intent-control.ts';

export function edenCoreRequested(cfg:Config,env:NodeJS.ProcessEnv){return cfg.worldKey==='eden'&&cfg.engine==='mars'&&env.ENABLE_EDEN_CORE==='1';}
export async function edenHistoryFactory(db:Db,worldId:string,options?:{lifeV1?:boolean;newcomerResourcesV1?:boolean;sleepSnapshotV1?:boolean;lectureV1?:boolean;groundV1?:boolean}):Promise<EngineFactory>{
  const header=db.world(worldId);
  if(header?.rules_version.includes('+eg/1')&&!options?.groundV1)throw Error('eden-bootstrap.explicit-ground-extension-reader-required');
  if(options?.groundV1&&!options.lifeV1)throw Error('eden-bootstrap.ground-extension-reader-requires-life');
  if(header?.rules_version.includes('+l/1')&&!options?.lectureV1)throw Error('eden-bootstrap.explicit-lecture-reader-required');
  if(options?.lectureV1&&!options.lifeV1)throw Error('eden-bootstrap.lecture-reader-requires-life');
  if(options?.sleepSnapshotV1&&!options.lifeV1)throw Error('eden-bootstrap.sleep-snapshot-reader-requires-life');
  if(header?.rules_version.endsWith('+ss/1')&&!options?.sleepSnapshotV1)throw Error('eden-bootstrap.explicit-sleep-snapshot-reader-required');
  if(options?.newcomerResourcesV1&&!options.lifeV1)throw Error('eden-bootstrap.newcomer-reader-requires-life');
  if(header?.rules_version.includes('+cp/2')&&!options?.newcomerResourcesV1)throw Error('eden-bootstrap.explicit-newcomer-reader-required');
  if(options?.lifeV1){const origin=header?.rules_version.includes('retained-shore/1')?await retainedCommonsShoreFactory({foodDeliveryV1:header.rules_version.includes('+fd/1'),socialEdenV1:header.rules_version.includes('+social-eden/1'),greenLandmarkV1:header.rules_version.includes('+g/1')}):await retainedCommonsShoreFactory({origin:commonsLifeReaderFactory(await edenOriginHistoryFactory(db,worldId)),foodDeliveryV1:true,socialEdenV1:true});const physical=options.groundV1?await edenGroundFactoryV1(origin):origin,resources=options.newcomerResourcesV1?commonsNewcomerResourcesFactory(physical):physical,lecture=options.lectureV1?edenLectureFactoryV1(resources):resources;return options.sleepSnapshotV1?nativeSleepSnapshotFactoryV1(lecture):lecture;}
  return edenOriginHistoryFactory(db,worldId);
}
async function edenOriginHistoryFactory(db:Db,worldId:string):Promise<EngineFactory>{
  const header=db.world(worldId);
  if(!header)return marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
  const policy=db.db.prepare("SELECT seq FROM events WHERE world_id=? AND kind='rules' AND json_extract(payload,'$.crewRemovalTransition.contract')='crew-removal-transition/1' ORDER BY seq LIMIT 1").get(worldId);
  if(policy)return marsCrewRemovalTransitionFactory();
  const physical=db.db.prepare("SELECT payload FROM events WHERE world_id=? AND kind='rules' AND json_extract(payload,'$.commonsTransition.contract')='commons-transition/1' ORDER BY seq LIMIT 1").get(worldId) as {payload:string}|undefined;
  const originalRules=physical?JSON.parse(physical.payload).commonsTransition.fromRulesVersion:header.rules_version;
  if(!physical&&header.rules_version.includes('+commons/1'))return marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
  if(originalRules.includes('+crew-removal/1'))return marsCommonsTransitionFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true},{safeArrivalV1:true});
  return marsCrewRemovalTransitionFactory();
}

export async function installEdenCore(host:WorldHost,options:{applyCrew:boolean;applyCommons:boolean;retainReader?:boolean}){
  if(options.retainReader){if(options.applyCrew||options.applyCommons)throw Error('eden-bootstrap.retain-reader-cannot-install');return [];}
  const crew=!host.engine.rulesVersion.includes('+crew-removal/1'),commons=!['eden-commons','eden-commons-shore/1','eden-commons-shore-expanded/1'].includes(host.engine.world.base.campus);
  if(crew&&!options.applyCrew)throw Error('eden-bootstrap.explicit-crew-checkpoint-required');
  if(commons&&!options.applyCommons)throw Error('eden-bootstrap.explicit-commons-checkpoint-required');
  if((crew||commons)&&host.stationHistoryV1())throw Error('eden-bootstrap.station-carry-required');
  if(crew||commons){
    // Preview both steps on detached resumable native data before committing
    // either. Never erase a successfully committed prefix after a later fault.
    if(!host.engine.canSnapshot?.())throw Error('eden-bootstrap.resumable-boundary-required');
    const copy=host.factory.restore(host.engine.snapshot());
    if(copy.stateHash()!==host.engine.stateHash())throw Error('eden-bootstrap.preview-restore-differs');
    if(crew){const p=copy.previewCrewRemovalTransitionV1?.();if(!p?.ok)throw Error(p?p.diagnostic.code:'eden-bootstrap.crew-reader-unavailable');copy.adoptCrewRemovalTransitionV1!(p.transition);}
    if(commons){const p=copy.previewCommonsTransition?.();if(!p?.ok)throw Error(p?p.diagnostic.code:'eden-bootstrap.commons-reader-unavailable');
      const known=new Set(host.engine.anchors().map(a=>a.id));for(const a of p.anchors)if(!known.has(a.id)&&host.kernel.things[a.id])throw Error('eden-bootstrap.kernel-collision');}
  }
  const facts=[];
  if(crew){const p=host.adoptCrewRemovalPolicyV1('operator:eden-core-bootstrap');host.drainInputs();facts.push(await p);}
  if(commons){const p=host.adoptCommons('operator:eden-core-bootstrap');host.drainInputs();facts.push(await p);}
  if(!host.engine.rulesVersion.includes('+crew-removal/1')||!['eden-commons','eden-commons-shore/1','eden-commons-shore-expanded/1'].includes(host.engine.world.base.campus))throw Error('eden-bootstrap.installation-incomplete');
  return facts;
}

export async function settleEmptyEden(host:WorldHost,living:LivingWorld|null,customs:string[]){
  if(!living)return;
  const installation=living.install(customs);host.drainInputs();await installation;
  if(host.minds.size===0&&host.living!.lastDay<0){for(let i=0;i<4;i++){host.tickOnce();host.drainInputs();}if(host.quietBarrier)throw Error('eden-bootstrap.empty-renewal-unsettled');}
}

/** Quiesce before calling. Clock/DB remain alive, including an explicitly
 * paused clock whose sequencer still must finish already accepted writes. */
export async function drainEdenThought(host:WorldHost,brain:Brain,service:IntentControlV2|undefined,acceptedRequests:Promise<unknown>=Promise.resolve(),additional:readonly (()=>Promise<unknown>)[]=[]){
  brain.quiesce();
  let fail!:(error:unknown)=>void;const failure=new Promise<never>((_,reject)=>fail=reject);
  const pump=setInterval(()=>{try{host.drainInputs();}catch(error){fail(error);clearInterval(pump);}},10);
  const drain=async()=>{await acceptedRequests;await Promise.all([brain.settled(),service?.settled(),...additional.map(settle=>settle())]);await brain.settled();host.drainInputs();};
  try{await Promise.race([drain(),failure]);}
  finally{clearInterval(pump);}
}

export type EdenLifeHandlesV1={settled():Promise<void>;close():void};
/** Production-compatible opt-in composition: real Config/Auth stay in main; no dev owner or local budget override. */
export async function installEdenLifeV1(host:WorldHost,brain:Brain,options:{retainReader?:boolean;foodDeliveryId?:string}={}):Promise<EdenLifeHandlesV1>{
  if(options.retainReader)return {async settled(){},close(){}};
  if(brain.host!==host||brain.cfg.worldKey!=='eden'||!host.living)throw Error('eden-life.opted-in-living-host-required');
  const drive=async<T>(p:Promise<T>)=>{let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await new Promise<void>(r=>setImmediate(r));}if(!done)throw Error('eden-life.bootstrap-unsettled');return p;};
  await drive(host.enableGroundFixtureGoalsV1());await drive(host.enableHumanRestNeedsV1());await drive<unknown>(host.enableIntentSequencesV1());await drive<unknown>(host.enableIntentApproachRetentionV1());await drive(host.enableQuietLandingCourtesyV1());await drive(brain.enableEdenAutonomyV1());
  if(!host.engine.rulesVersion.includes('+commons-provisions/1')&&!host.engine.rulesVersion.includes('+cp/2'))await drive(host.installCommonsProvisionsV1());
  const {followCommonsProvisionBirths}=await import('./commons-provisions.ts'),{scheduleCommonsKitchenInstallation}=await import('./commons-kitchen-install.ts');
  const provisions=await followCommonsProvisionBirths(host,brain),kitchen=scheduleCommonsKitchenInstallation(host,brain);
  const food=options.foodDeliveryId?(await import('./food-delivery.ts')).scheduleFiniteFoodDeliveryV1(host,brain,options.foodDeliveryId):undefined;
  return {async settled(){await provisions.settled();await kitchen.settled();await food?.settled();},close(){provisions.close();kitchen.close();food?.close();}};
}

/** Explicit first-use checkpoints for normal main.ts, preserving current world
 * identity/history. Reader-only restarts cannot install or refill anything. */
export async function installEdenExpansionV1(host:WorldHost,options:{retainReader?:boolean}={}){
 if(options.retainReader){if(!host.engine.rulesVersion.includes('+cp/2')||!host.engine.rulesVersion.includes('+eg/1')||!host.engine.rulesVersion.includes('+l/1')||!host.engine.rulesVersion.endsWith('+ss/1'))throw Error('eden-expansion.retained-complete-reader-required');return [];}
 const drive=async<T>(p:Promise<T>)=>{let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await new Promise<void>(r=>setImmediate(r));}if(!done)throw Error('eden-expansion.bootstrap-unsettled');return p;};
 const facts=[];
 if(!host.engine.rulesVersion.includes('+commons-provisions/1')&&!host.engine.rulesVersion.includes('+cp/2'))facts.push(await drive(host.installCommonsProvisionsV1()));
 if(!/\+commons-kitchen\/[12](?:\+|$)/.test(host.engine.rulesVersion))facts.push(await drive(host.installCommonsKitchenV1()));
 if(!host.engine.rulesVersion.includes('retained-shore/1+'))facts.push(await drive(host.installRetainedCommonsShoreV1()));
 if(!host.engine.rulesVersion.includes('+cp/2')){const layout=JSON.parse(readFileSync(new URL('../../../packages/engine-mars/src/fixtures/newcomer-layout.world-alternative.v2.json',import.meta.url),'utf8'));facts.push(await drive(host.installCommonsNewcomerResourcesV1(layout.placements)));}
 if(!host.engine.rulesVersion.endsWith('+ss/1'))facts.push(await drive(host.installNativeSleepSnapshotV1()));
 if(!host.engine.rulesVersion.includes('+eg/1'))facts.push(await drive(host.installEdenGroundV1()));
 if(!host.engine.rulesVersion.includes('+l/1'))facts.push(await drive(host.installEdenLectureV1({worldEast:'world-v2',id:'eden-classroom-1',origin:[42,-6],yaw:0,audienceSeats:20,lesson:'Eden: observe a world, give a direction, watch what changes.'})));
 return facts;
}
