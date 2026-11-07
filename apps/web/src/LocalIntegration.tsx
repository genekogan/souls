import {useEffect,useRef,useState} from 'react';
import type {Api} from './useSouls.ts';
import './LocalIntegration.css';
type Notes={integratedAt:string;changes:string[];knownGaps:string[]};
const local=()=>['127.0.0.1','localhost'].includes(location.hostname);
function notes(raw:unknown):Notes|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const v=raw as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['integratedAt','changes','knownGaps'].includes(k))||typeof v.integratedAt!=='string'||v.integratedAt.length>40||!Number.isFinite(Date.parse(v.integratedAt)))return null;
 const list=(x:unknown)=>Array.isArray(x)&&x.length<=8&&x.every(s=>typeof s==='string'&&s.length<=200);
 return list(v.changes)&&list(v.knownGaps)?v as Notes:null;
}
/** Optional PM-authored local metadata; absence adds no product claim. */
export function LocalIntegrationNotice({source='/__sim/integration.json'}:{source?:string}){
 const [data,setData]=useState<Notes|null>(null);
 useEffect(()=>{
  if(!local()||!/^\/[A-Za-z0-9_./-]+$/.test(source)||source.includes('..')||source.startsWith('//'))return;
  let alive=true;const controller=new AbortController();
  const read=async()=>{try{const r=await fetch(source,{credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});const parsed=r.ok?notes(await r.json()):null;if(alive)setData(parsed);}catch{if(alive)setData(null);}};
  void read();const timer=setInterval(()=>void read(),30000);return()=>{alive=false;clearInterval(timer);controller.abort();};
 },[source]);
 if(!local()||!data)return null;
 return <details className="local-integration"><summary>Local build · {new Date(data.integratedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</summary>
  <p className="small">Integrated {new Date(data.integratedAt).toLocaleString()}. Local work in progress.</p>
  <b>Changes</b><ul>{data.changes.map((s,i)=><li key={i}>{s}</li>)}</ul>
  <b>Known gaps</b><ul>{data.knownGaps.map((s,i)=><li key={i}>{s}</li>)}</ul>
 </details>;
}
export function LocalConnectionHelp({devAuth}:{devAuth:boolean}){
 if(!local()||!devAuth)return null;
 return <details className="local-connection-help"><summary>Local sign-in and agent setup</summary>
  <p>This local demo uses a development name. Choose the name provided for you and use the same name when returning. It is separate from real account sign-in.</p>
  <ol><li>Sign in, then open Your Soul. Check an existing arrival before requesting another.</li><li>Select your Soul and choose Follow. Give one supported direction and read its saved interpretation; action completion is separate.</li><li>Open Connect an assistant for your world and Soul details. Start the reviewed CLI connect process with that public world URL and Soul ID, keep it running, and open its approval link yourself.</li><li>Check the requested Soul, approve, then wait for the CLI result and verify current identity/perception. Approval alone does not prove an agent is running.</li></ol>
  <p>Keys and owner codes belong only in the approved private input/store. Use the reviewed CLI supplied with this local demo; no host settings change is needed for that fallback.</p>
 </details>;
}
export function DebugPanel({api}:{api:Api}){
 const [data,setData]=useState<unknown>(null),[state,setState]=useState('Read a public engine snapshot.'),[busy,setBusy]=useState(false);const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function read(){if(busy)return;setBusy(true);try{const r=await api('/v1/debug/world');if(alive.current){if(r.status===200){setData(r.data);setState('Public engine snapshot at the time of this read.');}else{setData(null);setState('Debug snapshot unavailable.');}}}catch{if(alive.current){setData(null);setState('Debug snapshot unavailable.');}}finally{if(alive.current)setBusy(false);}}
 return <section className="wide"><h2>Debug — public engine snapshot</h2><p>{state}</p><button disabled={busy} onClick={()=>void read()}>{busy?'Reading…':'Read debug snapshot'}</button>{data!==null&&<pre className="json">{JSON.stringify(data,null,2)}</pre>}</section>;
}
