// The site owner's one-page health dashboard (lane DASH, 2026-10-21): GET <base>/__sim/health.
//   plain GET   a static page shell (inline CSS/JS, light/dark, phone width) with NO data in it; it fetches ?json=1 every 30 s
//   ?json=1     the numbers, for the operator on loopback or a Clerk session (Authorization Bearer, or the __session cookie)
//               whose account is a site owner: SIM_SITE_OWNERS (comma list), else CATALOG_GENE_OWNER_ID, else the god of
//               the flagship world eden-2026. Anyone else: 401 (not signed in) or 403 (signed in, not an owner).
// The JSON never waits on a slow world: every world /healthz has a 200 ms budget (in parallel, frozen worlds are skipped and
// keep their last answer), Souls come from the launcher's cached stats (refreshed in the background), the last god edit is
// found by a chunked read-only scan that runs between requests. Target: < 300 ms server time (`ms` in the JSON).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, statfsSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const LINUX = process.platform === 'linux';
// As deploy/host-health.mjs reads them (not imported: a launcher runs without its deploy/ dir, e.g. keeper.test.mjs's releases).
const CGROUP_SLICE = '/sys/fs/cgroup/system.slice/system-sim\\x2dworlds.slice';
function readCgroup(dir) {
  const num = (f) => { const v = readFileSync(join(dir, f), 'utf8').trim(); return v === 'max' ? null : Number(v); };
  const stat = readFileSync(join(dir, 'memory.stat'), 'utf8'), events = readFileSync(join(dir, 'memory.events'), 'utf8');
  const field = (text, k) => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(text)?.[1] ?? 0);
  return { workingBytes: num('memory.current') - field(stat, 'inactive_file'), maxBytes: num('memory.max'), oomKills: field(events, 'oom_kill') };
}
const WORLD_BUDGET_MS = 200, EDIT_CHUNK = 20_000, FLAGSHIP = 'eden-2026';
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const iso = (t) => (Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null);
const run = (cmd, args, ms = 1500) => new Promise((done) => {
  try { execFile(cmd, args, { timeout: ms, encoding: 'utf8' }, (e, out) => done(e && !out ? null : String(out ?? ''))); } catch { done(null); }
});
/** A JWT's exp (seconds) without verifying it: only used to bound a cache entry for a token already verified. */
const jwtExp = (t) => { try { return Number(JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')).exp) || 0; } catch { return 0; } };
const cookie = (req, name) => {
  for (const part of String(req.headers.cookie ?? '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return null;
};

/**
 * A stage's last backup. backup-last.json (written by deploy/backup-restic.mjs) is the record; until its first nightly run
 * after a release has written one (fixup 2026-10-21: the 3.60 page alerted "no backup in its record" on both stages while
 * their backups were fine), fall back read-only to the newest success host-health saw (the backup unit's last successful
 * run) or the newest dated copy under <backupRoot>/<stage>/YYYYMMDD (deploy/backup.mjs), whichever is later.
 * `source` says which: 'record' | 'unit' | 'dated'. null when there is nothing at all.
 */
export function lastBackup(dir, stage, timer, backupRoot) {
  const rec = readJson(join(dir, 'backup-last.json'));
  if (rec) return { ...rec, source: 'record' };
  const seen = [];
  if (timer?.result === 'success' && Number.isFinite(Date.parse(timer.endedAt))) seen.push({ at: timer.endedAt, ok: true, source: 'unit' });
  try {
    const n = readdirSync(join(backupRoot, stage)).filter((x) => /^\d{8}$/.test(x)).sort().at(-1);
    if (n) seen.push({ at: statSync(join(backupRoot, stage, n)).mtime.toISOString(), ok: true, source: 'dated', name: n });
  } catch { /* no dated copies */ }
  return seen.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
}

/**
 * @param {{ dataDir: string, build: string, base: string, registry: any, pool: any, live: Map<string, number>,
 *           stats: Map<string, any>, refreshStats: (w: any) => Promise<void>, errors: any, hostHealth: () => any,
 *           auth: any, verify: (authorization: string) => Promise<string|null>, worldOwner: (slug: string) => string|null,
 *           wp: (slug: string) => string, backupRoot?: string, now?: () => number }} o
 */
export function healthDash(o) {
  const now = o.now ?? Date.now;
  const backupRoot = o.backupRoot ?? process.env.SIM_BACKUP_ROOT ?? '/srv/sim-worlds-backups';

  // ---------- who may read the numbers
  function owners() {
    const list = String(process.env.SIM_SITE_OWNERS || process.env.CATALOG_GENE_OWNER_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return new Set(list);
    const flag = o.registry.get(FLAGSHIP) ? (() => { try { return o.worldOwner(FLAGSHIP); } catch { return null; } })() : null;
    return new Set(flag ? [flag] : []);
  }
  const verified = new Map();   // sha256(token) → { account|null, until }
  let verifying = 0;
  async function accountOf(token) {
    const key = createHash('sha256').update(token).digest('hex'), t = now(), hit = verified.get(key);
    if (hit && hit.until > t) return hit.account;
    if (verifying >= 2) return undefined;   // a burst of tokens: never more than two verifier children at once
    verifying++;
    try {
      const account = await o.verify(`Bearer ${token}`);
      const exp = jwtExp(token) * 1000;
      if (verified.size > 200) verified.clear();
      verified.set(key, { account, until: account ? Math.min(exp || t + 60_000, t + 10 * 60_000) : t + 60_000 });
      return account;
    } finally { verifying--; }
  }
  /** 200 = may read; 401 = not signed in (or the sign-in did not verify); 403 = signed in, not a site owner; 429 = busy. */
  async function allowed(req, direct) {
    if (direct) return 200;
    if (!o.auth) return 401;   // a dev launcher: the operator on loopback only
    const token = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''))?.[1] ?? cookie(req, '__session');
    if (!token || token.length > 32768) return 401;
    const account = await accountOf(token);
    if (account === undefined) return 429;
    if (!account) return 401;
    return owners().has(account) ? 200 : 403;
  }

  // ---------- sim-watch (team/ops/sim-watch): its last request, and what it said was down
  let watch = null;
  function noteWatch(req) {
    const ua = String(req.headers['user-agent'] ?? '');
    if (!/^sim-watch\//.test(ua)) return;
    const down = req.headers['x-sim-watch-down'];
    watch = { at: now(), ...(down !== undefined ? { down: String(down).replace(/[^\w .,:()@/-]/g, '').slice(0, 300) } : watch?.down !== undefined ? { down: watch.down } : {}) };
  }

  // ---------- host
  let cpuPrev = { at: now(), t: cpuTimes() };
  function cpuTimes() { let idle = 0, total = 0; for (const c of cpus()) { const x = c.times; idle += x.idle; total += x.user + x.nice + x.sys + x.irq + x.idle; } return { idle, total }; }
  function cpuPct() {
    const t = cpuTimes(), d = t.total - cpuPrev.t.total, pct = d > 0 ? Math.round(1000 * (1 - (t.idle - cpuPrev.t.idle) / d)) / 10 : null;
    if (now() - cpuPrev.at > 5000) cpuPrev = { at: now(), t };
    return pct;
  }
  function memory() {
    if (LINUX) {
      try {
        const m = readFileSync('/proc/meminfo', 'utf8'), kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(m)?.[1] ?? NaN);
        return { totalMb: Math.round(kb('MemTotal') / 1024), availableMb: Math.round(kb('MemAvailable') / 1024), swapUsedMb: Math.round((kb('SwapTotal') - kb('SwapFree')) / 1024) };
      } catch { /* fall through */ }
    }
    return { totalMb: Math.round(totalmem() / 2 ** 20), availableMb: Math.round(freemem() / 2 ** 20), swapUsedMb: null };
  }
  function units(host) {
    const out = {};
    if (LINUX && existsSync(CGROUP_SLICE)) {
      try {
        for (const d of readdirSync(CGROUP_SLICE)) {
          const m = /^sim-worlds@([\w-]+)\.service$/.exec(d); if (!m) continue;
          try { const u = readCgroup(join(CGROUP_SLICE, d)); out[m[1]] = { workingMb: Math.round(u.workingBytes / 2 ** 20), maxMb: u.maxBytes ? Math.round(u.maxBytes / 2 ** 20) : null, pct: u.maxBytes ? +(100 * u.workingBytes / u.maxBytes).toFixed(1) : null, oomKills: u.oomKills }; } catch { /* gone */ }
        }
      } catch { /* unreadable */ }
    }
    return Object.keys(out).length ? out : host?.units ?? {};
  }
  function disk() {
    try { const s = statfsSync('/'); const total = s.blocks * s.bsize, free = s.bavail * s.bsize; return { freeGb: +(free / 1e9).toFixed(1), totalGb: +(total / 1e9).toFixed(1), freePct: +(100 * free / total).toFixed(1) }; } catch { return null; }
  }
  let caddy = { at: 0, v: null };
  async function caddyState() {
    if (!LINUX) return null;
    if (now() - caddy.at < 30_000) return caddy.v;
    const out = await run('systemctl', ['is-active', 'caddy'], 1000);
    caddy = { at: now(), v: out === null ? caddy.v : out.trim() || 'unknown' };
    return caddy.v;
  }

  // ---------- worlds
  const tick = new Map();   // slug → { at, tickMs, clockRate } (the last answer; a world that did not answer in time keeps it)
  async function worldHealth(w, st) {
    if (st.status !== 'running' || st.frozen || !st.port) return;
    try {
      const r = await fetch(`http://127.0.0.1:${st.port}${o.wp(w.slug)}/healthz`, { signal: AbortSignal.timeout(WORLD_BUDGET_MS) });
      if (!r.ok) return;
      const h = await r.json();
      tick.set(w.slug, { at: now(), tickMs: h.tickMs ?? null, clockRate: typeof h.clockRate === 'number' ? h.clockRate : null });
    } catch { /* slow or busy: keep the last answer */ }
  }
  let rssCache = { at: 0, v: new Map() };
  async function rssOf(pids) {
    const v = new Map();
    if (LINUX) {
      for (const pid of pids) { try { const kb = Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]); if (kb) v.set(pid, Math.round(kb / 1024)); } catch { /* exited */ } }
      return v;
    }
    if (!pids.length) return v;
    if (now() - rssCache.at < 5000) return rssCache.v;
    const out = await run('ps', ['-o', 'pid=,rss=', '-p', pids.join(',')], WORLD_BUDGET_MS);
    for (const line of String(out ?? '').split('\n')) { const [p, r] = line.trim().split(/\s+/).map(Number); if (p && r) v.set(p, Math.round(r / 1024)); }
    rssCache = { at: now(), v };
    return v;
  }

  // The last god edit per world: the newest `world-edit` event, found without a long synchronous scan. Each pass reads at
  // most EDIT_CHUNK sequence numbers per world (new events since the last pass first, then further back until one is found).
  const edits = new Map();   // slug → { worldId, top, low, at|null, done }
  let scanning = false;
  function editAt(slug) { return edits.get(slug)?.at ?? null; }
  function scanEdits() {
    if (scanning) return; scanning = true;
    const slugs = o.registry.worlds.map((w) => w.slug); let i = 0;
    const step = () => {
      const t0 = performance.now();
      while (i < slugs.length && performance.now() - t0 < 15) scanOne(slugs[i++]);
      if (i < slugs.length) setImmediate(step); else scanning = false;
    };
    setImmediate(step);
  }
  function scanOne(slug) {
    const file = join(o.registry.worldDir(slug), 'sim.db');
    if (!existsSync(file)) return;
    let db;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      let e = edits.get(slug);
      if (!e) {
        const head = db.prepare('SELECT world_id AS w, seq FROM events ORDER BY world_id DESC, seq DESC LIMIT 1').get();
        if (!head) return;
        e = { worldId: head.w, top: head.seq, low: head.seq, at: null, seq: null, done: false }; edits.set(slug, e);
        const r = db.prepare("SELECT seq, at FROM events WHERE world_id=? AND seq<=? AND seq>? AND kind='world-edit' ORDER BY seq DESC LIMIT 1").get(e.worldId, e.top, e.top - EDIT_CHUNK);
        e.low = e.top - EDIT_CHUNK; if (r) { e.at = r.at; e.seq = r.seq; e.done = true; }
        if (e.low <= 0) e.done = true;
        return;
      }
      const top = db.prepare('SELECT max(seq) AS s FROM events WHERE world_id=?').get(e.worldId)?.s ?? e.top;
      if (top > e.top) {
        const from = Math.max(e.top, top - EDIT_CHUNK);
        const r = db.prepare("SELECT seq, at FROM events WHERE world_id=? AND seq<=? AND seq>? AND kind='world-edit' ORDER BY seq DESC LIMIT 1").get(e.worldId, top, from);
        if (r) { e.at = r.at; e.seq = r.seq; e.done = true; }
        e.top = top;
      }
      if (!e.done) {
        const r = db.prepare("SELECT seq, at FROM events WHERE world_id=? AND seq<=? AND seq>? AND kind='world-edit' ORDER BY seq DESC LIMIT 1").get(e.worldId, e.low, e.low - EDIT_CHUNK);
        e.low -= EDIT_CHUNK; if (r) { e.at = r.at; e.seq = r.seq; e.done = true; } else if (e.low <= 0) e.done = true;
      }
    } catch { /* busy or not a world store */ } finally { try { db?.close(); } catch { /* closed */ } }
  }

  // ---------- release, backups, drill
  function stages() {
    const root = dirname(o.dataDir), out = [];
    let names = []; try { names = readdirSync(root); } catch { /* none */ }
    for (const n of names.slice(0, 40)) {
      const d = join(root, n);
      if (d !== o.dataDir && !existsSync(join(d, 'keeper.json')) && !existsSync(join(d, 'backup-last.json'))) continue;
      out.push({ stage: n, dir: d, self: d === o.dataDir });
    }
    if (!out.some((s) => s.self)) out.unshift({ stage: basename(o.dataDir), dir: o.dataDir, self: true });
    return out.slice(0, 8);
  }
  function drill() {
    let names = []; try { names = readdirSync(backupRoot).filter((n) => /^drill-/.test(n)).sort(); } catch { return null; }
    const n = names.at(-1); if (!n) return null;
    const dir = join(backupRoot, n), r = readJson(join(dir, 'RESTORED.json'));
    if (r) return { name: n, at: r.at ?? null, ok: r.ok ?? null, snapshot: r.snapshot ?? null, snapshotTime: r.snapshotTime ?? null, dbs: r.dbs ?? null, dbsOk: r.dbsOk ?? null };
    let mtime = null; try { mtime = statSync(dir).mtime.toISOString(); } catch { /* gone */ }
    return { name: n, at: mtime, ok: null };
  }

  // ---------- the numbers
  async function json() {
    const t0 = performance.now(), t = now();
    const host = o.hostHealth();
    const worlds = o.registry.worlds.map((w) => ({ w, st: o.pool.status(w.slug), kid: o.pool.kids?.get(w.slug) }));
    for (const { w, st } of worlds) if (st.status === 'running' && !st.frozen) o.refreshStats(w).catch(() => {});   // not awaited: the cached Souls answer
    const pids = worlds.map((x) => x.st.pid).filter(Boolean);
    const [rss, caddyNow] = await Promise.all([rssOf(pids), caddyState(), ...worlds.map(({ w, st }) => worldHealth(w, st))]);
    scanEdits();

    const rows = worlds.map(({ w, st, kid }) => {
      const s = o.stats.get(w.slug), h = tick.get(w.slug);
      return { slug: w.slug, name: w.name ?? w.slug, template: w.template ?? null, status: st.status, viewers: o.live.get(w.slug) ?? 0,
        lastVisit: iso(kid?.lastUsed ?? w.lastLookAt ?? null), rssMb: st.pid ? rss.get(st.pid) ?? null : null, souls: s?.souls ?? w.souls ?? null,
        entities: s?.entities ?? w.entities ?? null, tickMs: h?.tickMs ?? null, clockRate: h?.clockRate ?? null, tickAt: iso(h?.at), lastEdit: iso(editAt(w.slug)),
        restarts: st.restarts ?? 0, ...(st.restartsByReason ? { restartsByReason: st.restartsByReason } : {}), watchdogPort: st.healthPort ?? null, ...(st.held ? { held: st.held } : {}), ...(o.ceilings ? { limits: o.ceilings.limits(w.slug), refused: o.ceilings.refused(w.slug) } : {}), upSince: iso(st.upSince), lastExit: st.lastExit ? { code: st.lastExit.code ?? null, signal: st.lastExit.signal ?? null, at: iso(st.lastExit.at) } : null };
    }).sort((a, b) => (b.viewers - a.viewers) || String(b.lastVisit ?? '').localeCompare(String(a.lastVisit ?? '')));

    const keeper = readJson(join(o.dataDir, 'keeper.json'));
    const st = stages().map((s) => {
      const k = s.self ? keeper : readJson(join(s.dir, 'keeper.json'));
      return { stage: s.stage, self: s.self, build: s.self ? o.build : k?.active?.build ?? null, since: k?.active?.since ?? null,
        backup: lastBackup(s.dir, s.stage, host?.backups?.[s.stage], backupRoot), timer: host?.backups?.[s.stage] ?? null };
    });
    const mem = memory();
    const errs = o.errors.summary({ limit: 20 });
    const out = {
      ok: true, at: iso(t),
      build: { build: o.build, since: keeper?.active?.since ?? null, generation: keeper?.active?.gen ?? null },
      host: { load: loadavg().map((x) => Math.round(10 * x) / 10), cpus: cpus().length, cpuPct: cpuPct(), memory: mem, units: units(host), disk: disk(),
        uptimeH: Math.round(uptime() / 360) / 10, caddy: caddyNow, check: host ? { ok: host.ok, at: host.at ?? null, stale: !!host.stale, problems: host.problems ?? [], codes: host.codes ?? [] } : null },
      stages: st, drill: drill(),
      worlds: rows, totals: { worlds: rows.length, running: rows.filter((r) => r.status === 'running').length, viewers: rows.reduce((n, r) => n + r.viewers, 0) },
      arrivals: errs.arrivals,
      errors: { newSinceRelease: errs.newSinceRelease, kinds: errs.kinds, top: errs.top.filter((r) => r.new).slice(0, 8).map((r) => ({ kind: r.kind, message: r.message, source: r.source, count: r.count, visitors: r.visitors, first: r.first, last: r.last, worlds: Object.keys(r.worlds ?? {}).slice(0, 4) })) },
      watch: watch ? { at: iso(watch.at), ...(watch.down !== undefined ? { down: watch.down } : {}) } : null,
    };
    out.alerts = alerts(out, t);
    out.ms = Math.round(10 * (performance.now() - t0)) / 10;
    return out;
  }

  function alerts(d, t) {
    const a = [], bad = (text) => a.push({ level: 'bad', text }), warn = (text) => a.push({ level: 'warn', text });
    const ago = (s) => (s ? (t - Date.parse(s)) / 3_600_000 : Infinity);
    if (d.host.check && !d.host.check.ok) for (const p of d.host.check.problems.length ? d.host.check.problems : [d.host.check.stale ? 'host check is stale (no run in 30 min)' : 'host check failed']) bad(`host: ${p}`);
    if (LINUX && !d.host.check) warn('host check has never run (sim-worlds-health timer)');
    if (d.host.caddy && d.host.caddy !== 'active') bad(`caddy is ${d.host.caddy}`);
    if (d.host.disk && d.host.disk.freePct < 15) bad(`disk free ${d.host.disk.freePct}%`);
    for (const r of d.worlds) {
      if (r.status === 'failed' || r.status === 'restarting') bad(`${r.slug}: ${r.status} (restarts ${r.restarts})`);
      if (r.tickMs && r.tickMs.avg > 50) warn(`${r.slug}: ticks average ${r.tickMs.avg} ms (budget 50 ms)`);
      if (typeof r.clockRate === 'number' && r.clockRate < 0.9) warn(`${r.slug}: clock running at ${Math.round(100 * r.clockRate)}%`);
    }
    for (const s of d.stages) {
      if (s.backup && s.backup.ok === false) bad(`${s.stage} backup failed${s.backup.error ? `: ${String(s.backup.error).slice(0, 120)}` : ''}`);
      // No backup seen at all (a new stage before its first night) is not an alert: the page says when the first record comes.
      if (s.timer?.enabled && s.backup?.at && ago(s.backup.at) > 26) warn(`${s.stage}: no backup in ${Number.isFinite(ago(s.backup.at)) ? `${Math.round(ago(s.backup.at))} h` : 'its record'}`);
    }
    if (d.drill && d.drill.ok === false) bad(`restore drill ${d.drill.name} failed`);
    if (d.errors.newSinceRelease > 0) warn(`${d.errors.newSinceRelease} new client error kind${d.errors.newSinceRelease === 1 ? '' : 's'} since this release`);
    if (d.watch?.down) bad(`sim-watch reports down: ${d.watch.down}`);
    if (LINUX && (!d.watch || ago(d.watch.at) > 0.5)) warn(d.watch ? `sim-watch last checked ${Math.round(60 * ago(d.watch.at))} min ago` : 'sim-watch has not checked since this launcher started');
    return a;
  }

  return { allowed, json, noteWatch, owners, shell: () => shell(o.auth?.public ?? { provider: 'dev' }) };
}

/** The page: no numbers in it, only how to fetch them (the publishable key is public, the homepage serves it too). */
function shell(pub) {
  const cfg = JSON.stringify({ provider: pub.provider, key: pub.clerkPublishableKey ?? null }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><link rel="icon" href="data:,"><meta name="color-scheme" content="light dark"><title>Souls health</title>
<style>
:root{--bg:#f6f5f1;--fg:#1d1c1a;--mute:#6b6862;--line:#dedbd3;--card:#fff;--ok:#2f7d4f;--warn:#a26200;--bad:#b3261e;--chip:#efede7}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#e9e7e1;--mute:#9a968e;--line:#2c2b28;--card:#1c1b19;--ok:#5fbf86;--warn:#e0a03a;--bad:#ef6b62;--chip:#262522}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg)}
body{font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:20px 16px 48px;max-width:1100px;margin:0 auto}
h1{font-size:18px;margin:0;font-weight:600}h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin:28px 0 8px;font-weight:600}
.num,td.n,.mono{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
header{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:12px}
header .sub{color:var(--mute)}#state{margin-left:auto;color:var(--mute)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:1px;background:var(--mute)}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.dot.ok{background:var(--ok)}.dot.warn{background:var(--warn)}.dot.bad{background:var(--bad)}
ul.alerts{list-style:none;margin:0;padding:0}ul.alerts li{padding:6px 0;border-bottom:1px solid var(--line)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px}.tile .k{color:var(--mute);font-size:12px}.tile .v{font-size:15px;margin-top:2px}.tile .v .muted{font-size:12px}
h2 .muted{text-transform:none;letter-spacing:0;font-weight:400;margin-left:6px}
.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--card)}
table{border-collapse:collapse;width:100%}th,td{padding:7px 10px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-weight:500;color:var(--mute);font-size:12px}tr:last-child td{border-bottom:0}td.n,th.n{text-align:right}
.chip{display:inline-block;padding:1px 7px;border-radius:9px;background:var(--chip);font-size:12px}
.msg{white-space:normal;min-width:220px;word-break:break-word}
#gate{margin:48px 0;text-align:center;color:var(--mute)}#gate button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
.muted{color:var(--mute)}
@media (max-width:600px){body{padding:14px 16px 40px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hide-s{display:none}}
</style></head><body>
<header><h1>Souls health</h1><span class="sub mono" id="build"></span><span id="state">loading…</span></header>
<div id="gate" hidden></div><main id="main" hidden></main>
<script>
const CFG=${cfg};let token=null,clerk=null,timer=null,last=null;
const $=(s)=>document.querySelector(s),esc=(v)=>String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ago=(s)=>{if(!s)return'—';const m=(Date.now()-Date.parse(s))/60000;if(m<1)return'now';if(m<60)return Math.round(m)+' min ago';if(m<2880)return Math.round(m/60)+' h ago';return Math.round(m/1440)+' d ago'};
const fmt=(v,u='')=>v==null?'—':v+u;
function fapi(k){try{return atob(k.split('_')[2]).replace(/\\$$/,'')}catch{return null}}
async function signIn(){
  if(CFG.provider!=='clerk'||!CFG.key)return gate('Owner only. Open this page from the server itself.');
  if(!clerk){const host=fapi(CFG.key);if(!host)return gate('Sign-in is not configured.');
    await new Promise((ok,no)=>{const s=document.createElement('script');s.src='https://'+host+'/npm/@clerk/clerk-js@5/dist/clerk.browser.js';s.async=true;s.crossOrigin='anonymous';s.dataset.clerkPublishableKey=CFG.key;s.onload=ok;s.onerror=no;document.head.appendChild(s)}).catch(()=>{});
    if(!window.Clerk)return gate('Could not load sign-in.');clerk=window.Clerk;await clerk.load()}
  if(!clerk.session){gate('Owner only. Sign in to see it.',true);return false}
  token=await clerk.session.getToken();return true}
function gate(text,btn){$('#main').hidden=true;const g=$('#gate');g.hidden=false;g.innerHTML='<p>'+esc(text)+'</p>'+(btn?'<button id="si">Sign in</button>':'');if(btn)$('#si').onclick=()=>clerk.openSignIn({forceRedirectUrl:location.href});$('#state').textContent='';return false}
async function load(again){
  if(clerk?.session)token=await clerk.session.getToken().catch(()=>token);
  let r;try{r=await fetch(location.pathname+'?json=1',{headers:token?{authorization:'Bearer '+token}:{},credentials:'same-origin',cache:'no-store'})}catch{$('#state').innerHTML='<span class="bad">offline</span> · last '+esc(ago(last));return}
  if(r.status===401&&!again){if(await signIn())return load(true);return}
  if(r.status===401)return gate('That sign-in was not accepted.',true);
  if(r.status===403)return gate('Signed in, but this page is for the site owner.');
  if(!r.ok){$('#state').innerHTML='<span class="bad">error '+r.status+'</span>';return}
  const d=await r.json();last=d.at;render(d)}
function tile(k,v,cls){return '<div class="tile"><div class="k">'+esc(k)+'</div><div class="v num '+(cls||'')+'">'+v+'</div></div>'}
function render(d){
  $('#gate').hidden=true;const m=$('#main');m.hidden=false;
  const bad=d.alerts.filter(a=>a.level==='bad').length,lvl=bad?'bad':d.alerts.length?'warn':'ok';
  $('#build').textContent=d.build.build+(d.build.since?' · live since '+new Date(d.build.since).toISOString().slice(0,16).replace('T',' ')+'Z':'');
  $('#state').innerHTML='<span class="dot '+lvl+'"></span>'+(lvl==='ok'?'all clear':d.alerts.length+' alert'+(d.alerts.length>1?'s':''))+' · <span class="mono">'+d.ms+' ms</span> · '+esc(ago(d.at));
  const h=d.host,mem=h.memory||{},dk=h.disk||{};let s='';
  s+='<h2>Alerts</h2>'+(d.alerts.length?'<ul class="alerts">'+d.alerts.map(a=>'<li><span class="dot '+a.level+'"></span>'+esc(a.text)+'</li>').join('')+'</ul>':'<p class="ok">Nothing needs you.</p>');
  s+='<h2>Host</h2><div class="grid">'+tile('CPU',fmt(h.cpuPct,'%')+' <span class="muted">'+h.cpus+' cores</span>')+tile('Load 1/5/15',h.load.join(' / '))
    +tile('Memory free',fmt(mem.availableMb==null?null:(mem.availableMb/1024).toFixed(1),' GB')+' <span class="muted">of '+fmt(mem.totalMb==null?null:Math.round(mem.totalMb/1024),' GB')+'</span>',mem.availableMb<1536?'bad':'')
    +tile('Disk free',fmt(dk.freePct,'%')+' <span class="muted">'+fmt(dk.freeGb,' GB')+'</span>',dk.freePct<15?'bad':'')
    +Object.entries(h.units||{}).map(([k,u])=>tile('Worlds '+k,fmt(u.workingMb,' MB')+(u.maxMb?' <span class="muted">/ '+u.maxMb+' MB</span>':'')+(u.oomKills?' <span class="bad">'+u.oomKills+' OOM</span>':''),u.pct>=90?'bad':'')).join('')
    +tile('Caddy',esc(h.caddy??'—'),h.caddy&&h.caddy!=='active'?'bad':'')+tile('Up',fmt(h.uptimeH,' h'))
    +tile('Host check',h.check?(h.check.ok?'ok':'<span class="bad">'+esc(h.check.codes.join(', ')||'failed')+'</span>')+' <span class="muted">'+esc(ago(h.check.at))+'</span>':'—')+'</div>';
  s+='<h2>Worlds <span class="muted">'+d.totals.running+' running of '+d.totals.worlds+' · '+d.totals.viewers+' watching</span></h2><div class="wrap"><table><thead><tr><th>World</th><th>State</th><th class="n">Now</th><th>Last visit</th><th class="n">Souls</th><th class="n">Tick ms</th><th class="n">Clock</th><th class="n hide-s">RSS</th><th>Last god edit</th><th class="n hide-s">Restarts</th></tr></thead><tbody>'
    +d.worlds.map(w=>{const sc=w.status==='running'?'ok':w.status==='failed'||w.status==='restarting'?'bad':'muted',tk=w.tickMs;
      return '<tr><td title="'+esc(w.slug)+'">'+esc(w.name)+'</td><td><span class="'+sc+'">'+esc(w.status)+'</span></td><td class="n">'+(w.viewers||'<span class="muted">0</span>')+'</td><td>'+esc(ago(w.lastVisit))+'</td><td class="n">'+fmt(w.souls)+'</td>'
      +'<td class="n '+(tk&&tk.avg>50?'warn':'')+'">'+(tk?tk.avg+' <span class="muted">/ '+tk.max+'</span>':'—')+'</td><td class="n '+(w.clockRate!=null&&w.clockRate<0.9?'warn':'')+'">'+(w.clockRate==null?'—':Math.round(w.clockRate*100)+'%')+'</td><td class="n hide-s">'+fmt(w.rssMb,' MB')+'</td><td>'+esc(ago(w.lastEdit))+'</td><td class="n hide-s">'+w.restarts+'</td></tr>'}).join('')+'</tbody></table></div>';
  s+='<h2>Releases and backups</h2><div class="wrap"><table><thead><tr><th>Stage</th><th>Build</th><th>Live since</th><th>Last backup</th><th class="n">Size added</th><th>Timer</th></tr></thead><tbody>'
    +d.stages.map(x=>{const b=x.backup;return '<tr><td>'+esc(x.stage)+(x.self?' <span class="chip">this</span>':'')+'</td><td class="mono">'+esc(x.build??'—')+'</td><td>'+esc(ago(x.since))+'</td><td>'+(b?(b.ok?'<span class="ok">ok</span>':'<span class="bad">failed</span>')+' '+esc(ago(b.at))+(b.source!=='record'?' <span class="muted">('+(b.source==='unit'?'backup unit':'dated copy')+'; first record after tonight’s backup)</span>':b.ok&&b.dbs!=null?' <span class="muted">'+b.dbsOk+'/'+b.dbs+' dbs</span>':''):'<span class="muted">'+(x.timer&&x.timer.enabled?'first record after tonight’s backup':'none')+'</span>')+'</td><td class="n">'+(b&&b.addedMb!=null?b.addedMb+' MB':'—')+'</td><td>'+(x.timer?(x.timer.enabled?esc(x.timer.result||'enabled'):'<span class="muted">off</span>'):'—')+'</td></tr>'}).join('')+'</tbody></table></div>'
    +'<p class="muted">Restore drill: '+(d.drill?esc(d.drill.name)+' · '+(d.drill.ok===true?'<span class="ok">ok</span> '+d.drill.dbsOk+'/'+d.drill.dbs+' dbs':d.drill.ok===false?'<span class="bad">failed</span>':'result unknown')+' · '+esc(ago(d.drill.at)):'none yet')+'</p>';
  const ar=d.arrivals||{};
  s+='<h2>Arrivals, last 24 h</h2><div class="grid">'+tile('Arrivals',fmt(ar.n))+tile('Median',ar.p50==null?'—':(ar.p50/1000).toFixed(1)+' s')+tile('Slowest 10%',ar.p90==null?'—':(ar.p90/1000).toFixed(1)+' s',ar.p90>10000?'warn':'')+'</div>'
    +(ar.worlds&&ar.worlds.length?'<div class="wrap" style="margin-top:8px"><table><thead><tr><th>World</th><th class="n">Arrivals</th><th class="n">Median</th><th class="n">p90</th></tr></thead><tbody>'+ar.worlds.map(w=>'<tr><td>'+esc(w.world)+'</td><td class="n">'+w.n+'</td><td class="n">'+(w.p50/1000).toFixed(1)+' s</td><td class="n">'+(w.p90/1000).toFixed(1)+' s</td></tr>').join('')+'</tbody></table></div>':'');
  const e=d.errors;
  s+='<h2>New errors since this release <span class="muted">'+e.newSinceRelease+' kind'+(e.newSinceRelease===1?'':'s')+'</span></h2>'+(e.top.length?'<div class="wrap"><table><thead><tr><th>Kind</th><th>Message</th><th class="n">Count</th><th class="n">People</th><th>Last</th><th class="hide-s">Worlds</th></tr></thead><tbody>'+e.top.map(x=>'<tr><td><span class="chip">'+esc(x.kind)+'</span></td><td class="msg mono">'+esc(x.message)+(x.source?' <span class="muted">'+esc(x.source)+'</span>':'')+'</td><td class="n">'+x.count+'</td><td class="n">'+x.visitors+'</td><td>'+esc(ago(x.last))+'</td><td class="hide-s">'+esc(x.worlds.join(', '))+'</td></tr>').join('')+'</tbody></table></div>':'<p class="ok">None.</p>');
  s+='<p class="muted">sim-watch: '+(d.watch?'last check '+esc(ago(d.watch.at))+(d.watch.down?' · <span class="bad">down: '+esc(d.watch.down)+'</span>':''):'not seen since this launcher started')+'</p>';
  m.innerHTML=s}
load();timer=setInterval(()=>{if(!document.hidden)load()},30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
</script></body></html>`;
}
