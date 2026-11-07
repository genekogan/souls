import * as THREE from 'three';
import {surfaceKit} from './WorldEdenSurfaceKit.ts';
/** Presentation-only surface realism. Patches the fragment colour/roughness of
 * existing MeshStandardMaterials with cheap world-space procedural variation
 * (two-to-three value-noise taps, no textures, no loops, no extra passes).
 * Geometry, transforms, names, draw lists, shadows and transparency are never
 * touched; one shared program variant serves every class via a uniform. */
export type RealismClass='water'|'ground'|'path'|'soil'|'foliage'|'flower'|'bark'|'wood'|'plaster'|'stone'|'roof'|'metal'|'skin'|'cloth'|'generic';
const CLASS_ID:Record<RealismClass,number>={water:15,ground:1,path:2,soil:3,foliage:4,flower:5,bark:6,wood:7,plaster:8,stone:9,roof:10,metal:11,skin:12,cloth:13,generic:14};
const KEY='eden-realism-v3';
const patched=new WeakMap<THREE.Material,{cls:RealismClass;onBeforeCompile:THREE.Material['onBeforeCompile'];key:THREE.Material['customProgramCacheKey'];names?:string[]}>();
/** What `install` gave a material: the values a merged batch carries per vertex or shares (mergedRealismMaterial). */
const installed=new WeakMap<THREE.Material,{realism:THREE.Vector4;style:THREE.Vector4;paint:THREE.Color;trim:THREE.Color;mural:boolean;facade:boolean}>();

const VERTEX_HEAD=/* glsl */`
varying vec3 vEdenW;
varying vec3 vEdenO;
varying vec3 vEdenN;
varying float vEdenH;
#ifdef EDEN_MERGED
uniform vec4 edenRealismU;
#define edenRealism edenRealismU
#else
uniform vec4 edenRealism;
#endif
#ifdef EDEN_GOD_SURFACE
attribute vec4 edenSurf;
varying vec3 vEdenL;
varying vec2 vEdenKS;
#endif
#ifdef EDEN_FACADE
attribute float edenFace;
varying float vEdenFace;
#endif
#ifdef EDEN_MERGED
attribute vec4 edenMerged;
attribute vec3 edenMergedS;
flat varying vec3 vEdenMS;
#endif
`;
const VERTEX_BODY=/* glsl */`
{
 vec4 edenP=vec4(transformed,1.0),edenOrigin=vec4(0.,0.,0.,1.);vec3 edenNrm=objectNormal;
 #ifdef USE_BATCHING
  edenP=batchingMatrix*edenP;edenOrigin=batchingMatrix*edenOrigin;edenNrm=mat3(batchingMatrix)*edenNrm;
 #endif
 #ifdef USE_INSTANCING
  edenP=instanceMatrix*edenP;edenOrigin=instanceMatrix*edenOrigin;edenNrm=mat3(instanceMatrix)*edenNrm;
 #endif
 #ifdef EDEN_MERGED
  // PERF-BATCH: a merged static batch carries each source object's origin and local height per vertex (mergedRealismAttributes)
  edenOrigin=vec4(edenMerged.xyz,1.);vEdenMS=edenMergedS;
 #endif
 vEdenW=(modelMatrix*edenP).xyz;vEdenO=(modelMatrix*edenOrigin).xyz;vEdenN=normalize(mat3(modelMatrix)*edenNrm);
 #ifdef EDEN_MERGED
  vEdenH=clamp(edenMerged.w/max(edenRealism.w,1e-3),0.,1.);
 #else
  vEdenH=clamp(transformed.y/max(edenRealism.w,1e-3),0.,1.);
 #endif
 #ifdef EDEN_FACADE
  vEdenFace=edenFace;
 #endif
 #ifdef EDEN_GOD_SURFACE
  // Kit geometry has no per-shape height here: foliage keeps its full tone instead of a base fade.
  {float k=floor(edenSurf.w+1e-3);vEdenL=edenSurf.xyz;vEdenKS=vec2(k,edenSurf.w-k);vEdenH=.8;}
 #endif
}
`;
const FRAGMENT_HEAD=/* glsl */`
varying vec3 vEdenW;
varying vec3 vEdenO;
varying vec3 vEdenN;
varying float vEdenH;
#ifdef EDEN_MERGED
// PERF-BATCH round 2: a merged batch shares one program per building layer; each source's class, seed and style ride per
// vertex (mergedRealismAttributes: flat, so exactly the source's uniforms), strength, height and base y are the batch's.
uniform vec4 edenRealismU;
flat varying vec3 vEdenMS;
#define edenRealism vec4(vEdenMS.x,edenRealismU.y,vEdenMS.y,edenRealismU.w)
#else
uniform vec4 edenRealism;
#endif
float edenHash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
// Value noise that fades to its mean once a cell shrinks below ~a pixel: no sparkle/shimmer at distance.
float edenNoise(vec2 p){vec2 i=floor(p),f=fract(p),d=fwidth(p);f=f*f*(3.-2.*f);
 float n=mix(mix(edenHash(i),edenHash(i+vec2(1.,0.)),f.x),mix(edenHash(i+vec2(0.,1.)),edenHash(i+vec2(1.,1.)),f.x),f.y);
 return mix(n,.5,smoothstep(.3,.9,max(d.x,d.y)));}
uniform sampler2D edenPatA;
uniform sampler2D edenPatB;
uniform sampler2D edenMuralMap;
uniform sampler2D edenPatC;
uniform float edenTime;
#ifdef EDEN_MERGED
uniform vec4 edenStyleU;
#define edenStyle vec4(mod(vEdenMS.z,8.),mod(floor(vEdenMS.z/8.),8.),floor(vEdenMS.z/64.),edenStyleU.w)
#else
uniform vec4 edenStyle; // building role, wall pattern, roof pattern, building base y
#endif
uniform vec3 edenPaint;
uniform vec3 edenTrim;
uniform vec4 edenMuralA; // mural centre xyz, width
uniform vec4 edenMuralB; // mural right xz, height
// Planar projection by dominant world normal: a one-tap stand-in for triplanar.
vec2 edenPlane(vec3 w,vec3 n){vec3 a=abs(n);return a.y>max(a.x,a.z)?w.xz:(a.x>a.z?w.zy:w.xy);}
#ifdef EDEN_GOD_SURFACE
varying vec3 vEdenL;
varying vec2 vEdenKS;
uniform float edenPattern;
#endif
#ifdef EDEN_FACADE
varying float vEdenFace;
#endif
`;
/** Y1 / XP7: explicit god kit patterns in shape-local metres (1 marble, 2 ashlar, 3 planks, 4 shingles, 5 stripes).
 * They replace the material class's tint; fine lines fade with pixel size, so distance never shimmers. */
