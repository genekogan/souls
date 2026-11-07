// home.mjs: the Souls home, one `.souls/` folder holding every Soul a person keeps on this machine. No HTTP and no
// model: `doctor` is handed its one way of asking a world. Design: docs/design/soul-context.md section 1.
//
// Edit this file, then run `node tools/world-launcher/soul/inline.mjs`: worlds serve eden.mjs as one file, so this module
// lives inside it as a generated block.

import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export const HOME_NAME = ".souls", LEGACY_STATE = ".eden-agent.json", STATE_FILE = "state.json", CREDENTIALS = "credentials.json";
export const RUNTIME_LOCKS = [".listen.lock", ".eden-serve.lock"];
const SERVE_SOCKET = ".eden-serve.sock";
const SOUL_ID = /^s_[A-Za-z0-9_-]+$/;
/** Run in a seat (the world's waiting room), never as a Soul: they make or pair one. */
export const SEAT_COMMANDS = new Set(["register", "create", "pair", "adopt", "approval"]);
/** Work on the home itself, as no one in particular. */
export const HOME_COMMANDS = new Set(["list", "doctor", "default", "export", "import", "init", "upgrade", "guide", "help", "version"]);
/** What a legacy folder hands over on import. Anything else (1.9's `delegations` holds tokens) stays in its own file. */
export const IMPORTED_FIELDS = ["world", "worldId", "accountAuth", "identity", "soul", "token", "home", "cursor", "ownerMark", "lastReceipt", "lastActAt", "lastAcked", "lastAckedAt", "lastAckedActed", "pendingCreate"];
const IMPORTED_RUNTIME = [".eden-serve.json"];

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const isHome = (root) => existsSync(join(root, "config.json"));

/** Where this folder's Souls live. SOULS_HOME wins; else the nearest `.souls/` going up, stopping at the user's home
 *  folder without crossing it; a `.eden-agent.json` in this very folder is a legacy one-Soul folder. */
export function findHome({ cwd, env = {}, homedir }) {
  if (env.SOULS_HOME) { const root = resolve(cwd, env.SOULS_HOME); return { kind: isHome(root) ? "home" : "none", root }; }
  const start = real(cwd), stop = homedir ? real(homedir) : null;
  if (!isHome(join(start, HOME_NAME)) && existsSync(join(start, LEGACY_STATE))) return { kind: "legacy", root: join(start, HOME_NAME) };
  for (let dir = start; ; dir = dirname(dir)) {
    if (isHome(join(dir, HOME_NAME))) return { kind: "home", root: join(dir, HOME_NAME) };
    if (dir === stop || dirname(dir) === dir) return { kind: "none", root: join(start, HOME_NAME) };
  }
}

export function globalRoot(homedir) { return join(homedir, HOME_NAME); }

function writeJson(file, value, mode = 0o600) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1) + "\n", { mode });
  renameSync(tmp, file);
}
function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return fallback; throw new Error(`${basename(file)} cannot be read: ${e.message}`); }
}

/** Make a home at `root`. `cli` is the bundle to keep in bin/. Safe to call on an existing home. */
export function createHome(root, { cli, version } = {}) {
  mkdirSync(join(root, "souls"), { recursive: true, mode: 0o700 });
  if (!existsSync(join(root, "config.json"))) writeJson(join(root, "config.json"), { version: 1, client: version ?? null, default: null, currentWorld: null, worlds: {}, souls: {}, awaitingFirstWorld: true });
  if (!existsSync(join(root, CREDENTIALS))) writeJson(join(root, CREDENTIALS), { version: 1, souls: {}, worlds: {}, approvals: {} });
  if (!existsSync(join(root, ".gitignore"))) writeFileSync(join(root, ".gitignore"), `${CREDENTIALS}\nruntime/\npending/\n`);
  if (cli && !existsSync(join(root, "bin", "eden.mjs"))) {
    mkdirSync(join(root, "bin"), { recursive: true, mode: 0o700 });
    try { copyFileSync(cli, join(root, "bin", "eden.mjs")); } catch { /* the folder's own copy still runs */ }
  }
  return root;
}

