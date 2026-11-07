// Mars camp offers use the same native programs as CampCards. Availability is a
// structural preview; crew, occupancy, routes and finite resources decide again
// at admission. Nothing here assigns chores or changes Eden's capabilities.
import type {Program} from '@souls/engine-contract';
import type {EdgeCapability,EdgeSoul} from '../edge/contract.ts';
import type {WorldHost} from '../world.ts';
import type {Entity as NativeEntity} from '../../../../mars/viewer/engine/world/types.ts';
import {lookoutStateV1} from '../../../../packages/engine-mars/src/disassembly.ts';
import {edenCampActivities,bindCampActivity} from '../../../../mars/viewer/engine/scenarios/eden-camp.ts';
import {campResourceBindings} from '../camp-resources.ts';
export type WorldPlans = Map<string,{label:string;steps:Program['steps'];seconds?:boolean;stop?:boolean}>;
export function marsEdgeProfile(host:WorldHost){return (soul:EdgeSoul,caps:EdgeCapability[],plans:WorldPlans)=>{
 const me=host.engine.world.entities[soul.entityId] as NativeEntity|undefined;if(!me||me.body?.family==='floater')return;
 const add=(id:string,verb:string,label:string,steps:Program['steps'],target?:{id:string;kind:string},structural?:string)=>{
  const issue=structural?{code:'lookout.prerequisite',message:structural}:host.engine.canPerform({actor:soul.entityId,label,steps});
  caps.push({id,verb,label,available:!issue,...(target?{target}:{}),...(issue?{blocked:{code:issue.code,reason:issue.message??issue.code}}:{})});plans.set(id,{label,steps});
 };
 for(const action of lookoutStateV1(host.engine.world as Parameters<typeof lookoutStateV1>[0]).actions){
  const taking=action.verb==='unbuild_lookout',verb=taking?'take-down':'build';
  add(`${verb}:lookout-${action.phase}`,verb,`${taking?'Take down':'Build'} the pallet-rack lookout ${action.phase}`,[{verb:action.verb,params:{phase:action.phase}}],{id:'lookout',kind:'project'},action.available?undefined:action.reason);
 }
 const selected=new Map<string,[string,string]>([
  ['kitchen.prepare-supper',['cook:supper','cook']],['living.computer-work',['use-computer:computer-1','use-computer']],
  ['living.read',['read:camp-book','read']],['living.draw',['draw:sketch-pad','draw']],
  ...[1,2].map(n=>[`garden.water-${n}`,[`water:planter-${n}`,'water']] as [string,[string,string]]),
  ...[3,4].map(n=>[`garden.plant-${n}`,[`sow:planter-${n}`,'sow']] as [string,[string,string]]),
 ]);
 const personal=campResourceBindings(host,[...host.minds.values()]).bySoul.get(soul.soulId);
 for(const activity of edenCampActivities()){
  let selection=selected.get(activity.id);
  if(activity.verb==='sleep'&&personal&&activity.params.mat===personal.mat)selection=[`sleep:${personal.mat}`,'sleep'];
  if(!selection)continue;
  const params=bindCampActivity(activity,{actor:soul.entityId}) as Record<string,unknown>;
  const steps:Program['steps']=[{verb:`mars:${activity.verb}`,params}];
  if(activity.verb==='prepare_food')steps.push({verb:'mars:put_item',params:{item:'prep-spoon',surfaceSlot:'prep-table#r1c0'}});
  add(selection[0],selection[1],activity.label,steps,{id:activity.region,kind:'place'});
 }
 if(personal)for(const pot of ['stew-pot','supper-pot']){
  const point=pot==='supper-pot'?[-16.15,-16.9]:[-12.5,-13.4],{bowl,spoon}=personal;
  add(`eat:${pot}`,'eat',`Eat a bowl of ${pot==='stew-pot'?'stew':'bean supper'} and return the utensils`,[
   {verb:'mars:take_item',params:{item:bowl,hand:'left'}},{verb:'mars:walk_to',params:{x:point[0],z:point[1],face:Math.PI/2}},
   {verb:'mars:serve',params:{pot,bowl}},{verb:'mars:take_item',params:{item:spoon,hand:'right'}},
   {verb:'mars:eat',params:{bowl,spoon,cycles:6}},{verb:'mars:put_item',params:{item:bowl,surfaceSlot:personal.bowlReturn}},
   {verb:'mars:put_item',params:{item:spoon,surfaceSlot:personal.spoonReturn}},
  ],{id:pot,kind:'object'});
 }
};}
