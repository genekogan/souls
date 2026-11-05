import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coreLibrary, type StoredDef } from '@sim/world-compiler';
import { conformance, stateVariants, STATE_PRODUCT_CAP, type RenderCheck } from './conformance.ts';

// #973: the gallery also measures every declared entity state, so `when: "@state"` geometry cannot hide a budget overrun.
const def = (state: Record<string, unknown>, shapes: { when?: string }[] = []) => ({ ...coreLibrary().get('core-bench@1')!, state, make: { kind: 'gen', gen: 'kit/2', args: { v: 2, shapes } } }) as unknown as StoredDef;

test('state variants: bools both ways, enums, numeric thresholds either side, tested strings, full product under the cap', () => {
  const v = stateVariants(def({ on: { type: 'bool', default: false }, mode: { type: 'enum', default: 'a', values: ['a', 'b'] }, tea: { type: 'number', default: 0 } }, [{ when: '@on' }, { when: '@tea>0.5 & !@on' }, { when: '@tea<=0.2' }]));
  assert.equal(v.length, 2 * 2 * 5, 'on × mode × tea{0, 0.5, 0.501, 0.2, 0.201}');
  assert.deepEqual(v[0], { on: false, mode: 'a', tea: 0 }, 'the declared defaults come first');
  assert.ok(v.some(s => s.on === true && s.mode === 'b' && s.tea === 0.501), 'joint assignments are measured');
  assert.deepEqual([...new Set(v.map(s => s.tea))].sort(), [0, 0.2, 0.201, 0.5, 0.501]);
  assert.deepEqual(stateVariants(def({ label: { type: 'string', default: '' } }, [{ when: '@label' }])), [{ label: '' }, { label: 'sample' }], 'a tested string gets a non-empty value');
  assert.deepEqual(stateVariants(def({ tint: { type: 'color', default: '#fff' } })), [{ tint: '#fff' }], 'untested content stays at its default');
  assert.deepEqual(stateVariants(def({})), [], 'no declared state, nothing extra');
  assert.deepEqual(stateVariants(def({ level: { type: 'int', default: 2, min: 0, max: 9 } }, [{ when: '@level>=5' }])).map(s => s.level), [2, 0, 9, 5, 4]);
  const many = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`b${i}`, { type: 'bool', default: false }]));
  const capped = stateVariants(def(many));
  assert.ok(2 ** 7 > STATE_PRODUCT_CAP && capped.length === 1 + 7, 'over the cap: the defaults, then each field flipped alone');
  assert.ok(capped.every(s => Object.values(s).filter(Boolean).length <= 1));
  assert.deepEqual(stateVariants(def(many)), capped, 'deterministic');
  const mixed = stateVariants(def({ ...many, lid: { type: 'bool', default: false }, tea: { type: 'number', default: 0, min: 0, max: 1 } }, [{ when: '@lid & @tea<=0.4' }, { when: '@tea>2' }]));
  assert.ok(mixed.some(s => s.lid === true && s.tea === 0.401) && mixed.some(s => s.lid === true && s.tea === 1), 'over the cap, the when-tested fields still combine');
  assert.ok(!mixed.some(s => s.tea === 2 || s.tea === 2.001), 'thresholds stay in the declared range');
  assert.ok(mixed.some(s => s.b6 === true) && mixed.filter(s => s.b0 === true).length === 1, 'untested fields vary alone');
});

test('the sweep reports a state-gated overrun once per budget, and nothing when a state is within budget or no worse than stateless', async () => {
  const cabinet = coreLibrary().get('core-arcade-cabinet@1')!;
  assert.deepEqual((cabinet as unknown as { state: unknown }).state, { on: { type: 'bool', default: true } }, 'fixture: one declared bool state');
  const run = async (render: RenderCheck) => (await conformance({ defs: [cabinet], k: 0, render })).findings.filter(f => f.stage.startsWith('gallery'));
  const seen: unknown[] = [];
  const over = await run((_d, _p, _b, _m, _s, state) => { seen.push(state); return { tris: 10, draws: state?.on ? 6 : 2, materials: 1 }; });
  assert.ok(seen.includes(undefined) && seen.some(s => JSON.stringify(s) === '{"on":true}') && seen.some(s => JSON.stringify(s) === '{"on":false}'), 'stateless, on and off are all built');
  assert.ok(over.length > 0 && over.every(f => f.stage === 'gallery-state-budget' && f.code === 'draws' && f.detail === '6 > 4 @{"on":true}'), JSON.stringify(over.slice(0, 3)));
  assert.equal(new Set(over.map(f => f.field)).size, over.length, 'one finding per sample point and budget');
  assert.deepEqual(await run((_d, _p, _b, _m, _s, state) => ({ tris: 10, draws: state?.on ? 4 : 2, materials: 1 })), [], 'at the budget is within it');
  const same = await run(() => ({ tris: 10, draws: 6, materials: 1 }));
  assert.ok(same.length > 0 && same.every(f => f.stage === 'gallery-budget' && f.detail === '6 > 4'), 'no worse than stateless: only the unchanged stateless finding');
});
