import {intentHistoryEventV2Schema} from '@souls/protocol';

export type IntentHistoryRow = {
  key:string;seq:number;tick:number;intentId:string;version:number;requestId?:string;
  title:string;detail:string;reason?:string;directionSummary?:string;purpose:'unconfirmed'|'active'|'blocked'|'fulfilled';
  evidence:{seq:number;tick:number;kind:string}|null;
};
type Selection={worldId:string;soulId:string;ownerId:string;sourceCutoffSeq:number;throughTick:number};
/** Preparation for a private API projection, not an authorization or transport
 * adapter. Caller must discard rows whenever current private scope is lost.
 * Each row describes one recorded fact; it never reconstructs complete history,
 * correlates unrelated activity, or infers broader purpose from an attempt. */
export function intentHistoryRow(raw:unknown,selection:Selection):IntentHistoryRow|null {
  if(!selection.worldId||!selection.soulId||!selection.ownerId||
    !Number.isSafeInteger(selection.sourceCutoffSeq)||selection.sourceCutoffSeq<0||
    !Number.isSafeInteger(selection.throughTick)||selection.throughTick<0)return null;
  const parsed=intentHistoryEventV2Schema.safeParse(raw);if(!parsed.success)return null;
  const e=parsed.data;
  if(e.worldId!==selection.worldId||e.soulId!==selection.soulId||
    e.seq>selection.sourceCutoffSeq||e.tick>selection.throughTick)return null;
  let ref:{intentId:string;version:number};
  let title:string,detail:string,purpose:IntentHistoryRow['purpose']='unconfirmed';
  let evidence:IntentHistoryRow['evidence']=null,requestId:string|undefined,reason:string|undefined,directionSummary:string|undefined;
  const humanReference=(source:{kind:string;ownerId:string;principalId:string},id:string)=>source.kind==='owner'&&source.ownerId===selection.ownerId&&source.principalId===selection.ownerId?id:undefined;
  if(e.op==='upsert'){
    const r=e.revision;
    if(r.worldId!==e.worldId||r.soulId!==e.soulId||r.source.ownerId!==selection.ownerId||
      r.submitted.seq!==e.seq||r.submitted.tick!==e.tick)return null;
    requestId=humanReference(r.source,r.requestId);ref=r;title='Direction understood';detail=r.interpretation.summary;directionSummary=detail;
  }else if(e.op==='withdraw'){
    if(e.source.ownerId!==selection.ownerId)return null;
    requestId=humanReference(e.source,e.requestId);ref=e.intent;title='Direction withdrawn';detail='This direction was withdrawn. This does not confirm that an action stopped.';
  }else if(e.op==='outcome'){
    const o=e.outcome;
    if(o.worldId!==e.worldId||o.soulId!==e.soulId||o.seq!==e.seq||o.tick!==e.tick)return null;
    ref=o.intent;evidence=o.evidence;
    switch(o.phase){
      case 'accepted':title='Action admitted';detail='The world accepted an attempt. Physical progress has not been confirmed.';break;
      case 'started':title='Action started';detail='Recorded physical progress for this attempt.';break;
      case 'completed':title='Action finished';detail='This attempt finished. The broader direction has not been confirmed fulfilled.';break;
      case 'blocked':title='Action blocked';detail=o.reason;reason=o.reason;break;
      case 'interrupted':title='Action interrupted';reason=o.reason;detail=o.reason==='program.replaced'?'A new action replaced this attempt before it finished. Completion is unconfirmed.':o.reason;break;
    }
  }else{
    if(e.evidence.seq>e.seq||e.evidence.tick>e.tick||
      (e.status==='fulfilled'&&e.evidence.kind==='admission'))return null;
    ref=e.intent;evidence=e.evidence;purpose=e.status;
    title=e.status==='fulfilled'?'Direction fulfilled':e.status==='blocked'?'Direction blocked':'Direction active';detail=e.reason;
  }
  return {key:`${e.worldId}:${e.soulId}:${e.seq}`,seq:e.seq,tick:e.tick,
    intentId:ref.intentId,version:ref.version,...(requestId?{requestId}:{}),title,detail,...(reason?{reason}:{}),...(directionSummary?{directionSummary}:{}),purpose,evidence};
}

/** Only matching recorded intent/version supplies visible action context. */
export function recordedDirectionContexts(rows:readonly IntentHistoryRow[]):Map<string,string>{
 const contexts=new Map<string,string>(),ambiguous=new Set<string>();
 for(const row of rows){
  if(!row.directionSummary)continue;
  const ref=JSON.stringify([row.intentId,row.version]);
  if(ambiguous.has(ref))continue;
  if(contexts.has(ref)&&contexts.get(ref)!==row.directionSummary){contexts.delete(ref);ambiguous.add(ref);}
  else contexts.set(ref,row.directionSummary);
 }
 return contexts;
}

export type RecordedDirectionGroup={key:string;intentId:string;version:number;summary:string|null;latest:IntentHistoryRow;rows:IntentHistoryRow[]};
/** Group only an exact recorded intent/version; preserve every loaded fact. */
export function recordedDirectionGroups(rows:readonly IntentHistoryRow[]):RecordedDirectionGroup[]{
 const contexts=recordedDirectionContexts(rows),groups=new Map<string,RecordedDirectionGroup>();
 for(const row of rows){
  const key=JSON.stringify([row.intentId,row.version]);let group=groups.get(key);
  if(!group){group={key,intentId:row.intentId,version:row.version,summary:contexts.get(key)??null,latest:row,rows:[]};groups.set(key,group);}
  group.rows.push(row);if(row.seq>group.latest.seq)group.latest=row;
 }
 for(const group of groups.values())group.rows.sort((a,b)=>a.seq-b.seq);
 return [...groups.values()].sort((a,b)=>b.latest.seq-a.latest.seq);
}
