import {hashOf} from '@souls/engine-contract';
import {itemEntity,placeOnSlot,surfaceSlot} from '../../../mars/viewer/engine/items/model.ts';
import type {Entity,WorldState} from '../../../mars/viewer/engine/world/types.ts';
export const COMMONS_KITCHENS=Object.freeze(Array.from({length:4},(_,i)=>Object.freeze({
  id:`commons-kitchen-${i+1}`,table:`commons-kitchen-table-${i+1}`,pot:`commons-kitchen-pot-${i+1}`,
  beans:`commons-kitchen-beans-${i+1}`,greens:`commons-kitchen-greens-${i+1}`,spoon:`commons-kitchen-spoon-${i+1}`,
  p:[-22+i*6,0,4] as [number,number,number],
})));
/** Explicit finite supported ingredients, not a refill of consumed personal bowls. */
export type CommonsKitchenVersion='commons-kitchen/1'|'commons-kitchen/2';
export function commonsKitchen(version:CommonsKitchenVersion='commons-kitchen/1'){
  if(version!=='commons-kitchen/1'&&version!=='commons-kitchen/2')throw Error('commons-kitchen.version');
  const row=version==='commons-kitchen/2'?'r1':'r0';
  const entities:Record<string,Entity>={},provenance={origin:'design-edit' as const,confidence:'hypothetical' as const,note:'Explicit finite '+version+': two ingredient bowls yield two servings per station'};
  for(const r of COMMONS_KITCHENS){
    entities[r.table]={id:r.table,def:'table-6ft',kind:'fixture',label:`Preparation table ${r.id}`,pose:{p:[...r.p],yaw:0},support:{kind:'ground'},provenance};
    const w={entities} as WorldState;
    for(const [id,def,slot,food,fraction] of [[r.beans,'bowl',row+'c1','beans',1],[r.greens,'bowl',row+'c3','greens',1],[r.pot,'pot',row+'c2','hypothetical cold shared dish',0],[r.spoon,'spoon',row+'c4','',0]] as const){
      const item=itemEntity(id,def,[0,0,0],0,{provenance,...(food?{contents:{food,fraction}}:{})}),s=surfaceSlot(w,`${r.table}#${slot}`);
      if('code' in s)throw Error('commons-kitchen.slot');placeOnSlot(item,s,0);entities[id]=item;
    }
  }
  return {entities,hash:hashOf({contract:version,entities})};
}
