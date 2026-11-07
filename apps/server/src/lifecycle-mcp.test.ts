import { test,type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer,request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { fixture,invite } from '../test/native-owner-fixture.ts';
import { handleMcp } from './mcp.ts';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
async function local(t:TestContext,candidate=true){
  const f=fixture(':memory:',factory);if(candidate)f.souls.enableLifecycle();await invite(f,'alice');
  const input={name:'Alice',description:'local MCP fixture'};
  let soul;
  if(candidate){const op=f.souls.acceptLifecycleCreate('dev:alice',input);f.host.drainInputs();await delay(0);soul=f.db.soul(op.scope.soulId)!;}
  else{const created=f.souls.create('dev:alice',input);f.host.drainInputs();soul=await created;}
  const token=f.souls.pairExchange(f.souls.pairCode(soul,'http://127.0.0.1:4957',f.db.user('dev:alice')!).code,'local').token;
  // Each fixture closes its transport; keep pooled fetch sockets out of the next fixture.
  const server=createServer((req,res)=>{res.setHeader('Connection','close');void handleMcp(req,res,f.souls).catch(()=>{res.writeHead(500).end();});});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(4957,'127.0.0.1',resolve);});
  t.after(async()=>{await new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});f.db.close();});
  const call=async(name:string,args:unknown={})=>{
    const response=await fetch('http://127.0.0.1:4957/mcp',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
    assert.equal(response.status,200);const value=await response.json() as {result:{isError:boolean;content:{type:string;text:string}[]}};
    assert.ok(value.result);return {error:value.result.isError,cache:response.headers.get('cache-control'),data:JSON.parse(value.result.content[0].text) as {code?:string;ok?:boolean;intent?:{goal?:string};rule?:{id:string}}};
  };
  return {...f,soul,token,call};
}
async function drive<T>(f:Awaited<ReturnType<typeof local>>,promise:Promise<T>){
  let done=false;promise.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){f.host.drainInputs();await delay(2);}assert.ok(done);return promise;
}
function rotate(f:Awaited<ReturnType<typeof local>>){return f.souls.pairExchange(f.souls.pairCode(f.soul,'http://127.0.0.1:4957',f.db.user('dev:alice')!).code,'rotated local').token;}

test('actual stateless MCP current token accepts a native owner intent',async t=>{
  const f=await local(t);const result=await drive(f,f.call('soul_set_intent',{goal:'wander'}));assert.equal(result.error,false);assert.equal(result.cache,'no-store');assert.equal(result.data.ok,true);assert.equal(result.data.intent?.goal,'wander');assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent').length,1);assert.equal(f.db.paidCost(),0);
});

test('actual MCP current token reads all existing public/private tool views',async t=>{
  const f=await local(t);
  for(const name of ['world_query','soul_perceive','soul_mandate','soul_deck','soul_status','soul_log']){
    const result=await f.call(name);assert.equal(result.error,false,name);assert.ok(result.data);
  }
});

test('actual MCP slow body read rechecks a rotated credential before any tool lookup or private result',async t=>{
  const f=await local(t),authenticate=f.souls.soulFromToken.bind(f.souls);let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  t.mock.method(f.souls,'soulFromToken',(...args:Parameters<typeof f.souls.soulFromToken>)=>{const current=authenticate(...args);entered();return current;});
  const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'soul_perceive',arguments:{}}});
  let socket!:ReturnType<typeof httpRequest>;
  const response=new Promise<{status:number;cache:string|undefined;body:unknown}>((resolve,reject)=>{
    socket=httpRequest({hostname:'127.0.0.1',port:4957,path:'/mcp',method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json',accept:'application/json, text/event-stream','content-length':Buffer.byteLength(body)}},incoming=>{
      const chunks:Buffer[]=[];incoming.on('data',chunk=>chunks.push(chunk));incoming.on('end',()=>resolve({status:incoming.statusCode!,cache:incoming.headers['cache-control'],body:JSON.parse(Buffer.concat(chunks).toString())}));incoming.on('error',reject);
    });socket.on('error',reject);
  });
  socket.write(body.slice(0,1));await started;rotate(f);socket.end(body.slice(1));
  const denied=await response;assert.equal(denied.status,401);assert.equal(denied.cache,'no-store');assert.equal((denied.body as {error:{code:number}}).error.code,-32001);assert.equal('result' in (denied.body as object),false);
});

