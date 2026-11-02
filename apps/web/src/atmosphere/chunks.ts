import * as THREE from 'three';
import {INDOOR_RECTS} from './indoors.ts';
import {COVER_A,COVER_B,COVER_MAP} from './rain-cover.ts';
import {GRADE_A,GRADE_B,GRADE_PARS,GRADE_GLSL} from './grade.ts';
/** Weather terms folded into three's shared fog chunks (installed once, before
 * the fogged programs compile). Every fogged built-in material gets:
 *  - low-lying mist (height-limited, patchy) on top of the scene's exp² fog;
 *  - drifting cloud shadows on direct (sun) light;
 *  - wet ground: up-facing surfaces darken and pick up a puddle sky sheen.
 * All three switch off at uniform 0 (the defaults), so materials that never
 * receive these uniforms (custom ShaderMaterials) are unaffected. The
 * uniforms are shared plain objects so one write per frame updates all. */
export const ATMOS={value:{x:0,y:.5,z:0,w:0}}; // x cloud-shadow strength, y coverage threshold, zw drift
export const MIST={value:{x:0,y:0,z:-1.5,w:0}}; // x mist amount, y time (s, wrapped), z base y, w wetness
export const SHEEN={value:{x:.6,y:.65,z:.7,w:0}}; // xyz sky colour reflected by puddles (linear), w rain intensity
/** Desert dust: x amount (0..0.5), yz world-clock drift, w reserved. Zero costs no noise fetch. */
export const DUST={value:{x:0,y:0,z:0,w:0}};
/** Tileable fbm value noise, one texture for all weather patterns (R clouds, G mist, B puddles, A spare):
 * one filtered fetch replaces several procedural noise evaluations per pixel. */
