// Step 7: REPORT.md (spec §12.3), journal.md, metrics.json (via metrics.mjs) and replay.json (spec §12.4).
import { join, basename } from 'node:path';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { readJson, readJsonl, writeJson } from '../lib/jsonl.mjs';
import { sha256 } from '../lib/hash.mjs';
import { loadRun, secsBetween } from './run.mjs';
import { renderJournal } from './journal.mjs';
import { metricsRun, readLedger } from './metrics.mjs';
import { earlierRuns, rubricHash, RUBRIC_PATH } from './reviewer.mjs';
import { ORACLE_IDS } from './oracles.mjs';
import { buildStory, storyLines, writeStory } from './story.mjs'; // story (worker S)
import { fitDuration } from '../lib/schedule.mjs';
export { renderJournal } from './journal.mjs';

export const seedOf = (run) => run.scenario?.seed ?? (Number(basename(run.runDir).match(/-(\d+)$/)?.[1]) || null);

export function buildReplay(run) {
  const s = run.scenario ?? {};
  return {
    version: 1, kind: 'playtest-replay', run: basename(run.runDir), seed: seedOf(run), scenario: s,
    personas: Object.fromEntries(Object.entries(run.personas).map(([seat, p]) => [seat, { sheet: (s.seats ?? []).find((x) => x.id === seat)?.persona ?? s.god?.persona ?? null, sha256: sha256(p.sheet) }])),
    world: { kind: run.world.kind ?? s.world?.kind, slug: run.world.slug ?? s.world?.slug, genesis: s.world?.genesis ?? null, fork: run.world.fork ?? null, build: run.world.build ?? null, skill: run.world.skill ?? null, cli: run.world.cli ?? null },
    build: run.world.build ?? null,
    adapters: [...(s.seats ?? []).map((x) => ({ seat: x.id, adapter: x.adapter, model: x.model, effort: x.effort ?? null, personaModel: x.personaModel ?? null, soulId: run.seats[x.id]?.seat?.soulId ?? null })), ...(s.god ? [{ seat: 'god', adapter: s.god.adapter, model: s.god.model, effort: s.god.effort ?? null }] : [])],
    review: { reviewerModel: s.review?.reviewerModel ?? 'opus', developerModel: s.review?.developerModel ?? 'opus', rubric: { file: 'tools/playtest/review/RUBRIC.md', sha256: rubricHash() }, oracles: ORACLE_IDS },
    requests: run.evidence.map((e) => ({ requestId: e.requestId, seat: e.seat, channel: e.channel, text: e.text, sendOffsetSec: Math.round(e.sentMono) / 1000, budgetSec: e.budgetSec ?? null })),
    decisionLog: Object.fromEntries(Object.entries(run.personas).map(([seat, p]) => [seat, p.turns.map((t) => ({ turn: t.turn, mono: t.mono ?? null, requestId: t.requestId ?? null, shown: t.shown ?? null, decision: t.decision }))])),
  };
}

/** Scenario to re-run from replay.json alone. scripted: the same requests at the same offsets; live: same sheets and seed. */
export function replayToScenario(replay, mode = 'scripted') {
  const base = { ...replay.scenario, seed: replay.seed, replayOf: replay.run, replayMode: mode };
  if (mode === 'live') return base;
  // A request's scenario-truth expectation (round 2, review/expect-oracles.mjs) rides along: the k-th request with a seat
  // and text gets the k-th original script entry's expect, so a scripted replay is scored by the same oracles.
  const orig = replay.scenario?.director?.script ?? [], seen = new Map();
  const expectOf = (r) => { const k = `${r.seat}\u0000${r.text}`, n = seen.get(k) ?? 0; seen.set(k, n + 1); return orig.filter((e) => e.seat === r.seat && e.text === r.text)[n]?.expect ?? null; };
  // H-f: the run is long enough for every replayed request to finish (durationSec only grows).
  return fitDuration({ ...base, director: { ...(replay.scenario.director ?? {}), mode: 'scripted', script: replay.requests.map((r) => { const x = expectOf(r); return { seat: r.seat, atSec: r.sendOffsetSec, channel: r.channel, text: r.text, budgetSec: r.budgetSec ?? null, ...(x ? { expect: x } : {}) }; }) } });
}
/** Check persona sheets in a personas dir still match the hashes the replay recorded. */
export function verifyReplay(replay, personaSheets) { return Object.entries(replay.personas).map(([seat, p]) => ({ seat, ok: personaSheets[seat] != null && sha256(personaSheets[seat]) === p.sha256 })); }

