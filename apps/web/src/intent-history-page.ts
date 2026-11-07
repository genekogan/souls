import {intentHistoryPageV1Schema,type IntentHistoryPageV1} from '@souls/protocol';
import {intentHistoryRow,type IntentHistoryRow} from './intent-history-row.ts';
type Scope={worldId:string;soulId:string;ownerId:string};
export type HistoryWindow={page:Extract<IntentHistoryPageV1,{state:'page'}>;rows:IntentHistoryRow[];omitted:number};
export type HistoryRead={kind:'ready';window:HistoryWindow}|{kind:'gap'}|{kind:'unavailable'};
/** API-only projection. Current authority belongs to the server and parent.
 * An incomplete page advances a fixed frontier; resume opens a later frontier. */
export function readIntentHistory(status:number,raw:unknown,scope:Scope,previous?:HistoryWindow):HistoryRead{
 if(status!==200)return {kind:'unavailable'};
 const parsed=intentHistoryPageV1Schema.safeParse(raw);if(!parsed.success)return {kind:'unavailable'};
 const p=parsed.data;
 if(p.worldId!==scope.worldId||p.soulId!==scope.soulId||p.ownerId!==scope.ownerId)return {kind:'unavailable'};
 if(p.state==='gap')return {kind:'gap'};
 if(p.fromSeq!==(previous?.page.throughSeq??0))return {kind:'unavailable'};
 if(previous){
  const old=previous.page;
  if(old.worldId!==scope.worldId||old.soulId!==scope.soulId||old.ownerId!==scope.ownerId)return {kind:'unavailable'};
  if(!old.complete&&(p.frontier.seq!==old.frontier.seq||p.frontier.tick!==old.frontier.tick))return {kind:'unavailable'};
  if(old.complete&&(p.frontier.seq<old.frontier.seq||p.frontier.tick<old.frontier.tick))return {kind:'unavailable'};
 }
 const rows:IntentHistoryRow[]=[];
 for(const fact of p.events){
  // This producer does not publish purpose-resolution facts.
  if(fact.op==='resolve')return {kind:'unavailable'};
  const row=intentHistoryRow(fact,{...scope,sourceCutoffSeq:p.throughSeq,throughTick:p.frontier.tick});
  if(!row)return {kind:'unavailable'};rows.push(row);
 }
 const all=[...(previous?.rows??[]),...rows],drop=Math.max(0,all.length-250);
 return {kind:'ready',window:{page:p,rows:all.slice(drop),omitted:(previous?.omitted??0)+drop}};
}