test('actual MCP queued intent cannot apply after accepted retirement',async t=>{
  const f=await local(t),enqueue=f.host.enqueueChecked.bind(f.host);let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  t.mock.method(f.host,'enqueueChecked',(...args:Parameters<typeof f.host.enqueueChecked>)=>{const result=enqueue(...args);if(args[0]==='intent')entered();return result;});
  const pending=f.call('soul_set_intent',{goal:'wander'});await started;f.souls.acceptLifecycleRetire('dev:alice',f.soul);f.host.drainInputs();
  const result=await pending;assert.equal(result.error,true);assert.equal(result.data.code,'unauthorized');assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent').length,0);
});

test('actual MCP queued card mint retains captured credential authority under the host writer lock',async t=>{
  const f=await local(t),enqueue=f.host.enqueueChecked.bind(f.host);let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  t.mock.method(f.host,'enqueueChecked',(...args:Parameters<typeof f.host.enqueueChecked>)=>{
    const [kind,author,payload,guard,journal]=args;
    const result=enqueue(kind,author,payload,()=>{assert.equal(f.db.db.isTransaction,true);return guard();},journal);if(kind==='mint')entered();return result;
  });
  const {hash,by,mintedAt,origin,...card}=structuredClone(f.host.kernel.vocab.cards.wander);
  const pending=f.call('soul_propose_cards',{cards:[{...card,name:'drift locally'}]});await started;rotate(f);f.host.drainInputs();
  const result=await pending;assert.equal(result.error,true);assert.equal(result.data.code,'unauthorized');assert.equal(f.host.kernel.vocab.cards['drift locally'],undefined);
});

test('actual MCP final private perception delivery denies a rotated credential',async t=>{
  const f=await local(t),perceive=f.souls.perceive.bind(f.souls);let entered!:()=>void,finish!:()=>void;
  const started=new Promise<void>(resolve=>entered=resolve),held=new Promise<void>(resolve=>finish=resolve);
  t.mock.method(f.souls,'perceive',async(...args:Parameters<typeof f.souls.perceive>)=>{const result=perceive(...args);entered();await held;return result;});
  const pending=f.call('soul_perceive');await started;rotate(f);finish();const result=await pending;
  assert.equal(result.error,true);assert.equal(result.data.code,'unauthorized');assert.equal('soul' in result.data,false);
});

test('actual MCP final success delivery cannot restore a rotated credential but preserves prior accepted intent',async t=>{
  const f=await local(t),setIntent=f.souls.setIntent.bind(f.souls);let entered!:()=>void,finish!:()=>void;
  const started=new Promise<void>(resolve=>entered=resolve),held=new Promise<void>(resolve=>finish=resolve);
  t.mock.method(f.souls,'setIntent',async(...args:Parameters<typeof f.souls.setIntent>)=>{const result=await setIntent(...args);entered();await held;return result;});
  const enqueue=f.host.enqueueChecked.bind(f.host);let queued!:()=>void;const enqueued=new Promise<void>(resolve=>queued=resolve);
  t.mock.method(f.host,'enqueueChecked',(...args:Parameters<typeof f.host.enqueueChecked>)=>{const result=enqueue(...args);if(args[0]==='intent')queued();return result;});
  const pending=f.call('soul_set_intent',{goal:'wander'});await enqueued;f.host.drainInputs();await started;
  assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent').length,1);rotate(f);finish();const result=await pending;
  assert.equal(result.error,true);assert.equal(result.data.code,'unauthorized');assert.equal(result.data.intent,undefined);assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent').length,1);
});

