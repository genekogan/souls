// #789: a managed act that serves an owner message carries its id as `for` (the thin CLI's default link, D3b/D3c);
// which message comes from the owner events of retained decisions, never from a time window.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openJournal} from './journal.mjs';
import {parseDecision,retainDecision,applyPendingDecision} from './decision.mjs';
import {createWorldClient} from './world-client.mjs';

function fixture(t){const dir=mkdtempSync(join(tmpdir(),'sim-owner-link-'));const j=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>{try{j.close();}catch{}rmSync(dir,{recursive:true,force:true});});return {j,dir,fence:j.control.claim('test')};}
const call=(type,command,args)=>parseDecision(JSON.stringify({plan:'p',call:{type,command,arguments:JSON.stringify(args)},wakeAt:null}));
const owner=(j,id)=>j.ingest({source:'owner',after:j.cursor('owner'),cursor:id,events:[{id,kind:'owner.message',text:'walk over to the kitchen'}]});
// The real world client over a recording fetch: the assertion is on the request body the world receives.
function world(answer=()=>({accepted:true,receipt:{id:'r_'+Math.random().toString(36).slice(2),phase:'started'}})){
 const bodies=[];const client=createWorldClient({world:'http://127.0.0.1:1234',token:'synthetic-fixture-only',fetchImpl:async(url,o)=>{const body=o.body?JSON.parse(o.body):null;if(body)bodies.push({path:new URL(url).pathname,body});const a=body?answer(body):{here:{}};return Response.json(a.json??a,{status:a.status??200});}});
 return {client,bodies};
}
async function decide(j,fence,w,d){const events=j.pending();retainDecision(j,fence,d,{events});return applyPendingDecision(j,fence,w.client);}

test('A1: the act after an ack serves the acknowledged message; A2: the next act serves none',async t=>{
 const {j,fence}=fixture(t),w=world(b=>b.capability?{accepted:true,receipt:{id:'r_'+b.clientRef,phase:'started'},...(b.for?{for:b.for}:{})}:{ok:true});
 owner(j,'m_1');
 await decide(j,fence,w,call('write','ack',{id:'m_1'}));
 assert.deepEqual(w.bodies[0],{path:'/v1/edge/inbox/m_1/ack',body:{}},'non-act writes are unchanged');
 await decide(j,fence,w,call('read','here',{}));
 await decide(j,fence,w,call('write','act',{capability:'walk:cottage/kitchen'}));
 const first=w.bodies.at(-1);
 assert.equal(first.path,'/v1/edge/act');
 assert.equal(first.body.for,'m_1');assert.equal(first.body.forDefault,true);
 assert.equal(j.control.checkpoint().value.ownerLinkV1,undefined,'an accepted, closed act uses the link up');
 await decide(j,fence,w,call('write','act',{capability:'walk:green'}));
 const second=w.bodies.at(-1).body;
 assert.equal(Object.hasOwn(second,'for'),false);assert.equal(Object.hasOwn(second,'forDefault'),false);
 assert.deepEqual(Object.keys(second).sort(),['capability','clientRef','params']);
});

test('A2: a Soul that never had an owner message sends acts without for; say is unchanged; #804: an object action serves the message like an act',async t=>{
 const {j,fence}=fixture(t),w=world();
 j.ingest({source:'world',after:null,cursor:'c_1',events:[{id:'c_1'}]});
 await decide(j,fence,w,call('write','act',{capability:'wave'}));
 await decide(j,fence,w,call('write','say',{text:'Hello'}));
 await decide(j,fence,w,call('write','object',{id:'o_0',action:'look'}));
 owner(j,'m_2');
 await decide(j,fence,w,call('write','say',{text:'On my way'}));
 assert.equal(j.control.checkpoint().value.ownerLinkV1,'m_2','say keeps the link');
 await decide(j,fence,w,call('write','object',{id:'o_1',action:'ring'}));
 assert.equal(Object.hasOwn(w.bodies[0].body,'for'),false);
 assert.deepEqual(w.bodies[1].body,{text:'Hello'});
 assert.deepEqual(w.bodies[2],{path:'/v1/edge/objects/o_0/act',body:{action:'look',params:{}}},'no owner message: no link');
 assert.deepEqual(w.bodies[3].body,{text:'On my way'});
 assert.deepEqual(w.bodies[4],{path:'/v1/edge/objects/o_1/act',body:{action:'ring',params:{},for:'m_2',forDefault:true}});
 assert.equal(j.control.checkpoint().value.ownerLinkV1,undefined,'an accepted object action that is not kept open uses the link up');
});