const get = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);
export const KEY_METRICS = [['speed.ackSec.median', 'ack (median)', 's'], ['speed.firstBodyChangeSec.median', 'first visible body change (median)', 's'], ['speed.resultSec.median', 'result (median)', 's'], ['speed.walkMps.median', 'walk speed (median)', 'm/s'], ['uptime.listenOpenFraction', 'listen open fraction', ''], ['uptime.unackedAtCutoff', 'unacked at cutoff', 'n'], ['uptime.serverErrors', '5xx / unreachable', 'n'], ['fidelity.hitRate', 'H rate', ''], ['fidelity.wrong', 'W count', 'n'], ['fidelity.truthfulnessPassRate', 'truthfulness pass rate', ''], ['fidelity.vocabularyMisses', 'vocabulary misses', 'n'], ['physical.insideSolid', 'inside-solid events', 'n'], ['physical.noProgress', 'no-progress events', 'n'], ['physical.stuckReceipts', 'stuck receipts', 'n'], ['physical.oscillations', 'oscillations', 'n'], ['cost.tokensPerRequest.input', 'input tokens / request (median)', 'tok'], ['cost.tokensPerRequest.output', 'output tokens / request (median)', 'tok'], ['cost.acksOverBound', 'acks over 140 chars', 'n']];
const fmt = (v) => (v == null ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v));
const delta = (a, b) => (typeof a === 'number' && typeof b === 'number' ? (a - b >= 0 ? '+' : '') + fmt(a - b) : '—');

export function previousRun(runDir) { return earlierRuns(runDir).reverse().find((d) => existsSync(join(d, 'metrics.json'))) ?? null; }

