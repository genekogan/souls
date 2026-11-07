import {DECORATIVE_MOTION,nextFerrisAngle} from '../../../mars/viewer/app/engine-view/content/assets/decorative-motion.ts';
import {EDEN_WATER_DAYLIGHT} from '../../../mars/viewer/app/engine-view/content/environment/eden-water-readability/daylight.ts';
import {visualWindStrength} from './atmosphere/visual-transitions.ts';
import {twilightColour} from './atmosphere/twilight.ts';
import * as THREE from 'three';
import {WIND,WindPatches} from './atmosphere/wind.ts';
import {Fauna} from './atmosphere/fauna.ts';
import {Balloons} from './atmosphere/balloons.ts';
import {Fireflies,Smoke} from './atmosphere/particles.ts';
import {findAnchors,underCover} from './atmosphere/finder.ts';
import {insideBuilding} from './atmosphere/indoors.ts';
import {installAtmosphereChunks,ATMOS,MIST,SHEEN,DUST,NOISE_MAP} from './atmosphere/chunks.ts';
import {desertDustAt,parseDustOverride,DESERT_DUST_SEED,type DustSample} from './atmosphere/desert-dust.ts';
import {SkyDome,bowSunGate} from './atmosphere/sky.ts';
import {RainbowThings} from './atmosphere/rainbow-things.ts';
import {skyLook,type SkyLook} from './atmosphere/palettes.ts';
import {COVER_A,updateRainCover,rainCoverRendering,disposeRainCover} from './atmosphere/rain-cover.ts';
import {MotionPatches,ROTOR,RIPPLE,SKY_OBJECTS} from './atmosphere/motion.ts';
import {Rain} from './atmosphere/rain.ts';
import {Halos,type HaloSource} from './atmosphere/halos.ts';
import {registerFx} from './fx/debug.ts';
import {Lighthouse} from './atmosphere/lighthouse.ts';
import {FogBanks} from './atmosphere/fogbanks.ts';
import {SURF} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/coast-surf.ts';
import {skyBodies,type SkyBodies} from './atmosphere/astro.ts';
import {setGrade,clearGrade} from './atmosphere/grade.ts';
import {setWindowLife} from './WorldNightLights.ts';
import {ScaledNumber,TintedColor,overcast} from './atmosphere/lighting.ts';
import {type WeatherState,type WeatherKind,type WeatherOverride,weatherKindAt,targetFor,easeWeather,copyWeather,weatherEaseRate,setWeatherChanged,parseWeatherOverride,cycleKind,clockMs,hourOf,hash01} from './atmosphere/weather.ts';
/** World Motion & Weather lane entry point (owned by that lane): wind, flags,
 * birds, smoke, water motion, clouds, rain, fog. Presentation only.
 *
 * Everything here is decorative: no simulation, entity or camera authority.
 * Own objects live directly under the scene root (never inside a camera
 * visibility/raycast root). Other modules are found by traversing the given
 * scene at most once every few seconds; with `eden` false every change is
 * restored. URL overrides for review: `?weather=clear|cloudy|rain|wind|fog` (applied at once),
 * `cycle` (45 s each), `afterrain` (rain clearing → wet ground, rainbow), `off` (atmosphere fully off).
 *
 * Map (atmosphere/): weather.ts deterministic schedule + easing (pure); chunks.ts fog-chunk patch
 * (fog layer, low mist, cloud shadows, wet ground/puddles; one noise texture); wind.ts plant/cloth
 * sway by material patch; motion.ts windmill sails, fountain ripples, ornamental clouds; sky.ts dome
 * (clouds, stars, rainbow); rain.ts rain + blown leaves; fauna.ts birds/gulls/ducks/butterflies;
 * particles.ts fireflies/moths and chimney smoke; finder.ts the periodic scene scan; lighting.ts
 * exact multiply/restore of Daylight-owned values. */
export type AtmosphereFrame={seconds:number;dt:number;daylight:number|null;camera:THREE.Camera;eden:boolean;reducedMotion:boolean;
 /** World clock (ISO) when the caller has it; weather falls back to the wall clock. */
 clock?:string|null;
 /** R4-LIVE: 'world' = a god-built world (new worlds): the same sky, weather, wind, birds and lamps' halos, without
  * Eden's own fixtures (harbour lighthouse, sea fog banks, the balloon tracks, the commons fire pits). Default 'eden'. */
 profile?:'eden'|'world';
 /** A god world's set weather (its `world` state, kind other than 'auto'); null/undefined = the scheduled weather. */
 weather?:SetWeather|null;
 /** A god world's own "is this point under a roof" (Eden's are its building list). */
 indoors?:(x:number,y:number,z:number)=>boolean};
