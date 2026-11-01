// TRAVEL (M3, docs/sim/TRAVEL.md) on the world page. CARD-TRIM (Gene 2026-10-23 #17) removed the owner card's
// "Travel to…"; a Soul travels from its agent (`node eden-agent.mjs travel <world>|home`). Everyone sees who is visiting: "Visiting from Alder" on a visitor's card, and a
// visitors line under "Meet its Souls" (GET /v1/world/visitors). Names come from the site's world list.
import {useEffect,useState} from 'react';
import {pageHidden} from './poll-pace.ts';
import {apiPath} from './world-path.ts';
import {BASE} from './base-path.ts';
import './SoulTravel.css';

type Visitors={available?:boolean;open:boolean;visitors:{soulId:string;name:string;home:string}[]};
type SiteWorld={slug:string;name:string};

let worldsOnce:Promise<SiteWorld[]>|null=null;
/** The site's worlds (the launcher's list); [] where there is none. */
export function siteWorlds():Promise<SiteWorld[]>{
 worldsOnce??=fetch(`${BASE}/__sim/worlds.json`,{cache:'no-store'}).then(r=>r.ok&&r.headers.get('content-type')?.includes('json')?r.json():null).then((d:{worlds?:{slug?:unknown;name?:unknown}[]}|null)=>(d?.worlds??[]).flatMap(w=>typeof w.slug==='string'&&typeof w.name==='string'?[{slug:w.slug,name:w.name}]:[])).catch(()=>{worldsOnce=null;return [];});
 return worldsOnce;
}
const nameOf=(worlds:SiteWorld[],slug:string)=>worlds.find(w=>w.slug===slug)?.name??slug;

/** This world's visitors: one poll for the whole page, shared by every card. A world without travel (no Godmode: the
 * original worlds, plain local worlds) answers available:false, or 404 on an older server; it is not asked again. */
const NO_TRAVEL:Visitors={available:false,open:false,visitors:[]};
const visitorSubs=new Set<(v:Visitors)=>void>();
let visitorsNow:Visitors|null=null,visitorsTimer:ReturnType<typeof setInterval>|undefined;
const stopVisitors=()=>{clearInterval(visitorsTimer);visitorsTimer=undefined;};
function readVisitors(){
 if(pageHidden())return;  // PERF-EDEN: a hidden page does not poll
 void fetch(apiPath('/v1/world/visitors'),{cache:'no-store'}).then(r=>r.status===404?NO_TRAVEL:r.ok?r.json():null).then((d:Visitors|null)=>{
  if(!d||!Array.isArray(d.visitors))return;visitorsNow=d;if(d.available===false)stopVisitors();for(const f of visitorSubs)f(d);}).catch(()=>{});
}
function useVisitors():Visitors|null{
 const [v,setV]=useState<Visitors|null>(visitorsNow);
 useEffect(()=>{visitorSubs.add(setV);if(visitorsNow)setV(visitorsNow);
  if(!visitorsTimer&&visitorsNow?.available!==false){readVisitors();visitorsTimer=setInterval(readVisitors,15_000);}
  return()=>{visitorSubs.delete(setV);if(!visitorSubs.size)stopVisitors();};},[]);
 return v;
}
function useWorlds(){const [w,setW]=useState<SiteWorld[]>([]);useEffect(()=>{let live=true;void siteWorlds().then(x=>{if(live)setW(x);});return()=>{live=false;};},[]);return w;}

/** "Visiting from Alder" for a Soul that came from another world (any viewer). */
export function VisitorFrom({soulId}:{soulId:string}){
 const v=useVisitors(),worlds=useWorlds(),me=v?.visitors.find(x=>x.soulId===soulId);
 return me?<span className="soul-visiting" data-visiting-from={me.home}>Visiting from {nameOf(worlds,me.home)}</span>:null;
}

/** The world's visitors in one line (under "Meet its Souls"): who is here from elsewhere, and whether it is closed. */
export function VisitorsLine(){
 const v=useVisitors(),worlds=useWorlds();
 if(!v||v.available===false||(v.open&&!v.visitors.length))return null;
 return <p className="soul-visitors" data-visitors={v.visitors.length} data-open={v.open?'1':'0'}>
  {v.visitors.length?<>Visiting now: {v.visitors.map((x,i)=><span key={x.soulId}>{i?', ':''}<b>{x.name}</b> from {nameOf(worlds,x.home)}</span>)}</>:null}
  {!v.open&&<span className="soul-dim">{v.visitors.length?' · ':''}Closed to new visitors</span>}
 </p>;
}