const GOD_PATTERNS=/* glsl */`
 #ifdef EDEN_GOD_SURFACE
 if(edenPattern>.5){
  float pat=edenPattern,ring=floor(vEdenKS.x+.5),sd0=vEdenKS.y;vec3 L=vEdenL;
  float px=max(max(fwidth(L.x),fwidth(L.y)),fwidth(L.z));bool cyl=ring>.5&&abs(n.y)<.7;
  vec2 q=cyl?vec2(atan(L.z,L.x)*length(L.xz),L.y):edenPlane(L,n);
  if(pat<1.5){ // marble: thin turbulent veins with a soft halo (solid, so seam-free), broken hairlines, a faint cloud
   vec3 P=L*1.1+sd0*17.;float t=edenNoise(P.xy*1.3)*.5+edenNoise(P.yz*2.7+3.7)*.3+edenNoise(P.zx*5.9+9.1)*.2;
   float s=dot(P,vec3(.55,1.,.35))*2.7+t*4.2,a=fwidth(s),v=abs(sin(s)),th=.015+.03*edenNoise(P.xz*1.7+5.),far2=1.-smoothstep(1.,3.,a);
   float vein=(1.-smoothstep(th,th+a*1.2+.008,v))*far2,halo=(1.-smoothstep(th,th+.3,v))*far2;
   float s2=dot(P,vec3(-.4,.7,.9))*4.6+t*6.,a2=fwidth(s2);
   float hair=(1.-smoothstep(.01,.02+a2*1.2,abs(sin(s2))))*(1.-smoothstep(.6,1.6,a2))*smoothstep(.42,.58,edenNoise(P.xy*.9+2.));
   float cloud=edenNoise(P.xz*.45+P.y*.31+11.)*.6+edenNoise(P.xy*1.9+4.)*.4;
   tint=vec3(.97+.06*cloud)*mix(vec3(1.),vec3(.6,.62,.67),max(max(vein*.85,halo*.28),hair*.45));edenRough=.5+.2*cloud;
  }else if(pat<2.5){ // ashlar: coursed blocks, offset joints, per-block tone, recessed mortar
   float ch=.42,bw=.9,row=floor(q.y/ch),fy=fract(q.y/ch),xx=q.x/bw+row*.5+edenHash(vec2(row,sd0*7.+1.))*.6,col=floor(xx),fx=fract(xx);
   float d=min(min(fx,1.-fx)*bw,min(fy,1.-fy)*ch),fade=1.-smoothstep(.02,.06,px);
   float joint=(1.-smoothstep(.01,.012+px*1.5,d))*fade,edge=(1.-smoothstep(.012,.07,d))*fade,f=detail?mix(edenNoise(q*6.+col*3.1),.5,far):.5;
   tint=vec3(.84+.24*edenHash(vec2(col,row)+sd0*13.))*(.93+.12*f)*mix(1.,.9,edge)*mix(1.,.55,joint);
   edenRough=.92+.12*f;edenBump=-(joint*.008+edge*.003);edenBumpAmt=near*fade;
  }else if(pat<3.5){ // planks: boards along the long side, staggered butt joints, grain
   float bw=.16,bl=2.2,b=floor(q.y/bw),fy=fract(q.y/bw),e=q.x/bl+edenHash(vec2(b,sd0*5.+2.))*3.,ei=floor(e),ef=fract(e),fade=1.-smoothstep(.02,.05,px);
   float gap=max(1.-smoothstep(.004,.005+px*1.5,min(fy,1.-fy)*bw),1.-smoothstep(.003,.004+px*1.5,min(ef,1.-ef)*bl))*fade;
   float tone=.82+.26*edenHash(vec2(b,ei)+sd0*11.),g=detail?mix(edenNoise(vec2(q.x*1.1,q.y*34.)+b*3.1),.5,far):.5;
   tint=vec3(tone)*mix(vec3(1.),vec3(1.05,.98,.9),tone-.82)*(.86+.24*g)*mix(1.,.5,gap);
   edenRough=.84+.16*g;edenBump=-gap*.006;edenBumpAmt=near*fade;
  }else if(pat<4.5){ // shingles: courses up the world slope (pitched slabs too), staggered tabs, a shadow under each butt
   float u=q.x,s=q.y;
   if(ring>.5){if(abs(n.y)<=.97){u=atan(L.z,L.x)*length(L.xz);s=L.y/max(sqrt(max(1.-n.y*n.y,0.)),.25);}} // round: around, by height
   else{ // flat faces: world up projected on the face, carried back into shape metres through the screen derivatives
    vec3 a1=dFdx(L),a2=dFdy(L),b1=dFdx(vEdenW),b2=dFdy(vEdenW),nw=cross(b1,b2);nw*=inversesqrt(max(dot(nw,nw),1e-30));
    vec3 tw=vec3(0.,1.,0.)-nw.y*nw;float g11=dot(b1,b1),g12=dot(b1,b2),g22=dot(b2,b2);
    vec3 up=(g22*dot(b1,tw)-g12*dot(b2,tw))*a1+(g11*dot(b2,tw)-g12*dot(b1,tw))*a2;float ul=length(up);
    if(abs(nw.y)<.97&&ul>0.){vec3 e=up/ul;s=dot(L,e);u=dot(L,normalize(cross(n,e)));}
   }
   float rh=.2,tw=.3,row=floor(s/rh),fy=fract(s/rh),xx=u/tw+row*.5+edenHash(vec2(row,sd0*3.))*.3,c=floor(xx),fx=fract(xx),fade=1.-smoothstep(.03,.08,px);
   float slot=(1.-smoothstep(.005,.006+px*1.5,min(fx,1.-fx)*tw))*(1.-smoothstep(.7,.85,fy))*fade,butt=smoothstep(.7,1.,fy)*fade,f=detail?mix(edenNoise(vec2(u,s)*6.),.5,far):.5;
   tint=vec3(.8+.3*edenHash(vec2(c,row)+sd0*17.))*(.92+.14*f)*mix(1.,.62,butt)*mix(1.,.6,slot);
   edenRough=.9+.12*f;edenBump=(1.-fy)*.012*fade-slot*.004;edenBumpAmt=near;
  }else{ // stripes: the colour alternating with cream (a light colour with its darker shade), around round shapes
   float t=ring>.5?atan(L.z,L.x)/6.2831853*ring*.5:L.x/.5,per=ring>.5?6.2831853*max(length(L.xz),.02)/(ring*.5):.5;
   float a=px/per*2.,band=smoothstep(.5-a,.5+a,abs(fract(t)-.5)*2.);band=mix(band,.5,smoothstep(.25,.5,a));
   vec3 c=diffuseColor.rgb,alt=dot(c,vec3(.3,.59,.11))>.62?c*vec3(.52,.58,.68):vec3(.93,.91,.86);
   diffuseColor.rgb=mix(alt,c,band);tint=vec3(.97+.05*(detail?mix(edenNoise(q*9.),.5,far):.5));edenRough=.95;
  }
 }else
 #endif
`;
const FRAGMENT_BODY=/* glsl */`
float edenRough=1.,edenBump=0.,edenBumpAmt=0.;
{
 float cls=edenRealism.x,amt=edenRealism.y;vec3 w=vEdenW,n=normalize(vEdenN);vec3 tint=vec3(1.);
 // Distance LOD: full detail (texture taps, fine noise, bump) within 26 m, faded out by 40 m; beyond that only
 // the broad fields and the textures' mean tone remain. Branches are coherent per screen region.
 float far=smoothstep(26.,40.,length(cameraPosition-w)),near=1.-far;bool detail=far<.999;
 // Interpolated per-object origins wobble in the last bits; snap before hashing so seeds are constant per object.
 vec3 seed=floor(vEdenO*4.+.5)*.25;
 float obj=edenHash(seed.xz*.731+seed.y*.17+edenRealism.z);
 #ifdef EDEN_GOD_SURFACE
  // Y1 / XP7: god kit shapes shade in their own metres and faces (vEdenL) with a per-shape seed, so a surface holds
  // still while a thing eases in, moves, turns or swings; the face normal is the screen-derivative one, oriented by
  // the interpolated world normal.
  {vec3 fl=cross(dFdx(vEdenL),dFdy(vEdenL)),fw=cross(dFdx(vEdenW),dFdy(vEdenW));
   n=normalize(fl+vec3(0.,1e-12,0.))*(dot(fw,vEdenN)<0.?-1.:1.);w=vEdenL+vEdenKS.y*vec3(41.,0.,29.);obj=edenHash(vec2(vEdenKS.y*97.,7.1));}
 #endif
 // Shared countryside macro field: lush and sun-dried patches agree between turf and blades.
 float macro=.5;if(cls<1.5||(cls>3.5&&cls<4.5))macro=edenNoise(w.xz*.045)*.65+edenNoise(w.xz*.14+7.3)*.35;
 vec3 dry=vec3(1.12,1.04,.86),lush=vec3(.88,.98,.94);
${GOD_PATTERNS}
 // God kit shapes never take the terrain, flower, skin or water classes: those branches stay out of the god program.
 #ifndef EDEN_GOD_SURFACE
 if(cls<1.5){ // ground turf: strong lush/dry and warm/cool fields, textured blades and clumps, mown lawn stripes
  float temp=edenNoise(w.xz*.028+31.);
  tint=mix(vec3(.74,.97,.86),vec3(1.24,1.08,.7),smoothstep(.28,.78,macro))*(.82+.3*macro);
  tint*=mix(vec3(.94,1.,1.06),vec3(1.06,1.,.9),temp);
  float mid=edenNoise(w.xz*.43+3.1);vec3 det=vec3(.87);
  if(detail){vec4 G=texture2D(edenPatC,w.xz/1.6),G2=texture2D(edenPatC,w.xz/6.1+.37);float Gm=texture2D(edenPatC,w.xz/5.3+.61).r;
   vec3 d=(.68+.62*G.r)*(.74+.5*Gm)*mix(1.,.76,G2.g)*mix(vec3(1.),vec3(.9,1.05,.88),G.g);
   // Sun-bleached straw flecks in the dry patches.
   d=mix(d,d*vec3(1.25,1.12,.78),smoothstep(.6,.9,macro)*smoothstep(.55,.8,G2.a)*.8);
   det=mix(d,det,far);edenBump=G.r*.02;edenBumpAmt=near;
   tint=mix(tint,tint*vec3(.8,.9,.78),smoothstep(.68,.88,edenNoise(w.xz*.9+17.))*.7*near);}
  tint*=(.8+.36*mid)*det;
  // mown lawn bands (role 5): old Eden's commons runs them along (.92,.38); a lawn may give its own axis in edenStyle.yz
  if(edenStyle.x>4.5&&edenStyle.x<5.5){vec2 ax=dot(edenStyle.yz,edenStyle.yz)>.25?edenStyle.yz:vec2(.92,.38);tint*=.93+.14*step(.5,fract(dot(w.xz,ax)/3.2));}
  // Banks and slopes read thinner and earthier than level turf.
  tint=mix(tint,tint*vec3(1.02,.94,.8),smoothstep(.97,.82,n.y)*.8);
 }else if(cls<2.5){ // trodden path: gravel texture over broad damp/dry tone
  float broad=edenNoise(w.xz*.15+5.),mid=edenNoise(w.xz*.6),g=.9;
  if(detail){vec4 G=texture2D(edenPatC,w.xz/2.3);g=mix((.72+.36*G.b)*(.9+.2*G.a),g,far);edenBump=G.b*.012;edenBumpAmt=near;}
  tint=vec3(.82+.28*mid)*mix(vec3(.9,.93,.94),vec3(1.08,1.02,.92),broad)*g;
 }else
 #endif
 if(cls<3.5){ // soil
  float mid=edenNoise(w.xz*1.1+4.),fine=detail?mix(edenNoise(w.xz*5.7),.5,far):.5;
  tint=vec3(.72+.36*fine)*(.88+.2*mid);
 }else if(cls<4.5){ // foliage: per-plant hue/value, shared macro, base and underside occlusion
  float r=edenHash(seed.xz*1.37+edenRealism.z),v=edenHash(seed.zx*3.11+1.7);
  tint=mix(vec3(1.),mix(lush,dry,smoothstep(.3,.8,macro)),.5);
  tint*=mix(vec3(.9,1.,.96),vec3(1.1,1.05,.88),r)*(.86+.28*v);
  tint*=mix(.6,1.05,smoothstep(0.,.8,vEdenH))*mix(vec3(1.),vec3(1.06,1.05,.9),smoothstep(.65,1.,vEdenH));
  tint*=mix(.88,1.05,clamp(n.y*.5+.5,0.,1.));
  if(detail)tint*=mix(.88+.22*edenNoise(edenPlane(w,n)*1.9+r*11.),.99,far);
  tint*=mix(vec3(.95,1.,1.03),vec3(1.04,1.02,.93),clamp(n.y*.5+.5,0.,1.));
 }
 #ifndef EDEN_GOD_SURFACE
 else if(cls<5.5){ // flowers: restrained per-plant value only
  tint=vec3(.9+.18*edenHash(seed.xz*2.3));
 }
 #endif
 else if(cls<6.5){ // bark/stems: vertical fibres
  vec2 p=edenPlane(w,n);float s=.5,k=.5;if(detail){s=mix(edenNoise(vec2(p.x*16.,p.y*1.1)+obj*5.),.5,far);k=mix(edenNoise(vec2(p.x*3.,p.y*2.4)+obj*7.),.5,far);}
  tint=vec3(.68+.44*s)*(.88+.2*k)*(.9+.2*obj)*mix(.72,1.,smoothstep(0.,.35,vEdenH));
 }else if(cls<7.5){ // timber: board-to-board tone, grain mottle, slightly glossier wear
  vec2 p=edenPlane(w,n);float g=.5,m=.5;if(detail){g=mix(edenNoise(p*vec2(1.6,9.)+obj*13.),.5,far);m=mix(edenNoise(p*.9),.5,far);}
  tint=vec3(.84+.3*obj)*mix(vec3(1.),vec3(1.05,.98,.9),obj)*(.88+.2*g)*(.94+.1*m);
  edenRough=.86+.16*g;
 }else if(cls<8.5){ // plaster/render: soft stains, rain streaks, settled dust
  vec2 p=edenPlane(w,n);float st=edenNoise(p*.55+obj*9.),rain=.5;if(detail)rain=mix(edenNoise(vec2(p.x*2.6,w.y*.35)),.5,far);
  tint=vec3(.92+.12*st)*(.96+.07*rain)*mix(vec3(1.),vec3(1.03,1.,.95),st);
  tint*=mix(1.,.9,smoothstep(.6,1.,n.y))*(.95+.08*obj);
 }else if(cls<9.5){ // stone: two-scale mottle, per-stone tone, lichen on upward faces
  vec2 p=edenPlane(w,n);float m=edenNoise(p*1.3+obj*7.),f=.5;if(detail)f=mix(edenNoise(p*6.2),.5,far);
  tint=vec3(.82+.26*m)*(.94+.1*f)*(.88+.22*obj);
  if(detail)tint=mix(tint,tint*vec3(.86,.98,.76),smoothstep(.55,.85,edenNoise(p*.8+3.))*smoothstep(.2,.8,n.y)*.8*near);
  edenRough=.9+.15*f;
 }else if(cls<10.5){ // roof: weathered courses and moss
  vec2 p=edenPlane(w,n);float m=edenNoise(p*.8+obj*5.);
  tint=vec3(.82+.28*m)*(.9+.18*obj);
  if(detail){float c=mix(edenNoise(vec2(p.x*.6,p.y*4.)),.5,far);tint*=.92+.12*c;tint=mix(tint,tint*vec3(.82,.95,.72),smoothstep(.62,.9,edenNoise(p*.45+9.))*.75*near);
   // Pitched roofs only: shingle/tile courses as soft shadow lines, faded once rows approach pixel size.
   float rows=w.y*5.5,rw=fwidth(rows),course=mix(smoothstep(0.,.18,fract(rows)),.85,max(smoothstep(.25,.7,rw),far));
   tint*=mix(1.,.86+.14*course,smoothstep(.3,.45,n.y)*(1.-smoothstep(.93,.98,n.y)));}
 }else if(cls<11.5){ // metal: tarnish and roughness drift
  float m=edenNoise(edenPlane(w,n)*2.2);tint=vec3(.9+.16*m);edenRough=.82+.32*m;
 }
 #ifndef EDEN_GOD_SURFACE
 else if(cls<12.5){ // skin: per-person warmth, faint mottling, subtle sheen
  tint=mix(vec3(.96,.97,.98),vec3(1.04,1.,.97),obj)*(.97+.05*edenNoise(w.xz*9.+w.y*7.));edenRough=.82;
 }
 #endif
 else if(cls<13.5){ // cloth: weave/fold value, per-garment tone, never glossy
  float m=detail?mix(edenNoise(edenPlane(w,n)*14.),.5,far):.5;tint=vec3(.9+.14*obj)*(.94+.1*m);edenRough=1.08;
 }
 #ifndef EDEN_GOD_SURFACE
 else if(cls>14.5){ // open water: drifting two-scale ripple height -> bump normals, glossy sun glints; alpha untouched
  vec2 p=w.xz;float t=edenTime;float h=.15*(sin(dot(p,vec2(.8,.6))*1.6+t*1.1)*.5+.5)+.42;
  if(detail){h=mix(texture2D(edenPatC,p/3.1+vec2(.031,.017)*t).a*.55+texture2D(edenPatC,p/1.2-vec2(.043,.029)*t).a*.3,.42,far)+h-.42;edenBump=h*.12;edenBumpAmt=near;}
  edenRough=.3;
  tint=vec3(.78+.36*h)*mix(vec3(.9,.97,1.02),vec3(1.1,1.08,1.02),smoothstep(.55,.85,h));
 }
 #endif
 else{ // generic painted/built surfaces
  vec2 p=edenPlane(w,n);tint=vec3(.94+.12*obj)*(.95+.08*edenNoise(p*.7));
 }
 #ifndef EDEN_GOD_SURFACE
 // Building identity: per-building finish (brick/stone/siding/limewash, tile/slate roofs, mural) from generated tiling patterns.
 // One texture tap per wall/roof pixel near; zero beyond 40 m (the pattern's mean tone instead).
 float role=edenStyle.x;
 if(role>.5){
  float up=abs(n.y),hb=w.y-edenStyle.w;vec2 q=edenPlane(w,n);
  if(role<1.5){
   vec3 col=edenPaint*.92;
   if(up<.45){
    float pat=edenStyle.y,tile=pat<1.5?2.:pat<2.5?3.:pat<3.5?2.4:6.;
    vec3 mean=pat<1.5?mix(edenTrim,edenPaint,.8):pat<2.5?mix(edenTrim*.75,edenPaint*.95,.92):pat<3.5?edenPaint*.885:edenPaint*.97;
    col=mean;
    if(detail){vec3 c;
     if(pat<3.5){vec4 A=texture2D(edenPatA,q/tile);
      if(pat<1.5){float v=pat<.5?A.r:A.g,m=smoothstep(.18,.28,v);c=mix(edenTrim,edenPaint*(.6+.6*v),m);edenRough=mix(1.,.9,m);edenBump=m*.012;}
      else if(pat<2.5){float v=A.b,m=smoothstep(.18,.28,v);c=mix(edenTrim*.75,edenPaint*(.62+.5*v),m);edenBump=m*.02+v*.006;}
      else{c=edenPaint*(.5+.55*A.a);edenRough=.86;edenBump=A.a*.012;}
      edenBumpAmt=near;}
     else c=edenPaint*(.82+.3*texture2D(edenPatB,q/tile).b);
     col=mix(c,mean,far);}
    if(pat>4.5&&hb>2.28&&hb<2.6){float t=detail?mix(texture2D(edenPatB,vec2(q.x/2.56,(hb-2.28)/2.56)).a,.6,far):.6;col=t<.2?vec3(.78,.74,.66):mix(vec3(.03,.1,.3),vec3(.86,.8,.62),t);}
    if(hb<.42){float v=detail?mix(texture2D(edenPatA,q/2.2).b,.65,far):.65,m=smoothstep(.18,.28,v);col=mix(edenTrim*.45,edenTrim*(.5+.45*v),m);}
   }
   diffuseColor.rgb=col;
  }else if(role<2.5){
   if(up>.2&&up<.97){float v=.6;
    if(detail){vec2 sd=normalize(n.xz+vec2(1e-5));vec2 r=vec2(dot(w.xz,vec2(-sd.y,sd.x)),w.y*1.6);float pat=edenStyle.z;vec4 B=texture2D(edenPatB,r/(pat<.5?2.:pat<1.5?1.6:2.4));v=mix(pat<.5?B.r:B.g,.6,far);edenBump=v*.03;edenBumpAmt=near;}
    diffuseColor.rgb=edenPaint*(.45+.65*v);edenRough=mix(1.,.82,v);}
   else diffuseColor.rgb=mix(diffuseColor.rgb,edenPaint,.5);
  }else if(role<3.5){
   if(up<.45){float v=detail?mix(texture2D(edenPatA,q/2.6).b,.65,far):.65,m=smoothstep(.18,.28,v);diffuseColor.rgb*=mix(.55,.65+.5*v,m);}
  }else if(role>6.5){
   // W2b: entity building kit (building/1). The vertex colour is the paint; the building's finish is the material's
   // (edenStyle.y wall 0 running brick, 1 Flemish, 2 ashlar, 3 clapboard, 4 limewash; edenStyle.z roof 0 clay tile,
   // 1 slate, 2 shingle). Patterns go on the outer face only (edenFace): rooms inside keep their painted plaster.
   vec3 paint=diffuseColor.rgb;
   if(cls>9.5&&cls<10.5){
    if(up>.2&&up<.97){float pat=edenStyle.z,v=.6;
     if(detail){vec2 sd=normalize(n.xz+vec2(1e-5));vec2 r=vec2(dot(w.xz,vec2(-sd.y,sd.x)),w.y*1.6);vec4 B=texture2D(edenPatB,r/(pat<.5?2.:pat<1.5?1.6:2.4));v=mix(pat<.5?B.r:B.g,.6,far);edenBump=v*.03;edenBumpAmt=near;}
     diffuseColor.rgb=paint*(.5+.7*v);edenRough=mix(1.,.82,v);}
   }else{
    float face=0.;
    #ifdef EDEN_FACADE
     face=vEdenFace;
    #endif
    if(face>.5&&up<.45){
     float pat=edenStyle.y,tile=pat<1.5?2.:pat<2.5?3.:pat<3.5?2.4:6.;
     vec2 h=normalize(vec2(-n.z,n.x)+vec2(1e-5)),q=vec2(dot(w.xz,h),w.y);
     vec3 mortar=mix(paint,vec3(.82,.79,.73),.65),mean=pat<1.5?mix(mortar,paint,.8):pat<2.5?mix(mortar*.85,paint*.95,.92):pat<3.5?paint*.885:paint*.97,col=mean;
     if(detail){vec3 c;
      if(pat<3.5){vec4 A=texture2D(edenPatA,q/tile);
       // gentler than the old district finish: kit walls are large and often seen at a grazing angle, so tone only (a
       // derivative bump sparkles there) and a low per-brick tone
       if(pat<1.5){float v=pat<.5?A.r:A.g,m=smoothstep(.18,.28,v);c=mix(mortar,paint*(.8+.3*v),m);}
       else if(pat<2.5){float v=A.b,m=smoothstep(.18,.28,v);c=mix(mortar*.9,paint*(.74+.36*v),m);}
       else c=paint*(.66+.42*A.a);}
      else c=paint*(.82+.3*texture2D(edenPatB,q/tile).b);
      col=mix(c,mean,far);}
     diffuseColor.rgb=col;
    }
   }
  }else if(role>5.5){ // vertex-painted districts (Regions): the vertex colour is the paint; pattern picked per building tone
   vec3 paint=diffuseColor.rgb;float pick=edenHash(floor(paint.rg*24.)+floor(paint.b*24.)*.37),lum=dot(paint,vec3(.3,.59,.11));
   if(cls>9.5&&cls<10.5){
    if(up>.2&&up<.97){float v=.62;
     if(detail){vec2 sd=normalize(n.xz+vec2(1e-5));vec2 r=vec2(dot(w.xz,vec2(-sd.y,sd.x)),w.y*1.6);vec4 B=texture2D(edenPatB,r/(pick<.5?2.:1.6));v=mix(pick<.5?B.r:B.g,.62,far);edenBump=v*.03;edenBumpAmt=near;}
     diffuseColor.rgb=paint*(.55+.7*v);edenRough=mix(1.,.84,v);}
   }else if(up<.45){
    // stone -> ashlar, timber -> boards, painted render -> mostly limewash, some brick or dressed stone; pale trim stays limewash.
    float pat=cls>8.5&&cls<9.5?2.:cls>6.5&&cls<7.5?3.:(lum>.72?4.:pick<.28?0.:pick<.4?2.:4.);
    vec3 mortar=mix(paint,vec3(.8,.78,.73),.6),mean=pat<.5?mix(mortar,paint,.8):pat<2.5?paint*.9:pat<3.5?paint*.9:paint*.97,col=mean;
    if(detail){vec3 c;
     if(pat<3.5){vec4 A=texture2D(edenPatA,q/(pat<.5?2.:pat<2.5?2.6:2.4));
      if(pat<.5){float m=smoothstep(.18,.28,A.r);c=mix(mortar,paint*(.62+.55*A.r),m);edenRough=mix(1.,.9,m);edenBump=m*.012;}
      else if(pat<2.5){float m=smoothstep(.18,.28,A.b);c=mix(mortar*.85,paint*(.66+.45*A.b),m);edenBump=m*.018+A.b*.006;}
      else{c=paint*(.55+.5*A.a);edenRough=.88;edenBump=A.a*.012;}
      edenBumpAmt=near;}
     else c=paint*(.84+.26*texture2D(edenPatB,q/6.).b);
     col=mix(c,mean,far);}
    diffuseColor.rgb=col;
   }
  }else{
   vec2 rt=edenMuralB.xy,fw=vec2(-rt.y,rt.x);vec3 d=w-edenMuralA.xyz;float side=dot(n.xz,fw),u=dot(d.xz,rt)/edenMuralA.w+.5,vv=d.y/edenMuralB.z+.5;
   if(abs(side)>.7&&u>0.&&u<1.&&vv>0.&&vv<1.){if(side<0.)u=1.-u;diffuseColor.rgb=texture2D(edenMuralMap,vec2(u,1.-vv)).rgb;edenRough=.92;tint=mix(vec3(1.),tint,.4);}
  }
 }
 #endif
 diffuseColor.rgb*=mix(vec3(1.),tint,amt);
 edenRough=mix(1.,edenRough,amt);
}
`;

