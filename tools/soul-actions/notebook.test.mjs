import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {compactDoHere} from '../../apps/server/src/edge/perception/here.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {EDEN_LIBRARY_CATALOGUE} from '../../apps/server/src/edge/content/eden-library-catalogue.ts';
import {WorldModel, LECTERN_BOOKS} from '../../packages/world-compiler/src/index.ts';

// #428 books and notebooks: a lectern that holds a catalogue book reads it a passage at a time (W016); a notebook on a
// lectern takes one signed line per stroke by hand and another Soul reads the lines later (W017, the pinboard faculty).
const out=process.env.SOUL_ACTIONS_OUT;
test('lectern catalogue books and the notebook stand: real text, hand-written signed lines, attributed read, bounded context, persistence', {timeout:240000}, async t=>{
 // a god's world (world lore on): reading elsewhere reads the constitution, so a lectern book is visibly not that
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:true,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();
 const join=async(id,name)=>{await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Notebook test'}));await tick();return {soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};};
 const ana=await join('ana','Ana'),ben=await join('ben','Ben'),cy=await join('cy','Cy');soul=ana;
 const here=async(s)=>{soul=s;const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const bytes=h=>JSON.stringify(h).length,body=s=>f.host.engine.world.entities[s.entityId];
 const words=async(s,w)=>{soul=s;const r=await (await app.request('/v1/edge/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:w,params:{}})})).json();return r.resolve?.would?.capability??r.resolve?.code??JSON.stringify(r).slice(0,200);};
 // the lectern's book list is the catalogue's
 assert.deepEqual(LECTERN_BOOKS.slice(1),EDEN_LIBRARY_CATALOGUE.map(b=>b.id),'core-lectern@2 book values = the catalogue ids');
 const absent=await here(ana);
 // 100 distant written notebooks and 100 distant book lecterns: nothing reaches a Soul far away
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/notebook-stand@1',name:`distant-notebook-${i}`,p:[120+i%10*3,120+Math.floor(i/10)*3],state:{text:`secret distant line ${i} — Zed`,textBy:'s_someone'}}))
  .concat(Array.from({length:100},(_,i)=>({op:'place',def:'core/lectern@2',name:`distant-lectern-${i}`,p:[120+i%10*3,160+Math.floor(i/10)*3],params:{book:'book:pond-mirror'}})));
 for(let i=0;i<distant.length;i+=50)assert.equal(god.act({ops:distant.slice(i,i+50)}).accepted,true);await tick(45);
 const far=await here(ana);assert.ok(!/secret distant|distant-notebook|distant-lectern|Pond That Would/.test(JSON.stringify(far)),'distant notebooks and lecterns add nothing to here');
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(ana).filter(c=>/secret distant|Pond That Would/.test(c.label)||[...farIds].some(id=>c.id.includes(id))||c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant offers');
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 assert.equal(god.act({ops:[
  {op:'place',def:'core/notebook-stand@1',name:'notebook',p:[ax,az+2.6],r:Math.PI},
  {op:'place',def:'core/lectern@2',name:'oak-lectern',p:[ax+3.2,az+2.6],r:Math.PI,params:{book:'book:tea-cup'}},
  {op:'place',def:'core/lectern@1',name:'old-lectern',p:[ax-3.2,az+2.6],r:Math.PI},
  {op:'place',def:'core/notebook-stand@1',name:'private-journal',p:[ax-3.2,az-2.6],owner:'soul:someone-else',access:'private'}]}).accepted,true);
 assert.equal(god.act({ops:[{op:'place',def:'core/lectern@2',name:'bad-lectern',p:[ax+6,az-2],params:{book:'book:not-a-book'}}]}).accepted,false,'an unknown book is refused at placement');
 await tick(45);
 const id=n=>god.model.get(n).id,state=n=>god.model.get(n).state;
 const nearBlank=await here(ana);
 // ---- W017: the notebook
 assert.ok(!edge.capabilities(ana).some(c=>c.id===`read:${id('notebook')}`),'a blank notebook offers no read');
 const pinCap=edge.capabilities(ana).find(c=>c.id===`object:${id('notebook')}:pin`);assert.ok(pinCap,'write offered');assert.match(pinCap.label,/Write a line in the notebook/);
 assert.equal(await words(ana,'write in the notebook'),`object:${id('notebook')}:pin`,'"write in the notebook" is the notebook\'s line');
 assert.equal(await words(ana,'write a line in the notebook'),`object:${id('notebook')}:pin`);
 let retries=0;const act=async(s,capability,params,accepted=true)=>{let b;for(let k=0;k<20;k++){soul=s;const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability,...(params?{params}:{})})}));b=await r.json();if(b.code!=='object.admission-failed')break;retries++;await tick(10);}assert.equal(b.accepted,accepted,JSON.stringify(b));return b;};
 const lines=()=>{const s=state('notebook');return {lines:s.text?s.text.split('\n'):[],by:s.textBy?s.textBy.split(','):[]};};
 const finish=async(s,receipt,limit=900)=>{let stroke=null,early=false,hand=[],bz=Infinity,before=JSON.stringify(state('notebook'));for(let n=0;n<limit;n++){const h=body(s).human,m=h?.handActuator;if(m?.stroke){stroke=m.stroke;const p=h.hands?.right??h.hands?.left;if(p)hand.push(p);const nw=god.model.worldPose(god.model.get('notebook'));bz=Math.min(bz,(h&&body(s).pose.p[0]-nw.x)*Math.sin(nw.yaw)+(body(s).pose.p[2]-nw.z)*Math.cos(nw.yaw));if((f.host.engine.world.tick-m.startTick)*f.host.engine.dt<0.65+m.stroke.seconds-0.05&&JSON.stringify(state('notebook'))!==before)early=true;}const ph=edge.receipt(s.soulId,receipt.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}return {stroke:stroke&&{kind:stroke.kind,seconds:stroke.seconds,tilt:stroke.tilt},early,hand,bodyZ:+bz.toFixed(3),phase:edge.receipt(s.soulId,receipt.receipt.id).phase};};
 let makeWayRetries=0;const done=async(s,capability,params)=>{for(let k=0;;k++){const r=await act(s,capability,params);const fr=await finish(s,r),rc=edge.receipt(s.soulId,r.receipt.id);if(fr.phase==='failed'&&rc.code==='reservation.conflict'&&/:make-way:\d+/.test(rc.reason??'')&&k<3){makeWayRetries++;await tick(30);continue;}assert.equal(fr.phase,'completed',JSON.stringify(rc).slice(0,600));return fr;}};
 // strict offers (#1093, #1094): the line's text is a schema on the offer in caps, here.doHere and inspect, never words alone
 {soul=ana;const pinId=`object:${id('notebook')}:pin`,want={type:'string',maxLength:60};const fit=(o,where)=>{assert.ok(o,`${where} offers the line`);assert.equal(o.params?.text?.type,want.type,where);assert.equal(o.params?.text?.maxLength,want.maxLength,where);assert.notEqual(o.params?.text?.optional,true,`${where}: the line is required`);};
  fit(edge.capabilities(ana).find(c=>c.id===pinId),'caps');
  // this fixture's frame leaves doHere almost no budget, so here says it by verb; doHere with room carries the schema
  assert.ok((await here(ana)).offers.object?.count>=1,'here counts the line under its verb');
  fit(compactDoHere(edge.capabilities(ana).filter(c=>c.id===pinId),new Set([id('notebook')])).doHere[0],'doHere');
  soul=ana;const ins=await (await app.request(`/v1/edge/inspect/${encodeURIComponent(id('notebook'))}`)).json();fit(ins.inspect.offers.find(o=>o.id===pinId),'inspect');}
 // validation
 for(const [text,why] of [['','required'],['x'.repeat(61),'too long'],['two\nlines','one line'],['bell\u0007','control']]){const b=await act(ana,`object:${id('notebook')}:pin`,{text},false);assert.equal(b.code,'capability.params',why);}
 const none=await act(ana,`object:${id('notebook')}:unpin`,undefined,false);assert.equal(none.code,'object.state');
 // interrupted before the stroke ends: nothing written
 const cut=await act(ana,`object:${id('notebook')}:pin`,{text:'never finished'});for(let n=0;n<500&&!body(ana).human?.handActuator?.stroke;n++)await tick(1);await tick(15);
 await accept(f.host,edge.act(ana,{capability:'stand:here'}));await tick(80);assert.equal(state('notebook').text,'','an interrupted stroke writes nothing');assert.notEqual(edge.receipt(ana.soulId,cut.receipt.id).phase,'completed');
 // three Souls write: each line appears only at the end of its stroke, signed, in order; the hand works on the sloped page
 const runs=[];
 for(const [s,text] of [[ana,'Came by at noon, the tea was good'],[ben,'The kite is back on the hook'],[cy,'Choir at dusk, all welcome'],[ana,'Ben: thank you for the kite']]){const fr=await done(s,`object:${id('notebook')}:pin`,{text});assert.equal(fr.early,false,'no line before the stroke ends');assert.equal(fr.stroke.kind,'write');assert.ok(fr.stroke.tilt>1.2,'a sloped-page stroke');runs.push(fr);}
 assert.deepEqual(lines().lines,['Came by at noon, the tea was good — Ana','The kite is back on the hook — Ben','Choir at dusk, all welcome — Cy','Ben: thank you for the kite — Ana']);
 assert.deepEqual(lines().by,[ana.soulId,ben.soulId,cy.soulId,ana.soulId]);
 // the writing hand stays at the page (lectern top 1.10-1.25 m) and in front of the stand, never through it
 const handYs=runs.flatMap(r=>r.hand.slice(Math.floor(r.hand.length*.3),Math.floor(r.hand.length*.7)).map(p=>p[1]));
 const pageHand={minY:+Math.min(...handYs).toFixed(3),maxY:+Math.max(...handYs).toFixed(3)};assert.ok(pageHand.minY>1.1&&pageHand.maxY<1.3,JSON.stringify(pageHand));
 // while writing, each body stands in front of the stand, clear of its 0.224 m half-depth by more than a body radius
 const bodyZ=runs.map(r=>r.bodyZ);assert.ok(bodyZ.every(z=>z>0.224+0.25),JSON.stringify(bodyZ));
 // per-Soul limit and authorship
 const third=await act(ana,`object:${id('notebook')}:pin`,{text:'one too many'},false);assert.match(third.reason??'',/already have 2 lines/);
 const bd=await done(ben,`object:${id('notebook')}:unpin`);assert.equal(bd.stroke.kind,'wipe');
 assert.deepEqual(lines().lines,['Came by at noon, the tea was good — Ana','Choir at dusk, all welcome — Cy','Ben: thank you for the kite — Ana']);
 const benAgain=await act(ben,`object:${id('notebook')}:unpin`,undefined,false);assert.equal(benAgain.code,'object.not-yours');assert.match(benAgain.reason??'',/only its writer/);
 assert.equal(await words(ana,'cross out my line in the notebook'),`object:${id('notebook')}:unpin`,'"cross out" is the notebook\'s unpin where no sign-up sheet is offered');
 // fill it: eight lines, the ninth refused with a reason
 const dan=await join('dan','Dan'),eve=await join('eve','Eve');
 for(const [s,text] of [[ben,'Fresh bread at the bakery'],[cy,'Swap books on Sunday'],[dan,'Lost a glove by the well'],[eve,'Found a glove by the well'],[dan,'Thanks Eve!']])await done(s,`object:${id('notebook')}:pin`,{text});
 assert.equal(lines().lines.length,8);
 const fin=await join('fin','Fin');const full=await act(fin,`object:${id('notebook')}:pin`,{text:'room for me?'},false);assert.match(full.reason??'',/notebook is full/);
 // private notebook refused for a non-owner
 const priv=await act(ben,`object:${id('private-journal')}:pin`,{text:'hello'},false);assert.match(priv.code,/private|access|owner/);
 // reading: another Soul gets the lines attributed and untrusted, never in its ambient frame or the offer
 const finHere=await here(fin);assert.ok(!JSON.stringify(finHere).includes('kite'),'no words in here');
 const readCap=edge.capabilities(fin).find(c=>c.id===`read:${id('notebook')}`);assert.ok(readCap,'read offered');assert.match(readCap.label,/a notebook, 8 lines written/);assert.ok(!readCap.label.includes('kite'));
 assert.equal(await words(fin,'read the notebook'),`read:${id('notebook')}`);
 const rd=await act(fin,`read:${id('notebook')}`);assert.equal((await finish(fin,rd)).phase,'completed');
 const outcome=edge.receipt(fin.soulId,rd.receipt.id).outcome;
 assert.match(outcome.summary,/^Read notebook: "Came by at noon, the tea was good" \(Ana\) \/ "Choir at dusk, all welcome" \(Cy\)/);assert.ok(outcome.summary.length<=160);assert.match(outcome.summary,/their words, not world facts/);
 assert.equal(outcome.untrusted,true);assert.equal(outcome.learned.length,5,'one learned fact per writer');assert.match(outcome.learned[0].fact,/^Ana wrote in notebook: "Came by at noon, the tea was good" \/ "Ben: thank you for the kite"$/);
 assert.deepEqual(outcome.detail.sign.lines.map(n=>n.writtenBy.name),['Ana','Cy','Ana','Ben','Cy','Dan','Eve','Dan']);
 const nearFull=await here(ana);
 // ---- W016: the lectern's book
 const readers=edge.capabilities(ben).filter(c=>c.verb==='read');
 const atLectern=(s,n)=>edge.capabilities(s).find(c=>c.verb==='read'&&(c.id===`read:read.${id(n)}`.toLowerCase()||c.target?.id===`read.${id(n)}`.toLowerCase()));
 const lec=atLectern(ben,'oak-lectern');
 assert.ok(lec,`a reading offer at the book lectern: ${JSON.stringify(readers.map(c=>[c.id,c.label]))}`);assert.match(lec.label,/^Read A Cup with Room for Silence/);
 const lecIds=[];const book=EDEN_LIBRARY_CATALOGUE.find(b=>b.id==='book:tea-cup');
 const readAt=async(s,cap)=>{const r=await act(s,cap.id,{seconds:20});const fr=await finish(s,r,1200);assert.equal(fr.phase,'completed',JSON.stringify(edge.receipt(s.soulId,r.receipt.id)).slice(0,500));return edge.receipt(s.soulId,r.receipt.id).outcome;};
 assert.equal(await words(ben,'read a cup with room for silence'),`read:read.${id('oak-lectern')}`.toLowerCase(),'the book\'s title names its lectern');
 assert.equal(await words(ben,'read the book on the oak lectern'),`read:read.${id('oak-lectern')}`.toLowerCase(),'"read the book on the oak lectern" is that lectern, not ambiguous with read:here at the same spot');
 const p1=await readAt(ben,lec);
 assert.equal(p1.detail.book.id,'book:tea-cup');assert.match(p1.summary,new RegExp(`^Read ${book.title}, passage 1 of 3`));assert.equal(p1.detail.passage,book.passages[0].text);
 const p2=await readAt(ben,lec);assert.match(p2.summary,/passage 2 of 3/);assert.equal(p2.detail.passage,book.passages[1].text);
 // one reader at a time: Ben steps over to read the notebook, which frees the lectern's reading place for Cy
 const bn=await act(ben,`read:${id('notebook')}`);assert.equal((await finish(ben,bn)).phase,'completed');
 const c1=await readAt(cy,atLectern(cy,'oak-lectern'));
 const cn=await act(cy,`read:${id('notebook')}`);assert.equal((await finish(cy,cn)).phase,'completed');assert.match(c1.summary,/passage 1 of 3/,'another Soul starts at the beginning');
 await readAt(ben,atLectern(ben,'oak-lectern'));const p4=await readAt(ben,atLectern(ben,'oak-lectern'));assert.match(p4.summary,/^Finished A Cup with Room for Silence/);
 // the old lectern reads as before: this world's constitution / lore, not a library book
 const old=atLectern(dan,'old-lectern');
 assert.ok(old,'the @1 lectern still has its reading offer');assert.doesNotMatch(old.label,/Cup with Room/);
 const o1=await readAt(dan,old);lecIds.push(lec.id,old.id);assert.ok(!o1.detail?.book?.id?.startsWith('book:'),`@1 reads the world, not a catalogue book: ${o1.summary}`);
 // persistence
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);
 assert.equal(restored.get('notebook').state.text,state('notebook').text);assert.equal(restored.get('notebook').state.textBy,state('notebook').textBy);
 assert.equal(restored.get('oak-lectern').params.book,'book:tea-cup');
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 const report={status:'pass',admissionRetries:retries,makeWayRetries,hereBytes:{absent:bytes(absent),distant100Each:bytes(far),nearBlank:bytes(nearBlank),nearFull:bytes(nearFull)},pageHand,bodyLocalZ:bodyZ,
  readSummary:outcome.summary,learned:outcome.learned.map(l=>l.fact),lecternReads:[p1.summary,p2.summary,c1.summary,p4.summary],oldLectern:o1.summary,lecternOffers:lecIds,strokes:runs.map(r=>({...r.stroke,bodyZ:r.bodyZ})),notebook:lines().lines,
  checks:['catalogue ids = lectern@2 book values','unknown book refused at placement','validation (empty, >60, two lines, control)','cross-out with no line refused','interrupted stroke writes nothing','four lines by three Souls, signed, in order, none before its stroke ends','sloped-page stroke at page height, bodies clear of the stand','two lines per Soul','writer-only cross-out','plain words: write in / write a line in / cross out / read the notebook','full notebook refuses a ninth','private notebook refused','read offer names the count, no words','read: quoted lines with writers, untrusted, one learned fact per writer','no words in a reader\'s here','lectern book: passages in order, per-Soul progress, finished','@1 lectern unchanged','snapshot persistence','distant notebooks and lecterns add nothing','zero native violations'],
  limitation:'Deterministic native fake-brain test; the look of the page, the handwriting and the hand is judged from the real-client video.'};
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report));
});
