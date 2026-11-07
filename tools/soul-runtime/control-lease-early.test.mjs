// #471: a successor takes a dead controller's lease at once, and never a live one's.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openJournal} from './journal.mjs';
import {processGone} from './control.mjs';
import {inspectOwnedProcess} from './controller-ownership.mjs';
const JOURNAL=pathToFileURL(new URL('./journal.mjs',import.meta.url).pathname).href,OWNERSHIP=pathToFileURL(new URL('./controller-ownership.mjs',import.meta.url).pathname).href;
const inZone=(TZ,code)=>spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TZ},encoding:'utf8'});
function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'souls-lease-')),handles=[];t.after(()=>{for(const h of handles)h.close();rmSync(directory,{recursive:true,force:true});});
 return {directory,open(lease={}){const j=openJournal(directory,{worldId:'w',soulId:'s',lease});handles.push(j);return j.control;}};
}
const me={pid:4242,startToken:'Sat Nov  7 01:00:00 2026'};

test('processGone: only a clean answer counts',()=>{
 assert.equal(processGone(me,()=>null),true,'no such pid');
 assert.equal(processGone(me,()=>({pid:4242,startToken:'another time'})),true,'a reused pid');
 assert.equal(processGone(me,()=>({...me})),false,'the same process');
 assert.equal(processGone(me,()=>{throw Error('ps failed');}),false,'unknown is alive');
 const alive=inspectOwnedProcess(process.pid);assert.equal(processGone({pid:alive.pid,startToken:alive.startToken}),false,'this process, for real');
});

test('a holder that is gone loses its lease at once, its fence is refused, and the generation moves on',t=>{
 const f=fixture(t),old=f.open({self:()=>me,holderGone:()=>false}),fence=old.claim('old',60000),next=f.open({self:()=>({pid:5,startToken:'t'}),holderGone:h=>{assert.deepEqual(h,me);return true;}}),taken=next.claim('new',60000);
 assert.equal(taken.generation,fence.generation+1);
 assert.throws(()=>old.renew(fence),/Controller lease lost/);assert.throws(()=>old.save(fence,0,{x:1}),/Controller lease lost/);assert.throws(()=>old.release(fence),/Controller lease lost/);
 next.renew(taken);
});

test('a live holder, an unknown answer and a row with no identity are never displaced',t=>{
 const f=fixture(t);f.open({self:()=>me}).claim('old',60000);
 const busy={code:'CONTROLLER_BUSY'};
 assert.throws(()=>f.open({holderGone:()=>false}).claim('new'),busy);
 assert.throws(()=>f.open({holderGone:h=>processGone(h,()=>{throw Error('ps failed');})}).claim('new'),busy);
 const g=fixture(t);g.open({self:()=>null}).claim('old',60000);
 assert.throws(()=>g.open({holderGone:()=>{throw Error('must not be asked');}}).claim('new'),busy,'an older runtime\'s row waits out its TTL');
});

test('a new holder that came between the check and the claim is never displaced',t=>{
 const f=fixture(t),a=f.open({self:()=>me});a.claim('old',1000);
 const b=f.open({self:()=>({pid:6,startToken:'t'})});
 const racer=f.open({self:()=>({pid:7,startToken:'t'}),holderGone:()=>{b.claim('winner',60000);return true;}});
 assert.throws(()=>racer.claim('late',60000),{code:'CONTROLLER_BUSY'});
});

test('a real controller killed while holding the lease: the next claim takes it at once',async t=>{
 const f=fixture(t);
 const child=spawn(process.execPath,['--input-type=module','-e',`import {openJournal} from ${JSON.stringify(JOURNAL)};const j=openJournal(${JSON.stringify(f.directory)},{worldId:'w',soulId:'s'});const c=j.control.claim('dying',60000);console.log(c.generation);setInterval(()=>{},1000);`],{stdio:['ignore','pipe','ignore']});
 const generation=await new Promise(ok=>child.stdout.once('data',d=>ok(Number(String(d)))));
 const live=f.open();assert.throws(()=>live.claim('early',60000),{code:'CONTROLLER_BUSY'},'alive, it keeps the lease');
 const exited=new Promise(ok=>child.once('exit',ok));child.kill('SIGKILL');await exited;
 const t0=performance.now(),taken=f.open().claim('next',60000);
 assert.equal(taken.generation,generation+1);assert.ok(performance.now()-t0<3000,'inside the 3 s the issue asks for');
});

test('the start token does not depend on the reader\'s time zone',()=>{
 const read=TZ=>inZone(TZ,`import {inspectOwnedProcess} from ${JSON.stringify(OWNERSHIP)};console.log(inspectOwnedProcess(${process.pid}).startToken);`).stdout.trim();
 const honolulu=read('Pacific/Honolulu');assert.ok(honolulu);assert.equal(read('Asia/Tokyo'),honolulu);assert.equal(inspectOwnedProcess(process.pid).startToken,honolulu);
});

test('a live holder keeps the lease from a successor in another time zone',async t=>{
 const f=fixture(t);
 const child=spawn(process.execPath,['--input-type=module','-e',`import {openJournal} from ${JSON.stringify(JOURNAL)};const j=openJournal(${JSON.stringify(f.directory)},{worldId:'w',soulId:'s'});const c=j.control.claim('holder',60000);console.log(c.generation);setInterval(()=>{},1000);`],{stdio:['ignore','pipe','ignore'],env:{...process.env,TZ:'Pacific/Honolulu'}});
 const exited=new Promise(ok=>child.once('exit',ok));t.after(async()=>{child.kill('SIGKILL');await exited;});
 const generation=await new Promise(ok=>child.stdout.once('data',d=>ok(Number(String(d)))));
 const claim=inZone('Asia/Tokyo',`import {openJournal} from ${JSON.stringify(JOURNAL)};const j=openJournal(${JSON.stringify(f.directory)},{worldId:'w',soulId:'s'});let out;try{out=j.control.claim('successor',60000).generation;}catch(e){out=e.code;}j.close();console.log(out);`);
 assert.equal(claim.stdout.trim(),'CONTROLLER_BUSY',claim.stderr);
 assert.equal(generation,1);
});