export type BuildingStyle={role:1|2|3|4|5|6|7;wall:number;roof:number;baseY:number;paint:THREE.Color;trim:THREE.Color;mural?:{centre:THREE.Vector3;right:THREE.Vector2;width:number;height:number}};
const realismTime={value:0};
/** Scene seconds for animated finishes (water ripples). Wraps to keep float precision. */
export function setRealismTime(seconds:number){if(Number.isFinite(seconds))realismTime.value=seconds%3600;}
/** Derivative bump from the procedural height (three's bumpmap formulation), no tangents or maps needed. */
const BUMP=/* glsl */`if(edenBumpAmt>0.){vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition),r1=cross(sy,normal),r2=cross(normal,sx);float det=dot(sx,r1);
 vec3 grad=sign(det)*(dFdx(edenBump)*r1+dFdy(edenBump)*r2);normal=normalize(abs(det)*normal-grad*edenBumpAmt);}`;
type CompileShader=Parameters<THREE.Material['onBeforeCompile']>[0];
function patchShader(shader:CompileShader,uniforms:Record<string,THREE.IUniform>,god=false,facade=false){
 Object.assign(shader.uniforms,uniforms);shader.uniforms.edenTime=realismTime;shader.uniforms.edenRealismU=shader.uniforms.edenRealism;shader.uniforms.edenStyleU=shader.uniforms.edenStyle;const head=(god?'#define EDEN_GOD_SURFACE\n':'')+(facade?'#define EDEN_FACADE\n':'');
 shader.vertexShader=head+VERTEX_HEAD+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\n'+VERTEX_BODY);
 shader.fragmentShader=head+FRAGMENT_HEAD+shader.fragmentShader
  .replace('#include <color_fragment>','#include <color_fragment>\n'+FRAGMENT_BODY)
  .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor*edenRough,.04,1.);')
  .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n'+BUMP);
}
/** Y1 / XP7: one realism program serves every god kit/2 surface (class and pattern are uniforms). It reads the
 * `edenSurf` attribute (shape-local metres + ring count + seed) and never binds the Eden pattern textures. */
