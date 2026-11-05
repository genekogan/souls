// #1008: with no skillFile/instructionsFile, the tools/core edge and multiworld servers serve the pinned launcher guides
// (tools/world-launcher/soul), which name the /eden.mjs these worlds publish, never the legacy eden-agent.mjs.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';import {join,resolve} from 'node:path';
import {openEdgeServerV1} from './edge-server.mjs';import {openWorldServer} from './multiworld/world-server.mjs';
const input=resolve(new URL('../../',import.meta.url).pathname),pinned=f=>readFileSync(join(input,'tools/world-launcher/soul',f),'utf8');
const scratch=()=>{const root=join(input,'.local/test');mkdirSync(root,{recursive:true});return mkdtempSync(join(root,'pinned-guides-'));};
const get=async url=>{const r=await fetch(url);return {status:r.status,text:await r.text()};};
async function guides(base){
 const skill=await get(`${base}/skill.md`),instructions=await get(`${base}/instructions.md`);
 assert.equal(skill.status,200);assert.equal(instructions.status,200);
 for(const [name,text] of [['skill',skill.text],['instructions',instructions.text]])assert.ok(!text.includes('eden-agent.mjs'),`${name} names no eden-agent.mjs`);
 assert.ok(instructions.text.includes(`curl -fsSo eden.mjs ${base}/eden.mjs`),'the CLI line carries this world\'s base');
 assert.ok(instructions.text.includes(`\nWorld: ${base} (`),'the World: line carries this world\'s base');
 assert.ok(!instructions.text.includes('sim.eden.art/worlds/w/eden-2026'),'the captured base is gone');
 assert.equal((await get(`${base}/eden.mjs`)).status,200);assert.equal((await get(`${base}/eden-agent.mjs`)).status,404);
 return {skill:skill.text,instructions:instructions.text};
}

test('edge-server: no guide options serve the pinned skill bytes and the pinned instructions; explicit files still override',async()=>{
 const dir=scratch();let app;
 try{
  app=await openEdgeServerV1({input,dataDir:join(dir,'a'),worldId:'pinned-guides-1',port:4956,build:'local-pinned-guides',ambient:false});app.host.stop();
  const served=await guides('http://127.0.0.1:4956/w/eden');assert.equal(served.skill,pinned('skill.md').replaceAll('{{BASE}}','http://127.0.0.1:4956/w/eden'));
  await app.close();app=null;
  const skillFile=join(dir,'skill.md'),instructionsFile=join(dir,'instructions.md');writeFileSync(skillFile,'custom skill\n');writeFileSync(instructionsFile,'custom instructions\n');
  app=await openEdgeServerV1({input,dataDir:join(dir,'b'),worldId:'pinned-guides-2',port:4956,build:'local-pinned-guides',ambient:false,skillFile,instructionsFile});app.host.stop();
  assert.equal((await get('http://127.0.0.1:4956/w/eden/skill.md')).text,'custom skill\n');assert.match((await get('http://127.0.0.1:4956/w/eden/instructions.md')).text,/^custom instructions/);
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('world-server: no guide options serve the pinned instructions and the pinned skill with its world adaptation',async()=>{
 const dir=scratch();let app;
 try{
  app=await openWorldServer({input,dataDir:dir,worldKey:'littlemartians',worldId:'littlemartians-1',port:4965,nativeCast:false});app.host.stop();
  const served=await guides('http://127.0.0.1:4965/w/littlemartians');
  assert.ok(served.skill.startsWith(pinned('skill.md').replace(/\bEden\b/g,'Little Martians').replaceAll('{{BASE}}','http://127.0.0.1:4965/w/littlemartians')),'the pinned skill, adapted as for a launcher world');
  assert.match(served.skill,/## This world/);
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
