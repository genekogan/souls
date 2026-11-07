import type {TalkLine} from '@souls/protocol';
import {EDEN_VIEWER_PLACES} from './WorldEdenPlaceData.ts';
import {conversationColour} from './WorldSpectatorSpeech.ts';
/** DLG2 dialogue threads: the spectator's edge feed (doc 26 §10: spectators see every channel) folded into
 * one thread per conversation. A private `converse` conversation is one thread; aloud `say` lines group into
 * one thread per local scene (same place, or the same people still talking). Presentation only: draws only
 * what the speech records say, never infers words or hearers. */
export type ThreadKind='private'|'aloud'|'inside'|'audience';
export type DialogueLine={key:string;tick:number;at:number;soulId:string;name:string;text:string;
 /** Backfilled history (server replay on join, or older brain talk): never announced as "speaking now". */
 replay:boolean};
export type DialogueThread={id:string;kind:ThreadKind;conversation:string|null;placeId:string|null;
 /** Aloud grouping key (place or audience); null for private threads and place-less earshot. */
 group:string|null;colour:string;
 /** Current conversation members (private), in join order. */
 members:string[];invited:string[];
 /** Everyone named in the thread (speakers, members, hearers), soulId → name. */
 names:Map<string,string>;
 /** Aloud/inside/audience: who heard recent lines (server `heardBy`), soulId → last line `at`. */
 hearers:Map<string,number>;
 lines:DialogueLine[];lastAt:number;closed:boolean};
export type DialogueStore={seen:Set<string>;seenOrder:string[];threads:Map<string,DialogueThread>;byConversation:Map<string,string>;version:number};
/** One `{type:'edge'}` viewer message; open shape (EDGE-CONTRACT-v1 §7). */
export type DialogueEdgeMessage={type:'edge';kind?:string;tick?:unknown;at?:unknown}&Record<string,unknown>;

export const THREAD_LINE_LIMIT=80;
export const THREAD_LIMIT=24;
/** An aloud scene stays one thread while someone in it keeps talking within this gap. */
export const ALOUD_GAP_MS=4*60_000;
/** Recent lines whose speakers define "the people in this scene". */
const SCENE_LINES=8;

const placeNames=new Map(EDEN_VIEWER_PLACES.filter(p=>p.kind!=='world').map(p=>[p.id,p.name]));  // "Eden" itself says nothing
export const placeName=(id:string|null|undefined)=>id?placeNames.get(id)??null:null;

export function createDialogueStore():DialogueStore{return {seen:new Set(),seenOrder:[],threads:new Map(),byConversation:new Map(),version:0};}

type Ref={soulId:string;name:string};
const ref=(v:unknown):Ref|null=>v&&typeof v==='object'&&typeof (v as Ref).soulId==='string'&&(v as Ref).soulId?{soulId:(v as Ref).soulId,name:typeof (v as Ref).name==='string'&&(v as Ref).name?(v as Ref).name:'someone'}:null;
const num=(v:unknown,fallback=0)=>typeof v==='number'&&Number.isFinite(v)?v:fallback;
const text=(v:unknown)=>typeof v==='string'?v.trim().slice(0,4000):'';

/** Stable per-message identity, so live lines, reconnect repeats and server replay fold once. */
function keyOf(m:DialogueEdgeMessage):string|null{
 const c=String(m.conversation??'');
 switch(m.kind){
  case 'speech':return typeof m.id==='string'&&m.id?'sp:'+m.id:null;
  case 'conversation.turn':{const seq=(m.turn as {seq?:unknown}|undefined)?.seq;return c&&seq!==undefined?`turn:${c}:${String(seq)}`:null;}
  case 'conversation.start':return c?'start:'+c:null;
  case 'conversation.member':{const who=ref(m.soul);return c&&who?`member:${c}:${who.soulId}:${String(m.change)}:${num(m.tick)}`:null;}
  case 'conversation.closed':return c?'closed:'+c:null;
  default:return null;
 }
}
function remember(store:DialogueStore,key:string){store.seen.add(key);store.seenOrder.push(key);if(store.seenOrder.length>4000)for(const k of store.seenOrder.splice(0,2000))store.seen.delete(k);}

