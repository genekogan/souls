import {useEffect,useLayoutEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import type {TalkLine} from '@souls/protocol';
import type {WorldViewerHandle,WorldViewerState} from './WorldViewer.ts';
import {createDialogueStore,hearingLabel,ingestDialogue,joinNames,participants,threadSoulColours,type DialogueEdgeMessage,type DialogueLine,type DialogueStore,type DialogueThread} from './dialogue-threads.ts';
import {dialogueRequests,speakingNow} from './dialogue-speaking.ts';
import './DialogueDock.css';

/** A thread counts as current (auto-expanded) while its last line is this recent. */
export const DOCK_RECENT_MS=10*60_000;
export const DOCK_EXPANDED=3;
const PHONE='(max-width: 700px)';
const ago=(ms:number)=>ms<60_000?'now':ms<3600_000?`${Math.round(ms/60_000)}m`:`${Math.round(ms/3600_000)}h`;

type Shown={t:DialogueThread;lines:DialogueLine[];lastAt:number;names:string[];colours:Map<string,string>};
type Props={root:RefObject<HTMLDivElement|null>;scope:string;edge:readonly DialogueEdgeMessage[]|undefined;talk:readonly TalkLine[];
 state:WorldViewerState|null;active:boolean;handle:WorldViewerHandle|null;nameOf:(soulId:string)=>string};

/** Threads open only from a selected Soul or a nearby group marker. */
export function DialogueDock({root,scope,edge,talk,state,active,handle,nameOf}:Props){
 const stores=useRef<{scope:string;store:DialogueStore}|null>(null);
 if(stores.current?.scope!==scope)stores.current={scope,store:createDialogueStore()};
 const store=stores.current.store;
 const version=useMemo(()=>{ingestDialogue(store,edge??[],talk);return store.version;},[store,edge,talk]);
 const [focus,setFocus]=useState<string|null>(null);
 const [soulContext,setSoulContext]=useState<string|null>(null);
 const [top,setTop]=useState(90);
 /** Which thread is expanded inside the card: undefined = the newest (or focused), null = all collapsed. */
 const [slot,setSlot]=useState<HTMLElement|null>(null);
 const [cardOpen,setCardOpen]=useState<string|null|undefined>(undefined);
 const now=Date.now(),shownTick=state?.shownTick??null;
 const held=active&&shownTick!==null&&!state?.loading&&!state?.unavailableReason;
 const selected=state?.selection.soulId??null;
 useEffect(()=>{if(soulContext&&selected!==soulContext)setSoulContext(null);},[selected,soulContext]);
 useEffect(()=>setCardOpen(undefined),[selected,focus]);
 const shown=useMemo(()=>{
  const out:Shown[]=[];
  for(const t of store.threads.values()){const lines=held?t.lines.filter(l=>l.tick<=shownTick!):t.lines;if(!lines.length)continue;out.push({t,lines,lastAt:lines.at(-1)!.at,names:participants(t),colours:threadSoulColours(t)});}
  return out.sort((a,b)=>b.lastAt-a.lastAt);
 },[store,version,held,shownTick]);
 const announced=useRef(new Set<string>());
 useEffect(()=>{
  if(!active)return;const t0=performance.now(),wall=Date.now();
  for(const s of shown)for(const l of s.lines.slice(-6)){if(announced.current.has(l.key))continue;announced.current.add(l.key);
   if(!l.replay&&wall-l.at<20_000)speakingNow.set(l.soulId,{colour:s.t.colour,since:t0,thread:s.t.id,text:l.text,private:s.t.kind==='private',key:l.key});}
  if(announced.current.size>2000)announced.current=new Set([...announced.current].slice(-1000));
 },[shown,active]);
 useEffect(()=>{setFocus(null);setSoulContext(null);announced.current.clear();speakingNow.clear();},[scope]);
 useEffect(()=>{
  const open=(e:Event)=>{const id=(e as CustomEvent<string>).detail;if(!active||!store.threads.has(id))return;setSoulContext(null);setFocus(id);};
  const soul=(e:Event)=>{const id=(e as CustomEvent<string>).detail;if(!active)return;setSoulContext(id);setFocus(null);};
  dialogueRequests.addEventListener('open-thread',open);dialogueRequests.addEventListener('open-soul',soul);
  return()=>{dialogueRequests.removeEventListener('open-thread',open);dialogueRequests.removeEventListener('open-soul',soul);};
 },[active,store]);
 useEffect(()=>{const frame=root.current;if(!frame)return;const measure=()=>{const bar=frame.querySelector('.world-hud');setTop(Math.ceil((bar?.getBoundingClientRect().bottom??80)-frame.getBoundingClientRect().top)+10);};const ro=new ResizeObserver(measure);ro.observe(frame);const bar=frame.querySelector('.world-hud');if(bar)ro.observe(bar);measure();return()=>ro.disconnect();},[root]);
 // A Soul card exposes only threads that actually involve that Soul; no public conversation directory.
 const relevant=soulContext?shown.filter(s=>s.names.includes(soulContext)):focus?shown.filter(s=>s.t.id===focus):[];
 const close=()=>{setFocus(null);setSoulContext(null);};
 // CONV-UI (Gene 10-08 "per-Soul in its card"): the selected Soul's card holds a slot; its threads render there
 // (the focused one first), and the floating dock is only the fallback when no card slot is on screen.
 const cardFor=soulContext??selected;
 // The card may mount in the same commit as this render, so the slot is looked up after each commit (state only on change).
 useEffect(()=>{const el=active&&cardFor?document.querySelector<HTMLElement>(`.soul-card-thread[data-soul-thread="${CSS.escape(cardFor)}"]`):null;if(el!==slot)setSlot(el);});
 const own=cardFor?shown.filter(s=>s.names.includes(cardFor)):[];
 const inCard=!!slot?.isConnected&&(!focus||own.some(s=>s.t.id===focus));
 const cardThreads=inCard?[...own.filter(s=>s.t.id===focus),...own.filter(s=>s.t.id!==focus)].slice(0,3):[];
 const frameGroup=(s:Shown)=>{const ids=participants(s.t);handle?.frameSouls?.(ids);setSoulContext(null);setFocus(s.t.id);};
 const anchors=new Map((held?state?.speechAnchors??[]:[]).filter(a=>a.visible&&(a.distance??Infinity)<=48).map(a=>[a.soulId,a]));
 const viewport=root.current?.querySelector('.world-viewport');const frame=root.current;
 const offset=viewport&&frame?{x:viewport.getBoundingClientRect().left-frame.getBoundingClientRect().left,y:viewport.getBoundingClientRect().top-frame.getBoundingClientRect().top}:{x:0,y:0};
 const markers=held&&state?.presentation==='live'?shown.filter(s=>!s.t.closed&&now-s.lastAt<60_000).flatMap(s=>{const ids=participants(s.t),points=ids.flatMap(id=>{const a=anchors.get(id);return a?[a]:[];});if(points.length<2)return [];return [{s,x:points.reduce((n,a)=>n+a.x,0)/points.length+offset.x,y:Math.min(...points.map(a=>a.y))+offset.y-34}];}).slice(0,6):[];
 return <>
  {active&&markers.map(({s,x,y})=><button key={s.t.id} className="conversation-marker" style={{left:x,top:y,['--thread' as string]:s.t.colour}} aria-label={`Open conversation with ${joinNames(s.names.map(nameOf))}`} title="Open live conversation and frame speakers" onClick={()=>frameGroup(s)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="currentColor"/><circle cx="8" cy="11" r="1"/><circle cx="12" cy="11" r="1"/><circle cx="16" cy="11" r="1"/></svg></button>)}
  {inCard&&cardThreads.length>0&&createPortal(<CardThreads list={cardThreads} now={now} nameOf={nameOf} open={cardOpen} setOpen={setCardOpen} follow={frameGroup}/>,slot!)}
  {active&&(focus||soulContext)&&!inCard&&<section className="dialogue-dock open contextual" style={{top,maxHeight:`calc(100% - ${top+16}px)`,['--lines-max' as string]:'35dvh'}} aria-label={soulContext?`${nameOf(soulContext)} conversations`:'Live conversation'}>
   <div className="dlg-dock-head"><span>{soulContext?`${nameOf(soulContext)} · conversations`:'Live conversation'}</span><button className="dlg-icon" aria-label="Close conversation" onClick={close}>×</button></div>
   <div className="dlg-scroll">{relevant.length?relevant.map(s=><ThreadCard key={s.t.id} s={s} now={now} nameOf={nameOf} pinned={null} flash={false} onFollow={()=>frameGroup(s)} onCollapse={close}/>):<p className="dlg-empty">No conversations in this recent window.</p>}</div>
  </section>}
 </>;
}

/** The selected Soul's own threads inside its card: one expanded, the rest one line each. */
function CardThreads({list,now,nameOf,open,setOpen,follow}:{list:Shown[];now:number;nameOf:(id:string)=>string;open:string|null|undefined;setOpen:(id:string|null)=>void;follow:(s:Shown)=>void}){
 const expanded=open===undefined?list[0]!.t.id:open;
 return <div className="dialogue-dock dlg-card" role="group" aria-label="Conversations">{list.map(s=>s.t.id===expanded
  ?<ThreadCard key={s.t.id} s={s} now={now} nameOf={nameOf} pinned={null} flash={false} linesMax="22dvh" onFollow={()=>follow(s)} onCollapse={()=>setOpen(null)}/>
  :<CollapsedRow key={s.t.id} s={s} onOpen={()=>setOpen(s.t.id)}/>)}</div>;
}

function Names({s}:{s:Shown}){
 const ids=s.names.slice(0,3),rest=s.names.length-ids.length;
 return <span className="dlg-names">{ids.map((id,i)=><span key={id}>{i>0&&(i===ids.length-1&&!rest?' & ':', ')}<b style={{['--soul' as string]:s.colours.get(id)}}>{s.t.names.get(id)??'someone'}</b></span>)}{rest>0&&` +${rest}`}</span>;
}

function CollapsedRow({s,onOpen}:{s:Shown;onOpen:()=>void}){
 const last=s.lines.at(-1)!;
 return <button className="dlg-row" style={{['--thread' as string]:s.t.colour}} onClick={onOpen} title="Show this conversation">
  <span className="dlg-dot" aria-hidden="true"/><span className="dlg-row-text"><b>{joinNames(s.names.map(id=>s.t.names.get(id)??'someone'),2)}</b> <span className="dlg-dim">{last.name}: {last.text}</span></span>
 </button>;
}

function ThreadCard({s,now,nameOf,pinned,flash,onFollow,onCollapse,linesMax}:{s:Shown;now:number;nameOf:(id:string)=>string;linesMax?:string;pinned:string|null;flash:boolean;onFollow:()=>void;onCollapse:()=>void}){
 const list=useRef<HTMLOListElement>(null),stick=useRef(true),seen=useRef(s.lines.length);
 const [unread,setUnread]=useState(0);
 const count=s.lines.length,lastKey=s.lines.at(-1)?.key;
 // Follow the newest line unless the reader scrolled up; then count what arrived and offer a jump.
 useLayoutEffect(()=>{
  const el=list.current;if(!el)return;
  if(stick.current){el.scrollTop=el.scrollHeight;setUnread(0);}else setUnread(u=>u+Math.max(1,count-seen.current));
  el.classList.toggle('scrolled',el.scrollTop>2);
  seen.current=count;
 },[lastKey]);
 const onScroll=()=>{const el=list.current;if(!el)return;el.classList.toggle('scrolled',el.scrollTop>2);stick.current=el.scrollTop+el.clientHeight>=el.scrollHeight-12;if(stick.current&&unread)setUnread(0);};
 const jump=()=>{const el=list.current;if(!el)return;stick.current=true;el.scrollTop=el.scrollHeight;setUnread(0);};
 const hear=hearingLabel(s.t,nameOf,now);
 return <article className={'dlg-thread'+(pinned?' pinned':'')+(flash?' flash':'')} data-kind={s.t.kind} data-thread={s.t.id} style={{['--thread' as string]:s.t.colour,...(linesMax?{['--lines-max' as string]:linesMax}:{})}} aria-label={`${hear.icon==='🔒'?'Private conversation':'Conversation'}: ${joinNames(s.names.map(id=>s.t.names.get(id)??'someone'))}`}>
  <div className="dlg-head">
   <button className="dlg-who" onClick={onFollow} title="Follow this conversation in the view"><span className="dlg-dot" aria-hidden="true"/><Names s={s}/></button>
   <span className="dlg-age">{pinned?`${pinned} · `:''}{ago(now-s.lastAt)}</span>
   <button className="dlg-icon" aria-label="Collapse conversation" onClick={onCollapse}>▾</button>
  </div>
  <p className="dlg-hear"><span aria-hidden="true">{hear.icon}</span> {hear.text}</p>
  <ol className="dlg-lines" ref={list} onScroll={onScroll} tabIndex={0} aria-label="Lines, newest last">
   {s.lines.map(l=><li key={l.key}><b style={{['--soul' as string]:s.colours.get(l.soulId)}}>{l.name}</b> {l.text}</li>)}
  </ol>
  {unread>0&&<button className="dlg-new" onClick={jump}>{unread} new line{unread===1?'':'s'} ↓</button>}
 </article>;
}
