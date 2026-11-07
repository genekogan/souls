import {RequestDiagnostics} from './RequestDiagnostics.tsx';
import {RequestProgress} from './RequestProgress.tsx';
import {requestNeedsDiagnostics,type DiagnosticContext} from './request-diagnostics.ts';
import {intentFeedback} from './intent-feedback.ts';
import {useEffect,useRef,useState} from 'react';
import type {Api} from './useSouls.ts';
import {intentLookupResponse,type IntentResponse} from './intent-response.ts';
type Props={api:Api;worldId:string;soulId:string;ownerId:string;principalId?:string;authorityKey:string;active:boolean;entityId?:string;diagnosticContext?:Pick<DiagnosticContext,'backendBuild'|'body'>};
export function IntentLookup(props:Props){return props.active?<Lookup key={JSON.stringify([props.worldId,props.soulId,props.ownerId,props.authorityKey,props.entityId])} {...props}/>:null;}
function Lookup({api,worldId,soulId,ownerId,principalId,entityId,diagnosticContext}:Props){
  const [reference,setReference]=useState(''),[result,setResult]=useState<IntentResponse|null>(null),[busy,setBusy]=useState(false);
  const [observed,setObserved]=useState<DiagnosticContext|null>(null),[checked,setChecked]=useState('');
  const alive=useRef(true),reading=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const valid=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(reference.trim());
  const check=async()=>{
    if(reading.current||!valid)return;
    const requestId=reference.trim();reading.current=true;setBusy(true);setResult(null);setChecked(requestId);
    try{
      const response=await api(`/v1/souls/${encodeURIComponent(soulId)}/intent-v2/requests/${encodeURIComponent(requestId)}`);
      if(alive.current)setObserved({worldId,soulId,entityId,...diagnosticContext,responseStatus:response.status,observedAt:new Date().toISOString()});
      if(alive.current)setResult(intentLookupResponse(response.status,response.data,{worldId,soulId,ownerId,principalId,entityId,requestId}));
    }catch{if(alive.current)setObserved({worldId,soulId,entityId,...diagnosticContext,responseStatus:0,observedAt:new Date().toISOString()});if(alive.current)setResult(intentLookupResponse(0,null,{worldId,soulId,ownerId,principalId,entityId,requestId}));}
    finally{reading.current=false;if(alive.current)setBusy(false);}
  };
  return <><details className="intent-lookup"><summary>Check a previous direction</summary>
    <p className="small dim">Paste the request reference you kept. Checking reads the saved request; it does not send the direction again.</p>
    <form onSubmit={e=>{e.preventDefault();void check();}}>
      <label htmlFor="intent-reference">Request reference</label>
      <input id="intent-reference" maxLength={100} value={reference} disabled={busy} autoComplete="off" spellCheck={false} onChange={e=>{setReference(e.target.value);setResult(null);}}/>
      <button disabled={busy||!valid}>{busy?'Checking previous direction…':'Check reference'}</button>
    </form>
    </details><div aria-live="polite">
      {result?.kind==='unconfirmed'&&!observed&&<><b>{result.title}</b><p>{result.detail}</p></>}
      {result?.kind==='recorded'&&!(observed&&requestNeedsDiagnostics(result))&&<>
        <b>{intentFeedback(result.receipt).title}</b>
        <p>{intentFeedback(result.receipt).detail}</p>
        {intentFeedback(result.receipt).adaptation&&<p className="small">{intentFeedback(result.receipt).adaptation}</p>}
        {result.receipt.phase==='understood'&&<><p className="small">Your words: “{result.receipt.revision.words}”</p>{checked&&<RequestProgress key={checked} api={api} scope={{worldId,soulId,ownerId,principalId,entityId,requestId:checked}}/>}</>}
      </>}
    </div>
    {result&&observed&&checked&&requestNeedsDiagnostics(result)&&<RequestDiagnostics key={checked} api={api} scope={{worldId,soulId,ownerId,principalId,entityId,requestId:checked}} request={null} result={result} context={observed} reference={checked}/>}
  </>;
}
