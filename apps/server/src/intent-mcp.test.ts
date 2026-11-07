// Real stateless MCP SDK client/server/TCP, paired local credential, native
// engine and SQLite. Shared HTTP fixture has synthetic compiler + fake Jev.
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {setImmediate,setTimeout as delay} from 'node:timers/promises';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {INTENT_V2,intentReceiptV2Schema,type IntentReceiptV2} from '@souls/protocol';
import {intentNativeFixture,seed,worldId} from '../test/intent-native-fixture.ts';
import {hashToken} from './auth.ts';
import {handleMcp} from './mcp.ts';
import {replayFromGenesis} from './world.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();

const input=(requestId:string,words='go to the campfire')=>({contract:INTENT_V2,requestId,op:'upsert',words});
function result(raw:unknown) {
  const value=raw as {content:{type:string;text?:string}[];isError?:boolean};
  const content=value.content.find(c=>c.type==='text');assert.ok(content?.text);
  return {error:value.isError===true,data:JSON.parse(content.text) as IntentReceiptV2|{ok:false;code:string;message:string}};
}
async function local(t:TestContext,path=':memory:',enabled=true,existingToken?:string) {
  const f=intentNativeFixture(t,path,enabled),url=`http://127.0.0.1:${TEST_PORT}/mcp`;
  const credential=existingToken??f.souls.pairExchange(f.souls.pairCode(f.db.soul('s_A')!,url,f.db.user('dev:alice')!).code,'local MCP fixture').token;
  const server=createServer((req,res)=>{res.setHeader('Connection','close');void handleMcp(req,res,f.souls,enabled?f.service:undefined).catch(()=>{if(!res.headersSent)res.writeHead(503);res.end();});});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(TEST_PORT,'127.0.0.1',resolve);});
  const client=new Client({name:'local-owner-agent-fixture',version:'1'});
  const transport=new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{authorization:'Bearer '+credential}}});
  let closed=false;
  const close=async()=>{if(closed)return;closed=true;await client.close();await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});};
  t.after(close);await client.connect(transport);
  const call=(name:string,args:Record<string,unknown>)=>client.callTool({name,arguments:args}).then(result);
  const raw=async(method:string,params:unknown,token=credential)=>{
    const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id:99,method,params})});
    return {status:response.status,cache:response.headers.get('cache-control'),text:await response.text()};
  };
  // Preserve the fixture's live call getter / held-compiler setter. Spreading
  // it would silently copy zero calls and disconnect the compiler hold.
  return Object.assign(f,{client,credential,server,close,call,raw});
}
type Local=Awaited<ReturnType<typeof local>>;
async function drive<T>(f:Local,promise:Promise<T>) {
  let done=false;promise.then(()=>done=true,()=>done=true);
  for(let i=0;i<150&&!done;i++){f.host.drainInputs();await delay(2);}
  assert.ok(done,'actual MCP/host request settled');return promise;
}
async function settled(f:Local) {await drive(f,f.service.settled());}
function accepted(value:ReturnType<typeof result>,phase?:string) {
  assert.equal(value.error,false);const receipt=intentReceiptV2Schema.parse(value.data);if(phase)assert.equal(receipt.phase,phase);return receipt;
}
function rotate(f:Local) {return f.souls.pairExchange(f.souls.pairCode(f.db.soul('s_A')!,`http://127.0.0.1:${TEST_PORT}/mcp`,f.db.user('dev:alice')!).code,'rotated local MCP fixture').token;}

test('real SDK discovery exposes exact named write/read tools only when injected and scoped',async t=>{
  const f=await local(t),tools=await f.client.listTools();
  const submit=tools.tools.find(t=>t.name==='soul_intent_v2')!,lookup=tools.tools.find(t=>t.name==='soul_intent_request_v2')!;
  assert.ok(submit);assert.ok(lookup);assert.equal(submit.annotations?.readOnlyHint,false);assert.equal(submit.annotations?.idempotentHint,true);
  assert.equal(lookup.annotations?.readOnlyHint,true);assert.equal(submit.inputSchema.type,'object');
  assert.deepEqual(Object.keys(submit.inputSchema.properties!).sort(),['contract','edit','importance','op','requestId','strict','words']);
  assert.equal(submit.inputSchema.additionalProperties,false);assert.equal(lookup.inputSchema.additionalProperties,false);
  const publicCatalog=JSON.stringify(tools);assert.ok(!publicCatalog.includes(f.credential));assert.ok(!publicCatalog.includes(hashToken(f.credential)));
  const wire=await f.raw('tools/list',{});assert.equal(wire.cache,'no-store');
  await f.close();const off=await local(t,':memory:',false);const defaultTools=await off.client.listTools();
  assert.ok(!defaultTools.tools.some(t=>t.name==='soul_intent_v2'||t.name==='soul_intent_request_v2'));
  const unchanged=await off.raw('tools/list',{});assert.equal(unchanged.cache,null);
  assert.equal(off.db.paidCost(),0);
});

