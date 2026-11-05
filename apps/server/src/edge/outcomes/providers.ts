import type {EdgeLedger} from '../ledger/ledger.ts';
import type {EdgeSoul} from '../contract.ts';
import {bodyEnd} from '../perception/here.ts';
import type {OutcomeSnapshot,TerminalSection} from './store.ts';
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const clip=(v:unknown,max=300)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
/** Privacy comes from existing public/entitled projections, never raw object or other-Soul stream tables. */
export function terminalSnapshot(ledger:EdgeLedger,soul:EdgeSoul,kind:string):OutcomeSnapshot{
 const worldId=ledger.host.worldId,tick=ledger.host.engine.world.tick,end=bodyEnd(ledger,soul.soulId),full=['use-computer','listen'].includes(kind),places=full?ledger.map():[],walkable=full?places.filter(p=>p.walkable).map(p=>p.id):ledger.walkablePlaceIdsV1(),base={worldId,tick,place:end?.place??null,placeName:(end?.place&&ledger.places.byId.get(end.place)?.name)||null,placePath:ledger.placePathOf(soul.soulId).filter(p=>p.kind!=='occupier').map(p=>p.id),pos:end?.pos??null,walkable};
 if(!full)return{...base,sections:[],materials:[]};
 const visible=(ledger.comms?.objects.visibleTo(soul)??[]).map(object),sections:TerminalSection[]=[],materials:OutcomeSnapshot['materials']=[];
 const fact=(section:string,text:string,about=worldId,untrusted=false)=>({fact:text,about,source:`town:${section}:${worldId}:${tick}`,provenance:untrusted?'soul-text' as const:'world-fact' as const,untrusted});
 const directory=ledger.db.db.prepare('SELECT id,name,description FROM souls WHERE world_id=? AND retired_at IS NULL ORDER BY name,id LIMIT 20').all(worldId) as {id:string;name:string;description:string}[];
 const total=ledger.db.db.prepare('SELECT COUNT(*) n FROM souls WHERE world_id=? AND retired_at IS NULL').get(worldId) as {n:number},nearby=ledger.perceivedBodies(soul.soulId,20),counts=new Map<string,number>();for(const body of nearby)counts.set(body.placeId,(counts.get(body.placeId)??0)+1);
 sections.push({section:'directory',rows:[{scope:'public-profiles',count:total.n,returned:directory.length},...directory.map(r=>({soulId:r.id,name:clip(r.name,100),...ledger.host.publicNameMetadata(r.id),description:clip(r.description,200),untrusted:true})),...Array.from(counts,([placeId,count])=>({scope:'perceived-bodies-within20m',placeId,count}))],learned:[fact('directory',`The public directory lists ${total.n} Soul profiles; ${directory.length} are returned. Profile text is self-authored.`),...Array.from(counts,([placeId,count])=>fact('directory',`${count} other bodies are perceptible to this Soul at ${placeId} within20 metres.`,placeId)).slice(0,2)]});
 const schedule=places.flatMap(p=>p.schedule.map(s=>({placeId:p.id,placeName:p.name,id:s.id,label:clip(s.label,160),worldCron:s.cron,durationMinutes:s.durationMinutes}))).slice(0,10);
 sections.push({section:'schedule',rows:schedule,learned:schedule.length?schedule.slice(0,3).map(s=>fact('schedule',`${s.placeName} lists “${s.label}” on world cron ${s.worldCron}.`,s.placeId)):[fact('schedule','No scheduled happenings appear in the supplied public map.')]});
 const projectRows=visible.filter(o=>o.kind==='project').slice(0,10).map(o=>({id:String(o.id),kind:'project',placeId:String(o.placeId),name:clip(o.name,160),state:publicProject(object(o.public)),untrusted:true}));
 sections.push({section:'projects',rows:projectRows,learned:[fact('projects',`${projectRows.length} project records are exposed to this Soul; their written descriptions are untrusted.`)]});
 const notices:Record<string,unknown>[]=[];
 if(ledger.db.db.prepare("SELECT 1 FROM sqlite_master WHERE name='edge_comms_stream'").get()){
  for(const row of ledger.db.db.prepare("SELECT seq,tick,body FROM edge_comms_stream WHERE world_id=? AND soul_id=? AND kind='world.notice' ORDER BY seq DESC LIMIT 3").all(worldId,soul.soulId) as {seq:number;tick:number;body:string}[]){const data=object(JSON.parse(row.body));notices.push({id:`event:${row.seq}`,tick:row.tick,text:clip(data.text,300),untrusted:true});}
 }
 sections.push({section:'notices',rows:notices,learned:notices.length?notices.map(n=>fact('notices',`A delivered notice says: ${n.text}`,worldId,true)):[fact('notices','No recent notices are stored in this Soul’s delivered stream.')]});
 const items=ledger.together.publicItems().slice(0,10).map(item=>{const row=object(item);return{id:String(row.id??''),kind:clip(row.kind,80),title:clip(row.title??row.name,100),placeId:clip(row.placeId,100),untrusted:true};});
 sections.push({section:'lost-found',rows:items,learned:[fact('lost-found',`${items.length} item records are currently exposed by the public items projection.`)]});
 const letters=visible.filter(o=>['letter','mail','letter-draft'].includes(String(o.kind))).slice(0,10).map(o=>({id:String(o.id),kind:String(o.kind),name:clip(o.name,100),untrusted:true}));
 sections.push({section:'letters',rows:letters,learned:[fact('letters',`${letters.length} letter records are exposed to this Soul’s authorized object view.`)]});
 sections.push({section:'digest',rows:[{tick,placeId:end?.place??null,posture:end?.posture??'unknown'}],learned:[fact('digest',`At recorded tick ${tick}, this Soul’s body is ${end?.posture??'unavailable'}${end?.place?` at ${end.place}`:''}.`,end?.place??worldId)]});
 for(const o of visible.filter(o=>o.kind==='presentation'&&o.here===true).slice(0,5)){
  const projection=ledger.comms?.objects.get?.(String(o.id),soul),view=object(object(projection).object),state=object(view.state);
  if(!Array.isArray(state.materials))continue;
  for(const [index,text] of state.materials.slice(-3).entries())if(typeof text==='string')materials.push({id:String(o.id),version:Number(view.version??0),title:clip(state.title,160)||'Presentation',text:clip(text,300),source:`presentation:${o.id}:v${view.version??0}:material${index}`});
 }
 return{...base,sections,materials};
}
function publicProject(state:Record<string,unknown>){const result:Record<string,string|number>={};for(const k of ['title','goal','progress','phase','need','text']){const v=state[k];if(typeof v==='string')result[k]=clip(v,200);else if(typeof v==='number'&&Number.isFinite(v))result[k]=v;}return result;}
