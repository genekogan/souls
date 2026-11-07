// Soul Actions entry 31: a walk that a closed, permitted, hand-operated door walls off goes through that door. The Soul
// walks to the handle, opens it by hand (the same hand_actuator_v1 door-natural-v2 operation as "open the door"), walks
// through, closes it behind from the far side and walks on. A locked or private door on the only way is refused with a
// reason naming it. Only the one door walked through is ever named; doors elsewhere never enter the plan or the receipt.
import {actuatorPoint,HAND_OPEN_ANGLE} from '../../../../mars/viewer/engine/social/hand-actuator.ts';
import type {EdgeSoul} from '../edge/contract.ts';
import type {WorldModel} from '@souls/world-compiler';
import {actionsOf,actuatedState} from './actuators.ts';
import {isContactActuator,type ContactActuatorIntent,type ContactActuatorService} from './contact-actuator.ts';

type Step={verb:string;params:Record<string,unknown>};
type Engine={installDoorLockedV1?:(read:(id:string)=>boolean|null)=>void;closedDoorsOnWalkV1?:(actor:string,steps:Step[])=>{goal:[number,number];doors:string[];goalDoors?:()=>string[]}|null;walkFromReachesV1?:(actor:string,from:[number,number],steps:Step[])=>boolean};
export type DoorPassage={door:string;name:string;steps:Step[];direct:Step[];open:ContactActuatorIntent;note:string;/** entry 32: the walk turns the lock first */ unlocked?:true};
export type DoorPassageRefusal={refuse:true;code:string;reason:string};
/** How far past the door line the close is planned from (its far side). */
const FAR=1;
/** Where the walk stops before the hand takes over: door-local (along the wall to the latch side, out from it), metres. */
const STAGE=[.7,1.65];
/** Entry 32: where a second (third) passage on the same side waits instead: about a metre behind the staging spot on the
 *  latch side, or as far out on the hinge side, outside the doorway lane and the swing, and a row further back. The engine
 *  picks the nearest free one to the Soul when its staging walk begins (`doorQueueV1`). */
const QUEUE=[[1.25,2.5],[-1.6,2.5],[1.25,3.5],[-1.6,3.5]];

