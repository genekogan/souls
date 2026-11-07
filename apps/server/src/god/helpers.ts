// WD7 slice 3: helper child tokens. A lead mints one for a claim it holds; the token can edit only through that claim,
// lives until the claim stops being held (release/done/taken, or the build closes) or its TTL passes, pools its rate
// limits with the lead, and never reaches env, land, strike, others' undo, build lifecycle, minting or pairing.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Failure, Op } from '@souls/world-compiler';
import type { Db } from '../db.ts';

export const HELPER_LIMITS = { defaultTtlMs: 2 * 3_600_000, minTtlMs: 60_000, maxTtlMs: 12 * 3_600_000, perClaim: 4, perWorld: 64, verifyBudget: 3, maxVerifyBudget: 10, mintPerMinute: 12 } as const;
/** Entity and definition ops only. World state, terrain, economy, relationships, prayers and def retirement stay with the lead
 *  (`relate` writes world-wide layers, which no claim may touch). */
export const HELPER_OPS: ReadonlySet<string> = new Set(['place', 'remove', 'move', 'set', 'clone', 'define']);
export type HelperScope = { parent: string; parentLabel: string; build: string; claim: string; part: string; expiresAt: number; verify: { budget: number; used: number } };
type Row = { token_hash: string; parent_hash: string; parent_label: string; label: string; build: string; claim: string; part: string; created_at: number; expires_at: number; verify_budget: number; verify_used: number };
export type ClaimState = 'held' | 'released' | 'done' | 'taken' | 'closed' | 'unknown';

export const helperMintSchema = z.object({ label: z.string().min(1).max(60).optional(), ttlMs: z.number().int().min(HELPER_LIMITS.minTtlMs).max(HELPER_LIMITS.maxTtlMs).optional(), verify: z.number().int().min(0).max(HELPER_LIMITS.maxVerifyBudget).optional() }).strict();
export const helperFailure = (code: 'helper.scope' | 'helper.limit' | 'helper.claim', detail: string, extra: Partial<Failure> = {}): Failure => ({ op: -1, code, field: 'build', detail, fix: code === 'helper.scope' ? 'A helper token edits only inside its own claim; ask the lead for anything else.' : code === 'helper.limit' ? 'Let an earlier helper token expire, or release its claim.' : 'Mint from a claim you hold in an open build.', ...extra });

export class HelperTokens {
  private readonly db: Db; private readonly world: string;
  constructor(db: Db, world: string) {
    this.db = db; this.world = world;
    db.db.exec(`CREATE TABLE IF NOT EXISTS god_helper_tokens_v1 (world_id TEXT NOT NULL, token_hash TEXT NOT NULL, parent_hash TEXT NOT NULL, parent_label TEXT NOT NULL,
      label TEXT NOT NULL, build TEXT NOT NULL, claim TEXT NOT NULL, part TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      verify_budget INTEGER NOT NULL, verify_used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(world_id, token_hash)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS god_helper_tokens_v1_claim ON god_helper_tokens_v1(world_id, build, claim);`);
  }
  private row(hash: string): Row | undefined { return this.db.db.prepare('SELECT token_hash,parent_hash,parent_label,label,build,claim,part,created_at,expires_at,verify_budget,verify_used FROM god_helper_tokens_v1 WHERE world_id=? AND token_hash=?').get(this.world, hash) as Row | undefined; }
  /** Why this hash is not (or no longer) a usable helper; null when it is usable or is not a helper at all. */
  refusal(hash: string, now: number, claim: (build: string, claim: string) => ClaimState, parentLive: (hash: string) => boolean): string | null {
    const r = this.row(hash); return r ? this.ended(r, now, claim, parentLive) : null;
  }
  private ended(r: Row, now: number, claim: (build: string, claim: string) => ClaimState, parentLive: (hash: string) => boolean): string | null {
    if (now >= r.expires_at) return `helper token ${r.label} expired at ${new Date(r.expires_at).toISOString()}`;
    const state = claim(r.build, r.claim);
    if (state !== 'held') return `helper token ${r.label} ended: claim ${r.claim} (${r.part}) on build ${r.build} is ${state}`;
    if (!parentLive(r.parent_hash)) return `helper token ${r.label} ended: its lead token is no longer valid`;
    return null;
  }
  scope(hash: string, now: number, claim: (build: string, claim: string) => ClaimState, parentLive: (hash: string) => boolean): { label: string; scope: HelperScope } | null {
    const r = this.row(hash); if (!r || this.ended(r, now, claim, parentLive)) return null;
    return { label: r.label, scope: { parent: r.parent_hash, parentLabel: r.parent_label, build: r.build, claim: r.claim, part: r.part, expiresAt: r.expires_at, verify: { budget: r.verify_budget, used: r.verify_used } } };
  }
  /** Rows only live while their claim is held; drop dead and expired rows before counting. */
  private prune(now: number, claim: (build: string, claim: string) => ClaimState) {
    const rows = this.db.db.prepare('SELECT token_hash,build,claim,expires_at FROM god_helper_tokens_v1 WHERE world_id=?').all(this.world) as Pick<Row, 'token_hash' | 'build' | 'claim' | 'expires_at'>[];
    const drop = this.db.db.prepare('DELETE FROM god_helper_tokens_v1 WHERE world_id=? AND token_hash=?');
    for (const r of rows) if (now >= r.expires_at || claim(r.build, r.claim) !== 'held') drop.run(this.world, r.token_hash);
  }
  mint(input: { tokenHash: string; parent: { hash: string; label: string }; label: string; build: string; claim: string; part: string; ttlMs: number; verify: number }, now: number, claim: (build: string, claim: string) => ClaimState): Failure | { expiresAt: number } {
    this.prune(now, claim);
    const count = (sql: string, ...args: unknown[]) => (this.db.db.prepare(`SELECT COUNT(*) AS n FROM god_helper_tokens_v1 WHERE world_id=? ${sql}`).get(this.world, ...(args as never[])) as { n: number }).n;
    const perClaim = count('AND build=? AND claim=?', input.build, input.claim);
    if (perClaim >= HELPER_LIMITS.perClaim) return helperFailure('helper.limit', `claim ${input.claim} already has ${perClaim} live helper tokens (max ${HELPER_LIMITS.perClaim}).`, { measured: perClaim, limit: HELPER_LIMITS.perClaim });
    const perWorld = count('');
    if (perWorld >= HELPER_LIMITS.perWorld) return helperFailure('helper.limit', `this world already has ${perWorld} live helper tokens (max ${HELPER_LIMITS.perWorld}).`, { measured: perWorld, limit: HELPER_LIMITS.perWorld });
    const expiresAt = now + input.ttlMs;
    this.db.db.prepare('INSERT INTO god_helper_tokens_v1(world_id,token_hash,parent_hash,parent_label,label,build,claim,part,created_at,expires_at,verify_budget,verify_used) VALUES(?,?,?,?,?,?,?,?,?,?,?,0)')
      .run(this.world, input.tokenHash, input.parent.hash, input.parent.label, input.label, input.build, input.claim, input.part, now, expiresAt, input.verify);
    return { expiresAt };
  }
  /** Spend one verify-use from the token's own budget (atomic); false once spent. */
  spendVerify(hash: string): boolean {
    return !!this.db.db.prepare('UPDATE god_helper_tokens_v1 SET verify_used=verify_used+1 WHERE world_id=? AND token_hash=? AND verify_used<verify_budget RETURNING verify_used').get(this.world, hash);
  }
  live(): { label: string; hash8: string; build: string; claim: string; part: string; expiresAt: number }[] {
    return (this.db.db.prepare('SELECT label,token_hash,build,claim,part,expires_at FROM god_helper_tokens_v1 WHERE world_id=? ORDER BY created_at').all(this.world) as Pick<Row, 'label' | 'token_hash' | 'build' | 'claim' | 'part' | 'expires_at'>[])
      .map(r => ({ label: r.label, hash8: r.token_hash.slice(0, 8), build: r.build, claim: r.claim, part: r.part, expiresAt: r.expires_at }));
  }
}

