// Recorded, finite hand contact. Native roots own the step around a hinged leaf;
// viewers use this SAME timeline for the panel and the arm's reach/release weight.
import {z} from 'zod';
import type {ActionDef,Diagnostic,StepResult} from '../actions/types.ts';
import {DT,type Runtime} from '../runtime/runtime.ts';
import type {Entity} from '../world/types.ts';
import type {Spatial} from '../spatial/service.ts';
import {dcos,dsin,heading,hypot,type Vec2,type Vec3} from '../core/math.ts';
import {HUMAN_RADIUS} from '../world/catalog.ts';
import {clearanceAt} from '../spatial/grid.ts';
import {makeWay} from '../locomotion/walk.ts';
import {staticStepClear} from '../runtime/static-step.ts';
export const HAND_REACH_SECONDS=.65,HAND_SWING_SECONDS=2.2,HAND_RELEASE_SECONDS=.7;
export const HAND_IDLE_HANDOFF_SECONDS=1.2;
export const HAND_OPEN_ANGLE=-Math.PI*.48;
const vec=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const opening=z.object({floorY:z.number().finite().optional(),hinge:vec,yaw:z.number().finite(),radius:z.number().min(.2).max(2),height:z.number().min(.3).max(3),handleY:z.number().min(.3).max(2),from:z.number().min(-1.6).max(0),to:z.number().min(-1.6).max(0),side:z.union([z.literal(1),z.literal(-1)]),bodyPolicy:z.literal('door-natural-v2').optional()}).strict();
// A hand that writes or wipes across a flat face (a board): `at` is the face centre, `yaw` its facing.
// Soul Actions entry 38: a poster is put up (or taken down) with both hands: `width`/`height` are the sheet's, `at` its centre on
// the wall's surface, and `sheet` what is printed on it (so every viewer draws the same paper in the hands as on the wall).
const sheet=z.object({title:z.string().max(40),detail:z.string().max(80),name:z.string().max(40).optional(),paper:z.number().int().min(0).max(15),age:z.number().min(0).max(99).optional()}).strict();
const stroke=z.object({kind:z.union([z.literal('write'),z.literal('wipe'),z.literal('poster'),z.literal('unposter')]),yaw:z.number().finite(),stand:z.number().min(.3).max(.7).optional(),width:z.number().min(.1).max(1.2),height:z.number().min(.05).max(.8),lines:z.number().int().min(1).max(3),seconds:z.number().min(.8).max(6),release:z.number().min(.7).max(1.6).optional(),lead:z.object({y:z.number().finite(),out:z.number().min(0).max(.5)}).strict().optional(),handoff:z.number().min(0).max(1.2).optional(),sheet:sheet.optional()}).strict();
// Soul Actions entry 24: a drawer slides straight out along `dir` (the chest's front, world xz); `at` is the knob closed,
// `from`/`to` the travel out (m). The hand stays on the knob; the body keeps half a metre in front of it, facing the chest.
const slide=z.object({at:vec,dir:z.tuple([z.number().finite(),z.number().finite()]),travel:z.number().min(.05).max(.8),from:z.number().min(0).max(.8),to:z.number().min(0).max(.8),floorY:z.number().finite()}).strict();
/** Soul Actions entry 31: this operation is one leg of a walk through the door (`open` before the doorway, `close` after
 *  it). `door` is the doorway centre, `from` the side (door-local z sign) the walk comes from. */
const passage=z.object({mode:z.enum(['unlock','open','close']),door:z.tuple([z.number().finite(),z.number().finite()]),from:z.union([z.literal(1),z.literal(-1)]),
 /** entry 32: the door was locked when the walk was planned: the latch locks it again as it is shut behind */ relock:z.literal(true).optional()}).strict();
/** Soul Actions entry 32: a lockable door's lock and leaf. `lock`/`unlock`: the hand turns the key (front) or thumb-turn
 *  (back) and the bolt slides; `knock`: knuckles to the leaf, three raps. The leaf does not move (opening from = to = 0). */
const op=z.enum(['lock','unlock','knock']);
// Entry 37: `hold` keeps the hand on a switch for a while after contact (a radio's tuning knob turns while the dial sweeps);
// `reach` is a slower, deliberate reach to a small knob (default HAND_REACH_SECONDS), contact at its end.
export const handActuatorParams=z.object({actor:z.string(),target:z.string(),at:vec,opening:opening.optional(),stroke:stroke.optional(),slide:slide.optional(),passage:passage.optional(),op:op.optional(),hold:z.number().min(0).max(2).optional(),reach:z.number().min(.3).max(2).optional(),
 /** entry 42: `hand` names the free hand when the other one carries something; `release` a slower arm lowering (s) */ hand:z.enum(['left','right']).optional(),release:z.number().min(.3).max(2).optional(),
 /** entry 10: a bell pull: the hand tugs the rope down `length` m along `yaw`, the rope swinging by `angle` */ tug:z.object({length:z.number().positive().max(3),angle:z.number().positive().max(.6),yaw:z.number().finite(),seconds:z.number().min(.4).max(1.5)}).strict().optional()}).strict();

export type HandActuatorParams=z.infer<typeof handActuatorParams>;
export type HandActuatorMotion=Omit<HandActuatorParams,'actor'> & {startTick:number;actionId?:string;abortedAt?:number;abortWeight?:number};
const smooth=(v:number)=>{const k=Math.max(0,Math.min(1,v));return k*k*(3-2*k);};
export const handReachSeconds=(m:Pick<HandActuatorMotion,'reach'>)=>m.reach??HAND_REACH_SECONDS;
/** Entry 32: a key / thumb-turn turn, and three raps (the first starts KNOCK_LEAD after the reach, one every KNOCK_PERIOD). */
export const LOCK_TURN_SECONDS=.9,UNLOCK_SLIDE_SECONDS=.4,KNOCK_RAPS=3,KNOCK_PERIOD=.3,KNOCK_LEAD=.1,KNOCK_IN=.35,KNOCK_SECONDS=KNOCK_LEAD+KNOCK_RAPS*KNOCK_PERIOD+.1;
/** Depicted contact times of the raps (seconds from the motion's start). */
export const knockContacts=()=>Array.from({length:KNOCK_RAPS},(_,i)=>HAND_REACH_SECONDS+KNOCK_LEAD+(i+KNOCK_IN)*KNOCK_PERIOD);
/** `release`: the arm's way back down (s; default HAND_RELEASE_SECONDS). Entry 42's storage drawer, carrying in the other hand,
 *  lowered its arm at 0.082 m per 50 ms in 0.7 s (take 5); it takes 1 s. */
