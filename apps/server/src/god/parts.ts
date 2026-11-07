// World-local evidence of parts kept by finished builds. Definitions are never modified.
import { defSchema, definitionRefs, hashOf, type Entity, type Op, type StoredDef, type WorldModel } from '@souls/world-compiler';
import { searchDefs } from './assets.ts';
import type { BuildBody, Identity } from './builds.ts';
import type { WorldStore } from './store.ts';
import type { VerifyReceipt } from './verify-use.ts';

export const PART_LIMITS = { perBuild: 64, uses: 4000, receipts: 1000, body: 2048, summary: 1024, suggestions: 8, suggestionBytes: 2048 } as const;
export type DefOrigin = { hash: string; ref: string; label: string | null; hash8: string | null; exact: number };
type Origin = DefOrigin & { seq: number; at: number; grp: string | null };
type Check = { target: string; uses: string; ok: boolean; editSeq: number };
type Use = {
  ref: string;
  build: { id: string; title: string; doneAt: number; doneBy: string; claimsHeld: number; lead: string; agents: string[] };
  placed: number; via: 'direct' | 'extends' | 'param';
  origin: { seq: number; at: number; grp: string | null; by: string | null; exact: boolean };
  definedInBuild: boolean; closure: string[]; assets: { sha: string; license: string | null; by: string | null }[];
  checks: { buildDone: true; kept: number; buildUse: Check[] | 'none-recorded'; partUse: Check[] | 'none-recorded' | 'n/a' };
  source: 'done' | 'backfill'; observedAt?: number;
};
type UseRow = { hash: string; build: string; at: number; body: string };
type VerifyRow = { at: number; entity: string; edit_seq: number; def_hash: string | null; ok: number; body: string };
export type Reuse = { newDefs: number; placedFromParts: number; fromBuilds: string[]; kept: string[]; recorded?: boolean; code?: 'parts.cap' };
type Recording = { recorded: boolean; code?: 'parts.cap' };
type Standing = { placed: number; via: Use['via'] };
const inGroup = (grp: string | null, id: string) => grp === id || !!grp?.startsWith(id + '/');
const identityName = (label: string | null, hash8: string | null) => label === null ? null : label + (hash8 ? '#' + hash8 : '');
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

