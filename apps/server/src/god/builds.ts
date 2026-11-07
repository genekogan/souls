// Build records are server metadata, never entity state. Planning is pure; only committed writes replace the cache.
import { lockStatus, type Holder } from '../../../../tools/god-skill/lib/locks.mjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hashOf, obbOverlap, type Batch, type Diff, type Failure, type WorldModel, type OBB, type Op } from '@souls/world-compiler';
import type { BuildReceipt } from './build-integrity.ts';
import { type BuildRow, type BuildWrite, type EditRow, WorldStore } from './store.ts';
import { helperScopeFailure, type ClaimState, type HelperScope } from './helpers.ts';
import { accountKey, cobuilderFailure, labelAccount, whose } from './cobuilders.ts';

export const BUILD_LIMITS = { open: 8, roots: 256, closed: 200, claims: 8, retainedClaims: 32, made: 64, startPerMinute: 6, editsPerMinute: 120, bodyBytes: 65_536, transitionBytes: 256 } as const;
/** CE8: the lead's latest look target. Memory only (no SQL, no rev, no history); at most one publish per minMs per build. */
export const ATTENTION = { minMs: 1000, ttlMs: 20_000, perMinute: 120 } as const;
export type Attention = { at: [number, number, number]; eye?: [number, number, number]; t: number };
export const buildCodes = ['build.unknown', 'build.closed', 'build.exists', 'build.limit', 'build.site', 'build.group', 'build.lease', 'build.leased', 'build.claim', 'build.claimed', 'build.claim-unknown', 'build.claims-open', 'build.undo-incomplete', 'build.outside', 'build.rewind', 'build.depends'] as const;
const fixes: Record<typeof buildCodes[number], string> = {
  'build.outside': 'Name the existing entity with build start --include <ref> or build step --include <ref>, then retry.',
  'build.unknown': '`build` lists open builds; use `build start <id>`.',
  'build.closed': 'Start a new build with a new id.',
  'build.exists': 'Pick a new id (church-2), or use `build resume <id>`.',
  'build.limit': 'Finish or abandon an open build (`build abandon <id>` for a long-paused one).',
  'build.site': 'Move or shrink the site or mass.',
  'build.group': 'Drop group, or carry the build.',
  'build.lease': 'Use `build resume <id>` to see who leads now.',
  'build.leased': 'Wait, ask the lead, or use `build resume <id> --take` if it has stopped.',
  'build.claim': 'Edit only under the claim root or inside its region, or ask the lead.',
  'build.claimed': 'Release the claim or wait until its holder goes quiet.',
  'build.claim-unknown': 'Use `build resume <id>` to see the claims.',
  'build.claims-open': 'Release live claims, or use --force.',
  'build.undo-incomplete': 'The build stays open; see notReverted.',
  'build.rewind': '`build show` lists the steps; rewind --to takes 0 (the start) up to the newest step.',
  'build.depends': 'Undo the later edit first, or rewind to a later step.',
};
export const buildFailure = (code: typeof buildCodes[number], detail: string, field = 'build', extra: Partial<Failure> = {}): Failure => ({ op: -1, code, detail, field, fix: fixes[code], ...extra });
/** Leave room for lazy pause/closure markers on all author-controlled writes. */
export function buildBodyFailure(body: string, reserve = true): Failure | undefined {
  const measured = Buffer.byteLength(body), limit = BUILD_LIMITS.bodyBytes - (reserve ? BUILD_LIMITS.transitionBytes : 0);
  if (measured > limit) return buildFailure('build.limit', `Build body requires ${measured} bytes; limit is ${limit}.`, 'build', { measured, limit, fix: 'Shorten the note, summary or step labels, or finish this build and start a new one.' });
}
const fail = (code: typeof buildCodes[number], detail: string, field?: string, extra?: Partial<Failure>) => ({ ok: false as const, failures: [buildFailure(code, detail, field, extra)] });
const schemaFailure = (error: z.ZodError) => ({ ok: false as const, failures: error.issues.map(i => ({ op: -1, code: 'schema', field: i.path.join('.'), detail: i.message, fix: 'Use the build shapes in GET /v1/god/schema.' })) });
const pair = z.tuple([z.number().finite(), z.number().finite()]);
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const includeSchema = z.array(z.string().min(1).max(300)).max(512);
const asksSchema = z.array(z.string().min(1).max(500)).max(64);
const labelSchema = z.string().min(1).max(60);
export const buildFieldSchema = z.object({ id: idSchema, lease: z.string().regex(/^l_[0-9a-f]{8}$/).optional(), claim: z.string().regex(/^c_[0-9a-f]{8}$/).optional(), step: z.number().int().min(0).max(999).optional(), label: z.string().max(60).optional(), done: z.boolean().optional() }).strict().refine(f => (f.lease !== undefined) !== (f.claim !== undefined), 'Supply exactly one of lease and claim.');
const siteSchema = z.object({ at: pair, size: z.tuple([z.number().min(1).max(200), z.number().min(1).max(200)]), yaw: z.number().finite().default(0) }).strict();
export const massSchema = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,18}$/).optional(), at: pair, size: z.tuple([z.number().positive().max(200), z.number().positive().max(200)]), h: z.number().min(.5).max(120), yaw: z.number().finite().optional(), roof: z.enum(['flat', 'gable', 'pyramid']).optional() }).strict();
// Y3 districts: a chapter of a district plan (site, massing, title and steps are filled from the plan by districts.ts).
export const buildDistrictSchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,29}$/), plots: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,7}$/)).min(1).max(8) }).strict().describe('District chapter: send only {id, district: {id, plots?}} plus optional brief, asks, include, title, steps; the server fills site, massing, title and steps from the plan (see districts.chapter).');
export const buildStartSchema = z.object({ id: idSchema, title: z.string().min(1).max(80), steps: z.array(labelSchema).min(1).max(24), site: siteSchema, massing: z.array(massSchema).max(8).default([]), brief: z.string().max(4000).optional(), asks: asksSchema.optional(), root: z.string().min(1).max(300).optional(), include: includeSchema.optional(), district: buildDistrictSchema.optional() }).strict();
const STEP_CALLS = 256;
const cleanText = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/ {2,}/g, ' ').trim();
export const buildActionSchemas = {
  step: z.object({ include: includeSchema.optional(), asks: asksSchema.optional(), lease: buildFieldSchema.shape.lease, claim: buildFieldSchema.shape.claim, n: z.number().int().min(0).max(999).optional(), label: z.string().max(60).optional(), say: z.string().transform(cleanText).pipe(z.string().min(1).max(140)).optional(), masses: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,18}$/)).max(8).optional() }).strict().refine(f => (f.lease !== undefined) !== (f.claim !== undefined), 'Supply exactly one of lease and claim.'),
  pause: z.object({ lease: z.string().regex(/^l_[0-9a-f]{8}$/).optional(), note: z.string().max(4000).optional() }).strict(),
  resume: z.object({ lease: z.string().regex(/^l_[0-9a-f]{8}$/).optional(), take: z.boolean().optional() }).strict(),
  done: z.object({ summary: z.string().max(4000).optional(), force: z.boolean().optional() }).strict(),
  abandon: z.object({ undo: z.boolean().optional(), force: z.boolean().optional() }).strict(),
  claim: z.object({ part: z.string().regex(/^[a-z0-9][a-z0-9-]{0,18}$/), root: z.string().min(1).max(300).optional(), region: siteSchema.optional(), take: z.string().regex(/^c_[0-9a-f]{8}$/).optional() }).strict().refine(c => !!(c.root || c.region || c.take), 'Supply a root, region, or stale claim to take.'),
  release: z.object({ done: z.boolean().optional() }).strict(),
  rewind: z.object({ to: z.number().int().min(0).max(999), dry: z.boolean().optional(), force: z.boolean().optional() }).strict(),
  attention: z.object({ lease: z.string().regex(/^l_[0-9a-f]{8}$/).optional(), at: z.tuple([z.number().finite(), z.number().finite().min(-2000).max(2000), z.number().finite()]), eye: z.tuple([z.number().finite().min(-1e5).max(1e5), z.number().finite().min(-1e5).max(1e5), z.number().finite().min(-1e5).max(1e5)]).optional() }).strict(),
};
export type BuildField = z.infer<typeof buildFieldSchema>;
export type Mass = z.infer<typeof massSchema>;
export type Site = z.infer<typeof siteSchema>;
/** `child`: a helper token minted for one claim (WD7 slice 3); its rate limits and claim custody pool with `child.parent`.
 *  `cobuilder`: the co-builder account of the token (or of a helper's lead), Y4b; absent for owner tokens. */
