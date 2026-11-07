// R1: private, read-only diagnostics. Estimates are labelled; no resident probes or viewer work run here.
import { obbOverlap, type WorldModel, type Failure } from '@souls/world-compiler';
import { siteLocal, siteWorld, inSite, type BuildBody, type BuildInventory, type BuildInventoryContext } from './builds.ts';
import type { EditRow } from './store.ts';
import { runQuery } from './query.ts';
import { recommend } from './catalog.ts';

const round = (v: number) => Math.round(v * 100) / 100;
const members = (m: WorldModel, roots: string[]) => new Set(roots.flatMap(id => m.entities.has(id) ? m.subtree(id) : []));
const obb = (s: { at: [number, number]; size: [number, number]; yaw?: number }) => ({ c: s.at, half: [s.size[0] / 2, s.size[1] / 2] as [number, number], yaw: s.yaw ?? 0, y0: -1e6, y1: 1e6 });
function geometry(m: WorldModel, id: string) {
  const e = m.entities.get(id)!, d = m.resolvedDef(e.def)!;
  const b = m.bake(d, e.params ?? {}, e.seed ?? 0, e.shape), p = m.worldPose(e);
  const footprints = m.footprint(e, d);
  const bounds = footprints.length ? footprints : [{ c: [p.x, p.z] as [number, number], half: [b.box[0] * p.s / 2, b.box[2] * p.s / 2] as [number, number], yaw: p.yaw, y0: p.y, y1: p.y + b.box[1] * p.s }];
  return { e, d, b, p, bounds };
}
export function siteReport(m: WorldModel, body: Pick<BuildBody, 'title' | 'site' | 'massing' | 'roots'>, inventory: BuildInventory, context?: BuildInventoryContext) {
  const { site } = body, ys: number[] = [];
  for (let x = 0; x <= 16; x++) for (let z = 0; z <= 16; z++) { const p = siteWorld(site, [(x / 16 - .5) * site.size[0], (z / 16 - .5) * site.size[1]]); ys.push(m.terrain.sample(...p)); }
  const near = { ...site, size: [site.size[0] + 40, site.size[1] + 40] as [number, number] }, own = members(m, body.roots);
  const neighbours = [...m.entities.values()].filter(e => e.in.parent === 'world' && !own.has(e.id) && !m.resolvedDef(e.def)?.components.body).map(e => {
    const { b, d, p, bounds } = geometry(m, e.id);
    const height = d.make.kind === 'gen' && d.make.gen.startsWith('building/') ? Number(e.params?.floors ?? d.params.floors?.default ?? 1) * Number(e.params?.floorHeight ?? d.params.floorHeight?.default ?? 3) : b.box[1];
    return { path: m.pathOf(e.id), footprint: bounds.slice(0, 2).map(f => ({ at: f.c.map(round), size: f.half.map(v => round(v * 2)), yaw: round(f.yaw) })), footprintCount: bounds.length, eave: round(height * p.s), eaveSource: d.make.kind === 'gen' && d.make.gen.startsWith('building/') ? 'floors' : 'compiled-height', distance: Math.hypot(p.x - site.at[0], p.z - site.at[1]), bounds };
  }).filter(e => e.bounds.some(f => obbOverlap(f, obb(near)))).sort((a, b) => a.distance - b.distance);
  const heights = neighbours.filter(e => { const entity = m.get(e.path), d = entity && m.resolvedDef(entity.def); return d && (d.make.kind === 'gen' && d.make.gen.startsWith('building/') || !!m.bake(d, entity!.params ?? {}, entity!.seed ?? 0, entity!.shape).rooms?.length); }).map(e => e.eave).filter(v => v > 0).sort((a, b) => a - b), mid = Math.floor(heights.length / 2);
  const median = heights.length ? round(heights.length % 2 ? heights[mid] : (heights[mid - 1] + heights[mid]) / 2) : null, max = heights.at(-1) ?? null;
  const counts = Object.fromEntries(['things', 'seats', 'places', 'owned', 'bodies'].map(k => [k, inventory.counts?.[k as keyof NonNullable<BuildInventory['counts']>] ?? inventory[k as Exclude<keyof BuildInventory, 'counts'>].length]));
  const closure = { ...structuredClone(inventory), counts };
  for (const k of ['things', 'seats', 'places', 'owned', 'bodies'] as const) closure[k] = closure[k].slice(0, 3) as never;
  const approachPlace = context?.places.map(place => ({ name: place.name, at: [place.polygon.reduce((n, p) => n + p[0], 0) / place.polygon.length, place.polygon.reduce((n, p) => n + p[1], 0) / place.polygon.length] as [number, number] })).filter(p => p.at.every(Number.isFinite)).sort((a, b) => Math.hypot(a.at[0] - site.at[0], a.at[1] - site.at[1]) - Math.hypot(b.at[0] - site.at[0], b.at[1] - site.at[1]))[0];
  const report = {
    ground: { min: round(Math.min(...ys)), max: round(Math.max(...ys)), sampled: true, samples: ys.length },
    neighbours: neighbours.slice(0, 6).map(({ bounds: _b, distance: _d, ...e }) => e), neighbourCount: neighbours.length,
    eaves: { median, max },
    masses: body.massing.map((ms, i) => ({ name: ms.name ?? String(i + 1), fits: [-1, 1].every(x => [-1, 1].every(z => inSite({ at: [0, 0], size: site.size, yaw: 0 }, siteWorld({ ...ms, yaw: ms.yaw ?? 0 }, [x * ms.size[0] / 2, z * ms.size[1] / 2])))), medianRatio: median ? round(ms.h / median) : null, maxRatio: max ? round(ms.h / max) : null })),
    closure,
    approach: approachPlace ? { from: approachPlace.name, line: [approachPlace.at.map(round), site.at], to: site.at, checked: false, note: 'Line from the nearest named place; check reach before choosing an entrance.' } : { checked: false, note: 'No named approach is available.' },
    library: recommend(m.allDefs(), body.title, 1).needs.flatMap(n => n.picks).slice(0, 5).map(p => ({ ref: p.ref, category: p.cat })),
    truncated: neighbours.length > 6 || neighbours.some(n => n.bounds.length > 2) || Object.entries(counts).some(([k, count]) => count > closure[k as Exclude<keyof BuildInventory, 'counts'>].length),
  };
  // Keep mandatory ground/mass/count summaries; drop individual rows before crossing 3 KiB, even for Unicode paths.
  while (Buffer.byteLength(JSON.stringify(report)) > 3072) {
    report.truncated = true;
    const key = (['things', 'seats', 'places', 'owned', 'bodies'] as const).find(k => report.closure[k].length);
    if (key) report.closure[key].pop(); else if (report.neighbours.length) report.neighbours.pop(); else if (report.library.length) report.library.pop(); else { report.approach = { checked: false, note: 'Inspect named places for an approach.' }; break; }
  }
  return report;
}
export type BuildReceipt = {
  at: number; seq: number;
  exists: { count: number; roots: string[]; paths: string[] };
  preservation: { outside: { id: string; path: string; included: boolean }[]; count: number };
  undoability: { ok: boolean; edits: number; failed?: number; conflicts: Failure[] };
  massingOutside?: { count: number; paths: string[] };
  massing: { name: string; parts: number; fits: boolean; height: number; plannedHeight: number }[];
  uses: { path: string; behaviours?: unknown; walk?: unknown; error?: string }[];
  viewerCost: { triangles: { added: number | null; world: number; share: number | null }; colliders: { added: number | null; world: number; share: number | null }; draws: { added: null; world: null; share: null }; note: string };
  openAsks: number; refused: { count: number; recent: NonNullable<BuildBody['refusals']> };
  warnings: string[]; truncated?: boolean;
};
function totals(m: WorldModel) {
  let triangles = 0, colliders = 0;
  for (const e of m.entities.values()) { const d = m.resolvedDef(e.def); if (!d) continue; const b = m.bake(d, e.params ?? {}, e.seed ?? 0, e.shape); triangles += b.tris; colliders += b.colliders.length; }
  return { triangles, colliders };
}
export function buildReceipt(m: WorldModel, body: BuildBody, targets: EditRow[], undo: { ok: boolean; failed?: number; failures?: Failure[]; baseline?: WorldModel }, at: number): BuildReceipt {
  const own = members(m, body.roots), made = new Set<string>(), touched = new Set<string>();
  // Inverses distinguish creations from pre-existing edits, including legacy builds predating the covenant.
  for (const row of targets) for (const op of row.inverse) {
    if (op.op === 'remove') made.add(op.id);
    else if ('id' in op) touched.add(m.get(op.id)?.id ?? op.id);
    else if (op.op === 'restore') touched.add(op.entity.id);
    else if (op.op === 'restore-def') for (const x of op.instances ?? []) touched.add(x.entity.id);
  }
  const initial = undo.baseline ? members(undo.baseline, body.initialRoots ?? []) : new Set(body.initialRoots ?? []);
  const originalPaths = new Map<string, string>();
  for (const row of targets) {
    for (const op of row.inverse) if (op.op === 'restore') originalPaths.set(op.entity.id, op.entity.name ?? op.entity.id);
    if (row.ops.length === 1 && row.inverse.length === 1 && 'id' in row.ops[0] && 'id' in row.inverse[0]) originalPaths.set(row.inverse[0].id, row.ops[0].id);
  }
  for (const id of made) if (m.entities.has(id)) for (const child of m.subtree(id)) own.add(child);
  const outside = [...touched].filter(id => !initial.has(id) && !own.has(id) && !made.has(id) && !(body.initialRoots ?? []).includes(id)).map(id => ({ id, path: m.pathOf(id) || undo.baseline?.pathOf(id) || originalPaths.get(id) || id, included: (body.include ?? []).includes(id) }));
  const massing = body.massing.map((ms, i) => {
    const site = { at: siteWorld(body.site, ms.at), size: ms.size, yaw: body.site.yaw + (ms.yaw ?? 0) };
    let parts = 0, height = 0, fits = true;
    for (const id of own) { const { p, bounds } = geometry(m, id); if (!bounds.some(f => obbOverlap(f, obb(site)))) continue; parts++;
      height = Math.max(height, ...bounds.map(f => f.y1 - m.terrain.sample(p.x, p.z)));
      if (bounds.some(f => [-1, 1].some(x => [-1, 1].some(z => !inSite(site, siteWorld({ at: f.c, size: [f.half[0] * 2, f.half[1] * 2], yaw: f.yaw }, [x * f.half[0], z * f.half[1]])))))) fits = false;
    }
    const plannedHeight = ms.h + (ms.roof && ms.roof !== 'flat' ? Math.min(...ms.size) / 2 : 0);
    return { name: ms.name ?? String(i + 1), parts, fits: parts > 0 && fits && height <= plannedHeight + .5, height: round(height), plannedHeight: round(plannedHeight) };
  });
  const volumes = body.massing.map(ms => ({ at: siteWorld(body.site, ms.at), size: ms.size, yaw: body.site.yaw + (ms.yaw ?? 0) }));
  const beyond = volumes.length ? [...own].filter(id => geometry(m, id).bounds.some(f => [-1, 1].some(x => [-1, 1].some(z => !volumes.some(v => inSite(v, siteWorld({ at: f.c, size: [f.half[0] * 2, f.half[1] * 2], yaw: f.yaw }, [x * f.half[0], z * f.half[1]]))))))) : [];
  const current = totals(m), previous = undo.baseline ? totals(undo.baseline) : undefined;
  const metric = (key: keyof typeof current) => ({ added: previous ? current[key] - previous[key] : null, world: current[key], share: previous && current[key] ? round((current[key] - previous[key]) / current[key]) : null });
  const uses = [...own].filter(id => { const d = m.resolvedDef(m.entities.get(id)!.def); return d && (d.components.seat || d.components.container || m.slotsOf(m.entities.get(id)!).length); }).slice(0, 24).map(id => {
    const d = runQuery(m, { describe: id }).describe as { behaviours?: unknown; walk?: unknown; error?: string };
    return { path: m.pathOf(id), behaviours: d.behaviours, walk: d.walk, ...(d.error ? { error: d.error } : {}) };
  });
  const warnings: string[] = [];
  if (outside.length) warnings.push(`${outside.length} pre-existing entities outside the roots changed; inspect preservation.outside.`);
  if (!undo.ok) warnings.push('The inverse chain conflicts; undo would change nothing.');
  if (beyond.length) warnings.push(`${beyond.length} parts extend beyond the declared massing footprints (compiled bounds).`);
  if (massing.some(m => !m.fits)) warnings.push('Some massing volumes are empty or exceeded.');
  if (uses.some(u => (u.walk as { state?: string } | undefined)?.state === 'failed' || u.error)) warnings.push('Some compiled use checks failed; inspect uses.');
  if (body.plan.asks?.length) warnings.push(`${body.plan.asks.length} owner asks remain unverified; compare the private wording with the built result.`);
  warnings.push('Uses are compiled describe checks; no resident walk was run. Draw calls require a viewer measurement.');
  const receipt: BuildReceipt = { at, seq: m.editSeq, exists: { count: own.size, roots: body.roots.filter(id => m.entities.has(id)).map(id => m.pathOf(id)), paths: [...own].slice(0, 32).map(id => m.pathOf(id)) }, preservation: { outside: outside.slice(0, 32), count: outside.length }, undoability: { ok: undo.ok, edits: targets.length, ...(undo.failed !== undefined ? { failed: undo.failed } : {}), conflicts: (undo.failures ?? []).slice(0, 16).map(f => ({ ...f, detail: f.detail.slice(0, 1000), ...(f.fix ? { fix: f.fix.slice(0, 500) } : {}) })) }, massing, ...(beyond.length ? { massingOutside: { count: beyond.length, paths: beyond.slice(0, 32).map(id => m.pathOf(id)) } } : {}), uses, viewerCost: { triangles: metric('triangles'), colliders: metric('colliders'), draws: { added: null, world: null, share: null }, note: 'Triangles are compiler estimates; colliders are compiled counts. Added/share unavailable when inverse preflight conflicts; draw calls are not measured on the server.' }, openAsks: body.plan.asks?.length ?? 0, refused: { count: body.refusalCount ?? 0, recent: body.refusals ?? [] }, warnings };
  while (Buffer.byteLength(JSON.stringify(receipt)) > 10_000) {
    receipt.truncated = true;
    if (receipt.uses.length) receipt.uses.pop(); else if (receipt.exists.paths.length) receipt.exists.paths.pop(); else if (receipt.preservation.outside.length) receipt.preservation.outside.pop(); else if (receipt.refused.recent.length) receipt.refused.recent.pop(); else if (receipt.massingOutside?.paths.length) receipt.massingOutside.paths.pop(); else if (receipt.exists.roots.length) receipt.exists.roots.pop(); else if (receipt.undoability.conflicts.length > 1) receipt.undoability.conflicts.pop(); else break;
  }
  return receipt;
}
