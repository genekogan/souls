// #1138: the Reunion recall question reads the walk id each Soul named on the first day, what it said on the second and where it ended.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import question from './questions/reunion-recall.mjs';

const T = Date.parse('2026-11-07T10:00:00.000Z');
const say = (text, atMs = T + 1000) => ({ verb: 'say', args: [text], atMs, line: 1 });
const walk = (id, phase = 'completed', atMs = T + 2000) => ({ verb: 'act', args: [`walk:${id}`], atMs, out: { accepted: true, receipt: { capability: `walk:${id}`, phase } } });
// the shape the world prints: flags are not places, so `here` says "world" beside any flag
const here = ({ day = null, atMs = T + 3000, near = [] } = {}) => ({ verb: 'here', args: [], atMs, out: { me: { place: 'world', placePath: ['World'] }, near, ...(day === null ? {} : { now: `Sun 4 Oct 2026 · 06:40 · dawn · world day ${day}` }) } });
const plan = (id = 'flag-orchard', atMs = T - 5000) => say(`Tomorrow at walk:${id}.`, atMs);
const parted = (id = 'flag-pond') => walk(id, 'completed', T - 3000);
const ctxOf = (ada, bo, more = {}) => ({
  seats: ['ada', 'bo'], scenario: { seats: [{ id: 'ada', soulName: 'Ada' }, { id: 'bo', soulName: 'Bo' }] },
  requests: ['ada', 'bo'].flatMap((seat) => [{ seat, channel: 'card', sentAt: new Date(T - 9000).toISOString(), physical: [] }, { seat, channel: 'card', sentAt: new Date(T).toISOString(), physical: [] }]),
  steps: (seat) => ({ ada, bo })[seat], hasTranscript: () => true, stepRef: (s) => ({ path: 'x', line: s.line }), ...more,
});
const good = (other, ...rest) => [plan(), parted(), say(`Morning, ${other}!`), walk('flag-orchard'), ...rest];
const verdict = (a, b = good('Ada')) => question.score(ctxOf(a, b)).verdict;

