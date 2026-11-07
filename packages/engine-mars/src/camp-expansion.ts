// Canonical additive ground infrastructure, not adoption of World render mats,
// upper-floor support, replenishment, economy or a live/default scene switch.
import {campExpansionV1Schema,hashOf,type CampExpansionV1,type RenderScene} from '@souls/engine-contract';
import {decodeSnapshot,type RuntimeSnapshot} from '../../../mars/viewer/engine/runtime/snapshot.ts';
import {encode} from '../../../mars/viewer/engine/runtime/codec.ts';
import {itemEntity,placeOnSlot,surfaceSlot} from '../../../mars/viewer/engine/items/model.ts';
import type {WorldState,Entity,Region} from '../../../mars/viewer/engine/world/types.ts';
import type {SpatialScene} from '../../../mars/viewer/engine/spatial/types.ts';
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import type {Mars} from './load.ts';
import {readBodyLocation} from './body-location.ts';
export const CAMP_EXPANSION_CAMPUS='eden-camp-ground-eight/1';
export const CAMP_EIGHT_RESOURCES=Object.freeze([1,2,3,4,5,6,7,8].map(n=>Object.freeze({
  id:'camp-personal-'+n,mat:'mat-'+n,bowl:'bowl-'+n,spoon:'spoon-'+n,
  bowlReturn:`${n<=4?'dining-table':'camp-eight-table'}#r${n%4===1||n%4===2?0:2}c${n%2?0:4}`,
  spoonReturn:`${n<=4?'dining-table':'camp-eight-table'}#r${n%4===1||n%4===2?0:2}c${n%2?1:5}`,
  ...(n>4?{stewPot:'camp-eight-stew',stewService:[-10,25.1] as [number,number],sleepReturn:[-35+(n-5)*6,25.5] as [number,number],sleepRegion:'camp-eight-rest'}:{}),
})));
const provenance={origin:'design-edit' as const,confidence:'hypothetical' as const,note:'Explicit camp-ground-expansion/1 native infrastructure, not the frozen World visual proposal'};
function region(id:string,label:string,x0:number,z0:number,x1:number,z1:number,kind:Region['kind']='work-area'):Region{
  return {id,label,kind,level:0,polygon:[[x0,z0],[x1,z0],[x1,z1],[x0,z1]],provenance:{...provenance}};
}
/** `registry`: the reader's action registry (default: the engine's default registry; disassembly/1 passes its own). */
export function createCampExpansion(m:Mars,registry:()=>Map<string,any>=()=>m.createRegistry()){
  const old=m.edenCampWorld('base') as WorldState,scene=structuredClone(m.scenes[old.base.campus]) as SpatialScene;
  scene.bounds=[-44,-36,44,36];scene.surfaces[0].obb.half=[44,36];
  const entities:Record<string,Entity>={'camp-eight-table':{id:'camp-eight-table',def:'table-6ft',kind:'fixture',label:'Additional finite meal service',pose:{p:[-10,0,26],yaw:0},support:{kind:'ground'},provenance:{...provenance}}};
  const regions:Record<string,Region>={'camp-eight-rest':region('camp-eight-rest','Additional ground rest court',-38,24,-13,30,'place'),
    'camp-eight-dining':region('camp-eight-dining','Additional meal service',-13,23,-7,29,'place')};
  const slots=new Map(CAMP_EIGHT_RESOURCES.slice(4).flatMap(r=>[[r.bowl,r.bowlReturn],[r.spoon,r.spoonReturn]] as [string,string][]));
  const stock=[...slots.entries(),['camp-eight-stew','camp-eight-table#r0c2']];
  const staging={...old,entities:{...old.entities,...entities}};
  for(const [id,slot] of stock){
    const contents=id==='camp-eight-stew'?{food:'stew',fraction:1}:id.startsWith('bowl-')?{food:'stew',fraction:0}:undefined;
    const e=itemEntity(id,id==='camp-eight-stew'?'pot':id.startsWith('bowl-')?'bowl':'spoon',[0,0,0],0,{provenance:{...provenance},...(contents?{contents}:{})});
    const s=surfaceSlot(staging,slot);if('code' in s)throw new Error('camp-expansion.stock-slot:'+s.message);placeOnSlot(e,s,0);entities[id]=e;staging.entities[id]=e;
  }
  for(let n=5;n<=8;n++){const x=-35+(n-5)*6;regions['mat-'+n]=region('mat-'+n,'Ground sleeping area '+n,x-1.6,27.3,x+1.6,28.7);}
  const additionsHash=hashOf({entities,regions}),base={campus:CAMP_EXPANSION_CAMPUS,staticHash:hashOf({scene,additionsHash,contract:'camp-ground-expansion/1'})};
  const services=m.servicesFor({...m.scenes,[base.campus]:scene});
  const validate=(w:WorldState)=>{if(hashOf(w.base)!==hashOf(base))throw new Error('camp-expansion.restore-base');};
  const restore=(s:RuntimeSnapshot):Runtime=>{validate(decodeSnapshot(s).world);return m.Runtime.restore(s,registry(),services(decodeSnapshot(s).world),m.invariants);};
  function prepare(rt:Runtime,fromRulesVersion:string,toRulesVersion:string):{ok:true;transition:CampExpansionV1;runtime:Runtime}|{ok:false;diagnostic:{code:string;message:string}}{
    const no=(code:string,message:string)=>({ok:false as const,diagnostic:{code:'camp-expansion.'+code,message}});
    if(hashOf(rt.world.base)!==hashOf(old.base))return no('foreign-base','Only the exact historical native camp base can enter this ground upgrade.');
    const quiet=m.compactionIssue(rt);if(quiet)return no('not-quiet',quiet);
    if(rt.world.obstacleEdits)return no('obstacle-overrides','Existing explicit obstacle overrides require separate qualification.');
    for(const id of Object.keys(entities))if(rt.world.entities[id])return no('entity-collision','Existing '+id+' cannot be replaced.');
    for(const id of Object.keys(regions))if(rt.world.regions[id])return no('region-collision','Existing '+id+' cannot be replaced.');
    const snap=rt.snapshot();
    if(snap.dropped.length||snap.tick!==rt.tick||snap.stateHash!==rt.stateHash())return no('checkpoint-not-exact','The source native graph must snapshot without dropped work.');
    const graph=decodeSnapshot(snap);
    Object.assign(graph.world.entities,structuredClone(entities));Object.assign(graph.world.regions,structuredClone(regions));graph.world.base={...base};
    const next={...snap,data:encode(graph),stateHash:hashOf(graph.world)};delete next.spatialEpoch;
    const runtime=restore(next),issues=m.invariants.flatMap(inv=>inv(runtime));
    if(issues.length)return no('physical-conflict',issues.map((d:any)=>d.code+': '+d.message).join('; '));
    return {ok:true,runtime,transition:campExpansionV1Schema.parse({contract:'camp-ground-expansion/1',tick:rt.tick,fromRulesVersion,toRulesVersion,
      fromBase:rt.world.base,toBase:base,fromNativeHash:rt.stateHash(),additionsHash})};
  }
  return {base,additionsHash,prepare,restore,services,renderScene:():RenderScene=>({scene:structuredClone(scene)}),
    bodyLocation:(runtime:Runtime,actor:string)=>readBodyLocation(runtime,actor,()=>null),
    initialEntity:(id:string)=>entities[id]?structuredClone(entities[id]):undefined,
    // Detached publication facts; no permission to move or rewrite old mats.
    layout:()=>structuredClone({base,regions,entities,nativeGroundY:0,sleepEnvelope:[3.2,1.4],oldPersonalResourcesPreserved:4})};
}
export type CampExpansionReader=ReturnType<typeof createCampExpansion>&{rulesVersion:string};
