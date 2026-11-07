import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture,invite,accept,factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';

// #1086: a relocated body that then reaches must not trip motion.overspeed (it published 0 m/s in `reach`), and after an edge
// fault recovery every other Soul's open receipt follows its replayed programme or ends truthfully, never started forever.
const ITEM='core/bowl@2';
async function world(t,names=['Ana']){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono();let current;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>current});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 const bridge=installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};await tick();
 const souls={};for(const name of names){const id=name.toLowerCase();await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Repair test'}));souls[name]={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();}
 const W=()=>f.host.engine.world,body=s=>W().entities[s.entityId],named=n=>[...god.model.entities.values()].find(e=>e.name===n);
 const here=async s=>{current=s;const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const act=(s,capability,params)=>accept(f.host,edge.act(s,{capability,...(params?{params}:{})}));
 const receipt=(s,b)=>edge.receipt(s.soulId,b.receipt.id);
 const ended=(s,b)=>['completed','failed','cancelled','replaced'].includes(receipt(s,b)?.phase);
 const until=async(cond,limit=2400)=>{for(let n=0;n<limit;n++){if(cond())return n;await tick(1);}return -1;};
 const finish=async(s,b)=>{assert.ok(await until(()=>ended(s,b))>=0,'the receipt ends');return receipt(s,b);};
 const place=ops=>{const r=god.act({ops});assert.equal(r.accepted,true,JSON.stringify(r.failures?.slice(0,3)));};
 const relocate=async(s,x,z)=>{await accept(f.host,f.host.enqueue('edge-relocate','edge:'+s.soulId,{soulId:s.soulId,entityId:s.entityId,to:[x,z],why:'test placement'}));await tick(6);};
 return {f,edge,god,bridge,tick,souls,W,body,named,here,act,receipt,until,finish,place,relocate};
}
const strip=h=>JSON.stringify(h).replace(/"(tick|t|at|now|time|clock)":[^,}]*/g,'');
const refused=b=>JSON.stringify(b);


test('a relocated body reaches without a fault, while another Soul walks to fetch at the same time',{timeout:300000},async t=>{
 const w=await world(t,['Ana','Ben']),{souls:{Ana:ana,Ben:ben},tick,act,place,named,body,W,relocate,until,receipt}=w;await tick(10);
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 await relocate(ben,ax+4,az+4);
 place([{op:'place',def:ITEM,name:'near',p:[ax+4.6,az+4]},{op:'place',def:ITEM,name:'far',p:[ax-5,az-4]}]);await tick(30);
 const g=await act(ben,'pick-up:'+named('near').id),b=await act(ana,'pick-up:'+named('far').id);
 assert.ok(await until(()=>['completed','failed'].includes(receipt(ana,b)?.phase)&&['completed','failed'].includes(receipt(ben,g)?.phase),1500)>=0,'both end');
 assert.equal(receipt(ben,g).phase,'completed',JSON.stringify(receipt(ben,g)).slice(0,300));assert.equal(receipt(ana,b).phase,'completed',JSON.stringify(receipt(ana,b)).slice(0,300));
 const rec=w.f.db.db.prepare("SELECT payload FROM events WHERE kind='rules'").all().map(r=>JSON.parse(r.payload).recovery).filter(Boolean);
 assert.deepEqual(rec,[],'no fault was recovered');assert.equal(W().entities[named('near').id].support?.by,ben.entityId);assert.equal(W().entities[named('far').id].support?.by,ana.entityId);
});

test('after an edge recovery, another Soul\'s open receipt follows its programme\'s new id, or ends truthfully when none runs',{timeout:300000},async t=>{
 const w=await world(t,['Ana','Ben']),{souls:{Ana:ana,Ben:ben},tick,act,place,named,body,until,receipt,edge,f}=w;await tick(10);
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 place([{op:'place',def:ITEM,name:'far',p:[ax-6,az-4]}]);await tick(30);
 const b=await act(ana,'pick-up:'+named('far').id);assert.ok(await until(()=>!!f.host.engine.programOf(ana.entityId),200)>=0,'her programme runs');
 const live=f.host.engine.programOf(ana.entityId),stale=live+'-before';
 // what a replay leaves: the receipt names the programme id it had before the recovery
 f.db.db.prepare('UPDATE edge_receipts_v1 SET program_id=? WHERE receipt_id=?').run(stale,b.receipt.id);
 edge.onRecovery({kind:'rules',payload:{recovery:{edge:{souls:[ben.soulId]}}}});
 assert.equal(f.db.db.prepare('SELECT program_id FROM edge_receipts_v1 WHERE receipt_id=?').get(b.receipt.id).program_id,live,'it follows the running programme');
 assert.ok(await until(()=>receipt(ana,b)?.phase==='completed',1500)>=0,JSON.stringify(receipt(ana,b)).slice(0,300));
 // with nothing running for it any more, it ends with a named code instead of staying started
 const c=await act(ana,'put-down:here');assert.ok(await until(()=>!!f.host.engine.programOf(ana.entityId),200)>=0);
 f.db.db.prepare('UPDATE edge_receipts_v1 SET program_id=? WHERE receipt_id=?').run('p-gone',c.receipt.id);
 const cur=f.host.engine.programOf(ana.entityId);f.host.engine.byActor.delete(ana.entityId);
 edge.onRecovery({kind:'rules',payload:{recovery:{edge:{souls:[ben.soulId]}}}});f.host.engine.byActor.set(ana.entityId,cur);
 assert.equal(receipt(ana,c).phase,'failed');assert.equal(receipt(ana,c).code,'engine.fault-recovered',JSON.stringify(receipt(ana,c)).slice(0,300));
});
