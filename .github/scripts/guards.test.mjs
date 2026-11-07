import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addedLines, checkLedger, checkPaths, checkScrub, ledgerEntries, readAllowlist, scrubLine } from './guards.mjs';

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
    'import x from "@souls/web"', 'Co-Authored-By: Claude <noreply' + '@anthropic.com>', 'by someone' + '@users.noreply.github.com',
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

test('scrub guard: workspace paths and SSH targets beyond the service users, with placeholders allowed', () => {
  for (const line of ['cd ~/' + 'Projects/app', 'see $HOME/' + 'code/app', 'ssh -p 2222 someuser' + '@some-host', 'x someuser' + '@192.168.' + '7.8'])
    assert.ok(scrubLine(line).length, line);
  for (const line of ['cache ~/.cache/sim-assets', 'set $HOME/.config/tool', 'clone into ~/<project>', 'a bare ~/ prefix',
    'ssh user' + '@host', 'ssh -T git' + '@github.com', 'pnpm add foo' + '@latest', 'ssh deploy' + '@<host>'])
    assert.deepEqual(scrubLine(line), [], line);
});

const entry = (family, n, hex, id = n === 1 ? family : `${family}-${n}`) => ` {id:'${id}',family:'${family}',n:${n},asset:'body_${hex.repeat(64)}'},`;
const ledger = (...lines) => `export type CoreRevision={readonly id:string};\nexport const CORE_REVISIONS:readonly CoreRevision[]=Object.freeze([\n${lines.join('\n')}\n].map(r=>Object.freeze(r)));\n`;
const pip = entry('pip', 1, 'a'), ghost = entry('ghost', 1, 'b'), base = ledger(pip, ghost);

test('ledger guard reads the real ledger', () => {
  const entries = ledgerEntries(readFileSync(new URL('../../apps/server/src/edge/body/core-revisions.ts', import.meta.url), 'utf8'));
  assert.ok(entries.length >= 4);
  assert.deepEqual(Object.keys(entries[0]), ['id', 'family', 'n', 'asset']);
  assert.equal(entries[0].id, 'pip');
});

test('ledger guard passes an unchanged ledger, an append, and a file the base does not have', () => {
  assert.deepEqual(checkLedger(base, base), []);
  assert.deepEqual(checkLedger(base, ledger(pip, ghost, entry('pip', 2, 'c'))), []);
  assert.deepEqual(checkLedger(null, base), []);
});

test('ledger guard fails a changed, removed or reordered released entry (#845)', () => {
  const cases = {
    asset: ledger(entry('pip', 1, 'c'), ghost),
    id: ledger(entry('pip', 1, 'a', 'pip-x'), ghost),
    family: ledger(entry('pop', 1, 'a', 'pip'), ghost),
    number: ledger(entry('pip', 2, 'a', 'pip'), ghost),
    removed: ledger(pip),
    'removed first': ledger(ghost),
    reordered: ledger(ghost, pip),
    'inserted before': ledger(entry('new', 1, 'c'), pip, ghost),
  };
  for (const [what, head] of Object.entries(cases)) assert.ok(checkLedger(base, head).length, what);
});

test('ledger guard fails closed: comments, deletion and an unreadable shape never pass', () => {
  assert.ok(checkLedger(base, ledger(pip, `//${ghost}`)).length, 'commented out');
  assert.ok(checkLedger(base, ledger(pip, `/*${ghost}*/`)).length, 'block comment');
  assert.ok(checkLedger(base, null).length, 'file deleted');
  assert.ok(checkLedger(base, ledger(pip, ghost.replace("n:1", "n:1,note:'x'"))).length, 'an entry it cannot read');
  assert.ok(checkLedger('export const CORE_REVISIONS=load();', base).length, 'nothing readable at the base');
});
