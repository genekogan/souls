// Missing calves in mixed outfits: a static bind-space assembly, never a frame hook.
// The pinned beach bottom supplies the anatomical skin profile. Original parts stay untouched.
import * as THREE from 'three';
type Rig = {names:string[];joints:THREE.Vector3[]};
type Face={a:THREE.Vector3;b:THREE.Vector3;c:THREE.Vector3;ids:number[];lo:number;hi:number};
const faces=new WeakMap<THREE.BufferGeometry,{all:Face[];skin:Face[]}>();
const V=()=>new THREE.Vector3(),SIDES=['L','R'] as const,N=16,LEVELS=[.1,.24,.4,.58,.78,.96,1.06];
function triangles(g:THREE.BufferGeometry){
 let cached=faces.get(g);if(cached)return cached;cached={all:[],skin:[]};
 const p=g.attributes.position,h=g.attributes.hinfo,ix=g.index!;
 for(let k=0;k<ix.count;k+=3){const ids=[0,1,2].map(j=>ix.getX(k+j)),[a,b,c]=ids.map(i=>V().fromBufferAttribute(p,i));
  const f={a,b,c,ids,lo:Math.min(a.y,b.y,c.y),hi:Math.max(a.y,b.y,c.y)};cached.all.push(f);
  if(ids.every(i=>h.getX(i)<=1))cached.skin.push(f);
 }faces.set(g,cached);return cached;
}
function centre(rig:Rig,side:string,y:number){const a=rig.joints[rig.names.indexOf('Foot'+side)],b=rig.joints[rig.names.indexOf('LowerLeg'+side)];return a.clone().lerp(b,(y-a.y)/(b.y-a.y));}
const ray=new THREE.Ray(),point=V(),bary=V();
function nearest(fs:Face[],o:THREE.Vector3,d:THREE.Vector3){
 ray.set(o,d);let distance=Infinity,face:Face|undefined,at:THREE.Vector3|undefined;
 for(const f of fs){if(o.y<f.lo-1e-7||o.y>f.hi+1e-7)continue;if(!ray.intersectTriangle(f.a,f.b,f.c,false,point))continue;const r=point.distanceTo(o);if(r>.001&&r<.14&&r<distance){distance=r;face=f;at=point.clone();}}
 return {distance,face,at};
}
function weights(g:THREE.BufferGeometry,f:Face,p:THREE.Vector3){
 THREE.Triangle.getBarycoord(p,f.a,f.b,f.c,bary);const sum=new Map<number,number>(),j=g.attributes.skinIndex,w=g.attributes.skinWeight;
 f.ids.forEach((id,k)=>{for(let n=0;n<4;n++){const bone=j.getComponent(id,n),value=w.getComponent(id,n)*bary.getComponent(k);sum.set(bone,(sum.get(bone)??0)+value);}});
 const top=[...sum].filter(([,w])=>w>1e-7).sort((a,b)=>b[1]-a[1]).slice(0,4),total=top.reduce((n,[,w])=>n+w,0),raw=top.map(([,w])=>w/total*255),q=raw.map(Math.floor);
 const order=raw.map((w,i)=>[w-q[i],i]).sort((a,b)=>b[0]-a[0]);let left=255-q.reduce((a,b)=>a+b,0);for(let i=0;left>0;i++,left--)q[order[i%order.length][1]]++;
 return {j:Array.from({length:4},(_,i)=>top[i]?.[0]??0),w:Array.from({length:4},(_,i)=>q[i]??0)};
}
/** Sixteen radial samples at every source vertex interval (plus regular 1 cm planes).
 * A distant opposite leg is excluded by the 14 cm radial bound. Cold assembly only. */