export type Identity = { hash: string; label: string; holder?: Holder; child?: HelperScope; cobuilder?: string };
/** The token whose claim custody and rate limits a caller shares: the lead for a helper, otherwise itself. */
export const poolOf = (caller: Identity) => caller.child?.parent ?? caller.hash;
export const isIdentity = (v: unknown): v is Identity => !!v && typeof v === 'object' && typeof (v as Identity).hash === 'string';
/** Attribution for routes whose requireGod returns the caller (WD7 slice 2: every journal row names its token). */
export const callerOf = (v: unknown): BuildCaller => isIdentity(v) ? { identity: v } : {};
export type BuildCaller = { identity?: Identity; build?: BuildField };
export type Claim = { id: string; part: string; root?: string; region?: Site; made: string[]; step: { n: number; label: string }; status: 'held' | 'released' | 'done' | 'taken'; lastAt: number; holder: { label: string; hash8: string; process?: Holder }; user: { hash8: string; tokenHash: string }; takenBy?: { claim: string; label: string; at: number } };
type Caption = { text: string; at: number };
export type BuildBody = {
  id: string; title: string; plan: { steps: string[]; brief?: string; asks?: string[] }; root?: string; chapterOf?: string; district?: { id: string; plots: string[] }; include?: string[]; initialRoots?: string[]; refusals?: { at: number; code: string; entity?: string; detail: string }[]; refusalCount?: number; site: Site; massing: Mass[]; roots: string[];
  lead: { lease: string; label: string; hash8: string; tokenHash: string; since: number; holder?: Holder };
  step: { n: number; label: string; at: number; seq: number | null };
  steps: { n: number; label: string; claim?: string; batches: number; firstSeq: number; lastSeq: number; at: number }[];
  claims: Claim[]; agents: { label: string; hash8: string; at: number }[]; pauses: number;
  firstEditAt?: number; lastEditAt?: number; paused?: { from: number; seenAt: number; explicit?: boolean; note?: string };
  lastBatchAt?: number; closureLapsedAt?: number; say?: Caption; sayAt?: number; designing?: string[]; note?: Caption; stepCalls?: string[];
  done?: { at: number; summary?: string; byLabel: string; receipt?: BuildReceipt };
  abandoned?: { at: number; undo?: { reverted: number[]; notReverted: number[] } }; startHash: string;
  /** Y5: newest rewinds (owner card history). */
  rewinds?: { at: number; to: number; from: number; edits: number; removed: number; byLabel: string }[];
};
type Row = Omit<BuildRow, 'body'> & { body: BuildBody };
export type PublicSite = { id: string; title: string; status: BuildRow['status']; rev: number; lastAt: number; pauseAfterMs: number; closed: boolean; step: { n: number; label: string; of: number }; site: Site; massing: Mass[]; roots: string[]; claims: { part: string; status: Claim['status'] | 'stale' }[]; say?: Caption; designing?: string[]; note?: Caption; reopensAt?: number; attention?: Attention };
export type SiteDelta = Pick<PublicSite, 'id' | 'rev' | 'status' | 'lastAt' | 'say' | 'designing' | 'note' | 'reopensAt' | 'attention'> & { closed?: boolean; step?: PublicSite['step']; claim?: PublicSite['claims'][number]; rootsAdded?: string[]; rootsRemoved?: string[] };
export type BuildEcho = { id: string; status: BuildRow['status']; rev: number; group?: string; step: { n: number; label: string }; claim?: string };
export type BuildEventKind = 'started' | 'step' | 'alive' | 'paused' | 'resumed' | 'claimed' | 'released' | 'taken' | 'done' | 'abandoned' | 'closure-lifted' | 'rewound';
/** `attention` carries the site's current rev without advancing it: viewers apply it outside the rev sequence. */
export type WorldBuildMessage = { type: 'edge'; kind: 'world-build'; rev: number; now: number; event: BuildEventKind | 'attention'; site?: PublicSite; delta?: SiteDelta };
export type BuildNotice = { kind: BuildEventKind; id: string; rev: number; now: number; delta: SiteDelta; view?: GodBuildView };
export type GodBuildView = Omit<BuildBody, 'lead' | 'roots' | 'claims' | 'massing'> & {
  chapters?: { id: string; brief?: string; asks?: string[] }[];
  status: BuildRow['status']; rev: number; createdAt: number; lastAt: number; pauseAfterMs: number; now: number; closed: boolean; reopensAt?: number;
  lead: { label: string; hash8: string; since: number; live: boolean; holder?: Holder }; roots: { id: string; path: string }[];
  claims: (Omit<Claim, 'user' | 'status'> & { status: Claim['status'] | 'stale'; rootPath?: string })[];
  current: (BuildBody['steps'][number] & { recent: { seq: number; note: string | null; at: number }[] }) | null;
  next: { n: number; label: string } | null; massing: (Mass & { parts: number })[];
};
type RootChange = { added: string[]; removed: string[] };
export type RootsDelta = { changes: Map<string, RootChange>; warnings: string[]; removed: ReadonlySet<string> };
type PlannedWrite = BuildWrite & { kind: BuildEventKind; before: Row; next: BuildBody; roots: RootChange; claim?: PublicSite['claims'][number] };
type Admission = { field?: BuildField; row?: Row; mine?: LiveClaim; group?: string; warnings: string[]; failures?: Failure[] };
const holderName = (h: Holder | undefined, label: string) => h ? `${label} pid=${h.pid} host=${h.host} start=${h.start}` : label;
const lease = () => 'l_' + randomBytes(4).toString('hex');
const claimId = () => 'c_' + randomBytes(4).toString('hex');
const decode = (r: BuildRow): Row => {
  const body = JSON.parse(r.body); delete body.closureLiftedAt;
  // Old rows recorded committed work as lastEditAt; request liveness must never extend their closure.
  body.lastBatchAt ??= body.lastEditAt;
  return { ...r, body };
};
const open = (r: Pick<Row, 'status'>) => r.status === 'active' || r.status === 'paused';
export const effective = (r: Pick<Row, 'status' | 'last_at'>, now: number, pauseMs: number): BuildRow['status'] => r.status === 'active' && now - r.last_at > pauseMs ? 'paused' : r.status;
/** Same yaw convention as model.worldPose (local +x rotates toward -z). */
export function siteLocal(site: Site, p: [number, number]): [number, number] { const x = p[0] - site.at[0], z = p[1] - site.at[1], c = Math.cos(site.yaw), s = Math.sin(site.yaw); return [x * c - z * s, x * s + z * c]; }
export function siteWorld(site: Site, p: [number, number]): [number, number] { const c = Math.cos(site.yaw), s = Math.sin(site.yaw); return [site.at[0] + p[0] * c + p[1] * s, site.at[1] - p[0] * s + p[1] * c]; }
export function inSite(site: Site, p: [number, number], margin = 0): boolean { const [x, z] = siteLocal(site, p); return Math.abs(x) <= site.size[0] / 2 + margin && Math.abs(z) <= site.size[1] / 2 + margin; }
const box = (site: Site): OBB => ({ c: site.at, half: [site.size[0] / 2, site.size[1] / 2], yaw: site.yaw, y0: -1e6, y1: 1e6 });
const meets = (m: WorldModel, id: string, site: Site): boolean => { const fs = m.footprintsOf(id); if (fs.length) return fs.some(f => obbOverlap(f, box(site))); const p = m.worldPose(m.entities.get(id)!); return inSite(site, [p.x, p.z]); };
export const CLOSURE_MARGIN_M = 1.5;
export type ClosingSite = { id: string; site: Site; roots: string[]; zones: Site[] };
export const inClosure = (site: Pick<ClosingSite, 'zones'>, p: [number, number]) => site.zones.some(zone => inSite(zone, p));
/** Current collider footprints, with a point fallback for non-solid roots such as signs. */
function entityBoxes(model: WorldModel, id: string): Site[] {
  const e = model.entities.get(id); if (!e) return [];
  const def = e.in.parent === 'world' ? undefined : model.resolvedDef(e.def);
  const fs = e.in.parent === 'world' ? model.footprintsOf(id) : def?.layer === 'solid' ? model.footprint(e, def) : [];
  if (fs.length) return fs.map(f => ({ at: f.c, size: [f.half[0] * 2, f.half[1] * 2], yaw: f.yaw }));
  const p = model.worldPose(e); return [{ at: [p.x, p.z], size: [0, 0], yaw: p.yaw }];
}
function closureZones(b: Pick<BuildBody, 'site' | 'massing' | 'roots'>, model: WorldModel): Site[] {
  const zones: Site[] = b.massing.map(m => ({ at: siteWorld(b.site, m.at), size: [...m.size], yaw: b.site.yaw + (m.yaw ?? 0) }));
  const seen = new Set<string>();
  for (const root of b.roots) for (const id of model.entities.has(root) ? model.subtree(root) : []) {
    if (seen.has(id)) continue; seen.add(id);
    if (model.resolvedDef(model.entities.get(id)!.def)?.components.body) continue;
    zones.push(...entityBoxes(model, id));
  }
  return zones.map(s => ({ ...s, size: [s.size[0] + 2 * CLOSURE_MARGIN_M, s.size[1] + 2 * CLOSURE_MARGIN_M] }));
}
/** Segment clipping also catches thin/concave named places crossing a zone without a vertex inside it. */
export function closureMeetsPolygon(zones: Site[], polygon: [number, number][]): boolean {
  if (polygon.length < 3) return false;
  return zones.some(zone => {
    const p = polygon.map(v => siteLocal(zone, v)), [hx, hz] = zone.size.map(v => v / 2);
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[j], b = p[i];
      if ((a[1] > 0) !== (b[1] > 0) && 0 < (b[0] - a[0]) * -a[1] / (b[1] - a[1]) + a[0]) inside = !inside;
      let lo = 0, hi = 1;
      for (const [v, d, h] of [[a[0], b[0] - a[0], hx], [a[1], b[1] - a[1], hz]]) {
        if (d === 0) { if (Math.abs(v) > h) { hi = -1; break; } }
        else { const t = [(-h - v) / d, (h - v) / d].sort((x, y) => x - y); lo = Math.max(lo, t[0]); hi = Math.min(hi, t[1]); }
      }
      if (lo <= hi) return true;
    }
    return inside;
  });
}
export type BuildInventory = {
  things: { id: string; path: string; def: string }[]; seats: { id: string; path: string; occupied: boolean }[];
  places: { id: string; name: string }[]; owned: { id: string; path: string; owner: string | null }[];
  bodies: { name: string; soulId?: string }[]; counts?: Partial<Record<'things' | 'seats' | 'places' | 'owned' | 'bodies', number>>;
};
export type BuildInventoryContext = {
  occupied: (id: string) => boolean;
  places: { id: string; name: string; polygon: [number, number][] }[];
  bodies: { name: string; soulId?: string; at: [number, number] }[];
};
type Scope = { roots: Set<string>; region?: Site };
export type LiveClaim = Claim & { scope: Scope };
const scoped = (c: Claim): LiveClaim => ({ ...c, scope: { roots: new Set([...(c.root ? [c.root] : []), ...c.made]), ...(c.region ? { region: c.region } : {}) } });
const inScope = (m: WorldModel, id: string, roots: ReadonlySet<string>): boolean => {
  for (let e = m.entities.get(id); e; e = m.entities.get(e.in.parent)) if (roots.has(e.id)) return true;
  return false;
};
const newTops = (before: WorldModel, after: WorldModel, diff: Diff) => diff.upserts.filter(e => !before.entities.has(e.id) && (e.in.parent === 'world' || before.entities.has(e.in.parent)) && !after.resolvedDef(e.def)?.components.body).map(e => e.id);
const containsRect = (site: Site, region: Site) => [-1, 1].every(x => [-1, 1].every(z => inSite(site, siteWorld(region, [x * region.size[0] / 2, z * region.size[1] / 2]), 1e-7)));
/** Region geometry is evaluated in the current parent frame. A moved ancestor need not reindex its children. */
function regionTest(m: WorldModel) {
  const shapes = new Map<string, { boxes: OBB[] } | { point: [number, number] }>();
  return (id: string, region: Site, contained = false): boolean => {
    let shape = shapes.get(id);
    if (!shape) {
      const e = m.entities.get(id)!;
      // World-level boxes are already current. Descendants may still carry an ancestor's old indexed pose.
      const def = e.in.parent === 'world' ? undefined : m.resolvedDef(e.def);
      const fs = e.in.parent === 'world' ? m.footprintsOf(id) : def?.layer === 'solid' ? m.footprint(e, def) : [];
      if (fs.length) shape = { boxes: fs };
      else { const p = m.worldPose(e); shape = { point: [p.x, p.z] }; }
      shapes.set(id, shape);
    }
    if ('point' in shape) return inSite(region, shape.point);
    return contained ? shape.boxes.every(f => containsRect(region, { at: f.c, size: [f.half[0] * 2, f.half[1] * 2], yaw: f.yaw })) : shape.boxes.some(f => obbOverlap(f, box(region)));
  };
}
/** Symmetric admission, also used before a stale claim can resume. Each scope subtree is expanded once. */
function overlappingClaim(model: WorldModel, scope: Scope, others: readonly LiveClaim[]): LiveClaim | undefined {
  const members = (roots: ReadonlySet<string>) => new Set([...roots].flatMap(id => model.entities.has(id) ? model.subtree(id) : []));
  const ours = members(scope.roots), meetsRegion = regionTest(model);
  return others.find(c => {
    const theirs = members(c.scope.roots);
    return [...ours].some(id => theirs.has(id) || c.region && meetsRegion(id, c.region))
      || !!scope.region && (!!c.region && obbOverlap(box(scope.region), box(c.region)) || [...theirs].some(id => meetsRegion(id, scope.region!)));
  });
}