export const handReleaseSeconds=(m:Pick<HandActuatorMotion,'release'>)=>m.release??HAND_RELEASE_SECONDS;
export function handSwingSeconds(m:Pick<HandActuatorMotion,'opening'|'stroke'|'slide'|'op'|'hold'|'tug'>){
 if(m.op)return m.op==='knock'?KNOCK_SECONDS:LOCK_TURN_SECONDS;
 if(m.slide)return Math.max(1,Math.abs(m.slide.to-m.slide.from)*3.2);   // a drawer: about a second, an ordinary pull
 const o=m.opening;if(!o)return m.stroke?.seconds??m.tug?.seconds??m.hold??0;
 if(o.bodyPolicy==='door-natural-v2')return Math.max(HAND_SWING_SECONDS,(Math.abs(o.to-o.from)*(o.radius+.42)+.35)*1.5/1.2);
 // Slow a larger opted-in leaf rather than exceeding ordinary walking speed.
 return Math.max(HAND_SWING_SECONDS,Math.abs(o.to-o.from)*hypot(o.radius+(o.side<0?-.5:0),.42)*1.5/1.2);
}
export function handActuatorFrame(m:HandActuatorMotion,seconds:number){
 const R=handReachSeconds(m),swing=handSwingSeconds(m),releaseAt=R+swing;
 // a turned lock changes at the end of the turn; a knock is heard at its first rap
 const commitAt=m.op==='knock'?knockContacts()[0]:m.opening?.to===0||m.stroke||m.tug||m.slide?.to===0?releaseAt:R;
 const k=smooth(((m.abortedAt??seconds)-R)/(swing||1));
 const angle=m.opening?m.opening.from+(m.opening.to-m.opening.from)*k:0,pos=m.slide?m.slide.from+(m.slide.to-m.slide.from)*k:0;
 // Entry 38: a stroke may lower the arm more slowly (a hand coming down from above the shoulder; default 0.7 s)
 // Entry 42: or the motion's own `release` (a storage drawer, carrying in the other hand)
 const rel=m.stroke?.release??handReleaseSeconds(m);
 const weight=m.abortedAt!==undefined?(m.abortWeight??0)*(1-smooth((seconds-m.abortedAt)/rel))
   :smooth(seconds/R)*(1-smooth((seconds-releaseAt)/rel));
 // entry 32: a walk's thumb-turn / key keeps the hand up and slides it to the handle (`slide`), then hands over to the opening
 if(m.passage?.mode==='unlock'&&m.abortedAt===undefined){
  const turn=k,slide=smooth((seconds-releaseAt)/UNLOCK_SLIDE_SECONDS);
  return {angle,pos,weight:smooth(seconds/R),idleBlend:0,idleWeight:1-smooth(seconds/R),armDown:false,commitAt,done:seconds>=releaseAt+UNLOCK_SLIDE_SECONDS,contact:seconds>=commitAt,turn,rap:0,slide,tug:0};
 }
 // Entry 38: a stroke followed by a step back hands the body over soon after the arm is down (`handoff`), before an idle
 // gesture can rise in the 1.2 s idle handoff (take 4: a hand went up to the hair at 0.1 m per 50 ms, then the step back)
 const armDownAt=(m.abortedAt??releaseAt)+rel,idleBlend=smooth((seconds-armDownAt)/HAND_IDLE_HANDOFF_SECONDS),handoff=m.stroke?.handoff??HAND_IDLE_HANDOFF_SECONDS;
 const idleWeight=m.abortedAt!==undefined||seconds<R?1-weight:idleBlend;
 // entry 32: how far the key / thumb-turn has turned (0..1), and how far the knuckles are from the leaf (0 = touching)
 const turn=m.op==='lock'||m.op==='unlock'?k:0;
 let rap=0;if(m.op==='knock'){const f=(seconds-HAND_REACH_SECONDS-KNOCK_LEAD)/KNOCK_PERIOD;if(f<0)rap=1;else if(f>=KNOCK_RAPS)rap=1;else{const x=f%1;rap=x<KNOCK_IN?1-smooth(x/KNOCK_IN):smooth((x-KNOCK_IN)/(1-KNOCK_IN));}}
 // entry 10: how far a bell rope is pulled down (0..1): down over the swing, back up as the arm lowers
 const tug=m.tug?k*(1-smooth((seconds-(m.abortedAt??releaseAt))/rel)):0;
 return {angle,pos,weight,idleBlend,idleWeight,armDown:seconds>=armDownAt,commitAt,done:seconds>=armDownAt+handoff,contact:m.abortedAt===undefined&&seconds>=commitAt,turn,rap,slide:0,tug};
}
/** Three's local-Y rotation convention, converted to the native world frame. */
export function actuatorPoint(o:NonNullable<HandActuatorParams['opening']>,angle:number){
 const a=o.yaw+angle,c=dcos(a),s=dsin(a),[x,y,z]=o.hinge;
 const centre:Vec3=[x+c*o.radius,y+o.handleY,z-s*o.radius];
 const hand:Vec3=[centre[0]+s*.06*o.side,centre[1],centre[2]+c*.06*o.side];
 // On the push side, use the near (left) hand and keep the root nearer the
 // hinge than the handle, so the shoulder and hips clear the latch jamb.
 if(o.bodyPolicy==='door-natural-v2'&&o.side===1){
  // Stay beyond the free edge while pulling, rather than orbiting around the
  // hinge. The torso keeps facing the doorway; the hand follows the leaf.
  // Entry 31: pushing it shut from this side the body steps in with the leaf, and the drawn body trails its native root by
  // ~3 cm, so the close keeps 3 cm more from the wall (0.38 m measured clearance natively, 0.353 drawn, was the margin).
  const u=Math.max(0,Math.min(1,angle/HAND_OPEN_ANGLE)),ox=.35*u,oz=o.to===0&&o.from!==0?.48:.45;
  return {hand,root:[centre[0]+dcos(o.yaw)*ox+dsin(o.yaw)*oz,o.floorY??y,centre[2]-dsin(o.yaw)*ox+dcos(o.yaw)*oz] as Vec3};
 }
 const along=o.side<0?(o.bodyPolicy==='door-natural-v2'?-.35:-.5):0;
 // (entry 31: .40 from the leaf, was .37: the drawn body trails its native root by 2-3 cm, which left 0.347 m drawn)
 const off=o.bodyPolicy==='door-natural-v2'?.40:.42;
 const root:Vec3=[centre[0]+s*off*o.side+c*along,o.floorY??y,centre[2]+c*off*o.side-s*along];
 return {hand,root};
}
/** Where a writing or wiping hand is on the face at stroke progress `u` (0..1): rows of small letter strokes, left to
 *  right, with a slight lift back to the next row; a wipe is three overlapping sweeps. Continuous at u=0 and u=1. */
