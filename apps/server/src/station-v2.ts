// Explicit isolated G006 installation. No default timer, transport or audio.
import { nativeGatheringObservationV1Schema,hashOf } from '@souls/engine-contract';
import { STATION_PINS_V1,makeStationCueV2,stationCueEraRevision,stationPhaseAtTickV2,stationEndTick,stationAnchorV2Schema,
  stationLiveV2Schema,stationHistoricalV2Schema,initialStationPhysicalHeadV1,foldStationRulesEraV1,acceptStationPhysicalHeadV1,
  stationEraPageV1Schema,stationRulesEraFactV1Schema,stationSourceFromRulesV1,
  type StationLiveV2,type StationEraFoldStateV1 } from '@souls/protocol';
import type { WorldHost } from './world.ts';

export class CandidateStationV2 {
  private recoveredRevision:number;
  readonly host:WorldHost;
  constructor(host:WorldHost){
    this.host=host;
    this.recoveredRevision=host.stationHistoryV2()?.anchors.at(-1)?.revision??0;
    host.listeners.push({onApplied:e=>{
      if(e.kind==='rules'&&(e.payload?.recovery||e.payload?.clockRate!==undefined)||e.kind==='admin'&&['pause','resume'].includes(e.payload?.action))
        this.recoveredRevision=host.stationHistoryV2()?.anchors.at(-1)?.revision??0;
    }});
  }
  view():StationLiveV2 {
    const h=this.host,old=h.stationHistoryV1(),state=h.stationHistoryV2(),physical=h.stationPhysicalHeadV1()??null;
    const lastCue=state?.cues.at(-1)??null,last=state?.anchors.at(-1)??null;
    const anchor=last&&physical&&last.cueId===(lastCue?.cue.cueId??null)
      &&(last.contract==='station-anchor/1'?physical.revision===0&&last.rulesVersion===physical.rulesVersion:
        last.physicalEraRevision===physical.revision&&last.physicalRulesVersion===physical.rulesVersion)?last:null;
    return stationLiveV2Schema.parse({contract:'station-live/2',worldId:h.worldId,station:old?.station??null,physical,
      cue:lastCue?.cue??null,cuePhysical:lastCue?.physical??null,anchor,
      fresh:!!anchor&&anchor.revision>this.recoveredRevision&&anchor.paused===h.paused&&anchor.clockRate===h.clockRate});
  }
  /** Actual current public observation and journal guard. Caller drains the
   * sequencer; waiting never manufactures a tick, phase or musical selection. */
  async record():Promise<StationLiveV2> {
    const h=this.host,old=h.stationHistoryV1();if(!old)throw new Error('V2 station requires the immutable recorded epoch');
    let state=h.stationHistoryV2()!,cue=state.cues.at(-1)?.cue??null;
    const read=()=>{
      try{const o=nativeGatheringObservationV1Schema.parse(h.engine.gatheringObservation?.());
        return o.tick===h.engine.world.tick&&o.rulesVersion===h.engine.rulesVersion&&o.dtSeconds===h.engine.dt?o:undefined;
      }catch{return undefined;}
    };
    const sourceTick=h.engine.world.tick,physical=h.stationPhysicalHeadV1()!,observation=read();
    if(observation&&(!cue||stationPhaseAtTickV2(cue,sourceTick)===null)){
      const sequence=state.cues.length+1;if(sequence>0xffffffff)throw new Error('station seed sequence exhausted');
      const pieceId=observation.situation==='gathering'?'zoning-board':'starfield';
      const next=makeStationCueV2({contract:'station-cue/2',worldId:h.worldId,epoch:old.station.epoch,rulesVersion:h.engine.rulesVersion,
        eraRevision:physical.revision,dtSeconds:h.engine.dt,pins:STATION_PINS_V1,sequence,pieceId,bpm:pieceId==='starfield'?60:108,
        seed:(Number.parseInt(old.station.epoch.slice(0,8),16)+sequence)>>>0,startTick:sourceTick,cycleCount:4,energy:0,observation,
        transition:cue?{previousCueId:cue.cueId,previousEndTick:stationEndTick(cue),nextStartTick:sourceTick,fadeOutBeats:0,fadeInBeats:0}:null});
      await h.enqueueChecked('station-cue-v2','world:station',next,()=>{
        if(h.engine.world.tick!==sourceTick||hashOf(h.stationPhysicalHeadV1())!==hashOf(physical)||JSON.stringify(read())!==JSON.stringify(observation))
          throw new Error('V2 station cue physical source moved');return true;},()=>true);
      cue=next;
    }
    state=h.stationHistoryV2()!;
    const sampledTick=h.engine.world.tick,head=h.stationPhysicalHeadV1()!,sample=read();
    const anchor=stationAnchorV2Schema.parse({contract:'station-anchor/2',worldId:h.worldId,epoch:old.station.epoch,dtSeconds:h.engine.dt,pins:STATION_PINS_V1,
      revision:(state.anchors.at(-1)?.revision??0)+1,physicalRulesVersion:head.rulesVersion,physicalEraRevision:head.revision,
      cueId:cue?.cueId??null,cueRulesVersion:cue?.rulesVersion??null,cueEraRevision:cue?stationCueEraRevision(cue):null,
      sourceTick:sampledTick,serverTimeMs:Date.now(),beat:cue?stationPhaseAtTickV2(cue,sampledTick)?.beat??null:null,
      clockRate:h.clockRate,paused:h.paused,availability:sample?'supported':'unsupported'});
    await h.enqueueChecked('station-anchor-v2','world:station',anchor,()=>{
      if(h.engine.world.tick!==sampledTick||h.clockRate!==anchor.clockRate||h.paused!==anchor.paused
        ||hashOf(h.stationPhysicalHeadV1())!==hashOf(head)||JSON.stringify(read())!==JSON.stringify(sample))throw new Error('V2 station anchor source moved');
      return true;},()=>true);
    return this.view();
  }
  /** Authoritative recorded frontier, selected era and exclusive next boundary.
   * No guessed current-rules fallback is introduced. */
  history(scope:{worldId:string;epoch:string;rulesVersion:string},at:number,sourceCutoffSeq?:number){
    const h=this.host,old=h.stationHistoryV1(),state=h.stationHistoryV2();if(!old||!state||scope.worldId!==h.worldId||scope.epoch!==old.station.epoch)
      throw new Error('V2 station history scope differs');
    if(sourceCutoffSeq!==undefined&&(!Number.isSafeInteger(sourceCutoffSeq)||sourceCutoffSeq<0))throw new Error('invalid station history source frontier');
    const events=h.db.events(h.worldId).filter(e=>sourceCutoffSeq===undefined||e.seq<=sourceCutoffSeq),cutoff=events.at(-1);
    if(!cutoff||sourceCutoffSeq!==undefined&&cutoff.seq!==sourceCutoffSeq)throw new Error('station history has no exact recorded frontier');
    if(!events.some(e=>e.kind==='station-epoch-v1'&&hashOf(e.payload)===hashOf(old.station)))throw new Error('station epoch is beyond the source frontier');
    let eras:StationEraFoldStateV1|undefined,selected=initialStationPhysicalHeadV1(old.station),until:number|null=null;
    for(const fact of events){if(fact.kind!=='station-rules-era-v1')continue;
      const source=events.find(e=>e.seq===fact.payload.source.seq);
      if(!source||source.kind!=='rules'||Object.keys(source.payload).length!==1)throw new Error('station history lacks physical source');
      eras=foldStationRulesEraV1(eras,{seq:fact.seq,tick:fact.tick,payload:fact.payload},
        stationSourceFromRulesV1(h.worldId,source),old.station);
      if(fact.tick<=at)selected=eras.head;else if(until===null)until=fact.tick;
    }
    acceptStationPhysicalHeadV1(selected,old.station,{worldId:scope.worldId,rulesVersion:scope.rulesVersion,dtSeconds:h.engine.dt});
    const entry=state.cues.find(c=>stationPhaseAtTickV2(c.cue,at)!==null&&events.some(e=>
      (e.kind==='station-cue-v1'||e.kind==='station-cue-v2')&&hashOf(e.payload)===hashOf(c.cue)))??null;
    const anchor=entry?[...state.anchors].reverse().find(a=>a.cueId===entry.cue.cueId&&a.sourceTick<=at
      &&(a.contract==='station-anchor/1'?selected.revision===0:a.physicalEraRevision===selected.revision)
      &&events.some(e=>(e.kind==='station-anchor-v1'||e.kind==='station-anchor-v2')&&hashOf(e.payload)===hashOf(a)))??null:null;
    return stationHistoricalV2Schema.parse({contract:'station-history/2',worldId:h.worldId,station:old.station,physical:selected,
      cue:entry?.cue??null,cuePhysical:entry?.physical??null,anchor,tick:at,physicalUntilTick:until,
      sourceCutoff:{seq:cutoff.seq,tick:cutoff.tick},phase:entry?stationPhaseAtTickV2(entry.cue,at):null});
  }
  /** At most 64 immutable public era/source pairs. Cursor is an exact era row
   * in this selected world; page/frontier reads do not change station/clock. */
  eraPage(scope:{worldId:string;epoch:string},afterSeq=0,limit=64,sourceCutoffSeq?:number){
    const h=this.host,old=h.stationHistoryV1();
    if(!old||scope.worldId!==h.worldId||scope.epoch!==old.station.epoch)throw new Error('station era page scope differs');
    if(!Number.isSafeInteger(afterSeq)||afterSeq<0||!Number.isSafeInteger(limit)||limit<1||limit>64
      ||sourceCutoffSeq!==undefined&&(!Number.isSafeInteger(sourceCutoffSeq)||sourceCutoffSeq<0))throw new Error('invalid station era page bounds');
    const cutoff=sourceCutoffSeq===undefined?h.db.tailEvents(h.worldId,1)[0]:h.db.events(h.worldId,sourceCutoffSeq-1,1)[0];
    if(!cutoff||sourceCutoffSeq!==undefined&&cutoff.seq!==sourceCutoffSeq||afterSeq>cutoff.seq)throw new Error('station era page frontier differs');
    const epoch=h.db.db.prepare("SELECT payload FROM events WHERE world_id=? AND kind='station-epoch-v1' AND seq<=? ORDER BY seq LIMIT 1")
      .get(h.worldId,cutoff.seq) as {payload:string}|undefined;
    if(!epoch||hashOf(JSON.parse(epoch.payload))!==hashOf(old.station))throw new Error('station epoch is beyond the era page frontier');
    if(afterSeq){const cursor=h.db.events(h.worldId,afterSeq-1,1)[0];if(!cursor||cursor.seq!==afterSeq||cursor.kind!=='station-rules-era-v1')throw new Error('station era page cursor is not a recorded era');}
    const rows=h.db.db.prepare("SELECT seq,tick,payload FROM events WHERE world_id=? AND kind='station-rules-era-v1' AND seq>? AND seq<=? ORDER BY seq LIMIT ?")
      .all(h.worldId,afterSeq,cutoff.seq,limit+1) as {seq:number;tick:number;payload:string}[];
    const entries=rows.slice(0,limit).map(row=>{
      const fact=stationRulesEraFactV1Schema.parse({...row,payload:JSON.parse(row.payload)}),source=h.db.events(h.worldId,fact.payload.source.seq-1,1)[0];
      if(!source||source.kind!=='rules'||Object.keys(source.payload).length!==1)throw new Error('station era page lacks exact physical source');
      return {fact,source:stationSourceFromRulesV1(h.worldId,source)};
    });
    return stationEraPageV1Schema.parse({contract:'station-era-page/1',worldId:h.worldId,station:old.station,afterSeq,
      sourceCutoff:{seq:cutoff.seq,tick:cutoff.tick},nextAfterSeq:rows.length>limit?entries.at(-1)!.fact.seq:null,eras:entries});
  }
}
