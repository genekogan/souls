import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type {AddressInfo} from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { toyFactory } from '@souls/engine-toy';
import { agentReader } from './agent-reader.ts';
import { Auth } from './auth.ts';
import { Brain } from './brain.ts';
import { config, type Config } from './config.ts';
import { Db } from './db.ts';
import { buildApp } from './http.ts';
import type { Hub } from './hub.ts';
import { Souls } from './souls.ts';
import { WorldHost } from './world.ts';
import { stripWorldRequestPath } from './world-request-path.ts';

const pin=JSON.parse(readFileSync(new URL('../test/fixtures/agent-reader-g207.json',import.meta.url),'utf8')) as {
  sourceCommit:string;readerSourceSha256:string;examples:{key:Config['worldKey'];base:string;text:string}[]};

test('TypeScript reader producer matches independent reviewed App output byte for byte in all four worlds',()=>{
  assert.equal(pin.sourceCommit,'4e05f2c85745f703cbf52eec8648a5ad23bdc356');
  assert.equal(pin.readerSourceSha256,'2e3f9aba005041bd0ddc854567fe88f6ea03b7f862dfe4fe29034ef63079cbb3');
  for(const {key,base,text} of pin.examples){
    const cfg={publicUrl:base,worldKey:key,worldPath:`/w/${key}`};
    assert.equal(agentReader(cfg),text);assert.equal(agentReader({...cfg,publicUrl:new URL(base).origin}),text);
    assert.ok(text.split('\n').length>15);assert.ok(!text.includes('\\n'));
    assert.match(text,/After revocation, reconnecting requires fresh human approval/);
    assert.match(text,/discover both authenticated V2 tools before using them/);
    assert.match(text,/Retain the\nrequest reference before one write/);
    assert.match(text,/read-only\nreference lookup, never by automatic resubmission or legacy fallback/);
    assert.match(text,/does not assert that the connection exposes V2/);
    for(const other of pin.examples.filter(e=>e.key!==key))assert.ok(!text.includes(`/w/${other.key}`));
  }
});

test('reader rejects server scope/URL mistakes and never interprets Toy credentials or caller origins',()=>{
  const cfg={publicUrl:'https://reader.fixture.invalid',worldKey:'eden' as const,worldPath:'/w/eden'};
  for(const publicUrl of ['https://reader.fixture.invalid/w/toy','https://secret@reader.fixture.invalid',
    'https://reader.fixture.invalid?token=PRIVATE','https://reader.fixture.invalid/#PRIVATE','http://reader.fixture.invalid'])
    assert.throws(()=>agentReader({...cfg,publicUrl}));
  assert.throws(()=>agentReader({...cfg,worldPath:'/w/toy'}));
  assert.throws(()=>agentReader({...cfg,worldPath:'/'}));
  assert.ok(agentReader({...cfg,publicUrl:'http://localhost:4953'}).includes('http://localhost:4953/w/eden/skill.md'));
});

test('entry point normalization preserves selected paths, old aliases and reserved Mars labs',()=>{
  assert.equal(stripWorldRequestPath('/w/eden/llms.txt?x=1','/w/eden'),'/llms.txt?x=1');
  assert.equal(stripWorldRequestPath('/w/eden','/w/eden'),'/');
  assert.equal(stripWorldRequestPath('/llms.txt','/w/eden'),'/llms.txt');
  assert.equal(stripWorldRequestPath('/w/mars/llms.txt','/w/eden'),'/w/mars/llms.txt');
  for(let year=2020;year<=2027;year++)assert.equal(stripWorldRequestPath(`/w/mars/${year}/llms.txt`,'/w/mars'),`/w/mars/${year}/llms.txt`);
  assert.equal(stripWorldRequestPath(undefined,'/w/eden'),undefined);
});

async function fixture(t:TestContext,key:Config['worldKey']){
  const dir=mkdtempSync(join(tmpdir(),'core-agent-reader-')),db=new Db(':memory:');
  const host=new WorldHost(db,toyFactory,'reader-fixture',1e9,'reader-'+key);host.boot();
  writeFileSync(join(dir,'index.html'),'<!doctype html><title>PRIVATE_FIXTURE_SPA</title>');
  const cfg={...config,worldKey:key,worldId:host.worldId,worldPath:`/w/${key}`,publicUrl:`http://127.0.0.1:4953/w/${key}`,
    webDir:dir,marsWebDir:'/nonexistent',brainMode:'fake' as const,budgetUsdPerDay:0,typesafeKey:undefined,anthropicKey:undefined,
    privyAppId:'',privyAppSecret:''};
  const auth=new Auth(cfg,db),brain=new Brain(host,db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}}),souls=new Souls(host,db,brain,cfg);
  const app=buildApp({cfg,db,host,auth,brain,souls,hub:{clients:new Map(),refreshMe(){}} as unknown as Hub});
  const listener=getRequestListener(app.fetch),server=createServer((req,res)=>{
    req.url=stripWorldRequestPath(req.url,cfg.worldPath);void listener(req,res);
  });
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();rmSync(dir,{recursive:true,force:true});});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cfg.publicUrl=url+`/w/${key}`;
  // Each independent world uses its own allocated port and HTTP session.
  // Do not let the client's pool carry a closed socket into the next fixture.
  const request=(path:string,init:RequestInit={})=>fetch(url+path,{...init,
    headers:{connection:'close',...init.headers}});
  return {cfg,app,url,request};
}

for(const {key} of pin.examples)test(`actual selected ${key} HTTP text precedes SPA and retains its own skill path`,async t=>{
  const f=await fixture(t,key),path=`/w/${key}/llms.txt`;
  const response=await f.request(path,{headers:{host:'spoof.invalid','x-forwarded-host':'spoof.invalid',
    'x-forwarded-proto':'javascript','authorization':'Bearer PRIVATE_FIXTURE_TOKEN'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'text/plain; charset=utf-8');
  const text=await response.text();assert.equal(text,agentReader(f.cfg));assert.ok(!/spoof|PRIVATE_FIXTURE|<title>/.test(text));
  assert.ok(text.includes(f.url+`/w/${key}/skill.md`));
  const linked=await f.request(`/w/${key}/skill.md`);assert.equal(linked.status,200);assert.match(linked.headers.get('content-type')!,/text\/markdown/);
  const spa=await f.request(`/w/${key}/unmatched`);assert.match(await spa.text(),/PRIVATE_FIXTURE_SPA/);
  const head=await f.request(path,{method:'HEAD'});assert.equal(head.headers.get('content-type'),'text/plain; charset=utf-8');assert.equal(await head.text(),'');
  for(const other of pin.examples.filter(e=>e.key!==key)){
    const foreign=await f.request(`/w/${other.key}/llms.txt`);
    assert.equal(foreign.status,404);assert.equal(foreign.headers.get('content-type')?.toLowerCase(),'text/plain; charset=utf-8');
    assert.ok(!(await foreign.text()).startsWith('# Sim —'),'foreign prefix does not become the selected reader');
  }
  // Fail closed at the named text route instead of exposing an invalid
  // configured credential URL or falling through to HTML.
  f.cfg.publicUrl='https://PRIVATE_FIXTURE_TOKEN@reader.fixture.invalid';
  const bad=await f.request(path);assert.equal(bad.status,503);assert.equal(bad.headers.get('cache-control'),'no-store');
  assert.equal(await bad.text(),'World agent instructions are unavailable.');
});
