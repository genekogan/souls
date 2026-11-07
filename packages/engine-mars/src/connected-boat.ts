// Fresh connected native topology with an optional explicit helm rule version.
// No existing history or default reinterpretation; the owned adapter is separate.
import {readFileSync} from 'node:fs';
import {hashOf,nativeBoatControlsV1Schema,nativeShoreSceneV1Schema,shoreAppearanceSourceV1Schema,SHORE_APPEARANCE_SOURCE_V1,type RenderScene} from '@souls/engine-contract';
import {connectedCommonsShoreFixture,CONNECTED_SHORE_TRANSFORM} from './connected-shore.ts';
import {loadMars} from './load.ts';
import {createWaterGeometryProbe} from './water-geometry.ts';
import {translatedBoatControllers,type BoatGeometry} from '../../../mars/viewer/engine/vehicles/boat.ts';
import {decodeSnapshot,type RuntimeSnapshot} from '../../../mars/viewer/engine/runtime/snapshot.ts';
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import type {WorldState} from '../../../mars/viewer/engine/world/types.ts';
import {readBodyLocation} from './body-location.ts';
import {shoreContactInvariant,SHORE_POLICY} from '../../../mars/viewer/engine/locomotion/shore.ts';
export async function connectedCommonsBoatFixture(options?:{helmV1?:true;bodyLocationV1?:true}){
  const m=await loadMars(),controllers=translatedBoatControllers({x:CONNECTED_SHORE_TRANSFORM.x,y:CONNECTED_SHORE_TRANSFORM.y,z:CONNECTED_SHORE_TRANSFORM.z});
  const foundation=await connectedCommonsShoreFixture({version:'connected-boat/1',bodyContact:controllers.bodyContact,transferSpeed:controllers.policy.boardingSpeed});
  const water=createWaterGeometryProbe({...foundation.water,terrain:foundation.terrain}),B=controllers.policy,L=controllers.layout;
  const geometry:BoatGeometry={shore:foundation.geometry,clearance(from,to){
    const minX=Math.min(from[0],to[0])-1.5,maxX=Math.max(from[0],to[0])+1.5,minZ=Math.min(from[2],to[2])-.65,maxZ=Math.max(from[2],to[2])+.65;
    return water.clearance({centreXZ:[(minX+maxX)/2,(minZ+maxZ)/2],halfXZ:[(maxX-minX)/2,(maxZ-minZ)/2],draftMetres:B.draft,underKeelMarginMetres:B.keelMargin}).geometryStatus==='sufficient-depth';
  }};
  const rulesVersion='native-commons-boat/1+'+(options?.helmV1?'boat-helm/1+':'')+(options?.bodyLocationV1?'body-location/1+':'')+foundation.rulesVersion,scene=foundation.scene;
  const appearance=shoreAppearanceSourceV1Schema.parse({contract:'shore-appearance-source/1',source:SHORE_APPEARANCE_SOURCE_V1,utf8:readFileSync(new URL('./fixtures/shore-appearance-source.v1.json',import.meta.url),'utf8')});
  const base={campus:'eden-commons-boat/1',staticHash:hashOf({foundationBase:foundation.genesis().base,scene,policy:B,layout:L,rulesVersion,appearanceSource:appearance.source})};
  const initial=foundation.create(foundation.genesis('registry-only')),registry=new Map(initial.registry);for(const def of controllers.actions(geometry))registry.set(def.verb,def);
  if(options?.helmV1){
    for(const def of controllers.helmActions())registry.set(def.verb,def);
    const leave=registry.get('boat_leave')!;registry.set('boat_leave',{...leave,start(rt,p,plan,id){const ex=leave.start(rt,p,plan,id),actor=(p as {actor:string}).actor;rt.world.entities[B.boatId].boat!.pilotIds=rt.world.entities[B.boatId].boat!.pilotIds.filter((id:string)=>id!==actor);return ex;}});
  }
  const invariants=[...initial.invariants,controllers.clearanceInvariant,controllers.invariant(geometry),...(options?.helmV1?[controllers.helmInvariant]:[])],services=m.servicesFor({[base.campus]:scene});
  const validate=(w:WorldState)=>{if(w.base.campus!==base.campus||w.base.staticHash!==base.staticHash||w.obstacleEdits)throw new Error('connected boat physical base differs');};
  return {rulesVersion,geometry,layout:L,policy:B,human:foundation.human,servicesForWorld:services,helmV1:!!options?.helmV1,
    helmControls:options?.helmV1?(rt:Runtime,actor:string)=>{const view=controllers.helmControls(rt,actor);return view?nativeBoatControlsV1Schema.parse(view):null;}:undefined,
    bodyLocation:options?.bodyLocationV1?(rt:Runtime,actor:string)=>readBodyLocation(rt,actor,(runtime,e)=>{
      const boatContact=controllers.bodyContact(runtime,e);if(boatContact!==null)return boatContact;
      const s=e.human?.shore;if(!s)return null;
      const issues=shoreContactInvariant(foundation.geometry)(runtime).filter(d=>!d.subjects||d.subjects.includes(e.id));if(issues.length)return issues;
      const p=foundation.geometry.point([e.pose.p[0],e.pose.p[2]]);
      if(!p||s.mode!==(p.depth>=SHORE_POLICY.floatingRootBelowDatum?'buoyant':'bed')||Math.abs(s.bedY-p.point[1])>1e-9
        ||Math.abs(s.submergedHeightMetres-Math.max(0,Math.min(e.pose.p[1]+SHORE_POLICY.height,foundation.geometry.datumY)-Math.max(e.pose.p[1],p.point[1])))>1e-9
        ||s.normal.some((v,i)=>Math.abs(v-p.normal[i])>1e-9))
        return [{code:'location.stale-contact',message:'Recorded shore contact differs from current root and native geometry.',subjects:[e.id]}];
      return [];
    }):undefined,
    genesis(seed='connected-boat'):WorldState{const w=foundation.genesis(seed);w.base={...base};
      w.entities[B.dockId]={id:B.dockId,def:'eden-shore-dock',kind:'fixture',pose:{p:[...L.dock.position],yaw:0},provenance:{origin:'design-edit',confidence:'hypothetical'}};
      w.entities[B.boatId]={id:B.boatId,def:'eden-shore-boat',kind:'vehicle',pose:{p:[...L.boatDockPosition],yaw:0},provenance:{origin:'design-edit',confidence:'hypothetical'},boat:{contract:'boat-state/1',waterId:foundation.water.id,frameOffsetY:B.frameOffsetY,dockId:B.dockId,connectorOpen:true,phase:'docked',speed:0,passengers:{},pilotIds:[]}};
      return w;},
    create(w:WorldState):Runtime{validate(w);return new m.Runtime(w,registry,services(w),invariants);},
    restore(s:RuntimeSnapshot):Runtime{const w=decodeSnapshot(s).world;validate(w);return m.Runtime.restore(s,registry,services(w),invariants);},
    renderScene():RenderScene{const f=foundation.renderScene();return {...f,shore:nativeShoreSceneV1Schema.parse({...f.shore,rulesVersion,physicalBase:base,boat:{layout:L,appearance}})};},
  };
}
