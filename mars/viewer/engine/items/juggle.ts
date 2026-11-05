// Soul Actions #441 (W107): juggling three balls with real custody. The held set stays one item, in one hand, for the
// whole action; `juggle_v1` drives both hand points on the world tick. Every hand point and ball position is a pure
// function of the recorded `JuggleV1` and the tick, so live play, replay and every viewer agree. No ball physics: a
// 3-ball cascade (each throw lands in the other hand one dwell before that hand's next throw), no drops, no bounce.
// Stopping ends the throws, not the catches: what is in the air lands, the hands gather and come down, then it ends.
import {z} from 'zod';
import type {ActionDef,Diagnostic,StepResult} from '../actions/types.ts';
import type {Runtime} from '../runtime/runtime.ts';
import type {Entity} from '../world/types.ts';
import type {Vec3} from '../core/math.ts';
import {dcos,dsin} from '../core/math.ts';
import {at as atBody,carryHand,otherHand,restHand,sideOf,smooth,type BodyFrame,type Hand} from './body.ts';
import {followHand,heldBy,isItem} from './model.ts';

/** All in ticks of the fixed 20 Hz clock. A throw every BEAT, so each hand throws every 2·BEAT and each ball flies FLIGHT. */
export const JUGGLE=Object.freeze({RAISE:16,BEAT:6,FLIGHT:14,GATHER:6,LOWER:16,/** the set parts into balls this long before the first throw */PART:6,MIN_SECONDS:1,MAX_SECONDS:600});
/** Hand points, m from the body point: ahead of it, off its axis, above the ground. */
const FWD=.34,INNER=.1,OUTER=.24,TOGETHER=.03,READY_UP=1.02,THROW_UP=1.04,CATCH_UP=1.02,SCOOP=.08,RISE=.02;
/** How far a ball's centre sits above the hand point, and a second ball held in the same hand beside the first. */
export const BALL_LIFT=.045,BALL_BESIDE=.055;
/** Height of the arc above the straight line between the hands: a ball under gravity for FLIGHT ticks (g·T²/8, T = 0.7 s). */
const ARC=.6;
const DT_TICKS=20;