test('actual paired SDK owner-agent ordinary direction wakes native sleep and preserves older purpose/replay',async t=>{
  const f=await local(t);
  accepted(await drive(f,f.call('soul_intent_v2',input('standing','PRIVATE_MCP_WORDS make friends if you feel like it'))));await settled(f);
  f.mind.nextEvalTick=1e9;
  await drive(f,f.host.enqueue('decision','fixture',{soulId:'s_A',entityId:'h_A',option:'sleep',label:'sleep on mat',
    steps:[{verb:'mars:sleep',params:{mat:'mat-1',duration:600}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
  for(let i=0;i<1800&&f.host.engine.world.entities.h_A.human!.activity!=='sleep';i++){f.host.tickOnce();if(i%10===0)await setImmediate();}
  assert.equal(f.host.engine.world.entities.h_A.human!.activity,'sleep');
  let release!:()=>void;f.hold=new Promise<void>(r=>release=r);
  const received=accepted(await drive(f,f.call('soul_intent_v2',input('ordinary'))),'received');
  assert.equal(f.host.engine.world.entities.h_A.human!.activity,'sleep');release();await settled(f);
  const understood=accepted(await f.call('soul_intent_request_v2',{requestId:'ordinary'}),'understood');
  assert.equal(understood.phase,'understood');if(understood.phase!=='understood')return;
  assert.equal(understood.revision.source.channel,'mcp');assert.equal(understood.revision.source.kind,'owner-agent');
  assert.equal(understood.revision.source.principalId,f.db.soul('s_A')!.token_generation);
  const activity=()=>f.host.engine.world.entities.h_A.human!.activity;
  for(let i=0;i<100&&activity()!=='walk';i++){f.host.tickOnce();if(i%10===0)await setImmediate();}
  const walking=f.host.engine.world.tick;assert.equal(f.host.engine.world.entities.h_A.human!.activity,'walk');assert.ok(walking-understood.revision.submitted.tick<=100);
  for(let i=0;i<1800&&f.host.kernel.things.s_A.at!=='campfire';i++){f.host.tickOnce();if(i%10===0)await setImmediate();}
  assert.equal(f.host.kernel.things.s_A.at,'campfire');assert.equal(Object.keys(f.host.intentHistoryOf('s_A').intents).length,2);
  assert.equal(replayFromGenesis(f.host.factory,seed,f.db.events(worldId),f.host.engine.world.tick).engine.stateHash(),f.host.engine.stateHash());
  assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.calls,2);assert.equal(f.db.paidCost(),0);
  t.diagnostic(`received=${received.phase==='received'?received.tick:-1}; publication=${understood.revision.submitted.tick}; walking=${walking}; arrival=${f.host.engine.world.tick}; paid=$0`);
});

test('REST/MCP aliases share one durable generation namespace, original audit and compiler lease',async t=>{
  const f=await local(t);let release!:()=>void;f.hold=new Promise<void>(r=>release=r);
  accepted(await drive(f,f.call('soul_intent_v2',input('shared'))),'received');
  const response=await drive(f,f.post({...input('shared'),strict:false,importance:.5},f.credential,true));assert.equal(response.status,202);
  assert.equal(f.calls,1);assert.equal(f.db.events(worldId).filter(e=>e.kind==='intent-request-v2').length,1);
  const conflict=await f.call('soul_intent_v2',input('shared','different words'));assert.equal(conflict.error,true);assert.equal('code' in conflict.data&&conflict.data.code,'conflict');
  release();await settled(f);const terminal=accepted(await f.call('soul_intent_request_v2',{requestId:'shared'}),'understood');
  const http=await f.lookup('shared',f.credential,true);assert.deepEqual(intentReceiptV2Schema.parse(await http.json()),terminal);
  accepted(await drive(f,f.call('soul_intent_v2',input('shared'))),'understood');assert.equal(f.calls,1);
  if(terminal.phase==='understood')assert.equal(terminal.revision.source.channel,'mcp');
  // Reverse direction also retains the original api source, not the retry channel.
  f.hold=undefined;await drive(f,f.post(input('api-first'),f.credential,true));await settled(f);
  const retried=accepted(await drive(f,f.call('soul_intent_v2',input('api-first'))),'understood');
  if(retried.phase==='understood')assert.equal(retried.revision.source.channel,'api');assert.equal(f.calls,2);
});

test('withdrawal retains exact grammar and needs no compiler; invalid private argument keys never enter SDK diagnostics',async t=>{
  const f=await local(t);accepted(await drive(f,f.call('soul_intent_v2',input('initial'))));await settled(f);
  const terminal=accepted(await f.call('soul_intent_request_v2',{requestId:'initial'}),'understood');if(terminal.phase!=='understood')return;
  const edit={intentId:terminal.revision.intentId,expectedVersion:1};
  for(const malformed of [{...input('forged'),source:{principalId:'forged'}},{contract:INTENT_V2,requestId:'missing-words',op:'upsert'},
    {contract:INTENT_V2,requestId:'missing-edit',op:'withdraw'},{contract:INTENT_V2,requestId:'extra-withdraw',op:'withdraw',edit,strict:false},
    {...input('credential-key'),[f.credential]:'PRIVATE_ARG'}]) {
    const wire=await f.raw('tools/call',{name:'soul_intent_v2',arguments:malformed});assert.equal(wire.status,200);assert.equal(wire.cache,'no-store');
    const error=result(JSON.parse(wire.text).result);assert.equal(error.error,true);assert.equal('code' in error.data&&error.data.code,'invalid');
    assert.ok(!wire.text.includes(f.credential));assert.ok(!wire.text.includes('PRIVATE_ARG'));
  }
  const withdrawn=accepted(await drive(f,f.call('soul_intent_v2',{contract:INTENT_V2,requestId:'withdraw',op:'withdraw',edit})));
  await settled(f);accepted(await f.call('soul_intent_request_v2',{requestId:'withdraw'}),'withdrawn');assert.ok(withdrawn);
  assert.equal(f.calls,1);assert.equal(f.host.intentHistoryOf('s_A').intents[edit.intentId].status,'withdrawn');
});

test('MCP receipt survives actual DB reopen; old token and new generation cannot retrieve it after rotation',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'core-mcp-intent-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'local.db');
  const f=await local(t,path);accepted(await drive(f,f.call('soul_intent_v2',input('durable'))));await settled(f);
  const terminal=accepted(await f.call('soul_intent_request_v2',{requestId:'durable'}),'understood'),generation=f.db.soul('s_A')!.token_generation;
  f.host.saveSnapshot(true);await f.close();f.db.close();
  const reopened=await local(t,path,true,f.credential);assert.equal(reopened.db.soul('s_A')!.token_generation,generation);
  assert.deepEqual(accepted(await reopened.call('soul_intent_request_v2',{requestId:'durable'})),terminal);
  accepted(await drive(reopened,reopened.call('soul_intent_v2',input('durable'))));assert.equal(reopened.calls,0);
  const rotated=rotate(reopened);const denied=await reopened.raw('tools/call',{name:'soul_intent_request_v2',arguments:{requestId:'durable'}});
  assert.equal(denied.status,401);assert.equal(denied.cache,'no-store');assert.ok(!denied.text.includes('revision'));
  const hidden=await reopened.raw('tools/call',{name:'soul_intent_request_v2',arguments:{requestId:'durable'}},rotated);
  assert.equal(result(JSON.parse(hidden.text).result).error,true);assert.equal(JSON.parse(JSON.parse(hidden.text).result.content[0].text).code,'not-found');
  const fresh=await drive(reopened,reopened.raw('tools/call',{name:'soul_intent_v2',arguments:input('durable')},rotated));assert.equal(fresh.status,200);await settled(reopened);assert.equal(reopened.calls,1);
});

test('actual MCP slow body cannot use a rotated generation before tool registration or private lookup',async t=>{
  const f=await local(t);let entered!:()=>void;const started=new Promise<void>(r=>entered=r),authenticate=f.souls.soulFromToken.bind(f.souls);
  t.mock.method(f.souls,'soulFromToken',(...args:Parameters<typeof authenticate>)=>{const value=authenticate(...args);entered();return value;});
  const body=JSON.stringify({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'soul_intent_v2',arguments:input('slow')}});
  let socket!:ReturnType<typeof httpRequest>;
  const pending=new Promise<{status:number;cache:string|undefined;text:string}>((resolve,reject)=>{
    socket=httpRequest({hostname:'127.0.0.1',port:TEST_PORT,path:'/mcp',method:'POST',headers:{authorization:'Bearer '+f.credential,'content-type':'application/json',accept:'application/json, text/event-stream','content-length':Buffer.byteLength(body)}},incoming=>{
      const chunks:Buffer[]=[];incoming.on('data',c=>chunks.push(c));incoming.on('end',()=>resolve({status:incoming.statusCode!,cache:incoming.headers['cache-control'],text:Buffer.concat(chunks).toString()}));incoming.on('error',reject);
    });socket.on('error',reject);
  });
  socket.write(body.slice(0,1));await started;rotate(f);socket.end(body.slice(1));const refused=await pending;
  assert.equal(refused.status,401);assert.equal(refused.cache,'no-store');assert.equal(f.calls,0);assert.equal(f.db.events(worldId).filter(e=>e.kind==='intent-request-v2').length,0);
});

for(const changed of ['rotation','invite','retirement'] as const)test(`actual SDK delayed compiler rechecks ${changed} after its received receipt`,async t=>{
  const f=await local(t);let release!:()=>void;f.hold=new Promise<void>(r=>release=r);
  accepted(await drive(f,f.call('soul_intent_v2',input('late'))),'received');const before=f.db.events(worldId).length;
  if(changed==='rotation')rotate(f);
  if(changed==='invite')f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();
  if(changed==='retirement')f.db.retireSoul('s_A');
  release();await settled(f);assert.equal(f.db.events(worldId).length,before);assert.equal(Object.keys(f.host.intentHistoryOf('s_A').intents).length,0);
  const wire=await f.raw('tools/call',{name:'soul_intent_request_v2',arguments:{requestId:'late'}});assert.equal(wire.status,401);assert.ok(!wire.text.includes('revision'));
  assert.equal(f.db.paidCost(),0);
});

test('final SDK delivery denies rotation after earlier valid canonical receipt without erasing the fact',async t=>{
  const f=await local(t);let entered!:()=>void,release!:()=>void,releaseCompiler!:()=>void;
  const started=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);f.hold=new Promise<void>(r=>releaseCompiler=r);
  const submit=f.service.submit.bind(f.service);
  t.mock.method(f.service,'submit',async(...args:Parameters<typeof submit>)=>{const value=await submit(...args);entered();await held;return value;});
  const pending=f.call('soul_intent_v2',input('final'));await drive(f,started);
  assert.equal(f.db.events(worldId).filter(e=>e.kind==='intent-request-v2').length,1);rotate(f);release();const response=await pending;
  assert.equal(response.error,true);assert.equal('code' in response.data&&response.data.code,'unauthorized');assert.equal('revision' in response.data,false);
  releaseCompiler();await settled(f);assert.equal(f.db.events(worldId).filter(e=>e.kind==='intent-request-v2').length,1);
});

test('candidate registration current authority also protects existing private tools with lifecycle installer absent',async t=>{
  const f=await local(t);assert.equal(f.souls.lifecycle,undefined);
  let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r),perceive=f.souls.perceive.bind(f.souls);
  t.mock.method(f.souls,'perceive',async(...args:Parameters<typeof perceive>)=>{const value=perceive(...args);entered();await held;return value;});
  const pending=f.client.callTool({name:'soul_perceive',arguments:{}}).then(result);await started;rotate(f);release();
  const denied=await pending;assert.equal(denied.error,true);assert.equal('soul' in denied.data,false);assert.equal('code' in denied.data&&denied.data.code,'unauthorized');
});

test('malformed JSON tool name is rejected by the real transport without coercion or private diagnostic echo',async t=>{
  const f=await local(t),before=f.db.events(worldId).length;
  const malformed=await f.raw('tools/call',{name:{toString:0,valueOf:0},arguments:{}});
  assert.equal(malformed.cache,'no-store');assert.equal(malformed.status,200);
  const rpc=JSON.parse(malformed.text);assert.equal(rpc.jsonrpc,'2.0');assert.equal(rpc.id,99);
  // SDK1.31's outer schema parser maps its Zod error to InternalError.
  // The envelope is safely rejected; this is not an escaped handler exception.
  assert.equal(rpc.error?.code,-32603);assert.equal(Object.hasOwn(rpc,'result'),false);
  assert.ok(!malformed.text.includes('TypeError'));assert.ok(!malformed.text.includes(f.credential));
  assert.ok(!malformed.text.includes(hashToken(f.credential)));
  assert.equal(f.calls,0);assert.equal(f.db.events(worldId).length,before);assert.equal(f.db.paidCost(),0);
  const valid=await f.raw('tools/list',{});assert.equal(valid.status,200);
  assert.ok(JSON.parse(valid.text).result.tools.some((tool:{name:string})=>tool.name==='soul_intent_v2'));
});
