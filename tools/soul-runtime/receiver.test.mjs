import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJournal} from './journal.mjs';
import {receivePage,runReceiver,runWakeDispatcher} from './receiver.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'souls-receiver-'));const j=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>{j.close();rmSync(dir,{recursive:true,force:true})});return j;}
const page={cursor:'c_1',events:[{id:'c_1',kind:'conversation.turn',text:'Hello'}]};
test('host notification failure leaves pending facts durable while new events can arrive',async t=>{
 const j=fixture(t),abort=new AbortController();let wakes=0;const delays=[];
 await receivePage(j,'world',async()=>page);
 await runWakeDispatcher({journal:j,signal:abort.signal,notify:async({pending})=>{
  if(++wakes===1){assert.equal(pending.length,1);throw Object.assign(Error('host reconnecting'),{transient:true});}
  assert.equal(pending.length,2);abort.abort();
 },retryable:e=>e.transient===true,sleep:async ms=>{delays.push(ms);if(ms===1000)await receivePage(j,'world',async()=>({cursor:'c_2',events:[{id:'c_2',kind:'conversation.turn'}]}));}});
 assert.equal(wakes,2);assert.equal(delays[0],1000);assert.equal(j.pending().length,2);
});
test('transport retry retains cursor and terminal revocation does not loop',async t=>{
 const j=fixture(t);const cursors=[];let reads=0;
 await assert.rejects(runReceiver({journal:j,source:'world',read:async({after})=>{cursors.push(after);if(++reads===1)throw Object.assign(Error('network'),{transient:true});throw Error('control.revoked')},notify:async()=>{},retryable:e=>e.transient===true,sleep:async()=>{}}),/control.revoked/);
 assert.deepEqual(cursors,[null,null]);assert.equal(j.pending().length,0);
});
test('restart offers already-durable unhandled events without a new server message',async t=>{
 const j=fixture(t);j.ingest({source:'world',after:null,...page});const abort=new AbortController();let wake=false;
 await runWakeDispatcher({journal:j,signal:abort.signal,notify:async({pending})=>{assert.equal(pending[0].event.id,'c_1');wake=true;abort.abort()}});
 assert.equal(wake,true);assert.equal(j.pending().length,1);
});
test('aborted fetch never advances cursor; gaps remain visible to decision owner',async t=>{
 const j=fixture(t),abort=new AbortController();const result=await receivePage(j,'world',async()=>{abort.abort();return page},{signal:abort.signal});assert.equal(result.aborted,true);assert.equal(j.cursor('world'),null);
 await receivePage(j,'world',async()=>({cursor:'c_20',events:[],gap:true}));assert.equal(j.gaps().length,1);
});

test('receiver continues ingestion while host notification remains unresolved',async t=>{
 const j=fixture(t);await receivePage(j,'world',async()=>page);const abort=new AbortController();let release,entered;
 const notifying=new Promise(r=>entered=r),held=new Promise(r=>release=r);
 const dispatch=runWakeDispatcher({journal:j,signal:abort.signal,notify:async()=>{entered();await held;}});
 await notifying;
 await receivePage(j,'world',async()=>({cursor:'c_2',events:[{id:'c_2',kind:'speech'}]}));
 assert.equal(j.cursor('world'),'c_2');assert.equal(j.pending().length,2);abort.abort();release();await dispatch;
});

test('more than a page of unhandled events does not starve newer alerts',async t=>{
 const j=fixture(t),abort=new AbortController();
 j.ingest({source:'world',after:null,cursor:'c_1000',events:Array.from({length:1000},(_,i)=>({id:'c_'+(i+1)}))});
 j.ingest({source:'world',after:'c_1000',cursor:'c_1001',events:[{id:'c_1001',kind:'conversation.invite'}]});
 const batches=[];
 await runWakeDispatcher({journal:j,signal:abort.signal,sleep:async()=>{},notify:async({pending})=>{batches.push(pending.length);if(pending.some(e=>e.event.id==='c_1001'))abort.abort();}});
 assert.deepEqual(batches,[1000,1]);assert.equal(j.pending(1000,1000)[0].event.id,'c_1001');
});

test('durable intake telemetry follows commit and never reports refused intake',async t=>{
 const j=fixture(t),proof=[];
 await receivePage(j,'world',async()=>page,{onCommitted:e=>{assert.equal(j.cursor('world'),page.cursor);assert.equal(j.pending()[0].event.id,page.events[0].id);proof.push(e);}});
 assert.equal(proof[0].state,'events-persisted');assert.equal(proof[0].events[0].id,page.events[0].id);assert.ok(Number.isFinite(proof[0].committedAt));
 await assert.rejects(receivePage(j,'world',async()=>({cursor:'bad',events:[{...page.events[0],kind:'different'}]}),{onCommitted:e=>proof.push(e)}));
 assert.equal(proof.length,1);
});

