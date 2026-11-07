import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fragmentProofProblem, insertSection, parseFragment, readFragments, renderSection } from './compile.mjs';

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

test('inserts above the newest release and keeps the intro', () => {
  const old = '# Changelog\n\nIntro.\n\n## 1.0.0 (2026-10-01)\n\n- Old.\n';
  assert.equal(insertSection(old, '## 1.1.0 (2026-11-01)\n\n- New.\n'), '# Changelog\n\nIntro.\n\n## 1.1.0 (2026-11-01)\n\n- New.\n\n## 1.0.0 (2026-10-01)\n\n- Old.\n');
  assert.match(insertSection('', '## 1.0.0 (x)\n'), /^# Changelog\n[\s\S]*## 1\.0\.0/);
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

const FRAG = (extra) => `---\ntype: fix\n${extra}---\nSouls keep their seat.\n`;
const PROOF = 'https://github.com/soulsimulation/souls/releases/download/proofs-7/pr-7.proof.json';

test('a proof link reaches the release notes and nothing else (#1154)', () => {
  const f = parseFragment('7.md', FRAG(`proof: ${PROOF}\n`)), plain = parseFragment('8.md', FRAG(''));
  assert.equal(f.proof, PROOF); assert.ok(!('proof' in plain));
  const notes = renderSection('1.0', '2026-01-01', [f, plain], { proof: true }), log = renderSection('1.0', '2026-01-01', [f, plain]);
  assert.ok(notes.includes(`- Souls keep their seat. (#7) ([proof](${PROOF}))`));
  assert.ok(notes.includes('- Souls keep their seat. (#8)\n'), 'a fragment without one compiles unchanged');
  assert.ok(!log.includes('proof'), 'CHANGELOG.md stays one plain line per entry');
  assert.equal(notes.split('\n').filter(l => l.startsWith('- ')).length, 2);
});

test('a scorecard comment and the proof CDN are allowed; the fragment key stays optional', () => {
  assert.equal(fragmentProofProblem('https://github.com/soulsimulation/souls/pull/7#issuecomment-1'), null);
  assert.equal(fragmentProofProblem('https://cdn.example.test/proof/pr-7.json', 'https://cdn.example.test/proof'), null);
});

test('--check refuses a proof that is not https on github.com or the proof host, or names something private (#1154)', () => {
  const refused = {
    'http://github.com/o/r/pull/7': /canonical https/, 'not a url': /must be a URL/, '': /must be a URL/,
    'https://user:pw@github.com/o/r/pull/7': /canonical https/, 'https://github.com:8443/o/r/pull/7': /canonical https/,
    'https://evil.test/o/r/pull/7': /github\.com or the proof host/, 'https://github.com.evil.test/o/r/pull/7': /github\.com or the proof host/,
    'https://cdn.example.test.evil.test/proof/x': /github\.com or the proof host/,
  };
  for (const [value, why] of Object.entries(refused)) assert.match(String(fragmentProofProblem(value, 'https://cdn.example.test/proof')), why, value);
  const home = ['', 'Users', 'alice', 'x'].join('/');
  for (const url of [`https://github.com/o/r${home}`, `https://github.com/o/r/pull/7?p=${home}`, `https://github.com/o/r/pull/7?p=${encodeURIComponent(home)}`, `https://github.com/o/r/pull/7#${home}`])
    assert.match(String(fragmentProofProblem(url)), /private/, url);
  assert.throws(() => parseFragment('7.md', FRAG('proof: https://evil.test/x\n')), /7\.md: proof must be on github\.com/);
});

test('the repo fragments are valid', () => {
  readFragments(fileURLToPath(new URL('../../changes/', import.meta.url)));
});
