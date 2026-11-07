// memory.mjs: one memory per Soul across worlds. It keeps the record format of tools/edge-skill/memory-folder.mjs and
// feeds it what the client already received: no HTTP, no model. Design: docs/design/soul-context.md section 2.
//
// Edit this file, then run `node tools/world-launcher/soul/inline.mjs`: worlds serve eden.mjs as one file, so this module
// lives inside it as a generated block.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { openMemoryFolder } from "../../edge-skill/memory-folder.mjs";

const TERMINAL = new Set(["completed", "failed", "replaced"]);
/** How close a Soul has to be for a first meeting: the distance `here` counts as local. */
export const NEAR_METRES = 8;
const SEARCH_MAX = 20, OPEN_FOR_MAX = 32, SEEN_MAX = 64;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const sha = (v) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
const clip = (v, max) => { const t = String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };
const iso = (ms) => new Date(ms).toISOString();

/** Place ids repeat across worlds, so a memory holds them as `<world>:<place>`. */
export function worldKey(world, id) {
  const key = `${world}:${id}`;
  return SAFE_ID.test(key) ? key : `${world}:h-${sha(String(id)).slice(0, 40)}`;
}

/** A world's presence files, for `status`. Reads only. */
export function presences(soulDir) {
  const dir = join(soulDir, "worlds");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().flatMap((f) => {
    try { const { openFor, ...p } = JSON.parse(readFileSync(join(dir, f), "utf8")); return [p]; } catch { return []; }
  });
}

function dayFrom(text) { const m = /\bworld day (\d+)/i.exec(String(text ?? "")); return m ? Number(m[1]) : null; }

