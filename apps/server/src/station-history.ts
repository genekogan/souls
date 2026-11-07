// Named station fold. Public facts only; no selection, models or live actors.
import { hashOf } from '@souls/engine-contract';
import { stationEpochV1Schema, stationCueV1Schema, stationAnchorV1Schema, stationEpochId,
  sameStationScopeV1, acceptStationAnchorV1, stationEndTick, stationPhaseAtTick, isStationFactV1,
  stationHistoricalV1Schema, type StationEpochV1, type StationCueV1, type StationAnchorV1, type LogEvent } from '@souls/protocol';

export type StationHistoryV1={station:StationEpochV1;cues:StationCueV1[];anchors:StationAnchorV1[];lastFactSeq:number};
export type StationBindingV1={worldId:string;genesisId:string;rulesVersion:string;dtSeconds:number};
export function foldStationFactV1(state:StationHistoryV1|undefined,event:LogEvent,binding:StationBindingV1):StationHistoryV1 {
  if(!isStationFactV1(event.kind))throw new Error('not a named station fact');
  if(state&&event.seq<=state.lastFactSeq)throw new Error('station fact sequence regressed');
  if(event.kind==='station-epoch-v1'){
    const station=stationEpochV1Schema.parse(event.payload);
    if(state||station.worldId!==binding.worldId||station.genesisId!==binding.genesisId||station.epoch!==stationEpochId(binding.worldId,binding.genesisId)
      ||station.createdTick!==event.tick||station.rulesVersion!==binding.rulesVersion||station.dtSeconds!==binding.dtSeconds)throw new Error('station epoch mixed or reset');
    return {station,cues:[],anchors:[],lastFactSeq:event.seq};
  }
  if(!state)throw new Error('station epoch is not recorded');
  if(event.kind==='station-cue-v1'){
    const cue=stationCueV1Schema.parse(event.payload),previous=state.cues.at(-1);
    if(!sameStationScopeV1(state.station,cue)||cue.sequence!==state.cues.length+1||cue.startTick!==event.tick||cue.startTick<state.station.createdTick)
      throw new Error('station cue scope or order differs');
    if(previous&&(!cue.transition||cue.transition.previousCueId!==previous.cueId||cue.transition.previousEndTick!==stationEndTick(previous)
      ||cue.startTick<stationEndTick(previous)||cue.seed===previous.seed))throw new Error('station transition overlaps or reuses seed');
    return {...state,cues:[...state.cues,cue],lastFactSeq:event.seq};
  }
  const anchor=stationAnchorV1Schema.parse(event.payload),previous=state.anchors.at(-1);
  if(!sameStationScopeV1(state.station,anchor)||anchor.revision!==(previous?.revision??0)+1||anchor.sourceTick>event.tick||anchor.sourceTick<state.station.createdTick)
    throw new Error('station anchor scope, revision or future sample differs');
  acceptStationAnchorV1(previous??null,anchor,state.cues.at(-1)??null);
  return {...state,anchors:[...state.anchors,anchor],lastFactSeq:event.seq};
}
export function replayStationFactsV1(events:LogEvent[],binding:StationBindingV1){
  let state:StationHistoryV1|undefined;
  for(const event of events)if(isStationFactV1(event.kind))state=foldStationFactV1(state,event,binding);
  return state;
}
export function historicalStationV1(state:StationHistoryV1|undefined,scope:{worldId:string;epoch:string;rulesVersion:string},at:number){
  if(!state||state.station.worldId!==scope.worldId||state.station.epoch!==scope.epoch||state.station.rulesVersion!==scope.rulesVersion)throw new Error('station history scope differs');
  if(!Number.isFinite(at)||at<0||at>Number.MAX_SAFE_INTEGER)throw new Error('invalid historical tick');
  const cue=state.cues.find(c=>stationPhaseAtTick(c,at)!==null)??null;
  // A historical cue never borrows a later/current cue's anchor.
  const anchor=cue?[...state.anchors].reverse().find(a=>a.cueId===cue.cueId&&a.sourceTick<=at)??null:null;
  return stationHistoricalV1Schema.parse({contract:'station-history/1',worldId:scope.worldId,epoch:scope.epoch,rulesVersion:scope.rulesVersion,
    tick:at,cue,anchor,phase:cue?stationPhaseAtTick(cue,at):null});
}
export function stationGenesisIdV1(worldId:string,seed:string,genesis:unknown){return hashOf({contract:'station-genesis/1',worldId,seed,genesis});}