/** A world's short name: its `/w/<slug>`, else its host and port. */
export function slugOf(url) {
  const m = /\/w\/([a-z0-9-]+)\/*$/.exec(String(url));
  if (m) return m[1];
  try { const u = new URL(url); return `${u.hostname}${u.port ? `-${u.port}` : ""}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"); } catch { return "world"; }
}
export const keyOf = (worlds, url) => Object.keys(worlds).find((k) => worlds[k].url === url) ?? null;
export const originOf = (url) => { try { return new URL(url).origin; } catch { return String(url); } };
/** a > b for dotted versions; a missing one is oldest. */
export function newerThan(a, b) {
  const p = (v) => String(v ?? "0").split(".").map(Number), x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d > 0; }
  return false;
}
/** The name a person can type for a Soul: "Old Mira" answers to old-mira. */
export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");

/** A state split into what may sit on disk with the Soul and what only credentials.json may hold. */
export function splitSecrets(s) {
  const { token, identity, home, pendingApproval, ...open } = s;
  if (home) open.home = { world: home.world, soul: home.soul };
  if (pendingApproval) { const { pollSecret, ...input } = pendingApproval.input ?? {}; open.pendingApproval = { ...pendingApproval, input }; }
  return { open, secrets: { token, identity, homeToken: home?.token, pollSecret: pendingApproval?.input?.pollSecret } };
}

/** The Soul a person named, among those that can be addressed. `sel` is name, id, name@world or id@world. */
export function selectSoul(cfg, sel) {
  const at = sel.lastIndexOf("@"), who = at > 0 ? sel.slice(0, at) : sel, world = at > 0 ? sel.slice(at + 1) : null;
  const named = Object.entries(cfg.souls).filter(([id, e]) => (id === who || norm(e.name) === norm(who)) && (!world || e.world === world || e.at === world));
  const live = named.filter(([, e]) => e.state === "active");
  if (live.length === 1) return live[0][0];
  if (live.length > 1) throw new Error(`Several Souls answer to ${who}: ${live.map(([, e]) => `${norm(e.name)}@${e.world}`).join(", ")}. Say which.`);
  if (named.length) throw new Error(`${named[0][1].name} is ${named[0][1].state} and takes no commands here. See: list, doctor, adopt.`);
  return null;
}
export const looksLikeSelector = (cfg, word) => word.startsWith("@") ? !!cfg.worlds[word.slice(1)] : Object.entries(cfg.souls).some(([id, e]) => {
  const who = word.includes("@") ? word.slice(0, word.lastIndexOf("@")) : word;
  return id === who || norm(e.name) === norm(who);
});

/** Who a command speaks for: {soul: id}, {seat: worldKey} or {} when the home has no world yet. Pure. */
export function chooseContext(cfg, { cmd, selector, url, seatState = () => ({}) }) {
  const live = Object.entries(cfg.souls).filter(([, e]) => e.state === "active");
  const atWorld = selector?.startsWith("@") ? selector.slice(1) : null;
  const named = selector && !atWorld ? selectSoul(cfg, selector) : null;
  if (selector && !atWorld && !named) throw new Error(`No Soul here answers to ${selector}.`);
  if (SEAT_COMMANDS.has(cmd)) {
    if (cmd === "register" && url) return { seat: keyOf(cfg.worlds, url) };
    const chosen = atWorld ?? (named ? cfg.souls[named].world : null);
    if (chosen) return { seat: chosen };
    if (cmd === "approval") {
      const waiting = Object.keys(cfg.worlds).filter((k) => seatState(k).pendingApproval);
      if (!waiting.includes(cfg.currentWorld) && waiting.length > 1) throw new Error(`Approvals wait in several worlds (${waiting.join(", ")}). Say which: @${waiting[0]} approval wait`);
      if (!waiting.includes(cfg.currentWorld) && waiting.length === 1) return { seat: waiting[0] };
    }
    return cfg.currentWorld ? { seat: cfg.currentWorld } : {};
  }
  if (named) return { soul: named };
  if (atWorld) {
    const here = live.filter(([, e]) => (e.at ?? e.world) === atWorld);
    if (here.length === 1) return { soul: here[0][0] };
    if (here.length > 1) throw new Error(`Several Souls are in ${atWorld}: ${here.map(([, e]) => norm(e.name)).join(", ")}. Say which.`);
    return { seat: atWorld };
  }
  if (live.length === 1) return { soul: live[0][0] };
  if (live.length > 1) {
    if (cfg.default && cfg.souls[cfg.default]?.state === "active") return { soul: cfg.default };
    throw new Error(`Several Souls live here: ${live.map(([, e]) => norm(e.name)).join(", ")}. Name one first, like: node eden.mjs ${norm(live[0][1].name)} ${cmd ?? "here"} (or set one: default <name>)`);
  }
  return cfg.currentWorld ? { seat: cfg.currentWorld } : {};
}