export function renderReport(run, { metrics, prevMetrics = null, prevName = null, ledger = [], issues = [], frs = [], emergence = null, specs = [], reviews = [], story = null }) {
  const b = metrics?.basics ?? {};
  const s = run.scenario ?? {}; const L = [];
  const cost = metrics.cost.tokensTotal;
  L.push(`# Playtest report — ${s.name ?? 'session'} (${basename(run.runDir)})`, '');
  L.push('## 1. Identity', '', '| | |', '|---|---|',
    `| World | ${run.world.kind ?? s.world?.kind} \`${run.world.slug ?? s.world?.slug}\` at ${run.world.base ?? '?'}; genesis \`${s.world?.genesis ?? '—'}\` |`,
    `| Build | \`${run.world.build ?? '?'}\` · skill ${run.world.skill?.version ?? '?'} \`${(run.world.skill?.sha256 ?? '').slice(0, 12)}\` · CLI ${Object.entries(run.world.cli ?? {}).map(([k, v]) => `${k} \`${String(v).slice(0, 12)}\``).join(', ') || '?'} |`,
    `| Seats | ${(s.seats ?? []).map((x) => `${x.id}: ${x.adapter} ${x.model}${x.effort ? `/${x.effort}` : ''}, persona ${x.persona} (${x.personaModel ?? 'opus'})`).join('; ')}${s.god ? `; god: ${s.god.adapter} ${s.god.model}, persona ${s.god.persona}` : ''} |`,
    `| Seed / duration | ${seedOf(run) ?? '—'} · ${s.durationSec ?? '?'} s · director ${s.director?.mode ?? '?'} |`,
    `| Validity | world ${fmt(metrics.uptime?.tickRate)} ticks/s · request windows unscorable: ${metrics.uptime?.unscorableStalled ?? 0} world stalled (under 15 ticks/s), ${metrics.uptime?.unscorableTruncated ?? 0} truncated by run end or quota |`,
    `| Server root | ${serverRootLine(run.world.serverRoot)} |`,
    `| Cost (seats) | ${cost.input} in / ${cost.cached} cached / ${cost.output} out tokens |`,
    `| Review | ${s.review?.mode === 'deterministic' ? 'Deterministic oracles; no model reviewer or developer' : `Reviewer ${s.review?.reviewerModel ?? 'opus'}, Developer ${s.review?.developerModel ?? 'opus'}`}, rubric \`RUBRIC.md\` \`${rubricHash().slice(0, 12)}\` |`, '');
  L.push('## 1b. Basics scorecard', '', 'Plain walking and acting first; everything subjective comes after.', '', '| walks asked | arrived | arrival rate | body moved in budget | ack median (s) | first body change median (s) | stuck / no progress | inside solid | wrong | hits |', '|---|---|---|---|---|---|---|---|---|---|', `| ${b.walkRequests ?? 0} | ${b.walksArrived ?? 0} of ${b.walksArrivalKnown ?? 0} known | ${fmt(b.walkArrivalRate)} | ${b.bodyMovedInBudget ?? 0} of ${b.requests ?? 0} (${fmt(b.bodyMovedRate)}) | ${fmt(b.ackMedianSec)} | ${fmt(b.firstBodyChangeMedianSec)} | ${b.stuck ?? 0} | ${b.insideSolid ?? 0} | ${b.wrong ?? 0} | ${b.hits ?? 0} |`, '');
  if (metrics.journeys?.rows?.length) {
    L.push('## Complete journeys', '', '| request | oracle | result | evidence |', '|---|---|---|---|');
    for (const r of metrics.journeys.rows) L.push(`| ${r.requestId} | ${r.id} | ${r.status} | ${r.detail} |`);
    L.push('', `Infrastructure-invalid setups: ${metrics.journeys.infrastructureInvalid?.length ?? 0}. Setup time is separate from owner request budgets. Unknown predicates never pass.`, '');
  }
  L.push('## 2. What happened', '');
  if (emergence?.narrative?.strangerReading) L.push(emergence.narrative.strangerReading, '');
  // --- story (worker S): one line per important moment, the director's view beside each in story.html
  try {
    const st = story ?? buildStory(run);
    if (st.merged.length) L.push(`**The story in ${st.merged.length} moments** — open [story.html](story.html) to see each with the screenshot the player was shown:`, '', '```', ...storyLines(st, run), '```', '');
  } catch (e) { L.push(`*(story not built: ${e.message})*`, ''); }
  // --- end story
  const frames = []; for (const ev of run.evidence) { const r = ledger.find((x) => x.requestId === ev.requestId); const shot = (ev.shots ?? []).find((p) => existsSync(join(run.runDir, p))); if (shot) frames.push({ shot, cap: `${ev.requestId} "${ev.text}" — ${r?.fidelity ?? '?'}` }); }
  frames.slice(0, 4).forEach((f) => L.push(`![${f.cap}](${f.shot})`, `*${f.cap}*`, ''));
  L.push('The full player\'s-eye story is in [journal.md](journal.md).', '');
  L.push('## 3. Fidelity', '', '| request | seat | channel | asked | score | class | noticed | input depth | note |', '|---|---|---|---|---|---|---|---|---|');
  ledger.forEach((r) => L.push(`| ${r.requestId} | ${r.seat} | ${r.channel} | "${r.text}" | **${r.fidelity}** | ${r.class || '—'} | ${r.noticedByPlayer === 'true' ? 'yes' : 'no'} | ${r.inputDepth} | ${[r.vetoed, r.leaked === 'true' ? 'Reviewer text scrubbed' : ''].filter(Boolean).join('; ') || ''} |`));
  const c = metrics.fidelity.counts; L.push('', `H ${c.H} · P ${c.P} · M ${c.M} · W ${c.W}${c.unresolved ? ` · unresolved ${c.unresolved}` : ''} of ${ledger.length}. P never counts as H. No frozen battery ran in this session.`, '');
  L.push('## 4. Objective measures', '', prevMetrics ? `Against the previous run of this scenario: \`${prevName}\`.` : 'No previous run of this scenario in the runs folder.', '', `| measure | this run | ${prevMetrics ? 'previous | Δ |' : ''}`, `|---|---|${prevMetrics ? '---|---|' : ''}`);
  KEY_METRICS.forEach(([p, label, unit]) => { const a = get(metrics, p); const b = prevMetrics ? get(prevMetrics, p) : null; L.push(`| ${label}${unit ? ` (${unit})` : ''} | ${fmt(a)} | ${prevMetrics ? `${fmt(b)} | ${delta(a, b)} |` : ''}`); });
  L.push('', 'All measures with units and bases: [metrics.json](metrics.json).', '');
  const em = metrics.emergence; L.push('## 5. Emergence and story', '');
  if (em) L.push('| story (1–5) | O5 | co-location vs shuffled | conversations | unprompted shared | imitation ≤2 min | activity entropy (bits) | chains ≥2 |', '|---|---|---|---|---|---|---|---|', `| ${fmt(em.storyRating)} | ${fmt(em.o5Count)} | ${em.coLocationRatio == null ? '— (one Soul)' : `${fmt(em.coLocationRatio)}×`} | ${em.conversations} | ${em.unpromptedShared} | ${em.imitation} | ${fmt(em.meanActivityEntropyBits)} | ${em.chainsGe2} |`, '');
  (emergence?.narrative?.wantedMore ?? []).forEach((w) => L.push(`- wanted more: "${w.wording}" (${w.persona}${w.count > 1 ? ` ×${w.count}` : ''})`));
  L.push('', '## 6. Issues and feature requests', '');
  if (!issues.length) L.push('No issues raised.');
  issues.forEach((i) => L.push(`### ${i.id}: ${i.title}`, '', `Asked "${i.asked}". ${i.happened} Expected: ${i.expected} (${i.whereWhen}; ${i.frequency}.) Score ${i.fidelity}/${i.class ?? '—'}, ${i.inputDepth} depth, ${i.noticedByPlayer ? 'the player noticed' : 'the player did not notice'}${i.earlierSessions.length ? `; also in ${i.earlierSessions.length} earlier session(s)` : ''}.`, '', `Evidence: ${i.evidence.slice(0, 6).map((p) => (/^[\w./-]+\.(png|json|jsonl|md|tsv|gz)(#|$)/.test(p) ? `[${p.split('/').pop()}](${p.split('#')[0]})` : p)).join(' · ')}`, ''));
  L.push('**Feature requests** (grouped):', '');
  if (!frs.length) L.push('None.');
  frs.forEach((f) => L.push(`- **${f.title}** ×${f.count + (f.desireCount ?? 0)} — ${f.wordings.map((w) => `"${w}"`).join(', ')} (${f.personas.join(', ')})`));
  L.push('', 'Full text: [issues.md](issues.md) · [feature-requests.md](feature-requests.md).', '');
  L.push('## 7. Developer drafts', '', '**DRAFT — NOT IMPLEMENTED.** Each spec proposes a cause, an owning area, an approach and a bar; none was applied.', '');
  if (!specs.length) L.push('No drafts in this run.');
  specs.forEach((x) => L.push(`- [${x.id}: ${x.title}](${x.file}) — ${x.kind}${x.laneBrief ? `, lane brief \`${x.laneBrief.lane}\`` : ', no valid lane brief'}`));
  L.push('', '## 8. Harness notes', '');
  const notes = harnessNotes(run, { metrics, ledger, reviews, specs, emergence });
  L.push(...(notes.length ? notes.map((n) => `- ${n}`) : ['- Nothing the framework got wrong was detected.']), '');
  const coord = existsSync(join(run.runDir, 'COORDINATOR-NOTES.md')) ? readFileSync(join(run.runDir, 'COORDINATOR-NOTES.md'), 'utf8').trim() : '';
  if (coord) L.push('', '## 9. Coordinator note (read before trusting the scores)', '', coord, '');
  return L.join('\n');
}

/** H-i: the server root's HEAD at run start and end, and whether its tree was dirty (world.json serverRoot). */
export function serverRootLine(r) {
  if (!r || (!r.headAtStart && !r.headAtEnd)) return 'not recorded';
  const h = (sha, dirty) => (sha ? `\`${sha.slice(0, 12)}\`${dirty ? ' (dirty)' : ''}` : '?');
  const changed = r.headAtStart && r.headAtEnd && (r.headAtStart !== r.headAtEnd || !!r.dirtyAtStart !== !!r.dirtyAtEnd);
  return `start ${h(r.headAtStart, r.dirtyAtStart)} · end ${r.headAtEnd ? h(r.headAtEnd, r.dirtyAtEnd) : 'not recorded'}${changed ? ' · **CHANGED during the run**' : ''}`;
}

