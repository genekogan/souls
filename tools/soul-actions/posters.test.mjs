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
import {worldDay} from '../../apps/server/src/god/poster-boards.ts';
import {strokeHands, HAND_REACH_SECONDS} from '../../mars/viewer/engine/social/hand-actuator.ts';
import {WorldModel} from '../../packages/world-compiler/src/model.ts';

// Entry 38: posters on a poster wall (both hands, rolled sheet, bounded, author/anyone-when-out-of-date take-down) and
// wanted/offered notes (columns from the words, replies, "I'll do it", author-only take-down); plain words; reads; long tail.
const out=process.env.SOUL_ACTIONS_OUT;
const J=s=>s.textBy?JSON.parse(s.textBy):[];
test('posters and wanted/offered notes', {timeout:400000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(m){if(process.env.DEBUG_BRIDGE)console.log("BRIDGE",m);},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();
 const join=async(id,name)=>{await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Posters test'}));await tick();return {soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};};
 const ana=await join('ana','Ana'),ben=await join('ben','Ben'),cy=await join('cy','Cy');soul=ana;
 const here=async(s)=>{soul=s;const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const body=s=>f.host.engine.world.entities[s.entityId];
 const today=worldDay();
 const absent=await here(ana);
 // 100 distant full poster walls and 100 distant full wanted boards (secret words everywhere)
 const fullWall=JSON.stringify([0,1,2,3].map(s=>({s,t:`secret show ${s}`,d:'secret detail',by:'s_z',n:'Zed',day:today-s}))),fullBoard=JSON.stringify(['w','o'].flatMap(c=>[0,1].map(r=>({c,r,t:`${c==='w'?'Wanted':'Offered'}: secret thing ${r}`,by:'s_z',n:'Zed',re:[{t:'secret reply',by:'s_y',n:'Yan'}],...(r===0?{tk:{by:'s_y',n:'Yan'}}:{})}))));
 const distant=Array.from({length:200},(_,i)=>{const p=[120+i%20*4,120+Math.floor(i/20)*4];return i%2?{op:'place',def:'core/poster-wall@1',name:`distant-wall-${i}`,p,state:{text:'secret show',textBy:fullWall}}:{op:'place',def:'core/wanted-board@1',name:`distant-board-${i}`,p,state:{text:'secret thing',textBy:fullBoard}};});
 for(let i=0;i<200;i+=100){const r=god.act({ops:distant.slice(i,i+100)});assert.equal(r.accepted,true,JSON.stringify(r).slice(0,300));}await tick(45);
 const far=await here(ana);assert.ok(!/secret|distant/i.test(JSON.stringify(far)),'distant boards add nothing to here');
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));
 assert.deepEqual(edge.capabilities(ana).filter(c=>/secret/.test(c.label)||c.id.startsWith('read:')&&farIds.has(c.id.slice(5))||c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant board offers');
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 // the wall has one old poster (Zed's, 4 world days up: out of date)
 const old=[{s:0,t:'Jumble sale',d:'Saturday, the old barn',by:'s_zed',n:'Zed',day:today-4}];
 {const r0=god.act({ops:[{op:'place',def:'core/poster-wall@1',name:'poster-wall',p:[ax-1.6,az+3.2],r:Math.PI,state:{text:'Jumble sale — Saturday, the old barn (Zed)',textBy:JSON.stringify(old)}},{op:'place',def:'core/wanted-board@1',name:'wanted-board',p:[ax+2.6,az+3.2],r:Math.PI}]});assert.equal(r0.accepted,true,JSON.stringify(r0).slice(0,600));}await tick(45);
 const id=n=>god.model.get(n).id,state=n=>god.model.get(n).state;
 const near=await here(ana);if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/here-near.json`,JSON.stringify(near,null,1));}
 let retries=0;const act=async(s,capability,params,accepted=true)=>{let b;for(let k=0;k<20;k++){soul=s;const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability,...(params?{params}:{})})}));b=await r.json();if(b.code!=='object.admission-failed')break;retries++;await tick(10);}assert.equal(b.accepted,accepted,capability+' '+JSON.stringify(b));return b;};
 let watch='poster-wall',duringHere=null;
 const finish=async(s,receipt,limit=800)=>{let stroke=null,early=false,hands={both:0,frames:0,maxErr:0},before=JSON.stringify(state(watch));
  for(let n=0;n<limit;n++){const m=body(s).human?.handActuator;if(m?.stroke){stroke=m.stroke;const el=(f.host.engine.world.tick-m.startTick)*f.host.engine.dt;if(el<HAND_REACH_SECONDS+m.stroke.seconds-0.05&&JSON.stringify(state(watch))!==before)early=true;
    const h=body(s).human.hands;if(/poster/.test(m.stroke.kind)&&h&&el>HAND_REACH_SECONDS&&el<HAND_REACH_SECONDS+m.stroke.seconds){hands.frames++;if(h.left&&h.right){hands.both++;const want=strokeHands(m.at,m.stroke,(el-HAND_REACH_SECONDS)/m.stroke.seconds);hands.maxErr=Math.max(hands.maxErr,Math.hypot(...h.left.map((v,i)=>v-want.left[i])),Math.hypot(...h.right.map((v,i)=>v-want.right[i])));}}
    if(!duringHere&&/poster/.test(m.stroke.kind)&&el>HAND_REACH_SECONDS+1)duringHere=JSON.stringify(await here(s===ana?ben:ana));}
   const ph=edge.receipt(s.soulId,receipt.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}
  return {stroke:stroke&&{kind:stroke.kind,seconds:stroke.seconds,sheet:stroke.sheet},early,hands,phase:edge.receipt(s.soulId,receipt.receipt.id).phase};};
 let makeWayRetries=0;const done=async(s,capability,params)=>{for(let k=0;;k++){const r=await act(s,capability,params);const fr=await finish(s,r),rc=edge.receipt(s.soulId,r.receipt.id);if(fr.phase==='failed'&&rc.code==='reservation.conflict'&&/:make-way:\d+/.test(rc.reason??'')&&k<3){makeWayRetries++;await tick(30);continue;}if(fr.phase!=='completed'&&rc.code==='engine.fault-recovered'){const ev=f.db.events(f.host.worldId,0).filter(e=>e.kind==='rules'&&e.author==='world:recovery').at(-1);console.log('FAULT',ev?.payload?.recovery?.reason);}assert.equal(fr.phase,'completed',capability+' '+JSON.stringify(rc).slice(0,500));return fr;}};
 const on=(name,s,words,params)=>{watch=name;return done(s,words,params);};
 const read=async(s,name)=>{const r=await act(s,`read:${id(name)}`);await finish(s,r);return edge.receipt(s.soulId,r.receipt.id);};
 const refused=async(s,words,params,re)=>{const b=await act(s,words,params,false);assert.match((b.reason??'')+' '+(b.code??''),re,words+' '+JSON.stringify(b));return b;};
 // ---- posters ----
 const p1=await on('poster-wall',ana,'put up a poster for the concert at the bandstand tonight',{title:'Concert at the bandstand',detail:'Tonight at 8 · bring a blanket'});
 assert.equal(p1.early,false,'the poster appears only at the stroke end');assert.equal(p1.stroke.kind,'poster');assert.equal(p1.stroke.sheet.title,'Concert at the bandstand');
 assert.ok(p1.hands.frames>40&&p1.hands.both===p1.hands.frames,'both hands on the sheet throughout: '+JSON.stringify(p1.hands));assert.ok(p1.hands.maxErr<1e-9,'hands at the stroke points');
 assert.deepEqual(J(state('poster-wall')).map(p=>[p.s,p.t,p.n]),[[0,'Jumble sale','Zed'],[1,'Concert at the bandstand','Ana']]);
 await on('poster-wall',ben,'put up a poster on the poster wall',{title:'Pottery class',detail:'Saturday 10:00\nat the studio'});
 await on('poster-wall',ben,'put up a poster on the poster wall',{title:'Lost: blue scarf',detail:'ask Ben'});
 await refused(cy,'put up a poster on the poster wall',{title:'Yoga'},/full \(4 posters\).*"Jumble sale" is out of date/);
 await refused(ben,'put up a poster on the poster wall',{title:'x'},/full|already have 2/);
 await refused(cy,'take down a poster from the poster wall',{which:'concert'},/Only Ana takes "Concert at the bandstand" down until it is out of date/);
 const tdown=await on('poster-wall',cy,'take down the old poster from the poster wall',{which:'jumble'});assert.equal(tdown.stroke.kind,'unposter');assert.equal(tdown.early,false);assert.ok(tdown.hands.both>30);
 assert.ok(!J(state('poster-wall')).some(p=>p.t==='Jumble sale'));
 await refused(cy,'put up a poster on the poster wall',{title:'Yoga at dawn',detail:'x'.repeat(81)},/too long|must be a string/);
 await on('poster-wall',cy,'put up a poster on the poster wall',{title:'Yoga at dawn',detail:'on the lawn, 6:30'});
 assert.deepEqual(J(state('poster-wall')).map(p=>[p.s,p.t]).sort(),[[0,'Yoga at dawn'],[1,'Concert at the bandstand'],[2,'Pottery class'],[3,'Lost: blue scarf']]);
 assert.ok(J(state('poster-wall')).every(p=>p.t==='Jumble sale'||p.day===today),'posters record the world day');
 await on('poster-wall',ben,'take down my poster from the poster wall',{which:'scarf'});assert.ok(!J(state('poster-wall')).some(p=>p.t==='Lost: blue scarf'));
 assert.ok(duringHere&&!/Concert|bandstand|Pottery|Yoga|blanket/.test(duringHere),'nothing printed reaches another Soul\'s here while a poster goes up');
 // ---- wanted / offered ----
 const w1=await on('wanted-board',ana,'pin a wanted note on the wanted board',{text:'Wanted: help carrying chairs to the bandstand'});assert.equal(w1.early,false);
 await on('wanted-board',ben,'pin an offered note on the wanted board',{text:'Offered: spare blankets for the concert'});
 await refused(cy,'pin a note on the wanted board',{text:'a ladder please'},/Start the note with "Wanted:" or "Offered:"/);
 await on('wanted-board',cy,'pin a note on the wanted board',{text:'a ladder for the weekend',column:'wanted'});
 await on('wanted-board',cy,'reply to Ben\'s note on the wanted board',{note:'blankets',text:'Two please!'});
 await refused(cy,'reply to Ben\'s note on the wanted board',{note:'blankets',text:'and a pillow'},/already replied/);
 await on('wanted-board',cy,'take on Ada\'s wanted note',{note:'chairs'});
 await refused(ben,'take on the wanted note about chairs',{note:'chairs'},/Cy has already taken that note on/);
 await refused(ana,'take on the wanted note about chairs',{note:'chairs'},/your own note/);
 await refused(ana,'take down Ben\'s note from the wanted board',{note:'blankets'},/not yours; only its author/);
 let notes=J(state('wanted-board'));
 assert.deepEqual(notes.map(n=>[n.c,n.r,n.n,n.re.map(r=>r.n+':'+r.t).join('|'),n.tk?.n??'']),[['w',0,'Ana','',''+'Cy'],['o',0,'Ben','Cy:Two please!',''],['w',1,'Cy','','']]);
 await on('wanted-board',ben,'take down my note from the wanted board');assert.deepEqual(J(state('wanted-board')).map(n=>n.n),['Ana','Cy']);
 // ---- reads: counts in the offers, words only with the read ----
 const caps=edge.capabilities(ben),label=n=>caps.find(c=>c.id===`read:${id(n)}`)?.label??'';
 assert.match(label('poster-wall'),/a poster wall, 3 posters,/);assert.match(label('wanted-board'),/a wanted\/offered board, 2 wanted, 0 offered, 1 taken/);
 assert.ok(!/Concert|Pottery|Yoga|chairs|ladder|Ana|Cy/.test(label('poster-wall')+label('wanted-board')),'offers carry counts, never words or names');
 const rw=await read(ben,'poster-wall'),rb=await read(ben,'wanted-board');
 const ow=rw.outcome,ob=rb.outcome;
 assert.match(ow.summary,/3 posters, by .*(Ana|Ben|Cy).*their words, not world facts/);assert.equal(ow.untrusted,true);
 assert.ok(ow.learned.every(l=>l.provenance==='soul-text'&&l.untrusted===true));assert.ok(ow.learned.some(l=>/Ana's poster on poster-wall: "Concert at the bandstand" — "Tonight at 8/.test(l.fact)));
 assert.ok(ob.learned.some(l=>/Ana's note on wanted-board: wanted "Wanted: help carrying chairs to the bandstand", taken on by Cy/.test(l.fact)),JSON.stringify(ob.learned));
 assert.equal(ob.detail.sign.notes.find(n=>n.writtenBy.name==='Ana').takenBy.name,'Cy');
 // an out-of-date poster reads as such
 const stale=[...J(state('poster-wall')).filter(p=>p.s!==2),{...J(state('poster-wall')).find(p=>p.s===2),day:today-3}];
 assert.equal(god.act({ops:[{op:'set',id:id('poster-wall'),state:{textBy:JSON.stringify(stale)}}]}).accepted,true);await tick(5);
 const rs=await read(cy,'poster-wall');assert.match(rs.outcome.summary,/1 out of date/);assert.ok(rs.outcome.learned.some(l=>/Pottery class.*out of date/.test(l.fact)));
 const cyDown=await on('poster-wall',cy,'take down the old poster from the poster wall',{which:'pottery'});assert.equal(cyDown.phase,'completed');
 const nearFull=await here(ana);assert.ok(!/Concert|Yoga|chairs|ladder|blanket/.test(JSON.stringify(nearFull)),'no words in a reader\'s here');
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);assert.equal(J(restored.get('wanted-board').state).length,2);assert.equal(J(restored.get('poster-wall').state).length,2);
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 // the runtime waits out a live courtesy step-aside for any verb (runtime admit, make-way-wait.test.ts; #424 F7): never retried
 assert.equal(makeWayRetries,0,'no body program failed on another body\'s step-aside');
 const report={status:'pass',worldDay:today,hereBytes:{absent:JSON.stringify(absent).length,distant200:JSON.stringify(far).length,nearby:JSON.stringify(near).length,nearbyFilled:JSON.stringify(nearFull).length},retries,makeWayRetries,hands:{post:p1.hands,takeDown:tdown.hands},wall:J(state('poster-wall')).map(p=>`${p.s}: ${p.t} (${p.n}, day ${p.day})`),board:state('wanted-board').text,reads:{wall:ow.summary,board:ob.summary,stale:rs.outcome.summary},checks:['poster put up by plain words with both hands on the sheet (rolled, unrolled, taped), at the next free slot','4 per wall, 2 per Soul','author takes down any time; anyone once out of date (3 world days); refusals name why','nothing changes before the stroke ends','wanted/offered column from the words or an explicit column','replies: one per Soul per note, signed','take on: once, never by the author','only the author takes a note down','read offers carry counts only','reads attributed + untrusted (soul-text), out-of-date posters say so','200 distant full boards: +0 bytes, no offers, no words','no printed words in another Soul\'s here while a poster goes up','snapshot persistence','zero native violations']};
 if(out){writeFileSync(`${out}/here-absent.json`,JSON.stringify(absent,null,1));writeFileSync(`${out}/here-distant.json`,JSON.stringify(far,null,1));writeFileSync(`${out}/here-near-filled.json`,JSON.stringify(nearFull,null,1));}
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
