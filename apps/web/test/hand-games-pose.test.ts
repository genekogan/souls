// Entry 35 (packet 44): holding hands and rock-paper-scissors drawn on the real rig through the replay path
// (HumanViews.setFrame → render), from the recorded body state alone: the joined palms meet between the two bodies
// (standing and walking), arms within reach and in the lane between the bodies; the RPS fists count in step and throw
// rock, paper and scissors on the finger bones; every frame-to-frame palm step stays within the entry's bounds.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {ConvexHull} from 'three/addons/math/ConvexHull.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanViews,eachSkinnedWorld,type SampledHuman} from '../../../mars/viewer/app/engine-view/humans.ts';
import {templateFromGltf,type Template} from '../../../mars/viewer/app/engine-view/people.ts';
import {HAND_GAP,JOIN_SECONDS,RELEASE_SECONDS,HAND_STATE_TAIL,type HandHoldState} from '../../../mars/viewer/engine/social/hand-hold.ts';
import {RPS,RPS_STATE_TAIL,type RpsShape} from '../../../mars/viewer/engine/social/rps.ts';
import {CHARACTER_WIRE} from '../../../mars/viewer/app/engine-view/character-wire.ts';
import {HumanoidKit} from '../src/humanoid/compose.ts';
const RIGS=(process.env.HG_RIGS??'casual,wire-casual,wire-punk,wire-woman,kit-masc,kit-fem').split(',');

const DT=.05;
const tpls:Record<string,Template>={};
/** A GLB with its textures stripped (node has no image decoder). */
async function glb(file:string){
 const source=readFileSync(new URL(`../../../mars/viewer/public/modular/environment/${file}`,import.meta.url));
 const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
 if(json.materials)json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:.8}}));delete json.textures;delete json.images;delete json.samplers;
 let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
 const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
 const bytes=Buffer.concat([header,chunk,bin]);return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}
/** `name`: a source GLB (casual/punk/woman), or `wire-<name>`: the mesh + shared clips files the live client loads
 *  (people.ts loadTemplates; character-wire.ts), whose hands rest in other poses. */
