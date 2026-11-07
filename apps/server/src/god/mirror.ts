// G2 (tranche 2026-10-19): the CLI's world mirror as deltas.
//
// The CLI keeps a mirror: the god snapshot plus the layout rows (query `layout`). It used to refetch both after
// every edit and whenever the seq moved: ~320 KB gzip per edit in a small world, 1.6 MB of it the library.
// Here the server remembers, for the last few mirror states it handed out, a hash per layout row and per snapshot
// entity, and answers "what changed since the state with this guard hash" with only the changed rows/entities, the
// ids that went, the small top-level fields, the in-use defs only when they changed, and the library only when the
// client's library hash differs. The guard hash (over every id and row/entity hash, in order) lets the client check
// its patched mirror against the server's and refresh in full on any mismatch. The diff is by content, so
// neighbours that an edit touched (slot use, a parent's children) come along without knowing why they changed.
//
// Rows and entity hashes are cached (G2 row cache, follow-up): an act at Eden 2026 size (4,900 entities) used to lay out
// and hash every row again (~80 ms). A row is reused while everything it reads is unchanged (see `layoutRow` in
// query.ts); the check per entity is a few identity comparisons, so an act's delta costs what changed, not the world.
// Model entities are replaced, never changed in place, by every edit (compile.ts), so an entity's own inputs are its
// object identity.
//
// G3: the ground recipe (45 of 47 KB per act at Eden 2026 size) goes by hash, like the library: every answer names
// `groundHash`; a client that sends the same hash (`ground`) gets `top.ground: null` and `groundRef: true` and keeps its
// copy. Clients that send no hash (CLIs before G3) get the recipe as before.
import { createHash } from 'node:crypto';
import type { Entity, WorldModel } from '@souls/world-compiler';
import type { GodMode } from './god.ts';
import { layoutRow, seatProviders } from './query.ts';

export type MirrorWant = { since?: number; builds?: number; have?: string; lib?: string; ground?: string };
type State = { guard: string; seq: number; rows: Map<string, string>; ents: Map<string, string>; defs: string; order: string[] };
const KEEP = 16;
const memo = new WeakMap<object, State[]>();
/** Same function as the CLI's (tools/god-skill/lib/mirror.mjs): sha1, base64url, 16 chars. */
export const mirrorHash = (s: string) => createHash('sha1').update(s).digest('base64url').slice(0, 16);
const guardOf = (rows: [string, string][], ents: [string, string][], defs: string) =>
  mirrorHash(`${rows.map(([id, h]) => `${id}:${h}`).join(',')}|${ents.map(([id, h]) => `${id}:${h}`).join(',')}|${defs}`);

/** The library's identity: the shared library's id@version plus the world's own named defs (content-hashed). A library
 *  def the world adopted on first use is the same def (and the same object): it does not change the identity, so the
 *  client keeps its copy (only the list order differs, which no reader depends on). */
export function libraryHash(god: GodMode) {
  const m = god.model, own = [...m.defs.keys()].filter((k) => !k.startsWith('sha:') && m.library?.get(m.defs.get(k)!.ref) !== m.defs.get(k)).map((k) => `${k}:${m.defs.get(k)!.hash}`);
  return mirrorHash(`${m.library ? `${m.library.id}@${m.library.version}` : '-'}|${own.join(',')}`);
}

/** Is the client's mirror current (same edit seq and builds revision: the rule GET /v1/world/seq gave the CLI)? Cheap. */
export const mirrorCurrent = (god: GodMode, want: MirrorWant) => want.since === god.model.editSeq && want.builds === god.builds.publicList().rev;

/** The mirror for a client that has `want` (or nothing): a delta when the server still knows the client's state,
 *  else the whole mirror (without the library when the client's library hash matches). `child`: a helper token
 *  (no prayers, as in GET /v1/god/snapshot). */
