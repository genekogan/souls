// CW4 (#738): the bounded local telemetry store. One directory, telemetry only; gameplay data is never touched.
//
//   <dir>/fine/<YYYY-MM-DDTHH>.jsonl[.gz]   one file per UTC hour; closed hours are gzipped
//   <dir>/rollup/<YYYY-MM-DD>.jsonl[.gz]    one line per closed hour: every series reduced (reduce.mjs); closed days gzipped
//   <dir>/state.json                        format version, series types, loss counters
//
// A fine file is sparse: {"k":[keys]} declares series (appended with {"k+":[...]}), then each scrape is
// {"t":ms,"ok":1,"skewMs":n,"d":[[i,value|null],...]}: only the series whose value changed since the previous line
// (null = the series disappeared: absent, never 0). The first sample of a file lists every series. A failed scrape is
// {"t":ms,"ok":0,"error":"..."}: a gap, never zeros. Readers rebuild full rows (readHour).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { kindOf } from './prom.mjs';

export const STORE_VERSION = 1;
export const DEFAULTS = Object.freeze({ fineDays: 7, rollupDays: 90, maxBytes: 2 * 2 ** 30, everyMs: 15_000 });
const HOUR = 3_600_000, DAY = 24 * HOUR;
export const hourOf = (t) => Math.floor(t / HOUR) * HOUR;
export const hourName = (t) => new Date(hourOf(t)).toISOString().slice(0, 13);
export const dayName = (t) => new Date(t).toISOString().slice(0, 10);
// rollups keep six significant digits: enough for every reported figure, and a fraction of the bytes
const compact = (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v);
const parseHour = (n) => Date.parse(`${n.slice(0, 13)}:00:00Z`), parseDay = (n) => Date.parse(`${n.slice(0, 10)}T00:00:00Z`);

export class Store {
  constructor(dir, o = {}) {
    this.dir = dir; this.o = { ...DEFAULTS, ...o };
    mkdirSync(join(dir, 'fine'), { recursive: true }); mkdirSync(join(dir, 'rollup'), { recursive: true });
    this.state = { version: STORE_VERSION, types: {}, loss: { prunedByAge: 0, prunedBySize: 0, failedWrites: 0, skippedLines: 0 }, ...this.readState() };
    this.hour = null; this.keys = null; this.index = null; this.last = null;
  }
  readState() { try { return JSON.parse(readFileSync(join(this.dir, 'state.json'), 'utf8')); } catch { return {}; } }
  saveState() { try { writeFileSync(join(this.dir, 'state.json.tmp'), JSON.stringify(this.state) + '\n'); renameSync(join(this.dir, 'state.json.tmp'), join(this.dir, 'state.json')); } catch { this.state.loss.failedWrites++; } }
  file(h) { return join(this.dir, 'fine', `${hourName(h)}.jsonl`); }

