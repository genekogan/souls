// The core library (L4): every family def parses, has a description and tags, stays in budget,
// creatures carry the roles their gait needs, and every point def places in a world.
//   node --test packages/world-compiler/src/core-kit/library.test.ts
import { triBudget } from '../vocab/index.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kitArgs, kitPhysics } from '@souls/generators';
import { CORE_KIT, WorldModel, applyBatch, defSchema, type Refused } from '../index.ts';
import { FAMILY_KITS } from './index.ts';
import { readFileSync } from 'node:fs';

// Over-budget kit defs held on purpose, with the measured count and the reason (budget-holds.json, next to this test).
const HOLDS = JSON.parse(readFileSync(new URL('./budget-holds.json', import.meta.url), 'utf8')).holds as Record<string, { tris: number; why: string }>;

const kit = FAMILY_KITS.filter((d) => d.make.kind === 'gen' && d.make.gen === 'kit/2');

test('family defs parse, are unique, described, tagged, and within the Eden budgets', () => {
  const identities = new Set<string>();
  for (const d of kit) {
    const def = defSchema.parse(d);
    const identity = `${def.name}@${def.version}`;
    assert.ok(!identities.has(identity), `duplicate ${identity}`); identities.add(identity);
    assert.ok(def.description.length > 20, `${def.name}: one-line description`);
    assert.ok(def.tags.length >= 2, `${def.name}: tags`);
    const tris = kitPhysics(kitArgs.parse((def.make as { args: unknown }).args)).tris;
    // VOCAB-MECH: catalogue types are budgeted by their category (vocab.triBudget)
    const budget = def.category ? triBudget(def.category) : def.tags.includes('creature') ? 600 : def.tags.includes('structure') || def.tags.includes('ride') || def.tags.includes('large') ? 6000 : def.tags.includes('vehicle') ? 1200 : 400;
    const hold = HOLDS[identity];
    if (hold) {
      assert.ok(tris > budget, `${identity}: held but within budget (${tris} <= ${budget}); remove its hold`);
      assert.ok(tris <= hold.tris, `${identity}: ${tris} tris > its recorded hold ${hold.tris}`);
    } else assert.ok(tris <= budget, `${def.name}: ${tris} tris > ${budget} (fix it, or hold it in budget-holds.json with a reason)`);
  }
  for (const identity of Object.keys(HOLDS)) assert.ok(identities.has(identity), `${identity}: held but not a kit def; remove its hold`);
  assert.ok(kit.length >= 19, `only ${kit.length} kit defs`);
});

test('creatures: gait roles present (legs swing, heads nod, wings flap, tails wag)', () => {
  const need: Record<string, string[]> = { 'quadruped-walk': ['leg.fl', 'leg.fr', 'leg.bl', 'leg.br', 'head'], 'biped-waddle': ['leg.l', 'leg.r', 'head', 'wing.l', 'wing.r'], 'bird-fly': ['leg.l', 'leg.r', 'wing.l', 'wing.r', 'head'], 'fish-swim': ['tail'] };
  const creatures = kit.filter((d) => (d.tags ?? []).includes('creature'));
  assert.ok(creatures.length >= 19);
  for (const d of creatures) {
    const a = kitArgs.parse((d.make as { args: unknown }).args), roles = new Set(a.shapes.map((s) => s.role).filter(Boolean));
    for (const r of need[a.gait] ?? []) assert.ok(roles.has(r as never), `${d.name}: gait ${a.gait} needs role ${r}`);
    assert.ok(d.components?.behavior, `${d.name}: behavior component`);
  }
});

test('the library replaces the base kit placeholders (same names) and keeps their slots', () => {
  const byName = new Map(CORE_KIT.map((d) => [d.name, d]));
  for (const n of ['bench', 'table', 'chair', 'tree', 'rock', 'bowl', 'lamp-post', 'fountain']) {
    const d = byName.get(`core-${n}`); if (!d) continue;
    if (!kit.includes(d)) continue;   // not ported yet
    assert.equal(d.make.kind === 'gen' && d.make.gen, 'kit/2', `${n} is a kit def`);
  }
  const bench = byName.get('core-bench'); if (bench && kit.includes(bench)) assert.equal(bench.slots?.length, 2);
  const table = byName.get('core-table'); if (table && kit.includes(table)) assert.ok(table.slots?.some((s) => s.id === 'top'));
});

test('every point def places in a world (water things on a pond), nudged apart', () => {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'library' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  const pond = applyBatch(w, { ops: [{ op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: [[-200, 180], [200, 180], [200, 220], [-200, 220]] }, params: { depth: 1.5, level: -0.2 } }] }, 'god', 1);
  assert.equal(pond.result.accepted, true);
  let x = -300, fx = -180, prevHalf = 0;   // centre to centre = both half widths + 3 m (a wide vault no longer swallows its neighbour)
  const ops = kit.filter((d) => (d.form ?? 'point') === 'point').map((d) => {
    const version = defSchema.parse(d).version;
    const ref = `core/${d.name.slice(5)}@${version}`;
    const name = `t-${d.name.slice(5)}${version === 1 ? '' : `-v${version}`}`;
    if (d.anchor === 'float') { fx += 4; return { op: 'place', def: ref, name, p: [fx, 200] }; }
    const half = (d.size?.box[0] ?? 1) / 2; x += Math.max(4, prevHalf + half + 3); prevHalf = half; return { op: 'place', def: ref, name, p: [((x + 300) % 560) - 280, -300 + Math.floor((x + 300) / 560) * 60], mode: 'nudge' };   // rows 60 m apart: deep things (a grotto vault) clear the next row
  });
  for (let i = 0; i < ops.length; i += 200) {
    const r = applyBatch(w, { ops: ops.slice(i, i + 200) }, 'god', 2 + i);
    assert.equal(r.result.accepted, true, JSON.stringify((r.result as Refused).failures?.slice(0, 3)));
  }
});

test('perch slots: a robin perches on a tree branch and a lamp; a dog is refused', () => {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'perch' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  const ok = applyBatch(w, { ops: [
    { op: 'place', tmp: '$t', def: 'core/tree@1', name: 'oak', p: [0, 0] },
    { op: 'place', def: 'core/bird@1', name: 'robin', in: { parent: '$t', slot: 'branch-1' }, params: { behavior: 'perch' } },
    { op: 'place', tmp: '$l', def: 'core/lamp-post@1', name: 'lamp', p: [6, 0] },
    { op: 'place', def: 'core/crow@1', name: 'crow', in: { parent: '$l', slot: 'top' }, params: { behavior: 'perch' } },
  ] }, 'god', 1);
  assert.equal(ok.result.accepted, true, JSON.stringify((ok.result as Refused).failures));
  const robin = w.get('oak/robin')!; assert.ok(w.worldPose(robin).y > 3, 'up in the tree');
  const no = applyBatch(w, { ops: [{ op: 'place', def: 'core/dog@1', in: { parent: 'oak', slot: 'branch-2' } }] }, 'god', 2);
  assert.equal(no.result.accepted, false);
});
