import * as THREE from 'three';
import type {DistanceDetailOptions} from './quality-tier.ts';
/** Lane phones (V4): lower detail at a distance, for the phone quality tier.
 *
 * A phone shows the same world in a 390-pixel-wide window. Much of what the desktop view draws is, on that screen,
 * smaller than a pixel or two: cups on far tables, distant plants, fence posts across the lake. Each still costs a draw
 * call (and another in the shadow pass) on a GPU and CPU several times slower than a laptop's. Two render-time rules:
 *  - a mesh whose bounding sphere projects to less than `minRadiusPx` CSS pixels of radius is not drawn this frame;
 *  - a small shadow caster beyond `shadowNear + shadowPerMetre·radius` metres does not cast (as WorldShadowDetail does
 *    for the Eden expansion on every tier).
 * Like WorldShadowDetail it is render-time only: `apply` runs just before renderer.render and `restore` right after,
 * so scene state, picking, tests and the static batches' change checks never see a hidden mesh. Lines, points, sprites
 * and anything with frustum culling turned off (sky, horizon, overlays) are never touched. Skinned bodies (Souls, kin)
 * are never hidden; beyond `standInDistance` metres they stop casting shadows (release 3.1: a resident 100 m away is a
 * few pixels tall on a phone, yet each of its body parts cost a skinned draw in the shadow pass). The candidate list is rescanned every `rescanFrames` frames. */
/** PERF-PASSES: a mesh inside a frozen thing (WorldEntityLayer.freeze:
 *  `userData.frozenDrawn` on the thing, with its `frozen` list replaced at every freeze) keeps its world-space centre and
 *  radius in `w` until that list changes: ~5,000 of Eden 2026's 6,000 candidates read and decomposed a matrix a frame. */
