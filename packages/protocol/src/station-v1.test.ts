import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashOf} from '@souls/engine-contract';
import {STATION_PINS_V1,stationEpochId,makeStationCueV1,stationCueV1Schema,stationEpochV1Schema,stationAnchorV1Schema,
  stationEndTick,stationExpiryTick,stationPhaseAtTick,stationLiveV1Schema,stationLivePhaseV1,acceptStationAnchorV1,stationHistoricalV1Schema} from './station-v1.ts';

const worldId='codec-world',genesisId=hashOf('codec-genesis'),epoch=stationEpochId(worldId,genesisId);
const scope={worldId,epoch,rulesVersion:'native-fixture/1',dtSeconds:.05,pins:STATION_PINS_V1};
const station=stationEpochV1Schema.parse({contract:'station-epoch/1',...scope,genesisId,createdTick:0});
function cue(pieceId:'starfield'|'zoning-board'='starfield'){
  return makeStationCueV1({contract:'station-cue/1',...scope,sequence:1,pieceId,bpm:pieceId==='starfield'?60:108,
    seed:17,startTick:0,cycleCount:4,energy:0,transition:null,observation:{contract:'native-gathering-observation/1',sourceRevision:'settled-native-gather-fixtures/1',
      tick:0,dtSeconds:.05,rulesVersion:scope.rulesVersion,situation:pieceId==='starfield'?'ordinary':'gathering',largestCommonTargetMembers:pieceId==='starfield'?0:2}});
}
function anchor(c=cue()){
  return stationAnchorV1Schema.parse({contract:'station-anchor/1',...scope,revision:1,cueId:c.cueId,sourceTick:20,
    serverTimeMs:10000,beat:stationPhaseAtTick(c,20)!.beat,clockRate:1,paused:false,availability:'supported'});
}
test('strict finite cue identity/pins/physical sample binding reject private, altered and unsupported input',()=>{
  const c=cue();assert.equal(stationCueV1Schema.parse(c).cueId,c.cueId);
  for(const altered of [{...c,privateWords:'PRIVATE'},{...c,seed:18},{...c,pins:{...c.pins,tone:'next'}},
    {...c,cycleCount:5},{...c,energy:.5},{...c,observation:{...c.observation,actor:'PRIVATE'}},
    {...c,observation:{...c.observation,tick:1}},{...c,bpm:108},{...c,pieceId:'other'}])assert.throws(()=>stationCueV1Schema.parse(altered));
  assert.throws(()=>stationEpochV1Schema.parse({...station,genesisId:hashOf('another')}));
});
test('half-open fractional interval and integer expiry do not repeat, round historical boundaries or invent cycles',()=>{
  const c=cue('zoning-board'),end=stationEndTick(c);
  assert.equal(stationExpiryTick(c),1423);assert.equal(stationExpiryTick(cue()),2560);
  assert.equal(stationPhaseAtTick(c,end),null);assert.equal(stationPhaseAtTick(c,1423),null);
  assert.equal(stationPhaseAtTick(c,end-1e-7)!.cycle,3);assert.ok(stationPhaseAtTick(c,end-1e-7)!.beat<128);
  assert.equal(stationPhaseAtTick(c,end-Number.EPSILON*end)!.cycle,3);
  assert.deepEqual(stationPhaseAtTick(cue(),640),{beat:32,cycle:1,beatInCycle:0});
  assert.throws(()=>stationPhaseAtTick(c,NaN));assert.throws(()=>stationPhaseAtTick(c,-1));
  assert.throws(()=>stationHistoricalV1Schema.parse({contract:'station-history/1',worldId,epoch,rulesVersion:scope.rulesVersion,tick:end,cue:c,anchor:null,phase:null}));
});
test('anchors stop on pause/rate/unsupported/recovered inputs; stale or mixed anchors cannot replace accepted state',()=>{
  const c=cue(),a=anchor(c),v={contract:'station-live/1',worldId,station,cue:c,anchor:a,fresh:true};
  assert.equal(stationLivePhaseV1(v,11000)!.beat,2);
  for(const patch of [{paused:true},{clockRate:2},{clockRate:0},{availability:'unsupported'}])assert.equal(stationLivePhaseV1({...v,anchor:{...a,...patch}},11000),null);
  assert.equal(stationLivePhaseV1({...v,fresh:false},11000),null);assert.equal(stationLivePhaseV1(v,9999),null);
  assert.equal(stationLivePhaseV1(v,200000),null,'no repeat after end');
  const before=JSON.stringify(a);
  for(const next of [{...a,revision:1},{...a,revision:2,sourceTick:19},{...a,revision:2,worldId:'foreign'},{...a,revision:2,beat:99}])
    assert.throws(()=>acceptStationAnchorV1(a,next,c));
  assert.equal(JSON.stringify(a),before);assert.equal(acceptStationAnchorV1(a,{...a,revision:2},c).revision,2);
  assert.throws(()=>stationLiveV1Schema.parse({...v,worldId:'foreign'}));assert.throws(()=>stationLiveV1Schema.parse({...v,anchor:{...a,cueId:hashOf('foreign')}}));
});
