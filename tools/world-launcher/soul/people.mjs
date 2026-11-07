// people.mjs: what a Soul knows of each Soul it has met, one record per person across worlds. Pure: it folds log records and
// makes the markdown; memory.mjs says when and where. Design: docs/design/soul-context.md section 4.
//
// Edit this file, then run `node tools/world-launcher/soul/inline.mjs`: worlds serve eden.mjs as one file.

import { createHash } from "node:crypto";

const BELIEFS = 8, LINE_BYTES = 200, NAME_BYTES = 100, ONCE_BYTES = 2048, RECORD_BYTES = 8192, OPEN_MAX = 8;
/** Soul records bound themselves: fewer rows of each list until the file fits. */
const KEEP = [8, 4, 2, 1];
const md = (v) => String(v).replace(/[\r\n]+/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_[\]{}()#|~]/g, "\\$&");
const short = (v, max = LINE_BYTES) => { const t = String(v ?? ""); return Buffer.byteLength(t) > max ? `${Buffer.from(t).subarray(0, max - 3).toString().replace(/�+$/, "").trimEnd()}…` : t; };
const clock = (e) => [e.world, e.when?.worldDay == null ? null : `day ${e.when.worldDay}`, e.when?.time].filter(Boolean).join(", ");
const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);

/** The file for a person: a readable start, and a hash of the whole traveller id so two ids never share a file. */
export const personFile = (traveller) => `${String(traveller).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(0, 60)}-${createHash("sha256").update(String(traveller)).digest("hex").slice(0, 12)}.md`;

