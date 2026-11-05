import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertPublishable, loadDenylist, publicationFindings, readPublication } from './publication.mjs';

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

test('publication rejects SSH targets, schemeless local services and device-local roots (synthetic values)', () => {
  for (const value of [
    'ssh -p 2222 someuser' + '@some-host', 'someuser' + '@some-host', 'someuser' + '@10.' + '9.8.7', 'scp f someuser' + '@172.' + '20.1.2:/x',
    'localhost' + ':4512', 'bind 0.0.0' + '.0', 'host.docker' + '.internal', 'box-a' + '.local', 'nas' + '.lan:8080', 'svc.' + 'corp.internal',
    'http://' + 'buildbox:8080/x', 'ws://' + 'devbox/', '/root' + '/notes', '/Volumes' + '/External/run', '/private' + '/tmp/run',
    '/var' + '/folders/ab/cd', '/tmp/' + 'agent-501/scratch', '~' + 'otheruser/project', '/private' + '/var/db',
  ]) {
    assert.ok(publicationFindings(value, { denylist: [] }).length, `must reject a device-shaped value (${value.length} chars)`);
    assert.throws(() => assertPublishable(value), e => !e.message.includes(value));
  }
});

test('publication permits generic dotfiles, documentation placeholders, package tags and labelled counts', () => {
  for (const value of [
    'assets cache in ~/.cache/sim-assets', 'set $HOME/.config/tool', 'clone into ~/<project>', 'a bare ~/ prefix', '~/your-repo/apps',
    'ssh user' + '@host', 'ssh deploy' + '@<host>', 'ssh -T git' + '@github.com', 'pnpm add foo' + '@latest', 'react' + '@18.3.1',
    'see https://' + 'example/path', 'DATA_DIR=.local/dev', 'skin pass:1821 vertices', 'Desktop:1280×720', 'path guard:5161 files',
    'see @owner and `@types/node`', 'tools/tmp/x-1', 'https://github.com/owner/repo/pull/7',
  ]) assert.deepEqual(publicationFindings(value, { denylist: [] }), [], value);
});

test('an optional private denylist catches names no pattern knows, without echoing them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'publication-deny-'));
  const list = join(dir, 'deny.txt');
  writeFileSync(list, '# private machine names\nfictional-box\n\nab\n');
  const terms = loadDenylist(list);
  assert.deepEqual(terms, ['fictional-box']);
  assert.deepEqual(publicationFindings('ran on Fictional-Box today', { denylist: terms }), ['private denylist term']);
  assert.deepEqual(publicationFindings('ran on the candidate', { denylist: terms }), []);
  assert.deepEqual(loadDenylist(join(dir, 'missing.txt')), []);
  const out = spawnSync(process.execPath, ['tools/proof/publication.mjs', list], { encoding: 'utf8', env: { ...process.env, PUBLICATION_DENYLIST: list } });
  assert.equal(out.status, 1);
  assert.ok(!out.stderr.includes('fictional-box'));
});
