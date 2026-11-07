import {useEffect,useRef,useState} from 'react';
import type {Api} from './useSouls.ts';

export function InviteAccess({api,refresh,accountCheck}:{api:Api;refresh():void;accountCheck:object}){
 const [code,setCode]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const pending=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 // Only a fresh confirmed account response permits another manual attempt.
 useEffect(()=>{setUncertain(false);setMessage('');},[accountCheck]);
 const submit=async()=>{
  if(pending.current||uncertain||code.trim().length<3)return;
  pending.current=true;setBusy(true);setMessage('Checking your invitation…');
  try{
   const result=await api('/v1/invite',{code:code.trim()});
   if(!live.current)return;
   if(result.status===200&&result.data?.ok===true){setCode('');setMessage('Invitation accepted. Checking your account access…');setUncertain(true);refresh();}
   else if(result.status===404)setMessage('That invitation is invalid or has been used up. Check the code with the person who invited you.');
   else if(result.status===401||result.status===403)setMessage('Invitation refused. Check that you are signed in to the right account.');
   else if(result.status===429)setMessage('Too many invitation attempts. Wait before trying again.');
   else if(result.status===400)setMessage('Check your invitation code and try again.');
   else {setUncertain(true);setMessage('The invitation response is unconfirmed. Check account access before trying again.');}
  }catch{if(live.current){setUncertain(true);setMessage('The invitation response is unconfirmed. Check account access before trying again.');}}
  finally{pending.current=false;if(live.current)setBusy(false);}
 };
 return <section className="wide" aria-label="Your invitation">
  <h2>Your invitation</h2>
  <p>Enter the invitation you were given to access this world’s owner tools. You can keep watching without one.</p>
  <form onSubmit={event=>{event.preventDefault();void submit();}}>
   <label htmlFor="invite-code">Invitation code</label>
   <div className="row"><input id="invite-code" autoComplete="off" value={code} disabled={busy||uncertain} onChange={event=>setCode(event.target.value)} style={{maxWidth:260}}/>
    <button className="primary" disabled={busy||uncertain||code.trim().length<3}>{busy?'Checking…':'Continue'}</button></div>
  </form>
  {uncertain&&<button onClick={refresh}>Check account access</button>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