test('actual MCP current token mints a card and adds/removes an owner rule',async t=>{
  const f=await local(t),{hash,by,mintedAt,origin,...card}=structuredClone(f.host.kernel.vocab.cards.wander);
  const minted=await drive(f,f.call('soul_propose_cards',{cards:[{...card,name:'drift locally'}]}));assert.equal(minted.error,false);assert.equal(minted.data.ok,true);assert.ok(f.host.kernel.vocab.cards['drift locally']);
  const added=await drive(f,f.call('soul_steer',{words:'rest'}));assert.equal(added.error,false);assert.equal(added.data.ok,true);assert.ok(added.data.rule);
  const removed=await drive(f,f.call('soul_remove_rule',{id:added.data.rule.id}));assert.equal(removed.error,false);assert.equal(removed.data.ok,true);assert.deepEqual(f.souls.rules(f.soul),[]);
});

test('actual default MCP without lifecycle installer keeps normal legacy tool results',async t=>{
  const f=await local(t,false);assert.equal(f.souls.lifecycle,undefined);
  const result=await drive(f,f.call('soul_set_intent',{goal:'wander'}));assert.equal(result.error,false);assert.equal(result.cache,null);assert.equal(result.data.ok,true);assert.equal(result.data.intent?.goal,'wander');
  assert.equal((await f.call('soul_status')).error,false);assert.equal(f.db.paidCost(),0);
});

test('actual MCP late local compiler result cannot create intent after rotation',async t=>{
  const f=await local(t);let entered!:()=>void,finish!:(value:Awaited<ReturnType<typeof f.brain.compile>>)=>void;
  const started=new Promise<void>(resolve=>entered=resolve),held=new Promise<Awaited<ReturnType<typeof f.brain.compile>>>(resolve=>finish=resolve);
  t.mock.method(f.brain,'compile',async(...args:Parameters<typeof f.brain.compile>)=>{assert.equal(typeof args[3],'function');assert.equal(typeof args[4],'function');entered();return held;});
  const pending=f.call('soul_command',{text:'wander'});await started;rotate(f);finish({ok:true,agenda:[{card:'wander',target:null}],minted:[]});
  const result=await pending;assert.equal(result.error,true);assert.equal(result.data.code,'unauthorized');assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent').length,0);assert.equal(f.db.paidCost(),0);
});

test('actual MCP long-poll final delivery denies retired private status',async t=>{
  const f=await local(t),wait=f.souls.wait.bind(f.souls);let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  t.mock.method(f.souls,'wait',(...args:Parameters<typeof f.souls.wait>)=>{const result=wait(...args);entered();return result;});
  const pending=f.call('soul_wait',{seconds:1});await started;f.souls.acceptLifecycleRetire('dev:alice',f.soul);f.host.drainInputs();const result=await pending;
  assert.equal(result.error,true);assert.equal(result.data.code,'unauthorized');assert.equal('status' in result.data,false);
});

test('actual stateless MCP queued intent cannot use a rotated captured token',async t=>{
  const f=await local(t),queued=f.host.enqueueChecked.bind(f.host);let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  t.mock.method(f.host,'enqueueChecked',(...args:Parameters<typeof f.host.enqueueChecked>)=>{const result=queued(...args);if(args[0]==='intent')entered();return result;});
  const pending=f.call('soul_set_intent',{goal:'wander'});await started;
  f.souls.pairExchange(f.souls.pairCode(f.soul,'http://127.0.0.1:4957',f.db.user('dev:alice')!).code,'rotated local');f.host.drainInputs();
  const response=await pending;assert.equal(response.error,true);assert.equal(response.data.code,'unauthorized');assert.equal(f.db.events(f.host.worldId).filter(e=>e.kind==='intent').length,0);
});
