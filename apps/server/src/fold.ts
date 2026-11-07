import {soulProfileFactV1Schema} from '@souls/protocol';
import {authoredBoundariesDeclarationV1Schema} from '@souls/engine-contract';
// The fold: applying one logged event to the world. The world has two parts:
//   the KERNEL (meaning: things, links, vocabulary, decks), which replays from
//   the log alone, and the ENGINE (depiction: bodies, motion), which replays the
//   programs that decisions started. Models never appear here.
// Used identically by the live loop, the restart fast-forward and replay tests.
import type { Engine } from '@souls/engine-contract';
import {
  applyAll, bind, changesOf, emptyKernel, kernelHash, seedVocabulary, sweep, whyNot, BASE_MANNERS,
  type Change, type KState, type Thing,
} from '@souls/kernel';
import { intentReceivedPayloadV2Schema, intentHistoryFactV2, intentAdmissionFactV2, intentControllerFactV2, intentArrivalFactV1, type BirthPayload, type DecisionPayload, type DeckPayload, type LogEvent, type MintPayload, type PlayPayload, type PlayView } from '@souls/protocol';
import {foldMandate} from './mandate.ts';
import {intentSleepStopV1Schema} from '@souls/protocol';
import {bodyAssignmentV1Schema} from '@souls/protocol';
import {renderPlatformsDeclarationV1Schema} from '@souls/engine-contract';
import {officeStairGuardsDeclarationV1Schema} from '@souls/engine-contract';
import { isStationFactV1, parseStationFactV1 } from '@souls/protocol';

/**
 * The words a world began with (kinds, link kinds, manners, base cards), as written into its log.
 * A world's history is replayed with its own vocabulary, never with whatever the code's starting set has since become:
 * changing a base card in the code changes new worlds, and an existing world only when a `rules` event adopts it.
 */
export type Vocabulary = { kinds: KState['vocab']['kinds']; links: KState['vocab']['links']; manners: KState['vocab']['manners']; cards: KState['vocab']['cards'] };
export const baseVocabulary = (k: KState): Vocabulary => ({ kinds: k.vocab.kinds, links: k.vocab.links, manners: k.vocab.manners, cards: Object.fromEntries(Object.entries(k.vocab.cards).filter(([, c]) => c.origin === 'base')) });
export const codeVocabulary = (): Vocabulary => { const k = emptyKernel(); seedVocabulary(k); return structuredClone(baseVocabulary(k)); };
function setVocabulary(k: KState, v: Vocabulary): void {
  Object.assign(k.vocab.kinds, structuredClone(v.kinds)); Object.assign(k.vocab.links, structuredClone(v.links)); Object.assign(k.vocab.manners, structuredClone(v.manners)); Object.assign(k.vocab.cards, structuredClone(v.cards));
}
/** The first vocabulary written into a log, if any: what its genesis kernel started with. */
export const pinnedVocabulary = (events: LogEvent[]): Vocabulary | null => (events.find((e) => e.kind === 'rules' && (e.payload as { vocabulary?: Vocabulary } | null)?.vocabulary)?.payload as { vocabulary: Vocabulary } | undefined)?.vocabulary ?? null;

/** Where Souls arrive: the place the engine tags as its arrival point. */
export const arrivalPlace = (k: KState): string | null => Object.keys(k.things).sort().find((id) => Array.isArray(k.things[id].traits.tags) && (k.things[id].traits.tags as string[]).includes('arrival')) ?? null;

/** A fresh kernel for an engine world: the starting vocabulary plus a place Thing per physical anchor. */
export function initKernel(engine: Engine, pinned?: Vocabulary | null): KState {
  const k = emptyKernel(); if (pinned) setVocabulary(k, pinned); else seedVocabulary(k);
  const anchors = engine.anchors();
  const mk = (id: string, kind: string, name: string, at: string | null, traits: Thing['traits']) => { const r = applyAll(k, [{ op: 'appear', id, kind, name, at, traits }], 'world'); if (!r.ok) throw new Error(`kernel genesis: ${r.message}`); };
  for (const a of anchors) if (a.kind === 'region') mk(a.id, 'region', a.name, null, { ...(a.point ? { point: a.point } : {}) });
  for (const a of anchors) if (a.kind === 'place') mk(a.id, 'place', a.name, a.in ?? null, { ...(a.entity ? { entity: a.entity } : {}), ...(a.point ? { point: a.point } : {}), ...(a.tags ? { tags: a.tags } : {}) });
  return k;
}

