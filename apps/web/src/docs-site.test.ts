// #896: the docs the web build emits (docs-site.ts buildDocs, exactly what the vite plugin writes), checked over the real
// docs/site tree: every HTML page has its Markdown twin with the same headings and links, llms.txt lists every published
// page, pages.json (the sitemap's source) lists them too; plus the Markdown subset the renderer must get right.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocs, htmlOutline, inline, markdownHtml, markdownOutline, parseDoc, slug } from './docs-site.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)), SITE = join(ROOT, 'docs/site');
const files = (d: string): string[] => readdirSync(d).sort().flatMap((e) => { const f = join(d, e); return statSync(f).isDirectory() ? files(f) : f.endsWith('.md') ? [f] : []; });
const generated: Record<string, string> = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'tools/docs/generate.mjs'), '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const build = (base = '/') => buildDocs({ files: files(SITE).map((f) => relative(SITE, f)), read: (r) => generated[r] ?? readFileSync(join(SITE, r), 'utf8'),
  template: readFileSync(join(ROOT, 'apps/web/docs-template.html'), 'utf8'), changelog: readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), base, origin: 'https://soul.game' });

test('every page is emitted as HTML and as its Markdown twin, with the same headings and the same links', () => {
  for (const base of ['/', '/worlds/']) {
    const { pages, out } = build(base), b = base.replace(/\/$/, '');
    assert.ok(pages.length >= 18);
    for (const p of pages) {
      const rest = p.url.slice('/docs'.length), html = out.get(`docs${rest}/index.html`), md = out.get(`docs${rest}.md`);
      assert.ok(html && md, p.url);
      assert.equal(md, p.source, 'the twin is the canonical source');
      const a = markdownOutline(p.body), h = htmlOutline(html, (u) => (b && u.startsWith(b + '/') ? u.slice(b.length) : u));
      assert.deepEqual(h.headings, a.headings, `${p.url}: headings`);
      assert.deepEqual(h.links, a.links, `${p.url}: links`);
      assert.ok(html.includes(`<link rel="alternate" type="text/markdown" href="${b}${p.url === '/docs' ? '/docs.md' : p.url + '.md'}" />`), `${p.url}: alternate`);
      assert.ok(html.includes(`<link rel="canonical" href="https://soul.game${b}${p.url}" />`));
      const ld = JSON.parse(/<script type="application\/ld\+json">([^<]+)<\/script>/.exec(html)![1]!);
      assert.equal(ld['@type'], 'TechArticle'); assert.equal(ld.headline, p.meta.title);
      assert.equal(/<meta name="robots" content="noindex" \/>/.test(html), p.stub, `${p.url}: a stub is noindex, a written page is not`);
      assert.ok(!/<script(?! type="application\/ld\+json")/.test(html), 'no script');
      assert.ok(!/\{\{[A-Z]+\}\}/.test(html), 'every slot filled');
    }
  }
});

