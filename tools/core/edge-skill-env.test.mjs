// #1008 follow-up: tools/core/edge-server.mjs honors EDGE_SKILL_FILE (through config.ts's defaults.skillFile, as cliFile
// honors EDGE_CLI_FILE); an explicit skillFile option still wins. Its own file: config.ts reads the environment
// once, when it is first imported in a process.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {join,resolve} from 'node:path';
const input=resolve(new URL('../../',import.meta.url).pathname);
const get=async url=>(await fetch(url)).text();

test('edge-server: EDGE_SKILL_FILE sets /skill.md when no skillFile option is given; the option overrides it',async()=>{
 const root=join(input,'.local/test');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'edge-skill-env-'));
 const envFile=join(dir,'env-skill.md'),optionFile=join(dir,'option-skill.md');writeFileSync(envFile,'env skill\n');writeFileSync(optionFile,'option skill\n');
 const prior=process.env.EDGE_SKILL_FILE;process.env.EDGE_SKILL_FILE=envFile;let app;
 try{
  const {openEdgeServerV1}=await import('./edge-server.mjs');
  app=await openEdgeServerV1({input,dataDir:join(dir,'a'),worldId:'edge-skill-env-1',port:4957,build:'local-edge-skill-env',ambient:false});app.host.stop();
  assert.equal(await get('http://127.0.0.1:4957/w/eden/skill.md'),'env skill\n');
  await app.close();app=null;
  app=await openEdgeServerV1({input,dataDir:join(dir,'b'),worldId:'edge-skill-env-2',port:4957,build:'local-edge-skill-env',ambient:false,skillFile:optionFile});app.host.stop();
  assert.equal(await get('http://127.0.0.1:4957/w/eden/skill.md'),'option skill\n');
 }finally{if(app)await app.close();if(prior===undefined)delete process.env.EDGE_SKILL_FILE;else process.env.EDGE_SKILL_FILE=prior;rmSync(dir,{recursive:true,force:true});}
});