export const twoHanded=(s?:HandActuatorParams['stroke'])=>s?.kind==='poster'||s?.kind==='unposter';
/** Entry 38: where both palms are while putting a poster up (u 0..1 of the stroke). Face-local [x right, y up, out from the
 *  wall]: press the rolled top edge to the wall, unroll it downward with both palms sliding down the sides, press (tape) the
 *  bottom corners, smooth back up the sides and press (tape) the top corners. Taking down: hands to the top corners, peel, roll
 *  the sheet up from the top as the hands go down, then lift the roll away toward the chest. Continuous at u=0 and u=1. */
export const POSTER_ON=.035,POSTER_OFF=.07;
/** Entry 38 (take 3): a stroke with a `lead` first brings the hand(s) up to the front of the chest (world height `lead.y`,
 *  `lead.out` from the face) and only then to where the work starts, so the 0.65 s reach covers the short way from the side
 *  (a hand raised straight from the hip to above the shoulder in 0.65 s moved 0.15 m per 50 ms). STROKE_LEAD of the stroke. */
export const STROKE_LEAD=.2;
/** The stroke's own progress (0..1) at u; negative while the lead is still bringing the hands up. */
export const strokeWork=(s:NonNullable<HandActuatorParams['stroke']>,u:number)=>!s.lead?u:(Math.max(0,Math.min(1,u))-STROKE_LEAD)/(1-STROKE_LEAD);
const leadMix=(s:NonNullable<HandActuatorParams['stroke']>,u:number)=>s.lead&&u<STROKE_LEAD?smooth(Math.max(0,u)/STROKE_LEAD):1;
export function posterLocal(s:NonNullable<HandActuatorParams['stroke']>,u:number,at?:Vec3):{x:number;y:number;o:number;spread:number}{
 if(s.lead&&u<STROKE_LEAD){const to=posterBase(s,0),f=leadMix(s,u),ly=s.lead.y-(at?.[1]??s.lead.y+.2);return {x:0,y:ly+(to.y-ly)*f,o:s.lead.out+(to.o-s.lead.out)*f,spread:.8+(to.spread-.8)*f};}
 return posterBase(s,strokeWork(s,u));
}
function posterBase(s:NonNullable<HandActuatorParams['stroke']>,u:number):{x:number;y:number;o:number;spread:number}{
 const k=Math.max(0,Math.min(1,u)),yT=s.height/2-.08,yB=-s.height/2+.045,seg=(a:number,b:number)=>smooth((k-a)/(b-a)),lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
 if(s.kind==='unposter'){
  if(k<.15)return {x:0,y:yT,o:lerp(POSTER_OFF,POSTER_ON,seg(0,.15)),spread:1};
  if(k<.55){const f=seg(.15,.55);return {x:0,y:lerp(yT,yB,f),o:lerp(POSTER_ON,.06,f),spread:1};}
  const f=seg(.55,1);return {x:0,y:lerp(yB,-.2,f),o:lerp(.06,.15,f),spread:lerp(1,.85,f)};   // the roll held low in front, not at the chin
 }
 if(k<.09)return {x:0,y:yT,o:lerp(POSTER_OFF,POSTER_ON,seg(0,.09)),spread:1};
 if(k<.45)return {x:0,y:lerp(yT,yB,seg(.09,.45)),o:POSTER_ON,spread:1};
 if(k<.56)return {x:0,y:yB,o:POSTER_ON-.006*dsin(Math.PI*(k-.45)/.11),spread:1};
 if(k<.78){const f=(k-.56)/.22;return {x:0,y:lerp(yB,yT,smooth(f)),o:POSTER_ON+.03*dsin(Math.PI*f),spread:1};}
 if(k<.88)return {x:0,y:yT,o:POSTER_ON-.006*dsin(Math.PI*(k-.78)/.10),spread:1};
 // last, the palms slide off the top corners down the sheet's sides to chest height and come away, so the arms are lowered
 // from there and not from above the shoulders
 const f=seg(.88,1);return {x:0,y:lerp(yT,-.06,f),o:lerp(POSTER_ON,.11,f),spread:lerp(1,.86,f)};
}
export function strokeHands(at:Vec3,s:NonNullable<HandActuatorParams['stroke']>,u:number):{left:Vec3;right:Vec3}{
 const right:[number,number]=[dcos(s.yaw),-dsin(s.yaw)],out:[number,number]=[dsin(s.yaw),dcos(s.yaw)],l=posterLocal(s,u,at),half=(s.width/2-.04)*l.spread;
 const p=(x:number):Vec3=>[at[0]+right[0]*x+out[0]*l.o,at[1]+l.y,at[2]+right[1]*x+out[1]*l.o];
 return {left:p(-half),right:p(half)};
}
export function strokePoint(at:Vec3,s:NonNullable<HandActuatorParams['stroke']>,u:number):Vec3 {
 if(twoHanded(s))return strokeHands(at,s,u).right;
 if(s.lead&&u<STROKE_LEAD){const to=strokePoint({...at},{...s,lead:undefined},0),out:[number,number]=[dsin(s.yaw),dcos(s.yaw)],f=leadMix(s,u);
  // the lead point: in front of the chest, below the start of the work, out from the face
  const from:Vec3=[to[0]+out[0]*(s.lead.out-.04),s.lead.y,to[2]+out[1]*(s.lead.out-.04)];return [from[0]+(to[0]-from[0])*f,from[1]+(to[1]-from[1])*f,from[2]+(to[2]-from[2])*f];}
 if(s.lead)u=strokeWork(s,u);
 const k=Math.max(0,Math.min(1,u)),right:[number,number]=[dcos(s.yaw),-dsin(s.yaw)],out:[number,number]=[dsin(s.yaw),dcos(s.yaw)];
 let x:number,y:number,lift=0;
 if(s.kind==='wipe'){const pass=Math.min(2,Math.floor(k*3)),f=k*3-pass,dir=pass%2?-1:1;x=dir*(f-.5)*s.width;y=s.height*.3*(1-2*k)+.03*dsin(f*Math.PI*6);}
 else{const row=Math.min(s.lines-1,Math.floor(k*s.lines)),f=k*s.lines-row,top=s.lines>1?s.height/2:0,step=s.lines>1?s.height/(s.lines-1):0;
  const writing=f<.75,g=writing?f/.75:(f-.75)/.25;
  x=writing?(g-.5)*s.width:(.5-smooth(g))*s.width;y=top-row*step-(writing?0:step*smooth(g))+(writing?.012*dsin(g*Math.PI*14):0);lift=writing?0:.035*dsin(g*Math.PI);
  if(row===s.lines-1&&!writing){x=.5*s.width;y=top-row*step;lift=0;}}
 return [at[0]+right[0]*x+out[0]*lift,at[1]+y,at[2]+right[1]*x+out[1]*lift];
}
/** Where a body stands to write on a face: square in front of `at`, `STROKE_STAND` metres out along the face's facing. */
export const STROKE_STAND=.38;
export const strokeRoot=(at:Vec3,s:NonNullable<HandActuatorParams['stroke']>,y:number):Vec3=>{const d=s.stand??STROKE_STAND;return [at[0]+dsin(s.yaw)*d,y,at[2]+dcos(s.yaw)*d];};
/** Where the hand and the body are with a drawer `pos` metres out. */
export function slidePoint(s:NonNullable<HandActuatorParams['slide']>,pos:number){
 const hand:Vec3=[s.at[0]+s.dir[0]*pos,s.at[1],s.at[2]+s.dir[1]*pos];
 return {hand,root:[hand[0]+s.dir[0]*.5,s.floorY,hand[2]+s.dir[1]*.5] as Vec3};
}
/** Entry 32: where the hand is on a lockable door: the key / thumb-turn (0.9 m on a standard door, under the knob), or the
 *  knuckles on the leaf (about 1.38 m, a little towards the hinge). `rap` lifts the knuckles off the leaf between raps. */
