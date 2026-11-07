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

// M03 (entry 30): entries 18-28 composed, in a crowded scene around one Soul, against the same layout built from frozen
// v1 (inert) defs, plus 100 distant in-use copies of each interactive family. Also the server's per-tick cost.
const out=process.env.SOUL_ACTIONS_OUT,TICKS=Number(process.env.M03_TICKS??600);
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
};
const WORDS=/far note|far soup|far club|far question|Zed|Yan|Picnic|Swap books|Soup 3|Volleyball|Lunch tomorrow/;
function stats(xs){const s=[...xs].sort((a,b)=>a-b);return {n:s.length,meanMs:+(s.reduce((a,b)=>a+b,0)/s.length).toFixed(4),p95Ms:+s[Math.floor(s.length*.95)].toFixed(4),maxMs:+s[s.length-1].toFixed(4)};}
async function scene(version,{distant=true}={}){
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
 await tick(20);const tickEmpty=await timed();
 const absent=await here(),ord0=ordinary();
 let far=[];
 if(distant){
  // 100 distant copies of each family (16 placed families; the two planters share one family): in-use states on the new defs
  const fams=Object.entries(FAMILIES).filter(([k])=>k!=='bed-b');
  far=fams.flatMap(([k,fam],j)=>Array.from({length:100},(_,i)=>({op:'place',def:fam[col],name:`far-${k}-${i}`,p:[150+(j%4)*55+i%10*5,150+Math.floor(j/4)*55+Math.floor(i/10)*5],...(col===1&&Object.keys(fam[4]).length?{state:fam[4]}:{})})));
  for(let i=0;i<far.length;i+=100){const r=god.act({ops:far.slice(i,i+100)});assert.equal(r.accepted,true,JSON.stringify(r).slice(0,400));}
 }
 await tick(45);const distantHere=await here();
 const b=f.host.engine.world.entities[soul.entityId],[x,z]=[b.pose.p[0],b.pose.p[2]];
 const near=Object.entries(FAMILIES).map(([k,fam])=>({op:'place',def:fam[col],name:k,p:[x+fam[2][0],z+fam[2][1]],...(col===1&&Object.keys(fam[3]).length?{state:fam[3]}:{})}));
 {const r=god.act({ops:near});assert.equal(r.accepted,true,JSON.stringify(r).slice(0,600));}
 await tick(45);
 const crowded=await here(),caps=edge.capabilities(soul);
 const t0=performance.now();for(let i=0;i<20;i++)await here();const hereMs=(performance.now()-t0)/20;
 const tickCrowd=await timed();
 const farNames=new Set(far.map(o=>o.name)),farIds=new Set(far.map(o=>god.model.get(o.name)?.id).filter(Boolean));
 const report={version,distantThings:far.length,absent:JSON.stringify(absent).length,distant:JSON.stringify(distantHere).length,crowded:JSON.stringify(crowded).length,
  objects:crowded.objects.map(o=>o.kind+(o.state?JSON.stringify(o.state):'')),doHere:crowded.doHereCoverage,doHereIds:crowded.doHere.map(c=>c.id.replace(/e_[0-9a-f]+/,'#')),
  ordinaryBefore:ord0,ordinaryAfter:ordinary(),capsTotal:caps.length,// walk:<named place> is the existing navigation catalogue (any named thing, v1 too), counted apart from object offers
  distantOffers:caps.filter(c=>!c.id.startsWith('walk:')&&(c.object&&farIds.has(c.object)||c.target&&farIds.has(c.target.id)||c.id.startsWith('read:')&&farIds.has(c.id.slice(5)))).length,
  distantWalkOffers:caps.filter(c=>c.id.startsWith('walk:')&&farNames.has(c.id.slice(5))).length,
  herePerRequestMs:+hereMs.toFixed(2),
  leaks:{distant:WORDS.test(JSON.stringify(distantHere))||[...farNames].some(n=>JSON.stringify(distantHere).includes(n)),crowded:WORDS.test(JSON.stringify(crowded))},
  tickMs:{empty:tickEmpty,crowd:tickCrowd},violations:f.host.engine.runtime.violations.length};
 if(out){mkdirSync(out,{recursive:true});const tag=`${version}${distant?'':'-crowd-only'}`;for(const [n,v] of [['absent',absent],['distant',distantHere],['crowded',crowded]])writeFileSync(`${out}/here-${tag}-${n}.json`,JSON.stringify(v,null,1));}
 comms.close();f.host.stop();f.db.close();return report;
}
test('M03 crowded scene: v1 layout vs entries 18-28, 100 distant in-use copies of each family, server tick cost', {timeout:900000}, async()=>{
 const v1=await scene('v1'),v3=await scene('m03');
 const v1Crowd=await scene('v1',{distant:false}),v3Crowd=await scene('m03',{distant:false});
 for(const r of [v1,v3,v1Crowd,v3Crowd]){assert.equal(r.violations,0,r.version);assert.equal(r.leaks.distant,false,'no distant words or names in here');assert.equal(r.leaks.crowded,false,'no board words in the crowded here');}
 assert.equal(v3.distant,v3.absent,`${v3.distantThings} distant in-use things add nothing`);
 assert.equal(v3.distantOffers,0,'no distant object offers');
 assert.deepEqual(v3.ordinaryAfter,v3.ordinaryBefore,'ordinary offers still offered');
 const report={v1,m03:v3,crowdOnly:{v1:v1Crowd,m03:v3Crowd},
  delta:{crowdedBytes:v3.crowded-v1.crowded,distantBytes:v3.distant-v3.absent,v1DistantBytes:v1.distant-v1.absent},
  tickMs:{empty:v3.tickMs.empty,v1Crowd:v1Crowd.tickMs.crowd,m03CrowdPlusDistant:v3.tickMs.crowd,
   alsoMeasured:{v1CrowdPlusDistant:v1.tickMs.crowd,m03CrowdOnly:v3Crowd.tickMs.crowd,emptyV1Fixture:v1.tickMs.empty}},
  ticksPerMeasurement:TICKS};
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/crowd.json`,JSON.stringify(report,null,2));}console.log(JSON.stringify(report));
});
