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
import {HOOK_PEG, CAN_GRIP} from '../../packages/world-compiler/src/core-kit/watering-can.ts';

// M04 (entry 40): entries 18-39 (and 29) composed, in a crowded scene around one Soul, against the same layout built from
// frozen v1 (inert) defs, plus 100 distant in-use copies of each interactive family (the 16 of M03 and the 11 of tranche 4:
// doors, locked doors, torches, a neon sign, growing planters, cans on hooks, poster walls, wanted boards, lit lanterns,
// radios), and one distant Soul carrying a lit lantern. Also the server's per-tick cost.
const out=process.env.SOUL_ACTIONS_OUT,TICKS=Number(process.env.M04_TICKS??600);
// [v1 def, new def, offset from the Soul (x, z), nearby state, distant in-use state]
const FAMILIES={
 'bed-a':['core/planter-box@1','core/garden-planter@1',[-1.4,-2.2],{moisture:0},{moisture:0}],
 'bed-b':['core/planter-box@1','core/garden-planter@1',[0.4,-2.2],{moisture:1},{moisture:0}],
 notes:['core/notice-board@1','core/notice-board@3',[-2.2,2.4],{text:'Picnic at noon\nSwap books',textBy:'s_x,s_y'},{text:'far note one\nfar note two',textBy:'s_z,s_y'}],
 jukebox:['core/radio@1','core/jukebox@2',[2.0,-0.2],{on:false},{on:true}],
 fountain:['core/fountain@1','core/garden-fountain@2',[7,-1],{on:false},{on:true}],
 candle:['core/candle@1','core/candle-stand@1',[1.3,1.2],{on:false},{on:true}],
 lights:['core/string-lights@1','core/string-lights@2',[-5,-0.9],{on:false},{on:true}],
 campfire:['core/campfire@1','core/campfire@2',[-3.5,-5.5],{on:false},{on:true}],
 curtains:['core/window@1','core/curtained-window@1',[-4.8,1.6],{},{open:false}],
 blind:['core/window@1','core/blind-window@1',[-4.8,3.6],{},{open:false}],
 chest:['core/dresser@1','core/drawer-chest@1',[3.6,-2.6],{},{open:true}],
 chalk:['core/chalkboard@1','core/chalkboard@2',[0,3.6],{text:'Soup 3 / Bread 2',textBy:'s_x'},{text:'far soup of the day',textBy:'s_z'}],
 sheet:['core/sandwich-board@1','core/signup-sheet@1',[1.8,3.6],{title:'Volleyball at five'},{title:'far club',text:'Zed\nYan',textBy:'s_z,s_y'}],
 poll:['core/wall-board@1','core/poll-board@1',[4.6,4.6],{title:'Lunch tomorrow?',options:'Soup|Salad'},{title:'far question?',options:'Red|Blue',text:'Red — 1 vote\nBlue — 0 votes',textBy:'s_z:0'}],
 drums:['core/stool@1','core/drum-kit@2',[1.5,-5],{},{}],
 piano:['core/piano@1','core/piano@1',[3.8,0.8],{},{}],
 game:['core/chalkboard@1','core/tictactoe-board@1',[-0.6,5.8],{},{text:'XO.X.O...',textBy:'s_zed,s_yan',players:'Zed,Yan'}],
 // tranche 4 (entries 29, 31-38): [v1, new, offset, nearby state, distant in-use state]
 door:['core/door@1','core/door@2',[0,-9.5],{},{open:true}],
 locked:['core/door@1','core/door@3',[3.5,-9.5],{},{locked:true}],
 torch:['core/lantern-post@1','core/standing-torch@1',[-9.5,0],{on:false},{on:true}],
 walltorch:['core/lantern@1','core/wall-torch@1',[-9.5,-3],{on:false},{on:true}],
 neon:['core/sign@1','core/neon-sign@1',[-9.5,3.5],{on:false,text:'Open late'},{on:true,text:'Far sign'}],
 grow:['core/planter-box@1','core/garden-planter@2',[9.5,-6],{moisture:1,growth:2},{moisture:0.1,growth:3}],
 can:['core/watering-can@1','core/watering-can@3',[-6,-9.5],{level:0},{level:1}],
 posters:['core/poster@1','core/poster-wall@1',[4,9.5],{},{text:'secret show',textBy:'FULLWALL'}],
 wanted:['core/notice-board@1','core/wanted-board@1',[-4,9.5],{},{text:'secret thing',textBy:'FULLBOARD'}],
 lantern:['core/lantern@1','core/lantern@3',[10.5,4],{on:true},{on:true}],
 radio:['core/radio@1','core/radio@2',[11.5,0],{on:false},{on:true,station:'dance band'}],
};
const WORDS=/far note|far soup|far club|far question|Zed|Yan|Picnic|Swap books|Soup 3|Volleyball|Lunch tomorrow|secret|Far sign|Open late/;
// entry 38's full poster wall and wanted board (secret words everywhere), as in posters.test.mjs
const FULLWALL=JSON.stringify([0,1,2,3].map(s=>({s,t:`secret show ${s}`,d:'secret detail',by:'s_z',n:'Zed',day:0}))),FULLBOARD=JSON.stringify(['w','o'].flatMap(c=>[0,1].map(r=>({c,r,t:`${c==='w'?'Wanted':'Offered'}: secret thing ${r}`,by:'s_z',n:'Zed',re:[{t:'secret reply',by:'s_y',n:'Yan'}],...(r===0?{tk:{by:'s_y',n:'Yan'}}:{})}))));
const stateOf=s=>s.textBy==='FULLWALL'?{...s,textBy:FULLWALL}:s.textBy==='FULLBOARD'?{...s,textBy:FULLBOARD}:s;
// a can hangs on its hook (entry 34): new side only, one hook per can
const CARRIER=[-28,-28];
const HANG=[HOOK_PEG[0]-CAN_GRIP[0],HOOK_PEG[1]-CAN_GRIP[1],HOOK_PEG[2]-CAN_GRIP[2]];
function stats(xs){const s=[...xs].sort((a,b)=>a-b);return {n:s.length,meanMs:+(s.reduce((a,b)=>a+b,0)/s.length).toFixed(4),p95Ms:+s[Math.floor(s.length*.95)].toFixed(4),maxMs:+s[s.length-1].toFixed(4)};}
const LOG=process.env.M04_CROWD_LOG?(...a)=>console.error(new Date().toISOString(),...a):()=>{};
async function scene(version,{distant=true}={}){
 LOG('scene',version,distant);
 const col=version==='v1'?0:1;
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 const tick=async(n=5)=>{for(let i=0;i<n;i++){f.host.tickOnce();await setImmediate();f.host.drainInputs();}};
 // the server's own tick only: host.tickOnce() timed, then the same yield/drain as the fixture's ordinary loop
 const timed=async(n=TICKS)=>{const ms=[];for(let i=0;i<n;i++){const t0=performance.now();f.host.tickOnce();ms.push(performance.now()-t0);await setImmediate();f.host.drainInputs();}return stats(ms);};
 await tick();await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'Crowd test'}));soul={soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner};await tick();
 const here=async()=>{const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const ordinary=()=>edge.capabilities(soul).filter(c=>['stand:here','wave:here','rest:here','sit-ground:here'].includes(c.id)).map(c=>c.id).sort();
 // a second Soul far away (before the baseline, so the baseline already holds him): later he carries a lit lantern
 await invite(f,'bo');const brow=await accept(f.host,f.souls.create('dev:bo',{name:'Bo',description:'Crowd test carrier'}));const bo={soulId:brow.id,entityId:brow.entity_id,name:brow.name,owner:brow.owner};await tick(5);
 // the fixture's ground ends ~30 m out: he is relocated to its far corner, ~40 m away (beyond the 30 m sight radius)
 await tick(60);await accept(f.host,f.host.enqueue('edge-relocate','test:crowd',{soulId:bo.soulId,entityId:bo.entityId,to:CARRIER,why:'crowd carrier far away'}));await tick(20);
 LOG('bo at',JSON.stringify(f.host.engine.world.entities[bo.entityId].pose.p));
 await tick(20);LOG('timing empty');const tickEmpty=await timed();LOG('placing distant');
 const absent=await here(),ord0=ordinary();
 let far=[];
 if(distant){
  // 100 distant copies of each family (16 placed families; the two planters share one family): in-use states on the new defs
  const fams=Object.entries(FAMILIES).filter(([k])=>k!=='bed-b');
  far=fams.flatMap(([k,fam],j)=>Array.from({length:100},(_,i)=>{const p=[150+(j%6)*55+i%10*5,150+Math.floor(j/6)*55+Math.floor(i/10)*5],st=col===1&&Object.keys(fam[4]).length?{state:stateOf(fam[4])}:{};
   return k==='can'&&col===1?[{op:'place',def:'core/can-hook@1',tmp:`$h${i}`,name:`far-hook-${i}`,p},{op:'place',def:fam[col],name:`far-${k}-${i}`,in:{parent:`$h${i}`},p:HANG,...st}]:[{op:'place',def:fam[col],name:`far-${k}-${i}`,p,...st}];}).flat());
  // units keep a hook and its can in one edit (the can names its hook by tmp ref)
  const units=[];for(const o of far){if(o.in)units[units.length-1].push(o);else units.push([o]);}
  for(let i=0,batch=[];i<=units.length;i++){if(i===units.length||batch.length+units[i].length>100){const r=god.act({ops:batch});assert.equal(r.accepted,true,JSON.stringify(r).slice(0,400));batch=[];if(i===units.length)break;}batch.push(...units[i]);}
 }
 // the carried lantern: a lit lantern on a table beside Bo; on the new defs he picks it up and holds it
 let carried=null;
 if(distant){const bb=f.host.engine.world.entities[bo.entityId];
  {const r=god.act({ops:[{op:'place',def:'core/table@1',name:'far-carrier-table',p:[bb.pose.p[0]+1.6,bb.pose.p[2]]},{op:'place',def:col?'core/lantern@3':'core/lantern@1',name:'far-carried-lantern',in:{parent:'far-carrier-table',slot:'top'},p:[0,0],...(col?{state:{on:true}}:{})}]});assert.equal(r.accepted,true,JSON.stringify(r).slice(0,400));}
  await tick(40);
  if(col){const item=[...god.model.entities.values()].find(e=>e.name==='far-carried-lantern').id,r=await accept(f.host,edge.act(bo,{capability:'pick-up:'+item}));assert.equal(r.accepted,true,JSON.stringify(r).slice(0,300));
   for(let n=0;n<1400&&!['completed','failed','replaced'].includes(edge.receipt(bo.soulId,r.receipt.id)?.phase);n++)await tick(1);
   carried={phase:edge.receipt(bo.soulId,r.receipt.id)?.phase,support:f.host.engine.world.entities[item].support.kind,held:f.host.engine.world.entities[bo.entityId].human?.heldItemsV1??null,
    distanceFromAna:+Math.hypot(bb.pose.p[0]-f.host.engine.world.entities[soul.entityId].pose.p[0],bb.pose.p[2]-f.host.engine.world.entities[soul.entityId].pose.p[2]).toFixed(1)};}}
 LOG('carried',JSON.stringify(carried));
 await tick(45);const distantHere=await here();LOG('distant here');
 const b=f.host.engine.world.entities[soul.entityId],[x,z]=[b.pose.p[0],b.pose.p[2]];
 const near=Object.entries(FAMILIES).flatMap(([k,fam])=>{const p=[x+fam[2][0],z+fam[2][1]],st=col===1&&Object.keys(fam[3]).length?{state:stateOf(fam[3])}:{};
  return k==='can'&&col===1?[{op:'place',def:'core/can-hook@1',tmp:'$hn',name:'can-hook',p},{op:'place',def:fam[col],name:k,in:{parent:'$hn'},p:HANG,...st}]:[{op:'place',def:fam[col],name:k,p,...st}];});
 {const r=god.act({ops:near});assert.equal(r.accepted,true,JSON.stringify(r).slice(0,600));}
 await tick(45);
 const crowded=await here(),caps=edge.capabilities(soul);
 const t0=performance.now();for(let i=0;i<20;i++)await here();const hereMs=(performance.now()-t0)/20;
 LOG('timing crowd');const tickCrowd=await timed();LOG('timed crowd');
 const farNames=new Set(far.map(o=>o.name).filter(n=>!n.startsWith('far-hook-'))),farIds=new Set(far.map(o=>god.model.get(o.name)?.id).filter(Boolean));
 const report={version,distantThings:far.length,absent:JSON.stringify(absent).length,distant:JSON.stringify(distantHere).length,crowded:JSON.stringify(crowded).length,
  objects:crowded.objects.map(o=>o.kind+(o.state?JSON.stringify(o.state):'')),doHere:crowded.doHereCoverage,doHereIds:crowded.doHere.map(c=>c.id.replace(/e_[0-9a-f]+/,'#')),
  ordinaryBefore:ord0,ordinaryAfter:ordinary(),capsTotal:caps.length,// walk:<named place> is the existing navigation catalogue (any named thing, v1 too), counted apart from object offers
  distantOffers:caps.filter(c=>!c.id.startsWith('walk:')&&(c.object&&farIds.has(c.object)||c.target&&farIds.has(c.target.id)||c.id.startsWith('read:')&&farIds.has(c.id.slice(5)))).length,
  distantWalkOffers:caps.filter(c=>c.id.startsWith('walk:')&&farNames.has(c.id.slice(5))).length,
  herePerRequestMs:+hereMs.toFixed(2),
  leaks:{distant:WORDS.test(JSON.stringify(distantHere))||[...farNames].some(n=>JSON.stringify(distantHere).includes(n)),crowded:WORDS.test(JSON.stringify(crowded))},
  tickMs:{empty:tickEmpty,crowd:tickCrowd},carried,violations:f.host.engine.runtime.violations.length,violationCodes:[...new Set(f.host.engine.runtime.violations.map(v=>v.code??v.kind??String(v).slice(0,40)))]};
 if(out){mkdirSync(out,{recursive:true});const tag=`${version}${distant?'':'-crowd-only'}`;for(const [n,v] of [['absent',absent],['distant',distantHere],['crowded',crowded]])writeFileSync(`${out}/here-${tag}-${n}.json`,JSON.stringify(v,null,1));}
 comms.close();f.host.stop();f.db.close();return report;
}
test('M04 crowded scene: v1 layout vs entries 18-39, 100 distant in-use copies of each family, server tick cost', {timeout:900000}, async()=>{
 const v1=await scene('v1'),v3=await scene('m04');
 const v1Crowd=await scene('v1',{distant:false}),v3Crowd=await scene('m04',{distant:false});
 for(const r of [v1,v3,v1Crowd,v3Crowd]){assert.equal(r.violations,0,r.version);assert.equal(r.leaks.distant,false,'no distant words or names in here');assert.equal(r.leaks.crowded,false,'no board words in the crowded here');}
 assert.equal(v3.distant,v3.absent,`${v3.distantThings} distant in-use things add nothing`);
 assert.equal(v3.distantOffers,0,'no distant object offers');
 assert.equal(v3.carried?.support,'in-hand','a distant Soul carries a lit lantern');
 assert.deepEqual(v3.ordinaryAfter,v3.ordinaryBefore,'ordinary offers still offered');
 const report={v1,m04:v3,crowdOnly:{v1:v1Crowd,m04:v3Crowd},
  delta:{crowdedBytes:v3.crowded-v1.crowded,distantBytes:v3.distant-v3.absent,v1DistantBytes:v1.distant-v1.absent},
  tickMs:{empty:v3.tickMs.empty,v1Crowd:v1Crowd.tickMs.crowd,m04CrowdPlusDistant:v3.tickMs.crowd,
   alsoMeasured:{v1CrowdPlusDistant:v1.tickMs.crowd,m04CrowdOnly:v3Crowd.tickMs.crowd,emptyV1Fixture:v1.tickMs.empty}},
  ticksPerMeasurement:TICKS};
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/crowd.json`,JSON.stringify(report,null,2));}console.log(JSON.stringify(report));
});
