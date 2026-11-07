// Additive W1: immutable public knowledge is cached separately from fresh
// authenticated clock/Me/here. No route, pose, planner or credential authority.
import type {Hono,Context} from 'hono';
import {hashOf,stableStringify} from '@souls/engine-contract';
import type {EdgeLedger} from '../ledger/ledger.ts';
import {EdgeError,type EdgeDeps, edgeErrorOf} from '../contract.ts';
import {hereFrame,SIGHT_RADIUS} from '../perception/here.ts';
import {EARSHOT_RADIUS} from '../comms/speech.ts';
import {buildBootStatic,assembleBootSession} from './boot-pack.ts';
import {bootAliases,nativeAliasesOf} from './world-places.ts';
import {freshBootClock} from './clock.ts';
export const BOOT_BYTE_BUDGET=10240;
export const BOOT_API_CONTRACT='eden-edge/1.1';
// Public verb definitions are supplied from the shared schema by the mounting
// caller. Param schemas remain available at /v1/edge/schema, never guessed.
export function buildLedgerBoot(L:EdgeLedger,verbs:readonly string[]){
 const w=L.host.engine.world;
 const open=(id:string)=>!L.knowledge?.isSecret(id);// knowledge/1: secret places stay out of the shared catalogue
 return buildBootStatic({worldId:L.host.worldId,places:[...L.places.byId.values()].filter(p=>open(p.id)),
  nativePlaces:Object.entries(w.regions??{}).map(([id,r])=>({id,level:(r as {placeLevel?:number}).placeLevel??r.level??0,polygon:r.polygon})),
  nativeAliases:nativeAliasesOf(L).filter(a=>open(a.place)),aliases:Object.fromEntries(Object.entries(bootAliases(L)).filter(([id])=>open(id))),
  rules:{earshotMetres:EARSHOT_RADIUS,perceptionMetres:SIGHT_RADIUS,secondsCaps:{rest:600,wander:300,follow:3600,swim:1800}},
  verbs:[...new Set(verbs)].map(id=>({id,summary:`${id.replace(/-/g,' ')}: use a current offer or intent; parameters at /v1/edge/schema.`})),byteBudget:2*1024*1024});
}
/** Deterministic pages retain every destination. Overflow is explicit; clients
 * fetch every page or the complete authored catalogue instead of truncating. */
export function paginatedBoot(pack:ReturnType<typeof buildBootStatic>,budget=BOOT_BYTE_BUDGET){
 if(Buffer.byteLength(pack.serialized)<=budget)return {payload:pack.payload,serialized:pack.serialized,etag:pack.etag,pages:[] as {serialized:string;etag:string}[]};
 const rows=pack.payload.places,pages:typeof rows[]=[];let current:typeof rows=[];
 const body=(places:typeof rows,page:number)=>({contract:'boot-destinations/1',worldId:pack.payload.worldId,catalogueEtag:pack.etag,page,places});
 for(const row of rows){
  if(Buffer.byteLength(stableStringify(body([...current,row],pages.length)))>budget){if(!current.length)throw Error('boot-pack.overflow: one destination exceeds page budget');pages.push(current);current=[];}
  current.push(row);
 }
 if(current.length)pages.push(current);
 const encoded=pages.map((places,page)=>{const payload=body(places,page);return {serialized:stableStringify(payload),etag:'"'+hashOf(payload)+'"'};});
 const payload={...pack.payload,places:[],overflow:{code:'boot-pack.overflow',budgetBytes:budget,completeBytes:Buffer.byteLength(pack.serialized),destinationsOmittedFromThisManifest:rows.length},
  completeStaticEtag:pack.etag,
  destinationPages:encoded.map((p,page)=>({url:`/v1/edge/boot/static?page=${page}`,etag:p.etag,count:pages[page].length})),completeDestinations:rows.length};
 const serialized=stableStringify(payload);if(Buffer.byteLength(serialized)>budget)throw Error('boot-pack.overflow: metadata exceeds compact budget; complete catalogue at /v1/edge/boot/places');
 return {payload,serialized,etag:'"'+hashOf(payload)+'"',pages:encoded};
}
export function mountBootRoutes(app:Hono,deps:EdgeDeps&{ledger:EdgeLedger},verbs:readonly string[]){
 const pack=()=>buildLedgerBoot(deps.ledger,verbs);
 const guard=(fn:(c:Context)=>Response)=> (c:Context)=>{
  try{return fn(c);}catch(error){
   c.header('Cache-Control','no-store');
   if(error instanceof EdgeError)return c.json({apiContract:BOOT_API_CONTRACT,error:edgeErrorOf(error)},error.status as 400);
   if(error instanceof Error&&error.message.startsWith('boot-pack.overflow'))return c.json({apiContract:BOOT_API_CONTRACT,error:{code:'boot-pack.overflow',message:error.message},fullMap:{url:'/v1/edge/boot/places'}},413);
   throw error;
  }
 };
 const cached=(c:Context,serialized:string,etag:string)=>{
  c.header('Cache-Control','public, max-age=0, must-revalidate');c.header('ETag',etag);c.header('Content-Type','application/json; charset=utf-8');
  // A strong ETag describes these exact canonical bytes; time/Me are excluded.
  if((c.req.header('if-none-match')??'').split(',').map((s:string)=>s.trim()).some((s:string)=>s===etag||s==='W/'+etag||s==='*'))return c.body(null,304);
  return c.body(serialized,200);
 };
 app.get('/v1/edge/boot/places',guard(c=>{const p=pack();return cached(c,p.fullMapSerialized,p.fullMapEtag);}));
 app.get('/v1/edge/boot/static',guard(c=>{
  const p=paginatedBoot(pack()),raw=c.req.query('page');if(raw===undefined)return cached(c,p.serialized,p.etag);
  if(!/^(0|[1-9]\d*)$/.test(raw)||!p.pages[Number(raw)])return c.json({apiContract:BOOT_API_CONTRACT,error:{code:'boot.page',message:'No such destination page; read the static manifest.'}},400);
  const page=p.pages[Number(raw)];return cached(c,page.serialized,page.etag);
 }));
 app.get('/v1/edge/boot',guard(c=>{
  c.header('Cache-Control','no-store');const soul=deps.soul(c);if(!deps.souls.limits.allow(`edge-boot:${soul.soulId}`,120,60000).ok)throw new EdgeError(429,'rate-limited','too many boot requests; slow down');
  const L=deps.ledger,h=L.host,tick=h.engine.world.tick,raw=pack(),p=paginatedBoot(raw),m=h.minds.get(soul.soulId),here=hereFrame(L,soul,{doHere:true});
  const fresh={worldId:h.worldId,tick,clock:freshBootClock(h),
   me:{soulId:soul.soulId,name:soul.name,character:m?.description??'',place:L.placePathOf(soul.soulId)[0]?.id??null},here};
  // Session assembly remains fresh even when If-None-Match names the catalogue.
  const session=assembleBootSession(raw,fresh);
  return c.json({...session,apiContract:BOOT_API_CONTRACT,static:p.payload,staticEtag:p.etag,staticUrl:'/v1/edge/boot/static',fullMap:{url:'/v1/edge/boot/places',etag:raw.fullMapEtag},clock:{...fresh.clock,dayNightBoundariesSource:'not-declared'}});
 }));
}
