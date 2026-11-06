#!/usr/bin/env node
// Opt-in managed controller for an already paired folder. Never pairs, takes
// ownership, or changes a CLI credential. Stop any other controller first.
import {parseArgs} from 'node:util';
import {readFileSync,mkdirSync,writeFileSync,renameSync,lstatSync,openSync,closeSync,fstatSync,fchmodSync,fsyncSync,appendFile,constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {CodexHost} from './codex-host.mjs';
import {openControllerInventory} from './controller-ownership.mjs';
import {admitControllerReentry} from './decision.mjs';
import {openJournal} from './journal.mjs';
import {createWorldClient} from './world-client.mjs';
import {runManaged} from './managed.mjs';
import {abortableSleep} from './receiver.mjs';
import {createSink} from '../soul-trace/sink.mjs';
import {openHostTrace} from './trace.mjs';
const evidenceError=e=>({code:typeof e?.code==='string'&&/^[A-Za-z0-9._:-]{1,100}$/.test(e.code)?e.code:'unclassified',status:Number.isInteger(e?.status)&&e.status>=100&&e.status<=599?e.status:null});
const metadataId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,200}$/.test(value)?value:null;
const itemTypes=new Set(['userMessage','agentMessage','reasoning','commandExecution','fileChange','mcpToolCall','dynamicToolCall','webSearch','imageView','collabAgentToolCall','enteredReviewMode','exitedReviewMode','contextCompaction']);
const requestMethods=new Set(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/tool/call']);
const errorCategories=new Set(['contextWindowExceeded','sessionBudgetExceeded','usageLimitExceeded','rateLimitExceeded','flexUnavailable','serverOverloaded','cyberPolicy','misalignmentPolicyViolation','tooManyDenials','internalServerError','unauthorized','badRequest','threadRollbackFailed','sandboxError','other']);
const httpErrorVariants=new Set(['httpConnectionFailed','responseStreamConnectionFailed','responseStreamDisconnected','responseTooManyFailedAttempts']);
// CLI0.163 ErrorNotification's tagged union only. Never retain message,
// additionalDetails or arbitrary object keys/values, even when syntactically safe.
const hostErrorMetadata=error=>{
 const info=error?.codexErrorInfo;
 if(typeof info==='string')return {category:errorCategories.has(info)?info:'unknown'};
 if(info&&typeof info==='object'&&!Array.isArray(info)&&Object.keys(info).length===1){
  const [category]=Object.keys(info),details=info[category];
  if(httpErrorVariants.has(category))return {category,httpStatusCode:Number.isInteger(details?.httpStatusCode)&&details.httpStatusCode>=100&&details.httpStatusCode<=599?details.httpStatusCode:null};
  if(category==='activeTurnNotSteerable')return {category,turnKind:['review','compact'].includes(details?.turnKind)?details.turnKind:null};
 }
 return {category:'unknown'};
};
// Probe-only append evidence. No receiver wrapping, request arguments, config,
// credentials, model output or error messages. fsync is deferred to closure so
// observation latency excludes a per-row disk flush.
// By default rows go through soul-trace's bounded asynchronous queue (#733 S2):
// no synchronous write per row, one batch in flight, at most EVIDENCE_LIMITS
// queued; an overflow is counted as dropped. A crash can lose the last flushMs.
// A write failure is sticky. By default it only disables recording (#733 A4: an
// observer failure never changes gameplay): world reads and host calls keep their
// own results and errors, and close() reports {complete:false}. `required` keeps
// the fail-closed contract for qualification runs: synchronous appends; appends,
// reads and close throw. close() is async: it waits for the queue before fsync.
export const EVIDENCE_LIMITS=Object.freeze({queuedBytes:4*1024*1024,exitBytes:0,flushMs:100});
export function openEvidenceRecorder(path,{scope={},now=Date.now,onFailure=()=>{},writeRecord=writeFileSync,appendRecord=(fd,data,_options,done)=>appendFile(fd,data,done),syncFile=fsyncSync,required=false,limits=EVIDENCE_LIMITS,closeWaitMs=2000}={}){
 let fd,sink=null,closed=false,failure=null,dropped=0;const detach=[],sessionId=randomUUID(),base={sessionId,controllerPid:process.pid,worldId:scope.worldId??null,soulId:scope.soulId??null},sinkStats={dropped:0,sinkFailures:0};
 const fail=cause=>{if(!failure){failure=Object.assign(Error('Local evidence recording failed'),{code:'EVIDENCE_IO',cause});onFailure(failure);}return failure;};
 const append=row=>{
  if(failure){dropped++;if(required)throw failure;return;}
  if(closed){dropped++;if(required)throw fail(Error('Evidence recorder is closed'));return;}
  const line=JSON.stringify({...row,at:row.at??now(),...base})+'\n';
  if(sink){sink.push(line);return;}
  try{writeRecord(fd,line);}catch(e){dropped++;fail(e);if(required)throw failure;}
 };
 try{
  const file=resolve(path);let old;try{old=lstatSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(old&&(old.isSymbolicLink()||!old.isFile()||old.nlink!==1))throw Error('Evidence path must be a regular unlinked file');
  fd=openSync(file,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)throw Error('Evidence path must be a regular unlinked file');fchmodSync(fd,0o600);
  if(!required)sink=createSink({target:fd,append:appendRecord,appendSync:()=>{},limits,stats:sinkStats,onFailure:e=>fail(e)});
  append({kind:'evidence-session',state:'started'});
 }catch(e){if(fd!==undefined)try{closeSync(fd)}catch{}throw fail(e);}
 return {
  append,get failure(){return failure;},get dropped(){return dropped+sinkStats.dropped;},
  wrapWorld(world){return {...world,read:async function(...args){
   if(required){if(failure)throw failure;if(closed)throw fail(Error('Evidence recorder is closed'));}
   const command=args[0],requestedAt=now();let response;
   try{response=await Reflect.apply(world.read,world,args);}
   catch(error){append({kind:'world-read',origin:'agent',command,requestedAt,receivedAt:now(),error:evidenceError(error)});throw error;}
   append({kind:'world-read',origin:'agent',command,requestedAt,receivedAt:now(),response});return response;
  }};},
  bindHost(host){
   const hostId=randomUUID(),connect=host.connect;let actualModel=null;
   const identity=(threadId=host.threadId,turnId=null)=>({hostId,hostPid:Number.isSafeInteger(host.pid)?host.pid:null,threadId:metadataId(threadId),turnId:metadataId(turnId)});
   const record=row=>{try{append(row);}catch{}};
   host.connect=async function(...args){const connected=await Reflect.apply(connect,this,args);actualModel=typeof connected?.model==='string'?connected.model:null;(required?append:record)({kind:'host-session',state:'connected',hostId,hostPid:host.pid??null,threadId:host.threadId??null,model:actualModel,resumed:typeof args[0]?.threadId==='string'});return connected;};
   // Only the existing begin/steer ACK is timed; never await completed, change
   // arguments, introduce a timeout, retry, interrupt or replace an error/result.
   for(const operation of ['begin','steer']){
    const original=host[operation];if(typeof original!=='function')continue;
    host[operation]=async function(...args){
     const requestedAt=now(),started=performance.now(),promptBytes=typeof args[0]==='string'?Buffer.byteLength(args[0]):null,expectedTurnId=operation==='steer'?metadataId(args[1]??this.activeTurnId):null;
     let result;
     try{result=await Reflect.apply(original,this,args);}
     catch(error){record({kind:'host-rpc',operation,...identity(this.threadId,expectedTurnId),requestedAt,failedAt:now(),durationMs:Math.max(0,performance.now()-started),promptBytes,status:'rejected'});throw error;}
     record({kind:'host-rpc',operation,...identity(this.threadId,operation==='begin'?result?.turnId:expectedTurnId),requestedAt,acknowledgedAt:now(),durationMs:Math.max(0,performance.now()-started),promptBytes,status:'acknowledged'});return result;
    };
    detach.push(()=>{host[operation]=original;});
   }
   const event=e=>{
    const p=e.params??{},at=Number.isFinite(e.receivedAt)?e.receivedAt:now();
    if(['item/started','item/completed'].includes(e.method)){
     record({kind:'host-item',method:e.method,at,...identity(p.threadId??host.threadId,p.turnId),itemId:metadataId(p.item?.id),itemType:itemTypes.has(p.item?.type)?p.item.type:'unknown'});return;
    }
    if(e.method==='error'){
     record({kind:'host-error',method:'error',at,...identity(p.threadId??host.threadId,p.turnId),willRetry:typeof p.willRetry==='boolean'?p.willRetry:null,error:hostErrorMetadata(p.error)});return;
    }
    if(!['turn/started','turn/completed','thread/tokenUsage/updated'].includes(e.method))return;
    const reportedModel=p.model??p.turn?.model;if(typeof reportedModel==='string')actualModel=reportedModel;
    try{append({kind:'host-event',method:e.method,at:Number.isFinite(e.receivedAt)?e.receivedAt:now(),hostId,hostPid:host.pid??null,threadId:typeof p.threadId==='string'?p.threadId:host.threadId??null,turnId:p.turn?.id??p.turnId??null,model:actualModel,status:p.turn?.status??null,...(e.method==='thread/tokenUsage/updated'?{tokenUsage:p.tokenUsage??null}:{}),...(p.turn?.error?{error:evidenceError(p.turn.error)}:{})});}catch{}
   };
   const unsupported=e=>record({kind:'host-unsupported-request',at:now(),...identity(host.threadId,host.activeTurnId),method:requestMethods.has(e?.method)?e.method:'unknown'});
   // Method names only: bounded host notices let evidence attribute stalls without bodies.
   const notice=n=>record({kind:'host-notice',at:Number.isFinite(n?.receivedAt)?n.receivedAt:now(),...identity(host.threadId,host.activeTurnId),method:typeof n?.method==='string'&&/^[A-Za-z0-9_./-]{1,100}$/.test(n.method)?n.method:'unknown'});
   host.on('event',event);host.on('notice',notice);host.on('unsupportedRequest',unsupported);detach.push(()=>{host.off('event',event);host.off('notice',notice);host.off('unsupportedRequest',unsupported);host.connect=connect;});return host;
  },
  async close(details={}){
   const summary=()=>{const lost=dropped+sinkStats.dropped;return failure?{complete:false,code:failure.code,dropped:lost}:lost?{complete:false,code:'EVIDENCE_DROPPED',dropped:lost}:{complete:true};};
   if(closed){if(failure&&required)throw failure;return summary();}
   try{if(!failure)append({...details,kind:'evidence-session',state:'closed'});}catch(e){fail(e);}
   closed=true;for(const stop of detach)stop();
   // A stalled sink must not hang shutdown; its fd stays open so a late write can never land in a reused fd.
   let stalled=false;
   try{
    if(sink)stalled=await Promise.race([sink.drain().then(()=>false),new Promise(done=>{const h=setTimeout(()=>done(true),closeWaitMs);h.unref?.();})]);
    if(stalled){dropped+=sink.queued+sink.inFlight;fail(Error('Evidence sink did not drain before close'));}
    else if(!failure)syncFile(fd);
   }catch(e){fail(e);}
   finally{if(!stalled)try{closeSync(fd)}catch(e){fail(e);}}
   if(failure&&required)throw failure;
   return summary();
  },
 };
}
// Wait through a dead controller's lease, never bypass a live controller's
// renewals. Each attempt still uses the transactional claim and its fence.
export async function claimStartupLease(control,{signal,maxWaitMs=65000,pollMs=250,now=Date.now,sleep=abortableSleep,onWait=()=>{}}={}){
 if(!Number.isFinite(maxWaitMs)||maxWaitMs<0||!Number.isFinite(pollMs)||pollMs<1)throw Error('Invalid startup lease wait');
 const deadline=now()+maxWaitMs;let lastExpiry;
 while(!signal?.aborted){
  try{return control.claim();}catch(error){
   if(error.code!=='CONTROLLER_BUSY')throw error;
   const remaining=deadline-now();
   if(remaining<=0)throw Object.assign(Error('Timed out waiting for controller lease'),{code:'CONTROLLER_BUSY_TIMEOUT',expiresAt:error.expiresAt});
   const delayMs=Math.min(pollMs,remaining,Math.max(1,error.expiresAt-now()));
   if(lastExpiry!==error.expiresAt){onWait({state:'waiting',code:error.code,expiresAt:error.expiresAt,delayMs});lastExpiry=error.expiresAt;}
   await sleep(delayMs,signal);
  }
 }
 return null;
}
export async function main(argv=process.argv.slice(2),{signal,leaseWaitMs=65000,Host=CodexHost}={}){
 const {values}=parseArgs({args:argv,options:{folder:{type:'string'},state:{type:'string'},instruction:{type:'string'},model:{type:'string'},effort:{type:'string',default:'low'},seconds:{type:'string'},'session-name':{type:'string'},evidence:{type:'string'},'evidence-required':{type:'boolean'},help:{type:'boolean'}}});
 if(values.help){console.log('node tools/soul-runtime/run.mjs --folder <paired-folder> [--instruction <text-file>] [--model <advertised-model>] [--seconds <bounded-run>] [--evidence <local-jsonl> [--evidence-required]]');return;}
 if(values['evidence-required']&&!values.evidence)throw Error('--evidence-required needs --evidence <local-jsonl>');
 const folder=resolve(values.folder??process.cwd()),state=resolve(values.state??join(folder,'.soul-runtime'));
 const seconds=values.seconds===undefined?null:Number(values.seconds);if(seconds!==null&&(!Number.isFinite(seconds)||seconds<1||seconds>7*86400))throw Error('seconds must be1..604800');
 const stop=new AbortController(),quit=()=>stop.abort(),externalAbort=()=>stop.abort(signal?.reason);
 process.once('SIGINT',quit);process.once('SIGTERM',quit);signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)externalAbort();
 let journal,ownership,owner,ownerRenewal,timer,evidence,trace=null,runFailure=null,ownershipFailure=null,evidenceFailure=null;const ownedHosts=new Set();
 try{
 if(stop.signal.aborted)return;
 const credential=join(folder,'.eden-agent.json');if(lstatSync(credential).isSymbolicLink())throw Error('Linked pairing file refused');
 const paired=JSON.parse(readFileSync(credential,'utf8'));
 if(!paired.world||!paired.soul||!paired.token)throw Error('Folder must already be paired to one Soul');
 let world=createWorldClient({world:paired.world,token:paired.token,expectedSoulId:paired.soul});
 const cfg=await fetch(paired.world.replace(/\/$/,'')+'/v1/config',{redirect:'error',signal:AbortSignal.any([stop.signal,AbortSignal.timeout(15000)])});
 if(!cfg.ok)throw Error('Cannot verify world identity');const config=await cfg.json();if(!config.worldId)throw Error('World identity unavailable');
 const instruction=values.instruction?readFileSync(resolve(values.instruction),'utf8'):undefined;
 if(instruction&&Buffer.byteLength(JSON.stringify(instruction))>16000)throw Error('Initial instruction exceeds16000 JSON-encoded bytes');
 const scope={worldId:config.worldId,soulId:paired.soul};
 if(values.evidence){
  const required=!!values['evidence-required'];
  // Default: a failed sink stops recording, not the Soul (#733 A4). --evidence-required aborts as before.
  evidence=openEvidenceRecorder(values.evidence,{scope,required,onFailure:e=>{
   if(required){evidenceFailure=e;stop.abort(e);return;}
   console.error(JSON.stringify({state:'evidence-disabled',code:e.code,reason:'Local evidence recording failed; the run continues and this evidence file is incomplete'}));
  }});
  world=evidence.wrapWorld(world);
 }
 // Opt-in soul-trace/1 host boundaries (SOUL_TRACE_FILE); nothing without it.
 trace=openHostTrace();
 journal=openJournal(state,scope);
 ownership=openJournal(join(folder,'.soul-runtime-owner'),scope);
 timer=seconds?setTimeout(quit,seconds*1000):null;
 const startedAt=new Date().toISOString();let model=values.model??null;
 const saveStatus=s=>{const out={at:new Date().toISOString(),startedAt,controllerPid:process.pid,soulId:paired.soul,worldId:config.worldId,...s},early=['host-started','session-created','host-closed'].includes(s.state);if(early)console.log(JSON.stringify(out));writeFileSync(join(state,'status.json.tmp'),JSON.stringify(out,null,2),{mode:0o600});renameSync(join(state,'status.json.tmp'),join(state,'status.json'));if(!early&&s.state!=='receiving')console.log(JSON.stringify(out));};
 try{owner=await claimStartupLease(ownership.control,{signal:stop.signal,maxWaitMs:leaseWaitMs,onWait:saveStatus});}
 catch(error){saveStatus({state:'blocked',code:error.code??'runtime.failure',reason:error.message});throw error;}
 if(!owner){saveStatus({state:'stopped'});return;}
 ownerRenewal=setInterval(()=>{try{owner=ownership.control.renew(owner);}catch(e){ownershipFailure=e;stop.abort(e);}},5000);
 const inventory=await openControllerInventory();
 if(inventory?.reentryProof?.snapshot){const recoveryFence=await claimStartupLease(journal.control,{signal:stop.signal,maxWaitMs:leaseWaitMs,onWait:saveStatus});if(!recoveryFence)return;try{const admitted=admitControllerReentry(journal,recoveryFence,inventory.reentryProof,{journalPath:join(state,'continuity.sqlite'),scope});saveStatus({state:'controller-reentry',proofId:admitted.proofId,charged:admitted.charged});}finally{journal.control.release(recoveryFence);}}
 const cwd=join(state,'host');mkdirSync(cwd,{recursive:true,mode:0o700});
  await runManaged({journal,world,instruction,signal:stop.signal,onState:trace?s=>{trace.state(s);saveStatus(s);}:saveStatus,createHost:()=>{
   const reservation=inventory?.reserveHost();
   const host=new Host({cwd,model,effort:values.effort,name:values['session-name']??`Sim Soul — ${paired.soul}`});
   ownedHosts.add(host);
   if(inventory){try{inventory.registerHost(reservation,host.pid);}catch(e){void host.close().catch(()=>{});throw e;}host.on('lifecycle',s=>{if(s.state==='host-closed')inventory.hostClosed(reservation,s);});}
   evidence?.bindHost(host);trace?.bindHost(host);
   host.on('lifecycle',saveStatus);
   host.on('event',e=>{if(e.method==='thread/tokenUsage/updated'){writeFileSync(join(state,'usage.json'),JSON.stringify({at:new Date().toISOString(),threadId:host.threadId,model:host.model,usage:e.params.tokenUsage},null,2),{mode:0o600});}if(host.model)model=host.model;});
   return host;
  }});
  if(ownershipFailure||evidenceFailure)throw evidenceFailure??ownershipFailure;
 }catch(error){runFailure=error;if(!stop.signal.aborted||ownershipFailure||evidenceFailure)throw evidenceFailure??ownershipFailure??error;}
 finally{
  stop.abort();clearInterval(ownerRenewal);await Promise.allSettled([...ownedHosts].map(host=>host.close()));
  const proofs=[...ownedHosts].map(host=>host.closeProof??{hostPid:host.pid??null,threadId:host.threadId,groupClosed:false,groupVerification:'unverified'});
  if(owner)try{ownership.control.release(owner)}catch{}ownership?.close();clearTimeout(timer);process.removeListener('SIGINT',quit);process.removeListener('SIGTERM',quit);signal?.removeEventListener('abort',externalAbort);journal?.close();
  await trace?.close();
  let evidenceSummary,evidenceCloseError;
  try{evidenceSummary=await evidence?.close({failed:!!runFailure,ownedProcessesExited:proofs.every(p=>p.groupClosed===true)});}catch(e){evidenceCloseError=e;evidenceSummary={complete:false,code:e.code??'EVIDENCE_IO'};}
  console.log(JSON.stringify({state:'controller-closed',controllerPid:process.pid,ownedHosts:proofs,ownedProcessesExited:proofs.every(p=>p.groupClosed===true),...(evidenceSummary?{evidence:evidenceSummary}:{})}));
  if(evidenceCloseError)throw evidenceCloseError;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({state:'blocked',code:e.code??'runtime.failure',reason:e.message}));process.exitCode=1;});