type Ancestor={object:THREE.Object3D;parent?:Ancestor;frame:number;shown:boolean;frozen:unknown};
type Candidate={mesh:THREE.Mesh;centre:THREE.Vector3;radius:number;ancestor?:Ancestor;w?:{list:unknown;x:number;y:number;z:number;r:number}};
type FrozenMark={frozen?:unknown};
const tmpBody=new THREE.Vector3();
export class WorldDistanceDetail{
 private candidates:Candidate[]=[];private bodies:THREE.SkinnedMesh[]=[];private frame=0;private hidden:THREE.Mesh[]=[];private noShadow:THREE.Mesh[]=[];
 private ancestorTrail:Ancestor[]=[];
 private world=new THREE.Vector3();private sphere=new THREE.Sphere();
 /** Last apply(): meshes not drawn, casters skipped, candidates considered, CPU ms. */
 readonly stats={culled:0,shadowSkipped:0,candidates:0,bodyShadowsSkipped:0,cpuMs:0};
 private o:DistanceDetailOptions;
 constructor(o:DistanceDetailOptions){this.o=o;}
 private scan(root:THREE.Object3D){
  this.candidates=[];this.bodies=[];
  // Keep the scan's ancestry, as before; share its suffixes between sibling meshes. The memo is owned by these
  // candidates and replaced at the next scan. Visibility and the nearest freeze marker are reread each apply.
  const ancestors=new Map<THREE.Object3D,Ancestor>(),trail:THREE.Object3D[]=[];
  const ancestor=(o:THREE.Object3D|null):Ancestor|undefined=>{
   while(o&&o!==root&&!ancestors.has(o)){trail.push(o);o=o.parent;}
   let parent=o&&o!==root?ancestors.get(o):undefined;
   while(trail.length){const object=trail.pop()!;parent={object,parent,frame:-1,shown:true,frozen:undefined};ancestors.set(object,parent);}return parent;
  };
  root.traverse(obj=>{
   const m=obj as THREE.Mesh;
   if(m.isMesh&&(m as THREE.SkinnedMesh).isSkinnedMesh&&!m.userData.keepDetail){this.bodies.push(m as THREE.SkinnedMesh);return;}
   if(!m.isMesh||(m as THREE.SkinnedMesh).isSkinnedMesh||!m.frustumCulled||m.userData.keepDetail)return;
   const im=m as THREE.InstancedMesh;
   if(im.isInstancedMesh){if(!im.boundingSphere)im.computeBoundingSphere();if(!im.boundingSphere)return;this.sphere.copy(im.boundingSphere);}
   else{const g=m.geometry;if(!g)return;if(!g.boundingSphere)g.computeBoundingSphere();if(!g.boundingSphere||!Number.isFinite(g.boundingSphere.radius))return;this.sphere.copy(g.boundingSphere);}
   this.candidates.push({mesh:m,centre:this.sphere.center.clone(),radius:this.sphere.radius,ancestor:ancestor(m.parent)});
  });
 }
 private ancestorState(a:Ancestor):Ancestor{
  if(a.frame===this.frame)return a;
  const trail=this.ancestorTrail;
  for(let next:Ancestor|undefined=a;next&&next.frame!==this.frame;next=next.parent)trail.push(next);
  try{while(trail.length){
   const next=trail.pop()!;next.frame=this.frame;
   if(!next.object.visible){next.shown=false;next.frozen=undefined;continue;}
   next.shown=next.parent?.shown??true;
   const own=(next.object.userData.frozenDrawn as FrozenMark|undefined)?.frozen;
   next.frozen=own||next.parent?.frozen;
  }}finally{trail.length=0;}
  return a;
 }
 /** Call right before renderer.render. `viewHeight` is the canvas height in CSS pixels. */
 apply(root:THREE.Object3D,camera:THREE.PerspectiveCamera,viewHeight:number){
  const t0=performance.now();
  if(this.frame++%this.o.rescanFrames===0)this.scan(root);
  let culled=0,skipped=0;const cam=camera.position,pxPerUnit=viewHeight/(2*Math.tan(camera.fov*Math.PI/360))*(camera.zoom||1);
  for(const c of this.candidates){
   const m=c.mesh;if(!m.visible)continue;
   const ancestor=c.ancestor&&this.ancestorState(c.ancestor);if(ancestor&&!ancestor.shown)continue;
   const frozen=ancestor?.frozen;
   let r:number,d:number;
   if(frozen!==undefined&&c.w&&c.w.list===frozen){const w=c.w;r=w.r;d=Math.sqrt((w.x-cam.x)**2+(w.y-cam.y)**2+(w.z-cam.z)**2)-r;}
   else{
    const e=m.matrixWorld.elements,scale=Math.sqrt(Math.max(e[0]*e[0]+e[1]*e[1]+e[2]*e[2],e[4]*e[4]+e[5]*e[5]+e[6]*e[6],e[8]*e[8]+e[9]*e[9]+e[10]*e[10]));
    const w=this.world.copy(c.centre).applyMatrix4(m.matrixWorld);r=c.radius*scale;d=w.distanceTo(cam)-r;
    if(frozen!==undefined)c.w={list:frozen,x:w.x,y:w.y,z:w.z,r};else c.w=undefined;
   }
   if(d<=0)continue;
   if(r*pxPerUnit/d<this.o.minRadiusPx){m.visible=false;this.hidden.push(m);culled++;continue;}
   if(m.castShadow&&r<this.o.shadowMaxRadius&&d>this.o.shadowNear+this.o.shadowPerMetre*r){m.castShadow=false;this.noShadow.push(m);skipped++;}
  }
  let bodySkipped=0;const far2=this.o.standInDistance*this.o.standInDistance;
  if(Number.isFinite(far2))for(const b of this.bodies){if(!b.castShadow||!b.parent)continue;b.getWorldPosition(tmpBody);if(tmpBody.distanceToSquared(cam)>far2){b.castShadow=false;this.noShadow.push(b);bodySkipped++;}}
  this.stats.bodyShadowsSkipped=bodySkipped;
  this.stats.culled=culled;this.stats.shadowSkipped=skipped;this.stats.candidates=this.candidates.length;this.stats.cpuMs=performance.now()-t0;
 }
 /** Call right after renderer.render. */
 restore(){for(const m of this.hidden)m.visible=true;for(const m of this.noShadow)m.castShadow=true;this.hidden.length=0;this.noShadow.length=0;}
 dispose(){this.restore();this.candidates=[];}
}
