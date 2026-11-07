// Y3 / NT10 slice 1 — bigger than one plot. A district is ONE private plan (roads, plots with their buildings' massing,
// terrain and water notes), recorded once with POST /v1/god/districts and built as ordinary chapter builds
// (`POST /v1/god/builds {id, district: {id, plots?}}`), whose site and massing come from the named plots.
// Why a separate record and not a build: a plan has no lease, closure or undo group, outlives its chapters and may be
// larger than one 200 m site. As a build it would either close the whole district or adopt every new entity inside its
// rectangle as a root (rootsDelta assigns roots by site). Chapters keep all build machinery: closure covers only the
// chapter's own massing and roots (WD1), resume/claims/receipts are unchanged, and `undo --group <chapter>` is one
// atomic undo per chapter (RL2). Chapters never adopt earlier chapters' roots, so finished plots stay open to residents.
// Closed chapters are also copied to a small private ledger (god_district_chapters_v1), so plot status survives the
// retention prune of closed build rows; the ledger keeps each plot's newest chapter and is bounded per district.
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { hashOf, obbOverlap, type Failure, type OBB, type WorldModel } from '@souls/world-compiler';
import { ApiError } from '../souls.ts';
import { CLOSURE_MARGIN_M, effective, siteLocal, siteWorld, type BuildBody, type GodBuilds, type Identity, type Mass, type Site } from './builds.ts';
import type { BuildRow, WorldStore } from './store.ts';

export const DISTRICT_LIMITS = { districts: 32, plots: 48, roads: 32, roadPoints: 32, chapters: 48, plotsPerChapter: 8, chapterMasses: 8, chapterSiteM: 200, bodyBytes: 65_536, recordsPerMinute: 6, ledgerPerDistrict: 96 } as const;
export const districtCodes = ['district.unknown', 'district.exists', 'district.plan', 'district.limit', 'district.plot', 'district.open'] as const;
type Code = typeof districtCodes[number];
const fixes: Record<Code, string> = {
  'district.unknown': '`build district` lists districts; record one with `build district <id> --file plan.json`.',
  'district.exists': 'A district plan is recorded once; pick a new id, or build its chapters (`build district <id>`).',
  'district.plan': 'Fix the named plan field and record the plan again.',
  'district.limit': 'Keep the plan within districts.limits in GET /v1/god/schema.',
  'district.plot': '`build district <id>` shows each plot\'s status and the next chapter command.',
  'district.open': 'Finish or abandon the open chapter first (build resume <chapter>, then build done or build abandon).',
};
export const districtFailure = (code: Code, detail: string, field = 'district', extra: Partial<Failure> = {}): Failure => ({ op: -1, code, detail, field, fix: fixes[code], ...extra });
const refuse = (code: Code, detail: string, field?: string, extra?: Partial<Failure>) => ({ ok: false as const, failures: [districtFailure(code, detail, field, extra)] });
const schemaFailures = (error: z.ZodError, prefix = ''): Failure[] => error.issues.slice(0, 8).map(i => ({ op: -1, code: 'schema', field: [prefix, ...i.path.map(String)].filter(Boolean).join('.'), detail: i.message, fix: 'Use the district shapes in GET /v1/god/schema (districts).' }));

const pair = z.tuple([z.number().finite(), z.number().finite()]);
const districtId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,29}$/);
const plotId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,7}$/);
const label = z.string().min(1).max(60);
// Plot mass names stay short so a chapter can prefix them with the plot id inside the 19-character mass-name limit.
const plotMassSchema = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,9}$/).optional(), at: pair, size: z.tuple([z.number().positive().max(200), z.number().positive().max(200)]), h: z.number().min(.5).max(120), yaw: z.number().finite().optional(), roof: z.enum(['flat', 'gable', 'pyramid']).optional() }).strict();
const plotSchema = z.object({ id: plotId, title: z.string().min(1).max(80).optional(), use: z.string().min(1).max(60).optional(), at: pair, size: z.tuple([z.number().min(1).max(200), z.number().min(1).max(200)]), yaw: z.number().finite().optional(), massing: z.array(plotMassSchema).max(8).optional(), steps: z.array(label).min(1).max(24).optional() }).strict();
const roadSchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,15}$/), name: z.string().min(1).max(60).optional(), path: z.array(pair).min(2).max(32), width: z.number().min(1).max(40) }).strict();
/** World coordinates; plot massing is plot-local (like build massing is site-local). */
export const districtPlanSchema = z.object({
  id: districtId, title: z.string().min(1).max(80), brief: z.string().max(4000).optional(), steps: z.array(label).min(1).max(24).optional(),
  plots: z.array(plotSchema).min(1).max(48), roads: z.array(roadSchema).max(32).optional(), chapters: z.array(z.array(plotId).min(1).max(8)).max(48).optional(),
  terrain: z.string().max(500).optional(), water: z.string().max(500).optional(),
}).strict();
/** The `district` field of POST /v1/god/builds. Omitted plots take the plan's next chapter. */
export const districtChapterSchema = z.object({ id: districtId, plots: z.array(plotId).min(1).max(8).optional() }).strict();
export type DistrictPlan = z.infer<typeof districtPlanSchema>;
type Plot = DistrictPlan['plots'][number];
type Road = NonNullable<DistrictPlan['roads']>[number];
type PlotMass = NonNullable<Plot['massing']>[number];
type DistrictBody = { plan: DistrictPlan; by: { label: string; hash8: string }; at: number };
export type PlotStatus = 'planned' | 'building' | 'built' | 'undone';
type Chapter = { id: string; plots: string[]; status: BuildRow['status']; title: string; step: { n: number; label: string; of: number }; brief?: string; parts: number; closed: boolean; followUpOf?: string; roots: string[]; createdAt: number };
export type DistrictView = {
  id: string; title: string; brief?: string; steps?: string[]; terrain?: string; water?: string; createdAt: number; by: { label: string; hash8: string };
  roads: { id: string; name?: string; width: number; path: [number, number][] }[];
  plots: { id: string; title?: string; use?: string; at: [number, number]; size: [number, number]; yaw?: number; masses: number; status: PlotStatus; chapter?: string; parts?: number }[];
  chapters: Omit<Chapter, 'roots'>[];
  counts: { plots: number; built: number; building: number; planned: number };
  next: { action: 'resume' | 'start'; id: string; plots: string[] } | null;
};

