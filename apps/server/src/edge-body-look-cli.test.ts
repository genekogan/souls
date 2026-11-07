// `body look` in the Soul CLI against a local edge (lane LOOKS port 5731). Skips until the L10 patches are applied.
import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {once} from 'node:events';import {getRequestListener} from '@hono/node-server';import {Hono} from 'hono';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import {appearanceFromSeed,lookKey} from '../../web/src/humanoid/look.ts';
import {testPort} from '../test/test-port.ts';
const PORT=Number(process.env.LOOK_CLI_TEST_PORT??await testPort());
test('CLI body look: show, seeded random, set parts and colours, classic preset, refusal',async t=>{
 const cli=fileURLToPath(new URL('../../../tools/edge-skill/eden-agent.mjs',import.meta.url));
 if(!readFileSync(cli,'utf8').includes("cmd==='look'")){t.skip('needs the L10 CLI patch (tools/humanoid/patches/03-cli-body-look.patch)');return;}
 const f=fixture(':memory:'),dir=mkdtempSync(join(tmpdir(),'body-look-cli-'));f.brain.quiesce();let server:ReturnType<typeof createServer>|undefined,pump:NodeJS.Timeout|undefined;
 try{
  await invite(f,'look');const row=await accept(f.host,f.souls.create('dev:look',{name:'Look CLI',description:'local scripted CLI fixture'})),pair=f.souls.pairCode(row,`http://127.0.0.1:${PORT}`),credential=f.souls.pairExchange(pair.code,'scripted-cli');
  const app=new Hono(),ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:false});mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))});
  const listener=getRequestListener(app.fetch);server=createServer((req,res)=>{req.url=req.url?.replace(/^\/w\/eden(?=\/)/,'');void listener(req,res);});server.listen(PORT,'127.0.0.1');await once(server,'listening');pump=setInterval(()=>f.host.drainInputs(),10);
  writeFileSync(join(dir,'.eden-agent.json'),JSON.stringify({world:`http://127.0.0.1:${PORT}/w/eden`,soul:row.id,token:credential.token}),{mode:0o600});
  const run=async(...args:string[])=>{const {stdout}=await promisify(execFile)(process.execPath,[cli,'body','look',...args],{cwd:dir,timeout:30000,maxBuffer:256*1024});assert.ok(!stdout.includes(credential.token));return JSON.parse(stdout);};
  const shown=await run();assert.equal(shown.look,null);assert.deepEqual(shown.choices.glasses,['none','round','square','shades']);
  const random=await run('--random','--seed','11');assert.equal(random.body.model,lookKey(appearanceFromSeed(11)));
  const set=await run('--set','hat=sunhat','top1=#356477','headSize=1.05');assert.equal(set.body.params.hat,'sunhat');assert.equal(set.body.params.top1,'#356477');assert.equal(set.body.params.headSize,1.05);
  assert.equal(set.body.params.top,appearanceFromSeed(11).top,'unnamed parts are kept');
  const now=await run();assert.equal(now.look.hat,'sunhat');
  const classic=await run('--set','preset=punk');assert.deepEqual(classic.body.params,{preset:'punk'});
  // looks v2: an outfit, facial hair, an accessory colour and body shape in one command; a preset keeps them
  const v2=await run('--set','outfit=suit','facialHair=beard','scarf=scarf','accessory=#c58a2e','shoulders=1.1','weight=1.2');
  assert.equal(v2.body.params.top,'suit');assert.equal(v2.body.params.facialHair,'beard');assert.equal(v2.body.params.shoulders,1.1);assert.equal(v2.body.params.weight,1.2);
  assert.ok(shown.choices.outfit.includes('suit')&&shown.choices.facialHair.includes('beard'),'choices list outfits and accessories');
  const kept=await run('--set','preset=woman');assert.deepEqual(kept.body.params,{preset:'woman'},'choosing a preset is that classic look exactly');
  const punk=await run('--set','preset=punk');void punk;
  await assert.rejects(run('--set','outfit=tuxedo'),/outfit must be one of/);
  await assert.rejects(run('--set','hair=purple'),/body.look/);
  assert.deepEqual(f.host.engine.world.entities[row.entity_id].body,classic.body);
 }finally{if(pump)clearInterval(pump);if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));}f.host.stop();f.db.close();rmSync(dir,{recursive:true,force:true});}
});