test('journal pressure exposes structured retry cause without advancing refused intake',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-receiver-pressure-'));
 const j=openJournal(dir,{worldId:'w',soulId:'s',retention:{worldPendingEvents:1}});
 t.after(()=>{j.close();rmSync(dir,{recursive:true,force:true});});
 j.ingest({source:'world',after:null,cursor:'quiet',events:[{id:'quiet',salience:1}]});
 const stop=new AbortController(),states=[];
 await runReceiver({journal:j,source:'world',signal:stop.signal,retryable:e=>e.transient===true,
  read:async({after})=>{assert.equal(after,'quiet');return {cursor:'urgent',events:[{id:'urgent',kind:'conversation.turn',salience:3}]};},
  onState:s=>states.push(s),sleep:async()=>stop.abort()});
 const retry=states.find(s=>s.state==='retrying');assert.equal(retry.code,'JOURNAL_BACKLOG_FULL');assert.equal(retry.source,'world');assert.equal(retry.backoffMs,1000);assert.ok(retry.delayMs>=0&&retry.delayMs<1000,'full jitter over the 1 s base');
 assert.equal(j.cursor('world'),'quiet');assert.deepEqual(j.pending().map(p=>p.event.id),['quiet']);
 assert.equal(states.some(s=>s.state==='events-persisted'),false);
});

test('receiver readiness follows actual initial page commit, retries startup adoption and never acknowledges work',async t=>{
 const j=fixture(t),stop=new AbortController(),states=[],initials=[];let calls=0;
 await runReceiver({journal:j,source:'owner',signal:stop.signal,retryable:e=>e.transient===true,sleep:async()=>{},
  read:async({after,initial})=>{initials.push(initial);if(++calls===1)throw Object.assign(Error('offline'),{transient:true});if(calls===2)return {cursor:'owner_1',events:[{id:'owner_1',kind:'owner.message',text:'Keep original task'}]};assert.equal(after,'owner_1');stop.abort();return {cursor:after,events:[]};},
  onState:s=>{if(s.state==='receiver-ready'){assert.equal(j.cursor('owner'),'owner_1');assert.equal(j.pending()[0].event.id,'owner_1');}states.push(s);}});
 assert.deepEqual(initials,[true,true,false]);const ready=states.filter(s=>s.state==='receiver-ready');assert.equal(ready.length,1);assert.equal(ready[0].successful,true);assert.equal(ready[0].mode,'page-committed');assert.equal(j.pending().length,1);
});

test('validated stream adoption can establish transport readiness while the event read stays pending',async t=>{
 const j=fixture(t),stop=new AbortController(),states=[];let entered,release;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const running=runReceiver({journal:j,source:'world',signal:stop.signal,read:async({onReady,after})=>{onReady({mode:'stream-adopted',successful:true});entered();await gate;return {cursor:after,events:[]};},onState:s=>states.push(s)});
 await waiting;assert.equal(states.filter(s=>s.state==='receiver-ready').length,1);assert.equal(states.find(s=>s.state==='receiver-ready').mode,'stream-adopted');assert.equal(j.cursor('world'),null);assert.equal(j.pending().length,0);
 stop.abort();release();await running;assert.equal(j.cursor('world'),null,'adoption never advances a cursor or manufactures a page');
});

test('pre-request state, aborted pages and refused ingestion never produce successful page readiness',async t=>{
 const j=fixture(t),stop=new AbortController(),states=[];
 await runReceiver({journal:j,source:'owner',signal:stop.signal,read:async()=>{assert.equal(states.some(s=>s.state==='receiver-ready'),false);stop.abort();return {cursor:'ignored',events:[]};},onState:s=>states.push(s)});
 assert.equal(states.some(s=>s.state==='receiver-ready'),false);assert.equal(j.cursor('owner'),null);
 const rejected=[];await assert.rejects(runReceiver({journal:j,source:'world',read:async()=>({cursor:null,gap:true,events:[]}),onState:s=>rejected.push(s)}),/Gap needs/);assert.equal(rejected.some(s=>s.state==='receiver-ready'),false);
});

