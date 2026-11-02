import * as THREE from 'three';
const instanceRaycast=THREE.InstancedMesh.prototype.raycast,meshRaycast=THREE.Mesh.prototype.raycast,skinRaycast=THREE.SkinnedMesh.prototype.raycast,matrixAt=THREE.InstancedMesh.prototype.getMatrixAt,vertexAt=THREE.Mesh.prototype.getVertexPosition;
// Instances are visited through spatially grouped chunks. Each chunk sphere
// encloses its members' spheres, so rejecting a chunk never rejects a member
// the per-instance test would have kept.
type Chunk={sphere:THREE.Sphere;members:number[]};
// Rays visit instances through a sphere tree: each node sphere encloses its
// members' spheres (outward pad), so rejecting a node never rejects a member
// the per-instance test would have kept. Leaves list instance indices.
type Tree={nodes:Float64Array;left:Int32Array;right:Int32Array;start:Int32Array;count:Int32Array;order:Int32Array};
type Cache={geometry:THREE.BufferGeometry;array:Float32Array;count:number;world:number[];local:Float32Array;localBits:Uint32Array;sphere:number[];matrices:THREE.Matrix4[];spheres:THREE.Sphere[];chunks:Chunk[];tree:Tree};
// Library raycasts only read geometry/matrices; the Object3D/Group one is a no-op.
const STOCK_RAYCASTS=new Set<unknown>([meshRaycast,instanceRaycast,skinRaycast,THREE.Object3D.prototype.raycast,THREE.Line.prototype.raycast,THREE.LineSegments.prototype.raycast,THREE.Points.prototype.raycast,THREE.Sprite.prototype.raycast]);
const CHUNK=16,CELL=6,LEAF=4,MESH_CAP=65536,TOTAL_CAP=262144,CELL_MIN_TRIANGLES=256,CELL_TRIANGLES=48;
// Large static single-material meshes are split into local-space cells. Each
// cell is a subset index over the SAME attributes and is raycast by stock
// Mesh.raycast, so per-triangle results (side, distance, point, uv) match.
type Cell={box:THREE.Box3;geometry:THREE.BufferGeometry};
type Cells={geometry:THREE.BufferGeometry;index:THREE.BufferAttribute|null;indexVersion:number;position:THREE.BufferAttribute|THREE.InterleavedBufferAttribute;positionVersion:number;start:number;count:number;cells:Cell[]};
const sameArray=(a:ArrayLike<number>,b:ArrayLike<number>,n:number)=>{for(let i=0;i<n;i++)if(!Object.is(a[i],b[i]))return false;return true;};
// Same answer as sameArray for a finite cached copy (no NaN can be cached;
// +0/-0 differ in both), compared as 32-bit words: several times faster.
const sameBits=(a:Uint32Array,b:Float32Array,n:number)=>{const w=new Uint32Array(b.buffer,b.byteOffset,n);for(let i=0;i<n;i++)if(a[i]!==w[i])return false;return true;};
/** CPU-only read accelerator for stock instanced raycasts. No scene/resource ownership. */
export class WorldVisibilityInstances {
 private generation=0;
 private cache=new Map<THREE.InstancedMesh,Cache>();
 private proxy?:THREE.Mesh;
 private query?:Map<THREE.InstancedMesh,Cache|undefined>;
 private queryObjects?:readonly THREE.Object3D[];
 private queryDepth=0;
 /** Bounds passes taken (one per outermost withQuery; tests and frame-cost readouts). */
 readonly stats={boundsPasses:0};
 // World bounding spheres per query object (x,y,z,r; NaN = never pre-rejected).
 private bounds?:Float64Array;
 private boundsObjects?:readonly THREE.Object3D[];
 private sphere=new THREE.Sphere();
 private local=new THREE.Matrix4();
 private ray=new THREE.Ray();
 private point=new THREE.Vector3();
 private hits:THREE.Intersection[]=[];
 private meshCells=new Map<THREE.Mesh,Cells|null>();
 private cellProxy?:THREE.Mesh;
 private inverse=new THREE.Matrix4();
 private localRay=new THREE.Ray();
 private entry=new THREE.Vector3();
 private segment=new THREE.Box3();
 private stack=new Int32Array(256);
 reset(){this.generation++;this.bounds=undefined;this.boundsObjects=undefined;this.cache.clear();this.meshCells.clear();this.cellProxy=undefined;this.proxy=undefined;this.query=undefined;this.queryObjects=undefined;this.hits.length=0;}
 /** Keep validated caches for meshes still collected; every use still revalidates them. */
 retain(objects:readonly THREE.Object3D[]){const keep=new Set(objects);for(const mesh of [...this.cache.keys()])if(!keep.has(mesh))this.cache.delete(mesh);for(const mesh of [...this.meshCells.keys()])if(!keep.has(mesh))this.meshCells.delete(mesh);}
 private cellsOf(mesh:THREE.Mesh):Cells|null{
  const geometry=mesh.geometry,position=geometry.attributes.position,index=geometry.index;
  if(mesh.constructor!==THREE.Mesh||mesh.raycast!==meshRaycast||THREE.Mesh.prototype.raycast!==meshRaycast||THREE.Mesh.prototype.getVertexPosition!==vertexAt||Array.isArray(mesh.material)||!position||
   mesh.morphTargetInfluences?.length||Object.keys(geometry.morphAttributes).length||!geometry.boundingSphere)return null;
  const vertices=index?index.count:position.count,start=Math.max(0,geometry.drawRange.start),end=Math.min(vertices,geometry.drawRange.start+geometry.drawRange.count),count=Math.max(0,end-start);
  const old=this.meshCells.get(mesh),version=(a:unknown)=>{const x=a as {version?:number;data?:{version?:number}}|null;return x?.data?.version??x?.version??-1;};
  if(old&&old.geometry===geometry&&old.index===index&&old.indexVersion===version(index)&&old.position===position&&old.positionVersion===version(position)&&old.start===start&&old.count===count)return old;
  if(count/3<CELL_MIN_TRIANGLES){this.meshCells.set(mesh,null);return null;}
  const v=(i:number)=>index?index.getX(i):i,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),centre=new THREE.Vector3(),box=new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute),size=box.getSize(new THREE.Vector3());
  const per=Math.max(1,Math.cbrt(count/3/CELL_TRIANGLES)),n=[0,1,2].map(k=>Math.max(1,Math.min(32,Math.round(per*size.getComponent(k)/Math.max(size.x,size.y,size.z,1e-9)*3))));
  const buckets=new Map<number,number[]>();
  // Phone arrival (lane L3): plain float positions read straight from the array (the same numbers fromBufferAttribute
  // returns, the same arithmetic order), no per-triangle arrays; ~0.15 s of a 4x-throttled phone's first tour shot.
  const plain=position instanceof THREE.BufferAttribute&&!(position as THREE.BufferAttribute).normalized&&position.itemSize===3&&(!index||index instanceof THREE.BufferAttribute)?(position as THREE.BufferAttribute).array as ArrayLike<number>:null;
  if(plain){
   const ix=index?index.array as ArrayLike<number>:null,mx=box.min.x,my=box.min.y,mz=box.min.z,dx=Math.max(size.x,1e-9),dy=Math.max(size.y,1e-9),dz=Math.max(size.z,1e-9),[n0,n1,n2]=n,third=1/3;
   for(let t=start;t+2<end;t+=3){
    const i0=ix?ix[t]:t,i1=ix?ix[t+1]:t+1,i2=ix?ix[t+2]:t+2,p0=i0*3,p1=i1*3,p2=i2*3;
    const cx=(plain[p0]+plain[p1]+plain[p2])*third,cy=(plain[p0+1]+plain[p1+1]+plain[p2+1])*third,cz=(plain[p0+2]+plain[p1+2]+plain[p2+2])*third;
    const k0=Math.min(n0-1,Math.max(0,Math.floor((cx-mx)/dx*n0))),k1=Math.min(n1-1,Math.max(0,Math.floor((cy-my)/dy*n1))),k2=Math.min(n2-1,Math.max(0,Math.floor((cz-mz)/dz*n2))),key=(k0*n1+k1)*n2+k2;
    let list=buckets.get(key);if(!list)buckets.set(key,list=[]);list.push(i0,i1,i2);}
  }else for(let t=start;t+2<end;t+=3){a.fromBufferAttribute(position,v(t));b.fromBufferAttribute(position,v(t+1));c.fromBufferAttribute(position,v(t+2));centre.copy(a).add(b).add(c).multiplyScalar(1/3);
   const k=[0,1,2].map(d=>Math.min(n[d]-1,Math.max(0,Math.floor((centre.getComponent(d)-box.min.getComponent(d))/Math.max(size.getComponent(d),1e-9)*n[d])))),key=(k[0]*n[1]+k[1])*n[2]+k[2];
   let list=buckets.get(key);if(!list)buckets.set(key,list=[]);list.push(v(t),v(t+1),v(t+2));}
  const cells:Cell[]=[];
  for(const list of buckets.values()){
   const cellBox=new THREE.Box3();
   if(plain){let x0=Infinity,y0=Infinity,z0=Infinity,x1=-Infinity,y1=-Infinity,z1=-Infinity;for(const i of list){const q=i*3,x=plain[q],y=plain[q+1],z=plain[q+2];x0=Math.min(x0,x);y0=Math.min(y0,y);z0=Math.min(z0,z);x1=Math.max(x1,x);y1=Math.max(y1,y);z1=Math.max(z1,z);}cellBox.min.set(x0,y0,z0);cellBox.max.set(x1,y1,z1);}
   else for(const i of list)cellBox.expandByPoint(a.fromBufferAttribute(position,i));
   cellBox.expandByScalar(1e-6);
   const g=new THREE.BufferGeometry();for(const [name,attr] of Object.entries(geometry.attributes))g.setAttribute(name,attr);
   g.setIndex(new THREE.BufferAttribute(position.count>65535?new Uint32Array(list):new Uint16Array(list),1));g.boundingSphere=geometry.boundingSphere;g.boundingBox=geometry.boundingBox;// shared bounds: stock tests stay whole-mesh
   cells.push({box:cellBox,geometry:g});
  }
  const result={geometry,index,indexVersion:version(index),position,positionVersion:version(position),start,count,cells};this.meshCells.set(mesh,result);return result;
 }
 private intersectCells(mesh:THREE.Mesh,cells:Cells,raycaster:THREE.Raycaster,target:THREE.Intersection[]){
  // Stock whole-mesh sphere rejection first (Mesh.raycast does the same).
  this.sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld);this.ray.copy(raycaster.ray).recast(raycaster.near);if(this.misses(this.sphere,raycaster))return;
  this.inverse.copy(mesh.matrixWorld).invert();this.localRay.copy(raycaster.ray).applyMatrix4(this.inverse);
  const proxy=this.cellProxy??(this.cellProxy=new THREE.Mesh());proxy.material=mesh.material;proxy.matrixWorld=mesh.matrixWorld;proxy.layers=mesh.layers;
  // Local AABB of the [near,far] segment (exact endpoints, so scale-safe):
  // cells outside it cannot hold a hit. Cheap first test for short probes.
  const far=Number.isFinite(raycaster.far)?raycaster.far:Infinity,segment=this.segment;
  if(far<Infinity){segment.makeEmpty();segment.expandByPoint(this.entry.copy(raycaster.ray.direction).multiplyScalar(raycaster.near).add(raycaster.ray.origin).applyMatrix4(this.inverse));segment.expandByPoint(this.entry.copy(raycaster.ray.direction).multiplyScalar(far).add(raycaster.ray.origin).applyMatrix4(this.inverse));segment.expandByScalar(1e-6);}
  for(const cell of cells.cells){
   if(far<Infinity&&!cell.box.intersectsBox(segment))continue;
   // Conservative: a cell is skipped only if the ray misses its box or enters it beyond far.
   if(!cell.box.containsPoint(this.localRay.origin)){if(!this.localRay.intersectBox(cell.box,this.entry))continue;if(this.entry.applyMatrix4(mesh.matrixWorld).distanceTo(raycaster.ray.origin)>raycaster.far)continue;}
   // Bounds can be replaced without changing vertex/index versions. Stock
   // raycast uses the mesh's current bounds, even when its triangle cells reuse.
   proxy.geometry=cell.geometry;proxy.geometry.boundingSphere=mesh.geometry.boundingSphere;proxy.geometry.boundingBox=mesh.geometry.boundingBox;
   this.hits.length=0;proxy.raycast(raycaster,this.hits);
   for(const hit of this.hits){hit.object=mesh;target.push(hit);}this.hits.length=0;
  }
 }
 private prepare(mesh:THREE.InstancedMesh):Cache|undefined {
  const geometry=mesh.geometry,attribute=mesh.instanceMatrix,array=attribute.array,s=geometry.boundingSphere;
  // Unknown/custom/morph paths retain the original implementation. Missing
  // bounds are initialized by that original path, not by this accelerator.
  if(mesh.constructor!==THREE.InstancedMesh||mesh.raycast!==instanceRaycast||mesh.getMatrixAt!==matrixAt||THREE.Mesh.prototype.raycast!==meshRaycast||THREE.Mesh.prototype.getVertexPosition!==vertexAt||
   attribute.constructor!==THREE.InstancedBufferAttribute||array.constructor!==Float32Array||attribute.itemSize!==16||!Number.isSafeInteger(mesh.count)||mesh.count<0||mesh.count>MESH_CAP||array.length<mesh.count*16||
   mesh.morphTexture||Object.keys(geometry.morphAttributes).length||!s||!mesh.boundingSphere||!Number.isFinite(s.radius)||s.radius<0||!s.center.toArray().every(Number.isFinite)||!mesh.matrixWorld.elements.every(Number.isFinite))return;
  const count=mesh.count,world=mesh.matrixWorld.elements,sphere=[s.center.x,s.center.y,s.center.z,s.radius];let c=this.cache.get(mesh);
  const same=c&&c.geometry===geometry&&c.array===array&&c.count===count&&sameArray(world,c.world,16)&&sameArray(sphere,c.sphere,4)&&sameBits(c.localBits,array as Float32Array,count*16);
  if(same)return c;
  let total=count;for(const [other,old] of this.cache)if(other!==mesh)total+=old.count;if(total>TOTAL_CAP)return;
  const local=new Float32Array(array.subarray(0,count*16));if(!local.every(Number.isFinite))return;
  const matrices:THREE.Matrix4[]=[],spheres:THREE.Sphere[]=[];
  for(let i=0;i<count;i++){this.local.fromArray(local,i*16);const matrix=new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld,this.local);matrices.push(matrix);spheres.push(s.clone().applyMatrix4(matrix));}
  const chunks=chunksOf(spheres);
  c={geometry,array:array as Float32Array,count,world:[...world],local,localBits:new Uint32Array(local.buffer,local.byteOffset,count*16),sphere,matrices,spheres,chunks,tree:treeOf(spheres)};this.cache.set(mesh,c);return c;
 }
 /** Refresh once for a synchronous read-only score, not once per subject ray.
  * Custom raycasts stay on the fully revalidated fallback path. */
 withQuery<T>(objects:readonly THREE.Object3D[],run:()=>T):T {
  // PERF-PASSES: a query nested in another over the same objects (every score() inside evaluate()) reuses its bounds
  // pass, whether or not the instance caches were taken (a custom raycast among the objects leaves `query` unset)
  if(this.queryDepth>0&&this.queryObjects===objects)return run();
  const previous=this.query,previousObjects=this.queryObjects,generation=this.generation;
  const stock=objects.every(o=>STOCK_RAYCASTS.has(o.raycast));
  this.query=stock&&!previous?new Map(objects.filter((o):o is THREE.InstancedMesh=>o instanceof THREE.InstancedMesh).map(o=>[o,this.prepare(o)])):undefined;
  this.queryObjects=objects;const previousBounds=this.bounds,previousBoundsObjects=this.boundsObjects;this.bounds=boundsOf(objects);this.boundsObjects=objects;this.stats.boundsPasses++;this.queryDepth++;
  try{return run();}finally{this.queryDepth--;if(this.generation===generation){this.query=previous;this.queryObjects=previousObjects;this.bounds=previousBounds;this.boundsObjects=previousBoundsObjects;}}
 }
 // Exact stock Mesh near/far sphere rejection.
 private misses(sphere:THREE.Sphere,raycaster:THREE.Raycaster){
  if(sphere.containsPoint(this.ray.origin))return false;const hit=this.ray.intersectSphere(sphere,this.point);return !hit||this.ray.origin.distanceToSquared(hit)>(raycaster.far-raycaster.near)**2;
 }
 /** Indices of current query objects whose hits could lie within r of p
  * (objects without a known bounding sphere are always kept). */
 near(p:THREE.Vector3,r:number,out:number[]){
  out.length=0;const objects=this.queryObjects,b=this.boundsObjects===objects?this.bounds:undefined;if(!objects)return out;
  for(let i=0;i<objects.length;i++){const R=b?b[i*4+3]:NaN;if(R>=0){const dx=b![i*4]-p.x,dy=b![i*4+1]-p.y,dz=b![i*4+2]-p.z;if(dx*dx+dy*dy+dz*dz>(R+r)*(R+r))continue;}
   // Validated instances: keep the mesh only if some chunk sphere reaches p.
   const c=objects[i] instanceof THREE.InstancedMesh?this.query?.get(objects[i] as THREE.InstancedMesh):undefined;
   if(c&&!c.chunks.some(k=>k.sphere.center.distanceToSquared(p)<=(k.sphere.radius+r)**2))continue;
   out.push(i);}
  return out;
 }
 /** index: position of object in the current query list, enabling the bounds pre-test. */
 intersect(object:THREE.Object3D,raycaster:THREE.Raycaster,target:THREE.Intersection[],index?:number){
  if(index!==undefined&&this.bounds&&this.boundsObjects===this.queryObjects&&this.queryObjects?.[index]===object&&segmentMisses(this.bounds,index,raycaster))return;
  if(!(object instanceof THREE.InstancedMesh)){if(!object.layers.test(raycaster.layers))return;const cells=(object as THREE.Mesh).isMesh?this.cellsOf(object as THREE.Mesh):null;if(cells&&(object as THREE.Mesh).material!==undefined)this.intersectCells(object as THREE.Mesh,cells,raycaster,target);else object.raycast(raycaster,target);return;}
  const c=this.query?this.query.get(object):this.prepare(object);if(!c){if(object.layers.test(raycaster.layers))object.raycast(raycaster,target);return;}
  if(!object.layers.test(raycaster.layers)||object.material===undefined)return;
  // Match the stock InstancedMesh whole-object sphere before per-instance work.
  this.sphere.copy(object.boundingSphere!).applyMatrix4(object.matrixWorld);if(!raycaster.ray.intersectsSphere(this.sphere))return;
  const proxy=this.proxy??(this.proxy=new THREE.Mesh(object.geometry,object.material));proxy.geometry=object.geometry;proxy.material=object.material;
  this.ray.copy(raycaster.ray).recast(raycaster.near);
  const o=raycaster.ray.origin,d=raycaster.ray.direction,near=raycaster.near,far=raycaster.far;
  // Sound pre-test: a hit lies inside the sphere at a distance in [near,far].
  const off=(q:THREE.Sphere)=>{const cx=q.center.x-o.x,cy=q.center.y-o.y,cz=q.center.z-o.z,t=Math.min(far,Math.max(near,cx*d.x+cy*d.y+cz*d.z)),dx=cx-d.x*t,dy=cy-d.y*t,dz=cz-d.z*t;return dx*dx+dy*dy+dz*dz>q.radius*q.radius;};
  // Every caller's use of the hits is order-independent (any opaque / nearest).
  if(!c.count)return;const t=c.tree,n=t.nodes,stack=this.stack;let top=0;stack[top++]=0;
  while(top){const k=stack[--top],b=k*4,cx=n[b]-o.x,cy=n[b+1]-o.y,cz=n[b+2]-o.z,u=Math.min(far,Math.max(near,cx*d.x+cy*d.y+cz*d.z)),dx=cx-d.x*u,dy=cy-d.y*u,dz=cz-d.z*u;
   if(dx*dx+dy*dy+dz*dz>n[b+3]*n[b+3])continue;
   if(t.left[k]>=0){stack[top++]=t.right[k];stack[top++]=t.left[k];continue;}
   for(let j=t.start[k],e=j+t.count[k];j<e;j++){const i=t.order[j];
    // Remaining triangles still use stock Mesh.raycast, including
    // groups/material sides/draw range/UVs.
    if(off(c.spheres[i])||this.misses(c.spheres[i],raycaster))continue;
    proxy.matrixWorld=c.matrices[i];this.hits.length=0;proxy.raycast(raycaster,this.hits);
    for(const hit of this.hits){hit.object=object;hit.instanceId=i;target.push(hit);}this.hits.length=0;
   }
  }
 }
}
/** Group nearby instances (XZ grid order) and enclose each group's spheres. */
function chunksOf(spheres:readonly THREE.Sphere[]):Chunk[]{
 const order=spheres.map((s,i)=>({i,x:Math.floor(s.center.x/CELL),z:Math.floor(s.center.z/CELL)})).sort((a,b)=>a.x-b.x||a.z-b.z||a.i-b.i),chunks:Chunk[]=[];
 for(let k=0;k<order.length;k+=CHUNK){
  const members=order.slice(k,k+CHUNK).map(o=>o.i),centre=new THREE.Vector3();for(const i of members)centre.add(spheres[i].center);centre.multiplyScalar(1/members.length);
  let radius=0;for(const i of members)radius=Math.max(radius,centre.distanceTo(spheres[i].center)+spheres[i].radius);
  // Small outward pad so floating-point rounding can only keep, never drop, a member.
  chunks.push({sphere:new THREE.Sphere(centre,radius*(1+1e-6)+1e-6),members});
 }
 return chunks;
}
/** Median-split sphere tree over instance spheres (longest centre axis). */
function treeOf(spheres:readonly THREE.Sphere[]):Tree{
 const n=spheres.length,max=2*n+1,nodes=new Float64Array(max*4),left=new Int32Array(max).fill(-1),right=new Int32Array(max).fill(-1),start=new Int32Array(max),count=new Int32Array(max),order=Int32Array.from({length:n},(_,i)=>i);
 let used=0;const centre=new THREE.Vector3();
 const build=(lo:number,hi:number):number=>{
  const k=used++;centre.set(0,0,0);for(let j=lo;j<hi;j++)centre.add(spheres[order[j]].center);if(hi>lo)centre.multiplyScalar(1/(hi-lo));
  let r=0;for(let j=lo;j<hi;j++){const q=spheres[order[j]];r=Math.max(r,centre.distanceTo(q.center)+q.radius);}
  nodes.set([centre.x,centre.y,centre.z,hi>lo?r*(1+1e-6)+1e-6:-1],k*4);start[k]=lo;count[k]=hi-lo;
  if(hi-lo>LEAF){
   let axis=0,best=-1;for(const a of [0,1,2]){let mn=Infinity,mx=-Infinity;for(let j=lo;j<hi;j++){const v=spheres[order[j]].center.getComponent(a);mn=Math.min(mn,v);mx=Math.max(mx,v);}if(mx-mn>best){best=mx-mn;axis=a;}}
   const part=Array.from(order.subarray(lo,hi)).sort((p,q)=>spheres[p].center.getComponent(axis)-spheres[q].center.getComponent(axis)||p-q);order.set(part,lo);
   const mid=(lo+hi)>>1;left[k]=build(lo,mid);right[k]=build(mid,hi);
  }
  return k;
 };
 build(0,n);return {nodes,left,right,start,count,order};
}
/** Every Mesh/InstancedMesh hit is a point inside its (stock-used) world bounding
 * sphere at a distance in [near,far]; other object kinds are never pre-rejected. */
