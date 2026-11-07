import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashOf} from '@souls/engine-contract';
import {STATION_PINS_V1,stationEpochId,makeStationCueV1,publicEvent,type LogEvent} from '@souls/protocol';
import {foldStationFactV1,replayStationFactsV1,historicalStationV1} from './station-history.ts';

const binding={worldId:'history-world',genesisId:hashOf('genesis'),rulesVersion:'test-rules',dtSeconds:.05};
const epoch={contract:'station-epoch/1' as const,...binding,epoch:stationEpochId(binding.worldId,binding.genesisId),pins:STATION_PINS_V1,createdTick:0};
const first=makeStationCueV1({contract:'station-cue/1',worldId:binding.worldId,epoch:epoch.epoch,rulesVersion:binding.rulesVersion,dtSeconds:.05,pins:STATION_PINS_V1,
  sequence:1,pieceId:'zoning-board',bpm:108,seed:5,startTick:0,cycleCount:4,energy:0,transition:null,
  observation:{contract:'native-gathering-observation/1',sourceRevision:'settled-native-gather-fixtures/1',tick:0,dtSeconds:.05,rulesVersion:binding.rulesVersion,situation:'gathering',largestCommonTargetMembers:2}});
const e=(seq:number,tick:number,kind:LogEvent['kind'],payload:unknown):LogEvent=>({seq,tick,kind,payload,author:'PRIVATE_AUTHOR',at:1});
const events=[e(1,0,'station-epoch-v1',epoch),e(2,0,'station-cue-v1',first)];
test('named fold refuses reset/foreign/mixed/future/order/overlap and retains half-open silent history',()=>{
  const state=replayStationFactsV1(events,binding)!;
  assert.equal(historicalStationV1(state,epoch,100).cue!.cueId,first.cueId);
  assert.equal(historicalStationV1(state,epoch,1423).cue,null);
  const anchor={contract:'station-anchor/1',worldId:binding.worldId,epoch:epoch.epoch,rulesVersion:binding.rulesVersion,dtSeconds:.05,pins:STATION_PINS_V1,
    revision:1,cueId:first.cueId,sourceTick:1,serverTimeMs:1000,beat:.09,clockRate:1,paused:false,availability:'supported'};
  assert.throws(()=>foldStationFactV1(state,e(3,0,'station-anchor-v1',anchor),binding),/future/);
  assert.throws(()=>foldStationFactV1(state,e(3,0,'station-epoch-v1',epoch),binding),/reset/);
  assert.throws(()=>foldStationFactV1(undefined,events[0],{...binding,worldId:'foreign'}),/mixed/);
  assert.throws(()=>foldStationFactV1(state,e(2,0,'station-cue-v1',first),binding),/sequence/);
  assert.throws(()=>historicalStationV1(state,{...epoch,worldId:'foreign'},100),/scope/);
  const before=hashOf(state);assert.equal(publicEvent(events[1]).author,'world:station');assert.equal(hashOf(state),before);
  assert.throws(()=>publicEvent({...events[1],payload:{...first,private:'PRIVATE'}}));
});
