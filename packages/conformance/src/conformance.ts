// EF4: no truncation. Every point is isolated, deterministic and attributed to a def + field.
import { WorldModel, coreLibrary, applyBatch, hashOf, vocab, type StoredDef, type DefLibrary, type Batch } from '@sim/world-compiler';
import { CREATION_LIMITS } from '@sim/generators';
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
/** The cartesian product of declared state values is measured up to this many assignments; above it, one field at a time. */
export const STATE_PRODUCT_CAP = 64;
/** Declared entity-state assignments the gallery also measures (the stateless build is measured separately): bools both
 *  ways, enums every value, numbers at default/min/max and either side of each threshold a `when: "@field op N"` term
 *  tests; strings and colours (content, not switches) at their default, plus a non-empty value when a `when` term
 *  tests them. Deterministic; the full product up to STATE_PRODUCT_CAP, else each field varied alone from the defaults. */
export function stateVariants(d: StoredDef): Record<string, unknown>[] {
  const fields = Object.entries((d as { state?: Record<string, { type: string; default?: unknown; values?: unknown[]; min?: number; max?: number }> }).state ?? {});
  if (!fields.length) return [];
  const make = JSON.stringify(d.make), terms = [...make.matchAll(/@([A-Za-z][\w-]*)\s*(!=|=|>=|<=|>|<)?\s*([^&"\\]*)/g)];
  const candidates = fields.map(([name, f]) => {
    const tested = terms.filter(m => m[1] === name), out: unknown[] = [];
    const add = (v: unknown) => { if (v !== undefined && !out.some(o => JSON.stringify(o) === JSON.stringify(v))) out.push(v); };
    add(f.default);
    if (f.type === 'bool') { add(false); add(true); }
    else if (f.type === 'enum') for (const v of f.values ?? []) add(v);
    else if (f.type === 'number' || f.type === 'int') {
      add(f.min); add(f.max);
      const step = f.type === 'int' ? 1 : 1e-3;
      for (const [, , op, rhs] of tested) { const n = Number(rhs.trim()); if (op && op !== '=' && op !== '!=' && Number.isFinite(n)) { add(n); add(op === '>' || op === '<=' ? +(n + step).toFixed(6) : +(n - step).toFixed(6)); } }
    } else if (tested.length) {
      for (const [, , op, rhs] of tested) if (op === '=' || op === '!=') for (const v of rhs.split('|')) add(v.trim());
      if (!out.some(v => typeof v === 'string' && v !== '' && v !== 'none')) add('sample');
    }
    return [name, out] as const;
  });
  const defaults = Object.fromEntries(candidates.map(([n, vs]) => [n, vs[0]]));
  const product = candidates.reduce((n, [, vs]) => n * Math.max(1, vs.length), 1);
  const seen = new Set<string>(), variants: Record<string, unknown>[] = [];
  const push = (v: Record<string, unknown>) => { const key = JSON.stringify(v); if (!seen.has(key)) { seen.add(key); variants.push(v); } };
  if (product <= STATE_PRODUCT_CAP) {
    let combos: Record<string, unknown>[] = [{}];
    for (const [name, vs] of candidates) combos = combos.flatMap(c => (vs.length ? vs : [undefined]).map(v => (v === undefined ? c : { ...c, [name]: v })));
    combos.forEach(push);
  } else { push(defaults); for (const [name, vs] of candidates) for (const v of vs) push({ ...defaults, [name]: v }); }
  return variants;
}
export type RenderCheck = (d: StoredDef, params: Record<string, unknown>, baked: unknown, model: WorldModel, scale: number, state?: Record<string, unknown>) => Promise<{ tris: number; draws: number; materials: number } | void> | { tris: number; draws: number; materials: number } | void;
export async function conformance({ defs = coreLibrary().all(), library = coreLibrary(), k = 2, seed = 'EF4', render, onDef }: { defs?: readonly StoredDef[]; library?: DefLibrary; k?: number; seed?: string; render?: RenderCheck; onDef?: (ref: string) => void } = {}) {
  const findings: Finding[] = []; let samples = 0, placed = 0, bakedCount = 0, furnished = 0, rendered = 0, stateRendered = 0;
  const furnishPath = '../../../tools/god-skill/lib/furnish.mjs';
  const { furnishBatch } = await import(furnishPath);
  for (const d of [...defs].sort((a, b) => a.ref.localeCompare(b.ref))) {
    const base = new WorldModel({ constants: { ground: 'land', extent: 16_000 }, seed, assets: assetLookup }); base.library = library;
    const def = base.resolvedDef(d.ref) ?? d, shape = shapeFor(def);
    const defaults = Object.fromEntries(Object.entries(def.params).filter(([, p]) => p.default !== undefined).map(([n, p]) => [n, p.default]));
    const states = render ? stateVariants(def) : [];
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
          // #973: `when: "@state"` geometry is absent from the stateless build. Measure every declared state; report, per
          // budget, the worst assignment that is over it and worse than the stateless build (whose findings stand as before).
          const limits = { triangles: [cap, 'tris'], draws: [big ? Infinity : 4, 'draws'], materials: [big ? Infinity : 4, 'materials'] } as const;
          const worst: Partial<Record<keyof typeof limits, { value: number; state: Record<string, unknown> }>> = {};
          for (const state of states) {
            const m = await render(def, params, baked, model, scale, state); if (!m) continue;
            stateRendered++;
            for (const [code, [limit, key]] of Object.entries(limits) as [keyof typeof limits, readonly [number, 'tris' | 'draws' | 'materials']][]) {
              const v = m[key];
              if ((!Number.isFinite(v) || v > limit) && !(v <= drawn[key]) && !(v <= (worst[code]?.value ?? -Infinity))) worst[code] = { value: v, state };
            }
          }
          for (const [code, w] of Object.entries(worst)) if (w) fail('gallery-state-budget', code, `${w.value} > ${limits[code as keyof typeof limits][0]} @${JSON.stringify(w.state)}`);
        }
      } catch (e) { fail('gallery', 'exception', e); }
      else if (def.make.kind === 'gen' && def.make.gen === 'kit/2') {
        try { const m = await measure(def, params, library); if (m.how !== 'kit') fail('gallery', 'unavailable', 'viewer kit builder unavailable'); } catch (e) { fail('gallery', 'exception', e); }
      }
    }
    onDef?.(d.ref);
  }
  return { schema: 'library-conformance/1', seed, k, defs: defs.length, samples, placed, baked: bakedCount, furnished, rendered, stateRendered, findings };
}
