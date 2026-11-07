// Looks v2 (2026-10-16): accessories, outfits, and the guarantee that every v1 look keeps its template key and params.
import test from 'node:test';
import assert from 'node:assert/strict';
import {bodyV1Schema} from '@souls/protocol';
import * as L from '../src/humanoid/look.ts';

// golden keys computed with the trunk (27a56cba) look.ts: stored bodies' `model` must not change
const V1 = {casual: 'humanoid2-7c80d101236c2406', tall: 'humanoid2-cb88292e4ee7ab80', edit: 'humanoid2-fed270c1d31e3134'};
test('v1 looks keep their template keys and compact params', () => {
  assert.equal(L.lookKey({preset: 'casual'}), V1.casual);
  assert.equal(L.lookKey({preset: 'punk', height: 1.85}), V1.tall);
  assert.equal(L.lookKey({hat: 'cap', top1: '#356477'}), V1.edit);
  assert.deepEqual(L.compactLook(L.resolveLook({preset: 'punk', height: 1.85})), {preset: 'punk', height: 1.85});
  assert.deepEqual(L.compactLook(L.resolveLook({hat: 'cap', top1: '#356477'})), {hat: 'cap', top1: '#356477'});
});
test('accessories validate, survive a preset, and describe themselves', () => {
  for (const [k, v] of [['facialHair', 'beard'], ['scarf', 'scarf'], ['gloves', 'gloves'], ['mask', 'cloth'], ['jewellery', 'both'], ['accessory', '#123456']] as const) assert.equal((L.checkLook({[k]: v}) as Record<string, unknown>)[k], v);
  for (const bad of [{facialHair: 'stubble'}, {mask: 'gas'}, {jewellery: 'crown'}, {accessory: 'red'}]) assert.throws(() => L.checkLook(bad), L.LookError);
  const punk = L.editLook({preset: 'punk'}, {facialHair: 'beard', jewellery: 'earrings'});
  assert.equal(punk.preset, 'punk', 'an accessory keeps the classic preset'); assert.equal(punk.facialHair, 'beard');
  assert.deepEqual(L.compactLook(punk), {preset: 'punk', facialHair: 'beard', jewellery: 'earrings'});
  assert.equal(L.resolveLook(L.compactLook(punk)).facialHair, 'beard', 'stored and resolved again');
  assert.notEqual(L.lookKey(punk), L.lookKey({preset: 'punk'}));
  assert.match(L.describeLook(L.resolveLook({facialHair: 'goatee', scarf: 'scarf', jewellery: 'both'})), /goatee, scarf, earrings and necklace/);
  const {palette} = L.paletteOf(L.resolveLook({accessory: '#ffffff'})); assert.deepEqual([...palette.slice(15 * 3, 16 * 3)], [1, 1, 1], 'spare slot carries the accessory colour');
});
test('outfit=<id> sets top, bottom, shoes and colours in one go; explicit keys win; unknown refused', () => {
  const base = L.resolveLook({hat: 'cap', top1: '#356477'});
  const suit = L.editLook(base, {outfit: 'suit'});
  assert.deepEqual([suit.top, suit.bottom, suit.shoes, suit.top1], ['suit', 'suit', 'suit', L.OUTFITS.suit.top1]); assert.equal(suit.hat, 'cap', 'the rest of the look stays');
  assert.equal(L.editLook(base, {outfit: 'suit', top1: '#222222'}).top1, '#222222');
  for (const id of Object.keys(L.OUTFITS)) { const o = L.OUTFITS[id]; for (const k of ['top', 'bottom', 'shoes'] as const) assert.ok((L.HUMANOID_PARAMS[k] as {values: string[]}).values.includes(o[k] as string), `${id}.${k} is a kit part`); L.checkLook(o); }
  assert.throws(() => L.editLook(base, {outfit: 'tuxedo'}), /outfit must be one of/);
  const body = L.lookRequest(null, {outfit: 'farmer', facialHair: 'beard'}, {preset: 'casual'}, () => 1); assert.equal(L.resolveLook(body.params).top, 'farmer');
});
test('a maximal look stays within the BODY-v1 params bound', () => {
  const max = L.resolveLook({...L.appearanceFromSeed(5), preset: 'none', facialHair: 'beard', scarf: 'scarf', gloves: 'gloves', mask: 'cloth', jewellery: 'both', accessory: '#123456', hat: 'cap', glasses: 'round', bag: 'satchel', pattern: 'checks', walkSpeed: 1.1, headSize: 1.04, height: 1.82, build: 1.05});
  const body = L.lookBody(max); assert.ok(Object.keys(body.params).length <= 48);
  assert.ok(bodyV1Schema.safeParse(body).success, 'BODY-v1 accepts it');
});
test('seeded looks: v1 fields unchanged, v2 accessories drawn after them', () => {
  const s = L.appearanceFromSeed(42);
  const v1 = {frame: 'fem', face: 'woman-formal', top: 'woman-suit', bottom: 'woman-punk', shoes: 'adventurer', glasses: 'square', bag: 'backpack', headSize: 0.99, height: 1.68, build: 0.99, skin: '#a8683f', hair1: '#c49a5f', top1: '#4b6b8a'};
  for (const [k, v] of Object.entries(v1)) assert.equal((s as Record<string, unknown>)[k], v, k);
  assert.equal(s.facialHair, 'none', 'fem frames are never seeded facial hair');
  const masc = Array.from({length: 200}, (_, i) => L.appearanceFromSeed(i)).filter(l => l.frame === 'masc');
  assert.ok(masc.some(l => l.facialHair !== 'none') && masc.some(l => l.facialHair === 'none'), 'some seeded men have facial hair');
});
test('body shape: validated, rounded, kept with a preset, part of the key only when set', () => {
  assert.equal(L.resolveLook({weight: 1.2345}).weight, 1.23);
  for (const bad of [{shoulders: 1.3}, {hips: 0.5}, {weight: 2}, {chest: 'big'}]) assert.throws(() => L.checkLook(bad), L.LookError);
  const p = L.editLook({preset: 'woman'}, {hips: 1.12, weight: 1.1});
  assert.equal(p.preset, 'woman'); assert.deepEqual(L.compactLook(p), {preset: 'woman', hips: 1.12, weight: 1.1});
  assert.equal(L.lookKey({preset: 'woman', hips: 1}), L.lookKey({preset: 'woman'}));
  assert.notEqual(L.lookKey(p), L.lookKey({preset: 'woman'}));
  assert.match(L.describeLook(p), /hips 112 %, weight 110 %/);
});
