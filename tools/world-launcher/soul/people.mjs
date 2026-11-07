// people.mjs: what a Soul knows of each Soul it has met, one record per person across worlds. Pure: it folds log records and
// makes the markdown; memory.mjs says when and where. Design: docs/design/soul-context.md section 4.
//
// Edit this file, then run `node tools/world-launcher/soul/inline.mjs`: worlds serve eden.mjs as one file.

const EPISODES = 8, BELIEFS = 8, TOLD = 6, WORDS = 3;
const md = (v) => String(v).replace(/[\r\n]+/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_[\]{}()#|~]/g, "\\$&");
const clock = (e) => [e.world, e.when?.worldDay == null ? null : `day ${e.when.worldDay}`, e.when?.time].filter(Boolean).join(", ");
const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);

/** The file for a person: their traveller id, which holds a slash, made one safe name. */
export const personFile = (traveller) => `${String(traveller).replace(/\//g, "~").replace(/[^A-Za-z0-9._~-]/g, "_").slice(0, 120)}.md`;

export function createPeople({ world = null } = {}) {
  const rows = new Map(), alias = new Map(), conversations = new Map(), dirty = new Set(), gone = new Set();
  /** Who an id is. A Soul seen before its traveller id was known is folded into the record once it is. */
  function person(id, name, e) {
    const said = own(e.travellers, id), home = e.world ?? world;
    const key = said ?? alias.get(id) ?? `${home}/${id}`;
    const stale = alias.get(id);
    if (said && stale && stale !== said && rows.has(stale)) merge(stale, said);
    alias.set(id, key);
    let row = rows.get(key);
    if (!row) { row = { traveller: key, name: name ?? id, ids: [], first: null, last: null, met: 0, episodes: [], beliefs: [], words: [], told: [], commitments: new Map() }; rows.set(key, row); }
    if (name) row.name = name;
    if (!row.ids.includes(id)) row.ids.push(id);
    dirty.add(key);
    return row;
  }
  function merge(from, to) {
    const a = rows.get(from), b = rows.get(to);
    rows.delete(from); gone.add(from); dirty.delete(from);
    if (!b) { a.traveller = to; rows.set(to, a); dirty.add(to); for (const id of a.ids) alias.set(id, to); return; }
    for (const k of ["episodes", "beliefs", "words", "told"]) b[k] = [...a[k], ...b[k]].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
    for (const [k, v] of a.commitments) b.commitments.set(k, v);
    b.ids = [...new Set([...a.ids, ...b.ids])]; b.met += a.met;
    b.first = !b.first || (a.first && a.first.at < b.first.at) ? a.first : b.first;
    b.last = !b.last || (a.last && a.last.at > b.last.at) ? a.last : b.last;
    for (const id of a.ids) alias.set(id, to);
    dirty.add(to);
  }
  const contact = (row, e, where) => { const c = { at: e.at, world: e.world ?? null, worldDay: e.when?.worldDay ?? null, time: e.when?.time ?? null, place: where ?? null }; row.last = c; return c; };
  const named = (e, id) => own(e.seen, id) ?? null;
  const metHere = (row, e, placeId) => { const c = contact(row, e, named(e, placeId)); row.first ??= c; row.met += 1; };
  const episode = (row, ep) => { const i = row.episodes.findIndex((x) => x.ref === ep.ref); if (i >= 0) row.episodes.splice(i, 1); row.episodes.push(ep); };

  function apply(record) {
    const e = record.value;
    if (record.kind === "remember") {
      if (!e.person) return;
      const row = person(e.person, null, e);
      row.beliefs.push({ at: e.at, text: e.note, provenance: "my judgment", untrusted: false });
      return;
    }
    switch (e.type) {
      case "meet": metHere(person(e.person.id, e.person.name, e), e, e.placeId); break;
      case "speech": {
        const row = person(e.personId, named(e, e.personId), e);
        contact(row, e, named(e, e.placeId));
        row.words.push({ at: e.at, text: e.text });
        if (e.conversationId) { conversations.set(e.conversationId, [...new Set([...(conversations.get(e.conversationId) ?? []), e.personId])]); episode(row, { at: e.at, ref: e.conversationId, kind: "conversation", world: e.world ?? null, line: `talked${clock(e) ? ` (${clock(e)})` : ""}` }); }
        break;
      }
      case "outcome":
        for (const p of e.met ?? []) { const row = person(p.id, p.name, e); metHere(row, e, p.where); episode(row, { at: e.at, ref: e.receiptId, kind: "receipt", world: e.world ?? null, line: `${e.summary}${e.untrusted ? " [untrusted]" : ""}` }); }
        for (const f of e.learned ?? []) { const id = alias.has(f.about) ? f.about : null; if (id) person(id, null, e).beliefs.push({ at: e.at, text: f.fact, provenance: f.provenance, untrusted: !!f.untrusted }); }
        break;
      case "told": {
        const ids = e.conversationId ? conversations.get(e.conversationId) ?? e.personIds : e.personIds;
        for (const id of ids) person(id, named(e, id), e).told.push({ at: e.at, text: e.text, channel: e.channel });
        break;
      }
      case "commitment": person(e.personId, named(e, e.personId), e).commitments.set(e.id, { id: e.id, at: e.at, by: e.by, what: e.what, kept: null }); break;
      case "commitment.kept": { const row = person(e.personId, null, e), c = row.commitments.get(e.commitmentId); if (c) c.kept = { at: e.at, evidence: e.evidence }; break; }
    }
  }
  const open = (row) => [...row.commitments.values()].filter((c) => !c.kept);
  function render(row) {
    const list = (head, lines) => [`## ${head}`, ...lines, ""];
    const place = (c) => [c.world, c.worldDay == null ? null : `day ${c.worldDay}`, c.time].filter(Boolean).join(", ") + (c.place ? ` at ${md(c.place)}` : "");
    const commitments = [...row.commitments.values()];
    return [`# ${md(row.name)} [${md(row.traveller)}]`, "",
      ...(row.first ? list("First met", [`- ${place(row.first)}`]) : []),
      ...(row.last ? list("Last contact", [`- ${place(row.last)}`]) : []),
      ...(row.episodes.length ? list("Episodes", row.episodes.slice(-EPISODES).reverse().map((x) => `- ${md(x.line)} — ${x.kind} ${md(x.ref)}`)) : []),
      ...(row.beliefs.length ? list("What I believe", row.beliefs.slice(-BELIEFS).reverse().map((b) => `- ${md(b.text)} — ${md(b.provenance)}${b.untrusted ? "; UNTRUSTED" : ""}`)) : []),
      ...(row.words.length ? list("What they said — UNTRUSTED", row.words.slice(-WORDS).reverse().map((w) => `> ${md(w.text)}`)) : []),
      ...(row.told.length ? list("What I have told them", row.told.slice(-TOLD).reverse().map((t) => `- ${md(t.text)}`)) : []),
      ...(commitments.length ? list("Commitments", commitments.map((c) => `- ${c.by === "me" ? "I promised" : "They promised"}: ${md(c.what)} [${md(c.id)}]${c.kept ? ` — kept, ${md(c.kept.evidence)}` : " — open"}`)) : []),
    ].join("\n");
  }
  return {
    apply,
    /** Records changed since the last call, as files to write, and files of records folded into another. */
    changes() { const out = { write: [...dirty].filter((k) => rows.has(k)).map((k) => [personFile(k), render(rows.get(k)) + "\n"]), remove: [...gone].filter((k) => !rows.has(k)).map(personFile) }; dirty.clear(); gone.clear(); return out; },
    find(target) { const lower = String(target).toLowerCase(); const byId = alias.has(target) ? rows.get(alias.get(target)) : rows.get(target); return byId ?? [...rows.values()].find((r) => r.name.toLowerCase() === lower) ?? null; },
    /** One line's worth for the brief. */
    view(id) {
      const row = alias.has(id) ? rows.get(alias.get(id)) : null;
      if (!row) return null;
      const note = row.beliefs.filter((b) => !b.untrusted).at(-1)?.text ?? null, c = open(row).at(-1);
      return { name: row.name, met: row.met, last: row.last ? { world: row.last.world, worldDay: row.last.worldDay, place: row.last.place } : null, note, open: c ? `${c.by === "me" ? "I promised" : "they promised"}: ${c.what}` : null };
    },
    commitment(id) { for (const row of rows.values()) if (row.commitments.has(id)) return { row, ...row.commitments.get(id) }; return null; },
    conversation: (id) => conversations.get(id) ?? [],
    size: () => rows.size,
  };
}
