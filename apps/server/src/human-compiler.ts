import type {Card} from '@souls/kernel';
import {humanCompilerOutputV1Schema,humanSteeringOutcomeV1Schema,type HumanSteeringOutcomeV1,type HumanCompilerOutputV1,type HumanGoalV1} from '@souls/engine-contract';
import type {BrainCall,IntentRevisionV2} from '@souls/protocol';
import type {callTool} from '@souls/brain';
import type {Brain} from './brain.ts';
import {BudgetReservationUnavailable} from './db.ts';
import {basicHumanGoalV1,readHumanCapabilitiesV1,observeSeatedHumanGoalV1,type HumanRegistryReadV1} from './human-capabilities.ts';
import {previewHumanSleepStopV1,withHumanSleepStopReadV1} from './human-sleep-transition.ts';
import {humanWaitConditionV1,humanBlockedExplanationV1,type HumanWaitConditionV1} from './human-wait-condition.ts';
import {checkAcceptanceGuard,type Mind,type AcceptanceGuard,type AcceptanceJournal} from './world.ts';
export type ClosedHumanResultV1={kind:'planned';interpretation:IntentRevisionV2['interpretation'];outcome:Extract<HumanSteeringOutcomeV1,{kind:'planned'}>;revalidate?:AcceptanceGuard}|{kind:'terminal';outcome:Exclude<HumanSteeringOutcomeV1,{kind:'planned'}>};
const terminal=(outcome:Exclude<HumanSteeringOutcomeV1,{kind:'planned'}>):ClosedHumanResultV1=>({kind:'terminal',outcome});
function modelTool(read:HumanRegistryReadV1){
 const alternatives=read.view.goals.map(g=>{const props:Record<string,unknown>={goal:{const:g.id}};const required=['goal'];if(g.id!=='rest'){props.bindingId={enum:g.bindings.map(b=>b.id)};required.push('bindingId');}if(['sit','rest','hang_out'].includes(g.id)){props.seconds={type:'integer',minimum:1,maximum:600};required.push('seconds');}return {type:'object',properties:props,required,additionalProperties:false};});
 return {name:'select_human_goal',description:'Select only a registered semantic goal, or intentionally choose no action with a reason. Never mint cards or invent IDs.',input_schema:{type:'object',properties:{kind:{enum:['plan','no_action']},registryHash:{type:'string',pattern:'^[a-f0-9]{64}$'},goals:{type:'array',minItems:1,maxItems:4,items:{anyOf:alternatives}},explanation:{type:'string',minLength:1,maxLength:500},reason:{enum:['nonsense','needs_clarification','unsupported_here']},question:{type:'string',maxLength:500},trigger:{type:'object',properties:{kind:{enum:['none','now','time','gathering']},hour:{type:'integer',minimum:0,maximum:23},minute:{type:'integer',minimum:0,maximum:59},host:{type:'string'}},required:['kind'],additionalProperties:false},adaptation:{type:'object',properties:{originalGoal:{const:'hang_out'},substituteBindingId:{type:'string'},explanation:{type:'string',maxLength:500}},required:['originalGoal','substituteBindingId','explanation'],additionalProperties:false}},required:['kind','explanation'],additionalProperties:false}};
}
/** This path never interprets a compiler/provider error as a selected no-action. */
export async function compileHumanGoalV1(brain:Brain,m:Mind,words:string,strict:boolean,guard:AcceptanceGuard,journal:AcceptanceJournal,services:{call:typeof callTool;injected:boolean;record:(c:Omit<BrainCall,'id'|'at'>)=>unknown;registeredActivitiesV1?:boolean}):Promise<ClosedHumanResultV1>{
 checkAcceptanceGuard(guard);const initial=readHumanCapabilitiesV1(brain.host,m,{registeredActivitiesV1:services.registeredActivitiesV1}),basic=basicHumanGoalV1(words,initial,strict);let needsSafeSleepStop=false,waiting:HumanWaitConditionV1|null=null;let output:HumanCompilerOutputV1,modelRaw:unknown=null,modelUsage:{ms:number;inputTokens:number;outputTokens:number;cachedTokens:number;costUsd:number}|undefined;
 const record=(outcome:HumanSteeringOutcomeV1,raw:unknown=modelRaw,usage:{ms:number;inputTokens:number;outputTokens:number;cachedTokens:number;costUsd:number}|undefined=modelUsage)=>services.record({tick:brain.host.engine.world.tick,tier:'compile',subject:m.name,soulId:m.soulId,model:basic?'registry-basic/1':brain.cfg.compilerModel,request:{words,registry:initial.view},response:raw,applied:{contract:'closed-human-compiler/1',outcome},ms:usage?.ms??0,inputTokens:usage?.inputTokens??0,outputTokens:usage?.outputTokens??0,cachedTokens:usage?.cachedTokens??0,costUsd:usage?.costUsd??0,mode:basic||brain.mode==='fake'?'fake':'live'});
 const failure=(code:'schema'|'unknown_goal'|'unknown_binding'|'invalid_plan'|'postcondition',explanation:string)=>{const out={kind:'compilation_failure' as const,code,explanation};record(out);return terminal(out);};
 if(basic?.blocked){const b=basic.blocked,goal:HumanGoalV1=b.goal==='rest'?{goal:'rest',seconds:60}:b.goal==='sit'||b.goal==='hang_out'?{goal:b.goal,bindingId:b.id,seconds:60}:{goal:b.goal,bindingId:b.id};if(b.blockedCode==='program.safe-stop-required'&&previewHumanSleepStopV1(brain.host,m,{actor:m.entityId,label:b.label,steps:b.steps})){basic.goal=goal;delete basic.blocked;}else{const wait=humanWaitConditionV1(brain.host,m,b.blockedCode);if(wait){basic.goal=goal;delete basic.blocked;waiting=wait;}else{const out={kind:'state_blocked' as const,goal,code:b.blockedCode??'physical.unavailable',explanation:humanBlockedExplanationV1(b.blockedCode,b.label)};record(out);return terminal(out);}}}
 if(basic?.goal)output={kind:'plan',registryHash:initial.view.registryHash,goals:[basic.goal],explanation:basic.adaptation?.explanation??basic.note??basicExplanationV1(basic.goal,initial),trigger:{kind:'now'},...(basic.adaptation?{adaptation:basic.adaptation}:{})};
 else {
  if(!services.injected&&(!brain.cfg.anthropicKey||brain.mode==='fake'))return terminal({kind:'system_unavailable',code:'key',explanation:'The language service is unavailable for this request.'});
  if(brain.overBudget||!brain.gov.allow('user'))return terminal({kind:'system_unavailable',code:'budget',explanation:'The world thinking allowance cannot cover this interpretation.'});
  try{
   const result=await services.call<unknown>({apiKey:brain.cfg.anthropicKey??'synthetic-injected-client',model:brain.cfg.compilerModel,gate:brain.paidGate,maxTokens:1000,cacheSystem:true,system:'Interpret this one human direction conservatively. Select only the supplied actor-scoped registered goals/bindings. Intentional no_action is valid for unclear, nonsensical or unsupported requests. Explain respectfully; never label the person or their request nonsense. Never invent an object, action, card or default substitute. An occupied seat/empty food is a supported blocked binding, not unclear language. Sitting requires SIT, not WALK. Preserve exact/owned/strict targets and prohibitions. Only a same-goal low-risk hang_out substitution to an actual registered green landmark is allowed with explicit adaptation; never flight to walking. Future/conditional/recurring directions use the existing time/gathering/none trigger, never an invented immediate instruction. A technical failure is not no_action.',messages:[{role:'user',content:JSON.stringify({words,strict,registry:initial.view})}],tool:modelTool(initial)});
   checkAcceptanceGuard(guard);modelRaw=result.raw;modelUsage=result;const parsed=humanCompilerOutputV1Schema.safeParse(normalizeModelOutputV1(result.out,initial.view.registryHash));if(!parsed.success){const out={kind:'compilation_failure' as const,code:'schema' as const,explanation:'The language service returned a goal plan this world could not validate.'};record(out,{redactedValidation:parsed.error.issues.slice(0,8).map(i=>({path:i.path.join('.').slice(0,80),code:i.code}))},result);return terminal(out);}output=parsed.data;
   if(output.kind==='no_action'){record(output,result.raw,result);return terminal(output);}
  }catch(error){checkAcceptanceGuard(guard);const out={kind:'system_unavailable' as const,code:error instanceof BudgetReservationUnavailable?'budget' as const:'provider' as const,explanation:error instanceof BudgetReservationUnavailable?'The world thinking allowance cannot cover this interpretation.':'The language service could not complete this request.'};record(out);return terminal(out);}
 }
 if(output.kind!=='plan')return terminal(output);
 if(output.registryHash!==initial.view.registryHash)return failure('unknown_binding','The plan did not use the offered world capability registry.');
 if(output.adaptation&&(strict||/\b(?:exactly|only|must|never|not)\b|\w[’']s\b/i.test(words)))return failure('invalid_plan','This request does not permit changing its named target.');
 if(/\b(?:fly|airplane)\b/i.test(words))return failure('invalid_plan','This plan changes an unsupported flight request into a different action.');
 if(/\bsit\b/i.test(words)&&!/\b(?:not|never)\s+sit\b/i.test(words)&&!output.goals.some(g=>g.goal==='sit'||g.goal==='activity'&&initial.bindings.get(g.bindingId)?.steps.some(s=>s.verb==='sit')))return failure('postcondition','The request needs a seated goal; walking alone does not satisfy it.');
 if(/\b(?:not|never)\s+sit\b/i.test(words)&&output.goals.some(g=>g.goal==='sit'||g.goal==='activity'&&initial.bindings.get(g.bindingId)?.steps.some(s=>s.verb==='sit')))return failure('invalid_plan','The plan contradicts the instruction not to sit.');
 if(output.trigger.kind==='gathering'&&brain.host.kernel.things[output.trigger.host]?.kind!=='soul')return failure('unknown_binding','The conditional gathering does not identify a known Soul.');
 if(/\b(?:every|when|if|tomorrow|later)\b|\bat\s+\d/i.test(words)&&output.trigger.kind==='now')return failure('invalid_plan','The plan made a conditional or future direction immediate.');
 const clauses=words.trim().toLowerCase().split(/\s*,?\s+then\s+(?=(?:go to|walk to|hang out by|hang out at|sit on|eat|rest|greet|talk|chat)\b)/);
 const swimPlan=output.goals.length===1&&output.goals[0].goal==='activity'&&output.goals[0].bindingId==='activity:swim:shore-water';
 for(const [index,clause] of swimPlan?[]:clauses.entries()){
 const match=clause.replace(/[.!]$/,'').replace(/\s+(?:now|please)$/,'').match(/(go to|walk to|hang out by|hang out at|sit on)\s+(.+)$/),requested=match?.[2]?.replace(/^the /,'');
 if(requested&&!/^(?:a |an |the )?(?:supported )?bench$/.test(requested)){
  const goal=match![1]==='sit on'?'sit':match![1].startsWith('hang out')?'hang_out':'walk';
  const wanted=[...initial.bindings.values()].filter(b=>b.goal===goal&&b.aliases.includes(requested));
  const selected=output.goals[index];
  if(wanted.length){if(!selected||!('bindingId' in selected)||!wanted.some(b=>b.id===selected.bindingId))return failure('invalid_plan','The plan changed the explicitly named target or its sequence step.');}
  else if(requested==='garden'&&!strict&&output.adaptation){const b=initial.bindings.get(output.adaptation.substituteBindingId);if(!b?.green)return failure('invalid_plan','The substitute is not a registered related green landmark.');}
  else return failure('invalid_plan','The requested named target is not registered; clarification is required.');
 }
 }
 const normalized=' '+words.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu,' ')+' ',namedSouls=new Set([...initial.bindings.values()].filter(b=>b.targetId&&brain.host.kernel.things[b.targetId]?.kind==='soul'&&normalized.includes(' '+brain.host.kernel.things[b.targetId].name.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu,' ')+' ')).map(b=>b.targetId!));
 if(namedSouls.size===1&&/\b(?:greet|talk with|chat with)\b/i.test(words)&&!output.goals.some(g=>g.goal==='activity'&&(()=>{const b=initial.bindings.get(g.bindingId);return b?.targetId&&namedSouls.has(b.targetId)&&b.card.then.some(effect=>'say' in effect);})()))return failure('invalid_plan','The plan changed the named recipient or omitted the requested social speech effect.');
 const current=readHumanCapabilitiesV1(brain.host,m,{registeredActivitiesV1:services.registeredActivitiesV1}),cards:Card[]=[],agenda:{card:string;target:string|null}[]=[];let seatedWitness:ReturnType<typeof observeSeatedHumanGoalV1>=null;
 for(const goal of output.goals){const id=goal.goal==='rest'?'rest:self':goal.bindingId,b=current.bindings.get(id);if(!b||b.goal!==goal.goal)return failure('unknown_binding','The selected goal binding is not registered for this actor.');const sleepStop=!b.available&&b.blockedCode==='program.safe-stop-required'&&output.trigger.kind==='now'&&!!previewHumanSleepStopV1(brain.host,m,{actor:m.entityId,label:b.label,steps:b.steps}),wait=!b.available&&!sleepStop?humanWaitConditionV1(brain.host,m,b.blockedCode):null;if(!b.available&&!sleepStop&&!wait){const out={kind:'state_blocked' as const,goal,code:b.blockedCode??'physical.unavailable',explanation:humanBlockedExplanationV1(b.blockedCode,b.label)};return terminal(out);}
  if(sleepStop)needsSafeSleepStop=true;else if(wait)waiting??=wait;
  if(basic?.goal&&output.goals.length===1&&goal.goal==='sit'&&b.seatedWitness){seatedWitness=b.seatedWitness;output.explanation='Already seated on '+b.label+'.';continue;}
  if(b.reuseAgenda){agenda.push({card:b.reuseAgenda.card,target:b.reuseAgenda.target});continue;}
  const card=structuredClone(b.card);if('seconds' in goal){const seconds=goal.seconds;for(const s of card.during)if(s.verb==='rest')s.params.seconds=seconds;card.name=card.name+' '+seconds;}cards.push(card);agenda.push({card:card.name,target:null});
 }
 checkAcceptanceGuard(guard);const minted=await brain.mint(m,cards.filter(c=>!brain.host.kernel.decks[m.soulId].cards.includes(c.name)),undefined,undefined,'compiled',guard,journal);checkAcceptanceGuard(guard);if(minted.some(v=>!v.ok))return failure('invalid_plan','The registered goal card could not be admitted.');
 if(needsSafeSleepStop)output.explanation=('Wake safely first, then '+output.explanation).slice(0,500);
 else if(waiting)output.explanation=(waiting.explanation+' Then: '+output.explanation).slice(0,500);
 const outcome=humanSteeringOutcomeV1Schema.parse({kind:'planned',bindingContext:{worldId:brain.host.worldId,soulId:m.soulId,entityId:m.entityId},registryHash:current.view.registryHash,goals:output.goals,explanation:output.explanation,trigger:seatedWitness?{kind:'none'}:output.trigger,...(seatedWitness?{seatedWitness}:{}),...(output.adaptation?{adaptation:output.adaptation}:{})}) as Extract<HumanSteeringOutcomeV1,{kind:'planned'}>;
 record(outcome);
 // Acceptance rechecks every selected card exactly. Unselected route/activity alternatives are not consumed here.
 const revalidate:AcceptanceGuard=()=>withHumanSleepStopReadV1(brain.host,m,preview=>{checkAcceptanceGuard(guard);if(seatedWitness){const current=observeSeatedHumanGoalV1(brain.host,m,output.goals[0]);if(!current||current.nativeActionId!==seatedWitness.nativeActionId)throw new HumanGoalStateChanged(output.goals[0],'seat.changed','The current seated state changed before acceptance.');}else{const latest=readHumanCapabilitiesV1(brain.host,m,output.goals.some(g=>g.goal==='activity')?{registeredActivitiesV1:services.registeredActivitiesV1}:{registeredActivitiesV1:services.registeredActivitiesV1,deferRouteChecks:true,skipRegisteredCards:true});for(const card of cards){const issue=brain.host.engine.canPerform({actor:m.entityId,label:card.name,steps:[...card.approach,...card.during]});if(issue&&!(issue.code==='program.safe-stop-required'&&output.trigger.kind==='now'&&preview({actor:m.entityId,label:card.name,steps:[...card.approach,...card.during]}))&&!humanWaitConditionV1(brain.host,m,issue.code))throw new HumanGoalStateChanged(output.goals[0],issue.code,'The prepared native goal is currently blocked.');}for(const goal of output.goals){const b=latest.bindings.get(goal.goal==='rest'?'rest:self':goal.bindingId);if(!b||!b.available&&!(b.blockedCode==='program.safe-stop-required'&&output.trigger.kind==='now'&&preview({actor:m.entityId,label:b.label,steps:b.steps}))&&!humanWaitConditionV1(brain.host,m,b.blockedCode))throw new HumanGoalStateChanged(goal,b?.blockedCode??'binding.changed','The physical goal binding changed before acceptance.');}}return true;});
 return {kind:'planned',outcome,revalidate,interpretation:{summary:output.explanation,agenda,trigger:outcome.trigger,humanGoalPlan:outcome}};
}

export class HumanGoalStateChanged extends Error {readonly outcome:Exclude<HumanSteeringOutcomeV1,{kind:'planned'}>;constructor(goal:HumanGoalV1,code:string,explanation:string){super('physical goal state changed');this.outcome={kind:'state_blocked',goal,code,explanation};}}

/** Fill only omitted structural defaults the closed tool may legally leave out.
 * Later checks still refuse an immediate plan for future/conditional words. */
export function normalizeModelOutputV1(out:unknown,registryHash:string):unknown{
 if(!out||typeof out!=='object'||Array.isArray(out))return out;const v={...out as Record<string,unknown>};
 if(v.kind==='plan'){v.trigger??={kind:'now'};v.registryHash??=registryHash;delete v.reason;delete v.question;}
 else if(v.kind==='no_action'){for(const k of ['registryHash','goals','trigger','adaptation'])delete v[k];}
 return v;
}
function basicExplanationV1(goal:HumanGoalV1,read:HumanRegistryReadV1):string{
 const label=goal.goal==='rest'?'':read.bindings.get(goal.bindingId)?.label??'';
 switch(goal.goal){case 'walk':return `Walk to ${label}.`;case 'sit':return `Sit on ${label}.`;case 'rest':return 'Rest here.';case 'eat':return `Eat ${label.replace(/^My /,'my ')}.`;case 'hang_out':return `Spend time by ${label}.`;default:return `${label}.`;}
}
