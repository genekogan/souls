import {useEffect,useState} from 'react';
import type {Api} from './useSouls.ts';
import {ownRequestDiagnostics,ownRequestDiagnosticsPath,type DiagnosticScope,type OwnRequestDiagnostics,type ServerDiagnostics} from './request-diagnostics.ts';
/** GET-only reads of this own request's G414 DTO. Optional polling stops at `done`, on a missing route
 * or auth refusal, or after maxReads. Never sends or retries the direction itself. */
export function useOwnRequestDiagnostics(api:Api,scope:DiagnosticScope,options:{pollMs?:number;done?:(dto:OwnRequestDiagnostics)=>boolean;maxReads?:number}={}):ServerDiagnostics{
 const [server,setServer]=useState<ServerDiagnostics>({kind:'loading'});
 const {pollMs,done,maxReads=450}=options;
 useEffect(()=>{
  let current=true,timer:ReturnType<typeof setTimeout>|undefined,reads=0;setServer({kind:'loading'});
  const read=async()=>{
   reads++;let next:ServerDiagnostics;let status=0;
   try{const r=await api(ownRequestDiagnosticsPath(scope.soulId,scope.requestId));status=r.status;next=ownRequestDiagnostics(r.status,r.data,scope);}
   catch{next={kind:'unavailable',reason:'The diagnostics read did not complete.'};}
   if(!current)return;
   // Keep the last validated progress through a transient failed poll.
   setServer(prev=>next.kind==='unavailable'&&prev.kind==='available'&&(status===0||status>=500)?prev:next);
   const stop=!pollMs||reads>=maxReads||(next.kind==='available'&&!!done?.(next.dto))||[401,403,404,405,501].includes(status);
   if(!stop)timer=setTimeout(()=>void read(),pollMs);
  };
  void read();
  return()=>{current=false;clearTimeout(timer);};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[api,scope.worldId,scope.soulId,scope.ownerId,scope.entityId,scope.requestId,pollMs]);
 return server;
}
