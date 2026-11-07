import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coreLibrary, type StoredDef } from '@souls/world-compiler';
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
  // PC03 2026-11-04: loose construction materials; the narrow run found nothing, so this pins no finding.
  const looseMaterials = JSON.parse(readFileSync(new URL('../conformance/loose-materials-20261104.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // PC11 2026-11-05: the table-shaped load core-work-table@1; the narrow run found nothing, so this pins no finding.
  const workTable = JSON.parse(readFileSync(new URL('../conformance/work-table-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // 2026-11-05 library budgets (#494): the music family's new in-budget revisions; nothing left to pin (see the record's note).
  const budgetsMusic = JSON.parse(readFileSync(new URL('../conformance/library-budgets-music-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // #427 2026-11-05: core-tent@2 and core-field-gate@1 opened by hand; the narrow run found nothing, so this pins no finding.
  const openings = JSON.parse(readFileSync(new URL('../conformance/openings-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // 2026-11-05 music family (#431): the new record player; the narrow run found nothing, so this pins no finding.
  const recordPlayer = JSON.parse(readFileSync(new URL('../conformance/record-player-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // #430 2026-11-05: core-chalk-square@1 on the painting faculty; the narrow run found nothing, so this pins no finding.
  const chalk = JSON.parse(readFileSync(new URL('../conformance/chalk-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // #435 2026-11-05: core-swap-shelf@1 on the container faculty (no door, a leftBy record); the narrow run found nothing, so this pins no finding.
  const swapShelf = JSON.parse(readFileSync(new URL('../conformance/swap-shelf-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // #435 2026-11-05: core-pantry@1, core-apple@1 and core-bun@1; the narrow run found nothing, so this pins no finding.
  const pantry = JSON.parse(readFileSync(new URL('../conformance/pantry-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // #429 2026-11-05: core-guestbook@1 on the sign-up faculty; the narrow run found nothing, so this pins no finding.
  const guestbook = JSON.parse(readFileSync(new URL('../conformance/guestbook-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // #435 2026-11-05: core-lost-and-found@1, the swap shelf's form with an owner claim; the narrow run found nothing, so this pins no finding.
  const lostAndFound = JSON.parse(readFileSync(new URL('../conformance/lost-and-found-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // #442 2026-11-05: repairable bench and cart revisions and their tools; the narrow runs found nothing, so this pins no finding.
  const repairDefs = JSON.parse(readFileSync(new URL('../conformance/repair-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // #435 2026-11-05: core-hollow-stump@1 and core-wall-niche@1, hiding places (a doorless container with `hidden: true`); the narrow run found nothing, so this pins no finding.
  const hidingPlaces = JSON.parse(readFileSync(new URL('../conformance/hiding-places-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // #1088 2026-11-06: core-bin@2, core-wheelie-bin@2 (open bins on the container faculty) and core-wrapper@1; the narrow run found nothing, so this pins no finding.
  const litter = JSON.parse(readFileSync(new URL('../conformance/litter-20261106.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // PC12 2026-11-05: the loose upright and beam with structural connectors; the narrow runs found nothing, so this pins no finding.
  const joints = JSON.parse(readFileSync(new URL('../conformance/joints-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // PC15 2026-11-06: the step beam, deck joist and plywood sheet with deck connectors; the narrow runs found nothing, so this pins no finding.
  const deck = JSON.parse(readFileSync(new URL('../conformance/deck-20261106.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // PC16 2026-11-06: the stair flight, tread and step beam that takes a stair hook; the narrow runs found nothing, so this pins no finding.
  const stairs = JSON.parse(readFileSync(new URL('../conformance/stairs-20261106.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // 2026-11-05 library budgets (#494): the water and garden family's new in-budget revisions; nothing left to pin.
  const budgetsWater = JSON.parse(readFileSync(new URL('../conformance/library-budgets-water-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  // 2026-11-05 library budgets (#494): openings, drawers and bell; bell@3 keeps only its construction-view overruns.
  const budgetsOpenings = JSON.parse(readFileSync(new URL('../conformance/library-budgets-openings-20261105.json', import.meta.url), 'utf8')) as Pick<typeof known, 'findings'>;
  const signature = (f: Finding) => JSON.stringify([f.def, f.hash, f.field, f.stage, f.code, f.detail]);
  const allowed = new Set([...known.findings, ...integration.findings, ...trunk3.findings, ...trunk32.findings, ...w2.findings, ...z2.findings, ...bsgen.findings, ...seatdef.findings, ...officeDesk.findings, ...soulActions.findings, ...looseMaterials.findings, ...budgetsMusic.findings, ...budgetsWater.findings, ...budgetsOpenings.findings, ...recordPlayer.findings, ...chalk.findings, ...guestbook.findings, ...lostAndFound.findings, ...swapShelf.findings, ...repairDefs.findings, ...openings.findings, ...hidingPlaces.findings, ...pantry.findings, ...workTable.findings, ...litter.findings, ...joints.findings, ...deck.findings, ...stairs.findings].flatMap(f => f.fields.map(field => signature({ ...f, field }))));
  const newFindings = report.findings.filter(f => !allowed.has(signature(f)));
  assert.deepEqual(newFindings, [], `Undocumented conformance failures: ${JSON.stringify(newFindings.slice(0, 12))}`);
  assert.deepEqual(report.qualificationGaps, known.qualificationGaps, 'rendering gaps changed: qualify them or document the exact gap');
  t.diagnostic(`${report.defs} defs, ${report.samples} samples, ${report.rendered} gallery geometries; ${report.findings.length} exact documented findings, ${report.qualificationGaps.length} explicit GPU/nonvisual gaps`);
});
