// Narrow authenticated world transport. Credentials stay in this closure, never
// in model context, journal entries, URLs or diagnostics. No automatic write retry.
import {createEventReader} from './sse.mjs';
import {commandHelp,validateConversationArgs} from './command-help.mjs';
const segment=v=>encodeURIComponent(String(v));
const error=(code,message,extra={})=>Object.assign(Error(message),{code,...extra});
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
// Match the native explicit-clock request normalization, including rejecting
// dates that JS Date.parse would silently roll into a different calendar day.
const reminderAt=at=>{
 if(!record(at))return null;
 if(at.clock==='world')return Object.keys(at).every(k=>['clock','worldDayIndex','time'].includes(k))&&Number.isSafeInteger(at.worldDayIndex)&&at.worldDayIndex>=0&&at.worldDayIndex<=1000000&&typeof at.time==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(at.time)?at:null;
 if(at.clock!=='real'||!Object.keys(at).every(k=>['clock','time'].includes(k)))return null;
 const m=typeof at.time==='string'?/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?(Z|[+-]\d\d:\d\d)$/.exec(at.time):null;if(!m)return null;
 const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number),zone=m[8];
 if(year<1970||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||hour>23||minute>59||second>59||zone!=='Z'&&(Number(zone.slice(1,3))>14||Number(zone.slice(4,6))>59||Number(zone.slice(1,3))===14&&Number(zone.slice(4,6))!==0))return null;
 const ms=Date.parse(at.time);return Number.isSafeInteger(ms)?{clock:'real',time:new Date(ms).toISOString()}:null;
};
const unknown=()=>({state:'unknown',note:'No matching retained outcome found. The operation may still have executed; do not automatically replay it.'});
const observed=response=>{
 const reconciliation={evidence:'observed-native-state',note:'The requested effect is present in native state; this does not prove this operation executed.'};
 return {state:'recorded',evidence:reconciliation.evidence,status:200,response:{...response,reconciliation}};
};
export const isTransientRead=e=>e?.transient===true;
// LOAD-CONTRACT v1 §3: a refusal's stated wait, from Retry-After (seconds or an
// HTTP date) or the body's world.retry_after_s. Receivers treat it as a floor.
export function retryAfterMs(headers,data){
 const h=headers?.get?.('retry-after');
 if(h){const n=Number(h);if(Number.isFinite(n)&&n>=0)return n*1000;const at=Date.parse(h);if(Number.isFinite(at))return Math.max(0,at-Date.now());}
 for(const v of [data?.world?.retry_after_s,data?.error?.retry_after_s,data?.retry_after_s])if(Number.isFinite(v)&&v>=0)return v*1000;
 return null;
}
export function createWorldClient({world,token,fetchImpl=fetch,timeoutMs=65000,streamConnectMs=30000,expectedSoulId=null}){
 const base=new URL(world);
 if(base.username||base.password||base.search||base.hash||!(base.protocol==='https:'||(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))))throw Error('World must be HTTPS or loopback HTTP without credentials/query');
 if(typeof token!=='string'||!token)throw Error('Missing paired Soul credential');
 if(expectedSoulId!==null&&(typeof expectedSoulId!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(expectedSoulId)))throw Error('Invalid expected Soul identity');
 const origin=base.href.replace(/\/$/,'');
 async function request(path,{method='GET',body,operationId,signal,readOnly=method==='GET'}={}){
  const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
  if(operationId)headers['idempotency-key']=operationId;
  let response;
  try{response=await fetchImpl(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});}
  catch(e){throw error('transport.unreachable',signal?.aborted?'Request aborted':'World request did not return',{transient:readOnly&&!signal?.aborted,uncertain:!readOnly});}
  let data;
  try{const text=await response.text();if(Buffer.byteLength(text)>4*1024*1024)throw Error();data=JSON.parse(text);}
  catch{throw error('transport.body','World response body was incomplete or invalid',{transient:readOnly&&(response.status>=500||response.status<300),uncertain:!readOnly,status:response.status});}
  if(!response.ok)throw error(data.error?.code??data.code??`http.${response.status}`,data.error?.message??data.message??'World request refused',{status:response.status,transient:readOnly&&(response.status===429||response.status>=500),uncertain:!readOnly&&response.status>=500,retryAfterMs:retryAfterMs(response.headers,data)});
  return data;
 }
 const eventPage=createEventReader({open:async(after,signal)=>{
  // This limit ends at the headers: an open stream is held to the reader's idle limit, never to a whole-stream one.
  let response;const connect=new AbortController(),timer=setTimeout(()=>connect.abort(),streamConnectMs);
  try{response=await fetchImpl(origin+'/v1/edge/events?'+new URLSearchParams({cursor:after??'c_0',format:'envelope'}),{headers:{authorization:`Bearer ${token}`,accept:'text/event-stream'},redirect:'error',signal:signal?AbortSignal.any([signal,connect.signal]):connect.signal});}
  catch{throw error('transport.unreachable','Event stream unavailable',{transient:!signal?.aborted});}
  finally{clearTimeout(timer);}
  if(!response.ok){throw error('stream.refused','Event stream refused',{status:response.status,transient:response.status===429||response.status>=500,retryAfterMs:retryAfterMs(response.headers)});}
  if(!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream'))throw error('stream.invalid','Event stream content type unavailable');
  return response;
 },validateHello:(hello,{after})=>{
  if(!record(hello)||hello.contract!=='eden-edge/1'||hello.format!=='envelope'||typeof hello.soulId!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(hello.soulId)||expectedSoulId!==null&&hello.soulId!==expectedSoulId||hello.cursor!==(after??'c_0')||!/^c_(0|[1-9][0-9]{0,15})$/.test(hello.cursor)||typeof hello.head!=='string'||!/^c_(0|[1-9][0-9]{0,15})$/.test(hello.head))throw error('stream.identity','Event stream hello did not match the authenticated Soul/cursor contract');
 }});
 return {
  eventPage,
  async reconcile(call,operationId,signal){
   // Inbox routes precede edge idempotency middleware. Read the retained native
   // effect instead: absence/mismatch never authorizes replay of the POST.
   if(call.command==='ack'||call.command==='result'){
    let data;try{data=await request('/v1/edge/inbox/'+segment(call.args.id),{signal});}catch(e){if(e.status===404)return unknown();throw e;}
    const m=data.message;
    if(!m||m.id!==call.args.id||m.state!=='acknowledged')return unknown();
    if(call.command==='ack'){
     if(call.args.reply!==undefined&&(typeof call.args.reply!=='string'||call.args.reply.length>140||/[\r\n]/.test(call.args.reply)))return unknown();
     if((m.reply??null)!==(call.args.reply?.trim()||null))return unknown();
    }else if(typeof call.args.text!=='string'||!call.args.text.trim()||call.args.text.length>140||/[\r\n]/.test(call.args.text)||!['done','failed'].includes(call.args.outcome)||m.resultBy==='server'||!Number.isFinite(m.resultAt)||m.result!==call.args.text.trim()||m.outcome!==call.args.outcome)return unknown();
    return observed({inbox:{latest:m}});
   }
   if(call.command==='remind'){
    let data;try{data=await request('/v1/edge/reminders/by-client-ref/'+segment(operationId),{signal});}catch(e){if(e.status===404)return unknown();throw e;}
    const r=data.reminder,at=reminderAt(call.args.at);
    const sameAt=at?.clock==='world'?r?.at?.clock==='world'&&r.at.worldDayIndex===at.worldDayIndex&&r.at.time===at.time:
     at?.clock==='real'&&r?.at?.clock==='real'&&r.at.time===at.time;
    if(!r||r.clientRef!==operationId||typeof call.args.text!=='string'||!call.args.text.trim()||call.args.text.length>500||Buffer.byteLength(call.args.text)>2000||r.text!==call.args.text.replace(/\s+/g,' ').trim()||!sameAt)return unknown();
    return observed({reminder:r});
   }
   const route=call.command==='act'?'/v1/edge/act':call.command==='say'?'/v1/edge/say':call.command==='converse'?'/v1/edge/converse':call.command==='object'?'/v1/edge/objects/'+segment(call.args.id)+'/act':null;
   if(!route)return {state:'unknown',note:'No authoritative lookup for this operation'};
   return request('/v1/edge/operations/'+segment(operationId)+'?'+new URLSearchParams({route:'POST '+route}),{signal});
  },
  async worldPage({after,signal}){const d=await request('/v1/edge/wait?'+new URLSearchParams({after:after??'c_0',timeout:'50'}),{signal});return {cursor:d.cursor,events:d.events??[],gap:d.gap??false};},
  // One successful nonblocking startup read drains existing owner work before
  // adopting the usual long poll. This is an explicit startup transport change.
  async ownerPage({after,signal,initial=false}){const d=await request('/v1/edge/inbox/listen?'+new URLSearchParams({timeoutMs:initial?'0':'50000',...(after?{after}:{})}),{signal});
   if(initial&&!Array.isArray(d.backlog)&&!record(d.inbox))throw error('owner.invalid','Initial owner page did not match the inbox contract');
   const list=Array.isArray(d.backlog)?d.backlog:d.inbox?.latest?[d.inbox.latest]:[];
   const events=list.filter(m=>m?.id&&m.state!=='acknowledged').map(m=>({id:m.id,kind:'owner.message',text:m.text,sentAt:m.sentAt}));
   return {cursor:events.at(-1)?.id??after,events};
  },
  async read(command,args={},signal){
   if(command==='help')return commandHelp(args.command);
   if(command==='resync'){const observation=await request('/v1/edge/observe',{signal}),conversations=await request('/v1/edge/conversations',{signal});return {observation,conversations,historyIncomplete:true,note:'Current facts refreshed; missing historical events were not reconstructed.'};}
   if(command==='here'){
    if(args.view!==undefined&&args.view!=='body')throw error('invalid','here view must be body when supplied',{status:400,uncertain:false});
    return request(args.view==='body'?'/v1/edge/here?view=body':'/v1/edge/here?include=doHere',{signal});
   }
   if(command==='observe')return request('/v1/edge/observe',{signal});
   if(command==='explore')return request('/v1/edge/around'+(args.query?'?to='+segment(args.query):''),{signal});
   if(command==='resolve')return request('/v1/edge/resolve',{method:'POST',body:{capability:args.capability,params:args.params??{}},signal,readOnly:true});
   if(command==='receipt')return request('/v1/edge/receipts/'+segment(args.id),{signal});
   if(command==='conversations')return request('/v1/edge/conversations',{signal});
   if(command==='turns')return request('/v1/edge/conversations/'+segment(args.id)+'/turns?after='+segment(args.after??0),{signal});
   if(command==='calendar')return request('/v1/edge/calendar',{signal});
   if(command==='reminders')return request('/v1/edge/reminders?state=active',{signal});
   if(command==='object')return request('/v1/edge/objects/'+segment(args.id),{signal});
   throw Error('Unsupported world read');
  },
  // link.for: the owner message this act serves (#789), sent as the CLI's default link (D3b/D3c); acts only.
  async write(command,args,operationId,signal,link){
   if(typeof operationId!=='string'||!/^[A-Za-z0-9._:-]{1,100}$/.test(operationId))throw Error('Stable operation identity required');
   if(command==='converse')validateConversationArgs(args);
   if(command==='result'){
    if(!['done','failed'].includes(args.outcome))throw error('invalid','result outcome must be done or failed',{status:400,uncertain:false});
    if(typeof args.text!=='string'||!args.text.trim()||args.text.length>140||/[\r\n]/.test(args.text))throw error('invalid','result text must be one line of 1–140 characters; shorten it without changing the outcome',{status:400,uncertain:false});
   }
   if(command==='ack'&&args.reply!==undefined&&(typeof args.reply!=='string'||args.reply.length>140||/[\r\n]/.test(args.reply)))throw error('invalid','ack reply must be one line of at most 140 characters',{status:400,uncertain:false});
   let path,body;
   if(command==='act'){path='/v1/edge/act';body={capability:args.capability,params:args.params??{},clientRef:operationId,...(typeof link?.for==='string'&&link.for?{for:link.for,forDefault:true}:{})};}
   else if(command==='say'){path='/v1/edge/say';body={text:args.text};}
   else if(command==='converse'){path='/v1/edge/converse';body={...args};}
   else if(command==='ack'){path='/v1/edge/inbox/'+segment(args.id)+'/ack';body={reply:args.reply};}
   else if(command==='result'){path='/v1/edge/inbox/'+segment(args.id)+'/result';body={outcome:args.outcome,text:args.text};}
   else if(command==='remind'){path='/v1/edge/reminders';body={clientRef:operationId,text:args.text,at:args.at};}
   else if(command==='object'){path='/v1/edge/objects/'+segment(args.id)+'/act';body={action:args.action,params:args.params??{}};}
   else throw Error('Unsupported world write');
   return request(path,{method:'POST',body,operationId,signal});
  },
 };
}
