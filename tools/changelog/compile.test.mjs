import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADER, insertSection, parseFragment, readFragments, renderSection } from './compile.mjs';

const SCRIPT = fileURLToPath(new URL('./compile.mjs', import.meta.url));
const frag = (type, line, extra = '') => `---\ntype: ${type}\n${extra}---\n${line}\n`;

test('parses a fragment and takes the PR number from the file name', () => {
  assert.deepEqual(parseFragment('123.md', frag('fix', 'Seats stay taken.')), { name: '123.md', slug: '123', type: 'fix', line: 'Seats stay taken.', pr: 123 });
  assert.equal(parseFragment('seat-fix.md', frag('fix', 'x', 'pr: 9\n')).pr, 9);
  assert.equal(parseFragment('seat-fix.md', frag('perf', '- Faster.')).line, 'Faster.');
});

test('rejects bad fragments', () => {
  assert.throws(() => parseFragment('a.md', 'no front matter'), /front matter/);
  assert.throws(() => parseFragment('a.md', frag('chore', 'x')), /type must be/);
  assert.throws(() => parseFragment('a.md', frag('fix', 'one\ntwo')), /exactly one/);
  assert.throws(() => parseFragment('a.md', frag('fix', '')), /exactly one/);
  assert.throws(() => parseFragment('a.md', frag('fix', 'x', 'pr: abc\n')), /pr must be a number/);
});

test('renders sections by type, PR order, and leaves internal out', () => {
  const section = renderSection('1.2.0', '2026-11-01', [
    parseFragment('20.md', frag('fix', 'B fix.')), parseFragment('10.md', frag('fix', 'A fix.')),
    parseFragment('new-ui.md', frag('feature', 'New panel.')), parseFragment('ci.md', frag('internal', 'CI tweak.')),
  ]);
  assert.equal(section, '## 1.2.0 (2026-11-01)\n\n### Features\n\n- New panel.\n\n### Fixes\n\n- A fix. (#10)\n- B fix. (#20)\n');
  assert.match(renderSection('1.2.1', '2026-11-02', [parseFragment('ci.md', frag('internal', 'x'))]), /Internal changes only/);
});

test('inserts above the newest release; the intro is the header (an old one is replaced); releases kept byte for byte', () => {
  const old = '# Changelog\n\nUser-facing changes to Sim, newest first.\n\n## 1.0.0 (2026-10-01)\n\n- Old.\n\n## 0.9.0 (2026-09-01)\n\n- Older.\n';
  const out = insertSection(old, '## 1.1.0 (2026-11-01)\n\n- New.\n');
  assert.equal(out, `${HEADER}\n## 1.1.0 (2026-11-01)\n\n- New.\n\n## 1.0.0 (2026-10-01)\n\n- Old.\n\n## 0.9.0 (2026-09-01)\n\n- Older.\n`);
  assert.ok(out.endsWith(old.slice(old.indexOf('## 1.0.0'))), 'every earlier release unchanged');
  assert.match(HEADER, /changes to Souls, newest first/); assert.doesNotMatch(out, /\bSim\b/);
  assert.equal(insertSection('', '## 1.0.0 (x)\n'), `${HEADER}\n## 1.0.0 (x)\n`);
  assert.equal(insertSection('# Changelog\n\nNo releases yet.\n', '## 1.0.0 (x)\n'), `${HEADER}\n## 1.0.0 (x)\n`);
});

test('CLI: --check validates, --version compiles, writes notes and removes fragments', () => {
  const root = mkdtempSync(join(tmpdir(), 'changelog-'));
  mkdirSync(join(root, 'changes'));
  writeFileSync(join(root, 'changes', 'README.md'), 'not a fragment');
  writeFileSync(join(root, 'changes', '7.md'), frag('feature', 'Walk on floors.'));
  writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## 0.9.0 (2026-10-01)\n\n- Old.\n');
  const run = (...a) => execFileSync(process.execPath, [SCRIPT, '--root', root, ...a], { encoding: 'utf8' });
  assert.match(run('--check'), /1 valid fragment/);
  assert.match(run('--version', '1.0.0', '--dry-run', '--date', '2026-11-01'), /Walk on floors\. \(#7\)/);
  assert.ok(existsSync(join(root, 'changes', '7.md')), 'dry run keeps fragments');
  run('--version', '1.0.0', '--date', '2026-11-01', '--notes', join(root, 'notes.md'));
  const log = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(log.indexOf('## 1.0.0') < log.indexOf('## 0.9.0'));
  assert.equal(readFileSync(join(root, 'notes.md'), 'utf8'), '### Features\n\n- Walk on floors. (#7)\n');
  assert.deepEqual(readdirSync(join(root, 'changes')), ['README.md']);
  assert.throws(() => run('--version', '1.0.0'), /already has/);
  writeFileSync(join(root, 'changes', 'bad.md'), 'oops');
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, '--root', root, '--check'], { stdio: 'pipe' }));
});

test('CLI: --out writes the compiled changelog elsewhere and leaves the tree alone (#393)', () => {
  const root = mkdtempSync(join(tmpdir(), 'changelog-'));
  mkdirSync(join(root, 'changes'));
  writeFileSync(join(root, 'changes', '7.md'), frag('feature', 'Walk on floors.'));
  const before = '# Changelog\n\n## 0.9.0 (2026-10-01)\n\n- Old.\n';
  writeFileSync(join(root, 'CHANGELOG.md'), before);
  const out = join(root, 'build-changelog.md');
  const run = (...a) => execFileSync(process.execPath, [SCRIPT, '--root', root, ...a], { encoding: 'utf8' });
  run('--version', '1.0.0', '--date', '2026-11-01', '--out', out);
  assert.equal(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), before, 'CHANGELOG.md untouched');
  assert.ok(existsSync(join(root, 'changes', '7.md')), 'fragments kept for publish');
  run('--version', '1.0.0', '--date', '2026-11-01');   // what publish does later
  assert.equal(readFileSync(out, 'utf8'), readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), 'the build saw exactly what publish commits');
});

test('the repo fragments are valid', () => {
  readFragments(fileURLToPath(new URL('../../changes/', import.meta.url)));
});
