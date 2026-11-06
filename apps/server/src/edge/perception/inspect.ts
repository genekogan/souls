// CTRL-2 (#1094): one recursive read for any id: what it is, its state, what is in it, and the offers on it with their
// schemas. Nothing here knows a kind of object: facts come from the same source `here` reads, offers from the menu.
import type {EdgeLedger} from '../ledger/ledger.ts';
import {EdgeError, type EdgeCapability, type EdgeSoul} from '../contract.ts';
import {offerParams, type ParamSchema} from '../intents/offer-schema.ts';

type Child = {id: string; kind: string; name: string};
type Offer = {id: string; verb: string; label: string; available: boolean; why?: string; params?: ParamSchema};
export type Inspected = {id: string; kind: string; name: string; state?: Record<string, unknown>; parts?: Child[]; contents?: Child[]; offers: Offer[]; more?: {parts?: number; contents?: number; offers?: number}};

export const INSPECT_BYTES = 4096;
const unknown = (id: string) => new EdgeError(404, 'capability.unknown', `"${id}" is not an id this Soul knows. Ids come from here, caps and resolve.`);
const on = (c: EdgeCapability, id: string) => c.target?.id === id || c.object === id || c.id.slice(c.id.indexOf(':') + 1) === id;
const offerOf = (c: EdgeCapability): Offer => {const params = offerParams(c); return {id: c.id, verb: c.verb, label: c.label, available: c.available, ...(c.blocked ? {why: c.blocked.reason} : {}), ...(Object.keys(params).length ? {params} : {})};};

/** The thing's identity and children, or null. Only what this Soul may know: a secret place is unknown until found. */
function identify(L: EdgeLedger, soul: EdgeSoul, id: string, caps: EdgeCapability[]): Omit<Inspected, 'offers' | 'more'> | null {
  const place = L.places.byId.get(id);
  if (place) {
    if (!L.knowledge.knows(soul.soulId, id)) return null;
    const parts = [...L.places.byId.values()].filter(p => p.parent === id && L.knowledge.knows(soul.soulId, p.id)).map(p => ({id: p.id, kind: p.kind, name: p.name}));
    return {id, kind: 'place', name: place.name, ...(parts.length ? {parts} : {})};
  }
  const mind = L.host.minds.get(id);
  if (mind) return {id, kind: 'soul', name: mind.name, state: L.publicSoul(id) as Record<string, unknown>};
  const item = L.together.publicItems().find(i => i.id === id);
  const world = L.host.engine.world as {entities: Record<string, {tags?: string[]; support?: {on?: string; by?: string}; name?: string}>};
  const object = L.comms?.objects.all().find(o => o.id === id);
  const entity = world.entities[id];
  if (!item && !object && !entity && !caps.some(c => on(c, id))) return null;
  const facts = L.contactActuator?.facts(id, soul) ?? null;
  // a part's offers target its parent entity, so its own name is the one its offer label gives ("Sit at Audience Bench [ref]")
  const labelled = caps.find(c => on(c, id))?.label.match(/\bat ([^[]+?) \[/)?.[1] ?? caps.find(c => on(c, id))?.label.match(/^Walk to ([^[]+?) \[/)?.[1];
  const name = item?.name ?? (object as {name?: string} | undefined)?.name ?? entity?.name ?? labelled ?? caps.find(c => on(c, id))?.label ?? id;
  const contents = Object.entries(world.entities).filter(([, e]) => e.support?.on === id).map(([cid, e]) => ({id: cid, kind: 'item', name: L.together.publicItems().find(i => i.id === cid)?.name ?? e.name ?? cid}));
  return {id, kind: item ? 'item' : id.includes('/') ? 'part' : 'object', name, ...(facts && Object.keys(facts).length ? {state: facts} : {}), ...(contents.length ? {contents} : {})};
}

/** `GET /v1/edge/inspect/:id`: at most INSPECT_BYTES unless `all`, with `more` counting what was left out. */
export function inspectFrame(L: EdgeLedger, soul: EdgeSoul, id: string, opts: {all?: boolean} = {}): Inspected {
  const caps = L.coreA.binds(soul).caps, who = identify(L, soul, id, caps);
  if (!who) throw unknown(id);
  const out: Inspected = {...who, offers: caps.filter(c => on(c, id)).map(offerOf)};
  if (opts.all) return out;
  const more: NonNullable<Inspected['more']> = {};
  const cut = (key: 'offers' | 'contents' | 'parts') => {
    const list = out[key] as unknown[] | undefined; if (!list) return;
    let n = 0;
    while (list.length > 1 && Buffer.byteLength(JSON.stringify(out)) > INSPECT_BYTES) {list.pop(); n++;}
    if (n) more[key] = n;
  };
  cut('contents'); cut('parts'); cut('offers');
  return Object.keys(more).length ? {...out, more} : out;
}