/** The pids of runtime locks left in `dir` and whether each still lives. */
export function runtimeLocks(dir, alive) {
  const out = [];
  for (const name of RUNTIME_LOCKS) {
    const lock = readJsonQuietly(join(dir, name));
    if (lock) out.push({ name, pid: lock.pid ?? null, alive: Number.isSafeInteger(lock.pid) && lock.pid > 0 && alive(lock.pid) });
  }
  return out;
}
function readJsonQuietly(file) { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return existsSync(file) ? {} : null; } }

export function openHome(root, { reserved = new Set(), sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  const at = (...p) => join(root, ...p);
  const config = () => ({ worlds: {}, souls: {}, ...readJson(at("config.json"), {}) });
  const credentials = () => ({ souls: {}, worlds: {}, approvals: {}, ...readJson(at(CREDENTIALS), {}) });

  // Two chats in one home can finish a pairing at the same moment; a config or credentials change is one short exclusive step.
  function locked(fn) {
    const lock = at(".lock");
    for (let i = 0; ; i++) {
      try { closeSync(openSync(lock, "wx", 0o600)); break; }
      catch (e) {
        if (e.code !== "EEXIST") throw e;
        if (i >= 100) { try { unlinkSync(lock); } catch { /* the holder released it */ } } else sleepMs(20);
      }
    }
    try { return fn(); } finally { try { unlinkSync(lock); } catch { /* taken over */ } }
  }
  const updateConfig = (fn) => locked(() => { const c = config(), r = fn(c); writeJson(at("config.json"), c); return r; });
  // Most saves change no secret (a cursor moved): they neither lock nor write. `fn` must be safe to apply twice.
  function updateCredentials(fn) {
    const c = credentials(), before = JSON.stringify(c);
    fn(c);
    if (JSON.stringify(c) !== before) locked(() => { const fresh = credentials(); fn(fresh); writeJson(at(CREDENTIALS), fresh); });
  }

  /** The world's key in this home, added on first sight. */
  function ensureWorld(url, facts = {}) {
    return updateConfig((c) => {
      let key = keyOf(c.worlds, url);
      if (!key) { const base = slugOf(url); key = base; for (let n = 2; c.worlds[key]; n++) key = `${base}-${n}`; c.worlds[key] = { url }; }
      Object.assign(c.worlds[key], Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined)));
      return key;
    });
  }
  /** The one trust a home gives unasked: the first world a person registers, once it has answered. A home from before this
   *  has no such moment and trusts nothing until a person says so. Reading a world, a travel answer and an imported file,
   *  legacy or exported, never grant a site trust: anyone can write a file. */
  function madeFor(url) {
    if (config().awaitingFirstWorld) updateConfig((c) => { if (c.awaitingFirstWorld) { delete c.awaitingFirstWorld; c.trustedOrigins ??= [originOf(url)]; } });
  }
  const setCurrentWorld = (key) => updateConfig((c) => { c.currentWorld = key; });
  const seat = (key) => { const dir = at("pending", key); mkdirSync(dir, { recursive: true, mode: 0o700 }); return { kind: "seat", key, dir }; };
  // The id names a folder and it comes from a world or a file, so it must be one folder name here.
  const soul = (id) => { if (!SOUL_ID.test(id ?? "")) throw new Error(`"${String(id).slice(0, 40)}" is not a Soul id; nothing was kept for it.`); const dir = at("souls", id, "runtime"); mkdirSync(dir, { recursive: true, mode: 0o700 }); return { kind: "soul", id, dir }; };
  const seatState = (key) => readJson(at("pending", key, STATE_FILE), {});

  function load(ctx) {
    const s = { ...readJson(join(ctx.dir, STATE_FILE), {}) }, cfg = config(), creds = credentials();
    const key = keyOf(cfg.worlds, s.world) ?? ctx.key;
    const identity = (ctx.kind === "soul" ? creds.souls[ctx.id]?.[cfg.souls[ctx.id]?.world]?.identity : null) ?? creds.worlds[key]?.identity;
    if (identity) s.identity = identity;
    if (ctx.kind === "soul") {
      const token = creds.souls[ctx.id]?.[key]?.token;
      if (token) s.token = token;
      if (s.home) { const t = creds.souls[ctx.id]?.[keyOf(cfg.worlds, s.home.world)]?.token; if (t) s.home = { ...s.home, token: t }; }
    }
    if (s.pendingApproval) { const pollSecret = creds.approvals[key]?.pollSecret; if (pollSecret) s.pendingApproval = { ...s.pendingApproval, input: { ...s.pendingApproval.input, pollSecret } }; }
    return s;
  }

  /** The first token in a seat makes a Soul: its directory, its index entry. The seat stays for the world's next Soul. */
  function promote(ctx, open) {
    const id = open.home?.soul ?? open.soul;
    const { world, worldId, accountAuth } = open;
    writeJson(join(ctx.dir, STATE_FILE), Object.fromEntries(Object.entries({ world, worldId, accountAuth }).filter(([, v]) => v !== undefined)));
    Object.assign(ctx, soul(id));
    process.chdir(ctx.dir);
    // A kept Soul paired again in the same world goes on from where it was: same Soul, same stream, same cursor.
    const kept = readJson(join(ctx.dir, STATE_FILE), {});
    if (kept.world === world) for (const [k, v] of Object.entries(kept)) if (!(k in open)) open[k] = v;
    enlist(id, open, ctx.key);
  }
  function enlist(id, open, fallbackKey) {
    updateConfig((c) => {
      const { retiredAt, at: was, ...old } = c.souls[id] ?? {}, key = keyOf(c.worlds, open.world) ?? fallbackKey, home = open.home ? keyOf(c.worlds, open.home.world) ?? key : key;
      c.souls[id] = { name: id, ...old, world: old.world ?? home, ...(home !== key ? { at: key } : {}), state: "active" };
      c.currentWorld = key;
    });
    identify(id);
  }
  function identify(id) {
    const c = config(), e = c.souls[id];
    if (e) writeJson(at("souls", id, "soul.json"), { id, name: e.name, world: c.worlds[e.world]?.url ?? null });
  }

  function save(ctx, s) {
    const { open, secrets } = splitSecrets(s);
    let key = ctx.key;
    if (open.world) key = keyOf(config().worlds, open.world) ?? ensureWorld(open.world);
    const seatKey = ctx.kind === "seat" ? ctx.key : null;
    if (seatKey && open.soul && secrets.token) promote(ctx, open);
    writeJson(join(ctx.dir, STATE_FILE), open);
    if (ctx.kind === "soul") {
      const e = config().souls[ctx.id];
      if (e && (e.at ?? e.world) !== key) updateConfig((c) => { c.souls[ctx.id].at = key; });
    }
    updateCredentials((c) => {
      // The world's identity makes new Souls there and is only ever set from its seat; each Soul keeps its own (it travels).
      if (secrets.identity && seatKey) (c.worlds[seatKey] ??= {}).identity ??= secrets.identity;
      if (seatKey && secrets.pollSecret && ctx.kind === "seat") c.approvals[seatKey] = { pollSecret: secrets.pollSecret };
      else if (seatKey) delete c.approvals[seatKey];
      if (ctx.kind !== "soul") return;
      const mine = (c.souls[ctx.id] ??= {}), homeKey = open.home ? keyOf(config().worlds, open.home.world) ?? key : key;
      if (secrets.token) (mine[key] ??= {}).token = secrets.token;
      // Back home, the token just saved is the live one; `home` still names the one the journey left with.
      if (secrets.homeToken && homeKey !== key) (mine[homeKey] ??= {}).token = secrets.homeToken;
      if (secrets.identity) (mine[config().souls[ctx.id]?.world ?? homeKey] ??= {}).identity = secrets.identity;
    });
    return s;
  }

  /** Display name, from the world. */
  function named(id, name) {
    if (config().souls[id]?.name === name) return;
    updateConfig((c) => { if (c.souls[id]) c.souls[id].name = name; });
    identify(id);
  }

  function principals() {
    const c = config(), all = Object.entries(c.souls);
    return all.map(([id, e]) => {
      const twin = reserved.has(norm(e.name)) || all.some(([other, o]) => other !== id && o.state === "active" && norm(o.name) === norm(e.name));
      const state = readJson(at("souls", id, "runtime", STATE_FILE), {});
      return { name: e.name, id, world: e.world, ...(e.at && e.at !== e.world ? { visiting: e.at } : {}), state: e.state, address: twin ? `${norm(e.name)}@${e.world}` : norm(e.name), ...(c.default === id ? { default: true } : {}), lastSeen: state.lastActAt ?? null };
    });
  }

  function list() {
    const c = config();
    return {
      home: root, souls: principals(), worlds: Object.entries(c.worlds).map(([key, w]) => ({ key, url: w.url, name: w.name ?? null, current: c.currentWorld === key })),
      waiting: Object.keys(c.worlds).filter((k) => seatState(k).pendingApproval).map((world) => ({ world, approvalId: seatState(world).pendingApproval.approvalId })),
    };
  }

  function setDefault(sel) {
    const id = selectSoul(config(), sel);
    if (!id) throw new Error(`No Soul here answers to ${sel}.`);
    updateConfig((c) => { c.default = id; });
    return id;
  }

  /** Move a legacy folder's Soul in, keeping its token. The legacy file is left where it is. */
  function importLegacy(folder) {
    const legacy = JSON.parse(readFileSync(join(folder, LEGACY_STATE), "utf8"));
    if (!legacy.world) throw new Error(`${LEGACY_STATE} names no world; nothing to import.`);
    const s = Object.fromEntries(IMPORTED_FIELDS.filter((k) => legacy[k] !== undefined).map((k) => [k, legacy[k]]));
    s.token ??= legacy.delegations?.[s.soul]?.token;
    if (!s.token) delete s.token;
    const id = s.home?.soul ?? s.soul;
    if (id && config().souls[id]?.state === "active") return { imported: false, soul: id, reason: "This Soul already lives in this home." };
    const key = ensureWorld(s.world, { worldId: s.worldId, accountAuth: s.accountAuth });
    if (s.home?.world) ensureWorld(s.home.world);
    if (!id || !s.token) {   // a folder with no Soul yet is the world's seat, if that seat is free
      if (seatState(key).pendingApproval) throw new Error(`An approval already waits in ${key}. Finish it first: approval wait`);
      save(seat(key), { ...s, ...(legacy.pendingApproval ? { pendingApproval: legacy.pendingApproval } : {}) });
      setCurrentWorld(key);
      return { imported: true, soul: null, world: key };
    }
    if (!seatState(key).world) writeJson(join(seat(key).dir, STATE_FILE), Object.fromEntries(Object.entries({ world: s.world, worldId: s.worldId, accountAuth: s.accountAuth }).filter(([, v]) => v !== undefined)));
    const ctx = soul(id);
    enlist(id, s, key);
    save(ctx, s);
    updateCredentials((c) => { if (s.identity) (c.worlds[key] ??= {}).identity ??= s.identity; });
    for (const f of IMPORTED_RUNTIME) if (existsSync(join(folder, f))) copyFileSync(join(folder, f), join(ctx.dir, f));
    return { imported: true, soul: id, world: key, ctx };
  }

  /** The Soul without credentials or runtime: identity and whatever it has learned. */
  function exportSoul(id, out) {
    if (existsSync(out)) throw new Error(`${out} already exists; choose another --out.`);
    cpSync(at("souls", id), out, { recursive: true, filter: (p) => basename(p) !== "runtime" });
    return out;
  }
  /** An exported Soul comes in unpaired: everything but control. */
  function importExport(folder) {
    const me = JSON.parse(readFileSync(join(folder, "soul.json"), "utf8"));
    if (!SOUL_ID.test(me.id ?? "")) throw new Error("soul.json names no Soul.");
    if (config().souls[me.id]) return { imported: false, soul: me.id, reason: "This Soul already lives in this home." };
    const key = me.world ? ensureWorld(me.world) : null;
    cpSync(folder, at("souls", me.id), { recursive: true, filter: (p) => basename(p) !== "runtime" && basename(p) !== CREDENTIALS });
    updateConfig((c) => { c.souls[me.id] = { name: me.name ?? me.id, world: key, state: "unpaired" }; });
    return { imported: true, soul: me.id, world: key, paired: false };
  }

  /** The account against the home, world by world. `ask(url, bearer)` answers {status, data}. Prints no token. */
  async function doctor(ask, { alive }) {
    const out = { home: root, worlds: [], retired: [], adoptable: [], controlLost: [], orphanCredentials: [], locksCleared: [] };
    const retire = (id) => {
      updateConfig((c) => { c.souls[id].state = "retired"; c.souls[id].retiredAt = new Date().toISOString(); });
      out.retired.push({ id, name: config().souls[id].name });
    };
    const cfg = config(), creds = credentials();
    for (const [key, w] of Object.entries(cfg.worlds)) {
      const local = Object.entries(cfg.souls).filter(([, e]) => e.world === key && e.state === "active");
      // A home can hold Souls of several identities in one world (imported folders); the account is all of them together.
      const identities = [...new Set([creds.worlds[key]?.identity, ...local.map(([id]) => creds.souls[id]?.[key]?.identity)].filter(Boolean))];
      const answers = [];
      for (const identity of identities) answers.push(await ask(`${w.url}/v1/me`, `dev:${identity}`));
      const me = answers.find((a) => a.status === 0) ?? answers.find((a) => a.status !== 200) ?? answers[0];
      if (me?.status === 200 && answers.every((a) => Array.isArray(a.data?.souls))) {
        const owned = answers.flatMap((a) => a.data.souls), ids = new Set(owned.map((s) => s.id));
        // A Soul away on a journey is not this world's to list; its home says nothing about it until it is back.
        for (const [id, e] of local) if (!ids.has(id) && !(e.at && e.at !== e.world)) retire(id);
        for (const s of owned) {
          named(s.id, s.name);
          if (config().souls[s.id]?.state !== "active") out.adoptable.push({ id: s.id, name: s.name, world: key });
        }
        out.worlds.push({ world: key, checked: "account" });
        continue;
      }
      if (me?.status === 0) { out.worlds.push({ world: key, checked: "unreachable" }); continue; }
      // No account credential here: a delegated Soul token answers for its own Soul only.
      let reachable = true;
      for (const [id] of local) {
        const token = creds.souls[id]?.[key]?.token;
        if (!token) { out.controlLost.push({ id, name: cfg.souls[id].name, why: "no token in this home" }); continue; }
        const r = await ask(`${w.url}/v1/agent/me`, token);
        if (r.status === 0) { reachable = false; break; }
        if (r.status === 200) { if (r.data?.soul?.name) named(id, r.data.soul.name); continue; }
        // Only the world saying "retired" retires a Soul here; a refused token alone may just mean control moved.
        if (r.status === 401 && r.data?.code === "control.revoked" && r.data?.reason === "retired") retire(id);
        else out.controlLost.push({ id, name: cfg.souls[id].name, why: r.data?.reason ?? r.data?.code ?? `http-${r.status}` });
      }
      out.worlds.push({ world: key, checked: reachable ? "souls" : "unreachable", ...(reachable ? { note: "This world shows a Soul token its own Soul only, so account Souls that are not here cannot be listed. Adopt one by its id from the Soul card." } : {}) });
    }
    const after = config();
    for (const [id, worlds] of Object.entries(creds.souls)) if (!after.souls[id]) for (const world of Object.keys(worlds)) out.orphanCredentials.push({ principal: id, world });
    for (const world of Object.keys(creds.worlds)) if (!after.worlds[world]) out.orphanCredentials.push({ principal: "account", world });
    for (const id of existsSync(at("souls")) ? readdirSync(at("souls")) : []) {
      const dir = at("souls", id, "runtime");
      for (const lock of runtimeLocks(dir, alive)) {
        if (lock.alive) continue;
        try { unlinkSync(join(dir, lock.name)); out.locksCleared.push({ soul: id, lock: lock.name }); } catch { /* gone already */ }
        if (lock.name === ".eden-serve.lock") try { unlinkSync(join(dir, SERVE_SOCKET)); } catch { /* no socket left */ }
      }
    }
    if ((statSync(at(CREDENTIALS)).mode & 0o777) !== 0o600) { chmodSync(at(CREDENTIALS), 0o600); out.credentialsMode = "was too open; now 0600"; }
    out.healthy = !out.retired.length && !out.controlLost.length && !out.orphanCredentials.length && out.worlds.every((w) => w.checked !== "unreachable");
    return out;
  }

  /** Replace the home's bundle, and the running copy when it lives in this home's folder. Never older than either. */
  function installBundle(bytes, running, version) {
    if (!newerThan(version, config().client)) return null;
    mkdirSync(at("bin"), { recursive: true, mode: 0o700 });
    const write = (file) => { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, bytes, { mode: 0o755 }); renameSync(tmp, file); };
    write(at("bin", "eden.mjs"));
    if (running && dirname(real(running)) === dirname(real(root))) write(running);
    updateConfig((c) => { c.client = version; });
    return at("bin", "eden.mjs");
  }
  const trustOrigin = (origin) => updateConfig((c) => { c.trustedOrigins = [...new Set([...(c.trustedOrigins ?? []), origin])]; });

  return { root, config, installBundle, trustOrigin, madeFor, ensureWorld, setCurrentWorld, seat, soul, seatState, load, save, named, principals, list, setDefault, importLegacy, exportSoul, importExport, doctor };
}
