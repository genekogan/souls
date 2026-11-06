// Soul Actions #441 (W108): flying a kite with real custody. The kite stays one item, in one hand, for the whole action;
// `kite_v1` drives that hand on the world tick. The kite's place, its sway and the hand are pure functions of the recorded
// `KiteV1` and the tick, so live play, replay and every viewer agree. The wind is read once, at the start. No gusts, no
// crashes, no collisions: the kite affects nothing. Stopping reels it in first, then the hand comes down with it.
import {z} from 'zod';
import type {ActionDef,Diagnostic,StepResult} from '../actions/types.ts';
import type {Runtime} from '../runtime/runtime.ts';
import type {Entity} from '../world/types.ts';
import type {Vec3} from '../core/math.ts';
import {dcos,dsin,hypot} from '../core/math.ts';
import {at as atBody,carryHand,sideOf,smooth,type BodyFrame,type Hand} from './body.ts';
import {followHand,heldBy,isItem} from './model.ts';

/** All in ticks of the fixed 20 Hz clock: the arm rises, the kite climbs, it is reeled in, the arm comes down. */
export const KITE=Object.freeze({RAISE:14,CLIMB:60,REEL:24,LOWER:12,MIN_SECONDS:5,MAX_SECONDS:600,/** height above the hand, m, in still air and in a full wind */LOW:3,HIGH:13,/** how far out ahead, m */NEAR:3,FAR:9});
const DT_TICKS=20;
/** The working hand, m from the body point: ahead of it, off its axis, above the ground. */
const HOLD={f:.3,x:.18,y:1.28};

export type KiteV1={item:string;hand:Hand;startTick:number;/** where the body stands for it (x, z): a body moved off it has no kite up, even if it was forced */at:[number,number];/** the wind (0..1) when it started */wind:number;/** ticks the flight lasts before it is reeled in; a stop shortens it */flight:number;color?:string;/** the action ended here; drawn on no later tick */endTick?:number};
const clamp01=(n:number)=>n<0?0:n>1?1:n;
const lerp=(a:number,b:number,k:number)=>a+(b-a)*k;
export const kiteTimes=(s:Pick<KiteV1,'flight'>)=>({reel:s.flight,down:s.flight+KITE.REEL,end:s.flight+KITE.REEL+KITE.LOWER});
const frame=(p:readonly number[],yaw:number):BodyFrame=>({o:[p[0],p[1],p[2]],f:[dcos(yaw),dsin(yaw)],r:[-dsin(yaw),dcos(yaw)],drop:0});
/** How far out on its string the kite is at `t` ticks: 0 in the hand, 1 fully out. */
function out(s:KiteV1,t:number){const T=kiteTimes(s),up=smooth(clamp01((t-KITE.RAISE)/KITE.CLIMB));if(t<T.reel)return up;const at=smooth(clamp01((T.reel-KITE.RAISE)/KITE.CLIMB));return at*(1-smooth(clamp01((t-T.reel)/KITE.REEL)));}
/** The hand holding the string at `tick`. */
export function kiteHand(s:KiteV1,tick:number,p:readonly number[],yaw:number):Vec3{
 const t=tick-s.startTick,b=frame(p,yaw),T=kiteTimes(s),rest=carryHand(b,s.hand),side=sideOf(s.hand);
 const held=atBody(b,HOLD.f,side*HOLD.x,HOLD.y+.03*dsin(2*Math.PI*t/43)*out(s,t));
 const k=t<KITE.RAISE?smooth(t/KITE.RAISE):t<T.down?1:1-smooth(clamp01((t-T.down)/KITE.LOWER));
 return [lerp(rest[0],held[0],k),lerp(rest[1],held[1],k),lerp(rest[2],held[2],k)];
}
/** Is the kite in the air now (and not drawn whole in the hand)? Never both. */
export function kiteOut(s:KiteV1|undefined,tick:number):boolean{
 if(!s||s.endTick!==undefined&&tick>=s.endTick)return false;
 const t=tick-s.startTick;return t>=KITE.RAISE&&t<kiteTimes(s).down;
}
export type KitePlace={p:Vec3;hand:Vec3;yaw:number;roll:number};
/** The kite in the air and the hand its string runs to, or null while it is in the hand. */
export function kiteAt(s:KiteV1|undefined,tick:number,p:readonly number[],yaw:number):KitePlace|null{
 if(!s||!kiteOut(s,tick)||hypot(p[0]-s.at[0],p[2]-s.at[1])>.01)return null;
 const t=tick-s.startTick,k=out(s,t),b=frame(p,yaw),hand=kiteHand(s,tick,p,yaw),w=clamp01(s.wind);
 const ahead=lerp(KITE.NEAR,KITE.FAR,w)*k,up=lerp(KITE.LOW,KITE.HIGH,w)*k,sway=(.5+1.3*w)*k*dsin(2*Math.PI*t/90),bob=(.2+.4*w)*k*dsin(2*Math.PI*t/57);
 return {p:[hand[0]+b.f[0]*ahead+b.r[0]*sway,hand[1]+up+bob,hand[2]+b.f[1]*ahead+b.r[1]*sway],hand,yaw,roll:.3*k*dsin(2*Math.PI*t/90+.6)};
}

