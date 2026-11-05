// Contact effects commit at the recorded hand contact, with release still owned by the native action.
// Durable receipt intent, no per-tick object scan and no effect from an interrupted walk.
import {actuatorPoint,actuatorHand,tugPoint,opPoint,slidePoint,strokePoint,strokeRoot,twoHanded,STROKE_STAND,HAND_OPEN_ANGLE,type HandActuatorParams} from '../../../../mars/viewer/engine/social/hand-actuator.ts';
import { createHash } from 'node:crypto';
import { isDry, stageWord } from './garden.ts';
import { HUMAN_RADIUS } from '../../../../mars/viewer/engine/world/catalog.ts';
import { opSchema, contactStateKey, DRAWER_TRAVEL, containerInside, pinSlot, signupSlot, pollSlot, gameSquare, gameSquareOf, gameStatus, posterSlot, posterList, posterPaper, wantedSlot, wantedList, POSTER_W, POSTER_H, type WorldModel, type Op, type StoredDef } from '@sim/world-compiler';
import { posterName, posterFreeSlot, posterTarget, posterAge, posterStale, wantedColumn, wantedFreeRow, wantedTarget } from './poster-boards.ts';
import type { EdgeSoul } from '../edge/contract.ts';
import { actionPatch, actionsOf, actuatedState, boardTextProblem, gamePatch, gameProblem, isGameAction, isListAction, listProblem, pinNotes, pollChoice, pollLines, whenRefusal } from './actuators.ts';
export const CONTACT_REACH = .8;
/** Entry 37: how long the hand stays on a radio's tuning knob after contact while the dial sweeps to the next station. */
export const TUNE_HOLD_SECONDS = .9;
/** Entry 37: how far in front of a panel of knobs (a radio) the body stands. */
export const PANEL_STAND = .45;
/** Entry 37: a reach to a panel's small knob is deliberate: 1 s instead of the 0.65 s switch reach. */
export const PANEL_REACH_SECONDS = 1;
/** Entry 33: the most of a neon sign's words a nearby Soul is shown (the sign's own limit, 32, plus a line break shown as " / "). */
const NEON_WORDS = 34;
export type ContactActuatorIntent = { target:string; action:string; actor:string; owner:string; binding:string; motionV1?:true; params?:Record<string,string>; /** entry 32: a passage's close re-locks the latch */ relock?:true; /** entry 32: a leg of a walk through the door */ passage?:true };
/** Soul Actions entry 32: the hand operations on a lockable door that are not the leaf itself. */
const LOCK_OPS=new Set(['lock','unlock','knock']);
type Refusal={code:string;reason:string};
export const isContactActuator = (def:StoredDef, action:{name:string}) => contactStateKey(def,action.name)!==null;
const fail=(code:string,reason:string)=>({ok:false as const,code,reason});
export function createContactActuatorService(d:{levelAt?:(x:number,z:number,y:number)=>number;clearance?:(x:number,z:number,level?:number)=>number;model:()=>WorldModel;body:(id:string)=>{pose:{p:number[]};human?:{hands?:{left?:number[];right?:number[]};handActuator?:import('../../../../mars/viewer/engine/social/hand-actuator.ts').HandActuatorMotion}}|undefined;access:(id:string,soul:EdgeSoul)=>{code:string;reason:string}|null;
 /** entry 32: the thing's owner (a name) and whether it is this Soul; null when nobody owns it */ owner?:(id:string,soul:EdgeSoul)=>{name:string;mine:boolean}|null;
 /** entry 32: a knock on the leaf landed (the first rap): tell those who hear it */ knock?:(soul:EdgeSoul,id:string)=>void;
 /** Entry 43: compact facts of things that are not contact actuators (a kettle, a cup of tea), or null. */ moreFacts?:(id:string)=>Record<string,unknown>|null;
 record:(soul:EdgeSoul,id:string,action:string,params?:Record<string,unknown>)=>void;commit:(ops:Op[],note:string,done:()=>void)=>{accepted:boolean}}){
 const binding=(id:string)=>{const m=d.model(),e=m.entities.get(id);return e?createHash('sha256').update(JSON.stringify([e,m.worldPose(e),m.resolvedDef(e.def)?.hash])).digest('hex'):null;};
 return {
  /** `from`/`open` (entry 31's door passage): plan as if the body stood at `from` and the door were already open/shut. */
  plan(soul:EdgeSoul,target:string,action:string,input:Record<string,unknown>={},opts?:{from?:[number,number];open?:boolean}){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),body=d.body(soul.entityId);if(!e||!def||!body)return null;
   const wp=m.worldPose(e),me=opts?.from?[opts.from[0],body.pose.p[1],opts.from[1]]:body.pose.p,at:[number,number,number]=[wp.x,wp.y+1.04*wp.s,wp.z];
   const params:Omit<HandActuatorParams,'actor'>={target,at};let root:[number,number,number],face:[number,number]|undefined,faceTo:[number,number]|undefined;
   if(contactStateKey(def,action)==='text'){
    // Stand square in front of the board's face; the hand works across the face from its centre.
    const face=(def.make.kind==='gen'?(def.make.args as {faces?:{at?:number[];w?:number;h?:number}[]})?.faces?.[0]:undefined);if(!face?.at)return null;
    const c=Math.cos(wp.yaw),s=Math.sin(wp.yaw),[fx,fy,fz]=face.at.map(v=>v*wp.s),centre:[number,number,number]=[wp.x+fx*c+fz*s,wp.y+fy,wp.z-fx*s+fz*c];
    const text=typeof input.text==='string'?input.text.trim():'',lines=action==='write'?Math.min(3,Math.max(text.split('\n').length,Math.ceil(text.length/34),1)):1,pin=action==='pin'||action==='unpin',list=['sign','unsign','vote'].includes(action);
    // Work across the upper part of the face, near shoulder height, not at the hip.
    const lift=Math.min(.12,(face.h??.4)*wp.s*.2);params.at=[centre[0]+s*.04,centre[1]+lift,centre[2]+c*.04];
    // A pinned note goes to (or comes down from) its own place on the cork, the slot the viewer draws it in.
    // Entry 25: a sign-up name goes on the sheet's next line (or comes off its own); a vote is a tally mark beside the option.
    if(list){const st=actuatedState(e,def),names=pinNotes(st),i=action==='vote'?Math.max(0,pollChoice(st,input.choice)):action==='sign'?names.length:Math.max(0,names.map(n=>n.by).indexOf(soul.soulId)),[dx,dy]=(action==='vote'?pollSlot(i):signupSlot(i)).map(v=>v*wp.s);params.at=[centre[0]+dx*c+s*.04,centre[1]+dy,centre[2]-dx*s+c*.04];}
    if(pin){const notes=pinNotes(actuatedState(e,def)),i=action==='pin'?notes.length:notes.map(n=>n.by).lastIndexOf(soul.soulId),[dx,dy]=pinSlot(Math.max(0,i)).map(v=>v*wp.s);params.at=[centre[0]+dx*c+s*.04,centre[1]+dy,centre[2]-dx*s+c*.04];}
    // Entry 38: a poster goes up at (or comes down from) its slot with both hands; a wanted/offered note at its column and row,
    // a reply on the note's lower half, "taken by" across the note.
    const posters=!!def.tags?.includes('posters'),wanted=!!def.tags?.includes('wanted');
    const local=(dx:number,dy:number,out:number):[number,number,number]=>[centre[0]+dx*wp.s*c+s*out,centre[1]+dy*wp.s,centre[2]-dx*wp.s*s+c*out];
    let sheet:{title:string;detail:string;name:string;paper:number;age?:number}|undefined;
    if(posters){const st=actuatedState(e,def),list=posterList(st),p=action==='pin'?null:posterTarget(st,soul,input.which),slot=action==='pin'?Math.max(0,posterFreeSlot(list)):(p?.s??0),[dx,dy]=posterSlot(slot);
     params.at=local(dx,dy,.004);
     const title=action==='pin'?String(input.title??'').trim():p?.t??'',detail=action==='pin'?String(input.detail??'').trim():p?.d??'';
     sheet={title:title.slice(0,40),detail:detail.slice(0,80),name:(action==='pin'?posterName(soul):p?.n??'').slice(0,40),paper:posterPaper(title,action==='pin'?posterName(soul):p?.n??''),...(p?{age:Math.min(99,posterAge(p))}:{})};}
    if(wanted){const st=actuatedState(e,def),list=wantedList(st);let col=0,row=0,dx=0,dy=0;
     if(action==='pin'){const k=wantedColumn(input)??'w';col=k==='o'?1:0;row=Math.max(0,wantedFreeRow(list,k));}
     else{const n=wantedTarget(st,soul,input.note,action==='unpin'?'own':'any');col=n?.c==='o'?1:0;row=n?.r??0;if(action==='reply'){dx=.06;dy=-.075-.03*(n?.re.length??0);}if(action==='take-on'){dx=.1;dy=-.01;}}
     const [sx,sy]=wantedSlot(col,row);params.at=local(sx+dx,sy+dy,.04);}
    // Stand clear of the board's own footprint (its depth beyond the face) with a body radius to spare.
    const stand=Math.min(.7,Math.max(STROKE_STAND,(def.size.box[2]/2-(face.at[2]??0))*wp.s+HUMAN_RADIUS+.06-.04));
    // Entry 27: a noughts-and-crosses mark goes to its own square (gameSquare, shared with the viewer's face)
    const mark=action==='mark'&&def.tags.includes('tictactoe')?gameSquareOf(input.square):-1;
    if(mark>=0){const [dx,dy]=gameSquare(mark).map(v=>v*wp.s);params.at=[centre[0]+dx*c+s*.04,centre[1]+dy,centre[2]-dx*s+c*.04];}
    if(mark>=0)params.stroke={kind:'write',yaw:wp.yaw,stand,width:.1,height:.08,lines:1,seconds:1.2};
    else if(posters)params.stroke={kind:action==='unpin'?'unposter':'poster',yaw:wp.yaw,stand:Math.max(.4,stand),width:POSTER_W*wp.s,height:POSTER_H*wp.s,lines:1,seconds:action==='unpin'?4.2:5.6,release:1.1,handoff:.1,lead:{y:wp.y+1.05,out:.2},...(sheet?{sheet}:{})};
    else if(wanted)params.stroke={kind:action==='unpin'?'wipe':'write',yaw:wp.yaw,stand,width:action==='take-on'?.14:action==='reply'?.16:.22,height:.05,lines:1,seconds:action==='unpin'||action==='take-on'?1.8:2.2,release:1.1,handoff:.1,lead:{y:wp.y+1.1,out:.26}};
    else params.stroke=list?{kind:action==='unsign'?'wipe':'write',yaw:wp.yaw,stand,width:action==='vote'?.1:Math.min(.16,(face.w??.4)*wp.s*.45),height:.05,lines:1,seconds:action==='unsign'?1.0:1.4}:pin?{kind:action==='unpin'?'wipe':'write',yaw:wp.yaw,stand,width:Math.min(.22,(face.w??.6)*wp.s*.25),height:.06,lines:1,seconds:action==='unpin'?1.2:1.6}:{kind:action==='erase'?'wipe':'write',yaw:wp.yaw,stand,width:Math.min(.55,(face.w??.6)*wp.s*.6),height:Math.min(.3,(face.h??.4)*wp.s*.5),lines,seconds:action==='erase'?2.4:Math.min(6,1.2+1.6*lines)};   // 1.2+1.6*3 is 6.000000000000001 in floating point; the schema caps a stroke at 6 s (a three-line note failed)
    root=strokeRoot(params.at,params.stroke,wp.y);
    // Entry 38 (take 2): a Soul arriving along the wall turned to it during the reach and swung an arm out wide; posters and
    // wanted/offered notes turn to face the board on arrival first (entry 33's turn-then-reach), then the hands come up
    if(posters||wanted)faceTo=[params.at[0],params.at[2]];
   }else if(def.tags.includes('hand-drawer')){
    // a drawer slides straight out of the front (+z): the hand takes its knob, the body stands half a metre in front
    const shapes=def.make.kind==='gen'?(def.make.args as {shapes?:{role?:string;at?:number[];tint?:string}[]})?.shapes:undefined,knob=shapes?.find(s=>s.role==='drawer'&&s.tint==='brass'&&s.at);if(!knob?.at)return null;
    const c=Math.cos(wp.yaw),s=Math.sin(wp.yaw),[kx,ky,kz]=knob.at.map(v=>v*wp.s),travel=DRAWER_TRAVEL*wp.s;
    params.slide={at:[wp.x+kx*c+kz*s,wp.y+ky,wp.z-kx*s+kz*c],dir:[s,c],travel,from:actuatedState(e,def).open===true?travel:0,to:action==='open'?travel:0,floorY:wp.y};
    root=slidePoint(params.slide,params.slide.from).root;
    // entry 42 (take 2): arriving from the side (from a table, carrying a bowl) left the body 56° off the chest, and the
    // pull's own turn ran during the reach (0.105 m per 50 ms): turn to the knob on arrival first, as M04 does for valves
    face=[params.slide.at[0],params.slide.at[2]];
    // a storage drawer's knob is reached deliberately (0.9 s): the 0.65 s reach peaked at 0.087 m per 50 ms (take 3)
    // and the arm comes back down over 1 s (0.7 s lowered it at 0.082 m per 50 ms while the other hand carried, take 5)
    if(containerInside(def)){params.reach=.9;params.release=1;}
   }else if(def.components.opening||def.tags.includes('hand-cabinet')){
    const shapes=def.make.kind==='gen'?(def.make.args as {shapes?:{role?:string;pivot?:number[];at?:number[];size?:number[];tint?:string}[]})?.shapes:undefined;
    const leaf=shapes?.find(s=>s.role==='door'&&s.pivot),knob=shapes?.find(s=>s.role==='door'&&['brass','chrome'].includes(s.tint??''));if(!leaf?.pivot)return null;
    const number=(key:string)=>Number(e.params?.[key]??def.params[key]?.default??1),sx=wp.s*number('sx'),sy=wp.s*number('sy');
    const hx=leaf.pivot[0]*sx,hz=(leaf.pivot[2]??0)*wp.s,c=Math.cos(wp.yaw),s=Math.sin(wp.yaw);
    const localZ=(me[0]-wp.x)*s+(me[2]-wp.z)*c;
    if(LOCK_OPS.has(action)&&def.tags.includes('lockable'))params.op=action as 'lock'|'unlock'|'knock';
    params.opening={bodyPolicy:'door-natural-v2',...(def.tags.includes('wall-window')?{floorY:me[1]}:{}),hinge:[wp.x+hx*c+hz*s,wp.y,wp.z-hx*s+hz*c],yaw:wp.yaw,radius:((knob?.at?.[0]??(Number(def.components.opening?.width??leaf.size?.[0]??.8)/2-.1))-leaf.pivot[0])*sx,height:Number(def.components.opening?.height??leaf.size?.[1]??1.8)*sy,handleY:(knob?.at?.[1]??.85)*sy,from:(opts?.open??actuatedState(e,def).open===true)?HAND_OPEN_ANGLE:0,to:action==='open'?HAND_OPEN_ANGLE:0,side:def.tags.some(t=>['wall-window','hand-cabinet'].includes(t))?1:localZ<0?-1:1};
    if(def.tags.includes('wall-window')&&(wp.y+params.opening.handleY-me[1]>1.65||wp.y+params.opening.handleY-me[1]<.35))return null;
    root=actuatorPoint(params.opening,params.opening.from).root;
   }else if(def.components.bell&&def.tags.includes('hand-rung')){
    const [x,y,z]=def.components.bell.gripAt,stretch=(key:string)=>Number(e.params?.[key]??def.params[key]?.default??1),sx=wp.s*stretch('sx'),sy=wp.s*stretch('sy'),sz=wp.s*stretch('sz'),c=Math.cos(wp.yaw),s=Math.sin(wp.yaw);
    at[0]=wp.x+x*sx*c+z*sz*s;at[1]=wp.y+y*sy;at[2]=wp.z-x*sx*s+z*sz*c;params.tug={length:.45*sy,angle:def.components.bell.pullAngle,yaw:wp.yaw,seconds:.6};
    root=[at[0]+s*.55,m.terrain.sample(at[0]+s*.55,at[2]+c*.55),at[2]+c*.55];
   }else if(def.tags.includes('hand-powered-display')&&def.components.display?.controlAt){
    const [x,y,z]=def.components.display.controlAt,c=Math.cos(wp.yaw),s=Math.sin(wp.yaw);
    at[0]=wp.x+(x*c+z*s)*wp.s;at[1]=wp.y+y*wp.s;at[2]=wp.z+(-x*s+z*c)*wp.s;
    // Stand on the ground in front of the control, including mounted displays.
    root=[at[0]+s*.55,me[1],at[2]+c*.55];
    if((d.levelAt?.(me[0],me[2],me[1])??0)===0)root[1]=m.terrain.sample(root[0],root[2]);
   }else{
    // A def's part tinted `valve` (a tap handle) is where the hand goes; otherwise the old switch height at the centre.
    // Entry 37: a radio's tuning knob (tinted `tuner`) is where the hand goes to change the station; she stands where she
    // works the power knob (the `valve`), so both knobs are worked from one place, and holds the tuning knob while it turns.
    const shapes=def.make.kind==='gen'?(def.make.args as {shapes?:{tint?:string;at?:number[]}[]})?.shapes:undefined,valve=shapes?.find(s=>s.tint==='valve'&&s.at);
    const part=action==='change-station'?shapes?.find(s=>s.tint==='tuner'&&s.at)??valve:valve;
    // #427: a stretched def (sx, sy, sz, as the viewer draws it) has its valve and its footprint stretched with it
    const stretch=(key:string)=>Number(e.params?.[key]??def.params[key]?.default??1),[sx,sy,sz]=[stretch('sx'),stretch('sy'),stretch('sz')];
    const placeOf=(at:number[]):[number,number,number]=>{const c=Math.cos(wp.yaw),s=Math.sin(wp.yaw),[vx,vy,vz]=[at[0]*sx,at[1]*sy,at[2]*sz].map(v=>v*wp.s);return [wp.x+vx*c+vz*s,wp.y+vy,wp.z-vx*s+vz*c];};
    if(valve?.at)params.at=placeOf(valve.at);
    if(part&&part!==valve&&part.at)params.hold=TUNE_HOLD_SECONDS;
    const dx=me[0]-params.at[0],dz=me[2]-params.at[2],n=Math.hypot(dx,dz)||1;root=[params.at[0]+dx/n*.5,wp.y,params.at[2]+dz/n*.5];
    if(valve?.at){
     // Stand beside the valve, clear of the thing's own footprint (a basin, a tray) by a body radius: of eight
     // directions around the valve, the one nearest the Soul's approach whose stand point is outside. Entry 33: and clear
     // of the world's other obstacles (a wall behind a wall torch), so the body never walks into one to reach a valve.
     const c=Math.cos(wp.yaw),s=Math.sin(wp.yaw),[hx,,hz]=[def.size.box[0]*sx,0,def.size.box[2]*sz].map(v=>v*wp.s/2),outside=(p:number[])=>{const lx=(p[0]-wp.x)*c-(p[2]-wp.z)*s,lz=(p[0]-wp.x)*s+(p[2]-wp.z)*c;return Math.abs(lx)>hx+HUMAN_RADIUS||Math.abs(lz)>hz+HUMAN_RADIUS;};
     // #427: a pivoted leaf worked at a valve (a tent's flap at its toggle) swings clear of the body: no stand point within
     // the leaf's reach of its pivot, plus a body radius
     const leaf=(shapes as {role?:string;pivot?:number[];at?:number[];size?:number[]}[]|undefined)?.filter(q=>q.role==='door'&&q.pivot&&q.at),pivot=leaf?.[0]?.pivot;
     const swing=pivot?Math.max(...leaf!.map(q=>Math.hypot((q.at![0]-pivot[0])*sx,(q.at![2]-pivot[2])*sz)+(q.size?.[0]??0)*sx/2))*wp.s+HUMAN_RADIUS:0;
     const swingClear=(p:number[])=>{if(!pivot)return true;const lx=(p[0]-wp.x)*c-(p[2]-wp.z)*s,lz=(p[0]-wp.x)*s+(p[2]-wp.z)*c;return Math.hypot(lx-pivot[0]*sx*wp.s,lz-pivot[2]*sz*wp.s)>=swing;};
     const clear=(p:number[])=>!d.clearance||d.clearance(p[0],p[2],d.levelAt?.(p[0],p[2],wp.y)??0)>=HUMAN_RADIUS+.04;
     const want=Math.atan2(dz,dx),ring=(r:number)=>Array.from({length:8},(_,i)=>i*Math.PI/4).map(a=>[params.at[0]+Math.cos(a)*r,wp.y,params.at[2]+Math.sin(a)*r,Math.abs(((a-want+Math.PI*3)%(Math.PI*2))-Math.PI)]).filter(outside).filter(clear).filter(swingClear).sort((p,q)=>p[3]-q[3])[0];
     // #427: beside a pivoted leaf, a step further out when the near ring is all in the sweep or against the thing
     const best=ring(.55)??(pivot?ring(.7):undefined);
     if(best)root=[best[0],best[1],best[2]];
     // Entry 37: a panel of knobs (a def with a tuning knob as well as the power knob) is worked from straight in front of
     // the panel, centred between the knobs, from wherever the Soul comes: never from the side or a diagonal, and never a
     // shuffle between the two knobs. 0.45 m out (take 2: at 0.55 m the reach out of folded arms peaked at 0.087 m/50 ms):
     // elbows bent at a radio, the hands' travel shorter.
     const tuner=shapes?.find(s=>s.tint==='tuner'&&s.at);
     // Take 3: out of an idle gesture with the hand at the head, the 0.65 s reach to a knob 0.5 m lower drew the hand at
     // 0.108 m/50 ms mid-reach; a small knob is reached deliberately, over PANEL_REACH (contact at its end).
     if(tuner?.at&&valve.at){const mid=placeOf(valve.at.map((v,i)=>(v+tuner.at![i])/2));root=[mid[0]+s*PANEL_STAND,wp.y,mid[2]+c*PANEL_STAND];params.reach=PANEL_REACH_SECONDS;}
     // Entry 33 (take 4): a stand point beside the valve can leave the body ~40° off the valve when it arrives (a wall
     // torch approached along its wall); the Soul turns to face the valve on arrival, before the arm comes up, so the
     // reach is never added to a body turn (the hand actuator's own turn is then ~0).
     if(part?.at)params.at=placeOf(part.at);
     face=[params.at[0],params.at[2]];
    }}
   // entry 32: after knocking, step back beside the door (latch side, out of its swing and of the way through) to wait
   // entry 42: a body carrying something in the hand this would use operates with the other, free hand
   const busy=body.human?.hands,usual=actuatorHand(params.opening),other=usual==='left'?'right':'left';
   if(busy&&(busy.left||busy.right)&&!body.human?.handActuator&&!(busy[usual]&&busy[other]))params.hand=busy[usual]?other:usual;
   const o=params.opening,after:[number,number]|undefined=params.op==='knock'&&o?[+(wp.x+Math.cos(wp.yaw)*1.35+Math.sin(wp.yaw)*o.side*1.3).toFixed(3),+(wp.z-Math.sin(wp.yaw)*1.35+Math.cos(wp.yaw)*o.side*1.3).toFixed(3)]:undefined;
   return {params,root,level:d.levelAt?.(root[0],root[2],root[1])??0,...(face?{face}:faceTo?{face:faceTo}:{}),...(after?{after}:{})};
  },
  /** What a Soul reads when it completes `read:<sign>` (never in ambient perception for Soul-written boards). */
  sign(target:string){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),sign=def?.components.sign as {lines?:string[]}|undefined;if(!e||!def||!sign)return null;
   const text=typeof e.state?.text==='string'&&e.state.text.trim()?e.state.text:(sign.lines??[]).join('\n');
   // Entry 27: a game board reads as its players, its state and the grid (world facts: the moves are the world's)
   if(def.tags?.includes('tictactoe')){const g=String(e.state?.text??'').padEnd(9,'.').slice(0,9),st=gameStatus(g),names=String(e.state?.players??'').split(',').filter(Boolean),who=(m:'X'|'O')=>names[m==='X'?0:1]??m;
    const head=names.length?`Noughts and crosses: ${who('X')} (X)${names[1]?` against ${names[1]} (O)`:''}; ${st.winner?`${who(st.winner)} won`:st.draw?'a draw':`${who(st.turn)} to play`}`:'Noughts and crosses: a new game, X to play';
    return {id:e.id,name:e.name??def.name.replace(/^core-/,''),text:[head,...[0,1,2].map(r=>[...g.slice(r*3,r*3+3)].map(ch=>ch==='.'?'·':ch).join(' '))].join('\n'),by:null,writable:true};}
   return {id:e.id,name:e.name??def.name.replace(/^core-/,''),text,...(def.tags?.includes('pinboard')?{notes:pinNotes(e.state??{})}:{}),...(def.tags?.includes('signup')?{title:String(e.state?.title??''),text:[String(e.state?.title??'Sign up'),...pinNotes(e.state??{}).map((n,i)=>`${i+1}. ${n.text}`)].join('\n')}:{}),...(def.tags?.includes('poll')?{title:String(e.state?.title??''),text:[String(e.state?.title??''),pollLines(e.state??{})].join('\n')}:{}),...(def.tags?.includes('posters')?{posters:posterList(e.state??{}).map(p=>({...p,age:posterAge(p),stale:posterStale(p)}))}:{}),...(def.tags?.includes('wanted')?{wanted:wantedList(e.state??{})}:{}),by:typeof e.state?.textBy==='string'&&e.state.textBy&&!def.tags?.some(t=>t==='poll'||t==='signup'||t==='posters'||t==='wanted')?e.state.textBy:null,writable:!!def.tags?.includes('hand-writable')};
  },
  /** Entry 32: who may lock, unlock and knock on a lockable door. Its owner locks and unlocks it (key outside, thumb-turn
   *  inside); a door nobody owns locks for anyone. Knocking is for the outside (the front) of a closed door. A non-owner
   *  inside never needs `unlock`: a walk out turns the thumb-turn on the way (door-passage.ts). */
  policy(soul:EdgeSoul,target:string,action:string):Refusal|null{
   if(!LOCK_OPS.has(action))return null;
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def);if(!e||!def?.tags.includes('lockable'))return null;
   const name=e.name??'the door',side=this.side(soul,target);
   if(action==='knock')return side==='inside'?{code:'door.inside',reason:`You are inside ${name}; knocking is for someone outside it.`}:null;
   const own=d.owner?.(target,soul);
   if(own&&!own.mine)return {code:'door.not-yours',reason:`Only ${own.name} can ${action} ${name}; it is ${own.name}'s.${action==='unlock'&&side==='inside'?' From inside you can always just walk out: the thumb-turn opens as you go.':''}`};
   return null;
  },
  /** Which side of a door this Soul's body is on: the back (local -z) is the inside. */
  side(soul:EdgeSoul,target:string):'inside'|'outside'|null{
   const m=d.model(),e=m.entities.get(target),b=d.body(soul.entityId);if(!e||!b)return null;
   const p=m.worldPose(e);return (b.pose.p[0]-p.x)*Math.sin(p.yaw)+(b.pose.p[2]-p.z)*Math.cos(p.yaw)<0?'inside':'outside';
  },
  /** A few current public facts for compact nearby perception, never the full state. */
  facts(target:string){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),key=def&&contactStateKey(def);
   // Entry 18: a thirsty planter says so (only when dry; a watered garden adds nothing)
   if(e&&def&&!key&&(def.state as Record<string,{type?:string}>).moisture?.type==='number'){
    const st=def.state as Record<string,{type?:string;default?:unknown}>,dry=isDry(e.state?.moisture??st.moisture?.default);
    // Entry 34: a growing planter says its stage in a word (and dry only when dry)
    const stage=st.growth?.type==='number'?stageWord(e.state?.growth??st.growth.default):null;
    return stage?{stage,...(dry?{dry:true}:{})}:dry?{dry:true}:null;}
   if(e&&def&&!key)return d.moreFacts?.(target)??null;
   if(!e||!def||!key)return null;const state=actuatedState(e,def),facts:Record<string,boolean|string|string[]>={};
   if(typeof state[key]==='boolean')facts[key]=state[key] as boolean;
   if(key==='open'&&typeof state.locked==='boolean')facts.locked=state.locked;
   // Entry 37: a radio that is on says which station it plays ("radio: on, quiet piano"); off, only that it is off.
   if(state.on===true&&typeof state.station==='string')facts.station=state.station;
   // entry 42: what is inside an open container (names only, at most its few places); nothing while it is shut
   const ins=state.open===true?containerInside(def):null;
   if(ins){const slots=new Set(ins.slots.map(s=>s.id)),holds:string[]=[];for(const c of m.children.get(target)??[]){const x=m.entities.get(c);if(x&&slots.has(x.in.slot??''))holds.push(x.name??(m.resolvedDef(x.def)?.name.replace(/^core-/,'')??'something'));}if(holds.length)facts.holds=holds.sort();}
   return facts;
  },
  /** Entry 33: a neon sign's words for a Soul near it (the same nearby rule as `facts`): its owner's text, at most 32
   *  characters on two lines, control characters removed, with the owner ref that set it. Untrusted text. */
  words(target:string){
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def);if(!e||!def||!def.tags.includes('neon'))return null;
   const raw=typeof e.state?.text==='string'?e.state.text:(def.state as Record<string,{default?:unknown}>|undefined)?.text?.default;
   const text=typeof raw==='string'?raw.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g,'').split('\n').map(l=>l.trim()).filter(Boolean).slice(0,2).join(' / ').slice(0,NEON_WORDS):'';
   return text?{text,owner:e.owner??'god'}:null;
  },
  prepare(soul:EdgeSoul,target:string,action:string,input:Record<string,unknown>={}):ContactActuatorIntent|null{
   const m=d.model(),e=m.entities.get(target),def=e&&m.resolvedDef(e.def),a=def&&actionsOf(def).find(a=>a.name===action);
   if(!def||!a||!isContactActuator(def,a))return null;
   // Only the action's declared string params travel with the bound intent (board text, already validated at admission).
   const params=Object.fromEntries(Object.keys(a.params??{}).filter(k=>typeof input[k]==='string').map(k=>[k,(input[k] as string).trim()]));
   return {target,action,actor:soul.entityId,owner:soul.owner,binding:binding(target)!,motionV1:true,...(Object.keys(params).length?{params}:{})};
  },
  complete(soul:EdgeSoul,intent:ContactActuatorIntent,done:()=>void){
   if(intent.actor!==soul.entityId||intent.owner!==soul.owner)return fail('contact.identity-changed','The original Soul/body binding changed.');
   const m=d.model(),e=m.entities.get(intent.target),def=e&&m.resolvedDef(e.def),a=def&&actionsOf(def).find(a=>a.name===intent.action);
   if(!e||!def||!a||binding(intent.target)!==intent.binding)return fail('contact.target-changed','The target changed during the approach; no action was applied.');
   const denied=d.access(intent.target,soul);if(denied)return fail(denied.code,denied.reason);
   const b=d.body(soul.entityId),p=m.worldPose(e),motion=b?.human?.handActuator;
   const hand=motion?.hand?b?.human?.hands?.[motion.hand]:twoHanded(motion?.stroke)?b?.human?.hands?.right:b?.human?.hands?.left??b?.human?.hands?.right;
   const expected=motion?.opening&&motion.op?opPoint(motion.opening,motion.op,0):motion?.opening?actuatorPoint(motion.opening,intent.action==='close'?motion.opening.to:motion.opening.from).hand:motion?.slide?slidePoint(motion.slide,intent.action==='close'?motion.slide.to:motion.slide.from).hand:motion?.stroke?strokePoint(motion.at,motion.stroke,1):motion?.tug?tugPoint(motion.at,motion.tug,1):motion?.at;
   const reached=intent.motionV1?!!motion&&motion.target===intent.target&&!!hand&&!!expected&&Math.hypot(...hand.map((v,i)=>v-expected[i]))<.1&&Math.hypot(b!.pose.p[0]-hand[0],b!.pose.p[2]-hand[2])<.9&&Math.abs(b!.pose.p[1]-p.y)<1.2:!!b&&Math.hypot(b.pose.p[0]-p.x,b.pose.p[2]-p.z)<=CONTACT_REACH&&Math.abs(b.pose.p[1]-p.y)<=1.2;if(!b?.human||!reached)return fail('contact.not-reached','Your hand did not reach the target; no action was applied.');
   const state=actuatedState(e,def);
   // entry 32: a walk's thumb-turn on a door somebody unlocked meanwhile has nothing left to do
   if(intent.passage&&a.name==='unlock'&&state.locked!==true){done();return {ok:true as const};}
   const bad=whenRefusal(a,state,e.name??'object');if(bad)return fail(bad.code,bad.reason);
   // entry 32: a knock changes nothing in the world; those who hear it are told once
   if(a.name==='knock'&&def.tags.includes('lockable')){d.knock?.(soul,e.id);d.record(soul,e.id,a.name);done();return {ok:true as const};}
   const text=isGameAction(def,a)?gameProblem(a,state,soul,a.name==='mark'?intent.params?.square??'':undefined):isListAction(def,a)?listProblem(def,a,state,soul,intent.params??{}):contactStateKey(def,a.name)==='text'&&a.name==='write'?boardTextProblem(intent.params?.text):null;if(text)return fail(text.code,text.reason);
   const patch=isGameAction(def,a)?gamePatch(a,state,soul,intent.params?.square):actionPatch(def,a,state,intent.params??{},soul);if(contactStateKey(def,a.name)==='text'&&a.name==='write')patch.textBy=soul.soulId;
   // entry 32: a passage's close re-locks the latch
   if(intent.relock&&a.name==='close'&&typeof state.locked==='boolean')patch.locked=true;
   // A sprinkler coming on soaks the planters (things with numeric moisture) in its forward arc within reach, in the same commit:
   // one pass over the world at this event, never per tick.
   const soak:Op[]=[];
   if(def.tags?.includes('sprinkler')&&a.name==='switch-on'){const reach=Number(e.params?.reach??(def.params.reach as {default?:number}|undefined)?.default??3.5);
    for(const o of m.entities.values()){const od=o.id!==e.id&&m.resolvedDef(o.def);if(!od||(od.state as Record<string,{type?:string}>).moisture?.type!=='number')continue;const op=m.worldPose(o);const fx=Math.sin(p.yaw),fz=Math.cos(p.yaw);if(Math.hypot(op.x-p.x,op.z-p.z)<=reach&&(op.x-p.x)*fx+(op.z-p.z)*fz>0&&o.state?.moisture!==1)soak.push(opSchema.parse({op:'set',id:o.id,state:{moisture:1}}));}}
   const r=d.commit([opSchema.parse({op:'set',id:e.id,state:patch}),...soak],`${soul.soulId} ${a.name} ${e.name??e.id}`,()=>{
    // entry 32: a guest's thumb-turn on the way out is part of the walk, not an `unlock` of theirs (that is the owner's)
    if(!(intent.passage&&a.name==='unlock'))d.record(soul,e.id,a.name,intent.params??{});done();});
   return r.accepted?{ok:true as const}:fail('contact.commit-refused','The world refused the interaction.');
  }
 };
}
export type ContactActuatorService=ReturnType<typeof createContactActuatorService>;