async function views(name='casual'){
 if(!tpls[name]){
  if(name.startsWith('kit-')){const kit=new HumanoidKit(new GLTFLoader(),'/modular/humanoid/',async url=>{const b=readFileSync(new URL('../../../mars/viewer/public'+url,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;});tpls[name]=await kit.template({frame:name.slice(4) as 'masc'|'fem',preset:name==='kit-fem'?'woman':'casual'} as never);}
  else if(name.startsWith('wire-')){const w=CHARACTER_WIRE[name.slice(5) as keyof typeof CHARACTER_WIRE],g=await glb(w.mesh);g.animations=(await glb(w.clips)).animations.map(c=>c.clone());tpls[name]=templateFromGltf('hg-'+name,g);}
  else tpls[name]=templateFromGltf('hg-'+name,await glb(`animated-${name}.glb`));
 }
 const v=new HumanViews();v.setTemplates([tpls[name]]);return v;
}
type Bones={arms:{side:string;palm:number[];shoulder:number[];len:number}[];hipY:number;handGame?:{kind:string;w:number;curl:number[];shape?:string}};
const draw=(v:HumanViews,fs:SampledHuman[],k:number)=>{v.setFrame(fs,k*DT);v.render(1);return v.bones() as unknown as Record<string,Bones>;};
const palmOf=(b:Bones,side:string)=>b.arms.find(a=>a.side===side)!.palm;
const d3=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
/** Body-frame palm step: palm minus root, rotated into the body's heading (walking the body does not count). */
const bodyStep=(a:number[],pa:number[],ya:number,b:number[],pb:number[],yb:number)=>{const l=(q:number[],p:number[],y:number)=>{const x=q[0]-p[0],z=q[2]-p[2];return [x*Math.cos(y)+z*Math.sin(y),q[1]-p[1],-x*Math.sin(y)+z*Math.cos(y)];};return d3(l(a,pa,ya),l(b,pb,yb));};

for(const rig of RIGS)test(`holding hands (${rig}): palms meet palm to palm between the bodies, standing and walking; join and release are smooth`,async()=>{
 const v=await views(rig),since=100,release=since+Math.round((JOIN_SECONDS+3)/DT)+60;
 const hold=(hand:'left'|'right',other:string,k:number):HandHoldState=>({with:other,hand,...(hand==='right'?{offered:since-30}:{}),...(k>=since?{since}:{}),...(k>=release?{release}:{})});
 // a stands still for the offer and the join, both walk along +x at 1 m/s for 3 s, stop, stand, let go
 const walkFrom=since+Math.round((JOIN_SECONDS+.5)/DT),walkTo=walkFrom+60;
 const x=(k:number)=>k<walkFrom?0:k<walkTo?(k-walkFrom)*DT*1.0:(walkTo-walkFrom)*DT*1.0;
 const wOf=(k:number)=>{const s=(u:number)=>u<=0?0:u>=1?1:u*u*(3-2*u);return Math.max(0,Math.min(s((k-walkFrom+5)/11),1-s((k-walkTo+5)/11)));};
 let worstFace=-1,worstGap=0,worstReach=0,minLane=Infinity,worstStep=0,worstWalkStep=0,prev:{a:number[][];pa:number[];b:number[][];pb:number[]}|null=null;const kinds=new Set<string>();
 for(let k=since-40;k<=release+Math.round((RELEASE_SECONDS+HAND_STATE_TAIL)/DT)+10;k++){
  const xa=x(k),pa:[number,number,number]=[xa,0,0],pb:[number,number,number]=[xa,0,HAND_GAP],w=wOf(k);
  const f=(id:string,p:[number,number,number],hand:'left'|'right',other:string):SampledHuman=>({id,p,yaw:0,walk:w,walkDist:xa,activity:w>.02?'walk':'idle',speed:w>.02?1:0,restAge:30,handHold:hold(hand,other,k),handGameTick:k,handGameDt:DT});
  const B=draw(v,[f('hg_a',pa,'right','hg_b'),f('hg_b',pb,'left','hg_a')],k),A=B.hg_a,Bb=B.hg_b;
  if(A.handGame)kinds.add(A.handGame.kind);
  const joined=k>=since+JOIN_SECONDS/DT&&k<release;
  if(joined){const L=palmOf(A,'right'),R=palmOf(Bb,'left');worstGap=Math.max(worstGap,d3(L,R));const na=(A.handGame as unknown as {normal:number[]}).normal,nb=(Bb.handGame as unknown as {normal:number[]}).normal;worstFace=Math.max(worstFace,na[0]*nb[0]+na[1]*nb[1]+na[2]*nb[2]);
   for(const [b,side,p] of [[A,'right',pa],[Bb,'left',pb]] as const){const arm=b.arms.find(a=>a.side===side)!;worstReach=Math.max(worstReach,d3(arm.palm,arm.shoulder)/arm.len);minLane=Math.min(minLane,Math.abs(arm.palm[2]-p[2]));}}
  const now={a:A.arms.map(a=>a.palm),pa,b:Bb.arms.map(a=>a.palm),pb};
  if(prev){for(const [q0,p0,q1,p1] of [[prev.a,prev.pa,now.a,now.pa],[prev.b,prev.pb,now.b,now.pb]] as const)for(let j=0;j<2;j++){const s=bodyStep(q0[j],p0,0,q1[j],p1,0);if(w>.02||wOf(k-1)>.02){if(s>worstWalkStep&&process.env.HG_DEBUG)console.log('walkstep',k,j,s.toFixed(3),w.toFixed(2));worstWalkStep=Math.max(worstWalkStep,s);}else{if(s>worstStep&&process.env.HG_DEBUG)console.log('step',k,j,s.toFixed(3));worstStep=Math.max(worstStep,s);}}}
  prev=now;
 }
 if(process.env.HG_DEBUG)console.log({worstFace,worstGap,worstReach,minLane,worstStep,worstWalkStep,kinds:[...kinds]});
 assert.deepEqual([...kinds].sort(),['hold','offer']);
 assert.ok(worstFace<=-.8,`the two joined palms face each other (normals' dot ${worstFace.toFixed(3)})`);
 assert.ok(worstGap<=.06,`joined palm centres ${worstGap.toFixed(3)} m apart (≤ 0.06: palm to palm)`);
 assert.ok(worstReach<=.9,`joined arm reach ${worstReach.toFixed(3)} arm lengths (no stretching)`);
 assert.ok(minLane>=.17,`joined palms ${minLane.toFixed(3)} m from a body axis (in the lane between them)`);
 assert.ok(worstStep<=.08,`standing palm step ${worstStep.toFixed(3)} m per 50 ms (offer, join, release)`);
 assert.ok(worstWalkStep<=.12,`walking palm step ${worstWalkStep.toFixed(3)} m per 50 ms`);
});

for(const rig of RIGS)for(const shape of ['rock','paper','scissors'] as RpsShape[])test(`rock-paper-scissors (${rig}, ${shape}): three pumps in step, the throw on the fourth beat, ${shape} on the finger bones`,async()=>{
 const v=await views(rig),start=100,shoot=start+Math.round(RPS.SHOOT/DT);
 let worstBoundary=0,worstInterior=0,prev:{q:number[];r:number[]}|null=null;const lows:number[][]=[[],[]];let held:number[]|null=null,heldPrev=Infinity,facingAt:{normal:number[];curlSide:number;knuckles:number[]}|null=null;
 const ys:number[][]=[[],[]];
 const end=start+Math.round(RPS.SECONDS/DT);
 for(let k=start-10;k<=end+Math.round(RPS_STATE_TAIL/DT)+5;k++){
  const rps=(s:RpsShape)=>({start,shoot,...(k>=shoot?{shape:s}:{}),...(k>=end?{end}:{})});
  const f=(id:string,p:[number,number,number],yaw:number,s:RpsShape):SampledHuman=>({id,p,yaw,walk:0,walkDist:0,activity:k>=start&&k<end?'rps':'idle',...(k<start?{restAge:30}:k>=end?{restAge:(k-end)*DT,prevActivity:'rps',activityAge:(k-end)*DT}:{}),...(k>=start&&k<end+RPS_STATE_TAIL/DT?{rps:rps(s),handGameTick:k,handGameDt:DT}:{})});
  const B=draw(v,[f('rps_a',[0,0,0],0,shape),f('rps_b',[1,0,0],Math.PI,'rock')],k),A=B.rps_a;
  const q=palmOf(A,'right'),r=palmOf(B.rps_b,'right');ys[0].push(q[1]);ys[1].push(r[1]);
  if(k>=end&&k<end+20&&!process.env.NO_HOLD)assert.ok((A as unknown as {variety:number}).variety<1e-6,'no idle gesture in the first second after the count');
  if(prev){const s=Math.max(d3(prev.q,q),d3(prev.r,r)),t=(k-start)*DT,near=[0,RPS.RAISE,RPS.FIRST,RPS.FIRST+RPS.BEAT,RPS.FIRST+2*RPS.BEAT,RPS.SHOOT,RPS.HOLD_END,RPS.DOWN_END].some(b=>Math.abs(t-b)<=.5);
   if(t>RPS.FIRST-RPS.BEAT&&t<RPS.SHOOT+.3)worstInterior=Math.max(worstInterior,s);if(near){if(s>worstBoundary&&process.env.HG_DEBUG)console.log('bstep',t.toFixed(2),s.toFixed(3),d3(prev.q,q).toFixed(3),d3(prev.r,r).toFixed(3));worstBoundary=Math.max(worstBoundary,s);}}
  prev={q,r};
  if(k===shoot+20){held=A.handGame!.curl;facingAt=(A.handGame as unknown as {normal:number[];curlSide:number;knuckles:number[]});}
  if(k===shoot-5)heldPrev=A.handGame!.curl[0];
 }
 // the low points of both fists fall on the same samples (one shared count)
 for(const y of ys){const idx:number[]=[];for(let i=1;i+1<y.length;i++)if(y[i]<y[i-1]&&y[i]<=y[i+1])idx.push(i);lows[ys.indexOf(y)]=idx;}
 if(process.env.HG_DEBUG)console.log(rig,shape,{worstBoundary,worstInterior,held,facingAt});
 const want=[RPS.FIRST,RPS.FIRST+RPS.BEAT,RPS.FIRST+2*RPS.BEAT].map(t=>Math.round(t/DT)+10);
 for(const k of want)assert.ok(lows[0].some(i=>Math.abs(i-k)<=1)&&lows[1].some(i=>Math.abs(i-k)<=1),`both fists down on the beat at sample ${k}: ${lows[0]} / ${lows[1]}`);
 assert.ok(worstInterior<=.10,`count interior ${worstInterior.toFixed(3)} m per 50 ms`);
 assert.ok(worstBoundary<=.10,`near the boundaries ${worstBoundary.toFixed(3)}`);
 const [ix,mid,ring,pinky,heldThumb]=held!;
 assert.ok(heldPrev>=1.6,'a fist while counting');
 if(shape==='rock'){assert.ok([ix,mid,ring,pinky].every(c=>c>=1.6),'rock: all curled '+held+' (thumb '+heldThumb+')');assert.ok(facingAt!.curlSide>.01,'the fingers curl to the palm side of the drawn palm frame');assert.ok((facingAt as unknown as {thumbGap:number}).thumbGap<=.03,'the thumb lies across the fist: '+(facingAt as unknown as {thumbGap:number}).thumbGap);assert.ok((facingAt as unknown as {knuckles:number[]}).knuckles.every(k=>k>=.9),'the knuckles bend (a fist, not a claw): '+(facingAt as unknown as {knuckles:number[]}).knuckles);}
 if(shape==='paper')assert.ok(facingAt!.normal[1]<-.9,'paper: palm down '+facingAt!.normal);
 if(shape==='scissors')assert.ok(facingAt!.normal[2]<-.8,'scissors: palm in (the right hand, facing +x: in is −z) '+facingAt!.normal);
 if(shape==='paper')assert.ok([ix,mid,ring,pinky].every(c=>c<=.35),'paper: all straight '+held);
 if(shape==='scissors')assert.ok(ix<=.35&&mid<=.35&&ring>=1.6&&pinky>=1.6,'scissors: two out, two in '+held);
});

// Take 3 (17:37Z): an offered hand that began while the arm was up in an idle gesture (a hand at the hair) came down at
// 0.118 m per 50 ms; the count's raise out of a gesture cut the variety in one frame. A hand game starting out of the
// highest gesture an idle body plays must stay within the boundary bound.
for(const rig of ['wire-woman','kit-fem','kit-masc'])test(`a hand game starting out of a raised idle gesture (${rig}): offer, join and the count's raise stay within 0.08 m per 50 ms`,async()=>{
 const v=await views(rig),ids=['g_a','g_b','g_c','g_d','g_e','g_f'];let worst=0,cases=0,minTorsoClearance=Infinity;
 for(const id of ids){
  // find a moment this body holds a hand up in its idle variety (standing still a long while)
  let k0=-1;for(let k=400;k<4000;k+=5){const b=draw(v,[{id,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:'idle',restAge:60}],k)[id] as unknown as Bones&{variety:number};if(b.variety>.95&&Math.max(...b.arms.map(a=>a.palm[1]))>1.3){k0=k+20;break;}}
  if(k0<0)continue;cases++;
  for(const kind of ['offer','join','rps']){
   let prev:number[][]|null=null;
   for(let k=k0-10;k<k0+Math.round(3.5/DT);k++){
    const f:SampledHuman=kind==='rps'?{id,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:k>=k0?'rps':'idle',restAge:60,...(k>=k0?{rps:{start:k0,shoot:k0+Math.round(RPS.SHOOT/DT)},handGameTick:k,handGameDt:DT}:{})}
     :{id,p:[0,0,0],yaw:0,walk:0,walkDist:0,activity:'idle',restAge:60,handHold:{with:'g_partner',hand:'right',...(kind==='offer'?{offered:k0}:{since:k0})},handGameTick:k,handGameDt:DT};
    const partner:SampledHuman={id:'g_partner',p:[0,0,HAND_GAP],yaw:0,walk:0,walkDist:0,activity:'idle',restAge:60,handHold:{with:id,hand:'left',...(kind==='join'?{since:k0}:{})},handGameTick:k,handGameDt:DT};
    const b=draw(v,kind==='rps'?[f]:[f,partner],k)[id],now=b.arms.map(a=>a.palm);
    if(kind==='rps'){const arm=b.arms.find(a=>a.side==='right')!;minTorsoClearance=Math.min(minTorsoClearance,torsoClearance(v,id,arm.palm,b.hipY,arm.shoulder[1]));}
    if(prev&&k>k0)for(let j=0;j<2;j++){const s=d3(prev[j],now[j]);if(s>worst&&process.env.HG_DEBUG)console.log(rig,id,kind,k-k0,j,s.toFixed(3));worst=Math.max(worst,s);}
    prev=now;
   }
  }
 }
 console.log(JSON.stringify({rig,raisedGestureMinimumTorsoClearance:minTorsoClearance}));
 assert.ok(minTorsoClearance>=0,`raised-idle RPS palm clearance ${minTorsoClearance.toFixed(4)} m`);
 assert.ok(cases>=2,'raised gestures found '+cases);
 assert.ok(worst<=.08,`palm step out of a raised gesture ${worst.toFixed(3)} m per 50 ms`);
});


// F4: a real-rig torso envelope, rather than the hand-game target alone. Bone blending can
// send a palm through the body even when the final IK goal is in front of the shoulder.
type TorsoView={rig:{holder:THREE.Object3D};surf:{body:{mesh:THREE.SkinnedMesh;idx:number[]}[];hand:Map<number,{mesh:THREE.SkinnedMesh;idx:number[]}[]>}};
function torsoClearance(v:HumanViews,id:string,palm:number[],hip:number,shoulder:number){
 const view=(v as unknown as {views:Map<string,TorsoView>}).views.get(id)!;
 const points:THREE.Vector3[]=[];
 eachSkinnedWorld(view.surf.body,new THREE.Vector3(),p=>{if(p.y>=hip-.05&&p.y<=shoulder+.03)points.push(p.clone());});
 assert.ok(points.length>=20,'the real rig supplies a torso surface');
 const hull=new ConvexHull().setFromPoints(points),p=new THREE.Vector3(...palm);
 const margins=hull.faces.map(face=>face.distanceToPoint(p)-.035);
 const hand=view.surf.hand.get(-1);assert.ok(hand?.length,'actual right-hand skin vertices');
 eachSkinnedWorld(hand,new THREE.Vector3(),q=>{hull.faces.forEach((face,i)=>{margins[i]=Math.min(margins[i],face.distanceToPoint(q));});});
 // A single separating torso plane excludes the entire hand's convex skin envelope,
 // including edges between vertices, and the 3.5 cm palm sphere.
 return Math.max(...margins);
}
for(const rig of RIGS)for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2])for(const shape of ['rock','paper','scissors'] as RpsShape[])test(`rock-paper-scissors torso clearance (${rig}, yaw ${yaw}, ${shape}): rendered palm clears the body throughout ready and return`,async()=>{
 const v=await views(rig),start=100,shoot=start+Math.round(RPS.SHOOT/DT),end=start+Math.round(RPS.SECONDS/DT);
 let minimum=Infinity,worstAt=0;
 for(let k=start-10;k<=end+Math.round(RPS_STATE_TAIL/DT)+5;k++){
  const f:SampledHuman={id:'clearance',p:[0,0,0],yaw,walk:0,walkDist:0,activity:k>=start&&k<end?'rps':'idle',...(k<start?{restAge:30}:k>=end?{restAge:(k-end)*DT,prevActivity:'rps',activityAge:(k-end)*DT}:{}),...(k>=start&&k<end+RPS_STATE_TAIL/DT?{rps:{start,shoot,...(k>=shoot?{shape}:{}),...(k>=end?{end}:{})},handGameTick:k,handGameDt:DT}:{})};
  const b=draw(v,[f],k).clearance,arm=b.arms.find(a=>a.side==='right')!;
  const clearance=torsoClearance(v,'clearance',arm.palm,b.hipY,arm.shoulder[1]);
  if(clearance<minimum){minimum=clearance;worstAt=(k-start)*DT;}
 }
 console.log(JSON.stringify({rig,yaw,shape,minimumHandTorsoPlaneMargin:minimum,worstAtSeconds:worstAt}));
 assert.ok(minimum>=0,`${rig}: palm clearance ${minimum.toFixed(4)} m at ${worstAt.toFixed(2)} s`);
});
