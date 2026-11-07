import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEventReader} from './sse.mjs';
const stream=chunks=>new Response(new ReadableStream({start(c){for(const chunk of chunks)c.enqueue(new TextEncoder().encode(chunk));c.close();}}));
test('split frames, heartbeat and cursor-only delivery preserve event identity and connection',async()=>{
 let opens=0;const read=createEventReader({open:async()=>{opens++;return stream([': hello\r','\n\r\nevent: hello\ndata: {}\n\nevent: conversation.turn\nid: c_1\ndata: {"id":"c_1","text":"hé','llo"}\n\nevent: cursor\ndata: {"cursor":"c_2"}\n\n']);}});
 assert.deepEqual(await read({after:'c_0'}),{cursor:'c_1',events:[{id:'c_1',text:'héllo'}]});assert.deepEqual(await read({after:'c_1'}),{cursor:'c_2',events:[]});assert.equal(opens,1);
});
test('uncommitted cursor causes reconnect from old durable position',async()=>{
 const positions=[];const read=createEventReader({open:async after=>{positions.push(after);return stream(['id: c_1\nevent: speech.to-me\ndata: {"id":"c_1"}\n\n']);}});
 await read({after:'c_0'});await read({after:'c_0'});assert.deepEqual(positions,['c_0','c_0']);
});
test('gap is explicit and stream closure is retryable rather than data loss',async()=>{
 const read=createEventReader({open:async()=>stream(['event: gap\ndata: {"oldest":"c_50"}\n\n'])});assert.deepEqual(await read({after:'c_0'}),{cursor:'c_50',events:[],gap:true});await assert.rejects(read({after:'c_50'}),e=>e.transient===true);
});
test('aborting an idle stream does not wait for a heartbeat or a stalled cancel acknowledgement',async()=>{
 const stop=new AbortController();const read=createEventReader({open:async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){return new Promise(()=>{});}}))});
 const pending=read({after:'c_0',signal:stop.signal});await new Promise(r=>setImmediate(r));stop.abort();
 await Promise.race([assert.rejects(pending,/interrupted/),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('abort waited for transport')),100);timer.unref();})]);
});

test('validated hello reports adoption before any event without manufacturing a page or advancing a cursor',async()=>{
 let transport,ready,settled=false;const accepted=new Promise(r=>ready=r),stop=new AbortController();
 const read=createEventReader({open:async()=>new Response(new ReadableStream({start(c){transport=c;}})),validateHello:(hello,{after})=>{assert.deepEqual(hello,{cursor:'c_7'});assert.equal(after,'c_7');}});
 const pending=read({after:'c_7',signal:stop.signal,onReady:proof=>{assert.equal(proof.mode,'stream-adopted');assert.equal(proof.successful,true);ready();}}).finally(()=>{settled=true;});
 await new Promise(r=>setImmediate(r));assert.equal(settled,false);transport.enqueue(new TextEncoder().encode('event: hello\ndata: {"cursor":"c_7"}\n\n'));await accepted;assert.equal(settled,false);
 transport.enqueue(new TextEncoder().encode('id: c_8\nevent: speech\ndata: {"id":"c_8"}\n\n'));assert.deepEqual(await pending,{cursor:'c_8',events:[{id:'c_8'}]});stop.abort();
});

test('failed hello validation, missing hello and aborted adoption never report readiness',async()=>{
 let ready=0;const invalid=createEventReader({open:async()=>stream(['event: hello\ndata: {}\n\n']),validateHello:()=>{throw Error('wrong Soul');}});
 await assert.rejects(invalid({after:'c_0',onReady:()=>ready++}),/wrong Soul/);
 const missing=createEventReader({open:async()=>stream(['id: c_1\nevent: speech\ndata: {"id":"c_1"}\n\n']),validateHello:()=>{}});await assert.rejects(missing({after:'c_0',onReady:()=>ready++}),/preceded validated hello/);
 const stop=new AbortController();stop.abort();const aborted=createEventReader({open:async()=>stream(['event: hello\ndata: {}\n\n']),validateHello:()=>{}});await assert.rejects(aborted({after:'c_0',signal:stop.signal,onReady:()=>ready++}));assert.equal(ready,0);
});

const encode=text=>new TextEncoder().encode(text),hold=()=>new Promise(r=>setTimeout(r,10));
test('#466: a stream that stops sending reads as interrupted within 3 heartbeats of hello',async()=>{
 const read=createEventReader({idleMs:60000,open:async()=>new Response(new ReadableStream({start(c){c.enqueue(encode('event: hello\ndata: {"heartbeatSeconds":0.02}\n\n'));}}))});
 const started=performance.now();await assert.rejects(read({after:'c_0'}),e=>e.message==='Event stream interrupted'&&e.transient===true&&e.streamClosed===true);
 const took=performance.now()-started;assert.ok(took>=50&&took<1000,`${took} ms`);
});
test('#466: before any hello the default idle limit holds',async()=>{
 const read=createEventReader({idleMs:30,open:async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});}}))});
 await assert.rejects(read({after:'c_0'}),/interrupted/);
});
test('#466: keepalives hold the stream open for longer than the idle limit, on one connection',async()=>{
 let opens=0,transport;const read=createEventReader({idleMs:60,open:async()=>{opens++;return new Response(new ReadableStream({start(c){transport=c;}}));}});
 const pending=read({after:'c_0'});
 for(let i=0;i<20;i++){await hold();transport.enqueue(encode(': keepalive\n\n'));}
 transport.enqueue(encode('id: c_1\nevent: speech\ndata: {"id":"c_1"}\n\n'));
 assert.deepEqual(await pending,{cursor:'c_1',events:[{id:'c_1'}]});assert.equal(opens,1);
});
test('#466: a reconnect starts from the default limit, not the last hello\'s',async()=>{
 let opens=0;const read=createEventReader({idleMs:30,open:async()=>{opens++;return new Response(new ReadableStream({start(c){if(opens===1)c.enqueue(encode('event: hello\ndata: {"heartbeatSeconds":0.01}\n\n'));}}));}});
 await assert.rejects(read({after:'c_0'}),/interrupted/);const started=performance.now();await assert.rejects(read({after:'c_0'}),/interrupted/);
 assert.ok(performance.now()-started>=25,'the second connection had no hello');assert.equal(opens,2);
});
