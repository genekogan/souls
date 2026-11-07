// Actual native sequencer/SQLite and anonymous TCP/Hono/Hub checkpoint. Explicit
// manual source ticks; this proves publication/replay, not real-time audio pacing.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {setImmediate} from 'node:timers/promises';
import {getRequestListener} from '@hono/node-server';
import {WebSocket} from 'ws';
import {marsFactory} from '@souls/engine-mars';
import {hashOf,type RenderSceneRefV1,type NativeGatheringObservationV1} from '@souls/engine-contract';
import {kernelHash} from '@souls/kernel';
import {stationEndTick,stationPhaseAtTick,stationLivePhaseV1,publicEvent,isStationFactV1,type StationLiveV1} from '@souls/protocol';
import {Db} from '../../../src/db.ts';
import {WorldHost,replayFromGenesis} from '../../../src/world.ts';
import {CandidateStationV1} from '../../../src/station.ts';
import {replayStationFactsV1} from '../../../src/station-history.ts';
import {Auth} from '../../../src/auth.ts';
import type {Brain} from '../../../src/brain.ts';
import {Hub} from '../../../src/hub.ts';
import {Souls} from '../../../src/souls.ts';
import {buildApp} from '../../../src/http.ts';
import {config} from '../../../src/config.ts';
import {waitForSocketCondition} from '../../socket-condition.ts';

