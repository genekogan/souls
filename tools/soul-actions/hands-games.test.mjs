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

// Entry 35 (packet 44): rock-paper-scissors and holding hands, with consent, by plain words. Offers, the offeree's one
// line, accept / decline / withdraw / lapse, nobody moved before accepting, hidden throws refereed by the world, a walk
// together with the other beside, letting go (asked, and by being told to go elsewhere), 100 distant pairs +0 bytes.
const out=process.env.SOUL_ACTIONS_OUT;
test('rock-paper-scissors and holding hands with consent', {timeout:600000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();
 const join=async(id,name)=>{await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Hands test'}));await tick();return {soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};};
 const ana=await join('ana','Ana'),ben=await join('ben','Ben'),cy=await join('cy','Cy');
 const W=()=>f.host.engine.world,body=s=>W().entities[s.entityId],at=s=>[body(s).pose.p[0],body(s).pose.p[2]];
 const here=async(s)=>{soul=s;const r=await app.request('/v1/edge/here');assert.equal(r.status,200);return (await r.json()).here;};
 // place them: Ben 1.6 m beside Ana, Cy a bystander 3 m off; relocate through the engine's own logged edge-relocate
 const [ax,az]=at(ana);
 const put=async(s,x,z)=>{await accept(f.host,f.host.enqueue('edge-relocate',`edge:${s.soulId}`,{soulId:s.soulId,entityId:s.entityId,to:[x,z],why:'test placement'}));await tick(3);};
 await put(ben,ax,az+1.6);await put(cy,ax+3,az-1.2);await tick(20);
 const sz=x=>Buffer.byteLength(JSON.stringify(x));
 const absent=await here(cy),absentAna=await here(ana);
 // 100 distant pairs holding hands and 100 mid-game (body state) with pending offers among them (rows), far away but
 // on the floor (this fixture's ground is [-30, 30]²; a body off it is a fault the world sets aside, as in handover.test):
 // the far corner, beyond the 15 m object radius from all three Souls; pairs 1.6 m apart, rows 1.5 m
 const [gx0,gz0,gx1,gz1]=f.host.engine.groundBoundsV1(),FX=ax<=(gx0+gx1)/2?gx1-17:gx0+2,FZ=az<=(gz0+gz1)/2?gz1-17:gz0+2;
 const ents=W().entities;let distantScene;
 for(let i=0;i<200;i++){const id=`far_${i}`,e=structuredClone(body(cy));e.id=id;e.label=`Far ${i}`;delete e.human.task;ents[id]=e;const k=Math.floor(i/2),side=i%2;e.pose.p=[FX+k%10*1.6+(side?0.62:0),0,FZ+Math.floor(k/10)*1.5];e.pose.yaw=0;
  if(k<50){e.human.handHold={with:`far_${i^1}`,hand:side?'left':'right',since:1};}else{e.human.activity='rps';delete e.human.speed;e.human.rps={start:1,shoot:53,shape:'rock'};}}
 for(let i=0;i<100;i++)f.db.db.prepare('INSERT INTO edge_invites_v1 (world_id,invite_id,state,body,created_at) VALUES (?,?,?,?,?)').run(f.host.worldId,`inv_far${i}`,'pending',JSON.stringify({id:`inv_far${i}`,what:i%2?'rps':'hold-hands',kind:'paired',host:{soulId:`s_far${i*2}`,name:`Far ${i*2}`},guests:[{soulId:`s_far${i*2+1}`,name:`Far ${i*2+1}`}],capability:'x',label:'offers you a game',createdTick:W().tick,expiresTick:W().tick+1e9,state:'pending',responses:{},hostReceipt:null,guestReceipts:{},rps:{host:'rock'}}),Date.now());
 await tick(10);
 assert.equal(f.db.events(f.host.worldId,0).filter(e=>e.kind==='rules'&&e.payload?.recovery).length,0,'the distant scene raised no engine fault (nothing set aside): '+JSON.stringify(f.db.events(f.host.worldId,0).filter(e=>e.kind==='rules'&&e.payload?.recovery).map(e=>e.payload.recovery.reason)).slice(0,900));
 {const farIds=Object.keys(W().entities).filter(id=>id.startsWith('far_'));assert.equal(farIds.length,200,'the distant bodies are all still there');
  assert.equal(farIds.filter(id=>W().entities[id].human?.handHold).length,100,'100 distant bodies still hold hands');assert.equal(farIds.filter(id=>W().entities[id].human?.rps).length,100,'100 distant bodies are still mid-game');
  distantScene={from:[FX,FZ],nearestSoul:+Math.min(...[ana,ben,cy].map(q=>Math.hypot(at(q)[0]-FX,at(q)[1]-FZ))).toFixed(1)};assert.ok(distantScene.nearestSoul>15,'the distant scene is beyond the 15 m object radius from every Soul');}
 const far=await here(cy),farAna=await here(ana);
 assert.equal(sz(far),sz(absent),'100 distant pairs and their offers add nothing to here');assert.equal(sz(farAna),sz(absentAna));
 assert.ok(!/Far |far_|holding hands|offers you/.test(JSON.stringify(far)),'no names, no lines');
 // acting
 let retries=0;
 const act=async(s,capability,params,ok=true)=>{let b;for(let k=0;k<20;k++){soul=s;const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability,...(params?{params}:{})})}));b=await r.json();if(b.code!=='object.admission-failed')break;retries++;await tick(10);}assert.equal(b.accepted,ok,capability+' '+JSON.stringify(b).slice(0,400));return b;};
 const receipt=(s,b)=>edge.receipt(s.soulId,b.receipt.id);
 const until=async(cond,limit=1200)=>{for(let n=0;n<limit;n++){if(cond())return n;await tick(1);}return -1;};
 const ended=(s,b)=>['completed','failed','cancelled','replaced'].includes(receipt(s,b)?.phase);
 const messages=s=>f.db.db.prepare('SELECT kind,body FROM edge_comms_stream WHERE world_id=? AND soul_id=? ORDER BY seq').all(f.host.worldId,s.soulId).map(r=>({kind:r.kind,...JSON.parse(r.body)}));
 const report={status:'fail',hereBytes:{},checks:[],refusals:{},lines:{}};
 // ---- rock-paper-scissors, declined first (polite, final)
 const r0=await act(ana,'play rock-paper-scissors with Ben',{shape:'rock'});
 assert.ok(await until(()=>edge.together.invitesFor(ben.soulId).length>0)>=0);
 const benOffer=await here(ben);report.lines.rpsOffer=benOffer.me.offer;
 assert.match(benOffer.me.offer??'',/^Ana offers you a game of rock-paper-scissors: accept with your throw or decline \(\d+ s\)$/);
 assert.ok(!(await here(cy)).me.offer,'the bystander sees no offer');
 assert.equal(sz(await here(cy)),sz(absent),'+0 for the bystander while an offer is pending to someone else');
 assert.ok(!/"rock"|throw":|"host"/.test(JSON.stringify([benOffer,messages(ben)])),'the offerer\'s throw is nowhere in Ben\'s view');
 const decline=await act(ben,'decline');
 assert.ok(await until(()=>ended(ana,r0))>=0);assert.equal(receipt(ana,r0).code,'invite.declined');
 const afterDecline=await act(ben,'accept',{shape:'paper'},false),byId=await act(ben,`accept:${edge.together.inviteForReceipt(r0.receipt.id).id}`,{shape:'paper'},false);report.refusals.afterDecline={words:[afterDecline.code,afterDecline.reason],id:byId.code};
 assert.equal(afterDecline.code,'invite.none','declining is final for that offer');assert.equal(byId.code,'capability.unknown');
 // ---- rps refused without a throw, then played
 report.refusals.noThrow=(await act(ana,'play rock-paper-scissors with Ben',undefined,false)).code;assert.equal(report.refusals.noThrow,'rps.choose');
 await tick(30);
 const r1=await act(ana,'play rock-paper-scissors with Ben',{shape:'scissors'});
 assert.ok(await until(()=>edge.together.invitesFor(ben.soulId).length>0)>=0);
 report.refusals.acceptNoThrow=(await act(ben,'accept',undefined,false)).code;assert.equal(report.refusals.acceptNoThrow,'rps.choose');
 const r2=await act(ben,'accept',{shape:'paper'});
 const states=[];for(let n=0;n<900&&!(ended(ana,r1)&&ended(ben,r2));n++){await tick(1);const A=body(ana).human,B=body(ben).human;if(A.rps||B.rps)states.push({tick:W().tick,a:structuredClone(A.rps),b:structuredClone(B.rps),d:Math.hypot(body(ana).pose.p[0]-body(ben).pose.p[0],body(ana).pose.p[2]-body(ben).pose.p[2])});}
 assert.equal(receipt(ana,r1).phase,'completed');assert.equal(receipt(ben,r2).phase,'completed');
 const both=states.filter(s=>s.a&&s.b);assert.ok(both.length>80);
 assert.ok(both.every(s=>s.a.start===s.b.start&&s.a.shoot===s.b.shoot),'one shared count');
 assert.ok(both.every(s=>(s.tick<s.a.shoot)===(s.a.shape===undefined)&&(s.tick<s.b.shoot)===(s.b.shape===undefined)),'no throw shown before shoot');
 assert.ok(both.every(s=>s.d>=.95&&s.d<=1.05),'arm\'s length '+Math.min(...both.map(s=>s.d))+'..'+Math.max(...both.map(s=>s.d)));
 await tick(5);
 const resA=messages(ana).filter(m=>m.kind==='rps.result').at(-1),resB=messages(ben).filter(m=>m.kind==='rps.result').at(-1);
 assert.equal(resA?.text,'Rock, paper, scissors, shoot! You threw scissors; Ben threw paper. You win.');
 assert.equal(resB?.text,'Rock, paper, scissors, shoot! You threw paper; Ana threw scissors. Ana wins.');
 assert.match(receipt(ana,r1).outcome?.summary??'',/You win/);
 report.lines.rpsResult=[resA.text,resB.text];
 // ---- lapse
 const r3=await act(ana,'play rock-paper-scissors with Ben',{shape:'rock'});
 assert.ok(await until(()=>ended(ana,r3),900)>=0);assert.equal(receipt(ana,r3).code,'invite.expired');assert.ok(!(await here(ben)).me.offer,'the lapsed offer line is gone');
 // ---- holding hands: offer, nobody moved before accepting, withdraw
 await tick(20);const benAt0=at(ben),benYaw0=body(ben).pose.yaw;
 const h1=await act(ana,'offer Ben my hand');
 assert.ok(await until(()=>body(ana).human.handHold?.offered!==undefined)>=0,'Ana holds out her hand');
 const benHand=await here(ben);report.lines.handOffer=benHand.me.offer;assert.match(benHand.me.offer??'',/^Ana offers you a hand to hold: accept or decline \(\d+ s\)$/);
 assert.deepEqual(at(ben),benAt0,'Ben does not move before accepting');assert.equal(body(ben).pose.yaw,benYaw0);
 assert.match((await here(ana)).me.activity.kind,/inviting/);
 await act(ana,'withdraw my offer');
 assert.ok(await until(()=>ended(ana,h1))>=0);assert.equal(receipt(ana,h1).code,'invite.withdrawn');
 assert.ok(await until(()=>body(ana).human.handHold?.release!==undefined)>=0,'the offered hand comes back down');
 assert.ok(!(await here(ben)).me.offer,'the withdrawn offer line is gone');assert.match(messages(ben).at(-1)?.text??'',/withdrew the offer/);
 assert.deepEqual(at(ben),benAt0,'still not moved');
 // ---- offer again, take her hand
 await tick(60);
 const h2=await act(ana,'offer Ben my hand');assert.ok(await until(()=>edge.together.invitesFor(ben.soulId).length>0)>=0);
 await until(()=>body(ana).human.handHold?.offered!==undefined);
 assert.deepEqual(at(ben),benAt0,'not moved while offered');
 const h3=await act(ben,'take her hand');
 assert.ok(await until(()=>ended(ana,h2)&&ended(ben,h3))>=0);assert.equal(receipt(ana,h2).phase,'completed');assert.equal(receipt(ben,h3).phase,'completed');
 const A=body(ana),B=body(ben),gap=Math.hypot(A.pose.p[0]-B.pose.p[0],A.pose.p[2]-B.pose.p[2]);
 assert.ok(gap>=.58&&gap<=.68,'side by side '+gap);assert.ok(Math.abs(A.pose.yaw-B.pose.yaw)<=.1,'same way');
 const near=await here(ben),nearAna=await here(ana);report.lines.holding=[near.me.hands,nearAna.me.hands];
 assert.equal(near.me.hands,'holding hands with Ana');assert.equal(nearAna.me.hands,'holding hands with Ben');
 {const c=await here(cy);report.bystanderHolding={bytes:sz(c),near:c.near};assert.ok(!/hand|holding/.test(JSON.stringify(c)),'the bystander is told nothing of hands');if(process.env.HG_DEBUG)console.log(JSON.stringify(absent.near),JSON.stringify(c.near));}
 // ---- walk together: Ana is told to walk; Ben keeps beside her at her pace
 const [mx,mz]=[(A.pose.p[0]+B.pose.p[0])/2,(A.pose.p[2]+B.pose.p[2])/2],fx=Math.cos(A.pose.yaw),fz=Math.sin(A.pose.yaw);
 const goal=[mx+fx*6-fz*2,mz+fz*6+fx*2];
 assert.equal(god.act({ops:[{op:'place',def:'core/zone@1',name:'lawn',shape:{area:[[goal[0]-1.5,goal[1]-1.5],[goal[0]+1.5,goal[1]-1.5],[goal[0]+1.5,goal[1]+1.5],[goal[0]-1.5,goal[1]+1.5]]}},{op:'place',def:'core/zone@1',name:'orchard',shape:{area:[[mx-fz*-8-1.5,mz+fx*-8-1.5],[mx-fz*-8+1.5,mz+fx*-8-1.5],[mx-fz*-8+1.5,mz+fx*-8+1.5],[mx-fz*-8-1.5,mz+fx*-8+1.5]]}}]}).accepted,true);await tick(45);
 const w1=await act(ana,'walk to the lawn');
 let lag=0,lat=0,speedGap=0,moving=0,turnSeen=false;
 for(let n=0;n<1200&&!ended(ana,w1);n++){await tick(1);const a=A.pose.p,b=B.pose.p,yf=[Math.cos(A.pose.yaw),Math.sin(A.pose.yaw)],d=[b[0]-a[0],b[2]-a[2]];
  if(A.human.task&&f.host.engine.runtime.records.get(A.human.task)?.verb==='hand_hold_v1')turnSeen=true;
  if((A.human.speed??0)>.5&&f.host.engine.runtime.records.get(A.human.task??'')?.verb==='walk_to'){moving++;lag=Math.max(lag,Math.abs(d[0]*yf[0]+d[1]*yf[1]));lat=Math.max(lat,Math.abs(Math.abs(-d[0]*yf[1]+d[1]*yf[0])-.62));speedGap=Math.max(speedGap,Math.abs((A.human.speed??0)-(B.human.speed??0)));}}
 assert.equal(receipt(ana,w1).phase,'completed',JSON.stringify(receipt(ana,w1)));assert.ok(moving>40,'they walked '+moving);
 assert.ok(lag<=.1,'lag '+lag);assert.ok(lat<=.06,'lateral '+lat);assert.ok(speedGap<=.05,'pace '+speedGap);
 assert.ok(edge.together.handsWith(ana.entityId),'still holding hands at the lawn');
 report.walk={moving,lag:+lag.toFixed(4),lateral:+lat.toFixed(4),speedGap:+speedGap.toFixed(4),turnedTogether:turnSeen};
 // ---- Ana walks on to the orchard with Ben; on the way Ben is told to go to Cy instead: he lets go first, then goes
 const w3=await act(ana,'walk to the orchard');
 assert.ok(await until(()=>(B.human.speed??0)>.5,400)>=0,'walking together again');await tick(30);
 const w2=await act(ben,'go near Cy');
 assert.ok(await until(()=>B.human.handHold?.release!==undefined,200)>=0,'he lets go first');
 const releasedAt=W().tick,startPos=[...B.pose.p];
 assert.ok(await until(()=>B.human.task&&f.host.engine.runtime.records.get(B.human.task)?.verb==='walk_to'&&Math.hypot(B.pose.p[0]-startPos[0],B.pose.p[2]-startPos[2])>.05,400)>=0);
 report.release={ticksBeforeOwnWalk:W().tick-releasedAt};
 assert.ok(W().tick-releasedAt>=17,'the release plays in full before he walks off: '+(W().tick-releasedAt));
 assert.match(messages(ana).filter(m=>m.kind==='hands.released').at(-1)?.text??'',/Ben let go of your hand/);
 assert.ok(await until(()=>ended(ben,w2),1200)>=0);assert.equal(receipt(ben,w2).phase,'completed');
 assert.ok(await until(()=>ended(ana,w3),1200)>=0);assert.equal(receipt(ana,w3).phase,'completed','Ana walks on alone');
 assert.ok(!edge.together.handsWith(ana.entityId),'nobody pulls anyone along');
 // ---- once more by hand: Ben offers, Ana takes it, then Ana lets go
 const h4=await act(ben,'hold hands with Ana');assert.ok(await until(()=>edge.together.invitesFor(ana.soulId).length>0,400)>=0);
 const h5=await act(ana,'accept');assert.ok(await until(()=>ended(ben,h4)&&ended(ana,h5),1200)>=0);assert.equal(receipt(ana,h5).phase,'completed',JSON.stringify([receipt(ana,h5),receipt(ben,h4),at(ana),at(ben),at(cy)]));
 assert.ok(edge.together.handsWith(ben.entityId));
 const lg=await act(ana,'let go of his hand');assert.ok(await until(()=>ended(ana,lg))>=0);assert.equal(receipt(ana,lg).phase,'completed');
 assert.ok(!edge.together.handsWith(ben.entityId)&&!edge.together.handsWith(ana.entityId));
 assert.match(messages(ben).filter(m=>m.kind==='hands.released').at(-1)?.text??'',/Ana let go of your hand/);
 await tick(60);
 assert.equal(B.human.handHold,undefined,'state cleared after the arms are down');
 // ---- context bytes
 const nearCy=await here(cy);
 report.hereBytes={absent:sz(absent),distant100Pairs:sz(far),nearbyBystander:sz(nearCy),offereeAbsent:sz(absentAna),offereeWithOffer:sz(benHand),offereeJoined:sz(near),offerLineBytes:Buffer.byteLength(JSON.stringify({offer:benHand.me.offer})),holdingLineBytes:Buffer.byteLength(JSON.stringify({hands:near.me.hands}))};
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 Object.assign(report,{status:'pass',retries,distantScene,checks:['offer in plain words; the offeree alone sees one line','decline is polite and final (invite.gone after)','a throw is required with the offer and the acceptance (rps.choose)','one shared count; no throw shown before shoot; arm\'s length 0.95-1.05 m','the world referees; both told the result','an unanswered offer lapses','an offered hand can be withdrawn; Ben never moved before accepting','taking her hand: side by side 0.58-0.68 m, same facing; both see "holding hands with"','walk together: Ana leads, Ben beside her at her pace','told to go elsewhere, Ben lets go first (the release in full), then walks','letting go asked in plain words','100 distant pairs and their offers: +0 bytes; the bystander +0 throughout','zero native violations']});
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));}console.log(JSON.stringify(report));
});
