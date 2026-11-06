// strict/1 (EDGE-CONTRACT-v1 §8.4): an id-shaped target that names nothing in this world is refused, never
// swapped for something else. `walk:eden-pond-north` (no such place) used to resolve to the nearest walkable place
// and "complete". Plain words keep resolving (walk:pond, "walk to the pond", "go for a swim").
import type {WorldState as NativeWorld} from '../../../../../mars/viewer/engine/world/types.ts';
import type {EdgeLedger} from '../ledger/ledger.ts';
import type {EdgeCapability, EdgeSoul} from '../contract.ts';
import {offerParams, paramsProblem, type ParamSchema} from './offer-schema.ts';

/** An id, not words: lower-case, no spaces, at least one of - . _ (e.g. eden-pond-north, region-park.pond, s_123). */
export const ID_SHAPED = /^[a-z0-9]+(?:[-._][a-z0-9]+)+$/;

/** Every id a capability target may name here: capability targets, places, Souls, engine bodies and fixtures,
 *  activity spots, lasting objects, items and invitations. */
export function knownIds(ledger: EdgeLedger, caps: EdgeCapability[]): Set<string> {
  const out = new Set<string>();
  for (const c of caps) {out.add(c.id.slice(c.id.indexOf(':') + 1)); if (c.target) out.add(c.target.id); if (c.object) out.add(c.object);}
  for (const id of ledger.places.byId.keys()) out.add(id);
  for (const m of ledger.host.minds.values()) out.add(m.soulId);
  // the read worker's ledger reads through its MenuWorld facade (`mw`); a bare host (tests mock only `host.engine`) reads the engine
  const world = ((ledger as {mw?: {world: unknown}}).mw?.world ?? ledger.host.engine.world) as NativeWorld;
  for (const id of Object.keys(world.entities)) out.add(id);
  for (const s of ledger.spots.spots) out.add(s.id);
  try {for (const o of ledger.comms?.objects.all() ?? []) out.add(o.id);} catch {/* objects optional */}
  try {for (const i of ledger.together.publicItems()) out.add(i.id);} catch {/* items optional */}
  return out;
}

export type StrictRefusal = {code: string; reason: string; did_you_mean: {id: string; label: string}[]};

/** `verb:<id>` where <id> is id-shaped and names nothing here → a refusal (with the closest offered ids). */
export function strictCheck(ledger: EdgeLedger, soul: EdgeSoul, input: string, caps: EdgeCapability[]): StrictRefusal | null {
  const i = input.indexOf(':'); if (i <= 0) return null;
  const verb = input.slice(0, i).trim().toLowerCase(), target = input.slice(i + 1).trim();
  if (!ID_SHAPED.test(target) || caps.some(c => c.id === input)) return null;
  if (verb === 'accept' || verb === 'decline') return null;          // invitation ids are checked by together/1
  const known = knownIds(ledger, caps); if (known.has(target)) return null;
  // the closest real ids: same verb first, by shared words
  const words = target.split(/[-._]+/).filter(w => w.length > 2 && w !== 'eden');
  const score = (c: EdgeCapability) => (c.verb === verb ? 10 : 0) + (c.target?.kind === 'place' ? 2 : 0) + words.filter(w => (c.id + ' ' + c.label).toLowerCase().includes(w)).length * 3 + (c.available ? 1 : 0);
  const did = caps.filter(c => words.some(w => (c.id + ' ' + c.label).toLowerCase().includes(w)) || c.verb === verb).map(c => ({c, s: score(c)}))
    .sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id)).slice(0, 5).map(({c}) => ({id: c.id, label: c.label}));
  void soul;
  return {code: 'capability.unknown', reason: `"${target}" is not an id in this world (no place, Soul or thing has it), so nothing was done. Use an id from capabilities or the map, or say it in plain words.`, did_you_mean: did};
}

// ------------------------------------------------------------------ CTRL-1 (#1093): strict offers
/** Rollback for one release: `EDGE_FREE_TEXT_ACT=1` lets a strict client's words execute again. The CLI refuses words before
 *  it posts them, so `resolve` tells it the flag is on (`freeTextAct`), and it then posts them. */
