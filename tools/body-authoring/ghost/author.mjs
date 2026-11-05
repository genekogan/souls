#!/usr/bin/env node
// Agent-local example: an original asymmetric rigid ghost. Dependency-free; the GLB is generated, never checked in.
// It is a ceramic body: ground navigation on the admitted disc with a visual hover, bounded body-motion/1 adapters
// and no hands. The hover is appearance only; it does not grant flight, wall traversal or phasing.
import {writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const GHOST_MANIFEST={type:'ceramic',license:'owned',rightsConfirmed:true,name:'Wisp the ghost',
 description:'A lopsided sheet ghost with a curled hem and one waving flap. Glides on the ground; cannot hold things.',
 motion:{contract:'body-motion/1',idle:{period:3.6,bob:.04,pitch:.03,roll:.06,yaw:.05},move:{period:2.8,bob:.03,pitch:.1,roll:.04,yaw:.03},
  rest:{period:6,bob:.012,pitch:.015,roll:.02,yaw:.01},dance:{period:1.2,bob:.05,pitch:.14,roll:.3,yaw:.4}}};

function glb(json,bin){
 const j=Buffer.from(JSON.stringify(json)),jp=Buffer.alloc(Math.ceil(j.length/4)*4,32);j.copy(jp);const bp=Buffer.alloc(Math.ceil(bin.length/4)*4);bin.copy(bp);
 const head=Buffer.alloc(12);head.writeUInt32LE(0x46546c67,0);head.writeUInt32LE(2,4);head.writeUInt32LE(28+jp.length+bp.length,8);
 const ch=(n,k)=>{const c=Buffer.alloc(8);c.writeUInt32LE(n,0);c.writeUInt32LE(k,4);return c;};
 return Buffer.concat([head,ch(jp.length,0x4e4f534a),jp,ch(bp.length,0x004e4942),bp]);
}

/** Lathe a sheet profile, then bend it: the crown leans left, the hem curls, one flap reaches out to the right. */
export function authorGhost({out}={}){
 const rings=18,seg=32,pts=[];
 for(let i=0;i<=rings;i++){const t=i/rings,y=1-t,dome=Math.sqrt(Math.sin(Math.min(1,t*1.8)*Math.PI/2));
  const row=[];for(let k=0;k<seg;k++){const a=2*Math.PI*k/seg,hem=t>.7?.05*Math.sin(5*a+1.3)*(t-.7)/.3:0;
   let r=(.01+.33*dome)*(1+.08*Math.cos(a-.6))+(t>.85?.04*(t-.85)/.15:0),x=r*Math.sin(a),z=r*Math.cos(a),yy=y+hem;
   x-=.12*y*y;                                        // the crown leans to its left
   if(t>.35&&t<.7&&Math.sin(a)>.75)x+=.16*Math.sin((t-.35)/.35*Math.PI)*(Math.sin(a)-.75)/.25; // one flap, right side only
   row.push([x,yy*.95+.02,z]);}pts.push(row);}
 const eye=(a,y)=>[[-.3,.74,.11,.07],[.28,.77,.13,.08],[.02,.58,.16,.035]].some(([ea,ey,w,h])=>((a-ea)/w)**2+((y-ey)/h)**2<1); // uneven eyes, a crooked mouth
 const pos=[],nrm=[],col=[];
 const tri=(p,c)=>{const e1=p[1].map((v,i)=>v-p[0][i]),e2=p[2].map((v,i)=>v-p[0][i]),n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]],l=Math.hypot(...n)||1;for(const q of p){pos.push(...q);nrm.push(...n.map(v=>v/l));col.push(...c);}};
 for(let i=0;i<rings;i++)for(let k=0;k<seg;k++){const k2=(k+1)%seg,a=pts[i][k],b=pts[i][k2],c=pts[i+1][k],d=pts[i+1][k2];
  const angle=2*Math.PI*(k+.5)/seg,wrapped=Math.atan2(Math.sin(angle),Math.cos(angle)),y=1-(i+.5)/rings;
  const colour=eye(wrapped,y)?[.08,.09,.14]:i>=rings-2?[.78,.86,.95]:[.93,.95,.99];
  tri([a,c,b],colour);tri([b,c,d],colour);}
 // Close the crown so no hole shows from above.
 const top=[pts[0].reduce((s,p)=>s+p[0],0)/seg,pts[0][0][1]+.01,pts[0].reduce((s,p)=>s+p[2],0)/seg];
 for(let k=0;k<seg;k++)tri([top,pts[0][k],pts[0][(k+1)%seg]],[.95,.97,1]);
 const P=new Float32Array(pos),N=new Float32Array(nrm),C=new Float32Array(col),count=P.length/3;
 const lo=[0,1,2].map(a=>Math.min(...pos.filter((_,i)=>i%3===a))),hi=[0,1,2].map(a=>Math.max(...pos.filter((_,i)=>i%3===a)));
 const bin=Buffer.concat([Buffer.from(P.buffer),Buffer.from(N.buffer),Buffer.from(C.buffer)]);
 const bytes=glb({asset:{version:'2.0',generator:'Wisp agent-local ghost authoring example'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Wisp',mesh:0}],
  materials:[{name:'Sheet',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:.9}}],
  meshes:[{name:'Wisp original sheet',primitives:[{attributes:{POSITION:0,NORMAL:1,COLOR_0:2},material:0}]}],buffers:[{byteLength:bin.length}],
  bufferViews:[0,1,2].map(i=>({buffer:0,byteOffset:i*P.byteLength,byteLength:P.byteLength,target:34962})),
  accessors:[{bufferView:0,componentType:5126,count,type:'VEC3',min:lo,max:hi},{bufferView:1,componentType:5126,count,type:'VEC3'},{bufferView:2,componentType:5126,count,type:'VEC3'}]},bin);
 const manifest=structuredClone(GHOST_MANIFEST);
 if(out){out=resolve(out);mkdirSync(out,{recursive:true});writeFileSync(join(out,'body.glb'),bytes);writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,1)+'\n');}
 return {bytes,manifest,stats:{body:'Wisp',bytes:bytes.length,triangles:count/3,drawCalls:1,images:0,clips:[]}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(authorGhost({out:process.argv[2]}).stats));