function newThread(store:DialogueStore,id:string,kind:ThreadKind,at:number,extra:Partial<DialogueThread>={}):DialogueThread{
 const t:DialogueThread={id,kind,conversation:null,placeId:null,group:null,colour:conversationColour(id),members:[],invited:[],names:new Map(),hearers:new Map(),lines:[],lastAt:at,closed:false,...extra};
 store.threads.set(id,t);
 if(store.threads.size>THREAD_LIMIT){const oldest=[...store.threads.values()].sort((a,b)=>a.lastAt-b.lastAt).slice(0,store.threads.size-THREAD_LIMIT);
  for(const o of oldest){store.threads.delete(o.id);if(o.conversation&&store.byConversation.get(o.conversation)===o.id)store.byConversation.delete(o.conversation);}}
 return t;
}
function conversationThread(store:DialogueStore,conversation:string,at:number){
 const id=store.byConversation.get(conversation);const t=id?store.threads.get(id):undefined;if(t)return t;
 // Same colour as the 3D tether between the members (SpectatorSpeechLayer uses conversationColour(conversation)).
 const thread=newThread(store,'c:'+conversation,'private',at,{conversation,colour:conversationColour(conversation)});
 store.byConversation.set(conversation,thread.id);return thread;
}
function addLine(t:DialogueThread,line:DialogueLine){
 t.names.set(line.soulId,line.name);
 // Keep chronological order even when replayed history arrives after a live line.
 let i=t.lines.length;while(i>0&&(t.lines[i-1].at>line.at||(t.lines[i-1].at===line.at&&t.lines[i-1].tick>line.tick)))i--;
 t.lines.splice(i,0,line);if(t.lines.length>THREAD_LINE_LIMIT)t.lines.splice(0,t.lines.length-THREAD_LINE_LIMIT);
 t.lastAt=Math.max(t.lastAt,line.at);
}
const recentSpeakers=(t:DialogueThread)=>new Set(t.lines.slice(-SCENE_LINES).map(l=>l.soulId));

/** Pick (or open) the thread for an aloud line. Earshot is what the server says (`heardBy`), so a scene is the
 * people in it: join the live scene whose recent speakers include the speaker or one of the hearers (a group that
 * walks on keeps its thread; two clusters on the same big lawn stay apart). An audience is one thread per talk. */
function aloudThread(store:DialogueStore,kind:Exclude<ThreadKind,'private'>,group:string|null,placeId:string|null,speaker:string,heardBy:readonly string[],at:number,tick:number){
 const live=[...store.threads.values()].filter(t=>t.kind!=='private'&&!t.closed&&at-t.lastAt<=ALOUD_GAP_MS&&at>=t.lastAt-ALOUD_GAP_MS).sort((a,b)=>b.lastAt-a.lastAt);
 const people=new Set([speaker,...heardBy]);
 const found=kind==='audience'?live.find(t=>t.kind===kind&&t.group===group)
  :live.find(t=>t.kind===kind&&[...recentSpeakers(t)].some(id=>people.has(id)));
 if(found){if(group){found.group=group;found.placeId=placeId;}return found;}
 return newThread(store,`${kind}:${group??speaker}:${tick}`,kind,at,{group,placeId});
}

/** Fold new edge messages (and recent brain talk lines) into the store. Returns true when anything changed.
 * Messages already folded are skipped, so callers may pass the whole rolling buffer each time. */
