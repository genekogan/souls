import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  allowedProofLinks, checkPr, clipPreviews, issueNumberFromPath, linkedIssues, loadChecks, parseAudit, parseChecklist, prMode, renderComment, sections, skeleton, validateProof, proofHostProblem, MARKER, SCHEMA,
} from './acceptance.mjs';

const policy = loadChecks();
// tools/proof/upload.mjs hosts a PR's proof on its own prerelease `proofs-<n>`; older PRs link the shared `proofs`.
const VIDEO = 'https://github.com/o/r/releases/download/proofs-7/pr-7.desktop.mp4';
const PROOF = 'https://github.com/o/r/releases/download/proofs-7/pr-7.proof.json';
const SHARED = url => url.replace('/proofs-7/', '/proofs/');

const body = ({ problem = 'Visitors on phones cannot open the seat menu. Closes #12', acceptance, audit, proof = '' } = {}) => `## Problem
<!-- a comment that must not count -->
${problem}

## Acceptance
${acceptance ?? `- [x] **A1** Tapping a seat opens its menu — evidence: ${VIDEO} at 0:07
- [x] **A2** Desktop click still works — evidence: \`node --test apps/web/src/seat.test.ts\` -> pass
- [ ] **A3** Long-press shows a hint — deferred: #44`}

## Proof
Tier: T2
${proof}

## Self-audit
${audit ?? `- **Checks run**: \`node --test apps/web/src/seat.test.ts\` -> 12/12 pass
- **Failed attempts**: first take hid the menu behind the HUD (kept: ${VIDEO.replace('desktop', 'take1')})
- **Long tail / externalities**: 100 distant seats add 0 bytes to the snapshot
- **Known limits**: none known`}

## Changelog
- changes/seat-menu.md
`;

const proofDoc = (over = {}) => ({
  schema: SCHEMA, pr: 7, issue: 12, commit: 'abc1234', tier: 'T2',
  criteria: [
    { id: 'A1', text: 'Tapping a seat opens its menu', status: 'met', evidence: [VIDEO] },
    { id: 'A2', text: 'Desktop click still works', status: 'met', evidence: ['`node --test` -> pass'] },
    { id: 'A3', text: 'Long-press shows a hint', status: 'deferred', evidence: ['#44'] },
  ],
  media: [{ file: 'desktop.mp4', url: VIDEO, kind: 'video', seconds: 21, viewport: 'desktop', uncut: true, realSpeed: true }],
  checks: [{ cmd: 'node --test apps/web/src/seat.test.ts', result: 'pass' }],
  failedAttempts: [{ what: 'take 1', why: 'menu hidden', evidence: VIDEO }],
  externalities: [{ what: 'snapshot bytes, 100 distant seats', result: '+0 B', ok: true }],
  limits: [],
  ...over,
});

test('the policy declares pr_checks for every tier, T0 only the problem statement', () => {
  assert.deepEqual(policy.prChecks.T0, ['problem']);
  for (const t of ['T1', 'T2', 'T3', 'T4']) assert.ok(policy.prChecks[t].includes('acceptance'), t);
  assert.ok(policy.prChecks.T2.includes('clip') && policy.prChecks.T3.includes('playtest'));
  assert.ok(policy.required.T2.length > 0);
  assert.equal(policy.knobs.repeats_per_arm, 2);
});

test('sections: ## and ### headings, aliases, comments stripped', () => {
  const s = sections('### Problem statement\n\nBroken <!-- hidden -->thing here now\n\n### Acceptance criteria\n- [ ] x\n\n### Other\nz');
  assert.equal(s.problem, 'Broken thing here now');
  assert.equal(s.acceptance, '- [ ] x');
  assert.equal(s['other:other'], 'z');
});

test('parseChecklist: ids, met/deferred/unmet/open and evidence notes', () => {
  const items = parseChecklist(`- [x] **A1** One — evidence: \`cmd\`
- [ ] A2: Two — unmet: flaky on phone
- [ ] ~~**A3** Three~~ deferred: #9
- [ ] Four with no note
* [X] B1. Five evidence: https://x.test/a.png`);
  assert.deepEqual(items.map(i => [i.id, i.text, i.status]), [
    ['A1', 'One', 'met'], ['A2', 'Two', 'unmet'], ['A3', 'Three', 'deferred'], [null, 'Four with no note', 'open'], ['B1', 'Five', 'met'],
  ]);
  assert.equal(items[0].note, '`cmd`');
  assert.equal(items[1].note, 'flaky on phone');
});