test('both finish the walk they named, by name: pass, and the `here` beside the flag changes nothing', () => {
  const r = question.score(ctxOf(good('Bo', here({ near: [{ name: 'Ada' }] })), good('Ada')));
  assert.equal(r.verdict, 'pass'); assert.equal(r.detail.kept, true); assert.equal(r.detail.plan, 'flag-orchard');
});
test('a real walk id can hold a slash', () => {
  const at = (other) => [plan('cottage/bench'), parted(), say(`${other}!`), walk('cottage/bench')];
  const r = question.score(ctxOf(at('Bo'), at('Ada')));
  assert.equal(r.verdict, 'pass'); assert.equal(r.detail.plan, 'cottage/bench');
});
test('a move this question can\'t place is unknown, finished or not; a plan\'s walk read from `pending` counts', () => {
  const move = (cap, phase) => ({ verb: 'act', args: [cap], atMs: T + 2500, out: { accepted: true, receipt: { capability: cap, phase } } });
  for (const m of [move('run:g-orchard', 'completed'), move('run:g-orchard', 'started'), move('jog:g-orchard', 'started'), move('hang-out:flag-orchard', 'completed'), move('stroll:field', 'completed')]) assert.equal(verdict([plan(), parted(), say('Bo!'), m]), 'unknown', m.args[0]);
  assert.equal(verdict([plan(), parted(), say('Bo!'), walk('flag-mill'), move('run:g-orchard', 'started')]), 'unknown');
  const planned = { verb: 'plan', args: ['["walk:flag-orchard"]'], atMs: T + 2000, out: { accepted: true, plan: { state: 'running' } } }, ended = { verb: 'pending', args: [], atMs: T + 2600, out: { endedReceipts: [{ capability: 'walk:flag-orchard', phase: 'completed' }] } };
  assert.equal(verdict([plan(), parted(), say('Bo!'), planned]), 'unknown');
  assert.equal(verdict([plan(), parted(), say('Bo!'), planned, ended]), 'pass');
});
test('a walk elsewhere whose end was seen is a miss: `act` then `wait` is one receipt', () => {
  const r = { id: 'r_9', capability: 'walk:flag-mill' }, went = [{ verb: 'act', args: ['walk:flag-mill'], atMs: T + 2000, out: { accepted: true, receipt: { ...r, phase: 'started' } } }, { verb: 'wait', args: [], atMs: T + 3000, out: { receipt: { ...r, phase: 'completed' } } }];
  assert.equal(verdict([plan(), parted(), say('Bo!'), ...went]), 'fail');
  assert.equal(verdict([plan(), parted(), say('Bo!'), went[0]]), 'unknown', 'with no end seen it stays open');
});
test('leaving after the meeting changes nothing', () => {
  assert.equal(verdict(good('Bo', walk('flag-pond', 'completed', T + 5000))), 'pass');
});
test('a plan said with punctuation or the card\'s own brackets is the same plan', () => {
  for (const said of ['Tomorrow at walk:flag-orchard)', 'Tomorrow at walk:flag-orchard:', 'Tomorrow at walk:flag-orchard—see you', 'Tomorrow at walk:flag-orchard”', 'Tomorrow at walk:<flag-orchard>']) assert.equal(verdict([say(said, T - 5000), parted(), say('Bo!'), walk('flag-orchard')]), 'pass', said);
});
test('a refused `say` greets no one and plans nothing', () => {
  const refused = { ...say('Morning, Bo.'), out: { accepted: false } };
  assert.equal(verdict([plan(), parted(), refused, walk('flag-orchard')]), 'fail');
});
test('day one read back without the phrase is still being told', () => {
  const turns = { verb: 'converse', args: ['turns', 'cv_1'], atMs: T + 500, out: { turns: [{ text: 'Shall we, by the orchard flag?' }, { text: 'Yes.' }] } };
  const events = { verb: 'events', args: [], atMs: T + 500, out: { events: [{ text: 'See you by the orchard in the morning' }] } }, id = { verb: 'events', args: [], atMs: T + 500, out: { events: [{ text: 'by walk:flag-orchard then' }] } };
  for (const read of [turns, events, id]) assert.equal(verdict([plan(), parted(), read, say('Bo!'), walk('flag-orchard')]), 'unknown', read.verb);
  const offers = { verb: 'here', args: [], atMs: T + 500, out: { me: { place: 'world' }, offers: { walk: ['walk:flag-orchard'] } } };
  assert.equal(verdict([plan(), parted(), offers, say('Bo!'), walk('flag-orchard')]), 'pass', 'an offer is not a plan');
  assert.equal(verdict([plan(), parted(), say('Bo!'), walk('flag-orchard'), { ...turns, atMs: T + 4000 }]), 'pass', 'after setting off it tells nothing');
});
test('reading the conversation back is being told, not speaking', () => {
  const turns = { verb: 'converse', args: ['turns', 'cv_1'], atMs: T + 500, out: { turns: [{ text: 'Tomorrow at walk:flag-orchard.' }] } };
  assert.equal(verdict([plan(), parted(), turns, say('Bo!'), walk('flag-orchard')]), 'unknown');
  const r = question.score(ctxOf([plan(), parted(), { verb: 'converse', args: ['turns', 'cv_1'], atMs: T + 500, out: {} }, walk('flag-orchard')], good('Ada')));
  assert.equal(r.detail.rows[0].spoke, 0);
  assert.equal(verdict([plan(), parted(), { verb: 'converse', args: ['start', 's_b', 'Morning, Bo.'], atMs: T + 600 }, walk('flag-orchard')]), 'pass');
});
test('"both" is not Bo: a name is a whole word', () => {
  assert.equal(verdict([plan(), parted(), say('We both made it!'), walk('flag-orchard')]), 'fail');
});
test('a Soul who says no name, or speaks only on the first day, fails', () => {
  assert.equal(verdict([plan(), parted(), say('Morning!'), walk('flag-orchard')]), 'fail');
  assert.equal(verdict([plan(), say('Hi Bo', T - 4000), parted(), walk('flag-orchard')]), 'fail');
});
test('the same place is not enough: it has to be the one named on day one', () => {
  const r = question.score(ctxOf([plan(), parted(), say('Bo!'), walk('flag-knoll')], [plan(), parted(), say('Ada!'), walk('flag-knoll')]));
  assert.equal(r.verdict, 'fail'); assert.equal(r.detail.kept, false); assert.equal(r.detail.greeted, true);
});
test('a name read off `here` passes nothing, and the order is reported', () => {
  const near = [{ id: 's_b', name: 'Bo' }], r = question.score(ctxOf([plan(), parted(), here({ atMs: T + 500, near }), say('Hello Bo.', T + 900)], good('Ada')));
  assert.equal(r.verdict, 'fail'); assert.equal(r.detail.rows[0].namedBeforeSeen, false); assert.equal(r.detail.rows[1].namedBeforeSeen, true);
});
test('a Soul that never left the place proves nothing: unknown, whether it stood still or ended day one there', () => {
  assert.equal(verdict([plan(), say('Bo!'), here({ near: [{ name: 'Bo' }] })]), 'unknown');
  assert.equal(verdict([plan(), walk('flag-orchard', 'completed', T - 3000), say('Bo!')]), 'unknown');
});
test('a walk with no observed end is unknown; its end, read later, settles it', () => {
  const going = (other, ...rest) => [plan(), parted(), say(`${other}, on my way.`), walk('flag-orchard', 'started'), ...rest];
  assert.equal(verdict(going('Bo')), 'unknown');
  assert.equal(verdict(going('Bo', { verb: 'wait', args: [], atMs: T + 4000, out: { receipt: { capability: 'walk:flag-orchard', phase: 'completed' } } })), 'pass');
});
test('no shared plan on day one is unknown, not a failure of memory', () => {
  assert.equal(verdict([say('See you.', T - 5000), parted(), say('Bo!'), walk('flag-orchard')]), 'unknown');
  assert.equal(verdict([plan('flag-knoll'), parted(), say('Bo!'), walk('flag-orchard')]), 'unknown');
});
test('a plan the world repeats is not recall; the Soul\'s own memory and brief are', () => {
  const told = { verb: 'pending', args: [], atMs: T + 500, out: { events: [{ text: 'Tomorrow at walk:flag-orchard.' }] } };
  assert.equal(verdict([plan(), parted(), told, say('Bo!'), walk('flag-orchard')]), 'unknown');
  const mine = { verb: 'pending', args: [], atMs: T + 500, out: { brief: 'I told them: Tomorrow at walk:flag-orchard.' } }, search = { verb: 'memory', args: ['tomorrow'], atMs: T + 600, out: { matches: [{ text: 'Tomorrow at walk:flag-orchard.' }] } };
  assert.equal(verdict([plan(), parted(), mine, search, say('Bo!'), walk('flag-orchard')]), 'pass');
});
test('the world day has to turn between the cards', () => {
  const inside = [here({ day: 1, atMs: T - 8000 }), here({ day: 2, atMs: T - 6000 }), ...good('Bo')];
  assert.equal(verdict(inside), 'unknown');
  assert.equal(verdict([here({ day: 1, atMs: T - 8000 }), ...good('Bo'), here({ day: 1 })]), 'unknown');
  assert.equal(verdict([here({ day: 1, atMs: T - 8000 }), ...good('Bo'), here({ day: 2 })]), 'pass');
});
test('whether the wake carried a brief is reported', () => {
  const listens = (seat) => (seat === 'ada' ? [{ t: new Date(T + 1).toISOString(), stdout: '{"messages":[],"brief":"x"}' }] : [{ t: new Date(T - 8000).toISOString(), stdout: '{"brief":"x"}' }]);
  const r = question.score(ctxOf(good('Bo'), good('Ada'), { listens }));
  assert.deepEqual(r.detail.rows.map((x) => x.briefAtWake), [true, false]);
});
test('a seat that never had a second card, or no transcript, is unknown, never a fail', () => {
  const one = ctxOf(good('Bo'), good('Ada'));
  assert.equal(question.score({ ...one, requests: one.requests.filter((r) => !(r.seat === 'bo' && r.sentAt === new Date(T).toISOString())) }).verdict, 'unknown');
  assert.equal(question.score({ ...one, hasTranscript: () => false }).verdict, 'unknown');
});
