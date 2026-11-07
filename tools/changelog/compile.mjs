#!/usr/bin/env node
// Changelog fragments → CHANGELOG.md.
//
// Every user-visible PR adds `changes/<pr-number-or-slug>.md`:
//
//   ---
//   type: fix            # feature | fix | perf | docs | internal
//   ---
//   Souls keep their seat when a reader leaves the library.
//
// One line of body, written for people who use Sim. `internal` fragments are validated but left out of the
// public changelog. A PR with nothing to say carries the `no-changelog` label instead. An optional `proof: <url>` (a
// proof.json or scorecard, #1154) is linked in the release notes only: CHANGELOG.md, which the public page renders
// without links, stays one line per entry.
//
//   node tools/changelog/compile.mjs --check                       validate every fragment (CI)
//   node tools/changelog/compile.mjs --version <v> [--date YYYY-MM-DD] [--notes <file>] [--keep] [--dry-run]
//       fold the fragments into a new `## <v>` section at the top of CHANGELOG.md, write the same section to
//       --notes (for the GitHub Release), and delete the fragments (unless --keep). --dry-run prints the section.
//   node tools/changelog/compile.mjs --version <v> --date <d> --out <file>
//       write CHANGELOG.md with the new section to <file> instead; the tree (CHANGELOG.md and the fragments) is left as
//       it is. release.yml's ship job builds the web app from it (SIM_CHANGELOG_FILE), so the public changelog page
//       shows the release it ships (#393); publish later writes the same section into the committed CHANGELOG.md.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicationFindings } from '../proof/publication.mjs';

export const TYPES = ['feature', 'fix', 'perf', 'docs', 'internal'];
const HEADINGS = { feature: 'Features', fix: 'Fixes', perf: 'Performance', docs: 'Documentation' };
const NOT_FRAGMENTS = new Set(['README.md', '_template.md']);
const HEADER = '# Changelog\n\nUser-facing changes to Sim, newest first. Each release is compiled from `changes/` fragments.\n';

/** Why `value` can't be a fragment's proof link, or null: canonical https on github.com or the proof CDN, nothing private. */
export function fragmentProofProblem(value, cdn = process.env.SIM_PROOF_PUBLIC_URL || null) {
  let u;
  try { u = new URL(value); } catch { return 'must be a URL'; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.href !== value) return 'must be a canonical https URL with no userinfo or port';
  let host = u.origin === 'https://github.com';
  if (!host && cdn) { try { const c = new URL(cdn); host = u.origin === c.origin && u.pathname.startsWith(c.pathname.replace(/\/?$/, '/')); } catch { /* no usable proof host */ } }
  if (!host) return 'must be on github.com or the proof host';
  // The shared rules want a path at a boundary, so each path segment is also offered as the start of one.
  const parts = u.pathname.split('/').map((_, i, all) => all.slice(i).join('/')).filter(s => s.length > 1);
  const findings = [...new Set([value, ...parts.map(s => s.startsWith('/') ? s : '/' + s)].flatMap(s => [...publicationFindings(s)]))];
  return findings.length ? `names private details (${findings.join(', ')})` : null;
}

export function parseFragment(name, text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) throw Error(`${name}: needs front matter between --- lines`);
  const meta = Object.fromEntries(m[1].split(/\r?\n/).map(l => l.replace(/\s+#.*$/, '').trim()).filter(Boolean).map(l => {
    const i = l.indexOf(':');
    if (i < 0) throw Error(`${name}: bad front matter line "${l}"`);
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
  }));
  if (!TYPES.includes(meta.type)) throw Error(`${name}: type must be one of ${TYPES.join('|')} (got "${meta.type ?? ''}")`);
  const lines = m[2].split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length !== 1) throw Error(`${name}: body must be exactly one user-facing line (got ${lines.length})`);
  const line = lines[0].replace(/^[-*]\s+/, '');
  const slug = name.replace(/\.md$/, '');
  const pr = meta.pr || (/^\d+$/.test(slug) ? slug : null);
  if (pr && !/^\d+$/.test(String(pr))) throw Error(`${name}: pr must be a number`);
  if ('proof' in meta) { const why = fragmentProofProblem(meta.proof); if (why) throw Error(`${name}: proof ${why}`); }
  return { name, slug, type: meta.type, line, pr: pr ? Number(pr) : null, ...('proof' in meta ? { proof: meta.proof } : {}) };
}

export function readFragments(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.md') && !NOT_FRAGMENTS.has(f)).sort()
    .map(f => parseFragment(f, readFileSync(join(dir, f), 'utf8')));
}

export function renderSection(version, date, fragments, { proof = false } = {}) {
  const out = [`## ${version} (${date})`, ''];
  for (const type of TYPES.filter(t => HEADINGS[t])) {
    const items = fragments.filter(f => f.type === type).sort((a, b) => (a.pr ?? Infinity) - (b.pr ?? Infinity) || a.slug.localeCompare(b.slug));
    if (!items.length) continue;
    out.push(`### ${HEADINGS[type]}`, '', ...items.map(f => `- ${f.line}${f.pr ? ` (#${f.pr})` : ''}${proof && f.proof ? ` ([proof](${f.proof}))` : ''}`), '');
  }
  if (out.length === 2) out.push('Internal changes only.', '');
  return out.join('\n');
}

/** Inserts the section above the first existing release (`## `), keeping any intro text. */
export function insertSection(changelog, section) {
  if (!changelog.trim()) return `${HEADER}\n${section}`;
  const i = changelog.search(/^## /m);
  if (i < 0) return `${changelog.trimEnd()}\n\n${section}`;
  return `${changelog.slice(0, i)}${section}\n${changelog.slice(i)}`;
}

function main(argv) {
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const root = resolve(opt('--root') || fileURLToPath(new URL('../../', import.meta.url)));
  const dir = join(root, 'changes'), file = join(root, 'CHANGELOG.md');
  const fragments = readFragments(dir); // throws on the first invalid fragment
  if (argv.includes('--check')) { console.log(`changelog: ${fragments.length} valid fragment(s)`); return 0; }
  const version = opt('--version');
  if (!version) { console.error('usage: compile.mjs --check | --version <v> [--date YYYY-MM-DD] [--notes <file>] [--keep] [--dry-run] [--out <file>]'); return 2; }
  const date = opt('--date') || new Date().toISOString().slice(0, 10);
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `, 'm').test(existing)) throw Error(`CHANGELOG.md already has ${version}`);
  const section = renderSection(version, date, fragments);
  if (argv.includes('--dry-run')) { console.log(section); return 0; }
  if (opt('--out')) {
    writeFileSync(resolve(opt('--out')), insertSection(existing, section));
    console.log(`changelog: ${version} with ${fragments.length} fragment(s) -> ${opt('--out')} (tree unchanged)`);
    return 0;
  }
  writeFileSync(file, insertSection(existing, section));
  if (opt('--notes')) writeFileSync(resolve(opt('--notes')), renderSection(version, date, fragments, { proof: true }).split('\n').slice(2).join('\n'));
  if (!argv.includes('--keep')) for (const f of fragments) rmSync(join(dir, f.name));
  console.log(`changelog: ${version} with ${fragments.length} fragment(s)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(`changelog: ${e.message}`); process.exitCode = 1; }
}