export function harnessNotes(run, { metrics, ledger, reviews, specs, emergence }) {
  const n = [];
  const missing = run.shotsIndex.filter((s) => s.path && !existsSync(s.path.startsWith('/') ? s.path : join(run.runDir, s.path))).length;
  if (metrics.harness.shotsTaken < metrics.harness.shotsPlanned) n.push(`shots: ${metrics.harness.shotsTaken} indexed of ${metrics.harness.shotsPlanned} planned.`);
  if (missing) n.push(`shots: ${missing} indexed shot file(s) are missing on disk.`);
  if (metrics.harness.lateSamples) n.push(`samples: ${metrics.harness.lateSamples} gap(s) longer than 1.5× the sample interval.`);
  if (metrics.harness.packsWithUnknowns) n.push(`oracles: ${metrics.harness.packsWithUnknowns}/${run.evidence.length} evidence packs have at least one unknown oracle (missing godSlice, no walk, or no presence).`);
  const leaks = ledger.filter((r) => r.leaked === 'true').length + (emergence?.narrative?.leaked ? 1 : 0);
  if (leaks) n.push(`Reviewer: ${leaks} answer(s) contained diagnostic content (cause/code/fix) that was stripped.`);
  const vetoes = ledger.filter((r) => r.vetoed).length; if (vetoes) n.push(`Reviewer: ${vetoes} H lowered to P by a failing physical oracle; coordinator to reconcile.`);
  reviews.filter((r) => r.harness || r.timedOut).forEach((r) => n.push(`Reviewer ${r.requestId}: ${r.harness ?? 'timed out'}.`));
  specs.filter((x) => !x.laneBrief).forEach((x) => n.push(`Developer ${x.id}: no valid lane brief.`));
  specs.filter((x) => x.rescored).forEach((x) => n.push(`Developer ${x.id}: text appears to re-score the request (not allowed).`));
  specs.filter((x) => x.serverRootTouched).forEach((x) => n.push(`Developer ${x.id}: the server root's git status changed during the call.`));
  if (metrics.uptime.seatCrashes) n.push(`seats: ${metrics.uptime.seatCrashes} turn(s) exited non-zero.`);
  return n;
}

