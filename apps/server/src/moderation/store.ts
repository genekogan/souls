// G8 moderation: the append-only moderation log and the hidden set it folds into.
//
// Two logs, both append-only, both folded in order:
// - World log: table `moderation_log_v1` in the world's own DB. The world's creator hides and unhides;
//   the classifier quarantines at intake; the site admin releases quarantines. UPDATE and DELETE are
//   refused by triggers, so undo is always a new row.
// - Site log: a JSON-lines file shared by every world on the box (`SIM_MODERATION_SITE_LOG`, default
//   `<asset dir>/moderation-site.jsonl`). The site admin's hides land here and apply in every world.
//   It is only ever appended to (O_APPEND, one line per action).
// An upload is hidden while any of these holds: the creator's veto, the admin's veto, a quarantine.
// A creator cannot lift the admin's veto or a quarantine; the admin lifts their own veto and quarantines.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type ModAction = 'hide' | 'unhide' | 'quarantine' | 'release' | 'reject';
export type ModRole = 'creator' | 'admin' | 'classifier';
export type ModEntry = { seq: number; scope: 'world' | 'site'; world: string; sha: string; action: ModAction; actor: string; role: ModRole; reason: string | null; detail: unknown; at: number };
export type ModState = { sha: string; hidden: boolean; creatorVeto: boolean; adminVeto: boolean; quarantined: boolean; reasons: string[] };