export type JuggleV1={item:string;hand:Hand;startTick:number;/** throws the run will make; a stop lowers it */throws:number;/** a stop before any throw: the hands come down from here */stopTick?:number;/** the action ended; the record stays so the receipt can read its count */endTick?:number;/** the three ball colours, from the def */colors?:[string,string,string]};
export const juggleThrows=(seconds:number)=>Math.max(3,3*Math.floor(seconds*DT_TICKS/(3*JUGGLE.BEAT)));
const throwAt=(k:number)=>JUGGLE.RAISE+JUGGLE.BEAT*k;
const thrower=(s:JuggleV1,k:number):Hand=>k%2===0?s.hand:otherHand(s.hand);
/** Ticks from the start to the last catch, the gathered hands and the end of the action. */
export function juggleTimes(s:JuggleV1){
 if(s.throws<=0){const down=s.stopTick!==undefined?s.stopTick-s.startTick:JUGGLE.RAISE;return {lastCatch:down,gathered:down,end:down+JUGGLE.LOWER};}
 const lastCatch=throwAt(s.throws-1)+JUGGLE.FLIGHT,gathered=lastCatch+JUGGLE.GATHER;return {lastCatch,gathered,end:gathered+JUGGLE.LOWER};
}
type Local={f:number;x:number;y:number};
const lerp=(a:number,b:number,k:number)=>a+(b-a)*k;
const mix=(a:Local,b:Local,k:number):Local=>({f:lerp(a.f,b.f,k),x:lerp(a.x,b.x,k),y:lerp(a.y,b.y,k)});
const READY:Local={f:FWD,x:INNER,y:READY_UP},MEET:Local={f:FWD,x:TOGETHER,y:READY_UP-.04};
/** A hand throughout the throwing (t ticks from the start): travelling out to its catch, then the scoop in to its throw. */
function loopHand(s:JuggleV1,hand:Hand,t:number):Local{
 const first=hand===s.hand?0:1;
 if(s.throws<=first||t<throwAt(first))return t<JUGGLE.RAISE?mix(MEET,READY,smooth((t-(JUGGLE.RAISE-JUGGLE.PART))/JUGGLE.PART)):READY;
 const last=first+2*Math.floor((s.throws-1-first)/2),since=t-throwAt(first);
 let u=since%(2*JUGGLE.BEAT);if(t>=throwAt(last))u=Math.min(t-throwAt(last),2*JUGGLE.BEAT-4);
 const travel=2*JUGGLE.BEAT-4;
 if(u<travel){const k=u/travel;return {f:FWD,x:lerp(INNER,OUTER,smooth(k)),y:lerp(THROW_UP,CATCH_UP,k)+RISE*Math.sin(Math.PI*k)};}
 const k=(u-travel)/4;return {f:FWD,x:lerp(OUTER,INNER,smooth(k)),y:lerp(CATCH_UP,THROW_UP,k)-SCOOP*Math.sin(Math.PI*k)};
}
function localHand(s:JuggleV1,hand:Hand,t:number,rest:Local):Local{
 const T=juggleTimes(s),meetAt=JUGGLE.RAISE-JUGGLE.PART;
 if(t>=T.gathered){const k=smooth((t-T.gathered)/JUGGLE.LOWER),top=s.throws>0?MEET:raised(hand,T.gathered,rest,meetAt);return mix(top,rest,k);}
 if(s.throws<=0||t<meetAt)return raised(hand,t,rest,meetAt);
 if(t>=T.lastCatch)return mix(loopHand(s,hand,T.lastCatch),MEET,smooth((t-T.lastCatch)/JUGGLE.GATHER));
 return loopHand(s,hand,t);
}
const raised=(_h:Hand,t:number,rest:Local,meetAt:number)=>t<meetAt?mix(rest,MEET,smooth(t/meetAt)):mix(MEET,READY,smooth((t-meetAt)/JUGGLE.PART));
/** The landmark a hand starts from and returns to, in the same local frame as the pattern. */
function restLocal(s:JuggleV1,hand:Hand):Local{
 const o:BodyFrame={o:[0,0,0],f:[1,0],r:[0,1],drop:0},q=hand===s.hand?carryHand(o,hand):restHand(o,hand);
 return {f:q[0],x:Math.abs(q[2]),y:q[1]};
}
const frame=(p:readonly number[],yaw:number):BodyFrame=>({o:[p[0],p[1],p[2]],f:[dcos(yaw),dsin(yaw)],r:[-dsin(yaw),dcos(yaw)],drop:0});
const world=(b:BodyFrame,hand:Hand,l:Local):Vec3=>atBody(b,l.f,sideOf(hand)*l.x,l.y);
export function juggleHand(s:JuggleV1,hand:Hand,tick:number,p:readonly number[],yaw:number):Vec3{return world(frame(p,yaw),hand,localHand(s,hand,tick-s.startTick,restLocal(s,hand)));}
/** Is the set drawn as three balls now (and not as the resting set)? Never both. */
export function juggleBallsOut(s:JuggleV1|undefined,tick:number):boolean{
 if(!s||s.throws<=0||s.endTick!==undefined&&tick>=s.endTick)return false;
 const t=tick-s.startTick;return t>=JUGGLE.RAISE-JUGGLE.PART&&t<juggleTimes(s).gathered;
}
/** The three balls now, or null while the set is drawn whole. */
export function juggleBalls(s:JuggleV1|undefined,tick:number,p:readonly number[],yaw:number):Vec3[]|null{
 if(!s||!juggleBallsOut(s,tick))return null;
 const t=tick-s.startTick,b=frame(p,yaw),rest:Record<Hand,Local>={left:restLocal(s,'left'),right:restLocal(s,'right')};
 const inHand:Record<Hand,number>={left:0,right:0},out:Vec3[]=[];
 const palm=(hand:Hand):Vec3=>{const l=localHand(s,hand,t,rest[hand]),n=inHand[hand]++;return world(b,hand,{f:l.f-n*BALL_BESIDE,x:l.x,y:l.y+BALL_LIFT});};
 for(let ball=0;ball<3;ball++){
  // this ball's latest throw so far (throws k ≡ ball mod 3, k < throws)
  let k=-1;if(t>=throwAt(ball)&&ball<s.throws)k=Math.min(ball+3*Math.floor((t-throwAt(ball))/(3*JUGGLE.BEAT)),ball+3*Math.floor((s.throws-1-ball)/3));
  if(k<0){out.push(palm(thrower(s,ball)));continue;}
  const by=thrower(s,k),to=otherHand(by),u=(t-throwAt(k))/JUGGLE.FLIGHT;
  if(u>=1){out.push(palm(to));continue;}
  const a=world(b,by,{f:FWD,x:INNER,y:THROW_UP+BALL_LIFT}),c=world(b,to,localHand(s,to,throwAt(k)+JUGGLE.FLIGHT,rest[to]));c[1]+=BALL_LIFT;
  out.push([lerp(a[0],c[0],u),lerp(a[1],c[1],u)+4*ARC*u*(1-u),lerp(a[2],c[2],u)]);
 }
 return out;
}

