// The launcher's registry of local worlds (<dataDir>/worlds.json) and the
// genesis templates it offers (worlds/templates/*.json). Plain data, atomic
// writes; no world process is touched here.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { shadowsExisting } from './production.mjs';

export const SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/;
/** Names the server or the proxy already use for something else. */
export const RESERVED = new Set(['toy', 'mars', 'littlemartians', 'eden', 'assets', 'world-assets', 'mars-assets', 'api', 'new', 'sim', 'god', 'launcher', 'docs']);

/**
 * A URL-safe, unique slug for a human name ("Gene's Valley" → genes-valley, then genes-valley-2 …).
 * Names that would land under an existing release's world (`/w/mars*`, `/w/eden*` …) get a `my-`
 * prefix ("Mars" → my-mars, "Eden Garden" → my-eden-garden), so no Caddy glob can mis-route them.
 */
/**
 * Old worlds an operator may fork under the launcher's base (op register-fork), and only these: the one exception to
 * RESERVED. Public creation still maps these names to my-<name> (slugFor below), so nobody else can take them.
 */
export const FORK_SLUGS = Object.freeze(['eden', 'mars', 'littlemartians']);

export function slugFor(name, taken = new Set()) {
  let base = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(base)) base = `world-${base}`.replace(/-+$/, '');
  base = base.slice(0, 28).replace(/-+$/, '') || 'world';
  if (shadowsExisting(base)) base = `my-${base}`.slice(0, 28).replace(/-+$/, '');
  if (RESERVED.has(base)) base = `${base}-world`;
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  if (!SLUG_RE.test(slug)) throw new Error(`cannot make a slug from ${JSON.stringify(name)}`);
  return slug;
}

/** World process heap (LOAD-CONTRACT §4, lane L1): a registry entry's own `worldHeapMb` wins; otherwise the launcher's
 *  `--world-heap-mb` (a default only), else 1536 MB. Eden-2026-class worlds (its template, or > 3,000 entities last seen)
 *  get at least 2048 MB: the 768 MB launcher-wide cap was what Eden 2026 hit on 10-31. */
export const DEFAULT_WORLD_HEAP_MB = 1536, BIG_WORLD_HEAP_MB = 2048, BIG_WORLD_ENTITIES = 3000;
export function worldHeapMb(w, fallback = 0) {
  if (Number.isInteger(w?.worldHeapMb) && w.worldHeapMb >= 256) return w.worldHeapMb;
  const base = Number.isInteger(fallback) && fallback >= 256 ? fallback : DEFAULT_WORLD_HEAP_MB;
  const big = w?.template === 'eden-2026' || (Number(w?.entities) || 0) > BIG_WORLD_ENTITIES;
  return big ? Math.max(base, BIG_WORLD_HEAP_MB) : base;
}

/** Stage B (lane B-port): a world's read workers (LOAD-CONTRACT §4 `readWorkers`): its registry entry's `readWorkers`
 *  (0 = off, 1-4) wins; otherwise 1 when the launcher runs with SIM_READ_WORKER=1, else 0 (off: no read env, no ports). */
export const MAX_READ_WORKERS = 4;
export function readWorkersOf(w, env = process.env) {
  if (Number.isInteger(w?.readWorkers) && w.readWorkers >= 0) return Math.min(MAX_READ_WORKERS, w.readWorkers);
  return env.SIM_READ_WORKER === '1' ? 1 : 0;
}

/** Stable database identity and storage name survive a public URL rename. */
export const worldIdOf = (w) => w.worldId ?? `${w.slug}-1`;
export const dataSlugOf = (w) => w.dataSlug ?? w.slug;

