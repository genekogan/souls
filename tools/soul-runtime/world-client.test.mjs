import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorldClient,isTransientRead} from './world-client.mjs';
const mock=(fn)=>createWorldClient({world:'http://127.0.0.1:1234/world',token:'synthetic-fixture-only',fetchImpl:fn});
test('conversation help and refused ignored text avoid silent acceptance-as-speech',async()=>{
 let requests=0;const client=mock(async()=>{requests++;return Response.json({accepted:true});});
 const help=await client.read('help',{command:'converse'});assert.match(help.operations.accept.description,/does not publish speech/);assert.match(help.operations.say.description,/Publish a turn/);
 assert.match(help.operations.ask.description,/not a spoken question/);assert.deepEqual((await client.read('help')).commands,['converse']);
 for(const op of ['accept','decline','ask','leave'])await assert.rejects(client.write('converse',{op,conversation:'cv_example',text:'My actual question'},'op-'+op),e=>e.code==='invalid'&&e.status===400&&!e.uncertain&&/Unexpected arguments/.test(e.message));
 assert.equal(requests,0,'neither local help nor rejected calls contact the world');
 await assert.rejects(client.read('help',{command:'unknown'}),e=>e.status===400);
});
test('conversation admission preserves target Soul and a real speech call publishes text',async()=>{
 const requests=[];const client=mock(async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body)});return Response.json({accepted:true});});
 await client.write('converse',{op:'accept',conversation:'cv_example',soul:'s_joiner'},'admit');
 await client.write('converse',{op:'say',conversation:'cv_example',text:'What did you observe?'},'say');
 await client.write('converse',{op:'start',with:['s_peer'],text:'Welcome'},'start');
 assert.deepEqual(requests.map(r=>r.body),[{op:'accept',conversation:'cv_example',soul:'s_joiner'},{op:'say',conversation:'cv_example',text:'What did you observe?'},{op:'start',with:['s_peer'],text:'Welcome'}]);
 assert.ok(requests.every(r=>r.url.endsWith('/v1/edge/converse')));
 for(const args of [{op:'say',conversation:'cv_example'},{op:'accept',conversation:'cv_example',with:'cv_example'},{op:'constructor'}])await assert.rejects(client.write('converse',args,'bad'),e=>e.status===400);
 assert.equal(requests.length,3);
});
test('native flat validation messages survive transport and invalid completion reports never POST',async()=>{
 let writes=0;const client=mock(async()=>{writes++;return Response.json({ok:false,code:'invalid',message:'result must be one line of 1–140 characters'},{status:400})});
 for(const args of [{id:'m',outcome:'completed',text:'Returned'},{id:'m',outcome:'done',text:'x'.repeat(141)}])await assert.rejects(client.write('result',args,'op-validation'),e=>e.status===400&&e.uncertain===false&&/result/.test(e.message));
 assert.equal(writes,0);
 await assert.rejects(client.write('result',{id:'m',outcome:'done',text:'Returned'},'op-native'),e=>e.message==='result must be one line of 1–140 characters'&&e.uncertain===false);
 assert.equal(writes,1,'native refusal is not retried');
});
test('raw world page returns conversation turns immediately without a body receipt filter',async()=>{
 const client=mock(async(url,opts)=>{assert.match(url,/after=c_7/);assert.equal(opts.redirect,'error');return Response.json({cursor:'c_8',events:[{id:'c_8',kind:'conversation.turn'}]})});
 const page=await client.worldPage({after:'c_7'});assert.equal(page.events[0].kind,'conversation.turn');assert.equal(page.cursor,'c_8');
});
test('owner delivery normalizes immutable content and does not acknowledge it',async()=>{
 const calls=[];const client=mock(async(url,opts)=>{calls.push({url,method:opts.method});return Response.json({backlog:[{id:'m1',text:'Come here',sentAt:12,state:'pending',internal:'omit'}]})});
 assert.deepEqual(await client.ownerPage({after:null}),{cursor:'m1',events:[{id:'m1',kind:'owner.message',text:'Come here',sentAt:12}]});assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');
});

