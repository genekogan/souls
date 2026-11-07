import type {PublicSoul} from '@souls/protocol';
import {newest,readBody,readNow,type Body,type Now} from './soul-state.ts';
/** `travelled`: gone to another world (the fade roster's `away`); Explore leaves it out, it is not in this world now. */
export type ExplorePresence='active'|'fading'|'departed'|'travelled'|'unknown';
/** Public fade activity is authoritative; merely having a standing body does not imply an active agent. */
export function explorePresence(messages:readonly{kind?:string;souls?:unknown;soulId?:unknown;colour?:unknown;change?:unknown;away?:unknown}[],knownSoulIds:Iterable<string>=[]):Map<string,ExplorePresence>{
 const knownIds=[...knownSoulIds];let map=new Map<string,ExplorePresence>();const phase=(c:unknown):ExplorePresence=>c==='green'?'active':c==='yellow'||c==='red'?'fading':c==='gone'?'departed':'unknown';
 for(const m of messages){if(m.kind==='fade.roster'&&Array.isArray(m.souls)){if(!m.souls.every(r=>r&&typeof r==='object'&&typeof r.soulId==='string'&&['green','yellow','red','gone'].includes(r.colour)))continue;
 // Server fade.roster lists only non-green current Souls; an observed valid snapshot
 // makes omitted known roster IDs green. No snapshot means activity remains unknown.
 map=new Map(knownIds.map(id=>[id,'active' as const]));for(const r of m.souls){if(r&&typeof r==='object'&&typeof r.soulId==='string')map.set(r.soulId,r.colour==='gone'&&r.away===true?'travelled':phase(r.colour));}}else if(m.kind==='fade'&&typeof m.soulId==='string')map.set(m.soulId,m.change==='reclaimed'?'active':m.away===true?'travelled':m.change==='removed'?'departed':phase(m.colour));}return map;
}
export function orderedExploreSouls(souls:ReadonlyMap<string,PublicSoul>,presence:ReadonlyMap<string,ExplorePresence>,query='',bodies?:ReadonlyMap<string,Body>){
 const q=query.trim().toLocaleLowerCase(),byBody={awake:0,idle:0,zombie:1,asleep:2} as const,rank=(id:string)=>{const b=exploreSoulState(souls.get(id)!,bodies).body;return b?byBody[b.state]:({active:0,fading:1,unknown:2,departed:3,travelled:4}[presence.get(id)??'unknown']);};return [...souls.values()].filter(s=>presence.get(s.id)!=='travelled'&&(!q||`${s.name} ${s.description}`.toLocaleLowerCase().includes(q))).sort((a,b)=>rank(a.id)-rank(b.id)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
/** Camera-room context annotates a world search; an empty room never erases known Souls. */
export function exploreSoulRoster(souls:ReadonlyMap<string,PublicSoul>,presence:ReadonlyMap<string,ExplorePresence>,query='',room?:{soulIds:readonly string[]}|null,bodies?:ReadonlyMap<string,Body>){
 const inRoom=new Set((room?.soulIds??[]).filter(id=>souls.has(id)));return{souls:orderedExploreSouls(souls,presence,query,bodies),inRoom};
}
type Place={id:string;name:string;kind:string;polygon:readonly(readonly number[])[];level:number};
function contains(poly:Place['polygon'],x:number,z:number){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function exploreRoom(camera:readonly number[],places:readonly Place[],souls:ReadonlyMap<string,{entityId:string}>,entities:Readonly<Record<string,{p:readonly number[]}>>){
 const area=(p:Place)=>Math.abs(p.polygon.reduce((sum,a,i)=>{const b=p.polygon[(i+1)%p.polygon.length];return sum+a[0]*b[1]-b[0]*a[1];},0));
 const floor=(p:Place)=>p.level===0?0:p.id.startsWith('int-house-2')?2.6:p.level*3.1;
 const room=places.filter(p=>['room','bedroom','kitchen','studio','library','workshop','shop','chapel','clinic','bathhouse'].includes(p.kind)&&camera[1]>=floor(p)+.5&&camera[1]<=floor(p)+2.9&&contains(p.polygon,camera[0],camera[2])).sort((a,b)=>area(a)-area(b))[0];
 if(!room)return null;return{id:room.id,name:room.name,soulIds:[...souls].flatMap(([id,s])=>{const p=entities[s.entityId]?.p;return p&&Math.abs(p[1]-floor(room))<.6&&contains(room.polygon,p[0],p[2])?[id]:[];})};
}

/** LINK Explore rows: Awake / Zombie / Asleep and the agent's `now` (replica fields, the newest stream body event wins). */
export function exploreSoulState(soul:PublicSoul,bodies?:ReadonlyMap<string,Body>):{body:Body|null;now:Now|null}{
 const x=soul as PublicSoul&{body?:unknown;now?:unknown};
 return {body:newest(readBody(x.body),bodies?.get(soul.id)??null),now:readNow(x.now)};
}
/** "Heading to the pond to see if…" — a row-sized `now`. */
export function truncateNow(text:string,max=34){if(text.length<=max)return text;const cut=text.slice(0,max-1);return (/\s/.test(text[max-1])?cut:cut.replace(/\s+\S*$/,'')||cut).trimEnd()+'…';}
