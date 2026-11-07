import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const CLI=fileURLToPath(new URL('./soul/eden.mjs',import.meta.url));
const receipt={id:'r_travel',phase:'started',capability:'walk:square'};
const ambient={id:'c_11',kind:'speech',at:1000,from:{soulId:'s_other',name:'Other'},text:'Earlier earshot speech',untrusted:true};
const terminal={id:'c_13',kind:'receipt',receipt:{...receipt,phase:'completed'}};

async function fixture(t,firstEvents){
 const dir=mkdtempSync(join(tmpdir(),'souls-continuity-wait-')),requests=[];let waits=0;
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture');requests.push([req.method,req.url]);
  const reply=payload=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(payload));};
  if(url.pathname==='/v1/edge/wait'){
   waits++;
   // A second poll supplies a terminal event so a broken client fails the
   // request-count assertion promptly, without a timing-based latency oracle.
   return reply(waits===1?{cursor:'c_12',events:firstEvents}:{cursor:'c_13',events:[terminal]});
  }
  if(url.pathname==='/v1/edge/receipts/'+receipt.id)return reply({receipt:waits===1?receipt:terminal.receipt});
  if(url.pathname==='/v1/edge/act'&&req.method==='POST'){req.resume();return reply({accepted:true,receipt});}
  res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'unexpected-route'}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 writeFileSync(join(dir,'.eden-agent.json'),JSON.stringify({world:`http://127.0.0.1:${server.address().port}`,soul:'synthetic',token:'synthetic-only',cursor:'c_10',lastReceipt:receipt.id}),{mode:0o600});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
 const run=(...args)=>new Promise((resolve,reject)=>execFile(process.execPath,[CLI,...args],{cwd:dir,timeout:3000},(error,stdout,stderr)=>error?reject(new Error(stderr||error.message)):resolve(JSON.parse(stdout))));
 return {run,requests,state:()=>JSON.parse(readFileSync(join(dir,'.eden-agent.json'),'utf8'))};
}

for(const kind of ['invite','conversation.invite','conversation.turn']){
 for(const json of [true,false]){
  test(`active receipt wait wakes on ${kind} with ${json?'full':'brief'} event evidence`,{timeout:5000},async t=>{
   const notification={id:'c_12',kind,at:1200,conversation:'cv_1',from:{soulId:'s_ava',name:'Ava'},turn:{seq:1,text:'Are you coming?',from:{soulId:'s_ava',name:'Ava'}},untrusted:true};
   const f=await fixture(t,[ambient,notification]),out=await f.run('wait','60',...(json?[receipt.id,'--json']:[]));
   assert.deepEqual(out.events,[ambient,notification]);assert.equal(out.receipt.phase,'started','a social notification never claims physical completion');
   assert.deepEqual(f.requests,[['GET','/v1/edge/wait?timeout=55&after=c_10'],['GET','/v1/edge/receipts/'+receipt.id]],'return after the notification page while the body receipt is still active');
   assert.equal(f.state().lastReceipt,receipt.id);assert.equal(f.state().cursor,'c_12');
   if(!json){assert.equal(out.done,false);assert.equal(out.eventWindow.since,'c_10');assert.equal(out.eventWindow.cursor,'c_12');}
  });
 }
}

test('act --wait returns an incoming conversation turn without repeating or completing its action',{timeout:5000},async t=>{
 const turn={id:'c_12',kind:'conversation.turn',conversation:'cv_1',turn:{seq:2,text:'Please answer when you can'},untrusted:true};
 const f=await fixture(t,[turn]),out=await f.run('act','walk:square','--for','none','--wait','60','--json');
 assert.equal(out.accepted,true);assert.equal(out.receipt.phase,'started');assert.deepEqual(out.events,[turn]);
 assert.deepEqual(f.requests.map(([method,url])=>[method,url.split('?')[0]]),[['POST','/v1/edge/act'],['GET','/v1/edge/wait'],['GET','/v1/edge/receipts/'+receipt.id]]);
 assert.equal(f.state().lastReceipt,receipt.id);
});

test('ambient speech and conversation membership notices retain receipt waiting behavior',{timeout:5000},async t=>{
 const member={id:'c_12',kind:'conversation.member',conversation:'cv_1',change:'joined',untrusted:true};
 const f=await fixture(t,[ambient,member]),out=await f.run('wait','60',receipt.id,'--json');
 assert.equal(f.requests.filter(([,url])=>url.startsWith('/v1/edge/wait?')).length,2);
 assert.deepEqual(out.events,[ambient,member,terminal]);assert.equal(out.receipt.phase,'completed');assert.equal(f.state().cursor,'c_13');
});