const hash32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/** Three starting manners, picked deterministically from the Soul's id until its deck is attuned to its description. */
export const defaultManners = (soulId: string, manners = BASE_MANNERS): string[] => { const all = Object.keys(manners).sort(); if (!all.length) return []; const h = hash32(soulId); return [all[h % all.length], all[(h >>> 8) % all.length], all[(h >>> 16) % all.length]].filter((m, i, a) => a.indexOf(m) === i); };

export function soulThing(k: KState, p: BirthPayload, at: string | null): void {
  if (k.things[p.soulId]) return;
  const r = applyAll(k, [{ op: 'appear', id: p.soulId, kind: 'soul', name: p.name, at, traits: { body: p.entityId, about: p.description } }], 'world');
  if (!r.ok) throw new Error(`kernel birth: ${r.message}`);
  k.decks[p.soulId] = { cards: Object.values(k.vocab.cards).filter(c => c.origin === 'base').map(c => c.name), manners: defaultManners(p.soulId, k.vocab.manners) };
}

/** The most cards a Soul's deck holds. */
export const MAX_DECK = 80;

export type FoldResult = { play?: PlayView; programId?: string; programOk?: boolean; programCode?: string };

type GodWalkoutV1 = (id: string, to: [number, number], released: string[], how: 'walked' | 'relocated', dropAt?: [number, number, number], level?: number) => boolean;
/** G1 walk-out of a god edit's way. Deterministic and never a fault: a walk the engine no longer admits lands as a
 *  relocation at the same point; a body that cannot land there (or a payload for someone else's body) is left as is.
 *  `level` (default 0): an upstairs resident whose floor the edit leaves standing steps aside on that floor. */
function godWalkout(engine: Engine, k: KState, payload: unknown, how: 'walked' | 'relocated'): void {
  const p = payload as { soulId?: string; entityId?: string; to?: [number, number]; released?: string[]; dropAt?: [number, number, number]; level?: number } | null;
  const walk = (engine as unknown as { godWalkoutV1?: GodWalkoutV1 }).godWalkoutV1;
  if (!p?.soulId || !p.entityId || !Array.isArray(p.to) || !walk || k.things[p.soulId]?.traits.body !== p.entityId) return;
  const released = Array.isArray(p.released) ? p.released : [], level = Number.isInteger(p.level) ? p.level : 0;
  if (!walk.call(engine, p.entityId, p.to, released, how, p.dropAt, level) && how === 'walked') walk.call(engine, p.entityId, p.to, released, 'relocated', p.dropAt, level);
}

