import * as THREE from 'three';
import {publishedGroundSampler} from './WorldPublishedGround.ts';
import type {SceneInfo} from './WorldGeometry.ts';

/** Gene: "prevent the camera from going underground, thats confusing." Presentation only: after every camera
 * mode has placed the camera (Broadcast, Follow, Look around, Free, zoom/orbit), keep it a margin above the
 * terrain or water surface under it and under a point a little along its view. A selected ground-only provider
 * excludes buildings and decoration and samples exact positions, including narrow support/water boundaries.
 * Without a qualified provider, retain the legacy wide-mesh ray fallback; that heuristic can mistake merged
 * building geometry for ground. Its ray heights are cached per 2 m cell for a few seconds. */
export const CAMERA_GROUND_MARGIN=1.2;
const CELL=2,CACHE_MS=4_000,MESH_REFRESH_MS=3_000,MIN_SPAN=40,TOP=400,MAX_GROUND_Y=150;

type Cell={y:number|null;at:number};
export class CameraGroundClamp{
 private ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0),0,TOP+200);
 private cells=new Map<string,Cell>();
 private meshes:THREE.Object3D[]=[];
 private meshesAt=-Infinity;
 private box=new THREE.Box3();
 private ahead=new THREE.Vector3();
 private provider:((x:number,z:number)=>number|null)|undefined;
 private source:unknown;
 /** Last result, for diagnostics/proofs: ground height under the camera, whether it was lifted this frame. */
 last:{ground:number|null;lifted:number;surfaces:number}={ground:null,lifted:0,surfaces:0};

 /** Bind selected immutable scenery/ground ownership, never a current-world fallback
  * for recorded history. A qualified provider returning null means no support. */
 bindGround(provider:((x:number,z:number)=>number|null)|undefined,source:unknown=provider){
  if(provider===this.provider&&source===this.source)return;
  this.provider=provider;this.source=source;this.cells.clear();this.meshes=[];this.meshesAt=-Infinity;
 }

 /** Wide, mostly flat drawn surfaces: terrain, ground planes, water. Not the sky or weather. */
 private groundMeshes(scene:THREE.Object3D,now:number){
  if(now-this.meshesAt<MESH_REFRESH_MS)return this.meshes;
  this.meshesAt=now;const out:THREE.Object3D[]=[];
  scene.traverseVisible(o=>{
   const m=o as THREE.Mesh;if(!m.isMesh||(m as unknown as THREE.InstancedMesh).isInstancedMesh||(m as unknown as THREE.SkinnedMesh).isSkinnedMesh||!m.geometry)return;
   // Water draws without depth writes, so it counts; the atmosphere (sky, rain, balloons, birds) never does.
   if(m.userData.cameraTransparent||m.name.startsWith('atmosphere'))return;
   const mats=Array.isArray(m.material)?m.material:[m.material];if(mats.every(x=>!x||x.visible===false))return;
   if(!m.geometry.boundingBox)m.geometry.computeBoundingBox();
   this.box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
   const sx=this.box.max.x-this.box.min.x,sz=this.box.max.z-this.box.min.z,sy=this.box.max.y-this.box.min.y,span=Math.max(sx,sz);
   if(span>=MIN_SPAN&&sy<=span*.6&&this.box.min.y<MAX_GROUND_Y)out.push(m);
  });
  if(out.length!==this.meshes.length||out.some((m,i)=>m!==this.meshes[i]))this.cells.clear();
  this.meshes=out;return out;
 }

 /** Highest drawn ground/water surface at (x, z), or null where there is none. */
 heightAt(scene:THREE.Object3D,x:number,z:number,now=performance.now()):number|null{
  if(!Number.isFinite(x)||!Number.isFinite(z))return null;
  if(this.provider){const y=this.provider(x,z);return y!==null&&Number.isFinite(y)?y:null;}
  const meshes=this.groundMeshes(scene,now),key=`${Math.round(x/CELL)},${Math.round(z/CELL)}`,hit=this.cells.get(key);
  if(hit&&now-hit.at<CACHE_MS)return hit.y;
  let y:number|null=null;
  if(meshes.length){
   this.ray.ray.origin.set(Math.round(x/CELL)*CELL,TOP,Math.round(z/CELL)*CELL);
   for(const h of this.ray.intersectObjects(meshes,false))if(h.point.y<MAX_GROUND_Y&&(y===null||h.point.y>y))y=h.point.y;
  }
  this.cells.set(key,{y,at:now});
  if(this.cells.size>3000)for(const [k,v] of this.cells)if(now-v.at>CACHE_MS)this.cells.delete(k);
  return y;
 }

 /** C1: where a ray first meets the drawn ground or water (the selected provider: a march refined by bisection;
  * else one ray against the wide ground meshes), within `maxDistance`; null when it never does. */
 along(scene:THREE.Object3D,origin:THREE.Vector3,dir:THREE.Vector3,maxDistance=600,now=performance.now()):THREE.Vector3|null{
  if(!this.provider){
   const meshes=this.groundMeshes(scene,now);if(!meshes.length)return null;
   const ray=new THREE.Raycaster(origin,dir.clone().normalize(),0,maxDistance);
   for(const h of ray.intersectObjects(meshes,false))if(h.point.y<MAX_GROUND_Y)return h.point.clone();
   return null;
  }
  const d=dir.clone().normalize(),below=(t:number)=>{const x=origin.x+d.x*t,z=origin.z+d.z*t,g=this.heightAt(scene,x,z,now);return g!==null&&origin.y+d.y*t<=g;};
  let prev=0,step=1.5;
  for(let t=step;t<=maxDistance;t+=step){
   if(below(t)){let lo=prev,hi=t;for(let i=0;i<10;i++){const m=(lo+hi)/2;if(below(m))hi=m;else lo=m;}return origin.clone().addScaledVector(d,hi);}
   prev=t;step=Math.min(12,step*1.15);
  }
  return null;
 }
 /** Lift the camera above the ground under it (and just ahead of it). Never moves it down or sideways. */
 apply(camera:THREE.Camera,scene:THREE.Object3D,now=performance.now()){
  const p=camera.position;
  camera.getWorldDirection(this.ahead);this.ahead.y=0;
  const g0=this.heightAt(scene,p.x,p.z,now);
  const g1=this.ahead.lengthSq()>1e-6?(this.ahead.normalize(),this.heightAt(scene,p.x+this.ahead.x*1.5,p.z+this.ahead.z*1.5,now)):null;
  const ground=g0===null?g1:g1===null?g0:Math.max(g0,g1);
  const floor=ground===null?null:ground+CAMERA_GROUND_MARGIN;
  const lifted=floor!==null&&p.y<floor?floor-p.y:0;
  if(lifted>0){p.y=floor!;camera.updateMatrixWorld();}
  this.last={ground,lifted,surfaces:this.meshes.length};(globalThis as {__soulsCameraGround?:unknown}).__soulsCameraGround=this.last;
  return lifted;
 }
}