// ---------------------------------------------------------------- geometry (same yaw convention as builds.siteWorld)
const plotSite = (p: Plot): Site => ({ at: p.at, size: p.size, yaw: p.yaw ?? 0 });
const obb = (s: Site, grow = 0): OBB => ({ c: s.at, half: [s.size[0] / 2 + grow, s.size[1] / 2 + grow], yaw: s.yaw, y0: -1e6, y1: 1e6 });
const corners = (s: Site) => [-1, 1].flatMap(a => [-1, 1].map(b => siteWorld(s, [a * s.size[0] / 2, b * s.size[1] / 2])));
const massWorld = (p: Plot, m: PlotMass): Site => ({ at: siteWorld(plotSite(p), m.at), size: m.size, yaw: (p.yaw ?? 0) + (m.yaw ?? 0) });
const r1 = (v: number) => Math.round(v * 10) / 10;
/** Segment a→b as a box: local +x maps to [cos, -sin], so yaw = atan2(-dz, dx). */
const segmentBox = (a: [number, number], b: [number, number], width: number): Site => ({ at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], size: [Math.max(1e-3, Math.hypot(b[0] - a[0], b[1] - a[1])), width], yaw: Math.atan2(-(b[1] - a[1]), b[0] - a[0]) });
type P = [number, number];
const segments = (r: Road) => r.path.slice(1).map((b, i) => [r.path[i], b] as [P, P]);
/** The point of segment a→b nearest p. */
function nearestOnSegment(a: P, b: P, p: P): P {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz, t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
  return [a[0] + t * dx, a[1] + t * dz];
}
const ring = (s: Site) => { const c = corners(s); return [c[0], c[1], c[3], c[2]] as P[]; };
/** Distance between two rectangles, 0 when they overlap: the nearest pair is a corner of one and an edge of the other. */
export function rectGap(a: Site, b: Site) {
  if (obbOverlap(obb(a), obb(b))) return 0;
  const ra = ring(a), rb = ring(b); let d = Infinity;
  for (const [xs, ys] of [[ra, rb], [rb, ra]]) for (const p of xs) for (let i = 0; i < 4; i++) { const q = nearestOnSegment(ys[i], ys[(i + 1) % 4], p); d = Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1])); }
  return d;
}
/** Plots touching a chapter's bounding rectangle by less than this are neighbours, not inside it. */
const PLOT_EDGE_M = .05;
const roadsCrossing = (plan: DistrictPlan, site: Site) => (plan.roads ?? []).filter(r => segments(r).some(([a, b]) => obbOverlap(obb(segmentBox(a, b, r.width)), obb(site))));
/** The chapter site is the plots' bounding rectangle (in their shared yaw, else world axes) with a 1 cm edge. */
export function chapterShape(plots: Plot[]): { site: Site; massing: Mass[] } {
  const yaw = plots.every(p => (p.yaw ?? 0) === (plots[0].yaw ?? 0)) ? plots[0].yaw ?? 0 : 0, frame: Site = { at: [0, 0], size: [0, 0], yaw };
  const local = plots.flatMap(p => corners(plotSite(p)).map(c => siteLocal(frame, c))), xs = local.map(c => c[0]), zs = local.map(c => c[1]);
  const lo = [Math.min(...xs), Math.min(...zs)], hi = [Math.max(...xs), Math.max(...zs)], extent = [hi[0] - lo[0], hi[1] - lo[1]];
  const site: Site = { at: siteWorld(frame, [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]), size: [Math.min(DISTRICT_LIMITS.chapterSiteM, extent[0] + .02), Math.min(DISTRICT_LIMITS.chapterSiteM, extent[1] + .02)], yaw };
  if (extent.some(e => e > DISTRICT_LIMITS.chapterSiteM)) site.size = [extent[0], extent[1]];
  const massing = plots.flatMap(p => (p.massing ?? []).map((m, i): Mass => {
    const w = massWorld(p, m), turn = w.yaw - yaw;
    return { name: `${p.id}-${m.name ?? i + 1}`, at: siteLocal(site, w.at), size: [m.size[0], m.size[1]], h: m.h, ...(Math.abs(turn) > 1e-9 ? { yaw: turn } : {}), ...(m.roof ? { roof: m.roof } : {}) };
  }));
  return { site, massing };
}
const chapterGroupFailure = (plan: DistrictPlan, ids: string[], field: string): Failure | undefined => {
  const plots = ids.map(id => plan.plots.find(p => p.id === id)!), shape = chapterShape(plots), masses = shape.massing.length;
  if (shape.site.size.some(s => s > DISTRICT_LIMITS.chapterSiteM)) return districtFailure('district.plot', `Chapter ${ids.join(',')} spans ${shape.site.size.map(r1).join('×')} m; one build site is at most ${DISTRICT_LIMITS.chapterSiteM} m a side.`, field, { measured: shape.site.size.map(r1), limit: DISTRICT_LIMITS.chapterSiteM, fix: 'Build fewer or closer plots in this chapter.' });
  if (masses > DISTRICT_LIMITS.chapterMasses) return districtFailure('district.plot', `Chapter ${ids.join(',')} has ${masses} masses; one build holds at most ${DISTRICT_LIMITS.chapterMasses}.`, field, { measured: masses, limit: DISTRICT_LIMITS.chapterMasses, fix: 'Build fewer plots in this chapter.' });
  // The site is the plots' bounding rectangle: covering another plot would close it and adopt new things placed there.
  const covered = plan.plots.filter(p => !ids.includes(p.id) && obbOverlap(obb(shape.site), obb(plotSite(p), -PLOT_EDGE_M))).map(p => p.id);
  if (covered.length) return districtFailure('district.plot', `Chapter ${ids.join(',')} would take a ${shape.site.size.map(r1).join('×')} m site that covers plot${covered.length > 1 ? 's' : ''} ${covered.join(',')}, which ${covered.length > 1 ? 'are' : 'is'} not in it (a chapter's site is its plots' bounding rectangle).`, field, { fix: `Build plots that are not next to each other as separate chapters (e.g. --plots ${ids[0]}, then --plots ${ids.slice(1).join(',')}).` });
};

