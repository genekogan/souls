// Durable boundary between model decisions and public effects. Planning text is
// private agent state; only a world response/receipt proves an external effect.
import {randomUUID} from 'node:crypto';
import {verifyControllerReentry} from './controller-ownership.mjs';
import {responseReference,responseProjection,receiptProjection,validateResponseArguments} from './responses.mjs';
// Reserve one finite envelope for both recovery markers. Native observations
// remain exact in their durable response slots when a legacy checkpoint needs
// projection; private plan/task state is never trimmed to make recovery fit.
export const RECOVERY_METADATA_BYTES=2048;
const size=value=>Buffer.byteLength(JSON.stringify(value));
const progressFault=message=>Object.assign(Error(message),{code:'DECISION_PROGRESS_STATE_INVALID'});
export function decisionProgress(value){
 const p=value?.decisionProgressV1;if(p==null)return null;
 if(!p||typeof p!=='object'||typeof p.id!=='string'||!/^[-A-Za-z0-9._:]{1,200}$/.test(p.id)||!['ready','active','soft-pending','fallback-reserved','blocked'].includes(p.phase)||!Number.isInteger(p.window)||p.window<1||p.window>3||!Number.isInteger(p.worldReplans)||p.worldReplans<0||p.worldReplans>2||!Number.isFinite(p.deadlineAt)||typeof p.softUsed!=='boolean'||typeof p.fallbackUsed!=='boolean'||p.turnId!==null&&(typeof p.turnId!=='string'||!/^[-A-Za-z0-9._:]{1,200}$/.test(p.turnId))||p.hostPid!==null&&(!Number.isSafeInteger(p.hostPid)||p.hostPid<1)||p.grant!=null&&(!['urgent','progress'].includes(p.grant.kind)||typeof p.grant.id!=='string'||!/^[-A-Za-z0-9._:]{1,200}$/.test(p.grant.id)||p.grant.turnId!==null&&(typeof p.grant.turnId!=='string'||!/^[-A-Za-z0-9._:]{1,200}$/.test(p.grant.turnId))||p.grant.hostPid!==null&&(!Number.isSafeInteger(p.grant.hostPid)||p.grant.hostPid<1)))throw progressFault('Invalid persisted active-decision recovery state; task retained');
 const a=p.includedUrgency;
 if(Object.hasOwn(p,'includedUrgency')&&(!a||typeof a!=='object'||Object.keys(a).sort().join(',')!=='deadlineAt,eventId,reason,sequence,source,spent,triggerAt'||!['owner','world'].includes(a.source)||a.reason!==(a.source==='owner'?'owner':'direct')||typeof a.eventId!=='string'||!a.eventId.length||a.eventId.length>200||/[\u0000-\u001f]/.test(a.eventId)||!Number.isSafeInteger(a.sequence)||a.sequence<1||!Number.isFinite(a.triggerAt)||a.triggerAt<0||!Number.isFinite(a.deadlineAt)||a.deadlineAt<=a.triggerAt||a.deadlineAt-a.triggerAt>60000||typeof a.spent!=='boolean'))throw progressFault('Invalid included-alert response attempt; state retained');
 if(p.window>1+Number(p.softUsed)+Number(p.fallbackUsed)||p.phase==='soft-pending'&&!p.softUsed||p.phase==='fallback-reserved'&&(!p.fallbackUsed||!p.grant))throw progressFault('Inconsistent persisted decision recovery credits');
 if(size({urgentRecoveryV1:value.urgentRecoveryV1,decisionProgressV1:p})>RECOVERY_METADATA_BYTES)throw progressFault('Recovery metadata exceeds its bounded envelope');
 return p;
}
export function saveRecoveryCheckpoint(journal,fence,revision,value){
 decisionProgress(value);
 const {urgentRecoveryV1,decisionProgressV1,...body}=value;
 if(size({urgentRecoveryV1,decisionProgressV1})>RECOVERY_METADATA_BYTES)throw progressFault('Recovery metadata exceeds its bounded envelope');
 if(size(body)>65536-RECOVERY_METADATA_BYTES-128){
  const id=body.lastDecisionId;let response,reference;
  if(body.lastCall?.type==='read'&&id){const saved=journal.control.readResult(id);if(saved)({response,reference}=saved);}
  else if(body.lastCall?.type==='write'&&id&&journal.control.hasOperation(id)){const op=journal.control.operation(id);if(op.status==='settled'){response=op.response;reference=responseReference('operation',id,JSON.stringify(response));}}
  if(!reference||JSON.stringify(response)!==JSON.stringify(body.lastResult))throw progressFault('Legacy checkpoint needs verified durable response projection before recovery metadata fits');
  body.lastResult=responseProjection(response,reference,{bytesLimit:0});
  if(size(body)>65536-RECOVERY_METADATA_BYTES-128)throw progressFault('Checkpoint intent exceeds reserved recovery envelope; state retained');
 }
 return journal.control.save(fence,revision,{...body,...(urgentRecoveryV1===undefined?{}:{urgentRecoveryV1}),...(decisionProgressV1===undefined?{}:{decisionProgressV1})});
}
// Only the trusted launcher's complete post-death ownership proof admits this
// path. Claim generation is the durable one-use token, even without a choice.
export function admitControllerReentry(journal,fence,proof,{journalPath,scope,activeDecisionMs=30000}={}){
 journal.control.assertOwner(fence);
 if(!Number.isSafeInteger(activeDecisionMs)||activeDecisionMs<1||activeDecisionMs>300000)throw progressFault('Invalid active recovery window');
 const proofId=verifyControllerReentry(proof,{journalPath,scope,fence});
 const c=journal.control.checkpoint(),p=decisionProgress(c.value);
 // Reconciliation keeps its original operation IDs; absence never authorizes
 // dispatching an uncertain effect or discarding a retained decision.
 if(c.value?.pendingDecision||!p)return {admitted:true,proofId,charged:false};
 if(p.phase==='blocked'||p.window>=3||p.phase!=='fallback-reserved'&&(p.fallbackUsed||c.value.urgentRecoveryV1?.fallbackUsed))throw Object.assign(Error('Killed controller has no remaining shared fallback; state retained'),{code:'DECISION_PROGRESS_BUDGET_EXHAUSTED'});
 if(p.phase==='fallback-reserved'&&(!p.fallbackUsed||!p.grant||!proof.hosts.some(h=>h.birth.pid===p.grant.hostPid)))throw progressFault('Reserved fallback does not match the proven old host inventory');
 if(p.hostPid!==null&&!proof.hosts.some(h=>h.birth.pid===p.hostPid))throw progressFault('Active host is missing from complete ownership proof');
 const grant=p.phase==='fallback-reserved'?p.grant:{id:proofId,kind:'progress',turnId:p.turnId,hostPid:p.hostPid};
 saveRecoveryCheckpoint(journal,fence,c.revision,{...c.value,...(c.value.urgentRecoveryV1?{urgentRecoveryV1:{...c.value.urgentRecoveryV1,fallbackUsed:true}}:{}),decisionProgressV1:{...p,phase:'ready',fallbackUsed:true,window:p.window+1,deadlineAt:Date.now()+activeDecisionMs,turnId:null,hostPid:null,grant:{...grant,oldGroupAbsent:true,threadId:c.value.threadId}}});
 return {admitted:true,proofId,charged:true};
}
export const DECISION_SCHEMA={type:'object',additionalProperties:false,required:['plan','call','wakeAt'],properties:{
 plan:{type:'string',description:'Compact durable task state: current goal and original constraints, completed receipt IDs, current step, suspended work, deadlines and next step. Do not claim unobserved completion.'},
 call:{type:'object',additionalProperties:false,required:['type','command','arguments'],properties:{type:{type:'string',enum:['read','write','listen','wait']},command:{type:'string'},arguments:{type:'string',description:'A JSON object of arguments. Local type listen, command listen: exactly {listenTo:[observed Soul IDs]}, {listenTo:"nearby"}, or {listenTo:[]} to durably configure attention and immediately continue to the next decision. Wait sleeps: {} for events, {seconds:N} for a relative wake; wait may also configure listenTo before sleeping. Wakeup and listening survive other calls independently. Use wait {cancelWake:true} only to cancel the saved wakeup.'}}},
 wakeAt:{type:['string','null'],description:'ISO8601 wall-clock wakeup with timezone, or null for no new wakeup. A listen configuration preserves the saved wakeup when null and immediately continues; it never sleeps.'},
}};
const READS=new Set(['help','response','tasks','task','resync','here','observe','explore','resolve','receipt','conversations','turns','calendar','reminders','object']);
const WRITES=new Set(['act','say','converse','ack','result','remind','object']);
export function listeningScope(value){
 if(value==='nearby')return value;
 if(!Array.isArray(value)||value.length>12||value.some(id=>typeof id!=='string'||!/^s_[A-Za-z0-9_-]{1,198}$/.test(id)))throw Error('listenTo needs up to12 observed Soul IDs, "nearby", or [] to clear');
 return [...new Set(value)].sort();
}
export function parseDecision(text,{now=Date.now}={}){
 const value=JSON.parse(text);
 if(!value||Object.keys(value).sort().join(',')!=='call,plan,wakeAt')throw Error('Decision fields differ from contract');
 if(typeof value.plan!=='string'||value.plan.length>16000||Buffer.byteLength(JSON.stringify(value.plan))>16000)throw Error('Invalid durable plan: JSON-encoded text must be <=16000 bytes');
 const call=value.call;if(!call||Object.keys(call).sort().join(',')!=='arguments,command,type')throw Error('Invalid call');
 if(typeof call.arguments!=='string'||call.arguments.length>16000||Buffer.byteLength(JSON.stringify(call.arguments))>16000)throw Error('Invalid call arguments: JSON-encoded text must be <=16000 bytes');
 const args=JSON.parse(call.arguments);if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Call arguments must be an object');
 if(call.type==='read'?!READS.has(call.command):call.type==='write'?!WRITES.has(call.command):call.type==='listen'?call.command!=='listen':call.type!=='wait')throw Error('Unsupported decision command');
 if(call.type==='listen'&&Object.keys(args).sort().join(',')!=='listenTo')throw Error('Listen needs exactly listenTo; use wait for sleeping or cancelling a wakeup');
 if(call.type==='read'&&['tasks','task'].includes(call.command)){
  const fields=call.command==='tasks'?['after','limit']:['id','offset'];
  if(Object.keys(args).some(k=>!fields.includes(k)))throw Error('Invalid local owner task arguments');
  if(call.command==='tasks'&&(args.after!==undefined&&(!Number.isSafeInteger(args.after)||args.after<0)||args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>20)))throw Error('Local tasks needs nonnegative sequence after and limit 1..20');
  if(call.command==='task'&&(typeof args.id!=='string'||!args.id.length||args.id.length>200||args.offset!==undefined&&(!Number.isSafeInteger(args.offset)||args.offset<0||args.offset>65536)))throw Error('Local task needs id and nonnegative text offset');
 }
 if(call.type==='read'&&call.command==='response')validateResponseArguments(args);
 if(Object.hasOwn(args,'listenTo')){if(!['listen','wait'].includes(call.type))throw Error('Only wait or listen can change listenTo');args.listenTo=listeningScope(args.listenTo);}
 if(value.wakeAt!==null&&(typeof value.wakeAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(value.wakeAt)||!Number.isFinite(Date.parse(value.wakeAt))))throw Error('Wakeup needs explicit wall clock/timezone');
 let wakeAt=value.wakeAt;
 if(call.type==='wait'&&args.seconds!==undefined){
  if(!Number.isFinite(args.seconds)||args.seconds<1||args.seconds>86400)throw Error('Relative wait must be1..86400 seconds');
  const relative=now()+Math.round(args.seconds*1000);wakeAt=new Date(wakeAt===null?relative:Math.min(relative,Date.parse(wakeAt))).toISOString();
 }
 return {...value,wakeAt,call:{type:call.type,command:call.command,args}};
}
// Owner commitments are the explicit wall-clock times (ISO8601 with a timezone)
// in retained owner intent: the initial instruction and open owner tasks. A
// saved wake at or after such a time leaves no time to act on it, so the
// scheduled wake moves ahead by a lead: 10% of the time remaining, at least
// 120 s (a cross-place walk plus a few decisions and a report) and at most
// 600 s (a far earlier wake would only be slept through again). The lead is
// re-derived from the remaining time, so a commitment gets at most two early
// wakes, and one when it is under 20 minutes away. Scheduling only: the Soul
// sees the same prompt fields and still decides everything itself.
export const DEADLINE_LEAD=Object.freeze({minMs:120000,maxMs:600000,fraction:0.1});
export const deadlineLeadMs=remainingMs=>Math.min(DEADLINE_LEAD.maxMs,Math.max(DEADLINE_LEAD.minMs,Math.round(remainingMs*DEADLINE_LEAD.fraction)));
const OWNER_TIME=/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/g;
export function ownerCommitmentTimes(texts){
 const times=new Set();
 for(const text of texts)if(typeof text==='string')for(const m of text.matchAll(OWNER_TIME)){const t=Date.parse(m[0]);if(Number.isFinite(t))times.add(t);}
 return [...times].sort((a,b)=>a-b);
}
export function deadlineWake(wakeAt,commitments,now){
 if(wakeAt==null)return {wakeAt:null,lead:null};
 const requested=Date.parse(wakeAt);let best=null;
 for(const deadline of commitments){
  if(deadline<=now)continue;
  const at=deadline-deadlineLeadMs(deadline-now);
  if(at>now&&at<requested&&(!best||at<best.at))best={at,deadline};
 }
 return best?{wakeAt:new Date(best.at).toISOString(),lead:{wakeAt:new Date(best.at).toISOString(),deadlineAt:new Date(best.deadline).toISOString(),requestedWakeAt:wakeAt}}:{wakeAt,lead:null};
}
const ownerLinkId=v=>typeof v==='string'&&v.length>0&&v.length<=200&&!/[\u0000-\u001f]/.test(v)?v:null;
export function retainDecision(journal,fence,decision,{events=[],threadId,initialInstruction,deadlineAt=Infinity}={}){
 const c=journal.control.checkpoint();if(c.value?.pendingDecision)throw Error('Previous decision must be reconciled first');
 // The next choice incorporates the preceding observation. Drop that call/result
 // atomically with retaining the choice, and store its plan only once: recovery
 // needs the call/wake and checkpoint plan, not another copy of the old result.
 const {plan,...execution}=decision;
 const retainedAt=Date.now();
 if(deadlineAt!==Infinity&&!Number.isFinite(deadlineAt))throw Error('Invalid decision retention deadline');
 if(retainedAt>=deadlineAt)throw Object.assign(Error('Decision window expired before retention; no effect retained'),{code:'DECISION_WINDOW_EXPIRED'});
 const {lastResult,lastCall,...previous}=c.value??{};
 // #789 (D3 for the managed path): the newest owner message a retained decision incorporated is the owner link. The
 // act that serves it usually comes a decision later (after the ack), so the link is carried in the checkpoint, and
 // an act's pending record keeps its copy, so a replayed or reconciled write sends the same body. No time window.
 const owner=events.filter(e=>e.source==='owner'&&(e.event?.kind===undefined||e.event.kind==='owner.message')).at(-1)?.event?.id,link=ownerLinkId(owner)??ownerLinkId(previous.ownerLinkV1);
 const serves=link&&execution.call?.type==='write'&&execution.call.command==='act'?link:null;
 const id=randomUUID();const pendingDecision={id,decision:execution,eventIds:events.map(e=>({source:e.source,id:e.event.id})),retainedAt,...(serves?{for:serves}:{})};
 if(previous.lastReceipt)previous.lastReceipt=receiptProjection(previous.lastReceipt);
 journal.control.save(fence,c.revision,{...previous,...(link?{ownerLinkV1:link}:{}),threadId:threadId??c.value?.threadId,initialInstruction:c.value?.initialInstruction??initialInstruction??null,plan,pendingDecision});
 return id;
}
export async function applyPendingDecision(journal,fence,world,{signal}={}){
 const c=journal.control.checkpoint(),pending=c.value?.pendingDecision;if(!pending)return {applied:false};
 journal.control.assertOwner(fence);
 const {id,decision}=pending,call=decision.call;let response=null,reference=null;
 if(!['read','write','listen','wait'].includes(call?.type)||call.type==='read'&&!READS.has(call.command)||call.type==='write'&&!WRITES.has(call.command)||call.type==='listen'&&call.command!=='listen')throw Object.assign(Error('Retained decision requires a compatible runtime; state preserved'),{code:'UNSUPPORTED_RETAINED_DECISION'});
 if(call.type==='listen')response={local:true,listenTo:listeningScope(call.args.listenTo)};
 else if(call.type==='read'){
  if(call.command==='response')response=journal.control.response(call.args);
  else{
   let saved=journal.control.readResult(id);
   if(!saved){
    const gaps=call.command==='resync'?journal.gaps():[];let resyncThrough=call.command==='resync'?gaps.reduce((last,g)=>Math.max(last,g.seq),0):null;
    if(call.command==='tasks')response=journal.openOwnerTasks(call.args);
    else if(call.command==='task')response=journal.ownerTask(call.args);
    else try{response=await world.read(call.command,call.args,signal);}
    catch(e){
     // Native validation/not-found/conflict is an observation for replanning.
     // Auth, transport and transient server failures retain the pending read.
     if(![400,404,409,422].includes(e.status)||e.uncertain!==false)throw e;
     response={accepted:false,error:{code:e.code??'read-refused',message:e.message,status:e.status}};resyncThrough=null;
    }
    reference=journal.control.retainReadResult(fence,id,response,{resyncThrough});saved={response,reference,resyncThrough};
   }
   ({response,reference}=saved);
   if(call.command==='resync')for(const gap of journal.gaps())if(gap.seq<=saved.resyncThrough)journal.reconcileGap(gap.seq,'Current observation/conversations refreshed; past missing events remain incomplete. Decision '+id);
  }
 }
 else if(call.type==='write'&&journal.gaps().length&&!journal.control.hasOperation(id)){
  response={accepted:false,error:{code:'continuity.resync-required',message:'World event history has a gap. Read resync before writing; retain uncertainty about missing history.'}};
 }
 else if(call.type==='write'){
  let op=journal.control.prepare(fence,id,call);
  if(op.status==='prepared'){
   journal.control.dispatch(fence,id);
   try{response=await world.write(call.command,call.args,id,signal,pending.for?{for:pending.for}:undefined);}
   catch(e){
    // Even a transport with incomplete error classification must not cause
    // automatic re-execution of a potentially accepted world command.
    if(e.uncertain===false && e.status>=400 && e.status<500){
     response={accepted:false,error:{code:e.code??'refused',message:e.message,status:e.status}};
    }else{
     journal.control.uncertain(fence,id);
     throw Object.assign(Error('World operation needs reconciliation'),{code:'OPERATION_UNCERTAIN',operationId:id,cause:e});
    }
   }
   journal.control.settle(fence,id,response);op=journal.control.operation(id);
  }
  if(op.status!=='settled'&&world.reconcile){
   const known=await world.reconcile(call,id,signal);
   if(known.state==='recorded'){
    const observed=known.status>=400?{accepted:false,error:known.response?.error??{code:'refused',status:known.status}}:known.response;
    journal.control.settle(fence,id,observed);op=journal.control.operation(id);
   }
  }
  if(op.status!=='settled')throw Object.assign(Error('Earlier operation needs reconciliation'),{code:'OPERATION_UNCERTAIN',operationId:id});
  response=op.response;
  reference=responseReference('operation',id,JSON.stringify(response));
  // Closure inspects the durable settled operation's exact native result.
  // Do this before finalizing the decision: a settle->crash recovery repeats
  // this idempotently and cannot lose the original task between checkpoints.
  if(call.command==='result')journal.closeOwnerTaskFromOperation(fence,id);
 }
 journal.control.assertOwner(fence);
 // Mark incorporation only after decision and result are durable. It is NOT
 // the public owner ack/result, and does not assert goal completion.
 let incorporated=0;
 for(const event of pending.eventIds)if(!journal.handled(event.source,event.id,'incorporated:'+id).alreadyHandled)incorporated++;
 const latest=journal.control.checkpoint();
 if(latest.value?.pendingDecision?.id!==id)throw Error('Pending decision changed while applying');
 const receipt=response?.receipt==null?null:receiptProjection(response.receipt,reference);
 // Null means no newly scheduled wake, not cancellation of suspended work.
 // A due wake is consumed only by a committed non-configuration decision that
 // was retained after its deadline. Local listening configuration never consumes
 // it, so the immediate next choice still sees the outstanding reminder.
 const priorWake=latest.value.wakeAt,priorLead=latest.value.deadlineWakeV1??null,cancel=call.type==='wait'&&call.args.cancelWake===true;
 let wakeAt=decision.wakeAt??(call.type==='listen'?priorWake??null:cancel?null:priorWake&&Date.parse(priorWake)>pending.retainedAt?priorWake:null);
 // Consuming an early deadline wake restores the wake the Soul itself asked for.
 if(wakeAt===null&&decision.wakeAt==null&&!cancel&&call.type!=='listen'&&priorLead&&priorWake===priorLead.wakeAt&&Date.parse(priorLead.requestedWakeAt)>pending.retainedAt)wakeAt=priorLead.requestedWakeAt;
 const commitments=ownerCommitmentTimes([latest.value.initialInstruction,...(journal.ownerTaskTexts?.()??[])]);
 // A kept early wake whose commitment left owner intent (e.g. its task closed)
 // falls back to the requested wake, so no stale early prompt remains.
 let lead=priorLead&&wakeAt===priorLead.wakeAt?priorLead:null;
 if(lead&&!commitments.includes(Date.parse(lead.deadlineAt))){wakeAt=Date.parse(lead.requestedWakeAt)>pending.retainedAt?lead.requestedWakeAt:null;lead=null;}
 const scheduled=deadlineWake(wakeAt,commitments,pending.retainedAt);
 const deadlineWakeV1=scheduled.lead??lead;
 wakeAt=scheduled.wakeAt;
 // A real applied decision, including an explicit refusal, is the progress
 // boundary. Retention, inference and uncertain effects never refill this budget.
 const {lastResult,urgentRecoveryV1,decisionProgressV1,deadlineWakeV1:_lead,...previous}=latest.value;
 const listenTo=['listen','wait'].includes(call.type)&&Object.hasOwn(call.args,'listenTo')?listeningScope(call.args.listenTo):latest.value.listenTo??[];
 // The owner link is used up by the first accepted act that served it, unless the world keeps the message open (a
 // later step remains, D3c); a world refusal of the link or the agent's own result for that message also ends it.
 const linkEnded=(Boolean(pending.for)&&call.command==='act'&&((response?.accepted===true&&!response.open)||(response?.error?.status===400&&/no owner message/.test(response.error.message??''))))
  ||(call.type==='write'&&call.command==='result'&&call.args.id===previous.ownerLinkV1)
  // Choosing to wait ends it too: an act the Soul starts on its own later must not close an old message (D3b).
  ||call.type==='wait';
 if(linkEnded)delete previous.ownerLinkV1;
 const finalized={...previous,pendingDecision:null,lastDecisionId:id,lastCall:call,wakeAt,listenTo,...(deadlineWakeV1?{deadlineWakeV1}:{}),lastReceipt:receipt??receiptProjection(latest.value.lastReceipt)??null};
 // Count the actual surrounding checkpoint, including the lastResult key and
 // comma, before deciding whether this complete observation fits inline.
 const envelopeBytes=Buffer.byteLength(JSON.stringify({...finalized,lastResult:null}))-4;
 const bytesLimit=Math.max(0,Math.min(32768,65536-envelopeBytes-RECOVERY_METADATA_BYTES-128));
 journal.control.save(fence,latest.revision,{...finalized,lastResult:responseProjection(response,reference,{bytesLimit})});
 return {applied:true,id,call,response,wakeAt,incorporated};
}
