import type {IntentReceiptV2} from '@souls/protocol';
/** Owner-private presentation. Technical diagnostics stay out of the human message. */
export function intentFeedback(receipt:IntentReceiptV2):{title:string;detail:string;adaptation?:string} {
  if(receipt.phase==='received')return {title:'Direction received',detail:'Saved for interpretation. Understanding and action have not been confirmed.'};
  if(receipt.phase==='withdrawn')return {title:'Direction withdrawn',detail:'The recorded direction was withdrawn.'};
  if(receipt.phase==='understood'){
    const plan=receipt.revision.interpretation.humanGoalPlan;
    return {title:plan?.kind==='planned'&&plan.seatedWitness?'Seated when this direction was interpreted':'Direction understood',detail:receipt.revision.interpretation.summary,...(plan?.kind==='planned'&&plan.adaptation?{adaptation:plan.adaptation.explanation}:{})};
  }
  const outcome=receipt.outcome;
  if(!outcome)return {title:'Direction was not accepted',detail:receipt.reason};
  switch(outcome.kind){
    case 'no_action':return {title:outcome.reason==='needs_clarification'?'A little more direction needed':outcome.reason==='unsupported_here'?'That direction is not supported yet':'No action chosen',detail:outcome.question??outcome.explanation};
    case 'state_blocked':return {title:'Cannot do that right now',detail:outcome.explanation};
    case 'system_unavailable':return {title:'Direction service unavailable',detail:'Your direction was not added. Keep its reference. You can give another direction when the service is available.'};
    case 'compilation_failure':return {title:'Could not prepare this direction',detail:'Your direction was not added because preparation failed. Keep its reference to report the problem.'};
    default:return {title:'Direction could not be confirmed',detail:'Check this request before sending it again.'};
  }
}