/** reportRun(runDir) → step 7. */

/** Developer drafts: specs/index.json when the Developer finished; otherwise every specs/*.md on disk (a killed run). */
export function loadSpecs(runDir) {
  const idx = readJson(join(runDir, 'specs/index.json'), null);
  if (Array.isArray(idx) && idx.length) return idx;
  const dir = join(runDir, 'specs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const text = readFileSync(join(dir, f), 'utf8');
    const id = f.replace(/\.md$/, '');
    const title = text.match(/^\*\*Issue\*\*\s*\n+([^\n]+)/m)?.[1] ?? text.match(/^#+\s*(.+)$/m)?.[1] ?? id;
    const kind = /^F-/.test(id) ? 'feature request' : 'issue';
    const brief = text.match(/```json\s*([\s\S]*?)```/)?.[1]; let laneBrief = null; try { laneBrief = brief ? JSON.parse(brief) : null; } catch { laneBrief = null; }
    return { id, title: title.slice(0, 120), kind, file: `specs/${f}`, laneBrief, indexed: false };
  });
}

export function reportRun(runDir) {
  const run = loadRun(runDir);
  const metrics = metricsRun(runDir);
  const prev = previousRun(runDir);
  writeFileSync(join(runDir, 'journal.md'), renderJournal(run));
  const replay = buildReplay(run); writeJson(join(runDir, 'replay.json'), replay);
  const md = renderReport(run, { metrics, prevMetrics: prev ? readJson(join(prev, 'metrics.json')) : null, prevName: prev ? basename(prev) : null, ledger: readLedger(join(runDir, 'ledger.tsv')), issues: readJson(join(runDir, 'issues.json'), []), frs: readJson(join(runDir, 'feature-requests.json'), []), emergence: readJson(join(runDir, 'emergence.json'), null), specs: loadSpecs(runDir), reviews: readJsonl(join(runDir, 'reviews.jsonl')) });
  writeFileSync(join(runDir, 'REPORT.md'), md);
  try { writeStory(runDir, { run }); } catch { /* story (worker S): REPORT.md stands without it */ }
  return { report: join(runDir, 'REPORT.md'), metrics, replay };
}
