import {SoulAvatar} from './MySouls.tsx';
import {useEffect,useRef,useState} from 'react';
import type {PublicSoul} from '@souls/protocol';
import type {Api} from './useSouls.ts';
import {PUBLIC_SOUL_PATH,readPublicRecord,type PublicRecord} from './public-soul-record.ts';
import {publicSoulLink} from './soul-link.ts';
import {apiPath,worldPath} from './world-path.ts';
import {BASE} from './base-path.ts';
import './SoulCard.css';
import {SoulMessageBox,soulStartPrompt,useSoulInbox,useWindowCode,type AgentInbox} from './AgentMessageBox.tsx';
import {VisitorFrom} from './SoulTravel.tsx';
import {clockAt,clockTitle,useAgentPresence,type AgentHere} from './agent-presence.ts';
import {ApprovalCard} from './god-ui/ApprovalDialog.tsx';
import {WAITING_PROMPT_MS,ageText,bodyPhrase,bodyWord,holderLine,newest,ownerLink,placeOf,readBody,readNow,reconnectSentence,visitorPhrase,type Body,type Link,type Now} from './soul-state.ts';

/** LINK (spec SOUL-LINK r3 §4, canvas v5): one Soul card, one frame, the status line changes shape.
 * Owner: Connected (link details inline, the agent's `now`, message box + receipt, Follow) · Disconnected (the body as a
 * zombie or asleep, the last `now` dimmed, the Reconnect box as the primary element; just approved: waiting for the agent)
 * · Pairing (the card is the approval). Visitor: Awake / Zombie / Asleep, place, `now`, Follow.
 * Never two of {message box, Reconnect box, Approve} at once. All server text is untrusted and rendered as text only. */
type Rec=PublicRecord|'loading'|'unavailable';
type Camera={following:boolean;follow():void;stop():void};

function usePublicRecord(api:Api,soulId:string):Rec{
 const [rec,setRec]=useState<Rec>('loading');
 useEffect(()=>{let live=true,timer:ReturnType<typeof setTimeout>|undefined;setRec('loading');
  const read=async()=>{try{const r=await api(PUBLIC_SOUL_PATH(soulId));if(!live)return;
   if(r.status===404||r.status===405){setRec('unavailable');return;}
   const p=r.status===200?readPublicRecord(r.data):null;setRec(prev=>p??(prev!=='loading'?prev:'unavailable'));}catch{/* keep the last record */}
   if(live)timer=setTimeout(()=>void read(),10_000);};
  void read();return()=>{live=false;clearTimeout(timer);};},[api,soulId]);
 return rec;
}
/** The fade colour of an older server, as a body (green = present and awake); nothing new reads `fade` otherwise. */
const fadeBody=(rec:PublicRecord|null):Body|null=>rec?.fade&&['green','yellow','red'].includes(rec.fade.colour)?{state:'awake',doing:null,since:0}:null;

export type SoulCardProps={api:Api;soul:PublicSoul;owner:boolean;signedIn?:boolean;bodyEvent?:Body|null;camera?:Camera};
export function SoulCard(props:SoulCardProps){
 const rec=usePublicRecord(props.api,props.soul.id),r=rec==='loading'||rec==='unavailable'?null:rec;
 // COMMON-LINK §2 addendum: the replica's `now` is optional (present only when set); the record always carries it (or null)
 const x=props.soul as PublicSoul&{body?:unknown;now?:unknown};
 const body=newest(readBody(x.body),r?.body??null,props.bodyEvent??null)??fadeBody(r);
 const now=newest(readNow(x.now),r?.now??null);
 const place=placeOf(r?.self?.placePath);
 return props.owner?<OwnerCard {...props} body={body} now={now} place={place}/>:<SoulCardView soul={props.soul} view="visitor" body={body} now={now} place={place} camera={props.camera}/>;
}
function OwnerCard({api,soul,camera,signedIn=true,body,now,place}:SoulCardProps&{body:Body|null;now:Now|null;place:string|null}){
 const {inbox,send}=useSoulInbox(api,soul.id),here=useAgentPresence(soul.id),code=useWindowCode();
 const link=ownerLink(here?.link??null,here);
 const disconnect=async()=>{const r=await api(`/v1/souls/${encodeURIComponent(soul.id)}/revoke`,{});return r.status===200&&r.data?.ok===true;};
 return <SoulCardView soul={soul} view="owner" link={link} here={here} inbox={inbox} send={send} body={body} now={newest(now,readNow(inbox?.now))} place={place}
  prompt={soulStartPrompt(location.origin+apiPath(''),soul.id,soul.name,code)} camera={camera} signedIn={signedIn} disconnect={disconnect}/>;
}

