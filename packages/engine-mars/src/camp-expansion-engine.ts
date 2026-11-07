import {hashOf,type EngineFactory,type EngineSnapshot} from '@souls/engine-contract';
import {decodeSnapshot} from '../../../mars/viewer/engine/runtime/snapshot.ts';
import {loadMars} from './load.ts';
import {marsFactory,MarsEngine,type MarsWorldConfig} from './engine.ts';
import {createCampExpansion} from './camp-expansion.ts';
import {disassemblyRegistry} from '../../../mars/viewer/engine/construction/disassembly.ts';

/** Historical genesis stays unchanged. Only a validated, logged transition
 * can make the additional native ground infrastructure part of that history. */
export async function marsCampExpansionFactory(cfg?:MarsWorldConfig):Promise<EngineFactory>{
  const old=await marsFactory(cfg),m=await loadMars(),native=createCampExpansion(m,cfg?.disassemblyV1?()=>disassemblyRegistry(m.createRegistry):undefined);
  const origin=old.create(old.genesis('policy')) as MarsEngine;
  const initial=(origin.snapshot() as EngineSnapshot&{cfg:MarsWorldConfig}).cfg;
  if(!['proving-ground','eden-camp'].includes(initial.scene))throw new Error('camp-expansion.factory-origin');
  const camp=initial.scene==='eden-camp'?initial:{...initial,scene:'eden-camp' as const,arrival:[-3,18] as [number,number],reference:[-1,17] as [number,number],arrivalPlace:'arrival'};
  const rulesVersion=m.rulesVersion+'+camp-ground-expansion/1',reader={...native,rulesVersion};
  const next=old.rulesVersion.replace('sim-mars/1+'+m.rulesVersion,'sim-mars/1+'+rulesVersion);
  const allowed=(v:string)=>old.canReplayHistory?.(v)===true||v===next;
  const install=(engine:MarsEngine)=>{engine.installCampExpansionReader(reader);return engine;};
  const physicalCfg=({clock,sleepBlockTicks,quietSeatCourtesy,...rest}:MarsWorldConfig)=>rest;
  return {rulesVersion:old.rulesVersion,canReplayHistory:allowed,canRestoreSnapshot:v=>old.canRestoreSnapshot?.(v)===true||v===next,
    genesis:old.genesis,
    create(world){if(hashOf(world.base)!==hashOf(old.genesis('base').base))throw new Error('camp-expansion.genesis-base');return install(old.create(world) as MarsEngine);},
    restore(raw:EngineSnapshot){
      if(!('physicalBinding' in raw))return install(old.restore(raw) as MarsEngine);
      const s=structuredClone(raw) as EngineSnapshot&{physicalBinding?:string;mars:any;cfg:MarsWorldConfig;programs:any[];nextProg:number;leaving:string[];quiet?:boolean};
      if(s.format!=='sim-mars-snapshot/1'||s.physicalBinding!==rulesVersion||hashOf(physicalCfg(s.cfg))!==hashOf(physicalCfg(camp)))throw new Error('camp-expansion.snapshot-binding');
      if(hashOf(decodeSnapshot(s.mars).world.base)!==hashOf(native.base))throw new Error('camp-expansion.snapshot-base');
      const engine=install(new MarsEngine(m,native.restore(s.mars),s.cfg,{programs:s.programs,nextProg:s.nextProg,leaving:s.leaving,renderPlatformsV1:(s as any).renderPlatformsV1},reader));
      if(s.quiet)engine.beginQuiet();
      if(engine.stateHash()!==s.stateHash||engine.world.tick!==s.tick)throw new Error('camp-expansion.snapshot-state');
      return engine;
    },validateHistoryHead(engine,recorded){if(engine.rulesVersion!==recorded||!allowed(recorded))throw new Error('camp-expansion.history-head');},
  };
}
