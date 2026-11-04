import * as THREE from 'three';
import {WorldModel, defSchema, biologyAt, biologyHourAt, type PlantBiology, type Entity} from '@sim/world-compiler';
import {meshFor} from '../gen-mesh/registry.ts';
import {MaterialLib} from '../gen-mesh/materials.ts';
import {plantGroup, posePlants, plantSeed, plantPatch, type PlantGroup} from './plant-growth.ts';

type Render = {defHash:string;params:Record<string,unknown>;seed:number;scale:number};
type Frame = Record<string,{p:readonly number[];yaw:number;state:Record<string,unknown>}>;
type StaticEntity={plantBiology?:PlantBiology;plantRenderV1?:Render;pose?:{p:readonly number[];yaw:number}};
type Take = {tracks:Record<string,unknown>;entities0?:Record<string,{plantBiology?:unknown}>;finalState:{entities:Record<string,StaticEntity>;plantRenderDefsV1?:Record<string,unknown>;plantStaticIdsV1?:string[]}};
/** Only opted-in planter pictures. A fresh reader needs neither the live God model nor its current meshes. */
export class RecordedPlanters {
  readonly group=new THREE.Group();
  private readonly model=new WorldModel({constants:{ground:'land',extent:1000},seed:'recorded-planter'});
  private readonly materials=new MaterialLib();
  private definitions:Record<string,unknown>={};
  private ids:string[]=[];
  private staticShown=new Set<string>();
  private drawn=new Map<string,{key:string;object:THREE.Object3D;plants:PlantGroup}>();
  setTake(take:Take){
    this.definitions=take.finalState.plantRenderDefsV1??{};
    this.ids=Object.keys(take.tracks).filter(id=>take.entities0?.[id]?.plantBiology||take.finalState.entities[id]?.plantBiology);
    this.staticShown=new Set();
    for(const id of take.finalState.plantStaticIdsV1??[]){
      const e=take.finalState.entities[id];if(!e?.pose||!e.plantBiology||!e.plantRenderV1||this.ids.includes(id))continue;
      if(this.pose(id,{p:e.pose.p,yaw:e.pose.yaw,state:{}},e.plantBiology,e.plantRenderV1,0))this.staticShown.add(id);
    }
  }
  update(entities:Frame,tick:number,clock?:{origin:number;dayTicks:number;pausedAtTick?:number}){
    const shown=new Set(this.staticShown);if(!clock){for(const [id,e] of this.drawn)if(!shown.has(id)){this.release(e);this.drawn.delete(id);}return shown;}
    const hour=biologyHourAt(tick,clock);
    for(const id of this.ids){
      const entity=entities[id],anchor=entity?.state.plantBiology as PlantBiology|undefined,render=entity?.state.plantRenderV1 as Render|undefined;
      if(!anchor||!render||anchor.biologyHour<0)continue;
      if(this.pose(id,entity,anchor,render,hour))shown.add(id);
    }
    for(const [id,entry] of this.drawn)if(!shown.has(id)){this.release(entry);this.drawn.delete(id);}
    return shown;
  }
  private pose(id:string,entity:Frame[string],anchor:PlantBiology,render:Render,hour:number){
      const input=this.definitions[render.defHash];if(!input)return false;
      const key=JSON.stringify(render);let drawn=this.drawn.get(id);
      const at=anchor.biologyEnabled?biologyAt(anchor,hour):{g:anchor.biologyGrowth,w:anchor.biologyWilt,m:anchor.biologyMoisture},look={g:at.g,w:at.w,m:at.m};
      if(!drawn||drawn.key!==key){
        if(drawn){this.release(drawn);this.drawn.delete(id);}
        const def=this.model.defineDef(defSchema.parse(input),'recording',0);
        if(def.hash!==render.defHash)throw Error('plant-render.definition-hash-mismatch');
        const objectEntity={id,def:def.ref,in:{parent:'world'},seed:render.seed,params:render.params} as Entity;
        const params=Object.fromEntries(Object.entries(def.params).map(([k,f])=>[k,render.params[k]??f.default])) as Entity['params'];
        const builder=meshFor(def);if(!builder)throw Error('plant-render.builder-unavailable');
        const object=builder.build({def,entity:objectEntity,params:params!,args:def.make.kind==='gen'?(def.make.args??{}):{},baked:this.model.bake(def,render.params as NonNullable<Entity['params']>,render.seed),model:this.model,materials:this.materials,
          tint:(k,f)=>typeof params?.[k??'']==='string'&&String(params?.[k??'']).startsWith('#')?String(params?.[k??'']):def.palette?.[k??'']??f});
        if(!object)throw Error('plant-render.mesh-unavailable');
        const plants=plantGroup(plantSeed(id),look);object.add(plants);object.name=`recorded planter ${id}`;this.group.add(object);
        drawn={key,object,plants};this.drawn.set(id,drawn);
      }
      posePlants(drawn.plants,look);plantPatch(drawn.object,look.m);
      // Native fixture yaw is the inverse of the God/three.js convention.
      drawn.object.position.fromArray(entity.p);drawn.object.rotation.y=-entity.yaw;drawn.object.scale.setScalar(render.scale);
      drawn.object.updateMatrixWorld(true);return true;
  }
  private release(entry:{object:THREE.Object3D;plants:PlantGroup}){entry.object.removeFromParent();entry.plants.traverse(o=>{if((o as THREE.InstancedMesh).isInstancedMesh)(o as THREE.InstancedMesh).dispose();});for(const material of Object.values(entry.plants.userData.mats))material.dispose();}
  private clear(){for(const entry of this.drawn.values())this.release(entry);this.drawn.clear();}
  dispose(){this.clear();this.materials.dispose();}
}
