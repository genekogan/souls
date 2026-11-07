// W1 pure preparation. Full authored knowledge and a small destination index
// have separate cache identities. Neither static identity includes clock or Me.
import {hashOf,stableStringify} from '@souls/engine-contract';
import type {Place} from '../ledger/places.ts';
import type {KnownBootPlace} from './place-resolution.ts';
export type PublicBootRules={earshotMetres:number;perceptionMetres:number;secondsCaps:Record<string,number>;fadeThresholdSeconds?:number[]};
export type PublicBootVerb={id:string;summary:string;params?:Record<string,{type:string;min?:number;max?:number;optional?:boolean}>};
export type NativePlace={id:string;level:number;polygon:readonly (readonly [number,number])[]};
export type BootStaticInput={worldId:string;places:readonly Place[];nativePlaces:readonly NativePlace[];
 /** Only already-qualified authoredLmAliasProfile mappings; builder additionally
  * checks the named native region, level and exact polygon vertices. */
 nativeAliases?:readonly {place:string;nativeRegion:string}[];aliases?:Readonly<Record<string,readonly string[]>>;rules:PublicBootRules;verbs:readonly PublicBootVerb[];byteBudget?:number};
const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).length;
const sortId=(a:{id:string},b:{id:string})=>a.id<b.id?-1:a.id>b.id?1:0;
const pointKey=(p:readonly number[])=>p.join(',');
const polygonKey=(p:readonly (readonly number[])[])=>p.map(pointKey).sort().join(';');
const centre=(polygon:readonly (readonly number[])[]):[number,number]=>[0,1].map(i=>Math.round(polygon.reduce((sum,v)=>sum+v[i],0)/polygon.length*10)/10) as [number,number];
const goodFor=(p:Place)=>p.semanticKind ? (p.description??p.semanticKind).slice(0,160) : p.description?.match(/Good for:\s*([^.!?]+)/i)?.[1].trim().split(/\s+/).slice(0,8).join(' ')??'';
export function buildBootStatic(input:BootStaticInput){
 if(!input.worldId||input.worldId.length>200||!Number.isInteger(input.byteBudget??10240)||(input.byteBudget??10240)<1)throw Error('boot-pack.invalid: world/budget');
 const native=new Map(input.nativePlaces.map(p=>[p.id,p])),places=[...input.places].sort(sortId),placeIds=new Set(places.map(p=>p.id));
 if(placeIds.size!==places.length||native.size!==input.nativePlaces.length)throw Error('boot-pack.invalid: duplicate place/region');
 for(const p of native.values())if(!p.id||!Number.isInteger(p.level)||p.polygon.length<3||p.polygon.some(v=>v.length!==2||!v.every(Number.isFinite)))throw Error('boot-pack.invalid: native place metadata');
 for(const p of places)if(!p.id||!p.name||!Number.isInteger(p.level)||p.polygon.length<3||p.polygon.some(v=>v.length!==2||!v.every(Number.isFinite))||p.parent!==null&&!placeIds.has(p.parent))throw Error('boot-pack.invalid: place metadata');
 const alias=new Map<string,string>(),aliasTargets=new Set<string>();for(const a of input.nativeAliases??[]){
  const p=places.find(p=>p.id===a.place),r=native.get(a.nativeRegion);
  if(!p||!r||p.carrier||p.level!==r.level||polygonKey(p.polygon)!==polygonKey(r.polygon)||alias.has(a.place)||aliasTargets.has(a.nativeRegion))throw Error('boot-pack.invalid: unqualified native alias');
  alias.set(a.place,a.nativeRegion);aliasTargets.add(a.nativeRegion);
 }
 for(const [id,names] of Object.entries(input.aliases??{}))if(!placeIds.has(id)||names.some(n=>typeof n!=='string'||!n.trim()||n.length>100))throw Error('boot-pack.invalid: name alias');
 const r=input.rules;
 if(![r.earshotMetres,r.perceptionMetres].every(n=>Number.isFinite(n)&&n>0)||Object.values(r.secondsCaps).some(n=>!Number.isSafeInteger(n)||n<1)||r.fadeThresholdSeconds?.some(n=>!Number.isFinite(n)||n<0))throw Error('boot-pack.invalid: public limits');
 // Explicit public projection: a caller cannot copy unrelated config fields
 // into the cache merely by passing a wider object than this TypeScript type.
 const rules={earshotMetres:r.earshotMetres,perceptionMetres:r.perceptionMetres,secondsCaps:{...r.secondsCaps},...(r.fadeThresholdSeconds?{fadeThresholdSeconds:[...r.fadeThresholdSeconds]}:{})};
 const verbs=[...input.verbs].sort(sortId).map(v=>{
  if(!v.id||typeof v.summary!=='string'||v.summary.length>200)throw Error('boot-pack.invalid: public verb');
  const params=v.params?Object.fromEntries(Object.entries(v.params).map(([key,p])=>[key,{type:p.type,...(p.min!==undefined?{min:p.min}:{}),...(p.max!==undefined?{max:p.max}:{}),...(p.optional!==undefined?{optional:p.optional}:{})}])):undefined;
  return {id:v.id,summary:v.summary,...(params?{params}:{})};
 });
 const index:KnownBootPlace[]=places.map(p=>{
  const region=native.get(alias.get(p.id)??p.id),admitted=!!region&&region.level===p.level;
  return {id:p.id,name:p.name,aliases:[...new Set([...(input.aliases?.[p.id]??[]),...(p.aliases??[])])].sort(),level:p.level,nativeRegion:admitted?region!.id:null,
   access:p.carrier?'dynamic-carrier':admitted?'admitted':p.level!==0?'unsupported-floor':'scenery'};
 });
 const fullMap={contract:'boot-place-catalog/1' as const,worldId:input.worldId,places:places.map((p,i)=>({...structuredClone(p),...index[i],centre:p.carrier?null:centre(index[i].nativeRegion?native.get(index[i].nativeRegion!)!.polygon:p.polygon)}))};
 const fullMapHash=hashOf(fullMap),destinations=fullMap.places.filter(p=>p.access==='admitted'&&p.parent!==null&&p.kind!=='sleeping-mat');
 const worldAbout=places.find(p=>p.parent===null)?.worldAbout;
 const payload={contract:'boot-static/1' as const,worldId:input.worldId,...(worldAbout?{worldAbout}:{}),
  coverage:{scope:'admitted-static-destinations' as const,totalPlaces:places.length,listedDestinations:destinations.length,
   scenery:index.filter(p=>p.access==='scenery').length,unsupportedFloors:index.filter(p=>p.access==='unsupported-floor').length,dynamicCarriers:index.filter(p=>p.access==='dynamic-carrier').length,
   personalRestPlaces:fullMap.places.filter(p=>p.kind==='sleeping-mat').length},
  fullMap:{url:'/v1/edge/boot/places',etag:'"'+fullMapHash+'"'},
  places:destinations.map(p=>({id:p.id,name:p.name,kind:p.kind,parent:p.parent,walkable:true,level:p.level,centre:p.centre,goodFor:goodFor(p),aliases:p.aliases,schedule:(p.schedule??[]).map(s=>({label:s.label??s.id,cron:s.cron}))})),
  rules,verbs};
 const size=bytes(payload);if(size>(input.byteBudget??10240))throw Error(`boot-pack.overflow: ${size} bytes, ${destinations.length} destinations; paginate explicitly or increase negotiated budget, never truncate places`);
 // Future routes must send these canonical serialized bodies when using their
 // strong ETags; JSON key insertion order must not change bytes under one tag.
 return {payload,serialized:stableStringify(payload),etag:'"'+hashOf(payload)+'"',bytes:size,fullMap,fullMapSerialized:stableStringify(fullMap),fullMapEtag:'"'+fullMapHash+'"',index};
}
export type FreshBootContext={worldId:string;tick:number;clock:{day:number|null;time:string|null;realMsPerWorldMinute:number|null;dayNightBoundaries:null|{dawn:number;dusk:number}};
 me:{soulId:string;name:string;character:string;place:string|null};here:unknown};
/** Session response is always fresh/no-store. A 304 applies to the separate
 * static pack only; callers must still fetch/assemble authenticated fresh here. */
export function assembleBootSession(pack:ReturnType<typeof buildBootStatic>,fresh:FreshBootContext){
 if(fresh.worldId!==pack.payload.worldId||!Number.isSafeInteger(fresh.tick)||fresh.tick<0)throw Error('boot-pack.invalid: fresh world/tick');
 const clock={day:fresh.clock.day,time:fresh.clock.time,realMsPerWorldMinute:fresh.clock.realMsPerWorldMinute,dayNightBoundaries:structuredClone(fresh.clock.dayNightBoundaries)};
 const me={soulId:fresh.me.soulId,name:fresh.me.name,character:fresh.me.character,place:fresh.me.place};
 return {contract:'boot-session/1' as const,staticEtag:pack.etag,static:structuredClone(pack.payload),worldId:fresh.worldId,tick:fresh.tick,clock,me,here:structuredClone(fresh.here),cacheControl:'no-store' as const};
}