export function createPeople({ world = null } = {}) {
  const rows = new Map(), alias = new Map(), conversations = new Map(), dirty = new Set(), gone = new Set();
  const at = (home, id) => `${home}/${id}`;
  /** Who an id is, in the world it was seen in. A world speaks for its own Souls: `<world>/<id>`, or a traveller id with that world
   *  as its home. That another world's Soul is a visitor is only that world's word: the record is shared, but what this Soul
   *  wrote under one claim shows only under that claim or one its home world vouches for. */
  function person(id, name, e) {
    const said = own(e.travellers, id), home = e.world ?? world, local = at(home, id);
    const key = said ?? alias.get(local) ?? local, stale = alias.get(local);
    if (said && stale && stale !== said && rows.has(stale)) merge(stale, said);
    alias.set(local, key);
    let row = rows.get(key);
    if (!row) { row = { traveller: key, name: name ?? id, ids: [], locals: new Set(), claimed: new Set(), first: null, last: null, met: 0, episodes: [], beliefs: [], words: [], told: [], commitments: new Map() }; rows.set(key, row); }
    if (said && !said.startsWith(`${home}/`)) row.claimed.add(local);
    else row.claimed.delete(local);
    if (name && !row.claimed.has(local)) row.name = name;
    if (!row.ids.includes(id)) row.ids.push(id);
    row.locals.add(local);
    dirty.add(key);
    return row;
  }
  function merge(from, to) {
    const a = rows.get(from), b = rows.get(to);
    rows.delete(from); gone.add(from); dirty.delete(from);
    if (!b) { a.traveller = to; rows.set(to, a); dirty.add(to); for (const l of a.locals) alias.set(l, to); return; }
    for (const k of ["episodes", "beliefs", "words", "told"]) b[k] = [...a[k], ...b[k]].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
    for (const [k, v] of a.commitments) b.commitments.set(k, v);
    b.ids = [...new Set([...a.ids, ...b.ids])]; b.met += a.met;
    b.locals = new Set([...a.locals, ...b.locals]); b.claimed = new Set([...a.claimed, ...b.claimed]);
    b.first = !b.first || (a.first && a.first.at < b.first.at) ? a.first : b.first;
    b.last = !b.last || (a.last && a.last.at > b.last.at) ? a.last : b.last;
    for (const l of a.locals) alias.set(l, to);
    dirty.add(to);
  }
  const contact = (row, e, where) => { const c = { at: e.at, world: e.world ?? null, worldDay: e.when?.worldDay ?? null, time: e.when?.time ?? null, place: where ?? null }; row.last = c; return c; };
  const named = (e, id) => own(e.seen, id) ?? null;
  const metHere = (row, e, placeId) => { const c = contact(row, e, named(e, placeId)); row.first ??= c; row.met += 1; };
  const episode = (row, ep) => { const i = row.episodes.findIndex((x) => x.ref === ep.ref); if (i >= 0) row.episodes.splice(i, 1); row.episodes.push(ep); };
  /** A note or a promise made under `via` may be read under `from`: the same claim, or two no other world had to vouch for. */
  const shows = (row, via, from) => via === from || (!row.claimed.has(via) && !row.claimed.has(from));

  function apply(record) {
    const e = record.value, home = e.world ?? world;
    if (record.kind === "remember") {
      if (!e.person) return;
      const row = person(e.person, null, e);
      row.beliefs.push({ at: e.at, text: e.note, mine: true, via: at(home, e.person) });
      return;
    }
    switch (e.type) {
      case "meet": metHere(person(e.person.id, e.person.name, e), e, e.placeId); break;
      case "speech": {
        const row = person(e.personId, named(e, e.personId), e);
        contact(row, e, named(e, e.placeId));
        row.words.push({ at: e.at, text: e.text });
        if (e.conversationId) {
          const key = at(home, e.conversationId), turns = conversations.get(key) ?? new Map();
          conversations.set(key, turns.set(e.personId, e.at));
          episode(row, { at: e.at, ref: e.conversationId, kind: "conversation", world: e.world ?? null, line: `talked${clock(e) ? ` (${clock(e)})` : ""}` });
        }
        break;
      }
      case "outcome":
        for (const p of e.met ?? []) { const row = person(p.id, p.name, e); metHere(row, e, p.where); episode(row, { at: e.at, ref: e.receiptId, kind: "receipt", world: e.world ?? null, line: e.summary }); }
        // `about` is `<world>:<id>` from memory.mjs. What a world says of someone stays the world's, whatever it calls its source.
        for (const f of e.learned ?? []) {
          const id = f.about.startsWith(`${home}:`) ? f.about.slice(home.length + 1) : null;
          if (id && alias.has(at(home, id))) person(id, null, e).beliefs.push({ at: e.at, text: f.fact, provenance: f.provenance, mine: false });
        }
        break;
      case "told": {
        const members = e.conversationId ? [...(conversations.get(at(home, e.conversationId))?.keys() ?? [])] : [];
        for (const id of members.length ? members : e.personIds) person(id, named(e, id), e).told.push({ at: e.at, text: e.text, channel: e.channel });
        break;
      }
      case "commitment": person(e.personId, named(e, e.personId), e).commitments.set(e.id, { id: e.id, at: e.at, by: e.by, what: e.what, via: at(home, e.personId), kept: null }); break;
      case "commitment.kept": { const row = person(e.personId, null, e), c = row.commitments.get(e.commitmentId); if (c) c.kept = { at: e.at, evidence: e.evidence }; break; }
    }
  }
  const open = (row) => [...row.commitments.values()].filter((c) => !c.kept);
  const promised = (c) => (c.by === "me" ? "I promised" : "They promised");
  function render(row, keep) {
    const list = (head, lines) => (lines.length ? [`## ${head}`, ...lines, ""] : []);
    const place = (c) => [c.world, c.worldDay == null ? null : `day ${c.worldDay}`, c.time, c.at].filter(Boolean).join(", ") + (c.place ? ` at ${md(short(c.place, NAME_BYTES))}` : "");
    const last = (items, n = keep) => items.slice(-n).reverse();
    const beliefs = row.beliefs.filter((b) => b.mine), said = row.beliefs.filter((b) => !b.mine), commitments = [...open(row).slice(-Math.min(OPEN_MAX, keep + 1)), ...[...row.commitments.values()].filter((c) => c.kept).slice(-keep)];
    return [`# ${md(short(row.name, NAME_BYTES))} [${md(short(row.traveller, NAME_BYTES))}]`, "",
      ...(row.claimed.size ? [`A world's word, not checked: ${[...row.claimed].slice(0, 4).map((c) => md(short(c, NAME_BYTES))).join(", ")} is this Soul.`, ""] : []),
      ...list("First met", row.first ? [`- ${place(row.first)}`] : []),
      ...list("Last contact", row.last ? [`- ${place(row.last)}`] : []),
      ...list("Episodes — a world's words, UNTRUSTED", last(row.episodes).map((x) => `- ${md(short(x.line))} — ${x.kind} ${md(short(x.ref, NAME_BYTES))}`)),
      ...list("What I believe", last(beliefs, Math.min(keep, BELIEFS)).map((b) => `- ${md(short(b.text))} — my judgment`)),
      ...list("What a world says of them — UNTRUSTED", last(said, Math.min(keep, BELIEFS)).map((b) => `- ${md(short(b.text))} — ${md(short(b.provenance, NAME_BYTES))}`)),
      ...list("What they said — UNTRUSTED", last(row.words, Math.min(keep, 3)).map((w) => `> ${md(short(w.text))}`)),
      ...list("What I have told them", last(row.told, Math.min(keep, 6)).map((t) => `- ${md(short(t.text))}`)),
      ...list("Commitments", commitments.map((c) => `- ${promised(c)}: ${md(short(c.what))} [${md(c.id)}]${c.kept ? ` — kept, ${md(c.kept.evidence)}` : " — open"}`)),
    ].join("\n");
  }
  const fitted = (row) => { const cap = row.met > 1 ? RECORD_BYTES : ONCE_BYTES; let text = ""; for (const keep of KEEP) { text = render(row, keep); if (Buffer.byteLength(text) < cap) break; } return text; };
  const local = (id) => at(world, id);
  return {
    apply,
    /** Records changed since the last call, as files to write, and files of records folded into another. */
    changes() { const out = { write: [...dirty].filter((k) => rows.has(k)).map((k) => [personFile(k), fitted(rows.get(k)) + "\n"]), remove: [...gone].filter((k) => !rows.has(k)).map(personFile) }; dirty.clear(); gone.clear(); return out; },
    /** By id in this world, by traveller id, else by name: someone here before someone elsewhere. */
    find(target) { const lower = String(target).toLowerCase(), all = [...rows.values()], called = (r) => r.name.toLowerCase() === lower; return rows.get(alias.get(local(target))) ?? rows.get(target) ?? all.find((r) => called(r) && r.ids.some((id) => r.locals.has(local(id)))) ?? all.find(called) ?? null; },
    /** The id to write under now: this world's, else the first it was seen by, with the traveller id so the record is found. */
    addressOf(row) { const id = row.ids.find((x) => row.locals.has(local(x))) ?? row.ids[0]; return { id, travellers: row.ids.some((x) => row.locals.has(local(x))) ? {} : { [id]: row.traveller } }; },
    /** One line's worth for the brief, as this world's id sees it. */
    view(id) {
      const from = local(id), row = rows.get(alias.get(from));
      if (!row) return null;
      const note = row.beliefs.filter((b) => b.mine && shows(row, b.via, from)).at(-1)?.text ?? null, c = open(row).filter((x) => shows(row, x.via, from)).at(-1);
      return { name: row.name, met: row.met, last: row.last ? { world: row.last.world, worldDay: row.last.worldDay, place: row.last.place } : null, note, open: c ? `${promised(c)}: ${c.what}` : null, claimed: row.claimed.has(from) };
    },
    /** Every open promise, whoever is near. Oldest first: they have waited longest. */
    promises() { return [...rows.values()].flatMap((row) => open(row).map((c) => ({ with: row.name, by: c.by, what: c.what, at: c.at }))).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(0, OPEN_MAX); },
    commitment(id) { for (const row of rows.values()) if (row.commitments.has(id)) return { row, ...row.commitments.get(id) }; return null; },
    /** Who has spoken in a conversation here. */
    conversation: (id) => [...(conversations.get(local(id))?.keys() ?? [])],
    /** The last turn of this conversation by someone this promise can be read as: a promise kept under a claim is that claim's. */
    lastTurn(id, c) { let last = null; for (const [who, when] of conversations.get(local(id)) ?? []) if (c.row.locals.has(local(who)) && shows(c.row, c.via, local(who)) && (!last || when > last)) last = when; return last; },
    /** Whether a shared receipt's `met` holds this promise's person, as this promise can read them. */
    involves(receipt, c) { const home = receipt.world ?? world; return receipt.met.some((id) => c.row.locals.has(at(home, id)) && shows(c.row, c.via, at(home, id))); },
    size: () => rows.size,
  };
}
