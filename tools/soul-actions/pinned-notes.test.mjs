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

// Entry 19: several Souls pin signed notes on one board by hand; only a note's author takes it down; a reader gets them attributed.
const out=process.env.SOUL_ACTIONS_OUT;
test('pinned notes: several authors, author-only take-down, full board, attributed read, bounded context, persistence', {timeout:180000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();
 const join=async(id,name)=>{await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Notes test'}));await tick();return {soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};};
 const ana=await join('ana','Ana'),ben=await join('ben','Ben'),cy=await join('cy','Cy');soul=ana;
 const here=async(s)=>{soul=s;const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const bytes=h=>JSON.stringify(h).length,body=s=>f.host.engine.world.entities[s.entityId];
 const absent=await here(ana);
 // 100 distant boards full of notes: nothing reaches a Soul far away
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/notice-board@3',name:`distant-notes-${i}`,p:[120+i%10*3,120+Math.floor(i/10)*3],state:{text:`secret distant note ${i} — Zed`,textBy:'s_someone'}}));
 for(let i=0;i<100;i+=50)assert.equal(god.act({ops:distant.slice(i,i+50)}).accepted,true);await tick(45);
 const far=await here(ana);assert.ok(!/secret distant|distant-notes/.test(JSON.stringify(far)),'distant pinned boards add nothing to here');
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(ana).filter(c=>/secret distant/.test(c.label)||c.id.startsWith('read:')&&farIds.has(c.id.slice(5))||c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant board offers');
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 assert.equal(god.act({ops:[{op:'place',def:'core/notice-board@3',name:'notes',p:[ax,az+2.6],r:Math.PI},{op:'place',def:'core/notice-board@2',name:'old-board',p:[ax+3.4,az+2.6],r:Math.PI}]}).accepted,true);await tick(45);
 const id=n=>god.model.get(n).id,state=n=>god.model.get(n).state;
 const nearBlank=await here(ana);
 assert.ok(!edge.capabilities(ana).some(c=>c.id===`read:${id('notes')}`),'an empty pinboard offers no read');
 assert.ok(edge.capabilities(ana).some(c=>c.id===`object:${id('notes')}:pin`),'pin offered');
 assert.ok(!edge.capabilities(ana).some(c=>c.id===`object:${id('notes')}:unpin`&&c.available!==false),'unpin not offered with no note of yours');
 // "observe and retry": an admission can't commit while another body is mid make-way detour (a non-resumable snapshot; pre-existing engine limit)
 let retries=0;const act=async(s,capability,params,accepted=true)=>{let b;for(let k=0;k<20;k++){soul=s;const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability,...(params?{params}:{})})}));b=await r.json();if(b.code!=='object.admission-failed')break;retries++;await tick(10);}assert.equal(b.accepted,accepted,JSON.stringify(b));return b;};
 const finish=async(s,receipt,limit=600)=>{let stroke=null,early=false,before=JSON.stringify(state('notes'));for(let n=0;n<limit;n++){const m=body(s).human?.handActuator;if(m?.stroke){stroke=m.stroke;if((f.host.engine.world.tick-m.startTick)*f.host.engine.dt<0.65+m.stroke.seconds-0.05&&JSON.stringify(state('notes'))!==before)early=true;}const ph=edge.receipt(s.soulId,receipt.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}return {stroke:stroke&&{kind:stroke.kind,seconds:stroke.seconds},early,phase:edge.receipt(s.soulId,receipt.receipt.id).phase};};
 // A body program used to fail at once when its body was mid courtesy step-aside for someone else (walk.ts make-way).
 // The runtime now waits that out for any verb; the retry stays only as a counter, asserted zero below (#424 F7).
 let makeWayRetries=0;const done=async(s,capability,params)=>{for(let k=0;;k++){const r=await act(s,capability,params);const fr=await finish(s,r),rc=edge.receipt(s.soulId,r.receipt.id);if(fr.phase==='failed'&&rc.code==='reservation.conflict'&&/:make-way:\d+/.test(rc.reason??'')&&k<3){makeWayRetries++;await tick(30);continue;}assert.equal(fr.phase,'completed',capability+' '+JSON.stringify(rc).slice(0,500));return fr;}};
 // validation
 for(const [text,why] of [['','required'],['x'.repeat(61),'too long'],['two\nlines','one line'],['bell\u0007','control']]){const b=await act(ana,'object:notes:pin',{text},false);assert.equal(b.code,'capability.params',why);}
 const notes=()=>{const s=state('notes');return {lines:s.text?s.text.split('\n'):[],by:s.textBy?s.textBy.split(','):[]};};
 // three Souls pin: each note appears only at the end of its stroke, signed, in order
 const runs=[];
 for(const [s,text] of [[ana,'Picnic at noon by the pond'],[ben,'Lost: a blue scarf, near the well'],[cy,'Choir practice, dusk, all welcome'],[ana,'Bring fruit if you can']]){const fr=await done(s,'object:notes:pin',{text});assert.equal(fr.early,false,'no note before the stroke ends');runs.push(fr);}
 assert.deepEqual(notes().lines,['Picnic at noon by the pond — Ana','Lost: a blue scarf, near the well — Ben','Choir practice, dusk, all welcome — Cy','Bring fruit if you can — Ana']);
 assert.deepEqual(notes().by,[ana.soulId,ben.soulId,cy.soulId,ana.soulId]);
 // per-Soul limit (2) and the authorship rule
 const third=await act(ana,'object:notes:pin',{text:'one too many'},false);assert.match(third.reason??'',/already have 2/);
 // Ben can take down only his own; Cy's note stays
 const bd=await done(ben,'object:notes:unpin');assert.equal(bd.phase,'completed');assert.equal(bd.stroke.kind,'wipe');
 assert.deepEqual(notes().lines,['Picnic at noon by the pond — Ana','Choir practice, dusk, all welcome — Cy','Bring fruit if you can — Ana']);
 const benAgain=await act(ben,'object:notes:unpin',undefined,false);assert.match(benAgain.reason??'',/only its author/);
 // Ana takes down her latest note, not her first
 await done(ana,'object:notes:unpin');assert.deepEqual(notes().lines,['Picnic at noon by the pond — Ana','Choir practice, dusk, all welcome — Cy']);
 // fill the board: six notes, the seventh is refused with a reason
 for(const [s,text] of [[ben,'Fresh bread at the bakery'],[cy,'Swap books on Sunday'],[ana,'Thank you for the picnic'],[ben,'Kite flying, windy hill']])await done(s,'object:notes:pin',{text});
 assert.equal(notes().lines.length,6);
 const dan=await join('dan','Dan');const full=await act(dan,'object:notes:pin',{text:'room for me?'},false);assert.match(full.reason??'',/full/);
 // reading: a fourth Soul gets the notes attributed and untrusted, never in its ambient frame or the offer
 const danHere=await here(dan);assert.ok(!JSON.stringify(danHere).includes('Picnic'),'no words in here');
 const readCap=edge.capabilities(dan).find(c=>c.id===`read:${id('notes')}`);assert.ok(readCap,'read offered');assert.match(readCap.label,/6 pinned notes/);assert.ok(!readCap.label.includes('Picnic'));
 const rd=await act(dan,`read:${id('notes')}`);assert.equal((await finish(dan,rd)).phase,'completed');
 const outcome=edge.receipt(dan.soulId,rd.receipt.id).outcome;
 assert.match(outcome.summary,/6 notes, by Ana, Cy and Ben/);assert.equal(outcome.untrusted,true);
 assert.equal(outcome.learned.length,3,'one learned fact per author');assert.match(outcome.learned[0].fact,/^Ana's notes on .* read: "Picnic at noon by the pond" \/ "Thank you for the picnic"$/);assert.equal(outcome.learned[1].provenance,'soul-text');
 assert.deepEqual(outcome.detail.sign.notes.map(n=>n.writtenBy.name),['Ana','Cy','Ben','Cy','Ana','Ben']);
 const nearFull=await here(ana);
 // entry 13's notice-board@2 still writes and wipes as before
 await done(ana,'object:old-board:write',{text:'Old board still works'});assert.equal(state('old-board').text,'Old board still works');
 // persistence
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);
 assert.equal(restored.get('notes').state.text,state('notes').text);assert.equal(restored.get('notes').state.textBy,state('notes').textBy);
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 // the runtime waits out a live courtesy step-aside for any verb (runtime admit, make-way-wait.test.ts; #424 F7): never retried
 assert.equal(makeWayRetries,0,'no body program failed on another body\'s step-aside');
 const report={status:'pass',admissionRetries:retries,makeWayRetries,hereBytes:{absent:bytes(absent),distant100Pinned:bytes(far),nearEmptyBoard:bytes(nearBlank),nearFullBoard:bytes(nearFull)},
  readSummary:outcome.summary,learned:outcome.learned.map(l=>l.fact),strokes:runs,board:notes().lines,
  checks:['validation (empty, >60, two lines, control)','four pins by three Souls, signed, in order','no note before the stroke ends','two notes per Soul','others cannot take a note down','author takes down own latest','full board refuses a seventh','read offer names the count, no words','read: attributed, untrusted, one learned fact per author, every note in detail','no words in a reader\'s here','notice-board@2 unchanged','snapshot persistence','distant pinned boards add nothing','zero native violations'],
  limitation:'Deterministic native fake-brain test; the look of the cards and hands is judged from the real-client video.'};
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));writeFileSync(`${out}/pinned.json`,JSON.stringify(god.model.snapshot()));}
 console.log(JSON.stringify(report));
});
