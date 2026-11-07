import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {once} from 'node:events';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();
test('published CLI normalizes plain words with params exactly once and preserves explicit capability IDs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cli-word-params-')),sent:{capability:string;params:Record<string,unknown>}[]=[],token='synthetic-cli-only';let closed=false;
 const server=createServer(async(req,res)=>{res.setHeader('content-type','application/json');if(req.url?.endsWith('/capabilities'))return res.end(JSON.stringify({capabilities:[]}));if(req.url?.endsWith('/act')){const chunks:Buffer[]=[];for await(const b of req)chunks.push(Buffer.from(b));const data=JSON.parse(Buffer.concat(chunks).toString()) as typeof sent[number];sent.push(data);return res.end(JSON.stringify({accepted:true,receipt:{id:'r_synthetic_'+sent.length,capability:data.capability,phase:'completed'}}));}res.statusCode=404;res.end('{}');});
 try{server.listen(TEST_PORT,'127.0.0.1');await once(server,'listening');const cli=fileURLToPath(new URL('../../../tools/edge-skill/eden-agent.mjs',import.meta.url));
  const run=async(...args:string[])=>{writeFileSync(join(dir,'.eden-agent.json'),JSON.stringify({world:`http://127.0.0.1:${TEST_PORT}/w/eden`,soul:'s_synthetic',token,mode:'edge'}),{mode:0o600});const {stdout}=await promisify(execFile)(process.execPath,[cli,'act',...args],{cwd:dir,timeout:10000});assert.ok(!stdout.includes(token));return JSON.parse(stdout);};
  await run('do some exercise');await run('do some exercise','{"seconds":5}');await run('do','some','exercise','{"seconds":7}');await run('give a little bow','{"seconds":5}');await run('jumping-jacks:here','{"seconds":5}');
  assert.deepEqual(sent.map(x=>[x.capability,x.params]),[['do jumping jacks',{}],['do jumping jacks',{seconds:5}],['do jumping jacks',{seconds:7}],['bow',{seconds:5}],['jumping-jacks:here',{seconds:5}]]);assert.equal(sent.length,5,'each user request issues exactly one body command');
  await assert.rejects(run('do some exercise','{invalid'));assert.equal(sent.length,5,'invalid params cannot issue a body command');
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>{closed=true;resolve();}));assert.ok(closed,'owned listener closed before identity deletion');rmSync(dir,{recursive:true,force:true});}
});