export type GodSurface={cls:RealismClass;pattern:number};
export const GOD_SURFACE_KEY=KEY+'|god-surface/1';
export function patchGodSurface(shader:CompileShader,surface:GodSurface){
 patchShader(shader,{edenRealism:{value:new THREE.Vector4(CLASS_ID[surface.cls],1,0,1)},edenPattern:{value:surface.pattern},
  edenPatA:{value:null},edenPatB:{value:null},edenPatC:{value:null},edenMuralMap:{value:null},edenStyle:{value:new THREE.Vector4()},
  edenPaint:{value:new THREE.Color(1,1,1)},edenTrim:{value:new THREE.Color(1,1,1)},edenMuralA:{value:new THREE.Vector4()},edenMuralB:{value:new THREE.Vector4(1,0,1,0)}},true);
}
function install(material:THREE.MeshStandardMaterial,cls:RealismClass,height:number,strength:number,context:string,style?:BuildingStyle,facade=false){
 let h=2166136261;for(let i=0;i<context.length;i++)h=Math.imul(h^context.charCodeAt(i),16777619);
 const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey;
 const uniform={value:new THREE.Vector4(CLASS_ID[cls],strength,((h>>>0)%997)*.0137,height)};
 const kit=surfaceKit(),mural=style?.mural;
 const styleUniforms={edenPatA:{value:kit.patternsA},edenPatB:{value:kit.patternsB},edenPatC:{value:kit.patternsC},edenMuralMap:{value:mural?kit.mural:null},
  edenStyle:{value:new THREE.Vector4(style?.role??0,style?.wall??0,style?.roof??0,style?.baseY??0)},edenPaint:{value:style?.paint??new THREE.Color(1,1,1)},edenTrim:{value:style?.trim??new THREE.Color(1,1,1)},
  edenMuralA:{value:mural?new THREE.Vector4(mural.centre.x,mural.centre.y,mural.centre.z,mural.width):new THREE.Vector4()},edenMuralB:{value:mural?new THREE.Vector4(mural.right.x,mural.right.y,mural.height,0):new THREE.Vector4(1,0,1,0)}};
 material.onBeforeCompile=function(shader,renderer){
  previous.call(this,shader,renderer);
  patchShader(shader,{edenRealism:uniform,...styleUniforms},false,facade);
 };
 material.customProgramCacheKey=function(){return previousKey.call(this)+'|'+KEY+(facade?'|facade':'');};
 material.needsUpdate=true;
 patched.set(material,{cls,onBeforeCompile:previous,key:previousKey,names:context.split('|')});
 installed.set(material,{realism:uniform.value,style:styleUniforms.edenStyle.value,paint:styleUniforms.edenPaint.value,trim:styleUniforms.edenTrim.value,mural:!!mural,facade});
}

