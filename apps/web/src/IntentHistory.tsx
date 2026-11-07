import {recordedDirectionGroups} from './intent-history-row.ts';
import {useEffect,useRef,useState} from 'react';
import type {Api} from './useSouls.ts';
import {readIntentHistory,type HistoryRead,type HistoryWindow} from './intent-history-page.ts';
type Props={api:Api;worldId:string;soulId:string;ownerId:string;authorityKey:string;updateSignal?:number;active?:boolean;entityId?:string};
export function IntentHistory(props:Props){
 return <History key={JSON.stringify([props.worldId,props.soulId,props.ownerId,props.entityId,props.authorityKey])} {...props}/>;
}
function History({api,worldId,soulId,ownerId,updateSignal=0,active=false}:Props){
 const [result,setResult]=useState<HistoryRead|null>(null),[busy,setBusy]=useState(false),[readNotice,setReadNotice]=useState<string|null>(null),[catchingUp,setCatchingUp]=useState(false);
 const automaticReads=useRef(0),pollSignal=useRef(updateSignal);
 const [pageVisible,setPageVisible]=useState(()=>document.visibilityState==='visible');
 const alive=useRef(true),reading=useRef(false),readTicket=useRef(0),catching=useRef(false),handledUpdate=useRef(updateSignal);
 const path=`/v1/souls/${encodeURIComponent(soulId)}/intent-v2/history`;
 const read=async(previous?:HistoryWindow):Promise<HistoryWindow|null>=>{
  if(reading.current)return null;reading.current=true;const ticket=++readTicket.current;setBusy(true);setReadNotice(null);
  const cursor=previous?(previous.page.complete?previous.page.resumeCursor:previous.page.nextCursor):null;
  try{
   const response=await api(path+(cursor?'?cursor='+encodeURIComponent(cursor):''));
   if(alive.current&&ticket===readTicket.current){
    const next=readIntentHistory(response.status,response.data,{worldId,soulId,ownerId},previous);setResult(next);
    if(previous&&next.kind==='ready'){
     const count=next.window.page.events.length;
     setReadNotice(count?`Read ${count} ${previous.page.complete?'newer':'more'} recorded event${count===1?'':'s'}.`:previous.page.complete?'No newer recorded events in this read.':'No direction events in this page; more records may remain.');
    }
    return next.kind==='ready'?next.window:null;
   }
  }catch{if(alive.current&&ticket===readTicket.current)setResult({kind:'unavailable'});}
  finally{if(ticket===readTicket.current){reading.current=false;if(alive.current)setBusy(false);}}
  return null;
 };
 useEffect(()=>{alive.current=true;void read();return()=>{alive.current=false;readTicket.current++;reading.current=false;};},[]);
 const window=result?.kind==='ready'?result.window:null;
 const directionGroups=recordedDirectionGroups(window?.rows??[]);
 // Resume only when caught up. An owner reading older pages keeps their place.
 useEffect(()=>{
  if(updateSignal===handledUpdate.current||busy||catchingUp||!window?.page.complete)return;
  handledUpdate.current=updateSignal;void read(window);
 },[updateSignal,busy,result,catchingUp]);
 useEffect(()=>{const update=()=>setPageVisible(document.visibilityState==='visible');document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
 // After interpretation, read subsequent action facts without advancing an
 // incomplete older frontier or retrying a mutation. Failure requires manual recovery.
 useEffect(()=>{
  if(pollSignal.current!==updateSignal){pollSignal.current=updateSignal;automaticReads.current=0;}
  if(!active||!pageVisible||!updateSignal||busy||catchingUp||!window?.page.complete||automaticReads.current>=12)return;
  const timer=setTimeout(()=>{automaticReads.current++;void read(window);},5000);
  return()=>clearTimeout(timer);
 },[active,pageVisible,updateSignal,busy,result,catchingUp]);
 const catchUp=async()=>{
  if(catching.current||reading.current||!window)return;
  catching.current=true;setCatchingUp(true);
  let current=window,resumed=false,reads=0;
  try{
   for(;reads<8&&alive.current;){
    if(current.page.complete){if(resumed)break;resumed=true;}
    const next=await read(current);reads++;
    if(!next)return;current=next;
   }
   if(alive.current)setReadNotice(current.page.complete&&resumed?'Caught up through the latest frontier read. The world may have newer facts now.':'Catch-up paused after eight pages. More records remain; continue when ready.');
  }finally{catching.current=false;if(alive.current)setCatchingUp(false);}
 };
 return <section aria-label="Direction history">
  <h2>What happened</h2>
  <p className="small dim">Recorded direction and action facts for your Soul. Finishing an action does not confirm the whole direction was fulfilled.</p>
  {window?<>
   {directionGroups.length?<ol className="human-history">{directionGroups.map(group=><li key={group.key}>
    <b>{group.summary??'Direction context is not in the loaded records.'}</b>
    <p className="small dim">Latest recorded event · {group.latest.title}</p>
    {!group.latest.directionSummary&&<p>{group.latest.detail}</p>}
    <details><summary>{group.rows.length} recorded event{group.rows.length===1?'':'s'} · details</summary>
     <p className="small dim">Direction {group.intentId}, version {group.version}. These are the loaded records, not the whole history or a final purpose assessment.</p>
     <ol className="human-history">{group.rows.map(row=><li key={row.key}>
      <b>{row.title}</b><p>{row.detail}</p><details><summary>Event details</summary><p className="small dim">Event {row.seq} · tick {row.tick}{row.evidence?` · ${row.evidence.kind} evidence at event ${row.evidence.seq}`:''}</p>{row.reason&&<p className="small">Recorded reason: {row.reason}</p>}{row.requestId&&<p className="small">Request reference: <code>{row.requestId}</code>. Use your current access to check this direction; the reference does not grant permission.</p>}</details>
     </li>)}</ol>
    </details>
   </li>)}</ol>:<p>No direction or action facts in the records read so far.</p>}
   <p className="small dim">{window.page.complete?'Read through the selected history frontier.':'More records remain to be read.'}{window.omitted>0?` Showing the latest 250 facts read; ${window.omitted} earlier facts are omitted from this panel.`:''} This is not a summary since your last visit.</p>
   <details><summary>History details</summary><p className="small dim">Read through event {window.page.throughSeq}. Selected frontier: event {window.page.frontier.seq}, tick {window.page.frontier.tick}.</p></details>
  </>:<p role="status">{!result?'Loading direction history…':result.kind==='gap'?'The saved history has a gap. A fresh read may still be incomplete.':'Direction history is unavailable. No action or outcome can be inferred from this.'}</p>}
  {readNotice?<p className="small" role="status">{readNotice}</p>:null}
  <button disabled={busy||catchingUp} onClick={()=>void read(window??undefined)}>{busy?'Reading history…':window?(window.page.complete?'Check for newer facts':'Continue reading history'):'Read history again'}</button>
  {window&&<button disabled={busy||catchingUp} onClick={()=>void catchUp()}>{catchingUp?'Catching up…':'Catch up recorded history'}</button>}
 </section>;
}
