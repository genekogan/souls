import type {IntentReceiptV2,IntentRequestV2} from '@souls/protocol';
import type {IntentResponse} from './intent-response.ts';
import {intentFeedback} from './intent-feedback.ts';
export type DiagnosticContext={worldId:string;soulId:string;entityId?:string;backendBuild?:string;sentAt?:string;observedAt?:string;responseStatus?:number;body?:{activity?:string;actionId?:string;seatedOn?:string;tick?:number}};
export type DiagnosticScope={worldId:string;soulId:string;ownerId:string;principalId?:string;entityId?:string;requestId:string};
const unavailable='Unavailable — not supplied in this request evidence.';
export function redactDiagnosticText(value:string):string{
 return value.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[redacted private key]')
 .replace(/\bBearer\s+[A-Za-z0-9._~+/:=-]+/gi,'Bearer [redacted]')
 .replace(/\b(?:sim_[A-Za-z0-9_-]{20,}|sk[-_][A-Za-z0-9_-]{8,}|0x[a-fA-F0-9]{64})\b/g,'[redacted credential]')
 .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[redacted]@')
 .replace(/((?:authorization|password|api[_ -]?key|poll_token|access_token|token)\s*[:=]\s*)[^\s"',;]+/gi,'$1[redacted]');
}
export function loadedFrontendBuild():string{
 if(typeof document==='undefined')return unavailable;
 const source=document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
 try{const name=source?new URL(source).pathname.split('/').pop():null;return name&&/^[A-Za-z0-9._-]{1,240}$/.test(name)?name:unavailable;}catch{return unavailable;}
}

/* ---------- G414: strict own-request diagnostics DTO (Core producer, App consumer) ----------
 * Read-only GET /v1/souls/:soulId/intent-v2/requests/:requestId/diagnostics.
 * Separate from the strict receipt so existing receipt readers are unchanged. Every object is
 * closed: an unknown key, wrong type, oversize value or foreign scope refuses the whole DTO and
 * nothing from it is shown. Absent optional fields are rendered as explicitly unavailable. */
export const OWN_REQUEST_DIAGNOSTICS='own-request-diagnostics/1';
const stages=['received','understood','refused','withdrawn'] as const;
const attemptPhases=['accepted','started','blocked','completed','interrupted'] as const;
const goals=['walk','sit','rest','eat','activity','hang_out'] as const;
export type OwnRequestDiagnostics={
 contract:typeof OWN_REQUEST_DIAGNOSTICS;requestId:string;worldId:string;soulId:string;entityId:string;
 source:{kind:'owner';ownerId:string;principalId:string;channel:string};
 server:{createdAt:number;updatedAt:number;build?:string};
 stage:typeof stages[number];words?:string;code?:string;explanation?:string;
 validation?:{code:string;detail:string};
 resolution?:{goal?:typeof goals[number];bindingId?:string;destination?:string;available?:boolean;failedCondition?:string;conditionExplanation?:string};
 body?:{tick:number;activity?:string;actionId?:string;controller?:string;programme?:string;sleep?:string;busy?:boolean;busyReason?:string;queue?:{position:number;length:number}};
 attempts?:{attemptId:string;phase:typeof attemptPhases[number];seq:number;tick:number;reason?:string}[];
 unavailable?:{field:string;reason:string}[];
};
export type ServerDiagnostics={kind:'loading'}|{kind:'available';dto:OwnRequestDiagnostics}|{kind:'unavailable';reason:string};
type Spec={[k:string]:(v:unknown)=>boolean};
const isRef=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(v);
const isText=(max:number)=>(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=max;
const isInt=(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=0;
const isBool=(v:unknown)=>typeof v==='boolean';
const oneOf=(list:readonly string[])=>(v:unknown)=>typeof v==='string'&&list.includes(v);
const plain=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function closed(spec:Spec,required:string[]){return (v:unknown)=>plain(v)&&Object.keys(v).every(k=>k in spec&&v[k]!==undefined&&spec[k](v[k]))&&required.every(k=>k in v);}
function list(item:(v:unknown)=>boolean,max:number){return (v:unknown)=>Array.isArray(v)&&v.length<=max&&v.every(item);}
const dtoShape=closed({
 contract:v=>v===OWN_REQUEST_DIAGNOSTICS,requestId:isRef,worldId:isRef,soulId:isRef,entityId:isRef,
 source:closed({kind:v=>v==='owner',ownerId:isRef,principalId:isRef,channel:isRef},['kind','ownerId','principalId','channel']),
 server:closed({createdAt:isInt,updatedAt:isInt,build:isRef},['createdAt','updatedAt']),
 stage:oneOf(stages),words:isText(2000),code:isRef,explanation:isText(500),
 validation:closed({code:isRef,detail:isText(500)},['code','detail']),
 resolution:closed({goal:oneOf(goals),bindingId:isRef,destination:isText(200),available:isBool,failedCondition:isRef,conditionExplanation:isText(500)},[]),
 body:closed({tick:isInt,activity:isRef,actionId:isRef,controller:isRef,programme:isRef,sleep:isRef,busy:isBool,busyReason:isText(300),queue:closed({position:isInt,length:isInt},['position','length'])},['tick']),
 attempts:list(closed({attemptId:isRef,phase:oneOf(attemptPhases),seq:isInt,tick:isInt,reason:isText(500)},['attemptId','phase','seq','tick']),20),
 unavailable:list(closed({field:isRef,reason:isText(200)},['field','reason']),40),
},['contract','requestId','worldId','soulId','entityId','source','server','stage']);
/** Never returns or echoes the raw body. Scope must equal the current authorized owner/world/Soul/body/request. */
export function ownRequestDiagnostics(status:number,body:unknown,scope:DiagnosticScope):ServerDiagnostics{
 if(status===404||status===405||status===501)return {kind:'unavailable',reason:`Not provided by this server (HTTP ${status}).`};
 if(status===401||status===403)return {kind:'unavailable',reason:`Your current account cannot read diagnostics for this request (HTTP ${status}).`};
 if(status===0)return {kind:'unavailable',reason:'The diagnostics read did not complete.'};
 if(status!==200)return {kind:'unavailable',reason:`The server answered HTTP ${status}.`};
 if(!plain(body)||body.contract!==OWN_REQUEST_DIAGNOSTICS)return {kind:'unavailable',reason:'Not provided by this server (no own-request-diagnostics/1 response).'};
 if(!dtoShape(body))return {kind:'unavailable',reason:'The server diagnostics failed validation and were not shown.'};
 const d=body as unknown as OwnRequestDiagnostics;
 if(d.requestId!==scope.requestId||d.worldId!==scope.worldId||d.soulId!==scope.soulId||(scope.entityId!==undefined&&d.entityId!==scope.entityId)
  ||d.source.ownerId!==scope.ownerId||d.source.principalId!==(scope.principalId??scope.ownerId))return {kind:'unavailable',reason:'The server diagnostics did not match this request, Soul or owner and were not shown.'};
 return {kind:'available',dto:d};
}
export function ownRequestDiagnosticsPath(soulId:string,requestId:string){return `/v1/souls/${encodeURIComponent(soulId)}/intent-v2/requests/${encodeURIComponent(requestId)}/diagnostics`;}

/* ---------- Readable precise cause (shown first, above the copyable evidence) ---------- */
const blockedCodes:Record<string,string>={
 'program.safe-stop-required':'Their current action cannot be stopped safely yet, so this new goal was refused rather than interrupting it mid-step.',
 'program.safe-stop-pending':'They are bringing their current action to a safe stop first.',
 'program.replaced':'Their current action was replaced by a newer direction.',
 'program.stopped':'Their current action was stopped before this goal could begin.',
 'seat.approach-busy':'The way to that seat is occupied right now.',
 'seat.changed':'That seat changed while the direction was being prepared.',
 'seat-access-blocked':'That seat cannot be reached from where they are.',
 'binding.changed':'That place changed while the direction was being prepared.',
 'actor.busy':'They are busy with another activity right now (for example preparing for or attending a lecture).',
 'actor.removed':'Their body is not currently present in the world.',
 'route.blocked':'The way there is blocked right now.',
 'route.unreachable':'There is no walkable route from where they are to that place.',
 'target.unknown':'That place or object is not currently known in this world.',
 'world.quiet-point':'The world is at a quiet point where new actions are paused.',
 'food.service-in-use':'Someone else is using that food service right now.',
 'food.unavailable':'There is no food available there right now.',
 'eat.bowl-empty':'The bowl there is empty.',
 'rest.native-seat-required':'Resting needs a free seat they can actually sit on.',
};
const blockedNext:Record<string,string>={
 'program.safe-stop-required':'Wait until they finish or settle their current action, then give the direction again. This request will not be retried automatically.',
 'seat.approach-busy':'Try again once the area clears, or choose another seat.',
 'actor.busy':'Wait until the current activity ends, or give a direction that fits it. This request will not be retried automatically.',
 'route.unreachable':'Choose a destination reachable from where they are.',
 'food.service-in-use':'Try again shortly, or choose another place to eat.',
};
const compilationCodes:Record<string,string>={
 schema:'The language service returned a plan in a format the world does not accept. This is a system fault in preparing the direction, not a problem with your words.',
 unknown_goal:'The prepared plan named a goal this world does not support.',
 unknown_binding:'The prepared plan named a place or object that is not registered for this Soul here.',
 invalid_plan:'The prepared plan broke the world’s rules for combining goals.',
 postcondition:'The prepared plan could not be checked against what would actually happen.',
};
const systemCodes:Record<string,string>={
 budget:'The world’s model spending limit for the current period has been reached.',
 provider:'The language service did not respond successfully.',
 key:'The language service is not configured on this server.',
 closed:'Directions are closed on this server right now.',
};
function describeGoal(goal:{goal:string;bindingId?:string}):string{
 const place=goal.bindingId?goal.bindingId.replace(/^[a-z_]+:/,'').replace(/[-_]+/g,' ').trim():'';
 const verb:Record<string,string>={walk:'go to',sit:'sit at',eat:'eat at',activity:'do',hang_out:'hang out at'};
 if(goal.goal==='rest'||!place)return goal.goal.replace('_',' ');
 return `${verb[goal.goal]??goal.goal} ${place}`;
}
export type RequestCause={headline:string;cause:string;next?:string;code?:string};
/** Plain-language cause from closed codes only; producer free text for technical failures is not echoed. */
export function requestCause(result:IntentResponse,soulName='This Soul'):RequestCause{
 if(result.kind==='unconfirmed')return {headline:result.title,cause:result.detail,next:'Keep the request reference below. Checking it reads the saved request and never sends the direction again.'};
 const receipt:IntentReceiptV2=result.receipt;
 if(receipt.phase!=='refused'){const f=intentFeedback(receipt);return {headline:f.title,cause:f.detail};}
 const o=receipt.outcome;
 if(!o)return {headline:'Direction was not accepted',cause:`The server refused this request with code ${receipt.code}.`,code:receipt.code};
 switch(o.kind){
  case 'state_blocked':return {headline:`${soulName} cannot ${describeGoal(o.goal)} right now`,cause:blockedCodes[o.code]??`${o.explanation} Blocked condition: ${o.code}.`,next:blockedNext[o.code]??'The goal itself is supported here; try again when the condition above has changed.',code:receipt.code};
  case 'compilation_failure':return {headline:'Could not prepare this direction',cause:compilationCodes[o.code]??`Preparation failed (${o.code}).`,next:'Nothing was added. Copy the diagnostics below to report it; rewording may help, but the fault is on the system side.',code:receipt.code};
  case 'system_unavailable':return {headline:'Direction service unavailable',cause:systemCodes[o.code]??`Unavailable (${o.code}).`,next:'Nothing was added. Keep the reference; you can direct again when the service is available.',code:receipt.code};
  case 'no_action':{const f=intentFeedback(receipt);return {headline:f.title,cause:f.detail,code:receipt.code};}
  default:return {headline:'Direction was not accepted',cause:`Refused with code ${receipt.code}.`,code:receipt.code};
 }
}

/** Only validated own receipt / DTO fields are selected. Never serialize raw API data. */
export function requestDiagnostics(request:IntentRequestV2|null,result:IntentResponse,context:DiagnosticContext,reference?:string,server:ServerDiagnostics={kind:'unavailable',reason:'Not requested.'},soulName?:string):string{
 const receipt=result.kind==='recorded'?result.receipt:null;
 const revision=receipt?.phase==='understood'?receipt.revision:null;
 const outcome=receipt?.phase==='refused'?receipt.outcome:null;
 const plan=revision?.interpretation.humanGoalPlan;
 const dto=server.kind==='available'?server.dto:null;
 const serverNote=server.kind==='available'?'Validated own-request-diagnostics/1 from the server.':server.kind==='loading'?'Still being read from the server.':server.reason;
 const missing=(field:string)=>dto?.unavailable?.find(u=>u.field===field)?.reason??(dto?unavailable:`Unavailable — server diagnostics: ${serverNote}`);
 const attempt=(phase:typeof attemptPhases[number])=>{const a=dto?.attempts?.filter(x=>x.phase===phase);return a?.length?a.map(x=>({attempt:x.attemptId,seq:x.seq,tick:x.tick,...(x.reason?{reason:x.reason}:{})})):missing(phase);};
 const cause=requestCause(result,soulName);
 const data={
  cause:{headline:cause.headline,explanation:cause.cause,...(cause.next?{next:cause.next}:{})},
  request:{reference:request?.requestId??reference??receipt?.requestId??unavailable,words:request?.op==='upsert'?request.words:revision?.words??dto?.words??missing('words'),world:context.worldId,soul:context.soulId,body:context.entityId??dto?.entityId??unavailable,operation:request?.op??unavailable},
  timestamps:{clientSent:context.sentAt??unavailable,clientObserved:context.observedAt??unavailable,serverCreated:dto?new Date(dto.server.createdAt).toISOString():missing('serverCreated'),serverUpdated:dto?new Date(dto.server.updatedAt).toISOString():missing('serverUpdated'),submitted:revision?.submitted??(receipt?.phase==='received'?{seq:receipt.seq,tick:receipt.tick}:unavailable)},
  response:{httpStatus:context.responseStatus??unavailable,stage:receipt?.phase??'unconfirmed',code:receipt?.phase==='refused'?receipt.code:dto?.code??unavailable,typedOutcome:outcome?.kind??unavailable,failedCondition:outcome&&'code' in outcome?outcome.code:dto?.resolution?.failedCondition??unavailable,serverStage:dto?.stage??missing('stage'),serverExplanation:dto?.explanation??missing('explanation')},
  interpretation:{summary:revision?.interpretation.summary??unavailable,goals:plan?.kind==='planned'?plan.goals:outcome?.kind==='state_blocked'&&outcome.goal?[outcome.goal]:unavailable,resolvedDestination:dto?.resolution?.destination??missing('destination'),binding:dto?.resolution?.bindingId??(outcome?.kind==='state_blocked'&&'bindingId' in outcome.goal?outcome.goal.bindingId:missing('binding')),availability:dto?.resolution?.available!==undefined?(dto.resolution.available?'Available':'Unavailable'):outcome?.kind==='state_blocked'?'Unavailable when interpreted':missing('availability'),conditionExplanation:dto?.resolution?.conditionExplanation??missing('conditionExplanation')},
  physical:{
   serverBodySnapshot:dto?.body?{tick:dto.body.tick,activity:dto.body.activity??missing('activity'),action:dto.body.actionId??missing('action')}:missing('body'),
   publicBodySnapshot:context.body??unavailable,snapshotMeaning:'Current snapshots; not proof of the state when this request was decided.',
   controller:dto?.body?.controller??missing('controller'),programme:dto?.body?.programme??missing('programme'),sleepState:dto?.body?.sleep??missing('sleep'),
   busyCondition:dto?.body?.busy===undefined?missing('busy'):dto.body.busy?(dto.body.busyReason??'Busy'):'Not busy',
   queue:dto?.body?.queue??missing('queue'),admitted:attempt('accepted'),started:attempt('started'),blocked:attempt('blocked'),completed:attempt('completed'),interrupted:attempt('interrupted')},
  versions:{loadedFrontend:loadedFrontendBuild(),backendObservedFromWelcome:context.backendBuild??unavailable,backendFromDiagnostics:dto?.server.build??missing('build')},
  validation:result.kind==='recorded'?'Receipt validated for this own request/world/Soul/body/source.':'Response did not pass current request/scope validation. Raw response suppressed.',
  serverDiagnostics:serverNote,
  redactedException:dto?.validation?{code:dto.validation.code,detail:dto.validation.detail}:missing('validation'),
 };
 return JSON.stringify(data,(_key,value)=>typeof value==='string'?redactDiagnosticText(value):value,2);
}
export function requestNeedsDiagnostics(result:IntentResponse|null):boolean{return !!result&&(result.kind==='unconfirmed'||result.receipt.phase==='refused');}

/** The owner's own words for this request, from the local request, the understood receipt or the validated DTO. */
export function ownWords(request:IntentRequestV2|null,result:IntentResponse|null,server?:ServerDiagnostics):string|undefined{
 if(request?.op==='upsert')return request.words;
 if(result?.kind==='recorded'&&result.receipt.phase==='understood')return result.receipt.revision.words;
 return server?.kind==='available'?server.dto.words:undefined;
}

/* ---------- Actual controller phase for an understood direction (from G414 attempts/state) ---------- */
export type RequestPhase={kind:'waiting'|'not-started'|'accepted'|'started'|'completed'|'interrupted'|'blocked';title:string;detail:string;earlier?:string;terminal:boolean};
const waitingConditions:Record<string,string>={
 'quiet-renewal':'Eden is in its quiet hours, renewing before first light. This starts as soon as renewal finishes.',
 asleep:'They are asleep. This starts when they wake.',
 seated:'They will get up from their seat first.',
 moving:'They will finish their current movement first.',
 busy:'They will finish their current activity first.',
 'world-settling':'The world is settling. This starts shortly.',
};
const stopReason=(reason?:string)=>!reason?'The action stopped before finishing.':reason==='program.replaced'?'A newer direction replaced it before it finished.':blockedCodes[reason]??`The action stopped before finishing (${reason}).`;
export function requestPhase(dto:OwnRequestDiagnostics):RequestPhase{
 const attempts=dto.attempts??[],dest=dto.resolution?.destination;
 const last=attempts.at(-1);
 if(last){
  const current=attempts.filter(a=>a.attemptId===last.attemptId).at(-1)!;
  const earlierStops=attempts.filter(a=>a.attemptId!==last.attemptId&&a.phase==='interrupted');
  const earlier=earlierStops.length?`An earlier attempt stopped: ${stopReason(earlierStops.at(-1)!.reason)}`:undefined;
  const e=earlier?{earlier}:{};
  switch(current.phase){
   case 'completed':return {kind:'completed',title:'Completed',detail:dest?`Done: ${dest}.`:'The action finished.',...e,terminal:true};
   case 'interrupted':return {kind:'interrupted',title:'Stopped before finishing',detail:stopReason(current.reason),...e,terminal:true};
   case 'blocked':return {kind:'blocked',title:'Blocked for now',detail:current.reason?(blockedCodes[current.reason]??`Blocked (${current.reason}).`):'The action is blocked.',...e,terminal:false};
   case 'started':return {kind:'started',title:'In progress',detail:dest?`On the way: ${dest}.`:'Started and not finished yet.',...e,terminal:false};
   default:return {kind:'accepted',title:'Starting',detail:'Accepted by the world; about to begin.',...e,terminal:false};
  }
 }
 const condition=dto.resolution?.failedCondition;
 if(condition&&(condition in waitingConditions||dto.resolution?.conditionExplanation))return {kind:'waiting',title:'Waiting to start',detail:dto.resolution?.conditionExplanation??waitingConditions[condition],terminal:false};
 if(dto.body?.busy)return {kind:'waiting',title:'Waiting to start',detail:dto.body.busyReason??'They will finish their current activity first.',terminal:false};
 return {kind:'not-started',title:'Not started yet',detail:'Saved as direction. The world has not begun it yet.',terminal:false};
}
