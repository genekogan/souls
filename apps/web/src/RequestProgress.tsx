import type {Api} from './useSouls.ts';
import {requestPhase,type DiagnosticScope} from './request-diagnostics.ts';
import {useOwnRequestDiagnostics} from './use-own-request-diagnostics.ts';
/** Actual controller phase for an understood own direction. Mount with key=requestId. */
export function RequestProgress({api,scope}:{api:Api;scope:DiagnosticScope}){
 const server=useOwnRequestDiagnostics(api,scope,{pollMs:4000,done:dto=>requestPhase(dto).terminal});
 if(server.kind==='loading')return <p className="small dim request-progress" role="status">Checking whether this has started…</p>;
 if(server.kind==='unavailable')return <p className="small dim request-progress" role="status">Saved as direction. Progress is unavailable here ({server.reason}), so starting or completion has not been confirmed.</p>;
 const phase=requestPhase(server.dto);
 return <div className={`request-progress phase-${phase.kind}`} role="status" aria-live="polite">
  <b>{phase.title}</b> <span>{phase.detail}</span>
  {phase.earlier&&<p className="small dim">{phase.earlier}</p>}
 </div>;
}
