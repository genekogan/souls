import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('raw package results keep an earlier failure even when the last package passes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'souls-package-harness-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const p of ['engine-mars', 'world-compiler', 'generators', 'ground', 'kernel', 'brain', 'engine-toy', 'engine-contract', 'protocol', 'engine-native', 'conformance']) {
    mkdirSync(join(dir, 'packages', p, 'src'), { recursive: true });
    writeFileSync(join(dir, 'packages', p, 'src', 'stub.test.ts'), `import test from 'node:test'; test('${p}', () => { ${p === 'engine-mars' ? "throw Error('retained failure')" : ''} });\n`);
  }
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync('bash', [join(root, 'tools/test-harness/package-suite.sh')], { cwd: dir, encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not ok 1 - engine-mars/);
  assert.match(r.stdout, /retained failure/);
  assert.match(r.stdout, /## engine-mars exit=1/);
  assert.match(r.stdout, /## conformance exit=0/);
});

test('historical input transport resolves original SHAs in an independent Git database', t => {
  const dir = mkdtempSync(join(tmpdir(), 'souls-history-harness-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pack = join(dir, 'inputs.pack');
  execFileSync(process.execPath, [join(root, 'tools/test-harness/historical-inputs.mjs'), 'HEAD', pack], { cwd: root });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['index-pack', '--stdin'], { cwd: dir, input: readFileSync(pack) });
  const receipt = JSON.parse(readFileSync(pack + '.json'));
  for (const [commit, paths] of receipt.specs) {
    for (const path of paths) {
      const args = ['show', `${commit}:${path}`];
      assert.deepEqual(execFileSync('git', args, { cwd: dir }), execFileSync('git', args, { cwd: root }));
    }
    const parent = execFileSync('git', ['rev-parse', `${commit}^`], { cwd: root, encoding: 'utf8' }).trim();
    assert.notEqual(spawnSync('git', ['cat-file', '-e', parent], { cwd: dir }).status, 0);
  }
});