export class Registry {
  constructor(dataDir) {
    this.dataDir = resolve(dataDir);
    this.file = join(this.dataDir, 'worlds.json');
    mkdirSync(this.dataDir, { recursive: true });
    this.worlds = [];
    this.legacyBases = [];
    this.extra = {};
    if (existsSync(this.file)) {
      const j = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!Array.isArray(j.worlds)) throw new Error(`${this.file}: not a worlds registry`);
      const { worlds, legacyBases, ...extra } = j;
      this.extra = extra;
      this.legacyBases = legacyBases ?? [];
      if (!Array.isArray(this.legacyBases) || this.legacyBases.length > 8 || this.legacyBases.some((b) => !/^\/[a-z][a-z0-9-]{0,31}$/.test(b))) throw new Error('invalid registry legacyBases');
      this.worlds = j.worlds.filter((w) => SLUG_RE.test(w?.slug ?? ''));
      const used = new Set(this.worlds.map((w) => w.slug));
      for (const w of this.worlds) {
        if (!SLUG_RE.test(dataSlugOf(w)) || (w.worldKey !== undefined && !SLUG_RE.test(w.worldKey)) || (w.worldId !== undefined && !/^[a-z][a-z0-9-]{0,63}$/.test(w.worldId))) throw new Error('invalid stable world identity');
        if (w.aliases !== undefined && (!Array.isArray(w.aliases) || w.aliases.length > 32)) throw new Error('invalid world aliases');
        for (const alias of w.aliases ?? []) { if (!SLUG_RE.test(alias) || used.has(alias)) throw new Error('world alias collision'); used.add(alias); }
      }
    }
  }
  get(slug) { return this.worlds.find((w) => w.slug === slug) ?? null; }
  resolveSlug(slug) { return this.get(slug)?.slug ?? this.worlds.find((w) => w.aliases?.includes(slug))?.slug ?? null; }
  slugs() { return new Set(this.worlds.flatMap((w) => [w.slug, ...(w.aliases ?? [])])); }
  add(entry) {
    if (this.slugs().has(entry.slug)) throw new Error(`world ${entry.slug} exists`);
    this.worlds.push(entry); this.save(); return entry;
  }
  update(slug, patch) { const w = this.get(slug); if (!w) return null; Object.assign(w, patch); this.save(); return w; }
  remove(slug) { this.worlds = this.worlds.filter((w) => w.slug !== slug); this.save(); }
  worldDir(slug, entry = this.get(slug)) { return join(this.dataDir, 'worlds', entry ? dataSlugOf(entry) : slug); }
  save() {
    if (this.frozen) return;   // handing over to a newer launcher (keeper.mjs): it owns the file now
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...this.extra, schema: 'world-launcher-registry/1', worlds: this.worlds, ...(this.legacyBases.length ? { legacyBases: this.legacyBases } : {}) }, null, 2) + '\n');
    renameSync(tmp, this.file);
  }
}

/** Every template on disk plus the built-in empty plain, in the order the dialog shows them. A template with
 *  `"hidden": true` (a retired one: mars-camp, superseded by mars-two) is left out of the dialog and cannot start a new
 *  world; `{ all: true }` still finds it, so worlds already made from it keep their genesis file. */
export function listTemplates(dir, { all = false } = {}) {
  const out = [{ id: 'empty', name: 'Empty plain', description: 'An open grass plain to build from scratch.', file: null, batches: 0 }];
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { /* no templates */ }
  const found = [];
  for (const f of files) {
    try {
      const g = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (g?.schema !== 'genesis/1' || !Array.isArray(g.batches)) continue;
      const id = basename(f, '.json');
      if (!SLUG_RE.test(id) || id === 'empty') continue;
      if (g.hidden === true && !all) continue;
      const ops = g.batches.reduce((n, b) => n + (Array.isArray(b.ops) ? b.ops.length : 0), 0);
      found.push({ id, name: typeof g.name === 'string' ? g.name : id, description: typeof g.description === 'string' ? g.description : '', file: join(dir, f), batches: g.batches.length, ops });
    } catch { /* a broken template is skipped, not fatal */ }
  }
  // Hello hamlet is the canonical starter: right after the empty plain.
  found.sort((a, b) => (a.id === 'hello-hamlet' ? -1 : b.id === 'hello-hamlet' ? 1 : a.name.localeCompare(b.name)));
  return [...out, ...found];
}

/**
 * listTemplates, parsed again only when the folder or a template file changes (looked at no more than every `everyMs`).
 * Every proxied request builds its world's environment (the genesis file), and parsing every template (~2 MB of JSON;
 * Eden 2026 alone is 1.8 MB) took 30-100 ms of the launcher's one event loop per request, so one busy world slowed
 * every other world (lane P2, 2026-10-19). Callers must not mutate the arrays returned.
 */
export function cachedTemplates(dir, { everyMs = 2000, now = Date.now } = {}) {
  const memo = new Map(); let sig = null, checked = -Infinity;
  const signature = () => {
    try { return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => { const s = statSync(join(dir, f)); return `${f}:${s.mtimeMs}:${s.size}`; }).join('|'); }
    catch { return ''; }
  };
  return ({ all = false } = {}) => {
    const t = now();
    if (t - checked >= everyMs) { checked = t; const s = signature(); if (s !== sig) { sig = s; memo.clear(); } }
    const key = all ? 'all' : 'shown';
    if (!memo.has(key)) memo.set(key, listTemplates(dir, { all }));
    return memo.get(key);
  };
}