export function ingestDialogue(store:DialogueStore,messages:readonly DialogueEdgeMessage[],talk:readonly TalkLine[]=[],now=Date.now()):boolean{
 let changed=false;
 for(const m of messages){
  if(!m||m.type!=='edge')continue;const key=keyOf(m);if(!key||store.seen.has(key))continue;remember(store,key);
  const at=num(m.at,now),tick=num(m.tick),replay=m.replay===true;
  if(m.kind==='speech'){
   const from=ref(m.from),said=text(m.text);if(!from||!said)continue;
   const ch=m.channel as {kind?:string;placeId?:string|null;object?:string;base?:{kind?:string;placeId?:string|null}}|null|undefined;
   const base=ch?.kind==='audience'?ch.base:ch,kind:Exclude<ThreadKind,'private'>=ch?.kind==='audience'?'audience':base?.kind==='enclosure'?'inside':'aloud';
   const placeId=typeof base?.placeId==='string'&&base.placeId?base.placeId:null;
   const group=kind==='audience'?'audience:'+String(ch?.object??placeId??''):placeId?`${kind}:${placeId}`:null;
   const heardBy=Array.isArray(m.heardBy)?m.heardBy.filter((h):h is string=>typeof h==='string'):[];
   const t=aloudThread(store,kind,group,placeId,from.soulId,heardBy,at,tick);
   for(const h of heardBy)if(h!==from.soulId)t.hearers.set(h,Math.max(t.hearers.get(h)??0,at));
   addLine(t,{key,tick,at,soulId:from.soulId,name:from.name,text:said,replay});changed=true;
  }else{
   const conversation=String(m.conversation);
   if(m.kind==='conversation.turn'){
    const turn=m.turn as {from?:unknown;text?:unknown;at?:unknown;tick?:unknown}|undefined,from=ref(turn?.from),said=text(turn?.text);if(!from||!said)continue;
    const t=conversationThread(store,conversation,at);
    if(Array.isArray(m.members)){const members=m.members.map(ref).filter((r):r is Ref=>!!r);if(members.length){t.members=members.map(r=>r.soulId);for(const r of members)t.names.set(r.soulId,r.name);}}
    else if(!t.members.includes(from.soulId))t.members.push(from.soulId);
    if(m.state==='closed')t.closed=true;
    addLine(t,{key,tick:num(turn?.tick,tick),at:num(turn?.at,at),soulId:from.soulId,name:from.name,text:said,replay});changed=true;
   }else if(m.kind==='conversation.start'){
    const t=conversationThread(store,conversation,at),from=ref(m.from),invited=Array.isArray(m.invited)?m.invited.map(ref).filter((r):r is Ref=>!!r):[];
    if(from){t.names.set(from.soulId,from.name);if(!t.members.includes(from.soulId))t.members.push(from.soulId);}
    for(const r of invited){t.names.set(r.soulId,r.name);if(!t.invited.includes(r.soulId)&&!t.members.includes(r.soulId))t.invited.push(r.soulId);}
    t.closed=false;changed=true;
   }else if(m.kind==='conversation.member'){
    const t=conversationThread(store,conversation,at),who=ref(m.soul);if(!who)continue;t.names.set(who.soulId,who.name);
    t.invited=t.invited.filter(id=>id!==who.soulId);
    if(m.change==='joined'||m.change==='accepted'){if(!t.members.includes(who.soulId))t.members.push(who.soulId);}
    else if(m.change==='left'||m.change==='dropped')t.members=t.members.filter(id=>id!==who.soulId);
    changed=true;
   }else if(m.kind==='conversation.closed'){const id=store.byConversation.get(conversation),t=id?store.threads.get(id):undefined;if(t){t.closed=true;changed=true;}}
  }
 }
 // Brain talk (legacy, non-edge worlds): a pairwise exchange, shown like a private conversation. Only recent lines.
 for(const line of talk){
  const key='talk:'+line.id;if(store.seen.has(key))continue;remember(store,key);
  if(!line.from||!line.text?.trim()||now-line.at>30*60_000)continue;
  const pair=[line.from,line.to].filter(Boolean).sort(),t=conversationThread(store,'talk:'+pair.join('|'),line.at);
  if(line.to&&line.toName)t.names.set(line.to,line.toName);for(const id of pair)if(!t.members.includes(id))t.members.push(id);
  addLine(t,{key,tick:line.tick,at:line.at,soulId:line.from,name:line.fromName||'someone',text:line.text.trim(),replay:false});changed=true;
 }
 if(changed)store.version++;
 return changed;
}

/** "A & B", "A, B & C", "A, B, C +2". */
export function joinNames(names:readonly string[],max=3){
 const shown=names.slice(0,max),rest=names.length-shown.length;
 if(rest>0)return `${shown.join(', ')} +${rest}`;
 return shown.length<=1?shown.join(''):`${shown.slice(0,-1).join(', ')} & ${shown.at(-1)}`;
}
/** Participants in display order: members first (private), then speakers by first line. */
export function participants(t:DialogueThread):string[]{
 const ids=[...t.members];for(const l of t.lines)if(!ids.includes(l.soulId))ids.push(l.soulId);
 return ids;
}
/** The who-can-hear label, shown once per thread. */
export function hearingLabel(t:DialogueThread,nameOf:(soulId:string)=>string,now=Date.now()){
 const where=placeName(t.placeId);
 switch(t.kind){
  case 'private':return {icon:'🔒',text:t.closed?'private · ended':'private · only they hear'};
  case 'inside':return {icon:'🏠',text:`inside ${where??'a room'} · only those inside hear`};
  case 'audience':return {icon:'📣',text:`to the audience${where?` · ${where}`:''}`};
  default:{
   const speakers=new Set(t.lines.slice(-SCENE_LINES).map(l=>l.soulId));
   const listeners=[...t.hearers].filter(([id,at])=>!speakers.has(id)&&now-at<ALOUD_GAP_MS).map(([id])=>nameOf(id));
   return {icon:'💬',text:`aloud${where?` · ${where}`:''}${listeners.length?` · also heard by ${joinNames(listeners,2)}`:''}`};
  }
 }
}
const PALETTE=['#ffd166','#06d6a0','#4cc9f0','#f78c6b','#c77dff','#90be6d','#f15bb5','#ffb4a2'];
/** Name colours for one thread: each Soul keeps its own hue where it can, and no two speakers in the same
 * thread share one (they step to the next free hue). */
export function threadSoulColours(t:DialogueThread):Map<string,string>{
 const out=new Map<string,string>(),used=new Set<string>();
 for(const id of participants(t)){let h=2166136261;for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,16777619);}
  let k=(h>>>0)%PALETTE.length;for(let n=0;n<PALETTE.length&&used.has(PALETTE[k]);n++)k=(k+1)%PALETTE.length;
  used.add(PALETTE[k]);out.set(id,PALETTE[k]);}
 return out;
}
