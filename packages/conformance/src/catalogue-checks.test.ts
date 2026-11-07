import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coreLibrary, type StoredDef } from '@souls/world-compiler';
import { budgetCheck, catalogueChecks } from './catalogue-checks.ts';
import { assetMeta, type Measured } from './measure.ts';

const holds = JSON.parse(readFileSync(new URL('./catalogue-holds.json', import.meta.url), 'utf8')).G2 as Record<string, { why: string }>;
const lods = JSON.parse(readFileSync(new URL('../../world-compiler/src/core-mesh-lods.json', import.meta.url), 'utf8')) as Record<string, { lod1: string }>;

test('G2 judges a mesh with lod1 by the triangles drawn past the switch; a big GLB without lod1 fails', () => {
  const d = coreLibrary().get('core-kin-chebel@1')!;   // object class, 600-triangle cap
  const near: Measured = { tris: 29_324, draws: 0, materials: 0, assetBytes: 759_124, textures: 1, texturePx: 1024, how: 'asset-meta' };
  const bare = { ...d, make: { kind: 'mesh', asset: (d.make as { asset: string }).asset, collide: 'box' } } as StoredDef;
  const withLod = { ...bare, make: { ...bare.make, lod1: 'b'.repeat(64) } } as StoredDef;
  const a = budgetCheck(bare, near);
  assert.equal(a.ok, false);
  assert.ok(a.errors.some((e) => /without lod1/.test(e)) && a.errors.some((e) => /^29324 triangles over/.test(e)));
  assert.deepEqual(budgetCheck(withLod, near, { tris: 581, bytes: 102_008 }).errors, []);
  assert.match(budgetCheck(withLod, near, { tris: 1163, bytes: 150_000 }).errors.join(), /1163 triangles \(lod1, past the switch\) over/);
  assert.match(budgetCheck(withLod, near).errors.join(), /lod1 is not a measured asset/);
});

test('every installed lod1 is a measured, smaller asset and its core def carries it', () => {
  const defs = coreLibrary().all().filter((d) => d.make.kind === 'mesh');
  for (const [src, { lod1 }] of Object.entries(lods)) {
    const a = assetMeta(src), b = assetMeta(lod1);
    assert.ok(a && b, `${src.slice(0, 12)}: both measured`);
    assert.ok(b.tris < a.tris, `${src.slice(0, 12)}: lod1 ${b.tris} < near ${a.tris}`);
    const users = defs.filter((d) => (d.make as { asset: string }).asset === src);
    assert.ok(users.length > 0 && users.every((d) => (d.make as { lod1?: string }).lod1 === lod1), `${src.slice(0, 12)}: defs carry lod1`);
  }
});

test('core library: 0 placement (G3) failures; every budget (G2) failure is a recorded hold, and every hold still fails', async () => {
  const rows = await catalogueChecks();
  assert.ok(rows.length > 700, `${rows.length} core defs`);
  assert.deepEqual(rows.filter((r) => !r.g3.ok).map((r) => `${r.ref}: ${r.g3.errors[0]}`), []);
  const g2 = rows.filter((r) => !r.g2.ok).map((r) => r.ref).sort();
  assert.deepEqual(g2.filter((ref) => !holds[ref]).map((ref) => `${ref}: ${rows.find((r) => r.ref === ref)!.g2.errors.join('; ')}`), [], 'new G2 failures (fix them, or hold them with a reason)');
  assert.deepEqual(Object.keys(holds).filter((ref) => !g2.includes(ref)), [], 'holds that now pass: remove them from catalogue-holds.json');
});
