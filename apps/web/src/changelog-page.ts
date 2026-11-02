// The public changelog page (<base>/changelog, issue #388): CHANGELOG.md rendered to static HTML when the web app is
// built (vite.config.ts `changelogPage`, into changelog.html), so the page ships with its release, loads no script and
// asks nothing of GitHub or the API at runtime. CHANGELOG.md is what tools/changelog/compile.mjs writes:
//   ## <version> (<YYYY-MM-DD>)    a release; any other `## ` heading (## Earlier) is a closing note
//   ### Features | Fixes | …        a group inside a release
//   - one line                       an entry (indented lines continue it); other lines are paragraphs
// Plain text only: entry text is escaped, and only `code` spans become markup.

export type ChangelogBlock = { kind: 'group'; title: string; items: string[] } | { kind: 'text'; text: string };
export type ChangelogRelease = { version: string; date: string; blocks: ChangelogBlock[] };
export type ChangelogNote = { title: string; text: string[] };
export type Changelog = { releases: ChangelogRelease[]; notes: ChangelogNote[] };

const RELEASE = /^## +(\S+) +\((\d{4}-\d{2}-\d{2})\) *$/;

/** Parses CHANGELOG.md; throws when it names no release, so a broken file fails the build instead of an empty page. */
export function parseChangelog(md: string): Changelog {
  const releases: ChangelogRelease[] = [], notes: ChangelogNote[] = [];
  let release: ChangelogRelease | null = null, note: ChangelogNote | null = null, item: { items: string[] } | null = null;
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      const m = RELEASE.exec(line);
      item = null;
      if (m) { release = { version: m[1]!, date: m[2]!, blocks: [] }; releases.push(release); note = null; }
      else { note = { title: line.slice(3).trim(), text: [] }; notes.push(note); release = null; }
      continue;
    }
    if (!release && !note) continue;   // the file's own title and intro: the page has its own
    if (note) { if (line.trim()) note.text.push(line.trim()); continue; }
    if (line.startsWith('### ')) { const g = { kind: 'group' as const, title: line.slice(4).trim(), items: [] }; release!.blocks.push(g); item = g; continue; }
    const bullet = /^[-*] +(.*)$/.exec(line);
    if (bullet) {
      if (!item) { const g = { kind: 'group' as const, title: '', items: [] }; release!.blocks.push(g); item = g; }
      item.items.push(bullet[1]!.trim());
      continue;
    }
    if (!line.trim()) continue;
    if (item && /^\s+\S/.test(raw) && item.items.length) { item.items[item.items.length - 1] += ' ' + line.trim(); continue; }
    item = null;
    release!.blocks.push({ kind: 'text', text: line.trim() });
  }
  if (!releases.length) throw Error('CHANGELOG.md: no release headings ("## <version> (<YYYY-MM-DD>)"), so the changelog page would be empty');
  return { releases, notes };
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** Escaped text with `code` spans as <code>. */
export function inline(text: string): string {
  return text.split(/(`[^`]+`)/).map((part) => (/^`[^`]+`$/.test(part) ? `<code>${escapeHtml(part.slice(1, -1))}</code>` : escapeHtml(part))).join('');
}

/** A release's anchor: `v4.0`, `v3.62` (stable, so a visitor can link one release). */
export const releaseId = (version: string) => 'v' + version.replace(/[^A-Za-z0-9._-]/g, '-');

const LONG_DATE = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const longDate = (iso: string) => { const t = Date.parse(iso + 'T00:00:00Z'); return Number.isNaN(t) ? iso : LONG_DATE.format(t); };

/** Explicit public projection only; never pass a private board snapshot into this renderer. */
export type PublicJournal = {
  id: string; version: string; date: string; title: string; result: string; limitations: string;
  source: { url: string; commit: string; capturedOn: string; environment: 'historical-test' | 'isolated-test' | 'production' };
  media: { kind: 'video' | 'image'; url: string; poster?: string; alt: string; status: 'available' | 'retired' };
};

function publicUrl(value: unknown, media: boolean): string {
  if (typeof value !== 'string') throw Error('Public journal: URL must be text');
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash || u.href !== value)
    throw Error('Public journal: canonical HTTPS URL required');
  const allowed = media
    ? (u.origin === 'https://assets.eden.art' && /^\/public-journal\/[A-Za-z0-9._/-]+$/.test(u.pathname)) ||
      (u.origin === 'https://github.com' && /^\/genekogan\/souls\/releases\/download\/proofs\/[A-Za-z0-9._-]+$/.test(u.pathname))
    : u.origin === 'https://github.com' && /^\/genekogan\/souls\/(?:pull\/\d+|commit\/[a-f0-9]{40}|releases\/tag\/[A-Za-z0-9._-]+)$/.test(u.pathname);
  if (!allowed) throw Error('Public journal: URL outside publication allowlist');
  return value;
}

