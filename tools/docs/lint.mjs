#!/usr/bin/env node
// Lint the public docs source (docs/site/**, served at /docs by the M3 renderer; #890, #895). Every page has valid
// frontmatter, its one H1 equals its title, every page in the outline exists, every site link resolves to a page or to
// something the site serves, and no page text carries a local path, a private address or a host other than ours.
// The writing rules behind these checks: docs/site/WRITING.md.
//
//   node tools/docs/lint.mjs [--dir docs/site]     exit 0 clean, 1 with one line per problem
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
export const SITE = join(ROOT, 'docs/site');
/** Files in docs/site that are not pages. */
export const NOT_PAGES = new Set(['WRITING.md']);
/** The outline (#890 information architecture): every one of these pages must exist. */
export const OUTLINE = Object.freeze(['/docs', '/docs/concepts', '/docs/run-a-soul', '/docs/be-a-good-soul', '/docs/guide-your-human', '/docs/build-a-world',
  '/docs/world-model', '/docs/actions', '/docs/api', '/docs/mcp', '/docs/limits', '/docs/troubleshooting', '/docs/for-agents',
  '/docs/essays/mind-at-the-edge', '/docs/essays/canonical-history', '/docs/essays/meaning-over-depiction', '/docs/essays/few-rules', '/docs/essays/built-by-agents']);
/** Site paths served outside /docs that a page may link to. */
export const SERVED = Object.freeze(['/', '/changelog', '/llms.txt', '/llms-full.txt', '/.well-known/mcp/server.json', '/sitemap.xml', '/robots.txt']);
/** A world's served files (per world, any slug). */
export const WORLD_FILE = /^\/w\/(?:[a-z][a-z0-9-]{0,31}|<[a-z-]+>)\/(?:|SKILL\.md|skill\.md|instructions\.md|cards\.md|llms\.txt)$/;
export const HOSTS = Object.freeze(['soul.game', 'github.com']);
/** The paragraph that opens the generated part of a reference page (tools/docs/generate.mjs). The prose style rules
 *  (em-dashes, issue numbers) stop there: what follows quotes the code's own text; links and private data are checked. */
