#!/usr/bin/env node
// CW8 (#742) A1, #947: two capacity-qualify artifacts side by side, the baseline and a candidate, with every cell kept.
// A cell missing on either side is shown as missing, never as better; an objective that still fails stays bold; a change
// in the run conditions is flagged as not like for like. With two repeats a direction is called only when the repeat
// ranges do not overlap. Pure core; the CLI reads each artifact's summary.json (and qualify.json when present).
//   node tools/bench/capacity/meetup/compare.mjs <baseline-dir> <candidate-dir> [--out <file>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const COMPARE = 'cw8-compare/1';
// headline cells (meetup report.mjs `headline`) and which way is better
export const HEADLINE = Object.freeze([
  ['joined', 'higher'], ['readE2eP95Ms', 'lower'], ['readE2eP99Ms', 'lower'], ['actE2eP95Ms', 'lower'], ['actE2eP99Ms', 'lower'],
  ['actionStartP95Ms', 'lower'], ['deliveryP95Ms', 'lower'], ['overdue', 'lower'], ['unissued', 'lower'], ['loadFailures', 'lower'],
  ['clockMinQuiet', 'higher'], ['clockMinActive', 'higher'], ['restarts', 'lower'],
]);
export const WORLD = Object.freeze([['hottestCores', 'lower'], ['loopP99MsMax', 'lower'], ['queueMax', 'lower']]);

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
// the repeats' range; null when no repeat has the value. `partial` when some repeats lack it: never a direction then.
const range = (xs) => { const v = xs.map(num).filter((x) => x != null); if (!v.length) return null; const rg = [Math.min(...v), Math.max(...v)]; if (v.length < xs.length) rg.partial = `${v.length}/${xs.length}`; return rg; };
/** Two repeat ranges → better | worse | overlaps | partial | missing. Missing or partial on either side is never better. */
export function direction(base, cand, better) {
  if (!base || !cand) return 'missing';
  if (base.partial || cand.partial) return 'partial';
  const lower = better === 'lower';
  if (cand[1] < base[0]) return lower ? 'better' : 'worse';
  if (cand[0] > base[1]) return lower ? 'worse' : 'better';
  return 'overlaps';
}

/** The conditions a like-for-like comparison needs, from qualify.json inputs and each run's qualification. */
export function conditions(art) {
  const q = art.qualify ?? {}, runs = art.summary?.runs ?? [], i = q.inputs ?? {};
  const uniq = (f) => [...new Set(runs.map(f).map((x) => JSON.stringify(x ?? null)))].sort().join(' | ');
  return {
    hostClass: i.hostClass ?? null, short: i.short ?? null, quietDeclared: i.quietDeclared ?? null, browser: i.browser ?? null, repeats: i.repeats ?? null,
    slice: 'slice' in i ? (i.slice ?? 'none') : null,   // recorded as null: the run had no slice quietBefore: q.before?.quiet ?? null, quietAfter: q.after?.quiet ?? null,
    executor: uniq((r) => r.qualification?.qualifying?.executor), cpuMax: uniq((r) => r.qualification?.allocation?.cpuMax), memoryMaxMb: uniq((r) => r.qualification?.allocation?.memoryMaxMb),
  };
}

