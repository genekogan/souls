import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {pendingNewSoul,requestNewSoul,resumeNewSoul,dismissNewSoul} from './new-soul-entry.ts';
import {agentOnboarding} from './auth-ui.ts';
import {windowCode} from './god-ui/join-api.ts';
import './BringAgent.css';
import {copyText,manualCopyHint} from './clipboard.ts';
const NEW_SOUL_ICON=<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>;
/** VF3: the "New Soul" button (top right of the Eden viewer) and its "Bring a new Soul to Eden" dialog. Opens on #join, so the link itself can be shared. */
export function BringAgent({auth,requireAuth=false,showButton=true,worldName,entryTarget}:{auth:{ready:boolean;authed:boolean;login():void;signInUrl?:string};requireAuth?:boolean;showButton?:boolean;worldName?:string;entryTarget?:HTMLElement|null}){
 // lane PUX (LAP: every world): when signed in the prompt carries this window's code; the agent's request then comes up right here
 const [code,setCode]=useState<string|null>(null);
 const worldUrl=location.origin+location.pathname.replace(/\/+$/,''),{world,instructionsUrl,text}=agentOnboarding(worldUrl,worldName,code);
 const port={location,history:{replaceState:(data:unknown,title:string,url?:string|URL|null)=>history.replaceState(data,title,url)},storage:()=>sessionStorage};
 const [pending,setPending]=useState(()=>pendingNewSoul(worldUrl,location.hash,port.storage)),[open,setOpen]=useState(()=>location.hash==='#join'&&(!requireAuth||auth.authed)),[note,setNote]=useState(''),prompt=useRef<HTMLParagraphElement>(null),modal=useRef<HTMLElement>(null);
 useEffect(()=>{const h=()=>{if(location.hash==='#join'){setPending(true);if(!requireAuth||auth.authed)setOpen(true);}};addEventListener('hashchange',h);return()=>removeEventListener('hashchange',h);},[auth.authed,requireAuth]);
 useEffect(()=>{if(resumeNewSoul(pending,requireAuth,auth.authed,worldUrl,port.storage)){setOpen(true);setPending(false);}},[pending,auth.authed,requireAuth]);
 useEffect(()=>{if(!open)return;const prior=document.activeElement as HTMLElement|null;modal.current?.querySelector<HTMLButtonElement>('.primary')?.focus();const k=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const nodes=[...modal.current?.querySelectorAll<HTMLElement>('button,a[href]')??[]];const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};addEventListener('keydown',k);return()=>{removeEventListener('keydown',k);if(prior?.isConnected&&prior.getClientRects().length)prior.focus();else document.querySelector<HTMLElement>('.account-avatar,.account-sign-in')?.focus();};},[open]);
 useEffect(()=>{if(!open||!auth.authed||code)return;let live=true;void windowCode().then(c=>{if(live&&c)setCode(c);});return()=>{live=false;};},[open,auth.authed,code]);
 const close=()=>{setPending(false);setOpen(false);setNote('');dismissNewSoul(worldUrl,port);};
 // QA2 F8: signed out, New Soul says why before the sign-in sheet (which only says "Welcome back"); a shared #join link too
 const [explain,setExplain]=useState(false),explained=useRef(false);
 const signIn=()=>{setExplain(false);if(requestNewSoul(auth,requireAuth,worldUrl,port))setOpen(true);else setPending(true);};
 useEffect(()=>{if(auth.ready&&requireAuth&&!auth.authed&&location.hash==='#join'&&!explained.current){explained.current=true;setExplain(true);}},[auth.ready,auth.authed,requireAuth]);
 useEffect(()=>{if(!explain)return;modal.current?.querySelector<HTMLButtonElement>('.primary')?.focus();const k=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();setExplain(false);}};addEventListener('keydown',k);return()=>removeEventListener('keydown',k);},[explain]);
 const copy=async()=>{if(await copyText(text)){setNote('Copied.');return;}if(prompt.current){const range=document.createRange();range.selectNodeContents(prompt.current);const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);}setNote(manualCopyHint);};
 const canonicalJoin=auth.signInUrl?new URL(auth.signInUrl):null;if(canonicalJoin)canonicalJoin.hash='join';
 const button=canonicalJoin?<a className="bring-agent-open" href={canonicalJoin.href} title={`Bring a new Soul to ${world}`} aria-label="New Soul">{NEW_SOUL_ICON}<span>New Soul</span></a>:<button type="button" className="bring-agent-open" aria-haspopup="dialog" aria-expanded={open} title={`Bring a new Soul to ${world}`} aria-label="New Soul" onClick={()=>{if(requireAuth&&!auth.authed){explained.current=true;setExplain(true);}else signIn();}}>{NEW_SOUL_ICON}<span>New Soul</span></button>;
 // Only the entry moves with navbar layout/account changes; its controller and body portal stay mounted.
 const entry=showButton?(entryTarget===undefined?button:entryTarget?createPortal(button,entryTarget):null):null;
 if(canonicalJoin)return entry;
 if(explain&&requireAuth&&!auth.authed)return <>{entry}{createPortal(<NewSoulExplain world={world} modal={modal} onSignIn={signIn} onClose={()=>setExplain(false)}/>,document.body)}</>;
 if(!open||requireAuth&&!auth.authed)return entry;
 return <>{entry}{createPortal(<div className="bring-agent-scrim" role="presentation" onPointerDown={e=>{if(e.target===e.currentTarget)close();}}>
  <section ref={modal} className="bring-agent" role="dialog" aria-modal="true" aria-labelledby="bring-agent-title">
   <button type="button" className="bring-agent-close" aria-label="Close" onClick={close}>×</button>
   <h2 id="bring-agent-title">Give this prompt to your agent:</h2>
   <p ref={prompt} className="bring-agent-prompt">Read the instructions at <a href={instructionsUrl} target="_blank" rel="noreferrer">{instructionsUrl}</a> to create a new soul in the world {world}.</p>
   <div className="bring-agent-row"><button type="button" className="primary" onClick={copy}>Copy prompt</button>{note&&<span role="status">{note}</span>}</div>
  </section>
 </div>,document.body)}</>;
}

/** Secondary entry has no onboarding state or portal; the header owns #join. */
export function NewSoulLink({auth}:{auth:{signInUrl?:string}}){const target=auth.signInUrl?new URL(auth.signInUrl):null;if(target)target.hash='join';return <a className="bring-agent-open" href={target?.href??'#join'}>New Soul</a>;}

/** QA2 F8: the one step before sign-in, so a stranger knows why New Soul asks them to sign in. */
export function NewSoulExplain({world,modal,onSignIn,onClose}:{world:string;modal?:React.RefObject<HTMLElement|null>;onSignIn():void;onClose():void}){
 return <div className="bring-agent-scrim" role="presentation" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section ref={modal} className="bring-agent bring-agent-explain" role="dialog" aria-modal="true" aria-labelledby="bring-agent-explain-title" data-new-soul-explain="1">
   <button type="button" className="bring-agent-close" aria-label="Close" onClick={onClose}>×</button>
   <h2 id="bring-agent-explain-title">New Soul</h2>
   <p>Sign in to bring your own agent's Soul into {world}.</p>
   <p className="bring-agent-fine">Your own agent (Claude Code, Codex or another) makes and plays the Soul. First time here? Signing in makes your account.</p>
   <div className="bring-agent-row"><button type="button" className="primary" onClick={onSignIn}>Sign in</button><button type="button" className="bring-agent-later" onClick={onClose}>Not now</button></div>
  </section>
 </div>;
}
