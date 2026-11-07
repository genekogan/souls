import {useEffect,useRef,useState} from 'react';
import {admissionAccount,type AdmissionAccount} from './admission-account.ts';
import {creationReceipt,readyCreatedSoul,type CreationReceipt} from './creation-receipt.ts';
import {arrivalResumeAccount,type ArrivalResume} from './arrival-resume.ts';
import type {SoulLifecycle} from '@souls/protocol';
import type {Api} from './useSouls.ts';
type Props={api:Api;base:string;worldId:string;identity:string;onReady(id:string):void;active?:boolean;onPendingChange?(pending:boolean):void};
// Staged consumer for accepted lifecycle-enabled admission. The caller still
// owns admission availability and must preserve this scoped state while hidden.
export function SoulArrival(props:Props){return <Arrival key={JSON.stringify([props.base,props.worldId,props.identity])} {...props}/>;}
function Arrival({api,worldId,identity,onReady,active=true,onPendingChange}:Props){
 const [name,setName]=useState(''),[description,setDescription]=useState(''),[receipt,setReceipt]=useState<CreationReceipt|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [resume,setResume]=useState<ArrivalResume>({kind:'unavailable'}),[checked,setChecked]=useState(false);
 useEffect(()=>{onPendingChange?.(!!receipt);},[receipt,onPendingChange]);
 const live=useRef(true),pending=useRef(false),baseline=useRef<Set<string>>(new Set());
 const activeNow=useRef(active);activeNow.current=active;
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 async function account():Promise<AdmissionAccount|null>{if(!activeNow.current)return null;const r=await api('/v1/me');return live.current&&activeNow.current&&r.status===200?admissionAccount(r.data,worldId,identity):null;}
 function restore(row:SoulLifecycle){
  const next=creationReceipt(row.state==='pending'?202:200,{lifecycle:row},worldId,row.name);
  setName(row.name);setReceipt(next);setMessage(next.detail);
 }
 async function recover(){
  if(!activeNow.current||pending.current||receipt)return;pending.current=true;setBusy(true);setChecked(false);
  try{const fresh=await account();if(!live.current||!activeNow.current)return;const found=arrivalResumeAccount(fresh);setResume(found);setChecked(true);
   if(found.kind==='resume')restore(found.request);
   else setMessage(found.kind==='clear'?'':found.kind==='choose'?'Choose an existing arrival to check. No new arrival was requested.':found.kind==='incomplete'?'Earlier arrival records are not on this page. A new arrival stays paused until existing requests can be checked.':'Current account access could not be checked. No arrival was requested.');
  }catch{if(live.current){setResume({kind:'unavailable'});setMessage('Current account access could not be checked. No arrival was requested.');}}
  finally{pending.current=false;if(live.current)setBusy(false);}
 }
 useEffect(()=>{if(active&&!receipt)void recover();},[active]);
 async function reconcile(current:CreationReceipt,attemptName:string){
  const fresh=await account();if(!live.current)return;
  if(!fresh){setMessage('Current account access could not be checked. Keep this request and check again.');return;}
  let next=current;
  const rows=fresh.page.requests.filter(row=>row.operation==='create'&&row.name===attemptName&&(!current.soulId||row.soulId===current.soulId)&&(!current.lifecycle||row.requestId===current.lifecycle.requestId));
  const candidates=current.soulId||current.lifecycle?rows:rows.filter(row=>!baseline.current.has(row.requestId));
  if(candidates.length===1){const row=candidates[0];const previous=current.lifecycle;if(previous&&(row.revision<previous.revision||row.entityId!==previous.entityId||row.requestedAt!==previous.requestedAt)){setMessage('Current arrival records could not be reconciled. Keep this request and check again.');return;}const derived=creationReceipt(row.state==='refused'?409:row.state==='pending'?202:200,{...(row.state==='refused'?{ok:false,code:'arrival-unavailable'}:{}),lifecycle:row},worldId,attemptName);if(derived.kind!=='unconfirmed')next=derived;}
  setReceipt(next);setMessage(next.detail);
  const ready=readyCreatedSoul(next,fresh.page,fresh.owned,worldId);if(ready)onReady(ready);
 }
 async function start(){
  if(!activeNow.current||pending.current||receipt||!checked||resume.kind!=='clear')return;pending.current=true;setBusy(true);setMessage('Checking account access…');
  const attemptName=name.trim(),attemptDescription=description.trim();let sent=false;
  try{const before=await account();if(!live.current)return;if(!before){setMessage('Arrival is unavailable until current account access and arrival records can be checked.');return;}
   const found=arrivalResumeAccount(before);setResume(found);
   if(found.kind!=='clear'){if(found.kind==='resume')restore(found.request);else setMessage(found.kind==='choose'?'Choose an existing arrival to check. No new arrival was requested.':'Earlier arrival records could not be checked. No arrival was requested.');return;}
   baseline.current=new Set(before.page.requests.map(r=>r.requestId));setMessage('Requesting their arrival…');
   // Only the fresh exact-world/current-owner advertised response protocol.
   sent=true;const r=await api('/v1/souls',{name:attemptName,description:attemptDescription},'POST',{capability:before.capability,worldId,userId:identity});if(!live.current)return;
   const next=creationReceipt(r.status,r.data,worldId,attemptName);setReceipt(next);setMessage(next.detail);await reconcile(next,attemptName);
  }catch{if(live.current){if(sent){const next=creationReceipt(0,null,worldId,attemptName);setReceipt(next);setMessage(next.detail);}else setMessage('Current account access could not be checked. No arrival was requested.');}}
  finally{pending.current=false;if(live.current)setBusy(false);}
 }
 async function check(){if(!activeNow.current||pending.current||!receipt)return;pending.current=true;setBusy(true);try{await reconcile(receipt,name.trim());}catch{if(live.current)setMessage('Current account access could not be checked. Keep this request and check again.');}finally{pending.current=false;if(live.current)setBusy(false);}}
 if(!active)return null;
 return <section aria-label="Soul arrival"><h2>Bring your Soul into this world</h2><p>Give them a name and a short description. These are public. Their arrival must be confirmed by the world before you can steer them.</p>
  <label>Name<input value={name} maxLength={32} disabled={busy||!!receipt} onChange={e=>setName(e.target.value)}/></label>
  <label>Who are they?<input value={description} maxLength={1200} disabled={busy||!!receipt} onChange={e=>setDescription(e.target.value)}/></label>
  {!receipt&&resume.kind==='choose'&&<div aria-label="Existing arrivals">{resume.requests.map(row=><button key={row.requestId} disabled={busy} onClick={()=>restore(row)}>Check {row.name}’s arrival</button>)}</div>}
  {!receipt&&resume.kind!=='clear'&&<button disabled={busy} onClick={()=>void recover()}>Check existing arrivals</button>}
  {!receipt&&<button disabled={busy||!checked||resume.kind!=='clear'||name.trim().length<2||description.trim().length<3} onClick={()=>void start()}>Request arrival</button>}
  {receipt&&<button disabled={busy} onClick={()=>void check()}>Check arrival and account access</button>}
  {receipt?.kind==='refused'&&<button disabled={busy} onClick={()=>{setReceipt(null);setMessage('Choose a name and description for a new arrival request.');}}>Start another arrival request</button>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
