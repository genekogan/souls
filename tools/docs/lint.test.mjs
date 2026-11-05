// #895: the docs source lints clean, and each kind of broken page is refused with a named reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OUTLINE, SITE, frontmatter, lintPage, lintTree, urlOf } from './lint.mjs';

const page = (fm, body) => `---\n${fm}\n---\n\n${body}\n`;
const FM = 'title: A page\ndescription: One line.\naudience: agents\nupdated: 2026-11-05\nsources:\n  - docs/design/vision.md\ngenerated: false';
const codes = (text) => lintPage(text).map((p) => p.code);

test('docs/site lints clean: every outline page exists with valid frontmatter, one H1 and resolving links', () => {
  const { pages, problems } = lintTree();
  assert.deepEqual(problems, []);
  for (const url of OUTLINE) assert.ok(pages.includes(url), url);
  assert.ok(!pages.some((p) => /WRITING/i.test(p)), 'the writing guide is not a page');
});

test('the sample page /docs is written, not a stub', () => {
  const text = readFileSync(join(SITE, 'index.md'), 'utf8');
  assert.ok(!text.includes('_Will say:'), 'no stub lines');
  assert.ok(text.split('\n').length > 60);
  assert.equal(frontmatter(text).data.title, 'What Souls is');
  assert.match(text, /Tell your human:/);
});

test('urls: index is /docs, nested pages keep their folder', () => {
  assert.equal(urlOf('index.md'), '/docs'); assert.equal(urlOf('concepts.md'), '/docs/concepts'); assert.equal(urlOf('essays/few-rules.md'), '/docs/essays/few-rules');
});

test('refusals: each broken page names its problem', () => {
  assert.deepEqual(codes(page(FM, '# A page\n\nFine. [x](/docs/concepts) [y](https://soul.game/w/eden-2026/SKILL.md) [z](/changelog) [w](/llms.txt)')), []);
  assert.ok(codes('# no frontmatter').includes('frontmatter.missing'));
  assert.ok(codes(page(FM.replace('audience: agents\n', ''), '# A page')).includes('frontmatter.field'));
  assert.ok(codes(page(FM.replace('agents', 'robots'), '# A page')).includes('frontmatter.audience'));
  assert.ok(codes(page(FM.replace('2026-11-05', 'Nov 5'), '# A page')).includes('frontmatter.updated'));
  assert.ok(codes(page(FM.replace('docs/design/vision.md', 'docs/nope.md'), '# A page')).includes('frontmatter.source'));
  assert.ok(codes(page(FM, '# Another title')).includes('heading.title'));
  assert.ok(codes(page(FM, '# A page\n\n# Second')).includes('heading.h1'));
  assert.ok(codes(page(FM, '# A page\n\nSee [it](/docs/nowhere).')).includes('link.unresolved'));
  assert.ok(codes(page(FM, '# A page\n\nSee [it](concepts.md).')).includes('link.relative'));
  assert.ok(codes(page(FM, '# A page\n\nSee [it](https://example.com/x).')).includes('link.host'));
  assert.ok(codes(page(FM, '# A page\n\nRun it from /Users/someone/souls.')).includes('private.local-path'));
  assert.ok(codes(page(FM, '# A page\n\n```\ncurl http://127.0.0.1:4980/\n```')).includes('private.local-host'));
  assert.ok(codes(page(FM, '# A page\n\nThe box at 192.168.1.20.')).includes('private.ip'));
  assert.ok(codes(page(FM, '# A page\n\nWrite to someone@example.com.')).includes('private.email'));
});

test('a tree missing an outline page fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-lint-'));
  try {
    mkdirSync(join(dir, 'essays'));
    writeFileSync(join(dir, 'index.md'), page(FM.replace('A page', 'Home'), '# Home'));
    const { problems } = lintTree(dir);
    assert.ok(problems.some((p) => p.code === 'outline.missing' && p.message.includes('/docs/concepts')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
