// Real stateless SDK/TCP4958, local human-owned native fixture, synthetic compiler.
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {INTENT_V2,intentHistoryPageV1Schema} from '@souls/protocol';
import {intentNativeFixture} from '../test/intent-native-fixture.ts';
import {handleMcp} from './mcp.ts';

function decoded(raw:any){assert.ok(raw.content[0].text);return {error:raw.isError===true,data:JSON.parse(raw.content[0].text)};}
async function local(t:TestContext,historyV1=true){
  const f=intentNativeFixture(t,':memory:',true,historyV1),url='http://127.0.0.1:4958/mcp';
  const rotate=()=>f.souls.pairExchange(f.souls.pairCode(f.db.soul('s_A')!,url,f.db.user('dev:alice')!).code,'history SDK local fixture').token;
  const credential=rotate(),server=createServer((req,res)=>{res.setHeader('Connection','close');void handleMcp(req,res,f.souls,f.service).catch(()=>{if(!res.headersSent)res.writeHead(503);res.end();});});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(4958,'127.0.0.1',resolve);});
  const client=new Client({name:'private-history-local-fixture',version:'1'});
  let closed=false;const close=async()=>{if(closed)return;closed=true;await client.close();await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});};
  t.after(close);await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{authorization:'Bearer '+credential}}}));
  const call=(name:string,args:Record<string,unknown>={})=>client.callTool({name,arguments:args}).then(decoded);
  const raw=async(args:unknown,token=credential)=>{
    const r=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'soul_intent_history_v1',arguments:args}})});
    return {status:r.status,cache:r.headers.get('cache-control'),text:await r.text()};
  };
  return Object.assign(f,{client,credential,rotate,close,call,raw});
}
type F=Awaited<ReturnType<typeof local>>;
async function drive<T>(f:F,p:Promise<T>){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<150&&!done;i++){f.host.drainInputs();await delay(2);}assert.ok(done);return p;}
async function publish(f:F,id='initial'){
  const receipt=await drive(f,f.call('soul_intent_v2',{contract:INTENT_V2,requestId:id,op:'upsert',words:'PRIVATE_HISTORY_MCP make friends if you feel like it'}));assert.equal(receipt.error,false);
  await drive(f,f.service.settled());
}

test('actual SDK discovers opted-in strict history tool and returns accepted facts with private capability/no-store',async t=>{
  const f=await local(t),tools=await f.client.listTools(),tool=tools.tools.find(x=>x.name==='soul_intent_history_v1')!;
  assert.ok(tool);assert.equal(tool.annotations?.readOnlyHint,true);assert.equal(tool.inputSchema.additionalProperties,false);assert.deepEqual(Object.keys(tool.inputSchema.properties!),['cursor']);
  await publish(f);const before=f.host.seq,read=await f.call('soul_intent_history_v1');assert.equal(read.error,false);
  const p=intentHistoryPageV1Schema.parse(read.data);assert.equal(p.state,'page');if(p.state!=='page')return;
  assert.deepEqual(p.events.map(e=>e.op),['upsert']);assert.equal(p.complete,true);assert.ok(p.resumeCursor);
  const perception=await f.call('soul_perceive');assert.equal(perception.error,false);assert.equal(perception.data.intentHistory.contract,'private-intent-history/1');
  const http=await f.app.request('/v1/agent/intent-v2/history',{headers:{authorization:'Bearer '+f.credential}});assert.equal(http.status,200);
  const h=intentHistoryPageV1Schema.parse(await http.json());assert.equal(h.state,'page');if(h.state==='page')assert.deepEqual(h.events,p.events);
  const wire=await f.raw({cursor:p.resumeCursor});assert.equal(wire.status,200);assert.equal(wire.cache,'no-store');const resumed=intentHistoryPageV1Schema.parse(decoded(JSON.parse(wire.text).result).data);if(resumed.state==='page')assert.deepEqual(resumed.events,[]);
  assert.equal(f.host.seq,before);assert.equal(f.db.paidCost(),0);
  await f.close();const off=await local(t,false);assert.ok(!(await off.client.listTools()).tools.some(x=>x.name==='soul_intent_history_v1'));
  assert.equal((await off.call('soul_perceive')).data.intentHistory,undefined);assert.equal(off.db.db.prepare('SELECT COUNT(*) AS n FROM intent_history_cursors_v1').get()!.n,0);
});