export const KNOCK_LIFT=.07;
export function opPoint(o:NonNullable<HandActuatorParams['opening']>,op:'lock'|'unlock'|'knock',rap=0):Vec3{
 const along=op==='knock'?o.radius*.62:o.radius-(o.side<0?.03:0),y=o.hinge[1]+(op==='knock'?o.handleY*1.33:o.handleY*.865),c=dcos(o.yaw),s=dsin(o.yaw);
 // the palm point is a few centimetres off the face it touches (knuckles on the leaf at 0.03 m, fingers round the key bow)
 const off=op==='knock'?.075+KNOCK_LIFT*rap:.085;
 return [o.hinge[0]+c*along+s*off*o.side,y,o.hinge[2]-s*along+c*off*o.side];
}
export const actuatorHand=(o?:HandActuatorParams['opening'],hand?:'left'|'right'):'left'|'right'=>hand??(o?.bodyPolicy==='door-natural-v2'?'left':(o?.side===-1?'left':'right'));
export function tugPoint(at:Vec3,tug:NonNullable<HandActuatorParams['tug']>,amount:number):Vec3 {
 const a=tug.angle*amount,side=tug.length*dsin(a);
 return [at[0]+dsin(tug.yaw)*side,at[1]+tug.length*(1-dcos(a)),at[2]+dcos(tug.yaw)*side];
}
const issue=(code:string,message:string,subjects:string[]):Diagnostic=>({code:'contact.'+code,message,subjects});
type Obstacle=Spatial['scene']['obstacles'][number];
/** M01: obstacles near the whole operation, per scene obstacle array (rebuilt, never mutated, when the scene changes).
 *  Every root of one operation lies within `reach` of `centre`, so a farther obstacle can never block it. */
const nearOps=new WeakMap<Exec,{of:readonly Obstacle[];near:Obstacle[]}>();
export const handClearanceStats={obstaclesVisited:0,candidateBuilds:0};
const SHIFT_STEPS=[.01,.02,.03,.05],SHIFT_MAX=.18,STEP_MAX=.07;
function nearObstacles(ex:Exec,all:readonly Obstacle[]){
 const was=nearOps.get(ex);if(was?.of===all)return was.near;
 const o=ex.p.opening,centre=o?o.hinge:ex.root,reach=o?o.radius+2:ex.p.stroke?1:ex.p.slide?ex.p.slide.travel+.5:.5,near:Obstacle[]=[];
 for(const b of all){if(b.id===ex.p.target||b.id.startsWith(ex.p.target+'#'))continue;if(hypot(b.obb.c[0]-centre[0],b.obb.c[1]-centre[2])<=reach+hypot(b.obb.half[0],b.obb.half[1])+HUMAN_RADIUS+.1)near.push(b);}
 nearOps.set(ex,{of:all,near});handClearanceStats.candidateBuilds++;return near;
}
/** #1070: exact box distance can pass a step the rasterized clearance fails near a turned footprint, and an opening's body
 *  follows the handle, so it can't stop short as a stroke does. It sidesteps instead: the rest of the path shifts by the
 *  smallest step with room, up to SHIFT_MAX in all and no faster than a walk, so a big shift builds over several ticks. False when
 *  nothing fits. */
