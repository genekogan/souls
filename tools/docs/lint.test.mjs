// #895: the docs source lints clean, and each kind of broken page is refused with a named reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, fullPages } from './generate.mjs';
import { OUTLINE, SITE, frontmatter, lintPage, lintTree, urlOf } from './lint.mjs';

const page = (fm, body) => `---\n${fm}\n---\n\n${body}\n`;
const FM = 'title: A page\ndescription: One line.\naudience: agents\nupdated: 2026-11-05\nsources:\n  - docs/design/vision.md\ngenerated: false';
const codes = (text) => lintPage(text).map((p) => p.code);

test('docs/site lints clean: every outline page exists with valid frontmatter, one H1 and resolving links', () => {
  const { pages, problems } = lintTree(undefined, { full: Object.fromEntries(fullPages(collect()).map((p) => [p.file, p.text])) });
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

test('frontmatter edge cases and the writing rules the lint enforces', () => {
  assert.deepEqual(codes(page(FM, '# A page').replace(/\n/g, '\r\n')), [], 'CRLF files read like LF');
  assert.deepEqual(codes(page(FM.replace('title: A page', 'title: "A: page"'), '# A: page')), [], 'quoted values lose their quotes');
  assert.equal(frontmatter(page(FM.replace('One line.', 'See issue C # sharp.'), '# A page')).data.description, 'See issue C # sharp.', 'no inline comments');
  assert.ok(codes(page(FM.replace('2026-11-05', '2026-13-45'), '# A page')).includes('frontmatter.updated'));
  assert.ok(codes(page(FM.replace('docs/design/vision.md', '../outside.md'), '# A page')).includes('frontmatter.source'));
  assert.ok(codes(page(FM, '# A page\n\nBare https://soul.game/docs/nowhere here.')).includes('link.unresolved'));
  assert.ok(codes(page(FM, '# A page\n\nAn autolink <https://soul.game/docs/nowhere>.')).includes('link.unresolved'));
  assert.deepEqual(codes(page(FM, '# A page\n\nCode `[x](/docs/nowhere)` is not a link.\n\n~~~\n[y](/docs/nowhere)\n~~~')), []);
  assert.ok(codes(page(FM, '# A page\n\nWelcome to Sim.')).includes('name.retired'));
  assert.ok(codes(page(FM, '# A page\n\nAll Eden worlds.')).includes('name.eden'));
  assert.deepEqual(codes(page(FM, '# A page\n\nVisit Eden 2026.')), [], 'Eden 2026 is a world');
  assert.ok(codes(page(FM, '# A page\n\nIt works — mostly.')).includes('style.em-dash'));
  assert.ok(codes(page(FM, '# A page\n\nFixed in #890.')).includes('text.issue-number'));
  assert.ok(codes(page(FM, '# A page\n\nSee path=/Users/you/y.')).includes('private.local-path'));   // a placeholder user: the lint refuses any /Users/ path
  assert.ok(codes(page(FM, '# A page\n\nThe box at 100.101.1.2.')).includes('private.ip'));
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