/** Validate at the build boundary. Unknown fields and unassociated releases fail closed. */
export function parsePublicJournal(input: unknown, log: Changelog): PublicJournal[] {
  const object = (v: unknown, keys: string[]): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))
      throw Error('Public journal: expected explicitly allowlisted fields');
    return v as Record<string, unknown>;
  };
  const text = (v: unknown): string => {
    if (typeof v !== 'string' || !v.trim() || v.length > 2000 || /[\x00-\x08\x0b-\x1f]/.test(v)) throw Error('Public journal: invalid text');
    return v;
  };
  const date = (v: unknown): string => {
    const d = text(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d)
      throw Error('Public journal: invalid date');
    return d;
  };
  if (!Array.isArray(input)) throw Error('Public journal: expected entry array');
  const ids = new Set<string>();
  return input.map(raw => {
    const e = object(raw, ['id', 'version', 'date', 'title', 'result', 'limitations', 'source', 'media']);
    const id = text(e.id), version = text(e.version), shippedOn = date(e.date);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(`${version}/${id}`)) throw Error('Public journal: invalid or duplicate entry id');
    ids.add(`${version}/${id}`);
    if (!log.releases.some(r => r.version === version && r.date === shippedOn)) throw Error('Public journal: release version/date not in compiled changelog');
    const source = object(e.source, ['url', 'commit', 'capturedOn', 'environment']);
    if (!/^[a-f0-9]{40}$/.test(text(source.commit))) throw Error('Public journal: exact source commit required');
    if (!['historical-test', 'isolated-test', 'production'].includes(text(source.environment))) throw Error('Public journal: invalid capture environment');
    const media = object(e.media, ['kind', 'url', 'poster', 'alt', 'status']);
    if (!['image', 'video'].includes(text(media.kind)) || !['available', 'retired'].includes(text(media.status))) throw Error('Public journal: invalid media kind/status');
    if (media.kind === 'video' && media.status === 'available' && !media.poster) throw Error('Public journal: video needs a poster');
    return { id, version, date: shippedOn, title: text(e.title), result: text(e.result), limitations: text(e.limitations),
      source: { url: publicUrl(source.url, false), commit: text(source.commit), capturedOn: date(source.capturedOn), environment: source.environment as PublicJournal['source']['environment'] },
      media: { kind: media.kind as 'image' | 'video', url: publicUrl(media.url, true), ...(media.poster ? { poster: publicUrl(media.poster, true) } : {}), alt: text(media.alt), status: media.status as 'available' | 'retired' } };
  });
}

function renderJournal(e: PublicJournal): string {
  const id = `${releaseId(e.version)}-journal-${e.id}`, esc = escapeHtml, m = e.media;
  const environment = { 'historical-test': 'Historical test capture', 'isolated-test': 'Isolated test capture', production: 'Production capture' }[e.source.environment];
  const media = m.status === 'retired' ? '<p>Media retired or unavailable. The release notes and provenance remain available.</p>'
    : m.kind === 'video'
      ? `<video controls preload="none" playsinline poster="${esc(m.poster!)}" aria-label="${esc(m.alt)}"><source src="${esc(m.url)}" type="video/mp4">Video playback is unavailable.</video>`
      : `<img src="${esc(m.url)}" alt="${esc(m.alt)}" loading="lazy" decoding="async">`;
  return `<details class="cl-journal" id="${esc(id)}"><summary>${esc(e.title)} <span>View journal</span></summary>
    <article aria-label="${esc(e.title)}"><h4><a href="#${esc(id)}">${esc(e.title)}</a></h4><p>${esc(e.result)}</p>
    <p class="cl-provenance">Released in ${esc(e.version)} · ${esc(e.date)}. ${environment} · ${esc(e.source.capturedOn)} · source <a href="${esc(e.source.url)}">${esc(e.source.commit.slice(0, 12))}</a>.</p>
    <figure>${media}<figcaption>${esc(m.alt)}${m.kind === 'image' ? ' Still image; does not demonstrate motion.' : ''}</figcaption></figure>
    <p class="cl-limits">${esc(e.limitations)}</p><p>If media cannot load, use the release notes and source above; <a href="${esc(e.source.url)}">report a missing proof link with this entry id</a>: <code>${esc(id)}</code>.</p>
    <a href="#${esc(releaseId(e.version))}">← Back to release ${esc(e.version)}</a></article></details>`;
}

/** The page's body content (inside <main>): releases newest first, as CHANGELOG.md lists them. */
export function renderChangelog(log: Changelog, { home, journal = [] }: { home: string; journal?: PublicJournal[] }): string {
  const out: string[] = [];
  out.push(`<nav class="cl-nav"><a href="${escapeHtml(home)}">← Worlds</a></nav>`);
  out.push('<header class="cl-head"><h1>Changelog</h1><p>What changed in Sim, release by release. Newest first.</p></header>');
  for (const r of log.releases) {
    const id = releaseId(r.version);
    out.push(`<section class="cl-release" id="${escapeHtml(id)}" aria-labelledby="${escapeHtml(id)}-h">`);
    out.push(`<h2 id="${escapeHtml(id)}-h"><a class="cl-v" href="#${escapeHtml(id)}">${escapeHtml(r.version)}</a> <time datetime="${escapeHtml(r.date)}">${escapeHtml(longDate(r.date))}</time></h2>`);
    out.push('<div class="cl-body">');
    for (const b of r.blocks) {
      if (b.kind === 'text') { out.push(`<p class="cl-note">${inline(b.text)}</p>`); continue; }
      if (b.title) out.push(`<h3>${escapeHtml(b.title)}</h3>`);
      out.push(`<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`);
    }
    for (const e of journal.filter(e => e.version === r.version)) out.push(renderJournal(e));
    out.push('</div></section>');
  }
  for (const n of log.notes) out.push(`<section class="cl-release cl-end"><h2>${escapeHtml(n.title)}</h2><div class="cl-body">${n.text.map((t) => `<p class="cl-note">${inline(t)}</p>`).join('')}</div></section>`);
  return out.join('\n');
}

/** Fills changelog.html's `<!--changelog-->` slot; `base` is Vite's (`/` or `/worlds/`), so "Worlds" goes to this build's list. */
export function changelogHtml(template: string, md: string, base: string, publicInput: unknown = []): string {
  if (!template.includes('<!--changelog-->')) throw Error('changelog.html: no <!--changelog--> slot');
  const home = base.endsWith('/') ? base : base + '/';
  const log = parseChangelog(md), journal = parsePublicJournal(publicInput, log);
  return template.replace('<!--changelog-->', () => renderChangelog(log, { home, journal }));
}
