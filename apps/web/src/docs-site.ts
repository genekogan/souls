// The public docs at <base>/docs (#890 M3, #896): docs/site/**/*.md rendered at build time by the `docsSite` plugin in
// vite.config.ts, beside the changelog page. Markdown is canonical: every page is emitted as HTML (docs/<slug>/index.html)
// and as its Markdown twin (docs/<slug>.md, the source file), plus llms.txt (the index), llms-full.txt (every page) and
// docs/pages.json (what the launcher's sitemap lists). No script, no dependency: the Markdown subset docs/site/WRITING.md
// allows (## and ### headings, paragraphs, lists, fenced code, tables, block quotes, links, code, bold, italics).

export type DocMeta = { title: string; description: string; audience: string; updated: string; sources: string[]; generated: boolean };
export type DocPage = { file: string; url: string; meta: DocMeta; body: string; source: string; stub: boolean };

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** docs/site path (relative) -> site URL: index.md -> /docs, essays/few-rules.md -> /docs/essays/few-rules. */
export function urlOf(rel: string): string { const p = rel.split('\\').join('/').replace(/\.md$/, ''); return p === 'index' ? '/docs' : `/docs/${p.replace(/\/index$/, '')}`; }

const unquote = (v: string) => (/^"(.*)"$/.exec(v) ?? /^'(.*)'$/.exec(v))?.[1] ?? v;
/** The frontmatter subset docs/site uses (key: value, key: + `  - item`); throws on anything else, so a page never ships half-read. */
export function parseDoc(rel: string, text: string): DocPage {
  text = text.replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw Error(`docs/site/${rel}: no frontmatter`);
  const d: Record<string, string | boolean | string[]> = {}; let list: string | null = null;
  for (const line of m[1]!.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && list) { (d[list] as string[]).push(unquote(item[1]!.trim())); continue; }
    const kv = /^([a-z][a-zA-Z0-9]*):\s*(.*)$/.exec(line);
    if (!kv) throw Error(`docs/site/${rel}: cannot read frontmatter line "${line}"`);
    const v = unquote(kv[2]!.trim());
    if (v === '') { d[kv[1]!] = []; list = kv[1]!; } else { d[kv[1]!] = v === 'true' ? true : v === 'false' ? false : v; list = null; }
  }
  for (const k of ['title', 'description', 'audience', 'updated']) if (typeof d[k] !== 'string') throw Error(`docs/site/${rel}: frontmatter "${k}" missing`);
  const body = text.slice(m[0].length);
  const meta: DocMeta = { title: d.title as string, description: d.description as string, audience: d.audience as string, updated: d.updated as string, sources: Array.isArray(d.sources) ? d.sources : [], generated: d.generated === true };
  return { file: rel, url: urlOf(rel), meta, body, source: text, stub: /^_Will say:/m.test(body) };
}

