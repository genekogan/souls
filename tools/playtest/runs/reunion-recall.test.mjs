// #1138: the Reunion recall question reads what each Soul agreed on the first day, said on the second and where it ended.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import question from './questions/reunion-recall.mjs';

const T = Date.parse('2026-11-07T10:00:00.000Z');
const say = (text, atMs = T + 1000) => ({ verb: 'say', args: [text], atMs, line: 1 });
const walk = (id, phase = 'completed', atMs = T + 2000) => ({ verb: 'act', args: [`walk:${id}`], atMs, out: { accepted: true, receipt: { capability: `walk:${id}`, phase } } });
const here = (place, { day = null, atMs = T + 3000, near = [] } = {}) => ({ verb: 'here', args: [], atMs, out: { me: { place, placePath: [place] }, near, ...(day === null ? {} : { now: `· world day ${day}` }) } });
const plan = (place = 'the orchard', atMs = T - 5000) => say(`Tomorrow at ${place}.`, atMs);
const ctxOf = (ada, bo) => ({
  seats: ['ada', 'bo'], scenario: { seats: [{ id: 'ada', soulName: 'Ada' }, { id: 'bo', soulName: 'Bo' }] },
  requests: ['ada', 'bo'].flatMap((seat) => [{ seat, channel: 'card', sentAt: new Date(T - 9000).toISOString(), physical: [] }, { seat, channel: 'card', sentAt: new Date(T).toISOString(), physical: [] }]),
  steps: (seat) => ({ ada, bo })[seat], hasTranscript: () => true, stepRef: (s) => ({ path: 'x', line: s.line }),
});
const good = (other, ...rest) => [plan(), say(`Morning, ${other}!`), walk('flag-orchard'), ...rest];

test('both at the agreed place, by name: pass', () => {
  const r = question.score(ctxOf(good('Bo'), good('Ada')));
  assert.equal(r.verdict, 'pass'); assert.equal(r.detail.kept, true); assert.equal(r.detail.plan, 'orchard');
});
test('"both" is not Bo: a name is a whole word', () => {
  assert.equal(question.score(ctxOf([plan(), say('We both made it!'), walk('flag-orchard')], good('Ada'))).verdict, 'fail');
});
test('a Soul who says no name, or speaks only on the first day, fails', () => {
  assert.equal(question.score(ctxOf([plan(), say('Morning!'), walk('flag-orchard')], good('Ada'))).verdict, 'fail');
  assert.equal(question.score(ctxOf([plan(), say('Hi Bo', T - 4000), walk('flag-orchard')], good('Ada'))).verdict, 'fail');
});
test('the same place is not enough: it has to be the one agreed on day one', () => {
  const r = question.score(ctxOf([plan(), say('Bo!'), walk('flag-knoll')], [plan(), say('Ada!'), walk('flag-knoll')]));
  assert.equal(r.verdict, 'fail'); assert.equal(r.detail.kept, false); assert.equal(r.detail.greeted, true);
});
test('names read off `here` never pass on their own: a Soul elsewhere fails, and the order is reported', () => {
  const near = [{ id: 's_b', name: 'Bo' }], r = question.score(ctxOf([plan(), here('flag-pond', { atMs: T + 500, near }), say('Hello Bo.', T + 900)], good('Ada')));
  assert.equal(r.verdict, 'fail'); assert.equal(r.detail.rows[0].namedBeforeSeen, false); assert.equal(r.detail.rows[1].namedBeforeSeen, true);
});
test('a Soul already waiting there walks nowhere and passes', () => {
  assert.equal(question.score(ctxOf([plan(), say('Bo, here you are.'), here('flag-orchard')], good('Ada'))).verdict, 'pass');
});
test('a walk with no observed end is unknown; a later look settles it', () => {
  const going = (other, ...rest) => [plan(), say(`${other}, on my way.`), walk('flag-orchard', 'started'), ...rest];
  assert.equal(question.score(ctxOf(going('Bo'), good('Ada'))).verdict, 'unknown');
  assert.equal(question.score(ctxOf(going('Bo', here('flag-orchard', { atMs: T + 4000 })), good('Ada'))).verdict, 'pass');
});
test('no shared plan on day one is unknown, not a failure of memory', () => {
  assert.equal(question.score(ctxOf([say('See you.', T - 5000), say('Bo!'), walk('flag-orchard')], good('Ada'))).verdict, 'unknown');
  assert.equal(question.score(ctxOf([plan('the pond'), say('Bo!'), walk('flag-orchard')], good('Ada'))).verdict, 'unknown');
});
test('midnight has to fall between the cards', () => {
  const inside = [here('flag-knoll', { day: 1, atMs: T - 8000 }), here('flag-knoll', { day: 2, atMs: T - 6000 }), ...good('Bo')];
  assert.equal(question.score(ctxOf(inside, good('Ada'))).verdict, 'unknown');
  const never = [here('flag-knoll', { day: 1, atMs: T - 8000 }), ...good('Bo'), here('flag-orchard', { day: 1 })];
  assert.equal(question.score(ctxOf(never, good('Ada'))).verdict, 'unknown');
  const right = [here('flag-knoll', { day: 1, atMs: T - 8000 }), ...good('Bo'), here('flag-orchard', { day: 2 })];
  assert.equal(question.score(ctxOf(right, good('Ada'))).verdict, 'pass');
});
test('a seat that never had a second card, or no transcript, is unknown, never a fail', () => {
  const one = ctxOf(good('Bo'), good('Ada'));
  assert.equal(question.score({ ...one, requests: one.requests.filter((r) => !(r.seat === 'bo' && r.sentAt === new Date(T).toISOString())) }).verdict, 'unknown');
  assert.equal(question.score({ ...one, hasTranscript: () => false }).verdict, 'unknown');
});
