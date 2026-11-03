import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { WorldModel, coreLibrary, applyBatch } from '../../packages/world-compiler/src/index.ts';
import { dryingOps, growDay } from '../../apps/server/src/god/garden.ts';
import { plantLookOf } from '../../apps/web/src/fx/plant-growth.ts';

// Deliberately red diagnostic for #418, not a fixed-behavior CI test or motion proof.
const model = new WorldModel({ constants: { ground: 'land', extent: 300 }, seed: '418-revival-audit' });
model.library = coreLibrary();
const apply = ops => {
  const r = applyBatch(model, { ops }, 'god', model.editSeq + 1).result;
  assert.equal(r.accepted, true, JSON.stringify(r));
};
apply([1, 2].map((v, i) => ({ op: 'place', def: `core/garden-planter@${v}`, name: `unflagged-${v}`, p: [i * 3, 0], state: { moisture: 1, ...(v === 2 ? { growth: 2, thirst: 0 } : {}) } })));
const before = structuredClone([...model.entities.values()].map(e => ({ id: e.id, state: e.state })));
const drying = dryingOps(model, 1);
apply(drying);
const after = [...model.entities.values()].map(e => ({ id: e.id, state: e.state }));
const def = model.resolvedDef(model.get('unflagged-2').def);
let st = { moisture: 1, growth: 2, thirst: 0 };
const daily = [{ worldHours: 0, state: st, look: plantLookOf(st, def) }];
for (let d = 1; d <= 5; d++) { st = growDay(st); daily.push({ worldHours: d * 24, state: st, look: plantLookOf(st, def) }); }
const wilted = { moisture: 0, growth: 2, thirst: 3 };
const beforeWater = plantLookOf(wilted, def);
// This is the exact state-only moisture patch made by existing sprinkler/can commits.
// It is NOT a claimed native watering journey: the separate native fixtures validate those commits.
const afterWater = plantLookOf({ ...wilted, moisture: 1 }, def);
const opted = applyBatch(model, { ops: [{ op: 'set', id: model.get('unflagged-2').id, state: { dryingEnabled: true } }] }, 'god', model.editSeq + 1).result;
const requested = [
  { criterion: 'A2 unflagged planter is unchanged by daily drying', pass: JSON.stringify(before) === JSON.stringify(after), before, after, generatedOps: drying },
  { criterion: 'A1 same-clock visual wilt remains continuous (necessary condition only)', pass: afterWater.w === beforeWater.w, beforeWater, afterWater, deltaAtSameClock: afterWater.w - beforeWater.w },
];
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), scope: 'actual core definitions/daily ops/look function; deterministic state diagnostic only, no motion or native-pour claim', requested, legacyDailyVisualCurve: daily, attemptedOptInField: { name: 'dryingEnabled', accepted: opted.accepted, failures: opted.failures }, implementation: 'This diagnostic changes no runtime and does not certify the full A1–A5 contract.' };
if (process.env.SOUL_ACTIONS_REPORT) writeFileSync(process.env.SOUL_ACTIONS_REPORT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
process.exitCode = requested.every(x => x.pass) ? 0 : 1;
