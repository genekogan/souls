import test from'node:test';import assert from'node:assert/strict';import{DatabaseSync}from'node:sqlite';
import{Together,type TogetherPort,type Invite}from'./edge/ledger/together.ts';
import type{EdgeSoul,EdgeCapability}from'./edge/contract.ts';
import{emptyWorld,human,addAll}from'../../../mars/viewer/engine/world/factory.ts';
import{provingGround}from'../../../mars/viewer/engine/scenes/proving-ground.ts';
import{itemEntity,putInHand}from'../../../mars/viewer/engine/items/model.ts';
function fixture(t:{after(fn:()=>void):void}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const item=itemEntity('bowl','bowl',[-5.55,.94,-5.93]);item.tags=['entity-world','entity-world-item-pose'];putInHand(item,'a','right');
 const world=addAll(emptyWorld('proving-ground',provingGround()),human('a',-6,-6),human('b',-5.1,-6,{yaw:Math.PI}),item),a:EdgeSoul={soulId:'s_a',entityId:'a',name:'A',owner:'synthetic:a'},b:EdgeSoul={soulId:'s_b',entityId:'b',name:'B',owner:'synthetic:b'},host={worldId:'handover-policy-fixture',engine:{world},minds:new Map([['s_a',a],['s_b',b]])};
 const port={host,db:{db},places:{byId:new Map()},spots:()=>({spots:[],shelves:[]}),body:(id:string)=>world.entities[id],faded:()=>false,receipt:()=>null,aboard:()=>null,deliver:()=>{},spectate:()=>{},touch:()=>{}}as unknown as TogetherPort;
 const together=new Together(port),make=()=>{
  const steps=[{verb:'mars:hand_over_v1',params:{mode:'offer',partner:'b',item:'bowl',waitSeconds:40}}];
  const prepared=together.prepare(a,{id:'give:s_b:bowl'}as EdgeCapability,{label:'Give B the bowl',steps,together:{kind:'hand-over',guest:'s_b',item:'bowl',name:'bowl',custodyPolicy:'same-tick-v1'}},{},steps);assert.ok('steps'in prepared,JSON.stringify(prepared));prepared.commit!('r_host');
  const inv=JSON.parse((db.prepare('SELECT body FROM edge_invites_v1').get()as{body:string}).body)as Invite;return{prepared,inv};
 };
 const write=(inv:Invite)=>db.prepare('UPDATE edge_invites_v1 SET body=? WHERE invite_id=?').run(JSON.stringify(inv),inv.id);
 return{together,b,make,write,restart:()=>new Together(port)};
}
test('new handover freezes same-tick policy on offer, invitation and accepted body plan',t=>{
 const f=fixture(t),{prepared,inv}=f.make();const old=structuredClone(inv);delete old.custodyPolicy;const oldSteps=structuredClone(prepared.steps);for(const step of oldSteps)delete step.params.custodyPolicy;console.log(JSON.stringify({activeInviteBytes:Buffer.byteLength(JSON.stringify(inv)),withoutMarkerInviteBytes:Buffer.byteLength(JSON.stringify(old)),activeOfferPlanMarkerDeltaBytes:Buffer.byteLength(JSON.stringify(prepared.steps))-Buffer.byteLength(JSON.stringify(oldSteps))}));assert.equal(inv.custodyPolicy,'same-tick-v1');assert.equal(prepared.steps.find(s=>s.verb==='mars:hand_over_v1')!.params.custodyPolicy,'same-tick-v1');
 const accepted=f.restart().acceptPlan(f.b,inv.id,[],new Map());assert.ok('steps'in accepted,JSON.stringify(accepted));assert.equal(accepted.steps.find(s=>s.verb==='mars:hand_over_v1')!.params.custodyPolicy,'same-tick-v1');
});
test('old persisted handover after restart keeps absent policy and identical public projection',t=>{
 const f=fixture(t),{inv}=f.make(),marked=f.together.observe(f.b);delete inv.custodyPolicy;f.write(inv);const restarted=f.restart(),old=restarted.observe(f.b);assert.deepEqual(old,marked,'no new here/observer fields for policy');
 const accepted=restarted.acceptPlan(f.b,inv.id,[],new Map());assert.ok('steps'in accepted,JSON.stringify(accepted));assert.equal('custodyPolicy'in accepted.steps.find(s=>s.verb==='mars:hand_over_v1')!.params,false,'current code cannot upgrade stored old invitation');
});
