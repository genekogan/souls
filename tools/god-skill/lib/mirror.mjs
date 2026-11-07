// The world mirror: the god snapshot + a world-frame layout (poses, bounds, solid footprints, slots,
// rooms) cached in .eden-god.cache.json. Every command first asks the server whether the mirror is current (one
// small request); an unchanged seq means the cache is exact and nothing else is fetched. Offline (server
// unreachable) the cache is used as is and the command says so. `follow` keeps it fresh from the god SSE stream.
//
// G2 (mirror/1): a stale mirror is patched, not refetched. GET /v1/god/mirror?since&builds&have&lib answers
// `same`, a delta (changed layout rows and entities, ids gone, small top-level fields, defs/library only when they
// changed) or the whole mirror (the library left out when the client's library hash matches). Every edit (`act`)
// sends the same state and gets the delta back in its answer, so the command after it needs no refetch. The
// guard hash (every id and row/entity hash, in order) checks the patched mirror; any mismatch refreshes in full.
// A server without /v1/god/mirror gets the old snapshot + layout refresh.
//
// G3: the ground recipe goes by hash too (45 of 47 KB per edit at Eden 2026 size): the CLI sends `ground` (the hash the
// server gave with its copy) and a server that has the same recipe answers `groundRef` with `top.ground: null`; the CLI
// puts its copy back in that key. A server before G3 sends no `groundHash` and always the recipe.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { atomicWrite, call, load, ok, writesSent } from './state.mjs';
import { isFlagDef } from './solver.mjs';
import { noticeInboxHeader } from './inbox-notice.mjs';

import { godFile } from './seat.mjs';
export const CACHE = '.eden-god.cache.json';
let memo = null, synced = null, syncedAt = 0, syncedWrites = -1, oldServer = false, speaks = false, trustedRead = false;
/** Was the last mirror() a trusted cache read (no request)? */
export const wasTrusted = () => trustedRead;
/** Did this world answer mirror/1 in this process (so it also takes act `repair`, G2 C)? */
export const speaksMirror = () => speaks && !oldServer;

function readCache() { try { return existsSync(godFile(CACHE)) ? JSON.parse(readFileSync(godFile(CACHE), 'utf8')) : null; } catch { return null; } }
function writeCache(c) { try { atomicWrite(godFile(CACHE), JSON.stringify(c)); } catch { /* read-only folder: memory only */ } }

/** Same function as the server's (apps/server/src/god/mirror.ts). */
export const mirrorHash = (s) => createHash('sha1').update(s).digest('base64url').slice(0, 16);
const guardOf = (rows, ents, hr, he, defs) => mirrorHash(`${rows.map((r) => `${r.id}:${hr[r.id]}`).join(',')}|${ents.map((e) => `${e.id}:${he[e.id]}`).join(',')}|${defs}`);

/** What this folder's mirror is, for the server: { since, builds, have, lib, ground? } (null: no mirror to patch). */
export function mirrorState(world = load().world) {
  const m = memo?.world === world ? memo : readCache();
  if (!m || m.world !== world || !m.guard) return null;
  return { since: m.seq, builds: m.buildsRev, have: m.guard, lib: m.libraryHash, ...(m.groundHash ? { ground: m.groundHash } : {}) };
}

/** Patch `base` with a mirror/1 payload; null when the result does not match the server's guard. */
export function applyMirror(base, p, world) {
  if (!p || p.contract !== 'mirror/1' || p.same) return null;
  const library = p.library ?? (base?.libraryHash === p.libraryHash ? base.snapshot.library : undefined);
  if (!library) return null;
  let top = p.top;
  if (p.groundRef) { // G3: the server kept the recipe the client said it has
    if (!p.groundHash || base?.groundHash !== p.groundHash || !Object.hasOwn(base.snapshot, 'ground')) return null;
    top = { ...p.top, ground: base.snapshot.ground };
  }
  const gs = p.groundHash ? { groundHash: p.groundHash } : {};
  let entities, rows, defs, he, hr;
  if (p.full) {
    ({ entities, rows, defs } = p); he = {}; hr = {};
    for (const e of entities) he[e.id] = mirrorHash(JSON.stringify(e));
    for (const r of rows) hr[r.id] = mirrorHash(JSON.stringify(r));
  } else {
    if (!base?.h || base.guard !== p.since) return null;
    he = { ...base.h.ents }; hr = { ...base.h.rows };
    // `tail`: ids that go to the end in this order (rows: the model's insertion order); the others keep their place
    const patch = (list, changed, gone, hs, tail = []) => {
      const drop = new Set([...gone, ...tail]), by = new Map(changed.map((x) => [x.id, x])), had = new Map(list.map((x) => [x.id, x])), out = [];
      for (const id of gone) delete hs[id];
      for (const x of list) if (!drop.has(x.id)) { out.push(by.get(x.id) ?? x); by.delete(x.id); }
      for (const id of tail) { const y = by.get(id) ?? had.get(id); if (y) out.push(y); by.delete(id); }
      out.push(...by.values());
      for (const x of changed) hs[x.id] = mirrorHash(JSON.stringify(x));
      return out;
    };
    entities = patch(base.snapshot.entities, p.entities, p.entitiesGone, he).sort((a, b) => (a.id < b.id ? -1 : 1)); // the server's snapshot order
    rows = patch(base.rows, p.rows, p.rowsGone, hr, p.rowsTail);
    defs = p.defs ?? base.snapshot.defs;
  }
  const defsH = p.defs || p.full ? mirrorHash(JSON.stringify(defs)) : base.h.defs;
  const guard = guardOf(rows, entities, hr, he, defsH);
  if (guard !== p.guard) return p.full ? build(world, { ...top, entities, defs, library }, rows, { libraryHash: p.libraryHash }) : null; // whole but unverifiable: no deltas
  return build(world, { ...top, entities, defs, library }, rows, { guard, libraryHash: p.libraryHash, ...gs, h: { rows: hr, ents: he, defs: defsH } });
}