const SKIP=/water|lake surface|river surface|\bwet\b|cloud|sky|glass|window|pane\b|screen|slide|projection|label|marker|\bring\b|halo|glow|flame|lamp|bulb|highlight|select|riverreach|calmlake| bed\b(?!s)|ceramic|emissive/;
/** Ordered: material words beat location words; the most specific name segment is tried first. */
const RULES:[RegExp,RealismClass][]=[
 [/cosmetic ground|grass ground|turf|lawn|commons-ground|outside-ground|terrain/,'ground'],
 [/path appearance|approach|trail surface|gravel|dirt|clearing|(^|[ ;:_-])paths?([ ;:_-]|$)/,'path'],
 [/soil|plot|tilled|earth/,'soil'],
 [/parked-car|wagon|cart\b|vehicle/,'generic'],
 [/cushion|upholster|fabric|textile|rug\b|blanket|yoga|mat\b|towel|pillow/,'cloth'],
 [/petal|flower|blossom|fruit|bloom/,'flower'],
 [/plaster|render|stucco/,'plaster'],
 [/timber|wood|plank|board|deck|hull/,'wood'],
 [/stone|rock|basalt|strata|boulder|cobble|masonry|brick|concrete|plinth/,'stone'],
 [/steel|metal|iron|brass|copper|zinc/,'metal'],
 [/leaf|leaves|blade|grass|fern|frond|hedge|foliage|canopy|crown|shrub|bush|moss|reed|herb|vine|clusters|masses|sage|olive|ball:|cone:/,'foliage'],
 [/trunk|stem|branch|bamboo|stalk|vegetation:.*bark/,'bark'],
 [/bark/,'wood'],
 [/roof|tile|shingle|thatch/,'roof'],
 [/wall|gable/,'plaster'],
 [/bench|beam|post|rail|crate|barrel|wheel|door|shutter|table|chair|stool|shelf|furnishing/,'wood'],
];
function byName(s:string):RealismClass|null{for(const [re,cls] of RULES)if(re.test(s))return cls;return null;}
/** Name/colour classification of one material in its rendered context. Returns null to leave it alone. */
export function classifyRealism(material:THREE.Material,names:string[]):RealismClass|null{
 if(material instanceof THREE.MeshStandardMaterial&&material.transparent&&!material.map&&!material.alphaMap&&!material.wireframe&&material.onBeforeCompile===THREE.Material.prototype.onBeforeCompile&&/water|lake surface|river surface/.test(names.join(' ; ').toLowerCase())&&!/ bed\b|fountain|bed ;|riverreach bed|calmlake bed/.test(names.join(' ; ').toLowerCase()))return'water';
 if(!(material instanceof THREE.MeshStandardMaterial)||material.transparent||material.opacity<1||material.alphaTest>0||material.map||material.alphaMap||material.wireframe)return null;
 if(material.onBeforeCompile!==THREE.Material.prototype.onBeforeCompile||material.customProgramCacheKey!==THREE.Material.prototype.customProgramCacheKey)return null;
 if(material.emissive&&material.emissive.getHex()!==0&&material.emissiveIntensity>0)return null;
 const full=(names.join(' ; ')+' ; '+material.name).toLowerCase();
 // Water, sky and readability furniture are deliberately tuned elsewhere.
 if(SKIP.test(full))return null;
 const leaves=[material.name,...names.map(n=>n.split(/ > | \/ /).pop()??'')].join(' ; ').toLowerCase();
 const hsl={h:0,s:0,l:0};material.color.getHSL(hsl,THREE.SRGBColorSpace);const hue=hsl.h*360,brown=hsl.s>.18&&hue>=12&&hue<=48&&hsl.l<.62;
 let cls=byName(leaves)??byName(full);
 if(cls==='plaster'&&brown&&!material.vertexColors)cls='wood';
 if(cls)return cls;
 if(material.metalness>.1)return'metal';
 if(material.vertexColors)return'generic';
 if(hsl.s>.16&&hue>=65&&hue<=170)return/vegetation|plant|tree|leaf|garden|hedge/.test(full)?'foliage':'generic';
 if(brown)return'wood';
 if(hsl.s<.2&&hsl.l>.6)return'plaster';
 if(hsl.s<.16)return'stone';
 return'generic';
}

