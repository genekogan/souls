import {hashOf} from '@souls/engine-contract';
import {itemEntity} from '../../../mars/viewer/engine/items/model.ts';
import type {Entity,Region} from '../../../mars/viewer/engine/world/types.ts';
// Finite prepared meals and ground sleeping areas on the retained commons.
export const COMMONS_PERSONAL_RESOURCES=Object.freeze(Array.from({length:8},(_,i)=>{
  const n=i+1,x=-22+(i%4)*6,z=14+Math.floor(i/4)*7;
  return Object.freeze({id:'commons-personal-'+n,mat:'commons-mat-'+n,bowl:'commons-bowl-'+n,spoon:'commons-spoon-'+n,
    bowlHome:[x,0,8+Math.floor(i/4)*3] as [number,number,number],spoonHome:[x+.5,0,8+Math.floor(i/4)*3] as [number,number,number],sleepReturn:[x,z-1.5] as [number,number]});
}));
export function commonsProvisions(){
  const provenance={origin:'design-edit' as const,confidence:'hypothetical' as const,note:'Explicit finite commons-provisions/1'};
  const entities:Record<string,Entity>={},regions:Record<string,Region>={};
  for(const r of COMMONS_PERSONAL_RESOURCES){
    entities[r.bowl]=itemEntity(r.bowl,'bowl',[...r.bowlHome],0,{provenance,contents:{food:'stew',fraction:1}});
    entities[r.spoon]=itemEntity(r.spoon,'spoon',[...r.spoonHome],0,{provenance});
    const x=r.sleepReturn[0],z=r.sleepReturn[1]+1.5;
    regions[r.mat]={id:r.mat,label:'Ground sleeping area '+r.id,kind:'work-area',level:0,polygon:[[x-1.6,z-.7],[x+1.6,z-.7],[x+1.6,z+.7],[x-1.6,z+.7]],provenance};
  }
  return {entities,regions,hash:hashOf({entities,regions,contract:'commons-provisions/1'})};
}