export function makeAtmosphereNoise(size=128){
 const data=new Uint8Array(size*size*4);
 const hash=(x:number,y:number,s:number)=>{let h=(Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(s,1442695041))|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
 // PERF-LOAD: each (period, seed) lattice hashed once (the same values), not four hashes per sample (~60 ms at load)
 const lattices=new Map<number,Float64Array>(),lattice=(period:number,seed:number)=>{const k=seed*1024+period;let L=lattices.get(k);if(!L){L=new Float64Array(period*period);for(let j=0;j<period;j++)for(let i=0;i<period;i++)L[j*period+i]=hash(i,j,seed);lattices.set(k,L);}return L;};
 const value=(u:number,v:number,period:number,seed:number)=>{const x=u*period,y=v*period,i=Math.floor(x),j=Math.floor(y),fx=x-i,fy=y-j,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy),w=(a:number)=>((a%period)+period)%period;
  const L=lattice(period,seed),a=L[w(j)*period+w(i)],b=L[w(j)*period+w(i+1)],c=L[w(j+1)*period+w(i)],d=L[w(j+1)*period+w(i+1)];return a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy;};
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const u=x/size,v=y/size,o=(y*size+x)*4;
  for(let ch=0;ch<4;ch++){let s=0,amp=.5,norm=0;for(let oct=0;oct<4;oct++){s+=amp*value(u,v,4<<oct,ch*31+oct);norm+=amp;amp*=.5;}
   // stretch the fbm (which bunches around .5) back toward 0..1
   data[o+ch]=Math.round(255*Math.max(0,Math.min(1,(s/norm-.5)*1.6+.5)));}}
 const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;
 return t;
}
export const NOISE_MAP={value:null as THREE.Texture|null};
const NOISE=/* glsl */`
float edenAtmosHash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float edenAtmosNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(edenAtmosHash(i),edenAtmosHash(i+vec2(1.0,0.0)),f.x),mix(edenAtmosHash(i+vec2(0.0,1.0)),edenAtmosHash(i+vec2(1.0,1.0)),f.x),f.y);}
`;
let installed=false;
// WEATHER-FX: rain cover (rain-cover.ts) and raindrop rings with a fresh random centre per drop (no lattice).
const COVER=`uniform sampler2D uEdenCoverMap;uniform vec4 uEdenCoverA;uniform vec4 uEdenCoverB;
bool edenCovered(vec3 w){if(uEdenCoverA.w<.5)return false;vec2 uv=(w.xz-uEdenCoverA.xy)*uEdenCoverA.z;
 if(uv.x<=0.0||uv.y<=0.0||uv.x>=1.0||uv.y>=1.0)return false;vec4 c=texture2D(uEdenCoverMap,uv);if(c.a<.5)return false;
 return w.y<uEdenCoverB.x+(c.r*65280.0+c.g*255.0)/65535.0*uEdenCoverB.y-.6;}
float edenDropRing(vec2 q,float t,float seed){
 vec2 cell=floor(q);float h0=edenAtmosHash(cell+seed);float tt=t*1.4+h0;float n=floor(tt),ph=tt-n;
 float h1=edenAtmosHash(cell+vec2(n*.731+seed,n*1.37)),h2=fract(h1*41.7),h3=fract(h1*93.1);
 vec2 l=fract(q)-.5-(vec2(h1,h2)-.5)*.56;
 return step(.3,h3)*smoothstep(.04,.0,abs(length(l)-ph*.22))*(1.0-ph);}
`;
export function installAtmosphereChunks(){
 if(installed)return;installed=true;NOISE_MAP.value=makeAtmosphereNoise();
 const C=THREE.ShaderChunk;
 C.fog_pars_vertex+='\n#ifdef USE_FOG\nvarying vec3 vEdenAtmosW;\n#endif\n';
 C.fog_vertex+='\n#ifdef USE_FOG\nvEdenAtmosW=transpose(mat3(viewMatrix))*(mvPosition.xyz-viewMatrix[3].xyz);\n#endif\n';
 // Known interiors stay dry (static rectangles compiled in; evaluated only while the ground is wet).
 const f=(n:number)=>n.toFixed(2),dry='bool edenIndoor(vec3 w){'+INDOOR_RECTS.map(r=>`if(w.x>${f(r[1])}&&w.x<${f(r[3])}&&w.z>${f(r[2])}&&w.z<${f(r[4])}&&w.y<${f(r[5])})return true;`).join('')+'return false;}\n';
 C.fog_pars_fragment+='\n#ifdef USE_FOG\n'+dry+'varying vec3 vEdenAtmosW;\nuniform vec4 uEdenAtmos;\nuniform vec4 uEdenMist;\nuniform vec4 uEdenSheen;\nuniform vec4 uEdenDust;\nuniform sampler2D uEdenNoise;\n'+GRADE_PARS+NOISE+COVER+'#endif\n';
 const mix='gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );';
 if(C.fog_fragment.includes(mix))C.fog_fragment=C.fog_fragment.replace(mix,`if(uEdenMist.x>0.0){
  float edenH=max(vEdenAtmosW.y-uEdenMist.z,0.0);
  float edenN=texture2D(uEdenNoise,vEdenAtmosW.xz*(1.0/90.0)+uEdenAtmos.zw*.42).g;
  float edenM=uEdenMist.x*exp(-edenH/2.2)*(1.0-exp(-vFogDepth*.06))*(.55+.75*edenN);
  fogFactor=1.0-(1.0-fogFactor)*(1.0-clamp(edenM,0.0,.92));
 }
 if(uEdenDust.x>0.0){
  float dustField=texture2D(uEdenNoise,vEdenAtmosW.xz*(1.0/110.0)+uEdenDust.yz).g;
  float dustPatch=smoothstep(.18,.8,dustField);
  float dustLow=exp(-max(vEdenAtmosW.y,0.0)/9.0);
  float dustMass=uEdenDust.x*dustLow*(1.0-exp(-vFogDepth*.035))*(.35+1.15*dustPatch);
  fogFactor=1.0-(1.0-fogFactor)*(1.0-clamp(dustMass,0.0,.55));
 }
 ${mix}
 ${GRADE_GLSL}`);
 C.lights_fragment_end+=`
#ifdef USE_FOG
if(uEdenAtmos.x>0.0){
 float edenCn=texture2D(uEdenNoise,vEdenAtmosW.xz*(1.0/364.0)+uEdenAtmos.zw*.25).r;
 float edenShade=smoothstep(uEdenAtmos.y-.1,uEdenAtmos.y+.1,edenCn);
 float edenK=1.0-uEdenAtmos.x*edenShade;
 reflectedLight.directDiffuse*=edenK;reflectedLight.directSpecular*=edenK;
}
#ifndef USE_SKINNING
if(uEdenMist.w>0.0&&!edenIndoor(vEdenAtmosW)&&!edenCovered(vEdenAtmosW)){
 float edenUp=max(dot(normal,normalize((viewMatrix*vec4(0.0,1.0,0.0,0.0)).xyz)),0.0);
 float edenWet=uEdenMist.w*smoothstep(.55,.95,edenUp);
 reflectedLight.directDiffuse*=1.0-.38*edenWet;reflectedLight.indirectDiffuse*=1.0-.3*edenWet;
 // two rotated, differently scaled taps break up the value-noise lattice into rounder puddles
 vec2 edenPq=vEdenAtmosW.xz*(1.0/12.0);
 float edenPn=.5*(texture2D(uEdenNoise,mat2(.866,.5,-.5,.866)*edenPq).b+texture2D(uEdenNoise,mat2(.5,-.866,.866,.5)*edenPq*1.37+.31).b);
 // puddles collect on paths, soil and paving, not on grass (green-dominant albedo)
 float edenBare=smoothstep(-.02,.05,diffuseColor.r-diffuseColor.g);
 float edenPud=smoothstep(.6,.7,edenPn)*edenWet*smoothstep(.97,.995,edenUp)*edenBare;
 float edenFr=pow(1.0-max(dot(normal,normalize(vViewPosition)),0.0),3.0);
 float edenRing=0.0;
 // open water (blue-dominant, flat) takes rain rings everywhere
 float edenWater=smoothstep(.03,.1,diffuseColor.b-diffuseColor.r)*smoothstep(.97,.995,edenUp);
 // drops on exposed hard surfaces (roofs, paving, stone) that hold no puddle
 float edenHard=edenWet*edenBare*smoothstep(.6,.85,edenUp)*(1.0-smoothstep(.0,.5,edenPud));
 if(uEdenSheen.w>0.0&&(edenPud>0.0||edenWater>0.0||edenHard>0.0)){
  // two offset, rotated layers of ~45 cm cells; each drop lands at its own random spot in its cell, some cells skip a beat
  vec2 edenQ=vEdenAtmosW.xz*2.2;
  edenRing=edenDropRing(edenQ,uEdenMist.y,0.0)+edenDropRing(mat2(.799,.602,-.602,.799)*edenQ*1.31+vec2(.37,.11),uEdenMist.y*1.13,7.0);
  // fade with distance before the cells alias into moire
  edenRing*=uEdenSheen.w*smoothstep(32.0,12.0,vFogDepth);
 }
 reflectedLight.indirectSpecular+=uEdenSheen.rgb*(edenPud*((.08+.92*edenFr)*.35+edenRing*.22)+edenWater*edenRing*.3+edenHard*edenRing*.16);
}
#endif
#endif
`;
 for(const lib of Object.values(THREE.ShaderLib)){if(!lib.uniforms||!('fogDensity' in lib.uniforms))continue;
  lib.uniforms.uEdenAtmos=ATMOS;lib.uniforms.uEdenMist=MIST;lib.uniforms.uEdenSheen=SHEEN;lib.uniforms.uEdenDust=DUST;lib.uniforms.uEdenNoise=NOISE_MAP;lib.uniforms.uEdenCoverMap=COVER_MAP;lib.uniforms.uEdenCoverA=COVER_A;lib.uniforms.uEdenCoverB=COVER_B;lib.uniforms.uEdenGradeA={value:GRADE_A};lib.uniforms.uEdenGradeB={value:GRADE_B};}
}