/** Semantic checks after the schema; refusals name the field, warnings never block. */
export function checkPlan(plan: DistrictPlan, model?: WorldModel, openSites: { id: string; site: Site }[] = []): { failures: Failure[]; warnings: string[] } {
  const failures: Failure[] = [], warnings: string[] = [], seen = new Set<string>();
  const plan_ = (detail: string, field: string) => failures.push(districtFailure('district.plan', detail, field));
  plan.plots.forEach((p, i) => {
    if (seen.has(p.id)) plan_(`Plot id ${p.id} is used twice.`, `plots.${i}.id`); seen.add(p.id);
    const names = new Set<string>();
    (p.massing ?? []).forEach((m, j) => {
      const name = m.name ?? String(j + 1); if (names.has(name)) plan_(`Plot ${p.id} names mass ${name} twice.`, `plots.${i}.massing.${j}.name`); names.add(name);
      for (const c of corners({ at: m.at, size: m.size, yaw: m.yaw ?? 0 })) if (Math.abs(c[0]) > p.size[0] / 2 + 1e-7 || Math.abs(c[1]) > p.size[1] / 2 + 1e-7) { plan_(`Plot ${p.id} mass ${name} must be wholly inside its plot (plot-local metres).`, `plots.${i}.massing.${j}`); break; }
    });
    for (let k = 0; k < i; k++) if (obbOverlap(obb(plotSite(plan.plots[k])), obb(plotSite(p)))) plan_(`Plots ${plan.plots[k].id} and ${p.id} overlap.`, `plots.${i}`);
  });
  const roadIds = new Set<string>();
  (plan.roads ?? []).forEach((r, i) => { if (roadIds.has(r.id)) plan_(`Road id ${r.id} is used twice.`, `roads.${i}.id`); roadIds.add(r.id); });
  const grouped = new Map<string, number>();
  (plan.chapters ?? []).forEach((ids, i) => {
    for (const id of ids) {
      if (!seen.has(id)) { plan_(`Chapter ${i + 1} names unknown plot ${id}.`, `chapters.${i}`); return; }
      if (grouped.has(id)) { plan_(`Plot ${id} is in chapters ${grouped.get(id)! + 1} and ${i + 1}.`, `chapters.${i}`); return; }
      grouped.set(id, i);
    }
    const group = chapterGroupFailure(plan, ids, `chapters.${i}`); if (group) failures.push({ ...group, code: 'district.plan' });
  });
  if (failures.length) return { failures, warnings };
  for (const p of plan.plots) {
    for (const r of plan.roads ?? []) if (segments(r).some(([a, b]) => obbOverlap(obb(segmentBox(a, b, r.width)), obb(plotSite(p))))) warnings.push(`plot ${p.id} overlaps road ${r.id}; keep buildings off the carriageway`);
    if (model) { const [x0, z0, x1, z1] = model.ground().extent; if (p.at[0] < x0 || p.at[0] > x1 || p.at[1] < z0 || p.at[1] > z1) warnings.push(`plot ${p.id} centre is outside the ground extent; expand the world before building it`); }
    for (const o of openSites) if (obbOverlap(obb(o.site), obb(plotSite(p)))) warnings.push(`plot ${p.id} overlaps open build ${o.id}; finish it before building this plot`);
  }
  // Roots are adopted by site, so a chapter whose rectangle spans a road takes in things placed on that stretch.
  (plan.chapters ?? []).forEach((ids, i) => {
    const site = chapterShape(ids.map(id => plan.plots.find(p => p.id === id)!)).site;
    for (const r of roadsCrossing(plan, site)) warnings.push(`chapter ${i + 1} (${ids.join(',')}) site spans road ${r.id}: things placed on that road inside the site join the chapter and close with it`);
  });
  // Closure covers a chapter's massing plus CLOSURE_MARGIN_M: masses closer than that close a neighbour's edge.
  const masses = plan.plots.flatMap(p => (p.massing ?? []).map(m => ({ plot: p.id, box: massWorld(p, m) })));
  const near = new Set<string>();
  for (const a of masses) for (const b of masses) if (a.plot < b.plot && !near.has(`${a.plot}:${b.plot}`) && obbOverlap(obb(a.box, CLOSURE_MARGIN_M), obb(b.box))) { near.add(`${a.plot}:${b.plot}`); warnings.push(`plots ${a.plot} and ${b.plot} have masses within ${CLOSURE_MARGIN_M} m: building one closes the other's edge`); }
  return { failures, warnings: warnings.slice(0, 24) };
}