type Params={actor:string;item:string;seconds:number;colors?:[string,string,string]};
type Plan={hand:Hand};
type Exec={id:string;p:Params;hand:Hand;at:Vec3;level:number;base:string;stopping:boolean};
const still=new Set(['idle','gather','converse','listen','watch']);
const issue=(code:string,message:string,subjects:string[]):Diagnostic=>({code:'juggle.'+code,message,subjects});
function admission(rt:Runtime,p:Params,running=false):{actor:Entity;item:Entity;hand:Hand}|Diagnostic{
 const actor=rt.world.entities[p.actor],item=rt.world.entities[p.item],h=actor?.human;
 if(!h||actor.kind!=='human'||actor.body&&actor.body.family!=='humanoid')return issue('body-family','Juggling needs humanoid hands.',[p.actor]);
 if(h.grip||h.riding||h.on||h.shore||h.boatPassenger||h.boatTransit||h.sleepPose)return issue('occupied','Let go of what is supporting you before juggling.',[p.actor]);
 if(!running&&rt.holder('actor:'+p.actor).some(id=>rt.records.get(id)?.verb==='walk_to'))return issue('not-still','Stop walking before juggling.',[p.actor]);
 if(!(still.has(h.activity)||running&&h.activity==='juggle'))return issue('not-still','Stand still and clear before juggling.',[p.actor]);
 if(!item||!isItem(item)||item.support?.kind!=='in-hand'||item.support.by!==p.actor)return issue('not-held','Hold the balls before juggling.',[p.actor,p.item]);
 if(heldBy(rt.world,p.actor).length!==1)return issue('hand-full','Juggling needs the other hand free.',[p.actor]);
 return {actor,item,hand:item.support.hand};
}
function finish(rt:Runtime,ex:Exec){
 const h=rt.world.entities[ex.p.actor]?.human;if(!h)return;
 if(h.activity==='juggle')h.activity=ex.base;
 if(h.juggleV1&&h.juggleV1.endTick===undefined)h.juggleV1={...h.juggleV1,endTick:rt.tick};
 if(h.hands)delete h.hands[otherHand(ex.hand)];
}
export const juggle:ActionDef<Params,Plan,Exec>={
 verb:'juggle_v1',
 description:'Juggle a held set of three balls in a cascade, standing still with the other hand free. Recorded on the world tick; a cancel stops the throws, lets what is in the air land and lowers the hands, with the set still in hand.',
 schema:z.object({actor:z.string().min(1).max(80),item:z.string().min(1).max(80),seconds:z.number().min(JUGGLE.MIN_SECONDS).max(JUGGLE.MAX_SECONDS),colors:z.tuple([z.string().max(16),z.string().max(16),z.string().max(16)]).optional()}).strict(),
 reservations:(_w,p)=>[{resource:'hand:'+p.actor+':left',mode:'exclusive'},{resource:'hand:'+p.actor+':right',mode:'exclusive'},{resource:'entity:'+p.item,mode:'exclusive'}],
 plan(rt,p){const a=admission(rt,p);return 'code' in a?{ok:false,diagnostic:a}:{ok:true,program:{hand:a.hand}};},
 start(rt,p,plan,id){
  const actor=rt.world.entities[p.actor],h=actor.human!;
  h.juggleV1={item:p.item,hand:plan.hand,startTick:rt.tick,throws:juggleThrows(p.seconds),...(p.colors?{colors:p.colors}:{})};
  return {id,p:structuredClone(p),hand:plan.hand,at:[...actor.pose.p],level:h.level,base:h.activity,stopping:false};
 },
 step(rt,ex):StepResult{
  const a=admission(rt,ex.p,true);if('code' in a){finish(rt,ex);return {status:'failed',diagnostic:a};}
  const h=a.actor.human!,s=h.juggleV1;
  if(!s||s.item!==ex.p.item||h.level!==ex.level||a.actor.pose.p.some((n,i)=>Math.abs(n-ex.at[i])>1e-6)){finish(rt,ex);return {status:'failed',diagnostic:issue('moved','The body stopped being still; the juggling ended with the balls in hand.',[ex.p.actor])};}
  h.activity='juggle';
  const hands=h.hands??={};
  for(const hand of [s.hand,otherHand(s.hand)] as Hand[])hands[hand]=juggleHand(s,hand,rt.tick,a.actor.pose.p,a.actor.pose.yaw);
  followHand(a.item,hands[a.hand]!,a.actor.pose.yaw);
  if(rt.tick-s.startTick>=juggleTimes(s).end){const throws=s.throws;finish(rt,ex);return {status:'completed',outputs:{throws}};}
  return {status:'running',phase:ex.stopping?'stopping':'juggling'};
 },
 cancel(rt,ex){
  if(ex.stopping)return {ok:true,deferred:true};
  const h=rt.world.entities[ex.p.actor]?.human,s=h?.juggleV1;if(!h||!s){finish(rt,ex);return {ok:true};}
  ex.stopping=true;
  // the next throw still goes if its hand is already scooping into it (a hand never jumps back out mid-scoop)
  const t=rt.tick-s.startTick,next=Math.max(0,Math.ceil((t-JUGGLE.RAISE)/JUGGLE.BEAT)),keep=throwAt(next)-t<=4?next+1:next;
  const throws=Math.min(s.throws,keep);
  h.juggleV1={...s,throws,...(throws<=0?{stopTick:rt.tick}:{})};
  return {ok:true,deferred:true};
 },
 resumable:true,
};