/** {summary, qualify?} × 2 → the comparison (data). */
export function compare(base, cand) {
  const bc = conditions(base), cc = conditions(cand);
  const unknownish = (v) => v == null || v === 'null';   // not recorded: a match on it proves nothing
  const notLike = Object.keys(bc).filter((k) => JSON.stringify(bc[k]) !== JSON.stringify(cc[k])).map((k) => ({ key: k, base: bc[k], cand: cc[k] }));
  const unknown = Object.keys(bc).filter((k) => unknownish(bc[k]) && unknownish(cc[k]));
  const bRuns = base.summary?.runs ?? [], cRuns = cand.summary?.runs ?? [];
  const profiles = [...new Set([...bRuns, ...cRuns].map((r) => r.profile))].sort();
  const out = { schema: COMPARE, source: { base: base.qualify?.commit ?? null, cand: cand.qualify?.commit ?? null, baseRun: base.qualify?.workflowRun ?? null, candRun: cand.qualify?.workflowRun ?? null },
    verdicts: { base: base.summary?.verdict ?? null, cand: cand.summary?.verdict ?? null }, conditions: { base: bc, cand: cc, notLikeForLike: notLike, unknown }, profiles: {} };
  for (const p of profiles) {
    const b = bRuns.filter((r) => r.profile === p), c = cRuns.filter((r) => r.profile === p);
    const reps = [...new Set([...b, ...c].map((r) => r.rep))].sort((x, y) => x - y);
    const missing = reps.flatMap((k) => [...(b.some((r) => r.rep === k) ? [] : [`baseline r${k}`]), ...(c.some((r) => r.rep === k) ? [] : [`candidate r${k}`])]);
    const headline = HEADLINE.map(([key, better]) => { const br = range(b.map((r) => r.headline?.[key])), cr = range(c.map((r) => r.headline?.[key])); return { key, better, base: br, cand: cr, dir: direction(br, cr, better) }; });
    const keys = [...new Set([...b, ...c].flatMap((r) => Object.keys(r.qualification?.objectives ?? {})))];
    const objectives = reps.flatMap((k) => keys.map((key) => {
      const bv = b.find((r) => r.rep === k)?.qualification?.objectives?.[key], cv = c.find((r) => r.rep === k)?.qualification?.objectives?.[key];
      const state = typeof cv !== 'boolean' ? 'missing' : typeof bv !== 'boolean' ? (cv ? 'new, meets' : 'new, misses') : cv ? (bv ? 'meets' : 'fixed') : bv ? 'regressed' : 'still failing';
      return { rep: k, key, base: typeof bv === 'boolean' ? bv : null, cand: typeof cv === 'boolean' ? cv : null, state };
    }));
    const slugs = [...new Set([...b, ...c].flatMap((r) => Object.keys(r.qualification?.worlds ?? {})))].sort();
    const worlds = slugs.map((slug) => {
      const bw = b.map((r) => r.qualification?.worlds?.[slug]), cw = c.map((r) => r.qualification?.worlds?.[slug]);
      const cells = WORLD.map(([key, better]) => { const br = range(bw.map((w) => w?.[key])), cr = range(cw.map((w) => w?.[key])); return { key, base: br, cand: cr, dir: direction(br, cr, better) }; });
      const met = (ws, runs) => runs.map((r, i) => `r${r.rep} ${ws[i]?.met === true ? 'met' : ws[i]?.met === false ? 'missed' : 'missing'}`).join(', ');
      return { slug, cells, metBase: met(bw, b), metCand: met(cw, c), stillMissed: cw.some((w) => w?.met === false), missing: bw.some((w) => !w) || cw.some((w) => !w) || bw.length === 0 || cw.length === 0 };
    });
    out.profiles[p] = { reps, missing, headline, objectives, worlds };
  }
  return out;
}