type Params={actor:string;item:string;seconds:number;color?:string};
type Plan={hand:Hand};
type Exec={id:string;p:Params;hand:Hand;at:Vec3;level:number;base:string;stopping:boolean};
/** 'kite': a new act planned during a flight replaces it; the reservations make the new act wait for the reel-in. */
const still=new Set(['idle','gather','converse','listen','watch','kite']);
const issue=(code:string,message:string,subjects:string[]):Diagnostic=>({code:'kite.'+code,message,subjects});
function admission(rt:Runtime,p:Params,running=false):{actor:Entity;item:Entity;hand:Hand}|Diagnostic{
 const actor=rt.world.entities[p.actor],item=rt.world.entities[p.item],h=actor?.human;
 if(!h||actor.kind!=='human'||actor.body&&actor.body.family!=='humanoid')return issue('body-family','Flying a kite needs humanoid hands.',[p.actor]);
 if(h.grip||h.riding||h.on||h.shore||h.boatPassenger||h.boatTransit||h.sleepPose)return issue('occupied','Let go of what is supporting you before flying a kite.',[p.actor]);
 if(!running&&rt.holder('actor:'+p.actor).some(id=>rt.records.get(id)?.verb==='walk_to'))return issue('not-still','Stop walking before flying a kite.',[p.actor]);
 if(!still.has(h.activity))return issue('not-still','Stand still and clear before flying a kite.',[p.actor]);
 if(!item||!isItem(item)||item.support?.kind!=='in-hand'||item.support.by!==p.actor)return issue('not-held','Hold the kite before flying it.',[p.actor,p.item]);
 if(heldBy(rt.world,p.actor).length!==1)return issue('hand-full','Flying a kite needs the other hand free.',[p.actor]);
 return {actor,item,hand:item.support.hand};
}
function finish(rt:Runtime,ex:Exec){
 const h=rt.world.entities[ex.p.actor]?.human;if(!h)return;
 if(h.activity==='kite')h.activity=ex.base;
 if(h.kiteV1&&h.kiteV1.endTick===undefined)h.kiteV1={...h.kiteV1,endTick:rt.tick};
 if(h.hands){delete h.hands[ex.hand];if(!Object.keys(h.hands).length)delete h.hands;}
}
export const kite:ActionDef<Params,Plan,Exec>={
 verb:'kite_v1',
 description:'Fly a held kite, standing still with the other hand free. Its height comes from the wind when it starts; recorded on the world tick; a cancel reels it in and lowers the hand, with the kite in hand.',
 schema:z.object({actor:z.string().min(1).max(80),item:z.string().min(1).max(80),seconds:z.number().min(KITE.MIN_SECONDS).max(KITE.MAX_SECONDS),color:z.string().max(16).optional()}).strict(),
 // actor: the body holds its place while the kite is up (nobody's make-way moves it) and a new act waits for the reel-in
 reservations:(_w,p)=>[{resource:'actor:'+p.actor,mode:'exclusive'},{resource:'hand:'+p.actor+':left',mode:'exclusive'},{resource:'hand:'+p.actor+':right',mode:'exclusive'},{resource:'entity:'+p.item,mode:'exclusive'}],
 plan(rt,p){const a=admission(rt,p);return 'code' in a?{ok:false,diagnostic:a}:{ok:true,program:{hand:a.hand}};},
 start(rt,p,plan,id){
  const actor=rt.world.entities[p.actor],h=actor.human!,wind=(rt.world as unknown as {env?:{weather?:{wind?:number}}}).env?.weather?.wind;
  h.kiteV1={item:p.item,hand:plan.hand,startTick:rt.tick,at:[actor.pose.p[0],actor.pose.p[2]],wind:typeof wind==='number'?clamp01(wind):0,flight:KITE.RAISE+KITE.CLIMB+Math.round(p.seconds*DT_TICKS),...(p.color?{color:p.color}:{})};
  return {id,p:structuredClone(p),hand:plan.hand,at:[...actor.pose.p],level:h.level,base:h.activity,stopping:false};
 },
 step(rt,ex):StepResult{
  const a=admission(rt,ex.p,true);if('code' in a){finish(rt,ex);return {status:'failed',diagnostic:a};}
  const h=a.actor.human!,s=h.kiteV1;
  if(!s||s.item!==ex.p.item||h.level!==ex.level||a.actor.pose.p.some((n,i)=>Math.abs(n-ex.at[i])>1e-6)){finish(rt,ex);return {status:'failed',diagnostic:issue('moved','The body stopped being still; the kite came down with the string in hand.',[ex.p.actor])};}
  h.activity='kite';
  const hands=h.hands??={};hands[s.hand]=kiteHand(s,rt.tick,a.actor.pose.p,a.actor.pose.yaw);
  followHand(a.item,hands[s.hand]!,a.actor.pose.yaw);
  if(rt.tick-s.startTick>=kiteTimes(s).end){finish(rt,ex);return {status:'completed',outputs:{wind:s.wind}};}
  return {status:'running',phase:ex.stopping?'stopping':'flying'};
 },
 cancel(rt,ex){
  if(ex.stopping)return {ok:true,deferred:true};
  const h=rt.world.entities[ex.p.actor]?.human,s=h?.kiteV1;if(!h||!s){finish(rt,ex);return {ok:true};}
  ex.stopping=true;
  const t=rt.tick-s.startTick;if(t<s.flight)h.kiteV1={...s,flight:t};
  return {ok:true,deferred:true};
 },
 resumable:true,
};