function sidestep(rt:Runtime,ex:Exec,a:Entity,root:Vec3):boolean{
 const from=a.pose.p,fits=(x:number,z:number)=>staticStepClear(rt,a,[x,z]);
 if(fits(root[0],root[2]))return true;
 const [x,z]=ex.shift??[0,0];
 for(const m of SHIFT_STEPS)for(let i=0;i<8;i++){const dx=m*dcos(i*Math.PI/4),dz=m*dsin(i*Math.PI/4),qx=root[0]+dx,qz=root[2]+dz;
  if(hypot(x+dx,z+dz)<=SHIFT_MAX&&hypot(qx-from[0],qz-from[2])<=STEP_MAX&&fits(qx,qz)){ex.shift=[x+dx,z+dz];root[0]=qx;root[2]=qz;return true;}}
 return false;
}
function blocked(rt:Runtime,ex:Exec,root:Vec3,angle:number):Diagnostic|null{
 const p=ex.p,actor=rt.world.entities[p.actor],sp=rt.services.spatial as Spatial|undefined;
 if(!actor?.human)return issue('body-gone','The original body is gone.',[p.actor]);
 if(!sp)return issue('no-geometry','No authoritative clearance is available.',[p.actor]);
 sp.sync(rt.world);
 for(const o of nearObstacles(ex,sp.scene.obstacles)){
  handClearanceStats.obstaclesVisited++;
  if(o.y1<=root[1]+.15||o.y0>=root[1]+1.75)continue;
  const c=dcos(o.obb.yaw),s=dsin(o.obb.yaw),dx=root[0]-o.obb.c[0],dz=root[2]-o.obb.c[1];
  const x=Math.max(0,Math.abs(dx*c+dz*s)-o.obb.half[0]),z=Math.max(0,Math.abs(-dx*s+dz*c)-o.obb.half[1]);
  if(hypot(x,z)<HUMAN_RADIUS+.025)return issue('step-blocked',`There is no clear place to step while holding this handle beside ${o.label??o.id}.`,[p.actor,o.id]);
 }
 const who=personBlocking(rt,ex,root,angle);
 return who?(who.code==='leaf-blocked'?issue('leaf-blocked','Someone is in the swinging panel’s path.',[p.target,who.id]):issue('person-in-way','Someone is in the operating path.',[p.actor,who.id])):null;
}
/** Distance from a point to the leaf's mid-plane segment at `angle` (hinge to free edge, plus a little). */
export function leafDistance(o:NonNullable<HandActuatorParams['opening']>,angle:number,x:number,z:number){
 const dx=x-o.hinge[0],dz=z-o.hinge[2],a=o.yaw+angle,c=dcos(a),s=dsin(a),along=Math.max(0,Math.min(o.radius+.12,dx*c-dz*s));
 return hypot(dx-along*c,dz+along*s);
}
/** Another body on this level standing where the operator steps (`root`) or in the leaf's way at `angle`. */
function personBlocking(rt:Runtime,ex:Exec,root:Vec3,angle:number):{id:string;code:'person-in-way'|'leaf-blocked'}|null{
 const p=ex.p,actor=rt.world.entities[p.actor],o=p.opening;if(!actor?.human)return null;
 for(const e of Object.values(rt.world.entities)){
  if(e.id===p.actor||!e.human||(e.human.level??0)!==(actor.human.level??0))continue;
  if(hypot(e.pose.p[0]-root[0],e.pose.p[2]-root[2])<2*HUMAN_RADIUS+.04)return {id:e.id,code:'person-in-way'};
  if(o&&leafDistance(o,angle,e.pose.p[0],e.pose.p[2])<HUMAN_RADIUS+.06)return {id:e.id,code:'leaf-blocked'};
 }
 return null;
}
// ---- Soul Actions entry 31: door passage (a door opened and closed as one leg of a walk) ----
/** Seconds a passage waits on a body in the swing before asking it to step aside, the longest it waits before reaching,
 *  the longest a swing stays paused on a body that stepped into it, and the longest it waits for another Soul to pass. */
export const PASSAGE_ASK_SECONDS=1,PASSAGE_WAIT_SECONDS=8,PASSAGE_PAUSE_SECONDS=6,PASSAGE_YIELD_SECONDS=15;
/** Entry 32: the longest a queued Soul waits behind an earlier passage on its side that is still approaching or opening. */
export const PASSAGE_QUEUE_SECONDS=40;
/** Other Souls' door passages through `door` (engine-mars installs `doorPassersV1` from its programmes). */
type Passer={actor:string;phase:'approach'|'opening'|'through'|'closing';from?:number};
const passers=(rt:Runtime,door:string):Passer[]=>((rt.services as {doorPassersV1?:(d:string)=>Passer[]}).doorPassersV1?.(door)??[]);
/** Entry 32: is the door locked now (god engine-bridge installs `doorLockedV1`); null when nobody says. */
const doorLocked=(rt:Runtime,target:string)=>(rt.services as {doorLockedV1?:(id:string)=>boolean|null}).doorLockedV1?.(target)??null;
/** Is the door's closed gap still a solid in the walk graph (god engine-bridge: `<door>#door:<opening>`)? */
function doorShut(rt:Runtime,target:string){const sp=rt.services.spatial as Spatial|undefined;if(!sp)return false;sp.sync(rt.world);return sp.scene.obstacles.some(o=>o.id.startsWith(target+'#door:'));}
/** Door-local frame: `u` along the wall towards the latch, `n` the normal whose sign is the side. */
function doorFrame(p:HandActuatorParams){const y=p.opening!.yaw,u:[number,number]=[dcos(y),-dsin(y)],n:[number,number]=[dsin(y),dcos(y)],[cx,cz]=p.passage!.door;
 return {u,n,side:(x:number,z:number)=>((x-cx)*n[0]+(z-cz)*n[1])>=0?1:-1,local:(x:number,z:number)=>[(x-cx)*u[0]+(z-cz)*u[1],(x-cx)*n[0]+(z-cz)*n[1]] as const,at:(a:number,b:number):[number,number]=>[cx+u[0]*a+n[0]*b,cz+u[1]*a+n[1]*b]};}
/** Someone still to come through behind this Soul: another Soul's passage not yet through the doorway (within 10 m),
 *  or another body walking towards the doorway from the side this Soul came from (within 6 m) to a goal beyond it. */
function following(rt:Runtime,ex:Exec):string|null{
 const p=ex.p,f=doorFrame(p),[cx,cz]=p.passage!.door;
 for(const q of passers(rt,p.target)){if(q.actor===p.actor||q.phase==='closing')continue;const e=rt.world.entities[q.actor];if(e&&hypot(e.pose.p[0]-cx,e.pose.p[2]-cz)<=10)return q.actor;}
 const walks=rt.services.walkExecs as Map<string,{actor?:string;goal?:{p:[number,number]}}>|undefined;
 for(const w of walks?.values()??[]){const e=w.actor&&w.actor!==p.actor?rt.world.entities[w.actor]:undefined;if(!e?.human||!w.goal)continue;
  if(hypot(e.pose.p[0]-cx,e.pose.p[2]-cz)<=6&&f.side(e.pose.p[0],e.pose.p[2])===p.passage!.from&&f.side(w.goal.p[0],w.goal.p[1])!==p.passage!.from)return e.id;}
 return null;
}
/** Another Soul now opening, walking through or closing this door, or any body in the doorway itself. A passage queued
 *  behind this one on the same side (entry 32) waits for this one, never the other way round. */
function passing(rt:Runtime,ex:Exec):string|null{
 const p=ex.p,[cx,cz]=p.passage!.door;
 const hand=handOnDoor(rt,ex);if(hand)return hand;
 const list=passers(rt,p.target),mine=list.findIndex(q=>q.actor===p.actor);
 for(const [i,q] of list.entries())if(q.actor!==p.actor&&q.phase!=='approach'&&!(q.from===p.passage!.from&&mine>=0&&i>mine))return q.actor;
 for(const e of Object.values(rt.world.entities))if(e.id!==p.actor&&e.human&&hypot(e.pose.p[0]-cx,e.pose.p[2]-cz)<.75)return e.id;
 return null;
}
/** Entry 32: an earlier passage on this Soul's side of the door still approaching or opening: this one is queued behind. */
function queuedBehind(rt:Runtime,ex:Exec):string|null{
 const list=passers(rt,ex.p.target),mine=list.findIndex(q=>q.actor===ex.p.actor);if(mine<=0)return null;
 return list.slice(0,mine).find(q=>q.from===ex.p.passage!.from&&(q.phase==='approach'||q.phase==='opening'))?.actor??null;
}
/** Another body's hand on this door now (its operation has begun and not yet let go). */
function handOnDoor(rt:Runtime,ex:Exec):string|null{for(const e of Object.values(rt.world.entities))if(e.id!==ex.p.actor&&e.human?.handActuator?.target===ex.p.target)return e.id;return null;}
/** Where a Soul waits for another to come through: beside the doorway on its own side, latch side first (out of the swing
 *  and of the way through), else the hinge side, else straight back; the first with standing room. */
