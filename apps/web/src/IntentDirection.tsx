import {RequestDiagnostics} from './RequestDiagnostics.tsx';
import {RequestProgress} from './RequestProgress.tsx';
import {requestNeedsDiagnostics,type DiagnosticContext} from './request-diagnostics.ts';
import {HumanCapabilities} from './HumanCapabilities.tsx';
import {intentFeedback} from './intent-feedback.ts';
import { useEffect, useRef, useState } from 'react';
import { INTENT_V2, intentRequestV2Schema, type IntentRequestV2 } from '@souls/protocol';
import type { Api } from './useSouls.ts';
import { intentResponse, type IntentResponse } from './intent-response.ts';
import {IntentLookup} from './IntentLookup.tsx';
import {AvailableActions} from './AvailableActions.tsx';
const interpretationReadDelays = [1000, 2000, 4000, 8000, 8000, 8000] as const;
export type IntentDirectionProps = {api:Api;worldId:string;soulId:string;soulName:string;ownerId:string;principalId?:string;authorityKey:string;active:boolean;suggestions?:unknown;diagnosticContext?:Pick<DiagnosticContext,'backendBuild'|'body'>;humanGoalsEnabled?:boolean;humanGoalContract?:'human-capabilities/1'|'human-capabilities/2';entityId?:string;onUnderstood?():void};
/** Explicit candidate consumer. Parent must supply current own-authorized scope;
 * Shell selects the strict positive Core DTO; no error/engine-flag inference. */