/** Apply one logged event to the engine and the kernel. Deterministic; returns what happened for the host's bookkeeping. */
export function foldEvent(engine: Engine, k: KState, e: LogEvent, counts: Record<string, number>): FoldResult {
  if(isStationFactV1(e.kind))parseStationFactV1(e.kind,e.payload);
  k.tick = e.tick;
  sweep(k);
  switch (e.kind) {
    case 'intent-sleep-stop-v1': {
      const p=intentSleepStopV1Schema.parse(e.payload),action=engine.programAction?.(p.programId);
      if(e.author!=='world:human-sleep-stop'||k.things[p.soulId]?.traits.body!==p.entityId||engine.programOf(p.entityId)!==p.programId||action?.actor!==p.entityId||action.action.verb!=='sleep')throw Error('human-sleep-transition.invalid-source');
      engine.stop(p.programId);return {};
    }
    // Private owner control facts have no public kernel/body effects. The host
    // folds their private history separately, including snapshot/recovery replay.
    case 'intent-request-v2': { intentReceivedPayloadV2Schema.parse(e.payload); return {}; }
    case 'intent-v2': { intentHistoryFactV2(e); return {}; }
    case 'intent-admission-v2': { intentAdmissionFactV2(e); return {}; }
    case 'intent-arrival-v1': {intentArrivalFactV1(e);return {};}
    case 'intent-controller-v2': { intentControllerFactV2(e); return {}; }
    case 'birth': {
      const p = e.payload as BirthPayload;
      engine.spawnHuman({ id: p.entityId, label: p.name, soul: p.soulId, ...(p.near ? { near: p.near } : {}) });
      soulThing(k, p, arrivalPlace(k));
      return {};
    }
    case 'mandate': { foldMandate(k,e.payload);return {}; }
    case 'decision': {
      const p = e.payload as DecisionPayload;
      if (!engine.world.entities[p.entityId] || p.continue) return {};
      const r = engine.perform({ actor: p.entityId, label: p.label, steps: p.steps });
      return { programId: r.id, programOk: r.ok, programCode: r.diagnostic?.code };
    }
    case 'edge-god-walkout': {
      // G1: a god edit walked this resident out of its way (planned against the native route; compressed to its end).
      // Forward-only: release 1 folds this kind as a no-op, so snapshot before upgrading and never roll back past it.
      godWalkout(engine, k, e.payload, 'walked');
      return {};
    }
    case 'edge-relocate': {
      // Edge reclaim after fading: land an idle body at a starting place (no-op if the engine refuses).
      const p = e.payload as { entityId?: string; to?: [number, number]; godWalkout?: boolean };
      // G1: no walking route out of a god edit's way: the same intervention, landed directly.
      if (p.godWalkout) { godWalkout(engine, k, e.payload, 'relocated'); return {}; }
      const relocate = (engine as unknown as { relocateHumanV1?: (id: string, to: [number, number]) => boolean }).relocateHumanV1;
      if (p.entityId && Array.isArray(p.to) && relocate) relocate.call(engine, p.entityId, p.to);
      return {};
    }
    case 'body-assignment-v1': {
      const p=bodyAssignmentV1Schema.parse(e.payload);
      if(e.author!=='world:body'||k.things[p.soulId]?.traits.body!==p.entityId||!engine.assignBodyV1||!engine.assignBodyV1(p.entityId,p.body))throw Error('body.assignment-invalid');
      return {};
    }
    case 'world-edit': {
      // world-edit/1 (lane L9): an entity-world commit's derived physics and fixtures, applied from the log alone.
      // The payload carries everything (the fold never reads the entity model), so replay re-derives the same Spatial.
      const apply = (engine as unknown as { applyWorldEditV1?: (p: unknown) => { hash: string } }).applyWorldEditV1;
      if (!apply) throw Error('world-edit.reader-required');
      const r = apply.call(engine, e.payload);
      const want = (e.payload as { hash?: string } | null)?.hash;
      if (want && r.hash !== want) console.error(`[world-edit] seq ${(e.payload as { seq?: number }).seq}: derived physics ${r.hash.slice(0, 12)} differs from the logged ${want.slice(0, 12)}`);
      return {};
    }
    case 'edge-attention': {
      // attention/1: a Soul's own look / turn / face (or auto-face in a conversation). Head only, or a free standing body
      // turns; never stops, replaces or blocks the body's program (independent attention channel).
      const p = e.payload as { entityId?: string; gaze?: { target?: string; at?: [number, number]; until?: number; kind?: string } | null; yaw?: number; turn?: string };
      const attend = (engine as unknown as { attendHumanV1?: (id: string, g: unknown, yaw?: number, turn?: 'gradual-v1') => string }).attendHumanV1;
      // #423: `turn: 'gradual-v1'` is recorded on new events only; older events keep their at-once body turn.
      if (p.entityId && attend && p.gaze !== undefined) attend.call(engine, p.entityId, p.gaze, typeof p.yaw === 'number' ? p.yaw : undefined, p.turn === 'gradual-v1' ? 'gradual-v1' : undefined);
      return {};
    }
    case 'edge-stop': {
      // Edge worlds: a Soul's own agent asked its body to stop safely (rise from sleep,
      // finish the current step); the engine's ordinary stop owns the safe landing.
      const p = e.payload as { entityId?: string; programId?: string; stallReleaseV1?: { code: string; message: string } };
      // stall-guard/1 (edge/ledger/stall-guard.ts): the world ends a hold that stopped making progress and stands the body
      // at the nearest free spot (deterministic from the state at this tick; never aloft, never construction).
      if (p.entityId && p.stallReleaseV1) { engine.stallReleaseV1?.(p.entityId, p.stallReleaseV1); return {}; }
      // PC08 (#687, PC02 §3): a shared operation's stop names its programme (a borrowed guest's body runs the host's);
      // older events without `programId` replay through the body's own programme, unchanged
      if (typeof p.programId === 'string') { engine.stop(p.programId, { untilSafe: true }); return {}; }
      const id = p.entityId ? engine.programOf(p.entityId) : null;
      if (id) engine.stop(id);
      return {};
    }
    case 'play': {
      const p = e.payload as PlayPayload;
      const soul = k.things[p.soulId], card = k.vocab.cards[p.card], target = p.target ? k.things[p.target] : null;
      const view: PlayView = { seq: e.seq, tick: e.tick, soulId: p.soulId, soul: soul?.name ?? p.soulId, card: p.card, target: p.target, targetName: target?.name ?? null, ...(p.manner ? { manner: p.manner } : {}), ok: false, changes: [] };
      const refuse = (reason: string): FoldResult => {
        view.reason = reason;
        // the meaning did not happen, so the depiction should not carry on as if it had
        const body = soul?.traits.body as string | undefined; const pid = body ? engine.programOf(body) : null; if (pid) engine.stop(pid);
        return { play: view };
      };
      if (!soul) return refuse('no such Soul');
      if (!card || card.hash !== p.hash) return refuse('that card is not in the vocabulary');
      if (!k.decks[p.soulId]?.cards.includes(p.card)) return refuse('that card is not in this Soul’s deck');
      const why = whyNot(k, card, p.soulId, p.target); if (why) return refuse(why);
      let changes: Change[], nextId: number;
      try { ({ changes, nextId } = changesOf(k, card, bind(k, card, p.soulId, p.target)!, p.manner)); } catch (err) { return refuse(String((err as Error).message)); }
      const r = applyAll(k, changes, p.soulId);
      if (!r.ok) return refuse(r.message);
      k.nextId = nextId; counts[p.card] = (counts[p.card] ?? 0) + 1;
      view.ok = true; view.changes = changes;
      return { play: view };
    }
    case 'mint': {
      const p = e.payload as MintPayload;
      if (p.kinds) for (const [n, d] of Object.entries(p.kinds)) k.vocab.kinds[n] ??= d;
      if (p.links) for (const [n, d] of Object.entries(p.links)) k.vocab.links[n] ??= d;
      k.vocab.cards[p.card.name] ??= p.card;
      // If someone else minted a different card under this name first, theirs stands and this Soul is not dealt it.
      const same = k.vocab.cards[p.card.name].hash === p.card.hash, d = p.forSoul ? k.decks[p.forSoul] : undefined;
      if (same && d && !d.cards.includes(p.card.name) && d.cards.length < MAX_DECK) d.cards.push(p.card.name);
      return {};
    }
    case 'deck': {
      const p = e.payload as DeckPayload; const d = k.decks[p.soulId]; if (!d) return {};
      for (const c of p.add ?? []) if (k.vocab.cards[c] && !d.cards.includes(c) && d.cards.length < MAX_DECK) d.cards.push(c);
      if (p.remove) d.cards = d.cards.filter((c) => !p.remove!.includes(c));
      if (p.manners) d.manners = p.manners.filter((m) => k.vocab.manners[m]).slice(0, 4);
      return {};
    }
    case 'retire': {
      const p = e.payload as { soulId: string; entityId: string };
      if (engine.world.entities[p.entityId]) engine.removeEntity(p.entityId);
      // what the Soul hosted or made does not outlive it
      const orphans = Object.values(k.things).filter((t) => t.by === p.soulId).map((t) => t.id);
      for (const id of [...orphans, p.soulId]) if (k.things[id]) applyAll(k, [{ op: 'vanish', id }], 'world');
      delete k.decks[p.soulId];
      return {};
    }
    case 'rules': {
      if(e.payload?.nativeSleepSnapshotPolicy){if(Object.keys(e.payload).length!==1||!engine.adoptNativeSleepSnapshotV1)throw Error('sleep-snapshot.reader-required');engine.adoptNativeSleepSnapshotV1(e.payload.nativeSleepSnapshotPolicy);}
      if(e.payload?.commonsNewcomerResources){if(Object.keys(e.payload).length!==1||!engine.adoptCommonsNewcomerResourcesV1)throw Error('newcomer-resources.reader-required');engine.adoptCommonsNewcomerResourcesV1(e.payload.commonsNewcomerResources);
        for(const a of engine.anchors())if(!k.things[a.id]){const r=applyAll(k,[{op:'appear',id:a.id,kind:a.kind==='region'?'region':'place',name:a.name,at:a.in??null,traits:{...(a.entity?{entity:a.entity}:{}),...(a.point?{point:a.point}:{})}}],'world');if(!r.ok)throw Error('newcomer-resources.anchor:'+r.message);}}
      if(e.payload?.commonsFoodDelivery){if(Object.keys(e.payload).length!==1||!engine.adoptCommonsFoodDeliveryV1)throw Error('food-delivery.reader-required');engine.adoptCommonsFoodDeliveryV1(e.payload.commonsFoodDelivery);}
      if(e.payload?.existingGreenLandmark){if(Object.keys(e.payload).length!==1||!engine.adoptExistingGreenLandmarkV1)throw Error('green-landmark.reader-required');engine.adoptExistingGreenLandmarkV1(e.payload.existingGreenLandmark);for(const a of engine.anchors())if(!k.things[a.id]){const r=applyAll(k,[{op:'appear',id:a.id,kind:'place',name:a.name,at:a.in??null,traits:{...(a.point?{point:a.point}:{}),...(a.tags?{tags:a.tags}:{})}}],'world');if(!r.ok)throw Error('green-landmark.anchor:'+r.message);}}
      if(e.payload?.edenGround){if(Object.keys(e.payload).length!==1||!engine.adoptEdenGroundV1)throw Error('eden-ground.reader-required');engine.adoptEdenGroundV1(e.payload.edenGround);}
      if(e.payload?.edenLecture){if(Object.keys(e.payload).length!==1||!engine.adoptEdenLectureV1)throw Error('eden-lecture.reader-required');engine.adoptEdenLectureV1(e.payload.edenLecture);for(const a of engine.anchors())if(!k.things[a.id]){const r=applyAll(k,[{op:'appear',id:a.id,kind:a.kind==='region'?'region':'place',name:a.name,at:a.in??null,traits:{...(a.entity?{entity:a.entity}:{}),...(a.point?{point:a.point}:{}),...(a.tags?{tags:a.tags}:{})}}],'world');if(!r.ok)throw Error('eden-lecture.anchor:'+r.message);}}
      if(e.payload?.socialEden){if(Object.keys(e.payload).length!==1||!engine.adoptSocialEdenV1)throw Error('social-eden.reader-required');engine.adoptSocialEdenV1(e.payload.socialEden);
        for(const a of engine.anchors())if(!k.things[a.id]){const r=applyAll(k,[{op:'appear',id:a.id,kind:a.kind==='region'?'region':'place',name:a.name,at:a.in??null,traits:{...(a.entity?{entity:a.entity}:{}),...(a.point?{point:a.point}:{}),...(a.tags?{tags:a.tags}:{})},states:{socialSeat:!!a.tags?.some(t=>t==='camp-chair'||t==='bench-6ft'),socialDiningSeat:a.id.startsWith('social-eden-dining-chair-')}}],'world');if(!r.ok)throw Error('social-eden.anchor:'+r.message);}}
      if(e.payload?.retainedCommonsShore){if(Object.keys(e.payload).length!==1||!engine.adoptRetainedCommonsShoreV1)throw Error('retained-shore.reader-required');engine.adoptRetainedCommonsShoreV1(e.payload.retainedCommonsShore);
        for(const a of engine.anchors())if(!k.things[a.id]){const r=applyAll(k,[{op:'appear',id:a.id,kind:a.kind==='region'?'region':'place',name:a.name,at:a.in??null,traits:{...(a.entity?{entity:a.entity}:{}),...(a.point?{point:a.point}:{})}}],'world');if(!r.ok)throw Error('retained-shore.anchor:'+r.message);}}
      if(e.payload?.commonsKitchen){if(Object.keys(e.payload).length!==1||!engine.adoptCommonsKitchenV1)throw Error('commons-kitchen.reader-required');engine.adoptCommonsKitchenV1(e.payload.commonsKitchen);
        for(const a of engine.anchors())if(!k.things[a.id]){const r=applyAll(k,[{op:'appear',id:a.id,kind:a.kind==='region'?'region':'place',name:a.name,at:a.in??null,traits:{...(a.entity?{entity:a.entity}:{}),...(a.point?{point:a.point}:{})}}],'world');if(!r.ok)throw Error('commons-kitchen.anchor:'+r.message);}}
      if(e.payload?.commonsProvisions){if(Object.keys(e.payload).length!==1||!engine.adoptCommonsProvisionsV1)throw Error('commons-provisions.reader-required');engine.adoptCommonsProvisionsV1(e.payload.commonsProvisions);
        for(const a of engine.anchors())if(!k.things[a.id]){const r=applyAll(k,[{op:'appear',id:a.id,kind:a.kind==='region'?'region':'place',name:a.name,at:a.in??null,traits:{...(a.entity?{entity:a.entity}:{}),...(a.point?{point:a.point}:{})}}],'world');if(!r.ok)throw Error('commons-provisions.anchor:'+r.message);}}
      const crew=(e.payload as {crewRemovalTransition?:import('@souls/engine-contract').CrewRemovalTransitionV1}|null)?.crewRemovalTransition;
      if(crew){
        if(Object.keys(e.payload).length!==1)throw Error('crew-removal-transition.mixed-payload');
        if(!engine.adoptCrewRemovalTransitionV1)throw Error('crew-removal-transition.reader-unavailable');
        engine.adoptCrewRemovalTransitionV1(crew);
      }
      const transition=(e.payload as {commonsTransition?:import('@souls/engine-contract').CommonsTransitionV1}|null)?.commonsTransition;
      if(transition){
        if(!engine.adoptCommons)throw new Error('commons-transition.reader-unavailable');
        const preview=engine.previewCommonsTransition?.();
        if(!preview?.ok)throw new Error('commons-transition.preview-unavailable');
        const previous=new Set(engine.anchors().map(a=>a.id));
        for(const a of preview.anchors)if(!previous.has(a.id)&&k.things[a.id])throw new Error(`commons-transition.kernel-collision:${a.id}`);
        engine.adoptCommons(transition);
        for(const a of engine.anchors())if(!k.things[a.id]){
          const result=applyAll(k,[{op:'appear',id:a.id,kind:a.kind==='region'?'region':'place',name:a.name,at:a.in??null,
            traits:{...(a.entity?{entity:a.entity}:{}),...(a.point?{point:a.point}:{}),...(a.tags?{tags:a.tags}:{})}}],'world');
          if(!result.ok)throw new Error(`commons-transition.anchor:${result.message}`);
        }
      }
      const expansion=(e.payload as {campExpansion?:import('@souls/engine-contract').CampExpansionV1}|null)?.campExpansion;
      if(expansion){
        if(!engine.adoptCampExpansionV1)throw new Error('camp-expansion.reader-unavailable');
        const preview=engine.previewCampExpansionV1?.();if(!preview?.ok)throw new Error('camp-expansion.preview-unavailable');
        const previous=new Set(engine.anchors().map(a=>a.id));
        for(const a of preview.anchors)if(!previous.has(a.id)&&k.things[a.id])throw new Error('camp-expansion.kernel-collision:'+a.id);
        engine.adoptCampExpansionV1(expansion);
        for(const a of engine.anchors())if(!k.things[a.id]){
          const result=applyAll(k,[{op:'appear',id:a.id,kind:a.kind==='region'?'region':'place',name:a.name,at:a.in??null,
            traits:{...(a.entity?{entity:a.entity}:{}),...(a.point?{point:a.point}:{}),...(a.tags?{tags:a.tags}:{})}}],'world');
          if(!result.ok)throw new Error('camp-expansion.anchor:'+result.message);
        }
      }
      // ground/1 (lane L8): an entity world's terrain recipe (by hash); Souls stand and route on it from here on (prospective; idempotent).
      const groundV1=(e.payload as {groundV1?:unknown}|null)?.groundV1;
      if(groundV1){const install=(engine as unknown as {installGroundV1?:(f:unknown)=>unknown}).installGroundV1;if(!install)throw Error('ground.reader-required');install.call(engine,groundV1);}
      if(e.payload?.groundReclaimV1!==undefined){if(e.payload.groundReclaimV1!==true||!engine.enableGroundReclaimV1)throw Error('ground-reclaim.reader-required');engine.enableGroundReclaimV1();}
      // nav/1: extra flat walking ground and solid building/water footprints join the static walk scene (prospective; idempotent).
      const nav=(e.payload as {navV1?:unknown}|null)?.navV1;
      if(nav){const install=(engine as unknown as {installNavV1?:(s:unknown)=>unknown}).installNavV1;if(!install)throw Error('nav.reader-required');install.call(engine,nav);}
      if(e.payload?.renderPlatformsV1){if(e.author!=='operator:render-platforms'||!engine.configureRenderPlatformsV1)throw Error('render-platforms.reader-required');engine.configureRenderPlatformsV1({...renderPlatformsDeclarationV1Schema.parse(e.payload.renderPlatformsV1),acceptedAtTick:e.tick});}
      if(e.payload?.authoredBoundariesV1){if(e.author!=='operator:authored-boundaries'||!engine.configureAuthoredBoundariesV1)throw Error('authored-boundaries.reader-required');engine.configureAuthoredBoundariesV1({...authoredBoundariesDeclarationV1Schema.parse(e.payload.authoredBoundariesV1),acceptedAtTick:e.tick});}
      if(e.payload?.officeStairGuardsV1){if(e.author!=='operator:office-stair-guards'||!engine.configureOfficeStairGuardsV1)throw Error('office-guards.reader-required');engine.configureOfficeStairGuardsV1({...officeStairGuardsDeclarationV1Schema.parse(e.payload.officeStairGuardsV1),acceptedAtTick:e.tick});}
      // placeRegionsV1: W1 places on admitted native ground become destination regions, with their kernel places (walk offers).
      const regionsV1=(e.payload as {placeRegionsV1?:unknown}|null)?.placeRegionsV1;
      if(regionsV1){const install=(engine as unknown as {installPlaceRegionsV1?:(l:unknown)=>string[]}).installPlaceRegionsV1;if(!install)throw Error('place-regions.reader-required');
        const added=new Set(install.call(engine,regionsV1));
        for(const a of engine.anchors())if(added.has(a.id)&&!k.things[a.id]){const r=applyAll(k,[{op:'appear',id:a.id,kind:'place',name:a.name,at:a.in??null,traits:{...(a.point?{point:a.point}:{}),...(a.tags?{tags:a.tags}:{})}}],'world');if(!r.ok)throw Error('place-regions.anchor:'+r.message);}}
      // upper-floors/1: a building's upper floors (cropped levels, floors, stairs) and its rooms as places, or their removal;
      // prospective; a fact that does not preview cleanly is a no-op on every replay alike.
      const upperFloors=(e.payload as {upperFloorsV1?:unknown}|null)?.upperFloorsV1;
      if(upperFloors){const install=(engine as unknown as {installUpperFloorsV1?:(f:unknown)=>{added:string[];removed:string[]}}).installUpperFloorsV1;
        if(e.author!=='operator:upper-floors'||!install)throw Error('upper-floors.reader-required');
        const out=install.call(engine,upperFloors),added=new Set(out.added);
        for(const a of engine.anchors())if(added.has(a.id)&&!k.things[a.id]){const r=applyAll(k,[{op:'appear',id:a.id,kind:'place',name:a.name,at:a.in??null,traits:{...(a.point?{point:a.point}:{}),...(a.tags?{tags:a.tags}:{})}}],'world');if(!r.ok)throw Error('upper-floors.anchor:'+r.message);}
        for(const id of out.removed)if(k.things[id])applyAll(k,[{op:'vanish',id}],'world');}
      // carrier/1: a ride (balloon) installed at its home; prospective, idempotent by id; refused installs are no-ops.
      const carrierRoute=(e.payload as {carrierRouteV1?:{id:string;route:string}}|null)?.carrierRouteV1;
      if(carrierRoute){const set=(engine as unknown as {setCarrierRouteV1?:(s:unknown)=>boolean}).setCarrierRouteV1;if(!set)throw Error('carrier.reader-required');set.call(engine,carrierRoute);}
      const reroute=(e.payload as {carrierRerouteV1?:unknown}|null)?.carrierRerouteV1;
      if(reroute){const fn=(engine as unknown as {rerouteCarrierV1?:(s:unknown)=>boolean}).rerouteCarrierV1;if(!fn)throw Error('carrier.reader-required');fn.call(engine,reroute);}
      const carrier=(e.payload as {carrierV1?:unknown}|null)?.carrierV1;
      if(carrier){const install=(engine as unknown as {installCarrierV1?:(s:unknown)=>boolean}).installCarrierV1;if(!install)throw Error('carrier.reader-required');install.call(engine,carrier);}
      const rules = e.payload as { runtimePolicy?: {sleepBlockTicks:number;quietSeatCourtesy?:boolean}; dayConfig?: { origin: number; dayTicks: number }; quiet?: boolean; compact?: boolean; adoptCamp?: boolean; restockCamp?: boolean; anchors?: import('@souls/engine-contract').Anchor[]; soulId?: string; character?: string };
      if (rules?.runtimePolicy) {
        if (!engine.configureRuntimePolicy) throw Error('runtime-policy.unsupported');
        engine.configureRuntimePolicy(rules.runtimePolicy);
      }
      if (rules?.dayConfig) engine.configureClock?.(rules.dayConfig);
      if (rules?.quiet) engine.beginQuiet?.();
      if ((rules as {quietEnded?: boolean})?.quietEnded) (engine as {endQuiet?(): void}).endQuiet?.();
      if (rules?.adoptCamp) {
        engine.adoptCamp?.();
        for (const a of rules.anchors ?? []) if (!k.things[a.id]) {
          const result = applyAll(k,[{op:'appear',id:a.id,kind:a.kind === 'region'?'region':'place',name:a.name,at:a.in??null,traits:{...(a.entity?{entity:a.entity}:{}),...(a.point?{point:a.point}:{}),...(a.tags?{tags:a.tags}:{})}}],'world');
          if (!result.ok) throw new Error(`camp.anchor:${result.message}`);
        }
      }
      if (e.payload?.soulProfileV1) {
        const profile=soulProfileFactV1Schema.parse(e.payload.soulProfileV1),thing=k.things[profile.soulId],body=engine.world.entities[profile.entityId];
        if(thing?.kind!=='soul'||thing.traits.body!==profile.entityId||thing.name!==profile.fromName
          ||Number(thing.traits.soulProfileRevisionV1??0)!==profile.fromRevision||body?.human?.soul!==profile.soulId||body.label!==profile.fromName)
          throw Error('soul-profile.correspondence');
        thing.name=profile.name;thing.traits.about=profile.description;thing.traits.soulProfileRevisionV1=profile.revision;
        body.label=profile.name;
      }
      if (rules?.character && rules.soulId && k.things[rules.soulId]) k.things[rules.soulId].traits.about = rules.character;
      if (rules?.restockCamp) engine.restockCamp?.();
      if (rules?.compact) engine.compact?.();
      // A world that began before the kernel existed is given one once, and where each Soul was is written into the log,
      // so a replay from genesis arrives at the same kernel.
      const voc = (e.payload as { vocabulary?: Vocabulary } | null)?.vocabulary;
      if (voc) setVocabulary(k, voc);
      const boot = (e.payload as { kernelBootstrap?: { at: Record<string, string | null> } } | null)?.kernelBootstrap;
      if (boot) for (const id of Object.keys(boot.at).sort()) { const at = boot.at[id]; if (k.things[id] && (at === null || k.things[at])) k.things[id].at = at; }
      return {};
    }
    default: return {}; // intent, scene, admin: no effect on engine or kernel
  }
}