const STRENGTH:Record<RealismClass,number>={water:1,ground:1,path:1,soil:1,foliage:1,flower:1,bark:1,wood:1,plaster:1,stone:1,roof:1,metal:1,skin:1,cloth:1,generic:1};

/** Local top of a geometry without writing its bounding-box cache. */
function topOf(g:THREE.BufferGeometry){if(g.boundingBox)return g.boundingBox.max.y;const p=g.attributes.position;if(!p)return 1;let top=-Infinity;for(let i=0;i<p.count;i++)top=Math.max(top,p.getY(i));return Number.isFinite(top)?top:1;}

// ---------------------------------------------------------------- building identity
type Palette={name:string;wall:number;roof:number;paint:string;trim:string;roofPaint:string};
/** Curated wall × roof finishes (sRGB). Pattern ids: wall 0 running brick, 1 Flemish brick, 2 ashlar, 3 clapboard, 4 limewash, 5 limewash + tile band; roof 0 clay tile, 1 slate, 2 shingle. */
export const BUILDING_PALETTES:readonly Palette[]=[
 {name:'red brick, slate',wall:0,roof:1,paint:'#9a4a36',trim:'#cfc6b4',roofPaint:'#5c626b'},
 {name:'ochre limewash, clay tile',wall:4,roof:0,paint:'#d9a85e',trim:'#8c7a63',roofPaint:'#b5603c'},
 {name:'sage clapboard, slate',wall:3,roof:1,paint:'#8fa58a',trim:'#e8e2d2',roofPaint:'#3f4448'},
 {name:'sandstone ashlar, clay tile',wall:2,roof:0,paint:'#c8b08a',trim:'#8a7a62',roofPaint:'#a8553a'},
 {name:'brown Flemish brick, slate',wall:1,roof:1,paint:'#7a4536',trim:'#d8cfbd',roofPaint:'#4b5258'},
 {name:'blue limewash with tile band, clay tile',wall:5,roof:0,paint:'#9db8c9',trim:'#6b6458',roofPaint:'#b86a45'},
 {name:'white clapboard, shingle',wall:3,roof:2,paint:'#ece8de',trim:'#7b8a8f',roofPaint:'#56524a'},
 {name:'rose limewash, slate',wall:4,roof:1,paint:'#d49a8c',trim:'#7d6c5d',roofPaint:'#5a5f66'},
 {name:'barn-red clapboard, shingle',wall:3,roof:2,paint:'#8e3326',trim:'#e9dfcc',roofPaint:'#4a4440'},
 {name:'cream brick, clay tile',wall:0,roof:0,paint:'#d8c49a',trim:'#8a7f70',roofPaint:'#a65a3e'},
];
const BUILDING=/house|dwelling|cottage|farmhouse|verandah|library|office-1|market-1|barn-1|tower|cabin|tea-house|windmill|observatory|mural-wall/;
const NOT_BUILDING=/couch|yoga|mat\b|floor-mat|bed\b|desk|table|bench|cart|car\b|wagon|furnish|meeting|sails|chair|stool|planter/;
const assigned=new Map<string,{palette:number;centre:THREE.Vector3;baseY:number}>();
const clones=new Map<string,THREE.MeshStandardMaterial>();
function paletteChoices(key:string){if(/barn/.test(key))return[8];if(/windmill/.test(key))return[6];if(/library|office|market|observatory|tower/.test(key))return[0,3,4,9,5];return[0,1,2,3,4,5,6,7,9];}
const fnv=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return h>>>0;};
/** World bounds of a subtree from its vertices, without touching any geometry cache. */
function worldBounds(node:THREE.Object3D){const box=new THREE.Box3(),v=new THREE.Vector3(),m=new THREE.Matrix4(),world=new THREE.Matrix4();node.updateWorldMatrix(true,true);
 node.traverse(o=>{const mesh=o as THREE.Mesh;if(!mesh.isMesh)return;const p=mesh.geometry.attributes.position;if(!p)return;const inst=(mesh as THREE.InstancedMesh).isInstancedMesh?(mesh as THREE.InstancedMesh):null;
  for(let k=0;k<(inst?inst.count:1);k++){if(inst){inst.getMatrixAt(k,m);world.multiplyMatrices(mesh.matrixWorld,m);}else world.copy(mesh.matrixWorld);for(let i=0;i<p.count;i++)box.expandByPoint(v.fromBufferAttribute(p,i).applyMatrix4(world));}});
 return box;}
function buildingOf(mesh:THREE.Object3D,root:THREE.Object3D){
 if(mesh.userData.skipBuildingIdentity===true||root.userData.skipBuildingIdentity===true)return null;
 const chain:THREE.Object3D[]=[];let p=mesh.parent;while(p&&p!==root){if(p.userData.skipBuildingIdentity===true)return null;chain.unshift(p);p=p.parent;}
 const at=chain.findIndex(a=>/^[a-z]/.test(a.name));if(at<0||!BUILDING.test(chain[at].name))return null;
 if(chain.slice(at).some(a=>NOT_BUILDING.test(a.name))||NOT_BUILDING.test(mesh.name))return null;return chain[at];}