type Stmt = { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
export type RawDb = { exec(sql: string): void; prepare(sql: string): Stmt };

export const SHA = /^[0-9a-f]{64}$/;
/** Accept a bare sha, a body asset id, or any URL/path ending in one. */
export function targetSha(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  const m = value.match(/(?:^|[/_])([0-9a-f]{64})(?:\.(?:glb|png|jpg|json))?(?:[?#].*)?$/);
  return m ? m[1] : null;
}

export function defaultSiteLog(env = process.env) {
  if (env.SIM_MODERATION_SITE_LOG) return resolve(env.SIM_MODERATION_SITE_LOG);
  const assets = resolve(env.ASSET_DIR ?? join(resolve(env.DATA_DIR ?? './data'), '..', 'assets'));
  return join(assets, 'moderation-site.jsonl');
}

export class ModerationStore {
  readonly db: RawDb; readonly world: string; readonly siteLog: string;
  private site: { size: number; mtime: number; entries: ModEntry[] } = { size: -1, mtime: -1, entries: [] };
  private folded: { key: string; states: Map<string, ModState> } | null = null;
  constructor(db: RawDb, world: string, siteLog = defaultSiteLog()) {
    this.db = db; this.world = world; this.siteLog = siteLog;
    db.exec(`CREATE TABLE IF NOT EXISTS moderation_log_v1(seq INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, sha TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('hide','unhide','quarantine','release','reject')), actor TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('creator','admin','classifier')), reason TEXT, detail TEXT, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS moderation_log_v1_sha ON moderation_log_v1(world_id, sha, seq);
      CREATE TRIGGER IF NOT EXISTS moderation_log_v1_no_update BEFORE UPDATE ON moderation_log_v1 BEGIN SELECT RAISE(ABORT, 'moderation log is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS moderation_log_v1_no_delete BEFORE DELETE ON moderation_log_v1 BEGIN SELECT RAISE(ABORT, 'moderation log is append-only'); END;`);
  }

  // ---- reading

  private siteEntries(): ModEntry[] {
    let size = 0, mtime = 0;
    try { const s = statSync(this.siteLog); size = s.size; mtime = s.mtimeMs; } catch { /* no site log yet */ }
    if (size === this.site.size && mtime === this.site.mtime) return this.site.entries;
    const entries: ModEntry[] = [];
    if (size) {
      const lines = readFileSync(this.siteLog, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.trim()) return;
        try {
          const e = JSON.parse(line);
          if (SHA.test(e.sha) && ['hide', 'unhide'].includes(e.action) && e.role === 'admin') entries.push({ seq: i + 1, scope: 'site', world: String(e.world ?? ''), sha: e.sha, action: e.action, actor: String(e.actor), role: 'admin', reason: e.reason ?? null, detail: e.detail ?? null, at: Number(e.at) || 0 });
        } catch { /* a torn or foreign line is skipped, never rewritten */ }
      });
    }
    this.site = { size, mtime, entries };
    return entries;
  }
  private worldMax(): number { return ((this.db.prepare('SELECT COALESCE(MAX(seq),0) n FROM moderation_log_v1 WHERE world_id=?').get(this.world) as { n: number }).n); }
  /** Changes whenever either log grows: viewers compare it to know when to look again. */
  version(): string { const site = this.siteEntries(); return `${this.worldMax()}.${site.length}`; }

  private states(): Map<string, ModState> {
    const key = this.version();
    if (this.folded?.key === key) return this.folded.states;
    const states = new Map<string, ModState>();
    const at = (sha: string) => { let s = states.get(sha); if (!s) states.set(sha, s = { sha, hidden: false, creatorVeto: false, adminVeto: false, quarantined: false, reasons: [] }); return s; };
    const rows = this.db.prepare('SELECT sha, action, role, reason FROM moderation_log_v1 WHERE world_id=? ORDER BY seq').all(this.world) as { sha: string; action: ModAction; role: ModRole; reason: string | null }[];
    for (const r of rows) {
      const s = at(r.sha);
      if (r.action === 'hide') { if (r.role === 'admin') s.adminVeto = true; else s.creatorVeto = true; }
      if (r.action === 'unhide') { if (r.role === 'admin') s.adminVeto = false; else s.creatorVeto = false; }
      if (r.action === 'quarantine') s.quarantined = true;
      if (r.action === 'release') s.quarantined = false;
      if (r.reason && ['hide', 'quarantine'].includes(r.action)) s.reasons = [...s.reasons.slice(-4), r.reason];
    }
    for (const e of this.siteEntries()) {
      const s = at(e.sha);
      s.adminVeto = e.action === 'hide';
      if (e.action === 'hide' && e.reason) s.reasons = [...s.reasons.slice(-4), e.reason];
    }
    for (const s of states.values()) s.hidden = s.creatorVeto || s.adminVeto || s.quarantined;
    this.folded = { key, states };
    return states;
  }
  state(sha: string): ModState { return this.states().get(sha) ?? { sha, hidden: false, creatorVeto: false, adminVeto: false, quarantined: false, reasons: [] }; }
  isHidden(sha: string): boolean { return !!this.states().get(sha)?.hidden; }
  hidden(): string[] { return [...this.states().values()].filter((s) => s.hidden).map((s) => s.sha).sort(); }

  log(opts: { sha?: string; limit?: number; site?: 'all' | Set<string> } = {}): ModEntry[] {
    const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
    const rows = (opts.sha
      ? this.db.prepare('SELECT * FROM moderation_log_v1 WHERE world_id=? AND sha=? ORDER BY seq DESC LIMIT ?').all(this.world, opts.sha, limit)
      : this.db.prepare('SELECT * FROM moderation_log_v1 WHERE world_id=? ORDER BY seq DESC LIMIT ?').all(this.world, limit)) as { seq: number; sha: string; action: ModAction; actor: string; role: ModRole; reason: string | null; detail: string | null; at: number }[];
    const world: ModEntry[] = rows.map((r) => ({ seq: r.seq, scope: 'world', world: this.world, sha: r.sha, action: r.action, actor: r.actor, role: r.role, reason: r.reason, detail: r.detail ? JSON.parse(r.detail) : null, at: r.at }));
    const site = this.siteEntries().filter((e) => (!opts.sha || e.sha === opts.sha) && (opts.site === 'all' || (opts.site instanceof Set && opts.site.has(e.sha))));
    return [...world, ...site].sort((a, b) => b.at - a.at || b.seq - a.seq).slice(0, limit);
  }

  // ---- appending

  /** Called after every append (best effort): e.g. body collections write a withdrawal through (#717). */
  readonly appended: ((sha: string) => void)[] = [];
  append(e: { sha: string; action: ModAction; actor: string; role: ModRole; reason?: string | null; detail?: unknown; scope?: 'world' | 'site' }): ModEntry {
    const entry = this.appendEntry(e);
    for (const f of this.appended) { try { f(e.sha); } catch { /* a listener never fails moderation */ } }
    return entry;
  }
  private appendEntry(e: { sha: string; action: ModAction; actor: string; role: ModRole; reason?: string | null; detail?: unknown; scope?: 'world' | 'site' }): ModEntry {
    if (!SHA.test(e.sha)) throw new Error('moderation target must be a sha256');
    const reason = e.reason ? String(e.reason).slice(0, 500) : null, at = Date.now();
    if (e.scope === 'site') {
      if (e.role !== 'admin' || !['hide', 'unhide'].includes(e.action)) throw new Error('only the site admin hides or unhides site-wide');
      const line = JSON.stringify({ world: this.world, sha: e.sha, action: e.action, actor: e.actor.slice(0, 120), role: 'admin', reason, at });
      if (!existsSync(dirname(this.siteLog))) mkdirSync(dirname(this.siteLog), { recursive: true });
      appendFileSync(this.siteLog, line + '\n', { flag: 'a' });
      const site = this.siteEntries();
      return site[site.length - 1] ?? { seq: 0, scope: 'site', world: this.world, sha: e.sha, action: e.action, actor: e.actor, role: 'admin', reason, detail: null, at };
    }
    const detail = e.detail === undefined ? null : JSON.stringify(e.detail).slice(0, 4000);
    this.db.prepare('INSERT INTO moderation_log_v1(world_id, sha, action, actor, role, reason, detail, at) VALUES (?,?,?,?,?,?,?,?)').run(this.world, e.sha, e.action, e.actor.slice(0, 120), e.role, reason, detail, at);
    return this.log({ sha: e.sha, limit: 1 })[0];
  }
}

const stores = new WeakMap<object, Map<string, ModerationStore>>();
/** One store per (world DB, world id), shared by the upload hooks and the routes. */
export function moderationFor(db: RawDb, world: string, siteLog?: string): ModerationStore {
  let m = stores.get(db); if (!m) stores.set(db, m = new Map());
  let s = m.get(world); if (!s) m.set(world, s = new ModerationStore(db, world, siteLog));
  return s;
}
