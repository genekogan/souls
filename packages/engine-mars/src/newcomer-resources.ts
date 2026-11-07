import {hashOf,newcomerResourcePlacementV1Schema,type NewcomerResourcePlacementV1} from '@souls/engine-contract';
import {itemEntity} from '../../../mars/viewer/engine/items/model.ts';
import type {Entity,Region} from '../../../mars/viewer/engine/world/types.ts';
/** Add only fresh finite stock and lifetime slots. Positions must pass native admission. */
export function commonsNewcomerResourcesV1(firstSlot:number,raw:readonly NewcomerResourcePlacementV1[]){
 if(!Number.isInteger(firstSlot)||firstSlot<9||!raw.length||firstSlot+raw.length-1>30)throw Error('newcomer-resources.capacity');
 const placements=raw.map(p=>newcomerResourcePlacementV1Schema.parse(p)),entities:Record<string,Entity>={},regions:Record<string,Region>={},provenance={origin:'design-edit' as const,confidence:'hypothetical' as const,note:'Explicit finite commons-newcomer-resources/1; lifetime slots never recycled'};
 const resources=placements.map((p,i)=>{const slot=firstSlot+i,[x,z]=p.matCenter,[mx,mz]=p.mealPoint;return {id:'commons-personal-'+slot,slot,mat:'commons-mat-'+slot,bowl:'commons-bowl-'+slot,spoon:'commons-spoon-'+slot,bowlHome:[mx,0,mz] as [number,number,number],spoonHome:[mx+.5,0,mz] as [number,number,number],sleepReturn:[x,z-1.5] as [number,number]};});
 for(const [i,r] of resources.entries()){const [x,z]=placements[i].matCenter;entities[r.bowl]=itemEntity(r.bowl,'bowl',[...r.bowlHome],0,{provenance,contents:{food:'stew',fraction:1}});entities[r.spoon]=itemEntity(r.spoon,'spoon',[...r.spoonHome],0,{provenance});regions[r.mat]={id:r.mat,label:'Ground sleeping area '+r.id,kind:'work-area',level:0,polygon:[[x-1.6,z-.7],[x+1.6,z-.7],[x+1.6,z+.7],[x-1.6,z+.7]],provenance};}
 return {entities,regions,resources,hash:hashOf({contract:'commons-newcomer-resources/1',firstSlot,placements,entities,regions})};
}
