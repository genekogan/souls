// memory.mjs: one memory per Soul across worlds. It keeps the record format of tools/edge-skill/memory-folder.mjs and
// feeds it what the client already received: no HTTP, no model. Design: docs/design/soul-context.md section 2.
//
// Everything here comes from a world, and a world may lie: this is where its answers are bounded to what a record takes.
//
// Edit this file, then run `node tools/world-launcher/soul/inline.mjs`: worlds serve eden.mjs as one file, so this module
// lives inside it as a generated block.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join, relative } from "node:path";
import { openMemoryFolder } from "../../edge-skill/memory-folder.mjs";

const TERMINAL = new Set(["completed", "failed", "replaced"]);
/** How close a Soul has to be for a first meeting: the distance `here` counts as local. */
export const NEAR_METRES = 8;
const SEARCH_MAX = 20, OPEN_FOR_MAX = 32, RECORD_BYTES = 56 * 1024, LOCK_TRIES = 150, LOCK_WAIT_MS = 20;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const sha = (v) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
const clip = (v, max) => { const t = String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };
const safeId = (v) => typeof v === "string" && SAFE_ID.test(v);
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const rows = (v, max) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object").slice(0, max) : []);
const unique = (list) => [...new Map(list.map((x) => [x.id, x])).values()];
const bytes = (v) => Buffer.byteLength(JSON.stringify(v));
const realTime = (ms, fallback) => { try { return new Date(ms).toISOString(); } catch { return fallback(); } };

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

