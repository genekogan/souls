import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MANIFEST, check, treeFacts} from './check.mjs';

const manifest = () => JSON.parse(readFileSync(MANIFEST, 'utf8'));
const facts = await treeFacts();

test('the PC01 manifest agrees with the tree: every selector id once, real sources, catalog ids and PC issues', () => {
  assert.deepEqual(check(manifest(), facts), []);
});

test('a selector id the manifest drops, or one it invents, is reported', () => {
  const m = manifest();
  m.lab[0].ids = m.lab[0].ids.slice(1).concat('not-a-scenario');
  const errors = check(m, facts);
  assert.ok(errors.some((e) => e.startsWith('selector id ') && e.endsWith('has no manifest row')), errors.join('\n'));
  assert.ok(errors.includes('manifest lab id not-a-scenario is not in SELECTABLE_SCENARIOS'), errors.join('\n'));
});

test('a missing source, an unknown asset id or a row without an owner is reported', () => {
  const m = manifest();
  m.native[0].source = ['mars/viewer/engine/carry/no-such-file.ts'];
  m.assets[0].native = ['upright-99ft'];
  delete m.server[0].pc;
  const errors = check(m, facts);
  assert.ok(errors.some((e) => e.includes('no-such-file.ts does not exist')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('upright-99ft does not exist')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('names neither a PC issue')), errors.join('\n'));
});