// PERF-PASSES: ~6,000 objects per pass on Eden 2026, once per speech batch: no closures or arrays per object. A non-finite
// matrix element gives a non-finite centre or radius here (NaN/Infinity propagate through the products), so the
// finiteness test is on the result; a sphere that stays finite under such a matrix would bound the same points.
function boundsOf(objects:readonly THREE.Object3D[]):Float64Array{
 const out=new Float64Array(objects.length*4).fill(NaN);
 for(let i=0;i<objects.length;i++){
  const o=objects[i];let s:THREE.Sphere|null=null;const kind:unknown=o.constructor;
  if(kind===THREE.InstancedMesh&&o.raycast===instanceRaycast)s=(o as THREE.InstancedMesh).boundingSphere;
  else if(kind===THREE.Mesh&&o.raycast===meshRaycast)s=(o as THREE.Mesh).geometry.boundingSphere;
  if(!s||!Number.isFinite(s.radius))continue;
  const e=o.matrixWorld.elements,c=s.center,x=c.x,y=c.y,z=c.z;
  const w=1/(e[3]*x+e[7]*y+e[11]*z+e[15]),cx=(e[0]*x+e[4]*y+e[8]*z+e[12])*w,cy=(e[1]*x+e[5]*y+e[9]*z+e[13])*w,cz=(e[2]*x+e[6]*y+e[10]*z+e[14])*w;
  // Sphere.applyMatrix4: the radius scales by the matrix's largest axis scale
  const sx=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],sy=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],sz=e[8]*e[8]+e[9]*e[9]+e[10]*e[10],r=s.radius*Math.sqrt(Math.max(sx,sy,sz));
  if(!Number.isFinite(cx+cy+cz+r))continue;
  out[i*4]=cx;out[i*4+1]=cy;out[i*4+2]=cz;out[i*4+3]=r*(1+1e-6)+1e-6;
 }
 return out;
}
function segmentMisses(b:Float64Array,i:number,raycaster:THREE.Raycaster){
 const r=b[i*4+3];if(!(r>=0))return false;const o=raycaster.ray.origin,d=raycaster.ray.direction,cx=b[i*4]-o.x,cy=b[i*4+1]-o.y,cz=b[i*4+2]-o.z;
 const t=Math.min(raycaster.far,Math.max(raycaster.near,cx*d.x+cy*d.y+cz*d.z)),dx=cx-d.x*t,dy=cy-d.y*t,dz=cz-d.z*t;
 return dx*dx+dy*dy+dz*dz>r*r;
}
