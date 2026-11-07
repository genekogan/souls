import type {WorldHost} from './world.ts';
import type {Brain} from './brain.ts';
import type {Card} from '@souls/kernel';
import {COMMONS_PERSONAL_RESOURCES} from '@souls/engine-mars';

/** Birth-order evidence is stable through retirement/restart; slots are never
 * reassigned by a current cast sort. Only actual owned Souls receive cards. */
export async function installCommonsProvisionCards(host:WorldHost,brain:Brain,onlySoulId?:string){
  if(brain.host!==host)throw Error('commons-provisions.card-host-differs');
  const resources=[...COMMONS_PERSONAL_RESOURCES,...(host.engine.commonsNewcomerResourcesV1?.()??[])];
  const births=host.db.db.prepare("SELECT payload FROM events WHERE world_id=? AND kind='birth' ORDER BY seq LIMIT ?").all(host.worldId,resources.length) as {payload:string}[];
  const verdicts=[];
  for(const [index,event] of births.entries()){
    const birth=JSON.parse(event.payload);if(onlySoulId&&birth.soulId!==onlySoulId)continue;
    const m=host.minds.get(birth.soulId),row=host.db.soul(birth.soulId);if(!m||!row||row.retired_at!==null||row.owner!==m.owner||row.entity_id!==m.entityId)continue;
    const r=resources[index],suffix=m.soulId.slice(2),meal=`eat prepared meal ${suffix}`,sleep=`sleep on ground mat ${suffix}`;
    const cards:Card[]=[
      {name:meal,summary:'Eat my prepared meal with a spoon and free both hands afterward.',good_when:'Hungry, with food in my own bowl; native reach, food and hand requirements apply.',target:null,when:[],then:[{set:['$actor','doing','eating a prepared meal']}],approach:[],during:[
        {verb:'mars:take_item',params:{item:r.bowl,hand:'left'}},{verb:'mars:take_item',params:{item:r.spoon,hand:'right'}},{verb:'mars:eat',params:{bowl:r.bowl,spoon:r.spoon}},
        {verb:'mars:put_item',params:{item:r.spoon,surfaceSlot:'ground'}},{verb:'mars:put_item',params:{item:r.bowl,surfaceSlot:'ground'}}],takes:'minute'},
      {name:sleep,summary:'Sleep on my clear ground sleeping area and return to standing.',good_when:'Tired, free hands and an unoccupied supported sleep envelope; use real ground sleep.',target:null,when:[],then:[{set:['$actor','doing','sleeping on a ground mat']}],approach:[],during:[{verb:'mars:sleep',params:{mat:r.mat,duration:600,returnTo:r.sleepReturn}}],takes:'long'},
      ...[r.bowl,r.spoon].map((item):Card=>({name:`return ${item} ${suffix}`,summary:'Put my held utensil on the ground and free the hand.',good_when:'A held bowl or spoon after an interrupted meal; tidy before sleep or another task.',target:null,when:[],then:[{set:['$actor','doing','tidying utensils']}],approach:[],during:[{verb:'mars:put_item',params:{item,surfaceSlot:'ground'}}],takes:'seconds'})),
    ];
    const owner=m.owner,entityId=m.entityId;
    const guard=()=>{const current=host.db.soul(m.soulId);if(!current||current.retired_at!==null||current.owner!==owner||current.entity_id!==entityId||m.owner!==owner||m.entityId!==entityId||host.minds.get(m.soulId)!==m)throw Error('commons-provisions.owner-moved');return true as const;};
    const pending=brain.mint(m,cards.filter(c=>!host.kernel.decks[m.soulId].cards.includes(c.name)),undefined,undefined,'compiled',guard);
    let done=false;pending.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await new Promise<void>(r=>setImmediate(r));}if(!done)throw Error('commons-provisions.card-mint-unsettled');const accepted=await pending;if(accepted.some(v=>!v.ok))throw Error('commons-provisions.card-mint-refused');verdicts.push(...accepted);
  }
  return verdicts;
}

/** Install before listening for new births. This is a bounded resource policy:
 * canonical births retain their slots, even after retirement.
 * Later slots require an explicit recorded finite resource checkpoint. No replay-time listener runs. */
export async function followCommonsProvisionBirths(host:WorldHost,brain:Brain){
  let work=Promise.resolve(),failure:unknown;
  const append=(soulId?:string)=>{
    const pending=work.then(()=>installCommonsProvisionCards(host,brain,soulId));
    work=pending.then(()=>{},error=>{failure=error;console.error('commons-provisions.birth-assignment-failed');});return pending;
  };
  const listener={onApplied(e:{kind:string,payload:any}){if(e.kind==='birth')void append(e.payload.soulId).catch(()=>{});else if(e.kind==='rules'&&e.payload?.commonsNewcomerResources)void append().catch(()=>{});}};
  const close=()=>{const i=host.listeners.indexOf(listener);if(i>=0)host.listeners.splice(i,1);};
  const settled=async()=>{let pending;do{pending=work;await pending;}while(pending!==work);if(failure)throw failure;};
  // Subscribe before catch-up; births applied by mint's sequencer pump must
  // join the same chain rather than fall between the query and subscription.
  host.listeners.push(listener);
  try{await append();await settled();}catch(error){close();throw error;}
  return {settled,close};
}
