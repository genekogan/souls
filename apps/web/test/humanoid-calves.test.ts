import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanoidKit} from '../src/humanoid/compose.ts';
import {resolveLook,type Look} from '../src/humanoid/look.ts';
const kit=new HumanoidKit(new GLTFLoader(),'/modular/humanoid/',async url=>{const b=readFileSync(new URL('../../../mars/viewer/public'+url,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;});
const manifest=await kit.manifest();
type Assembly={geometries:(look:Look)=>Promise<THREE.BufferGeometry[]>};
const hash=(g:THREE.BufferGeometry)=>{const h=createHash('sha256');for(const a of [g.index!,...Object.values(g.attributes)])h.update(new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength));return h.digest('hex');};
type Face=[THREE.Vector3,THREE.Vector3,THREE.Vector3];
const cache=new WeakMap<THREE.BufferGeometry,Face[]>();
function faces(g:THREE.BufferGeometry){let fs=cache.get(g);if(fs)return fs;fs=[];const p=g.attributes.position,ix=g.index!;for(let k=0;k<ix.count;k+=3)fs.push([0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,ix.getX(k+j))) as Face);cache.set(g,fs);return fs;}
/** Independent triangle/plane sections, then union of their angular intervals: checks all
 * directions at each sampled height rather than repeating the implementation's 16 rays. */
function covered(gs:THREE.BufferGeometry[],centre:THREE.Vector3,side:number){
 const intervals:number[][]=[];
 for(const g of gs)for(const vs of faces(g)){
  if(vs.every(v=>v.y<centre.y)||vs.every(v=>v.y>centre.y))continue;const points:THREE.Vector3[]=[];
  for(let i=0;i<3;i++){const a=vs[i],b=vs[(i+1)%3];if((a.y<centre.y)!==(b.y<centre.y))points.push(a.clone().lerp(b,(centre.y-a.y)/(b.y-a.y)));}
  if(points.length!==2||points.some(p=>p.x*side<0))continue;
  const [a,b]=points.map(p=>p.sub(centre));if(Math.max(a.length(),b.length())>.14||Math.min(a.length(),b.length())<.001)continue;
  let start=Math.atan2(a.z,a.x),end=Math.atan2(b.z,b.x);if(start<0)start+=Math.PI*2;if(end<0)end+=Math.PI*2;if(end<start)[start,end]=[end,start];
  if(end-start>Math.PI){intervals.push([0,start],[end,Math.PI*2]);}else intervals.push([start,end]);
 }
 intervals.sort((a,b)=>a[0]-b[0]);let end=0;for(const [a,b] of intervals){if(a>end+1e-5)return false;end=Math.max(end,b);}return end>=Math.PI*2-1e-5;
}
test('all 882 catalogue pairs: sampled lower-leg sections, original buffers and shoe membership',async()=>{
 const failures:unknown[]=[],raw=new Map<THREE.BufferGeometry,string>();let pairs=0,repaired=0,maxVertices=0,maxTriangles=0;
 for(const frame of ['masc','fem']){const rig=await kit.rig(frame);
  for(const bottom of Object.keys(manifest.parts.bottom))for(const shoes of Object.keys(manifest.parts.shoes)){
   const b=await kit.part('bottom',bottom,frame),s=await kit.part('shoes',shoes,frame);for(const g of [b,s])if(!raw.has(g))raw.set(g,hash(g));
   const geos=await(kit as unknown as Assembly).geometries(resolveLook({frame,preset:'none',bottom,shoes})),added=geos[2].attributes.position.count-b.attributes.position.count,tris=(geos[2].index!.count-b.index!.count)/3;
   assert.equal(geos[3],s,'the exact original shoe geometry stays in its semantic slot');assert.ok(added===0||added===224);assert.ok(tris===0||tris===384);if(added)repaired++;maxVertices=Math.max(maxVertices,added);maxTriangles=Math.max(maxTriangles,tris);
   let missed=0;for(const [side,sign] of [['L',1],['R',-1]] as const){const ankle=rig.joints[rig.names.indexOf('Foot'+side)],knee=rig.joints[rig.names.indexOf('LowerLeg'+side)];
    for(const u of [.15,.25,.35,.45,.55,.65,.75,.85,.95,1.02]){const c=ankle.clone().lerp(knee,u);if(!covered([geos[2],s],c,sign))missed++;}
   }if(missed)failures.push({frame,bottom,shoes,missed});pairs++;
  }
 }
 for(const [g,before]of raw)assert.equal(hash(g),before,'shared source positions, normals, indices and skin attributes unchanged');
 console.log(JSON.stringify({pairs,repaired,maxVertices,maxTriangles,failures}));assert.equal(pairs,882);assert.equal(failures.length,0,JSON.stringify(failures.slice(0,12)));
});
