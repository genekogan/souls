// Explicit fresh-world adapter. No existing-world transition or default switch.
import {hashOf,type EngineFactory,type EngineSnapshot} from '@souls/engine-contract';
import {MarsEngine,EDEN_SAFE_COMMONS_WORLD,type MarsWorldConfig,type MarsPhysicalBinding} from './engine.ts';
import {loadMars} from './load.ts';
import {connectedCommonsShoreFixture} from './connected-shore.ts';
export async function connectedCommonsShoreFactory():Promise<EngineFactory>{
  const m=await loadMars(),native=await connectedCommonsShoreFixture();
  const cfg:MarsWorldConfig={...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true,walkBlockV1:true};
  const bindingVersion=native.rulesVersion+'+connected-adapter/1';
  const rulesVersion='sim-mars/1+'+bindingVersion+'+crew-removal/1+commons/1+arrival-clearance/1+walk-block/1';
  const binding:MarsPhysicalBinding={rulesVersion:bindingVersion,
    renderScene(){const scene=native.renderScene();scene.shore!.rulesVersion=rulesVersion;return scene;},restore:native.restore,services:native.servicesForWorld};
  return {rulesVersion,canReplayHistory:v=>v===rulesVersion,canRestoreSnapshot:v=>v===rulesVersion,
    genesis:seed=>native.genesis(seed),
    create:world=>new MarsEngine(m,native.create(world as any),cfg,undefined,binding),
    restore(raw:EngineSnapshot){
      const s=structuredClone(raw) as EngineSnapshot&{physicalBinding?:string;mars:any;cfg:MarsWorldConfig;programs:any[];nextProg:number;leaving:string[];quiet?:boolean;commonsVersion?:string};
      if(s.format!=='sim-mars-snapshot/1'||s.physicalBinding!==binding.rulesVersion||s.commonsVersion!=='commons/1')throw new Error('connected.snapshot-binding-differs');
      const {clock,sleepBlockTicks,quietSeatCourtesy,...physicalCfg}=s.cfg??{};
      if(hashOf(physicalCfg)!==hashOf(cfg))throw new Error('connected.snapshot-policy-differs');
      const e=new MarsEngine(m,native.restore(s.mars),s.cfg,{programs:s.programs,nextProg:s.nextProg,leaving:s.leaving,renderPlatformsV1:(s as any).renderPlatformsV1},binding);
      if(s.quiet)e.beginQuiet();
      if(e.stateHash()!==s.stateHash||e.world.tick!==s.tick)throw new Error('connected.snapshot-state-differs');
      return e;
    },
    validateHistoryHead(e,recorded){if(e.rulesVersion!==recorded||recorded!==rulesVersion)throw new Error('connected.history-head-differs');},
  };
}