/** `world` is this home's key for the world the Soul is in, `role` home or visiting. */
export function openSoulMemory(soulDir, { world, url = null, soul = null, role = "home", now = () => new Date().toISOString(), sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }) {
  const presenceFile = join(soulDir, "worlds", `${world}.json`), lock = join(soulDir, "runtime", ".memory.lock");
  const readPresence = () => { try { return JSON.parse(readFileSync(presenceFile, "utf8")); } catch { return null; } };
  let presence = readPresence() ?? { world, url, role, soul, place: null, placeName: null, posture: null, lastSeen: null, worldDay: null, time: null };
  function writePresence(patch) {
    presence = { ...presence, ...patch, world, url: url ?? presence.url, role, soul: soul ?? presence.soul };
    mkdirSync(join(soulDir, "worlds"), { recursive: true, mode: 0o700 });
    const tmp = `${presenceFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(presence, null, 1) + "\n", { mode: 0o600 });
    renameSync(tmp, presenceFile);
  }

  // A Soul's serve and a chat in the same home can both write: the log takes one writer at a time, and a writer that finds
  // the log moved under it opens it again. Everything else stays what memory-folder.mjs says: a torn log fails closed.
  let records = null;
  const openRecords = () => openMemoryFolder(soulDir, { logs: join("memory", "log") });
  function withRecords(fn) {
    mkdirSync(join(soulDir, "runtime"), { recursive: true, mode: 0o700 });
    for (let i = 0; ; i++) {
      try { closeSync(openSync(lock, "wx", 0o600)); break; }
      catch (e) {
        if (e.code !== "EEXIST") throw e;
        if (i >= 100) { try { unlinkSync(lock); } catch { /* the holder released it */ } } else sleepMs(20);
      }
    }
    try {
      records ??= openRecords();
      try { return fn(records); }
      catch (e) {
        if (!/another writer|changed outside remember/.test(e.message)) throw e;
        records = openRecords();
        return fn(records);
      }
    } finally { try { unlinkSync(lock); } catch { /* taken over */ } }
  }

  // One wire event or frame: both clocks. The world day is only in `here`; a clock going backwards means a day went by.
  function clockAt({ real, tick, time, worldDay }) {
    let day = worldDay ?? presence.worldDay ?? null;
    if (worldDay == null && day !== null && time && presence.time && time < presence.time) day += 1;
    return { real, tick: Number.isSafeInteger(tick) ? tick : null, worldDay: day, time: /^\d\d:\d\d$/.test(time ?? "") ? time : null };
  }
  const seenOf = (pairs) => Object.fromEntries(pairs.filter(([id, name]) => id != null && name != null && String(name).trim()).slice(0, SEEN_MAX).map(([id, name]) => [id, clip(name, 200)]));
  /** The record, once. Replays of a stream and a serve's second look at the same receipt add nothing. */
  function fold(records_, id, event) {
    const key = SAFE_ID.test(id) ? id : `ev:${sha(id)}`;
    if (records_.eventValue(key)) return false;
    return records_.fold({ id: key, at: event.when.real, world, ...event }).applied;
  }
  const arrived = (r, when, placeId, placeName) => {
    if (!placeId || placeId === presence.place) return false;
    const place = worldKey(world, placeId), wrote = fold(r, `arrival:${world}:${when.tick ?? when.real}:${placeId}`, { type: "arrival", placeId: place, when, seen: seenOf([[place, placeName ?? placeId]]) });
    writePresence({ place: placeId, placeName: placeName ?? placeId, lastSeen: when, worldDay: when.worldDay, time: when.time });
    return wrote;
  };
  const met = (r, when, person) => {
    if (!person?.id || person.id === soul || !SAFE_ID.test(person.id) || !person.name) return false;
    if (r.known().people.some((p) => p.id === person.id && p.met > 0)) return false;
    const place = presence.place ? worldKey(world, presence.place) : null, name = clip(person.name, 100);
    return fold(r, `meet:${world}:${person.id}`, { type: "meet", person: { id: person.id, name }, placeId: place, when, seen: seenOf([[person.id, name], ...(place ? [[place, presence.placeName]] : [])]) });
  };

  function outcome(r, receipt, when) {
    const out = receipt.outcome ?? {}, end = receipt.endedAt?.place ?? null, where = (id) => (id ? worldKey(world, id) : null);
    const metRows = (out.met ?? []).slice(0, 32).flatMap((p) => { const id = p.soulId ?? p.id; return id && SAFE_ID.test(id) && p.name ? [{ id, name: clip(p.name, 200), where: where(p.placeId) }] : []; });
    const produced = (out.produced ?? []).slice(0, 32).flatMap((o) => (o.id && SAFE_ID.test(o.id) ? [{ id: o.id, title: clip(o.title ?? o.id, 200), kind: clip(o.kind ?? "thing", 1000), where: where(o.where) }] : []));
    const learned = (out.learned ?? []).slice(0, 5).map((f) => ({ fact: clip(f.fact, 2000), about: worldKey(world, f.about), source: `${world}:${clip(f.source ?? f.about, 900)}`, provenance: clip(f.provenance === "authored-content" ? "authored-fiction" : f.provenance ?? "world-fact", 100), untrusted: !!f.untrusted || ["soul-text", "other-soul-report"].includes(f.provenance) }));
    const place = where(end), messageId = presence.openFor?.[receipt.id];
    const seen = seenOf([...(place ? [[place, end === presence.place ? presence.placeName : end]] : []), ...metRows.map((p) => [p.id, p.name]), ...metRows.filter((p) => p.where).map((p) => [p.where, p.where.slice(world.length + 1)]), ...produced.filter((o) => o.where).map((o) => [o.where, o.where.slice(world.length + 1)]), ...learned.map((f) => [f.about, f.about.slice(world.length + 1)])]);
    const event = { type: "outcome", receiptId: worldKey(world, receipt.id), act: clip(receipt.capability ?? "act", 160), phase: receipt.phase, summary: clip(out.summary ?? `${receipt.capability ?? "act"} ${receipt.phase}.`, 160), untrusted: !!out.untrusted || learned.some((f) => f.untrusted), learned, produced, met: metRows, ...(place ? { placeId: place } : {}), ...(messageId ? { messageId } : {}), when, seen };
    let wrote;
    try { wrote = fold(r, `terminal:${world}:${receipt.id}`, event); }
    catch (e) { if (!/conflicting learned/.test(e.message)) throw e; wrote = fold(r, `terminal:${world}:${receipt.id}`, { ...event, learned: [] }); }
    if (messageId) { const { [receipt.id]: _, ...rest } = presence.openFor; writePresence({ openFor: rest }); }
    return wrote;
  }

  function heard(r, e, when) {
    const from = e.from ?? e.turn?.from, text = e.text ?? e.turn?.text, person = from?.soulId ?? from?.id;
    if (!person || person === soul || !SAFE_ID.test(person) || !text || !from?.name) return false;
    const turn = e.kind === "conversation.turn", place = presence.place ? worldKey(world, presence.place) : null, name = clip(from.name, 100);
    return fold(r, `speech:${world}:${soul}:${e.id ?? sha([e.kind, e.conversation, e.turn?.seq, e.tick, person, text])}`, { type: "speech", personId: person, text: clip(text, 1000), untrusted: true, channel: turn ? "private-conversation" : "public-speech", ...(turn && SAFE_ID.test(e.conversation ?? "") ? { conversationId: e.conversation } : {}), placeId: place, when, seen: seenOf([[person, name], ...(place ? [[place, presence.placeName]] : [])]) });
  }

  return {
    /** The `here` frame the client just read. */
    sawHere(frame) {
      const me = frame?.me; if (!me) return;
      const when = clockAt({ real: now(), tick: frame.tick, time: frame.clock, worldDay: dayFrom(frame.now) });
      const near = (frame.near ?? []).filter((p) => typeof p.dist === "number" && p.dist <= NEAR_METRES);
      if ((!me.place || me.place === presence.place) && !near.length) {
        if ((me.posture ?? null) !== presence.posture || when.worldDay !== presence.worldDay) writePresence({ posture: me.posture ?? null, lastSeen: when, worldDay: when.worldDay, time: when.time });
        return;
      }
      withRecords((r) => {
        arrived(r, when, me.place, me.placePath?.[0]);
        for (const p of near) met(r, when, p);
      });
      if ((me.posture ?? null) !== presence.posture || when.worldDay !== presence.worldDay) writePresence({ posture: me.posture ?? null, lastSeen: when, worldDay: when.worldDay, time: when.time });
    },
    /** Events off the stream or a `wait`. */
    sawEvents(events) {
      const wanted = (events ?? []).filter((e) => (e.kind === "receipt" && TERMINAL.has(e.receipt?.phase)) || ["arrive", "approach", "speech", "conversation.turn"].includes(e.kind));
      if (!wanted.length) return;
      let last = null;
      withRecords((r) => {
        for (const e of wanted) {
          const when = clockAt({ real: Number.isFinite(e.at) ? iso(e.at) : now(), tick: e.tick, time: e.clock });
          if (when.worldDay !== presence.worldDay || when.time) presence = { ...presence, worldDay: when.worldDay, time: when.time ?? presence.time };
          if (e.kind === "receipt") outcome(r, e.receipt, when);
          else if (e.kind === "arrive") arrived(r, when, e.where?.placeId ?? e.placeId, e.where?.place ?? e.placePath?.[0]);
          else if (e.kind === "approach") met(r, when, { id: e.from?.soulId, name: e.from?.name });
          else heard(r, e, when);
          last = when;
        }
      });
      writePresence({ lastSeen: last, worldDay: last.worldDay, time: last.time ?? presence.time });
    },
    /** A receipt read by id. */
    sawReceipt(receipt) {
      if (!receipt?.id || !TERMINAL.has(receipt.phase)) return;
      const when = clockAt({ real: now(), tick: receipt.endedTick ?? null, time: null });
      withRecords((r) => outcome(r, receipt, when));
    },
    /** An act the world took for an owner's message: the message closes when the act ends. */
    sawAct(receiptId, messageId) {
      if (!receiptId || !messageId || !SAFE_ID.test(messageId)) return;
      writePresence({ openFor: Object.fromEntries([...Object.entries(presence.openFor ?? {}), [receiptId, messageId]].slice(-OPEN_FOR_MAX)) });
    },
    /** The Soul's own report on an owner's message. */
    sawResult(messageId, done, text) {
      if (!SAFE_ID.test(messageId ?? "")) return;
      const when = clockAt({ real: now(), tick: null, time: null });
      withRecords((r) => fold(r, `owner:${world}:${messageId}`, { type: "outcome", receiptId: worldKey(world, messageId), messageId, act: "owner-message", phase: done ? "completed" : "failed", summary: clip(text, 160), untrusted: false, learned: [], produced: [], met: [], when, seen: {} }));
    },
    /** Standing in this world, written when a Soul arrives by travel. */
    entered(extra = {}) { writePresence({ lastSeen: clockAt({ real: now(), tick: null, time: null }), ...extra }); },
    left() { writePresence({ left: now() }); },

    /** `remember`: the mind's own judgment, through the record's validators. `target` is a name as seen or an id. */
    remember(selector, target, note, goal = {}) {
      const at = now(), when = clockAt({ real: at, tick: null, time: null });
      return withRecords((r) => {
        const known = r.known(), value = { id: `judgment:${sha([selector, target, note, at])}`, at, world, when };
        if (selector === "self") {
          const lines = [...known.self, ...[note].flat().map((l) => clip(l, 200))];
          value.self = lines.slice(-20);
          r.remember(value);
          return { remembered: "self", lines: value.self.length, ...(lines.length > 20 ? { dropped: lines.length - 20 } : {}) };
        }
        if (selector === "goal") {
          Object.assign(value, { goal: SAFE_ID.test(target) ? target : `goal:${sha(target).slice(0, 32)}`, note: clip(note, 300), horizon: goal.horizon ?? "today", metric: clip(goal.metric ?? "Owner-defined progress", 160), next: clip(goal.next ?? "Choose a next step", 160) });
          r.remember(value);
          return { remembered: "goal", id: value.goal };
        }
        const lower = String(target).toLowerCase();
        if (selector === "person") {
          const p = known.people.find((x) => x.id === target) ?? known.people.find((x) => x.name.toLowerCase() === lower);
          if (!p) throw new Error(`I have no record of meeting ${target}. Use their id from around or here, once they have been near.`);
          r.remember({ ...value, person: p.id, seen: { [p.id]: p.name }, note: clip(note, 300) });
          return { remembered: "person", id: p.id, name: p.name };
        }
        const key = worldKey(world, target), p = known.places.find((x) => x.id === key || x.id === target) ?? known.places.find((x) => x.name.toLowerCase() === lower || x.formerly.some((n) => n.toLowerCase() === lower));
        if (!p) throw new Error(`I have no record of being at ${target}. Use a place I have been, by its id or the name I knew it by.`);
        r.remember({ ...value, place: p.id, seen: { [p.id]: p.name }, note: clip(note, 300) });
        return { remembered: "place", id: p.id, name: p.name };
      });
    },
    /** `memory <query>`: every projection line holding every word, each with where it came from. */
    search(query) {
      withRecords(() => {});   // opening regenerates the projections, and a torn log says so here
      const root = join(soulDir, "memory"), terms = String(query).toLowerCase().split(/\s+/).filter(Boolean), matches = [];
      const walk = (dir) => readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? 1 : -1)).flatMap((d) => (d.isDirectory() ? (d.name === "log" ? [] : walk(join(dir, d.name))) : d.name.endsWith(".md") ? [join(dir, d.name)] : []));
      const plain = (l) => l.replace(/\\(.)/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      let more = 0;
      for (const file of walk(root)) {
        let title = null, section = null;
        for (const raw of readFileSync(file, "utf8").split("\n")) {
          const line = plain(raw);
          if (raw.startsWith("# ")) { title = line.slice(2); section = null; }
          else if (raw.startsWith("## ")) section = line.slice(3);
          if (!raw.trim() || !terms.every((t) => line.toLowerCase().includes(t))) continue;
          if (matches.length >= SEARCH_MAX) { more++; continue; }
          const from = [title, section].filter(Boolean).join(" / ");
          matches.push({ text: line.replace(/^[-> ]+/, ""), file: relative(root, file), provenance: from, untrusted: /untrusted/i.test(`${from} ${line}`) });
        }
      }
      return { query, matches, ...(more ? { more } : {}) };
    },
  };
}
