// Z2 (2026-10-20): the catalogue's G2 (budgets) and G3 (placement) checks, ported from the archived @sim/catalog gates.ts
// (33242b515^, removed with the catalogue on Oct 15) to plain core defs. Same rules and numbers, with one stated change:
//   G2 budgets    tris per class; draws <= 4 and materials <= 4 below building class (kit defs); def <= 16 KB; a GLB over
//                 2 MB or 5k tris must carry a distant version (make.lod1). CHANGE: a mesh with lod1 is judged by the
//                 triangles drawn past the switch distance (lod1's), because the original stays the near model
//                 (apps/web/src/gen-mesh/mesh-lod.ts). The old gate judged the near model.
//   G3 placement  placed in a fresh world at the defaults, at min and max of every ranged param and at every enum value;
//                 bakes; an enterable thing is walls, not one solid block; a free-standing kit def is not below the floor or
//                 floating (anchor base, no hang slot). Approach and bounds-size findings stay warnings, as before.
// Run over the whole core library: node packages/conformance/bin/catalogue-checks.mjs [--out report.json]
import { WorldModel, applyBatch, coreLibrary, stableStringify, vocab, type StoredDef, type DefLibrary } from '@souls/world-compiler';
import { assetLookup, assetMeta, measure, shapeFor, type Measured } from './measure.ts';

export const CLASS_LIMITS = { drawsBelowBuilding: 4, materials: 4, defBytes: 16_384, glbBytes: 2_000_000, lod1AboveTris: 5_000 } as const;
const BIG = ['building', 'public', 'transport', 'terrain', 'water'];
/** Categories exempt from the per-item draw/material cap (whole buildings, roads, landforms). */
export const bigClass = (cat: string) => BIG.some((c) => cat === c || cat.startsWith(c + '.'));

export type CheckOutcome = { check: 'G2' | 'G3'; ok: boolean; errors: string[]; warnings: string[]; numbers: Record<string, number> };

/** The def's size in bytes, without the compiler-filled fields (hash, budget). */
function defBytes(d: StoredDef): number {
  const { hash: _h, budget: _b, ...rest } = d as StoredDef & { budget?: unknown };
  return Buffer.byteLength(stableStringify(rest));
}

/** G2. `lod1` = the measured distant version, when the def has one (make.lod1). */
export function budgetCheck(d: StoredDef, m: Measured, lod1?: { tris: number; bytes: number }): CheckOutcome {
  const errors: string[] = [], warnings: string[] = [];
  const cat = vocab.categoryOf(d as never), triCap = vocab.triBudget(cat), L = CLASS_LIMITS;
  const mesh = d.make.kind === 'mesh', hasLod1 = mesh && !!(d.make as { lod1?: string }).lod1;
  if (hasLod1 && !lod1) errors.push('lod1 is not a measured asset');
  const drawn = hasLod1 && lod1 ? lod1.tris : m.tris;
  if (drawn > triCap) errors.push(`${drawn} triangles${hasLod1 ? ' (lod1, past the switch)' : ''} over the ${cat} budget ${triCap}`);
  if (!bigClass(cat) && m.how === 'kit' && m.draws > L.drawsBelowBuilding) errors.push(`${m.draws} draws > ${L.drawsBelowBuilding} below building class`);
  if (!bigClass(cat) && m.how === 'kit' && m.materials > L.materials) errors.push(`${m.materials} materials > ${L.materials}`);
  const bytes = defBytes(d);
  if (bytes > L.defBytes) errors.push(`def ${bytes} B > ${L.defBytes} B`);
  if (m.assetBytes > L.glbBytes && !hasLod1) errors.push(`GLB ${(m.assetBytes / 1e6).toFixed(1)} MB > ${(L.glbBytes / 1e6).toFixed(0)} MB without lod1`);
  if (mesh && m.tris > L.lod1AboveTris && !hasLod1) errors.push(`GLB ${m.tris} tris > ${L.lod1AboveTris} without lod1`);
  if (m.how === 'estimate') warnings.push('triangles are the bake estimate (no measured mesh)');
  return { check: 'G2', ok: errors.length === 0, errors, warnings, numbers: { tris: m.tris, drawnFar: drawn, triCap, draws: m.draws, materials: m.materials, defBytes: bytes, assetBytes: m.assetBytes } };
}

