import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {privatePurposeContextV1Schema} from '@souls/protocol';
import {purposePerceiveFixture} from '../test/purpose-perceive-fixture.ts';
import {handleMcp} from './mcp.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();
test('actual SDK soul_perceive matches bounded REST/mind context and refuses a rotated generation without private payload',async t=>{
 const f=await purposePerceiveFixture(t),url=`http://127.0.0.1:${TEST_PORT}/mcp`,server=createServer((req,res)=>{res.setHeader('Connection','close');void handleMcp(req,res,f.souls,f.service).catch(()=>{if(!res.headersSent)res.writeHead(503);res.end();});});const client=new Client({name:'private-purpose-context-local',version:'1'});
 t.after(async()=>{await client.close();await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});});await new Promise<void>((r,reject)=>{server.once('error',reject);server.listen(TEST_PORT,'127.0.0.1',r);});await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{authorization:'Bearer '+f.credential}}}));
 const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='soul_perceive'&&t.annotations?.readOnlyHint));const before=f.host.seq,call=await client.callTool({name:'soul_perceive',arguments:{}});assert.notEqual(call.isError,true);const blocks=call.content;assert.ok(Array.isArray(blocks));const text=blocks[0];assert.equal(text.type,'text');assert.equal(typeof text.text,'string');const data=JSON.parse(text.text as string),dto=privatePurposeContextV1Schema.parse(data.private_purpose_context),ctx=f.brain.midContext(f.mind,'agent');assert.deepEqual(dto.purposes,ctx.purposes);assert.deepEqual(dto.recall,ctx.purposeRecall);const rest=await f.app.request('/v1/agent/perceive',{headers:{authorization:'Bearer '+f.credential}});assert.deepEqual((await rest.json() as any).private_purpose_context,dto);assert.equal(f.host.seq,before);assert.equal(f.db.paidCost(),0);
 f.souls.pairExchange(f.souls.pairCode(f.soul,url,f.db.user('dev:alice')!).code,'rotated synthetic perception generation');const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+f.credential,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'soul_perceive',arguments:{}}})});assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');const refused=await response.text();assert.ok(!refused.includes('PRIVATE_PERCEIVE_'));assert.ok(!refused.includes('private-purpose-context/1'));assert.ok(!refused.includes(f.credential));assert.equal((await f.app.request('/v1/agent/perceive',{headers:{authorization:'Bearer '+f.credential}})).status,404);
});
