import {useEffect,useRef,useState} from 'react';
import {ownerLifecycleListSchema,type OwnerLifecycleList,type SoulLifecycle} from '@souls/protocol';
import type {Api} from './useSouls.ts';
export type LifecycleRead={kind:'absent'}|{kind:'unavailable'}|{kind:'ready';page:OwnerLifecycleList};
export function readLifecycle(raw:unknown,worldId:string|undefined):LifecycleRead{
 if(raw===undefined)return {kind:'absent'};
 const parsed=ownerLifecycleListSchema.safeParse(raw);
 return parsed.success&&worldId&&parsed.data.worldId===worldId?{kind:'ready',page:parsed.data}:{kind:'unavailable'};
}
function describe(row:SoulLifecycle){
 if(row.operation==='retire')return row.state==='retired'
  ?{title:`${row.name} left the world`,detail:'Their departure is recorded.'}
  :{title:`${row.name} is leaving`,detail:'Their departure is in progress. We haven’t confirmed they’ve left yet.'};
 if(row.reason==='retirement-accepted')return {title:`${row.name}’s departure was accepted`,detail:'They are no longer available for you to steer. Their departure may still be in progress.'};
 if(row.state==='pending')return {title:`Preparing ${row.name}`,detail:'We’re waiting for the world to confirm their arrival.'};
 if(row.state==='refused')return {title:`${row.name} could not arrive`,detail:'They could not find a safe place to arrive.'};
 return row.ready?{title:`${row.name} has arrived`,detail:`Choose ← Back to the world to see ${row.name} and give a first direction.`}
  :{title:`Checking ${row.name}`,detail:'Their arrival was recorded. We’re checking whether they’re available now.'};
}
export function LifecycleStatus({initial,worldId,api,refresh}:{initial:LifecycleRead;worldId:string|undefined;api:Api;refresh():void}){
 const [result,setResult]=useState(initial),[busy,setBusy]=useState(false),live=useRef(true),pending=useRef(false);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const more=async()=>{
  if(pending.current||result.kind!=='ready'||!result.page.nextCursor)return;
  const cursor=result.page.nextCursor;pending.current=true;setBusy(true);
  try{const r=await api('/v1/lifecycle?cursor='+encodeURIComponent(cursor));if(live.current)setResult(r.status===200?readLifecycle(r.data,worldId):{kind:'unavailable'});}
  catch{if(live.current)setResult({kind:'unavailable'});}
  finally{pending.current=false;if(live.current)setBusy(false);}
 };
 if(result.kind==='absent')return null;
 return <section aria-label="Soul arrivals and departures">
  <h2>Soul arrivals and departures</h2>
  {result.kind==='unavailable'?<><p role="status">Arrival and departure records could not be loaded. Check account access again.</p><button onClick={refresh}>Check account access</button></>:<>
   {result.page.requests.length?<ol className="human-history">{result.page.requests.map(row=>{const copy=describe(row);return <li key={row.requestId}><b>{copy.title}</b><p>{copy.detail}</p><details><summary>Record details</summary><p className="small dim">Request {row.requestId} · revision {row.revision}{row.fact?` · event ${row.fact.seq}, tick ${row.fact.tick}`:''}</p></details></li>;})}</ol>:<p>No recorded Soul changes on this page.</p>}
   <details><summary>History details</summary><p className="small dim">Up to 20 recorded Soul changes. This page is not a complete history. An arrival record alone does not grant control.</p></details>
   {result.page.nextCursor&&<button disabled={busy} onClick={()=>void more()}>{busy?'Reading…':'Read earlier Soul changes'}</button>}
  </>}
 </section>;
}
