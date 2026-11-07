// Opt-in public fact fold. No models, selection, clock or rendering.
import { stationCueV2Schema,stationAnchorV2Schema,stationEndTick,acceptStationCuePhysicalV2,acceptStationAnchorV2,
  initialStationPhysicalHeadV1,type StationCueVariant,type StationAnchorVariant,type StationPhysicalHeadV1,type LogEvent } from '@souls/protocol';
import type { StationHistoryV1 } from './station-history.ts';
export type StationHistoryV2={cues:{cue:StationCueVariant;physical:StationPhysicalHeadV1}[];anchors:StationAnchorVariant[];lastFactSeq:number};
export function initialStationHistoryV2(old:StationHistoryV1):StationHistoryV2 {
  const origin=initialStationPhysicalHeadV1(old.station);
  return {cues:old.cues.map(cue=>({cue:structuredClone(cue),physical:structuredClone(origin)})),anchors:structuredClone(old.anchors),lastFactSeq:old.lastFactSeq};
}
export function foldStationFactV2(state:StationHistoryV2,old:StationHistoryV1,event:LogEvent,head:StationPhysicalHeadV1):StationHistoryV2 {
  if(event.seq<=state.lastFactSeq)throw new Error('V2 station sequence regressed');
  if(event.kind==='station-cue-v2'){
    const cue=stationCueV2Schema.parse(event.payload),previous=state.cues.at(-1)?.cue;
    acceptStationCuePhysicalV2(cue,head,old.station,head);
    if(cue.sequence!==state.cues.length+1||cue.startTick!==event.tick||cue.eraRevision!==head.revision)
      throw new Error('V2 station cue order, tick or current era differs');
    if(previous&&(!cue.transition||cue.transition.previousCueId!==previous.cueId||cue.transition.previousEndTick!==stationEndTick(previous)
      ||cue.startTick<stationEndTick(previous)||cue.seed===previous.seed))throw new Error('V2 station transition overlaps or reuses seed');
    return {...state,cues:[...state.cues,{cue,physical:structuredClone(head)}],lastFactSeq:event.seq};
  }
  if(event.kind!=='station-anchor-v2')throw new Error('not a V2 cue or anchor fact');
  const anchor=stationAnchorV2Schema.parse(event.payload),previous=state.anchors.at(-1)??null;
  if(anchor.revision!==(previous?.revision??0)+1||anchor.sourceTick>event.tick)throw new Error('V2 anchor revision or future tick differs');
  acceptStationAnchorV2(previous,anchor,state.cues.at(-1)?.cue??null,head,old.station);
  return {...state,anchors:[...state.anchors,anchor],lastFactSeq:event.seq};
}
