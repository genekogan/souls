import type {MidContext} from '@souls/brain';
import type {Mind,WorldHost} from './world.ts';
export type RetainedChoiceV1={intentId:string;version:number;card:string;target:string|null};
export const retainedChoiceKeyV1=(card:string,target:string|null)=>JSON.stringify([card,target]);
/** Ordinary alternatives from recalled current owned typed NOW next steps.
 * Ambiguous shared steps get no invented intent attribution or extra priority. */
export function retainedPurposeChoicesV1(host:WorldHost,m:Mind,purposes:NonNullable<MidContext['purposes']>):Map<string,RetainedChoiceV1>{
 const result=new Map<string,RetainedChoiceV1>(),ambiguous=new Set<string>();
 if(!host.extra.intentRetainedChoiceV1||m.activeRule||m.agendaPos<m.agenda.length)return result;
 const row=host.db.soul(m.soulId);if(!row||row.retired_at!==null||row.world_id!==host.worldId||row.owner!==m.owner||row.entity_id!==m.entityId||host.kernel.things[m.soulId]?.traits.body!==m.entityId)return result;
 const history=host.intentHistoryOf(m.soulId);
 for(const p of purposes){const ref=p.source;if(!ref||ref.worldId!==host.worldId||ref.soulId!==m.soulId||p.status!=='active'||p.trigger?.kind!=='now'||p.contribution?.kind!=='native_program_sequence'||p.contribution.completedSteps>=p.contribution.totalSteps)continue;
  const e=history.intents[ref.intentId],r=e?.revision;if(e?.status!=='active'||!r||r.version!==ref.version||r.source.ownerId!==m.owner||r.worldId!==host.worldId||r.soulId!==m.soulId||r.interpretation.trigger.kind!=='now'||r.interpretation.humanGoalPlan?.kind!=='planned'||r.interpretation.humanGoalPlan.bindingContext?.entityId!==m.entityId)continue;
  const i=host.intentSequenceStepV1(m.soulId,ref),s=r.interpretation.agenda[i];if(!s||!s.card.startsWith('human goal ')||!host.kernel.decks[m.soulId]?.cards.includes(s.card)||!host.kernel.vocab.cards[s.card])continue;
  const k=retainedChoiceKeyV1(s.card,s.target??null);if(result.has(k)){result.delete(k);ambiguous.add(k);}else if(!ambiguous.has(k))result.set(k,{intentId:r.intentId,version:r.version,card:s.card,target:s.target??null});
 }return result;
}
