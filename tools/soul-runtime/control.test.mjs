import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJournal} from './journal.mjs';
import {MAX_RESPONSE_BYTES,RESPONSE_DELIVERY_BYTES} from './responses.mjs';
import {createHash} from 'node:crypto';
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'souls-control-'));let time=1000;const handles=[];t.after(()=>{for(const h of handles)h.close();rmSync(directory,{recursive:true,force:true})});return {advance(ms){time+=ms},open(){const j=openJournal(directory,{worldId:'w',soulId:'s',now:()=>time});handles.push(j);return j.control;}};}
test('expired owner cannot renew, write checkpoint or release a successor',t=>{
 const f=fixture(t),a=f.open(),b=f.open(),old=a.claim('old',1000);assert.throws(()=>b.claim('other'),{message:'Controller already active',code:'CONTROLLER_BUSY',expiresAt:2000,transient:true});f.advance(1001);const fresh=b.claim('new');assert.equal(fresh.generation,2);assert.throws(()=>a.renew(old),/lease lost/);assert.throws(()=>a.save(old,0,{}),/lease lost/);assert.throws(()=>a.release(old),/lease lost/);b.assertOwner(fresh);
});
test('checkpoint survives connection restart with constraints and suspended task intact',t=>{
 const f=fixture(t),a=f.open(),owner=a.claim('one');const state={intent:'Attend reading',constraints:['return book'],suspended:[{intent:'Talk briefly'}],threadId:'thread-1',next:'read'};a.save(owner,0,state);a.release(owner);const b=f.open(),next=b.claim('two');assert.deepEqual(b.checkpoint().value,state);assert.throws(()=>b.save(next,0,{next:'wrong'}),/revision/);assert.equal(b.save(next,1,{...state,next:'return book'}),2);
});
test('restart after dispatch cannot replay or bypass an uncertain public effect',t=>{
 const f=fixture(t),a=f.open(),owner=a.claim('one',1000);a.prepare(owner,'op-1',{method:'say',text:'Hello'});a.dispatch(owner,'op-1');f.advance(1001);const b=f.open(),next=b.claim('two');assert.equal(b.operations()[0].status,'dispatching');assert.throws(()=>b.dispatch(next,'op-1'),/not safely/);assert.throws(()=>b.prepare(next,'op-2',{method:'say',text:'again'}),/reconciliation/);assert.throws(()=>a.settle(owner,'op-1',{ok:true}),/lease lost/);b.settle(next,'op-1',{confirmed:true,evidence:'existing server idempotency response'});assert.equal(b.prepare(next,'op-2',{method:'say',text:'new'}).status,'prepared');
});
test('stable operation identity rejects changed payload and concurrent reserved dispatch',t=>{
 const a=fixture(t).open(),owner=a.claim('one');a.prepare(owner,'op-1',{method:'act',capability:'sit:chair'});assert.throws(()=>a.prepare(owner,'op-1',{method:'act',capability:'stand:here'}),/reused/);a.prepare(owner,'op-2',{method:'say'});a.dispatch(owner,'op-1');assert.throws(()=>a.dispatch(owner,'op-2'),/requires reconciliation/);a.uncertain(owner,'op-1');assert.equal(a.operation('op-1').status,'uncertain');
});
test('native response storage has its own finite cap while requests and checkpoints stay bounded',t=>{
 const a=fixture(t).open(),owner=a.claim('one'),value={text:'x'.repeat(MAX_RESPONSE_BYTES-11)};
 assert.equal(Buffer.byteLength(JSON.stringify(value)),MAX_RESPONSE_BYTES);
 assert.throws(()=>a.save(owner,0,{text:'x'.repeat(65536)}),/64KiB/);assert.throws(()=>a.prepare(owner,'too-large',{text:'x'.repeat(65536)}),/64KiB/);
 a.prepare(owner,'large',{type:'write',command:'say',args:{text:'hello'}});a.dispatch(owner,'large');a.settle(owner,'large',value);
 assert.deepEqual(a.operation('large').response,value);assert.ok(Buffer.byteLength(JSON.stringify(a.response({kind:'operation',id:'large'})))<=RESPONSE_DELIVERY_BYTES);
 a.prepare(owner,'over-limit',{type:'write',command:'say',args:{text:'hello'}});a.dispatch(owner,'over-limit');
 assert.throws(()=>a.settle(owner,'over-limit',{text:value.text+'x'}),/reconciliation envelope/);assert.equal(a.operation('over-limit').status,'dispatching');
});
test('response chunks reconstruct exact Unicode JSON; finite read and startup slots never alias expired ids',t=>{
 const f=fixture(t),a=f.open(),owner=a.claim('one'),value={text:'🌎界\\\n"'.repeat(3000),accepted:false};
 a.save(owner,0,{pendingDecision:{id:'read-1',decision:{call:{type:'read',command:'observe'}}}});
 const reference=a.retainReadResult(owner,'read-1',value);assert.deepEqual(a.readResult('read-1').response,value);
 let offset=0,reconstructed='';do{const chunk=a.response({kind:'read',id:'read-1',offset});assert.ok(Buffer.byteLength(JSON.stringify(chunk))<=RESPONSE_DELIVERY_BYTES);assert.deepEqual(chunk.responseRef,reference);reconstructed+=chunk.text;offset=chunk.nextOffset;}while(offset!==null);
 assert.equal(reconstructed,JSON.stringify(value));assert.deepEqual(JSON.parse(reconstructed),value);assert.equal(createHash('sha256').update(reconstructed).digest('hex'),reference.sha256);
 a.retainStartupResult(owner,'startup-1',{text:'startup'});assert.deepEqual(a.readResult('read-1').response,value);
 assert.throws(()=>a.retainReadResult(owner,'read-1',{different:true}),/identity reused/);
 a.save(owner,1,{pendingDecision:{id:'read-2',decision:{call:{type:'read',command:'observe'}}}});a.retainReadResult(owner,'read-2',{current:true});
 assert.equal(a.readResult('read-1'),null);assert.equal(a.response({kind:'read',id:'read-1'}).reason,'expired-or-unknown-read-response');
 assert.equal(JSON.parse(a.response({kind:'startup',id:'startup-1'}).text).text,'startup');
 a.retainStartupResult(owner,'startup-2',{text:'new startup'});assert.equal(a.response({kind:'startup',id:'startup-1'}).responseUnavailable,true);assert.deepEqual(a.readResult('read-2').response,{current:true});
 a.save(owner,2,{pendingDecision:{id:'retrieve',decision:{call:{type:'read',command:'response'}}}});assert.throws(()=>a.retainReadResult(owner,'retrieve',{}),/pending read decision/);
 for(const args of [{kind:'bad',id:'read-2'},{kind:'read',id:'read-2',offset:-1},{kind:'read',id:'read-2',extra:1}])assert.throws(()=>a.response(args),/Local response/);
 assert.throws(()=>a.response({kind:'read',id:'read-2',offset:999}),/exceeds length/);
 a.release(owner);const b=f.open();assert.deepEqual(b.readResult('read-2').response,{current:true});assert.equal(b.response({kind:'startup',id:'startup-2'}).responseUnavailable,undefined);
});