async function fetchMirror(q) {
  const qs = Object.entries(q).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return call(`/v1/god/mirror${qs ? '?' + qs : ''}`, { timeoutMs: 60_000 });
}

/** The mirror, fresh unless the server is unreachable. `{ fresh: true }` refetches regardless (the library only when
 *  it changed). */
export async function mirror({ fresh = false, trust = false } = {}) {
  const world = load().world;
  if (trust && !fresh) { // G2: a caller that checks the seq itself (place: act ifSeq) takes a mirror/1 cache without a request
    const c = memo?.world === world ? memo : readCache();
    if (c?.world === world && c.guard) { memo = c; speaks = true; trustedRead = true; return c; }
  }
  trustedRead = false;
  // checked (or patched by this process's own edit) a moment ago in this command: no second request
  if (!fresh && synced && synced === memo && memo.world === world && Date.now() - syncedAt < 2000 && syncedWrites === writesSent()) return memo;
  const cached = memo?.world === world ? memo : readCache(), base = cached?.world === world ? cached : null;
  if (!oldServer) {
    const r = await fetchMirror(fresh || !base ? { lib: base?.libraryHash, ground: base?.groundHash } : { since: base.seq, builds: base.buildsRev, have: base.guard, lib: base.libraryHash, ground: base.groundHash });
    if (r.status === 0) oldServer = 'maybe'; // unreachable, or a server that fails the route: the seq request below decides
    else if (r.data?.contract !== 'mirror/1' && (r.status === 404 || (r.status >= 200 && r.status < 300))) oldServer = true; // a server before mirror/1
    else {
      const p = ok(r, 'mirror'); speaks = true;
      if (p.same && base) { memo = base; synced = base; syncedAt = Date.now(); syncedWrites = writesSent(); return base; }
      let m = applyMirror(base, p, world);
      if (!m) m = applyMirror(null, ok(await fetchMirror({}), 'mirror'), world); // drift or a lost library: the whole mirror once
      if (!m) throw new Error('mirror: the server sent a mirror this CLI cannot read; run `mirror --fresh`');
      memo = m; synced = m; syncedAt = Date.now(); syncedWrites = writesSent(); writeCache(m); return m;
    }
  }
  if (memo && memo.world === world && !fresh) {
    const s = await call('/v1/world/seq', { as: 'none', timeoutMs: 5000 });
    if (s.status === 0) return { ...memo, offline: true };
    if (s.data.seq === memo.seq && s.data.builds === memo.buildsRev) return memo;
  }
  const seqR = await call('/v1/world/seq', { as: 'none', timeoutMs: 5000 });
  if (oldServer === 'maybe') oldServer = seqR.status !== 0;
  if (seqR.status === 0) {
    if (base) { memo = base; return { ...base, offline: true }; }
    throw new Error(`world unreachable (${seqR.data.message}) and no cached mirror`);
  }
  if (!fresh && base && base.seq === seqR.data.seq && base.buildsRev === seqR.data.builds) { memo = base; return base; }
  const [snap, lay] = await Promise.all([call('/v1/god/snapshot'), call('/v1/god/query', { body: { layout: { obbs: true } } })]);
  const snapshot = ok(snap, 'snapshot'), layout = ok(lay, 'layout').layout;
  memo = build(world, snapshot, layout.entities);
  writeCache(memo);
  return memo;
}
/** An edit's answer carried the mirror delta (`act` sent mirrorState()): adopt it, so the next read needs no request. */
export function adoptMirror(p, held = null) {
  // `held`: the mirror this process held when it sent the edit (the one its `mirror` state described); reading the
  // cache file again would cost a 7+ MB JSON parse per edit at Eden 2026 size (GODPLACE, ~100 ms of a ~280 ms place)
  const world = load().world, base = held?.world === world ? held : memo?.world === world ? memo : readCache();
  const m = applyMirror(base?.world === world ? base : null, p, world);
  if (!m) return false;
  memo = m; synced = m; syncedAt = Date.now(); syncedWrites = writesSent(); writeCache(m); return true;
}
/** The mirror this process holds in memory (null: none read yet). */
export const heldMirror = () => memo;
export function invalidate() { memo = null; synced = null; }

