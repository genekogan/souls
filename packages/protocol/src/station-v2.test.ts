import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hashOf } from '@souls/engine-contract';
import { STATION_PINS_V1,stationEpochId,stationEpochV1Schema,makeStationCueV1,stationPhaseAtTick,stationLiveV1Schema,stationEndTick } from './station-v1.ts';
import { initialStationPhysicalHeadV1,foldStationRulesEraV1 } from './station-era-v1.ts';
import { makeStationCueV2,stationCueV2Schema,stationPhaseAtTickV2,stationCueEraRevision,stationAnchorV2Schema,
  acceptStationAnchorV2,stationLiveV2Schema,stationLivePhaseV2,stationHistoricalV2Schema,stationV2MessageSchema } from './station-v2.ts';
import { acceptStationLiveProgressV2 } from './station-v2.ts';
import { stationEraPageV1Schema } from './station-era-page-v1.ts';
const physical=JSON.parse(readFileSync(new URL('../../../apps/server/test/fixtures/commons-transition/journey.v1.json',import.meta.url),'utf8'));
// Native physical payload, synthetic cue/era metadata. Canonical producer proof
// is deliberately separate from these strict-codec cases.
const genesisId=hashOf('SYNTHETIC_V2_CODEC'),worldId=physical.worldId;
const station=stationEpochV1Schema.parse({contract:'station-epoch/1',worldId,epoch:stationEpochId(worldId,genesisId),genesisId,
  rulesVersion:physical.oldRulesVersion,dtSeconds:.05,pins:STATION_PINS_V1,createdTick:0});
const origin=initialStationPhysicalHeadV1(station),source={worldId,seq:10,tick:37,commonsTransition:physical.transition};
const head=foldStationRulesEraV1(undefined,{seq:11,tick:37,payload:{contract:'station-rules-era/1',worldId,epoch:station.epoch,
  revision:1,previousRevision:0,fromRulesVersion:station.rulesVersion,toRulesVersion:physical.rulesVersion,dtSeconds:.05,
  effectiveTick:37,source:{seq:10,tick:37,transitionHash:hashOf(source.commonsTransition)}}},source,station).head;
const observation=(tick:number,rulesVersion:string)=>({contract:'native-gathering-observation/1' as const,sourceRevision:'settled-native-gather-fixtures/1' as const,
  tick,dtSeconds:.05,rulesVersion,situation:'ordinary' as const,largestCommonTargetMembers:0});
const cue=makeStationCueV1({contract:'station-cue/1',worldId,epoch:station.epoch,rulesVersion:station.rulesVersion,dtSeconds:.05,pins:STATION_PINS_V1,
  sequence:1,pieceId:'starfield',bpm:60,seed:1,startTick:0,cycleCount:4,energy:0,observation:observation(0,station.rulesVersion),transition:null});
const anchor={contract:'station-anchor/2' as const,worldId,epoch:station.epoch,dtSeconds:.05,pins:STATION_PINS_V1,revision:2,
  physicalRulesVersion:head.rulesVersion,physicalEraRevision:1,cueId:cue.cueId,cueRulesVersion:cue.rulesVersion,cueEraRevision:0,
  sourceTick:37,serverTimeMs:10000,beat:stationPhaseAtTick(cue,37)!.beat,clockRate:1,paused:false,availability:'supported' as const};
const live={contract:'station-live/2' as const,worldId,station,physical:head,cue,cuePhysical:origin,anchor,fresh:true};
const prior={...live,physical:origin,anchor:null,fresh:false};
function nextCue(){return makeStationCueV2({contract:'station-cue/2',worldId,epoch:station.epoch,rulesVersion:head.rulesVersion,eraRevision:1,
  dtSeconds:.05,pins:STATION_PINS_V1,sequence:2,pieceId:'starfield',bpm:60,seed:2,startTick:2560,cycleCount:4,energy:0,
  observation:observation(2560,head.rulesVersion),transition:{previousCueId:cue.cueId,previousEndTick:stationEndTick(cue),nextStartTick:2560,fadeInBeats:0,fadeOutBeats:0}});}

