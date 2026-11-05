#!/usr/bin/env node
// Reads the acceptance checklist of an issue or PR (the PR body is the journal entry) and validates the proof.json
// machine summary against it, for the tier the change needs (docs/process/PROOF-POLICY.yml `pr_checks`).
//
//   node tools/proof/acceptance.mjs check --body pr.md [--issue issue.md] [--proof proof.json] [--tier T2 |
//        --files a,b | --base <ref>] [--label tier:T3 ...] [--head <sha>] [--repo owner/name] [--json] [--comment out.md]
//   node tools/proof/acceptance.mjs init --issue issue.md [--pr <n>] [--tier T2] [--issue-number <n>] [--commit <sha>]
//        > .e2e/journal/<n>/proof.json      (issue: from --issue-number or a .e2e/journal/<n>/ path; commit: the
//                                            git HEAD of the current directory, so run it from the PR's worktree)
//   node tools/proof/acceptance.mjs pr --repo owner/name --pr <n> [--head <sha>] [--comment out.md]
//        [--summary file] [--output file]          (proof-check.yml: reads the PR, its files, issue and proof.json
//                                                   with `gh api`; prints the report; writes ok=true|false; T3-T4
//                                                   also need the maintainer's sign-off, tools/proof/gate.mjs)
//
// Clip and proof.json links count only on a proof host (proofHostProblem, #765): this repository's proofs releases,
// GitHub attachments, or the SIM_PROOF_PUBLIC_URL CDN. Others are ignored with a warning, and `pr` fetches proof.json
// only from such a host. `check` without --repo accepts any repository's proofs releases.
//
// Exit codes: 0 proof-ok, 1 proof missing or invalid, 2 usage error. `pr` always exits 0 unless the tool itself
// failed; it reports the verdict through --output so the workflow can post the comment first.
//
// proof.json (schema "sim-proof/1"), written while the work runs and uploaded with tools/proof/upload.mjs:
//   { schema, pr, issue, commit, tier,
//     criteria:      [{ id, text, status: met|unmet|deferred, evidence: [url | "`command` -> result" | "#n"] }],
//     media:         [{ file, url, kind: video|image, seconds, viewport, uncut, realSpeed, caption }],
//     files?:        [{ file, url, caption }],          other uploads (logs, JSON); never counted as a clip
//     checks:        [{ cmd, result: pass|fail|skip, note }],
//     failedAttempts:[{ what, why, evidence }],          kept, never deleted; [] when there were none
//     externalities: [{ what, result, ok }],             long-tail cost elsewhere: payload or context bytes when the
//                                                        feature is absent / distant / in use, idle work, wakeups
//     limits:        [string],
//     playtest?:     { scenario, arms: [{ name, repeats, passed, url }] },          T3+
//     review?:       { by, verdict, url } }                                         T3+
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICY_PATH, loadPolicy as loadTierPolicy, tierFor } from './tier.mjs';
import { APPROVED_LABEL, labelAddedBy, maintainerSignOff, needsSignOff } from './gate.mjs';
import { assertPublishable, publicationFindings } from './publication.mjs';

export { labelAddedBy };

export const SCHEMA = 'sim-proof/1';
export const MARKER = '<!-- sim-proof-check -->';
const TIERS = ['T0', 'T1', 'T2', 'T3', 'T4'];
const rank = t => TIERS.indexOf(t);
const STATUSES = new Set(['met', 'unmet', 'deferred']);

// ── policy ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** The parts of PROOF-POLICY.yml this tool reads: tiers.*.required, pr_checks and knobs (flat values). */
export function loadChecks(text = readFileSync(POLICY_PATH, 'utf8')) {
  const required = {}, prChecks = {}, knobs = {};
  let section = null, tier = null;
  const list = s => s.replace(/^\[|\]$/g, '').split(',').map(x => x.trim()).filter(Boolean);
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\S/.test(line)) { section = line.split(':')[0]; tier = null; continue; }
    let m;
    if (section === 'tiers') {
      if ((m = /^ {2}(T\d):\s*$/.exec(line))) tier = m[1];
      else if (tier && (m = /^ {4}required:\s*(\[.*\])\s*$/.exec(line))) required[tier] = list(m[1]);
    } else if (section === 'pr_checks' && (m = /^ {2}(T\d):\s*(\[.*\])\s*$/.exec(line))) {
      prChecks[m[1]] = list(m[2]);
    } else if (section === 'knobs' && (m = /^ {2}(\w+):\s*([^\s]+)\s*$/.exec(line))) {
      knobs[m[1]] = /^\d+$/.test(m[2]) ? Number(m[2]) : m[2];
    }
  }
  for (const t of TIERS) if (!prChecks[t]) throw Error(`PROOF-POLICY pr_checks: missing ${t}`);
  return { required, prChecks, knobs };
}