export function mirrorPayload(god: GodMode, want: MirrorWant = {}, { child = false } = {}) {
  const lib = libraryHash(god), withLib = want.lib !== lib;
  const snap = god.godSnapshotOf(withLib) as Record<string, unknown> & { entities: { id: string }[]; defs: unknown[]; library?: unknown[] };
  if (child) snap.prayers = [];
  const { rows, rowH } = layoutRows(god);
  const entH: [string, string][] = snap.entities.map((e) => [e.id, entityHash(e)]);
  const defsH = defsHash(god, snap.defs);
  const guard = guardOf(rowH, entH, defsH);
  const states = memo.get(god) ?? [];
  const base = want.have ? states.find((s) => s.guard === want.have) : undefined;
  const now: State = { guard, seq: snap.seq as number, rows: new Map(rowH), ents: new Map(entH), defs: defsH, order: rowH.map(([id]) => id) };
  if (!states.some((s) => s.guard === guard)) { states.push(now); if (states.length > KEEP) states.shift(); memo.set(god, states); }
  const { entities, defs, library, ...top } = snap;
  const gh = groundHash(top.ground), groundRef = want.ground !== undefined && want.ground === gh;
  if (groundRef) top.ground = null; // same key, same place: the client puts its copy back where it was
  const head = { contract: 'mirror/1', seq: snap.seq, buildsRev: snap.buildsRev, guard, libraryHash: lib, groundHash: gh, ...(groundRef ? { groundRef: true } : {}), ...(withLib ? { library } : {}) };
  if (!base) return { ...head, full: true, top, entities, defs, rows };
  const changed = <T extends { id: string }>(list: T[], hs: [string, string][], was: Map<string, string>) => list.filter((x, i) => was.get(x.id) !== hs[i][1]);
  const gone = (was: Map<string, string>, is: Map<string, string>) => [...was.keys()].filter((id) => !is.has(id));
  // Row order is the model's insertion order: an entity an edit replaced moves to the end. `rowsTail` is the shortest
  // suffix of the current order after which the rest is in the client's order: the client keeps its other rows where
  // they are and appends these (changed or not) in this order.
  const pos = new Map(base.order.map((id, i) => [id, i])), ids = now.order;
  let q = 0; for (let last = -1; q < ids.length; q++) { const p = pos.get(ids[q]); if (p === undefined || p <= last) break; last = p; }
  return {
    ...head, full: false, since: base.guard, top, rowsTail: ids.slice(q),
    entities: changed(entities, entH, base.ents), entitiesGone: gone(base.ents, now.ents),
    rows: changed(rows, rowH, base.rows), rowsGone: gone(base.rows, now.rows),
    ...(defsH !== base.defs ? { defs } : {}),
  };
}

// ---------------------------------------------------------------- row cache

/** A cached layout row and what it was computed from. `chain`: the entity's effective def identity, then each ancestor
 *  and its def identity (pose, path and slot frames come from them; a missing parent ends it as undefined). `ground`:
 *  the terrain recipe its world-frame colliders were sampled on (solid root shapes only). `uses`: which slots its
 *  children hang in and which seats Souls sit on (things with rooms or slots only). */
type RowEntry = { e: Entity; chain: unknown[]; ground?: object; uses?: string; seats: boolean; row: Record<string, unknown>; hash: string };
const rowCaches = new WeakMap<object, Map<string, RowEntry>>();
const entityHashes = new WeakMap<object, string>();
/** The last layoutRows call: rows laid out again (the rest were reused) and rows in all. */
export const rowCacheStats = { recomputed: 0, rows: 0 };
const MAX_ROWS = 20000;   // query.ts layout's default cap (the mirror asked for the default)

/** The in-use defs' hash; the same def objects in the same order (publicDef is per stored def) keep the last one's. */
const defsHashes = new WeakMap<object, { defs: unknown[]; h: string }>();
function defsHash(god: GodMode, defs: unknown[]) {
  const was = defsHashes.get(god);
  if (was && was.defs.length === defs.length && was.defs.every((d, i) => d === defs[i])) return was.h;
  const h = mirrorHash(JSON.stringify(defs)); defsHashes.set(god, { defs, h }); return h;
}
/** The ground recipe's hash (as sent: JSON), per recipe object; the model keeps the object until the terrain changes. */
const groundHashes = new WeakMap<object, string>();
let lastGroundHashed: { g: object; h: string } | null = null;
export function groundHash(g: unknown) {
  if (!g || typeof g !== 'object') return mirrorHash(JSON.stringify(g ?? null));
  let h = groundHashes.get(g);
  if (h === undefined) {
    // an edit that rebuilt the recipe from the same parts in the same key order (see layoutRows): the same JSON, the same hash
    const was = lastGroundHashed?.g, ka = was && Object.keys(was), kb = Object.keys(g);
    h = was && sameGround(was, g) && ka!.every((k, i) => k === kb[i]) ? lastGroundHashed!.h : mirrorHash(JSON.stringify(g));
    groundHashes.set(g, h);
  }
  lastGroundHashed = { g, h };
  return h;
}
/** An entity's snapshot hash, per entity object (an edit replaces the object). */
export function entityHash(e: { id: string }) {
  let h = entityHashes.get(e);
  if (h === undefined) { h = mirrorHash(JSON.stringify(e)); entityHashes.set(e, h); }
  return h;
}