test('llms.txt lists every published page once with its description; llms-full.txt carries their Markdown; pages.json the same set', () => {
  const { pages, out } = build(), pub = pages.filter((p) => !p.stub);
  assert.ok(pub.some((p) => p.url === '/docs'));
  const llms = out.get('llms.txt')!;
  assert.match(llms, /^# Souls\n\n> /);
  for (const p of pub) { const twin = p.url === '/docs' ? '/docs.md' : `${p.url}.md`; assert.equal(llms.split(`](https://soul.game${twin}): ${p.meta.description}`).length - 1, 1, p.url); }
  for (const p of pages.filter((x) => x.stub)) assert.ok(!llms.includes(`](https://soul.game${p.url}.md)`), `stub ${p.url} not listed yet`);
  const full = out.get('llms-full.txt')!;
  for (const p of pub) assert.ok(full.includes(p.source.trimEnd()), p.url);
  assert.deepEqual(JSON.parse(out.get('docs/pages.json')!).pages.map((p: { url: string }) => p.url), pub.map((p) => p.url));
  assert.equal(out.get('changelog.md'), readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'));
  assert.ok(!/\bSim\b/.test(llms + full), 'one product name');
});

// A plain root build with the default origin (as `pnpm --filter @souls/web build` and the bundle gate make it) must hold exactly
// these files. A based or differently-originated build is checked by the parity test above, not here.
const DIST = join(ROOT, 'apps/web/dist'), rootBuild = existsSync(join(DIST, 'llms.txt')) && readFileSync(join(DIST, 'llms.txt'), 'utf8').includes('](https://soul.game/docs.md)');
test('the served reference pages are the full ones: HTML, Markdown twin and llms-full.txt', () => {
  const { pages, out } = build();
  for (const [slug, heading, inside] of [['actions', '## Actions', 'Refusal codes'], ['api', '## Routes', 'Served beside the route table'], ['mcp', '## Tools', 'soul_wait']] as const) {
    assert.ok(pages.some((p) => p.url === `/docs/${slug}`));
    assert.ok(out.get(`docs/${slug}.md`)!.includes(inside), `${slug}.md`);
    assert.ok(out.get(`docs/${slug}/index.html`)!.includes(inside), `${slug} html`);
    assert.ok(out.get(`docs/${slug}.md`)!.split(`\n${heading}\n`)[1]!.length > 1000, `${slug}: the part under ${heading}`);
  }
  if (!pages.find((p) => p.url === '/docs/mcp')!.stub) assert.ok(out.get('llms-full.txt')!.includes('### soul_wait'));
});

test('a root web build holds exactly the files the build function makes', { skip: !rootBuild && 'no root web build with the default origin in apps/web/dist' }, () => {
  const { out } = build();
  for (const [file, text] of out) assert.equal(readFileSync(join(ROOT, 'apps/web/dist', file), 'utf8'), text, file);
});

test('the Markdown subset: headings with anchors, lists, ordered lists, tables, fenced code, quotes, inline marks; text is escaped', () => {
  const html = markdownHtml('## A <b> title\n\nPara with `code <x>`, **bold**, _it_ and [a link](/docs/concepts).\nNext line.\n\n- one\n- two\n  continued\n\n1. first\n2. second\n\n| a | b |\n|---|---|\n| [x](/changelog) | `y` |\n\n```bash\necho "<hi>"\n```\n\n> quoted\n', (h) => '/base' + h);
  assert.match(html, /<h2 id="a-title">A &lt;b&gt; title<\/h2>/);
  assert.match(html, /<p>Para with <code>code &lt;x&gt;<\/code>, <strong>bold<\/strong>, <em>it<\/em> and <a href="\/base\/docs\/concepts">a link<\/a>\. Next line\.<\/p>/);
  assert.match(html, /<ul><li>one<\/li><li>two continued<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td><a href="\/base\/changelog">x<\/a><\/td><td><code>y<\/code><\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<pre><code class="language-bash">echo &quot;&lt;hi&gt;&quot;<\/code><\/pre>/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'vbscript:x', '//evil.example/x', '/\\evil.example/x']) assert.throws(() => inline(`[x](${bad})`), /is not a site path/, bad);
  assert.equal(inline('[a **b](/c**d)'), '<a href="/c**d">a **b</a>', 'emphasis never runs across link markup');
  assert.match(markdownHtml('## Dup\n\n## Dup'), /id="dup"[\s\S]*id="dup-2"/);
  assert.equal(slug('Start in one line'), 'start-in-one-line');
});

test('a page without frontmatter or a title fails the build instead of shipping half-read', () => {
  assert.throws(() => parseDoc('x.md', '# no frontmatter'), /no frontmatter/);
  assert.throws(() => parseDoc('x.md', '---\ndescription: d\naudience: agents\nupdated: 2026-11-05\n---\n# x'), /"title" missing/);
});
