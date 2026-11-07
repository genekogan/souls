// CTRL-2 (#1094): one recursive read for any id: what it is, its state, what is in it, and the offers on it with their
// schemas. Nothing here knows a kind of object: facts come from the same source `here` reads, offers from the menu.
import type {EdgeLedger} from '../ledger/ledger.ts';
import {EdgeError, type EdgeCapability, type EdgeSoul} from '../contract.ts';
import {offerParams, type ParamSchema} from '../intents/offer-schema.ts';

type Child = {id: string; kind: string; name: string};
type Member = {soulId: string; name: string; role: string; slot: number | null; accepted: boolean; answer?: string; ready?: boolean; why?: string};
type Offer = {id: string; verb: string; label: string; available: boolean; why?: string; params?: ParamSchema};
export type Inspected = {id: string; kind: string; name: string; state?: Record<string, unknown>; parts?: Child[]; contents?: Child[]; members?: Member[]; offers: Offer[]; more?: {parts?: number; contents?: number; offers?: number}};

export const INSPECT_BYTES = 4096;
/** What a place lists before the byte budget: the nearest; `more` still counts the rest. */
const PLACE_CONTENTS = 200;
/** Room kept for the `more` counts themselves. */
const MORE_BYTES = 64;
const unknown = (id: string) => new EdgeError(404, 'capability.unknown', `"${id}" is not an id this Soul knows. Ids come from here, caps and resolve.`);
const on = (c: EdgeCapability, id: string) => c.target?.id === id || c.object === id || c.id.slice(c.id.indexOf(':') + 1) === id;
const offerOf = (c: EdgeCapability): Offer => {const params = offerParams(c); return {id: c.id, verb: c.verb, label: c.label, available: c.available, ...(c.blocked ? {why: c.blocked.reason} : {}), ...(Object.keys(params).length ? {params} : {})};};

