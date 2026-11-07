// scripted-owner seat adapter (#751): script validation, turn classification and real turns against a stand-in eden.mjs
// in a temporary folder (no world, no model, no network). The stand-in records each argv so the test sees exactly which
// CLI commands the adapter ran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateScript, classify, matchRule, stepOutcome, turn, renderChat, bindPrev, keptOutput, OUTPUT_KEEP } from './scripted-owner.mjs';
import { seatActs } from '../../review/run.mjs';
import { brief } from '../../../world-launcher/soul/eden.mjs';
import { ADAPTERS } from '../seat.mjs';
import { providerPolicy } from '../../lib/provider-policy.mjs';
import { wakeText, onboardingText } from '../seat.mjs';

const STANDIN = `import { appendFileSync } from 'node:fs';
const a = process.argv.slice(2); appendFileSync('calls.jsonl', JSON.stringify(a) + '\\n');
if (a[0] === 'act') { if (a[1].includes('swim')) { console.log(JSON.stringify({ accepted: false, code: 'no-offer' })); } else console.log(JSON.stringify({ accepted: true, receipt: { id: 'r1', phase: a.includes('--wait') ? 'completed' : 'running' } })); }
else if (a[0] === 'status') console.log(JSON.stringify({ paired: true, soul: { id: 's1' } }));
else console.log(JSON.stringify({ ok: true, cmd: a[0] }));`;
const folder = () => { const d = mkdtempSync(join(tmpdir(), 'scripted-owner-')); writeFileSync(join(d, 'eden.mjs'), STANDIN); return d; };
const calls = (d) => readFileSync(join(d, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const SCRIPT = { rules: [
  { match: 'orchard', ack: 'Heading to the orchard', do: [['act', 'walk to the orchard']], close: 'open' },
  { match: 'pond', supersede: 'Owner changed the plan', do: [['act', 'walk to the pond', '--wait', '90'], ['say', 'At the pond']], result: 'At the pond' },
  { match: 'swim', do: [['act', 'swim across']] },
] };
const wake = (msgs) => wakeText('node eden.mjs listen', JSON.stringify({ messages: msgs, next: 'ack each' }));

test('validateScript names every problem and refuses commands the adapter owns', () => {
  assert.deepEqual(validateScript(SCRIPT), []);
  assert.deepEqual(validateScript(null), ['script.rules[] required']);
  const errs = validateScript({ rules: [{ match: '(', do: [['register', 'x']], close: 'later', extra: 1 }], other: 1 });
  assert.equal(errs.length, 5, errs.join('\n'));
  assert.ok(errs.some((e) => /adapter's own/.test(e)));
});

test('classify reads onboarding, nudges, wakes and typed chat from the harness texts', () => {
  assert.deepEqual(classify(onboardingText('http://127.0.0.1:4321/w/x', 'Ada')), { kind: 'onboard', base: 'http://127.0.0.1:4321/w/x', soulName: 'Ada' });
  assert.equal(classify('Onboarding is not finished. Run one command…').kind, 'onboard');
  assert.deepEqual(classify(wake([{ id: 'm1', text: 'go' }])).messages, [{ id: 'm1', text: 'go' }]);
  assert.equal(classify('hello there').kind, 'chat');
  assert.equal(matchRule(SCRIPT, 'Please go to the ORCHARD').match, 'orchard');
  assert.equal(matchRule(SCRIPT, 'dance'), null);
  assert.equal(stepOutcome({ code: 0, stdout: '{"accepted":false,"code":"no-offer"}' }).why, 'no-offer');
  assert.equal(stepOutcome({ code: 0, stdout: '{"accepted":true,"receipt":{"phase":"failed","reason":"blocked"}}' }).why, 'failed: blocked');
  assert.equal(stepOutcome({ code: 1, stdout: '', stderr: 'boom' }).ok, false);
  const sat = { accepted: true, receipt: { id: 'r1', phase: 'started' }, events: [{ kind: 'activity.observed', receipt: { id: 'r1' }, action: { status: 'executing' } }] };
  assert.equal(stepOutcome({ code: 0, stdout: JSON.stringify(sat) }, { waited: true }).ongoing, true, 'a seated sit is under way, not failed');
  assert.equal(stepOutcome({ code: 0, stdout: JSON.stringify({ ...sat, events: [] }) }, { waited: true }).why, 'still started after waiting');
  assert.equal(stepOutcome({ code: 0, stdout: JSON.stringify({ ...sat, events: [] }) }).ok, true, 'without --wait a started receipt is fine');
  // eden.mjs brief() drops the receipt when its output passes 600 chars or the receipt fetch failed: never a done.
  // Shapes produced by the real brief(), not hand-written, so a change to the CLI's output keeps this honest.
  const walking = { id: 'r2', capability: 'walk', phase: 'started', now: 'walking to the hall, 12 m left.' };
  const owner = [1, 2, 3].map((i) => ({ id: `m${i}`, text: `owner message ${i} `.repeat(12) }));
  const cut = brief({ accepted: true, waited: '9s', receipt: walking, ownerMessages: owner });
  assert.equal(cut.receipt, undefined, 'brief drops the receipt for a long output');
  assert.equal(cut.done, false);
  assert.deepEqual(stepOutcome({ code: 0, stdout: JSON.stringify(cut) }, { waited: true }), { ok: false, why: 'receipt unknown after waiting: completion not confirmed' });
  const fetchErr = brief({ accepted: true, waited: '60s', receipt: { error: 'HTTP 503' } });
  assert.deepEqual(fetchErr, { accepted: true, waited: '60s' });
  assert.equal(stepOutcome({ code: 0, stdout: JSON.stringify(fetchErr) }, { waited: true }).ok, false, 'a receipt-fetch error is not a completion');
  assert.equal(stepOutcome({ code: 0, stdout: JSON.stringify({ accepted: true, waited: '60s', receipt: { error: 'HTTP 503' } }) }, { waited: true }).ok, false, '--json form of the same error');
  const finishedLong = brief({ accepted: true, waited: '20s', receipt: { ...walking, phase: 'completed', done: 'walked to the hall.' }, ownerMessages: owner });
  assert.equal(stepOutcome({ code: 0, stdout: JSON.stringify(finishedLong) }, { waited: true }).ok, false, 'even a finished sentence without its receipt is unconfirmed');
  assert.equal(stepOutcome({ code: 0, stdout: JSON.stringify({ accepted: true, waited: '20s', receipt: { ...walking, phase: 'completed' }, ownerMessages: owner }) }, { waited: true }).ok, true, 'output that keeps its receipt (short brief, or --json in a script) counts');
  assert.equal(stepOutcome({ code: 0, stdout: JSON.stringify({ ...cut, events: [{ kind: 'activity.observed', action: { status: 'executing' } }] }) }, { waited: true }).ok, false, 'activity not tied to this receipt does not count');
  assert.equal(stepOutcome({ code: 0, stdout: 'walk completed' }, { waited: true }).ok, false, 'unparsed output is not a completion');
});

test('a redirection closes the open request as failed, then serves the new one through the CLI', async () => {
  const d = folder();
  const t1 = await turn({ cwd: d, text: wake([{ id: 'm1', text: 'walk to the orchard' }]), script: SCRIPT });
  assert.equal(t1.exit, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.scripted-owner.json'), 'utf8')).open, ['m1']);
  const t2 = await turn({ cwd: d, text: wake([{ id: 'm2', text: 'change of plan: the pond' }]), script: SCRIPT });
  assert.deepEqual(calls(d), [
    ['ack', 'm1', 'Heading to the orchard'], ['act', 'walk to the orchard'],
    ['result', 'm1', 'failed', 'Owner changed the plan'], ['ack', 'm2', 'On it.'], ['act', 'walk to the pond', '--wait', '90'], ['say', 'At the pond'], ['result', 'm2', 'done', 'At the pond'],
  ]);
  assert.deepEqual(t2.usage, { inputTokens: 0, cachedTokens: 0, cacheCreationTokens: 0, outputTokens: 0, costUsd: 0 });
  assert.equal(t2.toolCalls.length, 5);
  assert.match(renderChat(t2.stream), /node eden\.mjs result m1 failed "Owner changed the plan"/);
  // A redelivered message is not served twice.
  await turn({ cwd: d, text: wake([{ id: 'm2', text: 'change of plan: the pond' }]), script: SCRIPT });
  assert.equal(calls(d).length, 7);
});

test('a refused step and an unmatched message both end in an honest failed result', async () => {
  const d = folder();
  await turn({ cwd: d, text: wake([{ id: 'm1', text: 'swim to the island' }, { id: 'm2', text: 'dance' }]), script: SCRIPT });
  assert.deepEqual(calls(d), [['ack', 'm1', 'On it.'], ['act', 'swim across'], ['result', 'm1', 'failed', 'act: no-offer'], ['ack', 'm2'], ['result', 'm2', 'failed', 'no scripted response']]);
});

test('onboarding runs register, create and status from the served CLI already in the folder', async () => {
  const d = folder();
  const r = await turn({ cwd: d, text: onboardingText('http://127.0.0.1:1/w/x', 'Ada'), script: SCRIPT });
  assert.equal(r.exit, 0);
  assert.deepEqual(calls(d), [['register', 'http://127.0.0.1:1/w/x'], ['create', 'Ada'], ['status']]);
});

test('an invalid script fails the turn without running anything; the adapter is registered and needs no provider', async () => {
  const d = folder();
  const r = await turn({ cwd: d, text: 'hi', script: { rules: [] } });
  assert.equal(r.exit, 1);
  assert.equal(existsSync(join(d, 'calls.jsonl')), false);
  assert.equal(ADAPTERS['scripted-owner'].name, 'scripted-owner');
  assert.deepEqual(providerPolicy({ providers: { allowed: ['codex'] }, seats: [{ id: 'a', adapter: 'scripted-owner' }], director: { mode: 'scripted' }, review: { mode: 'deterministic', developer: false } }).required, []);
});

test('a turn cut short before its result leaves the card unhandled, so re-delivery answers it', async () => {
  const d = folder();
  // A stand-in whose `act` outlasts the turn wall; every other command answers at once.
  writeFileSync(join(d, 'eden.mjs'), `import { appendFileSync } from 'node:fs';
const a = process.argv.slice(2); appendFileSync('calls.jsonl', JSON.stringify(a) + '\\n');
if (a[0] === 'act' && !process.env.FAST) await new Promise((r) => setTimeout(r, 5000));
console.log(JSON.stringify(a[0] === 'act' ? { accepted: true, receipt: { id: 'r1', phase: 'completed' } } : { ok: true }));`);
  const pond = { rules: [{ match: 'pond', do: [['act', 'walk to the pond', '--wait', '90']], result: 'At the pond' }] };
  const t1 = await turn({ cwd: d, text: wake([{ id: 'm1', text: 'the pond' }]), script: pond, maxWallSec: 1 });
  assert.equal(t1.timedOut, true);
  const st = join(d, '.scripted-owner.json');
  assert.deepEqual(existsSync(st) ? JSON.parse(readFileSync(st, 'utf8')).handled : [], []);
  process.env.FAST = '1';
  try { await turn({ cwd: d, text: wake([{ id: 'm1', text: 'the pond' }]), script: pond }); } finally { delete process.env.FAST; }
  assert.deepEqual(calls(d).at(-1), ['result', 'm1', 'done', 'At the pond']);
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.scripted-owner.json'), 'utf8')).handled, ['m1']);
});

// #828: a refusal the script expects, then a recovery that takes the refusal's own suggestion.
const RECOVER = `import { appendFileSync } from 'node:fs';
const a = process.argv.slice(2); appendFileSync('calls.jsonl', JSON.stringify(a) + '\\n');
if (a[0] === 'act' && a[1].includes('fly')) { console.log(JSON.stringify({ accepted: false, code: 'capability.unknown', did_you_mean: [{ id: 'walk:g-field', label: 'Walk to the field' }, { id: 'walk:g-pond' }] })); process.exit(1); }
else if (a[0] === 'act') console.log(JSON.stringify({ accepted: true, receipt: { id: 'r9', phase: 'completed', capability: a[1] } }));
else console.log(JSON.stringify({ ok: true, cmd: a[0] }));`;
const recoverFolder = () => { const d = mkdtempSync(join(tmpdir(), 'scripted-recover-')); writeFileSync(join(d, 'eden.mjs'), RECOVER); return d; };
const resultOf = (d) => calls(d).find((c) => c[0] === 'result');

test('onRefused continue: a refused step is recorded and the next step takes the refusal\'s alternative', async () => {
  const d = recoverFolder();
  const script = { rules: [{ match: 'field', do: [['act', 'fly up to the field', { onRefused: 'continue' }], ['act', '{{prev.did_you_mean[0].id}}', '--wait', '30']], result: 'Walked instead' }] };
  assert.deepEqual(validateScript(script), []);
  const t = await turn({ cwd: d, text: wake([{ id: 'm1', text: 'fly to the field' }]), script });
  assert.deepEqual(calls(d).filter((c) => c[0] === 'act'), [['act', 'fly up to the field'], ['act', 'walk:g-field', '--wait', '30']]);
  assert.deepEqual(resultOf(d), ['result', 'm1', 'done', 'Walked instead']);
  const text = JSON.stringify(t.stream);
  assert.match(text, /act refused, continuing: .*capability\.unknown/);
  assert.match(text, /node eden.mjs act walk:g-field --wait 30/, 'the transcript shows the resolved command');
});

test('the default stays fail: a refused step stops the rule and the request fails', async () => {
  const d = recoverFolder();
  await turn({ cwd: d, text: wake([{ id: 'm1', text: 'fly' }]), script: { rules: [{ match: 'fly', do: [['act', 'fly up'], ['act', '{{prev.did_you_mean[0].id}}']] }] } });
  assert.equal(calls(d).filter((c) => c[0] === 'act').length, 1);
  assert.equal(resultOf(d)[2], 'failed');
});

test('an unresolved {{prev…}} fails its step without running it; onRefused applies to it too', async () => {
  const d = recoverFolder();
  await turn({ cwd: d, text: wake([{ id: 'm1', text: 'fly' }]), script: { rules: [{ match: 'fly', do: [['act', 'fly up', { onRefused: 'continue' }], ['act', '{{prev.alternatives[0].id}}']] }] } });
  assert.equal(calls(d).filter((c) => c[0] === 'act').length, 1, 'the unresolved step never ran');
  assert.deepEqual(resultOf(d).slice(0, 3), ['result', 'm1', 'failed']);
  assert.match(resultOf(d)[3], /unresolved \{\{prev\.alternatives\[0\]\.id\}\}/);
});

test('a refused final step fails the request even with onRefused continue', async () => {
  const d = recoverFolder();
  await turn({ cwd: d, text: wake([{ id: 'm1', text: 'fly' }]), script: { rules: [{ match: 'fly', do: [['act', 'walk:g-field'], ['act', 'fly up', { onRefused: 'continue' }]], result: 'Flew' }] } });
  assert.equal(calls(d).filter((c) => c[0] === 'act').length, 2);
  assert.deepEqual(resultOf(d).slice(0, 3), ['result', 'm1', 'failed']);
  assert.match(resultOf(d)[3], /^act: .*capability\.unknown/);
});

test('a step skipped for an unresolved {{prev…}} leaves no JSON for the step after it', async () => {
  const d = recoverFolder();
  const script = { rules: [{ match: 'fly', do: [['act', 'fly up', { onRefused: 'continue' }], ['act', '{{prev.alternatives[0].id}}', { onRefused: 'continue' }], ['act', '{{prev.did_you_mean[0].id}}']] }] };
  await turn({ cwd: d, text: wake([{ id: 'm1', text: 'fly' }]), script });
  assert.equal(calls(d).filter((c) => c[0] === 'act').length, 1, 'neither placeholder step ran: the refusal two steps back is not reused');
  assert.deepEqual(resultOf(d).slice(0, 3), ['result', 'm1', 'failed']);
  assert.match(resultOf(d)[3], /unresolved \{\{prev\.did_you_mean\[0\]\.id\}\} \(the previous step printed no JSON\)/);
});

test('bindPrev reads own properties only, never the prototype chain', () => {
  const prev = JSON.parse('{"did_you_mean":[{"id":"walk:g-field"}],"n":3}');
  assert.deepEqual(bindPrev(['{{prev.did_you_mean[0].id}}', 'x{{prev.n}}'], prev), { args: ['walk:g-field', 'x3'] });
  for (const path of ['constructor.name', 'toString', 'did_you_mean[0].constructor.name', '__proto__.constructor.name', 'did_you_mean[0].id.length'])
    assert.match(bindPrev([`{{prev.${path}}}`], prev).error, /^unresolved/, path);
});

test('step options and {{prev}} placeholders are validated by field', () => {
  const v = (step, j = 1) => validateScript({ rules: [{ match: 'x', do: j ? [['status'], step] : [step] }] });
  assert.deepEqual(v(['act', 'x', { onRefused: 'continue' }]), []);
  assert.deepEqual(v(['act', 'x', { onRefused: 'ignore' }]), ['script.rules[0].do[1].onRefused: continue or fail']);
  assert.deepEqual(v(['act', 'x', { retry: 2 }]), ['script.rules[0].do[1].retry is unknown (step options: onRefused)']);
  assert.deepEqual(v(['act', { onRefused: 'continue' }, 'x']), ['script.rules[0].do: a list of eden.mjs argument lists'], 'options only at the end');
  assert.deepEqual(v(['act', '{{prev.did_you_mean[0].id}}'], 0), ['script.rules[0].do[0]: {{prev.did_you_mean[0].id}} needs a previous step']);
  assert.deepEqual(v(['act', '{{prev.a..b}}']), ['script.rules[0].do[1]: {{prev.a..b}} is not a path like prev.did_you_mean[0].id']);
});

test('a long CLI output is kept whole for scoring; past the bound it carries a marker and a flag (#371)', async () => {
  // `around` with a route and `map` with its flags run past the old 4000-character window: the scorer read them as broken strings
  const d = mkdtempSync(join(tmpdir(), 'scripted-owner-')), route = Array.from({ length: 600 }, (_, i) => ({ step: i, toward: `the far gate ${i}` }));
  writeFileSync(join(d, 'eden.mjs'), `const a = process.argv.slice(2);
if (a[0] === 'around') console.log(JSON.stringify({ places: [], route: { found: true, steps: ${JSON.stringify(route)} } }));
else if (a[0] === 'map') process.stdout.write('x'.repeat(${OUTPUT_KEEP + 512 * 1024}));
else console.log(JSON.stringify({ ok: true }));`);
  const t = await turn({ cwd: d, text: wake([{ id: 'm1', text: 'look around' }]), script: { rules: [{ match: 'look', do: [['around'], ['map']] }] } });
  const results = t.stream.flatMap((e) => e.message?.content ?? []).filter((c) => c.type === 'tool_result');
  const around = results[1], map = results[2];
  assert.ok(around.content.length > 20000, `around is ${around.content.length} characters`);
  assert.deepEqual(JSON.parse(around.content).route.steps, route, 'kept byte for byte');
  assert.equal(around.truncated, undefined);
  assert.equal(map.truncated, true);
  assert.ok(map.content.startsWith('x'.repeat(OUTPUT_KEEP)));
  assert.match(map.content, new RegExp(`\\n\\[scripted-owner: output truncated: ${OUTPUT_KEEP} of ${OUTPUT_KEEP + 512 * 1024} characters kept\\]$`));
  // the scorer reads the transcript as the run stores it
  const acts = seatActs({ seats: { pip: { turns: [{ turn: 1 }], transcript: t.stream.map((e) => ({ ...e, turn: 1 })) } } }, 'pip', [1]);
  const a = acts.find((x) => / around$/.test(x.cmd)), m = acts.find((x) => / map$/.test(x.cmd));
  assert.equal(a.output.route.found, true, 'parsed as JSON, not a cut string'); assert.equal(a.truncated, undefined);
  assert.equal(m.truncated, true);
  // short outputs are stored exactly as before
  assert.deepEqual(keptOutput('{"ok":true}\n'), { content: '{"ok":true}\n' });
  assert.deepEqual(keptOutput('abcdef', 4), { content: 'abcd\n[scripted-owner: output truncated: 4 of 6 characters kept]', truncated: true });
});
