import * as THREE from 'three';
import{WorldVisibilityInstances}from'./WorldVisibilityInstances.ts';
import type { CameraPose, SubjectPose } from '../../../mars/viewer/engine/camera/shots.ts';
/** A reach (nearest surface both ways, no early exit) costs several score
 * rays: measured ~0.1-0.4 ms against ~0.02 ms per score ray. */
const REACH_WORK=8;
const UP=new THREE.Vector3(0,1,0);
/** Frustum grid in NDC, subject centre excluded. */
const FOREGROUND_GRID:readonly (readonly [number,number])[]=[[-.66,-.6],[0,-.6],[.66,-.6],[-.66,0],[.66,0],[-.66,.6],[0,.6],[.66,.6]];
/** Refresh the matrices a draw would use. WorldEntityLayer freezes current
 * subtrees by replacing updateMatrixWorld with a no-op; updateWorldMatrix
 * bypasses that contract and re-walks them. Ancestors still update first, and
 * manually supplied matrixWorld values keep Three's renderer semantics. */
function flushMatrices(root:THREE.Object3D){root.parent?.updateWorldMatrix(true,false);root.updateMatrixWorld(true);}
/** Read-only camera composition over actual opaque render meshes. These are
 * visual occluders, never native collisions, support or actor movement. */
