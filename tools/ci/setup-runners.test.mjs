// tools/ci/setup-runners.sh: the argument checks that run before it touches the host (no root needed for these).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./setup-runners.sh', import.meta.url));
const run = (...args) => spawnSync('bash', [script, ...args], { encoding: 'utf8' });

test('setup-runners.sh parses, prints its usage and refuses bad arguments before touching the host', () => {
  assert.equal(spawnSync('bash', ['-n', script]).status, 0, 'bash -n');
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--token <registration token>/);
  for (const [args, why] of [[[], /--token is required/], [['--token', 't', '--count', '0'], /--count must be 1-99/],
    [['--token', 't', '--user', 'Bad User'], /--user must be a plain user name/], [['--token', 't', '--label', 'a b'], /--prefix and --label/],
    [['--token', 't', '--repo', 'nope'], /--repo must be owner\/name/], [['--bogus'], /unknown argument/]]) {
    const r = run(...args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, why, args.join(' '));
  }
});