// ── markdown ────────────────────────────────────────────────────────────────────────────────────────────────────
const ALIASES = {
  problem: ['problem', 'problem statement', 'what happened'],
  acceptance: ['acceptance', 'acceptance criteria', 'done when'],
  proof: ['proof', 'proof required'],
  self_audit: ['self-audit', 'self audit'],
  changelog: ['changelog'],
  risk: ['risk'],
};
const stripComments = s => s.replace(/<!--[\s\S]*?(-->|$)/g, '');
const EMPTY = /^(_?no response_?|n\/a|tbd|todo|\.\.\.|-|none yet)$/i;

/** Splits markdown into sections keyed by known names (## or ### headings; issue forms render ### headings). */
export function sections(markdown = '') {
  const out = {};
  let key = null;
  for (const line of stripComments(String(markdown).replace(/\r\n/g, '\n')).split('\n')) {
    const h = /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const name = h[1].toLowerCase().replace(/[*_`:]/g, '').trim();
      key = Object.keys(ALIASES).find(k => ALIASES[k].some(a => name === a || name.startsWith(`${a} `) || name.startsWith(`${a} (`))) ?? `other:${name}`;
      out[key] = out[key] ?? '';
      continue;
    }
    if (key) out[key] += `${line}\n`;
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  return out;
}

export const meaningful = text => {
  const t = stripComments(text ?? '').replace(/^\s*[-*]\s*$/gm, '').trim();
  return t.length > 0 && !EMPTY.test(t) && t.split(/\s+/).length >= 3;
};

const URL_RE = /https?:\/\/[^\s)<>\]"']+/g;
export const urls = text => [...new Set([...String(text ?? '').matchAll(URL_RE)].map(m => m[0].replace(/[.,;:]+$/, '')))];
const VIDEO = /\.(mp4|webm|mov|m4v)(\?|#|$)|github\.com\/user-attachments\/assets\/|\/assets\/[0-9a-f-]{36}$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i;
export const isVideo = u => VIDEO.test(u) && !IMAGE.test(u);
export const isImage = u => IMAGE.test(u);
const isProofJson = u => /proof[^/]*\.json(\?|#|$)/i.test(u);

/**
 * Where a proof.json or clip link may live (#765): this repository's proofs releases (`releases/download/proofs/` or
 * `proofs-<n>/`), GitHub user attachments, and the proof CDN (SIM_PROOF_PUBLIC_URL) when one is configured. A canonical
 * https URL only: no userinfo, port, query or fragment. `repo` null (a local check with no repository known) accepts
 * any repository's proofs releases; proof-check always passes its repository. Returns null when allowed, else why not.
 */
export function proofHostProblem(value, { repo = null, cdn = process.env.SIM_PROOF_PUBLIC_URL || null } = {}) {
  let u;
  try { u = new URL(value); } catch { return 'not a URL'; }
  if (u.protocol !== 'https:') return 'not https';
  if (u.username || u.password || u.port || u.search || u.hash) return 'userinfo, a port, a query or a fragment is not allowed';
  const repoRe = repo ? repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '[\\w.-]+/[\\w.-]+';
  if (u.origin === 'https://github.com') {
    if (new RegExp(`^/${repoRe}/releases/download/proofs(?:-\\d+)?/[A-Za-z0-9._-]+$`).test(u.pathname)) return null;
    if (/^\/user-attachments\/(?:assets|files)\/[A-Za-z0-9-]+(?:\/[A-Za-z0-9._-]+)?$/.test(u.pathname)) return null;
    return `not this repository's proofs release${repo ? ` (${repo})` : ''} or a GitHub attachment`;
  }
  if (cdn) {
    let c;
    try { c = new URL(cdn); } catch { c = null; }
    if (c && u.origin === c.origin && u.pathname.startsWith(c.pathname.replace(/\/?$/, '/'))) return null;
  }
  return `host ${u.host} is not a proof host (proofs releases, GitHub attachments${cdn ? ', the proof CDN' : ''})`;
}
/** Splits candidate links into allowed ones and ignored ones (with the reason). */
export function allowedProofLinks(links, opts) {
  const ok = [], ignored = [];
  for (const u of links) { const why = proofHostProblem(u, opts); if (why) ignored.push({ url: u, why }); else ok.push(u); }
  return { ok, ignored };
}

/** Issue references in a Problem section: closing keywords first (the PR's own issue, which proof-check reads), then
 *  bare #n and issue URLs in order. */
export function linkedIssues(text = '') {
  const nums = new Set();
  for (const m of String(text).matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi)) nums.add(Number(m[1]));
  for (const m of String(text).matchAll(/(?:^|[^\w&])#(\d+)\b/g)) nums.add(Number(m[1]));
  for (const m of String(text).matchAll(/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)/g)) nums.add(Number(m[1]));
  return [...nums];
}

const NOTE = /(?:^|\s)(?:[—–-]{1,2}\s*)?(evidence|unmet|deferred)\s*:\s*/i;
const ID = /^(?:\*\*)?([A-Z]{1,2}\d{1,3})(?:\*\*)?[.:)]?\s+/;

/** `- [x] **A1** criterion — evidence: ...` lines → [{id, text, checked, kind, note, status}]. */
export function parseChecklist(text = '') {
  const items = [];
  for (const line of stripComments(text).split('\n')) {
    const m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    const checked = m[1] !== ' ';
    let body = m[2], kind = null, note = '';
    const n = NOTE.exec(body);
    if (n) { kind = n[1].toLowerCase(); note = body.slice(n.index + n[0].length).trim(); body = body.slice(0, n.index); }
    body = body.replace(/\s*[—–-]{1,2}\s*$/, '').trim();
    const struck = /^~~.*~~$/.test(body);
    const idm = ID.exec(body.replace(/^~~/, ''));
    const id = idm ? idm[1] : null;
    const textOnly = (idm ? body.replace(/^~~/, '').slice(idm[0].length) : body.replace(/^~~/, '')).replace(/~~$/, '').trim();
    let status;
    if (checked) status = 'met';
    else if (kind === 'deferred' || struck) status = 'deferred';
    else if (kind === 'unmet') status = 'unmet';
    else status = 'open';
    items.push({ id, text: textOnly, checked, kind, note, status });
  }
  return items;
}

/** Evidence a reviewer can follow: a link, an inline command, an issue/PR ref or a pointer into proof.json. */
export const hasEvidence = note => /https?:\/\/|`[^`]+`|#\d+|proof\.json/i.test(note ?? '');
const deferredOk = item => /#\d+|https?:\/\//.test(item.note);
export const normalize = s => String(s ?? '').toLowerCase().replace(/[*_`~[\]()]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function sameCriterion(a, b) {
  if (a.id && b.id) return a.id === b.id;
  const x = normalize(a.text), y = normalize(b.text);
  return x === y || (x.length > 12 && y.length > 12 && (x.includes(y) || y.includes(x)));
}