test('owner startup adopts one actual nonblocking page then retains the existing long poll and cursor',async()=>{
 const calls=[];const client=mock(async(url,opts)=>{calls.push({url,method:opts.method});return Response.json({backlog:[{id:'owner_1',text:'Original task',state:'pending',sentAt:12}]});});
 assert.equal((await client.ownerPage({after:null,initial:true})).cursor,'owner_1');await client.ownerPage({after:'owner_1'});
 assert.equal(new URL(calls[0].url).searchParams.get('timeoutMs'),'0');assert.equal(new URL(calls[1].url).searchParams.get('timeoutMs'),'50000');assert.equal(new URL(calls[1].url).searchParams.get('after'),'owner_1');assert(calls.every(c=>c.method==='GET'));
 const malformed=mock(async()=>Response.json({}));await assert.rejects(malformed.ownerPage({after:null,initial:true}),e=>e.code==='owner.invalid');
});

test('world stream adoption requires a successful authenticated native hello matching expected Soul/cursor',async()=>{
 const hello={contract:'eden-edge/1',soulId:'s_expected',cursor:'c_7',head:'c_9',format:'envelope'};let send,accepted;const ready=new Promise(r=>accepted=r),stop=new AbortController();let readiness=0;
 const client=createWorldClient({world:'http://127.0.0.1:1234/world',token:'CREDENTIAL_CANARY',expectedSoulId:'s_expected',fetchImpl:async()=>new Response(new ReadableStream({start(c){send=c;}}),{headers:{'content-type':'text/event-stream'}})});
 const pending=client.eventPage({after:'c_7',signal:stop.signal,onReady:proof=>{readiness++;assert.equal(JSON.stringify(proof).includes('CREDENTIAL_CANARY'),false);accepted();}});
 await new Promise(r=>setImmediate(r));assert.equal(readiness,0);send.enqueue(new TextEncoder().encode('event: hello\ndata: '+JSON.stringify(hello)+'\n\n'));await ready;assert.equal(readiness,1);stop.abort();await assert.rejects(pending);
 for(const bad of [{...hello,soulId:'s_other'},{...hello,cursor:'c_6'},{...hello,contract:'wrong'},{}]){
  const denied=createWorldClient({world:'http://127.0.0.1:1234/world',token:'synthetic',expectedSoulId:'s_expected',fetchImpl:async()=>new Response('event: hello\ndata: '+JSON.stringify(bad)+'\n\n',{headers:{'content-type':'text/event-stream'}})});
  await assert.rejects(denied.eventPage({after:'c_7',onReady:()=>readiness++}),e=>e.code==='stream.identity');
 }
 const refused=mock(async()=>Response.json({error:{code:'forbidden'}},{status:403}));await assert.rejects(refused.eventPage({after:'c_7',onReady:()=>readiness++}),e=>e.code==='stream.refused');assert.equal(readiness,1);
});
test('write uses stable key and clientRef but never retries a dropped response',async()=>{
 let calls=0;const client=mock(async(url,opts)=>{calls++;assert.equal(opts.headers['idempotency-key'],'op-1');assert.equal(JSON.parse(opts.body).clientRef,'op-1');throw Error('lost response')});
 await assert.rejects(client.write('act',{capability:'sit:chair'},'op-1'),e=>e.uncertain&&!e.transient);assert.equal(calls,1);
});
test('read retries can be classified separately from terminal auth and supersession',async()=>{
 const unavailable=mock(async()=>{throw Error('offline')});await assert.rejects(unavailable.worldPage({after:null}),isTransientRead);
 for(const status of [401,403,409]){const denied=mock(async()=>Response.json({error:{code:'terminal'}},{status}));await assert.rejects(denied.ownerPage({after:null}),e=>e.status===status&&!e.transient);}
});
test('credential stays out of URLs and serialization; arbitrary methods and remote HTTP refused',async()=>{
 const client=mock(async()=>Response.json({}));assert.equal(JSON.stringify(client).includes('synthetic'),false);await assert.rejects(client.read('http://evil',{}),/Unsupported/);await assert.rejects(client.write('pair',{},'x'),/Unsupported/);
 assert.throws(()=>createWorldClient({world:'http://example.com',token:'fixture'}),/HTTPS/);assert.throws(()=>createWorldClient({world:'https://user:pass@example.com',token:'fixture'}),/credentials/);
});
test('lost inbox responses reconcile matching native effects with GET only and preserve actual outcomes',async()=>{
 for(const [command,args,message] of [
  ['ack',{id:'msg_1',reply:' Got it '},{id:'msg_1',state:'acknowledged',reply:'Got it',outcome:'failed',result:'Could not arrive',resultAt:14}],
  ['ack',{id:'msg_1'},{id:'msg_1',state:'acknowledged'}],
  ['result',{id:'msg_1',text:' Could not arrive ',outcome:'failed'},{id:'msg_1',state:'acknowledged',reply:'Got it',outcome:'failed',result:'Could not arrive',resultAt:14}],
 ]){
  const calls=[];const client=mock(async(url,opts)=>{calls.push({url,method:opts.method});if(opts.method==='POST')throw Error('response lost');return Response.json({message});});
  await assert.rejects(client.write(command,args,'op-1'),e=>e.uncertain);
  const known=await client.reconcile({command,args},'op-1');assert.equal(known.state,'recorded');assert.equal(known.evidence,'observed-native-state');assert.deepEqual(known.response.inbox.latest,message);assert.match(known.response.reconciliation.note,/does not prove/);
  assert.deepEqual(calls.map(c=>c.method),['POST','GET']);assert.match(calls[1].url,/\/inbox\/msg_1$/);
 }
});
test('native inbox absence, unacknowledged, mismatched or server-only result stays unknown',async()=>{
 const args={id:'msg_1',text:'Arrived',outcome:'done'};
 for(const message of [null,{id:'msg_other',state:'acknowledged',result:'Arrived',outcome:'done',resultAt:1},{id:'msg_1',state:'delivered'},{id:'msg_1',state:'acknowledged',result:'Arrived',outcome:'done',resultAt:1,resultBy:'server'},{id:'msg_1',state:'acknowledged',result:'Arrived',outcome:'failed',resultAt:1},{id:'msg_1',state:'acknowledged',result:'Other result',outcome:'done',resultAt:1}]){
  const client=mock(async()=>Response.json({message}));assert.equal((await client.reconcile({command:'result',args},'op-1')).state,'unknown');
 }
 const mismatch=mock(async()=>Response.json({message:{id:'msg_1',state:'acknowledged',reply:'Different reply'}}));assert.equal((await mismatch.reconcile({command:'ack',args:{id:'msg_1',reply:'Got it'}},'op-1')).state,'unknown');
 const absent=mock(async()=>Response.json({error:{code:'not-found'}},{status:404}));assert.equal((await absent.reconcile({command:'ack',args:{id:'msg_1'}},'op-1')).state,'unknown');
 const denied=mock(async()=>Response.json({error:{code:'unauthorized'}},{status:401}));await assert.rejects(denied.reconcile({command:'ack',args:{id:'msg_1'}},'op-1'),e=>e.status===401);
 const invalid=mock(async()=>Response.json({message:{id:'msg_1',state:'acknowledged',reply:'Got it'}}));assert.equal((await invalid.reconcile({command:'ack',args:{id:'msg_1',reply:{}}},'op-1')).state,'unknown');
});
test('reminder recovery matches canonical request and stable ref across later native states without POST replay',async()=>{
 const args={text:'  Remember   the appointment  ',at:{clock:'real',time:'2027-01-01T09:00:00-05:00'}};
 for(const state of ['active','due','delivered','cancelled']){
  const reminder={id:'rm_1',clientRef:'op-remind',text:'Remember the appointment',at:{clock:'real',time:'2027-01-01T14:00:00.000Z'},state};
  let writes=0;const client=mock(async(url,opts)=>{if(opts.method==='POST'){writes++;throw Error('lost');}assert.match(url,/\/reminders\/by-client-ref\/op-remind$/);return Response.json({reminder});});
  await assert.rejects(client.write('remind',args,'op-remind'),e=>e.uncertain);const known=await client.reconcile({command:'remind',args},'op-remind');assert.equal(known.evidence,'observed-native-state');assert.deepEqual(known.response.reminder,reminder);assert.equal(writes,1);
 }
 const worldArgs={text:'note',at:{clock:'world',worldDayIndex:4,time:'09:00'}},native={clientRef:'op-world',text:'note',at:worldArgs.at};
 const same=mock(async()=>Response.json({reminder:native}));assert.equal((await same.reconcile({command:'remind',args:worldArgs},'op-world')).state,'recorded');
 for(const reminder of [{...native,clientRef:'other'},{...native,text:'other'},{...native,at:{...native.at,worldDayIndex:5}}]){
  const client=mock(async()=>Response.json({reminder}));assert.equal((await client.reconcile({command:'remind',args:worldArgs},'op-world')).state,'unknown');
 }
 const absent=mock(async()=>Response.json({error:{code:'not-found'}},{status:404}));assert.equal((await absent.reconcile({command:'remind',args:worldArgs},'op-world')).state,'unknown');
 const rolledDate=mock(async()=>Response.json({reminder:{...native,at:{clock:'real',time:'2027-03-02T09:00:00.000Z'}}}));assert.equal((await rolledDate.reconcile({command:'remind',args:{text:'note',at:{clock:'real',time:'2027-02-30T09:00:00Z'}}},'op-world')).state,'unknown','invalid dates must not match a JS-normalized later day');
});


