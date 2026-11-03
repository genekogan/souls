import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertPublishable, publicationFindings, readPublication } from './publication.mjs';

const home = ['', 'Users', 'private-person', 'workspace'].join('/');

test('publication rejects device values, including fixture markers, encoded paths and JSON keys', () => {
  for (const value of [home, home + ' # scrub-guard: allow', encodeURIComponent(home),
    'CPU 50%. Source: ' + encodeURIComponent(home), encodeURIComponent(encodeURIComponent(home)), ['~', 'workspace'].join('/'),
    ['C:', 'Users', 'private-person', 'workspace'].join('\\'), '/home/' + 'private-person/work',
    'http://' + 'localhost:5000', 'ws://' + 'workstation.local:5000', '192.' + '168.27.33',
    '100.' + '92.15.34', '10.' + '42.13.17', '172.' + '20.3.7', 'http://[' + 'fd12::1234]/',
    'PID' + '12345', 'box.tail1111.ts' + '.net']) {
    assert.ok(publicationFindings(value).length, 'must reject a device-shaped value');
    assert.throws(() => assertPublishable(value), e => e.message.startsWith('Publication blocked:') && !e.message.includes(value));
  }
  assert.ok(publicationFindings({ [home]: 'harmless' }).length);
});

test('publication permits relative source paths, neutral labels, versions and documentation addresses', () => {
  assert.doesNotThrow(() => assertPublishable({
    source: 'apps/web/src/notes/home/branding/assets.ts', environment: 'isolated-candidate',
    cmd: 'node tools/proof/acceptance.mjs check --body .local/outgoing/pr.md',
    docs: 'https://example.com at 192.0.2.30; node22.20.0; v1.2.3.4',
    processSemantics: 'PID0 is a process group; PID1 is init, not a device identity',
    media: ['https://github.com/owner/repo/releases/download/proofs/pr-7.candidate.mp4'],
  }));
});

test('CLI decodes JSON escapes, fails closed without echoing values, and accepts a corrected payload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'publication-'));
  const file = join(dir, 'proof.json');
  writeFileSync(file, JSON.stringify({ cmd: home }).replaceAll('/', '\\u002f'));
  assert.equal(readPublication(file).cmd, home);
  const bad = spawnSync(process.execPath, ['tools/proof/publication.mjs', file], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Publication blocked/);
  assert.ok(!bad.stderr.includes('private-person') && !bad.stderr.includes(dir));
  writeFileSync(file, JSON.stringify({ cmd: 'tools/repro.mjs' }));
  const good = spawnSync(process.execPath, ['tools/proof/publication.mjs', file], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
});