  /** One scrape: {t, ok, error?, skewMs?, samples?: [{key, value}], types?}. Never throws: a failed write is counted. */
  append(s) {
    try {
      const h = hourOf(s.t);
      if (this.hour !== h) this.openHour(h, s.t);
      if (s.types) for (const [k, v] of Object.entries(s.types)) if (this.state.types[k] !== v) { this.state.types[k] = v; this.typesDirty = true; }
      if (!s.ok) { appendFileSync(this.file(h), JSON.stringify({ t: s.t, ok: 0, error: String(s.error ?? 'error').slice(0, 200) }) + '\n'); this.last = null; return true; }
      const fresh = []; for (const x of s.samples) if (!this.index.has(x.key)) { this.index.set(x.key, this.keys.length); this.keys.push(x.key); fresh.push(x.key); }
      if (fresh.length) appendFileSync(this.file(h), JSON.stringify({ 'k+': fresh }) + '\n');
      const now = new Map(s.samples.map((x) => [this.index.get(x.key), x.value])), d = [];
      for (const [i, v] of now) if (!this.last || this.last.get(i) !== v) d.push([i, v]);
      if (this.last) for (const i of this.last.keys()) if (!now.has(i)) d.push([i, null]);
      appendFileSync(this.file(h), JSON.stringify({ t: s.t, ok: 1, ...(s.skewMs != null ? { skewMs: Math.round(s.skewMs) } : {}), d }) + '\n');
      this.last = now;
      if (this.typesDirty) { this.typesDirty = false; this.saveState(); }
      return true;
    } catch { this.state.loss.failedWrites++; this.last = null; return false; }
  }
  /** A new hour: close (roll up + gzip) every earlier open hour, then start this one with an empty dictionary. */
  openHour(h, now) {
    this.close(now);
    this.hour = h; this.keys = []; this.index = new Map(); this.last = null;
    if (existsSync(this.file(h))) { const r = readHour(this.file(h)); this.keys = r.keys; this.index = new Map(r.keys.map((k, i) => [k, i])); }   // a collector restart continues its hour
    appendFileSync(this.file(h), JSON.stringify({ k: [] }) + '\n');   // an empty declaration marks a (re)start boundary; the next line lists every series
  }
  /** Roll up and gzip every finished hour that is still plain (also after a crash), then prune. */
  close(now = Date.now(), reduceHour) {
    for (const f of readdirSync(join(this.dir, 'fine')).filter((x) => x.endsWith('.jsonl')).sort()) {
      const h = parseHour(f); if (h >= hourOf(now)) continue;
      try {
        const rows = readHour(join(this.dir, 'fine', f));
        if (reduceHour ?? this.o.reduceHour) appendFileSync(join(this.dir, 'rollup', `${dayName(h)}.jsonl`), JSON.stringify((reduceHour ?? this.o.reduceHour)(h, rows, this.state.types, this.o.everyMs), compact) + '\n');
        writeFileSync(join(this.dir, 'fine', `${f}.gz`), gzipSync(readFileSync(join(this.dir, 'fine', f)))); unlinkSync(join(this.dir, 'fine', f));
      } catch { this.state.loss.failedWrites++; }
    }
    for (const f of readdirSync(join(this.dir, 'rollup')).filter((x) => x.endsWith('.jsonl') && x.slice(0, 10) < dayName(now))) {
      try { writeFileSync(join(this.dir, 'rollup', `${f}.gz`), gzipSync(readFileSync(join(this.dir, 'rollup', f)))); unlinkSync(join(this.dir, 'rollup', f)); } catch { this.state.loss.failedWrites++; }
    }
    this.prune(now); this.saveState();
  }
  /** Retention by age, then the hard size cap (oldest fine first, then oldest rollups). Telemetry files only. */
  prune(now = Date.now()) {
    const fine = readdirSync(join(this.dir, 'fine')).sort(), roll = readdirSync(join(this.dir, 'rollup')).sort(), rm = (p) => { try { unlinkSync(p); return true; } catch { return false; } };
    for (const f of fine) if (parseHour(f) < now - this.o.fineDays * DAY && rm(join(this.dir, 'fine', f))) this.state.loss.prunedByAge++;
    for (const f of roll) if (parseDay(f) < now - this.o.rollupDays * DAY && rm(join(this.dir, 'rollup', f))) this.state.loss.prunedByAge++;
    const files = () => [...readdirSync(join(this.dir, 'fine')).sort().map((f) => join(this.dir, 'fine', f)), ...readdirSync(join(this.dir, 'rollup')).sort().map((f) => join(this.dir, 'rollup', f))];
    let all = files(), size = all.reduce((n, p) => n + statSync(p).size, 0);
    const open = this.hour != null ? this.file(this.hour) : null;
    for (const p of all) { if (size <= this.o.maxBytes) break; if (p === open) continue; const b = statSync(p).size; if (rm(p)) { size -= b; this.state.loss.prunedBySize++; } }
    this.bytes = size;
    return size;
  }
}

/** A fine file back into full rows: {keys, rows: [{t, ok, error?, skewMs?, values: Map<key, number>}], restarts}. */
export function readHour(file) {
  const text = file.endsWith('.gz') ? gunzipSync(readFileSync(file)).toString('utf8') : readFileSync(file, 'utf8');
  const keys = [], rows = []; let cur = new Map(), restarts = 0, skipped = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { skipped++; continue; }   // a torn last line after a crash
    if (o.k) { if (!o.k.length) { restarts++; cur = new Map(); } keys.push(...o.k); continue; }
    if (o['k+']) { keys.push(...o['k+']); continue; }
    if (!o.ok) { rows.push({ t: o.t, ok: false, error: o.error }); cur = new Map(); continue; }
    for (const [i, v] of o.d) { if (v === null) cur.delete(keys[i]); else cur.set(keys[i], v); }
    rows.push({ t: o.t, ok: true, skewMs: o.skewMs ?? null, values: new Map(cur) });
  }
  return { keys, rows, restarts: Math.max(0, restarts - 1), skipped };
}

/** Every fine file overlapping [from, to), oldest first. */
export function fineFiles(dir, from, to) {
  return readdirSync(join(dir, 'fine')).filter((f) => /\.jsonl(\.gz)?$/.test(f)).sort().filter((f) => { const h = parseHour(f); return h + HOUR > from && h < to; }).map((f) => join(dir, 'fine', f));
}
/** Every rollup line with an hour in [from, to). */
export function rollups(dir, from, to) {
  const out = [];
  for (const f of readdirSync(join(dir, 'rollup')).sort()) {
    const d = parseDay(f); if (d + DAY <= from || d >= to) continue;
    const p = join(dir, 'rollup', f), body = f.endsWith('.gz') ? gunzipSync(readFileSync(p)).toString('utf8') : readFileSync(p, 'utf8');
    for (const line of body.split('\n')) { if (!line) continue; try { const r = JSON.parse(line); if (r.hour >= from && r.hour < to) out.push(r); } catch { /* torn */ } }
  }
  return out;
}
export { kindOf };
