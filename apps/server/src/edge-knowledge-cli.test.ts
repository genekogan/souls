// knowledge/1 in the Soul CLI against a local edge (lane knowledge port 6101): `look around` / `explore` print the short
// around frame (places with walk ids and whether you have been there, people, things, a suggested new place), `--full`
// the raw one; `here` carries district and far. The Eden nav fixture (test bearer = Soul id); fake minds; 127.0.0.1 only.
import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {once} from 'node:events';import {getRequestListener} from '@hono/node-server';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
import {coreAWorld} from '../test/core-a-fixture.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();
const PORT=TEST_PORT;
test('CLI look around / explore: short around frame with walk ids; --full raw; here has district and far',{timeout:300000},async t=>{
 const cli=fileURLToPath(new URL('../../../tools/edge-skill/eden-agent.mjs',import.meta.url));
 const w=await coreAWorld(2),[a]=w.souls,dir=mkdtempSync(join(tmpdir(),'knowledge-cli-'));let server:ReturnType<typeof createServer>|undefined,pump:NodeJS.Timeout|undefined;
 try{
  await w.put(a,[14,14]);await w.ticks(12);
  const listener=getRequestListener(w.app.fetch);server=createServer((req,res)=>{req.url=req.url?.replace(/^\/w\/eden(?=\/)/,'');void listener(req,res);});server.listen(PORT,'127.0.0.1');await once(server,'listening');pump=setInterval(()=>w.f.host.drainInputs(),10);
  writeFileSync(join(dir,'.eden-agent.json'),JSON.stringify({world:`http://127.0.0.1:${PORT}/w/eden`,soul:a.soulId,token:a.soulId}),{mode:0o600});
  const run=async(...args:string[])=>{const {stdout}=await promisify(execFile)(process.execPath,[cli,...args],{cwd:dir,timeout:30000,maxBuffer:256*1024});return {out:JSON.parse(stdout),chars:stdout.length};};
  const around=await run('look','around'),explore=await run('explore');
  assert.deepEqual(around.out.places,explore.out.places,'look around = explore');
  assert.ok(around.out.places.length>0&&around.out.places.every((p:string)=>/ · [NESW]{1,2} \d+m ~.+ · (new|been \d+×|found)/.test(p))&&around.out.places.some((p:string)=>/\[walk:[^\]]+\]$/.test(p)),JSON.stringify(around.out.places));
  assert.match(around.out.suggestion,/^walk:/);assert.equal(around.out.untrusted,true);
  const full=await run('look','around','--full');assert.equal(typeof full.out.places[0]?.id,'string');
  const here=await run('here');assert.equal(here.out.district.name,'Commons ground');assert.ok(here.out.far.length>0);
  t.diagnostic(`look around ${around.chars} chars (~${Math.ceil(around.chars/4)} tokens) vs --full ${full.chars}; here ${here.chars}`);
  assert.ok(around.chars<full.chars,'the short form is shorter');
  await assert.rejects(run('look','sideways'),/usage: look around/);
 }finally{if(pump)clearInterval(pump);if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));}w.close();rmSync(dir,{recursive:true,force:true});}
});