export const STATION_FIXTURE_WORLD='core-native-station-fixture';
export const STATION_PRIVATE='PRIVATE_STATION_FIXTURE';
export async function acceptStationFixture<T>(host:WorldHost,promise:Promise<T>):Promise<T>{
  let done=false;promise.then(()=>done=true,()=>done=true);
  for(let n=0;n<80&&!done;n++){host.drainInputs();await setImmediate();}
  assert.ok(done,'station request settled without advancing its sampled source tick');return promise;
}
export async function generateStationFixture(){
  const factory=await marsFactory(),directory=mkdtempSync(join(tmpdir(),'core-station-')),path=join(directory,'world.sqlite');
  let db=new Db(path);const seed='native-world-station/1',worldId=STATION_FIXTURE_WORLD;
  let server:ReturnType<typeof createServer>|undefined,hub:Hub|undefined;const sockets:WebSocket[]=[];
  try{
    const host=new WorldHost(db,factory,seed,1e9,worldId);host.boot();host.drainInputs();
    for(const name of ['a','b']){
      const owner=STATION_PRIVATE+'_'+name,soulId='s_'+name,entityId='h_'+name;
      db.upsertUser({id:owner,email:null,wallet:null,role:'user'});db.setInvited(owner,'fixture');
      db.createSoul({id:soulId,entityId,worldId,owner,name:'Fake '+name,description:'Public fixture resident',native:false});
      await acceptStationFixture(host,host.enqueue('birth','fixture',{soulId,entityId,owner,name:'Fake '+name,description:'Public fixture resident'}));
      host.minds.get(soulId)!.nextEvalTick=1e9;
    }
    host.extra.privateJournal=STATION_PRIVATE+'_JOURNAL';
    await acceptStationFixture(host,host.enqueue('intent','fixture',{soulId:'s_a',intent:{goal:'gather',target:'fire',text:STATION_PRIVATE+'_WORDS'},source:'system'}));
    const station=new CandidateStationV1(host),views:{phase:string;observation:NativeGatheringObservationV1;view:StationLiveV1}[]=[];
    const record=async(phase:string)=>{const observation=host.engine.gatheringObservation!();
      views.push({phase,observation,view:await acceptStationFixture(host,station.record())});};
    await record('ordinary');
    for(const name of ['a','b'])await acceptStationFixture(host,host.enqueue('decision','fixture',{soulId:'s_'+name,entityId:'h_'+name,
      option:'native-fixture-gather',label:'Gathering at the fire',steps:[{verb:'gather',params:{at:'fire',seconds:3600}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
    function tickTo(to:number){while(host.engine.world.tick<to){host.tickOnce();if(host.engine.world.tick%20===0){
      for(const chunk of host.engine.takeChunks!(host.engine.world.tick-20)){
        const ref=(chunk.take as {renderSceneRef:RenderSceneRefV1}).renderSceneRef;
        db.saveTake(worldId,chunk,!db.hasRenderSceneCapture(worldId,ref.hash)?host.engine.takeScene!(ref.hash):undefined);
      }
    }}}
    for(let n=0;n<1500&&host.engine.gatheringObservation!().situation!=='gathering';n++)tickTo(host.engine.world.tick+1);
    const gathering=host.engine.gatheringObservation!();assert.equal(gathering.situation,'gathering');assert.equal(gathering.largestCommonTargetMembers,2);
    await record('settled-but-retained');
    assert.equal(views[1].view.cue!.cueId,views[0].view.cue!.cueId);
    tickTo(2563);await record('gathering-performance');
    assert.equal(views[2].view.cue!.pieceId,'zoning-board');assert.equal(views[2].view.cue!.startTick,2563);
    host.paused=true;await record('paused');
    assert.equal(stationLivePhaseV1(views.at(-1)!.view,views.at(-1)!.view.anchor!.serverTimeMs),null);
    host.paused=false;host.clockRate=2;await record('rate-unsupported');
    host.clockRate=1;
    for(const name of ['a','b'])await acceptStationFixture(host,host.enqueue('decision','fixture',{soulId:'s_'+name,entityId:'h_'+name,
      option:'native-fixture-stand',label:'Leaving the fire',steps:[{verb:'stand',params:{}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
    tickTo(2600);assert.equal(host.engine.gatheringObservation!().situation,'ordinary');
    await record('ordinary-but-retained');
    assert.equal(views.at(-1)!.view.cue!.cueId,views[2].view.cue!.cueId);
    tickTo(3303);await record('late-current-cycle');
    assert.equal(stationPhaseAtTick(views.at(-1)!.view.cue!,3303)!.cycle,2);
    tickTo(4000);await record('next-ordinary');
    assert.equal(views.at(-1)!.view.cue!.pieceId,'starfield');
    const beforeSnapshot=host.stationHistoryV1()!,bodyHash=host.engine.stateHash(),kh=kernelHash(host.kernel);
    assert.deepEqual(host.engine.runtime.violations,[]);assert.equal(db.events(worldId).filter(e=>e.kind==='rules'&&e.payload?.recovery).length,0);
    assert.equal('pending' in host.saveSnapshot(true),false);db.close();db=new Db(path);
    const restored=new WorldHost(db,factory,seed,1e9,worldId);assert.equal(restored.boot().from,'snapshot');
    assert.equal(restored.engine.stateHash(),bodyHash);assert.equal(kernelHash(restored.kernel),kh);assert.deepEqual(restored.stationHistoryV1(),beforeSnapshot);
    const replay=replayFromGenesis(factory,seed,db.events(worldId),4000,{includeHeadEvents:true});
    assert.equal(replay.engine.stateHash(),bodyHash);assert.equal(kernelHash(replay.kernel),kh);
    assert.deepEqual(replayStationFactsV1(db.events(worldId),restored.stationBindingV1()),beforeSnapshot);
    db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(worldId);
    const genesisHost=new WorldHost(db,factory,seed,1e9,worldId);assert.equal(genesisHost.boot().from,'genesis');
    assert.equal(genesisHost.engine.stateHash(),bodyHash);assert.equal(kernelHash(genesisHost.kernel),kh);assert.deepEqual(genesisHost.stationHistoryV1(),beforeSnapshot);
    const restarted=new CandidateStationV1(restored);assert.equal(restarted.view().fresh,false);
    const restart=await acceptStationFixture(restored,restarted.record());assert.equal(restart.fresh,true);
    assert.equal(restart.station!.epoch,beforeSnapshot.station.epoch);assert.equal(restart.cue!.cueId,beforeSnapshot.cues.at(-1)!.cueId);
    const cfg={...config,takesPersist:true,worldId,brainMode:'fake' as const,budgetUsdPerDay:0,typesafeKey:undefined,anthropicKey:undefined,privyAppId:'',privyAppSecret:''};
    const auth=new Auth(cfg,db),brain={mode:'fake',callsToday:0,spentToday:0,budget:0,inflight:new Map(),jevMsAvg:0,camera:null,ticker:[],narratives:new Map(),midContext:()=>({options:[]})} as unknown as Brain;
    const souls=new Souls(restored,db,brain,cfg);server=createServer();hub=new Hub(server,restored,auth,db,undefined,restarted);hub.brain=brain;
    const app=buildApp({cfg,db,host:restored,auth,brain,souls,hub,station:restarted});server.on('request',getRequestListener(app.fetch));
    await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
    const messages:any[]=[];
    const address=server!.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
    async function joinClient(){const ws=new WebSocket(origin.replace('http:','ws:')+'/ws'),own:any[]=[];sockets.push(ws);ws.on('message',data=>{const m=JSON.parse(String(data));messages.push(m);own.push(m);});
      await once(ws,'open');ws.send(JSON.stringify({t:'hello',proto:1}));
      await waitForSocketCondition(ws,()=>own.some(m=>m.t==='station'),'initial station');assert.ok(own.some(m=>m.t==='station'));return {ws,messages:own};}
    const firstClient=await joinClient();
    async function get(path:string){const response=await fetch(origin+path);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');return response.json();}
    const publicLive=await get('/v1/station');assert.deepEqual(publicLive,restarted.view());
    const scope=restart.station!,query=(at:number,world=worldId)=>`/v1/station/history?worldId=${world}&epoch=${scope.epoch}&rulesVersion=${encodeURIComponent(scope.rulesVersion)}&tick=${at}`;
    const history=[];for(const at of [0,640,2559,2560,2562,2563,3303,stationEndTick(beforeSnapshot.cues[1])-1e-7,stationEndTick(beforeSnapshot.cues[1]),3999,4000])history.push(await get(query(at)));
    assert.equal((await fetch(origin+query(100,'foreign'))).status,404);
    assert.equal((await fetch(origin+'/v1/station/history?worldId='+worldId+'&epoch=bad&rulesVersion=bad&tick=0')).status,404);
    const pairedTakes=[];for(const [from,to] of [[0,20],[2500,2620],[3280,3320],[3980,4000]])pairedTakes.push(await get(`/v1/takes?from=${from}&to=${to}&limit=120`));
    const captureHash=(pairedTakes[0] as any).chunks[0].take.renderSceneRef.hash,capture=await get('/v1/scenes/'+captureHash);
    const snapshot=restored.snapshotView();
    const streamed=await acceptStationFixture(restored,restarted.record());
    await waitForSocketCondition(firstClient.ws,()=>firstClient.messages.some(m=>m.t==='station'&&m.view.anchor?.revision===streamed.anchor!.revision),'streamed station revision');
    assert.deepEqual(messages.find(m=>m.t==='station'&&m.view.anchor?.revision===streamed.anchor!.revision).view,streamed);
    const closed=once(firstClient.ws,'close');firstClient.ws.terminate();await closed;
    const rejoined=await joinClient();assert.deepEqual(rejoined.messages.find(m=>m.t==='station').view,streamed);
    const facts=db.events(worldId).filter(e=>isStationFactV1(e.kind)).map(publicEvent),finalHistory=restored.stationHistoryV1()!;
    assert.deepEqual(replayStationFactsV1(db.events(worldId),restored.stationBindingV1()),finalHistory);
    const finalGenesis=new WorldHost(db,factory,seed,1e9,worldId);assert.equal(finalGenesis.boot().from,'genesis');
    assert.deepEqual(finalGenesis.stationHistoryV1(),finalHistory);assert.equal(finalGenesis.engine.stateHash(),bodyHash);assert.equal(kernelHash(finalGenesis.kernel),kh);
    const publicOutput={views,restart,live:publicLive,streamed,history,pairedTakes,capture,snapshot,facts};
    assert.ok(!JSON.stringify({publicOutput,messages}).includes(STATION_PRIVATE));assert.equal(db.paidCost(),0);
    await waitForSocketCondition(rejoined.ws,()=>rejoined.messages.some(m=>m.t==='station'),'reconnected station');
    assert.deepEqual(messages.find(m=>m.t==='station').view,publicLive);
    const authored=['packages/protocol/src/station-v1.ts','packages/protocol/src/index.ts','apps/server/src/station.ts','apps/server/src/station-history.ts',
      'apps/server/src/world.ts','apps/server/src/fold.ts','apps/server/src/http.ts','apps/server/src/hub.ts','apps/server/test/fixtures/station/generate.ts'];
    const root=new URL('../../../../../',import.meta.url),sourceSha256=Object.fromEntries(authored.map(path=>[path,createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex')]));
    return JSON.parse(JSON.stringify({contract:'core-native-station-fixture/1',producer:{baseCommit:'e03baf6b3397ee6b4634bde5cba2fcd1737d0407',authoredSourceSha256:sourceSha256},worldId,
      scope:'isolated manual native ticks, actual Date.now anchors and local TCP GET/WS; no audio/listener synchronization or World activity grant',
      ...publicOutput,reconstruction:{headTick:4000,bodyHash,kernelHash:kh,stationHash:hashOf(finalHistory),checkpointStationHash:hashOf(beforeSnapshot),snapshot:'exact',genesis:'exact',namedFactFold:'exact'},
      transport:{anonymousTcpGET:true,anonymousHubWS:true,streamedAnchor:true,reconnectLatestSameCue:true,restartRequiresFreshAnchor:true,privateMarkerMatches:0},paid:0}));
  }finally{for(const ws of sockets)ws.terminate();if(hub)hub.wss.close();if(server?.listening)await new Promise<void>(resolve=>server!.close(()=>resolve()));db.close();rmSync(directory,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify(await generateStationFixture(),null,2)+'\n');
