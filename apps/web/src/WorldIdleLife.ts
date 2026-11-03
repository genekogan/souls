import * as THREE from 'three';
import {turn,UP} from '../../../mars/viewer/app/engine-view/rig.ts';
/** Idle life for Souls: render-time additive bone motion so bodies never look
 * frozen. Breathing (torso pitch), slow weight shifts (hips roll), heads that
 * turn toward the nearest Soul nearby, and nods/torso sway while speaking.
 * Applied after the rig has posed the body and undone right after render, so
 * replay, recorded poses and simulation are never changed. */
export type IdleSoul={id:string;root:THREE.Object3D|null;p:readonly [number,number,number];yaw:number;activity:string;speaking:boolean;attention?:readonly string[];
  /** PERF-PASSES: the body is wholly outside the view this frame: its own offsets are skipped (nobody sees them); it still
   *  counts as a neighbour others look at. */
  offscreen?:boolean};
type Bones={head?:THREE.Object3D;torso?:THREE.Object3D;hips?:THREE.Object3D;abdomen?:THREE.Object3D};
const RIGID=/walk|run|swim|tread|wade|sleep|lie|prone|climb|carry|ride|dance/;
/** Hash a Soul id to a stable phase in [0,1). */
export const phaseOf=(id:string)=>{let h=2166136261;for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0)/4294967296;};
/** Relative head yaw (radians, engine convention: yaw 0 faces +X) toward the nearest Soul within `range`, clamped. */
export function lookTarget(self:IdleSoul,others:readonly IdleSoul[],range=6,limit=1.05):number{
 let best=Infinity,ang=0;
 for(const o of others){if(o.id===self.id||self.attention?.length&&!self.attention.includes(o.id))continue;const dx=o.p[0]-self.p[0],dz=o.p[2]-self.p[2],d=Math.hypot(dx,dz);if(d<.4||d>range||d>=best)continue;
  let a=Math.atan2(dz,dx)-self.yaw;a=Math.atan2(Math.sin(a),Math.cos(a));if(Math.abs(a)>limit+.6)continue;best=d;ang=Math.max(-limit,Math.min(limit,a));}
 return ang;
}
export class WorldIdleLife{
 private bones=new WeakMap<THREE.Object3D,Bones>();
 private look=new Map<string,number>();
 private bodyLook=new Map<string,number>();
 private saved:{o:THREE.Object3D;q:THREE.Quaternion}[]=[];
 private axis=new THREE.Vector3();
 private find(root:THREE.Object3D):Bones{let b=this.bones.get(root);if(b)return b;b={};
  root.traverse(o=>{if(!(o as THREE.Bone).isBone)return;if(o.name==='Head'&&!b!.head)b!.head=o;else if(o.name==='Torso'&&!b!.torso)b!.torso=o;else if(o.name==='Hips'&&!b!.hips)b!.hips=o;else if(o.name==='Abdomen'&&!b!.abdomen)b!.abdomen=o;});
  this.bones.set(root,b);return b;}
 private keep(o:THREE.Object3D){this.saved.push({o,q:o.quaternion.clone()});}
 /** Call once per frame after people are posed and before renderer.render. */
 apply(souls:readonly IdleSoul[],seconds:number,dt:number,reducedMotion=false){
  const k=1-Math.exp(-3*Math.max(0,Math.min(.1,dt)));
  for(const s of souls){if(!s.root||s.offscreen)continue;const b=this.find(s.root),ph=phaseOf(s.id),rigid=RIGID.test(s.activity),amp=reducedMotion?.4:1;
   // Breathing: everyone, always (gentle torso pitch, ~4.5 s, per-Soul phase).
   if(b.torso){this.keep(b.torso);this.axis.set(-Math.sin(s.yaw),0,Math.cos(s.yaw));turn(b.torso,this.axis,.018*amp*Math.sin(seconds*2*Math.PI/(4.2+ph)+ph*6.28));}
   if(rigid){this.look.delete(s.id);this.bodyLook.delete(s.id);continue;}
   // A current conversation selects real peers instead of an unrelated nearest passer-by.
   // Only idle standing bodies turn as a whole; supported work/seats retain their recorded orientation.
   const target=s.attention?.length?souls.find(o=>s.attention!.includes(o.id)&&o.id!==s.id&&Math.abs(o.p[1]-s.p[1])<.75&&Math.hypot(o.p[0]-s.p[0],o.p[2]-s.p[2])<=8):null;
   const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
   const want=target&&/^(idle|stand|talk|wait)$/.test(s.activity)?wrap(Math.atan2(target.p[2]-s.p[2],target.p[0]-s.p[0])-s.yaw):0;
   const standing=/^(idle|stand|talk|wait)$/.test(s.activity),bodyCur=this.bodyLook.get(s.id)??0,bodyNext=standing?wrap(bodyCur+wrap(want-bodyCur)*k):0;if(standing)this.bodyLook.set(s.id,bodyNext);else this.bodyLook.delete(s.id);
   if(Math.abs(bodyNext)>.0001){this.keep(s.root);if(s.root.parent)turn(s.root,UP,-bodyNext);else s.root.rotateOnWorldAxis(UP,-bodyNext);}
   const looking={...s,yaw:s.yaw+bodyNext};
   // Weight shift while standing/sitting: slow hips roll about the facing axis.
   const hipsBone=b.hips??b.abdomen;if(hipsBone&&!/sit/.test(s.activity)){this.keep(hipsBone);this.axis.set(Math.cos(s.yaw),0,Math.sin(s.yaw));turn(hipsBone,this.axis,.035*amp*Math.sin(seconds*2*Math.PI/(9+ph*4)+ph*3.1));}
   // Head: ease toward the nearest Soul; small idle glances otherwise; nods while speaking.
   if(b.head){this.keep(b.head);const want=lookTarget(looking,souls)+(.12*Math.sin(seconds*.37+ph*9)),cur=this.look.get(s.id)??0,next=cur+(want-cur)*k;this.look.set(s.id,next);
    turn(b.head,UP,-next*.8);if(b.torso){turn(b.torso,UP,-next*.2);}
    if(s.speaking){this.axis.set(-Math.sin(s.yaw),0,Math.cos(s.yaw));turn(b.head,this.axis,.07*amp*Math.sin(seconds*5.3+ph*4));if(b.torso)turn(b.torso,UP,.05*amp*Math.sin(seconds*1.7+ph));}}
  }
 }
 /** Undo this frame's offsets (call right after renderer.render). */
 restore(){for(let i=this.saved.length-1;i>=0;i--){const {o,q}=this.saved[i];o.quaternion.copy(q);}this.saved.length=0;}
 forget(ids:ReadonlySet<string>){for(const id of this.look.keys())if(!ids.has(id))this.look.delete(id);for(const id of this.bodyLook.keys())if(!ids.has(id))this.bodyLook.delete(id);}
}

/** Recent real conversation membership supplies undrawn attention targets. No speech/physics is inferred. */
export function conversationAttention(id:string,speeches:readonly{speaker:string;at:number;channel:{kind:string;members?:readonly string[]}}[],now:number){
 let speech:typeof speeches[number]|undefined;for(const s of speeches)if(s.channel.kind==='conversation'&&s.channel.members?.includes(id)&&now-s.at<20000&&now>=s.at&&(!speech||s.at>speech.at))speech=s;
 return speech?speech.speaker===id?(speech.channel.members??[]).filter(peer=>peer!==id):[speech.speaker]:[];
}
