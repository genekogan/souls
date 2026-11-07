// Explicit fresh owned-world boundary; never installs or grants a pilot itself.
import {hashOf,type EngineFactory,type EngineSnapshot} from '@souls/engine-contract';
import {MarsEngine,EDEN_SAFE_COMMONS_WORLD,type MarsWorldConfig,type MarsPhysicalBinding} from './engine.ts';
import {loadMars} from './load.ts';
import {connectedCommonsBoatFixture} from './connected-boat.ts';
export async function connectedCommonsBoatFactory(options?:{helmV1?:true;bodyLocationV1?:true}):Promise<EngineFactory>{
  const m=await loadMars(),native=await connectedCommonsBoatFixture(options);
  const cfg:MarsWorldConfig={...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true,walkBlockV1:true};
  // Commit the complete native rules identity without exceeding the existing
  // 200-character W address. No widening or truncation of the public codec.
  const bindingVersion='connected-boat-adapter/1+'+hashOf(native.rulesVersion);
  const rulesVersion='sim-mars/1+'+bindingVersion+'+crew-removal/1+commons/1+arrival-clearance/1+walk-block/1';
  const binding:MarsPhysicalBinding={rulesVersion:bindingVersion,
    renderScene(){const scene=native.renderScene();scene.shore!.rulesVersion=rulesVersion;return scene;},restore:native.restore,services:native.servicesForWorld,
    ...(native.helmControls?{boatControls:native.helmControls}:{}),
    ...(native.bodyLocation?{bodyLocation:native.bodyLocation}:{}),
    prepareRemoval(rt,id){
      const e=rt.world.entities[id],p=e?.human?.boatPassenger,v=rt.world.entities[native.policy.boatId];
      if(native.helmV1&&v?.boat)v.boat.pilotIds=v.boat.pilotIds.filter((actor:string)=>actor!==id);
      if(!p&&!e?.human?.boatTransit){
        if(v?.boat&&Object.values(v.boat.passengers).includes(id))return false;
        if(v?.boat)v.boat.pilotIds=v.boat.pilotIds.filter((actor:string)=>actor!==id);return true;
      }
      // Do not cancel another owner's ongoing trip or delete a committed
      // transfer. Away from dock retirement honestly remains physically pending.
      if(!p||p.boatId!==native.policy.boatId||!Object.hasOwn(native.layout.seats,p.slotId)||v?.boat?.passengers[p.slotId]!==id)return false;
      if(rt.holder('actor:'+id).length||rt.holder('boat:'+native.policy.boatId).length)return false;
      const params={actor:id,slot:p.slotId},action=rt.registry.get('boat_leave');
      if(action?.plan(rt,params).ok)rt.submit('boat_leave',params);
      return false;
    }};
  return {rulesVersion,canReplayHistory:v=>v===rulesVersion,canRestoreSnapshot:v=>v===rulesVersion,
    genesis:seed=>native.genesis(seed),create:world=>new MarsEngine(m,native.create(world as any),cfg,undefined,binding),
    restore(raw:EngineSnapshot){
      const s=structuredClone(raw) as EngineSnapshot&{physicalBinding?:string;mars:any;cfg:MarsWorldConfig;programs:any[];nextProg:number;leaving:string[];quiet?:boolean;commonsVersion?:string};
      if(s.format!=='sim-mars-snapshot/1'||s.physicalBinding!==binding.rulesVersion||s.commonsVersion!=='commons/1')throw new Error('connected-boat.snapshot-binding-differs');
      const {clock,sleepBlockTicks,quietSeatCourtesy,...physicalCfg}=s.cfg??{};
      if(hashOf(physicalCfg)!==hashOf(cfg))throw new Error('connected-boat.snapshot-policy-differs');
      const e=new MarsEngine(m,native.restore(s.mars),s.cfg,{programs:s.programs,nextProg:s.nextProg,leaving:s.leaving,renderPlatformsV1:(s as any).renderPlatformsV1},binding);
      if(s.quiet)e.beginQuiet();
      if(e.stateHash()!==s.stateHash||e.world.tick!==s.tick)throw new Error('connected-boat.snapshot-state-differs');return e;
    },
    validateHistoryHead(e,recorded){if(e.rulesVersion!==recorded||recorded!==rulesVersion)throw new Error('connected-boat.history-head-differs');},
  };
}
export const connectedCommonsHelmFactory=()=>connectedCommonsBoatFactory({helmV1:true});
export const connectedCommonsLocationFactory=()=>connectedCommonsBoatFactory({helmV1:true,bodyLocationV1:true});