test('here physical view is explicit while default agent here keeps rich offers and transport semantics',async()=>{
 const calls=[],stop=new AbortController(),payload={here:{view:'body',tick:7,me:{pos:[1,2],activity:{kind:'read'},actualActivity:{kind:'walk'}}}};
 const client=mock(async(url,opts)=>{calls.push({url,opts});return Response.json(payload);});
 assert.deepEqual(await client.read('here',{view:'body'},stop.signal),payload);
 await client.read('here',{},stop.signal);
 assert.equal(new URL(calls[0].url).search,'?view=body');assert.equal(new URL(calls[1].url).search,'?include=doHere');
 assert(calls.every(c=>c.opts.method==='GET'&&c.opts.redirect==='error'&&c.opts.signal));
 await assert.rejects(client.read('here',{view:'unknown'}),e=>e.code==='invalid'&&e.status===400&&e.uncertain===false);assert.equal(calls.length,2);
 const refused=mock(async()=>Response.json({error:{code:'unauthorized'}},{status:401}));
 await assert.rejects(refused.read('here',{view:'body'}),e=>e.status===401&&!e.transient);
});

test('refusals carry the stated Retry-After for the receiver backoff floor',async()=>{
 const {retryAfterMs}=await import('./world-client.mjs');
 const busy=mock(async()=>Response.json({error:{code:'world.busy'},world:{load:'red',retry_after_s:3}},{status:503,headers:{'retry-after':'2'}}));
 await assert.rejects(busy.ownerPage({after:null}),e=>e.transient===true&&e.status===503&&e.retryAfterMs===2000);
 const bodyOnly=mock(async()=>Response.json({error:{code:'soul.slow-down'},world:{retry_after_s:4}},{status:429}));
 await assert.rejects(bodyOnly.ownerPage({after:null}),e=>e.retryAfterMs===4000);
 const stream=mock(async()=>new Response('{}',{status:429,headers:{'retry-after':'7','content-type':'application/json'}}));
 await assert.rejects(stream.eventPage({after:'c_1'}),e=>e.code==='stream.refused'&&e.transient===true&&e.retryAfterMs===7000);
 const plain=mock(async()=>Response.json({error:{code:'x'}},{status:500}));await assert.rejects(plain.ownerPage({after:null}),e=>e.retryAfterMs===null);
 assert.equal(retryAfterMs({get:()=>new Date(Date.now()+60000).toUTCString()})>50000,true);
});

test('#466: the stream connect limit ends at the headers; an open stream outlives it, and a slow connect does not',async()=>{
 const seen=[],open=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('event: hello\ndata: {"contract":"eden-edge/1","format":"envelope","soulId":"s1","cursor":"c_0","heartbeatSeconds":15}\n\n'));}});
 const client=createWorldClient({world:'https://example.test',token:'t',streamConnectMs:20,fetchImpl:async(url,o)=>{seen.push(o.signal);return new Response(open,{headers:{'content-type':'text/event-stream'}});}});
 const stop=new AbortController(),page=client.eventPage({after:'c_0',signal:stop.signal}).catch(e=>e);
 await new Promise(r=>setTimeout(r,60));assert.equal(seen[0].aborted,false,'open past the connect limit');stop.abort();await page;
 const slow=createWorldClient({world:'https://example.test',token:'t',streamConnectMs:20,fetchImpl:(url,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error('aborted'))))});
 await assert.rejects(slow.eventPage({after:'c_0'}),e=>e.code==='transport.unreachable'&&e.transient===true);
});

