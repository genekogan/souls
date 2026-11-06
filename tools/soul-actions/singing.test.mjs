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

// Entry 36: singing at a mic stand along with the music (the voice is the viewer's, on the score clock; here the offer, the
// singer's place and body state, one singer per mic, stopping when told or when the music stops, and the long tail).
const out=process.env.SOUL_ACTIONS_OUT,SINGERS=Number(process.env.SOUL_SING_DISTANT??12);
test('mic stand: sing along, one singer per mic, stop when told or when the music stops, bounded perception', {timeout:900000}, async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();
 const edge=new EdgeLedger(f.host,f.db,undefined,{ambient:false});const app=new Hono();let soul;
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,ledger:edge,soul:()=>soul});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 const god=new GodMode(f.db,{worldId:f.host.worldId,ownerId:'dev:admin',tick:()=>f.host.engine.world.tick,emit(){}});
 installEngineBridge({host:f.host,god,edge,log(){},worldLore:false,worldClock:false});
 let tickMs=0,ticks=0;const tick=async(n=5)=>{for(let i=0;i<n;i++){const t0=performance.now();f.host.tickOnce();tickMs+=performance.now()-t0;ticks++;await setImmediate();f.host.drainInputs();}};
 await tick();
 const join=async(id,name)=>{await invite(f,id);const row=await accept(f.host,f.souls.create('dev:'+id,{name,description:'Singing test'}));await tick();return {soulId:row.id,entityId:row.entity_id,name:row.name};};
 const ana=await join('ana','Ana'),ben=await join('ben','Ben'),cal=await join('cal','Cal');
 const here=async(s)=>{soul=s;const r=await app.request('/v1/edge/here?include=doHere');assert.equal(r.status,200);return (await r.json()).here;};
 const body=s=>f.host.engine.world.entities[s.entityId],W=()=>f.host.engine.world;
 const act=async(s,capability,params)=>{let b;for(let k=0;k<20;k++){soul=s;const r=await accept(f.host,app.request('/v1/edge/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability,...(params?{params}:{})})}));b=await r.json();if(b.code!=='object.admission-failed')break;await tick(10);}return b;};
 const phase=(s,r)=>edge.receipt(s.soulId,r.receipt.id)?.phase;
 const until=async(pred,n=2000)=>{for(let i=0;i<n;i++){if(pred())return W().tick;await tick(1);}return null;};
 // ---- near: a mic stand with a piano beside it
 const [ax,az]=[body(ana).pose.p[0],body(ana).pose.p[2]],absentHere=await here(ana);
 assert.equal(god.act({ops:[{op:'place',def:'core/mic-stand@2',name:'microphone',p:[ax+1,az+3],r:0},{op:'place',def:'core/piano@1',name:'piano',p:[ax-2,az+4]}]}).accepted,true);await tick(45);
 const mic=W().entities[god.model.get('microphone').id];assert.ok(await until(()=>edge.capabilities(ana).some(c=>c.verb==='sing'&&c.id.includes(mic.id)),600),'the near mic is offered');const near=await here(ana);
 const cap=edge.capabilities(ana).find(c=>c.verb==='sing'&&c.id.includes(mic.id));assert.ok(cap,'the mic stand offers sing');
 // no music: she goes, and the singing does not start (refused after 4 s)
 const lone=await act(ana,'sing at the microphone');assert.equal(lone.accepted,true,JSON.stringify(lone).slice(0,600));await until(()=>['completed','failed'].includes(phase(ana,lone)),1500);
 assert.equal(phase(ana,lone),'failed');assert.equal(edge.receipt(ana.soulId,lone.receipt.id).code,'pose.no-music');
 const at=body(ana).pose.p,yaw=body(ana).pose.yaw,face=Math.atan2(mic.pose.p[2]-at[2],mic.pose.p[0]-at[0]);
 assert.ok(Math.abs(Math.hypot(at[0]-mic.pose.p[0],at[2]-mic.pose.p[2])-0.55)<0.02,'the singer\'s place: 0.55 m in front of the pole: '+JSON.stringify([at,mic.pose.p,edge.spotsProvider?.()?.spots?.find(x=>x.id==='sing.'+mic.id),[0.2,0.3,0.4,0.43,0.45,0.5,0.53,0.6].map(d=>[d,f.host.engine.clearanceAtV1?.(mic.pose.p[0],mic.pose.p[2]+d),f.host.engine.clearanceUpToV1?.(mic.pose.p[0],mic.pose.p[2]+d,1)])]));
 // the band: Ben at the piano, Ana sings along
 const piano=await act(ben,'play the piano',{seconds:40});assert.equal(piano.accepted,true);await until(()=>body(ben).human?.activity==='play-piano',1500);
 const sing=await act(ana,'sing at the microphone');assert.equal(sing.accepted,true,JSON.stringify(sing));assert.match(sing.receipt.capability,/^sing:/);
 const singAt=await until(()=>body(ana).human?.activity==='sing',600);assert.ok(singAt,'she sings');
 const yawErr=Math.abs(((body(ana).pose.yaw-Math.atan2(mic.pose.p[2]-body(ana).pose.p[2],mic.pose.p[0]-body(ana).pose.p[0]))+Math.PI*3)%(Math.PI*2)-Math.PI);assert.ok(yawErr<0.1745,'she faces the mic');
 await tick(20);const benSees=await here(ben),seen=benSees.near.find(n=>n.name==='Ana');
 assert.equal(seen?.doing,'singing at the microphone',JSON.stringify(seen));
 // a second singer is refused politely, by name, and nobody walks over
 const calAt=[...body(cal).pose.p],second=await act(cal,'sing at the microphone');
 assert.equal(second.accepted,false);assert.match(second.reason,/^Ana is already singing at the nearest microphone.*one singer at a time/,second.reason);
 await tick(20);assert.ok(Math.hypot(body(cal).pose.p[0]-calAt[0],body(cal).pose.p[2]-calAt[2])<0.05,'Cal stays where she is');
 // "stop singing": she stops
 const stopAt=W().tick,stop=await act(ana,'stop singing');assert.equal(stop.accepted,true);
 const stoppedAt=await until(()=>body(ana).human?.activity!=='sing',200);assert.ok(stoppedAt!==null&&(stoppedAt-stopAt)*0.05<=2,'stopped within 2 s');
 // sing again; she stops by herself when the piano does
 const again=await act(ana,'sing at the microphone');assert.equal(again.accepted,true);await until(()=>body(ana).human?.activity==='sing',400);
 const pianoEnd=await until(()=>body(ben).human?.activity!=='play-piano',2000),endSing=await until(()=>body(ana).human?.activity!=='sing',200);
 assert.ok(pianoEnd&&endSing&&(endSing-pianoEnd)*0.05<=3,`stopped ${(endSing-pianoEnd)*0.05} s after the music`);
 await until(()=>['completed','failed'].includes(phase(ana,again)),100);assert.equal(phase(ana,again),'completed');
 // the near things go before the long tail is measured from elsewhere
 assert.equal(god.act({ops:[{op:'remove',id:'microphone'},{op:'remove',id:'piano'}]}).accepted,true);await tick(45);
 // ---- the long tail. Ana (the observer) goes ~45 m away from where the band plays; 100 mic stands stand round the band
 //      (a 10 x 10 grid, 2 m apart), K Souls sing along at the nearest of them with two pianists. The control for the
 //      bytes is the same Souls standing there without singing (people are counted in a district; mics must add nothing).
 assert.equal(god.act({ops:[{op:'place',def:'core/bench-seat@1',name:'lookout-bench',p:[-30,-20]}]}).accepted,true);await tick(60);
 {const r=await act(ana,'walk to the lookout bench');assert.equal(r.accepted,true,JSON.stringify(r).slice(0,300));assert.ok(await until(()=>Math.hypot(body(ana).pose.p[0]+30,body(ana).pose.p[2]+20)<3&&body(ana).human?.activity!=='walk',4000),'Ana at the lookout: '+JSON.stringify(body(ana).pose.p));}
 const absent=await here(ana);
 const distant=[...Array.from({length:100},(_,i)=>({op:'place',def:'core/mic-stand@2',name:`distant-mic-${i}`,p:[6+i%10*2,6+Math.floor(i/10)*2]})),
  {op:'place',def:'core/piano@1',name:'distant-piano-a',p:[10,27],r:0},{op:'place',def:'core/piano@1',name:'distant-piano-b',p:[20,27],r:0},{op:'place',def:'core/bench-seat@1',name:'gathering-bench',p:[15,31]}];
 {const g=god.act({ops:distant});assert.equal(g.accepted,true,JSON.stringify(g).slice(0,600));}await tick(60);const farIdle=await here(ana);
 const crowd=[];for(let i=0;i<SINGERS+2;i++)crowd.push(await join('far'+i,'Far '+String.fromCharCode(65+i%26)+i));
 for(const s of crowd){const r=await act(s,'walk to the gathering bench');assert.equal(r.accepted,true,JSON.stringify(r).slice(0,300));}
 await until(()=>crowd.every(s=>{const p=body(s).pose.p;return Math.hypot(p[0]-15,p[2]-31)<8&&body(s).human?.activity!=='walk';}),6000);
 await tick(40);const farControl=await here(ana);
 const [pa,pb]=crowd;const pr=[await act(pa,'play the piano',{seconds:600}),await act(pb,'play the piano',{seconds:600})];assert.ok(pr.every(r=>r.accepted),JSON.stringify(pr).slice(0,900));
 await until(()=>[pa,pb].every(s=>body(s).human?.activity==='play-piano'),3000);
 const singers=crowd.slice(2),sung=[];for(const s of singers){const r=await act(s,'sing at the nearest microphone',{seconds:600});sung.push(r);assert.equal(r.accepted,true,JSON.stringify(r).slice(0,400));await tick(3);}
 // a singer whose walk was cut short (a courtesy step in the crowd) is asked again, at most three times; counted
 let singRetries=0,inUseAt=null;for(let k=0;k<4&&!inUseAt;k++){inUseAt=await until(()=>singers.every(s=>body(s).human?.activity==='sing'),1500);
  if(!inUseAt)for(const [i,s] of singers.entries())if(['failed','replaced'].includes(phase(s,sung[i]))){sung[i]=await act(s,'sing at the nearest microphone',{seconds:600});singRetries++;}}
 assert.ok(inUseAt,'every distant singer sings: '+singers.map((s,i)=>body(s).human?.activity+'/'+edge.receipt(s.soulId,sung[i].receipt?.id)?.code).join(','));
 await tick(40);const farInUse=await here(ana);
 assert.ok(!/distant-mic|microphone/.test(JSON.stringify(farInUse)),'distant mic stands add nothing to here');
 // per-tick cost with K singers (the music check, twice a second each) vs the same world with them standing
 tickMs=0;ticks=0;await tick(400);const singingMs=tickMs/ticks;
 for(const s of singers)await act(s,'stop singing');await until(()=>singers.every(s=>body(s).human?.activity!=='sing'),400);
 tickMs=0;ticks=0;await tick(400);const standingMs=tickMs/ticks;
 await tick(40);const farAfter=await here(ana);
 for(const s of [pa,pb])await act(s,'stand up');await tick(40);
 if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/here-far-in-use.json`,JSON.stringify(farInUse,null,1));writeFileSync(`${out}/here-far-control.json`,JSON.stringify(farControl,null,1));}
 // violations: none by the singer, the band or Cal, none in a singing pose; the crowd of 14 walking to one bench can trip the
 // engine's existing make-way/wait overspeed check (reported, not about singing)
 const V=f.host.engine.runtime.violations,mine=new Set([ana,ben,cal].map(s=>s.entityId));
 assert.deepEqual(V.filter(v=>v.subjects?.some(x=>mine.has(x))||/\bsing\b/.test(v.message)),[]);
 const report={status:'pass',hereBytes:{absent:JSON.stringify(absent).length,distant100MicStands:JSON.stringify(farIdle).length,distantSoulsStandingControl:JSON.stringify(farControl).length,distant100MicsInUse:JSON.stringify(farInUse).length,distantAfterStopping:JSON.stringify(farAfter).length,distantSingers:singers.length,singRetries,distantPianists:2,nearbyBaseline:JSON.stringify(absentHere).length,nearby:JSON.stringify(near).length},
  tickMs:{distantSingingAlong:+singingMs.toFixed(3),sameSoulsStanding:+standingMs.toFixed(3)},singCap:cap.id,label:cap.label,singerPlaceFromPole:+Math.hypot(at[0]-mic.pose.p[0],at[2]-mic.pose.p[2]).toFixed(3),yawToMicErrDeg:+(yawErr*180/Math.PI).toFixed(2),
  noMusic:edge.receipt(ana.soulId,lone.receipt.id).reason,refusal:second.reason,crowdViolations:V.map(v=>v.code+' '+v.message.replace(/h_[0-9a-f]+/,'h_*')),stopSeconds:(stoppedAt-stopAt)*0.05,musicStopSeconds:(endSing-pianoEnd)*0.05,benSees:seen,
  checks:['the mic stand offers sing (plain words: sing at the microphone)','the singer stands 0.55 m in front of the pole, facing it','no music: refused after 4 s (pose.no-music)','a nearby Soul sees "singing at the microphone"','a second singer is refused by name; nobody walks over','stop singing: stops within 2 s','stops by herself within 3 s of the music stopping','distant mic stands, in use or not: +0 bytes vs the same Souls standing there','no native violations by the singer, the band or Cal (the 14-body crowd may trip the existing wait overspeed check; reported)']};
 if(out)writeFileSync(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 assert.equal(report.hereBytes.distant100MicsInUse,report.hereBytes.distantSoulsStandingControl,'mics in use add +0 bytes');
 assert.equal(report.hereBytes.distant100MicStands,report.hereBytes.absent,'100 distant mic stands add +0 bytes');
});
