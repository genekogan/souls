// node --test apps/web/src/changelog-page.test.ts (issue #388: the public changelog page)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { changelogHtml, inline, parseChangelog, parsePublicJournal, releaseId, renderChangelog } from './changelog-page.ts';

const SAMPLE = `# Changelog

User-facing changes to Sim, newest first.

## 4.1 (2026-11-02)

### Features

- Souls can paint with \`brush\` colours.
- A long entry that the compiler wrapped
  onto a second line.

### Fixes

- Doors <script>alert(1)</script> & "quotes" stay text.

## 4.0 (2026-10-29)

Rolled back; superseded by 4.1.

## Earlier

Earlier development is recorded in the git history.
`;

// Text-only rendering has no subresources. Published visual journals intentionally add allowlisted media.
function assertTextOnlySelfContained(page: string) {
  assert.ok(!/<script|<link|<img|<iframe|@import|url\(/i.test(page), 'no script and no subresource: the document is the whole page');
  // Entries are escaped text. A written repository address or API path is not a runtime reference.
  const markup = (page.match(/<[^>]*>/g) ?? []).join('\n');
  assert.ok(!/github\.com|\/v1\//i.test(markup), 'no runtime GitHub or API reference');
}

await test('releases newest first, with groups, entries, wrapped lines and paragraphs; the intro is dropped', () => {
  const log = parseChangelog(SAMPLE);
  assert.deepEqual(log.releases.map((r) => [r.version, r.date]), [['4.1', '2026-11-02'], ['4.0', '2026-10-29']]);
  assert.deepEqual(log.releases[0]!.blocks, [
    { kind: 'group', title: 'Features', items: ['Souls can paint with `brush` colours.', 'A long entry that the compiler wrapped onto a second line.'] },
    { kind: 'group', title: 'Fixes', items: ['Doors <script>alert(1)</script> & "quotes" stay text.'] },
  ]);
  assert.deepEqual(log.releases[1]!.blocks, [{ kind: 'text', text: 'Rolled back; superseded by 4.1.' }]);
  assert.deepEqual(log.notes, [{ title: 'Earlier', text: ['Earlier development is recorded in the git history.'] }]);
});

await test('rendered HTML escapes entry text, renders `code`, anchors each release and links home', () => {
  const html = renderChangelog(parseChangelog(SAMPLE), { home: '/worlds/' });
  assert.ok(!html.includes('<script>'), 'an entry never becomes markup');
  assert.match(html, /Doors &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quotes&quot; stay text\./);
  assert.match(html, /paint with <code>brush<\/code> colours/);
  assert.match(html, /<section class="cl-release" id="v4\.1"[^>]*>\s*<h2 id="v4\.1-h"><a class="cl-v" href="#v4\.1">4\.1<\/a> <time datetime="2026-11-02">November 2, 2026<\/time>/);
  assert.ok(html.indexOf('id="v4.1"') < html.indexOf('id="v4.0"'), 'newest first, as the file lists them');
  assert.match(html, /<a href="\/worlds\/">← Worlds<\/a>/);
  assert.match(html, /<h2>Earlier<\/h2>/);
  assert.equal(inline('a `<b>` c'), 'a <code>&lt;b&gt;</code> c');
  assert.equal(releaseId('3.62'), 'v3.62');
});

await test('refused: a CHANGELOG.md without release headings fails the build with a reason; a template without the slot too', () => {
  assert.throws(() => parseChangelog('# Changelog\n\n- a stray entry\n## Earlier\n'), /no release headings/);
  assert.throws(() => parseChangelog(''), /no release headings/);
  assert.throws(() => changelogHtml('<main></main>', SAMPLE, '/'), /no <!--changelog--> slot/);
});

await test('text-only page checks allow inert GitHub and API prose, including escaped would-be markup', () => {
  const md = SAMPLE.replace('Souls can paint with `brush` colours.', 'See github.com/genekogan/souls and `/v1/config`; <a href="https://github.com/example/repo">stays text</a>.');
  const page = changelogHtml('<main><!--changelog--></main>', md, '/');
  assert.match(page, /See github\.com\/genekogan\/souls and <code>\/v1\/config<\/code>/);
  assert.match(page, /&lt;a href=&quot;https:\/\/github\.com\/example\/repo&quot;&gt;stays text&lt;\/a&gt;/);
  assertTextOnlySelfContained(page);
});

await test('text-only page checks reject actual GitHub/API attributes, scripts and subresources', () => {
  for (const markup of [
    '<a href="https://github.com/example/repo">external</a>',
    '<form action="/v1/config"></form>',
    '<button formaction="/v1/config">send</button>',
    '<button onclick="fetch(\'/v1/config\')">fetch</button>',
  ]) assert.throws(() => assertTextOnlySelfContained(changelogHtml(`<main>${markup}<!--changelog--></main>`, SAMPLE, '/')), /no runtime GitHub or API reference/);
  for (const markup of [
    '<script>fetch("/anything")</script>', '<link rel="stylesheet" href="/style.css">',
    '<img src="/image.png">', '<iframe src="/frame"></iframe>',
    '<style>@import "/style.css";</style>', '<style>body{background:url(/image.png)}</style>',
  ]) assert.throws(() => assertTextOnlySelfContained(changelogHtml(`<main>${markup}<!--changelog--></main>`, SAMPLE, '/')), /no script and no subresource/);
});

await test('text-only page template plus real CHANGELOG.md: every release, no subresources, base-aware home link', () => {
  const md = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
  const template = readFileSync(new URL('../changelog.html', import.meta.url), 'utf8');
  const releases = md.split('\n').filter((l) => /^## \S+ \(\d{4}-\d{2}-\d{2}\)$/.test(l)).length;
  assert.ok(releases > 0);
  for (const base of ['/', '/worlds/']) {
    const page = changelogHtml(template, md, base);
    assert.equal((page.match(/<section class="cl-release" id="v/g) ?? []).length, releases, 'one section per release');
    assertTextOnlySelfContained(page);
    assert.match(page, new RegExp(`<a href="${base}">← Worlds</a>`));
  }
});

const JOURNAL = {
  id: 'tea', version: '4.1', date: '2026-11-02', title: 'Tea <together>', result: 'Serve & wash',
  limitations: 'Historical branch footage; not production verification.',
  source: { url: 'https://github.com/genekogan/souls/pull/493', commit: 'a'.repeat(40), capturedOn: '2026-10-31', environment: 'historical-test' },
  media: { kind: 'video', url: 'https://github.com/genekogan/souls/releases/download/proofs/tea.mp4',
    poster: 'https://github.com/genekogan/souls/releases/download/proofs/tea.jpg', alt: 'Wash <cup>', status: 'available' },
};

await test('public journal preserves exact association, stable anchors, escaped prose and user-initiated media', () => {
  const html = changelogHtml('<main><!--changelog--></main>', SAMPLE, '/', [JOURNAL]);
  assert.match(html, /id="v4.1-journal-tea"/);
  assert.match(html, /Tea &lt;together&gt;/);
  assert.match(html, /Wash &lt;cup&gt;/);
  assert.match(html, /controls preload="none" playsinline poster=/);
  assert.match(html, /Historical test capture · 2026-10-31/);
  assert.match(html, /href="#v4.1">← Back to release 4.1/);
  assert.ok(html.indexOf('id="v4.1-journal-tea"') < html.indexOf('id="v4.0"'));
  assert.ok(!/<script|autoplay|<iframe|onerror=/.test(html));
  assert.match(html, /If media cannot load/);
});

await test('public projection refuses unknown/private fields, wrong association, malformed provenance and unsafe URLs', () => {
  const bad = [
    { ...JOURNAL, owner: 'private' }, { ...JOURNAL, version: '99' }, { ...JOURNAL, date: '2026-11-01' },
    { ...JOURNAL, id: 'unsafe" id=' }, { ...JOURNAL, source: { ...JOURNAL.source, token: 'private' } },
    { ...JOURNAL, source: { ...JOURNAL.source, commit: 'short' } },
    { ...JOURNAL, source: { ...JOURNAL.source, capturedOn: '2026-02-31' } },
    { ...JOURNAL, media: { ...JOURNAL.media, poster: undefined } },
  ];
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'http://assets.eden.art/public-journal/a.mp4',
    'https://github.com.evil.test/genekogan/souls/releases/download/proofs/a.mp4',
    'https://user:secret@github.com/genekogan/souls/releases/download/proofs/a.mp4',
    'https://github.com/genekogan/souls/releases/download/proofs/a.mp4?token=private',
    'https://assets.eden.art/private/a.mp4', 'https://assets.eden.art/public-journal/../private/a.mp4',
  ]) bad.push({ ...JOURNAL, media: { ...JOURNAL.media, url } });
  for (const input of bad) assert.throws(() => parsePublicJournal([input], parseChangelog(SAMPLE)));
  assert.throws(() => parsePublicJournal([JOURNAL, JOURNAL], parseChangelog(SAMPLE)), /duplicate/);
});

await test('retired proof stays text-only and traceable; stills are lazy and never motion proof', () => {
  const retired = changelogHtml('<main><!--changelog--></main>', SAMPLE, '/', [{ ...JOURNAL, media: { ...JOURNAL.media, status: 'retired' } }]);
  assert.match(retired, /Media retired or unavailable/);
  assert.ok(!/<video|<img|<source/.test(retired));
  assert.match(retired, /v4.1-journal-tea/);
  const still = changelogHtml('<main><!--changelog--></main>', SAMPLE, '/', [{ ...JOURNAL, media: { ...JOURNAL.media, kind: 'image' } }]);
  assert.match(still, /loading="lazy" decoding="async"/);
  assert.match(still, /Still image; does not demonstrate motion/);
});

await test('reviewed real public projection builds with compiled history and contains no private board payload', () => {
  const md = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
  const entries = JSON.parse(readFileSync(new URL('../../../tools/changelog/public-journal.json', import.meta.url), 'utf8'));
  const html = changelogHtml('<main><!--changelog--></main>', md, '/', entries);
  assert.match(html, /v4.07-journal-soul-actions-tea/);
  assert.ok(!/localhost|127\.0\.0\.1|\/Users\/|ownerId|workerId|transcript|token[=:]/i.test(html));
});
