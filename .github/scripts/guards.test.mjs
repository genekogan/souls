import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addedLines, checkPaths, checkScrub, readAllowlist, scrubLine } from './guards.mjs';

test('path guard flags databases, state files, env files and unlisted media', () => {
  const allow = readAllowlist('# comment\napps/web/pwa/icon-192.png\n');
  const files = ['a/world.sqlite', 'b/x.db-wal', 'c/.eden-agent.json', '.eden-god.json', '.env', 'apps/x/.env.local',
    '.env.example', 'apps/web/pwa/icon-192.png', 'worlds/mars/hall.glb', 'docs/a.md', 'tools/blob'];
  const problems = checkPaths(files, allow, f => f === 'tools/blob');
  const flagged = problems.map(p => p.split(':')[0]);
  assert.deepEqual(flagged, ['a/world.sqlite', 'b/x.db-wal', 'c/.eden-agent.json', '.eden-god.json', '.env', 'apps/x/.env.local',
    'worlds/mars/hall.glb', 'tools/blob']);
});

test('scrub guard flags private values', () => {
  const home = ['', 'Users', 'alice', 'x'].join('/');
  assert.deepEqual(scrubLine(`open ${home}`), ['home path']);
  assert.deepEqual(scrubLine('see ~/Eden/' + 'team/notes.md'), ['private workspace path']);
  assert.deepEqual(scrubLine('see ~/' + 'workspace/project'), ['private workspace path']);
  assert.deepEqual(scrubLine('host 93.184.215.14 here'), ['public IP address']);
  assert.deepEqual(scrubLine('box.tail1234.ts' + '.net'), ['private host name']);
  assert.deepEqual(scrubLine('ssh root' + '@prodbox'), ['ssh target']);
  assert.deepEqual(scrubLine('mail alice' + '@mail.com'), ['email address']);
});

test('scrub guard passes neutral and documentation values', () => {
  for (const line of [
    'listen on 127.0.0.1:4000 or 0.0.0.0', 'docs use 192.0.2.10 and 10.0.0.2', 'version 1.2.3', 'node@22.20.0',
    'import x from "@sim/web"', 'Co-Authored-By: Claude <noreply' + '@anthropic.com>', 'by someone' + '@users.noreply.github.com',
    'path /Users/you/project', 'git' + '@github.com:owner/repo.git', 'v1.2.3.4', 'resolver 8.8.8.8', 'key 7.2.3.0', 'fixture 93.184.215.14 # scrub-guard: allow',
    'unit sim-worlds' + '@production.service', 'https://user:pw' + '@host.example', '/home/sim/sim.env', 'rot=R' + '@np.array(row)', 'c=world' + '@f.center;', 'root' + '@unreachable.invalid',
  ]) assert.deepEqual(scrubLine(line), [], line);
});

test('added lines carry file and line numbers; guard files are skipped', () => {
  const diff = [
    'diff --git a/x.md b/x.md', '--- a/x.md', '+++ b/x.md', '@@ -1,0 +5,2 @@', '+ok line', '+ip 93.184.215.14',
    'diff --git a/.gitleaks.toml b/.gitleaks.toml', '--- a/.gitleaks.toml', '+++ b/.gitleaks.toml', '@@ -0,0 +1 @@', '+93.184.215.14',
  ].join('\n');
  const lines = addedLines(diff);
  assert.deepEqual(lines.map(l => `${l.file}:${l.line}`), ['x.md:5', 'x.md:6', '.gitleaks.toml:1']);
  assert.deepEqual(checkScrub(lines), ['x.md:6: public IP address']);
});