const LEDGER_BYTES = 32_768, BRIEF_VIEW = 140;
export function ensureDistrictSchema(db: WorldStore['db']) {
  db.db.exec(`CREATE TABLE IF NOT EXISTS god_districts_v1 (world_id TEXT NOT NULL, id TEXT NOT NULL CHECK(length(id)<=30), created_at INTEGER NOT NULL, hash TEXT NOT NULL,
    body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=${DISTRICT_LIMITS.bodyBytes}), PRIMARY KEY(world_id,id)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS god_district_chapters_v1 (world_id TEXT NOT NULL, district TEXT NOT NULL, chapter TEXT NOT NULL, created_at INTEGER NOT NULL,
    body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=${LEDGER_BYTES}), PRIMARY KEY(world_id,district,chapter)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS god_builds_v1_district ON god_builds_v1(world_id,json_extract(body,'$.district.id')) WHERE json_extract(body,'$.district.id') IS NOT NULL;`);
}
type LedgerBody = Pick<Chapter, 'plots' | 'status' | 'title' | 'step' | 'brief' | 'roots' | 'followUpOf'>;
type RecordRow = { id: string; created_at: number; hash: string; body: DistrictBody };
const isOpen = (c: Pick<Chapter, 'status'>) => c.status === 'active' || c.status === 'paused';

