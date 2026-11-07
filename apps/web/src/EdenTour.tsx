import {useEffect,useLayoutEffect,useMemo,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import type {WorldLocationPage} from './WorldLocations.ts';
import type {PublicSoul} from '@souls/protocol';
import {SoulAvatar} from './MySouls.tsx';
import {curatedExploreLocations} from './WorldPlaces.ts';
import './Explore.css';
import {exploreSoulRoster,exploreSoulState,truncateNow,type ExplorePresence} from './explore-data.ts';
import {bodyWord,type Body} from './soul-state.ts';
import {firstExploreResult} from './explore-control.ts';
/** Explore selects a camera view; it never moves or controls a Soul. */
export type EdenTourPlace=string;
function PlacePicture({id,revision,preview}:{id:string;revision?:number|string;preview?:(id:string)=>Promise<string|null>}){
 const host=useRef<HTMLSpanElement>(null),[image,setImage]=useState<string|null>(null);
 useEffect(()=>{setImage(null);const el=host.current;if(!el||!preview)return;let gone=false,started=false;
  const load=()=>{if(started)return;started=true;void preview(id).then(src=>{if(!gone)setImage(src);}).catch(()=>{});};
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load();}},{root:el.closest('.explore-scroll'),rootMargin:'80px'});observer.observe(el);
  return()=>{gone=true;observer.disconnect();};
 },[id,revision,preview]);
 return <span ref={host} className="explore-picture" aria-hidden="true">{image?<img src={image} alt=""/>:<svg viewBox="0 0 64 48"><path d="M10 37V18l15-9 15 9v19M40 37V24l14-8v21M20 37V26h10v11" fill="none" stroke="currentColor" strokeWidth="2"/></svg>}</span>;
}
export function EdenTour({onView,souls=new Map(),present=new Set(),onSoul,preview,onOpen,onClose,locationPage,onSearch,onMore,presence=new Map(),room,worldName='Eden',locations=curatedExploreLocations,bodies}:{bodies?:ReadonlyMap<string,Body>;worldName?:string;locations?:readonly{id:string;label:string;previewRevision?:number|string;previewLabel?:string}[];onView:(place:EdenTourPlace)=>boolean;souls?:ReadonlyMap<string,PublicSoul>;present?:ReadonlySet<string>;onSoul?:(id:string)=>boolean;preview?:(id:string)=>Promise<string|null>;onOpen?:()=>void;onClose?:()=>void;locationPage?:WorldLocationPage;onSearch?:(query:string)=>void;onMore?:()=>void;presence?:ReadonlyMap<string,ExplorePresence>;room?:{name:string;soulIds:readonly string[]}|null}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[unavailable,setUnavailable]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),search=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null),openReader=useRef(onOpen);openReader.current=onOpen;
 const searchReader=useRef(onSearch),closeReader=useRef(onClose),lastSent=useRef('');searchReader.current=onSearch;closeReader.current=onClose;
 useEffect(()=>{if(!open||!searchReader.current||query===lastSent.current)return;const timer=setTimeout(()=>{lastSent.current=query;searchReader.current?.(query);},180);return()=>clearTimeout(timer);},[query,open]);
 const close=()=>{setOpen(false);setUnavailable('');};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(!(e.metaKey||e.ctrlKey)||e.key.toLowerCase()!=='k'||e.altKey||e.shiftKey)return;if(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')&&!dialog.current?.open)return;e.preventDefault();setOpen(o=>!o);};addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[]);
 useLayoutEffect(()=>{if(!open)return;const node=dialog.current,button=trigger.current;openReader.current?.();setQuery('');lastSent.current='';searchReader.current?.('');node?.showModal();search.current?.focus();const backdrop=(e:PointerEvent)=>{if(e.target!==node||!node)return;const b=node.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom){setOpen(false);setUnavailable('');}};node?.addEventListener('pointerdown',backdrop);return()=>{node?.removeEventListener('pointerdown',backdrop);node?.close();closeReader.current?.();button?.focus();};},[open]);
 // accent- and case-blind: "cafe" finds "Café", "café" finds "Cafe"
 const locationsReady=!onSearch||!!locationPage&&!locationPage.loading&&locationPage.query===query.trim();
 const shownLocations=useMemo(()=>onSearch?(locationsReady?locations:[]):locations.filter(p=>searchKey(p.label).includes(searchKey(query.trim()))),[query,locations,onSearch,locationsReady]);
 const roster=exploreSoulRoster(souls,presence,query,room,bodies),shownSouls=roster.souls;
 const pickSoul=(s:PublicSoul)=>{if(present.has(s.id)&&onSoul?.(s.id))close();else setUnavailable(`${s.name} is away from this world.`);};
 const pickPlace=(id:string)=>{if(onView(id))close();else setUnavailable('This view is unavailable right now.');};
 // V1: Enter in the search box picks the first shown result, as a click on it would.
 const enter=(e:ReactKeyboardEvent<HTMLInputElement>)=>{if(e.key!=='Enter'||e.nativeEvent.isComposing)return;const first=firstExploreResult(query,shownSouls,shownLocations);if(!first)return;e.preventDefault();if(first.kind==='soul')pickSoul(first.soul);else pickPlace(first.id);};
 return <span className="eden-tour explore-control"><button ref={trigger} type="button" className="explore-open" aria-label={`Explore ${worldName}`} data-tooltip={`Explore ${worldName} (⌘K / Ctrl+K)`} aria-haspopup="dialog" aria-expanded={open} title={`Explore ${worldName} (⌘K / Ctrl+K)`} onClick={()=>setOpen(true)}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="m12.5 12.5 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg></button>
  {open&&<dialog ref={dialog} aria-modal="true" className="frosted-modal explore-modal" aria-labelledby="explore-title" onCancel={e=>{e.preventDefault();close();}}>
   <header className="explore-heading"><h2 id="explore-title">Explore {worldName}</h2><button type="button" aria-label="Close Explore" onClick={close}>×</button></header>
   <input ref={search} className="explore-search" type="search" aria-label="Search locations and Souls" placeholder="Find a location or Soul…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={enter}/>
   <div className="explore-scroll">
    {!!shownSouls.length&&<section aria-labelledby="explore-souls"><h3 id="explore-souls">Souls in {worldName}</h3>{room&&<p className="dim">{room.name}: {roster.inRoom.size} {roster.inRoom.size===1?'Soul':'Souls'} here</p>}<div className="explore-souls">{shownSouls.map(s=>{const st=exploreSoulState(s,bodies),word=bodyWord(st.body),fade=presence.get(s.id)==='active'?'Active':presence.get(s.id)==='fading'?'Fading':presence.get(s.id)==='departed'?'Away':'',label=word??fade,
     line=[label,st.now?`“${truncateNow(st.now.text)}”`:'',roster.inRoom.has(s.id)?(label?'in this room':'In this room'):''].filter(Boolean).join(' · ');
     return <button type="button" key={s.id} className={'explore-soul '+(st.body?`body-${st.body.state}`:(presence.get(s.id)??'unknown'))} title={st.now?.text} onClick={()=>pickSoul(s)}><SoulAvatar soul={s}/><span><b title={s.name}>{s.name}</b><small><i/><span className="explore-line">{line}</span></small></span></button>;})}</div></section>}
    <section aria-labelledby="explore-locations"><h3 id="explore-locations">Locations</h3>{locationPage&&<p className="dim" aria-live="polite">{locationsReady?`${locations.length} of ${locationPage.total} locations`:'Searching locations…'}</p>}<div className="explore-locations">{shownLocations.map(p=><button type="button" key={p.id} title={p.previewLabel} aria-description={p.previewLabel} onClick={()=>pickPlace(p.id)}><PlacePicture id={p.id} revision={p.previewRevision} preview={preview}/><span>{p.label}</span></button>)}</div>{locationPage?.more&&<button type="button" onClick={onMore} disabled={!locationsReady}>Load more locations</button>}{locationPage?.error&&<p role="status" className="explore-note">{locationPage.error}</p>}{locationsReady&&!shownLocations.length&&!shownSouls.length&&<p className="dim">No matching locations or Souls.</p>}</section>
   </div>{unavailable&&<p role="status" className="explore-note">{unavailable}</p>}
  </dialog>}
 </span>;
}
/** Lower-case, accents removed: what Explore's search compares. */
export const searchKey=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