test('live progression binds first welcome, exact adjacent era, immutable cue and retained anchor across pending views',()=>{
  const binding={worldId,rulesVersion:station.rulesVersion,dtSeconds:.05};
  assert.deepEqual(acceptStationLiveProgressV2(null,prior,binding),prior);
  assert.throws(()=>acceptStationLiveProgressV2(null,live,binding),/physical reader/);
  assert.deepEqual(acceptStationLiveProgressV2(null,live,{...binding,rulesVersion:head.rulesVersion}),live);
  const pending={...live,anchor:null,fresh:false};assert.deepEqual(acceptStationLiveProgressV2(prior,pending,binding),pending);
  assert.deepEqual(acceptStationLiveProgressV2(pending,live,binding),live);
  assert.deepEqual(acceptStationLiveProgressV2(live,live,binding),live);
  assert.throws(()=>acceptStationLiveProgressV2(live,prior,binding),/reset/);
  assert.throws(()=>acceptStationLiveProgressV2(prior,live,{...binding,worldId:'foreign'}),/world/);
  assert.throws(()=>acceptStationLiveProgressV2(live,{...live,anchor:{...anchor,revision:1}},binding,anchor),/regressed/);
  const next=nextCue(),changed={...live,cue:next,cuePhysical:head,anchor:null,fresh:false};
  assert.deepEqual(acceptStationLiveProgressV2(live,changed,binding),changed);
  const {cueId,...body}=next;
  assert.throws(()=>acceptStationLiveProgressV2(live,{...changed,cue:makeStationCueV2({...body,sequence:4})},binding),/gap/);
  assert.throws(()=>acceptStationLiveProgressV2(live,{...live,cue:null,cuePhysical:null,anchor:null,fresh:false},binding),/disappeared/);
  assert.equal(hashOf(live),hashOf(stationLiveV2Schema.parse(live)));
});
test('bounded era page rejects private, frontier, cursor, missing-source and predecessor mismatches',()=>{
  const page={contract:'station-era-page/1',worldId,station,afterSeq:0,sourceCutoff:{seq:11,tick:37},nextAfterSeq:null,
    eras:[{fact:head.era,source:head.source}]};
  assert.equal(stationEraPageV1Schema.parse(page).eras.length,1);
  assert.equal(stationEraPageV1Schema.parse({...page,afterSeq:11,eras:[]}).eras.length,0);
  for(const bad of [{...page,owner:'PRIVATE'},{...page,worldId:'foreign'},{...page,sourceCutoff:{seq:10,tick:37}},
    {...page,sourceCutoff:{seq:11,tick:36}},{...page,afterSeq:10},{...page,nextAfterSeq:10},
    {...page,eras:[{fact:head.era,source:{...head.source,seq:9}}]},
    {...page,eras:Array(65).fill(page.eras[0])}])assert.equal(stationEraPageV1Schema.safeParse(bad).success,false);
});

