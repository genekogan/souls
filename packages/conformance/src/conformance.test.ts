import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coreLibrary, type StoredDef } from '@sim/world-compiler';
import { samplePoints, type Finding } from './conformance.ts';

test('EF4 seeded points include all endpoints, enums, scales and K combinations without a 48-point cap', () => {
  const d = coreLibrary().get('core-bench@1')!;
  const def = { ...d, size: { ...d.size, scale: [0.5, 2] }, params: { ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, { type: 'number', default: 2, min: 1, max: 3 }])), kind: { type: 'enum', default: 'a', values: ['a', 'b', 'c'] }, n: { type: 'int', default: 2, min: 0, max: 7 } } } as StoredDef;
  const a = samplePoints(def, 2), b = samplePoints(def, 2);
  assert.deepEqual(a, b); assert.equal(a.length, 70); assert.notDeepEqual(a, samplePoints(def, 2, 'other'));
  assert.equal(a.find(p => p.field === 'size.scale.min')?.scale, 0.5); assert.equal(a.find(p => p.field === 'size.scale.max')?.scale, 2);
  assert.ok(a.some(p => p.field === 'params.kind=c')); assert.ok(a.some(p => p.field === 'params.p29.max'));
  for (const p of a.filter(p => p.field.startsWith('random'))) assert.ok(Number.isInteger(p.params.n));
});

test('EF4 small-K gate: every library def places, bakes, furnishes and builds gallery geometry, or has an exact documented finding', { timeout: 180_000 }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'ef4-conformance-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, 'report.json');
  const env = { ...process.env }; delete env.NODE_USE_SYSTEM_CA;
  const result = spawnSync(process.execPath, [new URL('../bin/conformance.mjs', import.meta.url).pathname, '--k', '2', '--out', out, '--report-only'], { encoding: 'utf8', timeout: 170_000, env });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(out, 'utf8')) as { defs: number; samples: number; rendered: number; findings: Finding[]; qualificationGaps: { def: string; kind: string; reason: string }[] };
  assert.equal(report.defs, coreLibrary().all().length); assert.ok(report.samples > report.defs * 3); assert.ok(report.rendered > 0);
  const known = JSON.parse(readFileSync(new URL('../conformance/known-20261015.json', import.meta.url), 'utf8')) as { findings: (Omit<Finding, 'field'> & { fields: string[] })[]; qualificationGaps: typeof report.qualificationGaps };
  // M3: exact pre-E1 findings from B1's expanded parameter samples at the supplied integration head.
  const integration = JSON.parse(readFileSync(new URL('../conformance/integration-3baa4c51.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // Trunk release 3: lane/bugs' new animal (flee) and excavator (digging arm) revisions, reviewed; see the record's note.
  const trunk3 = JSON.parse(readFileSync(new URL('../conformance/trunk-r3-20261016.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // Release 3.2: glass roofs lost their ceiling slab (fewer triangles, still over budget); exact re-pins, see the record's note.
  const trunk32 = JSON.parse(readFileSync(new URL('../conformance/trunk-r32-20261017.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // Tranche 2026-10-19 W2: smoke puffs became atmosphere smoke (one draw fewer in two construction views); see the record's note.
  const w2 = JSON.parse(readFileSync(new URL('../conformance/w2-effects-20261019.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // Tranche 2026-10-20 Z2: lod1 on 145 mesh defs and the placement fixes re-hash defs; building layouts resize; see the record's note.
  const z2 = JSON.parse(readFileSync(new URL('../conformance/z2-catalogue-20261020.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // Tranche 2026-10-21 BSGEN: apartment block plan.landing and three furnished defs' contents re-hash defs; exact re-pins.
  const bsgen = JSON.parse(readFileSync(new URL('../conformance/bsgen-20261021.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // Tranche 2026-10-22 SEATDEF: seat heights from the model geometry re-hash six defs with documented tuples; exact re-pins.
  const seatdef = JSON.parse(readFileSync(new URL('../conformance/seatdef-20261022.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // 2026-10-28: chair-free immutable office-desk@2 retains the documented construction draw overrun.
  const officeDesk = JSON.parse(readFileSync(new URL('../conformance/office-desk-20261028.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // Public cutover 2026-11-01: Soul Actions 1-44 defs over their gallery budgets, pinned to their exact revision hashes.
  const soulActions = JSON.parse(readFileSync(new URL('../conformance/soul-actions-20261101.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  const signature = (f: Finding) => JSON.stringify([f.def, f.hash, f.field, f.stage, f.code, f.detail]);
  const allowed = new Set([...known.findings, ...integration.findings, ...trunk3.findings, ...trunk32.findings, ...w2.findings, ...z2.findings, ...bsgen.findings, ...seatdef.findings, ...officeDesk.findings, ...soulActions.findings].flatMap(f => f.fields.map(field => signature({ ...f, field }))));
  const newFindings = report.findings.filter(f => !allowed.has(signature(f)));
  assert.deepEqual(newFindings, [], `Undocumented conformance failures: ${JSON.stringify(newFindings.slice(0, 12))}`);
  assert.deepEqual(report.qualificationGaps, known.qualificationGaps, 'rendering gaps changed: qualify them or document the exact gap');
  t.diagnostic(`${report.defs} defs, ${report.samples} samples, ${report.rendered} gallery geometries; ${report.findings.length} exact documented findings, ${report.qualificationGaps.length} explicit GPU/nonvisual gaps`);
});