/** The parameter points G3 places: defaults, then min and max of each ranged param, then each enum value (max 48). */
export function sweep(d: Pick<StoredDef, 'params'>): { label: string; params: Record<string, unknown> }[] {
  const out: { label: string; params: Record<string, unknown> }[] = [{ label: 'default', params: {} }];
  for (const [k, p] of Object.entries(d.params)) {
    if (p.type === 'number' || p.type === 'int') { if (p.min !== undefined && p.min !== p.default) out.push({ label: `${k}=min`, params: { [k]: p.min } }); if (p.max !== undefined && p.max !== p.default) out.push({ label: `${k}=max`, params: { [k]: p.max } }); }
    if (p.type === 'enum') for (const v of p.values) if (v !== p.default) out.push({ label: `${k}=${v}`, params: { [k]: v } });
  }
  return out.slice(0, 48);
}

function world(library: DefLibrary): WorldModel { const w = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'g3', assets: assetLookup }); w.library = library; return w; }

/** G3. `m` = the def's measured drawing (bounds); measured here when not given. */
export async function placementCheck(d: StoredDef, library: DefLibrary = coreLibrary(), m?: Measured): Promise<CheckOutcome> {
  const errors: string[] = [], warnings: string[] = [];
  const w = world(library);
  const r = w.resolvedDef(d.ref) ?? d, ref = d.ref;
  // things that float (boats, buoys) are tested on water: a pond under the origin first
  if (r.anchor === 'float') { const span = Math.max(15, Math.max(r.size.box[0], r.size.box[2]) * 2); const p = applyBatch(w, { ops: [{ op: 'place', def: 'core/pond@1', name: 'g3-water', p: [0, 0, 0], params: { depth: 3 }, shape: { area: [[-span, -span], [span, -span], [span, span], [-span, span]] } }] } as never, 'catalog', 0); if (!p.result.accepted) warnings.push(`test water refused: ${p.result.failures?.[0]?.code}`); }
  let placed = 0, tried = 0;
  const shape = r.form === 'point' ? undefined : shapeFor(r);
  for (const pt of sweep(d)) {   // the def's own params, as the old gate swept def/2 (not inherited/convention ones)
    tried++;
    const res = applyBatch(w.fork(), { ops: [{ op: 'place', def: ref, name: 'it', p: [0, 0, 0], ...(Object.keys(pt.params).length ? { params: pt.params } : {}), ...(shape ? { shape } : {}) }] } as never, 'catalog', 1);
    if (res.result.accepted) placed++;
    else errors.push(`place ${pt.label}: ${res.result.failures?.[0]?.code} ${String(res.result.failures?.[0]?.detail ?? '').slice(0, 120)}`);
  }
  // physics of the default bake
  let baked; try { baked = w.bake(r, Object.fromEntries(Object.entries(r.params).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default!])) as never, 0, shape as never); } catch (e) { errors.push(`bake: ${String(e).slice(0, 160)}`); }
  const box = r.size.box;
  if (baked && r.form === 'point') {
    const slotKinds = new Set(r.slots.map((x) => x.kind));
    const enterable = slotKinds.has('room') || slotKinds.has('door') || (baked.rooms?.length ?? 0) > 0;
    const solid = baked.colliders.filter((c) => !c.tag || !/^(floor|roof|deck)/.test(c.tag));
    if (enterable && solid.length === 1) { const c = solid[0], a = 4 * c.half[0] * c.half[1]; if (a >= 0.8 * box[0] * box[2] && c.y1 - c.y0 >= 0.8 * box[1]) errors.push('enterable but one solid block (walls expected)'); }
    // approach points: 0.6 m in front of each seat/bed/stand slot, outside every collider of the thing itself
    for (const sl of r.slots.filter((x) => x.kind === 'seat' || x.kind === 'bed' || x.kind === 'stand')) {
      const fx = sl.p[0] + Math.sin(sl.yaw) * 0.6, fz = sl.p[2] + Math.cos(sl.yaw) * 0.6;
      const inside = baked.colliders.some((c) => { const dx = fx - c.c[0], dz = fz - c.c[1], co = Math.cos(c.yaw), si = Math.sin(c.yaw); const lx = dx * co - dz * si, lz = dx * si + dz * co; return Math.abs(lx) < c.half[0] && Math.abs(lz) < c.half[1] && c.y0 < 1.0 && c.y1 > 0.1; });
      if (inside) warnings.push(`approach: slot ${sl.id} (${sl.kind}) has no free standing point in front`);
    }
  }
  // drawn bounds (kit: the viewer's own geometry; mesh: the measured GLB) against the declared box and the floor
  if (r.form === 'point') m ??= await measure(d, undefined, library);
  if (m?.box && r.form === 'point') {
    const [x0, y0, z0] = m.box.min, [x1, y1, z1] = m.box.max, tol = 0.12;
    const w0 = x1 - x0, h0 = y1 - y0, d0 = z1 - z0;
    if (m.how === 'kit') {
      if (w0 > box[0] * (1 + tol) + 0.05 || h0 > box[1] * (1 + tol) + 0.05 || d0 > box[2] * (1 + tol) + 0.05) warnings.push(`bounds ${[w0, h0, d0].map((v) => v.toFixed(2)).join('×')} exceed the declared box ${box.join('×')}`);
      // the floor rules apply to free-standing things on a base anchor; mounted parts (component.*: roofs, awnings),
      // ground-hugging anchors (conform, drape) and ground works (terrain, water, pitches, layers) set into the ground
      const cat = vocab.categoryOf(r as never), freeStanding = r.anchor === 'base' && !/^(component|terrain|water|layer|public\.(pitch|park))/.test(cat);
      if (freeStanding && y0 < -0.02) errors.push(`${(-y0).toFixed(2)} m below the floor`);
      if (freeStanding && y0 > 0.05 && !r.slots.some((x) => x.kind === 'hang')) errors.push(`floating ${y0.toFixed(2)} m above the floor (anchor base)`);
    } else if (r.make.kind === 'mesh' && h0 > 0) {
      const scale = box[1] / h0;
      if (y0 * scale < -0.02 && r.anchor === 'base') warnings.push(`GLB origin ${(y0 * scale).toFixed(2)} m below its base`);
    }
  }
  return { check: 'G3', ok: errors.length === 0, errors, warnings, numbers: { placements: tried, placed, colliders: baked?.colliders.length ?? 0 } };
}

export type CatalogueRow = { ref: string; category: string; how: Measured['how']; g2: CheckOutcome; g3: CheckOutcome };

/** G2 and G3 over every def (default: the whole core library), in ref order. */
export async function catalogueChecks({ defs, library = coreLibrary(), onDef }: { defs?: readonly StoredDef[]; library?: DefLibrary; onDef?: (ref: string) => void } = {}): Promise<CatalogueRow[]> {
  const rows: CatalogueRow[] = [];
  for (const d of [...(defs ?? library.all())].sort((a, b) => a.ref.localeCompare(b.ref))) {
    onDef?.(d.ref);
    const m = await measure(d, undefined, library);
    const lod1Sha = d.make.kind === 'mesh' ? (d.make as { lod1?: string }).lod1 : undefined, lm = lod1Sha ? assetMeta(lod1Sha) : undefined;
    rows.push({ ref: d.ref, category: vocab.categoryOf(d as never), how: m.how, g2: budgetCheck(d, m, lm ? { tris: lm.tris, bytes: lm.bytes } : undefined), g3: await placementCheck(d, library, m) });
  }
  return rows;
}
