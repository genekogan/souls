import test from 'node:test';
import assert from 'node:assert/strict';
import { componentsSchema, defSchema, CORE_KIT, WorldModel, applyBatch } from './index.ts';
import { kitArgs, kitPhysics } from '@souls/generators';
const { examples } = await import(new URL('../../../tools/god-skill/examples/light-motion.mjs', import.meta.url).href) as { examples: Record<string, unknown> };

test('authored light fields are optional; old singular defaults and serialized defs stay unchanged', () => {
  assert.deepEqual(componentsSchema.parse({ light: {} }), { light: { color: '#ffe9c4', range: 8, on: true } });
  assert.deepEqual(componentsSchema.parse({}), {});
  for (const pattern of ['steady', 'blink', 'twinkle', 'chase', 'pulse']) {
    const parsed = componentsSchema.parse({ light: { at: [2, 4, -1], pattern }, lights: [{ at: [1, 2] }] });
    assert.equal(parsed.light?.pattern, pattern); assert.deepEqual(parsed.light?.at, [2, 4, -1]);
    assert.deepEqual(parsed.lights?.[0].at, [1, 2]);
  }
});

test('light schema refuses invalid patterns/offsets and more than eight bulbs', () => {
  for (const input of [{ light: { pattern: 'strobe' } }, { light: { at: [1] } }, { light: { at: [1, Infinity, 0] } }, { lights: [] }, { lights: Array(9).fill({}) }]) assert.equal(componentsSchema.safeParse(input).success, false);
  assert.equal(componentsSchema.parse({ lights: Array(8).fill({}) }).lights?.length, 8);
});

test('twinkle is a real library def, with eight matching bulbs and no seeded entities', () => {
  const d = CORE_KIT.find(d => d.name === 'core-twinkle-lights'); assert.ok(d);
  const parsed = defSchema.parse(d); assert.equal(parsed.components.lights?.length, 8);
  assert.ok(parsed.description.includes('god/examples/light-motion.mjs'));
  assert.ok(parsed.tags.includes('twinkle'));
  assert.equal(parsed.make.kind, 'gen');
  const a = kitArgs.parse((parsed.make as { args: unknown }).args);
  assert.ok(kitPhysics(a).tris <= 800);
  for (const light of parsed.components.lights!) assert.ok(a.shapes.some(s => JSON.stringify(s.at) === JSON.stringify(light.at)));
  const w = new WorldModel({ constants: { extent: 100, ground: 'land' }, seed: 'light-test' });
  w.defineDef(parsed, 'core', 0); assert.equal(w.entities.size, 0);
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'core/twinkle-lights@1', name: 'market-lights', p: [0, 0] }] }, 'god', 1);
  assert.equal(r.result.accepted, true, JSON.stringify(r.result));
});

test('served examples cover spin, sway, hover, route, sound and twinkle and only define final things', () => {
  assert.deepEqual(Object.keys(examples), ['spin', 'sway', 'hover', 'route', 'sound', 'twinkle']);
  const w = new WorldModel({ constants: { extent: 100, ground: 'land' }, seed: 'light-test' });
  for (const d of Object.values(examples)) { const parsed = defSchema.parse(d); w.defineDef(parsed, 'god', 0); }
  assert.equal(w.entities.size, 0, 'no motion-test entities needed or created');
});
