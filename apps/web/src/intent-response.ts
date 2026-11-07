import { intentReceiptV2Schema, type IntentReceiptV2, type IntentRequestV2 } from '@souls/protocol';
export type IntentResponse = { kind: 'recorded'; receipt: IntentReceiptV2 } | { kind: 'unconfirmed'; title: string; detail: string };
/** Validate the actual versioned wire response and this caller's immutable request. */
export function intentResponse(status: number, body: unknown, scope: {worldId:string;soulId:string;ownerId:string;principalId?:string;entityId?:string;request:IntentRequestV2}):IntentResponse {
  const uncertain = (detail: string): IntentResponse => ({kind:'unconfirmed',title:'Direction could not be confirmed',detail});
  if (status !== 200 && status !== 202) return uncertain(status === 404
    ? 'This request is unavailable to your current account. Keep its reference; this does not confirm whether it was saved.'
    : status === 401 || status === 403 ? 'Your current account cannot read this request. Sign in with its owner to check it.'
    : 'The server may have saved your direction. Check this request before sending it again.');
  const parsed = intentReceiptV2Schema.safeParse(body);
  if (!parsed.success) return uncertain('The response was incomplete. Check this request before sending it again.');
  const r = parsed.data, q = scope.request;
  if (r.requestId !== q.requestId || (status === 202) !== (r.phase === 'received')) return uncertain('The response did not match this request. Keep its reference and check again.');
  if (r.phase === 'received' || r.phase === 'withdrawn') {
    if (r.worldId !== scope.worldId || r.soulId !== scope.soulId) return uncertain('The response did not match this Soul and world.');
  }
  if (r.phase === 'understood') {
    const v = r.revision;
    const plan=v.interpretation.humanGoalPlan;
    if(scope.entityId!==undefined&&plan?.kind==='planned'&&plan.bindingContext?.entityId!==scope.entityId)return uncertain('The response did not match this Soul’s current body.');
    if (q.op !== 'upsert' || v.worldId !== scope.worldId || v.soulId !== scope.soulId || v.words !== q.words
      || v.source.kind !== 'owner' || v.source.ownerId !== scope.ownerId || v.source.principalId !== (scope.principalId??scope.ownerId) || v.source.channel !== 'web'
      || v.strict !== q.strict || v.importance !== q.importance
      || (q.edit ? v.intentId !== q.edit.intentId || v.version !== q.edit.expectedVersion + 1 : v.version !== 1)) return uncertain('The interpretation did not match the submitted direction. Keep its reference and check again.');
  }
  if (r.phase === 'withdrawn' && (q.op !== 'withdraw' || r.intent.intentId !== q.edit.intentId || r.intent.version !== q.edit.expectedVersion)) return uncertain('The response did not match this withdrawal.');
  if(r.phase==='refused'&&(r.outcome||r.scope)) {
    const v=r.scope;
    if(!v||v.worldId!==scope.worldId||v.soulId!==scope.soulId||v.source.kind!=='owner'||v.source.ownerId!==scope.ownerId||v.source.principalId!==(scope.principalId??scope.ownerId)||v.source.channel!=='web'||(scope.entityId!==undefined&&v.entityId!==scope.entityId))return uncertain('The response did not match your current ownership. Keep its reference and check again.');
  }
  return {kind:'recorded',receipt:r};
}

/** A reference lookup has no local copy of the submitted words/settings.
 * Trust only a strict current-authorized server receipt, never invent a request. */
export function intentLookupResponse(status:number,body:unknown,scope:{worldId:string;soulId:string;ownerId:string;principalId?:string;entityId?:string;requestId:string}):IntentResponse {
  const uncertain=(detail:string):IntentResponse=>({kind:'unconfirmed',title:'Previous direction could not be confirmed',detail});
  if(status!==200&&status!==202)return uncertain('This reference is unavailable to your current account or could not be read. Keep it; this does not confirm whether the direction was saved.');
  const parsed=intentReceiptV2Schema.safeParse(body);
  if(!parsed.success)return uncertain('The response was incomplete. Keep the reference and check again later.');
  const r=parsed.data;
  if(r.requestId!==scope.requestId||(status===202)!==(r.phase==='received'))return uncertain('The response did not match this reference.');
  if((r.phase==='received'||r.phase==='withdrawn')&&(r.worldId!==scope.worldId||r.soulId!==scope.soulId))return uncertain('The response did not match this Soul and world.');
  if(r.phase==='understood'){
    const v=r.revision;
    const plan=v.interpretation.humanGoalPlan;
    if(scope.entityId!==undefined&&plan?.kind==='planned'&&plan.bindingContext?.entityId!==scope.entityId)return uncertain('The response did not match this Soul’s current body.');
    if(v.worldId!==scope.worldId||v.soulId!==scope.soulId||v.source.kind!=='owner'||v.source.ownerId!==scope.ownerId||v.source.principalId!==(scope.principalId??scope.ownerId))return uncertain('The response did not match your current ownership.');
  }
  if(r.phase==='refused'&&(r.outcome||r.scope)) {
    const v=r.scope;
    if(!v||v.worldId!==scope.worldId||v.soulId!==scope.soulId||v.source.kind!=='owner'||v.source.ownerId!==scope.ownerId||v.source.principalId!==(scope.principalId??scope.ownerId)||v.source.channel!=='web'||(scope.entityId!==undefined&&v.entityId!==scope.entityId))return uncertain('The response did not match your current ownership. Keep its reference and check again.');
  }
  return {kind:'recorded',receipt:r};
}
