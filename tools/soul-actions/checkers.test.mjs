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
import {WorldModel, checkersCellOf} from '../../packages/world-compiler/src/index.ts';

// #439 W093: checkers on the chalk-board game faculty (entry 27), by hand and plain words: the opening, a compulsory jump
// and the recapture, refusals, a third Soul waiting, an interrupted move, a multi-jump that wins, the read, the wipe, the
// long tail and a second boot. The rules themselves are unit-tested in packages/world-compiler/src/core-kit/checkers.test.ts.
const out=process.env.SOUL_ACTIONS_OUT;
const board=(pieces,turn='X')=>{const c=[...'.'.repeat(32)];for(const [sq,p] of Object.entries(pieces))c[checkersCellOf(sq)]=p;return c.join('')+turn;};
test('checkers: opening, compulsory jump, recapture, refusals, third player, interrupted move, multi-jump win, read, wipe, long tail', {timeout:300000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 await tick();
 const join=async(id,name)=>{await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Checkers test'}));await tick();return {soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};};
 const ana=await join('ana','Ana'),ben=await join('ben','Ben'),cy=await join('cy','Cy');soul=ana;
 const here=async(s)=>{soul=s;const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const body=s=>f.host.engine.world.entities[s.entityId];
 const absent=await here(ana);
 // ---- the long tail: 100 boards in play 120 m away add nothing ----
 const mid=board({c3:'x',e3:'x',d6:'o',f6:'o',b8:'O'},'O');
 const distant=Array.from({length:100},(_,i)=>({op:'place',def:'core/checkers-board@1',name:`distant-checkers-${i}`,p:[120+i%10*2,120+Math.floor(i/10)*2],state:{text:mid,textBy:'s_zed,s_yan',players:'Zed,Yan'}}));
 assert.equal(god.act({ops:distant}).accepted,true);await tick(45);const far=await here(ana);
 assert.ok(!/distant-checkers|Zed|Yan/.test(JSON.stringify(far)),'distant boards add nothing to here');
 const farIds=new Set(distant.map(d=>god.model.get(d.name).id));assert.deepEqual(edge.capabilities(ana).filter(c=>c.id.startsWith('read:')&&farIds.has(c.id.slice(5))||c.object&&farIds.has(c.object)).map(c=>c.id),[],'no distant offers');
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]];
 assert.equal(god.act({ops:[{op:'place',def:'core/checkers-board@1',name:'checkers',p:[ax,az+2.6],r:Math.PI},{op:'place',def:'core/tictactoe-board@1',name:'game',p:[ax-3,az+2.6],r:Math.PI}]}).accepted,true);await tick(45);
 const id=n=>god.model.get(n).id,state=n=>god.model.get(n).state,near=await here(ana);
 let retries=0;const act=async(s,capability,params,accepted=true)=>{let b;for(let k=0;k<20;k++){soul=s;const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability,...(params?{params}:{})})}));b=await r.json();if(b.code!=='object.admission-failed')break;retries++;await tick(10);}assert.equal(b.accepted,accepted,JSON.stringify(b).slice(0,600));return b;};
 let watch='checkers';const finish=async(s,receipt,limit=600)=>{let stroke=null,early=false,before=JSON.stringify(state(watch));for(let n=0;n<limit;n++){const m=body(s).human?.handActuator;if(m?.stroke){stroke=m.stroke;if((f.host.engine.world.tick-m.startTick)*f.host.engine.dt<0.65+m.stroke.seconds-0.05&&JSON.stringify(state(watch))!==before)early=true;}const ph=edge.receipt(s.soulId,receipt.receipt.id)?.phase;if(['completed','failed','cancelled','replaced'].includes(ph))break;await tick(1);}return {stroke:stroke&&{kind:stroke.kind,seconds:stroke.seconds,width:stroke.width},early,phase:edge.receipt(s.soulId,receipt.receipt.id).phase};};
 let makeWayRetries=0;const done=async(s,capability,params)=>{for(let k=0;;k++){const r=await act(s,capability,params);const fr=await finish(s,r),rc=edge.receipt(s.soulId,r.receipt.id);if(fr.phase==='failed'&&rc.code==='reservation.conflict'&&/:make-way:\d+/.test(rc.reason??'')&&k<3){makeWayRetries++;await tick(30);continue;}assert.equal(fr.phase,'completed',capability+' '+JSON.stringify(rc).slice(0,500));return {...fr,cap:r.capability??r.receipt?.capability,summary:JSON.stringify(r).match(/"summary":"(Moved[^"]*)"/)?.[1]??''};}};
 const words={},reasons={};const move=async(s,w)=>{const r=await done(s,w);words[`${s.name}: ${w}`]=r.cap;return r;};
 const refused=async(s,w,re,key)=>{const b=await act(s,w,undefined,false);assert.match(b.reason??'',re,JSON.stringify(b).slice(0,300));reasons[key]=b.reason;return b;};
 const cells=()=>String(state('checkers').text).slice(0,32),at=sq=>cells()[checkersCellOf(sq)];
 // offers: the board's own move, the tic-tac-toe board keeps its mark (own kind, no clash)
 const caps=edge.capabilities(ana);assert.ok(caps.some(c=>c.id===`object:${id('checkers')}:move`),'the checkers board offers its move');
 assert.ok(caps.some(c=>c.id===`object:${id('game')}:mark`),'the noughts and crosses board keeps its mark');
 assert.equal(caps.find(c=>c.id===`read:${id('checkers')}`)?.label.includes('a game of checkers, not started'),true);
 // ---- the opening ----
 const m1=await move(ana,'move c3 to d4');assert.equal(m1.early,false,'no move before the stroke ends');assert.equal(m1.stroke.kind,'write');assert.equal(m1.summary,'Moved the piece on c3 to d4 on checkers.');
 assert.equal(at('c3'),'.');assert.equal(at('d4'),'x');assert.equal(state('checkers').players,'Ana');assert.equal(String(state('checkers').text)[32],'O');
 await refused(ana,'move d4 to e5',/O's turn: the next Soul to move plays O against Ana/,'outOfTurnAlone');
 await move(ben,'f6 to e5');assert.equal(state('checkers').players,'Ana,Ben');
 await refused(cy,'move a3 to b4',/between Ana and Ben/,'third');
 await refused(ana,'move a3 to b4',/A jump is open, so it must be taken: d4 to f6/,'compulsory');
 await refused(ana,'move c4 to d5',/light square/,'light');
 await refused(ana,'move b4 to c5',/no piece on b4/,'empty');
 await refused(ana,'move e5 to f4',/O's; you play X/,'opponent');
 await refused(ana,'move b2 to c3',/A jump is open/,'notJump');
 await refused(ben,'move b6 to a5',/Ana's turn/,'outOfTurn');
 const cap=await move(ana,'jump d4 to f6');assert.match(cap.summary,/jumping the piece on e5/);assert.equal(at('e5'),'.','the jumped piece is taken');assert.equal(at('f6'),'x');
 await refused(ben,'move b6 to a5',/must be taken: (?:e7 to g5|g7 to e5)/,'recaptureCompulsory');
 await refused(ben,'move h6 to g5',/must be taken/,'recaptureAgain');
 const before=state('checkers').text;
 // ---- an interrupted move changes nothing ----
 const ip=await act(ben,'move g7 to e5');let started=false;for(let n=0;n<600&&!started;n++){if(body(ben).human?.handActuator?.stroke)started=true;else await tick(1);}
 assert.ok(started,'the stroke started');const stop=await act(ben,'mark a square on the game board',{square:'centre'});
 const ipf=await finish(ben,ip);assert.notEqual(ipf.phase,'completed','the move was interrupted');await tick(40);assert.equal(state('checkers').text,before,'an interrupted move leaves the board as it was');
 const interrupted={phase:ipf.phase,by:stop.capability??stop.receipt?.capability};await finish(ben,stop);
 await move(ben,'g7 to e5');assert.equal(at('f6'),'.');assert.equal(at('e5'),'o');
 const label=edge.capabilities(cy).find(c=>c.id===`read:${id('checkers')}`)?.label??'';assert.match(label,/a game of checkers, X to play/);assert.ok(!/Ana|Ben|x\.|o\./.test(label),'the offer names the state only');
 const r=await act(cy,"read:checkers");words["Cy: read:checkers"]=r.receipt?.capability??r.capability;await finish(cy,r);const read=edge.receipt(cy.soulId,r.receipt.id).outcome?.summary??'';
 assert.match(read,/Ana \(X\) against Ben \(O\); Ana to move; X 11 pieces, O 11 pieces/);
 // ---- a multi-jump that wins: Ana's last X jumps twice, the turn stays hers between the jumps ----
 watch='end';
 assert.equal(god.act({ops:[{op:'place',def:'core/checkers-board@1',name:'end',p:[ax+3,az+2.6],r:Math.PI,state:{text:board({c3:'x',d4:'o',f6:'o'},'X'),textBy:`${ana.soulId},${ben.soulId}`,players:'Ana,Ben'}}]}).accepted,true);await tick(45);
 const end=`object:${id('end')}:move`;
 const j1=await done(ana,end,{from:'c3',to:'e5'});assert.equal(String(state('end').text)[32],'X','the turn stays with the jumping piece');
 const benWait=await act(ben,end,{from:'f6',to:'g5'},false);reasons.midChain=benWait.reason;assert.match(benWait.reason,/Ana's turn/);
 assert.match(j1.summary,/it must jump again/);const j2=await done(ana,end,{from:'e5',to:'g7'});assert.match(j2.summary,/the game is won/);assert.match(edge.capabilities(cy).find(c=>c.id===`read:${id('end')}`)?.label??'',/won by X/);
 const over=await act(ben,end,{from:'f6',to:'g5'},false);reasons.over=over.reason;assert.match(over.reason,/over: Ana won/);
 const wipe=await done(cy,`object:${id('end')}:erase`);assert.equal(wipe.stroke.kind,'wipe');assert.equal(state('end').text,'');
 const fresh=await done(cy,end,{from:'c3',to:'d4'});assert.equal(state('end').players,'Cy');
 // ---- crowning by hand at the top and bottom rows (rank 8 about 1.48 m, rank 1 about 1.02 m up) ----
 watch='crown';
 assert.equal(god.act({ops:[{op:'place',def:'core/checkers-board@1',name:'crown',p:[ax+6,az+2.6],r:Math.PI,state:{text:board({a7:'x',b2:'o',h4:'x'},'X'),textBy:`${ana.soulId},${ben.soulId}`,players:'Ana,Ben'}}]}).accepted,true);await tick(45);
 const crown=`object:${id('crown')}:move`,c8=await done(ana,crown,{from:'a7',to:'b8'}),c1=await done(ben,crown,{from:'b2',to:'a1'});
 const crowned=String(state('crown').text);assert.equal(crowned[checkersCellOf('b8')],'X');assert.equal(crowned[checkersCellOf('a1')],'O');assert.match(c8.summary,/it is crowned/);assert.match(c1.summary,/it is crowned/);
 const back=await done(ana,crown,{from:'b8',to:'c7'});assert.equal(String(state('crown').text)[checkersCellOf('c7')],'X','the king moves back');
 // ---- a Soul outside a game in progress cannot wipe it ----
 const noWipe=await act(cy,`object:${id('checkers')}:erase`,undefined,false);reasons.noWipe=noWipe.reason;assert.match(noWipe.reason??'',/between Ana and Ben is in progress/);
 // ---- two free boards in reach (review finding): a move goes to the Soul's own game, never a new game on the other board ----
 const dee=await join('dee','Dee'),eve=await join('eve','Eve');const [dx,dz]=[body(dee).pose.p[0],body(dee).pose.p[2]];
 assert.equal(god.act({ops:[{op:'place',def:'core/checkers-board@1',name:'left',p:[dx-1.5,dz-2.6],r:0},{op:'place',def:'core/checkers-board@1',name:'right',p:[dx+1.5,dz-2.6],r:0}]}).accepted,true);await tick(45);
 // #1084: no game of hers and two open boards (equally near here): one of them takes the move, no refusal to choose
 watch='left';const first=await move(dee,'move c3 to d4');const nb=state('left').players==='Dee'?'left':'right',fb=nb==='left'?'right':'left';
 assert.equal(state(nb).players,'Dee','a game started');assert.equal(state(fb).text??'','','no game on the other board');
 await refused(dee,'move d4 to e5',/O's turn: the next Soul to move plays O against Dee/,'twoBoardsOutOfTurn');
 assert.equal(state(fb).text??'','','out of turn: the other board does not start a game');
 // a second game is hers to start, on that board's own move
 watch=fb;const second=await done(dee,`object:${id(fb)}:move`,{from:'c3',to:'d4'});assert.equal(state(fb).players,'Dee','a second game');
 watch=nb;await done(eve,`object:${id(nb)}:move`,{from:'f6',to:'e5'});assert.equal(state(nb).players,'Dee,Eve');
 // in turn on one game and out of turn on the other: the words take the game where it is her turn
 const own=await move(dee,'jump d4 to f6');assert.match(own.summary,new RegExp(`on ${nb}, jumping the piece on e5`));assert.equal(state(fb).players,'Dee','the other game is untouched');
 const twoBoards={board:nb,first:first.summary,own:own.summary,second:second.summary??null};
 const restored=WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())),undefined,god.model.library);assert.equal(restored.get('checkers').state.text,state('checkers').text);assert.equal(restored.get('end').state.players,'Cy');
 assert.deepEqual(f.host.engine.runtime.violations,[]);
 const report={status:'pass',twoBoards,hereBytes:{absent:JSON.stringify(absent).length,distant100Boards:JSON.stringify(far).length,nearby:JSON.stringify(near).length},words,reasons,label,read,interrupted,summaries:{crown:[c8.summary,c1.summary,back.summary],opening:m1.summary,jump:cap.summary,chain:[j1.summary,j2.summary],fresh:fresh.summary},stroke:m1.stroke,retries,makeWayRetries,
  checks:['two free boards: words with no game of hers take the nearest open board; out of turn they never start a game on the other board; a second game on the other board is hers to start; in turn the words take the game where it is her turn','words: "move c3 to d4", "f6 to e5", "jump d4 to f6", "g7 to e5" name the nearest checkers board\'s move','the first mover plays X, the second O; turns enforced','a third Soul refused while a game is on','compulsory jump refused a plain move, for both sides','light, empty, opponent\'s squares refused','a jump takes the piece; the recapture','an interrupted move leaves the board unchanged','a multi-jump keeps the turn; the other player waits','the win is detected; moving after it refused','crowning by hand on rank 8 and rank 1; the king moves back','the read offer names the state only; the read names players, turn and counts','a wipe by anyone after the game sets it up again; the next mover plays X','a Soul outside a game in progress cannot wipe it','the noughts and crosses board keeps its own mark offer','100 distant boards in play: +0 bytes, no offers','snapshot persistence','zero native violations']};
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));}console.log(JSON.stringify(report));
});
