import type {MidContext,PurposeRecallV1} from '@souls/brain';
type Purpose=NonNullable<MidContext['purposes']>[number];
export const PURPOSE_RECALL_LIMITS_V1=Object.freeze({entries:12,bytes:16_384,omittedRefs:12});
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;
const key=(p:Purpose)=>p.source?JSON.stringify([p.source.intentId,p.source.version]):null;
const words=(s:string)=>new Set(s.toLowerCase().match(/[\p{L}\p{N}_-]{4,}/gu)??[]);
/** Select prompt context only. It does not schedule, resolve or delete a purpose.
 * Every strict/current commitment must fit in full or no choice is authorized. */
export function recallPurposesV1(all:Purpose[],acting?:{intentId:string;version:number},localContext=''):{purposes:Purpose[];recall:PurposeRecallV1}{
 if(all.some(p=>!p.source))throw Error('purpose-recall.recorded-evidence-required');
 if(all.some(p=>p.source!.worldId!==all[0].source!.worldId||p.source!.soulId!==all[0].source!.soulId))throw Error('purpose-recall.mixed-private-scope');
 const active=acting?JSON.stringify([acting.intentId,acting.version]):null,seen=new Set<string>();
 for(const p of all){const k=key(p)!;if(seen.has(k))throw Error('purpose-recall.duplicate-revision');seen.add(k);}
 if(active&&!seen.has(active))throw Error('purpose-recall.current-commitment-missing');
 const mandatory=all.filter(p=>p.strict||key(p)===active),optional=all.filter(p=>!mandatory.includes(p));
 const tokens=words(localContext),score=(p:Purpose)=>{
  const text=words(p.words+' '+p.understanding);return [...tokens].reduce((n,t)=>n+Number(text.has(t)),0);
 };
 optional.sort((a,b)=>{
  const unfinished=(p:Purpose)=>!!p.contribution&&p.contribution.completedSteps<p.contribution.totalSteps||['blocked','interrupted'].includes(p.lastAttempt?.phase??'');
  return score(b)-score(a)||Number(unfinished(b))-Number(unfinished(a))||b.importance-a.importance||(b.source!.seq-a.source!.seq)||(key(a)!<key(b)!?-1:key(a)!>key(b)!?1:0);
 });
 const selected:Purpose[]=[];let state:PurposeRecallV1['state']='ready';
 if(mandatory.length>PURPOSE_RECALL_LIMITS_V1.entries||bytes(mandatory)>PURPOSE_RECALL_LIMITS_V1.bytes)state='overflow';
 else{selected.push(...mandatory);for(const p of optional){if(selected.length===PURPOSE_RECALL_LIMITS_V1.entries)break;if(bytes([...selected,p])<=PURPOSE_RECALL_LIMITS_V1.bytes)selected.push(p);}}
 const included=new Set(selected.map(key)),omitted=all.filter(p=>!included.has(key(p)));
 return {purposes:selected,recall:{contract:'private-purpose-recall/1',state,total:all.length,selected:selected.length,omitted:omitted.length,bytes:bytes(selected),omittedSources:omitted.slice(0,PURPOSE_RECALL_LIMITS_V1.omittedRefs).map(p=>({...p.source!})),moreOmittedSources:omitted.length>PURPOSE_RECALL_LIMITS_V1.omittedRefs,...(state==='overflow'?{reason:'mandatory_context_exceeds_limit' as const}:{})}};
}