/** The live view's clamp (one viewer per page). */
export const cameraGround=new CameraGroundClamp();

/** Camera clearance uses selected land only, with the selected pond surface above
 * its submerged bed. It does not admit floors, routes, or new native support.
 * Undefined means no qualified provider; null from a provider means no support. */
export function cameraGroundSampler(info?:Pick<SceneInfo,'scene'|'shore'>,drawnGround?:((x:number,z:number)=>number|null)){
 if(!drawnGround&&!info?.shore?.metadata.terrain&&!info?.scene?.surfaces.some(s=>s.level===0))return undefined;
 const land=drawnGround??publishedGroundSampler(info),water=info?.shore?.metadata.water;
 return (x:number,z:number):number|null=>{
  const y=land(x,z);if(y===null||!Number.isFinite(y))return null;
  if(water){const b=water.wetBoundsXZ;if(x>=b[0]&&x<=b[2]&&z>=b[1]&&z<=b[3]&&y<water.datumY)return water.datumY;}
  return y;
 };
}

/** lookrace: where a picture's eye goes when the requested one is under the ground (terrain only). An eye that clears
 * the ground is kept as asked. A buried eye first keeps its view line and moves toward the target, to the farthest
 * point that clears the ground by `margin` and whose line to the target clears it by `lineMargin` (the last `targetSlack` metres before the target, which
 * usually sits on the ground, are not tested), as long as at least `keep` of the distance remains; otherwise it keeps
 * its compass side and distance and rises (2° steps) until the whole line clears. Null: neither works (buried target). */
export type ShotEye={eye:number[];closer:number;raised:number};
export function clearShotEye(eye:readonly number[],at:readonly number[],heightAt:(x:number,z:number)=>number|null,margin=CAMERA_GROUND_MARGIN,targetSlack=3,keep=.35,lineMargin=.3):ShotEye|null{
 const point=(e:readonly number[],t:number)=>[e[0]+(at[0]-e[0])*t,e[1]+(at[1]-e[1])*t,e[2]+(at[2]-e[2])*t];
 const clear=(p:readonly number[],m=margin)=>{const g=heightAt(p[0],p[2]);return g===null||p[1]>=g+m;};
 if(clear(eye))return {eye:[...eye],closer:0,raised:0};
 const len=Math.hypot(at[0]-eye[0],at[1]-eye[1],at[2]-eye[2]);if(!(len>targetSlack))return null;
 const end=1-targetSlack/len,steps=Math.max(8,Math.min(512,Math.ceil(len)));
 const lineClear=(e:readonly number[])=>{for(let i=1;i<=steps;i++)if(!clear(point(e,end*i/steps),lineMargin))return false;return true;};
 // walk back from the target: the first buried sample bounds the clear stretch next to the target
 let t=end;for(let i=steps;i>=0;i--){const s=end*i/steps;if(!clear(point(eye,s),lineMargin))break;t=s;}
 // the eye itself needs the camera margin: step on toward the target until it has it
 for(let i=Math.round(t/end*steps);i<steps&&!clear(point(eye,t));i++)t=end*(i+1)/steps;
 if(t<end&&clear(point(eye,t))&&1-t>=keep)return {eye:point(eye,t),closer:t*len,raised:0};
 const h=Math.hypot(eye[0]-at[0],eye[2]-at[2]),el0=Math.atan2(eye[1]-at[1],h),ux=h>1e-9?(eye[0]-at[0])/h:0,uz=h>1e-9?(eye[2]-at[2])/h:1;
 for(let deg=2;el0+deg*Math.PI/180<Math.PI*89/180;deg+=2){const el=el0+deg*Math.PI/180,e=[at[0]+ux*Math.cos(el)*len,at[1]+Math.sin(el)*len,at[2]+uz*Math.cos(el)*len];
  if(clear(e)&&lineClear(e))return {eye:e,closer:0,raised:deg};}
 return null;
}