export type SoulCardViewProps={soul:PublicSoul;view:'owner'|'visitor';body:Body|null;now:Now|null;place:string|null;camera?:Camera;
 /** owner only: the one state (null = not known yet), presence, inbox, the start prompt, Disconnect */
 link?:Link|null;here?:AgentHere|null;inbox?:AgentInbox|null;send?(text:string):Promise<unknown>;prompt?:string;signedIn?:boolean;disconnect?():Promise<boolean>;
 /** fixtures and shots: a fixed clock, the link details (and Pair another session) open from the start */
 clock?:number;open?:{details?:boolean;pair?:boolean}};
export function SoulCardView({soul,view,body,now,place,camera,link=null,here=null,inbox=null,send,prompt='',signedIn=true,disconnect,clock,open}:SoulCardViewProps){
 const t=clock??Date.now();
 const [copied,setCopied]=useState<''|'ok'|'failed'>('');
 const [details,setDetails]=useState(!!open?.details);
 const title=useRef<HTMLHeadingElement>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{setCopied('');},[soul.id]);
 useEffect(()=>{if(title.current?.offsetParent)title.current.focus({preventScroll:true});},[soul.id]);
 useEffect(()=>{if(!copied)return;const k=setTimeout(()=>setCopied(''),2200);return()=>clearTimeout(k);},[copied]);
 // the waiting variant offers the prompt after a minute: re-render once then
 const [,tick]=useState(0);
 const waitingSince=view==='owner'&&link?.reason==='approved-waiting'?link.since:null;
 useEffect(()=>{if(waitingSince==null)return;const left=waitingSince+WAITING_PROMPT_MS-Date.now();if(left<=0)return;const k=setTimeout(()=>tick(n=>n+1),left+50);return()=>clearTimeout(k);},[waitingSince]);
 const share=async()=>{try{await navigator.clipboard.writeText(publicSoulLink(location.origin,worldPath,soul.id,BASE));if(alive.current)setCopied('ok');}catch{if(alive.current)setCopied('failed');}};

 // Pairing: the card is the approval (nothing else on it)
 if(view==='owner'&&link?.state==='pairing'){
  return <article className="soul-card" aria-label={`${soul.name}, pairing`} data-soul-state="pairing">
   {link.approvalId?<ApprovalCard key={link.approvalId} id={link.approvalId} signedIn={signedIn} embedded onDone={()=>{}}/>
    :<><Head soul={soul} title={title} share={share} copied={copied}/><p className="soul-meta"><span className="soul-status" data-status="pairing"><i aria-hidden="true"/>Pairing</span><StatusPlace text="waiting for your answer"/></p></>}
  </article>;
 }
 const owner=view==='owner',connected=owner&&link?.state==='connected',disconnected=owner&&link?.state==='disconnected';
 const waiting=disconnected&&link!.reason==='approved-waiting'&&body?.state!=='zombie'&&body?.state!=='asleep';
 const sleeping=owner?disconnected:body?.state==='zombie'||body?.state==='asleep';
 const state=!owner?(body?.state??'unknown'):link?(waiting?'approved-waiting':link.state):'checking';
 const followShown=camera&&(owner?connected||camera.following:true);
 return <article className="soul-card" aria-labelledby="soul-card-name" data-soul-state={state} data-body={body?.state} data-sleeping={sleeping?'1':undefined}>
  <Head soul={soul} title={title} share={share} copied={copied}/>
  <p className="soul-meta">
   {owner?<OwnerStatus link={link} waiting={waiting} details={details} toggle={()=>setDetails(v=>!v)}/>:<VisitorStatus body={body}/>}
   <StatusPlace text={!owner?visitorPhrase(body,place,t):waiting?(link?.since&&t-link.since<WAITING_PROMPT_MS?'approved just now':'approved'):disconnected&&!body?(link?.since?`since ${clockAt(link.since,t)}`:''):bodyPhrase(body,place,t)} title={body?.since?clockTitle(body.since):undefined}/>
   <VisitorFrom soulId={soul.id}/>
  </p>
  {connected&&details&&<LinkDetails name={soul.name} link={link!} here={here} prompt={prompt} disconnect={disconnect} clock={t} pairOpen={!!open?.pair}/>}
  {now&&<p className={'soul-now'+(sleeping?' soul-now-dim':'')} data-now="1"><q>{now.text}</q>{now.at>0&&<span className="soul-dim" title={clockTitle(now.at)}> · {ageText(now.at,t)}</span>}</p>}
  {waiting&&<WaitingNote name={soul.name} place={place} since={link!.since} prompt={prompt} clock={t}/>}
  {disconnected&&!waiting&&<ReconnectBox name={soul.name} link={link!} prompt={prompt} clock={t}/>}
  <div className="soul-card-thread" data-soul-thread={soul.id}/>
  {connected&&send&&<SoulMessageBox inbox={inbox} send={send}/>}
  {followShown&&<div className="soul-actions">
   <button className={camera.following?'soul-follow on':'soul-follow'} aria-pressed={camera.following} title={camera.following?'Stop following':'Keep the camera on this Soul'} onClick={camera.following?camera.stop:camera.follow}><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.6" fill="currentColor"/><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg>{camera.following?'Following':'Follow'}</button>
  </div>}
 </article>;
}