test('V2 current physical head retains exact V1 cue identity, observation, finite phase and distinct origin',()=>{
  const before=hashOf({station,cue,head,origin}),v=stationLiveV2Schema.parse(live);
  assert.deepEqual(v.cue,cue);assert.equal(stationCueEraRevision(v.cue!),0);assert.equal(v.physical!.revision,1);
  assert.deepEqual(stationLivePhaseV2(v,10000),stationPhaseAtTick(cue,37));
  assert.deepEqual(stationLivePhaseV2(v,11000),stationPhaseAtTick(cue,57));
  assert.equal(hashOf({station,cue,head,origin}),before);
  assert.equal(stationLiveV1Schema.safeParse(live).success,false);
  assert.equal(stationV2MessageSchema.safeParse({t:'station',view:live}).success,false);
  assert.equal(stationV2MessageSchema.parse({t:'station-v2',view:live}).view.contract,'station-live/2');
});
test('V2 cue identity includes actual era and preserves finite half-open transition and observation bindings',()=>{
  const c=nextCue();assert.equal(stationPhaseAtTickV2(c,2560)!.beat,0);assert.equal(stationPhaseAtTickV2(c,stationEndTick(c)),null);
  assert.ok(stationPhaseAtTickV2(c,stationEndTick(c)-Number.EPSILON*stationEndTick(c))!.beat<128);
  for(const patch of [{eraRevision:0},{seed:3},{observation:{...c.observation,rulesVersion:station.rulesVersion}},
    {bpm:108},{energy:1},{privateWords:'PRIVATE'},{transition:{...c.transition,previousEndTick:2561}}])
    assert.equal(stationCueV2Schema.safeParse({...c,...patch}).success,false);
  assert.equal(stationLiveV2Schema.safeParse({...live,cue:c,cuePhysical:head,anchor:null,fresh:false}).success,true);
  assert.equal(stationLiveV2Schema.safeParse({...live,cue:c,cuePhysical:origin,anchor:null,fresh:false}).success,false);
});
test('anchors reject mixed origins, missing heads, changed dt, stale revisions and private fields',()=>{
  for(const patch of [{physicalRulesVersion:cue.rulesVersion},{physicalEraRevision:0},{cueRulesVersion:head.rulesVersion},{cueEraRevision:1},
    {cueId:hashOf('foreign')},{worldId:'foreign'},{dtSeconds:.1},{sourceTick:36},{beat:99},{owner:'PRIVATE'}])
    assert.equal(stationLiveV2Schema.safeParse({...live,anchor:{...anchor,...patch}}).success,false);
  for(const patch of [{physical:null},{cuePhysical:null},{station:{...station,rulesVersion:head.rulesVersion}},
    {physical:{...head,source:null}},{cuePhysical:head},{privateIntent:'PRIVATE'}])assert.equal(stationLiveV2Schema.safeParse({...live,...patch}).success,false);
  const old={contract:'station-anchor/1' as const,worldId,epoch:station.epoch,rulesVersion:cue.rulesVersion,dtSeconds:.05,pins:STATION_PINS_V1,
    revision:1,cueId:cue.cueId,sourceTick:20,serverTimeMs:9000,beat:1,clockRate:1,paused:false,availability:'supported' as const};
  assert.throws(()=>acceptStationAnchorV2(null,old,cue,head,station),/physical origin/);
  assert.equal(acceptStationAnchorV2(old,anchor,cue,head,station).revision,2);
  assert.throws(()=>acceptStationAnchorV2(anchor,anchor,cue,head,station),/regressed/);
  assert.equal(stationAnchorV2Schema.safeParse({...anchor,cueId:null}).success,false);
});
test('live playback stops on stale, pause, rate, unsupported and expiry; an era receipt without anchor starts nothing',()=>{
  assert.equal(stationLivePhaseV2({...live,anchor:null,fresh:false},11000),null);
  assert.equal(stationLivePhaseV2({...live,fresh:false},11000),null);
  for(const patch of [{paused:true},{clockRate:2},{clockRate:0},{availability:'unsupported'}])
    assert.equal(stationLivePhaseV2({...live,anchor:{...anchor,...patch}},11000),null);
  assert.equal(stationLivePhaseV2(live,9999),null);assert.equal(stationLivePhaseV2(live,200000),null);
});
test('history selects exact physical interval with cutoff and no future anchor, and preserves silent gaps',()=>{
  const query={...live,contract:'station-history/2',tick:37,physicalUntilTick:null,sourceCutoff:{seq:12,tick:100},phase:stationPhaseAtTick(cue,37)};
  delete (query as Partial<typeof live>).fresh;
  assert.equal(stationHistoricalV2Schema.parse(query).physical!.effectiveTick,37);
  for(const patch of [{tick:36,phase:stationPhaseAtTick(cue,36)},{physicalUntilTick:37},{sourceCutoff:{seq:10,tick:100}},
    {sourceCutoff:{seq:12,tick:36}},{anchor:{...anchor,sourceTick:38,beat:stationPhaseAtTick(cue,38)!.beat}},
    {tick:2560,phase:null},{phase:{beat:99,cycle:3,beatInCycle:3}}])assert.equal(stationHistoricalV2Schema.safeParse({...query,...patch}).success,false);
  assert.equal(stationHistoricalV2Schema.safeParse({...query,tick:3000,sourceCutoff:{seq:12,tick:3000},cue:null,cuePhysical:null,anchor:null,phase:null}).success,true);
  const oldQuery={...query,physical:origin,anchor:null,tick:36,physicalUntilTick:37,phase:stationPhaseAtTick(cue,36)};
  assert.equal(stationHistoricalV2Schema.safeParse(oldQuery).success,true);
  assert.equal(stationHistoricalV2Schema.safeParse({...oldQuery,tick:37,phase:stationPhaseAtTick(cue,37)}).success,false);
});
test('second-era history checks both physical heads against the exact row frontier and refuses reversed predecessor source order',()=>{
  const transition={...physical.transition,tick:100,fromRulesVersion:head.rulesVersion,toRulesVersion:head.rulesVersion+'+CODEC_ONLY_SECOND'};
  const physicalSource={worldId,seq:20,tick:100,commonsTransition:transition};
  const state={station,head,lastFactSeq:11};
  const current=foldStationRulesEraV1(state,{seq:21,tick:100,payload:{...head.era!.payload,revision:2,previousRevision:1,
    fromRulesVersion:transition.fromRulesVersion,toRulesVersion:transition.toRulesVersion,effectiveTick:100,
    source:{seq:20,tick:100,transitionHash:hashOf(transition)}}},physicalSource,station).head;
  const c=makeStationCueV2({contract:'station-cue/2',worldId,epoch:station.epoch,rulesVersion:head.rulesVersion,eraRevision:1,
    dtSeconds:.05,pins:STATION_PINS_V1,sequence:1,pieceId:'starfield',bpm:60,seed:2,startTick:50,cycleCount:4,energy:0,
    observation:observation(50,head.rulesVersion),transition:null});
  const query={contract:'station-history/2',worldId,station,physical:current,cue:c,cuePhysical:head,anchor:null,tick:100,
    physicalUntilTick:null,sourceCutoff:{seq:21,tick:200},phase:stationPhaseAtTickV2(c,100)};
  assert.equal(stationHistoricalV2Schema.safeParse(query).success,true);
  const currentView={contract:'station-live/2' as const,worldId,station,physical:current,cue,cuePhysical:origin,anchor:null,fresh:false};
  assert.equal(stationLiveV2Schema.safeParse(currentView).success,true);
  const binding={worldId,rulesVersion:station.rulesVersion,dtSeconds:.05};
  assert.throws(()=>acceptStationLiveProgressV2(prior,currentView,binding),/gap/);
  assert.deepEqual(acceptStationLiveProgressV2({...live,anchor:null,fresh:false},currentView,binding),currentView);
  const future={...head,era:{...head.era!,seq:31,payload:{...head.era!.payload,source:{...head.era!.payload.source,seq:30}}},source:{...head.source!,seq:30}};
  assert.equal(stationHistoricalV2Schema.safeParse({...query,cuePhysical:future}).success,false);
  assert.equal(stationLiveV2Schema.safeParse({contract:'station-live/2',worldId,station,physical:current,cue:c,cuePhysical:future,anchor:null,fresh:false}).success,false);
  const page={contract:'station-era-page/1',worldId,station,afterSeq:0,sourceCutoff:{seq:21,tick:100},nextAfterSeq:11,
    eras:[{fact:head.era,source:head.source}]};
  assert.equal(stationEraPageV1Schema.parse(page).nextAfterSeq,11);
  assert.equal(stationEraPageV1Schema.parse({...page,afterSeq:11,nextAfterSeq:null,eras:[{fact:current.era,source:current.source}]}).eras.length,1);
  assert.equal(stationEraPageV1Schema.safeParse({...page,nextAfterSeq:null,eras:[{fact:current.era,source:current.source}]}).success,false);
});
