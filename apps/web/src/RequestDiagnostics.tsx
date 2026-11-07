import type {IntentRequestV2} from '@souls/protocol';
import {useEffect,useRef,useState} from 'react';
import type {Api} from './useSouls.ts';
import type {IntentResponse} from './intent-response.ts';
import {ownWords,requestCause,requestDiagnostics,type DiagnosticContext,type DiagnosticScope} from './request-diagnostics.ts';
import {useOwnRequestDiagnostics} from './use-own-request-diagnostics.ts';
type Props={api:Api;scope:DiagnosticScope;request:IntentRequestV2|null;result:IntentResponse;context:DiagnosticContext;reference?:string;soulName?:string};
/** Mount with key=requestId. Reads (GET only) this own request's server diagnostics once; never resends. */
export function RequestDiagnostics({api,scope,request,result,context,reference,soulName}:Props){
 const [message,setMessage]=useState('');
 const server=useOwnRequestDiagnostics(api,scope);
 const alive=useRef(true),area=useRef<HTMLTextAreaElement>(null),causeBox=useRef<HTMLDivElement>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 // Bring the cause into view automatically (it can land below the fold in a phone-height panel).
 useEffect(()=>{causeBox.current?.scrollIntoView?.({block:'nearest',behavior:'smooth'});},[]);
 const cause=requestCause(result,soulName),words=ownWords(request,result,server);
 const text=requestDiagnostics(request,result,context,reference,server,soulName);
 const copy=()=>{
  const fallback=()=>{const el=area.current;if(!el)return false;el.focus();el.select();try{return document.execCommand('copy');}catch{return false;}};
  const done=(ok:boolean)=>{if(alive.current)setMessage(ok?'Diagnostics copied.':'Copy unavailable here. The text below is selected; copy it with your keyboard.');};
  if(navigator.clipboard?.writeText)void navigator.clipboard.writeText(text).then(()=>done(true),()=>done(fallback()));else done(fallback());
 };
 return <section className="request-diagnostics" aria-label="Request diagnostics">
  <div ref={causeBox} role="alert" className="request-cause"><b>{cause.headline}</b><p>{cause.cause}</p>{cause.next&&<p className="small">{cause.next}</p>}{words&&<p className="small">Your words: “{words}”</p>}{cause.code&&<p className="small dim">Code: <code>{cause.code}</code></p>}</div>
  <h3>Request diagnostics</h3>
  <p className="small">Only this request’s own evidence is shown. Fields that were not supplied are marked unavailable. Reading diagnostics never sends the direction again.{server.kind==='loading'?' Reading server diagnostics…':''}</p>
  <button type="button" onClick={copy}>Copy diagnostics</button>
  {message&&<p role="status">{message}</p>}
  <textarea ref={area} aria-label="Complete request diagnostics" readOnly value={text} rows={18} spellCheck={false} style={{width:'100%',fontFamily:'monospace',userSelect:'text'}} onFocus={event=>event.currentTarget.select()}/>
 </section>;
}