const partName = (c?: EdgeCapability) => c?.label.match(/\bat ([^[]+?) \[/)?.[1] ?? c?.label.match(/^Walk to ([^[]+?) \[/)?.[1];

/** The thing's identity and children, or null. Only what this Soul may know: a secret place is unknown until found. */
function identify(L: EdgeLedger, soul: EdgeSoul, id: string, caps: EdgeCapability[]): (Omit<Inspected, 'offers' | 'more'> & {cutOff?: number}) | null {
  const world = L.host.engine.world as {entities: Record<string, {tags?: string[]; human?: unknown; pose?: {p: number[]}; def?: string; support?: {kind?: string; on?: string; by?: string}; name?: string}>};
  const child = (cid: string, e: {name?: string}): Child => {const item = L.together.publicItems().find(i => i.id === cid); return {id: cid, kind: item ? 'item' : 'object', name: item?.name ?? L.thingName?.(cid) ?? e.name ?? cid};};
  const place = L.places.byId.get(id);
  if (place) {
    if (!L.knowledge.knows(soul.soulId, id)) return null;
    const parts = [...L.places.byId.values()].filter(p => p.parent === id && L.knowledge.knows(soul.soulId, p.id)).map(p => ({id: p.id, kind: p.kind, name: p.name}));
    // what stands in it, nearest first: bodies and things resting on another thing are not its own (they are that thing's),
    // and what stands inside a secret place this Soul has not found gives that place away
    const me = world.entities[soul.entityId]?.pose?.p, away = (p: number[]) => me ? Math.hypot(p[0]! - me[0]!, p[2]! - me[2]!) : 0;
    const standing = Object.entries(world.entities)
      .filter(([cid, e]) => e.pose && e.def && !e.human && !e.support?.on && e.support?.kind !== 'in-hand' && !L.concealedThing?.(cid) && (() => {const at = L.places.containing(e.pose!.p[0]!, e.pose!.p[2]!, 0); return at.some(p => p.id === id) && at.every(p => L.knowledge.knows(soul.soulId, p.id));})())
      .sort(([, a], [, b]) => away(a.pose!.p) - away(b.pose!.p));
    const contents = standing.slice(0, PLACE_CONTENTS).map(([cid, e]) => child(cid, e));
    return {id, kind: 'place', name: place.name, ...(parts.length ? {parts} : {}), ...(contents.length ? {contents} : {}), ...(standing.length > PLACE_CONTENTS ? {cutOff: standing.length - PLACE_CONTENTS} : {})};
  }
  const mind = L.host.minds.get(id);
  if (mind) {
    // public facts only: not its receipts, its events or where it is, which may be a place this Soul has not found
    const seen = L.publicSoul(id) as {soul?: {description?: string | null}; now?: unknown; self?: {activity?: string; doing?: unknown} | null};
    return {id, kind: 'soul', name: mind.name, state: {...(seen.soul?.description ? {description: seen.soul.description, untrusted: true} : {}), ...(seen.now ? {now: seen.now} : {}), ...(seen.self ? {activity: seen.self.activity} : {})}};
  }
  if (L.concealedThing?.(id)) return null;
  const item = L.together.publicItems().find(i => i.id === id);
  const object = L.comms?.objects.all().find(o => o.id === id);
  const entity = world.entities[id];
  // a thing inside a secret place this Soul has not found is as unknown as the place, whether or not it has a body here
  const pos = entity?.pose?.p, within = pos ? L.places.containing(pos[0]!, pos[2]!, 0) : [];
  const partOf = id.includes('/') ? L.places.byId.get(id.slice(0, id.indexOf('/'))) : undefined;
  if (within.some(p => !L.knowledge.knows(soul.soulId, p.id)) || (partOf && !L.knowledge.knows(soul.soulId, partOf.id))) return null;
  if (!item && !object && !entity && !caps.some(c => on(c, id))) return null;
  const facts = L.contactActuator?.facts(id, soul) ?? null;
  // a part's offers target its parent entity, so its own name is the one its offer label gives ("Sit at Audience Bench [ref]")
  const labelled = partName(caps.find(c => on(c, id)));
  const name = item?.name ?? (object as {name?: string} | undefined)?.name ?? L.thingName?.(id) ?? entity?.name ?? labelled ?? caps.find(c => on(c, id))?.label ?? id;
  // what rests on it, except what its container keeps out of sight (a shut drawer, a hiding place)
  const contents = Object.entries(world.entities).filter(([cid, e]) => e.support?.on === id && !L.concealedThing?.(cid)).map(([cid, e]) => ({...child(cid, e), kind: 'item'}));
  // its parts are the ids its offers name under it (`cottage/part-outdoor-bench`), so a drill goes on from here
  const seen = new Map<string, Child>();
  for (const c of caps) {
    const tail = c.id.slice(c.id.indexOf(':') + 1);
    if (tail.startsWith(id + '/') && !seen.has(tail)) seen.set(tail, {id: tail, kind: 'part', name: partName(c) ?? tail});
  }
  const parts = [...seen.values()];
  return {id, kind: item || entity?.support?.on || caps.some(c => c.verb === 'pick-up' && on(c, id)) ? 'item' : id.includes('/') ? 'part' : 'object', name, ...(facts && Object.keys(facts).length ? {state: facts} : {}), ...(parts.length ? {parts} : {}), ...(contents.length ? {contents} : {})};
}

/** `GET /v1/edge/inspect/:id`: at most INSPECT_BYTES unless `all`, with `more` counting what was left out. */
export function inspectFrame(L: EdgeLedger, soul: EdgeSoul, id: string, opts: {all?: boolean} = {}): Inspected {
  const caps = L.coreA.binds(soul).caps, shared = L.together.sharedView(id, soul.soulId), project = L.projects?.view(id, soul) ?? null;
  // a shared operation's offers name its invitation or operation; the host's amend is the carry-with on its load
  const offersOn = shared
    ? caps.filter(c => {const tail = c.id.slice(c.id.indexOf(':') + 1); return tail === shared.id || tail === shared.op || (c.verb === 'carry-with' && tail === shared.load);})
    : caps.filter(c => on(c, id));
  const {cutOff = 0, ...who}: Omit<Inspected, 'offers' | 'more'> & {cutOff?: number} = project ?? (shared ? {id: shared.id, kind: 'shared', name: shared.name, state: shared.state, members: shared.members} : null) ?? identify(L, soul, id, caps) ?? (() => {throw unknown(id);})();
  const out: Inspected = {...who, offers: offersOn.map(offerOf)};
  if (opts.all) return out;
  const more: NonNullable<Inspected['more']> = {};
  const cut = (key: 'offers' | 'contents' | 'parts') => {
    const list = out[key] as unknown[] | undefined; if (!list) return;
    let n = 0;
    while (list.length > 1 && Buffer.byteLength(JSON.stringify(out)) > INSPECT_BYTES - MORE_BYTES) {list.pop(); n++;}
    if (n) more[key] = n;
  };
  cut('contents'); cut('parts'); cut('offers');
  if (cutOff) more.contents = (more.contents ?? 0) + cutOff;
  return Object.keys(more).length ? {...out, more} : out;
}