function waitSpot(rt:Runtime,ex:Exec):[number,number]|null{
 const p=ex.p,a=rt.world.entities[p.actor],f=doorFrame(p),side=f.side(a.pose.p[0],a.pose.p[2]),sp=rt.services.spatial as Spatial|undefined,g=sp?.levelAt(a.human?.level??0,[a.pose.p[0],a.pose.p[2]]);
 for(const [x,zz] of [[1.35,1.0],[1.35,1.5],[-1.6,1.2],[0,1.9]] as const){const q=f.at(x,zz*side);if(!g||clearanceAt(g,q)>=HUMAN_RADIUS+.1)return q;}
 return null;
}
/** In the doorway's lane or swing (door-local |x| < 0.95 m, |z| < 1.6 m): where a waiting body is in the way. */
function inTheWay(ex:Exec,x:number,z:number){const [lx,lz]=doorFrame(ex.p).local(x,z);return Math.abs(lx)<.95&&Math.abs(lz)<1.6;}
/** A short courtesy walk of this Soul's own (a child of the operation, so the body stays reserved to it). */
function stepTo(rt:Runtime,ex:Exec,q:[number,number]){dropHandover(rt,ex);const r=rt.submit('walk_to',{actor:ex.p.actor,x:q[0],z:q[1]},{parent:ex.id});if(r.status!=='failed')ex.child=r.id;return r.status!=='failed';}
/** One passage tick before or while operating: a result to return now, or null to run the ordinary operation. */
function passageStep(rt:Runtime,ex:Exec,dt:number):StepResult|null{
 const p=ex.p,o=p.opening!,a=rt.world.entities[p.actor],pass=p.passage!;
 if(ex.child){if(rt.isActive(ex.child))return {status:'running',phase:'waiting'};delete ex.child;}
 if(!ex.began){
  // entry 32: queued behind an earlier passage on this side: wait where the walk stopped (the queue spot) until it is through
  if(pass.mode!=='close'){const ahead=queuedBehind(rt,ex);if(ahead)return hold(rt,ex,'queue',ahead);}
  // entry 32: the thumb-turn / key before the door: nothing to turn when somebody already unlocked or opened it
  if(pass.mode==='unlock'&&(!doorShut(rt,p.target)||doorLocked(rt,p.target)===false)){const who=doorShut(rt,p.target)?null:passing(rt,ex);if(!who)return skip(rt,ex,doorShut(rt,p.target)?'already unlocked':'found open');return hold(rt,ex,'passing',who);}
  if(pass.mode==='open'&&!doorShut(rt,p.target)){const who=passing(rt,ex);if(!who)return skip(rt,ex,'found open');return hold(rt,ex,'passing',who);}
  if(pass.mode==='close'){if(doorShut(rt,p.target))return skip(rt,ex,'already shut');const who=following(rt,ex);if(who)return skip(rt,ex,'held open for '+who);}
  const hand=handOnDoor(rt,ex);if(hand)return hold(rt,ex,'passing',hand);
  // the whole swing and the stepping path, closed to open, before the hand goes out
  for(let k=0;k<=8;k++){const ang=o.from+(o.to-o.from)*k/8,pt=actuatorPoint(o,ang),who=personBlocking(rt,ex,pt.root,ang);if(who)return hold(rt,ex,'swing',who.id);}
  const r0=actuatorPoint(o,o.from).root;
  if(hypot(a.pose.p[0]-r0[0],a.pose.p[2]-r0[2])>.2){if(stepTo(rt,ex,[r0[0],r0[2]]))return {status:'running',phase:'waiting'};return {status:'failed',diagnostic:issue('not-at-handle','Walk to the actual handle before operating it.',[p.target])};}
  ex.began=true;delete ex.held;ex.t=0;ex.root=[...a.pose.p];ex.yaw=a.pose.yaw;ex.motion.startTick=rt.tick;
  rt.mark('hand.passage-begin',{action:ex.id,target:p.target,mode:pass.mode});
  return null;
 }
 // operating: a body that steps into the swing pauses the leaf (the shared timeline shifts with it, so every viewer draws
 // the same pause); after PASSAGE_PAUSE_SECONDS the ordinary check below refuses and the hand lets go
 const swing=handSwingSeconds(ex.motion);
 if(ex.t<HAND_REACH_SECONDS+swing&&(ex.paused??0)*dt<PASSAGE_PAUSE_SECONDS){
  const f=handActuatorFrame(ex.motion,ex.t+dt),pt=actuatorPoint(o,f.angle),who=personBlocking(rt,ex,pt.root,f.angle);
  if(who){ex.paused=(ex.paused??0)+1;ex.motion.startTick+=1;if(ex.paused*dt>=PASSAGE_ASK_SECONDS&&ex.held?.asked!==who.id){ex.held={since:rt.tick,why:'swing',asked:who.id};ask(rt,who.id,swingCentre(o));}return {status:'running',phase:'operating'};}
 }
 return null;
}
/** Ask a body standing idle in the swing to step aside (entry 28's courtesy step-aside); someone sitting, lying, asleep
 *  or busy is not shooed off for a door: the Soul waits, and stops with a reason if the way does not clear. */
function ask(rt:Runtime,who:string,keepClear:Vec2){const h=rt.world.entities[who]?.human;if(h&&h.activity==='idle'&&!h.sleepPose&&!h.baseActivity&&!h.task)makeWay(rt,who,keepClear);}
const swingCentre=(o:NonNullable<HandActuatorParams['opening']>):Vec2=>{const a=o.yaw+(o.from+o.to)/2,r=o.radius*.6;return [o.hinge[0]+dcos(a)*r,o.hinge[2]-dsin(a)*r];};
/** Entry 32: a hand left on the handle by this Soul's own thumb-turn step, when the opening it handed over to is not
 *  going ahead now (it waits, is skipped or stops): lower it (the viewer eases the arm back). */
