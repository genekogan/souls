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

// #429 (W092): a guestbook at a place, on the sign-up sheet's faculty with data only (capacity, noun, a few words, a fresh
// page when full); by hand and by plain words; several Souls; refusals; interruption; reads; persistence; long tail.
const out=process.env.SOUL_ACTIONS_OUT;
test('guestbook: sign by hand with a few words, several Souls, a fresh page when full, bounded perception', {timeout:300000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();
 const join=async(id,name)=>{await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Guestbook test'}));await tick();return {soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};};
 const ana=await join('ana','Ana'),ben=await join('ben','Ben'),cy=await join('cy','Cy');soul=ana;
 const here=async(s)=>{soul=s;const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const body=s=>f.host.engine.world.entities[s.entityId];
 const absent=await here(ana);
 // G9: 100 filled guestbooks 120 m away add nothing
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/guestbook@1',name:`distant-book-${i}`,p:[120+i%10*3,120+Math.floor(i/10)*3],state:{title:'secret visitors',text:'Zed — secret words\nYan',textBy:'s_z,s_y'}}));
 assert.equal(god.act({ops:distant}).accepted,true);await tick(45);
 const far=await here(ana);assert.ok(!/secret|distant-/.test(JSON.stringify(far)),'distant guestbooks add nothing to here');
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(ana).filter(c=>/secret/.test(c.label)||c.id.startsWith('read:')&&farIds.has(c.id.slice(5))||c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant guestbook offers');
 const strip=h=>JSON.stringify({...h,tick:0});
 assert.equal(strip(far),strip(absent),'the here frame with 100 distant guestbooks is the absent one apart from its tick');
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 // a sign-up sheet beside it: the same faculty, its own words and capacity
 assert.equal(god.act({ops:[{op:'place',def:'core/guestbook@1',name:'guestbook',p:[ax+1.2,az+2.6],r:Math.PI,state:{title:'Visitors to the mill'}},{op:'place',def:'core/signup-sheet@1',name:'sheet',p:[ax-1.6,az+2.6],r:Math.PI,state:{title:'Volleyball at five'}}]}).accepted,true);await tick(45);
 const id=n=>god.model.get(n).id,state=n=>god.model.get(n).state;
 const near=await here(ana);
 let retries=0;const act=async(s,capability,params,accepted=true)=>{let b;for(let k=0;k<20;k++){soul=s;const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability,...(params?{params}:{})})}));b=await r.json();if(b.code!=='object.admission-failed')break;retries++;await tick(10);}assert.equal(b.accepted,accepted,JSON.stringify(b));return b;};
 let watch='guestbook';const finish=async(s,receipt,limit=900)=>{let stroke=null,early=false,at=null,before=JSON.stringify(state(watch));for(let n=0;n<limit;n++){const m=body(s).human?.handActuator;if(m?.stroke){stroke=m.stroke;at??=m.at??m.target?.at??null;if((f.host.engine.world.tick-m.startTick)*f.host.engine.dt<0.65+m.stroke.seconds-0.05&&JSON.stringify(state(watch))!==before)early=true;}const ph=edge.receipt(s.soulId,receipt.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}return {stroke:stroke&&{kind:stroke.kind,seconds:stroke.seconds,width:stroke.width},at,early,phase:edge.receipt(s.soulId,receipt.receipt.id).phase};};
 let makeWayRetries=0;const done=async(s,capability,params)=>{for(let k=0;;k++){const r=await act(s,capability,params);const fr=await finish(s,r),rc=edge.receipt(s.soulId,r.receipt.id);if(fr.phase==='failed'&&rc.code==='reservation.conflict'&&/:make-way:\d+/.test(rc.reason??'')&&k<3){makeWayRetries++;await tick(30);continue;}assert.equal(fr.phase,'completed',capability+' '+JSON.stringify(rc).slice(0,500));return fr;}};
 const on=(name,s,words,params)=>{watch=name;return done(s,words,params);};
 const read=async(s,name)=>{const r=await act(s,`read:${id(name)}`);await finish(s,r);return edge.receipt(s.soulId,r.receipt.id);};
 const results={};
 // G7: an act interrupted before the contact changes nothing
 {watch='guestbook';const cut=await act(cy,'sign the guestbook');await tick(4);soul=cy;await accept(f.host,edge.act(cy,{capability:'stand:here'}));await tick(60);
  assert.equal(state('guestbook').text,'','interrupted before contact: the book stays empty');assert.ok(['replaced','cancelled','failed'].includes(edge.receipt(cy.soulId,cut.receipt.id).phase),'the sign act was interrupted');results.interrupted=edge.receipt(cy.soulId,cut.receipt.id).phase;}
 // G1: plain words; the name at the end of the stroke; a few words with the name
 const a1=await on('guestbook',ana,'sign the guestbook');assert.equal(a1.early,false,'no name before the stroke ends');assert.equal(a1.stroke.kind,'write');assert.equal(state('guestbook').text,'Ana');results.ana=a1;
 const b1=await on('guestbook',ben,'sign the guestbook',{text:'Lovely  garden,  thank you '});assert.equal(b1.early,false);results.ben=b1;
 assert.equal(state('guestbook').text,'Ana\nBen — Lovely garden, thank you');assert.ok(b1.stroke.seconds>a1.stroke.seconds&&b1.stroke.width>a1.stroke.width,'a longer line takes a longer stroke');
 assert.ok(a1.at&&b1.at&&b1.at[1]<a1.at[1],'the second entry is written on the next line down');
 // G5: once each; words bounded; nothing crossed off
 const again=await act(ana,'sign the guestbook',undefined,false);assert.match(again.reason??'',/already signed the guestbook/);results.again=again.code;
 const long=await act(cy,'sign the guestbook',{text:'x'.repeat(41)},false);assert.equal(long.code,'capability.params',JSON.stringify(long));assert.match(long.reason??'',/at most 40 characters \(yours is 41\)/);results.long=long.reason;
 const blank=await act(cy,'sign the guestbook',{text:'   '},true);assert.ok(blank.accepted,'blank words are no words');soul=cy;await accept(f.host,edge.act(cy,{capability:'stand:here'}));await tick(60);assert.ok(['replaced','cancelled'].includes(edge.receipt(cy.soulId,blank.receipt.id).phase),'the blank-words act was interrupted');assert.ok(!/Cy/.test(state('guestbook').text),'the blank-words act was cut before contact');
 const ctl=await act(cy,'sign the guestbook',{text:'a\u0007b'},false);assert.match(ctl.reason??'',/control characters/);
 const off=await act(ben,'cross my name off the guestbook',undefined,false);assert.ok(!off.accepted,JSON.stringify(off));results.unsign=off.code;
 assert.ok(!edge.capabilities(ben).some(c=>c.object===id('guestbook')&&/unsign|cross/i.test(c.id+c.label)),'no unsign on a guestbook');
 // G2: a third Soul; order kept
 await on('guestbook',cy,'sign the guestbook',{text:'Back next spring'});assert.equal(state('guestbook').text,'Ana\nBen — Lovely garden, thank you\nCy — Back next spring');
 assert.equal(state('guestbook').textBy,`${ana.soulId},${ben.soulId},${cy.soulId}`);
 // G3: the sheet beside it keeps its own words and capacity
 await on('sheet',ana,'sign the sign-up sheet');const sheetAgain=await act(ana,'sign the sign-up sheet',undefined,false);assert.match(sheetAgain.reason??'',/^Your name is already on this sheet\.$/);
 // G4: counts in the offer, words only with the read
 const caps=edge.capabilities(ben),label=n=>caps.find(c=>c.id===`read:${id(n)}`)?.label??'';
 assert.match(label('guestbook'),/a guestbook, 3 names/);assert.match(label('sheet'),/a sign-up sheet, 1 name/);assert.ok(!/Ana|Lovely|spring|mill/.test(label('guestbook')),'offers carry counts, not words');
 const rg=await read(ben,'guestbook');const rgText=rg.outcome?.summary??JSON.stringify(rg);assert.match(rgText,/Visitors to the mill.*1\. Ana.*2\. Ben — Lovely garden, thank you.*3\. Cy — Back next spring/s);results.read=rgText.slice(0,300);
 // G6: a full book (16) takes the next entry on a fresh page; the oldest page gives way
 const filler=Array.from({length:13},(_,i)=>({t:`Guest ${i+1}`,by:`s_g${i+1}`}));
 const st=state('guestbook');assert.equal(god.act({ops:[{op:'set',id:'guestbook',state:{text:[st.text,...filler.map(x=>x.t)].join('\n'),textBy:[st.textBy,...filler.map(x=>x.by)].join(',')}}]}).accepted,true);await tick(5);
 assert.equal(state('guestbook').text.split('\n').length,16);
 const ana2=await act(ana,'sign the guestbook',undefined,false);assert.match(ana2.reason??'',/already signed/,'still once each while her entry is kept');
 const extra=await join('dee','Dee');
 const d1=await on('guestbook',extra,'sign the guestbook',{text:'Fresh page'});assert.equal(d1.early,false);
 const kept=state('guestbook').text.split('\n');assert.equal(kept.length,9,'the oldest page of 8 gave way');assert.equal(kept[0],'Guest 6');assert.equal(kept[8],'Dee — Fresh page');assert.ok(!kept.some(l=>/^Ana$|Ben —|Cy —/.test(l)),'the first page is gone');
 assert.ok(d1.at&&Math.abs(d1.at[1]-a1.at[1])<1e-6,'a fresh page: the hand writes on its first line, at the top');results.dee=d1;
 const ana3=await on('guestbook',ana,'sign the guestbook',{text:'Came back'});assert.equal(state('guestbook').text.split('\n').at(-1),'Ana — Came back','once her entry has gone she signs again');
 const eve=await join('eve','Eve');await on('guestbook',eve,'sign the guestbook',{text:' \n '});assert.equal(state('guestbook').text.split('\n').at(-1),'Eve','blank words are no words: the name alone');
 const rFull=await read(ben,'guestbook');assert.ok(JSON.stringify(rFull).length<4000,'the read stays bounded');results.ana3=ana3;
 // G8: persistence
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);assert.equal(restored.get('guestbook').state.text,state('guestbook').text);assert.equal(restored.get('guestbook').state.textBy,state('guestbook').textBy);
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 const nearFull=await here(ana);assert.ok(!/Lovely|spring|Fresh page|Came back|mill|Guest \d/.test(JSON.stringify(nearFull)),'here carries no words, title or other guests: they come with the read');assert.ok(JSON.stringify(nearFull).includes(id('guestbook')),'the guestbook is in the nearby frame');
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,distant100:JSON.stringify(far).length,nearby:JSON.stringify(near).length,nearbyFilled:JSON.stringify(nearFull).length},retries,makeWayRetries,book:state('guestbook').text,results,
  checks:['100 distant guestbooks: the absent here frame apart from its tick, no offers','an act interrupted before contact changes nothing','plain words sign at the stroke end, never before','a few words follow the name; a longer stroke','the next entry on the next line down','once each; words bounded; control characters refused; no unsign','three Souls in order, each attributed','the sign-up sheet keeps its own words','the read offer counts names, never words; the read lists them numbered','a full book turns to a fresh page; the oldest page gives way; the hand at the first line','a Soul whose entry has gone signs again','restored snapshot keeps entries and authors','no engine violations']};
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/here-near.json`,JSON.stringify(near,null,1));writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));}console.log(JSON.stringify(report));
});