const lastGround = new WeakMap<object, object>();
/** Same terrain recipe: every field the same value, arrays (landforms, waters) the same items in the same order. */
function sameGround(a: object, b: object): boolean {
  if (a === b) return true;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.hasOwn(b, k)) return false;
    const x = (a as Record<string, unknown>)[k], y = (b as Record<string, unknown>)[k];
    if (x === y) continue;
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length || x.some((v, i) => v !== y[i])) return false;
  }
  return true;
}
function chainOf(w: WorldModel, e: Entity, did: (ref: string) => string): unknown[] {
  const out: unknown[] = [did(e.def)];
  for (let cur = e; cur.in.parent !== 'world';) { const p = w.entities.get(cur.in.parent); out.push(p); if (!p) break; out.push(did(p.def)); cur = p; }
  return out;
}
function chainSame(w: WorldModel, e: Entity, chain: unknown[], did: (ref: string) => string): boolean {
  if (chain[0] !== did(e.def)) return false;
  let i = 1;
  for (let cur = e; cur.in.parent !== 'world';) { const p = w.entities.get(cur.in.parent); if (chain[i++] !== p) return false; if (!p) break; if (chain[i++] !== did(p.def)) return false; cur = p; }
  return i === chain.length;
}
/** What a thing's slot rows read besides its own bake: its children's slots and the Souls on its seats. */
function usesOf(w: WorldModel, e: Entity, seats: boolean): string {
  let s = '';
  const kids = w.children.get(e.id);
  if (kids) for (const c of kids) { const k = w.entities.get(c); if (k) s += `${k.in.slot ?? ''}\u0001`; }
  if (seats) { const f = seatProviders.get(w); if (f) for (const x of f(e.id)) s += `\u0002${x.slot}`; }
  return s;
}

/** The layout rows (exactly query.ts `layout` with obbs, every entity) and their hashes, reusing each cached row whose
 *  inputs are unchanged. `fresh`: ignore the cache (tests compare against it). */
export function layoutRows(god: GodMode, { fresh = false } = {}) {
  const w = god.model, was = fresh ? undefined : rowCaches.get(god), now = new Map<string, RowEntry>();
  // removing or moving anything rebuilds the ground recipe with the same parts: still the same terrain
  const last = was && lastGround.get(god), ground = last && sameGround(last, w.terrain.ground) ? last : w.terrain.ground;
  if (!fresh) lastGround.set(god, ground);
  const ids = new Map<string, string>(), did = (ref: string) => w.effectiveDefIdentity(ref, ids);
  const rows: (Record<string, unknown> & { id: string })[] = [], rowH: [string, string][] = [];
  let recomputed = 0;
  w.readPass(() => {
    for (const e of w.entities.values()) {
      if (rows.length >= MAX_ROWS) break;
      let c = was?.get(e.id);
      if (!(c && c.e === e && (c.ground === undefined || c.ground === ground) && chainSame(w, e, c.chain, did) && (c.uses === undefined || c.uses === usesOf(w, e, c.seats)))) {
        const r = layoutRow(w, e, true); if (!r) continue;
        recomputed++;
        const slotted = !!(r.baked.rooms?.length || r.baked.slots.length), seats = r.baked.slots.some((s) => s.kind === 'seat');
        c = { e, chain: chainOf(w, e, did), ...(e.in.parent === 'world' && r.def.layer === 'solid' && r.def.form !== 'point' ? { ground } : {}), ...(slotted ? { uses: usesOf(w, e, seats) } : {}), seats, row: r.row, hash: mirrorHash(JSON.stringify(r.row)) };
      }
      now.set(e.id, c); rows.push(c.row as Record<string, unknown> & { id: string }); rowH.push([e.id, c.hash]);
    }
  });
  if (!fresh) rowCaches.set(god, now);
  rowCacheStats.recomputed = recomputed; rowCacheStats.rows = rows.length;
  return { rows, rowH };
}