/** The labelled bullets of a Self-audit section: { 'checks run': '...', 'failed attempts': '...', ... }. */
export function parseAudit(text = '') {
  const fields = {};
  let key = null;
  for (const line of stripComments(text).split('\n')) {
    const m = /^[-*]\s+(?:\*\*)?([A-Za-z][\w /-]*?)(?:\*\*)?\s*:(?:\*\*)?\s*(.*)$/.exec(line);
    if (m) {
      const k = m[1].toLowerCase().trim();
      key = k.startsWith('check') ? 'checks' : k.startsWith('failed') ? 'failed' : (k.startsWith('long') || k.startsWith('externalit')) ? 'longTail' : (k.startsWith('known') || k.startsWith('limit')) ? 'limits' : k;
      fields[key] = (fields[key] ? `${fields[key]}\n` : '') + m[2];
    } else if (key) fields[key] += `\n${line}`;
  }
  for (const k of Object.keys(fields)) fields[k] = fields[k].trim();
  return fields;
}

// ── proof.json ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Validates a proof.json object for a tier; cross-checks it against the PR checklist when given. */
export function validateProof(proof, { tier = 'T0', checklist = null, knobs = {}, head = null } = {}) {
  const problems = [], warnings = [];
  const arr = (k, min = 0) => {
    if (!Array.isArray(proof?.[k])) { problems.push(`proof.json: \`${k}\` must be an array`); return []; }
    if (proof[k].length < min) problems.push(`proof.json: \`${k}\` needs at least ${min} entr${min === 1 ? 'y' : 'ies'} at ${tier}`);
    return proof[k];
  };
  if (!proof || typeof proof !== 'object') return { problems: ['proof.json: not a JSON object'], warnings };
  if (proof.schema !== SCHEMA) problems.push(`proof.json: schema must be "${SCHEMA}"`);
  if (proof.tier && rank(proof.tier) >= 0 && rank(proof.tier) < rank(tier)) problems.push(`proof.json: records ${proof.tier} proof; the change needs ${tier}`);
  if (head && proof.commit && !String(head).startsWith(String(proof.commit)) && !String(proof.commit).startsWith(String(head))) {
    warnings.push(`proof.json was recorded on ${String(proof.commit).slice(0, 12)}, the PR head is ${String(head).slice(0, 12)}: re-record if behaviour changed since`);
  }
  const criteria = arr('criteria', 1);
  criteria.forEach((c, i) => {
    const name = c?.id ?? `#${i + 1}`;
    if (!c?.text) problems.push(`proof.json criterion ${name}: no text`);
    if (!STATUSES.has(c?.status)) problems.push(`proof.json criterion ${name}: status must be met, unmet or deferred`);
    if (c?.status === 'met' && !(Array.isArray(c.evidence) && c.evidence.some(e => String(e).trim()))) problems.push(`proof.json criterion ${name}: met without evidence`);
  });
  const media = arr('media', rank(tier) >= 2 ? 1 : 0);
  for (const [i, m] of media.entries()) {
    if (!['video', 'image'].includes(m?.kind)) problems.push(`proof.json media ${i + 1}: kind must be video or image`);
    if (m?.url && !/^https:\/\//.test(m.url)) problems.push(`proof.json media ${i + 1}: url must be https`);
    if (!m?.url) warnings.push(`proof.json media ${i + 1} (${m?.file ?? '?'}): no url yet (not uploaded)`);
    if (m?.kind === 'video' && (m.uncut !== true || m.realSpeed !== true)) problems.push(`proof.json media ${i + 1}: a proof video must be uncut and real speed (uncut: true, realSpeed: true)`);
  }
  if (rank(tier) >= 2 && !media.some(m => m?.kind === 'video' && m.url)) problems.push('proof.json: no uploaded video for a T2+ change');
  if (proof.files !== undefined) {
    for (const [i, f] of arr('files').entries()) {
      if (!f?.file) problems.push(`proof.json files ${i + 1}: needs a file name`);
      if (f?.url && !/^https:\/\//.test(f.url)) problems.push(`proof.json files ${i + 1}: url must be https`);
      if (!f?.url) warnings.push(`proof.json files ${i + 1} (${f?.file ?? '?'}): no url yet (not uploaded)`);
    }
  }
  const checks = arr('checks', rank(tier) >= 1 ? 1 : 0);
  for (const [i, c] of checks.entries()) if (!c?.cmd || !['pass', 'fail', 'skip'].includes(c?.result)) problems.push(`proof.json check ${i + 1}: needs cmd and result pass|fail|skip`);
  arr('failedAttempts');
  arr('externalities', rank(tier) >= 2 ? 1 : 0);
  arr('limits');
  if (rank(tier) >= 3) {
    const need = Number(knobs.repeats_per_arm ?? 2);
    const arms = proof.playtest?.arms;
    if (!Array.isArray(arms) || arms.length < 2) problems.push('proof.json: `playtest.arms` needs a baseline and a candidate arm at T3+');
    else for (const a of arms) if (!(Number(a?.repeats) >= need)) problems.push(`proof.json playtest arm ${a?.name ?? '?'}: ${a?.repeats ?? 0} repeat(s), the policy needs ${need}`);
    if (!proof.review?.verdict) problems.push('proof.json: `review` (reviewer-agent pass with a verdict) is required at T3+');
  }
  if (checklist) {
    for (const item of checklist) {
      const c = criteria.find(x => sameCriterion(x, item));
      if (!c) { problems.push(`proof.json has no criterion for "${label(item)}"`); continue; }
      const want = item.status === 'open' ? 'unmet' : item.status;
      if (c.status !== want) problems.push(`"${label(item)}" is ${item.status} in the PR but ${c.status} in proof.json`);
    }
    for (const c of criteria) if (!checklist.some(item => sameCriterion(c, item))) warnings.push(`proof.json criterion "${label(c)}" is not in the PR checklist`);
  }
  return { problems, warnings };
}

const label = c => `${c.id ? `${c.id} ` : ''}${String(c.text ?? '').slice(0, 70)}`;

// ── the PR check ────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Everything proof-check needs to say about one PR. `proof` is the parsed proof.json (or {error}) when the PR links
 * one; `issueBody` is the linked issue's body when there is one.
 */
function privacyFailure(tier, privacy) {
  const detail = `device details detected (${privacy.join(', ')}); sanitize source text/metadata before publication`;
  return { ok: false, tier, rows: [{ name: 'publication privacy', ok: false, detail }], problems: [detail], warnings: [], checklist: [], links: { videos: [], images: [], proofJson: [] }, clips: [] };
}

export function checkPr({ body = '', tier = 'T0', issueBody = null, proof = undefined, head = null, policy = loadChecks(), repo = null }) {
  const privacy = publicationFindings({ body, issueBody, proof });
  if (privacy.length) return privacyFailure(tier, privacy);
  const s = sections(body);
  const need = new Set(policy.prChecks[tier] ?? policy.prChecks.T0);
  const problems = [], warnings = [], rows = [];
  const row = (name, ok, detail) => { rows.push({ name, ok, detail }); if (ok === false) problems.push(`${name}: ${detail}`); };

  const problemText = s.problem ?? '';
  row('problem statement', meaningful(problemText) ? true : need.has('problem') ? false : null,
    meaningful(problemText) ? 'present' : 'the Problem section is empty: say who is affected and what is wrong or missing');
  const issues = linkedIssues(problemText);
  if (need.has('issue') || issues.length) row('linked issue', issues.length ? true : false, issues.length ? issues.map(n => `#${n}`).join(', ') : 'link the issue in Problem (Closes #n)');
  else warnings.push('Problem does not link an issue (Closes #n)');

  const checklist = parseChecklist(s.acceptance ?? '');
  const counts = { met: 0, unmet: 0, deferred: 0, open: 0 };
  for (const c of checklist) counts[c.status]++;
  if (need.has('acceptance')) {
    if (!checklist.length) row('acceptance', false, 'no checklist: copy the issue\'s criteria as `- [ ] **A1** ...` lines');
    else {
      const bad = [];
      for (const c of checklist) {
        if (c.status === 'met' && !hasEvidence(c.note)) bad.push(`"${label(c)}" is ticked without evidence (add "evidence:" with a link, a \`command\` -> result, or proof.json)`);
        if (c.status === 'deferred' && !deferredOk(c)) bad.push(`"${label(c)}" is deferred without an issue link (deferred: #n)`);
        if (c.status === 'unmet') bad.push(`"${label(c)}" is unmet${c.note ? `: ${c.note}` : ''}`);
        if (c.status === 'open') bad.push(`"${label(c)}" is not ticked (tick it with evidence, or mark it unmet/deferred)`);
      }
      row('acceptance', bad.length === 0, `${counts.met}/${checklist.length} met${counts.deferred ? `, ${counts.deferred} deferred` : ''}${counts.unmet ? `, ${counts.unmet} unmet` : ''}${counts.open ? `, ${counts.open} open` : ''}`);
      problems.push(...bad);
    }
    if (issueBody) {
      const fromIssue = parseChecklist(sections(issueBody).acceptance ?? '');
      const dropped = fromIssue.filter(i => !checklist.some(c => sameCriterion(c, i)));
      if (dropped.length) row('carried from the issue', false, `${dropped.length} issue criteria missing from the PR: ${dropped.map(label).map(x => `"${x}"`).join('; ')} (keep them, unmet or deferred: #n, never drop them)`);
      else if (fromIssue.length) row('carried from the issue', true, `all ${fromIssue.length} issue criteria present`);
    }
  }

  if (need.has('self_audit')) {
    const a = parseAudit(s.self_audit ?? '');
    const missing = [['checks', 'checks run'], ['failed', 'failed attempts'], ['longTail', 'long tail / externalities'], ['limits', 'known limits']]
      .filter(([k]) => !String(a[k] ?? '').trim() || EMPTY.test(String(a[k]).trim())).map(([, n]) => n);
    const commands = /`[^`]+`|```/.test(a.checks ?? '');
    row('self-audit', missing.length === 0 && commands, missing.length ? `fill: ${missing.join(', ')} ("none" is an answer)` : commands ? 'checks, failed attempts, long tail and limits filled' : 'name the commands you ran in `code`, with their results');
  }

  const links = urls(body);
  // Clip and proof.json links count only on a proof host (#765); every other one is named in the warnings.
  const v = allowedProofLinks(links.filter(isVideo), { repo }), pj = allowedProofLinks(links.filter(isProofJson), { repo });
  for (const x of [...v.ignored, ...pj.ignored]) warnings.push(`ignored proof link ${x.url}: ${x.why}`);
  const videos = v.ok, images = links.filter(isImage), proofLinks = pj.ok;
  if (need.has('clip')) row('clip', videos.length > 0, videos.length ? `${videos.length} video link(s)${images.length ? `, ${images.length} image(s)` : ''}` : 'no video link: record an uncut, real-speed clip of the changed journey (proof skill) and upload it (tools/proof/upload.mjs)');
  if (need.has('proof_json')) {
    if (!proofLinks.length) row('proof.json', false, 'no proof.json link: write the machine summary and upload it with the media');
    else if (proof === undefined) row('proof.json', null, `linked (${proofLinks[0]}), not fetched`);
    else if (proof?.error) row('proof.json', false, `could not read ${proofLinks[0]}: ${proof.error}`);
    else {
      const pv = validateProof(proof, { tier, checklist, knobs: policy.knobs, head });
      row('proof.json', pv.problems.length === 0, pv.problems.length ? `${pv.problems.length} problem(s)` : 'valid and agrees with the checklist');
      problems.push(...pv.problems.filter(p => !problems.includes(p)));
      warnings.push(...pv.warnings);
      if (need.has('playtest')) row('playtest', Array.isArray(proof.playtest?.arms) && proof.playtest.arms.length >= 2, proof.playtest?.arms ? proof.playtest.arms.map(a => `${a.name}: ${a.passed ?? '?'}/${a.repeats ?? 0}`).join(', ') : 'none in proof.json');
      if (need.has('review')) row('reviewer pass', Boolean(proof.review?.verdict), proof.review?.verdict ? `${proof.review.by ?? 'reviewer'}: ${proof.review.verdict}` : 'none in proof.json');
    }
  }
  const uniq = [...new Set(problems)];
  const clips = clipPreviews(videos, images, proof);
  return { ok: uniq.length === 0, tier, checks: [...need], rows, problems: uniq, warnings: [...new Set(warnings)], checklist, links: { videos, images, proofJson: proofLinks }, clips };
}

/** Each clip with its inline preview (tools/proof/upload.mjs uploads `<clip>.preview.gif` beside it): from proof.json
 *  `media[].preview`, else an image link in the PR named after the clip. GitHub serves release mp4s as downloads, so the
 *  comment embeds the preview and links it to the clip. */
export function clipPreviews(videos = [], images = [], proof = null) {
  const media = Array.isArray(proof?.media) ? proof.media : [];
  const stem = u => decodeURIComponent(String(u).split(/[?#]/)[0].split('/').pop() ?? '').replace(/\.[^.]+$/, '');
  return videos.map(video => {
    const fromProof = media.find(m => m?.url === video && typeof m.preview === 'string' && /^https:\/\//.test(m.preview))?.preview;
    const s = stem(video), fromBody = images.find(i => /\.gif(\?|#|$)/i.test(i) && new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.preview(-\\d+)?$`).test(stem(i)));
    return { video, preview: fromProof ?? fromBody ?? null };
  });
}

/** A note cut to the table's width, never mid-link: `https://gi` reads as a local host (#1055). checkPr has already scanned the whole note. */
function clipNote(note, max = 120) {
  const s = note || '';
  if (s.length <= max) return s;
  const start = s.slice(0, max).search(/\S*$/);
  const word = s.slice(start).match(/^\S*/)[0];
  return start + word.length > max && word.includes('://') ? s.slice(0, start).trimEnd() : s.slice(0, max);
}

/** The bot comment (updated in place by proof-check.yml). */
export function renderComment(result, { required = [], files = [], raisedByLabel = null, note = null } = {}) {
  const mark = ok => ok === true ? 'ok' : ok === false ? '**missing**' : '-';
  const out = [MARKER, `### Proof check: ${result.ok ? '`proof-ok` passes' : '`proof-ok` fails'}`, ''];
  const top = files.filter(f => f.tier === result.tier).slice(0, 4).map(f => `\`${f.file}\``);
  out.push(`**Tier ${result.tier}**${raisedByLabel ? ` (raised by the \`tier:${raisedByLabel}\` label)` : top.length ? ` from ${top.join(', ')}${files.filter(f => f.tier === result.tier).length > 4 ? ', ...' : ''}` : ''} (\`node tools/proof/tier.mjs\`).`);
  if (required.length) out.push(`**Required at ${result.tier}** (docs/process/PROOF-POLICY.yml): ${required.join('; ')}.`);
  if (note) out.push('', note);
  out.push('', '| Check | Status | Detail |', '|---|---|---|');
  for (const r of result.rows) out.push(`| ${r.name} | ${mark(r.ok)} | ${String(r.detail).replace(/\|/g, '\\|')} |`);
  if (result.checklist.length) {
    out.push('', '<details><summary>Acceptance criteria</summary>', '', '| | Criterion | Status | Evidence |', '|---|---|---|---|');
    for (const c of result.checklist) out.push(`| ${c.checked ? '[x]' : '[ ]'} | ${label(c).replace(/\|/g, '\\|')} | ${c.status} | ${clipNote(c.note).replace(/\|/g, '\\|')} |`);
    out.push('', '</details>');
  }
  const { videos, images, proofJson } = result.links;
  out.push('', `Proof links: ${videos.length} video, ${images.length} image, ${proofJson.length ? 'proof.json linked' : 'no proof.json'}.`);
  const clips = result.clips ?? [];
  if (clips.length) {
    const name = u => decodeURIComponent(String(u).split(/[?#]/)[0].split('/').pop());
    out.push('', '**Full-resolution videos** — use the original clips and their proof metadata for motion/contact review. GIFs below are reduced previews.', '');
    for (const c of clips) {
      out.push(`- [Full-resolution video: ${name(c.video)}](${c.video})`);
      if (c.preview) out.push('', `[![${name(c.video)}](${c.preview})](${c.video})`, '');
    }
  }
  if (result.problems.length) out.push('', '**To fix**', ...result.problems.map(p => `- ${p}`));
  if (result.warnings.length) out.push('', '**Warnings**', ...result.warnings.map(w => `- ${w}`));
  out.push('', '<sub>Updated on every edit, push, label and review. How to fill it: `.claude/skills/journal/SKILL.md`. T3-T4 also need the maintainer\'s sign-off (`tools/proof/gate.mjs`). A maintainer can waive with the `proof:waived` label.</sub>');
  const comment = out.join('\n');
  assertPublishable(comment);
  return comment;
}

/** A proof.json skeleton from an issue's checklist, for the journal skill. */
export function skeleton({ issueBody = '', pr = null, issue = null, tier = 'T1', commit = null }) {
  const items = parseChecklist(sections(issueBody).acceptance ?? '');
  return {
    schema: SCHEMA, pr, issue, commit, tier,
    criteria: items.map((c, i) => ({ id: c.id ?? `A${i + 1}`, text: c.text, status: 'unmet', evidence: [] })),
    media: [], checks: [], failedAttempts: [], externalities: [], limits: [],
    ...(rank(tier) >= 3 ? { playtest: { scenario: '', arms: [{ name: 'baseline', repeats: 0, passed: 0 }, { name: 'candidate', repeats: 0, passed: 0 }] }, review: { by: '', verdict: '', url: '' } } : {}),
  };
}

/** The issue number in a journal path (`.e2e/journal/388/issue.md` -> 388), else null. */
export const issueNumberFromPath = p => { const m = /(?:^|[\\/])journal[\\/](\d+)[\\/]/.exec(String(p ?? '')); return m ? Number(m[1]) : null; };
const headCommit = () => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; } };

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const ghJson = (path, extra = []) => JSON.parse(execFileSync('gh', ['api', ...extra, path], { encoding: 'utf8', maxBuffer: 1 << 26 }));

async function fetchProof(url, fetchImpl = fetch) {
  try {
    if (!/^https:\/\//.test(url)) return { error: 'not an https URL' };
    const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const text = await res.text();
    if (text.length > 1 << 20) return { error: 'larger than 1 MB' };
    return JSON.parse(text);
  } catch (e) { return { error: e.message }; }
}

/**
 * proof-check's verdict for one PR: the journal-entry check for its tier and, at T3-T4, the maintainer gate
 * (tools/proof/gate.mjs). The gate is part of `proof-ok` because the `main` ruleset requires no approving review (T0-T2
 * merge on green), so this required check is what stops `gh pr merge --auto` landing a T3/T4 PR without the maintainer.
 */
export async function prMode({ repo, pr, head, gh = ghJson, fetchImpl = fetch, policy = loadChecks(), maintainer = process.env.SIM_MAINTAINER || repo.split('/')[0] }) {
  const warningsOut = [];
  const p = gh(`repos/${repo}/pulls/${pr}`);
  const labels = (p.labels ?? []).map(l => l.name);
  const files = gh(`repos/${repo}/pulls/${pr}/files?per_page=100`, ['--paginate', '--slurp']).flat().flatMap(f => [f.filename, f.previous_filename]).filter(Boolean);
  const t = tierFor(files, loadTierPolicy(), labels);
  const required = policy.required[t.tier] ?? [];
  const author = p.user?.login ?? '';
  const headSha = head ?? p.head?.sha ?? null;
  let events = null;
  const prEvents = () => (events ??= gh(`repos/${repo}/issues/${pr}/events?per_page=100`, ['--paginate', '--slurp']).flat());
  const waivedBy = labels.includes('proof:waived') ? labelAddedBy(prEvents(), 'proof:waived') : null;
  if (waivedBy && waivedBy !== maintainer) warningsOut.push(`the \`proof:waived\` label was added by ${waivedBy}, not the maintainer (${maintainer}); it does not count`);
  const waived = waivedBy === maintainer;
  // The maintainer gate. A maintainer's waiver is itself their sign-off.
  let gate = null;
  if (needsSignOff(t.tier)) {
    gate = waived ? { ok: true, detail: `waived by @${maintainer} (\`proof:waived\`)` }
      : maintainerSignOff({ reviews: gh(`repos/${repo}/pulls/${pr}/reviews?per_page=100`, ['--paginate', '--slurp']).flat(),
        events: labels.includes(APPROVED_LABEL) ? prEvents() : [], labels, maintainer, head: headSha });
    if (gate.warning) warningsOut.push(gate.warning);
  }
  const addGate = result => {
    if (!gate) return result;
    result.rows.unshift({ name: 'maintainer sign-off', ok: gate.ok, detail: gate.detail });
    if (!gate.ok) { result.problems.unshift(`maintainer sign-off: ${gate.detail}`); result.ok = false; }
    return result;
  };
  const body = p.body ?? '';
  const titlePrivacy = publicationFindings({ title: p.title, body });
  if (titlePrivacy.length) {
    const result = addGate(privacyFailure(t.tier, titlePrivacy));
    return { result, comment: renderComment(result) };
  }
  const issueNums = linkedIssues(sections(body).problem ?? '');
  let issueBody = null;
  if (issueNums.length) { try { const i = gh(`repos/${repo}/issues/${issueNums[0]}`); if (!i.pull_request) issueBody = i.body ?? ''; } catch { /* unreadable issue: skip the carry check */ } }
  // Only a proof.json on a proof host is ever fetched (#765): never a host chosen by PR text.
  const proofUrl = allowedProofLinks(urls(body).filter(isProofJson), { repo }).ok[0];
  const proof = proofUrl ? await fetchProof(proofUrl, fetchImpl) : undefined;
  const privateInputs = publicationFindings({ body, issueBody, proof });
  if (privateInputs.length) {
    const result = addGate(privacyFailure(t.tier, privateInputs));
    return { result, comment: renderComment(result) };
  }
  if (waived || author === 'dependabot[bot]') {
    const why = waived ? `Waived by the maintainer with the \`proof:waived\` label.` : 'Dependency update from Dependabot: CI is its proof.';
    const result = addGate({ ok: true, tier: t.tier, rows: [], problems: [], warnings: warningsOut, checklist: [], links: { videos: [], images: [], proofJson: [] } });
    return { result, comment: renderComment(result, { required, files: t.byFile, raisedByLabel: t.raisedByLabel, note: why }) };
  }
  const result = addGate(checkPr({ body, tier: t.tier, issueBody, proof, head: headSha, policy, repo }));
  result.warnings.push(...warningsOut);
  return { result, comment: renderComment(result, { required, files: t.byFile, raisedByLabel: t.raisedByLabel, note: p.draft ? 'Draft PR: proof-check skips drafts and runs when the PR is marked ready for review.' : null }) };
}

async function main(argv) {
  const [mode, ...rest] = argv;
  const opt = k => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  const labels = rest.flatMap((a, i) => a === '--label' ? [rest[i + 1]] : []);
  const read = f => readFileSync(f, 'utf8');
  if (mode === 'init') {
    if (!opt('--issue')) { console.error('init needs --issue <file>'); return 2; }
    const issue = opt('--issue-number') ? Number(opt('--issue-number')) : issueNumberFromPath(opt('--issue'));
    console.log(JSON.stringify(skeleton({ issueBody: read(opt('--issue')), pr: opt('--pr') ? Number(opt('--pr')) : null, issue, commit: opt('--commit') ?? headCommit(), tier: opt('--tier') ?? 'T1' }), null, 2));
    return 0;
  }
  if (mode === 'check') {
    if (!opt('--body')) { console.error('check needs --body <file>'); return 2; }
    let tier = opt('--tier'), byFile = [], raised = null;
    if (!tier) {
      let files = [];
      if (opt('--files')) files = opt('--files').split(',');
      else if (opt('--base')) files = execFileSync('git', ['diff', '--name-only', `${opt('--base')}...${opt('--head') ?? 'HEAD'}`], { encoding: 'utf8' }).split('\n').filter(Boolean);
      const t = tierFor(files, loadTierPolicy(), labels); tier = t.tier; byFile = t.byFile; raised = t.raisedByLabel;
    }
    const policy = loadChecks();
    let proof;
    if (opt('--proof')) { try { proof = /^https:/.test(opt('--proof')) ? await fetchProof(opt('--proof')) : JSON.parse(read(opt('--proof'))); } catch (e) { proof = { error: e.message }; } }
    const result = checkPr({ body: read(opt('--body')), tier, issueBody: opt('--issue') ? read(opt('--issue')) : null, proof, head: opt('--head'), policy, repo: opt('--repo') ?? null });
    if (opt('--comment')) writeFileSync(opt('--comment'), renderComment(result, { required: policy.required[tier], files: byFile, raisedByLabel: raised }));
    if (rest.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`proof check (${tier}): ${result.ok ? 'ok' : 'FAIL'}`);
      for (const r of result.rows) console.log(`  ${r.ok === true ? 'ok  ' : r.ok === false ? 'MISS' : '-   '} ${r.name}: ${r.detail}`);
      for (const p of result.problems.filter(p => !result.rows.some(r => p === `${r.name}: ${r.detail}`))) console.log(`  fix: ${p}`);
      for (const w of result.warnings) console.log(`  warn: ${w}`);
    }
    return result.ok ? 0 : 1;
  }
  if (mode === 'pr') {
    if (!opt('--repo') || !opt('--pr')) { console.error('pr needs --repo and --pr'); return 2; }
    const { result, comment } = await prMode({ repo: opt('--repo'), pr: opt('--pr'), head: opt('--head') });
    if (opt('--comment')) writeFileSync(opt('--comment'), `${comment}\n`);
    if (opt('--summary')) appendFileSync(opt('--summary'), `${comment.replace(MARKER, '')}\n`);
    if (opt('--output')) appendFileSync(opt('--output'), `ok=${result.ok}\ntier=${result.tier}\n`);
    console.log(`proof check (${result.tier}): ${result.ok ? 'ok' : 'FAIL'}`);
    for (const p of result.problems) console.log(`  fix: ${p}`);
    return 0;
  }
  console.error('usage: acceptance.mjs check --body <file> [...] | init --issue <file> | pr --repo <r> --pr <n>');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