type Host = { store: WorldStore; model: () => WorldModel; now: () => number; builds: () => GodBuilds };
/** God-only plans and their derived state. Every read is derived from durable rows, so restarts need no cache. */
export class GodDistricts {
  private readonly h: Host;
  constructor(h: Host) {
    this.h = h; ensureDistrictSchema(h.store.db);
    // Closed chapters missing from the ledger (a stop between a close and its notice) are copied once at start.
    const missing = this.sql.prepare(`SELECT id,status,rev,created_at,last_at,body FROM god_builds_v1 b WHERE world_id=? AND json_extract(body,'$.district.id') IS NOT NULL AND status IN ('done','abandoned')
      AND NOT EXISTS (SELECT 1 FROM god_district_chapters_v1 l WHERE l.world_id=b.world_id AND l.district=json_extract(b.body,'$.district.id') AND l.chapter=b.id)`).all(h.store.worldId) as BuildRow[];
    for (const r of missing) this.remember(r);
  }
  private get sql() { return this.h.store.db.db; }
  private row(id: string): RecordRow | null {
    const r = this.sql.prepare('SELECT id,created_at,hash,body FROM god_districts_v1 WHERE world_id=? AND id=?').get(this.h.store.worldId, id) as { id: string; created_at: number; hash: string; body: string } | undefined;
    return r ? { ...r, body: JSON.parse(r.body) } : null;
  }
  /** Build notice hook: a closed chapter is copied to the ledger, so pruning its build row keeps its plots' status. */
  onClosed(id: string) { const r = this.h.store.build(id); if (r) this.remember(r); }
  private remember(r: BuildRow) {
    if (r.status !== 'done' && r.status !== 'abandoned') return;
    let b: BuildBody; try { b = JSON.parse(r.body); } catch { return; } if (!b.district) return;
    const entry: LedgerBody = { plots: b.district.plots, status: r.status, title: b.title, step: { n: b.step.n, label: b.step.label, of: b.plan.steps.length }, ...(b.plan.brief !== undefined ? { brief: b.plan.brief.slice(0, BRIEF_VIEW) } : {}), roots: b.roots, ...(b.chapterOf ? { followUpOf: b.chapterOf } : {}) };
    let body = JSON.stringify(entry);
    while (Buffer.byteLength(body) > LEDGER_BYTES && entry.roots.length) { entry.roots = entry.roots.slice(0, Math.floor(entry.roots.length / 2)); body = JSON.stringify(entry); }
    this.sql.prepare('INSERT INTO god_district_chapters_v1(world_id,district,chapter,created_at,body) VALUES(?,?,?,?,?) ON CONFLICT(world_id,district,chapter) DO UPDATE SET created_at=excluded.created_at,body=excluded.body').run(this.h.store.worldId, b.district.id, r.id, r.created_at, body);
    this.pruneLedger(b.district.id);
  }
  /** Keep every plot's newest closed chapter, then the newest others, up to ledgerPerDistrict rows. */
  private pruneLedger(district: string) {
    const rows = this.sql.prepare('SELECT chapter,body FROM god_district_chapters_v1 WHERE world_id=? AND district=? ORDER BY created_at DESC, chapter DESC').all(this.h.store.worldId, district) as { chapter: string; body: string }[];
    if (rows.length <= DISTRICT_LIMITS.ledgerPerDistrict) return;
    const keep = new Set<string>(), seen = new Set<string>();
    for (const r of rows) { const plots = (JSON.parse(r.body) as LedgerBody).plots; if (plots.some(p => !seen.has(p))) keep.add(r.chapter); for (const p of plots) seen.add(p); }
    for (const r of rows) if (keep.size < DISTRICT_LIMITS.ledgerPerDistrict) keep.add(r.chapter);
    const drop = this.sql.prepare('DELETE FROM god_district_chapters_v1 WHERE world_id=? AND district=? AND chapter=?');
    for (const r of rows) if (!keep.has(r.chapter)) drop.run(this.h.store.worldId, district, r.chapter);
  }
  /** Chapters by district: retained build rows naming it (follow-ups inherit the link), else their ledger copy; oldest first. */
  private chaptersBy(only?: string): Map<string, Chapter[]> {
    const builds = this.h.builds(), now = this.h.now(), model = this.h.model(), closing = new Set(builds.closingSites(now).map(s => s.id)), out = new Map<string, Chapter[]>(), seen = new Set<string>();
    const add = (district: string, c: Chapter) => { seen.add(`${district}/${c.id}`); const list = out.get(district); if (list) list.push(c); else out.set(district, [c]); };
    const standing = (roots: string[]) => roots.filter(root => model.entities.has(root));
    // The expression index on the district id keeps this to the district's own rows.
    const rows = (only !== undefined
      ? this.sql.prepare("SELECT id,status,rev,created_at,last_at,body FROM god_builds_v1 WHERE world_id=? AND json_extract(body,'$.district.id')=?").all(this.h.store.worldId, only)
      : this.sql.prepare("SELECT id,status,rev,created_at,last_at,body FROM god_builds_v1 WHERE world_id=? AND json_extract(body,'$.district.id') IS NOT NULL").all(this.h.store.worldId)) as BuildRow[];
    for (const r of rows) {
      let b: BuildBody; try { b = JSON.parse(r.body); } catch { continue; }
      if (!b.district || (only !== undefined && b.district.id !== only)) continue;
      const roots = standing(b.roots);
      add(b.district.id, { id: r.id, plots: [...b.district.plots], status: effective(r, now, builds.pauseMs), title: b.title, step: { n: b.step.n, label: b.step.label, of: b.plan.steps.length }, ...(b.plan.brief !== undefined ? { brief: b.plan.brief } : {}), parts: roots.length, closed: closing.has(r.id), ...(b.chapterOf ? { followUpOf: b.chapterOf } : {}), roots, createdAt: r.created_at });
    }
    const ledger = (only !== undefined
      ? this.sql.prepare('SELECT district,chapter,created_at,body FROM god_district_chapters_v1 WHERE world_id=? AND district=?').all(this.h.store.worldId, only)
      : this.sql.prepare('SELECT district,chapter,created_at,body FROM god_district_chapters_v1 WHERE world_id=?').all(this.h.store.worldId)) as { district: string; chapter: string; created_at: number; body: string }[];
    for (const l of ledger) {
      if (seen.has(`${l.district}/${l.chapter}`)) continue;
      const e = JSON.parse(l.body) as LedgerBody, roots = standing(e.roots);
      add(l.district, { ...e, id: l.chapter, roots, parts: roots.length, closed: false, createdAt: l.created_at });
    }
    for (const list of out.values()) list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return out;
  }
  /** A district's chapters are the builds started since it was recorded (an id may be reused after a delete). */
  private chapters(row: RecordRow, all?: Map<string, Chapter[]>) { return ((all ?? this.chaptersBy(row.id)).get(row.id) ?? []).filter(c => c.createdAt >= row.created_at); }
  private plotParts(plot: Plot, roots: string[]) {
    const model = this.h.model(), area = { ...plotSite(plot), size: [plot.size[0] + 1, plot.size[1] + 1] as [number, number] };
    return roots.filter(id => { const p = model.worldPose(model.entities.get(id)!), [x, z] = siteLocal(area, [p.x, p.z]); return Math.abs(x) <= area.size[0] / 2 && Math.abs(z) <= area.size[1] / 2; }).length;
  }
  /**
   * Open beats built beats undone. A closed chapter (done, or abandoned without undo) counts each plot by what still
   * stands on it: built when its own parts stand there, else free again. `except` ignores one chapter (its own replay).
   */
  private states(plan: DistrictPlan, chapters: Chapter[], except?: string) {
    const rank: Record<PlotStatus, number> = { planned: 0, undone: 1, built: 2, building: 3 }, states = new Map<string, { status: PlotStatus; chapter?: string; parts?: number }>();
    for (const c of chapters) {
      if (c.id === except) continue;
      for (const id of c.plots) {
        const plot = plan.plots.find(p => p.id === id); if (!plot) continue;
        const parts = this.plotParts(plot, c.roots), status: PlotStatus = isOpen(c) ? 'building' : parts ? 'built' : 'undone';
        const previous = states.get(id); if (previous && rank[status] < rank[previous.status]) continue;
        states.set(id, { status, chapter: c.id, parts });
      }
    }
    return states;
  }
  /** The plan's next chapter of free plots; a remainder whose rectangle would cover a taken plot starts one plot at a time. */
  private nextGroup(plan: DistrictPlan, states: ReturnType<GodDistricts['states']>): string[] | undefined {
    const groups = plan.chapters ?? [], named = new Set(groups.flat());
    for (const group of [...groups, ...plan.plots.filter(p => !named.has(p.id)).map(p => [p.id])]) {
      const free = group.filter(id => ['planned', 'undone'].includes(states.get(id)?.status ?? 'planned'));
      if (free.length) return free.length > 1 && chapterGroupFailure(plan, free, 'district.plots') ? [free[0]] : free;
    }
  }
  private freshId(id: string, chapters: Chapter[]) { const used = new Set(chapters.map(c => c.id)); for (let n = 1; n < 1000; n++) { const candidate = `${id}-${n}`; if (!used.has(candidate) && !this.h.store.build(candidate) && !this.h.store.hasGroupUnder(candidate)) return candidate; } return `${id}-${Date.now() % 100000}`; }
  /** One scan of chapter rows for every district. */
  list() {
    const rows = this.sql.prepare('SELECT id,created_at,hash,body FROM god_districts_v1 WHERE world_id=? ORDER BY created_at').all(this.h.store.worldId) as { id: string; created_at: number; hash: string; body: string }[];
    const all = this.chaptersBy();
    return rows.map(r => { const v = this.compose({ ...r, body: JSON.parse(r.body) }, all, true); return { id: v.id, title: v.title, counts: v.counts, next: v.next, createdAt: v.createdAt }; });
  }
  /** `compact` drops chapter briefs (the view beside one chapter); otherwise each is trimmed (full text: `build show <chapter>`). */
  view(id: string, compact = false): DistrictView | null { const row = this.row(id); return row ? this.compose(row, undefined, compact) : null; }
  private compose(row: RecordRow, all: Map<string, Chapter[]> | undefined, compact: boolean): DistrictView {
    const plan = row.body.plan, id = row.id, chapters = this.chapters(row, all), states = this.states(plan, chapters);
    const plots = plan.plots.map(p => { const s = states.get(p.id) ?? { status: 'planned' as const }; return { id: p.id, ...(p.title ? { title: p.title } : {}), ...(p.use ? { use: p.use } : {}), at: p.at, size: p.size, ...(p.yaw ? { yaw: p.yaw } : {}), masses: p.massing?.length ?? 0, ...s }; });
    const count = (s: PlotStatus) => plots.filter(p => p.status === s).length;
    const open = chapters.filter(isOpen).at(-1), group = open ? undefined : this.nextGroup(plan, states);
    return {
      id, title: plan.title, ...(plan.brief !== undefined ? { brief: plan.brief } : {}), ...(plan.steps ? { steps: plan.steps } : {}), ...(plan.terrain ? { terrain: plan.terrain } : {}), ...(plan.water ? { water: plan.water } : {}),
      createdAt: row.created_at, by: row.body.by, roads: (plan.roads ?? []).map(r => ({ id: r.id, ...(r.name ? { name: r.name } : {}), width: r.width, path: r.path })), plots,
      chapters: chapters.map(({ roots: _roots, brief, ...c }) => ({ ...c, ...(brief !== undefined && !compact ? { brief: brief.length > BRIEF_VIEW ? `${brief.slice(0, BRIEF_VIEW - 1)}…` : brief } : {}) })),
      counts: { plots: plots.length, built: count('built'), building: count('building'), planned: count('planned') + count('undone') },
      next: open ? { action: 'resume', id: open.id, plots: open.plots } : group ? { action: 'start', id: this.freshId(id, chapters), plots: group } : null,
    };
  }
  record(raw: unknown, caller: Identity) {
    const p = districtPlanSchema.safeParse(raw); if (!p.success) return { ok: false as const, failures: schemaFailures(p.error) };
    const plan = p.data, hash = hashOf(plan), prior = this.row(plan.id);
    if (prior) return prior.hash === hash ? { ok: true as const, district: this.view(plan.id)!, warnings: [] as string[], replayed: true } : refuse('district.exists', `District ${plan.id} already has a different plan.`, 'id');
    const count = (this.sql.prepare('SELECT count(*) AS n FROM god_districts_v1 WHERE world_id=?').get(this.h.store.worldId) as { n: number }).n;
    if (count >= DISTRICT_LIMITS.districts) return refuse('district.limit', `At most ${DISTRICT_LIMITS.districts} districts per world.`, 'id', { measured: count, limit: DISTRICT_LIMITS.districts, fix: 'Delete a district you no longer need (build district <id> --delete; its buildings and chapters stay).' });
    const checked = checkPlan(plan, this.h.model(), this.h.builds().publicList().builds.map(b => ({ id: b.id, site: b.site })));
    if (checked.failures.length) return { ok: false as const, failures: checked.failures };
    const body = JSON.stringify({ plan, by: { label: caller.label, hash8: caller.hash.slice(0, 8) }, at: this.h.now() } satisfies DistrictBody), bytes = Buffer.byteLength(body);
    if (bytes > DISTRICT_LIMITS.bodyBytes) return refuse('district.limit', `The plan needs ${bytes} bytes; the limit is ${DISTRICT_LIMITS.bodyBytes}.`, 'plots', { measured: bytes, limit: DISTRICT_LIMITS.bodyBytes, fix: 'Shorten texts or road paths, or split the area into two districts.' });
    this.sql.prepare('INSERT INTO god_districts_v1(world_id,id,created_at,hash,body) VALUES(?,?,?,?,?)').run(this.h.store.worldId, plan.id, this.h.now(), hash, body);
    return { ok: true as const, district: this.view(plan.id)!, warnings: checked.warnings };
  }
  /** Deletes the plan (frees its id and quota) when no chapter is open. Buildings and chapter builds stay; so do their undo groups. */
  remove(id: string) {
    const row = this.row(id); if (!row) return null;
    const chapters = this.chapters(row), open = chapters.find(isOpen);
    if (open) return refuse('district.open', `Chapter ${open.id} of ${id} is open.`, 'id', { fix: `Finish or abandon ${open.id} first (build resume ${open.id}, then build done or build abandon).` });
    this.sql.prepare('DELETE FROM god_districts_v1 WHERE world_id=? AND id=?').run(this.h.store.worldId, id);
    this.sql.prepare('DELETE FROM god_district_chapters_v1 WHERE world_id=? AND district=?').run(this.h.store.worldId, id);
    return { ok: true as const, deleted: id, chapters: chapters.map(c => c.id) };
  }
  /** GodBuilds.start hook: a chapter start names the district (and optionally its plots); site, massing, title and steps come from the plan. */
  expand(raw: Record<string, unknown>): { raw: Record<string, unknown> } | { failures: Failure[] } {
    const p = districtChapterSchema.safeParse(raw.district); if (!p.success) return { failures: schemaFailures(p.error, 'district') };
    const row = this.row(p.data.id); if (!row) return { failures: [districtFailure('district.unknown', `Unknown district ${p.data.id}.`, 'district.id')] };
    for (const key of ['site', 'root'] as const) if (raw[key] !== undefined) return { failures: [districtFailure('district.plot', `A district chapter takes its ${key === 'site' ? 'site' : 'roots'} from its plots; omit ${key}.`, key, { fix: key === 'root' ? 'Use build continue <chapter> for a follow-up on built plots.' : 'Omit --at/--size/--mass; the plan holds each plot\'s rectangle and massing.' })] };
    if (Array.isArray(raw.massing) && raw.massing.length) return { failures: [districtFailure('district.plot', 'A district chapter takes its massing from its plots; omit massing.', 'massing')] };
    const plan = row.body.plan, self = typeof raw.id === 'string' ? raw.id : undefined, chapters = this.chapters(row), states = this.states(plan, chapters, self);
    const prior = self ? chapters.find(c => c.id === self) : undefined;
    if (prior && !this.h.store.build(prior.id)) return { failures: [districtFailure('district.plot', `${self} was an earlier chapter of ${plan.id}.`, 'id', { fix: `Pick a new chapter id; build district ${plan.id} prints next with a fresh one.` })] };
    const ids = p.data.plots ?? prior?.plots ?? this.nextGroup(plan, states);
    if (!ids?.length) return { failures: [districtFailure('district.plot', `Every plot of ${plan.id} is built or being built.`, 'district.plots')] };
    if (new Set(ids).size !== ids.length) return { failures: [districtFailure('district.plot', 'A chapter names each plot once.', 'district.plots')] };
    for (const id of ids) {
      if (!plan.plots.some(x => x.id === id)) return { failures: [districtFailure('district.plot', `District ${plan.id} has no plot ${id}.`, 'district.plots')] };
      const s = states.get(id);
      if (s?.status === 'building') return { failures: [districtFailure('district.plot', `Plot ${id} is being built in ${s.chapter}.`, 'district.plots', { fix: `build resume ${s.chapter}` })] };
      if (s?.status === 'built') return { failures: [districtFailure('district.plot', `Plot ${id} is built by ${s.chapter} (${s.parts} part${s.parts === 1 ? '' : 's'} standing).`, 'district.plots', { fix: `Pick a planned plot, use build continue ${s.chapter} for a follow-up, or undo --group ${s.chapter} first.` })] };
    }
    const group = chapterGroupFailure(plan, ids, 'district.plots'); if (group) return { failures: [group] };
    const plots = ids.map(id => plan.plots.find(x => x.id === id)!), shape = chapterShape(plots);
    const title = raw.title ?? `${plan.title}: ${plots.map(x => x.title ?? x.id).join(', ')}`.slice(0, 80);
    const steps = raw.steps ?? plan.steps ?? (plots.length === 1 ? plots[0].steps : undefined) ?? ['massing', 'buildings', 'details'];
    return { raw: { ...raw, district: { id: plan.id, plots: ids }, title, steps, site: shape.site, massing: shape.massing } };
  }
  /** Compact district section for the chapter's start site report: its plots' road frontage, roads it spans and neighbouring plots. */
  report(b: { id: string; site: Site; district?: BuildBody['district'] }) {
    if (!b.district) return undefined; const row = this.row(b.district.id); if (!row) return undefined;
    const plan = row.body.plan, mine = b.district.plots, states = this.states(plan, this.chapters(row));
    const frontage = mine.flatMap(id => {
      const plot = plan.plots.find(p => p.id === id); if (!plot || !plan.roads?.length) return [];
      // gap: the shortest distance from the plot's rectangle to the road's carriageway (each segment as a box).
      const best = plan.roads.flatMap(r => segments(r).map(([a, z]) => ({ road: r.id, a, z, gap: rectGap(plotSite(plot), segmentBox(a, z, r.width)) }))).sort((x, y) => x.gap - y.gap)[0];
      const at = nearestOnSegment(best.a, best.z, plot.at), dx = at[0] - plot.at[0], dz = at[1] - plot.at[1];
      return [{ plot: id, road: best.road, gap: r1(best.gap), side: Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : (dz > 0 ? 'south' : 'north'), frontYaw: Math.round(Math.atan2(dx, dz) * 1000) / 1000 }];
    });
    const near = obb(b.site, 40), counts = { built: 0, building: 0, planned: 0 };
    for (const p of plan.plots) { const s = states.get(p.id)?.status ?? 'planned'; counts[s === 'undone' ? 'planned' : s]++; }
    const neighbours = plan.plots.filter(p => !mine.includes(p.id) && obbOverlap(obb(plotSite(p)), near)).slice(0, 6).map(p => ({ plot: p.id, status: states.get(p.id)?.status ?? 'planned', ...(states.get(p.id)?.chapter ? { chapter: states.get(p.id)!.chapter } : {}) }));
    const warnings = roadsCrossing(plan, b.site).map(r => `this chapter's site spans road ${r.id}: things placed on that road inside the site join the chapter and close with it`);
    return { id: plan.id, title: plan.title, chapter: b.id, plots: mine.map(id => { const p = plan.plots.find(x => x.id === id); return { id, ...(p?.title ? { title: p.title } : {}), ...(p?.use ? { use: p.use } : {}) }; }), frontage, neighbours, counts: { plots: plan.plots.length, ...counts }, ...(plan.terrain ? { terrain: plan.terrain.slice(0, 140) } : {}), ...(plan.water ? { water: plan.water.slice(0, 140) } : {}), ...(warnings.length ? { warnings } : {}) };
  }
}