export const freeTextAct = () => process.env.EDGE_FREE_TEXT_ACT === '1';
/** An offered id is `<verb>:<target>` with no spaces. */
export const OFFER_ID = /^[a-z][\w-]*:\S+$/i;
/** Attention never touches the body, and its target is any direction or thing in sight (the intent path checks it). */
const ATTENTION_ID = /^(?:look|turn|face|look-at|turn-to):\S+$/i;
/** Ids whose refusal says more than `capability.unknown`: a closed proposal, a shared stop, a named place or seat. */
const ANSWER_ID = /^(?:accept|decline):inv_|^stop-carry:/;
const ON_DEMAND_VERB = /^(?:walk|jog|run|sit)$/;

export type Candidate = {id: string; verb: string; label: string; available: boolean; blocked?: {code: string; reason: string}; params?: ParamSchema; args?: Record<string, unknown>};

/** `resolve`: the words read as ranked offers, each with its schema and availability. It never executes and never chooses;
 *  the first candidate is the parser's reading, and `args` are the values it read from the words. */
export function resolveCandidates(L: EdgeLedger, soul: EdgeSoul, d: Record<string, unknown>, limit = 5): Candidate[] {
  const would = d.would as {capability?: string; label?: string; available?: boolean; params?: Record<string, unknown>} | undefined;
  const ids = [...(typeof would?.capability === 'string' ? [would.capability] : []), ...((d.did_you_mean as {id: string}[] | undefined) ?? []).map(x => x.id)];
  const out: Candidate[] = [];
  for (const id of new Set(ids)) {
    if (out.length >= limit) break;
    const cap = L.bindOne(soul, id)?.cap, first = id === would?.capability, args = first && would?.params && Object.keys(would.params).length ? would.params : undefined;
    const params = cap ? offerParams(cap) : {};
    out.push({id, verb: cap?.verb ?? id.split(':')[0]!, label: cap?.label ?? (first ? would?.label : undefined) ?? id, available: cap?.available ?? (first ? would?.available !== false : true),
      ...(cap?.blocked ? {blocked: cap.blocked} : {}), ...(Object.keys(params).length ? {params} : {}), ...(args ? {args} : {})});
  }
  return out;
}

export type OfferRefusal = {accepted: false; code: string; reason: string; capability: string; did_you_mean?: {id: string; label: string}[]; candidates?: Candidate[]; params?: ParamSchema};

/** A strict act: null when `capability` is an id on offer to this Soul and its params fit, else why not. */
export function offerCheck(L: EdgeLedger, soul: EdgeSoul, input: {capability?: unknown; params?: unknown; verb?: unknown; target?: unknown; clientRef?: unknown}): OfferRefusal | null {
  const asked = typeof input.capability === 'string' ? input.capability.trim() : '';
  if (typeof input.clientRef === 'string' && input.clientRef.length <= 100 && L.coreA.byClientRef(soul.soulId, input.clientRef)) return null;   // a retry returns the first result
  if (OFFER_ID.test(asked)) {
    const verb = asked.slice(0, asked.indexOf(':'));
    if (ATTENTION_ID.test(asked) || ANSWER_ID.test(asked) || L.bodyVerbProblem(soul, verb)) return null;
    const cap = L.bindOne(soul, asked)?.cap ?? L.coreA.binds(soul).caps.find(c => c.id === asked);
    if (cap) {
      const problem = paramsProblem(cap, input.params);
      return problem ? {accepted: false, code: 'capability.params', reason: problem, capability: asked, params: offerParams(cap)} : null;
    }
    // far offers the page leaves out, and places that refuse for a reason of their own: by id only, never by a name
    const target = asked.slice(asked.indexOf(':') + 1);
    if (ON_DEMAND_VERB.test(verb) && knownIds(L, []).has(target)) return null;
  }
  const body = input.capability !== undefined ? {capability: asked, ...(input.params ? {params: input.params} : {})} : input;
  const d = asked || input.verb !== undefined ? L.intents.dryRun(soul, body as Parameters<EdgeLedger['intents']['dryRun']>[1]) : {};
  // an id `resolve` itself reads as this very act is an offer, on or off the menu's page; a candidate is always takeable
  if (OFFER_ID.test(asked) && (d as {would?: {capability?: unknown}}).would?.capability === asked) return null;
  const candidates = resolveCandidates(L, soul, d);
  const label = asked || String(input.verb ?? '');
  return {accepted: false, code: 'capability.unknown', capability: label,
    reason: `"${label}" is not an offer on this Soul right now, so nothing was done. Send an offered id; candidates lists the closest.`,
    ...(candidates.length ? {did_you_mean: candidates.map(c => ({id: c.id, label: c.label})), candidates} : {})};
}
