// Owner rules live in kernel state; their triggers request thought, never an activity.
import type {KState,Json} from '@souls/kernel';
import type {MandateRule,MandateTrigger} from '@souls/protocol';
export const MANDATE_STATE='privateMandate';
export function mandateOf(k:KState,soulId:string):MandateRule[]{return (k.things[soulId]?.states[MANDATE_STATE] as unknown as MandateRule[]|undefined)??[];}
export function saveMandate(k:KState,soulId:string,rules:MandateRule[]){if(k.things[soulId])k.things[soulId].states[MANDATE_STATE]=structuredClone(rules) as unknown as Json;}
export function foldMandate(k:KState,p:{soulId:string;op:string;rule?:MandateRule;ruleId?:string;patch?:Partial<MandateRule>}){
 const rules=mandateOf(k,p.soulId);
 if(p.op==='upsert'&&p.rule)saveMandate(k,p.soulId,[...rules.filter(r=>r.id!==p.rule!.id),p.rule]);
 else if(p.op==='remove')saveMandate(k,p.soulId,rules.filter(r=>r.id!==p.ruleId));
 else if(p.patch)saveMandate(k,p.soulId,rules.map(r=>r.id===p.ruleId?{...r,...p.patch}:r));
}
export function triggerDue(rule:MandateRule,k:KState,day:number,hour:number):boolean{
 if(rule.status!=='active')return false;
 if(rule.trigger.kind==='time')return (hour+18)%24>=(rule.trigger.hour+18)%24+rule.trigger.minute/60&&rule.lastFiredDay!==day;
 if(rule.trigger.kind==='gathering'){const host=rule.trigger.host;return !rule.conditionMatched&&Object.values(k.links).some(l=>l.kind==='hosts'&&l.from===host&&k.things[l.to]?.kind==='gathering');}
 return false;
}
/** Tests/offline fallback understand a small explicit syntax; live alignment uses Haiku. */
export function explicitTrigger(words:string,resolveSoul:(name:string)=>string|null):MandateTrigger{
 if(/\bif you feel like it\b/i.test(words))return {kind:'none'};
 const party=words.match(/every time\s+(.+?)\s+is (?:having|hosting) (?:a |the )?(?:party|gathering)/i);
 if(party){const host=resolveSoul(party[1]);if(!host)throw Error(`No Soul named ${party[1]} is known here`);return {kind:'gathering',host};}
 const time=words.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+every day\b/i);
 if(time){let hour=Number(time[1]);const minute=Number(time[2]??0);if(time[3]){if(hour<1||hour>12)throw Error('Use a time from 1 to 12 with am or pm');hour=hour%12+(time[3].toLowerCase()==='pm'?12:0);}if(hour>23||minute>59)throw Error('That time is outside the world day');return {kind:'time',hour,minute};}
 if(!/\bnot\s+(?:now|immediately)\b/i.test(words)&&/\b(?:do|go|start|stop|sit|stand|eat|sleep|rest|build|read|join|host|cook|perform|please)\b.*\b(?:now|immediately|right away)\b/i.test(words))return {kind:'now'};
 return {kind:'none'};
}
