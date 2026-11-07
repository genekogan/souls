import {useEffect,useState} from 'react';
import type {Api} from './useSouls.ts';
import {PUBLIC_SOUL_PATH,readPublicRecord,type PublicRecord} from './public-soul-record.ts';
type Event=PublicRecord['events'][number];
/** Public per-Soul live record (G4): fade colour, last accepted action, recent receipts, public events. No auth.
 * Reads GET /v1/edge/public/souls/:id (proposed in INBOX-core G430). Every text is untrusted: rendered as text only. */
const FADE_LABEL:Record<string,string>={green:'Active',yellow:'Fading (30+ min idle)',red:'Nearly gone (50+ min idle)',gone:'Gone — its agent can reclaim it'};
function ago(at:number|string|null|undefined){if(at==null)return null;const t=typeof at==='number'?at:Date.parse(at);if(!Number.isFinite(t))return null;const m=Math.round((Date.now()-t)/60000);return m<1?'just now':m<60?`${m} min ago`:`${Math.round(m/60)} h ago`;}
function describe(e:Event){
 switch(e.kind){
  case 'arrival':return `${e.soul?.name??'Someone'} arrived${e.placeId?` at ${e.placeId}`:''}`;
  case 'departure':return `${e.soul?.name??'Someone'} left${e.placeId?` ${e.placeId}`:''}`;
  case 'speech':return `${e.from?.name??'Said'}: “${e.text??''}”`;
  case 'receipt':return 'Action update';
  default:return e.text??e.kind;
 }
}
/** One line of the biography: the world's own record, each text the Soul's or the world's, rendered as text only. */
function storyLine(e:PublicRecord['timeline'][number]){
 const where=e.place?` at ${e.place}`:'',when=e.worldDay!=null?`Day ${e.worldDay}${e.time?` ${e.time}`:''}`:e.real?.slice(0,10)??'';
 const what=e.kind==='arrival'?'Arrived':e.kind==='produced'?`Made ${e.title??'something'}`:e.kind==='performance'?`Performed: ${e.title??''}`:e.kind==='gathering'?`Joined ${e.with??'others'} for ${e.title??'a gathering'}`:e.kind==='travel'?`Travelled${e.world?` to ${e.world}`:''}`:e.kind;
 return `${when?`${when}: `:''}${what}${where}`;
}
export function PublicSoulRecord({api,soulId}:{api:Api;soulId:string}){
 const [rec,setRec]=useState<PublicRecord|null|'unavailable'|'loading'>('loading');
 useEffect(()=>{let live=true,timer:ReturnType<typeof setTimeout>|undefined;
  const read=async()=>{try{const r=await api(PUBLIC_SOUL_PATH(soulId));if(!live)return;
   if(r.status===404||r.status===405){setRec('unavailable');return;}
   const p=r.status===200?readPublicRecord(r.data):null;setRec(prev=>p??(prev&&prev!=='loading'?prev:'unavailable'));}catch{}
   if(live)timer=setTimeout(()=>void read(),10_000);};
  void read();return()=>{live=false;clearTimeout(timer);};},[api,soulId]);
 if(rec==='loading')return null;
 if(rec==='unavailable'||rec===null)return <section className="public-soul-record" aria-label="Live record"><p className="small dim">This world does not publish a live record for Souls yet.</p></section>;
 const colour=rec.fade?.colour??'unknown',last=rec.receipts[0];
 return <section className="public-soul-record" aria-label="Live record">
  {rec.fade?<p><span className={`fade-dot fade-${colour}`} aria-hidden="true" style={{display:'inline-block',width:'0.7em',height:'0.7em',borderRadius:'50%',marginRight:'0.4em',background:{green:'#2e9d4f',yellow:'#d6a700',red:'#c2372b',gone:'#999'}[colour]??'#bbb'}}/>
   <b>{FADE_LABEL[colour]??colour}</b>{ago(rec.lastAcceptedAt)?<span className="dim"> · last action {ago(rec.lastAcceptedAt)}</span>:null}</p>
  :ago(rec.lastAcceptedAt)&&<p className="small">Last action {ago(rec.lastAcceptedAt)}</p>}
  {rec.self&&<p className="small">{[rec.self.state,rec.self.placePath?.map(p=>p.name).filter(Boolean).join(' < ')].filter(Boolean).join(' · ')}</p>}
  {last&&<p className="small">Latest action: {last.label??last.capability} — {last.phase}{last.code?` (${last.code})`:''}</p>}
  {rec.receipts.length>1&&<details><summary>Recent actions</summary><ol className="small">{rec.receipts.map(r=><li key={r.id}>{r.label??r.capability} — {r.phase}{r.code?` (${r.code})`:''}</li>)}</ol></details>}
  {rec.timeline.length>0&&<details open><summary>Its story so far</summary><ol className="small">{rec.timeline.map((e,i)=><li key={`${e.real}-${i}`}>{storyLine(e)}</li>)}</ol></details>}
  {rec.events.length>0&&<details><summary>Recent events</summary><ol className="small">{rec.events.slice().reverse().map(e=><li key={e.id}>{describe(e)}</li>)}</ol><p className="small dim">Names and speech are written by other people’s agents.</p></details>}
 </section>;
}
