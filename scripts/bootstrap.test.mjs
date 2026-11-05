// scripts/bootstrap.sh and the Claude wrapper, against a fake pnpm in a throwaway git repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = fileURLToPath(new URL('.', import.meta.url));

function fixture({ installFails = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrap-test-'));
  const repo = join(dir, 'repo'), bin = join(dir, 'bin'), calls = join(dir, 'calls.log');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, 'tools/assets'), { recursive: true });
  mkdirSync(bin);
  for (const f of ['bootstrap.sh', 'cloud-session-start.sh']) cpSync(join(SCRIPTS, f), join(repo, 'scripts', f));
  writeFileSync(join(repo, 'package.json'), '{"name":"x"}\n');
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  writeFileSync(join(repo, 'tools/assets/manifest.json'), '{}\n');
  // The fake pnpm records each call; `install` creates node_modules like the real one.
  writeFileSync(join(bin, 'pnpm'), `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(calls)}\n` +
    (installFails ? 'if [ "$1" = install ]; then echo boom; exit 1; fi\n' : '') +
    'if [ "$1" = install ]; then mkdir -p node_modules; fi\nexit 0\n');
  chmodSync(join(bin, 'pnpm'), 0o755);
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q'); git('add', '-A');
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: dir, TMPDIR: dir };
  const run = (script, args = [], extra = {}) => {
    const r = spawnSync('bash', [join(repo, 'scripts', script), ...args], { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout };
  };
  const callLog = () => { try { return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
  return { repo, git, run, callLog };
}

test('first run installs and pulls; an unchanged second run does neither', () => {
  const f = fixture();
  const first = f.run('bootstrap.sh');
  assert.equal(first.code, 0);
  assert.match(first.out, /dependencies installed/);
  assert.match(first.out, /media pulled/);
  assert.deepEqual(f.callLog(), ['install --frozen-lockfile', 'assets:pull --quiet']);
  const second = f.run('bootstrap.sh');
  assert.equal(second.code, 0);
  assert.equal(second.out, '');
  assert.equal(f.callLog().length, 2);
});

test('a lockfile change reinstalls without pulling media again', () => {
  const f = fixture();
  f.run('bootstrap.sh');
  writeFileSync(join(f.repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n# changed\n');
  f.git('add', '-A');
  assert.match(f.run('bootstrap.sh').out, /dependencies installed/);
  assert.deepEqual(f.callLog(), ['install --frozen-lockfile', 'assets:pull --quiet', 'install --frozen-lockfile']);
});

test('a failed install is reported, leaves no stamp, retries next time and still exits 0', () => {
  const f = fixture({ installFails: true });
  const r = f.run('bootstrap.sh', ['--no-media']);
  assert.equal(r.code, 0);
  assert.match(r.out, /pnpm install --frozen-lockfile FAILED/);
  f.run('bootstrap.sh', ['--no-media']);
  assert.deepEqual(f.callLog(), ['install --frozen-lockfile', 'install --frozen-lockfile']);
});

test('--no-media skips the pull', () => {
  const f = fixture();
  assert.doesNotMatch(f.run('bootstrap.sh', ['--no-media']).out, /media/);
  assert.deepEqual(f.callLog(), ['install --frozen-lockfile']);
});

test('the Claude wrapper does nothing locally and runs the shared bootstrap in a cloud session', () => {
  const f = fixture();
  assert.deepEqual(f.run('cloud-session-start.sh'), { code: 0, out: '' });
  assert.deepEqual(f.callLog(), []);
  const cloud = f.run('cloud-session-start.sh', [], { CLAUDE_CODE_REMOTE: 'true', CLAUDE_PROJECT_DIR: f.repo });
  assert.equal(cloud.code, 0);
  assert.deepEqual(f.callLog(), ['install --frozen-lockfile', 'assets:pull --quiet']);
});

test('the bootstrap reads no provider variable', () => {
  assert.doesNotMatch(readFileSync(join(SCRIPTS, 'bootstrap.sh'), 'utf8'), /CLAUDE_|CODEX_/);
});
