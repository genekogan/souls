import {useEffect,useState,type ReactNode} from 'react';
import {NavbarMenu} from './NavbarMenu.tsx';
import {orderedSoulIds,readSoulRecency,selectedSoulIds} from './soul-recency.ts';
import type {PublicSoul} from '@souls/protocol';
import {worldKey,worldPath} from './world-path.ts';
import {requestSoulConversations} from './dialogue-speaking.ts';
import {soulAvatars} from './SoulAvatars.ts';
import {soulAvatarImage} from './soul-avatar-source.ts';
import type {Api} from './useSouls.ts';
import {useOwnedAgentPresence} from './agent-presence.ts';
import {newest,ownerLink,readBody,type Body} from './soul-state.ts';
const ID=/^[a-zA-Z0-9_-]{1,100}$/;
export function mineIds(value:unknown):string[]{return Array.isArray(value)?[...new Set(value.filter((id):id is string=>typeof id==='string'&&ID.test(id)))].slice(0,24):[];}
const key='sim.mine.'+worldKey;
function stored(){try{return mineIds(JSON.parse(localStorage.getItem(key)??'[]'));}catch{return [];}}
function fragmentMine(){try{return mineIds(new URLSearchParams(location.hash.slice(1)).get('mine')?.split(','));}catch{return [];}}
/** Pins identify a browser's favourites; they confer no ownership or control authority. */
export function useMySouls(){
 const [ids,setIds]=useState(()=>mineIds([...stored(),...fragmentMine()]));
 useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(ids));}catch{}},[ids]);
 useEffect(()=>{const read=()=>{const add=fragmentMine();if(!add.length)return;setIds(prev=>mineIds([...prev,...add]));history.replaceState(null,'',location.pathname+location.search+'#watch');};read();addEventListener('hashchange',read);return()=>removeEventListener('hashchange',read);},[]);
 return {ids,toggle:(id:string)=>setIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):mineIds([...prev,id]))};
}
export function SoulAvatar({soul}:{soul:PublicSoul}){
 const [failedPhoto,setFailedPhoto]=useState<string|null>(null);
 const [,refresh]=useState(0);useEffect(()=>{const change=()=>refresh(n=>n+1);soulAvatars.events.addEventListener('change',change);return()=>soulAvatars.events.removeEventListener('change',change);},[]);
 const image=soulAvatarImage(soul,worldPath,soulAvatars.images.get(soul.id),failedPhoto),source=soulAvatars.sources.get(soul.id);let hash=0;for(const c of soul.id)hash=(hash*31+c.charCodeAt(0))>>>0;
 return image?<img key={image.key} className="soul-avatar" src={image.src} data-avatar-source={image.kind} data-profile-photo-hash={image.hash} data-avatar-entity={image.kind==='generated'?source?.entityId:undefined} data-avatar-model={image.kind==='generated'?source?.model:undefined} data-avatar-body-root={image.kind==='generated'?source?.bodyRoot:undefined} onError={image.kind==='profile-photo'?()=>setFailedPhoto(image.key):undefined} alt=""/>:<span className="soul-avatar initials" style={{background:`hsl(${hash%360} 38% 46%)`}} aria-hidden="true">{soul.name.split(/\s+/).slice(0,2).map(n=>n[0]).join('')}</span>;
}
/** LINK chips (canvas board 6): green ring = Connected; dimmed + "zz" = asleep; dimmed + a zombie mark = zombie;
 * amber ring + "!" = Pairing; dimmed alone = disconnected with no body word yet; null = not known (claims nothing). */
export type ChipState='pairing'|'connected'|'zombie'|'asleep'|'disconnected';
export function chipState(link:ReturnType<typeof ownerLink>,body:Body|null):ChipState|null{
 if(!link)return null;if(link.state!=='disconnected')return link.state;
 return body?.state==='zombie'?'zombie':body?.state==='asleep'?'asleep':'disconnected';
}
const CHIP_WORD:Record<ChipState,string>={pairing:'pairing request waiting',connected:'connected',zombie:'disconnected, zombie',asleep:'disconnected, asleep',disconnected:'disconnected'};
const CHIP_MARK:Partial<Record<ChipState,{cls:string;text:string}>>={pairing:{cls:'my-souls-pair',text:'!'},asleep:{cls:'my-souls-zz',text:'zz'},zombie:{cls:'my-souls-zz my-souls-zombie',text:'≈'}};
/** B3: a click opens the Soul's card (select) and flies the camera to follow it (follow → requestFollowSoul). */
export function MySouls({ids,souls,select,follow,present,api,bodies,newSoul,recencyKey='sim.soul-recency.'+worldKey,selectedId}:{ids:readonly string[];souls:ReadonlyMap<string,PublicSoul>;select:(id:string)=>void;follow?:(id:string)=>void;present?:ReadonlySet<string>;api?:Api;bodies?:ReadonlyMap<string,Body>;newSoul?:ReactNode;recencyKey?:string;selectedId?:string|null}){
 const [recent,setRecent]=useState(()=>readSoulRecency(recencyKey));
 const remember=(id:string)=>setRecent(prev=>selectedSoulIds(id,prev,ids));
 useEffect(()=>{if(!ids.length)return;try{localStorage.setItem(recencyKey,JSON.stringify(recent.filter(id=>ids.includes(id))));}catch{}},[recent,recencyKey,ids.join(',')]);
 useEffect(()=>{if(selectedId&&ids.includes(selectedId))remember(selectedId);},[selectedId,ids.join(',')]);
 const pinned=orderedSoulIds(ids,recent).flatMap(id=>{const soul=souls.get(id);return soul?[soul]:[];});
 const agent=useOwnedAgentPresence(api,pinned.slice(0,3).map(s=>s.id));
 const stateOf=(soul:PublicSoul)=>{const here=agent(soul.id);return chipState(ownerLink(here?.link??null,here),newest(readBody((soul as PublicSoul&{body?:unknown}).body),bodies?.get(soul.id)??null));};
 const open=(id:string)=>{remember(id);select(id);follow?.(id);};
 const chip=(soul:PublicSoul,close?:()=>void)=>{const st=stateOf(soul),mark=st?CHIP_MARK[st]:undefined,dim=st==='zombie'||st==='asleep'||st==='disconnected';
  return <button type="button" key={soul.id} className={(present&&!present.has(soul.id))||dim?'my-souls-away':undefined} data-link-state={st??undefined} onContextMenu={e=>{e.preventDefault();remember(soul.id);select(soul.id);requestSoulConversations(soul.id);}} title={`${soul.name}${st?` · ${CHIP_WORD[st]}`:''} · Soul details · right-click for conversations`} aria-label={`Open ${soul.name}${st?` (${CHIP_WORD[st]})`:''}`} onClick={()=>{open(soul.id);close?.();}}><SoulAvatar soul={soul}/>{close&&<span>{soul.name}</span>}{mark&&<span className={mark.cls} aria-hidden="true">{mark.text}</span>}</button>;};
 return <div className="my-souls" aria-label="Your account Souls">{pinned.length>3
  ? <NavbarMenu label="Your Souls" className="souls-menu" trigger={<span className="soul-avatar-pile">{pinned.slice(0,3).map((soul,i)=><span key={soul.id} style={{zIndex:3-i}} data-soul-id={soul.id}><SoulAvatar soul={soul}/></span>)}</span>}>
      {close=><>{pinned.map(soul=>chip(soul,close))}<div onClick={close}>{newSoul}</div></>}
    </NavbarMenu>
  : <>{pinned.map(soul=>chip(soul))}<span className="new-soul-control">{newSoul}</span></>}</div>;
}