export const GENERATED_MARK = 'Generated from';
export const AUDIENCES = Object.freeze(['agents', 'humans', 'both']);
const PRIVATE = [
  [/(?:\/Users\/|\/home\/|(?:^|[\s(`'"=])~\/)/m, 'private.local-path'],
  [/\b(?:127\.0\.0\.1|localhost|0\.0\.0\.0)\b/, 'private.local-host'],
  [/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.\d{1,3}\.\d{1,3}\b/, 'private.ip'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, 'private.email'],
];

/** docs/site/essays/few-rules.md -> /docs/essays/few-rules; index.md -> /docs. */
export function urlOf(rel) { const p = rel.split('\\').join('/').replace(/\.md$/, ''); return p === 'index' ? '/docs' : `/docs/${p.replace(/\/index$/, '')}`; }

/** A value in matching single or double quotes loses them; nothing else is interpreted (no inline comments). */
const unquote = (v) => (/^"(.*)"$/.exec(v) ?? /^'(.*)'$/.exec(v))?.[1] ?? v;

/** The small YAML subset the frontmatter uses: `key: value` lines and `key:` followed by `  - item` lines. */
export function frontmatter(text) {
  text = text.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const out = {}; let list = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && list) { out[list].push(unquote(item[1].trim())); continue; }
    const kv = /^([a-z][a-zA-Z0-9]*):\s*(.*)$/.exec(line);
    if (!kv) return { __bad: line };
    const v = unquote(kv[2].trim());
    if (v === '') { out[kv[1]] = []; list = kv[1]; } else { out[kv[1]] = v === 'true' ? true : v === 'false' ? false : v; list = null; }
  }
  return { data: out, body: text.slice(m[0].length) };
}

/** Problems in one page: [{ code, message }]. `pages` is the set of page URLs in the tree. */
export function lintPage(text, { pages = new Set(OUTLINE) } = {}) {
  const problems = [], bad = (code, message) => problems.push({ code, message });
  text = text.replace(/\r\n/g, '\n');
  const fm = frontmatter(text);
  if (!fm) { bad('frontmatter.missing', 'the page must start with --- frontmatter ---'); return problems; }
  if (fm.__bad) { bad('frontmatter.syntax', `cannot read the line "${fm.__bad}"`); return problems; }
  const d = fm.data;
  for (const k of ['title', 'description', 'audience', 'updated', 'sources']) if (d[k] === undefined || d[k] === '' || (Array.isArray(d[k]) && !d[k].length)) bad('frontmatter.field', `"${k}" is required`);
  if (typeof d.title === 'string' && d.title.length > 80) bad('frontmatter.title', 'title is longer than 80 characters');
  if (typeof d.description === 'string' && d.description.length > 160) bad('frontmatter.description', `description is ${d.description.length} characters (at most 160)`);
  if (d.audience !== undefined && !AUDIENCES.includes(d.audience)) bad('frontmatter.audience', `audience must be one of ${AUDIENCES.join(', ')}`);
  if (d.updated !== undefined && !(/^\d{4}-\d{2}-\d{2}$/.test(String(d.updated)) && !Number.isNaN(Date.parse(`${d.updated}T00:00:00Z`)) && new Date(`${d.updated}T00:00:00Z`).toISOString().startsWith(String(d.updated)))) bad('frontmatter.updated', 'updated must be a real date, YYYY-MM-DD');
  if (d.sources !== undefined && !Array.isArray(d.sources)) bad('frontmatter.sources', 'sources must be a list');
  for (const s of Array.isArray(d.sources) ? d.sources : []) if (!/^https:\/\//.test(s) && (/^[/~]|(^|\/)\.\.(\/|$)/.test(s) || !existsSync(join(ROOT, s)))) bad('frontmatter.source', `source "${s}" is not a file in the repository or an https URL`);
  if (d.generated !== undefined && typeof d.generated !== 'boolean') bad('frontmatter.generated', 'generated must be true or false');
  for (const k of Object.keys(d)) if (!['title', 'description', 'audience', 'updated', 'sources', 'generated'].includes(k)) bad('frontmatter.unknown', `unknown field "${k}"`);
  // headings: the first is the one H1 and equals the title; no other H1
  const prose = fm.body.replace(/^ {0,3}(```|~~~)[\s\S]*?^ {0,3}\1/gm, '').replace(/`[^`\n]*`/g, '');
  const heads = [...prose.matchAll(/^(#{1,6}) (.+)$/gm)];
  if (!heads.length || heads[0][1] !== '#') bad('heading.first', 'the first heading must be "# <title>"');
  else if (heads[0][2].trim() !== d.title) bad('heading.title', `the H1 "${heads[0][2].trim()}" differs from the title "${d.title}"`);
  if (heads.filter((h) => h[1] === '#').length > 1) bad('heading.h1', 'only one H1 per page');
  for (const h of heads) if (h[1].length > 3) bad('heading.depth', `"${h[2]}": use ## and ### only`);
  // links (outside code): site paths and soul.game URLs must resolve; other hosts only from the allowed list
  const targets = [...[...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]), ...[...prose.matchAll(/<(https?:\/\/[^>\s]+)>/g)].map((m) => m[1]),
    ...[...prose.matchAll(/(?<![(<])https:\/\/soul\.game[^\s)<>`"']*/g)].map((m) => m[0].replace(/[.,;:!?]+$/, ''))];
  for (const target of targets) {
    let path = null;
    if (target.startsWith('/')) path = target;
    else if (/^https?:\/\//.test(target)) {
      let u; try { u = new URL(target); } catch { bad('link.url', `bad URL ${target}`); continue; }
      if (!HOSTS.includes(u.hostname)) { bad('link.host', `${target}: only ${HOSTS.join(', ')} may be linked`); continue; }
      if (u.protocol !== 'https:') bad('link.https', `${target}: use https`);
      if (u.hostname === 'soul.game') path = u.pathname;
    } else if (!target.startsWith('#') && !target.startsWith('mailto:')) { bad('link.relative', `${target}: link pages by site path (/docs/...)`); continue; }
    if (path === null) continue;
    path = path.replace(/[#?].*$/, ''); const bare = path.replace(/\.md$/, '').replace(/\/$/, '') || '/';
    if (!(pages.has(bare) || SERVED.includes(path) || SERVED.includes(bare) || WORLD_FILE.test(path))) bad('link.unresolved', `${target} is not a page or a served path`);
  }
  // bare URLs anywhere (code included): our hosts only
  for (const [raw] of fm.body.matchAll(/https?:\/\/[^\s)<>`"']+/g)) { const u = raw.replace(/[.,;:!?]+$/, ''); let h; try { h = new URL(u).hostname; } catch { continue; } if (!HOSTS.includes(h)) bad('link.host', `${u}: only ${HOSTS.join(', ')} may appear`); }
  // the generated part starts at the mark paragraph directly under a ## heading, nowhere else
  const mark = d.generated === true ? new RegExp(`^## [^\\n]+\\n\\n(?=${GENERATED_MARK} )`, 'm').exec(prose) : null;
  const written = mark ? prose.slice(0, mark.index) : prose;
  if (/\bSim\b/.test(prose)) bad('name.retired', '"Sim" is retired: the product is Souls');
  if (/\bEden worlds?\b|\bin Eden\b(?! \d)/.test(prose)) bad('name.eden', 'Eden is one world, never the product');
  if (/—/.test(written.replace(/^#.*$/gm, ''))) bad('style.em-dash', 'no em-dashes in body text (WRITING.md)');
  if (/(?:^|\s)#\d{2,}\b/.test(written)) bad('text.issue-number', 'no issue numbers in page text');
  for (const [re, code] of PRIVATE) { const m = re.exec(text); if (m) bad(code, `"${m[0].trim()}" must not appear in a public page`); }
  return problems;
}

function* walk(dir) { for (const e of readdirSync(dir).sort()) { const p = join(dir, e); if (statSync(p).isDirectory()) yield* walk(p); else if (p.endsWith('.md')) yield p; } }

/** Lint a docs tree: { pages: [url], problems: [{ file, code, message }] }. */
export function lintTree(dir = SITE) {
  const files = [...walk(dir)].filter((f) => !NOT_PAGES.has(relative(dir, f)));
  const pages = new Set(files.map((f) => urlOf(relative(dir, f))));
  const problems = [];
  for (const url of OUTLINE) if (!pages.has(url)) problems.push({ file: dir, code: 'outline.missing', message: `the outline page ${url} has no file` });
  for (const f of files) for (const p of lintPage(readFileSync(f, 'utf8'), { pages })) problems.push({ file: relative(ROOT, f), ...p });
  return { pages: [...pages].sort(), problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--dir');
  if (i > 0 && !process.argv[i + 1]) { console.error('usage: node tools/docs/lint.mjs [--dir <docs dir>]'); process.exit(2); }
  const dir = i > 0 ? resolve(process.argv[i + 1]) : SITE;
  const { pages, problems } = lintTree(dir);
  for (const p of problems) console.log(`${p.file}: ${p.code}: ${p.message}`);
  console.log(`docs lint: ${pages.length} page(s), ${problems.length} problem(s)`);
  process.exit(problems.length ? 1 : 0);
}
