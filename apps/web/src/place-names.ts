import {EDEN_VIEWER_PLACES} from './WorldEdenPlaceData.ts';
import {humanActivity} from './human-activity.ts';

/** VF1: human names for the ids a Soul's "doing" can carry ("commons-bench-east", "walk:region-park",
 * "read:lib-armchair-sage"). Place data and World's activity-spot labels name what they know; a fixture id
 * under a known place reads as "East bench, Commons gathering lawn"; anything else becomes plain words.
 * Presentation only: never use these strings as identifiers. */
const NAMES=new Map<string,string>();
for(const p of EDEN_VIEWER_PLACES)if(p.name&&p.name!==p.id)NAMES.set(p.id,p.name);
/** P7c: World's activity-spot labels (~22 KB br of /w/eden data) load beside the page instead of before its first frame
 * (a phone's arrival waits for every byte in front of it); until then those ids read as plain words. */
export const placeNamesReady:Promise<void>=import('../../../worlds/eden/activity-spots.v1.json',{with:{type:'json'}}).then((m:{default:{spots?:{id?:unknown;label?:unknown}[]}})=>{
 for(const s of m.default.spots??[])if(typeof s.id==='string'&&typeof s.label==='string'&&s.label)NAMES.set(s.id,s.label);
},()=>{});

const ID=/^[a-z0-9]+([-_:.][a-z0-9]+)+$/i;
const DIRECTION=new Set(['north','south','east','west','northeast','northwest','southeast','southwest','upper','lower','left','right','front','back','inner','outer']);
const NOISE=new Set(['eden','social','mars','int','region']);
/** In water the body is drawn swimming, or treading water when still; these outrank POSES (one "Swimming" for both). */
const WATER:Record<string,string>={swim:'Swimming',tread:'Treading water',wade:'Wading'};
/** The server's doing while no activity runs (apps/server/src/world.ts). It says nothing about the body, so it never
 * outranks a named pose the body is visibly in: a swimmer left treading water after its swim reads "Treading water". */
const IDLE_DOING='standing around';
const cap=(s:string)=>s?s[0].toUpperCase()+s.slice(1):s;
/** "bench east" → "east bench"; "mat 3" stays; noise prefixes dropped. */
function words(tokens:string[]){
 const t=tokens.filter((w,i)=>!(NOISE.has(w)&&i<tokens.length-1)).filter(w=>!/^[a-f0-9]{8,}$/.test(w));
 const dirs=t.filter(w=>DIRECTION.has(w)),rest=t.filter(w=>!DIRECTION.has(w));
 return [...dirs,...rest].join(' ');
}
/** True when `s` looks like a machine id rather than words. */
export const looksLikeId=(s:string)=>ID.test(s.trim());
/** A readable name for a place, fixture or activity-spot id. `known` may supply extra names (kernel things, entity labels). */
export function placeName(raw:string,known?:(id:string)=>string|null|undefined):string{
 const id=raw.trim(),bare=id.includes(':')?id.slice(id.lastIndexOf(':')+1):id;
 const look=(k:string)=>{const v=NAMES.get(k)??known?.(k)??null;return v&&v!==k&&!looksLikeId(v)?v:null;};
 const direct=look(bare);if(direct)return direct;
 const tokens=bare.toLowerCase().split(/[-_.]+/).filter(Boolean);
 for(let k=tokens.length-1;k>=1;k--){
  const prefix=tokens.slice(0,k).join('-'),parent=prefix==='eden'?null:look(prefix);
  if(parent){const what=words(tokens.slice(k));return what?`${cap(what)}, ${parent}`:parent;}
 }
 return cap(words(tokens));
}
const POSES:Record<string,string>={sit:'Sitting',walk:'Walking',idle:'Standing around',settle:'Settling',stand:'Standing',sleep:'Sleeping',warm:'Warming up',tread:'Swimming',swim:'Swimming',eat:'Eating',lie:'Lying down',nap:'Napping',read:'Reading',dance:'Dancing','sit-ground':'Sitting on the grass',talk:'Talking',listen:'Listening',wave:'Waving',paint:'Painting',chalk:'Drawing in chalk',write:'Writing',cook:'Cooking',drink:'Drinking',browse:'Browsing the shelves',yoga:'Doing yoga',stretch:'Stretching',
 /* D1: a body on a carrier (ferris wheel, balloon, punt) is riding, rowing, boarding or stepping out, never the idle doing */
 ride:'Riding',row:'Rowing',board:'Boarding',alight:'Stepping out'};
/** The body's activity in words ("sit" → "Sitting"); ids become plain words, never raw. */
export function activityWords(activity:string|undefined|null,soulId?:string){
 if(!activity)return '';
 const a=activity.replace(/^mars:/,''),named=namedPose(a);
 if(named)return named;
 const label=humanActivity(a,soulId).label;
 return cap(looksLikeId(label)?placeName(label):label.replace(/[-_]+/g,' '));
}
/** The dedicated word for a named pose ("tread" → "Treading water"), or '' for any other activity. */
function namedPose(activity:string|undefined|null){const a=(activity??'').replace(/^mars:/,'');return WATER[a]??POSES[a]??'';}
/** A Soul's "doing" line: free text as written; a bare id reads as the body's activity at that named thing
 * ("Sitting · East bench, Commons gathering lawn"). */
export function doingText(doing:string|undefined|null,activity:string|undefined|null,soulId?:string,known?:(id:string)=>string|null|undefined){
 const d=(doing??'').trim(),pose=activityWords(activity,soulId);
 if(d.toLowerCase()===IDLE_DOING&&namedPose(activity))return pose;
 if(d&&looksLikeId(d)){
  const verb=d.includes(':')?d.slice(0,d.indexOf(':')):'';
  const act=pose||(verb?activityWords(verb,soulId):'');
  return [act,placeName(d,known)].filter(Boolean).join(' · ');
 }
 const label=d?humanActivity(d,soulId).label:pose;
 return cap(withNames(label,known));
}
const ID_IN_TEXT=/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+\b/g;
/** Free text that quotes ids ("nearest free seat (eden-classroom-seat-16, 28 m)") gets their names instead. */
export function withNames(text:string,known?:(id:string)=>string|null|undefined){
 return text.replace(ID_IN_TEXT,m=>NAMES.has(m)||known?.(m)||(m.match(/[-_]/g)?.length??0)>=2?placeName(m,known):m);
}