function roleFor(cls:RealismClass|null,m:THREE.MeshStandardMaterial,mesh:THREE.Object3D,key:string,timberWalls:boolean):1|2|3|4|null{
 if(/mural-wall/.test(key))return/mural-wall-body|mural-paint/.test(mesh.name)?4:null;
 if(!cls)return null;if(cls==='roof'&&!/door|guard|rail|wall|storey|band/.test(mesh.name))return 2;
 const hsl={h:0,s:0,l:0};m.color.getHSL(hsl,THREE.SRGBColorSpace);
 if((cls==='plaster'||cls==='generic'||cls==='stone'||cls==='wood'||cls==='roof')&&!m.vertexColors&&hsl.l>.55&&hsl.s<.5)return 1;
 // Timber-clad buildings (barns) also paint their mid-tone timber walls.
 if(timberWalls&&cls==='wood'&&!m.vertexColors&&hsl.l>.4&&/wall|parts|gable/.test(mesh.name))return 1;
 if(cls==='stone')return 3;return null;}
/** Gives each identified building its own finish by swapping in a per-building clone of its wall/roof
 * materials (same program; clones are owned here). Draw calls, geometry and names are unchanged. */
function applyBuildingIdentity(root:THREE.Object3D){
 let made=0;const pending:[THREE.Mesh,THREE.MeshStandardMaterial][]=[];
 root.traverse(o=>{const mesh=o as THREE.Mesh;if(!mesh.isMesh||(o as THREE.SkinnedMesh).isSkinnedMesh||Array.isArray(mesh.material))return;const m=mesh.material as THREE.MeshStandardMaterial;if(ownedClone.has(m))return;pending.push([mesh,m]);});
 for(const [mesh,m] of pending){
  const node=buildingOf(mesh,root);if(!node)continue;const key=node.name;
  const original=patched.get(m),cls=original&&m.onBeforeCompile!==original.onBeforeCompile?original.cls:classifyRealism(m,[(mesh.parent?.name??'')+' > '+mesh.name]);
  if(!(m instanceof THREE.MeshStandardMaterial))continue;
  if(!cls&&!/mural-wall/.test(key))continue;
  let a=assigned.get(key);
  if(!a){const box=worldBounds(node),centre=box.getCenter(new THREE.Vector3()),choices=paletteChoices(key),start=fnv(key)%choices.length,others=[...assigned.values()];
   // Neighbours within 45 m never share a finish; otherwise prefer the least-used palette (stable hash order breaks ties).
   const cost=(p:number)=>others.filter(b=>b.palette===p).length+(others.some(b=>b.palette===p&&b.centre.distanceTo(centre)<45)?100:0);
   let best=choices[start];for(let t=0;t<choices.length;t++){const p=choices[(start+t)%choices.length];if(cost(p)<cost(best))best=p;}
   a={palette:best,centre,baseY:box.min.y};assigned.set(key,a);}
  const role=roleFor(cls,m,mesh,key,BUILDING_PALETTES[a.palette].wall===3&&/barn/.test(key));if(!role)continue;
  const id=key+'|'+m.uuid+'|'+role;let c=clones.get(id);
  if(!c){const pal=BUILDING_PALETTES[a.palette];c=m.clone();c.onBeforeCompile=THREE.Material.prototype.onBeforeCompile;c.customProgramCacheKey=THREE.Material.prototype.customProgramCacheKey;
   const hsl={h:0,s:0,l:0};m.color.getHSL(hsl,THREE.SRGBColorSpace);
   let mural:BuildingStyle['mural'];if(role===4){const body=node.getObjectByName('mural-wall-body')??mesh,box=worldBounds(body),e=new THREE.Vector3().setFromMatrixColumn(body.matrixWorld,0).setY(0).normalize(),size=box.getSize(new THREE.Vector3());
    mural={centre:box.getCenter(new THREE.Vector3()),right:new THREE.Vector2(e.x,e.z),width:Math.abs(e.x)>Math.abs(e.z)?size.x:size.z,height:size.y};}
   const style:BuildingStyle={role,wall:pal.wall,roof:pal.roof,baseY:a.baseY,paint:new THREE.Color(role===2&&hsl.s>.35?'#'+m.color.getHexString(THREE.SRGBColorSpace):role===2?pal.roofPaint:pal.paint),trim:new THREE.Color(pal.trim),mural};
   install(c,cls??'plaster',1,1,key+'|'+mesh.name,style);clones.set(id,c);ownedClone.add(c);made++;}
  mesh.material=c;
 }
 return made;
}
const ownedClone=new WeakSet<THREE.Material>();
/** Which curated palette a building got (null when it has none). */
export function buildingPaletteOf(key:string){const a=assigned.get(key);return a?BUILDING_PALETTES[a.palette].name:null;}
/** Releases the per-building clones (call when the owning scenery is disposed). */
export function disposeBuildingIdentity(){for(const c of clones.values())c.dispose();clones.clear();assigned.clear();}

/** Idempotent pass over a rendered subtree; new materials (lazily created fixtures) are picked up on later calls. */
export function applyWorldRealism(root:THREE.Object3D,options:{classify?:(m:THREE.Material,names:string[])=>RealismClass|null;buildings?:boolean}={}){
 const classify=options.classify??classifyRealism;if(options.buildings)applyBuildingIdentity(root);const seen=new Map<THREE.Material,{names:string[];height:number}>();
 root.traverse(o=>{
  // Skinned actors keep their audited appearance-preset materials untouched.
  if(!(o as THREE.Mesh).isMesh||(o as THREE.SkinnedMesh).isSkinnedMesh)return;const mesh=o as THREE.Mesh;
  if(mesh.userData.cameraTransparent&&!/water/i.test(mesh.name+' '+(mesh.parent?.name??'')))return;
  for(const m of ([] as THREE.Material[]).concat(mesh.material)){
   if(patched.has(m))continue;
   let row=seen.get(m);if(!row){row={names:[],height:Math.max(topOf(mesh.geometry),1e-3)};seen.set(m,row);}
   if(row.names.length<6)row.names.push((mesh.parent?.name??'')+' > '+mesh.name);
  }
 });
 let added=0;
 for(const [m,row] of seen){const cls=classify(m,row.names);if(!cls){patched.set(m,{cls:'generic',onBeforeCompile:m.onBeforeCompile,key:m.customProgramCacheKey});continue;}const regions=(m as THREE.MeshStandardMaterial).vertexColors&&/^Regions (plaster|roof|stone|timber)/.test(m.name)&&(cls==='plaster'||cls==='roof'||cls==='stone'||cls==='wood');
  install(m as THREE.MeshStandardMaterial,cls,row.height,STRENGTH[cls],row.names.join('|'),cls==='ground'&&row.names.some(n=>/commons-ground|> floor\b/.test(n))?{role:5,wall:0,roof:0,baseY:0,paint:new THREE.Color(1,1,1),trim:new THREE.Color(1,1,1)}:regions?{role:6,wall:0,roof:0,baseY:0,paint:new THREE.Color(1,1,1),trim:new THREE.Color(1,1,1)}:undefined);added++;}
 return added;
}

/** Scene-level siblings (commons dressing, native fixtures, understory). Whole subtrees that hold
 * actors (any skinned mesh), floaters or Little Martians kin are left to their own appearance owners. */
export function applySceneryRealism(scene:THREE.Object3D,skip:readonly THREE.Object3D[]=[]){
 let added=0;
 for(const child of scene.children){
  if(skip.includes(child)||/^(floaters|kin)$|^floater:/.test(child.name))continue;
  let actor=false;child.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)actor=true;});
  if(!actor)added+=applyWorldRealism(child);
 }
 return added;
}

