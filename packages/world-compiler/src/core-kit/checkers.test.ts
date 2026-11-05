// #439 W093: the checkers rules (English draughts) the chalk-board game faculty applies.
//   node --test packages/world-compiler/src/core-kit/checkers.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKERS_START, checkersBoard, checkersCellOf, checkersMoveProblem, checkersMoves, checkersName, checkersPlay, checkersRows, checkersSquare, checkersStatus } from './checkers.ts';

/** A board text from pieces by square (`{c3: 'x', e5: 'O'}`) and the side to move. */
const board = (pieces: Record<string, string>, turn: 'X' | 'O' = 'X', chain = '') => {
  const cells = [...'.'.repeat(32)]; for (const [sq, p] of Object.entries(pieces)) { const i = checkersCellOf(sq); assert.ok(i >= 0, sq); cells[i] = p; }
  return cells.join('') + turn + chain;
};
const play = (text: string, from: string, to: string) => { assert.equal(checkersMoveProblem(text, from, to), null, `${from}-${to}`); return checkersPlay(text, from, to); };

test('squares: a1 bottom left and dark, 32 dark squares, names round-trip, face places on an 8x8 grid', () => {
  assert.equal(checkersCellOf('a1'), 28); assert.equal(checkersCellOf('h8'), 3); assert.equal(checkersCellOf('B8'), 0);
  assert.equal(checkersCellOf('a2'), -2, 'a light square'); assert.equal(checkersCellOf('i3'), -1); assert.equal(checkersCellOf('c'), -1);
  for (let i = 0; i < 32; i++) assert.equal(checkersCellOf(checkersName(i)), i);
  const [x0, y0] = checkersSquare(checkersCellOf('a1')), [x1, y1] = checkersSquare(checkersCellOf('h8'));
  assert.ok(x0 < 0 && y0 < 0 && x1 > 0 && y1 > 0); assert.ok(Math.abs(x1 - x0 - 7 * 0.066) < 1e-9 && Math.abs(y1 - y0 - 7 * 0.066) < 1e-9);
  assert.equal(checkersBoard('').cells, CHECKERS_START); assert.equal(checkersBoard('junk').fresh, true);
});

test('opening: X moves first and up, seven moves; a man never moves back or sideways', () => {
  const b = checkersBoard(''); assert.equal(b.turn, 'X'); assert.equal(checkersMoves(b).length, 7);
  assert.equal(checkersMoveProblem('', 'c3', 'd4'), null);
  assert.match(checkersMoveProblem('', 'c3', 'c4')!.reason, /light square/);
  assert.match(checkersMoveProblem('', 'c3', 'e5')!.reason, /no O piece on d4 to jump/);
  assert.match(checkersMoveProblem('', 'd4', 'e5')!.reason, /no piece on d4/);
  assert.match(checkersMoveProblem('', 'f6', 'e5')!.reason, /O's; you play X/);
  assert.match(checkersMoveProblem('', 'b2', 'c3')!.reason, /c3 is taken/);
  assert.match(checkersMoveProblem('', 'c3', 'x9')!.reason, /not a square/);
  assert.equal(checkersMoveProblem('', '', 'd4')!.code, 'capability.params');
  const r = play('', 'c3', 'd4'); assert.equal(r.captured, null); assert.equal(checkersBoard(r.text).turn, 'O');
  assert.match(checkersMoveProblem(board({ d4: 'x', h8: 'o' }, 'X'), 'd4', 'c3')!.reason, /forward only/);
});

test('captures: a jump takes the piece, a jump open must be taken, the other side recaptures', () => {
  let t = play('', 'c3', 'd4').text; t = play(t, 'f6', 'e5').text;
  assert.match(checkersMoveProblem(t, 'a3', 'b4')!.reason, /A jump is open, so it must be taken: d4 to f6/);
  const j = play(t, 'd4', 'f6'); assert.equal(j.captured, 'e5'); assert.equal(j.again, false); t = j.text;
  assert.equal(checkersStatus(t).men.O, 11);
  assert.match(checkersMoveProblem(t, 'b6', 'a5')!.reason, /must be taken: (?:e7 to g5|g7 to e5)/);
  const back = play(t, 'g7', 'e5'); assert.equal(back.captured, 'f6'); assert.deepEqual(checkersStatus(back.text).men, { X: 11, O: 11 });
});

test('a multi-jump keeps the turn and only that piece moves on', () => {
  const t = board({ c3: 'x', d4: 'o', f6: 'o', a7: 'o' }, 'X');
  const one = play(t, 'c3', 'e5'); assert.equal(one.again, true); const b = checkersBoard(one.text); assert.equal(b.turn, 'X'); assert.equal(checkersName(b.chain), 'e5');
  assert.match(checkersMoveProblem(one.text, 'e5', 'd6')!.reason, /must be taken: e5 to g7/);
  const two = play(one.text, 'e5', 'g7'); assert.equal(two.again, false); assert.equal(checkersBoard(two.text).turn, 'O'); assert.equal(checkersStatus(two.text).men.O, 1);
  const other = board({ c3: 'x', a1: 'x', d4: 'o', f6: 'o', a7: 'o' }, 'X', String(checkersCellOf('e5')).padStart(2, '0'));
  assert.match(checkersMoveProblem(other, 'a1', 'b2')!.reason, /jumping and must jump again/);
});

test('crowning: a man on the far row is a king (ending the turn), and a king moves back', () => {
  const t = board({ b6: 'x', h2: 'o' }, 'X');
  const up = play(t, 'b6', 'a7'); assert.equal(up.crowned, false); const t2 = play(up.text, 'h2', 'g1');
  assert.equal(t2.crowned, true); assert.equal(checkersBoard(t2.text).cells[checkersCellOf('g1')], 'O');
  const k = play(t2.text, 'a7', 'b8'); assert.equal(k.crowned, true); assert.equal(checkersStatus(k.text).kings.X, 1);
  assert.equal(checkersMoveProblem(play(k.text, 'g1', 'h2').text, 'b8', 'a7'), null, 'the king moves back');
  // a crowning jump ends the turn even with another jump open from the new king
  const c = board({ b6: 'x', c7: 'o', e7: 'o', h2: 'o' }, 'X'); const cj = play(c, 'b6', 'd8'); assert.equal(cj.crowned, true); assert.equal(cj.again, false); assert.equal(checkersBoard(cj.text).turn, 'O');
});

test('the end: no pieces or no move left loses; a fresh board has no winner', () => {
  const last = play(board({ c3: 'x', d4: 'o' }, 'X'), 'c3', 'e5'); assert.equal(checkersStatus(last.text).winner, 'X');
  const stuck = board({ a1: 'o', b2: 'x', c3: 'x' }, 'O'); assert.equal(checkersStatus(stuck).winner, 'X', 'O blocked in the corner');
  assert.equal(checkersStatus('').winner, null); assert.equal(checkersStatus('').fresh, true);
  const rows = checkersRows(''); assert.equal(rows.length, 9); assert.equal(rows[0], '8   o   o   o   o'); assert.equal(rows[7], '1 x   x   x   x  '); assert.equal(rows[8], '  a b c d e f g h');
});
