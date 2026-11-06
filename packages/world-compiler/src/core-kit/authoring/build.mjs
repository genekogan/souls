#!/usr/bin/env node
// Writes core-kit/<family>.json from the authoring modules and reports triangle counts
// (kit estimate and the real three.js geometry) against the Eden budgets
// (creature ≤ 600, prop ≤ 400, structures ≤ 6000).
//   node packages/world-compiler/src/core-kit/authoring/build.mjs [--check]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defSchema } from '../../schemas.ts';
import { handlingProblem } from '../../handling.ts';
import { lintDef, triBudget, categoryOf } from '../../vocab/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FAMILIES = ['creatures', 'furniture', 'props', 'plants', 'transport', 'civic', 'play', 'kitchen', 'work', 'signage', 'vocab', 'vocab-2', 'vocab-w1', 'vocab-w2', 'vocab-w3'];
const check = process.argv.includes('--check');

// real triangle counts from the viewer's own kit builder
const { buildKit } = await import('../../../../../apps/web/src/gen-mesh/kit.mesh.ts');
const { MaterialLib } = await import('../../../../../apps/web/src/gen-mesh/materials.ts');
const { kitArgs } = await import('../../../../generators/src/kit.ts');
const lib = new MaterialLib();
function realTris(def) {
  const params = Object.fromEntries(Object.entries(def.params ?? {}).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default]));
  const g = buildKit(kitArgs.parse(def.make.args), { materials: lib, tint: (k, f) => (k && def.palette?.[k]) || f, params, state: {} });
  let tris = 0; g.traverse((o) => { if (o.isMesh) tris += o.geometry.attributes.position.count / 3; });
  return Math.round(tris);
}
const budgetOf = (d) => d.category ? triBudget(categoryOf(d)) : (d.tags.includes('creature') ? 600 : d.tags.includes('structure') || d.tags.includes('ride') || d.tags.includes('large') ? 6000 : d.tags.includes('vehicle') ? 1200 : 400);

let total = 0, over = 0, stale = 0, lintErrors = 0;
const rows = [];
for (const fam of FAMILIES) {
  const file = resolve(here, `${fam}.mjs`);
  if (!existsSync(file)) continue;
  const defs = (await import(file)).default;
  for (const d of defs) {
    const p = defSchema.safeParse(d); if (!p.success) throw new Error(`${d.name}: ${p.error.message}`);
    const h = handlingProblem(p.data); if (h) throw new Error(`${d.name}: ${h.code} ${h.message}`);
    // VOCAB-MECH: catalogue types (those with a category) must pass the induction lint
    if (d.category) { const l = lintDef(d, { tris: d.make.gen === 'kit/2' ? Math.max(realTris(d), d.__tris ?? 0) : 0 }); for (const e of l.errors) console.error(`✖ ${d.name}: ${e}`); for (const w of l.warnings) console.error(`  ${d.name}: ${w}`); lintErrors += l.errors.length; }
    if (d.make.gen !== 'kit/2') { rows.push({ fam, name: d.name, real: 0, est: 0, budget: 0, shapes: 0, roles: 0 }); continue; }
    const real = realTris(d), est = d.__tris, budget = budgetOf(d);
    if (Math.max(real, est) > budget) over++;
    rows.push({ fam, name: d.name, real, est, budget, shapes: d.make.args.shapes.length, roles: [...new Set(d.make.args.shapes.map((s) => s.role).filter(Boolean))].length });
  }
  const out = resolve(here, `../${fam}.json`), json = JSON.stringify(defs) + '\n';
  if (check) { if (!existsSync(out) || readFileSync(out, 'utf8') !== json) { stale++; console.error(`stale: ${fam}.json`); } }
  else writeFileSync(out, json);
  total += defs.length;
}
for (const r of rows) console.log(`${Math.max(r.real, r.est) > r.budget ? '✖' : ' '} ${r.fam.padEnd(9)} ${r.name.padEnd(26)} tris ${String(r.real).padStart(5)} (est ${String(r.est).padStart(5)}) / ${r.budget}  shapes ${r.shapes} roles ${r.roles}`);
console.log(`${total} defs, ${over} over budget, ${lintErrors} lint errors${check ? `, ${stale} stale json` : ''}`);
process.exit(over || stale || lintErrors ? 1 : 0);