/** W2b: an entity building kit material takes old Eden's building identity (role 7): the wall material patterns the outer
 *  faces its geometry marks with an `edenFace` attribute (brick/ashlar/clapboard/limewash by `wall`), the roof material
 *  its sloped faces (clay tile/slate/shingle by `roof`); floors keep the timber class. The paint stays the vertex colour.
 *  Idempotent; phones keep their plain materials. */
export function applyBuildingFinish(material:THREE.Material,layer:'wall'|'roof'|'floor',finish:{wall:number;roof:number}={wall:4,roof:0}){
 if(patched.has(material)||!(material instanceof THREE.MeshStandardMaterial))return false;
 if((globalThis as {__soulsQuality?:{tier?:string}}).__soulsQuality?.tier==='phone'){patched.set(material,{cls:'generic',onBeforeCompile:material.onBeforeCompile,key:material.customProgramCacheKey});return false;}
 if(layer==='floor'){install(material,'wood',1,STRENGTH.wood,'building floor');return true;}
 const style:BuildingStyle={role:7,wall:finish.wall,roof:finish.roof,baseY:0,paint:new THREE.Color(1,1,1),trim:new THREE.Color(1,1,1)};
 install(material,layer==='wall'?'plaster':'roof',1,1,`building ${layer} ${layer==='wall'?finish.wall:finish.roof}`,style,layer==='wall');return true;
}
/** W2b: a lawn turf material (vertex-coloured) takes the meadow ground class with old Eden's mown bands along `axis`
 *  (a unit xz direction; the lawn's long side). One material per axis; same program as every ground. */
export function applyMownTurf(material:THREE.Material,axis:[number,number]){
 if(patched.has(material)||!(material instanceof THREE.MeshStandardMaterial))return false;
 install(material,'ground',1,STRENGTH.ground,'mown lawn',{role:5,wall:axis[0],roof:axis[1],baseY:0,paint:new THREE.Color(1,1,1),trim:new THREE.Color(1,1,1)});return true;
}
/** Class actually installed on a material (null when untouched). */
export function realismNamesOf(material:THREE.Material){return patched.get(material)?.names??null;}
export function realismClassOf(material:THREE.Material):RealismClass|null{const p=patched.get(material);return p&&material.onBeforeCompile!==p.onBeforeCompile?p.cls:null;}

/** Restore pristine compile hooks on given materials (e.g. before a surface study or wind takes ownership); they stay opted out. */
// PERF-BATCH: the realism shader seeds each object's tone from its origin (vEdenO) and reads its local height
// (vEdenH), both lost when geometries merge into one scene-space mesh. A merged batch draws with this derived copy of
// the material (same patch and uniform objects, EDEN_MERGED defined) and carries origin + local y per vertex, so every
// source pixel shades exactly as its original did. Null for a material the realism pass has not installed.
const mergedVariants=new WeakMap<THREE.Material,{material:THREE.MeshStandardMaterial;from:THREE.Material['onBeforeCompile']}>();
// PERF-BATCH round 2: one merged material per signature: every installed material whose shader reads the same things
// apart from class, seed and style (per vertex in a merged batch) draws from one program and one material, so a cell's
// walls of every finish, or its roofs, are one draw (Eden 2026: 9 building materials → 3).
const mergedShared=new Map<string,{material:THREE.MeshStandardMaterial;source:THREE.Material;from:THREE.Material['onBeforeCompile']}>();
const MAP_KEYS=['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap','alphaMap','bumpMap','lightMap','displacementMap','envMap'] as const;
function mergedSignature(m:THREE.MeshStandardMaterial,i:NonNullable<ReturnType<typeof installed.get>>){
 return [m.constructor.name,m.customProgramCacheKey.call(m),i.facade?1:0,i.realism.y,i.realism.w,i.style.w,i.paint.getHex(),i.trim.getHex(),i.mural?m.uuid:0,m.color.getHex(),m.roughness,m.metalness,m.emissive.getHex(),m.emissiveIntensity,m.side,m.shadowSide,m.flatShading?1:0,m.vertexColors?1:0,m.transparent?1:0,m.opacity,m.depthWrite?1:0,m.depthTest?1:0,m.alphaTest,m.alphaHash?1:0,m.alphaToCoverage?1:0,m.polygonOffset?1:0,m.polygonOffsetFactor,m.polygonOffsetUnits,m.envMapIntensity,m.normalScale.x,m.normalScale.y,m.bumpScale,m.wireframe?1:0,m.dithering?1:0,m.toneMapped?1:0,m.fog?1:0,m.blending,m.depthFunc,m.colorWrite?1:0,m.forceSinglePass?1:0,m.premultipliedAlpha?1:0,m.precision,JSON.stringify(m.defines??null),JSON.stringify(m.userData),...MAP_KEYS.map(k=>(m[k] as THREE.Texture|null)?.uuid??'')].join('|');
}
export function mergedRealismMaterial(m:THREE.Material):THREE.Material|null{
 const p=patched.get(m),i=installed.get(m);if(!p||!i||m.onBeforeCompile===p.onBeforeCompile||!(m instanceof THREE.MeshStandardMaterial))return null;
 const known=mergedVariants.get(m);if(known&&known.from===m.onBeforeCompile)return known.material;
 const key=mergedSignature(m,i);let shared=mergedShared.get(key);
 if(!shared||shared.from!==shared.source.onBeforeCompile){
  const c=m.clone();c.onBeforeCompile=m.onBeforeCompile;c.customProgramCacheKey=()=>m.customProgramCacheKey.call(m)+'|merged';c.defines={...(c.defines??{}),EDEN_MERGED:''};c.name=(m.name||'realism')+' merged';c.userData.mergedRealism=true;c.needsUpdate=true;
  shared={material:c,source:m,from:m.onBeforeCompile};mergedShared.set(key,shared);
 }
 mergedVariants.set(m,{material:shared.material,from:m.onBeforeCompile});return shared.material;
}
/** Tests and probes: merged materials made so far. */
export function mergedRealismCount(){return mergedShared.size;}
/** Per-vertex `edenMerged` = (source object origin in the batch's frame, source local y) and `edenMergedS` = (realism
 *  class, seed, style code role + 8·wall + 64·roof) of `material` (the source mesh's installed material). Call before the
 *  copy is transformed into that frame; `toSceneLocal` is the source mesh's world matrix in the batch's frame. */
export function mergedRealismAttributes(copy:THREE.BufferGeometry,mesh:THREE.Mesh,toSceneLocal:THREE.Matrix4,material:THREE.Material=mesh.material as THREE.Material){
 const pos=copy.attributes.position,n=pos.count,out=new Float32Array(n*4),e=toSceneLocal.elements,ox=e[12],oy=e[13],oz=e[14];
 for(let i=0;i<n;i++){const o=i*4;out[o]=ox;out[o+1]=oy;out[o+2]=oz;out[o+3]=pos.getY(i);}
 copy.setAttribute('edenMerged',new THREE.BufferAttribute(out,4));
 const inst=installed.get(material);if(!inst)throw Error('eden-realism.merged-attributes.not-installed');
 const r=inst.realism,st=inst.style,whole=(v:number,max:number)=>Math.min(max,Math.max(0,Math.round(v)));
 const cls=r.x,seed=r.z,code=whole(st.x,7)+8*whole(st.y,7)+64*whole(st.z,7),style=new Float32Array(n*3);
 for(let i=0;i<n;i++){const o=i*3;style[o]=cls;style[o+1]=seed;style[o+2]=code;}
 copy.setAttribute('edenMergedS',new THREE.BufferAttribute(style,3));
}
export function releaseWorldRealism(materials:Iterable<THREE.Material>){
 for(const m of materials){const p=patched.get(m);if(!p)continue;m.onBeforeCompile=p.onBeforeCompile;m.customProgramCacheKey=p.key;m.needsUpdate=true;patched.set(m,{cls:'generic',onBeforeCompile:p.onBeforeCompile,key:p.key});}
}
