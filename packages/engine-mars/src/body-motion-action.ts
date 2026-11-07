import {z} from 'zod';
import type {ActionDef,Diagnostic} from '../../../mars/viewer/engine/actions/types.ts';
import {hasDeclaredProfile} from '../../../mars/viewer/engine/bodies/action-profile.ts';
import {hasBodyDance,MOTION_LIMITS,type BodyMotionState} from '../../../mars/viewer/engine/bodies/motion.ts';
import {DT,type Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import type {Spatial} from '../../../mars/viewer/engine/spatial/service.ts';

const schema=z.strictObject({actor:z.string().min(1).max(80),motion:z.enum(['dance','rest']),seconds:z.number().finite().min(1).max(600)});
type Params=z.infer<typeof schema>;
type Exec={id:string;p:Params;since:number;until:number};
const issue=(message:string,actor:string):Diagnostic=>({code:'body.motion-unavailable',message,subjects:[actor]});
function problem(rt:Runtime,p:Params):Diagnostic|null {
 const e=rt.world.entities[p.actor],h=e?.human;
 if(!h||!(p.motion==='rest'?hasDeclaredProfile(e.body):hasBodyDance(e.body)))return issue('This body has no admitted adapter for the requested motion.',p.actor);
 if(h.task||h.grip||h.holding||h.prop||(h.hands&&Object.keys(h.hands).length>0)||Object.values(rt.world.entities).some(e=>e.support?.kind==='in-hand'&&e.support.by===p.actor)||h.on||h.riding||h.carrier||h.boatPassenger||h.shore||h.sleepPose||h.partner||h.together||!['idle','wait','rest'].includes(h.activity))return issue('Finish safely standing with free hands before this motion.',p.actor);
 const sp=rt.services.spatial as Spatial|undefined;if(!sp)return issue('This world cannot validate standing support.',p.actor);
 sp.sync(rt.world);const at:[number,number]=[e.pose.p[0],e.pose.p[2]],read=sp.clearanceReader(h.level,at);
 if(!read||read(at)<(e.body?.radius??.35))return issue('There is not enough supported standing room for this body.',p.actor);
 return null;
}
const smooth=(x:number)=>{const v=Math.max(0,Math.min(1,x));return v*v*(3-2*v);};
/** One authoritative stationary action. It never writes root pose, hands or object custody. */
export const bodyMotionAction:ActionDef<Params,true,Exec>={
 verb:'body_motion_v1',resumable:true,navPure:true,drivesReservedHands:false,
 description:'Run an admitted stationary dance or upright-rest adapter, with supported ground and free hands.',schema,
 reservations:(_w,p)=>[{resource:'actor:'+p.actor,mode:'exclusive'},{resource:'pose:'+p.actor,mode:'exclusive'}],
 plan(rt,p){const d=problem(rt,p);return d?{ok:false,diagnostic:d}:{ok:true,program:true};},
 start(rt,p,_plan,id){const since=rt.tick,until=since+Math.round(p.seconds/DT);const h=rt.world.entities[p.actor].human!;h.bodyMotionV1={since,until};h.task=id;h.activity=p.motion;return{id,p:structuredClone(p),since,until};},
 step(rt,ex){const h=rt.world.entities[ex.p.actor]?.human;if(!h)return{status:'failed',diagnostic:issue('The body is gone.',ex.p.actor)};
  if(rt.tick<ex.until)return{status:'running',phase:ex.p.motion==='rest'?'standby':'dancing'};
  if(h.task===ex.id){delete h.task;h.activity='idle';}return{status:'completed'};},
 cancel(rt,ex){const h=rt.world.entities[ex.p.actor]?.human;if(h?.task===ex.id){
  const fade=MOTION_LIMITS.fadeSeconds/DT,weight=Math.min(smooth((rt.tick-ex.since)/fade),smooth((ex.until-rt.tick)/fade));
  h.bodyMotionV1={since:ex.since,until:rt.tick+Math.ceil(fade),release:{at:rt.tick,weight}} satisfies BodyMotionState;
  delete h.task;h.activity='idle';
 }return{ok:true};},
};