// Soak r1 §B: an idle world closes its event stream about every 65 s. A stream
// the server admitted must not count as a failed connect, or a quiet Soul's
// receiver sits out a 30 s backoff in every ~95 s.
function clock(){let t=0;return {now:()=>t,advance:ms=>{t+=ms;}};}
const interrupted=()=>Object.assign(Error('Event stream interrupted'),{transient:true,streamClosed:true});
test('a quiet stream that keeps closing normally reconnects promptly instead of backing off',async t=>{
 const j=fixture(t),stop=new AbortController(),c=clock(),states=[],delays=[];let opens=0;
 await runReceiver({journal:j,source:'world',signal:stop.signal,retryable:e=>e.transient===true,now:c.now,random:()=>0.5,
  read:async({onReady})=>{opens++;onReady({mode:'stream-adopted',successful:true});c.advance(65000);throw interrupted();},
  onState:s=>states.push(s),sleep:async ms=>{delays.push(ms);c.advance(ms);if(delays.length===8)stop.abort();}});
 assert.equal(opens,8);assert.deepEqual(delays,Array(8).fill(500),'every normal close reconnects within the 1 s jitter, never 1→2→4→…→30 s');
 assert.equal(states.filter(s=>s.state==='reconnecting').length,8);assert.equal(states.some(s=>s.state==='retrying'),false);
 assert.equal(states.find(s=>s.state==='reconnecting').connectedMs,65000);assert.equal(j.cursor('world'),null,'reconnecting never advances a cursor');
});
test('consecutive failed connects back off with full jitter over a base doubling to the cap',async t=>{
 const j=fixture(t),stop=new AbortController(),states=[],delays=[];
 await runReceiver({journal:j,source:'world',signal:stop.signal,retryable:e=>e.transient===true,random:()=>0.5,
  read:async()=>{throw Object.assign(Error('Event stream unavailable'),{transient:true});},onState:s=>states.push(s),
  sleep:async ms=>{delays.push(ms);if(delays.length===7)stop.abort();}});
 assert.deepEqual(states.filter(s=>s.state==='retrying').map(s=>s.backoffMs),[1000,2000,4000,8000,16000,30000,30000]);
 assert.deepEqual(delays,[500,1000,2000,4000,8000,15000,15000],'delay = random(0, base)');
});
test('an admitted stream that dies at once is a failure, not a healthy rotation',async t=>{
 const j=fixture(t),stop=new AbortController(),c=clock(),states=[];let n=0;
 await runReceiver({journal:j,source:'world',signal:stop.signal,retryable:e=>e.transient===true,now:c.now,random:()=>0.5,
  read:async({onReady})=>{onReady({mode:'stream-adopted',successful:true});c.advance(200);throw Object.assign(Error('Event stream ended'),{transient:true,streamClosed:true});},
  onState:s=>states.push(s),sleep:async ms=>{c.advance(ms);if(++n===5)stop.abort();}});
 assert.deepEqual(states.filter(s=>s.state==='retrying').map(s=>s.backoffMs),[1000,2000,4000,8000,16000],'accept-then-close loops cannot storm the server');
 assert.equal(states.some(s=>s.state==='reconnecting'),false);
});
test('a coded error on a long-lived stream takes the retrying path, so journal pressure pulses at once',async t=>{
 const j=fixture(t),stop=new AbortController(),c=clock(),states=[];
 await runReceiver({journal:j,source:'world',signal:stop.signal,retryable:e=>e.transient===true,now:c.now,random:()=>0.5,
  read:async({onReady})=>{onReady({mode:'stream-adopted',successful:true});c.advance(65000);throw Object.assign(Error('Journal world backlog full'),{code:'JOURNAL_BACKLOG_FULL',transient:true});},
  onState:s=>states.push(s),sleep:async()=>stop.abort()});
 const retry=states.find(s=>s.state==='retrying');assert.ok(retry,'pressure must reach the supervisor as retrying');assert.equal(retry.code,'JOURNAL_BACKLOG_FULL');assert.equal(retry.backoffMs,1000);
 assert.equal(states.some(s=>s.state==='reconnecting'),false);
 const coded=[];const stop2=new AbortController();
 await runReceiver({journal:j,source:'world',signal:stop2.signal,retryable:e=>e.transient===true,now:c.now,random:()=>0.5,
  read:async({onReady})=>{onReady({mode:'stream-adopted',successful:true});c.advance(65000);throw Object.assign(Error('Event stream interrupted'),{transient:true,streamClosed:true,code:'transport.reset'});},
  onState:s=>coded.push(s),sleep:async()=>stop2.abort()});
 assert.equal(coded.some(s=>s.state==='reconnecting'),false,'a code on a closed stream is still a failure');
});
test('a healthy close after failures resets the backoff; the next failure starts again at 1 s',async t=>{
 const j=fixture(t),stop=new AbortController(),c=clock(),states=[],delays=[];let n=0;
 const fail=()=>Object.assign(Error('Event stream unavailable'),{transient:true});
 await runReceiver({journal:j,source:'world',signal:stop.signal,retryable:e=>e.transient===true,now:c.now,random:()=>0.5,
  read:async({onReady})=>{n++;if(n<=3)throw fail();if(n===4){onReady({mode:'stream-adopted',successful:true});c.advance(65000);throw interrupted();}throw fail();},
  onState:s=>states.push(s),sleep:async ms=>{delays.push(ms);c.advance(ms);if(delays.length===5)stop.abort();}});
 assert.deepEqual(states.filter(s=>s.state==='retrying'||s.state==='reconnecting').map(s=>s.state+':'+(s.backoffMs??s.delayMs)),['retrying:1000','retrying:2000','retrying:4000','reconnecting:500','retrying:1000']);
});
test('Retry-After is honoured as a floor with up to 20 % jitter, and never as a prompt reconnect',async t=>{
 const j=fixture(t),stop=new AbortController(),c=clock(),states=[],delays=[];let n=0;
 await runReceiver({journal:j,source:'world',signal:stop.signal,retryable:e=>e.transient===true,now:c.now,random:()=>0.5,
  read:async({onReady})=>{n++;if(n===1){onReady({mode:'stream-adopted',successful:true});c.advance(65000);throw interrupted();}
   throw Object.assign(Error('Event stream refused'),{code:'stream.refused',status:503,transient:true,retryAfterMs:5000});},
  onState:s=>states.push(s),sleep:async ms=>{delays.push(ms);c.advance(ms);if(delays.length===2)stop.abort();}});
 assert.deepEqual(delays,[500,5500],'stated wait (+10 % at random=0.5) beats the jittered 1 s backoff');
 const refused=states.find(s=>s.state==='retrying');assert.equal(refused.retryAfterMs,5000);assert.equal(refused.code,'stream.refused');
});
test('a huge Retry-After waits at most 60 s, jitter included',async t=>{
 const j=fixture(t),stop=new AbortController(),delays=[];
 for(const r of [0,0.5,0.999]){
  const s=new AbortController();
  await runReceiver({journal:j,source:'world',signal:s.signal,retryable:e=>e.transient===true,random:()=>r,
   read:async()=>{throw Object.assign(Error('World request refused'),{code:'soul.slow-down',status:429,transient:true,retryAfterMs:600000});},
   sleep:async ms=>{delays.push(ms);s.abort();}});
 }
 assert.deepEqual(delays,[60000,60000,60000]);
 const edge=[];const s2=new AbortController();
 await runReceiver({journal:j,source:'world',signal:s2.signal,retryable:e=>e.transient===true,random:()=>0.999,
  read:async()=>{throw Object.assign(Error('busy'),{code:'world.busy',status:503,transient:true,retryAfterMs:55000});},sleep:async ms=>{edge.push(ms);s2.abort();}});
 assert.deepEqual(edge,[60000],'55 s + 20 % jitter is capped after the jitter');void stop;
});
test('a committed page still resets the backoff on long-poll sources',async t=>{
 const j=fixture(t),stop=new AbortController(),states=[];let n=0;
 await runReceiver({journal:j,source:'owner',signal:stop.signal,retryable:e=>e.transient===true,random:()=>0.5,
  read:async({after})=>{n++;if(n===1||n===2||n===4)throw Object.assign(Error('offline'),{transient:true});if(n===5){stop.abort();}return {cursor:after??'o_0',events:[]};},
  onState:s=>states.push(s),sleep:async()=>{}});
 assert.deepEqual(states.filter(s=>s.state==='retrying').map(s=>s.backoffMs),[1000,2000,1000]);
});
test('real SSE reader: an event-free stream that the server closes every 40 ms keeps reconnecting without backoff',async t=>{
 const {createWorldClient}=await import('./world-client.mjs');
 const j=fixture(t),stop=new AbortController(),states=[];let opens=0;
 const world=createWorldClient({world:'http://127.0.0.1:1234/world',token:'synthetic-fixture-only',expectedSoulId:'s_quiet',fetchImpl:async url=>{
  opens++;let timer;const cursor=new URL(url).searchParams.get('cursor');const enc=new TextEncoder();
  return new Response(new ReadableStream({start(c){c.enqueue(enc.encode('event: hello\ndata: '+JSON.stringify({contract:'eden-edge/1',format:'envelope',soulId:'s_quiet',cursor,head:cursor})+'\n\n'));timer=setTimeout(()=>{try{c.close();}catch{}},40);},cancel(){clearTimeout(timer);}}),{headers:{'content-type':'text/event-stream'}});
 }});
 const running=runReceiver({journal:j,source:'world',read:args=>world.eventPage(args),signal:stop.signal,retryable:e=>e.transient===true,minHealthyMs:20,healthyReconnectMs:5,onState:s=>states.push(s)});
 await new Promise(r=>setTimeout(r,600));stop.abort();await running;
 const delays=states.filter(s=>s.state==='reconnecting'||s.state==='retrying');
 assert.ok(opens>=8,`expected prompt reconnects, saw ${opens} opens`);assert.equal(delays.some(s=>s.state==='retrying'),false);assert.ok(delays.every(s=>s.delayMs<5));
 assert.equal(states.filter(s=>s.state==='receiver-ready').length,1);assert.equal(j.cursor('world'),null);
});
