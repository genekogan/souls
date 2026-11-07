// EF4: no truncation. Every point is isolated, deterministic and attributed to a def + field.
import { WorldModel, coreLibrary, applyBatch, hashOf, vocab, type StoredDef, type DefLibrary, type Batch } from '@souls/world-compiler';
import { CREATION_LIMITS } from '@souls/generators';
import { assetLookup, shapeFor, measure } from './measure.ts';
export type SweepPoint = { field: string; params: Record<string, unknown>; scale?: number };
export type Finding = { def: string; hash: string; field: string; stage: string; code: string; detail: string };
export function samplePoints(d: StoredDef, k = 2, seed = 'EF4'): SweepPoint[] {
  const points: SweepPoint[] = [{ field: 'defaults', params: {} }];
  let state = parseInt(hashOf([seed, d.ref]).slice(0, 8), 16);
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (const [field, p] of Object.entries(d.params)) {
    if (p.type === 'number' || p.type === 'int') for (const edge of ['min', 'max'] as const) if (p[edge] !== undefined) points.push({ field: `params.${field}.${edge}`, params: { [field]: p[edge] } });
    if (p.type === 'enum') for (const value of p.values) points.push({ field: `params.${field}=${value}`, params: { [field]: value } });
    if (p.type === 'bool') for (const value of [false, true]) points.push({ field: `params.${field}=${value}`, params: { [field]: value } });
  }
  const scale = d.size.scale ?? [1, 1];
  for (const [i, name] of ['min', 'max'].entries()) points.push({ field: `size.scale.${name}`, params: {}, scale: scale[i] });
  for (let i = 0; i < k; i++) {
    const params: Record<string, unknown> = {};
    for (const [field, p] of Object.entries(d.params)) {
      if ((p.type === 'number' || p.type === 'int') && p.min !== undefined && p.max !== undefined) { const v = p.min + random() * (p.max - p.min); params[field] = p.type === 'int' ? Math.floor(v) : v; }
      if (p.type === 'enum') params[field] = p.values[Math.floor(random() * p.values.length)];
      if (p.type === 'bool') params[field] = random() < 0.5;
    }
    points.push({ field: `random[${i}]`, params, scale: scale[0] + random() * (scale[1] - scale[0]) });
  }
  return points;
}
export type RenderCheck = (d: StoredDef, params: Record<string, unknown>, baked: unknown, model: WorldModel, scale: number) => Promise<{ tris: number; draws: number; materials: number } | void> | { tris: number; draws: number; materials: number } | void;
export async function conformance({ defs = coreLibrary().all(), library = coreLibrary(), k = 2, seed = 'EF4', render, onDef }: { defs?: readonly StoredDef[]; library?: DefLibrary; k?: number; seed?: string; render?: RenderCheck; onDef?: (ref: string) => void } = {}) {
  const findings: Finding[] = []; let samples = 0, placed = 0, bakedCount = 0, furnished = 0, rendered = 0;
  const furnishPath = '../../../tools/god-skill/lib/furnish.mjs';
  const { furnishBatch } = await import(furnishPath);
  for (const d of [...defs].sort((a, b) => a.ref.localeCompare(b.ref))) {
    const base = new WorldModel({ constants: { ground: 'land', extent: 16_000 }, seed, assets: assetLookup }); base.library = library;
    const def = base.resolvedDef(d.ref) ?? d, shape = shapeFor(def);
    const defaults = Object.fromEntries(Object.entries(def.params).filter(([, p]) => p.default !== undefined).map(([n, p]) => [n, p.default]));
    for (const point of samplePoints(def, k, seed)) {
      samples++;
      const fail = (stage: string, code: string, detail: unknown) => findings.push({ def: d.ref, hash: d.hash, field: point.field, stage, code, detail: String(detail).slice(0, 500) });
      const model = base.fork(), params = { ...defaults, ...point.params }, scale = point.scale ?? 1;
      // Float fixtures need water sized for this sample, never unrelated real-world state.
      if (def.anchor === 'float') {
        const span = Math.max(50, ...def.size.box) * Math.max(1, scale) * 2;
        const water = applyBatch(model, { ops: [{ op: 'place', def: 'core/pond@1', name: 'water', params: { depth: 3, level: 0 }, shape: { area: [[-span, -span], [span, -span], [span, span], [-span, span]] } }] }, 'sweep', 0);
        if (!water.result.accepted) fail('fixture', 'water', JSON.stringify(water.result.failures));
      }
      let baked;
      try {
        baked = model.bake(def, params as never, 7, shape as never); bakedCount++;
        const cap = Math.min(CREATION_LIMITS.defTris, vocab.triBudget(vocab.categoryOf(def)));
        if (!Number.isFinite(baked.tris) || baked.tris > cap) fail('budget', 'triangles', `${baked.tris} > ${cap}`);
        if (baked.box.some(v => !Number.isFinite(v))) fail('bake', 'nonfinite', baked.box);
      } catch (e) { fail('bake', 'exception', e); }
      try {
        const r = applyBatch(model, { ops: [{ op: 'place', def: d.ref, name: 'sample', seed: 7, ...(shape ? { shape } : {}), ...(scale !== 1 ? { s: scale } : {}), params: point.params }] } as Batch, 'sweep', 1);
        if (!r.result.accepted) for (const f of r.result.failures ?? []) fail('place', f.code, `${f.field ?? ''} ${f.detail}`);
        else {
          placed++;
          if (baked?.rooms?.length) {
            const plan = furnishBatch(model, 'sample');
            const f = plan.ops.length ? applyBatch(model, { ops: plan.ops } as Batch, 'sweep', 2) : { result: { accepted: true, failures: [] } };
            furnished++;
            if (!f.result.accepted) for (const issue of f.result.failures ?? []) fail('furnish', issue.code, `${issue.field ?? ''} ${issue.detail}`);
          }
        }
      } catch (e) { fail('place', 'exception', e); }
      if (render && baked) try {
        const drawn = await render(def, params, baked, model, scale);
        if (drawn) {
          rendered++;
          const cap = vocab.triBudget(vocab.categoryOf(def));
          if (!Number.isFinite(drawn.tris) || drawn.tris > cap) fail('gallery-budget', 'triangles', `${drawn.tris} > ${cap}`);
          const big = /^(building|public|transport|terrain|water)(\.|$)/.test(vocab.categoryOf(def));
          if (!big && drawn.draws > 4) fail('gallery-budget', 'draws', `${drawn.draws} > 4`);
          if (!big && drawn.materials > 4) fail('gallery-budget', 'materials', `${drawn.materials} > 4`);
        }
      } catch (e) { fail('gallery', 'exception', e); }
      else if (def.make.kind === 'gen' && def.make.gen === 'kit/2') {
        try { const m = await measure(def, params, library); if (m.how !== 'kit') fail('gallery', 'unavailable', 'viewer kit builder unavailable'); } catch (e) { fail('gallery', 'exception', e); }
      }
    }
    onDef?.(d.ref);
  }
  return { schema: 'library-conformance/1', seed, k, defs: defs.length, samples, placed, baked: bakedCount, furnished, rendered, findings };
}
