import {useEffect,useRef,useState} from 'react';
import {humanCapabilityRegistryV1Schema,type HumanCapabilityRegistryV1} from '@souls/engine-contract';
import type {Api} from './useSouls.ts';
const names={walk:'Walk',sit:'Sit',rest:'Rest',eat:'Eat',hang_out:'Spend time somewhere',activity:'Other activities'};
/** Private actor-scoped suggestions. Read only on opening or explicit refresh. */
export function HumanCapabilities({api,worldId,soulId,entityId,contract='human-capabilities/1'}:{api:Api;worldId:string;soulId:string;entityId:string;contract?:'human-capabilities/1'|'human-capabilities/2'}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[view,setView]=useState<HumanCapabilityRegistryV1|null>(null),[unavailable,setUnavailable]=useState(false);
 const alive=useRef(true),reading=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const read=async()=>{
  if(reading.current)return;reading.current=true;setBusy(true);setUnavailable(false);setView(null);
  try{
   const response=await api(`/v1/souls/${encodeURIComponent(soulId)}/intent-v2/capabilities`);
   const parsed=response.status===200?humanCapabilityRegistryV1Schema.safeParse(response.data):null;
   if(alive.current){if(parsed?.success&&parsed.data.contract===contract&&parsed.data.worldId===worldId&&parsed.data.soulId===soulId&&parsed.data.entityId===entityId)setView(parsed.data);else setUnavailable(true);}
  }catch{if(alive.current)setUnavailable(true);}finally{reading.current=false;if(alive.current)setBusy(false);}
 };
 return <details className="playing-help" onToggle={event=>{const next=event.currentTarget.open;setOpen(next);if(next&&!view&&!busy&&!unavailable)void read();}}><summary>What could I ask for?</summary>
  {open&&<>
   <p>Describe what you want in your own words. These supported actions were checked for this Soul; availability can change before they act.</p>
   {busy&&<p role="status">Checking current possibilities…</p>}
   {unavailable&&<p role="status">Current possibilities are unavailable. No action has been requested.</p>}
   {view&&<>{view.goals.length===0?<p>No supported goals were returned for this Soul.</p>:view.goals.map(goal=><section key={goal.id}><b>{names[goal.id]}</b><ul>{goal.bindings.slice(0,12).map(binding=><li key={binding.id}>{binding.label}{!binding.available&&<span className="dim"> · unavailable now</span>}</li>)}</ul>{goal.bindings.length>12&&<p className="small dim">Showing 12 of {goal.bindings.length} places or options.</p>}</section>)}<p className="small dim">Status at world tick {view.tick}. Listed actions do not confirm that anything started or finished.</p></>}
   <button type="button" disabled={busy} onClick={()=>void read()}>Refresh possibilities</button>
  </>}
 </details>;
}
