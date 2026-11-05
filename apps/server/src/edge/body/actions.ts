import type {Entity,Program} from '@sim/engine-contract';
import type {EdgeCapability} from '../contract.ts';
import {creatureOf,type CreatureSpecies} from '../../../../../mars/viewer/engine/bodies/creatures.ts';
import {hasRollingProfile,rollingActionProblem} from '../../../../../mars/viewer/engine/bodies/action-profile.ts';
import {hasBodyDance,bodyDanceStep} from '../../../../../mars/viewer/engine/bodies/motion.ts';

export const isRigidBody=(e:Pick<Entity,'body'>|undefined)=>e?.body?.family==='floater';
/** The creature species of an entity's body (duck, snail, dog), when it is one. */
export const creatureOfEntity=(e:Pick<Entity,'body'>|undefined):CreatureSpecies|undefined=>creatureOf(e?.body as Parameters<typeof creatureOf>[0]);
const rigidVerbs=new Set(['go','walk','glide','stroll','wander','approach','go-near','hang-out','rest','hover','settle','gather','stand','turn','face','look','auto-face','follow','ask-to-stop','accept','decline','make']);
const rigidSteps=['walk_to','ambient_wander','face','wave','rest','gather','stand'];
const swimSteps=['walk_to','swim_to','mars:swim_to','ground_travel','mars:ground_travel'];
// Edge verbs a creature lacks, grouped by the plain reason its species gives (bodies/creatures.ts `cannot`).
const HUG=new Set(['hug','high-five','handshake','wave-to','fist-bump']),DANCE=new Set(['dance','dance-with','jump','stretch','jumping-jacks','yoga','pushups','situps']);
const SIT=new Set(['sit','sit-ground','lie','nap','warm-by-fire']),RIDE=new Set(['ride','board','mount','fly']);
function creatureReason(c:CreatureSpecies,verb:string){
  if(HUG.has(verb))return c.cannot.hug;if(DANCE.has(verb))return c.cannot.dance;if(SIT.has(verb))return c.cannot.sit;if(RIDE.has(verb))return c.cannot.ride;
  if(verb==='swim')return c.cannot.swim??`A ${c.id} cannot swim here`;
  return `${c.cannot.hands} (it cannot ${verb})`;
}
export function bodyVerbProblem(e:Entity|undefined,verb:string){
  if(hasRollingProfile(e?.body)){const reason=rollingActionProblem(verb,undefined,'edge');return reason?{code:'body.unsupported',reason}:null;}
  if(verb==='dance'&&hasBodyDance(e?.body))return null;
  if(!isRigidBody(e)||rigidVerbs.has(verb))return null;
  const c=creatureOfEntity(e);
  if(c){if(verb==='swim'&&c.swimSpeed)return null;return {code:'body.unsupported',reason:`${creatureReason(c,verb)}. It can ${c.moves}, ${c.swims?'swim, ':''}settle, turn, look, follow and speak.`};}
  return {code:'body.unsupported',reason:`${e?.body?.type==='ceramic'?'Ceramic':'Floater'} bodies cannot ${verb}; try glide, hover, settle or turn.`};
}
export function bodyCapabilityProblem(e:Entity|undefined,c:EdgeCapability,steps?:Program['steps']){
  if(hasRollingProfile(e?.body)){
    if(c.verb==='object'&&['read','respond','add-step','endorse','interest','uninterest','state','history','inspect'].includes(c.action??''))return null;
    const v=bodyVerbProblem(e,c.verb);if(v)return v;
    for(const step of steps??[]){if(['rest','stand','walk','go','face','turn'].includes(step.verb))continue;const reason=rollingActionProblem(step.verb,step.params);if(reason)return {code:'body.unsupported',reason};}
    return null;
  }
  if(!isRigidBody(e))return null;
  // Information on a public object remains readable/writable; rides and physical hand actions are excluded.
  if(c.verb==='object'&&['read','respond','add-step','endorse','interest','uninterest','state','history','inspect'].includes(c.action??''))return null;
  const v=bodyVerbProblem(e,c.verb);if(v)return v;
  const creature=creatureOfEntity(e),allowed=creature?.swimSpeed?[...rigidSteps,...swimSteps]:rigidSteps;
  if(steps?.some(s=>!allowed.includes(s.verb)&&!bodyDanceStep(e?.body,s.verb,s.params)))return {code:'body.unsupported',reason:creature?`This activity needs hands or a humanoid body; a ${creature.id} can ${creature.moves}, settle, turn and follow.`:'This activity needs a humanoid body; try glide, hover, settle or turn.'};
  return null;
}
type Plan={label:string;steps:Program['steps'];seconds?:boolean};
/** Shape the capability list for a rigid body: drop what it cannot do, offer settle (and hover for floaters), and
 *  name its own way of moving (glide; a creature's waddle, slide or trot). */
