// AWAY-UI (Gene's night notes 2026-10-23 #14): one page-wide record of whether each owned Soul's agent is here.
// The open card's inbox poll reports into it (every 2 s); the toolbar chips poll the owner inbox slowly for the rest.
// Only the owner's own inbox reads feed it (GET /v1/edge/owner/:id/inbox, read-only), so nothing here confers control.
import {useEffect,useState} from 'react';
import {whenVisible} from './poll-pace.ts';
import type {Api} from './useSouls.ts';
import {readLink,type Link} from './soul-state.ts';

// PRESENCE (SOUL3): a Soul's agent is listening while a listen is open or closed <= 60 s ago (the server decides; its other
// calls never count). `since` = when it last listened (`listenedAt`; an older server's `lastSeenAt`), null = never seen;
// `waiting` = the owner's messages it has not acknowledged; `readAt` = this page's clock when the answer came.
export type AgentHere={away:boolean;state:'listening'|'working'|'away';since:number|null;waiting:number;readAt:number;
 /** LINK: the server's one owner state (COMMON-LINK §2), null from an older server (presence decides then). */ link:Link|null;
 /** @deprecated kept for older readers; the same as `since` */ lastSeenAt:number|null};
type InboxPresence={presence?:string;connected:boolean;lastSeenAt:number|null;listenedAt?:number|null;queued?:number;link?:unknown};
const known=new Map<string,AgentHere>(),subs=new Set<()=>void>();
export function presenceOf(inbox:InboxPresence,readAt=Date.now()):AgentHere{
 const p=inbox.presence??(inbox.connected?'recent':'away'),state=p==='away'?'away':p==='working'?'working':'listening';
 const since=inbox.listenedAt!==undefined?inbox.listenedAt:inbox.lastSeenAt;
 return {away:state==='away',state,since,lastSeenAt:since,waiting:Math.max(0,inbox.queued??0),readAt,link:readLink(inbox.link)};
}
const linkKey=(l:Link|null)=>l?`${l.state}:${l.reason}:${l.since}:${l.approvalId??''}:${l.holder?.label??''}:${l.holder?.since??''}`:'';
/** A fresh owner-inbox answer for this Soul (null: status unavailable, which makes no away claim). */
export function reportAgentPresence(soulId:string,inbox:InboxPresence|null,readAt=Date.now()){
 const next=inbox?presenceOf(inbox,readAt):null,prev=known.get(soulId);
 if(next)known.set(soulId,next);else known.delete(soulId);
 // readAt alone changes on every poll: tell subscribers only when something they show changed (staleness has its own tick)
 if(next?prev?.state===next.state&&prev.since===next.since&&prev.waiting===next.waiting&&linkKey(prev.link)===linkKey(next.link):!prev)return;
 for(const f of subs)f();
}
/** A last answer older than this is not shown as current: the page stopped hearing (hidden tab, network). */
export const PRESENCE_STALE_MS=45_000;
export const agentPresence=(soulId:string,now=Date.now())=>{const k=known.get(soulId);return k&&now-k.readAt<=PRESENCE_STALE_MS?k:null;};
function useTick(every=0){const [,set]=useState(0);useEffect(()=>{const f=()=>set(n=>n+1);subs.add(f);const t=every?setInterval(f,every):undefined;return()=>{subs.delete(f);clearInterval(t);};},[every]);}
/** This Soul's agent state as last reported (null = unknown or stale: show the active affordances, claim nothing). */
export function useAgentPresence(soulId:string|null|undefined){useTick(soulId?5_000:0);return soulId?agentPresence(soulId):null;}
const two=(n:number)=>String(n).padStart(2,'0');
/** "21:40" in this viewer's own time zone (24 h, as the card says it); "Oct 22, 21:40" on another day. */
export function clockAt(at:number,now=Date.now()){
 const d=new Date(at),hm=`${two(d.getHours())}:${two(d.getMinutes())}`;
 return new Date(now).toDateString()===d.toDateString()?hm:`${d.toLocaleDateString([],{month:'short',day:'numeric'})}, ${hm}`;
}
/** The full instant with its zone, for a tooltip: the short clock is local to whoever reads it. */
export const clockTitle=(at:number)=>new Date(at).toLocaleString([],{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'});
/** The owner inbox answer with `link` wherever the server put it (inside `inbox`, or beside it). */
export const withLink=<T extends InboxPresence>(data:{inbox:T;link?:unknown}):T=>data.inbox.link!==undefined||data.link===undefined?data.inbox:{...data.inbox,link:data.link};
/** The toolbar chips: poll the owner inbox of each shown Soul every 15 s (the open card refreshes its own every 2 s). */
export const CHIP_POLL_MS=15_000;
export function useOwnedAgentPresence(api:Api|undefined,ids:readonly string[]){
 useTick();
 const key=ids.join(',');
 useEffect(()=>{
  if(!api||!key)return;
  let live=true,timer:ReturnType<typeof setTimeout>|undefined;
  const read=async()=>{
   await Promise.all(key.split(',').map(async id=>{
    try{const r=await api(`/v1/edge/owner/${encodeURIComponent(id)}/inbox`);if(live&&r.status===200&&r.data?.inbox)reportAgentPresence(id,withLink(r.data));}catch{/* keep the last state */}
   }));
   if(live)timer=setTimeout(()=>{cancelVisible=whenVisible(()=>void read());},CHIP_POLL_MS);  // PERF-EDEN: never while hidden
  };
  let cancelVisible=()=>{};
  void read();return()=>{live=false;clearTimeout(timer);cancelVisible();};
 },[api,key]);
 return (id:string)=>agentPresence(id);
}