/** Pure replay of the log from genesis. The legacy default stops before inputs
 * at untilTick. Opt-in includeHeadEvents folds those inputs without stepping
 * beyond the tick, matching a host after drainInputs/boot at the same head. */
export function replayFromGenesis(factory: { genesis(seed: string): unknown; create(world: any): Engine; restore?(snap: import('@souls/engine-contract').EngineSnapshot): Engine }, seed: string, events: LogEvent[], untilTick: number, options:{includeHeadEvents?:boolean}={}): { engine: Engine; kernel: KState; counts: Record<string, number> } {
  const repairs=events.filter(e=>e.tick<=untilTick && e.kind==='rules' && e.payload?.recovery), repair=repairs.at(-1);
  let engine: Engine, kernel: KState, counts: Record<string,number>, suffix=events;
  if (repair) {
    const recipe=repair.payload.recovery as import('./world.ts').RecoveryRecipe;
    if (!factory.restore) throw new Error('recovery requires a checkpoint factory');
    engine=factory.restore(structuredClone(recipe.baseline.runtime)); kernel=structuredClone(recipe.baseline.kernel!); counts={...recipe.baseline.counts};
    for (const m of recipe.baseline.minds) if (m.pending && recipe.excluded.includes(m.pending.card)) engine.stop(m.pending.program);
    for (const actor of recipe.edge?.stopActors ?? []) { const program=engine.programOf(actor); if (program) engine.stop(program); }
    for (const e of recipe.events) { while (engine.world.tick<e.tick) engine.step(); foldEvent(engine,kernel,e,counts); }
    while (engine.world.tick<recipe.untilTick) engine.step();
    suffix=events.filter(e=>e.seq>repair.seq);
  } else { engine=factory.create(factory.genesis(seed)); kernel=initKernel(engine,pinnedVocabulary(events)); counts={}; }
  let i=0;
  while (engine.world.tick < untilTick) {
    while (i<suffix.length && suffix[i].tick===engine.world.tick) foldEvent(engine,kernel,suffix[i++],counts);
    engine.step();
  }
  if(options.includeHeadEvents)while(i<suffix.length&&suffix[i].tick===untilTick)foldEvent(engine,kernel,suffix[i++],counts);
  kernel.tick=engine.world.tick; sweep(kernel);
  return {engine,kernel,counts};
}

