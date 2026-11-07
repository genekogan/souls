// W1: owner-only, world-free kit admission and never-placed trial cleanup.
import type { Context, Hono } from 'hono';
import { batchSchema, correctKitDefines, creationInputFailure, definitionRefs, plan, type StoredDef } from '@souls/world-compiler';
import { CREATION_LIMITS } from '@souls/generators';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError } from '../souls.ts';
import type { GodMode } from './god.ts';
import { definitionUseClosure } from './unused-defs.ts';

export function unusedDefinitions(god: GodMode): StoredDef[] {
  const model = god.model, used = definitionUseClosure(model, [...model.entities.values()].map(e => e.def).concat(god.store.placedDefRefs()));
  for (const d of model.allDefs()) for (const ref of definitionRefs(d)) if (model.def(ref)?.ref !== d.ref) { const resolved = model.def(ref); if (resolved) used.add(resolved.ref); }
  return model.allDefs().filter(d => model.owns(d.ref) && d.by !== 'core' && !model.library?.get(d.ref) && !used.has(d.ref));
}

/** Uses the same compiler plan of a define op as dryrun, on an isolated fork; no sweep, preview or journal. */
export function admitWorkbench(god: GodMode, raw: unknown) {
  const b = raw as { def?: unknown; beside?: unknown } | null;
  const batch = { ops: [{ op: 'define', def: b?.def }] };
  const inputFailure = creationInputFailure(batch);
  if (inputFailure) return { accepted: false as const, failures: [inputFailure] };
  const kit = correctKitDefines(batch); // harvest fix kitlenient: the bench admits what define would
  const parsed = batchSchema.safeParse(kit.batch);
  if (!parsed.success) return { accepted: false as const, failures: parsed.error.issues.map(i => ({ op: 0, code: 'schema', field: i.path.join('.'), detail: i.message })) };
  const model = god.model.fork(), p = plan(model, parsed.data, 'god', god.opts.tick());
  if (!p.ok) return { accepted: false as const, failures: p.failures };
  p.apply();
  const input = parsed.data.ops[0]; if (input.op !== 'define') throw Error('define expected');
  const def = model.def(`${input.def.name}@${input.def.version}`)!;
  const beside = typeof b?.beside === 'string' ? model.resolvedDef(b.beside) : undefined;
  if (b?.beside !== undefined && !beside) return { accepted: false as const, failures: [{ op: -1, code: 'def.unknown', field: 'beside', detail: 'Unknown comparison definition' }] };
  const deps = new Map<string, StoredDef>();
  const add = (d: StoredDef) => { if (deps.has(d.ref)) return; deps.set(d.ref, d); for (const ref of definitionRefs(d)) { const child = model.def(ref); if (child) add(child); } };
  add(def); if (beside) add(beside);
  return { accepted: true as const, def, ...(beside ? { beside } : {}), defs: [...deps.values()], warnings: [...kit.warnings, ...p.warnings], seq: god.model.editSeq };
}

export function mountWorkbenchRoutes(app: Hono, d: { god: GodMode; requireGod(c: Context): unknown; limitGod(c: Context, bucket: string, max: number): void; asGod<T>(c: Context, fn: () => T): T }) {
  const headers = { 'cache-control': 'no-store' };
  app.get('/god/workbench', c => {
    const path = resolve(process.env.WEB_DIR ?? new URL('../../../web/dist/', import.meta.url).pathname, 'workbench.html');
    try { return c.html(readFileSync(path, 'utf8'), 200, headers); } catch { throw new ApiError(404, 'not-found', 'Build the web app to serve the kit workbench'); }
  });
  app.post('/v1/god/kit/render', async c => {
    d.limitGod(c, 'kit-render', CREATION_LIMITS.dryrunsPerMinute);
    const b = await c.req.json().catch(() => null);
    return c.json(admitWorkbench(d.god, b), 200, headers);
  });
  app.get('/v1/god/defs/unused', c => { d.limitGod(c, 'defs-unused', CREATION_LIMITS.godQueriesPerMinute); return c.json({ defs: unusedDefinitions(d.god) }, 200, headers); });
  app.post('/v1/god/defs/unused/remove', async c => {
    d.limitGod(c, 'defs-cleanup', CREATION_LIMITS.actsPerMinute);
    const defs = unusedDefinitions(d.god);
    if (!defs.length) return c.json({ accepted: true, removed: [], seq: d.god.model.editSeq }, 200, headers);
    const selected = defs.slice(0, CREATION_LIMITS.batchOps);
    const result = d.asGod(c, () => d.god.act({ ops: selected.map(d => ({ op: 'undefine', ref: d.ref })), note: 'Remove never-placed trial definitions' }));
    return c.json({ ...result, removed: result.accepted ? selected.map(d => d.ref) : [], remaining: defs.length - selected.length }, 200, headers);
  });
}