export function shapeRigidCapabilities(me:Entity|undefined,caps:EdgeCapability[],plans:Map<string,Plan>,secondsParam:EdgeCapability['params']){
  if(hasRollingProfile(me?.body)){
    for(const verb of ['rest','lie','nap']){const id=verb+':here',label=verb==='nap'?'Sleep upright (standby)':'Fold away upright (standby)';const old=caps.find(c=>c.id===id);if(old)Object.assign(old,{label,available:true,blocked:undefined});else caps.unshift({id,verb,label,available:true,params:secondsParam});plans.set(id,{label,steps:[{verb:'mars:body_motion_v1',params:{motion:'rest',seconds:60}}],seconds:true});}
    for(let i=caps.length-1;i>=0;i--)if(bodyCapabilityProblem(me,caps[i]!,plans.get(caps[i]!.id)?.steps)){plans.delete(caps[i]!.id);caps.splice(i,1);}
    for(const c of caps)if(c.verb==='walk')c.label=c.label.replace(/walk/ig,'Roll');
    return;
  }
  if(!isRigidBody(me))return;
  // Reuse the existing supported-ground discovery check, but execute the authored non-limb action.
  if(hasBodyDance(me?.body)){const index=caps.findIndex(c=>c.id==='dance:here'),p=plans.get('dance:here');
    if(index>=0&&p){const label='Dance here (wiggle in place)';caps[index]={...caps[index]!,label};plans.set('dance:here',{...p,label,steps:[{verb:'mars:body_motion_v1',params:{motion:'dance',seconds:60}}]});}
  }
  for(let i=caps.length-1;i>=0;i--)if(bodyCapabilityProblem(me,caps[i]!,plans.get(caps[i]!.id)?.steps as Program['steps']|undefined)){plans.delete(caps[i]!.id);caps.splice(i,1);}
  const creature=creatureOfEntity(me);
  if(creature){
    const label=`Settle here (the ${creature.id} ${creature.settles})`;caps.unshift({id:'settle:here',verb:'settle',label,available:true,params:secondsParam});plans.set('settle:here',{label,steps:[{verb:'rest',params:{seconds:60}}],seconds:true});
    const Move=creature.moves[0]!.toUpperCase()+creature.moves.slice(1);
    for(const c of caps)if(['walk','stroll','wander','go-near'].includes(c.verb)){c.label=c.label.replace(/\b(?:walk|stroll|wander|go near)\b/ig,Move);if(!c.label.includes(Move))c.label=`${Move} to ${c.label}`;}else if(c.verb==='swim')c.label=c.label.replace(/\bswim\b/i,`Swim (${creature.swims})`).replace(/walk to/i,`${creature.moves} to`);else if(c.id==='stand:here')c.label='Get up / stop what I am doing';
    return;
  }
  for(const verb of ['hover','settle']){const id=verb+':here',label=verb==='hover'?'Hover here':'Settle here (hold position while hovering)';caps.unshift({id,verb,label,available:true,params:secondsParam});plans.set(id,{label,steps:[{verb:'rest',params:{seconds:60}}],seconds:true});}
  for(const c of caps)if(c.verb==='walk')c.label=c.label.replace(/walk/ig,'Glide');else if(c.id==='stand:here')c.label='Stop / release my current hover slot';
}