test('#804: an object action the world keeps open keeps the link for the next act',async t=>{
 const {j,fence}=fixture(t),w=world(b=>({accepted:true,...(b.for&&b.action?{for:b.for,open:true}:b.for?{for:b.for}:{}),...(b.capability?{receipt:{id:'r_'+b.clientRef,phase:'started'}}:{})}));
 owner(j,'m_o');
 await decide(j,fence,w,call('write','object',{id:'bell',action:'ring'}));
 assert.equal(w.bodies.at(-1).body.for,'m_o');assert.equal(j.control.checkpoint().value.ownerLinkV1,'m_o','open: the message has a later step');
 await decide(j,fence,w,call('write','act',{capability:'walk:green'}));
 assert.equal(w.bodies.at(-1).body.for,'m_o');assert.equal(j.control.checkpoint().value.ownerLinkV1,undefined);
});

test('A1: a newer owner message replaces the link; an open answer keeps it; result and wait end it',async t=>{
 const {j,fence}=fixture(t);let open=true;const w=world(b=>({accepted:true,receipt:{id:'r_'+b.clientRef,phase:'started'},...(b.for?{for:b.for}:{}),...(b.for&&open?{open:true}:{})}));
 owner(j,'m_a');owner(j,'m_b');
 await decide(j,fence,w,call('write','act',{capability:'sit:bench'}));
 assert.equal(w.bodies.at(-1).body.for,'m_b','the newest incorporated owner message');
 assert.equal(j.control.checkpoint().value.ownerLinkV1,'m_b','open: a later step remains, the link stays');
 open=false;await decide(j,fence,w,call('write','act',{capability:'walk:balloon'}));
 assert.equal(w.bodies.at(-1).body.for,'m_b');assert.equal(j.control.checkpoint().value.ownerLinkV1,undefined);
 owner(j,'m_c');await decide(j,fence,w,call('write','result',{id:'m_c',outcome:'done',text:'Said hello back'}));
 assert.equal(j.control.checkpoint().value.ownerLinkV1,undefined,'the agent closed it itself');
 owner(j,'m_d');await decide(j,fence,w,call('wait','wait',{seconds:60}));
 assert.equal(j.control.checkpoint().value.ownerLinkV1,undefined,'choosing to wait ends it');
 await decide(j,fence,w,call('write','act',{capability:'wave'}));
 assert.equal(Object.hasOwn(w.bodies.at(-1).body,'for'),false,'a later self-started act does not close the old message');
});

test('A4: a refused link is a refusal observation, no retry, and the next act goes without it',async t=>{
 const {j,fence}=fixture(t);let writes=0;
 const w=world(b=>{writes++;return b.for?{status:400,json:{error:{code:'invalid',message:`no owner message ${b.for} for this Soul (it may be too old)`}}}:{accepted:true,receipt:{id:'r_ok',phase:'started'}};});
 owner(j,'m_old');
 const r=await decide(j,fence,w,call('write','act',{capability:'walk:field'}));
 assert.equal(r.response.accepted,false);assert.equal(r.response.error.status,400);assert.equal(writes,1);
 assert.equal(j.control.checkpoint().value.ownerLinkV1,undefined);
 const next=await decide(j,fence,w,call('write','act',{capability:'walk:field'}));
 assert.equal(next.response.accepted,true);assert.equal(Object.hasOwn(w.bodies.at(-1).body,'for'),false);
});

test('A1: a world refusal (accepted false) keeps the link for the next act; a restart replays the same for',async t=>{
 const {j,dir,fence}=fixture(t);let refuse=true;
 const w=world(b=>refuse?{accepted:false,code:'ride.unavailable',reason:'No matching ride is offered here.'}:{accepted:true,receipt:{id:'r_'+b.clientRef,phase:'started'},for:b.for});
 owner(j,'m_fly');
 await decide(j,fence,w,call('write','act',{capability:'fly:field'}));
 assert.equal(w.bodies.at(-1).body.for,'m_fly');assert.equal(j.control.checkpoint().value.ownerLinkV1,'m_fly');
 // Retain the recovery act, then lose the process before it is sent: the reopened journal sends the retained link.
 refuse=false;retainDecision(j,fence,call('write','act',{capability:'walk:field'}),{events:j.pending()});
 j.control.release(fence);j.close();
 const again=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>again.close());const next=again.control.claim('next');
 const r=await applyPendingDecision(again,next,w.client);
 assert.equal(r.response.accepted,true);assert.equal(w.bodies.at(-1).body.for,'m_fly');assert.equal(again.control.checkpoint().value.ownerLinkV1,undefined);
});
