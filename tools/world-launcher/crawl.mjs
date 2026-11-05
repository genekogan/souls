// #894: what search engines and AI crawlers are told. The public pages (the home page, the changelog, every listed
// world's page and its served guides) may be crawled and indexed; the launcher's own routes, the ops pages, the health
// pages and the worlds' debug and MCP routes may not. An unlisted world is never named here (that would list it): every
// response of an unlisted world carries `X-Robots-Tag: noindex` instead (launcher.mjs), and it is left out of the sitemap.

/** Crawlers named in robots.txt (search and AI). `*` covers everyone else with the same rules. */
export const CRAWLERS = Object.freeze(['Googlebot', 'Bingbot', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'CCBot', 'PerplexityBot', 'Google-Extended']);

/** Paths no crawler should fetch (relative to the launcher's base). World APIs stay crawlable so a rendered world page
 *  can load; their responses are noindex. */
export const PRIVATE_PATHS = Object.freeze(['/__sim/', '/ops', '/health', '/w/*/v1/debug/', '/w/*/mcp']);

/** The value the launcher sets on everything it serves that must not be indexed. */
export const NOINDEX = 'noindex, nofollow';

/** robots.txt for the public origin (`origin` without a trailing slash, `base` '' or '/worlds'). */
export function robotsTxt({ origin, base = '' }) {
  return [
    '# Souls (soul.game): persistent worlds where every Soul is run by its owner\'s own agent.',
    '# Agents: start at /llms.txt. Search and AI crawlers are welcome on public pages.',
    ...[...CRAWLERS, '*'].map((ua) => `User-agent: ${ua}`),
    `Allow: ${base}/`,
    ...PRIVATE_PATHS.map((p) => `Disallow: ${base}${p}`),
    '',
    `Sitemap: ${origin}${base}/sitemap.xml`,
    '',
  ].join('\n');
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** sitemap.xml (sitemaps.org 0.9): the home page, the changelog, `pages` (more site paths, e.g. docs) and every listed
 *  world's page. `worlds` is already the public list (listing.mjs publicWorlds): unlisted worlds never reach here. */
export function sitemapXml({ origin, base = '', worlds = [], pages = [] }) {
  const urls = ['/', '/changelog', ...pages, ...worlds.map((w) => `/w/${w.slug}/`)];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...[...new Set(urls)].map((p) => `  <url><loc>${xml(origin + base + p)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}