test('linkedIssues: closing keywords, bare refs and issue URLs, not HTML entities', () => {
  assert.deepEqual(linkedIssues('Closes #12, see https://github.com/o/r/issues/40 and &#39;'), [12, 40]);
  // the closing reference is the PR's own issue even when another issue is mentioned first (proof-check uses [0])
  assert.deepEqual(linkedIssues('Found while shipping #388 (PR #392). Closes #397'), [397, 388, 392]);
  assert.deepEqual(linkedIssues('fixes: #5 and resolves #6; see #1'), [5, 6, 1]);
});

test('parseAudit reads labelled top-level bullets with continuation lines', () => {
  const a = parseAudit('- **Checks run**: `a` -> pass\n  - `b` -> pass\n- Failed attempts: none\n- Externalities: +0 B\n- **Known limits:** grey paper');
  assert.match(a.checks, /`b`/);
  assert.equal(a.failed, 'none');
  assert.equal(a.longTail, '+0 B');
  assert.equal(a.limits, 'grey paper');
});

test('T0 needs only the problem statement', () => {
  assert.equal(checkPr({ body: '## Problem\nThe README names a removed command.\n', tier: 'T0', policy }).ok, true);
  const r = checkPr({ body: '## Problem\n\n## Acceptance\n', tier: 'T0', policy });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /problem statement/);
});

