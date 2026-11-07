// #1114: the committed kit files are what the authoring modules produce, and --check says so when one is not.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), build = join(here, 'authoring/build.mjs');
const check = (...args: string[]) => spawnSync(process.execPath, [build, '--check', ...args], { encoding: 'utf8' });

test('build --check reproduces every committed kit file', () => {
  const r = check();
  assert.equal(r.status, 0, r.stderr.split('\n').filter((l) => l.startsWith('stale') || l.startsWith('✖')).join('\n') || r.stderr);
});

test('build --check fails on a stale kit file and names it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-check-'));
  try {
    cpSync(here, dir, { recursive: true, filter: (f) => f === here || f.endsWith('.json') });
    appendFileSync(join(dir, 'signage.json'), ' ');
    const r = check('--against', dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^stale: signage\.json$/m);
    assert.doesNotMatch(r.stderr, /^stale: vocab-w3\.json$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