const fmt = (rg) => (rg ? `${rg[0] === rg[1] ? rg[0] : `${rg[0]}–${rg[1]}`}${rg.partial ? ` (${rg.partial} repeats)` : ''}` : 'missing');
const mark = (d) => (d === 'worse' || d === 'missing' || d === 'partial' ? `**${d}**` : d);
/** The comparison → markdown. Numbers and labels only; no hosts or paths. */
export function compareText(x) {
  const L = [], v = (s) => (s ? `${s.verdict}${s.qualifies ? '' : ' (indicative only, does not qualify)'}` : 'missing');
  L.push(`# Capacity comparison (${x.schema})`, '');
  L.push(`Baseline run ${x.source.baseRun ?? '?'} at \`${String(x.source.base ?? '?').slice(0, 8)}\` · candidate run ${x.source.candRun ?? '?'} at \`${String(x.source.cand ?? '?').slice(0, 8)}\`. Ranges are the repeats (min–max); a direction is called only when they do not overlap.`, '');
  L.push(`- **Verdict before:** ${v(x.verdicts.base)}`); for (const r of x.verdicts.base?.reasons ?? []) L.push(`  - ${r}`);
  L.push(`- **Verdict after:** ${v(x.verdicts.cand)}`); for (const r of x.verdicts.cand?.reasons ?? []) L.push(`  - ${r}`);
  L.push('');
  if (x.conditions.notLikeForLike.length) {
    L.push('**Not like for like.** These conditions differ; a difference below may come from them:', '');
    for (const d of x.conditions.notLikeForLike) L.push(`- \`${d.key}\`: ${JSON.stringify(d.base)} → ${JSON.stringify(d.cand)}`);
    L.push('');
  } else L.push(x.conditions.unknown.length ? 'Conditions are like for like on the known conditions.' : 'Conditions are like for like.', '');
  if (x.conditions.unknown.length) L.push(`Not recorded on either side, so not compared: ${x.conditions.unknown.map((k) => `\`${k}\``).join(', ')}.`, '');
  for (const [p, P] of Object.entries(x.profiles)) {
    L.push(`## ${p}`, '');
    if (P.missing.length) L.push(`**Missing repeats:** ${P.missing.join(', ')}`, '');
    L.push('| cell | better | baseline | candidate | direction |', '|---|---|---|---|---|');
    for (const h of P.headline) L.push(`| ${h.key} | ${h.better} | ${fmt(h.base)} | ${fmt(h.cand)} | ${mark(h.dir)} |`);
    L.push('', '| objective | rep | baseline | candidate | state |', '|---|---|---|---|---|');
    const yn = (b) => (b === true ? 'meets' : b === false ? 'misses' : 'missing');
    for (const o of P.objectives) L.push(`| ${o.key} | ${o.rep} | ${yn(o.base)} | ${o.cand === false ? '**misses**' : yn(o.cand)} | ${['meets', 'fixed', 'new, meets'].includes(o.state) ? o.state : `**${o.state}**`} |`);
    L.push('', '| world | met (baseline) | met (candidate) | ' + WORLD.map(([k]) => `${k} before → after`).join(' | ') + ' |', '|---|---|---|' + WORLD.map(() => '---|').join(''));
    for (const w of P.worlds) L.push(`| ${w.slug}${w.missing ? ' (incomplete)' : ''} | ${w.metBase} | ${w.stillMissed ? `**${w.metCand}**` : w.metCand} | ${w.cells.map((c) => `${fmt(c.base)} → ${fmt(c.cand)} (${mark(c.dir)})`).join(' | ')} |`);
    L.push('');
  }
  return L.join('\n');
}

export function readArtifact(dir) {
  const j = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null);
  const summary = j('summary.json'); if (!summary) throw new Error(`no summary.json in ${dir}`);
  return { summary, qualify: j('qualify.json') };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const usage = () => { console.error('usage: compare.mjs <baseline-dir> <candidate-dir> [--out <file>]'); process.exit(2); };
  const dirs = []; let out = null;
  for (let a = process.argv.slice(2), i = 0; i < a.length; i++) {
    if (a[i] === '--out') { out = a[++i]; if (!out || out.startsWith('--')) usage(); } else if (a[i].startsWith('--out=')) { out = a[i].slice(6); if (!out) usage(); } else if (a[i].startsWith('--')) usage(); else dirs.push(a[i]);
  }
  if (dirs.length !== 2) usage();
  const text = compareText(compare(readArtifact(dirs[0]), readArtifact(dirs[1])));
  if (out) writeFileSync(out, text + '\n'); else process.stdout.write(text + '\n');
}