/** Heading anchors: lowercase words joined by hyphens ("Start in one line" -> start-in-one-line). */
export const slug = (s: string) => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/[`*_]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Inline Markdown -> HTML: code spans first (their content is literal), then links, autolinks, bold, italics. */
export function inline(text: string, link: (href: string) => string = (h) => h): string {
  return text.split(/(`[^`]+`)/).map((part) => {
    if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
    let s = esc(part);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, h: string) => `<a href="${esc(link(h.replace(/&amp;/g, '&')))}">${t}</a>`);
    s = s.replace(/&lt;(https:\/\/[^\s&]+)&gt;/g, (_m, h: string) => `<a href="${h}">${h}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])_([^_]+)_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>').replace(/(^|[\s(])\*([^*]+)\*(?=$|[\s).,;:!?])/g, '$1<em>$2</em>');
    return s;
  }).join('');
}

/** Block Markdown -> HTML (the WRITING.md subset). `link` maps a link target for this build (base path). */
export function markdownHtml(md: string, link: (href: string) => string = (h) => h): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n'), out: string[] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '), link)}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^ {0,3}(```|~~~)\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      flush(); const code: string[] = []; i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[1]}\\s*$`).test(lines[i]!)) code.push(lines[i++]!);
      i++; out.push(`<pre><code${fence[2] ? ` class="language-${esc(fence[2])}"` : ''}>${esc(code.join('\n'))}</code></pre>`); continue;
    }
    const h = /^(#{1,3}) (.+)$/.exec(line);
    if (h) { flush(); const n = h[1]!.length, t = h[2]!.trim(); out.push(`<h${n} id="${slug(t)}">${inline(t, link)}</h${n}>`); i++; continue; }
    if (/^\s*$/.test(line)) { flush(); i++; continue; }
    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      flush(); const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line); i += 2; const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c, link)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, link)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const li = /^([-*]|\d+\.) +(.*)$/.exec(line);
    if (li) {
      flush(); const ordered = /\d/.test(li[1]!), items: string[] = [];
      while (i < lines.length) {
        const m = /^([-*]|\d+\.) +(.*)$/.exec(lines[i]!);
        if (m && /\d/.test(m[1]!) === ordered) { items.push(m[2]!); i++; continue; }
        if (items.length && /^\s{2,}\S/.test(lines[i]!)) { items[items.length - 1] += ' ' + lines[i]!.trim(); i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul'; out.push(`<${tag}>${items.map((t) => `<li>${inline(t, link)}</li>`).join('')}</${tag}>`); continue;
    }
    if (/^> ?/.test(line)) {
      flush(); const q: string[] = [];
      while (i < lines.length && /^> ?/.test(lines[i]!)) q.push(lines[i++]!.replace(/^> ?/, ''));
      out.push(`<blockquote>${markdownHtml(q.join('\n'), link)}</blockquote>`); continue;
    }
    para.push(line.trim()); i++;
  }
  flush();
  return out.join('\n');
}

/** Headings (level and text) and link targets of a page's Markdown, outside code: the twin's side of the parity test. */
export function markdownOutline(md: string): { headings: string[]; links: string[] } {
  const prose = md.replace(/^ {0,3}(```|~~~)[\s\S]*?^ {0,3}\1\s*$/gm, '');
  const headings = [...prose.matchAll(/^(#{1,3}) (.+)$/gm)].map((m) => `h${m[1]!.length} ${m[2]!.trim().replace(/[`*_]/g, '')}`);
  const links = [...prose.replace(/`[^`\n]*`/g, '').matchAll(/\]\(([^)\s]+)\)|<(https:\/\/[^>\s]+)>/g)].map((m) => (m[1] ?? m[2])!);
  return { headings, links };
}
/** The same from rendered HTML (inside <article>): the HTML side of the parity test. */
export function htmlOutline(html: string, unlink: (href: string) => string = (h) => h): { headings: string[]; links: string[] } {
  const art = /<article[^>]*>([\s\S]*)<\/article>/.exec(html)?.[1] ?? html;
  const text = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const headings = [...art.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => `h${m[1]} ${text(m[2]!)}`);
  const links = [...art.replace(/<pre>[\s\S]*?<\/pre>/g, '').matchAll(/<a href="([^"]+)"/g)].map((m) => unlink(text(m[1]!)));
  return { headings, links };
}

/** The nav, in the #890 outline's order; pages not named here are listed after, in file order. */
export const NAV: { title: string; urls: string[] }[] = [
  { title: 'Start here', urls: ['/docs', '/docs/concepts', '/docs/for-agents'] },
  { title: 'Do', urls: ['/docs/run-a-soul', '/docs/be-a-good-soul', '/docs/guide-your-human', '/docs/build-a-world'] },
  { title: 'Reference', urls: ['/docs/world-model', '/docs/actions', '/docs/api', '/docs/mcp', '/docs/limits', '/docs/troubleshooting', '/changelog'] },
  { title: 'Reading room', urls: ['/docs/essays/mind-at-the-edge', '/docs/essays/canonical-history', '/docs/essays/meaning-over-depiction', '/docs/essays/few-rules', '/docs/essays/built-by-agents'] },
];

/** Pages in nav order. */
export function ordered(pages: DocPage[]): DocPage[] {
  const at = (u: string) => { const i = NAV.flatMap((g) => g.urls).indexOf(u); return i < 0 ? 1e6 : i; };
  return [...pages].sort((a, b) => at(a.url) - at(b.url) || a.file.localeCompare(b.file));
}

/** One page's HTML from docs-template.html: {{TITLE}} {{DESCRIPTION}} {{CANONICAL}} {{TWIN}} {{ROBOTS}} {{JSONLD}} {{NAV}} {{ARTICLE}} {{HOME}}. */
export function pageHtml(template: string, page: DocPage, pages: DocPage[], { base, origin }: { base: string; origin: string }): string {
  const b = base.replace(/\/$/, ''), at = (u: string) => b + u, link = (h: string) => (h.startsWith('/') ? b + h : h);
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const nav = NAV.map((g) => `<section><h2>${esc(g.title)}</h2><ul>${g.urls.map((u) => {
    if (u === '/changelog') return `<li><a href="${esc(at(u))}">Changelog</a></li>`;
    const p = byUrl.get(u); if (!p) return '';
    return `<li><a href="${esc(at(u))}"${u === page.url ? ' aria-current="page"' : ''}>${esc(p.meta.title)}</a>${p.stub ? ' <span class="soon">coming</span>' : ''}</li>`;
  }).join('')}</ul></section>`).join('');
  const twin = page.url === '/docs' ? '/docs.md' : `${page.url}.md`;
  const ld = { '@context': 'https://schema.org', '@type': 'TechArticle', headline: page.meta.title, description: page.meta.description, dateModified: page.meta.updated,
    url: origin + at(page.url), inLanguage: 'en', isPartOf: { '@type': 'WebSite', name: 'Souls', url: origin + at('/') }, encodingFormat: 'text/html' };
  const fill: Record<string, string> = {
    TITLE: esc(page.url === '/docs' ? `${page.meta.title} · Souls docs` : `${page.meta.title} · Souls`), DESCRIPTION: esc(page.meta.description),
    CANONICAL: esc(origin + at(page.url)), TWIN: esc(at(twin)), HOME: esc(at('/')), DOCS: esc(at('/docs')),
    ROBOTS: page.stub ? '<meta name="robots" content="noindex" />' : '',
    JSONLD: JSON.stringify(ld).replace(/</g, '\\u003c'), NAV: nav,
    ARTICLE: (page.stub ? '<p class="soon-note">This page is an outline; its full text is coming.</p>\n' : '') + markdownHtml(page.body, link),
  };
  return template.replace(/\{\{([A-Z]+)\}\}/g, (m, k: string) => fill[k] ?? m);
}

/** llms.txt (llmstxt.org): the site, then every published page as `- [Title](url.md): description`. */
export function llmsTxt(pages: DocPage[], { base, origin }: { base: string; origin: string }): string {
  const b = origin + base.replace(/\/$/, ''), twin = (u: string) => b + (u === '/docs' ? '/docs.md' : `${u}.md`);
  const pub = ordered(pages).filter((p) => !p.stub);
  const out = ['# Souls', '', '> Souls (soul.game) is persistent shared worlds where every character, a Soul, is run by its owner\'s own AI agent, and every world is built by its one god through their agent. These docs are written for agents first; every page is Markdown.', '',
    `Every page below is also HTML at the same URL without \`.md\`, and answers \`Accept: text/markdown\`. All pages in one file: ${b}/llms-full.txt`, ''];
  for (const g of NAV) {
    const ps = g.urls.map((u) => pub.find((p) => p.url === u)).filter((p): p is DocPage => !!p);
    if (!ps.length) continue;
    out.push(`## ${g.title}`, '', ...ps.map((p) => `- [${p.meta.title}](${twin(p.url)}): ${p.meta.description}`), '');
  }
  const rest = pub.filter((p) => !NAV.some((g) => g.urls.includes(p.url)));
  if (rest.length) out.push('## More', '', ...rest.map((p) => `- [${p.meta.title}](${twin(p.url)}): ${p.meta.description}`), '');
  out.push('## Optional', '', `- [Changelog](${b}/changelog.md): what changed, release by release`, '');
  return out.join('\n');
}

/** llms-full.txt: every published page's Markdown, in nav order, each headed by its URL. */
export function llmsFull(pages: DocPage[], { base, origin }: { base: string; origin: string }): string {
  const b = origin + base.replace(/\/$/, '');
  return ordered(pages).filter((p) => !p.stub).map((p) => `<!-- ${b}${p.url} -->\n${p.source.trimEnd()}\n`).join('\n');
}

/** Every file the docs add to a build, by its path in dist: what the vite plugin emits and what the tests check.
 *  `read(rel)` gives a docs/site file's text; `files` are the docs/site paths (WRITING.md is skipped here). */
export function buildDocs({ files, read, template, changelog, base, origin }: { files: string[]; read: (rel: string) => string; template: string; changelog: string; base: string; origin: string }): { pages: DocPage[]; out: Map<string, string> } {
  const pages = ordered(files.filter((r) => r !== 'WRITING.md').map((r) => parseDoc(r, read(r))));
  if (!pages.some((p) => p.url === '/docs')) throw Error('docs/site: no index.md, so /docs would be missing');
  const seen = new Set<string>();
  for (const p of pages) { if (seen.has(p.url)) throw Error(`docs/site: two files make ${p.url}`); seen.add(p.url); }
  const opts = { base, origin }, out = new Map<string, string>();
  for (const p of pages) { const slugPath = p.url.slice('/docs'.length); out.set(`docs${slugPath}/index.html`, pageHtml(template, p, pages, opts)); out.set(`docs${slugPath}.md`, p.source); }
  out.set('llms.txt', llmsTxt(pages, opts));
  out.set('llms-full.txt', llmsFull(pages, opts));
  out.set('docs/pages.json', JSON.stringify({ pages: pages.filter((p) => !p.stub).map((p) => ({ url: p.url, title: p.meta.title, updated: p.meta.updated })) }, null, 1) + '\n');
  out.set('changelog.md', changelog);
  return { pages, out };
}