test('T1: every box needs evidence, an open box fails, the self-audit must be filled', () => {
  assert.equal(checkPr({ body: body(), tier: 'T1', policy }).ok, true);
  const open = checkPr({ body: body({ acceptance: '- [x] **A1** Works — evidence: `node --test x` -> pass\n- [ ] **A2** Also works' }), tier: 'T1', policy });
  assert.equal(open.ok, false);
  assert.ok(open.problems.some(p => /A2 Also works" is not ticked/.test(p)));
  const noEvidence = checkPr({ body: body({ acceptance: '- [x] **A1** Works' }), tier: 'T1', policy });
  assert.ok(noEvidence.problems.some(p => /without evidence/.test(p)));
  const unmet = checkPr({ body: body({ acceptance: '- [ ] **A1** Works — unmet: phone layout overflows' }), tier: 'T1', policy });
  assert.ok(unmet.problems.some(p => /unmet: phone layout overflows/.test(p)));
  const audit = checkPr({ body: body({ audit: '- **Checks run**: ran tests\n- **Failed attempts**: none' }), tier: 'T1', policy });
  assert.ok(audit.problems.some(p => /self-audit: fill: long tail \/ externalities, known limits/.test(p)));
});

test('criteria from the linked issue must be carried into the PR', () => {
  const issue = '### Problem\nx y z\n\n### Acceptance criteria\n- [ ] **A1** Tapping a seat opens its menu\n- [ ] **A4** Menu closes on Escape';
  const r = checkPr({ body: body(), tier: 'T1', issueBody: issue, policy });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some(p => /A4 Menu closes on Escape/.test(p)));
});

test('T2 needs the issue link, a clip and a valid proof.json that agrees with the checklist', () => {
  const withLinks = body({ proof: `- clip: ${VIDEO}\n- proof.json: ${PROOF}` });
  assert.equal(checkPr({ body: withLinks, tier: 'T2', proof: proofDoc(), head: 'abc1234def', policy }).ok, true);
  const bare = checkPr({ body: body({ problem: 'Visitors on phones cannot open the seat menu.', acceptance: '- [x] **A1** Opens — evidence: `node --test x` -> pass', audit: '- **Checks run**: `x` -> pass\n- **Failed attempts**: none\n- **Long tail**: +0 B\n- **Known limits**: none' }), tier: 'T2', policy });
  for (const name of ['linked issue', 'clip', 'proof.json']) assert.ok(bare.rows.find(r => r.name === name && r.ok === false), name);
  const disagree = checkPr({ body: withLinks, tier: 'T2', proof: proofDoc({ criteria: proofDoc().criteria.map(c => c.id === 'A2' ? { ...c, status: 'unmet' } : c) }), policy });
  assert.ok(disagree.problems.some(p => /A2 Desktop click still works" is met in the PR but unmet in proof.json/.test(p)));
  const unreadable = checkPr({ body: withLinks, tier: 'T2', proof: { error: 'HTTP 404' }, policy });
  assert.ok(unreadable.problems.some(p => /HTTP 404/.test(p)));
  const legacy = body({ proof: `- clip: ${SHARED(VIDEO)}\n- proof.json: ${SHARED(PROOF)}` });
  const legacyProof = proofDoc({ media: proofDoc().media.map(m => ({ ...m, url: SHARED(m.url) })) });
  assert.equal(checkPr({ body: legacy, tier: 'T2', proof: legacyProof, head: 'abc1234def', policy }).ok, true, 'links on the shared release still count');
});

test('validateProof: schema, evidence, uncut real-speed video, stale commit warning', () => {
  assert.deepEqual(validateProof(proofDoc(), { tier: 'T2' }).problems, []);
  const p = validateProof(proofDoc({ schema: 'x', media: [{ kind: 'video', url: 'http://x/a.mp4', uncut: false, realSpeed: true }], criteria: [{ id: 'A1', text: 't', status: 'met', evidence: [] }] }), { tier: 'T2', head: 'fff0000' });
  for (const re of [/schema/, /met without evidence/, /url must be https/, /uncut and real speed/]) assert.ok(p.problems.some(x => re.test(x)), re);
  assert.ok(p.warnings.some(w => /recorded on abc1234/.test(w)));
  assert.ok(validateProof(proofDoc({ tier: 'T1' }), { tier: 'T2' }).problems.some(x => /records T1 proof/.test(x)));
});

test('validateProof: files[] (logs, JSON) are checked but never count as a clip; kind file in media[] is refused', () => {
  const files = [{ file: 'run.log', url: 'https://h/pr-7.run.log', caption: '' }, { file: 'summary.json', url: 'https://h/pr-7.summary.json', caption: '' }];
  assert.deepEqual(validateProof(proofDoc({ files }), { tier: 'T2' }).problems, []);
  const noClip = validateProof(proofDoc({ media: [], files }), { tier: 'T2' });
  assert.ok(noClip.problems.some(x => /no uploaded video/.test(x)));
  const bad = validateProof(proofDoc({ files: [{ file: 'a.log', url: 'http://h/a.log' }, { file: 'b.log' }] }), { tier: 'T2' });
  assert.ok(bad.problems.some(x => /files 1: url must be https/.test(x)));
  assert.ok(bad.warnings.some(x => /files 2 \(b\.log\): no url yet/.test(x)));
  assert.ok(validateProof(proofDoc({ files: {} }), { tier: 'T2' }).problems.some(x => /`files` must be an array/.test(x)));
  const legacy = validateProof(proofDoc({ media: [...proofDoc().media, { file: 'run.log', url: 'https://h/run.log', kind: 'file' }] }), { tier: 'T2' });
  assert.ok(legacy.problems.some(x => /kind must be video or image/.test(x)));
});

test('T3 needs playtest arms with the policy repeats and a reviewer verdict', () => {
  const bad = validateProof(proofDoc({ tier: 'T3', playtest: { arms: [{ name: 'baseline', repeats: 2 }, { name: 'candidate', repeats: 1 }] } }), { tier: 'T3', knobs: policy.knobs });
  assert.ok(bad.problems.some(x => /candidate: 1 repeat/.test(x)));
  assert.ok(bad.problems.some(x => /review/.test(x)));
  const good = validateProof(proofDoc({ tier: 'T3', playtest: { arms: [{ name: 'baseline', repeats: 2 }, { name: 'candidate', repeats: 2 }] }, review: { by: 'reviewer agent', verdict: 'approve' } }), { tier: 'T3', knobs: policy.knobs });
  assert.deepEqual(good.problems, []);
});

test('the PR template itself fails T1 until filled, and the comment carries the marker', () => {
  const template = readFileSync(fileURLToPath(new URL('../../.github/pull_request_template.md', import.meta.url)), 'utf8');
  const r = checkPr({ body: template, tier: 'T1', policy });
  assert.equal(r.ok, false);
  const c = renderComment(r, { required: policy.required.T1, files: [{ file: 'apps/server/a.ts', tier: 'T1' }] });
  assert.ok(c.startsWith(MARKER));
  assert.match(c, /Tier T1/);
  assert.match(c, /`proof-ok` fails/);
});

test('skeleton turns issue criteria into unmet proof.json criteria', () => {
  const s = skeleton({ issueBody: '### Acceptance criteria\n- [ ] **A1** One\n- [ ] Two', tier: 'T3' });
  assert.deepEqual(s.criteria.map(c => [c.id, c.status]), [['A1', 'unmet'], ['A2', 'unmet']]);
  assert.ok(s.playtest && s.review);
});

test('init fills the issue number from a journal path and the commit it is given', () => {
  assert.equal(issueNumberFromPath('.e2e/journal/388/issue.md'), 388);
  assert.equal(issueNumberFromPath('/abs/clone/.e2e/journal/12/issue.md'), 12);
  assert.equal(issueNumberFromPath('issue.md'), null);
  assert.equal(issueNumberFromPath(undefined), null);
  const s = skeleton({ issueBody: '### Acceptance criteria\n- [ ] **A1** One', issue: 388, commit: 'abc1234', tier: 'T2' });
  assert.equal(s.issue, 388); assert.equal(s.commit, 'abc1234');
});

test('prMode reads the PR, files, issue and proof.json through injected gh/fetch', async () => {
  const withLinks = body({ proof: `- clip: ${VIDEO}\n- proof.json: ${PROOF}` });
  const gh = path => {
    if (path.endsWith('/pulls/7')) return { body: withLinks, labels: [], user: { login: 'someone' }, head: { sha: 'abc1234' }, draft: false };
    if (path.includes('/pulls/7/files')) return [[{ filename: 'apps/web/src/seat.ts' }]];
    if (path.endsWith('/issues/12')) return { body: '### Acceptance criteria\n- [ ] **A1** Tapping a seat opens its menu' };
    throw Error(`unexpected ${path}`);
  };
  const fetched = [];
  const fetchImpl = async url => { fetched.push(url); return { ok: true, status: 200, text: async () => JSON.stringify(proofDoc()) }; };
  const { result, comment } = await prMode({ repo: 'o/r', pr: 7, gh, fetchImpl, policy });
  assert.equal(fetched[0], PROOF, 'proof-check fetches proof.json from the per-PR release');
  assert.equal(result.tier, 'T2');
  assert.equal(result.ok, true, result.problems.join('\n'));
  assert.match(comment, /Tier T2/);
  const waiver = actor => p => p.endsWith('/pulls/7') ? { body: '', labels: [{ name: 'proof:waived' }], user: { login: 'x' } }
    : p.includes('/events') ? [[{ event: 'labeled', label: { name: 'proof:waived' }, actor: { login: actor } }]] : gh(p);
  const waived = await prMode({ repo: 'o/r', pr: 7, gh: waiver('o'), fetchImpl, policy });
  assert.equal(waived.result.ok, true);
  assert.match(waived.comment, /Waived by the maintainer/);
  const notMaintainer = await prMode({ repo: 'o/r', pr: 7, gh: waiver('someone-else'), fetchImpl, policy });
  assert.equal(notMaintainer.result.ok, false);
  assert.ok(notMaintainer.result.warnings.some(w => /does not count/.test(w)));
});

test('prMode: a T3 PR needs the maintainer\'s sign-off in proof-ok; T0-T2 do not', async () => {
  const pr = ({ labels = [], author = 'agent', body = '## Problem\nThe kernel drops a refusal reason for blocked moves. Closes #12' } = {}) => ({ body, labels: labels.map(name => ({ name })), user: { login: author }, head: { sha: 'head123' }, draft: false });
  const api = ({ files = ['packages/kernel/src/a.ts'], reviews = [], events = [], ...o } = {}) => path => {
    if (path.endsWith('/pulls/7')) return pr(o);
    if (path.includes('/pulls/7/files')) return [files.map(filename => ({ filename }))];
    if (path.includes('/pulls/7/reviews')) return [reviews];
    if (path.includes('/issues/7/events')) return [events];
    if (path.endsWith('/issues/12')) return { body: '' };
    throw Error(`unexpected ${path}`);
  };
  const T0policy = { ...policy, prChecks: { ...policy.prChecks, T3: ['problem'] } }; // isolate the gate from the T3 journal checks
  const run = o => prMode({ repo: 'o/r', pr: 7, gh: api(o), fetchImpl: async () => { throw Error('no fetch'); }, policy: T0policy, maintainer: 'o' });

  const none = await run();
  assert.equal(none.result.tier, 'T3');
  assert.equal(none.result.ok, false);
  assert.ok(none.result.problems.some(p => /^maintainer sign-off: no approval from @o/.test(p)));
  assert.match(none.comment, /maintainer sign-off \| \*\*missing\*\*/);

  const approved = await run({ reviews: [{ user: { login: 'o' }, state: 'APPROVED', commit_id: 'head123' }] });
  assert.equal(approved.result.ok, true, approved.result.problems.join('\n'));
  assert.match(approved.comment, /maintainer sign-off \| ok \| approved by @o/);

  const agentLabel = await run({ labels: ['approved:maintainer'], events: [{ event: 'labeled', label: { name: 'approved:maintainer' }, actor: { login: 'agent' } }] });
  assert.equal(agentLabel.result.ok, false);
  const ownLabel = await run({ author: 'o', labels: ['approved:maintainer'], events: [{ event: 'labeled', label: { name: 'approved:maintainer' }, actor: { login: 'o' } }] });
  assert.equal(ownLabel.result.ok, true);

  const raised = await run({ files: ['docs/a.md'], labels: ['tier:T3'] });
  assert.equal(raised.result.ok, false, 'a tier:T3 label puts the PR behind the gate');
  const dependabot = await run({ author: 'dependabot[bot]' });
  assert.equal(dependabot.result.ok, false, 'Dependabot is not exempt from the gate');
  const waived = await run({ labels: ['proof:waived'], events: [{ event: 'labeled', label: { name: 'proof:waived' }, actor: { login: 'o' } }] });
  assert.equal(waived.result.ok, true, 'the maintainer\'s waiver is their sign-off');

  for (const files of [['docs/a.md'], ['apps/server/src/account-auth.ts'], ['apps/web/src/hud.ts']]) {
    const r = await run({ files, body: '## Problem\nThe kernel drops a refusal reason for blocked moves. Closes #12' });
    assert.ok(!r.result.rows.some(x => x.name === 'maintainer sign-off'), files[0]);
    assert.ok(!r.result.problems.some(p => /maintainer sign-off/.test(p)), files[0]);
  }
});

test('the comment embeds each clip\'s preview, linked to the clip (proof.json first, else a GIF named after it)', () => {
  const GIF = VIDEO.replace('.mp4', '.preview.gif');
  assert.deepEqual(clipPreviews([VIDEO], [], { media: [{ url: VIDEO, preview: GIF }] }), [{ video: VIDEO, preview: GIF }]);
  assert.deepEqual(clipPreviews([VIDEO], [VIDEO.replace('.mp4', '.preview-2.gif')]), [{ video: VIDEO, preview: VIDEO.replace('.mp4', '.preview-2.gif') }]);
  assert.deepEqual(clipPreviews([VIDEO], ['https://h/other.preview.gif', 'https://h/pr-7.desktop.png']), [{ video: VIDEO, preview: null }]);
  const r = checkPr({ body: body({ proof: `- clips: [![desktop](${GIF})](${VIDEO})` }), tier: 'T1', policy });
  assert.deepEqual(r.clips[0], { video: VIDEO, preview: GIF });
  assert.equal(r.clips[1].preview, null, 'the kept failed take has no preview');
  const c = renderComment(r, { required: [] });
  assert.ok(c.includes(`[![pr-7.desktop.mp4](${GIF})](${VIDEO})`), c);
  const plain = renderComment(checkPr({ body: body(), tier: 'T1', policy }), { required: [] });
  assert.match(plain, /\[Full-resolution video: pr-7\.desktop\.mp4\]\(.*\)/);
  assert.match(c, /GIFs below are reduced previews/);
});

test('private PR/issue/proof values fail without being copied into the generated comment', () => {
  const privatePath = ['', 'Users', 'private-person', 'workspace'].join('/');
  for (const patch of [{ body: `## Problem\nFailure in ${privatePath}` }, { issueBody: privatePath }, { proof: { checks: [{ cmd: privatePath }] } }]) {
    const r = checkPr({ body: body(), tier: 'T1', policy, ...patch });
    assert.equal(r.ok, false);
    assert.match(r.problems.join(' '), /device details detected/);
    assert.ok(!JSON.stringify(r).includes('private-person'));
    assert.ok(!renderComment(r).includes('private-person'));
  }
  const r = checkPr({ body: body(), tier: 'T1', policy });
  r.warnings.push(privatePath);
  assert.throws(() => renderComment(r), /Publication blocked/);
});


test('privacy is never waived or skipped for Dependabot, including linked issue and proof metadata', async () => {
  const privatePath = ['', 'Users', 'fixture-person', 'workspace'].join('/');
  for (const exempt of ['waived', 'dependabot']) for (const location of ['body', 'title', 'issue', 'proof']) {
    const gh = path => {
      if (path.endsWith('/pulls/7')) return {
        title: location === 'title' ? privatePath : 'safe title',
        body: location === 'body' ? 'CPU 50%. ' + encodeURIComponent(privatePath) : body({ proof: PROOF }),
        labels: exempt === 'waived' ? [{ name: 'proof:waived' }] : [],
        user: { login: exempt === 'dependabot' ? 'dependabot[bot]' : 'agent' },
      };
      if (path.includes('/files')) return [[{ filename: 'docs/a.md' }]];
      if (path.includes('/events')) return [[{ event: 'labeled', label: { name: 'proof:waived' }, actor: { login: 'o' } }]];
      if (path.endsWith('/issues/12')) return { body: location === 'issue' ? privatePath : '' };
      throw Error('unexpected read');
    };
    const fetchImpl = async () => ({ ok: true, text: async () => JSON.stringify(location === 'proof' ? { cmd: privatePath } : proofDoc()) });
    const r = await prMode({ repo: 'o/r', pr: 7, gh, fetchImpl, policy });
    assert.equal(r.result.ok, false, exempt + '/' + location);
    assert.match(r.comment, /device details detected/);
    assert.ok(!r.comment.includes('fixture-person'));
  }
});

// #765: proof links count, and proof.json is fetched, only from a proof host.
test('proofHostProblem: this repository\'s proofs releases, GitHub attachments and the proof CDN only', () => {
  const ok = (u, o = { repo: 'o/r' }) => assert.equal(proofHostProblem(u, o), null, u);
  const no = (u, re, o = { repo: 'o/r' }) => assert.match(String(proofHostProblem(u, o)), re, u);
  ok(VIDEO); ok(PROOF); ok(SHARED(VIDEO));
  ok('https://github.com/user-attachments/assets/1a2b3c4d-1111-2222-3333-444455556666');
  ok('https://github.com/user-attachments/files/123456/run.log');
  ok('https://cdn.example.test/proofs/pr-7/clip.mp4', { repo: 'o/r', cdn: 'https://cdn.example.test/proofs' });
  // look-alike hosts and paths
  no('https://github.com.evil.test/o/r/releases/download/proofs-7/x.mp4', /not a proof host/);
  no('https://evil.test/github.com/o/r/releases/download/proofs-7/x.mp4', /not a proof host/);
  no('https://gist.github.com/o/r/releases/download/proofs-7/x.mp4', /not a proof host/);
  no('https://cdn.example.test.evil.test/proofs/x.mp4', /not a proof host/, { repo: 'o/r', cdn: 'https://cdn.example.test/proofs' });
  no('https://cdn.example.test/other/x.mp4', /not a proof host/, { repo: 'o/r', cdn: 'https://cdn.example.test/proofs' });
  // userinfo, ports, queries, fragments, plain http
  no('https://user:pw@github.com/o/r/releases/download/proofs-7/x.mp4', /userinfo/);
  no('https://github.com:8443/o/r/releases/download/proofs-7/x.mp4', /port/);
  no(`${VIDEO}?x=1`, /query/); no(`${VIDEO}#t=3`, /fragment/);
  no(VIDEO.replace('https:', 'http:'), /not https/);
  // other repositories and other release tags
  no('https://github.com/evil/r/releases/download/proofs-7/x.mp4', /proofs release \(o\/r\)/);
  no('https://github.com/o/r/releases/download/v4.14/x.mp4', /proofs release/);
  no('https://github.com/o/r/releases/download/proofs-x/x.mp4', /proofs release/);
  no('https://github.com/o/r/releases/download/proofs-7/../v1/x.mp4', /proofs release/);
  no('https://github.com/o/r/blob/main/x.mp4', /proofs release/);
  assert.equal(proofHostProblem('https://github.com/any/repo/releases/download/proofs/x.mp4', { repo: null }), null, 'a local check with no repository accepts any proofs release');
  assert.deepEqual(allowedProofLinks([VIDEO, 'https://evil.test/a.mp4'], { repo: 'o/r' }).ok, [VIDEO]);
});

test('checkPr counts clips and proof.json only on proof hosts and says why the rest were ignored', () => {
  const evil = 'https://evil.test/pr-7.proof.json', clip = 'https://evil.test/pr-7.mp4';
  const r = checkPr({ body: body({ proof: `- clip: ${clip}\n- proof.json: ${evil}` }), tier: 'T2', policy, repo: 'o/r' });
  assert.ok(!r.links.videos.includes(clip) && !r.links.proofJson.includes(evil));
  assert.ok(r.warnings.some(w => w.includes(`ignored proof link ${evil}`) && /not a proof host/.test(w)), r.warnings.join('\n'));
  assert.ok(r.problems.some(p => /no proof\.json link/.test(p)));
  const good = checkPr({ body: body({ proof: `- clip: ${VIDEO}\n- proof.json: ${PROOF}` }), tier: 'T2', policy, repo: 'o/r', proof: proofDoc() });
  assert.deepEqual(good.links.proofJson, [PROOF]);
});

test('prMode never fetches a proof.json from a host outside the allowlist', async () => {
  const evil = 'https://evil.test/pr-7.proof.json';
  const gh = path => {
    if (path.endsWith('/pulls/7')) return { body: body({ proof: `- clip: ${VIDEO}\n- proof.json: ${evil}` }), labels: [], user: { login: 'someone' }, head: { sha: 'abc1234' }, draft: false };
    if (path.includes('/pulls/7/files')) return [[{ filename: 'apps/web/src/seat.ts' }]];
    if (path.endsWith('/issues/12')) return { body: '' };
    throw Error(`unexpected ${path}`);
  };
  const fetched = [];
  const { result } = await prMode({ repo: 'o/r', pr: 7, gh, fetchImpl: async url => { fetched.push(url); throw Error('no'); }, policy });
  assert.deepEqual(fetched, []);
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some(w => w.startsWith(`ignored proof link ${evil}`)));
});
