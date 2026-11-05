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

// #431 (music family, entry 1): a record player. A Soul puts on the record she picks at the tonearm and stops it at the power
// knob, by hand; the record and power change only at contact.
const out=process.env.SOUL_ACTIONS_OUT;
const SLEEVES=['Morning Waltz','Harbour Lights','Low Tide','Night Train'];
test('record player: pick a record at the tonearm, stop at the knob, refusal, interruption, persistence, bounded perception', {timeout:180000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Record player test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const absent=await here();
 // 100 distant record players, all playing, records mixed: nothing of them reaches this Soul
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/record-player@1',name:`distant-player-${i}`,p:[120+i%10*2,120+Math.floor(i/10)*2],state:{on:true,record:SLEEVES[i%4]}}));
 assert.equal(god.act({ops:distant}).accepted,true);await tick(45);const far=await here();
 const strip=h=>JSON.stringify(h).replace(/"(tick|t|at|now|time|clock)":[^,}]*/g,'');
 assert.equal(strip(far),strip(absent),'distant record players add nothing to here');assert.ok(!/record/i.test(JSON.stringify(far)),'no distant record player in here');
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(soul).filter(c=>c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant record player offers');
 const body=()=>f.host.engine.world.entities[soul.entityId],[ax,az]=[body().pose.p[0],body().pose.p[2]];
 assert.equal(god.act({ops:[{op:'place',def:'core/record-player@1',name:'player',p:[ax+0.3,az-1.6],r:0},{op:'place',def:'core/radio@2',name:'radio',p:[ax-2.2,az-1.6],r:0}]}).accepted,true);await tick(45);
 const state=n=>god.model.get(n).state??{},id=n=>god.model.get(n).id;
 const part=tint=>{const e=god.model.get('player'),def=god.model.resolvedDef(e.def),wp=god.model.worldPose(e),s=def.make.args.shapes.find(x=>x.tint===tint),c=Math.cos(wp.yaw),sn=Math.sin(wp.yaw),[x,y,z]=s.at;return [wp.x+x*c+z*sn,wp.y+y,wp.z-x*sn+z*c];};
 const near=await here(),row0=near.objects.find(o=>o.id===id('player'));
 assert.deepEqual(row0?.state,{on:false},'an off record player shows only that it is off');
 const offer=edge.capabilities(soul).find(c=>c.id===`object:${id('player')}:put-on-record`);
 assert.ok(offer,'put-on-record is offered');assert.match(JSON.stringify(offer.params??offer),/Morning Waltz, Harbour Lights, Low Tide, Night Train/,'the offer lists the sleeves');
 const act=async(cap,accepted=true,params)=>{const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:cap,...(params?{params}:{})})}));const b=await r.json();assert.equal(b.accepted,accepted,JSON.stringify(b));return b;};
 const finish=async(r,field,want,limit=600)=>{let motion=null,early=false,root=null;for(let n=0;n<limit;n++){const m=body().human?.handActuator;if(m){motion=m;root=[...body().pose.p];if((f.host.engine.world.tick-m.startTick)*f.host.engine.dt<(m.reach??0.65)-0.05&&state('player')[field]===want)early=true;}const ph=edge.receipt(soul.soulId,r.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}return {motion,early,root,phase:edge.receipt(soul.soulId,r.receipt.id)?.phase};};
 // refused: stopping an off player, an unknown record, no record named
 const stopOff=await act('object:player:switch-off',false);
 assert.match(JSON.stringify(stopOff),/object\.state/);assert.match(JSON.stringify(stopOff),/is off/,'stopping an off record player is refused as off');
 const unknown=await act('object:player:put-on-record',false,{record:'Abbey Road'});
 assert.match(JSON.stringify(unknown),/capability\.params/);assert.match(JSON.stringify(unknown),/Morning Waltz, Harbour Lights, Low Tide, Night Train/,'the refusal lists the sleeves');
 await tick(30);assert.equal(state('player').on??false,false,'a refused pick changes nothing');assert.equal(body().human?.handActuator,undefined,'nothing moved');
 // interruption before contact: nothing changes
 const cut=await act('object:player:put-on-record',true,{record:'Low Tide'});for(let n=0;n<300&&!body().human?.handActuator;n++)await tick(1);assert.ok(body().human?.handActuator,'the reach started');await tick(4);await accept(f.host,edge.act(soul,{capability:'stand:here'}));await tick(60);
 assert.equal(state('player').on??false,false,'interrupted before contact: the record player stays off');
 assert.ok(['replaced','cancelled'].includes(edge.receipt(soul.soulId,cut.receipt.id)?.phase),'the interrupted act ends replaced');assert.notEqual(state('player').record,'Low Tide','and the picked record was not set');
 const results=[];
 const run=async(cap,field,want,tint,params)=>{
  const before=state('player')[field],r=await act(cap,true,params);assert.equal(state('player')[field],before,'admission changes nothing remotely');
  const x=await finish(r,field,want);
  assert.equal(x.phase,'completed',JSON.stringify(edge.receipt(soul.soulId,r.receipt.id)).slice(0,400));assert.ok(x.motion,'actual hand contact ran');assert.equal(x.early,false,'no change before contact');
  assert.equal(state('player')[field],want);
  const k=part(tint),d=Math.hypot(...x.motion.at.map((v,i)=>v-k[i]));assert.ok(d<0.01,`the hand goes to the ${tint} part (${d.toFixed(3)} m)`);
  assert.equal(body().human?.handActuator,undefined);
  results.push({cap,params:params??null,want,part:tint,hold:x.motion.hold??0,handAt:x.motion.at.map(v=>+v.toFixed(3)),root:x.root.map(v=>+v.toFixed(3))});return x;
 };
 await run('object:player:put-on-record','record','Low Tide','tuner',{record:'Low Tide'});
 assert.equal(state('player').on,true);
 const onRow=(await here()).objects.find(o=>o.id===id('player'));assert.deepEqual(onRow?.state,{on:true,record:'Low Tide'},'on: the record in a few words');
 // the pick is the Soul's (any sleeve, case and spacing forgiven), not a cycle
 await run('object:player:put-on-record','record','Night Train','tuner',{record:'  night TRAIN '});
 await run('object:player:put-on-record','record','Morning Waltz','tuner',{record:'Morning Waltz'});
 // plain words the way a Soul says them
 const resolve=async(w,params={})=>{const r=await (await app.request('/v1/edge/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:w,params})})).json();return r.resolve?.would?.capability??r.resolve?.code??JSON.stringify(r).slice(0,200);};
 const words={};for(const w of ['put on a record','play a record','put a record on','play a record on the record player','stop the record player','turn off the record player'])words[w]=await resolve(w,/^(stop|turn)/.test(w)?{}:{record:'Harbour Lights'});
for(const w of ["put on a record","play a record","put a record on","play a record on the record player"])assert.equal(words[w],`object:${id('player')}:put-on-record`,`"${w}": ${words[w]}`);
 assert.equal(words['stop the record player'],`object:${id('player')}:switch-off`);
 const nearOn=await here();
 await run('object:player:switch-off','on',false,'valve');
 assert.equal(state('player').record,'Morning Waltz','the record stays on the platter');
 const offRow=(await here()).objects.find(o=>o.id===id('player'));assert.deepEqual(offRow?.state,{on:false});
 // power and the tonearm are worked from one place
 const roots=results.map(r=>r.root),spread=Math.max(...roots.map(p=>Math.hypot(p[0]-roots[0][0],p[2]-roots[0][2])));
 assert.ok(spread<0.06,`one stand point for the tonearm and the knob (${spread.toFixed(3)} m) ${JSON.stringify(results)}`);
 // the radio beside it keeps its own offers (radio.test.mjs covers its knobs)
 const radioOffers=edge.capabilities(soul).filter(c=>c.object===id('radio')).map(c=>c.id.split(':').at(-1));
 assert.ok(radioOffers.includes('switch-on')&&!radioOffers.includes('put-on-record'),`radio offers unchanged: ${radioOffers}`);
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);
 assert.equal(restored.get('player').state.on,false);assert.equal(restored.get('player').state.record,'Morning Waltz');
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 const report={status:'pass',plainWords:words,refusals:{stopOff:stopOff.code??stopOff.refusal?.code??null,stopOffReason:JSON.stringify(stopOff).slice(0,300),unknown:JSON.stringify(unknown).slice(0,400)},hereBytes:{absent:JSON.stringify(absent).length,distant100Players:JSON.stringify(far).length,nearbyOff:JSON.stringify(near).length,nearbyOn:JSON.stringify(nearOn).length},rows:{off:row0,on:onRow},standSpread:+spread.toFixed(3),results};
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));}console.log(JSON.stringify(report));
});
