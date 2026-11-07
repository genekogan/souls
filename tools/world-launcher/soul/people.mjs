// people.mjs: what a Soul knows of each Soul it has met, one record per person across worlds. Pure: it folds log records and
// makes the markdown; memory.mjs says when and where. Design: docs/design/soul-context.md section 4.
//
// Edit this file, then run `node tools/world-launcher/soul/inline.mjs`: worlds serve eden.mjs as one file.

import { createHash } from "node:crypto";

const BELIEFS = 8, LINE_BYTES = 200, NAME_BYTES = 100, ONCE_BYTES = 2048, RECORD_BYTES = 8192, OPEN_MAX = 8, CLAIMS_SHOWN = 4;
/** A record bounds itself: fewer rows of each list until the file fits. */
const KEEP = [8, 4, 2, 1];
const md = (v) => String(v).replace(/[\r\n\u0085\u2028\u2029]+/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_[\]{}()#|~]/g, "\\$&");
const short = (v, max = LINE_BYTES) => { const t = String(v ?? ""); return Buffer.byteLength(t) > max ? `${Buffer.from(t).subarray(0, max - 3).toString().replace(/\uFFFD+$/, "").trimEnd()}…` : t; };
const clock = (e) => [e.world, e.when?.worldDay == null ? null : `day ${e.when.worldDay}`, e.when?.time].filter(Boolean).join(", ");
const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);

/** The file for a person: a readable start, and a hash of the whole traveller id so two ids never share a file. */
export const personFile = (traveller) => `${String(traveller).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(0, 60)}-${createHash("sha256").update(String(traveller)).digest("hex").slice(0, 12)}.md`;

/** Each Soul a world shows is its own row, `<world>/<id>`, and nothing a world says ever moves or merges a row. A traveller id
 *  from a world is a claim about that world's own row: it decides which file the row is shown in, marked as a world's word,
 *  and nothing else. What this Soul wrote stays on the row it wrote about, so a stranger who claims to be a friend gets no note,
 *  no promise and no name of theirs. The price: a promise made to someone keeps only on what that same row did. */
