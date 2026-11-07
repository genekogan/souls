import type {WorldHost} from './world.ts';
import type {Brain} from './brain.ts';
import type {Card} from '@souls/kernel';
import {COMMONS_KITCHENS,COMMONS_PERSONAL_RESOURCES} from '@souls/engine-mars';

/** Two residents share each finite station; ownership applies to cards and
 * personal utensils, while native pot reservations/quantity govern admission. */
export async function installCommonsKitchenCards(host:WorldHost,brain:Brain,onlySoulId?:string){
  if(brain.host!==host||! /\+commons-kitchen\/[12](?:\+|$)/.test(host.engine.rulesVersion))throw Error('commons-kitchen.card-reader-required');
  const slotRow=/\+commons-kitchen\/2(?:\+|$)/.test(host.engine.rulesVersion)?'r1':'r0';
  const births=host.db.db.prepare("SELECT payload FROM events WHERE world_id=? AND kind='birth' ORDER BY seq LIMIT 8").all(host.worldId) as {payload:string}[];
  const verdicts=[];
  for(const [index,event] of births.entries()){
    const birth=JSON.parse(event.payload);if(onlySoulId&&birth.soulId!==onlySoulId)continue;
    const m=host.minds.get(birth.soulId),row=host.db.soul(birth.soulId);if(!m||!row||row.retired_at!==null||row.owner!==m.owner||row.entity_id!==m.entityId)continue;
    const r=COMMONS_KITCHENS[Math.floor(index/2)],personal=COMMONS_PERSONAL_RESOURCES[index],suffix=m.soulId.slice(2);
    const cards:Card[]=[
      {name:`prepare shared dish ${suffix}`,summary:'Prepare two servings from our two finite ingredient bowls; return the preparation spoon to its table.',good_when:'Our finite ingredients or incomplete dish need preparation. Stand on ground with free hands; wait if someone is using the station.',target:null,when:[],then:[{set:['$actor','doing','preparing a shared cold dish']}],approach:[],during:[
        {verb:'mars:prepare_food',params:{pot:r.pot,spoon:r.spoon,ingredients:[r.beans,r.greens],groundRoutePolicy:'supported-ground/1'}},
        {verb:'mars:put_item',params:{item:r.spoon,surfaceSlot:r.table+'#'+slotRow+'c4'}}],takes:'minute'},
      {name:`eat shared dish ${suffix}`,summary:'Bring my empty bowl and spoon to our table, serve one prepared portion, eat and free my hands.',good_when:'Hungry, my bowl is empty and our completed pot has a finite serving. Prepare first if unfinished; native route, quantity and hand requirements apply.',target:null,when:[],then:[{set:['$actor','doing','eating a shared dish']}],approach:[
        {verb:'mars:take_item',params:{item:personal.bowl,hand:'left'}},{verb:'mars:take_item',params:{item:personal.spoon,hand:'right'}}],during:[
        {verb:'mars:walk_to',params:{x:r.p[0]-.15,z:r.p[2]-.9,level:0}},{verb:'mars:serve',params:{pot:r.pot,bowl:personal.bowl}},{verb:'mars:eat',params:{bowl:personal.bowl,spoon:personal.spoon}},
        {verb:'mars:put_item',params:{item:personal.spoon,surfaceSlot:'ground'}},{verb:'mars:put_item',params:{item:personal.bowl,surfaceSlot:'ground'}}],takes:'minute'},
    ];
    const owner=m.owner,entityId=m.entityId;
    const guard=()=>{const current=host.db.soul(m.soulId);if(!current||current.retired_at!==null||current.owner!==owner||current.entity_id!==entityId||m.owner!==owner||m.entityId!==entityId||host.minds.get(m.soulId)!==m)throw Error('commons-kitchen.owner-moved');return true as const;};
    const pending=brain.mint(m,cards.filter(c=>!host.kernel.decks[m.soulId].cards.includes(c.name)),undefined,undefined,'compiled',guard);
    let done=false;pending.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await new Promise<void>(r=>setImmediate(r));}if(!done)throw Error('commons-kitchen.card-mint-unsettled');const accepted=await pending;if(accepted.some(v=>!v.ok))throw Error('commons-kitchen.card-mint-refused');verdicts.push(...accepted);
  }
  return verdicts;
}
export async function followCommonsKitchenBirths(host:WorldHost,brain:Brain){
  let work=Promise.resolve(),failure:unknown;
  const append=(soulId?:string)=>{
    const pending=work.then(()=>installCommonsKitchenCards(host,brain,soulId));
    work=pending.then(()=>{},error=>{failure=error;console.error('commons-kitchen.birth-assignment-failed');});return pending;
  };
  const listener={onApplied(e:{kind:string,payload:any}){if(e.kind==='birth')void append(e.payload.soulId).catch(()=>{});}};
  const close=()=>{const i=host.listeners.indexOf(listener);if(i>=0)host.listeners.splice(i,1);};
  const settled=async()=>{let pending;do{pending=work;await pending;}while(pending!==work);if(failure)throw failure;};
  // Subscribe before catch-up; births applied by mint's sequencer pump must
  // join the same chain rather than fall between the query and subscription.
  host.listeners.push(listener);
  try{await append();await settled();}catch(error){close();throw error;}
  return {settled,close};
}
