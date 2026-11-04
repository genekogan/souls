// scripted-owner seat adapter (#751): script validation, turn classification and real turns against a stand-in eden.mjs
// in a temporary folder (no world, no model, no network). The stand-in records each argv so the test sees exactly which
// CLI commands the adapter ran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateScript, classify, matchRule, stepOutcome, turn, renderChat } from './scripted-owner.mjs';
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