test('actual MCP suppresses invalid credential-shaped diagnostics and refuses owner/generation/expired cursors',async t=>{
  const f=await local(t);await publish(f);const p=intentHistoryPageV1Schema.parse((await f.call('soul_intent_history_v1')).data);if(p.state!=='page')throw Error('unexpected gap');
  for(const args of [{[f.credential]:'PRIVATE_ARGUMENT'},{cursor:'PRIVATE_ARGUMENT'},{cursor:p.resumeCursor,worldId:'PRIVATE_OTHER_WORLD'}]){
    const wire=await f.raw(args);assert.equal(wire.status,200);assert.equal(wire.cache,'no-store');assert.equal(decoded(JSON.parse(wire.text).result).error,true);assert.ok(!wire.text.includes(f.credential));assert.ok(!wire.text.includes('PRIVATE_ARGUMENT'));assert.ok(!wire.text.includes('PRIVATE_OTHER_WORLD'));
  }
  const owner=await f.app.request('/v1/souls/s_A/intent-v2/history',{headers:{authorization:'Bearer dev:alice'}}),op=intentHistoryPageV1Schema.parse(await owner.json());if(op.state!=='page')throw Error('unexpected gap');
  assert.equal((await f.call('soul_intent_history_v1',{cursor:op.resumeCursor})).data.code,'cursor-unavailable');
  f.db.db.prepare('UPDATE intent_history_cursors_v1 SET expires_at=0 WHERE cursor=?').run(p.resumeCursor!);
  assert.equal((await f.call('soul_intent_history_v1',{cursor:p.resumeCursor})).data.code,'cursor-expired');
  const q=intentHistoryPageV1Schema.parse((await f.call('soul_intent_history_v1')).data);if(q.state!=='page')throw Error('unexpected gap');const next=f.rotate();
  const denied=await f.raw({cursor:q.resumeCursor});assert.equal(denied.status,401);assert.ok(!denied.text.includes('PRIVATE_HISTORY_MCP'));
  const foreign=await f.raw({cursor:q.resumeCursor},next);assert.equal(foreign.status,200);assert.equal(decoded(JSON.parse(foreign.text).result).data.code,'cursor-unavailable');assert.ok(!foreign.text.includes('PRIVATE_HISTORY_MCP'));
  assert.equal(f.db.paidCost(),0);
});

for(const change of ['invite','retirement'] as const)test(`actual MCP checks current ${change} before history decode`,async t=>{
  const f=await local(t);await publish(f);const p=intentHistoryPageV1Schema.parse((await f.call('soul_intent_history_v1')).data);if(p.state!=='page')throw Error('unexpected gap');
  f.db.db.prepare('UPDATE intent_history_cursors_v1 SET body=? WHERE cursor=?').run('{"PRIVATE_CORRUPT":true}',p.resumeCursor!);
  if(change==='invite')f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();else f.db.retireSoul('s_A');
  const denied=await f.raw({cursor:p.resumeCursor});assert.equal(denied.status,401);assert.equal(denied.cache,'no-store');assert.ok(!denied.text.includes('PRIVATE_CORRUPT'));assert.ok(!denied.text.includes('PRIVATE_HISTORY_MCP'));
});

test('actual SDK final delivery guard withholds history after credential rotation without deleting facts',async t=>{
  const f=await local(t);await publish(f);const before=f.host.seq,page=f.service.historyPage.bind(f.service);
  t.mock.method(f.service,'historyPage',(...args:Parameters<typeof page>)=>{const p=page(...args);f.rotate();return p;});
  const denied=await f.call('soul_intent_history_v1');assert.equal(denied.error,true);assert.equal('events' in denied.data,false);assert.ok(!JSON.stringify(denied).includes('PRIVATE_HISTORY_MCP'));assert.equal(f.host.seq,before);assert.equal(f.db.paidCost(),0);
});
