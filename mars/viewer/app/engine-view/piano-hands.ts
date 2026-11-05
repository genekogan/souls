// The piano overlay observes the recorded seat/root and shared audible score.
// It fits the hand to the immutable core/piano@1 keys with the existing arm IK.
import * as THREE from 'three';
import {BODY_MODEL,ik,palm,setWorldQuat,swing,turn,type Arm} from './rig.ts';
const V=()=>new THREE.Vector3();
const P=(o:THREE.Object3D)=>o.getWorldPosition(V());
/** Palm down and fingers gently curled toward the keys. Solve the wrist once,
 * preserving that orientation; no body/root, seat, bone length or score changes. */
export function posePianoHand(arm:Arm,origin:THREE.Vector3,goal:THREE.Vector3,fwd:THREE.Vector3,right:THREE.Vector3,keyY:number,lift:number,weight:number,sampleSkin:(visit:(p:THREE.Vector3)=>void)=>void){
 if(arm.fingers.length!==16||weight<=0)return;
 const before=weight<1?[arm.upper,arm.lower,arm.hand,...arm.fingers,...arm.thumb].map(o=>({o,q:o.quaternion.clone(),p:o.position.clone()})):[];
 const f=palm(arm,V()).sub(P(arm.hand)).normalize(),across=P(arm.fingers[1]).sub(P(arm.fingers[13]));
 across.addScaledVector(f,-across.dot(f)).normalize();
 const n=(arm.side>0?V().crossVectors(across,f):V().crossVectors(f,across)).normalize(),inv=arm.hand.getWorldQuaternion(new THREE.Quaternion()).invert();
 const fl=f.applyQuaternion(inv),nl=n.applyQuaternion(inv),bl=V().crossVectors(fl,nl),N=V().set(0,-1,0),F=fwd.clone(),B=V().crossVectors(F,N);
 const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(F,N,B).multiply(new THREE.Matrix4().makeBasis(fl,nl,bl).transpose()));
 setWorldQuat(arm.hand,q);
 for(let finger=0;finger<4;finger++){
  const chain=arm.fingers.slice(finger*4,finger*4+4);
  for(let j=1;j<3;j++){const a=P(chain[j-1]),b=P(chain[j]),c=P(chain[j+1]);swing(chain[j],c,b.clone().addScaledVector(b.clone().sub(a).normalize(),b.distanceTo(c)),1);}
  const d=P(chain[2]).sub(P(chain[1])).normalize(),axis=V().crossVectors(d,N).normalize();
  for(let j=1;j<4;j++)turn(chain[j],axis,[0,.5,.55,.2][j]);
 }
 const currentPalm=palm(arm,V()),wrist=P(arm.hand);
 if(arm.thumb.length===3){const tip=P(arm.thumb[2]),target=tip.clone().setY(currentPalm.y-.01);swing(arm.thumb[0],tip,target,1);}
 // Fit the actual skinned hand where it overlaps the keyboard, including the
 // thumb and palm. White keys are 12.5 mm below the highest black key surface.
 const shift=goal.clone().sub(currentPalm),projected=V();shift.y=0;let dy=-Infinity;
 sampleSkin(p=>{projected.copy(p).add(shift).sub(origin);const depth=projected.dot(fwd),along=projected.dot(right);
  if(depth>=.47&&depth<=.63&&Math.abs(along)<=.65){const top=keyY-(depth>=.555&&depth<=.625?0:.0125);dy=Math.max(dy,top-p.y);}
 });
 if(!Number.isFinite(dy)){const low=Math.min(...[3,7,11,15].map(i=>P(arm.fingers[i]).y),...(arm.thumb.length?[P(arm.thumb.at(-1)!).y]:[]),currentPalm.y-.02);dy=keyY-low;}
 goal.y=currentPalm.y+dy+.002+lift;
 const wristGoal=goal.clone().sub(currentPalm).add(wrist),pole=right.clone().multiplyScalar(-arm.side*.6).add(new THREE.Vector3(0,-.5,0)).addScaledVector(fwd,-.2);
 ik(arm.upper,arm.lower,wrist,wristGoal,pole,1,BODY_MODEL.maxExtension);
 setWorldQuat(arm.hand,q);
 for(const b of before){b.o.quaternion.copy(b.q.slerp(b.o.quaternion.clone(),weight));b.o.position.copy(b.p.lerp(b.o.position.clone(),weight));}
 arm.upper.updateMatrixWorld(true);
}
