// CTX-7 (#1140): one record per person across worlds: first met, episodes, beliefs, what I told them, commitments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSoulMemory } from './soul/memory.mjs';
import { personFile } from './soul/people.mjs';

const tmp = (t) => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'souls-people-'))); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const T0 = Date.parse('2026-11-07T10:00:00.000Z');
const near = (id, traveller) => ({ id, name: 'Ana', dist: 2, ...(traveller ? { traveller } : {}) });
const frame = (world, tick, list, place = 'pier') => ({ tick, clock: '09:15', now: '· world day 3', me: { place, placePath: [`the ${place}`], posture: 'standing' }, near: list });
const open = (dir, world = 'eden', role = 'home') => openSoulMemory(dir, { world, role, soul: 's_me' });
const file = (dir, traveller) => readFileSync(join(dir, 'memory/people', personFile(traveller)), 'utf8');
const turn = (id, conversation, text, at = T0) => ({ id, kind: 'conversation.turn', tick: 140, at, clock: '09:22', conversation, turn: { seq: 1, from: { soulId: 's_ana', name: 'Ana' }, text } });

test('A1: a record holds first met, last contact, episodes, beliefs, words, what I told them and commitments', (t) => {
  const dir = tmp(t), m = open(dir);
  m.sawHere(frame('eden', 100, [near('s_ana', 'eden/s_ana')]));
  m.sawEvents([turn('c_1', 'cv_1', 'Meet me at the mill.')]);
  m.sawReceipt({ id: 'r_1', capability: 'dance:here', phase: 'completed', endedTick: 150, endedAt: { place: 'pier' }, outcome: { summary: 'Danced with Ana.', learned: [], produced: [], met: [{ soulId: 's_ana', name: 'Ana', placeId: 'pier' }] } });
  m.remember('person', 's_ana', 'Keeps her word.');
  m.sawSaid('I will be at the mill.', { conversationId: 'cv_1' });
  m.promise('s_ana', 'Be at the mill at dawn');
  const text = file(dir, 'eden/s_ana');
  assert.match(text, /# Ana \[eden\/s\\_ana\]/);
  assert.match(text, /## First met\n- eden, day 3, 09:15 at the pier/);
  assert.match(text, /## Episodes\n- Danced with Ana\. — receipt eden:r\\_1\n- talked .* — conversation cv\\_1/, 'newest first, each a pointer');
  assert.match(text, /## What I believe\n- Keeps her word\. — my judgment/);
  assert.match(text, /## What they said — UNTRUSTED\n> Meet me at the mill\./);
  assert.match(text, /## What I have told them\n- I will be at the mill\./);
  assert.match(text, /I promised: Be at the mill at dawn \[promise:[0-9a-f]+\] — open/);
});

test('A1: a Soul met in two worlds is one record, and a record made before its traveller id was known joins it', (t) => {
  const dir = tmp(t), a = open(dir, 'eden');
  a.sawEvents([{ id: 'c_1', kind: 'speech', tick: 90, at: T0, clock: '09:00', from: { soulId: 's_ana', name: 'Ana' }, text: 'Hello.' }]);
  assert.deepEqual(readdirSync(join(dir, 'memory/people')), [personFile('eden/s_ana')]);
  a.sawHere(frame('eden', 100, [near('s_ana', 'mars/s_home')]));
  const b = open(dir, 'venus', 'visiting');
  b.sawHere(frame('venus', 200, [near('s_visit', 'mars/s_home')]));
  b.sawEvents([{ id: 'c_9', kind: 'speech', tick: 201, at: T0 + 9000, clock: '10:00', from: { soulId: 's_visit', name: 'Ana' }, text: 'Hello again.' }]);
  assert.deepEqual(readdirSync(join(dir, 'memory/people')), [personFile('mars/s_home')], 'one file, and the old one is gone');
  const text = file(dir, 'mars/s_home');
  assert.match(text, /Hello again\./); assert.match(text, /Hello\./);
  const again = open(dir, 'venus', 'visiting');
  assert.equal(again.search('Hello again').matches.length, 1, 'a replay finds the same one record');
  assert.deepEqual(readdirSync(join(dir, 'memory/people')), [personFile('mars/s_home')]);
});

test('A2: a promise is kept by what happened, never by saying so', (t) => {
  const dir = tmp(t), m = open(dir);
  m.sawHere(frame('eden', 100, [near('s_ana', 'eden/s_ana')]));
  m.sawEvents([turn('c_1', 'cv_1', 'See you.')]);
  const { promised } = m.promise('Ana', 'Walk with Ana', 'me'), theirs = m.promise('s_ana', 'Bring the map', 'them').promised;
  assert.throws(() => m.kept(promised, 'r_never'), /kept by what happened/);
  assert.throws(() => m.kept('promise:nope', 'cv_1'), /No promise/);
  m.sawReceipt({ id: 'r_f', capability: 'walk:mill', phase: 'failed', endedTick: 150, outcome: { summary: 'Blocked.', learned: [], produced: [], met: [] } });
  assert.throws(() => m.kept(promised, 'r_f'), /kept by what happened/, 'a failed act keeps nothing');
  m.sawReceipt({ id: 'r_ok', capability: 'walk:mill', phase: 'completed', endedTick: 160, outcome: { summary: 'Walked.', learned: [], produced: [], met: [] } });
  assert.equal(m.kept(promised, 'r_ok').evidence, 'eden:r_ok');
  assert.equal(m.kept(theirs, 'cv_1').evidence, 'cv_1', 'a conversation with them counts');
  const text = file(dir, 'eden/s_ana');
  assert.match(text, /I promised: Walk with Ana .* — kept, eden:r\\_ok/); assert.match(text, /They promised: Bring the map .* — kept, cv\\_1/);
});

test('A3: the brief\'s known people line reads the record, with what is open', (t) => {
  const dir = tmp(t), m = open(dir);
  m.sawHere(frame('eden', 100, [near('s_ana', 'eden/s_ana')]));
  m.remember('person', 's_ana', 'Keeps her word.');
  m.promise('s_ana', 'Meet at the mill');
  assert.match(m.brief(), /Known people here:\n- Ana: met once, last eden, day 3 at the pier\. My note: Keeps her word\. Open: I promised: Meet at the mill/);
});

test('A5: no one met, no folder; a person met once stays under 2 KB', (t) => {
  const none = tmp(t), m = open(none);
  m.sawHere(frame('eden', 100, []));
  assert.ok(!existsSync(join(none, 'memory/people')));
  const dir = tmp(t), once = open(dir);
  once.sawHere(frame('eden', 100, [near('s_ana', 'eden/s_ana')]));
  assert.ok(statSync(join(dir, 'memory/people', personFile('eden/s_ana'))).size < 2048);
});

test('an unsafe traveller id is only a file name, and stays in its folder', (t) => {
  const dir = tmp(t), m = open(dir);
  m.sawHere(frame('eden', 100, [near('s_ana', '../../../evil')]));
  assert.deepEqual(readdirSync(join(dir, 'memory/people')).length, 1);
  assert.ok(!readdirSync(join(dir, 'memory/people'))[0].includes('/'));
  assert.ok(!existsSync(join(dir, '..', 'evil.md')));
});
