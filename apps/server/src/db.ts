// SQLite via node:sqlite (built in, no native build). One file, WAL.
import { DatabaseSync, backup } from 'node:sqlite';
import { statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { migrate } from './migrations.ts';
import { countGlitch, type GlitchCountsV1, type GlitchRecordV1, type GlitchRung } from './glitch.ts';
import type { BrainCall, LogEvent, NarrativeView, TalkLine } from '@souls/protocol';
import {recordedTakeChunkSchema} from '@souls/protocol';
import {stableStringify,parseRenderSceneCapture,type RenderSceneCaptureV1} from '@souls/engine-contract';

export type UserRow = { id: string; email: string | null; wallet: string | null; role: 'user' | 'admin'; created_at: number; last_seen: number; invited_by: string | null };
export type SoulRow = { id: string; world_id: string; owner: string; entity_id: string; name: string; description: string; created_at: number; retired_at: number | null; token_hash: string | null; token_generation: string | null; token_created_at: number | null; native: number; token_label: string | null; token_last_used: number | null };

export class BudgetReservationUnavailable extends Error {}

type VerifiedCapture={key:string;capture:RenderSceneCaptureV1;json?:string};
export class Db {
  db: DatabaseSync;
  path: string;
  constructor(path: string) {
    this.path = path;
    this.db = new DatabaseSync(path);
    // busy_timeout: another process (Litestream checkpointing, a backup, a read-only tool) may hold the write lock for a
    // moment. Without a timeout SQLite refuses at once and the tick loop dies; with one, the write waits its turn.
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrated = migrate(this.db);
  }
  migrated: number[] = [];
  /** L8: verified render scene captures (content-addressed rows, never updated or deleted): each verified once by hash,
   * then served from here, the response JSON serialized once. Filled only outside transactions or after a commit. */
  private renderCaptureCache=new Map<string,VerifiedCapture>();

  paidCost(now = Date.now()): number {
    return Number((this.db.prepare('SELECT COALESCE(SUM(cost),0) AS cost FROM paid_costs WHERE at >= ?').get(now - 86400_000) as { cost: number }).cost);
  }
  reserveCost(bound: number, model: string, budget: number, now = Date.now(), ceiling:1|3=1) {
    if (!Number.isFinite(bound) || bound < 0 || !Number.isFinite(budget) || ![1,3].includes(ceiling) || this.paidCost(now) + bound > Math.min(ceiling, budget)) throw new BudgetReservationUnavailable('world model budget cannot cover this request');
    const id = Number(this.db.prepare('INSERT INTO paid_costs(at,model,cost) VALUES (?,?,?)').run(now, model, bound).lastInsertRowid);
    return { settle: (cost: number) => {
      if (!Number.isFinite(cost) || cost < 0) return;
      this.db.prepare('UPDATE paid_costs SET cost = ?, settled = 1 WHERE id = ?').run(cost, id);
      if (cost > bound) throw new Error('provider cost exceeded its admission bound');
    } };
  }

  saveTake(worldId: string, chunk: {fromTick: number; toTick: number; take: unknown}, scene?:RenderSceneCaptureV1) {
    const body = gzipSync(JSON.stringify(chunk.take), {level: 1});
    const raw=chunk.take as {renderSceneRef?:unknown}|null;
    if(!raw || typeof raw!=='object' || !Object.hasOwn(raw,'renderSceneRef')) {
      // Legacy takes keep their existing persistence semantics. Never infer a
      // historical geometry reference from the currently running engine.
      this.db.prepare('INSERT OR IGNORE INTO take_chunks VALUES (?,?,?,?)').run(worldId, chunk.fromTick, chunk.toTick, body);
      return;
    }
    const ref=recordedTakeChunkSchema.parse(chunk).take.renderSceneRef!;
    const {id:takeId,...takeBody}=chunk.take as Record<string,unknown>;
    if(takeId!==createHash('sha256').update(stableStringify(takeBody)).digest('hex').slice(0,24))throw new Error('take content address mismatch');
    const captured=scene?parseRenderSceneCapture(scene):undefined;
    if(captured && (captured.ref.hash!==ref.hash||captured.ref.rulesVersion!==ref.rulesVersion))
      throw new Error('take render scene reference mismatch');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(captured)this.db.prepare('INSERT OR IGNORE INTO render_scene_captures VALUES (?,?,?)').run(worldId,ref.hash,JSON.stringify(captured));
      const verified=this.verifiedCapture(worldId,ref.hash),stored=verified?.capture;
      if(!stored||stored.ref.rulesVersion!==ref.rulesVersion)throw new Error('take render scene capture unavailable');
      const existing=this.db.prepare('SELECT body FROM take_chunks WHERE world_id=? AND to_tick=?').get(worldId,chunk.toTick) as {body:Uint8Array}|undefined;
      if(existing) {
        const old=JSON.parse(gunzipSync(existing.body).toString()) as {renderSceneRef?:{hash:string}};
        if(old.renderSceneRef?.hash!==ref.hash)throw new Error('stored take render scene identity conflict');
      }
      this.db.prepare('INSERT OR IGNORE INTO take_chunks VALUES (?,?,?,?)').run(worldId, chunk.fromTick, chunk.toTick, body);
      this.db.exec('COMMIT');
      this.cacheCapture(verified);
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  /** Stores only the public render scene a live take references (tiny, one row per
   * scene hash). Used when take recordings are off (TAKES_PERSIST unset) so
   * /v1/scenes/:hash still resolves for live viewers. */
  saveRenderSceneCapture(worldId:string,scene:RenderSceneCaptureV1) {
    const captured=parseRenderSceneCapture(scene);
    this.db.prepare('INSERT OR IGNORE INTO render_scene_captures VALUES (?,?,?)').run(worldId,captured.ref.hash,JSON.stringify(captured));
  }
  /** Public rendering data only, scoped to the selected world and verified on
   * read. Retained separately from take pruning and independent of live code. */
  renderSceneCapture(worldId:string,hash:string):RenderSceneCaptureV1|undefined {
    const v=this.verifiedCapture(worldId,hash);
    return v?structuredClone(v.capture):undefined;
  }
  /** The public `/v1/scenes/:hash` body (`{worldId, ...capture}`), serialized once per verified capture. */
  renderSceneCaptureJson(worldId:string,hash:string):string|undefined {
    const v=this.verifiedCapture(worldId,hash);
    return v?(v.json??=JSON.stringify({worldId,...v.capture})):undefined;
  }
  private verifiedCapture(worldId:string,hash:string):VerifiedCapture|undefined {
    const key=`${worldId}\0${hash}`,hit=this.renderCaptureCache.get(key);
    if(hit){this.renderCaptureCache.delete(key);this.renderCaptureCache.set(key,hit);return hit;}
    const row=this.db.prepare('SELECT body FROM render_scene_captures WHERE world_id=? AND hash=?').get(worldId,hash) as {body:string}|undefined;
    if(!row)return undefined;
    const capture=parseRenderSceneCapture(JSON.parse(row.body));
    if(capture.ref.hash!==hash)throw new Error('stored render scene capture hash mismatch');
    const v:VerifiedCapture={key,capture};
    // A read inside a transaction may see a row the transaction then rolls back: cache it only once committed.
    if(!this.db.isTransaction)this.cacheCapture(v);
    return v;
  }
  private cacheCapture(v:VerifiedCapture|undefined){
    if(!v)return;
    this.renderCaptureCache.delete(v.key);this.renderCaptureCache.set(v.key,v);
    while(this.renderCaptureCache.size>8)this.renderCaptureCache.delete(this.renderCaptureCache.keys().next().value!);
  }
  hasRenderSceneCapture(worldId:string,hash:string):boolean {
    return !!this.db.prepare('SELECT 1 FROM render_scene_captures WHERE world_id=? AND hash=?').get(worldId,hash);
  }
  takes(worldId: string, from: number, to: number, limit: number) {
    const rows = this.db.prepare('SELECT from_tick, to_tick, body FROM take_chunks WHERE world_id = ? AND to_tick > ? AND from_tick < ? ORDER BY to_tick LIMIT ?').all(worldId, from, to, limit + 1) as {from_tick: number; to_tick: number; body: Uint8Array}[];
    const selected = rows.slice(0, limit);
    return { chunks: selected.map(r => ({fromTick: r.from_tick, toTick: r.to_tick, take: JSON.parse(gunzipSync(r.body).toString())})), next: rows.length > limit ? selected.at(-1)!.to_tick : null };
  }

  // worlds
  world(id: string) { return this.db.prepare('SELECT * FROM worlds WHERE id = ?').get(id) as { id: string; schema: string; rules_version: string; dt: number; seed: string; clock_rate: number } | undefined; }
  createWorld(w: { id: string; schema: string; rules_version: string; dt: number; seed: string }) { this.db.prepare('INSERT INTO worlds (id, schema, rules_version, dt, seed, created_at) VALUES (?,?,?,?,?,?)').run(w.id, w.schema, w.rules_version, w.dt, w.seed, Date.now()); }
  setClockRate(id: string, rate: number) { this.db.prepare('UPDATE worlds SET clock_rate = ? WHERE id = ?').run(rate, id); }

  // events
  appendEvent(worldId: string, e: LogEvent) { this.db.prepare('INSERT INTO events (world_id, seq, tick, kind, author, payload, at, soul_id) VALUES (?,?,?,?,?,?,?,?)').run(worldId, e.seq, e.tick, e.kind, e.author, JSON.stringify(e.payload), e.at, (e.payload as { soulId?: string })?.soulId ?? null); }
  /** Bounded original personal camp-card evidence bound by actual world/Soul
   * IDs. Removing a card or changing display order does not erase its source. */
  campPersonalCards(worldId:string,soulId:string):import('@souls/kernel').MintedCard[]{
    return (this.db.prepare("SELECT payload FROM events WHERE world_id=? AND kind='mint' AND json_extract(payload,'$.forSoul')=? AND json_extract(payload,'$.card.by')='world' AND (json_extract(payload,'$.card.name') LIKE 'bunk sleep %' OR json_extract(payload,'$.card.name') LIKE 'eat a bowl of %' OR json_extract(payload,'$.card.name') LIKE 'finish the bowl %') ORDER BY seq LIMIT 32").all(worldId,soulId) as {payload:string}[]).map(r=>JSON.parse(r.payload).card);
  }
  /** A Soul's own events, newest last (indexed). */
  soulEvents(worldId: string, soulId: string, limit = 100): LogEvent[] {
    return (this.db.prepare('SELECT seq, tick, kind, author, payload, at FROM events WHERE world_id = ? AND soul_id = ? ORDER BY seq DESC LIMIT ?').all(worldId, soulId, limit) as any[]).map(rowToEvent).reverse();
  }
  recentKind(worldId: string, kind: string, limit: number): LogEvent[] {
    return (this.db.prepare('SELECT seq, tick, kind, author, payload, at FROM events WHERE world_id = ? AND kind = ? ORDER BY seq DESC LIMIT ?').all(worldId, kind, limit) as any[]).map(rowToEvent).reverse();
  }
  /** `light` reads a logged recovery as only its public receipt (excluded cards, faults): its recipe carries a whole
   *  world body, so the public log, joins and prompts would otherwise parse megabytes per event. */
  events(worldId: string, afterSeq = 0, limit = 1_000_000, light = false): LogEvent[] {
    return (this.db.prepare(`SELECT seq, tick, kind, author, ${light ? LIGHT_PAYLOAD : 'payload'}, at FROM events WHERE world_id = ? AND seq > ? ORDER BY seq LIMIT ?`).all(worldId, afterSeq, limit) as any[]).map(rowToEvent);
  }
  tailEvents(worldId: string, n: number, light = false): LogEvent[] {
    return (this.db.prepare(`SELECT seq, tick, kind, author, ${light ? LIGHT_PAYLOAD : 'payload'}, at FROM events WHERE world_id = ? ORDER BY seq DESC LIMIT ?`).all(worldId, n) as any[]).map(rowToEvent).reverse();
  }
  /** The seq of the last logged recovery after `afterSeq`, if any (a recovery supersedes the log before it). */
  lastRecoverySeq(worldId: string, afterSeq: number): number | null {
    return ((this.db.prepare("SELECT MAX(seq) AS s FROM events WHERE world_id = ? AND seq > ? AND kind = 'rules' AND author = 'world:recovery'").get(worldId, afterSeq) as any)?.s as number) ?? null;
  }
  /** The tick of this world's last rung 3 (#1150): a boot starts past its recipe, and its cooldown still counts. */
  lastRewindTick(worldId: string): number | null {
    return ((this.db.prepare("SELECT MAX(tick) AS t FROM events WHERE world_id = ? AND kind = 'rules' AND author = 'world:recovery' AND json_type(payload, '$.recovery.lastRung') IS NOT NULL").get(worldId) as any)?.t as number) ?? null;
  }
  /** The tick at which each Soul was born (from the log). */
  birthTicks(worldId: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.db.prepare("SELECT tick, payload FROM events WHERE world_id = ? AND kind = 'birth' ORDER BY seq").all(worldId) as any[]) { const id = JSON.parse(r.payload)?.soulId; if (id && out[id] === undefined) out[id] = r.tick; }
    return out;
  }
  rulesEvents(worldId: string): LogEvent[] { return (this.db.prepare("SELECT seq, tick, kind, author, payload, at FROM events WHERE world_id = ? AND kind = 'rules' ORDER BY seq").all(worldId) as any[]).map(rowToEvent); }
  hasVocabulary(worldId: string): boolean { return !!this.db.prepare("SELECT 1 FROM events WHERE world_id = ? AND kind = 'rules' AND author <> 'world:recovery' AND json_type(payload, '$.vocabulary') = 'object' LIMIT 1").get(worldId); }
  lastSeq(worldId: string): number { return ((this.db.prepare('SELECT MAX(seq) AS s FROM events WHERE world_id = ?').get(worldId) as any)?.s as number) ?? 0; }
  countEvents(worldId: string): number { return (this.db.prepare('SELECT COUNT(*) AS c FROM events WHERE world_id = ?').get(worldId) as any).c; }

  // #1150: glitch records (operations data; replay never reads them)
  appendGlitch(worldId: string, g: GlitchRecordV1): void {
    this.db.prepare('INSERT INTO glitches_v1 (world_id, at, tick, rung, rule, bodies, evidence) VALUES (?,?,?,?,?,?,?)').run(worldId, g.at, g.tick, g.rung, g.rule, JSON.stringify(g.bodies), JSON.stringify(g.evidence));
  }
  glitchCounts(worldId: string): GlitchCountsV1 {
    const out: GlitchCountsV1 = {total: 0, byRule: {}};
    for (const r of this.db.prepare('SELECT rule, rung, COUNT(*) AS n FROM glitches_v1 WHERE world_id = ? GROUP BY rule, rung').all(worldId) as {rule: string; rung: GlitchRung; n: number}[]) countGlitch(out, r.rule, r.rung, r.n);
    return out;
  }

  // snapshots
  saveSnapshot(worldId: string, s: { tick: number; seq: number; stateHash: string; physicalHash: string; rulesVersion: string; body: unknown }) {
    this.saveSnapshotSerialized(worldId, s, JSON.stringify(s.body));
  }
  /** The caller owns the captured body and serialized it before this synchronous write.
   * Keep the same TEXT bytes, write timestamp and retention policy as saveSnapshot. */
  saveSnapshotSerialized(worldId: string, s: { tick: number; seq: number; stateHash: string; physicalHash: string; rulesVersion: string }, bodyJson: string) {
    this.db.prepare('INSERT OR REPLACE INTO snapshots (world_id, tick, seq, state_hash, physical_hash, rules_version, snapshot, at) VALUES (?,?,?,?,?,?,?,?)').run(worldId, s.tick, s.seq, s.stateHash, s.physicalHash, s.rulesVersion, bodyJson, Date.now());
    // keep the latest 5, plus the first snapshot of each of the last 7 days
    this.db.prepare(`DELETE FROM snapshots WHERE world_id = ?1
      AND tick NOT IN (SELECT tick FROM snapshots WHERE world_id = ?1 ORDER BY tick DESC LIMIT 5)
      AND tick NOT IN (SELECT MIN(tick) FROM snapshots WHERE world_id = ?1 AND at > ?2 GROUP BY at / 86400000)`).run(worldId, Date.now() - 7 * 86400000);
  }
  latestSnapshot(worldId: string) {
    const r = this.latestSnapshotText(worldId);
    return r ? { tick: r.tick, seq: r.seq, stateHash: r.stateHash, rulesVersion: r.rulesVersion, body: JSON.parse(r.text) } : null;
  }
  /** The latest snapshot with its stored JSON text undecoded (a boot keeps the text, not a second decoded copy). */
  latestSnapshotText(worldId: string) {
    const r = this.db.prepare('SELECT tick, seq, state_hash, rules_version, snapshot FROM snapshots WHERE world_id = ? ORDER BY tick DESC LIMIT 1').get(worldId) as any;
    return r ? { tick: r.tick as number, seq: r.seq as number, stateHash: r.state_hash as string, rulesVersion: r.rules_version as string, text: r.snapshot as string } : null;
  }

  // users
  user(id: string) { return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined; }
  upsertUser(u: { id: string; email: string | null; wallet: string | null; role: 'user' | 'admin' }) {
    const now = Date.now();
    this.db.prepare('INSERT INTO users (id, email, wallet, role, created_at, last_seen) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, wallet = excluded.wallet, role = excluded.role, last_seen = excluded.last_seen').run(u.id, u.email, u.wallet, u.role, now, now);
  }
  setInvited(id: string, by: string) { this.db.prepare('UPDATE users SET invited_by = ? WHERE id = ?').run(by, id); }
  // invites
  createInvite(code: string, maxUses: number, note: string | null, by: string) { this.db.prepare('INSERT INTO invites (code, max_uses, note, created_by, created_at) VALUES (?,?,?,?,?)').run(code, maxUses, note, by, Date.now()); }
  invites() { return this.db.prepare('SELECT * FROM invites ORDER BY created_at DESC').all() as { code: string; max_uses: number; uses: number; note: string | null; created_at: number }[]; }
  /** Atomically consume one use of an invite code. */
  useInvite(code: string): boolean { return Number(this.db.prepare('UPDATE invites SET uses = uses + 1 WHERE code = ? AND uses < max_uses').run(code).changes) === 1; }
  touchUser(id: string) { this.db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), id); }
  countUsers(): number { return (this.db.prepare('SELECT COUNT(*) AS c FROM users').get() as any).c; }

  // souls
  soul(id: string) { return this.db.prepare('SELECT * FROM souls WHERE id = ?').get(id) as SoulRow | undefined; }
  soulsOf(owner: string) { return this.db.prepare('SELECT * FROM souls WHERE owner = ? AND retired_at IS NULL ORDER BY created_at').all(owner) as SoulRow[]; }
  liveSouls(worldId: string) { return this.db.prepare('SELECT * FROM souls WHERE world_id = ? AND retired_at IS NULL ORDER BY created_at').all(worldId) as SoulRow[]; }
  soulByName(worldId: string, name: string) { return this.db.prepare('SELECT * FROM souls WHERE world_id = ? AND name = ? COLLATE NOCASE AND retired_at IS NULL').get(worldId, name) as SoulRow | undefined; }
  soulByTokenHash(hash: string) { return this.db.prepare('SELECT * FROM souls WHERE token_hash = ? AND retired_at IS NULL').get(hash) as SoulRow | undefined; }
  createSoul(s: { id: string; worldId: string; owner: string; entityId: string; name: string; description: string; native: boolean }) {
    this.db.prepare('INSERT INTO souls (id, world_id, owner, entity_id, name, description, created_at, native) VALUES (?,?,?,?,?,?,?,?)').run(s.id, s.worldId, s.owner, s.entityId, s.name, s.description, Date.now(), s.native ? 1 : 0);
  }
  retireSoul(id: string) { this.retireToken(id, null, 'retired'); this.db.prepare('UPDATE souls SET retired_at = ?, token_hash = NULL, token_generation = NULL WHERE id = ?').run(Date.now(), id); }
  /** SOUL3: the outgoing token's hash (never the token) is kept, so its holder learns it was superseded. */
  private retireToken(id: string, next: string | null, reason: string) { this.db.prepare('INSERT OR IGNORE INTO soul_token_tombstones_v1 (token_hash, world_id, soul_id, label, issued_at, revoked_at, reason) SELECT token_hash, world_id, id, token_label, token_created_at, ?, ? FROM souls WHERE id = ? AND token_hash IS NOT NULL AND token_hash IS NOT ?').run(Date.now(), reason, id, next); }
  tokenTombstone(hash: string) { return this.db.prepare('SELECT * FROM soul_token_tombstones_v1 WHERE token_hash = ?').get(hash) as { token_hash: string; world_id: string; soul_id: string; label: string | null; issued_at: number | null; revoked_at: number; reason: string | null } | undefined; }
  /** `reason` records why the outgoing token ended: a new token replaces it; clearing is a revoke unless said otherwise. */
  setSoulToken(id: string, hash: string | null, label: string | null = null, reason: 'replaced' | 'revoked' | 'released' = hash ? 'replaced' : 'revoked') { this.retireToken(id, hash, reason); this.db.prepare('UPDATE souls SET token_hash = ?, token_generation = ?, token_created_at = ?, token_label = ?, token_last_used = NULL WHERE id = ?').run(hash, hash ? `g_${randomUUID()}` : null, hash ? Date.now() : null, hash ? label : null, id); }
  touchSoulToken(id: string) { this.db.prepare('UPDATE souls SET token_last_used = ? WHERE id = ?').run(Date.now(), id); }

  // brain calls
  /** Store a long prompt once; returns a reference the UI can resolve via /v1/prompt/:hash. */
  internPrompt(text: string): { $prompt: string; chars: number } {
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 24);
    this.db.prepare('INSERT OR IGNORE INTO prompts (hash, text, created_at) VALUES (?,?,?)').run(hash, text, Date.now());
    return { $prompt: hash, chars: text.length };
  }
  /** Resolve only a retained originating system reference visible to this caller.
   * Hash possession, response lookalikes and interned-but-unassociated text are
   * not authority. Reads recheck current ownership/role; pruning removes access.
   */
  prompt(hash: string, access: { worldId: string; userId: string; admin: boolean; soulIds?:string[] }): string | null {
    if(access.soulIds?.length===0)return null;
    const ready=access.soulIds?`AND b.soul_id IN (${access.soulIds.map(()=>'?').join(',')})`:'';
    const owner = access.admin ? '' : `AND b.soul_id IN (
      SELECT s.id FROM souls s WHERE s.owner = ? AND s.world_id = b.world_id AND s.retired_at IS NULL
    )`;
    const row = this.db.prepare(`SELECT p.text FROM prompts p WHERE p.hash = ? AND EXISTS (
      SELECT 1 FROM brain_calls b WHERE b.world_id = ?
      AND CASE WHEN json_valid(b.body) THEN json_extract(b.body, '$.request.system[0].text.$prompt') END = p.hash
      ${owner} ${ready}
    )`).get(hash, access.worldId, ...(access.admin ? [] : [access.userId]),...(access.soulIds??[])) as { text: string } | undefined;
    return row?.text ?? null;
  }
  saveBrainCall(worldId: string, c: Omit<BrainCall, 'id'>): number {
    const r = this.db.prepare('INSERT INTO brain_calls (world_id, tick, at, tier, subject, body, cost_usd, ms, soul_id, mode) VALUES (?,?,?,?,?,?,?,?,?,?)').run(worldId, c.tick, c.at, c.tier, c.subject, JSON.stringify(c), c.costUsd, c.ms, c.soulId ?? null, c.mode);
    // hourly rollup: survives pruning of brain_calls, so all-time spend stays exact
    if (c.mode === 'live') this.db.prepare(`INSERT INTO spend_hourly (hour, tier, model, calls, input_tokens, output_tokens, cached_tokens, cost_usd) VALUES (?,?,?,1,?,?,?,?)
      ON CONFLICT(hour, tier, model) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens, cached_tokens = cached_tokens + excluded.cached_tokens, cost_usd = cost_usd + excluded.cost_usd`)
      .run(Math.floor(c.at / 3600_000), c.tier, c.model, c.inputTokens, c.outputTokens, c.cachedTokens, c.costUsd);
    return Number(r.lastInsertRowid);
  }
  /** Calls visible to a viewer: admins see all; owners see calls about their own Souls. */
  brainCalls(limit: number, o: { tier?: string; soulIds?: string[] | null; worldId?:string } = {}): BrainCall[] {
    const where: string[] = [], args: (string | number)[] = [];
    if(o.worldId!==undefined){where.push('world_id = ?');args.push(o.worldId);}
    if (o.tier) { where.push('tier = ?'); args.push(o.tier); }
    if (o.soulIds) { if (!o.soulIds.length) return []; where.push(`soul_id IN (${o.soulIds.map(() => '?').join(',')})`); args.push(...o.soulIds); }
    const rows = this.db.prepare(`SELECT id, body FROM brain_calls ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args, limit) as any[];
    return rows.map((r) => ({ ...JSON.parse(r.body), id: r.id })).reverse();
  }
  brainToday(sinceMs = 0): { calls: number; cost: number; jevMs: number } {
    const since = Math.max(sinceMs, Date.now() - 24 * 3600 * 1000);
    const a = this.db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(cost_usd),0) AS s FROM brain_calls WHERE at > ?').get(since) as any;
    const b = this.db.prepare("SELECT COALESCE(AVG(ms),0) AS m FROM (SELECT ms FROM brain_calls WHERE tier = 'mid' AND ms > 2 ORDER BY id DESC LIMIT 100)").get() as any;
    return { calls: a.c, cost: a.s, jevMs: b.m };
  }
  /** Spend since a time, by tier (live calls only). */
  spendSince(sinceMs: number): { tier: string; calls: number; cost: number; tokens: number }[] {
    return (this.db.prepare('SELECT tier, SUM(calls) AS calls, SUM(cost_usd) AS cost, SUM(input_tokens + output_tokens) AS tokens FROM spend_hourly WHERE hour >= ? GROUP BY tier').all(Math.floor(sinceMs / 3600_000)) as any[]);
  }
  /** Exact spend over the last N minutes from the raw call table (for the short window). */
  spendRecent(sinceMs: number): { tier: string; calls: number; cost: number }[] {
    return this.db.prepare("SELECT tier, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM brain_calls WHERE at >= ? AND mode = 'live' GROUP BY tier").all(sinceMs) as any[];
  }
  spendHourly(hours: number): { hour: number; tier: string; cost: number; calls: number }[] {
    return this.db.prepare('SELECT hour, tier, SUM(cost_usd) AS cost, SUM(calls) AS calls FROM spend_hourly WHERE hour >= ? GROUP BY hour, tier ORDER BY hour').all(Math.floor(Date.now() / 3600_000) - hours + 1) as any[];
  }
  spendByModel(): { model: string; calls: number; cost: number; input: number; output: number; cached: number }[] {
    return this.db.prepare('SELECT model, SUM(calls) AS calls, SUM(cost_usd) AS cost, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cached_tokens) AS cached FROM spend_hourly GROUP BY model').all() as any[];
  }
  spendFirstHour(): number | null { return ((this.db.prepare('SELECT MIN(hour) AS h FROM spend_hourly').get() as any)?.h as number) ?? null; }
  /** Backfill the rollup from calls recorded before it existed (idempotent: only when the rollup is empty). */
  backfillSpend() {
    if ((this.db.prepare('SELECT COUNT(*) AS c FROM spend_hourly').get() as any).c > 0) return;
    for (const r of this.db.prepare('SELECT body FROM brain_calls ORDER BY id').all() as any[]) {
      const c = JSON.parse(r.body); if (c.mode !== 'live') continue;
      this.db.prepare(`INSERT INTO spend_hourly (hour, tier, model, calls, input_tokens, output_tokens, cached_tokens, cost_usd) VALUES (?,?,?,1,?,?,?,?)
        ON CONFLICT(hour, tier, model) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens, cached_tokens = cached_tokens + excluded.cached_tokens, cost_usd = cost_usd + excluded.cost_usd`)
        .run(Math.floor(c.at / 3600_000), c.tier, c.model, c.inputTokens ?? 0, c.outputTokens ?? 0, c.cachedTokens ?? 0, c.costUsd ?? 0);
    }
  }
  /** Call bodies are debugging data: keep a day's worth (and at most `keep` rows). Spend lives on in spend_hourly. */
  pruneBrainCalls(keep = 6000) {
    this.db.prepare('DELETE FROM brain_calls WHERE at < ? OR id <= (SELECT MAX(id) FROM brain_calls) - ?').run(Date.now() - 24 * 3600_000, keep);
  }
  soulSpend(soulId: string): { calls: number; cost: number } { const r = this.db.prepare("SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd),0) AS cost FROM brain_calls WHERE soul_id = ? AND mode = 'live'").get(soulId) as any; return { calls: r.calls, cost: r.cost }; }
  /** Reclaim file space after large deletes (only when it is worth it). */
  vacuumIfBloated() {
    const free = (this.db.prepare('PRAGMA freelist_count').get() as any).freelist_count as number;
    const total = (this.db.prepare('PRAGMA page_count').get() as any).page_count as number;
    if (free > 2000 && free > total * 0.3) { this.db.exec('VACUUM'); return true; }
    return false;
  }

  // talk (rendered words; depiction, not state)
  saveTalk(worldId: string, l: Omit<TalkLine, 'id'>): number {
    return Number(this.db.prepare('INSERT INTO talks (world_id, tick, at, from_id, to_id, body) VALUES (?,?,?,?,?,?)').run(worldId, l.tick, l.at, l.from, l.to, JSON.stringify(l)).lastInsertRowid);
  }
  recentTalk(limit: number, soulId?: string): TalkLine[] {
    const rows = (soulId
      ? this.db.prepare('SELECT id, body FROM talks WHERE from_id = ? OR to_id = ? ORDER BY id DESC LIMIT ?').all(soulId, soulId, limit)
      : this.db.prepare('SELECT id, body FROM talks ORDER BY id DESC LIMIT ?').all(limit)) as any[];
    return rows.map((r) => ({ ...JSON.parse(r.body), id: r.id })).reverse();
  }
  talkBetween(a: string, b: string, limit: number): TalkLine[] {
    return (this.db.prepare('SELECT id, body FROM talks WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id DESC LIMIT ?').all(a, b, b, a, limit) as any[]).map((r) => ({ ...JSON.parse(r.body), id: r.id })).reverse();
  }
  pruneTalk(keep = 20000) { this.db.prepare('DELETE FROM talks WHERE id <= (SELECT MAX(id) FROM talks) - ?').run(keep); }

  // narratives
  saveNarrative(worldId: string, region: string, tick: number, body: Omit<NarrativeView, 'id'>): number {
    return Number(this.db.prepare('INSERT INTO narratives (world_id, region, tick, at, body) VALUES (?,?,?,?,?)').run(worldId, region, tick, Date.now(), JSON.stringify(body)).lastInsertRowid);
  }
  updateNarrative(id: number, body: NarrativeView) { this.db.prepare('UPDATE narratives SET body = ? WHERE id = ?').run(JSON.stringify(body), id); }

  bytes(): number { try { return statSync(this.path).size; } catch { return 0; } }
  async backupTo(dest: string) {
    // One complete SQLite step prevents another connection's intervening
    // writes from repeatedly restarting an incremental100-page copy.
    await backup(this.db, dest, {rate: 0x7fffffff});
  }
  close() { this.db.close(); }
}
const LIGHT_PAYLOAD = "CASE WHEN kind = 'rules' AND author = 'world:recovery' THEN json_object('recovery', json_object('excluded', json(json_extract(payload, '$.recovery.excluded')), 'faults', json(json_extract(payload, '$.recovery.faults')))) ELSE payload END AS payload";
const rowToEvent = (r: any): LogEvent => ({ seq: r.seq, tick: r.tick, kind: r.kind, author: r.author, payload: JSON.parse(r.payload), at: r.at });