function dropHandover(rt:Runtime,ex:Exec){const h=rt.world.entities[ex.p.actor]?.human;if(!ex.began&&h?.handActuator&&h.handActuator.actionId!==ex.id&&h.handActuator.passage?.mode==='unlock'){delete h.handActuator;delete h.hands;}}
function skip(rt:Runtime,ex:Exec,why:string):StepResult{dropHandover(rt,ex);ex.skip=why;rt.mark('hand.passage-skip',{action:ex.id,target:ex.p.target,mode:ex.p.passage!.mode,why});return {status:'completed'};}
/** Wait before reaching: out of the way for a Soul passing; a body in the swing is asked to step aside after a second. */
function hold(rt:Runtime,ex:Exec,why:'passing'|'swing'|'queue',who:string):StepResult{
 const p=ex.p,a=rt.world.entities[p.actor];dropHandover(rt,ex);ex.held??={since:rt.tick,why};if(ex.held.why!==why)ex.held={since:rt.tick,why};
 const waited=(rt.tick-ex.held.since)*DT;
 if(why==='queue'){if(waited>PASSAGE_QUEUE_SECONDS)return {status:'failed',diagnostic:issue('door-busy','Someone ahead at the door did not get through; this walk stopped before it.',[p.target,who])};if(a.human&&!ex.child)a.human.activity='idle';return {status:'running',phase:'waiting'};}
 if(waited>(why==='passing'?PASSAGE_YIELD_SECONDS:PASSAGE_WAIT_SECONDS))return {status:'failed',diagnostic:why==='passing'?issue('door-busy','Someone else kept passing through the door; this walk stopped before it.',[p.target,who]):issue('swing-blocked','Someone is in the door’s swing and did not move aside; nothing was opened.',[p.target,who])};
 if(why==='passing'&&inTheWay(ex,a.pose.p[0],a.pose.p[2])){const q=waitSpot(rt,ex);if(q&&hypot(q[0]-a.pose.p[0],q[1]-a.pose.p[2])>.3&&stepTo(rt,ex,q))return {status:'running',phase:'waiting'};}
 if(why==='swing'&&waited>=PASSAGE_ASK_SECONDS&&ex.held.asked!==who){ex.held.asked=who;ask(rt,who,swingCentre(p.opening!));}
 if(a.human&&!ex.child)a.human.activity='idle';
 return {status:'running',phase:'waiting'};
}
type Exec={p:HandActuatorParams;motion:HandActuatorMotion;t:number;root:Vec3;yaw:number;id?:string;strokeHeld?:true;shift?:[number,number];
 /** passage: nothing to do (found open, or someone is following) */ skip?:string;
 /** passage: waiting before the reach (a body in the swing, another Soul passing) since tick; who was asked to step aside */ held?:{since:number;asked?:string;why:string};
 /** passage: ticks the swing has been paused on a body in it */ paused?:number;
 /** passage: a courtesy walk of this Soul's own in progress */ child?:string;
 /** passage: the operation reached the door (motion begun) */ began?:true};