function build(world, snapshot, rows, sync) {
  return { world, seq: snapshot.seq, buildsRev: snapshot.buildsRev, at: Date.now(), extent: snapshot.constants.extent, snapshot, rows, ...(sync ?? {}) };
}

/** Index helpers over a mirror. */
export function view(m) {
  const byId = new Map(m.rows.map((r) => [r.id, r]));
  const byPath = new Map(m.rows.map((r) => [r.path, r]));
  const lib = new Map();
  // The god library carries active named revisions; in-use defs can also contain older hash-pinned content.
  for (const d of [...(m.snapshot.defs ?? []), ...(m.snapshot.library ?? [])]) { lib.set('sha:' + d.hash, d); lib.set(d.ref, d); if (d.ref.startsWith('core-')) lib.set('core/' + d.ref.slice(5), d); }
  const get = (ref) => {
    if (!ref) return null;
    const r = String(ref).replace(/^flag:/, '');
    return byId.get(r) ?? byPath.get(r) ?? m.rows.find((x) => x.name === r && x.parent === m.rows.find((p) => p.id === x.parent)?.id) ?? m.rows.find((x) => x.name === r) ?? m.rows.find((x) => isFlagDef(lib.get(x.def)?.ref ?? x.def) && m.snapshot.entities.find((e) => e.id === x.id)?.state?.label === r) ?? null;
  };
  const entity = (id) => m.snapshot.entities.find((e) => e.id === id) ?? null;
  const children = (id) => m.rows.filter((r) => r.parent === id);
  const def = (ref) => lib.get(ref) ?? lib.get(normDef(ref)) ?? null;
  const refs = [...new Set([...(m.snapshot.defs ?? []), ...(m.snapshot.library ?? [])].map((d) => d.ref).filter(Boolean))];
  return { m, rows: m.rows, byId, byPath, get, entity, children, def, refs, extent: m.extent };
}
export const normDef = (d) => (d.includes('@') || d.startsWith('sha:') ? d : `core/${d}@1`);
/** An unknown def ref that names exactly one library def (harvest P0 #8): `core/<local>@k` → `<local>@k`, `<name>` (no
 *  version) → its only version, `<name>@k` → `core/<name>@k`. Returns the library ref, or null when the ref is known,
 *  unknown, or ambiguous (several versions/namespaces), so the caller refuses as before. */
export function resolveDef(v, ref) {
  const s = String(ref ?? '').trim();
  if (!s || s.startsWith('sha:') || v.def(s)) return null;
  const m = /^(?:core[/-])?([a-z0-9][a-z0-9._-]*?)(?:@(\d+))?$/i.exec(s); if (!m) return null;
  const [, name, ver] = m, hits = new Set();
  for (const r of v.refs ?? []) {
    const d = /^(core[/-])?(.+)@(\d+)$/.exec(r);
    if (d && d[2] === name && (!ver || d[3] === ver)) hits.add(d[1] ? `core/${d[2]}@${d[3]}` : r);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/** follow [seconds]: keep the mirror fresh from the god stream (refetch on every diff). */
export async function follow(seconds = 3600, onEvent = () => {}) {
  const s = load();
  const r = await fetch(s.world + '/v1/god/stream', { headers: { authorization: `Bearer ${s.token}`, accept: 'text/event-stream' }, signal: AbortSignal.timeout(seconds * 1000) });
  noticeInboxHeader(r.headers);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2); if (frame.startsWith(':')) continue;
        const ev = /^event: (.*)$/m.exec(frame)?.[1], data = /^data: (.*)$/m.exec(frame)?.[1];
        if (ev === 'diff') { invalidate(); await mirror({ fresh: true }); }
        if (ev) onEvent({ event: ev, data: data ? JSON.parse(data) : null });
      }
    }
  } catch { /* timeout or closed */ }
  return { ended: true };
}