/** WD7 slice 3: explicit existing targets (move/set/remove ids; place/move/clone parents) must already lie inside the claim. */
function outsideClaim(model: WorldModel, mine: LiveClaim, ops: readonly Op[]): Failure | null {
  for (const [i, op] of ops.entries()) {
    // A root-only claim cannot adopt a new world-root thing; only a region claim can (decided geometrically in claimCheck).
    // Where the op puts things: place/move/clone parents (a clone defaults to its source's parent). Reading a clone source is fine.
    const source = op.op === 'clone' && !op.id.startsWith('$') ? model.get(op.id) : undefined;
    const parent = op.op === 'place' ? op.in?.parent ?? 'world' : op.op === 'move' ? op.in?.parent : op.op === 'clone' ? op.in?.parent ?? source?.in.parent : undefined;
    if (parent === 'world' && !mine.region) return { op: i, code: 'helper.scope', field: 'in.parent', detail: `A new thing at the world root is outside claim ${mine.id} (${mine.part}); place it under ${mine.root ?? 'the claim root'}.`, limit: { claim: mine.id, root: mine.root }, fix: 'Place under the claim root, or ask the lead.' };
    const targets: [string, string][] = [];
    if (op.op === 'move' || op.op === 'set' || op.op === 'remove') targets.push([op.id, 'id']);
    if (parent && parent !== 'world') targets.push([parent, 'in.parent']);
    for (const [ref, field] of targets) {
      if (ref.startsWith('$')) continue;
      const e = model.get(ref); if (!e || inScope(model, e.id, mine.scope.roots)) continue;
      return { op: i, code: 'helper.scope', field, entity: e.id, detail: `${model.pathOf(e.id) || e.id} is outside claim ${mine.id} (${mine.part}); a helper token edits only inside its claim.`, limit: { claim: mine.id, root: mine.root, region: mine.region }, fix: 'Edit only under the claim root or inside its region, or ask the lead.' };
    }
  }
  return null;
}

/** Pure: scope is read from both worlds; speculative made ids never enter the cached claim. */
export function claimCheck(before: WorldModel, after: WorldModel, diff: Diff, ops: Op[], mine: LiveClaim | undefined, others: readonly LiveClaim[]): { failure: Failure } | { made: string[] } {
  if (!mine && !others.length) return { made: [] };
  const made: string[] = [], myRoots = mine ? new Set(mine.scope.roots) : undefined, afterRegion = regionTest(after);
  if (mine?.scope.region) for (const id of newTops(before, after, diff)) if (!inScope(after, id, myRoots!) && after.subtree(id).every(child => afterRegion(child, mine.scope.region!, true))) { myRoots!.add(id); if (!mine.made.includes(id)) made.push(id); }
  const touched: ['up' | 'rm', string][] = [...diff.upserts.map(e => ['up', e.id] as ['up', string]), ...diff.removes.map(id => ['rm', id] as ['rm', string])];
  for (const [kind, id] of touched) {
    const existed = before.entities.has(id), path = () => (kind === 'up' ? after : before).pathOf(id) || id;
    const touches = (roots: Set<string>) => existed && inScope(before, id, roots) || kind === 'up' && inScope(after, id, roots);
    const other = others.find(c => touches(c.scope.roots));
    const opOf = () => ops.findIndex(o => 'id' in o && (before.get(o.id as string)?.id === id || after.get(o.id as string)?.id === id));
    if (other) return { failure: buildFailure('build.claimed', `${path()} is inside claim ${other.id} (${other.part}), held by ${holderName(other.holder.process, other.holder.label)}.`, 'id', { op: opOf(), entity: id, limit: { claim: other.id, part: other.part, root: other.root, region: other.region } }) };
  }
  const regions = others.filter(c => c.scope.region);
  if (regions.length) {
    const beforeRegion = regionTest(before), affected = new Set<string>();
    for (const e of diff.upserts) {
      const prev = before.entities.get(e.id);
      // Version, name and state-only upserts cannot enter a region. Parent changes still expand to all children.
      const changed = !prev || diff.defs.length || diff.constants || prev.def !== e.def || prev.params !== e.params || prev.shape !== e.shape || prev.seed !== e.seed || prev.p !== e.p || prev.r !== e.r || prev.s !== e.s || prev.in.parent !== e.in.parent || prev.in.slot !== e.in.slot;
      if (changed && !affected.has(e.id)) for (const id of after.subtree(e.id)) affected.add(id);
    }
    for (const id of affected) {
      const other = regions.find(c => afterRegion(id, c.scope.region!) && (!before.entities.has(id) || !beforeRegion(id, c.scope.region!)));
      if (other) return { failure: buildFailure('build.claimed', `${after.pathOf(id) || id} enters claim ${other.id} (${other.part}), held by ${holderName(other.holder.process, other.holder.label)}.`, 'id', { op: ops.findIndex(o => 'id' in o && after.subtree(after.get(o.id as string)?.id ?? '').includes(id)), entity: id, limit: { claim: other.id, part: other.part, region: other.region } }) };
    }
  }
  if (mine) for (const [kind, id] of touched) {
    const existed = before.entities.has(id);
    if ((!existed || inScope(before, id, myRoots!)) && (kind === 'rm' || inScope(after, id, myRoots!))) continue;
    return { failure: buildFailure('build.claim', `${(kind === 'up' ? after : before).pathOf(id) || id} is outside claim ${mine.id} (${mine.part})${existed && kind === 'up' ? ' before or after this edit' : ''}.`, kind === 'up' && after.entities.get(id)?.in.parent === 'world' ? 'p' : 'in.parent', { op: ops.findIndex(o => 'id' in o && (before.get(o.id as string)?.id === id || after.get(o.id as string)?.id === id)), entity: id, limit: { claim: mine.id, root: mine.root, region: mine.region } }) };
  }
  const standing = mine ? mine.made.filter(id => after.entities.has(id)).length + made.length : 0;
  if (standing > BUILD_LIMITS.made) return { failure: buildFailure('build.limit', `claim ${mine!.part} would hold ${standing} parts (max ${BUILD_LIMITS.made}).`, 'claim.made', { fix: 'Group parts under one container.' }) };
  if (mine && (diff.world || diff.tiles.length || diff.constants || diff.layers)) return { failure: buildFailure('build.claim', 'World, terrain and constants edits belong to the build lead.', 'op', { fix: 'Ask the lead to make this edit.' }) };
  return { made };
}

/** Every committed diff, including undo/redo. The input rows and bodies are never mutated. */
export function rootsDelta(before: WorldModel, after: WorldModel, diff: Diff, kind: 'edit' | 'undo' | 'redo' | 'engine', field: BuildField | undefined, rows: readonly Row[], rootIndex: ReadonlyMap<string, string> = new Map(rows.filter(open).flatMap(r => r.body.roots.map(id => [id, r.id] as const)))): RootsDelta {
  const changes = new Map<string, RootChange>(), warnings: string[] = [], removed = new Set(diff.removes.filter(id => !after.entities.has(id)));
  const sites = rows.filter(open).sort((a, b) => a.id.localeCompare(b.id));
  const roots = new Map(sites.map(r => [r.id, new Set(r.body.roots.filter(id => !removed.has(id)))]));
  const addedOwners = new Map<string, string>();
  for (const r of sites) { const gone = r.body.roots.filter(id => removed.has(id)); if (gone.length) changes.set(r.id, { added: [], removed: gone }); }
  if (kind === 'engine') return { changes, warnings, removed };
  // Upserts need not be ordered parent-first (notably inverse ops), so process by depth.
  const tops = diff.upserts.filter(e => !before.entities.has(e.id) && (e.in.parent === 'world' || before.entities.has(e.in.parent)) && !after.resolvedDef(e.def)?.components.body).sort((a, b) => after.ancestors(a.id).size - after.ancestors(b.id).size);
  for (const e of tops) {
    const ancestors = after.ancestors(e.id);
    if ([...ancestors].some(id => addedOwners.has(id) || !removed.has(id) && rootIndex.has(id))) continue;
    const candidates = [...sites.filter(r => r.id === field?.id), ...sites.filter(r => r.id !== field?.id)];
    const owner = candidates.find(r => meets(after, e.id, r.body.site));
    if (!owner) { if (field) warnings.push(`${after.pathOf(e.id)} is outside site ${field.id}: not part of the build (residents can use it)`); continue; }
    const ids = roots.get(owner.id)!;
    if (ids.size >= BUILD_LIMITS.roots) { warnings.push(`${owner.id}: group the parts under one container (\`place … --in church\`); root limit ${BUILD_LIMITS.roots}`); continue; }
    ids.add(e.id); addedOwners.set(e.id, owner.id); const change = changes.get(owner.id) ?? { added: [], removed: [] }; change.added.push(e.id); changes.set(owner.id, change);
  }
  if (field) { const r = sites.find(r => r.id === field.id); if (r) for (const e of diff.upserts) if (rootIndex.get(e.id) === r.id && !meets(after, e.id, r.body.site)) warnings.push(`${after.pathOf(e.id)} moved outside site ${r.id}: still part of the build`); }
  if (!field) {
    const touched = new Set<string>([...diff.removes, ...diff.upserts.map(e => e.id)]), builds = new Set<string>();
    for (const id of [...touched]) { for (const a of before.ancestors(id)) touched.add(a); for (const a of after.ancestors(id)) touched.add(a); }
    for (const id of touched) { const owner = rootIndex.get(id); if (owner) builds.add(owner); }
    for (const id of [...builds].sort()) warnings.push(`edited ${id} (under construction) outside its build; progress not recorded`);
  }
  return { changes, warnings, removed };
}

/** Pure accepted-batch update. Rev is deliberately absent: SQL is its only source. */
export function advance(body: BuildBody, field: BuildField | undefined, made: string[], roots: RootChange, seq: number, at: number, caller?: Identity, pauseMs = 600_000, revert = false, removed: ReadonlySet<string> = new Set()): BuildBody {
  const b = structuredClone(body);
  b.roots = [...b.roots.filter(id => !roots.removed.includes(id)), ...roots.added];
  for (const claim of b.claims) claim.made = claim.made.filter(id => !removed.has(id));
  if (!field) return b;
  const claim = field.claim ? b.claims.find(c => c.id === field.claim)! : undefined;
  if (claim && caller?.holder) claim.holder.process = caller.holder;
  if (!claim && caller?.holder) b.lead.holder = caller.holder;
  if (claim) { claim.made = [...new Set([...claim.made, ...made])]; claim.lastAt = at; if (caller) claim.user = { hash8: poolOf(caller).slice(0, 8), tokenHash: poolOf(caller) }; }
  if (revert) return b;
  const current = claim?.step ?? b.step, n = Math.max(current.n, field.step ?? current.n);
  const label = field.step !== undefined && field.step < current.n ? current.label : field.label ?? (n > current.n ? b.plan.steps[n - 1] ?? `step ${n}` : current.label);
  if (claim) claim.step = { n, label }; else b.step = { n, label, at, seq };
  let s = [...b.steps].reverse().find(s => s.n === n && s.claim === field.claim);
  if (!s) { s = { n, label, ...(claim ? { claim: claim.id } : {}), batches: 0, firstSeq: seq, lastSeq: seq, at }; b.steps.push(s); }
  s.batches++; s.lastSeq = seq; s.at = at; s.label = label;
  b.steps = b.steps.slice(-64); b.firstEditAt ??= at; b.lastEditAt = at;
  delete b.paused;
  if (caller && !b.agents.some(a => a.hash8 === caller.hash.slice(0, 8))) b.agents = [...b.agents, { label: caller.label, hash8: caller.hash.slice(0, 8), at }].slice(-8);
  if (field.done && claim) claim.status = 'done';
  else if (field.done && !b.claims.some(c => c.status === 'held' && at - c.lastAt <= pauseMs)) b.done = { at, byLabel: caller?.label ?? b.lead.label };
  return b;
}