const noStore = { 'cache-control': 'no-store' };
export function mountDistrictRoutes(app: Hono, d: { districts: () => GodDistricts; requireGod: (c: Context) => Identity; limitGod: (c: Context, bucket: string, max: number) => void }) {
  app.post('/v1/god/districts', async c => {
    d.limitGod(c, 'districts', DISTRICT_LIMITS.recordsPerMinute); const who = d.requireGod(c);
    let body: unknown; try { body = await c.req.json(); } catch { throw new ApiError(400, 'bad-json', 'body must be JSON'); }
    return c.json(d.districts().record(body, who), 200, noStore);
  });
  app.get('/v1/god/districts', c => { d.requireGod(c); return c.json({ districts: d.districts().list() }, 200, noStore); });
  app.get('/v1/god/districts/:id', c => { d.requireGod(c); const district = d.districts().view(c.req.param('id')); if (!district) throw new ApiError(404, 'not-found', 'unknown district'); return c.json({ ok: true, district }, 200, noStore); });
  app.delete('/v1/god/districts/:id', c => {
    d.limitGod(c, 'districts', DISTRICT_LIMITS.recordsPerMinute); d.requireGod(c);
    const r = d.districts().remove(c.req.param('id')); if (!r) throw new ApiError(404, 'not-found', 'unknown district'); return c.json(r, 200, noStore);
  });
}
/** Chapter responses carry the plan-wide view (without chapter briefs) so a resuming agent sees the district first, at no extra call. */
export const withDistrict = <T extends { ok: boolean; build?: { district?: BuildBody['district'] } }>(districts: GodDistricts, r: T): T & { district?: DistrictView } => {
  const id = r.ok ? r.build?.district?.id : undefined, district = id ? districts.view(id, true) : null;
  return district ? { ...r, district } : r;
};
