import type {MidContext,PurposeExperiencesV1} from '@souls/brain';
import {ownedBodyCorresponds} from './lifecycle-runner.ts';
import type {WorldHost,Mind} from './world.ts';
import type {IntentHistoryV2} from './intent-history.ts';
export type PurposeEpisodeV1={intentId:string;version:number;attemptId:string;phase:string;seq:number;tick:number;origin:{seq:number;tick:number};evidence:{seq:number;tick:number;kind:string}};
/** Only current owned accepted outcomes; journal prose does not create episodes. */
export function purposeEpisodesV1(host:WorldHost,m:Mind,throughSeq=host.seq):PurposeEpisodeV1[]{
 const row=host.db.soul(m.soulId);if(!row||row.owner!==m.owner||row.entity_id!==m.entityId||row.world_id!==host.worldId||row.retired_at!==null)return [];
 const history:IntentHistoryV2=host.intentHistoryOf(m.soulId);
 return episodesFromHistoryV1(history,m.owner,throughSeq);
}
export function episodesFromHistoryV1(history:IntentHistoryV2,owner:string,throughSeq:number):PurposeEpisodeV1[]{
 return Object.values(history.attempts).filter(a=>{const r=history.intents[a.intent.intentId]?.revision;return a.seq<=throughSeq&&r?.source.ownerId===owner&&r.version===a.intent.version;}).sort((a,b)=>b.seq-a.seq).slice(0,12).map(a=>{const r=history.intents[a.intent.intentId].revision;return {intentId:a.intent.intentId,version:a.intent.version,attemptId:a.attemptId,phase:a.phase,seq:a.seq,tick:a.tick,origin:{seq:r.submitted.seq,tick:r.submitted.tick},evidence:{...a.evidence}};});
}
export function episodeJournalV1(episodes:PurposeEpisodeV1[]):string{
 const count=(phase:string)=>episodes.filter(e=>e.phase===phase).length;
 return `My recorded purpose activities currently include ${count('accepted')} admitted, ${count('started')} started, ${count('completed')} completed, ${count('blocked')} blocked and ${count('interrupted')} interrupted attempts. Admission alone does not show a physical start. Completed attempts are contributions, not declarations that my broader purposes are finished. These notes interpret my recorded experience; they do not prescribe a routine.`;
}

/** Relevant recent private outcomes for ordinary choice, bounded independently
 * of strict commitment recall. Current world tick is freshness, not a new event. */
export function purposeExperienceContextV1(host:WorldHost,m:Mind,purposes:NonNullable<MidContext['purposes']>=[]):PurposeExperiencesV1|undefined{
 if(!host.extra.intentEpisodeMemoryV1||host.minds.get(m.soulId)!==m)return undefined;
 const row=host.db.soul(m.soulId);if(!row||!ownedBodyCorresponds(host,{worldId:host.worldId,soulId:m.soulId,entityId:m.entityId,owner:m.owner},row.name))return undefined;
 const relevant=new Set(purposes.filter(p=>p.source?.worldId===host.worldId&&p.source.soulId===m.soulId).map(p=>JSON.stringify([p.source!.intentId,p.source!.version])));
 const episodes=purposeEpisodesV1(host,m).sort((a,b)=>Number(relevant.has(JSON.stringify([b.intentId,b.version])))-Number(relevant.has(JSON.stringify([a.intentId,a.version])))||b.seq-a.seq).slice(0,3);
 return {contract:'private-purpose-experiences/1',worldId:host.worldId,soulId:m.soulId,entityId:m.entityId,observedTick:host.engine.world.tick,throughSeq:host.seq,episodes};
}