export class GodBuilds {
  private rows = new Map<string, Row>();
  private geometry = new WeakMap<WorldModel, { seq: number; rows: Map<string, { body: BuildBody; zones: Site[]; hits: Map<string, boolean> }> }>();
  /** Engine-only observations are read at start, never persisted in a public site. */
  inventoryContext?: () => BuildInventoryContext;
  /** Y3 districts: fills a district chapter's site, massing, title and steps from its plan before validation. */
  districtStart?: (raw: Record<string, unknown>) => { raw: unknown } | { failures: Failure[] };
  readonly rootIndex = new Map<string, string>();
  readonly pauseMs: number; readonly closureMs: number;
  readonly store: WorldStore;
  private host: { model: () => WorldModel; now: () => number; pauseMs?: number; closureMs?: number; emit: (message: WorldBuildMessage) => void; notice: (event: BuildNotice) => void; receipt?: (id: string, body?: BuildBody) => BuildReceipt | undefined; schedule?: (fn: () => void, ms: number) => void };
  /** CE8: latest lead look per open build; never persisted. `pending` = one trailing publish is scheduled. */
  private gaze = new Map<string, { latest: Attention; publishedAt: number; pending: boolean }>();
  constructor(store: WorldStore, host: GodBuilds['host']) {
    this.store = store; this.host = host;
    const positive = (v: number | undefined, fallback: number) => v !== undefined && Number.isFinite(v) && v > 0 ? v : fallback;
    this.pauseMs = positive(host.pauseMs ?? (process.env.GOD_BUILD_PAUSE_MS ? Number(process.env.GOD_BUILD_PAUSE_MS) : undefined), 600_000);
    this.closureMs = positive(host.closureMs ?? (process.env.GOD_BUILD_CLOSE_IDLE_MS ? Number(process.env.GOD_BUILD_CLOSE_IDLE_MS) : undefined), 1_800_000);
    for (const r of store.builds(true)) this.rows.set(r.id, decode(r)); this.index();
  }
  /** Detached metadata for inverse-chain preflight; never writes or publishes. */
  fork(model: () => WorldModel, releaseClaims?: string) {
    const fork = new GodBuilds(this.store, { ...this.host, model, emit: () => {}, notice: () => {} });
    fork.rows = structuredClone(this.rows);
    if (releaseClaims) for (const c of fork.rows.get(releaseClaims)?.body.claims ?? []) if (c.status === 'held') c.status = 'released';
    fork.index(); return fork;
  }
  private index() { this.rootIndex.clear(); for (const r of this.rows.values()) for (const id of r.body.roots) this.rootIndex.set(id, r.id); }
  private row(id: string) { return this.rows.get(id) ?? (() => { const r = this.store.build(id); return r ? decode(r) : undefined; })(); }
  private reopensAt(r: Row) { return (r.body.lastBatchAt ?? r.created_at) + this.closureMs; }
  private isClosing(r: Row, now: number) { return open(r) && now < this.reopensAt(r); }
  private shape(r: Row, model: WorldModel) {
    let cache = this.geometry.get(model);
    if (!cache || cache.seq !== model.editSeq) { cache = { seq: model.editSeq, rows: new Map() }; this.geometry.set(model, cache); }
    let shape = cache.rows.get(r.id);
    if (!shape || shape.body !== r.body) { shape = { body: r.body, zones: closureZones(r.body, model), hits: new Map() }; cache.rows.set(r.id, shape); }
    return shape;
  }
  hasClosure(now = this.host.now()): boolean { return [...this.rows.values()].some(r => this.isClosing(r, now)); }
  closing(id: string, model = this.host.model(), now = this.host.now()): { id: string; title: string; step: string } | null {
    if (!model.entities.has(id)) return null;
    for (const r of this.rows.values()) {
      if (!this.isClosing(r, now)) continue;
      const shape = this.shape(r, model); let hit = shape.hits.get(id);
      if (hit === undefined) { const fs = entityBoxes(model, id); hit = shape.zones.some(zone => fs.some(f => obbOverlap(box(f), box(zone)))); shape.hits.set(id, hit); }
      if (hit) return { id: r.id, title: r.body.title, step: `step ${r.body.step.n}/${r.body.plan.steps.length}: ${r.body.step.label}` };
    }
    return null;
  }
  closingSites(now = this.host.now()): ClosingSite[] { return [...this.rows.values()].filter(r => this.isClosing(r, now)).map(r => ({ id: r.id, site: r.body.site, roots: [...r.body.roots], zones: this.shape(r, this.host.model()).zones })); }
  private captions(r: Row, previous?: BuildBody) {
    const b = r.body;
    return {
      ...(b.say && (!previous || b.say.at !== previous.say?.at || b.say.text !== previous.say?.text) ? { say: { ...b.say } } : {}),
      ...(b.designing && (!previous || b.designing.join(',') !== previous.designing?.join(',')) ? { designing: [...b.designing] } : {}),
      ...(b.note && (!previous || b.note.at !== previous.note?.at || b.note.text !== previous.note?.text) ? { note: { ...b.note } } : {}),
      ...(!b.note && previous?.note ? { note: { text: '', at: b.lastBatchAt ?? r.last_at } } : {}),
      ...(open(r) ? { reopensAt: this.reopensAt(r) } : {}),
    };
  }
  private public(r: Row, now: number): PublicSite { const b = r.body; return { id: r.id, title: b.title, status: effective(r, now, this.pauseMs), rev: r.rev, lastAt: r.last_at, pauseAfterMs: this.pauseMs, closed: this.isClosing(r, now), step: { n: b.step.n, label: b.step.label, of: b.plan.steps.length }, site: structuredClone(b.site), massing: structuredClone(b.massing), roots: [...b.roots], claims: b.claims.map(c => ({ part: c.part, status: c.status === 'held' && lockStatus(c.holder.process, c.lastAt, this.pauseMs, now).stale ? 'stale' : c.status })), ...this.captions(r), ...this.attentionOf(r.id, now) }; }
  /** Snapshots carry the latest look while it is fresh (no older trail is kept). */
  private attentionOf(id: string, now: number): { attention?: Attention } {
    const a = this.gaze.get(id)?.latest;
    return a && now - a.t <= ATTENTION.ttlMs ? { attention: structuredClone(a) } : {};
  }
  /** CE8 passive marker: the build lead says where it is looking. Fire-and-forget for the caller; never a SQL write. */
  attend(id: string, raw: unknown, caller: Identity) {
    const now = this.host.now(), p = buildActionSchemas.attention.safeParse(raw); if (!p.success) return schemaFailure(p.error);
    const row = this.row(id); if (!row) return fail('build.unknown', id); if (!open(row)) return fail('build.closed', id);
    if (caller.hash !== row.body.lead.tokenHash && p.data.lease !== row.body.lead.lease) return fail('build.lease', `${id} is led by ${row.body.lead.label}; only the lead's looks are shown.`);
    const [x0, z0, x1, z1] = this.host.model().ground().extent, [x, , z] = p.data.at;
    if (x < x0 || x > x1 || z < z0 || z > z1) return fail('build.site', 'Attention point is outside the ground extent.', 'at');
    const round = (v: [number, number, number]) => v.map(n => Math.round(n * 100) / 100) as [number, number, number];
    const latest: Attention = { at: round(p.data.at), ...(p.data.eye ? { eye: round(p.data.eye) } : {}), t: now };
    const g = this.gaze.get(id) ?? { latest, publishedAt: -Infinity, pending: false }; g.latest = latest; this.gaze.set(id, g);
    const wait = g.publishedAt + ATTENTION.minMs - now;
    if (wait <= 0) { this.publishAttention(id); return { ok: true as const, t: now, published: true }; }
    if (!g.pending) { g.pending = true; (this.host.schedule ?? ((fn, ms) => { setTimeout(fn, ms).unref?.(); }))(() => this.publishAttention(id), wait); }
    return { ok: true as const, t: now, published: false };
  }
  private publishAttention(id: string) {
    const g = this.gaze.get(id), row = this.rows.get(id); if (!g) return;
    g.pending = false;
    if (!row || !open(row)) { this.gaze.delete(id); return; }
    const now = this.host.now(); if (now - g.latest.t > ATTENTION.ttlMs) return;
    g.publishedAt = now;
    const delta: SiteDelta = { id, rev: row.rev, status: effective(row, now, this.pauseMs), lastAt: row.last_at, attention: structuredClone(g.latest) };
    this.host.emit({ type: 'edge', kind: 'world-build', event: 'attention', rev: row.rev, now, delta });
  }
  private view(r: Row, now: number, recent?: { seq: number; note: string | null; at: number }[]): GodBuildView {
    const b = structuredClone(r.body), refused = this.store.buildRefusals(r.id), { lease: _lease, tokenHash: _tokenHash, ...lead } = b.lead;
    if (b.done && !b.done.receipt) b.done.receipt = this.store.buildReceipt(r.id);
    const step = [...b.steps].reverse().find(s => s.n === b.step.n && !s.claim);
    const current = step ? { ...step, recent: recent ?? this.store.buildRecent(r.id, step.firstSeq, step.lastSeq) } : null;
    const model = this.host.model();
    const massing = b.massing.map(m => ({ ...m, parts: 0 })), boxes = massing.map(m => ({ at: m.at, size: m.size, yaw: m.yaw ?? 0 }));
    if (massing.length) for (const root of b.roots) for (const id of model.entities.has(root) ? model.subtree(root) : []) {
      const fs = model.footprintsOf(id), wp = fs.length ? null : model.worldPose(model.entities.get(id)!);
      const p = siteLocal(b.site, fs.length ? [fs.reduce((a, f) => a + f.c[0], 0) / fs.length, fs.reduce((a, f) => a + f.c[1], 0) / fs.length] : [wp!.x, wp!.z]);
      boxes.forEach((ms, i) => { if (inSite(ms, p)) massing[i].parts++; });
    }
    const chapters: NonNullable<GodBuildView['chapters']> = [];
    let parent = b.chapterOf; const seen = new Set([b.id]);
    while (parent && !seen.has(parent) && chapters.length < 24) { seen.add(parent); const previous = this.row(parent); if (!previous) break; chapters.unshift({ id: previous.id, brief: previous.body.plan.brief, asks: previous.body.plan.asks }); parent = previous.body.chapterOf; }
    return { ...b, ...(refused.count ? { refusalCount: refused.count, refusals: refused.recent } : {}), ...(chapters.length ? { chapters } : {}), ...this.captions(r), status: effective(r, now, this.pauseMs), rev: r.rev, createdAt: r.created_at, lastAt: r.last_at, now, pauseAfterMs: this.pauseMs, closed: this.isClosing(r, now), lead: { ...lead, live: !lockStatus(b.lead.holder, r.last_at, this.pauseMs, now).stale }, roots: b.roots.map(id => ({ id, path: model.pathOf(id) })), claims: b.claims.map(({ user: _user, ...c }) => ({ ...c, status: c.status === 'held' && lockStatus(c.holder.process, c.lastAt, this.pauseMs, now).stale ? 'stale' : c.status, ...(c.root ? { rootPath: model.pathOf(c.root) } : {}) })), current, next: b.step.n < b.plan.steps.length ? { n: b.step.n + 1, label: b.plan.steps[b.step.n] } : null, massing };
  }
  publicList(now = this.host.now()) { this.sweep(now); return { now, rev: this.store.buildsRev(), builds: [...this.rows.values()].map(r => this.public(r, now)) }; }
  list(now = this.host.now()) { this.sweep(now); return { now, rev: this.store.buildsRev(), open: [...this.rows.values()].map(r => this.view(r, now)), recent: this.store.builds().filter(r => !open(r)).slice(0, 20).map(r => { const b = decode(r); return { id: r.id, title: b.body.title, status: r.status, rev: r.rev, step: b.body.step, lastAt: r.last_at }; }) }; }
  summaries(now = this.host.now()) { this.sweep(now); return [...this.rows.values()].map(r => ({ id: r.id, status: effective(r, now, this.pauseMs), step: structuredClone(r.body.step) })); }
  body(id: string) { const row = this.row(id); if (!row) return undefined; const b = structuredClone(row.body), refused = this.store.buildRefusals(id); if (b.done && !b.done.receipt) b.done.receipt = this.store.buildReceipt(id); return { ...b, ...(refused.count ? { refusalCount: refused.count, refusals: refused.recent } : {}) }; }
  status(id: string) {
    const now = this.host.now(); this.sweep(now); const r = this.row(id); if (!r) return null;
    const step = [...r.body.steps].reverse().find(s => s.n === r.body.step.n && !s.claim), { journal, recent } = this.store.buildJournal(id, step);
    return { ok: true as const, build: this.view(r, now, recent), journal };
  }
  private inventory(body: Pick<BuildBody, 'site' | 'massing' | 'roots'>) {
    const model = this.host.model(), zones = closureZones(body, model), context = this.inventoryContext?.();
    const inventory: BuildInventory = { things: [], seats: [], places: [], owned: [], bodies: [] }, protectedThings: { id: string; path: string }[] = [];
    const counts: NonNullable<BuildInventory['counts']> = {};
    const add = <K extends Exclude<keyof BuildInventory, 'counts'>>(key: K, value: BuildInventory[K][number]) => {
      counts[key] = (counts[key] ?? 0) + 1;
      if (inventory[key].length < 50) (inventory[key] as (typeof value)[]).push(value);
    };
    for (const e of model.entities.values()) {
      const def = model.resolvedDef(e.def); if (def?.components.body) continue;
      const fs = entityBoxes(model, e.id); if (!zones.some(z => fs.some(f => obbOverlap(box(z), box(f))))) continue;
      const path = model.pathOf(e.id); add('things', { id: e.id, path, def: e.def });
      const seat = !!def?.components.seat || model.slotsOf(e).some(s => s.kind === 'seat');
      const occupied = seat && (context?.occupied(e.id) ?? false);
      if (seat) add('seats', { id: e.id, path, occupied });
      let owner: string | undefined, access: string | undefined;
      for (let p: typeof e | undefined = e; p; p = model.entities.get(p.in.parent)) if (p.owner || p.access) { owner = p.owner; access = p.access; break; }
      if (owner || access === 'private') add('owned', { id: e.id, path, owner: owner ?? null });
      // G1: occupancy is informational; residents are walked out when the site closes.
      if (owner?.startsWith('soul:') || access === 'private') protectedThings.push({ id: e.id, path });
    }
    for (const p of context?.places ?? []) if (closureMeetsPolygon(zones, p.polygon)) add('places', { id: p.id, name: p.name });
    for (const b of context?.bodies ?? []) if (zones.some(z => inSite(z, b.at))) add('bodies', { name: b.name, ...(b.soulId ? { soulId: b.soulId } : {}) });
    for (const [key, count] of Object.entries(counts)) if (count > 50) (inventory.counts ??= {})[key as keyof typeof counts] = count;
    return { inventory, protectedThings };
  }
  start(raw: unknown, caller: Identity) {
    const now = this.host.now(); this.sweep(now);
    if (this.districtStart && raw && typeof raw === 'object' && (raw as Record<string, unknown>).district !== undefined) { const expanded = this.districtStart(raw as Record<string, unknown>); if ('failures' in expanded) return { ok: false as const, failures: expanded.failures }; raw = expanded.raw; } // Y3 districts
    const p = buildStartSchema.safeParse(raw); if (!p.success) return schemaFailure(p.error);
    const input = p.data, startHash = hashOf(input), prior = this.row(input.id);
    if (prior) return !open(prior) ? fail('build.closed', input.id) : prior.body.startHash === startHash && prior.body.lead.tokenHash === caller.hash ? { ok: true as const, build: this.view(prior, now), lease: prior.body.lead.lease, inventory: this.inventory(prior.body).inventory, replayed: true } : fail('build.exists', `${input.id} already exists.`);
    if (this.store.hasGroupUnder(input.id)) return fail('build.exists', `${input.id} is already a journal group.`);
    if (this.rows.size >= BUILD_LIMITS.open) return fail('build.limit', 'At most 8 builds may be open.');
    const model = this.host.model(), [x0, z0, x1, z1] = model.ground().extent, [x, z] = input.site.at;
    if (x < x0 || x > x1 || z < z0 || z > z1) return fail('build.site', 'Site centre is outside the ground extent.', 'site');
    if ([...this.rows.values()].some(r => obbOverlap(box(input.site), box(r.body.site)))) return fail('build.site', 'Site overlaps another open build.', 'site');
    for (const m of input.massing) for (const a of [-1, 1]) for (const b of [-1, 1]) { const p = siteWorld({ at: m.at, size: m.size, yaw: m.yaw ?? 0 }, [a * m.size[0] / 2, b * m.size[1] / 2]); if (Math.abs(p[0]) > input.site.size[0] / 2 + 1e-7 || Math.abs(p[1]) > input.site.size[1] / 2 + 1e-7) return fail('build.site', 'Massing must be wholly inside the site.', 'massing'); }
    const chapter = input.root ? this.row(input.root) : undefined;
    if (chapter && open(chapter)) return fail('build.site', 'Finish the previous chapter before continuing it.', 'root');
    const root = input.root && !chapter ? model.get(input.root) : undefined;
    if (input.root && !root && !chapter) return { ok: false as const, failures: [{ op: -1, code: 'entity.unknown', entity: input.root, detail: `Unknown root ${input.root}.`, fix: 'Use an existing entity id or path.' }] };
    if (root && this.rootIndex.has(root.id)) return fail('build.site', 'Root already belongs to an open build.', 'root');
    const adopted = chapter ? chapter.body.roots.filter(id => model.entities.has(id)) : root ? [root.id] : [];
    if (adopted.some(id => this.rootIndex.has(id))) return fail('build.site', 'A chapter root already belongs to an open build.', 'root');
    const included: string[] = [];
    for (const ref of input.include ?? []) { const e = model.get(ref); if (!e) return fail('build.site', `Unknown included entity ${ref}.`, 'include', { fix: 'Use an existing entity id or path.' }); included.push(e.id); }
    const body: BuildBody = { id: input.id, title: input.title, plan: { steps: input.steps, ...(input.brief !== undefined ? { brief: input.brief } : {}), ...(input.asks ? { asks: input.asks } : {}) }, ...(input.root ? { root: input.root } : {}), ...(chapter ? { chapterOf: chapter.id } : {}), ...(input.district ? { district: input.district } : chapter?.body.district ? { district: structuredClone(chapter.body.district) } : {}), ...(included.length ? { include: [...new Set(included)] } : {}), site: input.site, massing: input.massing, roots: adopted, ...(adopted.length ? { initialRoots: adopted } : {}), lead: { lease: lease(), label: caller.label, hash8: caller.hash.slice(0, 8), tokenHash: caller.hash, since: now, ...(caller.holder ? { holder: caller.holder } : {}) }, step: { n: 1, label: input.steps[0], at: now, seq: null }, steps: [], claims: [], agents: [{ label: caller.label, hash8: caller.hash.slice(0, 8), at: now }], pauses: 0, startHash };
    const { inventory, protectedThings } = this.inventory(body), explicit = new Set(included);
    const missing = protectedThings.filter(e => !explicit.has(e.id));
    if (missing.length) return { ...fail('build.site', `Closure would cover ${missing.length} protected thing(s).`, 'include', { fix: `Include ${missing.slice(0, 50).map(e => `${e.path} (${e.id})`).join(', ')}${missing.length > 50 ? `; ${missing.length - 50} more (see inventory counts)` : ''}, or move/shrink the massing or root.`, measured: missing.length }), inventory };
    const encoded = JSON.stringify(body), failure = buildBodyFailure(encoded); if (failure) return { ok: false as const, failures: [failure] };
    const inserted = this.store.insertBuild(input.id, now, encoded); if (!inserted) return fail('build.exists', `${input.id} already exists.`);
    if ('accepted' in inserted) return { ok: false as const, failures: inserted.failures };
    const row = decode(inserted); this.rows.set(row.id, row); this.index(); const build = this.view(row, now); this.announce(row, 'started', { added: row.body.roots, removed: [] }, false, build);
    return { ok: true as const, build, lease: body.lead.lease, inventory };
  }
  private save(row: Row, body: BuildBody, status: Row['status'], at: number, kind: BuildEventKind, transition = false) {
    const durable = structuredClone(body), receipt = durable.done?.receipt; if (durable.done) delete durable.done.receipt;
    const w: BuildWrite = { id: row.id, expectRev: row.rev, status, lastAt: at, body: JSON.stringify(durable), ...(receipt ? { receipt } : {}) };
    const failure = buildBodyFailure(w.body, !transition); if (failure) return { ok: false as const, failures: [failure] };
    const refused = this.store.saveBuild(w); if (refused && !refused.accepted) return { ok: false as const, failures: refused.failures };
    const next: Row = { ...row, body, status, rev: w.rev!, last_at: at }; this.install(next);
    return { ok: true as const, row: next, kind };
  }
  private savedView(result: ReturnType<GodBuilds['save']>) {
    if (!result.ok) return result;
    const build = this.view(result.row, this.host.now()); this.announce(result.row, result.kind, { added: [], removed: [] }, false, build);
    return { ok: true as const, build };
  }
  private install(row: Row, roots?: RootChange) {
    if (open(row)) {
      this.rows.set(row.id, row);
      if (roots) { for (const id of roots.removed) if (this.rootIndex.get(id) === row.id) this.rootIndex.delete(id); for (const id of roots.added) this.rootIndex.set(id, row.id); }
    } else {
      const previous = this.rows.get(row.id); this.rows.delete(row.id); this.gaze.delete(row.id);
      for (const id of previous?.body.roots ?? []) if (this.rootIndex.get(id) === row.id) this.rootIndex.delete(id);
    }
  }
  private delta(row: Row, roots: RootChange, claim?: PublicSite['claims'][number], previous?: BuildBody): SiteDelta {
    const now = this.host.now(), b = row.body;
    return { id: row.id, rev: row.rev, status: effective(row, now, this.pauseMs), lastAt: row.last_at, closed: this.isClosing(row, now), step: { n: b.step.n, label: b.step.label, of: b.plan.steps.length }, ...this.captions(row, previous), ...(claim ? { claim } : {}), ...(roots.added.length ? { rootsAdded: [...roots.added] } : {}), ...(roots.removed.length ? { rootsRemoved: [...roots.removed] } : {}) };
  }
  private announce(row: Row, kind: BuildEventKind, roots: RootChange, inEdit = false, view?: GodBuildView, claim?: PublicSite['claims'][number], previous?: BuildBody) {
    const delta = this.delta(row, roots, claim, previous), full = kind === 'started' || kind === 'resumed';
    if (!inEdit) this.host.emit({ type: 'edge', kind: 'world-build', event: kind as WorldBuildMessage['event'], rev: row.rev, now: this.host.now(), ...(full ? { site: this.public(row, this.host.now()) } : { delta }) });
    this.host.notice({ kind, id: row.id, rev: row.rev, now: this.host.now(), delta, ...(full ? { view: view ?? this.view(row, this.host.now()) } : {}) });
  }
  sweep(now = this.host.now()) {
    for (let row of [...this.rows.values()]) {
      // Legacy rows may not have reserved marker space. One refused transition must not wedge public reads.
      try {
        if (row.status === 'active' && effective(row, now, this.pauseMs) === 'paused') {
          const body = structuredClone(row.body); body.paused = { from: row.last_at + this.pauseMs, seenAt: now };
          const saved = this.save(row, body, 'paused', row.last_at, 'paused', true);
          if (saved.ok) { row = saved.row; this.announce(row, 'paused', { added: [], removed: [] }); }
        }
        if (open(row) && now >= this.reopensAt(row) && row.body.closureLapsedAt === undefined) {
          const body = structuredClone(row.body); body.closureLapsedAt = now;
          const saved = this.save(row, body, row.status, row.last_at, 'closure-lifted', true);
          if (saved.ok) this.announce(saved.row, 'closure-lifted', { added: [], removed: [] });
        }
      } catch { /* A malformed legacy row cannot stop the other sites or public routes. */ }
    }
  }
  touch(hash: string, now = this.host.now()) {
    // No SQL or allocation on the usual authenticated request.
    for (const row of this.rows.values()) {
      // Shared tokens cannot identify which helper is working. Only a batch carrying a claim refreshes it.
      // A deliberate handoff survives even reads from the lead's token; a lease/claim batch can resume it.
      if (row.body.lead.tokenHash !== hash || row.body.paused?.explicit || now - row.last_at <= this.pauseMs / 4) continue;
      const body = structuredClone(row.body), paused = effective(row, now, this.pauseMs) === 'paused';
      if (paused) body.pauses++; delete body.paused;
      const saved = this.save(row, body, 'active', now, paused ? 'resumed' : 'alive');
      if (saved.ok) this.announce(saved.row, saved.kind, { added: [], removed: [] });
    }
  }
  step(id: string, raw: unknown, caller?: Identity) {
    const now = this.host.now(); this.sweep(now);
    const p = buildActionSchemas.step.safeParse(raw); if (!p.success) return schemaFailure(p.error);
    const input = p.data, field: BuildField = { id, ...(input.lease ? { lease: input.lease } : { claim: input.claim }) };
    const admission = this.admit(field, {}, caller); if (admission.failures) return { ok: false as const, failures: admission.failures };
    const row = admission.row!;
    const unknown = input.masses?.filter(name => !row.body.massing.some(m => m.name === name));
    if (unknown?.length) return fail('build.site', `Unknown mass(es): ${unknown.join(', ')}.`, 'masses', { fix: 'Use mass names from this build\'s massing.' });
    const included: string[] = [];
    for (const ref of input.include ?? []) { const e = this.host.model().get(ref); if (!e) return fail('build.site', `Unknown included entity ${ref}.`, 'include'); included.push(e.id); }
    if (input.claim && (input.include || input.asks)) return fail('build.claim', 'The lead records includes and owner asks.', 'include');
    const old = input.claim ? row.body.claims.find(c => c.id === input.claim)! : row.body;
    const key = hashOf({ claim: input.claim ?? null, n: input.n ?? old.step.n, say: input.say ?? null, ...(input.include ? { include: input.include } : {}), ...(input.asks ? { asks: input.asks } : {}) }).slice(0, 16);
    if (row.body.stepCalls?.includes(key)) {
      if (input.lease) this.touch(row.body.lead.tokenHash, now);
      return { ok: true as const, build: this.view(this.row(id)!, now), replayed: true };
    }
    const body = structuredClone(row.body), claim = input.claim ? body.claims.find(c => c.id === input.claim)! : undefined;
    if (included.length) body.include = [...new Set([...(body.include ?? []), ...included])];
    if (input.asks) { body.plan.asks = [...new Set([...(body.plan.asks ?? []), ...input.asks])]; if (body.plan.asks.length > 64) return fail('build.limit', 'At most 64 owner asks per chapter.', 'asks'); }
    const current = claim?.step ?? body.step, n = Math.max(current.n, input.n ?? current.n);
    const label = input.n !== undefined && input.n < current.n ? current.label : input.label ?? (n > current.n ? body.plan.steps[n - 1] ?? `step ${n}` : current.label);
    if (claim && caller?.holder) claim.holder.process = caller.holder;
    if (!claim && caller?.holder) body.lead.holder = caller.holder;
    if (claim) { claim.step = { n, label }; claim.lastAt = now; if (caller) claim.user = { hash8: poolOf(caller).slice(0, 8), tokenHash: poolOf(caller) }; }
    else body.step = { n, label, at: now, seq: null };
    // Keep the last STEP_CALLS accepted tuples (16 hex each): a retry cannot replace a newer announcement, and a long,
    // chatty build can never grow its body to the 64 KiB guard (which would refuse every later batch).
    body.stepCalls = [...(body.stepCalls ?? []), key].slice(-STEP_CALLS);
    if (input.say !== undefined) { body.say = { text: input.say, at: now }; body.sayAt = now; }
    body.designing = [...new Set(input.masses ?? [])];
    let status = row.status;
    if (!claim) { if (effective(row, now, this.pauseMs) === 'paused') body.pauses++; delete body.paused; status = 'active'; }
    const saved = this.save(row, body, status, claim ? row.last_at : now, 'step');
    if (!saved.ok) return saved;
    const build = this.view(saved.row, now);
    this.announce(saved.row, 'step', { added: [], removed: [] }, false, build, claim ? { part: claim.part, status: claim.status } : undefined);
    return { ok: true as const, build };
  }
  pause(id: string, raw: unknown, caller?: Identity) {
    this.sweep(); const p = buildActionSchemas.pause.safeParse(raw); if (!p.success) return schemaFailure(p.error); const row = this.row(id); if (!row) return fail('build.unknown', id);
    if (!open(row)) return fail('build.closed', id);
    if (caller?.hash !== row.body.lead.tokenHash && p.data.lease !== row.body.lead.lease) return fail('build.lease', `${id} is led by ${row.body.lead.label}.`);
    if (row.status === 'paused') return { ok: true as const, build: this.view(row, this.host.now()), replayed: true };
    const body = structuredClone(row.body); body.paused = { from: this.host.now(), seenAt: this.host.now(), explicit: true, ...p.data };
    // Never persist a submitted lease in the pause note.
    delete (body.paused as Record<string, unknown>).lease;
    return this.savedView(this.save(row, body, 'paused', row.last_at, 'paused'));
  }
  resume(id: string, raw: unknown, caller: Identity) {
    const now = this.host.now(); this.sweep(now); const p = buildActionSchemas.resume.safeParse(raw); if (!p.success) return schemaFailure(p.error); const row = this.row(id); if (!row) return fail('build.unknown', id); if (!open(row)) return fail('build.closed', id);
    const replayed = p.data.lease === row.body.lead.lease || caller.hash === row.body.lead.tokenHash;
    if (!replayed && !row.body.paused?.explicit && !lockStatus(row.body.lead.holder, row.last_at, this.pauseMs, now).stale && !p.data.take) return fail('build.leased', `${holderName(row.body.lead.holder, row.body.lead.label)} leads ${id}; quietFor=${now - row.last_at}ms, staleIn=${this.pauseMs - (now - row.last_at)}ms.`, 'build', { measured: { label: row.body.lead.label, ...(row.body.lead.holder ? { holder: row.body.lead.holder } : {}), quietFor: now - row.last_at, staleIn: this.pauseMs - (now - row.last_at) } });
    if (replayed && !caller.holder && row.status === 'active' && row.last_at === now) {
      const build = this.view(row, now); return { ok: true as const, build, lease: row.body.lead.lease, current: build.current, next: build.next, massing: build.massing, replayed: true };
    }
    const body = structuredClone(row.body); if (effective(row, now, this.pauseMs) === 'paused') body.pauses++;
    if (!replayed) body.lead = { lease: lease(), label: caller.label, hash8: caller.hash.slice(0, 8), tokenHash: caller.hash, since: now, ...(caller.holder ? { holder: caller.holder } : {}) };
    if (caller.holder) body.lead.holder = caller.holder;
    if (!body.agents.some(a => a.hash8 === caller.hash.slice(0, 8))) body.agents = [...body.agents, { label: caller.label, hash8: caller.hash.slice(0, 8), at: now }].slice(-8);
    const resumed = !replayed || effective(row, now, this.pauseMs) === 'paused';
    delete body.paused; const r = this.savedView(this.save(row, body, 'active', now, resumed ? 'resumed' : 'alive'));
    if (!r.ok) return r; return { ...r, lease: body.lead.lease, current: r.build.current, next: r.build.next, massing: r.build.massing, ...(replayed ? { replayed: true } : {}) };
  }
  claim(id: string, raw: unknown, caller: Identity) {
    const now = this.host.now(); this.sweep(now); const p = buildActionSchemas.claim.safeParse(raw); if (!p.success) return schemaFailure(p.error);
    const row = this.row(id); if (!row) return fail('build.unknown', id); if (!open(row)) return fail('build.closed', id);
    const input = p.data, prior = row.body.claims.find(c => c.part === input.part && c.status === 'held' && c.user.tokenHash === caller.hash);
    // A retry of take may still name the taken id; replay its already-issued replacement.
    if (prior && (!input.take || input.take === prior.id || row.body.claims.find(c => c.id === input.take)?.takenBy?.claim === prior.id)) {
      if (input.take === prior.id && !lockStatus(prior.holder.process, prior.lastAt, this.pauseMs, now).stale) return fail('build.claim-unknown', `${prior.id} is still live.`);
      if (!input.take || input.take !== prior.id) { const build = this.view(row, now); return { ok: true as const, claim: build.claims.find(c => c.id === prior.id)!, build, replayed: true }; }
    }
    const old = input.take ? row.body.claims.find(c => c.id === input.take) : undefined;
    if (input.take && (!old || old.status !== 'held' || !lockStatus(old.holder.process, old.lastAt, this.pauseMs, now).stale || old.part !== input.part)) return fail('build.claim-unknown', `${input.take} is unknown, not stale, or belongs to a different part.`);
    const busy = row.body.claims.find(c => c.part === input.part && c.status === 'held' && c.id !== old?.id);
    if (busy) return fail('build.claimed', `${input.part} is held by ${holderName(busy.holder.process, busy.holder.label)}; take ${busy.id} after it goes stale.`, 'build.claim', { measured: { holder: busy.holder.process ?? { label: busy.holder.label }, ttlMs: this.pauseMs, heartbeatAt: busy.lastAt } });
    if (row.body.claims.filter(c => c.status === 'held' && c.id !== old?.id).length >= BUILD_LIMITS.claims) return fail('build.limit', 'At most 8 claims may be held.');
    const model = this.host.model(), root = old ? old.root : input.root ? model.get(input.root)?.id : undefined, region = old ? old.region : input.region;
    if (!old && input.root && (!root || !inScope(model, root, new Set(row.body.roots)))) return { ok: false as const, failures: [{ op: -1, code: 'entity.unknown', entity: input.root, field: 'root', detail: `${input.root} is not an entity inside build ${id}.`, fix: 'Use a root or subtree from this build.' }] };
    if (region && !containsRect(row.body.site, region)) return fail('build.site', `Claim region must be wholly inside site ${id}.`, 'region');
    const made = (old?.made ?? []).filter(id => model.entities.has(id)), roots = new Set([...(root ? [root] : []), ...made]);
    const overlap = this.overlap({ roots, region }, now, old?.id);
    if (overlap) return fail('build.claimed', `Claim overlaps ${overlap.id} (${overlap.part}), held by ${holderName(overlap.holder.process, overlap.holder.label)}.`, 'root', { limit: { claim: overlap.id, part: overlap.part } });
    const body = structuredClone(row.body); let cid: string; do { cid = claimId(); } while (body.claims.some(c => c.id === cid));
    if (old) { const taken = body.claims.find(c => c.id === old.id)!; taken.status = 'taken'; taken.takenBy = { claim: cid, label: caller.label, at: now }; }
    while (body.claims.length >= BUILD_LIMITS.retainedClaims) { const i = body.claims.findIndex(c => c.status !== 'held'); body.claims.splice(i, 1); }
    const claim: Claim = { id: cid, part: input.part, ...(root ? { root } : {}), ...(region ? { region: structuredClone(region) } : {}), made, step: old ? { ...old.step } : { n: 1, label: body.plan.steps[0] }, status: 'held', lastAt: now, holder: { label: caller.label, hash8: caller.hash.slice(0, 8), ...(caller.holder ? { process: caller.holder } : {}) }, user: { hash8: caller.hash.slice(0, 8), tokenHash: caller.hash } };
    body.claims.push(claim);
    const result = this.save(row, body, row.status, row.last_at, old ? 'taken' : 'claimed'); if (!result.ok) return result;
    const build = this.view(result.row, now); this.announce(result.row, result.kind, { added: [], removed: [] }, false, build, { part: claim.part, status: 'held' });
    return { ok: true as const, claim: build.claims.find(c => c.id === cid)!, build };
  }
  release(id: string, cid: string, raw: unknown) {
    const now = this.host.now(); this.sweep(now); const p = buildActionSchemas.release.safeParse(raw); if (!p.success) return schemaFailure(p.error);
    const row = this.row(id); if (!row) return fail('build.unknown', id);
    const claim = row.body.claims.find(c => c.id === cid); if (!claim || claim.status === 'taken') return fail('build.claim-unknown', `${cid}${claim?.takenBy ? ` was taken by ${claim.takenBy.label} at ${claim.takenBy.at}` : ' is unknown'}.`);
    if (claim.status === 'released' || claim.status === 'done') return { ok: true as const, build: this.view(row, now), replayed: true };
    if (!open(row)) return fail('build.closed', id);
    const body = structuredClone(row.body), next = body.claims.find(c => c.id === cid)!; next.status = p.data.done ? 'done' : 'released';
    const result = this.save(row, body, row.status, row.last_at, 'released'); if (!result.ok) return result;
    const build = this.view(result.row, now); this.announce(result.row, 'released', { added: [], removed: [] }, false, build, { part: next.part, status: next.status });
    return { ok: true as const, build };
  }
  done(id: string, raw: unknown, caller: Identity) {
    const now = this.host.now(); this.sweep(now); const p = buildActionSchemas.done.safeParse(raw); if (!p.success) return schemaFailure(p.error); const row = this.row(id); if (!row) return fail('build.unknown', id);
    if (row.status === 'done') return { ok: true as const, build: this.view(row, now), replayed: true }; if (!open(row)) return fail('build.closed', id);
    if (!p.data.force && this.liveClaims(row, now).length) return fail('build.claims-open', id);
    const body = structuredClone(row.body); if (p.data.force) for (const c of body.claims) if (c.status === 'held') c.status = 'released';
    body.done = { at: now, byLabel: caller.label, ...(this.host.receipt ? { receipt: this.host.receipt(id, body) } : {}), ...(p.data.summary ? { summary: p.data.summary } : {}) }; return this.savedView(this.save(row, body, 'done', row.last_at, 'done'));
  }
  abandon(id: string, raw: unknown, undo: () => { accepted: boolean; reverted: number[]; notReverted: number[]; failures?: Failure[] }) {
    const now = this.host.now(); this.sweep(now); const p = buildActionSchemas.abandon.safeParse(raw); if (!p.success) return schemaFailure(p.error); let row = this.row(id); if (!row) return fail('build.unknown', id);
    if (row.status === 'abandoned') return { ok: true as const, build: this.view(row, now), replayed: true }; if (!open(row)) return fail('build.closed', id);
    if (!p.data.force && this.liveClaims(row, now).length) return fail('build.claims-open', id);
    const reverted = p.data.undo ? undo() : undefined;
    if (reverted && !reverted.accepted) return { ...fail('build.undo-incomplete', 'Undo preflight failed; no build edits were reverted.'), reverted: reverted.reverted, notReverted: reverted.notReverted, causes: reverted.failures };
    row = this.row(id)!; const body = structuredClone(row.body); if (p.data.force) for (const c of body.claims) if (c.status === 'held') c.status = 'released'; body.abandoned = { at: now, ...(reverted ? { undo: { reverted: reverted.reverted, notReverted: [] } } : {}) }; return this.savedView(this.save(row, body, 'abandoned', row.last_at, 'abandoned'));
  }
  /** Y5: which live build edits (lead and claim subgroups) a rewind to after step k reverts. `journal` is every row of
   *  the build's groups. An edit's step is the recorded step range that holds its original edit (redo chains are
   *  followed); the group separates the lead's ranges from interleaved claim ranges. Never writes. */
  rewindPlan(id: string, raw: unknown, journal: readonly EditRow[]) {
    const now = this.host.now(); this.sweep(now);
    const p = buildActionSchemas.rewind.safeParse(raw); if (!p.success) return schemaFailure(p.error);
    const row = this.row(id); if (!row) return fail('build.unknown', id);
    if (!open(row)) return fail('build.closed', `${id} is ${row.status}; only an open build can be rewound.`, 'build', { fix: `Start a linked chapter with build continue ${id} --brief "…", or undo --group ${id}.` });
    const { to } = p.data, b = row.body;
    const newest = Math.max(b.step.n, ...b.steps.map(s => s.n), ...b.claims.map(c => c.step.n));
    if (to > newest) return fail('build.rewind', `${id} is at step ${b.step.n}${newest > b.step.n ? ` (helpers reached ${newest})` : ''}; --to takes 0..${newest}.`, 'to', { measured: to, limit: newest });
    const bySeq = new Map(journal.map(r => [r.seq, r])), claimGroups = new Map(b.claims.map(c => [c.id, `${id}/${c.part}`])), claimed = new Set(claimGroups.values());
    const origin = (r: EditRow) => { let e: EditRow | undefined = r; for (let i = 0; e && e.kind !== 'edit' && i < 256; i++) e = e.undo_of === null ? undefined : bySeq.get(e.undo_of); return e?.kind === 'edit' ? e : undefined; };
    const stepOf = (r: EditRow): number | undefined => {
      const e = origin(r); if (!e) return undefined;
      const hits = b.steps.filter(s => s.firstSeq <= e.seq && e.seq <= s.lastSeq), mine = hits.filter(s => s.claim ? claimGroups.get(s.claim) === e.grp : !claimed.has(e.grp ?? ''));
      // An unresolvable overlap (a claim dropped from retention) takes the later step: rewind removes more, never less.
      return hits.length ? Math.max(...(mine.length ? mine : hits).map(s => s.n)) : undefined;
    };
    const targets: (EditRow & { step: number })[] = [];
    for (const r of journal) {
      if (r.undone || (r.kind !== 'edit' && r.kind !== 'redo')) continue;
      const n = stepOf(r);
      if (n === undefined && to > 0) return fail('build.rewind', `Edit ${r.seq} has no recorded step (a build keeps its newest 64 step records).`, 'to', { measured: { seq: r.seq }, fix: `Rewind to 0 (the start), or undo the newer edits with undo --group ${r.grp ?? id}.` });
      if (to === 0 || n! > to) targets.push({ ...r, step: n ?? 0 });
    }
    const lead = to === 0 ? 1 : Math.min(b.step.n, to), claimStep = Math.max(to, 1);
    const unchanged = !targets.length && b.step.n === lead && !b.steps.some(s => s.n > to) && !b.claims.some(c => c.step.n > claimStep || p.data.force && c.status === 'held');
    return { ok: true as const, row, to, dry: !!p.data.dry, force: !!p.data.force, targets, newest, unchanged, steps: b.steps.filter(s => s.n > to).map(s => ({ n: s.n, label: s.label, ...(s.claim ? { part: b.claims.find(c => c.id === s.claim)?.part ?? s.claim } : {}) })) };
  }
  /** Pure: the open record left at step k (k = 0 is the start). Closure is re-armed and retained claims are clamped;
   *  only the lead's own token refreshes lead liveness, so an owner's rewind never makes a dead lead look alive. */
  rewoundBody(body: BuildBody, to: number, at: number, caller: Identity | undefined, force: boolean, info: { from: number; edits: number; removed: number }) {
    const b = structuredClone(body), lead = caller?.hash === b.lead.tokenHash, n = to === 0 ? 1 : Math.min(b.step.n, to), claimStep = Math.max(to, 1);
    b.steps = b.steps.filter(s => s.n <= to);
    const label = (k: number, claim?: string) => [...b.steps].reverse().find(s => s.n === k && s.claim === claim)?.label ?? b.plan.steps[k - 1] ?? `step ${k}`;
    const kept = [...b.steps].reverse().find(s => s.n === n && !s.claim);
    b.step = { n, label: n === body.step.n ? body.step.label : label(n), at, seq: kept?.lastSeq ?? null };
    for (const c of b.claims) { if (force && c.status === 'held') c.status = 'released'; if (c.step.n > claimStep) c.step = { n: claimStep, label: label(claimStep, c.id) }; }
    b.lastBatchAt = at; delete b.closureLapsedAt; b.stepCalls = []; b.designing = []; delete b.note;
    b.say = { text: (to === 0 ? 'Rewound to the start' : `Rewound to step ${to}${to === n ? `: ${b.step.label}` : ''}`).slice(0, 140), at };
    if (lead) delete b.paused;
    b.rewinds = [...(b.rewinds ?? []), { at, to, from: info.from, edits: info.edits, removed: info.removed, byLabel: caller?.label ?? 'owner' }].slice(-16);
    return { body: b, lead };
  }
  /** Y5 with nothing to revert: only the record moves back (same body rules as the chain's final write). */
  saveRewound(id: string, to: number, at: number, caller: Identity | undefined, force: boolean, info: { from: number; edits: number; removed: number }) {
    const row = this.row(id); if (!row || !open(row)) return fail('build.closed', id);
    const { body, lead } = this.rewoundBody(row.body, to, at, caller, force, info);
    const saved = this.save(row, body, lead ? 'active' : row.status, lead ? at : row.last_at, 'rewound'); if (!saved.ok) return saved;
    const build = this.view(saved.row, at); this.announce(saved.row, 'rewound', { added: [], removed: [] }, false, build);
    return { ok: true as const, build };
  }
  leadLive(id: string) { const row = this.rows.get(id); return row ? { label: row.body.lead.label, tokenHash: row.body.lead.tokenHash, live: !lockStatus(row.body.lead.holder, row.last_at, this.pauseMs, this.host.now()).stale } : undefined; }
  breakStaleLead(id: string) {
    const row = this.row(id); if (!row || !open(row)) return false;
    if (!lockStatus(row.body.lead.holder, row.last_at, this.pauseMs, this.host.now()).stale) return false;
    return this.pause(id, { lease: row.body.lead.lease, note: 'doctor: stale holder' }).ok;
  }
  /** Custody of one claim, for helper-token validity: only `held` in an open build keeps a helper alive. */
  claimState(id: string, cid: string): ClaimState {
    const row = this.rows.get(id); if (!row) return this.store.build(id) ? 'closed' : 'unknown';
    return row.body.claims.find(c => c.id === cid)?.status ?? 'unknown';
  }
  /** Y4b: why a co-builder may not act on this build (lead account) or this claim (holder account); null for owner tokens,
   *  its own account's work, and unknown ids (the action itself reports those). */
  foreignTo(caller: Identity | undefined, id: string, cid?: string, verb = 'act on'): Failure | null {
    if (caller?.cobuilder === undefined) return null;
    const row = this.rows.get(id); if (!row) return null;
    const mine = accountKey(caller.cobuilder);
    if (cid === undefined) {
      const owner = labelAccount(row.body.lead.label);
      return owner === mine ? null : cobuilderFailure(`${id} is ${whose(owner)} build (led by ${row.body.lead.label}); a co-builder cannot ${verb} it.`, { limit: { build: id } });
    }
    const claim = row.body.claims.find(c => c.id === cid); if (!claim) return null;
    const owner = labelAccount(claim.holder.label);
    return owner === mine ? null : cobuilderFailure(`Claim ${cid} (${claim.part}) is ${whose(owner)} (held by ${claim.holder.label}); a co-builder cannot ${verb} it.`, { limit: { build: id, claim: cid } });
  }
  /** The claim a root token holds (directly or through its helpers), for minting. */
  heldClaim(id: string, cid: string, caller: Identity): { claim: Claim } | { failure: Failure } {
    const row = this.rows.get(id); if (!row) return { failure: buildFailure(this.store.build(id) ? 'build.closed' : 'build.unknown', id) };
    const claim = row.body.claims.find(c => c.id === cid);
    if (!claim || claim.status !== 'held') return { failure: buildFailure('build.claim-unknown', `${cid} is unknown or no longer held.`) };
    if (claim.user.tokenHash !== poolOf(caller)) return { failure: buildFailure('build.claimed', `${cid} (${claim.part}) is held by ${claim.holder.label}; only its holder can mint a helper for it.`, 'build.claim') };
    return { claim };
  }
  private liveClaims(row: Row, now: number) { return row.body.claims.filter(c => c.status === 'held' && !lockStatus(c.holder.process, c.lastAt, this.pauseMs, now).stale); }
  private overlap(scope: Scope, now: number, except?: string) {
    const others: LiveClaim[] = [];
    for (const row of this.rows.values()) for (const c of this.liveClaims(row, now)) if (c.id !== except) others.push(scoped(c));
    return overlappingClaim(this.host.model(), scope, others);
  }
  admit(field: BuildField | undefined, batch: Pick<Batch, 'group'> & { ops?: readonly Op[] }, caller?: Identity): Admission {
    const warnings: string[] = [];
    // WD7 slice 3: a helper token is authorised only through its own claim, before any planning.
    if (caller?.child) { const refused = helperScopeFailure(caller.child, field, batch.ops); if (refused) return { warnings, failures: [refused] }; }
    if (!field) { const owned = [...this.rows.values()].find(r => batch.group === r.id || batch.group?.startsWith(r.id + '/')); return { group: batch.group, warnings, ...(owned ? { failures: [buildFailure('build.group', `${batch.group} belongs to open build ${owned.id}.`)] } : {}) }; }
    const row = this.row(field.id); if (!row) return { warnings, failures: [buildFailure('build.unknown', field.id)] }; if (!open(row)) return { warnings, failures: [buildFailure('build.closed', field.id)] };
    // Y4b: a co-builder edits only through builds it leads and claims it holds.
    const foreign = this.foreignTo(caller, row.id, field.claim, 'edit through'); if (foreign) return { warnings, failures: [foreign] };
    if (field.claim) {
      const claim = row.body.claims.find(c => c.id === field.claim);
      if (!claim || claim.status !== 'held') return { warnings, failures: [buildFailure('build.claim-unknown', `${field.claim}${claim?.takenBy ? ` was taken by ${claim.takenBy.label} at ${claim.takenBy.at}` : ' is unknown or released'}.`)] };
      if (lockStatus(claim.holder.process, claim.lastAt, this.pauseMs, this.host.now()).stale) {
        const overlap = this.overlap(scoped(claim).scope, this.host.now(), claim.id);
        if (overlap) return { warnings, failures: [buildFailure('build.claimed', `Claim ${claim.id} cannot resume: overlaps ${overlap.id} (${overlap.part}).`, 'build.claim', { limit: { claim: overlap.id, part: overlap.part } })] };
      }
      const group = `${row.id}/${claim.part}`; if (batch.group && batch.group !== group) warnings.push(`group ${batch.group} ignored; claim group is ${group}`);
      const mine = scoped(claim);
      // A helper's named targets are checked before planning; claimCheck remains the geometric backstop.
      if (caller?.child && batch.ops) { const outside = outsideClaim(this.host.model(), mine, batch.ops); if (outside) return { warnings, failures: [outside] }; }
      return { row, field, mine, group, warnings };
    }
    if (field.lease !== row.body.lead.lease) return { warnings, failures: [buildFailure('build.lease', `${field.id} was resumed by ${row.body.lead.label} at ${row.body.lead.since}.`)] };
    let group = batch.group;
    if (!group || group === row.id) group = row.id;
    else if (!group.startsWith(row.id + '/')) { group = `${row.id}/${group}`.slice(0, 60); warnings.push(`group ${batch.group} mapped to ${group}`); }
    if (row.body.claims.some(c => c.status === 'held' && group === `${row.id}/${c.part}`)) return { warnings, failures: [buildFailure('build.group', `${group} belongs to a held claim.`)] };
    return { row, field, group, warnings };
  }
  check(admission: Admission, before: WorldModel, after: WorldModel, diff: Diff, ops: Op[], revert = false) {
    const now = this.host.now(), others: LiveClaim[] = [];
    for (const row of this.rows.values()) for (const c of this.liveClaims(row, now)) if (c.id !== admission.mine?.id) others.push(scoped(c));
    if (admission.row && !revert) {
      const body = admission.row.body, allowed = new Set([...body.roots, ...(body.include ?? []), ...body.claims.flatMap(c => [...(c.root ? [c.root] : []), ...c.made])]);
      const explicit = new Map<string, number>();
      ops.forEach((op, i) => {
        if (['move', 'set', 'remove'].includes(op.op) && 'id' in op) { const e = before.get(op.id); if (e) for (const id of before.subtree(e.id)) explicit.set(id, i); }
        if (op.op === 'define') for (const e of diff.upserts) { const prev = before.entities.get(e.id); if (prev && before.resolvedDef(prev.def)?.hash !== after.resolvedDef(e.def)?.hash) explicit.set(e.id, i); }
      });
      let created: Set<string> | undefined;
      for (const id of [...diff.removes, ...diff.upserts.map(e => e.id)]) {
        if (!before.entities.has(id) || !explicit.has(id) || inScope(before, id, allowed)) continue;
        created ??= new Set(this.store.groupEditsUnder(body.id, false, 2_147_483_647).flatMap(row => row.inverse.filter(op => op.op === 'remove').flatMap(op => before.entities.has(op.id) ? before.subtree(op.id) : [op.id])));
        if (created.has(id)) continue;
        return { failure: buildFailure('build.outside', `${before.pathOf(id)} existed outside build ${body.id}'s roots and claims.`, 'include', { entity: id, op: explicit.get(id), fix: `Use build step --include ${before.pathOf(id) || id}, then retry; or change the design to preserve it.` }) };
      }
    }
    const checked = claimCheck(before, after, diff, ops, admission.mine, others);
    if ('failure' in checked) return checked;
    // Region adoption cannot acquire a new child of another build, even if that build's root has moved here.
    if (admission.mine?.region) for (const id of checked.made) for (const parent of after.ancestors(id)) {
      const owner = this.rootIndex.get(parent);
      if (owner && owner !== admission.row!.id) return { failure: buildFailure('build.claim', `${after.pathOf(id)} belongs under build ${owner}, outside claim ${admission.mine.id}.`, 'in.parent', { entity: id }) };
    }
    return checked;
  }
  recordRefusal(field: BuildField | undefined, failures: Failure[]) {
    if (!field) return; const row = this.row(field.id); if (!row || !open(row)) return;
    // An invalid lease must not write another agent's private build metadata.
    if (field.lease !== row.body.lead.lease && !row.body.claims.some(c => c.id === field.claim && c.status === 'held')) return;
    this.store.noteBuildRefusal(row.id, failures.slice(0, 4).map(f => ({ at: this.host.now(), code: f.code.slice(0, 100), ...(f.entity ? { entity: f.entity.slice(0, 300) } : {}), detail: f.detail.slice(0, 300) })));
  }
  rootsDelta(before: WorldModel, after: WorldModel, diff: Diff, kind: 'edit' | 'undo' | 'redo' | 'engine', field?: BuildField) { return rootsDelta(before, after, diff, kind, field, [...this.rows.values()], this.rootIndex); }
  writes(admission: Admission, roots: RootsDelta, seq: number, at: number, caller?: Identity, group?: string, revert = false, made: string[] = [], note?: string): { writes: PlannedWrite[]; echo?: BuildEcho; warnings: string[]; failures?: Failure[] } {
    const ids = new Set(roots.changes.keys()); if (admission.row) ids.add(admission.row.id);
    // Prune removed made ids even for field-less edits, engine removals, and retained claims outside this batch.
    if (roots.removed.size) for (const row of this.rows.values()) if (row.body.claims.some(c => c.made.some(id => roots.removed.has(id)))) ids.add(row.id);
    // Undo/redo refresh liveness for the group they actually reverted, without advancing progress.
    if (group) for (const r of this.rows.values()) if (group === r.id || group.startsWith(r.id + '/')) ids.add(r.id);
    const writes: PlannedWrite[] = [], warnings: string[] = []; let echo: BuildEcho | undefined;
    for (const id of [...ids].sort()) {
      const row = this.rows.get(id)!, field = admission.row?.id === id ? admission.field : undefined, change = roots.changes.get(id) ?? { added: [], removed: [] };
      const body = advance(row.body, field, made, change, seq, at, caller, this.pauseMs, revert, roots.removed), wasPaused = effective(row, at, this.pauseMs) === 'paused';
      let status = row.status, kind: BuildEventKind = 'step';
      const groupLead = !!group && !row.body.paused?.explicit && (group === id || group.startsWith(id + '/')) && caller?.hash === row.body.lead.tokenHash;
      const refresh = !!field || groupLead;
      const claim = field?.claim ? body.claims.find(c => c.id === field.claim) : undefined;
      if (refresh) { body.lastBatchAt = at; delete body.closureLapsedAt; delete body.paused; if (note !== undefined) body.note = { text: cleanText(note).slice(0, 140), at }; else delete body.note; status = !revert && body.done ? 'done' : 'active'; if (wasPaused) { body.pauses++; kind = 'resumed'; } if (status === 'done') kind = 'done'; if (!revert && field?.done && !field.claim && !body.done) warnings.push(`${id} stays open: ${this.liveClaims(row, at).length} live claims (${this.liveClaims(row, at).map(c => c.part).join(', ')}); release them or build done --force`); if (claim?.status === 'done') kind = 'released'; }
      const encoded = JSON.stringify(body), failure = buildBodyFailure(encoded); if (failure) return { writes: [], warnings, failures: [failure] };
      const w: PlannedWrite = { id, expectRev: row.rev, status, lastAt: refresh ? at : row.last_at, body: encoded, next: body, before: row, roots: change, kind, ...(field ? { echo: true } : {}), ...(claim ? { claim: { part: claim.part, status: claim.status } } : {}) };
      writes.push(w); if (field) echo = { id, status, rev: 0, group: revert ? group : admission.group!, step: { n: claim?.step.n ?? body.step.n, label: claim?.step.label ?? body.step.label }, ...(claim ? { claim: claim.id } : {}) };
    }
    return { writes, echo, warnings };
  }
  accepted(writes: PlannedWrite[]): SiteDelta[] { return writes.map(w => { const row: Row = { ...w.before, body: w.next, rev: w.rev!, status: w.status, last_at: w.lastAt }; this.install(row, w.roots); return this.delta(row, w.roots, w.claim, w.before.body); }); }
  announceCommitted(writes: PlannedWrite[]) { for (const w of writes) this.announce({ ...w.before, body: w.next, rev: w.rev!, status: w.status, last_at: w.lastAt }, w.kind, w.roots, true, undefined, w.claim, w.before.body); }
}