function clear(rt:Runtime,ex:Exec){const h=rt.world.entities[ex.p.actor]?.human;if(!h)return;delete h.handActuator;freeHand(h,ex.p);delete h.speed;h.activity='idle';}
/** Lower the operating hand: the other hand keeps what it carries (entry 42); without `hand`, all hands as before. */
function freeHand(h:NonNullable<Entity['human']>,p:HandActuatorParams){if(!p.hand||!h.hands){delete h.hands;return;}delete h.hands[p.hand];if(!h.hands.left&&!h.hands.right)delete h.hands;}
/** Entry 42: the hands of `actor` that hold an item (hold_items keeps them at their carry points). */
const holdingHands=(rt:Runtime,actor:string)=>{const out=new Set<string>();for(const e of Object.values(rt.world.entities))if(e.support?.kind==='in-hand'&&e.support.by===actor)out.add(e.support.hand);return out;};
export const handActuator:ActionDef<HandActuatorParams,true,Exec>={
 verb:'hand_actuator_v1',description:'Reach, operate a switch or hinged opening with continuous hand contact, and lower the arm before releasing the body.',schema:handActuatorParams,
 // A passage step shares the door with other passages and decides who goes first itself (passageStep: one hand on the
 // door at a time); against an explicit open/close it is exclusive as before, and waits for it (runtime nudgeHolds).
 reservations:(_w,p)=>[{resource:'actor:'+p.actor,mode:'exclusive'},{resource:'hand:'+p.actor+(':'+actuatorHand(p.opening,p.hand)),mode:'exclusive'},...(twoHanded(p.stroke)?[{resource:'hand:'+p.actor+':left',mode:'exclusive' as const}]:[]),{resource:'entity:'+p.target,mode:p.passage?'shared':'exclusive'}],
 plan(rt,p){const actor=rt.world.entities[p.actor],h=actor?.human;if(actor?.body?.family==='floater')return {ok:false,diagnostic:issue('no-arms','This body has no humanoid hand actuator.',[p.actor])};const carried=p.hand&&h?.hands?holdingHands(rt,p.actor):null,carrying=!!carried&&Object.keys(h!.hands!).every(k=>carried.has(k))&&!carried.has(p.hand!);
  if(p.tug&&actor&&(p.at[1]-actor.pose.p[1]>1.65||p.at[1]-actor.pose.p[1]<.9))return {ok:false,diagnostic:issue('rope-out-of-reach','This rope cannot be pulled from a comfortable standing reach.',[p.actor,p.target])};if(!h||h.grip||(h.hands&&!(h.handActuator?.passage?.mode==='unlock'&&h.handActuator.target===p.target)&&!carrying)||h.on||h.carrier||h.riding||h.shore||h.holding||h.activity==='sit')return {ok:false,diagnostic:issue('body-busy','Stand with a free hand on stable ground first.',[p.actor])};return {ok:true,program:true};},
 start(rt,p,_plan,_id){const a=rt.world.entities[p.actor];return {p:structuredClone(p),motion:{...structuredClone(p),startTick:rt.tick,actionId:_id},t:0,root:[...a.pose.p],yaw:a.pose.yaw,id:_id};},
 step(rt,ex,dt){
  const a=rt.world.entities[ex.p.actor],h=a?.human;if(!h)return {status:'failed',diagnostic:issue('body-gone','The original body is gone.',[ex.p.actor])};
  if(ex.p.passage&&ex.p.opening){const r=passageStep(rt,ex,dt);if(r)return r;}
  ex.t+=dt;const f=handActuatorFrame(ex.motion,ex.t),point=ex.p.opening?actuatorPoint(ex.p.opening,f.angle):ex.p.slide?slidePoint(ex.p.slide,f.pos):{hand:ex.p.stroke?strokePoint(ex.p.at,ex.p.stroke,(ex.t-HAND_REACH_SECONDS)/ex.p.stroke.seconds):ex.p.tug?tugPoint(ex.p.at,ex.p.tug,f.tug):ex.p.at,root:ex.root};
  if(ex.p.op&&ex.p.opening){point.hand=opPoint(ex.p.opening,ex.p.op,f.rap);if(f.slide>0){const to=actuatorPoint(ex.p.opening,ex.p.opening.from).hand;point.hand=[point.hand[0]+(to[0]-point.hand[0])*f.slide,point.hand[1]+(to[1]-point.hand[1])*f.slide,point.hand[2]+(to[2]-point.hand[2])*f.slide];}}
  if(ex.p.opening&&hypot(ex.root[0]-actuatorPoint(ex.p.opening,ex.p.opening.from).root[0],ex.root[2]-actuatorPoint(ex.p.opening,ex.p.opening.from).root[2])>.22){clear(rt,ex);return {status:'failed',diagnostic:issue('not-at-handle','Walk to the actual handle before operating it.',[ex.p.target])};}
  if(ex.p.slide&&hypot(ex.root[0]-slidePoint(ex.p.slide,ex.p.slide.from).root[0],ex.root[2]-slidePoint(ex.p.slide,ex.p.slide.from).root[2])>.22){clear(rt,ex);return {status:'failed',diagnostic:issue('not-at-handle','Walk to the actual handle before operating it.',[ex.p.target])};}
  if(ex.p.stroke){const goal=strokeRoot(ex.p.at,ex.p.stroke,ex.root[1]);if(hypot(goal[0]-ex.root[0],goal[2]-ex.root[2])>.5){clear(rt,ex);return {status:'failed',diagnostic:issue('not-at-board','Walk up to the board before writing on it.',[ex.p.target])};}
   const k=smooth(Math.min(1,ex.t/HAND_REACH_SECONDS));point.root=ex.strokeHeld?[...a.pose.p]:[ex.root[0]+(goal[0]-ex.root[0])*k,ex.root[1],ex.root[2]+(goal[2]-ex.root[2])*k];}
  if((ex.p.opening||ex.p.slide)&&ex.t<handReachSeconds(ex.p)){const k=smooth(ex.t/handReachSeconds(ex.p));point.root=[ex.root[0]+(point.root[0]-ex.root[0])*k,ex.root[1]+(point.root[1]-ex.root[1])*k,ex.root[2]+(point.root[2]-ex.root[2])*k];}
  if(ex.shift)point.root=[point.root[0]+ex.shift[0],point.root[1],point.root[2]+ex.shift[1]];
  const bad=blocked(rt,ex,point.root,f.angle);if(bad){clear(rt,ex);return {status:'failed',diagnostic:bad};}
  // #1063: a stroke's step stops for good where the next one would overlap by the invariant's measure, and the hand works from there
  if(ex.p.stroke&&!ex.strokeHeld&&!staticStepClear(rt,a,[point.root[0],point.root[2]])){ex.strokeHeld=true;point.root=[...a.pose.p];}
  if((ex.p.opening||ex.p.slide)&&!sidestep(rt,ex,a,point.root)){clear(rt,ex);return {status:'failed',diagnostic:issue('step-blocked','There is no clear place to step while holding this handle.',[ex.p.actor,ex.p.target])};}
  const before=[...a.pose.p];a.pose.p=[...point.root];
  const face=ex.p.slide?heading([-ex.p.slide.dir[0],-ex.p.slide.dir[1]]):ex.p.opening?heading([-dsin(ex.p.opening.yaw+(ex.p.opening.bodyPolicy==='door-natural-v2'?(ex.p.opening.side===-1?f.angle*.34:0):f.angle))*ex.p.opening.side,-dcos(ex.p.opening.yaw+(ex.p.opening.bodyPolicy==='door-natural-v2'?(ex.p.opening.side===-1?f.angle*.34:0):f.angle))*ex.p.opening.side]):ex.p.stroke?heading([-dsin(ex.p.stroke.yaw),-dcos(ex.p.stroke.yaw)]):heading([point.hand[0]-a.pose.p[0],point.hand[2]-a.pose.p[2]]),turn=((face-ex.yaw+Math.PI*3)%(Math.PI*2))-Math.PI;
  // Soul Actions entry 33: a switch or valve contact turns the body over the whole reach (a door, drawer or board stroke
  // keeps its 0.4 s), so the reaching hand and the turning torso do not add up to a fast sweep
  a.pose.yaw=ex.yaw+turn*smooth(ex.t/(ex.p.opening||ex.p.slide||ex.p.stroke?.4:handReachSeconds(ex.motion)));
  const speed=hypot(a.pose.p[0]-before[0],a.pose.p[2]-before[2])/dt;h.activity=speed>.08?'walk':'operate';if(speed>.08)h.speed=speed;else delete h.speed;
  if(f.armDown){freeHand(h,ex.p);h.activity='idle';delete h.speed;}else if(twoHanded(ex.p.stroke)){const two=strokeHands(ex.p.at,ex.p.stroke!,(ex.t-HAND_REACH_SECONDS)/ex.p.stroke!.seconds);h.hands={left:two.left,right:two.right};}else if(ex.p.hand)h.hands={...(h.hands??{}),[ex.p.hand]:[...point.hand]};else h.hands=actuatorHand(ex.p.opening)==='left'?{left:[...point.hand]}:{right:[...point.hand]};h.handActuator=ex.motion;
  // entry 32: a walk's thumb-turn ends with the hand already on the handle: the opening that follows takes it from there
  if(f.done&&ex.p.passage?.mode==='unlock'&&ex.motion.abortedAt===undefined){h.activity='operate';return {status:'completed'};}
  if(f.done){clear(rt,ex);return {status:'completed'};}return {status:'running',phase:ex.t<handReachSeconds(ex.motion)?'reaching':ex.t<handReachSeconds(ex.motion)+handSwingSeconds(ex.motion)?'operating':'releasing'};
 },
 cancel(rt,ex){
  // Before contact, return the partly raised arm without applying anything.
  // Once grasped, complete the short safe swing/release before a new walk owns the body.
  if(ex.p.passage&&!ex.began)return {ok:true};
  if(ex.t<(ex.p.tug?handReachSeconds(ex.motion)+handSwingSeconds(ex.motion):handReachSeconds(ex.motion))&&ex.motion.abortedAt===undefined){ex.motion.abortWeight=handActuatorFrame(ex.motion,ex.t).weight;ex.motion.abortedAt=ex.t;}
  return {ok:true,deferred:true};
 },resumable:true,
};