export function createDoorPassage(d:{engine:()=>Engine;model:()=>WorldModel;contact:ContactActuatorService;access:(id:string,soul:EdgeSoul)=>{code:string;reason:string}|null;owner?:(id:string,soul:EdgeSoul)=>{name:string;mine:boolean}|null}){
 /** Entry 32: a locked door refused to a walk, naming its owner (and that knocking is possible) when it has one. */
 const lockedReason=(id:string,soul:EdgeSoul,what:string,name:string)=>{const own=d.owner?.(id,soul);return own&&!own.mine?`The way to ${what} goes through ${name}, which is locked (${own.name}'s). It was not opened; knock to ask ${own.name} in.`:`The way to ${what} goes through ${name}, which is locked. It was not opened.`;};
 const lockedOf=(id:string)=>{const m=d.model(),e=m.entities.get(id),def=e&&m.resolvedDef(e.def);return e&&def?actuatedState(e,def).locked===true:null;};
 /** The passage for a plain walk (`steps`) whose destination no walk reaches now; null when no closed door explains it. */
 return (soul:EdgeSoul,steps:Step[],what:string):DoorPassage|DoorPassageRefusal|null=>{
  const eng=d.engine(),found=eng.closedDoorsOnWalkV1?.(soul.entityId,steps);if(!found||!eng.walkFromReachesV1)return null;
  // entry 32: the hand step reads whether a door is still locked (a thumb-turn nobody needs any more is skipped)
  eng.installDoorLockedV1?.(lockedOf);
  let refusal:DoorPassageRefusal|null=null;
  for(const id of found.doors){
   const m=d.model(),e=m.entities.get(id),def=e&&m.resolvedDef(e.def);if(!e||!def)continue;
   // a walk to the door itself (or to a spot at it) ends at the door, on this side: it is not a walk through it
   const at=m.worldPose(e);if(steps.some(s=>s.verb==='walk_to'&&s.params.to===id)||Math.hypot(found.goal[0]-at.x,found.goal[1]-at.z)<1.5)continue;
   if(!actionsOf(def).some(a=>a.name==='open'&&isContactActuator(def,a)))continue;
   const open=d.contact.plan(soul,id,'open',{},{open:false}),o=open?.params.opening;if(!open||!o)continue;
   const wp=m.worldPose(e),n:[number,number]=[Math.sin(wp.yaw),Math.cos(wp.yaw)],far:[number,number]=[wp.x-n[0]*o.side*FAR,wp.z-n[1]*o.side*FAR];
   const close=d.contact.plan(soul,id,'close',{},{from:far,open:true}),c=close?.params.opening;if(!close||!c||c.side===o.side)continue;
   // does the far side reach the destination (the door's own gap stays shut in this check: the far side is beyond it)?
   const end=actuatorPoint(c,0).root;if(!eng.walkFromReachesV1(soul.entityId,[end[0],end[2]],steps))continue;
   const name=e.name??id,denied=d.access(id,soul);
   if(denied){refusal??={refuse:true,code:denied.code,reason:`The way to ${what} goes through ${name}: ${denied.reason.replace(/[.\s]+$/,'')}. It was not opened.`};continue;}
   // Entry 32, the safe way out: from inside (the back), a lockable door's thumb-turn opens for anyone, and its owner's
   // key opens it from outside. The walk turns it first and the latch locks it again as it is shut behind (a guest cannot
   // lock it again from outside, and must not leave the owner's door open to all). Anyone else outside is refused.
   const lockedNow=actuatedState(e,def).locked===true,inside=o.side<0,own=lockedNow?d.owner?.(id,soul):null;
   if(lockedNow&&(!def.tags.includes('lockable')||(!inside&&own?.mine!==true))){refusal??={refuse:true,code:'door.locked',reason:lockedReason(id,soul,what,name)};continue;}
   const unlock=lockedNow?d.contact.plan(soul,id,'unlock'):null;if(lockedNow&&!unlock)continue;
   const intent=d.contact.prepare(soul,id,'open');if(!intent)continue;
   const passage={door:[wp.x,wp.z] as [number,number],from:o.side};
   const rest=steps[0]?.verb==='stand'?steps.slice(1):steps,openAt=actuatorPoint(o,o.from).root,closeAt=actuatorPoint(c,HAND_OPEN_ANGLE).root;
   const walk=(p:number[]):Step=>({verb:'walk_to',params:{to:[p[0],p[2]],standoff:0}});
   // The walk ends a step short of the door, in front of the latch side (out of the swing and of the way through); the hand
   // step takes the last metre itself once nobody else is at the door (a follower never walks into the leader's swing).
   const u=[Math.cos(wp.yaw),-Math.sin(wp.yaw)],stage=[wp.x+u[0]*STAGE[0]+n[0]*o.side*STAGE[1],0,wp.z+u[1]*STAGE[0]+n[1]*o.side*STAGE[1]];
   const queue=QUEUE.map(([a,b])=>[+(wp.x+u[0]*a+n[0]*o.side*b).toFixed(3),+(wp.z+u[1]*a+n[1]*o.side*b).toFixed(3)]);
   const turn:Step[]=unlock?[{verb:'mars:hand_actuator_v1',params:{...unlock.params,passage:{mode:'unlock',...passage}}}]:[];
   const legs=(first:number[]):Step[]=>[{verb:'stand',params:{}},first===stage?{verb:'walk_to',params:{to:[stage[0],stage[2]],standoff:0,doorQueueV1:{door:id,from:o.side,queue}}}:walk(first),...turn,{verb:'mars:hand_actuator_v1',params:{...open.params,passage:{mode:'open',...passage}}},walk(closeAt),{verb:'mars:hand_actuator_v1',params:{...close.params,passage:{mode:'close',...passage,...(lockedNow?{relock:true as const}:{})}}},...rest];
   const note=lockedNow?`Through ${name}: unlocked it ${inside?'with the thumb-turn inside':'with your key'}, opened it by hand on the way, and it locked again as it was shut behind (unless someone was following).`:`Through ${name}: opened it by hand on the way, and closed it behind unless someone was following.`;
   return {door:id,name,open:intent,...(unlock?{unlocked:true as const}:{}),note,steps:legs(stage),direct:legs(openAt)};
  }
  if(refusal)return refusal;
  // No door on this side opens the way. When every door walling the destination's own side is locked or private (the
  // way would need it even after another door), refuse naming it, rather than walking round to the nearest point outside.
  const m=d.model(),goalSide=(found.goalDoors?.()??[]).filter(id=>!found.doors.includes(id)).flatMap(id=>{const e=m.entities.get(id),def=e&&m.resolvedDef(e.def);if(!e||!def)return [];
   // only a door that walls the destination in (its other side is not reachable from the destination): a free-standing
   // door in the open borders every region it stands in and separates nothing
   const p=m.worldPose(e),k=[Math.sin(p.yaw),Math.cos(p.yaw)],g=(found.goal[0]-p.x)*k[0]+(found.goal[1]-p.z)*k[1]>=0?1:-1,beyond:[number,number]=[p.x-k[0]*g*FAR,p.z-k[1]*g*FAR];
   if(eng.walkFromReachesV1!(soul.entityId,beyond,steps))return [];
   const denied=d.access(id,soul),name=e.name??id;return denied?{refuse:true as const,code:denied.code,reason:`The way to ${what} goes through ${name}: ${denied.reason.replace(/[.\s]+$/,'')}. It was not opened.`}:actuatedState(e,def).locked===true?{refuse:true as const,code:'door.locked',reason:lockedReason(id,soul,what,name)}:null;}).map(x=>x);
  return goalSide.length&&goalSide.every(x=>x)?goalSide[0]:null;
 };
}
