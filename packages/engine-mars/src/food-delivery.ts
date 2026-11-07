import {hashOf,type CommonsFoodDeliveryV1} from '@souls/engine-contract';
import {COMMONS_PERSONAL_RESOURCES} from './commons-provisions.ts';
import {itemEntity} from '../../../mars/viewer/engine/items/model.ts';
import type {Entity} from '../../../mars/viewer/engine/world/types.ts';
/** Explicit eight-meal finite provisioning. Never modifies consumed objects. */
export function commonsFoodDeliveryItemsV1(batch:number){
 if(!Number.isInteger(batch)||batch<1||batch>4)throw Error('food-delivery.capacity');
 const entities:Record<string,Entity>={},resources=COMMONS_PERSONAL_RESOURCES.map((r,index)=>({index,bowl:`commons-food-${batch}-bowl-${index+1}`,spoon:r.spoon,home:[r.bowlHome[0]+1+(batch-1)*.3,0,r.bowlHome[2]] as [number,number,number]}));
 for(const r of resources)entities[r.bowl]=itemEntity(r.bowl,'bowl',[...r.home],0,{label:`Delivered prepared meal ${batch}.${r.index+1}`,provenance:{origin:'design-edit',confidence:'hypothetical',note:`Explicit finite commons-food-delivery/1 batch${batch}; preserved earlier consumed resources`},contents:{food:'stew',fraction:1}});
 return {entities,resources,hash:hashOf({contract:'commons-food-delivery/1',batch,entities,resources})};
}
export type CommonsFoodDeliveryStateV1=CommonsFoodDeliveryV1[];