export function IntentDirection(props:IntentDirectionProps) {
  return props.active ? <Direction key={JSON.stringify([props.worldId,props.soulId,props.ownerId,props.authorityKey,props.entityId])} {...props}/> : null;
}
function Direction(props:IntentDirectionProps) {
  const {api,worldId,soulId,soulName,ownerId}=props;
  const [referenceNotice,setReferenceNotice]=useState('');
  const [diagnosticContext,setDiagnosticContext]=useState<DiagnosticContext|null>(null);
  const sentAt=useRef<string|undefined>(undefined);
  const [words,setWords]=useState(''),[pending,setPending]=useState<IntentRequestV2|null>(null),[result,setResult]=useState<IntentResponse|null>(null),[busy,setBusy]=useState(false);
  const alive=useRef(true),sending=useRef(false),copyTicket=useRef(0),automaticReads=useRef(0),notifiedRequest=useRef<string|null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const path=`/v1/souls/${encodeURIComponent(soulId)}/intent-v2`;
  const terminal=result?.kind==='recorded'&&result.receipt.phase!=='received';
  const consume=(request:IntentRequestV2,status:number,data:unknown)=>{
    if(!alive.current)return;
    setDiagnosticContext({worldId,soulId,entityId:props.entityId,...props.diagnosticContext,sentAt:sentAt.current,observedAt:new Date().toISOString(),responseStatus:status});
    const response=intentResponse(status,data,{worldId,soulId,ownerId,principalId:props.principalId,entityId:props.entityId,request});setResult(response);
    if(response.kind==='recorded'&&response.receipt.phase==='understood'&&request.op==='upsert')setWords(old=>old.trim()===request.words?'':old);
    if(response.kind==='recorded'&&response.receipt.phase==='understood'&&notifiedRequest.current!==request.requestId){notifiedRequest.current=request.requestId;props.onUnderstood?.();}
  };
  const submit=async()=>{
    if(sending.current||pending||!words.trim())return;
    const request=intentRequestV2Schema.parse({contract:INTENT_V2,requestId:crypto.randomUUID(),op:'upsert',words:words.trim()});
    sentAt.current=new Date().toISOString();sending.current=true;automaticReads.current=0;setBusy(true);setPending(request);setResult(null);setReferenceNotice('');copyTicket.current++;
    try{const response=await api(path,request);consume(request,response.status,response.data);}
    catch{consume(request,0,null);}finally{sending.current=false;if(alive.current)setBusy(false);}
  };
  const check=async()=>{
    if(sending.current||!pending)return;
    sending.current=true;setBusy(true);
    try{const response=await api(`${path}/requests/${encodeURIComponent(pending.requestId)}`);consume(pending,response.status,response.data);}
    catch{consume(pending,0,null);}finally{sending.current=false;if(alive.current)setBusy(false);}
  };
  // A few reads of the original reference reveal prompt interpretation without
  // another human click. They never retry submission or start interpretation.
  useEffect(()=>{
    if(!pending||!result||terminal||busy||automaticReads.current>=interpretationReadDelays.length)return;
    const timer=setTimeout(()=>{automaticReads.current++;void check();},interpretationReadDelays[automaticReads.current]);
    return()=>clearTimeout(timer);
  },[pending,result,terminal,busy]);
  return <section aria-label="Soul direction" className="intent-direction">
    <form onSubmit={e=>{e.preventDefault();void submit();}}>
      <label htmlFor="intent-direction">Give {soulName} direction</label>
      <textarea id="intent-direction" maxLength={2000} rows={3} value={words} disabled={!!pending} onChange={e=>setWords(e.target.value)} placeholder="What would you like them to do?"/>
      {!pending&&<button className="primary" disabled={busy||!words.trim()}>Send direction</button>}
    </form>
    {props.humanGoalsEnabled&&props.entityId?<HumanCapabilities key={`${props.entityId}:${props.humanGoalContract??'human-capabilities/1'}`} api={api} worldId={worldId} soulId={soulId} entityId={props.entityId} contract={props.humanGoalContract??'human-capabilities/1'}/>:null}
    <AvailableActions soulId={soulId} summary={props.humanGoalsEnabled?'Other current options':undefined} options={props.suggestions} disabled={busy||!!pending||!!words.trim()} onChoose={label=>{if(!busy&&!pending&&!words.trim())setWords(label);}}/>
    <div aria-live="polite">
      {busy&&!result&&<p>Sending your direction…</p>}
      {result?.kind==='unconfirmed'&&!(pending&&diagnosticContext)&&<><b>{result.title}</b><p>{result.detail}</p></>}
      {result?.kind==='recorded'&&!(pending&&diagnosticContext&&requestNeedsDiagnostics(result))&&<>
        <b>{intentFeedback(result.receipt).title}</b>
        <p>{intentFeedback(result.receipt).detail}</p>
        {intentFeedback(result.receipt).adaptation&&<p className="small">{intentFeedback(result.receipt).adaptation}</p>}
        {result.receipt.phase==='understood'&&pending&&<RequestProgress key={pending.requestId} api={api} scope={{worldId,soulId,ownerId,principalId:props.principalId,entityId:props.entityId,requestId:pending.requestId}}/>}
      </>}
    </div>
    {pending&&result&&requestNeedsDiagnostics(result)&&diagnosticContext&&<RequestDiagnostics key={pending.requestId} api={api} scope={{worldId,soulId,ownerId,principalId:props.principalId,entityId:props.entityId,requestId:pending.requestId}} request={pending} result={result} context={diagnosticContext} soulName={soulName}/>}
    {pending&&<>
      {!terminal&&<p className="small dim">{automaticReads.current<interpretationReadDelays.length?'Checking this saved request for interpretation. No direction is being sent again.':'Automatic checks paused. Choose Check this direction to read the same request again.'}</p>}
      <button disabled={busy} onClick={()=>void check()}>{busy?'Checking…':'Check this direction'}</button>
      {terminal&&<button disabled={busy} onClick={()=>{setPending(null);setResult(null);setReferenceNotice('');copyTicket.current++;}}>Give another direction</button>}
      <details><summary>Request details</summary>
        <label htmlFor="direction-reference">Request reference</label>
        <input id="direction-reference" value={pending.requestId} readOnly onFocus={event=>event.currentTarget.select()} spellCheck={false}/>
        <button type="button" onClick={()=>{
          const requestId=pending.requestId,ticket=++copyTicket.current;
          void (async()=>{try{await navigator.clipboard.writeText(requestId);if(alive.current&&ticket===copyTicket.current)setReferenceNotice('Request reference copied. Keep it to check this direction later.');}
            catch{if(alive.current&&ticket===copyTicket.current)setReferenceNotice('Could not copy automatically. Select and copy the request reference above.');}})();
        }}>Copy request reference</button>
        {referenceNotice&&<p role="status" className="small">{referenceNotice}</p>}
        <p className="small dim">Checking reads this request. It never sends the direction again. Keep this reference if you leave this page.</p>
      </details>
    </>}
    <IntentLookup {...props}/>
    <p className="small dim">Directions affect the live world. Your Soul chooses how to carry them out.</p>
  </section>;
}
