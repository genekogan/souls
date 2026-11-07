// G414/G417: strict current-own request diagnostics. Read-only; scoped by the
// existing owner lookup. No raw model output, reasoning, keys, chain, other
// owner or other body state. Every object is closed (App refuses unknown keys).
import {z} from 'zod';
import {intentAdmissionFactV2,intentControllerFactV2,type IntentReceiptV2} from '@souls/protocol';
import {readHumanCapabilitiesV1} from './human-capabilities.ts';
import {humanBodyStateV1,humanWaitConditionV1} from './human-wait-condition.ts';
import type {WorldHost,Mind} from './world.ts';
const ref=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/),text=(n:number)=>z.string().min(1).max(n),int=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const ownRequestDiagnosticsV1Schema=z.strictObject({
 contract:z.literal('own-request-diagnostics/1'),requestId:ref,worldId:ref,soulId:ref,entityId:ref,
 source:z.strictObject({kind:z.literal('owner'),ownerId:ref,principalId:ref,channel:ref}),
 server:z.strictObject({createdAt:int,updatedAt:int,build:ref.optional()}),
 stage:z.enum(['received','understood','refused','withdrawn']),words:text(2000).optional(),code:ref.optional(),explanation:text(500).optional(),
 validation:z.strictObject({code:ref,detail:text(500)}).optional(),
 resolution:z.strictObject({goal:z.enum(['walk','sit','rest','eat','activity','hang_out']).optional(),bindingId:ref.optional(),destination:text(200).optional(),available:z.boolean().optional(),failedCondition:ref.optional(),conditionExplanation:text(500).optional()}).optional(),
 body:z.strictObject({tick:int,activity:ref.optional(),actionId:ref.optional(),controller:ref.optional(),programme:ref.optional(),sleep:ref.optional(),busy:z.boolean().optional(),busyReason:text(300).optional(),queue:z.strictObject({position:int,length:int}).optional()}).optional(),
 attempts:z.array(z.strictObject({attemptId:ref,phase:z.enum(['accepted','started','blocked','completed','interrupted']),seq:int,tick:int,reason:text(500).optional()})).max(20).optional(),
 unavailable:z.array(z.strictObject({field:ref,reason:text(200)})).max(40).optional(),
});
export type OwnRequestDiagnosticsV1=z.infer<typeof ownRequestDiagnosticsV1Schema>;
const asRef=(v:unknown)=>typeof v==='string'&&ref.safeParse(v).success?v:undefined;
const clip=(v:string,n:number)=>v.length>n?v.slice(0,n-1)+'…':v;
type Source={kind:'owner';ownerId:string;principalId:string;channel:string};
/** Caller must have authorized `scope` and re-check it after this synchronous read. */
export function ownRequestDiagnosticsV1(host:WorldHost,m:Mind,input:{requestId:string;words?:string;source:Source;createdAt:number;updatedAt:number;receipt:IntentReceiptV2;build?:string;registeredActivitiesV1?:boolean}):OwnRequestDiagnosticsV1{
 const r=input.receipt,unavailable:{field:string;reason:string}[]=[],gone=(field:string,reason:string)=>unavailable.push({field,reason:clip(reason,200)});
 const out:OwnRequestDiagnosticsV1={contract:'own-request-diagnostics/1',requestId:input.requestId,worldId:host.worldId,soulId:m.soulId,entityId:m.entityId,source:{kind:'owner',ownerId:input.source.ownerId,principalId:input.source.principalId,channel:input.source.channel},server:{createdAt:input.createdAt,updatedAt:input.updatedAt,...(asRef(input.build)?{build:input.build}:{})},stage:r.phase,...(input.words?{words:clip(input.words,2000)}:{})};
 if(!out.server.build)gone('build','This server did not declare a build name.');
 let goal:{goal:string;bindingId?:string}|undefined;
 if(r.phase==='refused'){
  out.code=asRef(r.code);out.explanation=clip(r.reason,500);
  const o=r.outcome;
  if(o?.kind==='state_blocked'){goal=o.goal;out.resolution={failedCondition:asRef(o.code)};}
  if(o?.kind==='compilation_failure'||o?.kind==='system_unavailable')out.validation={code:asRef(r.code)??'refused',detail:clip(o.explanation,500)};
  else gone('validation','No technical validation step failed for this request.');
 }else if(r.phase==='understood'){
  out.explanation=clip(r.revision.interpretation.summary,500);const plan=r.revision.interpretation.humanGoalPlan;
  if(plan?.kind==='planned')goal=plan.goals[0];else gone('binding','This direction was understood without a typed goal binding.');
  gone('validation','No technical validation step failed for this request.');
 }else{gone('explanation','No explanation is recorded at this stage.');gone('validation','No validation has run yet.');}
 if(goal){
  const bindingId=goal.goal==='rest'?'rest:self':goal.bindingId;let binding;
  try{binding=bindingId?readHumanCapabilitiesV1(host,m,{registeredActivitiesV1:input.registeredActivitiesV1}).bindings.get(bindingId):undefined;}catch{binding=undefined;}
  out.resolution={...out.resolution,goal:goal.goal as NonNullable<OwnRequestDiagnosticsV1['resolution']>['goal'],...(asRef(bindingId)?{bindingId}:{})};
  if(binding){out.resolution.destination=clip(binding.label,200);out.resolution.available=binding.available;
   const wait=binding.available?null:humanWaitConditionV1(host,m,binding.blockedCode);
   if(!binding.available&&r.phase==='understood'){out.resolution.failedCondition=asRef(wait?.condition??binding.blockedCode);if(wait)out.resolution.conditionExplanation=clip(wait.explanation,500);}
   if(!out.resolution.conditionExplanation)gone('conditionExplanation',binding.available?'The destination is currently available.':'Failure-time condition only; see code and explanation.');
  }else{gone('destination','The binding is not in the current registry for this body.');gone('availability','The binding is not in the current registry for this body.');}
 }else if(r.phase!=='received'&&r.phase!=='withdrawn'){gone('destination','No goal binding was selected.');gone('availability','No goal binding was selected.');}
 const s=humanBodyStateV1(host,m);
 if(s){
  const busyReason=s.quietRenewal?'Eden is quietly renewing before first light; new actions start after renewal.':s.asleep?'Asleep.':s.seated?'Seated.':s.moving?'Moving.':undefined;
  out.body={tick:host.engine.world.tick,...(asRef(s.activity)?{activity:s.activity!}:{}),...(s.action&&asRef(host.engine.programAction?.(s.programId!)?.action.id)?{actionId:host.engine.programAction!(s.programId!)!.action.id}:{}),...(s.action&&asRef(s.action.verb)?{controller:s.action.verb}:{}),...(asRef(s.programId)?{programme:s.programId!}:{}),sleep:s.asleep?'asleep':'awake',busy:!!busyReason,...(busyReason?{busyReason}:{})};
  if(!s.action)gone('action','No native action is running for this body now.');
  gone('queue','Owner directions are not queued; the latest active direction is followed.');
 }else gone('body','This Soul has no current body in the world.');
 const intentId=r.phase==='understood'?r.revision.intentId:undefined;
 if(intentId&&r.phase==='understood'){
  const from=r.revision.submitted.seq,rows=host.db.db.prepare("SELECT seq,tick,kind,payload FROM events WHERE world_id=? AND seq>? AND kind IN ('intent-admission-v2','intent-controller-v2') ORDER BY seq").all(host.worldId,from) as {seq:number;tick:number;kind:string;payload:string}[];
  const attempts:NonNullable<OwnRequestDiagnosticsV1['attempts']>=[];
  for(const row of rows){const payload=JSON.parse(row.payload);if(payload.soulId!==m.soulId||payload.intent?.intentId!==intentId)continue;
   try{const o=(row.kind==='intent-admission-v2'?intentAdmissionFactV2:intentControllerFactV2)({...row,payload}).outcome;if(!asRef(o.attemptId))continue;attempts.push({attemptId:o.attemptId,phase:o.phase,seq:o.seq,tick:o.tick,...('reason' in o&&o.reason?{reason:clip(o.reason,500)}:{})});}catch{continue;}}
  out.attempts=attempts.slice(-20);
  for(const phase of ['accepted','started','blocked','completed','interrupted'] as const)if(!attempts.some(a=>a.phase===phase))gone(phase,'No canonical '+phase+' fact exists yet for this direction.');
 }else for(const phase of ['accepted','started','completed'] as const)gone(phase,r.phase==='refused'?'The direction was refused before any native admission.':'No direction was published yet.');
 if(unavailable.length)out.unavailable=unavailable.slice(0,40);
 return ownRequestDiagnosticsV1Schema.parse(out);
}
