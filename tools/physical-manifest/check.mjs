// PC01 (#680): keeps docs/design/physical-coordination-manifest.json honest against the tree it is pinned to.
// The check makes sure that:
// - every Lab selector id (and each listed special route) is covered exactly once;
// - every source path exists;
// - every named native catalog id and library def exists;
// - every row names a PC issue or an out-of-scope reason;
// - an unresolved row is never presented as qualified.
// Usage: node tools/physical-manifest/check.mjs [manifest.json]
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const MANIFEST = join(ROOT, 'docs/design/physical-coordination-manifest.json');

/** The tree's facts the manifest is checked against. */
export async function treeFacts(root = ROOT) {
  const lab = await import(pathToFileURL(join(root, 'mars/viewer/app/lab/scenarios.ts')).href);
  const {CATALOG} = await import(pathToFileURL(join(root, 'mars/viewer/engine/world/catalog.ts')).href);
  const kit = join(root, 'packages/world-compiler/src/core-kit');
  const library = new Set();
  for (const f of readdirSync(kit).filter((f) => f.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(kit, f), 'utf8'));
    for (const d of Array.isArray(j) ? j : []) if (d && typeof d.name === 'string') library.add(d.name);
  }
  return {
    selector: lab.SELECTABLE_SCENARIOS.map((s) => s.name),
    route: (name) => lab.scenarioByName(name)?.name ?? null,
    native: new Set(Object.keys(CATALOG)),
    library,
    exists: (p) => existsSync(join(root, p)),
  };
}

const ISSUE = /^#\d+$/;

/** Returns a list of problems; empty means the manifest agrees with the tree. */
export function check(manifest, facts) {
  const errors = [], pcs = new Set(Object.values(manifest.pcs ?? {}));
  const seen = new Map();
  const rowName = (r) => r.id ?? r.need ?? (r.ids ?? []).join(',');
  const rows = [...(manifest.lab ?? []), ...(manifest.specialRoutes ?? []), ...(manifest.native ?? []), ...(manifest.server ?? [])];
  for (const r of manifest.lab ?? []) for (const id of r.ids ?? []) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const id of facts.selector) if (!seen.has(id)) errors.push(`selector id ${id} has no manifest row`);
  for (const [id, n] of seen) {
    if (!facts.selector.includes(id)) errors.push(`manifest lab id ${id} is not in SELECTABLE_SCENARIOS`);
    if (n > 1) errors.push(`selector id ${id} is listed ${n} times`);
  }
  for (const r of manifest.specialRoutes ?? []) {
    if (facts.selector.includes(r.id)) errors.push(`special route ${r.id} is selectable; list it under lab`);
    if (facts.route(r.id) !== r.id) errors.push(`special route ${r.id} does not resolve through scenarioByName`);
  }
  for (const r of rows) {
    const name = rowName(r);
    if (!Object.hasOwn(manifest.classes ?? {}, r.class)) errors.push(`${name}: unknown class ${r.class}`);
    if (!r.source?.length) errors.push(`${name}: no source`);
    for (const p of r.source ?? []) if (!facts.exists(p)) errors.push(`${name}: source ${p} does not exist`);
    for (const e of r.evidence ?? []) {
      const path = e.split(' ')[0];
      if (/^(apps|mars|packages|tools|docs)\//.test(path) && !facts.exists(path)) errors.push(`${name}: evidence ${path} does not exist`);
    }
    if (!r.evidence?.length) errors.push(`${name}: no evidence (write "none: ..." when there is none)`);
    for (const id of r.native ?? []) if (!facts.native.has(id)) errors.push(`${name}: native catalog id ${id} does not exist`);
  }
  for (const r of [...rows, ...(manifest.assets ?? [])]) {
    const name = rowName(r);
    if (r.pc === undefined && !r.outOfScope) errors.push(`${name}: names neither a PC issue nor an out-of-scope reason`);
    if (r.pc !== undefined && (!ISSUE.test(r.pc) || !pcs.has(r.pc))) errors.push(`${name}: ${r.pc} is not a PC issue`);
    if (r.status === 'unresolved' && (r.evidence ?? []).some((e) => /\bqualified\b/i.test(e))) errors.push(`${name}: unresolved but its evidence claims qualified`);
  }
  for (const a of manifest.assets ?? []) {
    for (const id of a.native ?? []) if (!facts.native.has(id)) errors.push(`asset ${a.need}: native catalog id ${id} does not exist`);
    for (const id of a.library ?? []) if (!facts.library.has(id)) errors.push(`asset ${a.need}: library def ${id} does not exist`);
    if (!['missing', 'adapt', 'exists'].includes(a.status)) errors.push(`asset ${a.need}: status must be missing, adapt or exists`);
  }
  for (const m of manifest.provenance?.missingSource ?? []) for (const b of m.blocks ?? []) if (!pcs.has(b)) errors.push(`missing source ${m.ref}: ${b} is not a PC issue`);
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(process.argv[2] ?? MANIFEST, 'utf8'));
  const errors = check(manifest, await treeFacts());
  for (const e of errors) console.error(e);
  const lab = (manifest.lab ?? []).reduce((n, r) => n + r.ids.length, 0);
  console.log(errors.length ? `${errors.length} problem(s)` : `ok: ${lab} selector ids, ${(manifest.specialRoutes ?? []).length} special route(s), ${(manifest.native ?? []).length} native, ${(manifest.server ?? []).length} server rows, ${(manifest.assets ?? []).length} asset needs`);
  process.exitCode = errors.length ? 1 : 0;
}