/** A god's weather as set (apps/server god/world-env.ts): channels 0..1; kind 'storm' brings lightning. */
export type SetWeather={kind:string;clouds:number;rain:number;wind:number;fog:number;intensity:number};
export type AtmosphereInspection={bow:number;rainbowThings:number;rainbowThing:number;sun:number[];rainCover:number;profile:'eden'|'world';dust:({profile:'mars-desert';seed:number}&DustSample)|null;set:boolean;lightning:number;active:boolean;rotor:boolean;fountainWater:number;skyClouds:number;kind:WeatherKind|null;state:WeatherState;windMaterials:number;windModes:Record<string,number>;smokeSources:number;flowers:number;meadow:number;roofs:number;water:number;harbour:boolean;scans:number;lightCollects:number;lightRefreshes:number;drawCalls:number};
const SCAN_AT=[0,1.5,5,12,25,45];
/** W2b: phones skip the sea fog banks (big alpha-blended puffs: fill rate). */
/** Rainbow life after a shower stops (world seconds): full until HOLD, gone by GONE. */
const BOW_HOLD_S=100,BOW_GONE_S=240;
const phoneTier=()=>(globalThis as {__soulsQuality?:{tier?:string}}).__soulsQuality?.tier==='phone';const RESCAN_EVERY=30;
const WHITE=new THREE.Color(1,1,1);
/** The kind a set weather draws as (its own name, or for 'manual' the nearest by its channels). */
function setKind(w:SetWeather):WeatherKind{
 if(w.kind!=='manual'&&w.kind!=='auto')return w.kind as WeatherKind;
 return w.rain>.6&&w.wind>.6&&w.clouds>.9?'storm':w.rain>.3?'rain':w.fog>.5?'fog':w.wind>.7?'wind':w.clouds>.5?'cloudy':'clear';
}
const pulse=(u:number,c:number,w:number)=>{const x=(u-c)/w;return Math.exp(-x*x);};
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function createWorldAtmosphere(scene:THREE.Scene):{update(frame:AtmosphereFrame):void;dispose():void;inspect():AtmosphereInspection;
 /** Explore place shots (Gene #13): pose the atmosphere as a clear, dry, still day at `clock` for one offscreen render;
  * returns the undo, which puts back the live weather exactly (no easing, no flicker in the main view). */
 photo(clock:string|null,daylight:number|null):()=>void;
 /** R4-LIVE hook (GOD-ENV: thunder sound, a bolt): called when a lightning flash starts, with its strength and sky direction. */
 onLightning:((strength:number,dir:THREE.Vector3)=>void)|null}{
 const override:WeatherOverride=typeof location!=='undefined'?parseWeatherOverride(location.search):null;
 const dustOverride=typeof location!=='undefined'?parseDustOverride(location.search):null;
 const root=new THREE.Group();root.name='atmosphere (decorative; not a camera root)';root.userData.cameraTransparent=true;
 const beacons:Lighthouse[]=[];let lanternKey='';
 let windHeld=0;registerFx('atmosphere',{set(on){smoke.points.visible=on&&smoke.sourceCount>0;for(const b of beacons)b.group.visible=on;if(!on){windHeld=WIND.value.y||windHeld;WIND.value.y=0;}else if(windHeld){WIND.value.y=windHeld;}},stats(){return {smoke:smoke.sourceCount,lighthouses:beacons.length,windMaterials:wind.count};}});
 const fauna=new Fauna(),fireflies=new Fireflies(),smoke=new Smoke(),sky=new SkyDome(),rain=new Rain(),balloons=new Balloons(),halos=new Halos(),lighthouse=new Lighthouse(),fogBanks=new FogBanks();
 root.add(sky.mesh,fauna.mesh,fireflies.points,smoke.points,rain.lines,balloons.mesh,halos.mesh,lighthouse.group,fogBanks.mesh);
 // Fog is installed once, before anything compiles, at zero density (inert) so weather never recompiles programs.
 installAtmosphereChunks();sky.uniforms.uNoise.value=NOISE_MAP.value;
 const fog=new THREE.FogExp2(0xffffff,0);const ownsFog=!scene.fog;if(ownsFog)scene.fog=fog;
 const lights:{sun:ScaledNumber|null;hemi:ScaledNumber|null;sunLight:THREE.DirectionalLight|null}={sun:null,hemi:null,sunLight:null};
 const background=new TintedColor(()=>(scene.background as THREE.Color|null)?.isColor?scene.background as THREE.Color:null);
 const rainbowThings=new RainbowThings();
 const cWarm=new THREE.Color(),cSky=new THREE.Color(),cGrey=new THREE.Color(),cFog=new THREE.Color(),cTmp=new THREE.Color(),sunDir=new THREE.Vector3();
 const dustColor=new THREE.Color('#c4a57e'),dustSample=desertDustAt(0);let desert=false,dustScheduled=false;
 let driftX=0,driftZ=0;
 const wind=new WindPatches(),motion=new MotionPatches();let sailAngle=0,ferrisAngle=0;
 const own=(o:THREE.Object3D)=>o===root;
 const state:WeatherState={cloud:0,rain:0,wind:0,fog:0,mist:0,wet:0},target:WeatherState={...state};
 let worldBalloons=false,worldFog=false;
 let profile:'eden'|'world'='eden',setWeather:SetWeather|null=null,lastSet:SetWeather|null=null,godChangeAt=-Infinity,indoorsOf:AtmosphereFrame['indoors']=undefined,lastFlash=0,flashCell=-1;
 let clockAt=0,clockNow=0,active=false,closed=false,initialised=false,expansionSeen=-1,scans=0,nextScan=0,kind:WeatherKind|null=null,lastFound={flowers:0,meadow:0,roofs:0,water:0,harbour:false};
 // Pixel scale for world-sized point sprites, read where the renderer is known (no allocation).
 const size=new THREE.Vector2();
 const pointScale=function(this:THREE.Points,renderer:THREE.WebGLRenderer,_s:THREE.Scene,camera:THREE.Camera){
  renderer.getDrawingBufferSize(size);const fov=(camera as THREE.PerspectiveCamera).isPerspectiveCamera?(camera as THREE.PerspectiveCamera).fov:50;
  const k=size.y/(2*Math.tan(fov*Math.PI/360));fireflies.uniforms.uFly.value.z=k;smoke.uniforms.uSmoke.value.z=k;};
 fireflies.points.onBeforeRender=pointScale;smoke.points.onBeforeRender=pointScale;
 halos.mesh.onBeforeRender=function(renderer:THREE.WebGLRenderer,_s:THREE.Scene,camera:THREE.Camera){renderer.getDrawingBufferSize(size);
  const fov=(camera as THREE.PerspectiveCamera).isPerspectiveCamera?(camera as THREE.PerspectiveCamera).fov:50;halos.uniforms.uHalo.value.z=size.y/(fov*Math.PI/180);};
 // Sky bodies (sun, moon and phase, star rotation) from the world clock, recomputed about once a second.
 let bodies:SkyBodies|null=null,bodiesAt=-Infinity,bodiesClock='';
 const lightList:HaloSource[]=[],lv=new THREE.Vector3();
 const lightPublishers:{node:THREE.Object3D;list:unknown;offset:number;moveVersion:unknown}[]=[];
 let lightCollects=0,lightRefreshes=0;
 /** Published night lights (lamps, lanterns, fires) in world space, for the glow sprites. */
 function publish(o:THREE.Object3D,list:unknown[]){lightPublishers.push({node:o,list,offset:lightList.length,moveVersion:o.userData.edenLightMoveVersion});o.updateWorldMatrix(true,false);
   for(const a of list){if(!Array.isArray(a)||a.length<3)continue;lv.set(+a[0],+a[1],+a[2]).applyMatrix4(o.matrixWorld);lightList.push([lv.x,lv.y,lv.z,String(a[3]??'lamp'),a[4]===undefined?1:+a[4],a[5],a[6],a[7]]);}}
 function finishLights(){
  // The commons campfire (native fixture) and the garden fire circle publish no anchors of their own.
  if(lightList.length&&profile==='eden')lightList.push([24,0,-7,'fire',1],[47,0,64,'fire',.8]);
  halos.setSources(lightList);}
 function collectLights(){lightList.length=0;lightPublishers.length=0;scene.updateWorldMatrix(true,false);lightCollects++;
  scene.traverse(o=>{if(o===root)return;const list=o.userData?.edenLightSources;if(Array.isArray(list))publish(o,list);});finishLights();}
 /** M01: a known publisher replaced its list (a lamp switched): the same halos from the known publishers, in scene order,
  *  without walking the whole scene. New publishers are still found by the periodic scan's collectLights. */
 function refreshLights(){const known=lightPublishers.map(p=>p.node);lightList.length=0;lightPublishers.length=0;scene.updateWorldMatrix(true,false);lightRefreshes++;
  for(const o of known){const list=o.userData?.edenLightSources;if(Array.isArray(list))publish(o,list);}finishLights();}
 /** Cached publishers supply only changed portable anchors; no scene traversal
  * or static light-list reconstruction for a lantern moving in one hand. */
 function moveLights(){for(const p of lightPublishers){const v=p.node.userData.edenLightMoveVersion;if(v===p.moveVersion)continue;p.moveVersion=v;
  for(const move of (p.node.userData.edenLightMoves??[]) as {index:number;at:HaloSource}[]){const a=move.at;lv.set(a[0],a[1],a[2]).applyMatrix4(p.node.matrixWorld);halos.moveSource(p.offset+move.index,lv.x,lv.y,lv.z);}
 }}
 function scan(seconds:number){
  wind.scan(scene,scans,scans===0?0:1,own);motion.scan(scene,own);
  const f=findAnchors(scene,own,!fauna.ducksPlaced);covers=f.covers;
  if(f.sun&&f.sun!==lights.sunLight){lights.sun?.restore();const sun=f.sun;lights.sun=new ScaledNumber(()=>sun.intensity,v=>{sun.intensity=v;});lights.sunLight=sun;}
  if(f.hemi&&!lights.hemi){const hemi=f.hemi;lights.hemi=new ScaledNumber(()=>hemi.intensity,v=>{hemi.intensity=v;});}
  if(f.flowers.length)fauna.setFlowers(f.flowers);if(f.water.length)fauna.setWater(f.water);if(f.harbour)fauna.setGulls(f.harbour.x,f.harbour.z);if(f.roofs.length)fauna.setPerches(f.roofs);if(f.meadow.length)fireflies.setSites(f.meadow);if(f.lamps.length)fireflies.setLamps(f.lamps);smoke.setSources(f.smoke);
  lastFound={flowers:f.flowers.length,meadow:f.meadow.length,roofs:f.roofs.length,water:f.water.length,harbour:!!f.harbour};
  let landing:readonly number[]|null=null;
  scene.traverse(o=>{const p=o.userData?.edenBalloonLanding;if(!landing&&Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)){o.updateWorldMatrix(true,false);const w=new THREE.Vector3(...p as [number,number,number]).applyMatrix4(o.matrixWorld);landing=w.toArray();}});
  balloons.setLanding(landing);
  // MARSLAND-FAR: a god world's sky palette (GodWorldLiving publishes state.sky.palette on its group)
  let pal:unknown=null;scene.traverse(o=>{if(pal===null&&typeof o.userData?.edenSkyPalette==='string')pal=o.userData.edenSkyPalette;});
  // W2b: a god world's drifting balloons and its sea fog band (GodWorldLiving publishes both on its group)
  let tracks:unknown=null,band:unknown=null;scene.traverse(o=>{if(o===root)return;if(tracks===null&&Array.isArray(o.userData?.edenBalloonTracks))tracks=o.userData.edenBalloonTracks;if(band===null&&Array.isArray(o.userData?.edenFogBand))band=o.userData.edenFogBand;});
  worldBalloons=Array.isArray(tracks)&&tracks.length>0;worldFog=Array.isArray(band)&&band.length>=4;
  if(worldBalloons)balloons.setTracks(tracks as number[][]);else balloons.setTracks(null);
  fogBanks.setBand(worldFog?(band as number[]).slice(0,4):null,worldFog?Number((band as number[])[4]??0):0);palLook=skyLook(pal);desert=pal==='mars-desert';
  collectLights();rainbowThings.scan(scene);
  // W2: a god world's lighthouses (GodWorldLiving publishes their lanterns); at most four beam pairs
  const lanterns:THREE.Vector3[]=[];scene.traverse(o=>{const l=o.userData?.edenLighthouses;if(o===root||!Array.isArray(l))return;o.updateWorldMatrix(true,false);for(const a of l)if(Array.isArray(a)&&a.length===3&&a.every(Number.isFinite)&&lanterns.length<4)lanterns.push(new THREE.Vector3(a[0],a[1],a[2]).applyMatrix4(o.matrixWorld));});
  const lkey=lanterns.map(v=>v.toArray().map(n=>n.toFixed(1)).join(',')).join(';');
  if(lkey!==lanternKey){lanternKey=lkey;for(const b of beacons)b.dispose();beacons.length=0;for(const v of lanterns){const b=new Lighthouse(v);beacons.push(b);root.add(b.group);}}
  scans++;const since=seconds-expansionSeen;nextScan=expansionSeen+(scans<SCAN_AT.length?SCAN_AT[scans]:since+RESCAN_EVERY);
 }
 function deactivate(){disposeRainCover();rainbowThings.apply(0);
  if(!active)return;active=false;WIND.value.y=0;root.visible=false;
  lights.sun?.restore();lights.hemi?.restore();background.restore();clearGrade();halos.mesh.visible=false;fog.density=0;DUST.value.x=0;MIST.value.x=0;MIST.value.w=0;ATMOS.value.x=0;SHEEN.value.w=0;RIPPLE.value.y=0;SURF.value.y=0;SKY_OBJECTS.value.x=SKY_OBJECTS.value.y=0;SKY_OBJECTS.value.z=1;ROTOR.value.w=sailAngle=0;
 }
 /** Clouds dim the sun and grey the sky; fog/mist thicken the air; rain wets the ground. */
 function applyWeather(frame:AtmosphereFrame,day:number){
  const base=background.sample();
  skyWanted=!!base;sky.mesh.visible=skyWanted;
  if(base){
   overcast(base,cGrey);cSky.copy(base).lerp(cGrey,state.cloud*.8);
   cFog.copy(cGrey).multiplyScalar(1.08+.1*day).lerp(cSky,.35);
   cTmp.copy(cSky).lerp(cFog,Math.min(1,state.fog*.9+state.rain*.25));background.write(cTmp);
   fog.color.copy(cFog);SHEEN.value.x=cSky.r;SHEEN.value.y=cSky.g;SHEEN.value.z=cSky.b;
   // Sky dome: zenith = the (weathered) background, hazier toward the horizon.
   sky.uniforms.uZenith.value.copy(cTmp).multiplyScalar(.94);
   sky.uniforms.uHorizon.value.copy(cTmp).lerp(WHITE,.16*day).lerp(cFog,Math.min(1,state.fog+state.mist*.3));
   // Clouds: bright and silver by day; at night barely distinct from the sky.
   // ... and warm-lit by a low sun (Daylight warms the sun colour at dawn/dusk).
   cTmp.copy(cGrey).lerp(WHITE,.55);if(lights.sunLight)cTmp.multiply(cWarm.copy(WHITE).lerp(lights.sunLight.color,.85).multiplyScalar(1.12));
   sky.uniforms.uCloudLit.value.copy(cGrey).multiplyScalar(1.12).lerp(cTmp,Math.min(1,day*1.4));
   sky.uniforms.uCloudShade.value.copy(cGrey).multiplyScalar(.88-.24*day);
   // MARSLAND-FAR: a palette's own sky by day (clouds and fog fade it back to the weathered default)
   if(palLook){const k=day*(1-.85*state.cloud)*(1-state.fog);sky.uniforms.uZenith.value.lerp(palLook.zenith,k);sky.uniforms.uHorizon.value.lerp(palLook.horizon,k);fog.color.lerp(palLook.horizon,k*.6);}
   if(dustScheduled){
    cWarm.copy(dustColor).multiplyScalar(.12+.88*day);fog.color.copy(cWarm);
    sky.uniforms.uZenith.value.lerp(cWarm,dustSample.intensity*.55);
    sky.uniforms.uHorizon.value.lerp(cWarm,dustSample.intensity*1.5);
    cTmp.copy(base).lerp(cWarm,dustSample.intensity*.6);background.write(cTmp);
   }
  }
  // Fog is a ground layer: looking down from high up (overview) passes through less of it.
  mistWanted=Math.min(1,state.mist+state.fog*.35);
  forCamera(frame.camera);
  lights.sun?.apply((1-.72*state.cloud)*(1-dustSample.intensity*.85));lights.hemi?.apply((1-.1*state.cloud-.08*state.fog)*(1-dustSample.intensity*.18));
  // Cloud shadows drift downwind; fewer but crisper in fair weather, broad and faint under overcast.
  const drift=frame.reducedMotion?0:(2+6*state.wind)*.011*Math.min(frame.dt,.25);driftX=(driftX+WIND.value.z*drift)%1000;driftZ=(driftZ+WIND.value.w*drift)%1000;
  ATMOS.value.x=desert?0:day*(.28*(1-state.cloud)+.1)*(1-state.fog*.8);ATMOS.value.y=.74-state.cloud*.42;ATMOS.value.z=-driftX;ATMOS.value.w=-driftZ;
  MIST.value.w=state.wet;
  sky.uniforms.uCloud.value.set(dustScheduled?0:Math.min(1,.18+.82*state.cloud+state.rain*.1),driftX*2.2,driftZ*2.2,day);
  const sun=lights.sunLight;if(sun){sunDir.copy(sun.position).sub(sun.target.position).normalize();sky.uniforms.uSunDir.value.copy(sunDir);}
  // A rainbow opposite the sun once rain passes while the ground is still wet; with the sun above ~42 deg the whole bow
  // sits below the horizon, so strength (and inspect().bow) is 0 there.
  // WEATHER-FX (Gene #18): only for a few world minutes after a real shower stops, and never with the sun low or down
  // (the night sun is parked just under the horizon, which used to put a full bow overhead all night).
  // Age in world seconds, or viewing seconds when the world clock is slower or held (shots). A place shot's dry clear
  // frame is not the end of a shower: it leaves the bow's state alone.
  if(!photoFrame){if(state.rain>.35)bowArmed=true,bowFrom=null;else if(bowArmed&&state.rain<.08){bowArmed=false;bowFrom=clockNow;bowSeen=0;}
   if(bowFrom!==null)bowSeen+=Math.min(frame.dt,1);}
  const bowAge=bowFrom===null?-1:Math.max(bowSeen,(clockNow-bowFrom)/1000);
  // Expiry is final for this shower, even if a later clock adjustment moves world time backwards.
  if(!photoFrame&&bowAge>=BOW_GONE_S)bowFrom=null;
  const bowLife=bowAge<0?0:smooth(0,20,bowAge)*(1-smooth(BOW_HOLD_S,BOW_GONE_S,bowAge));
  const bowWeather=bowLife*smooth(.3,.8,state.wet)*(1-smooth(.08,.35,state.rain))*(1-smooth(.5,.8,state.cloud))*smooth(.45,.8,day);
  sky.uniforms.uBow.value.x=bowWeather*bowSunGate(sunDir.y);
  // A god-built rainbow thing keeps the same post-rain daylight window (it is no optical bow, so no sun-height cut).
  rainbowThings.apply(bowWeather);
  // Stars on clear nights (clouds and fog hide them).
  sky.uniforms.uBow.value.y=(1-smooth(.05,.3,day))*(1-smooth(.3,.75,state.cloud))*(1-state.fog)*(1-state.mist*.5);sky.uniforms.uBow.value.z=frame.reducedMotion?0:frame.seconds%600;
  // Distant lightning in a storm: brief double pulses in the cloud deck only (no scene light flash), a few per minute.
  // A god's storm (R4-LIVE) is a real one: flashes as often as its intensity says, as the rain and cloud build.
  const godStorm=setWeather?.kind==='storm'?setWeather.intensity*smooth(.5,.9,state.cloud):0;
  const storm=frame.reducedMotion?0:Math.max(godStorm,smooth(.9,.99,state.cloud)*smooth(.8,.97,state.rain)*smooth(.65,.8,state.wind));
  let flash=0;
  if(storm>0){const cell=Math.floor(frame.seconds/9),u=frame.seconds-cell*9-hash01(cell,71)*7;
   if(hash01(cell,72)<(godStorm>0?.9:.55)*storm&&u>0&&u<.6){flash=(pulse(u,.02,.05)+.65*pulse(u,.2,.05)+.3*pulse(u,.34,.04))*storm;
    const a=hash01(cell,73)*Math.PI*2;sky.uniforms.uFlash.value.set(0,Math.cos(a)*.96,.28,Math.sin(a)*.96);
    if(cell!==flashCell){flashCell=cell;try{api.onLightning?.(storm,new THREE.Vector3(sky.uniforms.uFlash.value.y,sky.uniforms.uFlash.value.z,sky.uniforms.uFlash.value.w));}catch{}}}}
  sky.uniforms.uFlash.value.x=flash;lastFlash=flash;
  // Sky bodies, dawn/dusk glow, night-sky visibility and the colour grade.
  if(frame.clock&&(Math.abs(frame.seconds-bodiesAt)>=1||Math.abs((Date.parse(frame.clock)||0)-(Date.parse(bodiesClock)||0))>60e3)){bodiesAt=frame.seconds;bodiesClock=frame.clock;bodies=skyBodies(frame.clock,bodies??undefined)??bodies;}
  if(!frame.clock)bodies=null;
  const u=sky.uniforms,b=bodies;
  if(b){const sunUp=smooth(-1.2,.8,b.sunElevation);u.uSun.value.set(b.sun.x,b.sun.y,b.sun.z,sunUp*(1-state.fog*.9));
   if(lights.sunLight)u.uSunColor.value.copy(lights.sunLight.color);
   const moonUp=smooth(-1.5,1.5,Math.asin(Math.max(-1,Math.min(1,b.moon.y)))*180/Math.PI);
   u.uMoon.value.set(b.moon.x,b.moon.y,b.moon.z,moonUp*(.3+.7*(1-day))*(1-state.fog*.85));
   u.uMoonLight.value.set(b.illumination,1-smooth(.05,.4,day),1-.75*b.illumination,0);
   u.uStarRot.value.copy(b.starRotation);
   // warm band on the sun's side at dawn/dusk, into a rosy-violet afterglow in the blue hour; less under cloud
   const dusk=(b.warmth*smooth(-.2,.6,day)*.55+b.blueHour*.35)*(1-.75*state.cloud)*(1-state.fog);
   if(lights.sunLight)cWarm.copy(lights.sunLight.color).lerp(cTmp.setRGB(1,.55,.38),.5).lerp(cTmp.setRGB(.62,.42,.62),b.blueHour*.7);else cWarm.setRGB(1,.6,.4);
   const glow=twilightColour(b.sunElevation,state.cloud,Math.floor(clockNow/86400000));
   cWarm.lerp(cTmp.setRGB(...glow.rgb),glow.strength*.6);
   u.uDusk.value.set(cWarm.r,cWarm.g,cWarm.b,dusk+glow.strength*.12*(1-state.fog));
   u.uCloudLit.value.lerp(cTmp.setRGB(...glow.rgb).multiplyScalar(.95),glow.strength*.28*(1-state.fog));
   sky.uniforms.uBow.value.y*=1-.5*b.illumination*moonUp;
   setGrade(day,b.warmth,b.blueHour,state.cloud);
  }else{u.uSun.value.w=0;u.uMoon.value.w=0;u.uDusk.value.w=0;u.uMoonLight.value.set(0,0,1,0);setGrade(day,0,0,state.cloud);}
  halos.update(frame.reducedMotion?0:frame.seconds,Math.pow(1-day,1.5),frame.reducedMotion);
  sky.follow(frame.camera);
 }
 /** Camera-dependent parts, redone for every render of the scene (the viewer camera, and on-demand eyes /
  * overhead / map snapshots): fog is a ground layer (thin from high up, none for orthographic map views),
  * and rain/sky follow whichever camera is drawing. */
 const camAt=new THREE.Vector3();let mistWanted=0,rainWanted=false,covers:number[]=[];
 function forCamera(camera:THREE.Camera){
  const ortho=!!(camera as THREE.OrthographicCamera).isOrthographicCamera;camera.getWorldPosition(camAt);
  const indoors=!ortho&&(profile==='world'?!!indoorsOf?.(camAt.x,camAt.y,camAt.z):insideBuilding(camAt.x,camAt.y,camAt.z)||underCover(covers,camAt));
  const layer=ortho?0:(indoors?.25:1)/(1+Math.max(0,camAt.y-6)/10);
  fog.density=ortho?0:.0009*(palLook?.fog??1)+(state.fog*.022+state.rain*.0055)*layer+state.cloud*.0006;
  // The dust layer is spatially uneven and ground-biased in the shared fog chunk.
  // Suppress it inside rooms, and omit it from map renders; a heavy episode stays navigable.
  DUST.value.x=dustScheduled&&!ortho?dustSample.intensity*(indoors?.06:1):0;
  const drift=frameDustDrift;DUST.value.y=drift;DUST.value.z=drift*.375;
  MIST.value.x=ortho||indoors?0:mistWanted;
  sky.uniforms.uBow.value.w=Math.min(.9,state.fog*.9*layer+state.rain*.25);
  // No rain, leaves or motes for a camera indoors / under a roof (they are camera-local and would fall through ceilings).
  rain.lines.visible=rainWanted&&!ortho&&!indoors;rain.uniforms.uCam.value.copy(camAt);
  sky.mesh.visible=skyWanted&&!ortho;if(!ortho){sky.mesh.position.copy(camAt);sky.mesh.updateMatrix();sky.mesh.updateMatrixWorld(true);}
 }
 let skyWanted=false,palLook:SkyLook|null=null,frameDustDrift=0;
 // Capture the callback value; disposal restores this exact function, and invocation below supplies its Scene receiver.
 const previousBeforeRender=Reflect.get(scene,'onBeforeRender') as THREE.Object3D['onBeforeRender'];
 const beforeRender:THREE.Object3D['onBeforeRender']=function(this:THREE.Object3D,renderer,s,camera,geometry,material,group){
  previousBeforeRender.call(this,renderer,s,camera,geometry,material,group);if(rainCoverRendering())return;lastRenderer=renderer;if(active&&!closed)forCamera(camera);};
 let lastRenderer:THREE.WebGLRenderer|null=null;
 let bowArmed=false,bowFrom:number|null=null,bowSeen=0;
 scene.onBeforeRender=beforeRender;
 function windDirection(seconds:number,ms:number){
  const day=Math.floor(ms/86_400_000),a=hash01(day,313)*Math.PI*2+Math.sin(seconds/420)*.35;
  WIND.value.z=Math.cos(a);WIND.value.w=Math.sin(a);
 }
 let lastFrame:AtmosphereFrame|null=null,photoFrame=false;
 const api={
  update(frame:AtmosphereFrame){
   if(closed)return;
   if(!photoFrame)lastFrame=frame;
   if(!frame.eden||override?.kind==='off'){deactivate();return;}
   const seconds=frame.seconds;
   profile=frame.profile??'eden';setWeather=frame.weather??null;indoorsOf=frame.indoors;
   // `eden` means the expansion is in the scene this frame: scan now so wind patches compile with its pre-warm.
   if(expansionSeen<0){expansionSeen=seconds;nextScan=seconds;}
   if(seconds>=nextScan)scan(seconds);
   // Lamp switches publish a new source array. Refresh just the halos immediately;
   // unchanged frames compare a few publisher references, not every world entity.
   else if(lightPublishers.some(p=>p.node!==scene&&!p.node.parent))collectLights();
   else if(lightPublishers.some(p=>p.node.userData.edenLightSources!==p.list))refreshLights();
   moveLights();
   // Any world can opt in using its admitted sky palette; no Mars identity special case.
   // Explicit owner weather wins over auto, unless a dust review override was requested.
   dustScheduled=!photoFrame&&desert&&!!(dustOverride||(!override&&!setWeather));
   if(dustScheduled){
    const worldMs=clockMs(frame.clock)??0;desertDustAt(worldMs,DESERT_DUST_SEED,dustOverride,dustSample);
    frameDustDrift=frame.reducedMotion?0:((worldMs/3_600_000)%8+8)%8;
   }else{dustSample.kind='clear';dustSample.intensity=0;}
   // Weather target from the world clock (or the review override), eased over minutes.
   // (Re)read the clock about once a second: the schedule is coarse, and this keeps frames allocation-free.
   if(photoFrame){clockNow=clockMs(frame.clock)??clockNow;kind='clear';targetFor('clear',frame.daylight===null?null:hourOf(clockNow),target);target.mist=target.wet=0;}
   else if(!initialised||Math.abs(seconds-clockAt)>=1){clockAt=seconds;clockNow=clockMs(frame.clock)??Date.now();const hour=frame.daylight===null?null:hourOf(clockNow);
    kind=override?.kind==='cycle'?cycleKind(seconds):override?override.kind as WeatherKind:setWeather?setKind(setWeather):weatherKindAt(clockNow);targetFor(kind,hour,target);
    // a god's set weather: its channels exactly (morning mist kept from the kind; wet follows rain)
    if(setWeather&&!override){target.cloud=setWeather.clouds;target.rain=setWeather.rain;target.wind=setWeather.wind;target.fog=setWeather.fog;target.wet=setWeather.rain>.1?Math.min(1,setWeather.rain*1.2):0;}
    if(desert){target.mist=0;target.wet=0;}
    if(!initialised&&override?.from)targetFor(override.from,hour,state);}
   const ms=clockNow;
   // a god's change shows in about 10–25 s (not the schedule's minutes): the god is watching it happen
   // ... and keeps that pace for a while after the god clears it back to the schedule (E2 #8: rain lingered for minutes)
   if(!photoFrame&&setWeatherChanged(lastSet,setWeather)){if(initialised)godChangeAt=seconds;lastSet=setWeather?{...setWeather}:null;}
   if(dustScheduled){
    // Clock-derived channels have no browser-session easing and never inherit dawn mist/rain/wetness.
    kind=dustSample.kind==='heavy'?'wind':'clear';
    state.cloud=state.rain=state.fog=state.mist=state.wet=0;state.wind=.16+dustSample.intensity*1.6;initialised=true;
   }else if(photoFrame)copyWeather(state,target);
   else if(!initialised){if(!override?.from)copyWeather(state,target);initialised=true;}else easeWeather(state,target,frame.dt*weatherEaseRate(!!setWeather,seconds-godChangeAt,override?.kind==='cycle'));
   windDirection(dustScheduled?dustSample.worldMs/1000:seconds,ms);
   // Rooms behind lit windows switch on and off with the hour of the world clock.
   setWindowLife(frame.daylight===null?null:hourOf(ms),frame.reducedMotion?0:seconds);
   const day=frame.daylight===null?1:Math.max(0,Math.min(1,frame.daylight)),still=frame.reducedMotion;
   EDEN_WATER_DAYLIGHT.value=day;
   applyWeather(frame,day);
   // WEATHER-FX: what roofs, ceilings and canopies shelter stays dry (the cover map; parked when dry).
   updateRainCover(lastRenderer,scene,frame.camera,seconds,!desert&&(state.wet>.02||state.rain>.02),phoneTier(),root);
   if(!active){active=true;if(!root.parent)scene.add(root);root.visible=true;}
   const t=seconds%7200;
   // Less frequent strong decorative spells; reported weather and native facts stay unchanged.
   const visualWind=dustScheduled?state.wind:visualWindStrength(seconds,state.wind);
   WIND.value.x=t;WIND.value.y=still?0:.15+visualWind*.95;
   // Windmill sails turn with the wind (angle integrated, so speed changes never jump); fountain ripples.
   if(!still)sailAngle=(sailAngle+Math.min(frame.dt,.25)*(.18+state.wind*1.1))%(Math.PI*2);ROTOR.value.w=sailAngle;
   // The static ornamental sky clouds drift slowly to and fro downwind and grey under overcast.
   if(!still){const a=seconds/170,b=seconds/97;SKY_OBJECTS.value.x=WIND.value.z*14*Math.sin(a)-WIND.value.w*5*Math.sin(b);SKY_OBJECTS.value.y=WIND.value.w*14*Math.sin(a)+WIND.value.z*5*Math.sin(b);}
   SKY_OBJECTS.value.z=(1-.5*state.cloud-.15*state.rain)*(.3+.7*day);
   RIPPLE.value.x=t;RIPPLE.value.y=still?0:1;MIST.value.y=still?0:seconds%600;SHEEN.value.w=still?0:state.rain;
   const birds=still?0:Math.max(0,Math.min(1,(day-.15)/.35))*(1-state.rain*.9)*(1-state.fog*.6)*(1-Math.max(0,state.wind-.7)*1.5);
   const butterflies=still?0:Math.max(0,Math.min(1,(day-.4)/.3))*(1-state.rain)*(1-state.cloud*.5)*(1-state.wind*.6);
   fauna.update(t,birds,butterflies,day,still?0:1);
   // the lighthouse sweeps from dusk to dawn, its beam stronger in mist and fog
   lighthouse.update(still?0:t,profile==='eden'?Math.pow(1-day,1.5):0,state.fog+state.mist*.5+state.rain*.3);lighthouse.group.visible=profile==='eden';
   for(const b of beacons)b.update(still?0:t,profile==='world'?Math.pow(1-day,1.5):0,state.fog+state.mist*.5+state.rain*.3);
   // fog banks roll over the sea in fog and mist, and on still early mornings
   {const h=hourOf(ms),dawn=smooth(4.5,6.5,h)*(1-smooth(8.5,10.5,h));fogBanks.update(still?0:t,(profile==='world'&&!worldFog)||phoneTier()?0:Math.min(1,state.fog*1.1+state.mist*.6+dawn*.45*(1-state.wind)*(1-state.rain)),WIND.value.z,WIND.value.w,state.wind,fog.color);}
   // the sea: swell and surf (livelier in wind; still for reduced motion)
   SURF.value.x=still?0:t;SURF.value.y=1;SURF.value.z=state.wind;
   ferrisAngle=nextFerrisAngle(ferrisAngle,frame.dt,frame.daylight===null||hourOf(ms)>=7&&hourOf(ms)<19,still);
   if(!still){DECORATIVE_MOTION.value.set(seconds,ferrisAngle);balloons.update(t);}balloons.mesh.visible=profile==='eden'||worldBalloons;
   fireflies.update(t,still?0:Math.max(0,1-day*3)*(1-state.rain)*(1-state.wind*.7),fireflies.uniforms.uFly.value.z);
   if(desert){fauna.mesh.visible=false;fireflies.points.visible=false;}
   smoke.update(t,still?0:1-state.rain*.5,smoke.uniforms.uSmoke.value.z,day,WIND.value.z,WIND.value.w,state.wind);
   // Autumn leaves blow through in wind (a few drift down on any breezy day).
   const leaves=still?0:Math.max(0,Math.min(1,(visualWind-.3)/.5))*(1-state.rain*.7)*(.15+.85*Math.min(1,day*2));
   // Rain comes in heavier and lighter spells (smooth, tens of seconds) rather than at a constant rate.
   const spell=.72+.18*Math.sin(seconds*.037+1.3)+.1*Math.sin(seconds*.11+.4);
   // Sunlit pollen/seed motes drift near the camera on fair, breezy-but-not-windy days.
   const motes=still?0:smooth(.45,.8,day)*(1-smooth(.35,.7,state.cloud))*(1-smooth(.6,.9,state.wind))*(1-state.rain)*(1-state.fog);
   // ... and in a real wind the same particles become fine dust skimming low over the ground (desert setting); dry ground only.
   const dust=still?0:smooth(.65,.95,state.wind)*(1-smooth(.15,.4,state.wet));
   rain.update2(dustScheduled?dustSample.worldMs/1000:seconds,still?0:state.rain*spell,desert?0:leaves,day,frame.camera,WIND.value.z,WIND.value.w,visualWind,desert?(still?0:dustSample.intensity):Math.max(motes,dust),desert?1:dust>motes?1:0);rainWanted=rain.lines.visible;
  },
  photo(clock:string|null,daylight:number|null){
   if(closed||!active||!lastFrame||photoFrame)return ()=>{};
   const real=lastFrame,saved={...state},savedTarget={...target},was={kind,clockAt,clockNow,sailAngle,ferrisAngle,driftX,driftZ,lastFlash};
   photoFrame=true;try{api.update({...real,dt:0,reducedMotion:true,clock,daylight});}catch{/* the live frame below restores */}finally{photoFrame=false;}
   return ()=>{copyWeather(state,saved);copyWeather(target,savedTarget);({kind,clockAt,clockNow,sailAngle,ferrisAngle,driftX,driftZ}=was);bodiesAt=-Infinity;bodiesClock='';
    try{api.update({...real,dt:0});}catch{/* next frame */}lastFlash=was.lastFlash;};
  },
  onLightning:null as ((strength:number,dir:THREE.Vector3)=>void)|null,
  inspect(){return {bow:sky.uniforms.uBow.value.x,rainbowThings:rainbowThings.count,rainbowThing:rainbowThings.strength,sun:sunDir.toArray(),rainCover:COVER_A.value.w,profile,dust:desert?{profile:'mars-desert' as const,seed:DESERT_DUST_SEED,...dustSample}:null,set:!!setWeather,lightning:lastFlash,active,kind,state:{...state},rotor:motion.rotorFound,fountainWater:motion.waterFound,skyClouds:motion.skyClouds,windMaterials:wind.count,windModes:wind.modes(),smokeSources:smoke.sourceCount,flowers:lastFound.flowers,meadow:lastFound.meadow,roofs:lastFound.roofs,water:lastFound.water,harbour:lastFound.harbour,scans,lightCollects,lightRefreshes,drawCalls:root.children.filter(o=>o.visible).length};},
  dispose(){if(closed)return;closed=true;if(review&&(globalThis as Record<string,unknown>).edenAtmosphere===api)delete (globalThis as Record<string,unknown>).edenAtmosphere;deactivate();wind.dispose();motion.dispose();fauna.dispose();balloons.dispose();fireflies.dispose();smoke.dispose();sky.dispose();rain.dispose();halos.dispose();lighthouse.dispose();for(const b of beacons)b.dispose();fogBanks.dispose();root.removeFromParent();if(ownsFog&&scene.fog===fog)scene.fog=null;if(scene.onBeforeRender===beforeRender)scene.onBeforeRender=previousBeforeRender;},
 };
 // Review hook (only with ?weather=… or ?atmos in the URL): window.edenAtmosphere.inspect() in the console.
 const review=typeof location!=='undefined'&&/[?&](weather|dust|atmos)\b/.test(location.search);
 if(review)(globalThis as Record<string,unknown>).edenAtmosphere=api;
 return api;
}