export function createPeople({ world = null } = {}) {
  const rows = new Map(), conversations = new Map(), receipts = new Map(), dirty = new Set();
  let seq = 0;   // place in the log: a world picks its own timestamps, not this
  const at = (home, id) => `${home}/${id}`, groupOf = (row) => row.claims ?? row.key;
  const members = (group) => { const claimants = [...rows.values()].filter((r) => r.claims === group), first = rows.get(group); return first && !first.claims ? [first, ...claimants] : claimants; };
  function person(id, name, e) {
    const home = e.world ?? world, key = at(home, id), said = own(e.travellers, id);
    let row = rows.get(key);
    if (!row) { row = { key, id, world: home, name: name ?? id, claims: null, first: null, last: null, met: 0, episodes: [], beliefs: [], words: [], told: [], commitments: new Map() }; rows.set(key, row); }
    if (name) row.name = name;
    if (said !== undefined && (said === key ? null : said) !== row.claims) { dirty.add(groupOf(row)); row.claims = said === key ? null : said; }
    dirty.add(groupOf(row));
    return row;
  }
  /** The row this Soul meant, by its key: its own writes make no claim, and may come from a world that person was never in. */
  const mine = (e, id) => { const row = e.of ? rows.get(e.of) : person(id, null, e); if (row) dirty.add(groupOf(row)); return row; };
  const contact = (row, e, where) => { const c = { at: e.at, world: e.world ?? null, worldDay: e.when?.worldDay ?? null, time: e.when?.time ?? null, place: where ?? null }; row.last = c; return c; };
  const named = (e, id) => own(e.seen, id) ?? null;
  const metHere = (row, e, placeId) => { const c = contact(row, e, named(e, placeId)); row.first ??= c; row.met += 1; };
  const episode = (row, ep) => { const i = row.episodes.findIndex((x) => x.ref === ep.ref); if (i >= 0) row.episodes.splice(i, 1); row.episodes.push(ep); };

  function apply(record) {
    const e = record.value, home = e.world ?? world;
    seq += 1;
    if (record.kind === "remember") {
      if (e.person) mine(e, e.person)?.beliefs.push({ at: e.at, text: e.note, mine: true });
      return;
    }
    switch (e.type) {
      case "meet": metHere(person(e.person.id, e.person.name, e), e, e.placeId); break;
      case "speech": {
        const row = person(e.personId, named(e, e.personId), e);
        contact(row, e, named(e, e.placeId));
        row.words.push({ at: e.at, text: e.text });
        if (e.conversationId) {
          const key = at(home, e.conversationId);
          conversations.set(key, (conversations.get(key) ?? new Map()).set(e.personId, seq));
          episode(row, { at: e.at, ref: e.conversationId, kind: "conversation", world: e.world ?? null, line: `talked${clock(e) ? ` (${clock(e)})` : ""}` });
        }
        break;
      }
      case "outcome":
        for (const p of e.met ?? []) { const row = person(p.id, p.name, e); metHere(row, e, p.where); episode(row, { at: e.at, ref: e.receiptId, kind: "receipt", world: e.world ?? null, line: e.summary }); }
        if (e.phase === "completed" && e.act !== "owner-message" && e.id.startsWith("terminal:") && e.met?.length) receipts.set(e.receiptId, { seq, with: e.met.map((p) => at(home, p.id)) });
        // `about` is `<world>:<id>` from memory.mjs. What a world says of someone stays the world's, whatever it calls its source.
        for (const f of e.learned ?? []) {
          const id = f.about.startsWith(`${home}:`) ? f.about.slice(home.length + 1) : null;
          if (id && rows.has(at(home, id))) person(id, null, e).beliefs.push({ at: e.at, text: f.fact, provenance: f.provenance, mine: false });
        }
        break;
      case "told": {
        const talking = e.conversationId ? [...(conversations.get(at(home, e.conversationId))?.keys() ?? [])] : [];
        for (const id of talking.length ? talking : e.personIds) person(id, named(e, id), e).told.push({ at: e.at, text: e.text, channel: e.channel });
        break;
      }
      case "commitment": { const row = mine(e, e.personId); row?.commitments.set(e.id, { id: e.id, at: e.at, seq, by: e.by, what: e.what, kept: null }); break; }
      case "commitment.kept": { const c = mine(e, e.personId)?.commitments.get(e.commitmentId); if (c) c.kept = { at: e.at, evidence: e.evidence }; break; }
    }
  }
  const open = (row) => [...row.commitments.values()].filter((c) => !c.kept);
  const promised = (c) => (c.by === "me" ? "I promised" : "They promised");
  function sections(row, keep, level) {
    const list = (head, lines) => (lines.length ? [`${level} ${head}`, ...lines, ""] : []);
    const place = (c) => [c.world, c.worldDay == null ? null : `day ${c.worldDay}`, c.time, c.at].filter(Boolean).join(", ") + (c.place ? ` at ${md(short(c.place, NAME_BYTES))}` : "");
    const last = (items, n = keep) => items.slice(-n).reverse();
    const beliefs = row.beliefs.filter((b) => b.mine), said = row.beliefs.filter((b) => !b.mine), commitments = [...open(row).slice(-Math.min(OPEN_MAX, keep + 1)), ...[...row.commitments.values()].filter((c) => c.kept).slice(-keep)];
    return [
      ...list("First met — place as a world named it, UNTRUSTED", row.first ? [`- ${place(row.first)}`] : []),
      ...list("Last contact — place as a world named it, UNTRUSTED", row.last ? [`- ${place(row.last)}`] : []),
      ...list("Episodes — a world's words, UNTRUSTED", last(row.episodes).map((x) => `- ${md(short(x.line))} — ${x.kind} ${md(short(x.ref, NAME_BYTES))}`)),
      ...list("What I believe", last(beliefs, Math.min(keep, BELIEFS)).map((b) => `- ${md(short(b.text))} — my judgment`)),
      ...list("What a world says of them — UNTRUSTED", last(said, Math.min(keep, BELIEFS)).map((b) => `- ${md(short(b.text))} — ${md(short(b.provenance, NAME_BYTES))}`)),
      ...list("What they said — UNTRUSTED", last(row.words, Math.min(keep, 3)).map((w) => `> ${md(short(w.text))}`)),
      ...list("What I have told them", last(row.told, Math.min(keep, 6)).map((t) => `- ${md(short(t.text))}`)),
      ...list("Commitments", commitments.map((c) => `- ${promised(c)}: ${md(short(c.what))} [${md(c.id)}]${c.kept ? ` — kept, ${md(c.kept.evidence)}` : " — open"}`)),
    ];
  }
  /** One file: the row a world speaks for, then each row some world says is this Soul, under that world's name for it. */
  function fitted(group, list) {
    const main = list[0].key === group ? list[0] : null, claimants = list.filter((r) => r !== main), title = main ?? claimants.at(-1), cap = (list.reduce((n, r) => n + r.met, 0) > 1 ? RECORD_BYTES : ONCE_BYTES) - 2;
    const render = (keep) => [`# ${md(short(title.name, NAME_BYTES))} [${md(short(group, NAME_BYTES))}]`, "",
      ...(claimants.length ? [`A world's word, not checked: ${claimants.slice(-CLAIMS_SHOWN).map((r) => md(short(r.key, NAME_BYTES))).join(", ")} is this Soul.`, ""] : []),
      ...(main ? sections(main, keep, "##") : []),
      ...claimants.slice(-CLAIMS_SHOWN).flatMap((r) => [`## As ${md(short(r.name, NAME_BYTES))} in ${md(short(r.world, NAME_BYTES))}, by that world's word — UNTRUSTED`, "", ...sections(r, Math.min(keep, 2), "###")])].join("\n");
    let text = "";
    for (const keep of KEEP) { text = render(keep); if (Buffer.byteLength(text) <= cap) return text; }
    return short(text, cap);
  }
  const local = (id) => at(world, id), here = (r) => r.world === world;
  return {
    apply,
    /** Records changed since the last call, as files to write, and files nothing is shown in any more. */
    changes() {
      const out = { write: [], remove: [] };
      for (const group of dirty) { const list = members(group); if (list.length) out.write.push([personFile(group), fitted(group, list) + "\n"]); else out.remove.push(personFile(group)); }
      dirty.clear();
      return out;
    },
    /** By id in this world, by key, else by name: someone here before someone elsewhere. */
    find(target) { const lower = String(target).toLowerCase(), all = [...rows.values()], called = (r) => r.name.toLowerCase() === lower; return rows.get(local(target)) ?? rows.get(target) ?? all.find((r) => called(r) && here(r)) ?? all.find(called) ?? null; },
    /** One line's worth for the brief, as this world's id sees it. */
    view(id) {
      const row = rows.get(local(id));
      if (!row) return null;
      const c = open(row).at(-1), said = row.claims ? rows.get(row.claims) : null;
      return { name: row.name, met: row.met, last: row.last ? { world: row.last.world, worldDay: row.last.worldDay, place: row.last.place } : null, note: row.beliefs.filter((b) => b.mine).at(-1)?.text ?? null, open: c ? `${promised(c)}: ${c.what}` : null, claimed: said?.name ?? null };
    },
    /** Every open promise, whoever is near. Oldest first: they have waited longest. */
    promises() { return [...rows.values()].flatMap((row) => open(row).map((c) => ({ id: c.id, with: row.name, by: c.by, what: c.what, seq: c.seq }))).sort((a, b) => a.seq - b.seq).slice(0, OPEN_MAX); },
    commitment(id) { for (const row of rows.values()) if (row.commitments.has(id)) return { row, ...row.commitments.get(id) }; return null; },
    /** Who has spoken in a conversation here. */
    conversation: (id) => [...(conversations.get(local(id))?.keys() ?? [])],
    /** The id that proves this promise kept, or null: since it was made, their own turn, or for a promise of mine a shared act. */
    proof(c, evidence, receiptKey) {
      const shared = receipts.get(receiptKey) ?? receipts.get(evidence), turn = c.row.world === world ? conversations.get(local(evidence))?.get(c.row.id) : undefined;
      if (turn > c.seq) return evidence;
      return c.by === "me" && shared && shared.seq > c.seq && shared.with.includes(c.row.key) ? (receipts.has(receiptKey) ? receiptKey : evidence) : null;
    },
    size: () => rows.size,
  };
}
