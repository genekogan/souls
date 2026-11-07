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

// Entry 25: a chalkboard menu, a sign-up sheet and a poll, by hand and by plain words; several Souls; reads; long tail.
const out=process.env.SOUL_ACTIONS_OUT;
test('public boards II: chalkboard, sign-up sheet, poll', {timeout:300000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();
 const join=async(id,name)=>{await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Boards test'}));await tick();return {soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};};
 const ana=await join('ana','Ana'),ben=await join('ben','Ben'),cy=await join('cy','Cy');soul=ana;
 const here=async(s)=>{soul=s;const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const body=s=>f.host.engine.world.entities[s.entityId];
 const absent=await here(ana);
 const distant=Array.from({length:300},(_,i)=>{const k=i%3,p=[120+i%15*3,120+Math.floor(i/15)*3];return k===0?{op:'place',def:'core/chalkboard@2',name:`distant-chalk-${i}`,p,state:{text:'secret soup of the day',textBy:'s_x'}}:k===1?{op:'place',def:'core/signup-sheet@1',name:`distant-sheet-${i}`,p,state:{title:'secret club',text:'Zed\nYan',textBy:'s_z,s_y'}}:{op:'place',def:'core/poll-board@1',name:`distant-poll-${i}`,p,state:{title:'secret question?',options:'Red|Blue',text:'Red — 1 vote\nBlue — 0 votes',textBy:'s_z:0'}};});
 for(let i=0;i<300;i+=100){const r=god.act({ops:distant.slice(i,i+100)});assert.equal(r.accepted,true,JSON.stringify(r).slice(0,300));}await tick(45);
 const far=await here(ana);assert.ok(!/secret|distant-/.test(JSON.stringify(far)),'distant boards add nothing to here');
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(ana).filter(c=>/secret/.test(c.label)||c.id.startsWith('read:')&&farIds.has(c.id.slice(5))||c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant board offers');
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 assert.equal(god.act({ops:[{op:'place',def:'core/chalkboard@2',name:'menu',p:[ax-2.4,az+2.6],r:Math.PI},{op:'place',def:'core/signup-sheet@1',name:'sheet',p:[ax,az+2.6],r:Math.PI,state:{title:'Volleyball at five'}},{op:'place',def:'core/poll-board@1',name:'poll',p:[ax+2.6,az+2.6],r:Math.PI,state:{title:'Lunch tomorrow?',options:'Soup|Salad|Sandwich'}}]}).accepted,true);await tick(45);
 const id=n=>god.model.get(n).id,state=n=>god.model.get(n).state;
 const near=await here(ana);if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/here-near.json`,JSON.stringify(near,null,1));}
 let retries=0;const act=async(s,capability,params,accepted=true)=>{let b;for(let k=0;k<20;k++){soul=s;const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability,...(params?{params}:{})})}));b=await r.json();if(b.code!=='object.admission-failed')break;retries++;await tick(10);}assert.equal(b.accepted,accepted,JSON.stringify(b));return b;};
 let watch='sheet';const finish=async(s,receipt,limit=600)=>{let stroke=null,early=false,before=JSON.stringify(state(watch));for(let n=0;n<limit;n++){const m=body(s).human?.handActuator;if(m?.stroke){stroke=m.stroke;if((f.host.engine.world.tick-m.startTick)*f.host.engine.dt<0.65+m.stroke.seconds-0.05&&JSON.stringify(state(watch))!==before)early=true;}const ph=edge.receipt(s.soulId,receipt.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}return {stroke:stroke&&{kind:stroke.kind,seconds:stroke.seconds},early,phase:edge.receipt(s.soulId,receipt.receipt.id).phase};};
 let makeWayRetries=0;const done=async(s,capability,params)=>{for(let k=0;;k++){const r=await act(s,capability,params);const fr=await finish(s,r),rc=edge.receipt(s.soulId,r.receipt.id);if(fr.phase==='failed'&&rc.code==='reservation.conflict'&&/:make-way:\d+/.test(rc.reason??'')&&k<3){makeWayRetries++;await tick(30);continue;}assert.equal(fr.phase,'completed',capability+' '+JSON.stringify(rc).slice(0,500));return fr;}};
 const on=(name,s,words,params)=>{watch=name;return done(s,words,params);};
 const read=async(s,name)=>{const r=await act(s,`read:${id(name)}`);await finish(s,r);return edge.receipt(s.soulId,r.receipt.id);};
 // chalkboard menu: the whiteboard contract in chalk
 const w=await on('menu',ana,'write on the chalkboard',{text:'Soup 3\nBread 2\nTea 1'});assert.equal(w.early,false);assert.equal(state('menu').text,'Soup 3\nBread 2\nTea 1');
 // sign-up: own name, one each, only the signer crosses off
 for(const [s,words] of [[ana,'sign the sign-up sheet'],[ben,'sign up on the sign-up sheet']]){const fr=await on('sheet',s,words);assert.equal(fr.early,false,'no name before the stroke ends');}
 assert.equal(state('sheet').text,'Ana\nBen');
 const again=await act(ana,'sign the sign-up sheet',undefined,false);assert.match(again.reason??'',/already on this sheet/);
 const notMine=await act(cy,'cross off my name on the sign-up sheet',undefined,false);assert.ok(/not on this sheet|not-yours|No .*capability|offered/i.test((again.reason??'')+(notMine.reason??'')+notMine.code),JSON.stringify(notMine));
 const off=await on('sheet',ben,'cross off my name on the sign-up sheet');assert.equal(off.stroke.kind,'wipe');assert.equal(state('sheet').text,'Ana');
 await on('sheet',cy,'sign the sign-up sheet');assert.equal(state('sheet').text,'Ana\nCy');assert.deepEqual(state('sheet').textBy,`${ana.soulId},${cy.soulId}`);
 // poll: one vote each, a new vote moves it, unknown choices refused with the options
 await on('poll',ana,'vote on the poll',{choice:'soup'});await on('poll',ben,'vote on the poll',{choice:'Salad'});
 const bad=await act(cy,'vote on the poll',{choice:'tea'},false);assert.match(bad.reason??'',/Soup, Salad, Sandwich/);
 await on('poll',cy,'vote on the poll',{choice:'sand'});
 const moved=await on('poll',ana,'vote on the poll',{choice:'salad'});assert.equal(moved.early,false);
 assert.equal(state('poll').text,'Soup — 0 votes\nSalad — 2 votes\nSandwich — 1 vote');
 const same=await act(ana,'vote on the poll',{choice:'salad'},false);assert.match(same.reason??'',/already voted for Salad/);
 // reads: counts in the offers, the words only with the read
 const caps=edge.capabilities(ben);const label=n=>caps.find(c=>c.id===`read:${id(n)}`)?.label??'';
 assert.match(label('poll'),/a poll, 3 votes/);assert.match(label('sheet'),/a sign-up sheet, 2 names/);assert.ok(!/Ana|Salad|Lunch/.test(label('poll')+label('sheet')),'offers carry counts, not words');
 const rp=await read(ben,'poll'),rs=await read(ben,'sheet'),rm=await read(ben,'menu');
 assert.match(rp.outcome?.summary??JSON.stringify(rp),/Lunch tomorrow\?.*Salad — 2 votes/);assert.match(rs.outcome?.summary??JSON.stringify(rs),/Volleyball at five.*1\. Ana.*2\. Cy/);assert.match(rm.outcome?.summary??JSON.stringify(rm),/Soup 3/);
 // #429: a sign-up sheet's names are the signers' own: untrusted, attributed
 assert.equal(rs.outcome.untrusted,true);assert.equal(rs.outcome.detail.sign.provenance,'soul-text');assert.equal(rs.outcome.detail.sign.entries.length,2);
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);assert.equal(restored.get('poll').state.textBy.split(',').length,3);assert.equal(restored.get('sheet').state.text,'Ana\nCy');
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 const nearFull=await here(ana);
 // the runtime waits out a live courtesy step-aside for any verb (runtime admit, make-way-wait.test.ts; #424 F7): never retried
 assert.equal(makeWayRetries,0,'no body program failed on another body\'s step-aside');
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,distant300:JSON.stringify(far).length,nearby:JSON.stringify(near).length,nearbyFilled:JSON.stringify(nearFull).length},retries,makeWayRetries,poll:state('poll').text,sheet:state('sheet').text,reads:{poll:rp.outcome?.summary,sheet:rs.outcome?.summary,menu:rm.outcome?.summary},checks:['chalkboard written by hand in words','sign-up: own name, one each, signer-only cross-off','poll: one vote each, a new vote moves it, unknown choice lists the options','nothing changes before the stroke ends','read offers carry counts, never names or words','reads name the title and the lines','300 distant filled boards: +0 bytes, no offers, no words','snapshot persistence','zero native violations']};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