export const newHelperSecret = () => randomBytes(24).toString('base64url');

/** Admission scope: a helper's build field must name exactly its claim, and its ops must be entity/def ops. */
export function helperScopeFailure(scope: HelperScope, field: { id: string; claim?: string; lease?: string } | undefined, ops?: readonly Op[]): Failure | null {
  if (!field || field.id !== scope.build || field.claim !== scope.claim || field.lease !== undefined)
    return helperFailure('helper.scope', `This helper token may edit only through claim ${scope.claim} (${scope.part}) of build ${scope.build}; got ${field ? `${field.lease !== undefined ? 'a lead lease' : `claim ${field.claim ?? 'none'}`} on build ${field.id}` : 'no build field'}.`, { limit: { build: scope.build, claim: scope.claim, part: scope.part } });
  for (const [i, op] of (ops ?? []).entries()) if (!HELPER_OPS.has(op.op))
    return helperFailure('helper.scope', `Helper tokens cannot submit ${op.op} ops; world, terrain, economy, relationship, prayer and def-retirement edits belong to the lead.`, { op: i, field: 'op' });
  return null;
}

const READS: RegExp[] = [/^\/v1\/god\/(status|schema|parts|edits|previews|recommend|snapshot|trace)$/, /^\/v1\/god\/(defs|catalog|assets)(\/.*)?$/, /^\/v1\/god\/preview\/[^/]+$/, /^\/v1\/god\/requests\/.*$/, /^\/v1\/god\/builds(\/[^/]+)?$/];
const WRITES: RegExp[] = [/^\/v1\/god\/(act|preview|dryrun|query|undo|redo|verify-use|look|kit\/render|assets)$/];
/** Route authorisation for helper tokens (deny by default). Returns the refusal text, or null when allowed. */
export function helperRoute(method: string, rawPath: string, scope: HelperScope): string | null {
  const at = rawPath.indexOf('/v1/god/'), path = at < 0 ? rawPath : rawPath.slice(at);
  if (method === 'GET' || method === 'HEAD') { if (READS.some(r => r.test(path))) return null; }
  else if (method === 'POST') {
    if (WRITES.some(r => r.test(path))) return null;
    const m = path.match(/^\/v1\/god\/builds\/([^/]+)\/(step|check|claims\/([^/]+)\/release)$/);
    if (m) {
      let build: string, claim: string | undefined;
      try { build = decodeURIComponent(m[1]); claim = m[3] ? decodeURIComponent(m[3]) : undefined; } catch { return `helper tokens cannot use a malformed path ${path.slice(0, 120)}`; }
      if (build !== scope.build) return `helper tokens act only on build ${scope.build}, not ${build}`;
      if (claim !== undefined && claim !== scope.claim) return `helper tokens release only their own claim ${scope.claim}`;
      return null;
    }
  }
  return `helper tokens cannot use ${method} ${path}: env, land, strike, prayers, build start/done/abandon/pause/resume, new claims, minting, pairing and the lock doctor belong to the lead`;
}
