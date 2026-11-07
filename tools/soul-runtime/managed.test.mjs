import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openJournal} from './journal.mjs';
import {runManaged} from './managed.mjs';
import {abortableSleep} from './receiver.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'souls-managed-'));const journal=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>{journal.close();rmSync(dir,{recursive:true,force:true});});return journal;}
class Host extends EventEmitter{
 constructor(decision){super();this.decision=decision;this.threadId='t';}
 async connect(){}
 async begin(){return {turnId:'turn',completed:Promise.resolve({status:'completed',text:JSON.stringify(this.decision)})};}
 async close(){this.closed=true;}
}
const idle=async({after,signal})=>{await abortableSleep(10000,signal);return {cursor:after,events:[]};};
test('managed restart reconciles dropped response before any new inference or public action',async t=>{
 const journal=fixture(t),stop=new AbortController(),hosts=[],states=[];let writes=0,reconciled=false;
 const write={plan:'Keep appointment after this greeting',call:{type:'write',command:'say',arguments:'{"text":"Hello"}'},wakeAt:null};
 const wait={plan:'Greeting completed; retain appointment',call:{type:'wait',command:'',arguments:'{}'},wakeAt:null};
 const world={read:async()=>({}),worldPage:idle,ownerPage:idle,write:async()=>{writes++;throw Error('lost response');},reconcile:async()=>{reconciled=true;return {state:'recorded',status:200,response:{said:{id:'sp1'}}};}};
 await runManaged({journal,world,instruction:'Keep appointment',signal:stop.signal,sleep:async()=>{},createHost:()=>{const h=new Host(hosts.length?wait:write);if(hosts.length)h.connect=async()=>assert.equal(reconciled,true);hosts.push(h);return h;},onState:s=>{states.push(s);if(s.state==='decision'&&s.call==='wait')stop.abort();}});
 assert.equal(writes,1);assert.equal(hosts.length,2);assert.ok(hosts.every(h=>h.closed));assert.ok(states.some(s=>s.state==='recovering'));assert.equal(journal.control.checkpoint().value.initialInstruction,'Keep appointment');assert.equal(journal.control.operations().length,0);
});
test('repeated host failure is bounded and leaves an explicit blocked status',async t=>{
 const journal=fixture(t);let starts=0;const states=[];
 await assert.rejects(runManaged({journal,world:{},instruction:'Keep goal',maxConsecutiveRestarts:2,sleep:async()=>{},createHost:()=>{starts++;const h=new Host();h.connect=async()=>{throw Object.assign(Error('Host exited'),{code:'HOST_EXITED'});};return h;},onState:s=>states.push(s)}),{code:'HOST_EXITED'});
 assert.equal(starts,3);assert.equal(states.at(-1).state,'blocked');assert.equal(states.at(-1).pendingPreserved,true);
});
test('an unreserved urgent timeout cannot enter the ordinary restart path',async t=>{
 const journal=fixture(t),states=[];let hosts=0;
 await assert.rejects(runManaged({journal,world:{read:async()=>{throw Object.assign(Error('unreserved timeout'),{code:'HOST_URGENT_TURN_TIMEOUT',urgentFallbackGranted:true,urgentRecoveryId:'not-reserved'});}},createHost:()=>{hosts++;return new Host();},sleep:async()=>{},onState:s=>states.push(s)}),{code:'URGENT_RECOVERY_TICKET_INVALID'});
 assert.equal(hosts,1);assert.equal(states.at(-1).state,'blocked');assert.equal(journal.control.checkpoint().value.urgentRecoveryV1,undefined);
});