export class WorldRenderedVisibility {
  private objects:THREE.Object3D[]=[];
  private roots:THREE.Object3D[]=[];
  private instances=new WorldVisibilityInstances();
  private ray=new THREE.Raycaster();
  private hits:THREE.Intersection[]=[];
  private eye=new THREE.Vector3();
  private point=new THREE.Vector3();
  private direction=new THREE.Vector3();
  /** Rays cast so far (score/seen points, clearance probes, reach legs): a
   * deterministic measure of camera work for time-slicing decisions. */
  work=0;
  private clearDecisions(){this.crowds.length=0;this.cleared.length=0;this.seenSets.length=0;this.rooms.length=0;this.preparations=0;}
  reset(){this.clearDecisions();this.roots.length=0;this.objects.length=0;this.hits.length=0;this.instances.reset();}
  private visible(object:THREE.Object3D,requireRoot=false){let attached=!requireRoot;for(let p:THREE.Object3D|null=object;p;p=p.parent){if(!p.visible)return false;if(requireRoot&&this.roots.includes(p))attached=true;}return attached;}
  private opaque(hit:THREE.Intersection){
    if(!this.visible(hit.object,true)||hit.object.userData.cameraTransparent===true)return false;const materials=(hit.object as THREE.Mesh).material;const material=Array.isArray(materials)?materials[hit.face?.materialIndex??0]:materials;return !!material&&material.visible&&(!material.transparent||material.opacity>=.5);}
  prepare(roots:readonly THREE.Object3D[]){
    // Validated instance caches survive decisions; reset() still clears them.
    // Clearance/sightline proofs expire after ~1 s of decisions (10 Hz), room
    // samples (architecture) after ~3 s; all at once if the root set changes.
    const same=roots.length===this.roots.length&&roots.every(r=>this.roots.includes(r));this.preparations++;
    this.cleared=same?this.cleared.filter(c=>this.preparations-c.at<10):[];this.seenSets=same?this.seenSets.filter(c=>this.preparations-c.at<10):[];this.rooms=same?this.rooms.filter(c=>this.preparations-c.at<30):[];this.crowds=same?this.crowds.filter(c=>this.preparations-c.at<10):[];
    this.roots.length=0;this.objects.length=0;this.hits.length=0;this.roots=[...new Set(roots)];const seen=new Set<THREE.Object3D>();
    // A hit object marked cameraTransparent is never opaque(), so it cannot change a score.
    // traverseVisible keeps the same mesh order while pruning hidden branches;
    // check ancestors once per root instead of once per mesh.
    for(const root of this.roots){flushMatrices(root);if(root.parent&&!this.visible(root.parent))continue;root.traverseVisible(o=>{if((o as THREE.Mesh).isMesh&&o.userData.cameraTransparent!==true&&!seen.has(o)){seen.add(o);this.objects.push(o);}});}
    this.instances.retain(this.objects);
  }
  /** A fresh speech batch owns no visibility decision from the previous frame.
   * Keep only geometry accelerators, which revalidate their inputs on every
   * query. A replaced root set releases even those old geometry references. */
  prepareFresh(roots:readonly THREE.Object3D[]){
    const unique=[...new Set(roots)];
    if(unique.length!==this.roots.length||unique.some(root=>!this.roots.includes(root)))this.reset();
    else this.clearDecisions();
    this.prepare(unique);
  }
  /** One synchronous read-only camera evaluation; never retained across frames. */
  // Component/fixture render poses may change before renderer.render updates
  // matrices. Flush once per evaluation, not once per candidate or subject ray.
  evaluate<T>(run:()=>T):T{for(const root of this.roots)flushMatrices(root);return this.instances.withQuery(this.objects,run);}
  score(pose:CameraPose,ids:readonly string[],subjects:Record<string,SubjectPose>){
    if(!ids.length)return 1;return this.instances.withQuery(this.objects,()=>{this.eye.fromArray(pose.position);let clear=0,total=0;
    for(const id of ids){const subject=subjects[id];if(!subject)return 0;const points=subject.points??[[subject.p[0],subject.p[1]+(subject.height??1.75)*.6,subject.p[2]],[subject.p[0],subject.p[1]+(subject.height??1.75)*.95,subject.p[2]]];
      for(const p of points){this.point.fromArray(p);this.direction.copy(this.eye).sub(this.point);const distance=this.direction.length();if(!Number.isFinite(distance)||distance<=.08)return 0;this.direction.multiplyScalar(1/distance);this.work++;this.ray.set(this.point,this.direction);this.ray.near=.06;this.ray.far=distance-.08;this.hits.length=0;let blocked=false;for(let o=0;o<this.objects.length;o++){const from=this.hits.length;this.instances.intersect(this.objects[o],this.ray,this.hits,o);for(let h=from;h<this.hits.length;h++)if(this.opaque(this.hits[h])){blocked=true;break;}if(blocked)break;}total++;if(!blocked)clear++;}
    }
    return total?clear/total:0;});
  }
  /** Same probes as score(), cast from the camera toward each point. A face
   * is drawn when it faces the camera, so this catches single-sided shells
   * (towers, drums, painted walls) whose outward face score()'s subject-side
   * rays pass through from behind. Fraction of points clear both ways. */
  // Fully seen camera/point sets, reused within 10 cm (each display frame
  // moves a held shot only centimetres). Same expiry as clearance proofs.
  private seenSets:{eye:number[];points:number[][];at:number}[]=[];
  seen(pose:CameraPose,ids:readonly string[],subjects:Record<string,SubjectPose>){
    if(!ids.length)return 1;
    const sets:number[][]=[];
    for(const id of ids){const subject=subjects[id];if(!subject)return 0;sets.push(...(subject.points??[[subject.p[0],subject.p[1]+(subject.height??1.75)*.6,subject.p[2]],[subject.p[0],subject.p[1]+(subject.height??1.75)*.95,subject.p[2]]]));}
    const near=(a:readonly number[],b:readonly number[])=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])<.1;
    if(this.seenSets.some(c=>c.points.length===sets.length&&near(c.eye,pose.position)&&c.points.every((q,i)=>near(q,sets[i]))))return 1;
    const value=this.instances.withQuery(this.objects,()=>{this.eye.fromArray(pose.position);let clear=0,total=0;
    {const points=sets;
      for(const p of points){this.point.fromArray(p);this.direction.copy(this.point).sub(this.eye);const distance=this.direction.length();if(!Number.isFinite(distance)||distance<=.08)return 0;this.direction.multiplyScalar(1/distance);this.ray.set(this.eye,this.direction);total++;if(!this.blocked(.08,distance-.06,null))clear++;}
    }
    return total?clear/total:0;});
    if(value===1){this.seenSets.push({eye:[...pose.position],points:sets.map(p=>[...p]),at:this.preparations});if(this.seenSets.length>16)this.seenSets.shift();}
    return value;
  }
  /** Fraction of a sparse frustum grid (centre excluded) whose rays meet an
   * opaque wall-like rendered surface (|normal.y| < .7) before 0.6 of the
   * distance to the target: a near wall, jamb or fixture filling the frame. */
  // Recent foreground fractions, reused within 10 cm of eye and target at the
  // same lens/aspect (decisions re-grade nearly the same framings 10x a second).
  private crowds:{eye:number[];target:number[];fov:number;aspect:number;value:number;at:number}[]=[];
  foreground(pose:CameraPose,aspect:number){
    if(!this.objects.length)return 0;
    const near=(a:readonly number[],b:readonly number[])=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])<.1;
    const known=this.crowds.find(c=>c.fov===pose.fov&&c.aspect===aspect&&near(c.eye,pose.position)&&near(c.target,pose.target));if(known)return known.value;
    const value=this.probeForeground(pose,aspect);
    this.crowds.push({eye:[...pose.position],target:[...pose.target],fov:pose.fov,aspect,value,at:this.preparations});if(this.crowds.length>64)this.crowds.shift();
    return value;
  }
  private probeForeground(pose:CameraPose,aspect:number){const eye=this.eye.fromArray(pose.position),forward=this.direction.fromArray(pose.target).sub(eye),d=forward.length();
    if(!(d>.2)||!(aspect>0)||!Number.isFinite(pose.fov))return 0;forward.multiplyScalar(1/d);
    const right=this.side.crossVectors(forward,UP);if(right.lengthSq()<1e-8)right.set(1,0,0);right.normalize();const up=this.upward.crossVectors(right,forward);
    const t=Math.tan(pose.fov*Math.PI/360);
    return this.instances.withQuery(this.objects,()=>{let hit=0;
      for(const [x,y] of FOREGROUND_GRID){this.work++;this.point.copy(forward).addScaledVector(right,x*t*aspect).addScaledVector(up,y*t).normalize();this.ray.set(eye,this.point);this.ray.near=.1;this.ray.far=.6*d;this.hits.length=0;
        let wall=false;for(let o=0;o<this.objects.length&&!wall;o++){const from=this.hits.length;this.instances.intersect(this.objects[o],this.ray,this.hits,o);for(let h=from;h<this.hits.length;h++){const q=this.hits[h];if(q.face&&this.opaque(q)&&Math.abs(this.worldNormal(q).y)<.7){wall=true;break;}}}
        this.hits.length=0;if(wall)hit++;}
      return hit/FOREGROUND_GRID.length;});
  }
  private side=new THREE.Vector3();private upward=new THREE.Vector3();private normalW=new THREE.Vector3();private instanceMatrix=new THREE.Matrix4();
  private worldNormal(hit:THREE.Intersection){
    const n=this.normalW.copy(hit.face!.normal),mesh=hit.object as THREE.InstancedMesh;
    if(hit.instanceId!==undefined&&mesh.isInstancedMesh){mesh.getMatrixAt(hit.instanceId,this.instanceMatrix);n.transformDirection(this.instanceMatrix);}
    return n.transformDirection(hit.object.matrixWorld);
  }
  private nearby:number[]=[];
  /** Any opaque hit on origin+direction*[near,far] among the listed objects. */
  private blocked(near:number,far:number,indices:readonly number[]|null){
    this.work++;this.ray.near=near;this.ray.far=far;this.hits.length=0;
    const n=indices?indices.length:this.objects.length;
    for(let k=0;k<n;k++){const o=indices?indices[k]:k;const from=this.hits.length;this.instances.intersect(this.objects[o],this.ray,this.hits,o);for(let h=from;h<this.hits.length;h++)if(this.opaque(this.hits[h])){this.hits.length=0;return true;}}
    this.hits.length=0;return false;
  }
  /** No opaque rendered surface, facing either way, within radius of p along
   * ±x/±y/±z. Each axis is crossed from both ends, so single-sided faces and
   * a point inside a closed wall solid are both detected. */
  // Recently proven clear positions at their radius. A camera within 15 cm of
  // one (well inside the 40 cm clearance) is not re-probed every display frame.
  private cleared:{p:number[];radius:number;at:number}[]=[];
  private preparations=0;
  clear(p:readonly number[],radius:number){
    if(!this.objects.length)return true;if(!(radius>0)||!p.every(Number.isFinite))return false;
    if(this.cleared.some(c=>c.radius===radius&&Math.hypot(c.p[0]-p[0],c.p[1]-p[1],c.p[2]-p[2])<.15))return true;
    const clear=this.probeClear(p,radius);
    if(clear){this.cleared.push({p:[...p],radius,at:this.preparations});if(this.cleared.length>48)this.cleared.shift();}
    return clear;
  }
  private probeClear(p:readonly number[],radius:number){
    return this.instances.withQuery(this.objects,()=>{
      // Every probe segment lies within radius of p: one bounds pass serves all six.
      const nearby=this.instances.near(this.point.fromArray(p),radius,this.nearby);
      for(const axis of [0,1,2])for(const sign of [1,-1]){
        this.direction.set(0,0,0).setComponent(axis,sign);this.point.fromArray(p).addScaledVector(this.direction,-radius);this.ray.set(this.point,this.direction);
        if(this.blocked(0,2*radius,nearby))return false;
      }
      return true;});
  }
  // Recent room samples (subject torso → eight horizontal reaches).
  private rooms:{p:number[];far:number;walls:number;reach:number[]|undefined;at:number}[]=[];
  /** Reach in eight horizontal directions (azimuth k*45deg from +x toward +z)
   * then straight up, up to far, either facing; undefined as soon as fewer
   * than `walls` horizontal reaches can end before far (axes are cast first).
   * Reused within 50 cm for ~3 s of decisions. */
  around(p:readonly number[],far:number,walls=0):readonly number[]|undefined{
    const known=this.rooms.find(r=>r.far===far&&r.walls===walls&&Math.hypot(r.p[0]-p[0],r.p[1]-p[1],r.p[2]-p[2])<.5);if(known)return known.reach;
    const reach:number[]=new Array(8).fill(far),cast=(k:number)=>{const a=k*Math.PI/4;reach[k]=Math.min(far,this.reach(p,[p[0]+Math.cos(a)*far,p[1],p[2]+Math.sin(a)*far]));};
    let open=0,result:number[]|undefined=reach;
    for(const k of [0,2,4,6,1,3,5,7]){cast(k);if(reach[k]>=far&&++open>8-walls){result=undefined;break;}}
    if(result)reach.push(Math.min(far,this.reach(p,[p[0],p[1]+far,p[2]])));
    this.rooms.push({p:[...p],far,walls,reach:result,at:this.preparations});if(this.rooms.length>8)this.rooms.shift();return result;
  }
  /** Distance from a toward b to the first opaque surface on the segment,
   * facing either way; Infinity when nothing opaque lies on it. */
  reach(a:readonly number[],b:readonly number[]){
    if(!this.objects.length)return Infinity;this.point.fromArray(a);this.direction.fromArray(b).sub(this.point);const length=this.direction.length();
    if(!Number.isFinite(length))return 0;if(length<=.06)return Infinity;
    return this.instances.withQuery(this.objects,()=>{
      this.work+=REACH_WORK;this.direction.multiplyScalar(1/length);this.ray.set(this.point,this.direction);this.ray.near=.06;this.ray.far=length;this.hits.length=0;let nearest=Infinity;
      // Shrinking far lets later objects fail the bounds pre-test.
      for(let o=0;o<this.objects.length;o++){const from=this.hits.length;this.instances.intersect(this.objects[o],this.ray,this.hits,o);for(let h=from;h<this.hits.length;h++){const hit=this.hits[h];if(hit.distance<nearest&&this.opaque(hit)){nearest=hit.distance;this.ray.far=nearest;}}this.hits.length=0;}
      // Faces drawn toward b (single-sided shells) are met from b: the hit
      // nearest a on that reverse ray, limited to the part before `nearest`.
      const end=Math.min(nearest,length);this.eye.fromArray(b);this.direction.negate();this.ray.set(this.eye,this.direction);this.ray.near=Math.max(0,length-end);this.ray.far=length-.06;
      if(this.ray.far>this.ray.near)for(let o=0;o<this.objects.length;o++){const from=this.hits.length;this.instances.intersect(this.objects[o],this.ray,this.hits,o);for(let h=from;h<this.hits.length;h++){const hit=this.hits[h];if(this.opaque(hit)&&length-hit.distance<nearest){nearest=length-hit.distance;this.ray.near=hit.distance;}}this.hits.length=0;}
      return nearest;});
  }
}
