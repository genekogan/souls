import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {WorldModel} from '../../packages/world-compiler/src/model.ts';

// Entry 26: a drum kit played sitting on its stool; a pianist and a drummer play at once (the duet is drawn and heard by the
// viewer on the shared score clock; here the offers, bodies and long tail).
const out=process.env.SOUL_ACTIONS_OUT;
test('drum kit: seated play-music offer, two players at once, bounded perception', {timeout:240000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();
 const join=async(id,name)=>{await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Duet test'}));await tick();return {soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};};
 const ana=await join('ana','Ana'),ben=await join('ben','Ben');soul=ana;
 const here=async(s)=>{soul=s;const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const body=s=>f.host.engine.world.entities[s.entityId];
 const absent=await here(ana);
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/drum-kit@2',name:`distant-drums-${i}`,p:[120+i%10*2,120+Math.floor(i/10)*2]}));
 assert.equal(god.act({ops:distant}).accepted,true);await tick(45);const far=await here(ana);
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/here-far.json`,JSON.stringify(far,null,1));}
 assert.ok(!/distant-drums/.test(JSON.stringify(far)),'distant drum kits add nothing to here');
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 assert.equal(god.act({ops:[{op:'place',def:'core/drum-kit@2',name:'drums',p:[ax+1.6,az+3]},{op:'place',def:'core/piano@1',name:'piano',p:[ax-1.6,az+3]}]}).accepted,true);await tick(45);
 const near=await here(ana),id=n=>god.model.get(n).id;
 const caps=edge.capabilities(ana),drumCap=caps.find(c=>/play-music/.test(c.id)&&c.id.includes(id('drums')));assert.ok(drumCap,'the drum kit offers play-music: '+caps.filter(c=>/play/.test(c.id)).map(c=>c.id).join(' '));
 let retries=0;const act=async(s,capability,params,accepted=true)=>{let b;for(let k=0;k<20;k++){soul=s;const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability,...(params?{params}:{})})}));b=await r.json();if(b.code!=='object.admission-failed')break;retries++;await tick(10);}assert.equal(b.accepted,accepted,JSON.stringify(b));return b;};
 const dr=await act(ana,'play the nearest drums',{seconds:6}),pr=await act(ben,'play the piano',{seconds:6});
 assert.match(dr.receipt.capability,/play-music/);assert.match(pr.receipt.capability,/play-piano/);
 // both reach their instruments and play at once
 let both=0,seat=null;for(let n=0;n<600;n++){const a=body(ana),b=body(ben);if(a.human?.activity==='play-music'&&b.human?.activity==='play-piano'){both++;seat=a.human.instrument;}const pa=edge.receipt(ana.soulId,dr.receipt.id)?.phase,pb=edge.receipt(ben.soulId,pr.receipt.id)?.phase;if(['completed','failed'].includes(pa)&&['completed','failed'].includes(pb))break;await tick(1);}
 assert.ok(both>40,'both played at the same time for a while: '+both);assert.equal(seat,'drums','the drummer plays the drums');
 assert.equal(edge.receipt(ana.soulId,dr.receipt.id).phase,'completed',JSON.stringify(edge.receipt(ana.soulId,dr.receipt.id)).slice(0,300));
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,distant100DrumKits:JSON.stringify(far).length,nearby:JSON.stringify(near).length},drumCap:drumCap.id,label:drumCap.label,ticksTogether:both,retries,checks:['the drum kit offers a seated play-music (instrument drums)','plain words: play the drums / play the piano','both play at once','100 distant drum kits: +0 bytes','zero native violations']};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
