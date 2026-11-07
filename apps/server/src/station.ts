// Explicit isolated installation only. No timer, default flag or main bootstrap.
import { nativeGatheringObservationV1Schema } from '@souls/engine-contract';
import { STATION_PINS_V1, stationEpochV1Schema, stationEpochId, makeStationCueV1, stationPhaseAtTick, stationEndTick,
  stationLiveV1Schema, stationAnchorV1Schema, type StationLiveV1, type StationCueV1 } from '@souls/protocol';
import { historicalStationV1 } from './station-history.ts';
import type { WorldHost } from './world.ts';

export class CandidateStationV1 {
  readonly host:WorldHost;
  private recoveredRevision:number;
  constructor(host:WorldHost){
    this.host=host;this.recoveredRevision=host.stationHistoryV1()?.anchors.at(-1)?.revision??0;
    host.listeners.push({onApplied:e=>{
      if(e.kind==='rules'&&(e.payload?.recovery||e.payload?.clockRate!==undefined)||e.kind==='admin'&&['pause','resume'].includes(e.payload?.action))
        this.recoveredRevision=host.stationHistoryV1()?.anchors.at(-1)?.revision??0;
    }});
  }
  view():StationLiveV1 {
    const state=this.host.stationHistoryV1(),cue=state?.cues.at(-1)??null,last=state?.anchors.at(-1)??null;
    const anchor=last?.cueId===(cue?.cueId??null)?last:null;
    return stationLiveV1Schema.parse({contract:'station-live/1',worldId:this.host.worldId,station:state?.station??null,
      cue,anchor,fresh:(this.host.stationPhysicalHeadV1()?.revision??0)===0&&!this.host.extra.stationV2
        &&!!anchor&&anchor.revision>this.recoveredRevision&&anchor.paused===this.host.paused&&anchor.clockRate===this.host.clockRate});
  }
  history(scope:{worldId:string;epoch:string;rulesVersion:string},tick:number){return historicalStationV1(this.host.stationHistoryV1(),scope,tick);}
  /** Caller drains the sequencer while awaiting this; no tick or clock is forged. */
  async record():Promise<StationLiveV1> {
    const h=this.host;
    if((h.stationPhysicalHeadV1()?.revision??0)>0||h.extra.stationV2)throw new Error('V1 station producer is unavailable after a versioned station checkpoint');
    if(!h.stationHistoryV1()){
      const binding=h.stationBindingV1(),station=stationEpochV1Schema.parse({contract:'station-epoch/1',...binding,
        epoch:stationEpochId(h.worldId,binding.genesisId),pins:STATION_PINS_V1,createdTick:h.engine.world.tick});
      await h.enqueueChecked('station-epoch-v1','world:station',station,()=>{
        if(h.engine.world.tick!==station.createdTick)throw new Error('station epoch source moved');return true;},()=>true);
    }
    let state=h.stationHistoryV1()!,cue=state.cues.at(-1)??null;
    const sourceTick=h.engine.world.tick;
    const readObservation=()=>{
      try{const sample=nativeGatheringObservationV1Schema.parse(h.engine.gatheringObservation?.());
        return sample.tick===h.engine.world.tick&&sample.dtSeconds===h.engine.dt&&sample.rulesVersion===h.engine.rulesVersion?sample:undefined;
      }catch{return undefined;}
    };
    const observation=readObservation();
    if(observation&&(!cue||stationPhaseAtTick(cue,sourceTick)===null)){
      const sequence=state.cues.length+1,pieceId=observation.situation==='gathering'?'zoning-board':'starfield';
      // Epoch-derived public seed stream is recorded in each cue. Distinct for
      // the finite uint32 range; does not advance physical or model RNG state.
      if(sequence>0xffffffff)throw new Error('station seed sequence exhausted');
      const seed=(Number.parseInt(state.station.epoch.slice(0,8),16)+sequence)>>>0;
      const next=makeStationCueV1({contract:'station-cue/1',worldId:h.worldId,epoch:state.station.epoch,
        rulesVersion:h.engine.rulesVersion,dtSeconds:h.engine.dt,pins:STATION_PINS_V1,sequence,
        pieceId,bpm:pieceId==='starfield'?60:108,seed,startTick:sourceTick,cycleCount:4,energy:0,observation,
        transition:cue?{previousCueId:cue.cueId,previousEndTick:stationEndTick(cue),nextStartTick:sourceTick,fadeOutBeats:0,fadeInBeats:0}:null});
      await h.enqueueChecked('station-cue-v1','world:station',next,()=>{
        if(h.engine.world.tick!==sourceTick)throw new Error('station cue source moved');
        const actual=readObservation();
        if(JSON.stringify(actual)!==JSON.stringify(observation))throw new Error('station physical observation changed');return true;},()=>true);
      cue=next;
    }
    state=h.stationHistoryV1()!;
    // Sample actual clock only after cue acceptance, for this actual source tick.
    const sampledTick=h.engine.world.tick,anchorObservation=readObservation(),serverTimeMs=Date.now();
    const anchor=stationAnchorV1Schema.parse({contract:'station-anchor/1',worldId:h.worldId,epoch:state.station.epoch,
      rulesVersion:h.engine.rulesVersion,dtSeconds:h.engine.dt,pins:STATION_PINS_V1,revision:(state.anchors.at(-1)?.revision??0)+1,
      cueId:cue?.cueId??null,sourceTick:sampledTick,serverTimeMs,beat:cue?stationPhaseAtTick(cue,sampledTick)?.beat??null:null,
      clockRate:h.clockRate,paused:h.paused,availability:anchorObservation?'supported':'unsupported'});
    await h.enqueueChecked('station-anchor-v1','world:station',anchor,()=>{
      if(h.engine.world.tick!==sampledTick||h.clockRate!==anchor.clockRate||h.paused!==anchor.paused||JSON.stringify(readObservation())!==JSON.stringify(anchorObservation))
        throw new Error('station anchor source moved');return true;},()=>true);
    return this.view();
  }
}
