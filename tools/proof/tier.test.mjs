import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, loadPolicy, tierFor, tierForFile } from './tier.mjs';
import { SCOPE_RULES } from '../test-harness/release-gate.mjs';

const policy = loadPolicy();
const tier = (files, labels) => tierFor(files, policy, labels).tier;

test('docs, process and CI changes are T0', () => {
  assert.equal(tier(['README.md', 'docs/TESTING.md', '.github/workflows/ci.yml', 'changes/x.md', 'tools/playtest/a.mjs']), 'T0');
  assert.equal(tier([]), 'T0');
});

test('server and package logic is T1; visible UI is T2; Soul/engine is T3', () => {
  assert.equal(tier(['apps/server/src/account-auth.ts']), 'T1');
  assert.equal(tier(['packages/world-compiler/src/x.ts', 'pnpm-lock.yaml']), 'T1');
  assert.equal(tier(['apps/web/src/hud.ts', 'docs/a.md']), 'T2');
  assert.equal(tier(['apps/server/src/intent-arrivals.ts']), 'T3');
  assert.equal(tier(['packages/engine-mars/src/nav.ts']), 'T3');
});

test('Soul and navigation families retain top-level protection and cover nested directories', () => {
  for (const family of ['edge', 'intent', 'soul', 'brain', 'body', 'purpose', 'lifecycle', 'nav']) {
    for (const suffix of ['-example.ts', '/nested/example.ts']) {
      const file = `apps/server/src/${family}${suffix}`;
      assert.equal(tier([file]), 'T3', file);
      assert.equal(tier([file], ['tier:T0']), 'T3', `${file}: labels never lower protection`);
    }
  }
  assert.equal(tier(['apps/server/src/edge/ledger/ledger.ts']), 'T3');
});

test('shared god navigation/perception and split read-facade code require T3', () => {
  for (const file of [
    'apps/server/src/god/nav.ts', 'apps/server/src/god/perceive.ts',
    'apps/server/src/god/engine-bridge.ts', 'apps/server/src/god/buildsafe-rule.ts',
    'apps/server/src/split/menu-world.test.ts', 'apps/server/src/split/read-model.ts',
  ]) assert.equal(tier([file]), 'T3', file);
  for (const file of ['apps/server/src/account-auth.ts', 'apps/server/src/god/assets.ts', 'apps/server/src/http.ts']) {
    assert.deepEqual(tierForFile(file, policy), { tier: 'T1', rule: 'apps/server/' }, file);
  }
});

test('path policy keeps first-match precedence, independent of tier rank', () => {
  const custom = loadPolicy('paths:\n  - { prefix: "specific/", tier: T1 }\n  - { glob: "**", tier: T3 }\ndefault_tier: T1\n');
  assert.deepEqual(tierForFile('specific/file.ts', custom), { tier: 'T1', rule: 'specific/' });
});

test('the highest file wins and a label can raise but not lower', () => {
  assert.equal(tier(['docs/a.md', 'apps/web/x.ts']), 'T2');
  assert.equal(tier(['docs/a.md'], ['tier:T3']), 'T3');
  assert.equal(tier(['apps/web/x.ts'], ['tier:T0']), 'T2');
  assert.equal(tierFor(['docs/a.md'], policy, ['tier:T3']).raisedByLabel, 'T3');
});

test('unknown paths take default_tier', () => {
  assert.deepEqual(tierForFile('something-new/x', policy), { tier: policy.defaultTier, rule: 'default_tier' });
});

test('every release-gate scope prefix has its own rule (the two maps stay in step)', () => {
  for (const [prefix] of SCOPE_RULES) assert.notEqual(tierForFile(`${prefix}x/y.ts`, policy).rule, 'default_tier', prefix);
});

test('globs support *, ** and {a,b}', () => {
  assert.ok(globToRegExp('apps/server/src/{edge,soul}*').test('apps/server/src/soul-state.ts'));
  assert.ok(!globToRegExp('apps/server/src/{edge,soul}*').test('apps/server/src/x/soul.ts'));
  assert.ok(globToRegExp('packages/engine-*/**').test('packages/engine-toy/src/a/b.ts'));
  assert.ok(globToRegExp('*.md').test('README.md') && !globToRegExp('*.md').test('docs/a.md'));
});

test('malformed rules are rejected', () => {
  assert.throws(() => loadPolicy('paths:\n  - prefix: docs/\ndefault_tier: T1\n'));
  assert.throws(() => loadPolicy('paths:\n  - { prefix: "docs/", tier: T9 }\ndefault_tier: T1\n'));
});
