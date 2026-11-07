import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {marsFactory} from '@souls/engine-mars';
import {hashOf} from '@souls/engine-contract';
import {stationLiveV1Schema,stationHistoricalV1Schema,recordedTakeChunkSchema,decodeSceneCapturePublication,isStationFactV1,stationEndTick} from '@souls/protocol';
import {takeIdOf} from '../../../mars/viewer/engine/take/recorder.ts';
import {Db} from './db.ts';
import {WorldHost} from './world.ts';
import {CandidateStationV1} from './station.ts';
import {buildApp} from './http.ts';
import {Auth} from './auth.ts';
import {config} from './config.ts';
import {Souls} from './souls.ts';
import type {Brain} from './brain.ts';
import type {Hub} from './hub.ts';
import {acceptStationFixture,generateStationFixture,STATION_PRIVATE} from '../test/fixtures/station/generate.ts';

test('actual candidate never defaults missing/malformed/mixed observations to ordinary and refuses private facts before append',async t=>{
  const factory=await marsFactory(),db=new Db(':memory:');t.after(()=>db.close());
  const host=new WorldHost(db,factory,'negative-station',1e9,'negative-world');host.boot();host.drainInputs();
  const observer=host.engine.gatheringObservation!.bind(host.engine),station=new CandidateStationV1(host);
  for(const invalid of [undefined,{...observer(),tick:1},{...observer(),sourceRevision:'other'},{...observer(),dtSeconds:.1},{...observer(),words:STATION_PRIVATE}]){
    host.engine.gatheringObservation=(()=>invalid) as typeof host.engine.gatheringObservation;
    const view=await acceptStationFixture(host,station.record());assert.equal(view.cue,null);assert.equal(view.anchor!.availability,'unsupported');
  }
  host.engine.gatheringObservation=observer;const live=await acceptStationFixture(host,station.record());assert.equal(live.cue!.pieceId,'starfield');
  const before=hashOf(host.stationHistoryV1()),seq=host.seq;
  const bad=host.enqueueChecked('station-anchor-v1','fixture',{...live.anchor!,revision:live.anchor!.revision+1,private:STATION_PRIVATE},()=>true);
  await assert.rejects(acceptStationFixture(host,bad));assert.equal(host.seq,seq);assert.equal(hashOf(host.stationHistoryV1()),before);
  assert.equal(db.events(host.worldId).filter(e=>isStationFactV1(e.kind)).length,8);assert.equal(db.paidCost(),0);
});
test('anchor append failure leaves the immutable cue unready; retry records one anchor without repeating selection',async t=>{
  const factory=await marsFactory(),db=new Db(':memory:');t.after(()=>db.close());const host=new WorldHost(db,factory,'station-write-refusal',1e9,'refusal-world');host.boot();host.drainInputs();
  const station=new CandidateStationV1(host),body=host.engine.stateHash();
  db.db.exec("CREATE TEMP TRIGGER reject_station_anchor BEFORE INSERT ON events WHEN NEW.kind='station-anchor-v1' BEGIN SELECT RAISE(ABORT,'fixture anchor refusal'); END");
  await assert.rejects(acceptStationFixture(host,station.record()),/refusal/);const state=host.stationHistoryV1()!;
  assert.equal(state.cues.length,1);assert.equal(state.anchors.length,0);assert.equal(station.view().fresh,false);assert.equal(host.engine.stateHash(),body);
  db.db.exec('DROP TRIGGER reject_station_anchor');const retried=await acceptStationFixture(host,station.record());
  assert.equal(retried.cue!.cueId,state.cues[0].cueId);assert.equal(retried.anchor!.revision,1);assert.equal(retried.fresh,true);
  assert.equal(host.stationHistoryV1()!.cues.length,1);assert.equal(db.events(host.worldId).filter(e=>e.kind==='station-anchor-v1').length,1);
});
test('default selected-world routes remain uninstalled; an isolated same-piece renewal gets a new seed/identity with a silent gap and no physical change',async t=>{
  const factory=await marsFactory(),db=new Db(':memory:');t.after(()=>db.close());const host=new WorldHost(db,factory,'same-piece-station',1e9,'same-piece-world');host.boot();host.drainInputs();
  const cfg={...config,worldId:host.worldId,brainMode:'fake' as const,budgetUsdPerDay:0,typesafeKey:undefined,anthropicKey:undefined,privyAppId:'',privyAppSecret:''};
  const brain={midContext:()=>({options:[]})} as unknown as Brain,auth=new Auth(cfg,db),souls=new Souls(host,db,brain,cfg);
  const app=buildApp({cfg,db,host,auth,brain,souls,hub:{clients:new Set()} as unknown as Hub});
  for(const path of ['/v1/station','/v1/station/history']){const response=await app.request(path);assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');}
  assert.equal(host.stationHistoryV1(),undefined);
  const station=new CandidateStationV1(host),first=await acceptStationFixture(host,station.record());
  while(host.engine.world.tick<2563)host.tickOnce();const before=host.engine.stateHash(),next=await acceptStationFixture(host,station.record());
  assert.equal(next.cue!.pieceId,first.cue!.pieceId);assert.notEqual(next.cue!.cueId,first.cue!.cueId);assert.notEqual(next.cue!.seed,first.cue!.seed);
  assert.equal(next.cue!.startTick,2563);assert.equal(next.station!.epoch,first.station!.epoch);assert.equal(host.engine.stateHash(),before);
  assert.equal(station.history(first.station!,2561).cue,null);assert.equal(station.history(first.station!,2563).cue!.cueId,next.cue!.cueId);
});
test('serialized native paired fixture has strict public facts, finite history, immutable addressed takes and actual TCP/WS receipts',()=>{
  const bytes=readFileSync(new URL('../test/fixtures/station/native-station.v1.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'27b78076a33d961ff8cd48970bb37e359b327ebdca0819ecb9ae6bc57d80b671');
  const f=JSON.parse(bytes.toString());
  for(const sample of f.views)stationLiveV1Schema.parse(sample.view);stationLiveV1Schema.parse(f.live);stationLiveV1Schema.parse(f.streamed);
  for(const historical of f.history)stationHistoricalV1Schema.parse(historical);
  assert.deepEqual(f.views.filter((v:any)=>['ordinary','gathering-performance','next-ordinary'].includes(v.phase)).map((v:any)=>v.view.cue.pieceId),['starfield','zoning-board','starfield']);
  const late=f.views.find((v:any)=>v.phase==='late-current-cycle');assert.ok(late.view.anchor.beat>64&&late.view.anchor.beat<96);
  assert.equal(f.history.find((v:any)=>v.tick===2560).cue,null);assert.equal(f.history.find((v:any)=>v.tick===3999).cue,null);
  assert.equal(f.history.find((v:any)=>v.tick===stationEndTick(f.views[2].view.cue)).cue,null);
  for(const page of f.pairedTakes)for(const chunk of page.chunks){recordedTakeChunkSchema.parse(chunk);assert.equal(takeIdOf(chunk.take),chunk.take.id);assert.equal(chunk.take.renderSceneRef.hash,f.capture.ref.hash);}
  decodeSceneCapturePublication(f.capture);assert.equal(JSON.stringify(f).includes(STATION_PRIVATE),false);
  for(const key of ['anonymousTcpGET','anonymousHubWS','streamedAnchor','reconnectLatestSameCue','restartRequiresFreshAnchor'])assert.equal(f.transport[key],true);
  assert.equal(f.paid,0);assert.equal(f.reconstruction.snapshot,'exact');assert.equal(f.reconstruction.genesis,'exact');
  // Immutable earlier recording proves its own authored input, not whichever
  // source a later server happens to load. Keep the original bytes/hash and
  // compare against the actual reviewed producer commit; current execution is
  // qualified separately below instead of relabeling this historical proof.
  for(const [path,sha] of Object.entries(f.producer.authoredSourceSha256)) {
    const source=execFileSync('git',['show',`ad8c2c4df48e43e767688392ec55964aa3c7bd7c:${path}`],{cwd:fileURLToPath(new URL('../../../',import.meta.url))});
    assert.equal(createHash('sha256').update(source).digest('hex'),sha);
  }
});
test('fresh current-source native station generation still reconstructs through SQLite, genesis and actual anonymous TCP/WS',async t=>{
  const fresh=await generateStationFixture();
  for(const [path,sha] of Object.entries(fresh.producer.authoredSourceSha256))
    assert.equal(createHash('sha256').update(readFileSync(new URL('../../../'+path,import.meta.url))).digest('hex'),sha);
  assert.equal(fresh.reconstruction.snapshot,'exact');assert.equal(fresh.reconstruction.genesis,'exact');
  assert.equal(fresh.transport.anonymousTcpGET,true);assert.equal(fresh.transport.anonymousHubWS,true);
  assert.equal(fresh.transport.streamedAnchor,true);assert.equal(fresh.transport.reconnectLatestSameCue,true);
  assert.equal(fresh.paid,0);stationLiveV1Schema.parse(fresh.live);
  t.diagnostic(`fresh native producer: ${fresh.facts.length} facts; ${fresh.views.length} views; paid=$0; original recording unchanged`);
});
test('new actual Core selections/retentions agree with the exact pinned inactive App policy on recorded native samples',async()=>{
  const f=JSON.parse(readFileSync(new URL('../test/fixtures/station/native-station.v1.json',import.meta.url),'utf8'));
  const source=readFileSync(new URL('../test/fixtures/station/station-policy.source.v1.mjs',import.meta.url),'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'),'3f5e3fb89cd53287847035095765acda0f3f90b4d822c945c27e54b5d3ba7137');
  const {selectStation}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  let previous:any=null;
  for(const sample of f.views){
    const current=sample.view.cue,selection=selectStation({worldId:f.worldId,tick:sample.observation.tick,dtSeconds:sample.observation.dtSeconds,
      situation:sample.observation.situation,energy:0,catalogRevision:current.pins.catalog,previous:previous?{worldId:f.worldId,cueId:previous.cueId,pieceId:previous.pieceId,
        startTick:previous.startTick,cycleCount:4,policyRevision:previous.pins.policy,catalogRevision:previous.pins.catalog,dtSeconds:previous.dtSeconds}:null});
    if(selection.kind==='retain')assert.equal(current.cueId,selection.cueId);else assert.equal(current.pieceId,selection.pieceId);
    previous=current;
  }
});
