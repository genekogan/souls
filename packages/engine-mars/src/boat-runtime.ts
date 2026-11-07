// Explicit new fixture version. Existing shore and living factories stay intact.
import { readFileSync } from 'node:fs';
import { hashOf,nativeShoreSceneV1Schema,shoreAppearanceSourceV1Schema,SHORE_APPEARANCE_SOURCE_V1,type RenderScene } from '@souls/engine-contract';
import { loadMars } from './load.ts';
import { nativeShoreFixture } from './shore-runtime.ts';
import { createWaterGeometryProbe } from './water-geometry.ts';
import { boatActions, boatInvariant, boatBodyContact, boatClearanceInvariant, BOAT_POLICY, BOAT_LAYOUT, type BoatGeometry } from '../../../mars/viewer/engine/vehicles/boat.ts';
import { shoreActions, shoreContactInvariant, shoreSpeedInvariant } from '../../../mars/viewer/engine/locomotion/shore.ts';
import { speedWithinCap, humanStaticClearance } from '../../../mars/viewer/engine/runtime/invariants.ts';
import { decodeSnapshot, type RuntimeSnapshot } from '../../../mars/viewer/engine/runtime/snapshot.ts';
import type { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import type { WorldState } from '../../../mars/viewer/engine/world/types.ts';
import type { SpatialScene } from '../../../mars/viewer/engine/spatial/types.ts';

export async function nativeBoatFixture() {
  const shore=await nativeShoreFixture(),m=await loadMars();
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/shore-bed.v1.json',import.meta.url),'utf8'));
  const water=createWaterGeometryProbe({...fixture.water,terrain:fixture.terrain});
  const g:BoatGeometry=Object.freeze({shore:shore.geometry,clearance(from,to){
    const minX=Math.min(from[0],to[0])-1.5,maxX=Math.max(from[0],to[0])+1.5;
    const minZ=Math.min(from[2],to[2])-.65,maxZ=Math.max(from[2],to[2])+.65;
    return water.clearance({centreXZ:[(minX+maxX)/2,(minZ+maxZ)/2],halfXZ:[(maxX-minX)/2,(maxZ-minZ)/2],
      draftMetres:BOAT_POLICY.draft,underKeelMarginMetres:BOAT_POLICY.keelMargin}).geometryStatus==='sufficient-depth';
  }} satisfies BoatGeometry);
  const scene:SpatialScene={bounds:[-16,-12,16,12],levels:[{id:0,y:0,label:'clearance grid'}],surfaces:[
    {id:'shore-clearance',level:0,y:0,obb:{c:[0,0],half:[16,12],yaw:0}}],links:[],obstacles:[]};
  const rulesVersion=`native-boat-fixture/1+${m.rulesVersion}`;
  const base={campus:'eden-boat-fixture/1',staticHash:hashOf({fixture,scene,rulesVersion,policy:BOAT_POLICY,layout:BOAT_LAYOUT})};
  const appearance=shoreAppearanceSourceV1Schema.parse({contract:'shore-appearance-source/1',source:SHORE_APPEARANCE_SOURCE_V1,
    utf8:readFileSync(new URL('./fixtures/shore-appearance-source.v1.json',import.meta.url),'utf8')});
  const registry=new Map([...shoreActions(g.shore),...boatActions(g)].map(a=>[a.verb,a]));
  const services=m.servicesFor({[base.campus]:scene});
  const inTransit=(rt:Runtime,id:string)=>!!rt.world.entities[id]?.human?.boatTransit;
  const invariants=[...m.invariants.filter(i=>i!==speedWithinCap&&i!==humanStaticClearance),
    boatClearanceInvariant,
    (rt:Runtime)=>shoreSpeedInvariant(rt).filter(d=>!d.subjects?.some(id=>inTransit(rt,id))),
    (rt:Runtime)=>Object.values(rt.world.entities).flatMap(e=>e.human?.boatTransit&&(!Number.isFinite(e.human.speed)||e.human.speed!<0||e.human.speed!>BOAT_POLICY.boardingSpeed*1.05)
      ?[{code:'boat.boarding-speed',message:`${e.id} exceeded supported transfer speed`}]:[]),
    shoreContactInvariant(g.shore,boatBodyContact),boatInvariant(g)];
  const validate=(w:WorldState)=>{if(w.base.campus!==base.campus||w.base.staticHash!==base.staticHash||w.obstacleEdits)throw new Error('boat fixture physical base/rules differ');};
  return {rulesVersion,geometry:g,fixture:shore.fixture,
    renderScene():RenderScene {
      const s=shore.renderScene().shore!;
      return {scene:structuredClone(scene),shore:nativeShoreSceneV1Schema.parse({...s,rulesVersion,physicalBase:base,
        boat:{layout:BOAT_LAYOUT,appearance}})};
    },
    genesis(seed='boat'):WorldState {
      const w=shore.genesis(seed);w.base={...base};
      w.entities['eden-dock']={id:'eden-dock',def:'eden-shore-dock',kind:'fixture',pose:{p:[-3,.5,5],yaw:0},provenance:{origin:'design-edit',confidence:'hypothetical'}};
      w.entities['eden-boat-prototype']={id:'eden-boat-prototype',def:'eden-shore-boat',kind:'vehicle',pose:{p:[-4,-.3,7],yaw:0},
        provenance:{origin:'design-edit',confidence:'hypothetical'},boat:{contract:'boat-state/1',waterId:g.shore.waterId,frameOffsetY:.4,
          dockId:'eden-dock',connectorOpen:true,phase:'docked',speed:0,passengers:{},pilotIds:['pilot']}};
      return w;
    },
    create(w:WorldState):Runtime{validate(w);return new m.Runtime(w,registry,services(w),invariants);},
    restore(s:RuntimeSnapshot):Runtime{const w=decodeSnapshot(s).world;validate(w);return m.Runtime.restore(s,registry,services(w),invariants);},
    human:shore.human,
  };
}