function dayFrom(text) { const m = /\bworld day (\d{1,12})\b/i.exec(String(text ?? "")); return m ? count(Number(m[1])) : null; }
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }

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
  // the log moved under it opens it again. A holder that died is passed over; a live one is waited for, then reported, and
  // nothing else may touch its lock. Everything else stays what memory-folder.mjs says: a torn log fails closed.
  let records = null;
  const openRecords = () => openMemoryFolder(soulDir, { logs: join("memory", "log") });
  function takeLock() {
    const mine = `${process.pid}:${randomBytes(6).toString("hex")}`;
    mkdirSync(join(soulDir, "runtime"), { recursive: true, mode: 0o700 });
    for (let i = 0; i < LOCK_TRIES; i++) {
      try { const fd = openSync(lock, "wx", 0o600); writeSync(fd, mine); closeSync(fd); return mine; }
      catch (e) { if (e.code !== "EEXIST") throw e; }
      let holder;
      try { holder = Number(readFileSync(lock, "utf8").split(":")[0]); }
      catch (e) { if (e.code === "ENOENT") continue; throw new Error(`memory: ${e.message}`); }
      if (Number.isSafeInteger(holder) && holder > 0 && !pidAlive(holder)) { try { unlinkSync(lock); } catch { /* the next try says */ } continue; }
      sleepMs(LOCK_WAIT_MS);
    }
    throw new Error("memory: another writer holds the lock; nothing was written");
  }
  const dropLock = (mine) => { try { if (readFileSync(lock, "utf8") === mine) unlinkSync(lock); } catch { /* gone already */ } };
  const stale = (e) => /another writer changed|changed outside remember/.test(e.message);
  function withRecords(fn) {
    const mine = takeLock();
    try {
      records ??= openRecords();
      try { return fn(records); }
      catch (e) {
        if (!stale(e)) throw e;
        records = openRecords();
        return fn(records);
      }
    } finally { dropLock(mine); }
  }

  // One wire event or frame: both clocks. The world day is only in `here`; a clock going backwards as ticks go forwards means a
  // day went by. Backlog, with older ticks, moves nothing.
  function clockAt({ real, tick, time, worldDay }) {
    const at = count(tick), known = count(presence.worldDay), last = presence.lastSeen?.tick ?? null, hhmm = /^\d\d:\d\d$/.test(time ?? "") ? time : null;
    let day = count(worldDay) ?? known;
    if (count(worldDay) === null && day !== null && hhmm && presence.time && hhmm < presence.time && at !== null && last !== null && at > last) day += 1;
    return { real, tick: at, worldDay: day, time: hhmm };
  }
  const moved = (when) => { const last = presence.lastSeen?.tick ?? null; return when.tick !== null && (last === null || when.tick >= last); };
  const seenOf = (pairs) => Object.fromEntries(pairs.filter(([id, name]) => typeof id === "string" && clip(name, 200)).map(([id, name]) => [id, clip(name, 200)]));
  /** The record, once. Replays of a stream and a serve's second look at the same receipt add nothing. */
  function fold(r, id, event) {
    const key = safeId(id) ? id : `ev:${sha(id)}`;
    if (r.eventValue(key)) return false;
    return r.fold({ id: key, at: event.when.real, world, ...event }).applied;
  }
  /** What this place goes by: what the world just said, else what this memory knows, else its id until a name turns up. */
  const nameOf = (r, key, said) => clip(said, 200) || r.placeName(key) || (key === worldKey(world, presence.place) ? presence.placeName : null) || key.slice(world.length + 1);
  const arrived = (r, when, placeId, said) => {
    if (typeof placeId !== "string" || !placeId || placeId === presence.place) return false;
    const place = worldKey(world, placeId), name = nameOf(r, place, said);
    const wrote = fold(r, `arrival:${world}:${when.tick ?? when.real}:${placeId}`, { type: "arrival", placeId: place, when, seen: seenOf([[place, name]]) });
    writePresence({ place: clip(placeId, 200), placeName: name, lastSeen: when, worldDay: when.worldDay, time: when.time });
    return wrote;
  };
  const here = (r) => { const key = typeof presence.place === "string" && presence.place ? worldKey(world, presence.place) : null; return key ? [key, nameOf(r, key)] : [null, null]; };
  const met = (r, when, person) => {
    const name = clip(person?.name, 100);
    if (!safeId(person?.id) || person.id === soul || !name) return false;
    if (r.known().people.some((p) => p.id === person.id && p.met > 0)) return false;
    const [place, placeName] = here(r);
    return fold(r, `meet:${world}:${person.id}`, { type: "meet", person: { id: person.id, name }, placeId: place, when, seen: seenOf([[person.id, name], ...(place ? [[place, placeName]] : [])]) });
  };

  function outcome(r, receipt, when) {
    const out = receipt.outcome && typeof receipt.outcome === "object" ? receipt.outcome : {}, where = (id) => (typeof id === "string" && id ? worldKey(world, id) : null);
    let metRows = unique(rows(out.met, 32).flatMap((p) => { const id = p.soulId ?? p.id, name = clip(p.name, 200); return safeId(id) && id !== soul && name ? [{ id, name, where: where(p.placeId) }] : []; }));
    let produced = unique(rows(out.produced, 32).flatMap((o) => (safeId(o.id) ? [{ id: o.id, title: clip(o.title, 200) || o.id, kind: clip(o.kind, 200) || "thing", where: where(o.where) }] : [])));
    // A changing source is a new reading, not a conflict: each fact keeps its own version of the source.
    let learned = unique(rows(out.learned, 5).flatMap((f) => {
      const fact = clip(f.fact, 2000), provenance = clip(f.provenance === "authored-content" ? "authored-fiction" : f.provenance, 100) || "world-fact", untrusted = !!f.untrusted || ["soul-text", "other-soul-report"].includes(f.provenance);
      if (!fact || typeof f.about !== "string" || !f.about) return [];
      const about = worldKey(world, f.about), source = `${world}:${clip(f.source ?? f.about, 900)}#${sha([fact, about, provenance, untrusted]).slice(0, 12)}`;
      return [{ id: source, fact, about, source, provenance, untrusted }];
    })).map(({ id, ...f }) => f);
    const end = where(receipt.endedAt?.place), messageId = safeId(presence.openFor?.[receipt.id]) ? presence.openFor[receipt.id] : null;
    const build = () => ({
      type: "outcome", receiptId: worldKey(world, receipt.id), act: clip(receipt.capability, 160) || "act", phase: receipt.phase, summary: clip(out.summary, 160) || `${clip(receipt.capability, 140) || "act"} ${receipt.phase}.`,
      untrusted: !!out.untrusted || learned.some((f) => f.untrusted), learned, produced, met: metRows, ...(end ? { placeId: end } : {}), ...(messageId ? { messageId } : {}), when,
      seen: seenOf([...(end ? [[end, nameOf(r, end, receipt.endedAt?.placePath?.[0])]] : []), ...metRows.flatMap((p) => [[p.id, p.name], ...(p.where ? [[p.where, nameOf(r, p.where)]] : [])]), ...produced.flatMap((o) => [[o.id, o.title], ...(o.where ? [[o.where, nameOf(r, o.where)]] : [])]), ...learned.map((f) => [f.about, r.placeName(f.about) ?? f.about.slice(world.length + 1)])]),
    });
    let event = build();
    while (bytes(event) > RECORD_BYTES && (produced.length || metRows.length || learned.length)) {   // what fits, rather than nothing
      if (produced.length) produced = produced.slice(0, -1); else if (metRows.length) metRows = metRows.slice(0, -1); else learned = learned.slice(0, -1);
      event = build();
    }
    const wrote = fold(r, `terminal:${world}:${receipt.id}`, event);
    if (messageId) { const { [receipt.id]: _, ...rest } = presence.openFor; writePresence({ openFor: rest }); }
    return wrote;
  }

  function heard(r, e, when) {
    const from = e.from ?? e.turn?.from, text = clip(e.text ?? e.turn?.text, 1000), person = from?.soulId ?? from?.id, name = clip(from?.name, 100);
    if (!safeId(person) || person === soul || !text || !name) return false;
    const turn = e.kind === "conversation.turn", [place, placeName] = here(r);
    return fold(r, `speech:${world}:${soul}:${e.id ?? sha([e.kind, e.conversation, e.turn?.seq, e.tick, person, text])}`, { type: "speech", personId: person, text, untrusted: true, channel: turn ? "private-conversation" : "public-speech", ...(turn && safeId(e.conversation) ? { conversationId: e.conversation } : {}), placeId: place, when, seen: seenOf([[person, name], ...(place ? [[place, placeName]] : [])]) });
  }
  const noted = (me, when) => { const posture = typeof me.posture === "string" ? clip(me.posture, 40) : null; if (posture !== presence.posture || when.worldDay !== presence.worldDay) writePresence({ posture, lastSeen: when, worldDay: when.worldDay, time: when.time }); };

  return {
    /** The `here` frame the client just read. */
    sawHere(frame) {
      const me = frame?.me; if (!me) return;
      const when = clockAt({ real: now(), tick: frame.tick, time: frame.clock, worldDay: dayFrom(frame.now) });
      const near = rows(frame.near, 64).filter((p) => typeof p.dist === "number" && p.dist <= NEAR_METRES);
      const placeId = typeof me.place === "string" ? me.place : null;
      if ((placeId && placeId !== presence.place) || near.length) withRecords((r) => {
        arrived(r, when, placeId, me.placePath?.[0]);
        for (const p of near) met(r, when, p);
      });
      noted(me, when);
    },
    /** Events off the stream or a `wait`. One the record won't take costs only itself. */
    sawEvents(events) {
      const wanted = rows(events, 1000).filter((e) => (e.kind === "receipt" && TERMINAL.has(e.receipt?.phase) && typeof e.receipt?.id === "string") || ["arrive", "approach", "speech", "conversation.turn"].includes(e.kind));
      if (!wanted.length) return;
      let last = null, problem = null;
      withRecords((r) => {
        for (const e of wanted) {
          const when = clockAt({ real: Number.isFinite(e.at) ? realTime(e.at, now) : now(), tick: e.tick, time: e.clock });
          try {
            if (e.kind === "receipt") outcome(r, e.receipt, when);
            else if (e.kind === "arrive") arrived(r, when, e.where?.placeId ?? e.placeId, e.where?.place ?? e.placePath?.[0]);
            else if (e.kind === "approach") met(r, when, { id: e.from?.soulId, name: e.from?.name });
            else heard(r, e, when);
          } catch (err) { if (stale(err)) throw err; problem ??= err; }
          if (moved(when)) { last = when; presence = { ...presence, lastSeen: when, worldDay: when.worldDay, time: when.time ?? presence.time }; }
        }
      });
      if (last) writePresence({});
      if (problem) throw problem;
    },
    /** A receipt read by id. */
    sawReceipt(receipt) {
      if (typeof receipt?.id !== "string" || !TERMINAL.has(receipt.phase)) return;
      const when = clockAt({ real: now(), tick: receipt.endedTick, time: null });
      withRecords((r) => outcome(r, receipt, when));
    },
    /** An act the world took for an owner's message: the message closes when the act ends. */
    sawAct(receiptId, messageId) {
      if (typeof receiptId !== "string" || !safeId(messageId)) return;
      writePresence({ openFor: Object.fromEntries([...Object.entries(presence.openFor ?? {}), [receiptId, messageId]].slice(-OPEN_FOR_MAX)) });
    },
    /** The Soul's own report on an owner's message. */
    sawResult(messageId, done, text) {
      if (!safeId(messageId) || !clip(text, 160)) return;
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
          Object.assign(value, { goal: safeId(target) ? target : `goal:${sha(String(target)).slice(0, 32)}`, note: clip(note, 300), horizon: goal.horizon ?? "today", metric: clip(goal.metric ?? "Owner-defined progress", 160), next: clip(goal.next ?? "Choose a next step", 160) });
          r.remember(value);
          return { remembered: "goal", id: value.goal };
        }
        const lower = String(target).toLowerCase();
        if (selector === "person") {
          const p = known.people.find((x) => x.id === target) ?? known.people.find((x) => x.name.toLowerCase() === lower);
          if (!p) throw new Error(`I have no record of meeting ${target}. Use their id from around or here, once they have been near.`);
          r.remember({ ...value, person: p.id, seen: seenOf([[p.id, p.name]]), note: clip(note, 300) });
          return { remembered: "person", id: p.id, name: p.name };
        }
        // Worlds from one template share names, so this world's place comes first.
        const key = worldKey(world, target), called = (x) => x.name.toLowerCase() === lower || x.formerly.some((n) => n.toLowerCase() === lower), mine = (x) => x.id.startsWith(`${world}:`);
        const p = known.places.find((x) => x.id === key || x.id === target) ?? known.places.find((x) => mine(x) && called(x)) ?? known.places.find(called);
        if (!p) throw new Error(`I have no record of being at ${target}. Use a place I have been, by its id or the name I knew it by.`);
        r.remember({ ...value, place: p.id, seen: seenOf([[p.id, p.name]]), note: clip(note, 300) });
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