export class Parts {
  readonly store: WorldStore;
  private host: { model: () => WorldModel; now: () => number };
  private cache?: { seq: number; uses: Map<string, Use[]>; standing: Map<string, Standing> };
  constructor(store: WorldStore, host: Parts['host']) { this.store = store; this.host = host; }
  private get sql() { return this.store.db.db; }
  private get world() { return this.store.worldId; }
  private tx<T>(fn: () => T): T {
    this.sql.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.sql.exec('COMMIT'); return r; } catch (e) { this.sql.exec('ROLLBACK'); throw e; }
  }
  private authored(d: StoredDef | undefined): d is StoredDef { return !!d && d.by === 'god' && !this.host.model().library?.get('sha:' + d.hash); }
  /** Includes identical defines (which have no diff), but never an adoption or restore-def. */
  origins(ops: Op[], after: WorldModel, caller?: Identity): DefOrigin[] {
    if (!ops.some(op => op.op === 'define')) return [];
    const rows = new Map<string, DefOrigin>();
    const refs = new Map<string, number>();
    for (const op of ops) if (op.op === 'define') { const ref = `${op.def.name}@${op.def.version}`; refs.set(ref, (refs.get(ref) ?? 0) + 1); }
    for (const op of ops) if (op.op === 'define') {
      const ref = `${op.def.name}@${op.def.version}`;
      // The compiler already normalized and hashed this define. Rehash only intermediate revisions in one batch.
      let stored = after.def(ref);
      if (refs.get(ref)! > 1) { const { budget: _budget, ...def } = op.def; stored = after.def('sha:' + hashOf(def)); }
      if (this.authored(stored)) rows.set(stored.hash, { hash: stored.hash, ref: stored.ref, label: caller?.label ?? null, hash8: caller?.hash.slice(0, 8) ?? null, exact: 1 });
    }
    return [...rows.values()];
  }
  private firstOrigin(hash: string): Origin | undefined {
    return this.sql.prepare('SELECT hash,ref,seq,at,grp,label,hash8,exact FROM god_def_origins_v1 WHERE world_id=? AND hash=? ORDER BY seq LIMIT 1').get(this.world, hash) as Origin | undefined;
  }
  private isPartOrigin(o: Origin | undefined): o is Origin { return !!o && o.label !== null && !inGroup(o.grp, 'genesis'); }
  private rows(build?: string): UseRow[] {
    return this.sql.prepare(`SELECT hash,build,at,body FROM god_part_uses_v1 WHERE world_id=?${build === undefined ? '' : ' AND build=?'} ORDER BY at DESC,build,hash`).all(this.world, ...(build === undefined ? [] : [build])) as UseRow[];
  }
  /** A hash counts at most once for each entity, even through multiple parameter references. */
  private entityHashes(e: Entity, chains: Map<string, Map<string, Use['via']>>): Map<string, Use['via']> {
    const model = this.host.model();
    let chain = chains.get(e.def);
    if (!chain) {
      chain = new Map(); let d = model.def(e.def);
      while (d && !chain.has(d.hash)) { chain.set(d.hash, chain.size ? 'extends' : 'direct'); d = d.extends ? model.def(d.extends) : undefined; }
      // Store the structural chain only: instance params may override a reference-valued default.
      chains.set(e.def, chain);
    }
    const found = new Map(chain), resolved = model.resolvedDef(e.def);
    const defaults = Object.fromEntries(Object.entries(resolved?.params ?? {}).map(([key, field]) => [key, field.default]));
    for (const ref of definitionRefs({ ...defaults, ...e.params })) {
      let d = model.def(ref); const seen = new Set<string>();
      while (d && !seen.has(d.hash)) { seen.add(d.hash); if (!found.has(d.hash)) found.set(d.hash, 'param'); d = d.extends ? model.def(d.extends) : undefined; }
    }
    return found;
  }
  private standing(ids: Iterable<string>): Map<string, Standing> {
    const out = new Map<string, Standing>(), chains = new Map<string, Map<string, Use['via']>>(), model = this.host.model();
    for (const id of ids) { const e = model.entities.get(id); if (!e) continue;
      for (const [hash, via] of this.entityHashes(e, chains)) { const old = out.get(hash); out.set(hash, { placed: (old?.placed ?? 0) + 1, via: old?.via === 'direct' || via === 'direct' ? 'direct' : old?.via ?? via }); }
    }
    return out;
  }
  private cached() {
    const model = this.host.model();
    if (!this.cache || this.cache.seq !== model.editSeq) {
      const uses = new Map<string, Use[]>();
      for (const row of this.rows()) if (row.hash !== '-') { const list = uses.get(row.hash) ?? []; list.push(JSON.parse(row.body) as Use); uses.set(row.hash, list); }
      this.cache = { seq: model.editSeq, uses, standing: uses.size ? this.standing(model.entities.keys()) : new Map() };
    }
    return this.cache;
  }
  placedNow(hash: string): number { return this.cached().standing.get(hash)?.placed ?? 0; }
  used(hash: string): boolean { const c = this.cached(); return c.uses.has(hash) && (c.standing.get(hash)?.placed ?? 0) > 0; }
  badge(hash: string) { return (this.cached().uses.get(hash) ?? []).map(u => ({ build: u.build.id, placedNow: this.placedNow(hash) })); }
  details(hash: string): Use[] { return structuredClone(this.cached().uses.get(hash) ?? []); }
  private dependencies(hash: string) {
    const model = this.host.model(), seen = new Set([hash]), closure: string[] = [], assets = new Set<string>(), pending = [hash];
    while (pending.length) {
      const d = model.def('sha:' + pending.pop()!); if (!d) continue;
      for (const sha of JSON.stringify(d.make).match(/[0-9a-f]{64}/g) ?? []) if (!model.def('sha:' + sha)) assets.add(sha);
      for (const ref of definitionRefs({ extends: d.extends, make: d.make, contents: d.contents, params: d.params, components: d.components })) {
        const dep = model.def(ref); if (!dep || seen.has(dep.hash)) continue; seen.add(dep.hash);
        if (!model.library?.get('sha:' + dep.hash)) { closure.push(dep.hash); pending.push(dep.hash); }
      }
    }
    return { closure: closure.sort(), assets: [...assets].sort().map(sha => ({ sha, ...(this.sql.prepare('SELECT license,by FROM world_assets_v1 WHERE world_id=? AND sha=?').get(this.world, sha) as { license: string | null; by: string | null } | undefined ?? { license: null, by: null }) })) };
  }
  /** The explicit owner-keep policy can be added here later; today done + live standing is the signal. */
  onDone(id: string, source: Use['source'] = 'done'): Recording {
    const prior = this.rows(id); if (prior.length) return this.recording(prior);
    const row = this.store.build(id); if (!row || row.status !== 'done') return { recorded: false };
    const b = JSON.parse(row.body) as BuildBody, model = this.host.model(), ids = new Set<string>();
    for (const root of b.roots) if (model.entities.has(root)) for (const entity of model.subtree(root)) ids.add(entity);
    const standing = this.standing(ids), receipts = this.sql.prepare('SELECT at,entity,edit_seq,def_hash,ok,body FROM god_verify_receipts_v1 WHERE world_id=? AND at>=? ORDER BY at DESC,entity').all(this.world, row.created_at) as VerifyRow[];
    const latest = new Map<string, VerifyRow>();
    for (const r of receipts) if (ids.has(r.entity) && !latest.has(r.entity)) latest.set(r.entity, r);
    const check = (r: VerifyRow): Check => ({ target: model.pathOf(r.entity), uses: (JSON.parse(r.body) as { uses: { use: string }[] }).uses.map(u => u.use).join(','), ok: !!r.ok, editSeq: r.edit_seq });
    const checks = [...latest.values()], pending: { hash: string; body: string }[] = []; let capped = false;
    for (const [hash, placed] of [...standing].sort(([a], [z]) => a.localeCompare(z))) {
      const d = model.def('sha:' + hash), origin = this.firstOrigin(hash); if (!this.authored(d) || !this.isPartOrigin(origin)) continue;
      if (pending.length === PART_LIMITS.perBuild) { capped = true; continue; }
      const own = this.sql.prepare('SELECT 1 FROM god_def_origins_v1 WHERE world_id=? AND hash=? AND (grp=? OR (grp>=? AND grp<?)) LIMIT 1').get(this.world, hash, id, id + '/', id + '0');
      const resolved = model.resolvedDef('sha:' + hash)!, partChecks = checks.filter(r => r.def_hash === hash).slice(0, 3).map(check);
      const evidence = this.dependencies(hash);
      const interactive = resolved.slots.length || resolved.actions.length || resolved.components.place?.enclosed || (resolved.make.kind === 'mesh' && !!resolved.make.footprint) || (resolved.make.kind === 'gen' && /building/.test(resolved.make.gen));
      const use: Use = { ref: d.ref, build: { id, title: b.title, doneAt: b.done!.at, doneBy: b.done!.byLabel, claimsHeld: b.claims.filter(c => c.status === 'held').length, lead: identityName(b.lead.label, b.lead.hash8)!, agents: b.agents.map(a => identityName(a.label, a.hash8)!) },
        ...placed, origin: { seq: origin.seq, at: origin.at, grp: origin.grp, by: identityName(origin.label, origin.hash8), exact: !!origin.exact }, definedInBuild: !!own, ...evidence,
        checks: { buildDone: true, kept: placed.placed, buildUse: checks.length ? checks.slice(0, 3).map(check) : 'none-recorded', partUse: interactive ? partChecks.length ? partChecks : 'none-recorded' : 'n/a' }, source, ...(source === 'backfill' ? { observedAt: this.host.now() } : {}) };
      if (jsonBytes(use) > PART_LIMITS.body) { capped = true; continue; } // Never truncate provenance or pretend checks ran.
      pending.push({ hash, body: JSON.stringify(use) });
    }
    const outcome = this.tx(() => {
      const existing = this.rows(id); if (existing.length) return this.recording(existing);
      const count = this.useCount(), marker = !pending.length || capped;
      if (count + pending.length + Number(marker) > PART_LIMITS.uses) {
        if (count < PART_LIMITS.uses) this.insertUse('-', id, b.done!.at, JSON.stringify({ recorded: false, code: 'parts.cap', source }));
        return { recorded: false, code: 'parts.cap' as const };
      }
      for (const part of pending) this.insertUse(part.hash, id, b.done!.at, part.body);
      if (marker) this.insertUse('-', id, b.done!.at, JSON.stringify({ recorded: !capped, ...(capped ? { code: 'parts.cap' } : {}), source, ...(source === 'backfill' ? { observedAt: this.host.now() } : {}) }));
      return { recorded: !capped, ...(capped ? { code: 'parts.cap' as const } : {}) };
    });
    this.cache = undefined; return outcome;
  }
  private insertUse(hash: string, build: string, at: number, body: string) { this.sql.prepare('INSERT OR IGNORE INTO god_part_uses_v1(world_id,hash,build,at,body) VALUES(?,?,?,?,?)').run(this.world, hash, build, at, body); }
  private useCount() { return (this.sql.prepare('SELECT count(*) AS n FROM god_part_uses_v1 WHERE world_id=?').get(this.world) as { n: number }).n; }
  private recording(rows: UseRow[]): Recording { const marker = rows.find(r => r.hash === '-'); if (!marker) return { recorded: true }; const value = JSON.parse(marker.body) as Recording; return { recorded: value.recorded, ...(value.code ? { code: value.code } : {}) }; }
  backfill() {
    // Iterate the complete bounded journal, never groupEditsUnder's default 200. INSERT OR IGNORE preserves exact rows.
    const builds = this.store.builds().map(row => ({ ...row, body: JSON.parse(row.body) as BuildBody }));
    if (!this.store.partsOriginsV1) { this.tx(() => {
      const edits = this.sql.prepare("SELECT seq,at,grp,ops FROM world_edits_v1 WHERE world_id=? AND kind='edit' ORDER BY seq").iterate(this.world);
      const insert = this.sql.prepare('INSERT OR IGNORE INTO god_def_origins_v1(world_id,hash,seq,ref,at,grp,label,hash8,exact) VALUES(?,?,?,?,?,?,?,?,0)');
      for (const value of edits) {
        const edit = value as { seq: number; at: number; grp: string | null; ops: string };
        for (const op of JSON.parse(edit.ops) as Op[]) if (op.op === 'define') {
          const parsed = defSchema.safeParse(op.def); if (!parsed.success) continue;
          const { budget: _budget, ...def } = parsed.data, hash = hashOf(def), stored = this.host.model().def('sha:' + hash); if (!this.authored(stored)) continue;
          const build = builds.find(b => inGroup(edit.grp, b.id)), caller = !inGroup(edit.grp, 'genesis') ? build?.body.lead : undefined;
          insert.run(this.world, hash, edit.seq, stored.ref, edit.at, edit.grp, caller?.label ?? null, caller?.hash8 ?? null);
        }
      }
      this.sql.prepare("UPDATE world_meta_v1 SET body=json_set(body,'$.partsOriginsV1',json('true')) WHERE world_id=?").run(this.world);
    }); this.store.partsOriginsV1 = true; }
    for (const build of builds) if (build.status === 'done' && !this.rows(build.id).length) this.onDone(build.id, 'backfill');
  }
  recordVerify(receipt: VerifyReceipt, caller: Identity) {
    const model = this.host.model(), target = typeof receipt.target === 'string' ? receipt.target : '', entity = model.get(target), def = entity && model.resolvedDef(entity.def);
    // Embedders may return only an outcome. Missing facts stay absent; they cannot become part checks.
    const summary = { uses: (receipt.uses ?? []).slice(0, 2).map(u => ({ use: u.use, ok: u.ok, ...(u.reason ? { code: u.reason.code } : {}) })), ms: Number.isFinite(receipt.ms) ? receipt.ms : 0 };
    const body = JSON.stringify(summary); if (Buffer.byteLength(body) > PART_LIMITS.summary) throw new Error('verify summary exceeds parts receipt budget');
    this.tx(() => {
      // Multiple calls can finish in the same millisecond. Keep each one with a monotonic local stamp.
      const last = (this.sql.prepare('SELECT MAX(at) AS at FROM god_verify_receipts_v1 WHERE world_id=?').get(this.world) as { at: number | null }).at;
      const at = Math.max(this.host.now(), (last ?? -1) + 1);
      this.sql.prepare('INSERT INTO god_verify_receipts_v1(world_id,at,entity,edit_seq,def_hash,ok,label,hash8,body) VALUES(?,?,?,?,?,?,?,?,?)').run(this.world, at, entity?.id ?? target.slice(0, 200), model.editSeq, def?.hash ?? null, Number(receipt.ok), caller.label, caller.hash.slice(0, 8), body);
      this.sql.prepare('DELETE FROM god_verify_receipts_v1 WHERE world_id=? AND (at,entity) IN (SELECT at,entity FROM god_verify_receipts_v1 WHERE world_id=? ORDER BY at DESC,entity LIMIT -1 OFFSET ?)').run(this.world, this.world, PART_LIMITS.receipts);
    });
  }
  reuseOf(id: string): Reuse {
    const origins = this.sql.prepare('SELECT DISTINCT hash FROM god_def_origins_v1 WHERE world_id=? AND label IS NOT NULL AND (grp=? OR (grp>=? AND grp<?))').all(this.world, id, id + '/', id + '0') as { hash: string }[];
    const rows = this.rows(id), uses = rows.filter(r => r.hash !== '-').map(r => ({ hash: r.hash, use: JSON.parse(r.body) as Use }));
    // Open builds have no use rows yet. Measure their currently standing parts under their roots.
    const build = this.store.build(id), b = build && JSON.parse(build.body) as BuildBody | null;
    const ids = new Set<string>(); if (b) for (const root of b.roots) if (this.host.model().entities.has(root)) for (const entity of this.host.model().subtree(root)) ids.add(entity);
    const placed = uses.length ? new Map(uses.map(u => [u.hash, u.use.placed])) : new Map([...this.standing(ids)].map(([hash, s]) => [hash, s.placed]));
    let placedFromParts = 0; const fromBuilds = new Set<string>();
    const observedAt = b?.done?.at ?? uses[0]?.use.build.doneAt ?? this.host.now();
    for (const [hash, count] of placed) {
      const earlier = (this.cached().uses.get(hash) ?? []).filter(u => u.build.id !== id && u.build.doneAt <= observedAt);
      if (earlier.length) { placedFromParts += count; earlier.forEach(u => fromBuilds.add(u.build.id)); }
    }
    const result: Reuse = { newDefs: origins.length, placedFromParts, fromBuilds: [...fromBuilds].sort(), kept: uses.map(u => u.use.ref).sort() };
    if (build?.status === 'done') Object.assign(result, rows.length ? this.recording(rows) : { recorded: false, ...(this.useCount() >= PART_LIMITS.uses ? { code: 'parts.cap' } : {}) });
    return result;
  }
  warnings(ops: Op[]): string[] {
    const model = this.host.model(), out: string[] = [];
    for (const op of ops) if (op.op === 'define') {
      const ref = `${op.def.name}@${op.def.version}`, current = model.def(ref); if (!current) continue;
      const { budget: _budget, ...def } = defSchema.parse(op.def); if (hashOf(def) === current.hash) continue;
      const use = this.cached().uses.get(current.hash)?.[0]; if (!use) continue;
      const copies = [...model.entities.values()].filter(e => e.def === ref).length;
      out.push(`${ref} is a part of done build ${use.build.id} (${copies} copies placed by name); this changes them — place by sha: or use a new name to leave it as built`);
    }
    return out;
  }
  list(q = '', limit = 50) {
    const cache = this.cached(), model = this.host.model(), defs = [...cache.uses.keys()].flatMap(hash => { const d = model.def('sha:' + hash); return d ? [d] : []; });
    const hits = searchDefs(defs, q.slice(0, 2048), { limit: PART_LIMITS.uses });
    hits.sort((a, b) => Number(this.placedNow(a.def.hash) === 0) - Number(this.placedNow(b.def.hash) === 0) || b.score - a.score || cache.uses.get(b.def.hash)!.length - cache.uses.get(a.def.hash)!.length || cache.uses.get(b.def.hash)![0].build.doneAt - cache.uses.get(a.def.hash)![0].build.doneAt || a.def.hash.localeCompare(b.def.hash));
    return hits.slice(0, Math.max(1, Math.min(500, Math.floor(limit) || 50))).map(({ def }) => {
      const uses = cache.uses.get(def.hash)!, first = uses[0];
      return { sha: def.hash, ref: def.ref, from: uses.slice(0, 3).map(u => ({ build: u.build.id, title: u.build.title, doneAt: u.build.doneAt })), placedNow: this.placedNow(def.hash), firstBy: first.origin.by, checks: first.checks, place: `place sha:${def.hash} …` };
    });
  }
  suggest(build: { title: string; plan: { steps: string[]; brief?: string } }) {
    const out: ReturnType<Parts['list']> = [];
    for (const part of this.list([build.title, ...build.plan.steps, build.plan.brief?.slice(0, 400) ?? ''].join(' '), 500)) {
      // Compact provenance without hiding whether a check was actually recorded.
      const compact = { ...part, from: part.from.slice(0, 1) };
      if (out.length === PART_LIMITS.suggestions) break;
      if (jsonBytes([...out, compact]) <= PART_LIMITS.suggestionBytes) out.push(compact);
    }
    return out;
  }
}