/** Replay the kernel alone from the log: meaning needs no engine. `places` are the genesis anchors. */
export function replayKernel(genesis: KState, events: LogEvent[]): KState {
  const k: KState = structuredClone(genesis); const counts: Record<string, number> = {};
  const pin = pinnedVocabulary(events); if (pin) { k.vocab = { kinds: {}, links: {}, cards: {}, manners: {} }; setVocabulary(k, pin); }
  const noEngine = { world: { entities: {} as Record<string, unknown> }, spawnHuman() { return ''; }, removeEntity() {}, programOf() { return null; }, stop() {}, perform() { return { id: '', ok: true }; } } as unknown as Engine;
  for (const e of events) {
    if (e.kind === 'rules' && e.payload?.recovery) { const r=e.payload.recovery as import('./world.ts').RecoveryRecipe; const restored=replayKernel(r.baseline.kernel!,r.events); Object.assign(k,restored); k.tick=r.untilTick; sweep(k); continue; }
    if (e.kind === 'birth' || e.kind === 'play' || e.kind === 'mint' || e.kind === 'deck' || e.kind === 'retire' || e.kind === 'rules' || e.kind==='mandate' || e.kind==='intent-request-v2' || e.kind==='intent-v2') foldEvent(noEngine, k, e, counts);
  }
  return k;
}
export { kernelHash };