export function calfMissing(bottom:THREE.BufferGeometry,shoes:THREE.BufferGeometry,rig:Rig){
 const fs=[...triangles(bottom).all,...triangles(shoes).all];
 for(const side of SIDES){const ankle=rig.joints[rig.names.indexOf('Foot'+side)],knee=rig.joints[rig.names.indexOf('LowerLeg'+side)],lo=ankle.y+(knee.y-ankle.y)*LEVELS[0],hi=ankle.y+(knee.y-ankle.y)*LEVELS.at(-1)!;
  const planes=new Set<number>([lo,hi]);for(let y=lo;y<hi;y+=.01)planes.add(y);
  for(const f of fs)for(const p of [f.a,f.b,f.c])if(p.y>lo&&p.y<hi)planes.add(p.y);
  const ys=[...planes].sort((a,b)=>a-b);
  for(let i=1;i<ys.length;i++){const y=(ys[i-1]+ys[i])/2,o=centre(rig,side,y);for(let n=0;n<N;n++){const d=V().set(Math.cos(n*Math.PI*2/N),0,Math.sin(n*Math.PI*2/N));if(!Number.isFinite(nearest(fs,o,d).distance))return true;}}
 }return false;
}
/** At most 224 vertices / 384 triangles, merged into the existing bottom draw.
 * No sole/foot-dominant vertex is introduced. Added GPU geometry is an explicit cost. */
export function calfSkin(bottom:THREE.BufferGeometry,shoes:THREE.BufferGeometry,donor:THREE.BufferGeometry,rig:Rig):THREE.BufferGeometry{
 const source=triangles(donor).skin,cover=[...triangles(bottom).all,...triangles(shoes).all],low=Math.min(...source.map(f=>f.lo)),positions:number[]=[],joints:number[]=[],skinWeights:number[]=[],indices:number[]=[];
 for(const side of SIDES){const ankle=rig.joints[rig.names.indexOf('Foot'+side)],knee=rig.joints[rig.names.indexOf('LowerLeg'+side)],base=positions.length/3;
  for(const u of LEVELS){const y=ankle.y+(knee.y-ankle.y)*u,probeY=Math.max(y,low+.015),o=centre(rig,side,y),probe=centre(rig,side,probeY);
   for(let n=0;n<N;n++){const d=V().set(Math.cos(n*Math.PI*2/N),0,Math.sin(n*Math.PI*2/N)),sample=nearest(source,probe,d);if(!sample.face||!sample.at)throw Error('calf donor lacks a closed skin profile');
    const taper=y<probeY?Math.max(.55,(y-ankle.y)/(probeY-ankle.y)):1,under=nearest(cover,o,d).distance;
    const r=Math.max(.002,Math.min(sample.distance*.96*taper,under-.003));const p=o.clone().addScaledVector(d,r);positions.push(p.x,p.y,p.z);
    const wt=weights(donor,sample.face,sample.at),dominant=rig.names[wt.j[wt.w.indexOf(Math.max(...wt.w))]];if(/^(Foot|Toe)/.test(dominant))throw Error('calf donor would change sole membership');joints.push(...wt.j);skinWeights.push(...wt.w);
   }
  }
  for(let ring=0;ring<LEVELS.length-1;ring++)for(let n=0;n<N;n++){const a=base+ring*N+n,b=base+(ring+1)*N+n,a1=base+ring*N+(n+1)%N,b1=base+(ring+1)*N+(n+1)%N;indices.push(a,b,a1,a1,b,b1);}
 }
 const g=new THREE.BufferGeometry(),count=positions.length/3;g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();
 const normal=g.attributes.normal,q=new Int8Array(count*3),info=new Uint8Array(count*4);for(let i=0;i<count;i++){for(let j=0;j<3;j++)q[i*3+j]=Math.round(normal.getComponent(i,j)*127);info.set([0,1,158,0],i*4);}
 g.setAttribute('normal',new THREE.BufferAttribute(q,3,true));g.setAttribute('skinIndex',new THREE.Uint8BufferAttribute(joints,4));g.setAttribute('skinWeight',new THREE.Uint8BufferAttribute(skinWeights,4,true));g.setAttribute('hinfo',new THREE.BufferAttribute(info,4));g.userData.calfRepair={vertices:count,triangles:indices.length/3};return g;
}
