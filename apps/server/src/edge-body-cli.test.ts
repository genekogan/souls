import test from 'node:test';import {BODY_PRESETS} from './edge/body/routes.ts';import {PIP_PRESET} from './edge/body/pip.ts';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {once} from 'node:events';import {getRequestListener} from '@hono/node-server';import {Hono} from 'hono';
import {mkdtempSync,writeFileSync,rmSync,statSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';import {rigidGLB} from './edge/body/testing.ts';
import {testPort} from '../test/test-port.ts';

// A free port by default, which is outside 4930-4970 (the laptop's release listeners); override with TEST_BODY_CLI_PORT.
const BODY_CLI_PORT=Number(process.env.TEST_BODY_CLI_PORT??await testPort());if(BODY_CLI_PORT>=4930&&BODY_CLI_PORT<=4970)throw Error('TEST_BODY_CLI_PORT must be outside 4930-4970');
test('CLI BODY authenticates privately and completed plans remain readable by ID',async()=>{
 const f=fixture(':memory:'),dir=mkdtempSync(join(tmpdir(),'body-cli-'));f.brain.quiesce();let server:ReturnType<typeof createServer>|undefined,pump:NodeJS.Timeout|undefined,closed=false;
 try{
  await invite(f,'cli');const row=await accept(f.host,f.souls.create('dev:cli',{name:'Body CLI',description:'local scripted CLI fixture'})),pair=f.souls.pairCode(row,'http://127.0.0.1:'+BODY_CLI_PORT),credential=f.souls.pairExchange(pair.code,'scripted-cli');
  const app=new Hono(),ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:false});mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))});
  const listener=getRequestListener(app.fetch);server=createServer((req,res)=>{req.url=req.url?.replace(/^\/w\/eden(?=\/)/,'');void listener(req,res);});server.listen(BODY_CLI_PORT,'127.0.0.1');await once(server,'listening');pump=setInterval(()=>f.host.drainInputs(),10);
  const state=join(dir,'.eden-agent.json');writeFileSync(state,JSON.stringify({world:'http://127.0.0.1:'+BODY_CLI_PORT+'/w/eden',soul:row.id,token:credential.token}),{mode:0o600});assert.equal(statSync(state).mode&0o777,0o600);writeFileSync(join(dir,'fixture.glb'),rigidGLB());
  const cli=fileURLToPath(new URL('../../../tools/edge-skill/eden-agent.mjs',import.meta.url));
  const command=async(cmd:string,...args:string[])=>{const {stdout}=await promisify(execFile)(process.execPath,[cli,cmd,...args],{cwd:dir,timeout:30000,maxBuffer:256*1024});assert.ok(!stdout.includes(credential.token));return JSON.parse(stdout);},run=(...args:string[])=>command('body',...args);
  const presets=await run('presets');assert.deepEqual(presets.map((p:{id:string})=>p.id),BODY_PRESETS.map(p=>p.id),'the CLI lists every shared preset, Pip included');assert.ok(presets.some((p:{id:string})=>p.id===PIP_PRESET.id));const uploaded=await run('upload','fixture.glb','--type','ceramic','--license','owned','--rights-confirmed');assert.match(uploaded.assetId,/^body_[a-f0-9]{64}$/);
  const assigned=await run('set',uploaded.assetId);assert.equal(assigned.body.type,'ceramic');
  // body-library/1 (#717): the owner's saved bodies, a bounded core page, lookup, save/forget by reference
  const mine=await run('library');assert.deepEqual(mine.items.map((i:{ref:string})=>i.ref),[uploaded.assetId]);const core=await run('library','core','--limit','3');assert.equal(core.items.length,3);assert.ok(core.next);
  assert.equal((await run('show',uploaded.assetId)).definition.attribution.creatorSoul,row.id);assert.equal((await run('show',uploaded.assetId)).definition.public,false);assert.equal((await run('publish',uploaded.assetId)).public,true);assert.equal((await run('unpublish',uploaded.assetId)).public,false);assert.equal((await run('forget',uploaded.assetId)).saved,false);assert.deepEqual((await run('library')).items,[]);assert.equal((await run('save',uploaded.assetId)).saved,true);const current=await run();assert.equal(current.body.modelUrl,uploaded.modelUrl);assert.equal(current.body.avatar.modelUrl,uploaded.modelUrl);assert.equal(f.db.paidCost(),0);
  const planned=await command('plan',JSON.stringify([{say:'Synthetic completed plan lookup.'}]));assert.equal(planned.plan.state,'done');assert.equal((await command('plan')).plan,null);
  const archived=await command('plan','get',planned.plan.id);assert.equal(archived.plan.id,planned.plan.id);assert.equal(archived.plan.state,'done');assert.equal(archived.plan.steps[0].status,'done');
 }finally{if(pump)clearInterval(pump);if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>{closed=true;resolve();}));}f.host.stop();f.db.close();assert.ok(closed||!server,'owned fixture listener closed before private identity deletion');rmSync(dir,{recursive:true,force:true});}
});