function Head({soul,title,share,copied}:{soul:PublicSoul;title:React.RefObject<HTMLHeadingElement|null>;share():void;copied:string}){
 return <>
  <div className="soul-card-portrait"><SoulAvatar soul={soul}/></div>
  <div className="soul-card-head">
   <h1 id="soul-card-name" ref={title} tabIndex={-1} title={soul.name}>{soul.name}</h1>
   {/* CARD-TRIM (Gene 2026-10-23 #17): Share is a paperclip by the name; it copies the Soul's public link */}
   <button className="soul-share" aria-label={`Copy a link to ${soul.name}`} title="Copy link" onClick={()=>void share()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 4.5v6a2.5 2.5 0 01-5 0V3.75a1.75 1.75 0 013.5 0V10a1 1 0 01-2 0V5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
   <span className="soul-copied" role="status" aria-live="polite">{copied==='ok'?'Link copied':copied==='failed'?'Copy unavailable':''}</span>
  </div>
  {soul.description&&<p className="soul-character">{soul.description}</p>}
 </>;
}
/** A small chevron (a text ▾ reads as a second dot next to the · separator at 13 px). */
const Chevron=({up,right}:{up:boolean;right?:boolean})=><svg className="soul-caret" data-caret={up?'up':right?'right':'down'} viewBox="0 0 10 10" aria-hidden="true"><path d={up?'M2 6.5 5 3.5 8 6.5':right?'M3.5 2 6.5 5 3.5 8':'M2 3.5 5 6.5 8 3.5'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const StatusPlace=({text,title}:{text:string;title?:string})=>text?<span className="soul-place" title={title}><span className="soul-sep" aria-hidden="true"> · </span>{text}</span>:null;
function OwnerStatus({link,waiting,details,toggle}:{link:Link|null;waiting:boolean;details:boolean;toggle():void}){
 if(!link)return <span className="soul-status" data-status="checking"><i aria-hidden="true"/>Checking…</span>;
 if(link.state==='connected')return <button type="button" className="soul-status soul-link" data-status="connected" aria-expanded={details} aria-controls="soul-link-details" title="Link details" onClick={toggle}><i aria-hidden="true"/>Connected<Chevron up={details}/></button>;
 return <span className="soul-status" data-status={waiting?'approved-waiting':'disconnected'}><i aria-hidden="true"/>Disconnected</span>;
}
function VisitorStatus({body}:{body:Body|null}){
 const word=bodyWord(body);
 return word?<span className="soul-status" data-status={word.toLowerCase()}><i aria-hidden="true"/>{word}</span>:null;
}
function useCopy(text:string){
 const [state,setState]=useState<''|'ok'|'failed'>('');
 useEffect(()=>{if(!state)return;const k=setTimeout(()=>setState(''),2000);return()=>clearTimeout(k);},[state]);
 return [state,async()=>{try{await navigator.clipboard.writeText(text);setState('ok');}catch{setState('failed');}}] as const;
}
function PromptCopy({prompt}:{prompt:string}){
 const [state,copy]=useCopy(prompt);
 return <><p className="soul-prompt" aria-label="Start prompt">{prompt}</p>
  <button type="button" className="soul-pill fill" onClick={()=>void copy()}>{state==='ok'?'Copied':'Copy prompt'}</button>
  {state==='failed'&&<span className="soul-dim" role="status"> Copy unavailable: select the prompt above.</span>}</>;
}
function LinkDetails({name,link,here,prompt,disconnect,clock,pairOpen}:{name:string;link:Link;here:AgentHere|null;prompt:string;disconnect?():Promise<boolean>;clock:number;pairOpen:boolean}){
 const [pair,setPair]=useState(pairOpen),[busy,setBusy]=useState(false),[note,setNote]=useState('');
 const off=async()=>{if(!disconnect||busy)return;setBusy(true);setNote('');
  try{setNote(await disconnect()?`Disconnected. ${name} stays where it is.`:'Not confirmed. Check again in a moment.');}catch{setNote('Not confirmed. Check again in a moment.');}finally{setBusy(false);}};
 return <div className="soul-box" id="soul-link-details" data-link-details="1">
  <p className="soul-box-title">Held by your agent</p>
  <p className="soul-dim soul-box-line">{holderLine(link,here,clock)}</p>
  <div className="soul-box-actions">
   <button type="button" className="soul-pill" disabled={busy} onClick={()=>void off()}>Disconnect</button>
   <button type="button" className="soul-pill quiet" aria-expanded={pair} onClick={()=>setPair(v=>!v)}>Pair another session<Chevron up={pair} right={!pair}/></button>
  </div>
  {pair&&<><p className="soul-box-text">Give this to the agent that should take over. Its request shows up here; approving it disconnects the current one.</p><PromptCopy prompt={prompt}/></>}
  {note&&<p className="soul-box-text" role="status">{note}</p>}
 </div>;
}
function ReconnectBox({name,link,prompt,clock}:{name:string;link:Link;prompt:string;clock:number}){
 const {why,ask}=reconnectSentence(name,link,clock);
 return <div className="soul-box soul-reconnect" data-reconnect="1">
  <p className="soul-dim soul-box-line" data-reconnect-why="1">{why}</p>
  <p className="soul-box-text">{ask}</p>
  <PromptCopy prompt={prompt}/>
 </div>;
}
function WaitingNote({name,place,since,prompt,clock}:{name:string;place:string|null;since:number|null;prompt:string;clock:number}){
 const [state,copy]=useCopy(prompt);
 const late=since==null||clock-since>=WAITING_PROMPT_MS;
 return <div className="soul-waiting" data-waiting="1">
  <p className="soul-box-text">{name} is standing {place?`at ${place}`:'at the arrival point'}. Waiting for the agent to start listening…</p>
  {late&&<p className="soul-dim soul-box-text">Still here after a minute? Tell the agent to continue, or <button type="button" className="soul-pill small" onClick={()=>void copy()}>{state==='ok'?'copied':'copy the prompt'}</button> again.</p>}
 </div>;
}
