// Explicit fresh-world drink profile, never an old-history/default switch.
import {hashOf,type EngineFactory,type EngineSnapshot} from '@souls/engine-contract';
import {loadMars} from './load.ts';
import {MarsEngine,type MarsWorldConfig,type MarsPhysicalBinding} from './engine.ts';
import {decodeSnapshot} from '../../../mars/viewer/engine/runtime/snapshot.ts';
import {drinkWater,DRINK_POLICY,qualifiedSeatedDrink} from '../../../mars/viewer/engine/items/drink.ts';
import {humanStaticClearance,humanStaticClearanceWithOverlay} from '../../../mars/viewer/engine/runtime/invariants.ts';
import {readBodyLocation} from './body-location.ts';
export async function nativeCampDrinkFactory():Promise<EngineFactory>{
  const m=await loadMars(),origin=m.edenCampWorld('base'),scene=structuredClone(m.scenes[origin.base.campus]);
  const version=m.rulesVersion+'+drink/1',base={campus:'eden-camp-drink/1',staticHash:hashOf({scene,policy:DRINK_POLICY,rules:version})};
  const registry=m.createRegistry();registry.set(drinkWater.verb,drinkWater);const services=m.servicesFor({...m.scenes,[base.campus]:scene});
  const invariants=m.invariants.map(inv=>inv===humanStaticClearance?humanStaticClearanceWithOverlay(qualifiedSeatedDrink):inv);
  const validate=(w:any)=>{if(hashOf(w.base)!==hashOf(base))throw new Error('drink.snapshot-base');};
  const restore=(snapshot:any)=>{const w=decodeSnapshot(snapshot).world;validate(w);return m.Runtime.restore(snapshot,registry,services(w),invariants);};
  const cfg:MarsWorldConfig={scene:'eden-camp',safeArrivalV1:true,safeCrewRemoval:true,arrival:[-3,18],arrivalPlace:'arrival',reference:[-1,17],grounds:{id:'grounds',name:'Camp grounds'}};
  const binding:MarsPhysicalBinding={rulesVersion:version,restore,services,renderScene:()=>({scene:structuredClone(scene)}),bodyLocation:(rt,actor)=>readBodyLocation(rt,actor,()=>null)};
  const rulesVersion='sim-mars/1+'+version+'+crew-removal/1+arrival-clearance/1';
  return {rulesVersion,canReplayHistory:v=>v===rulesVersion,canRestoreSnapshot:v=>v===rulesVersion,
    genesis(seed){const w=m.edenCampWorld(seed);w.base={...base};return w;},
    create(w){validate(w);return new MarsEngine(m,new m.Runtime(w,registry,services(w),invariants),cfg,undefined,binding);},
    restore(raw){const s=structuredClone(raw) as EngineSnapshot&{physicalBinding?:string;mars:any;cfg:MarsWorldConfig;programs:any[];nextProg:number;leaving:string[];quiet?:boolean};
      const {clock,sleepBlockTicks,quietSeatCourtesy,...policy}=s.cfg??{};if(s.format!=='sim-mars-snapshot/1'||s.physicalBinding!==version||hashOf(policy)!==hashOf(cfg))throw new Error('drink.snapshot-policy');
      const e=new MarsEngine(m,restore(s.mars),s.cfg,{programs:s.programs,nextProg:s.nextProg,leaving:s.leaving,renderPlatformsV1:(s as any).renderPlatformsV1},binding);if(s.quiet)e.beginQuiet();if(e.stateHash()!==s.stateHash)throw new Error('drink.snapshot-state');return e;},
    validateHistoryHead(e,recorded){if(recorded!==rulesVersion||e.rulesVersion!==recorded)throw new Error('drink.history-head');},
  };
}
