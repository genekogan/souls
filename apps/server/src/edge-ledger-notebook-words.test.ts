// #428: the notebook's words ("write in", "cross out") apply only where a notebook's line (or a cross-out) is on offer, so
// "write in the study" still reaches a desk beside a pinboard, and "cross out" keeps meaning a sign-up sheet's name.
//   node --test apps/server/src/edge-ledger-notebook-words.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCapability } from './edge/ledger/vocabulary.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mk = (obj: string, action: string, label: string, name: string) => ({ id: `object:${obj}:${action}`, verb: 'object', object: obj, action, label, available: true, target: { id: obj, kind: 'object' }, _name: name }) as any;
// as the world offers them: an object target has no names of its own, and its label ends in the thing's name
const pin = mk('e_aaaa0001', 'pin', 'Pin a note on the notice board (board)', ''), unpin = mk('e_aaaa0001', 'unpin', 'Take down your note from the notice board (board)', '');
const sign = mk('e_bbbb0002', 'sign', 'Sign the sign-up sheet (sheet)', ''), unsign = mk('e_bbbb0002', 'unsign', 'Cross your name off the sign-up sheet (sheet)', '');
const nbPin = mk('e_cccc0003', 'pin', 'Write a line in the notebook (notebook)', ''), nbUnpin = mk('e_cccc0003', 'unpin', 'Cross out your line in the notebook (notebook)', '');
const desk = { id: 'write:write.e_dddd0004', verb: 'write', label: 'Write (desk in the study)', available: true, target: { id: 'write.e_dddd0004', kind: 'spot' }, _name: 'desk' } as any;
const resolve = (input: string, caps: any[]) => { const r: any = resolveCapability(input, { caps, target: (c: any) => ({ names: c._name ? [c._name] : [], around: c === desk ? ['study'] : [], at: [1, 1] }), places: [], root: [], me: [0, 0] } as any); return r.cap?.id ?? r.code ?? r.kind; };

test('notebook words resolve only where a notebook is offered', () => {
  assert.equal(resolve('write in the study', [desk]), desk.id);
  assert.equal(resolve('write in the study', [desk, pin, unpin]), desk.id, 'a pinboard nearby does not turn "write in" into pinning');
  assert.equal(resolve('write in the notebook', [desk, pin, unpin, nbPin, nbUnpin]), nbPin.id);
  assert.equal(resolve('write a line in the notebook', [nbPin, nbUnpin]), nbPin.id);
  assert.equal(resolve('write in the study', [desk, nbPin, nbUnpin]), desk.id, 'a notebook nearby does not take "write in the study" from the desk');
  assert.equal(resolve('cross out my line in the notebook', [nbPin, nbUnpin]), nbUnpin.id);
  assert.equal(resolve('cross out my name on the sign-up sheet', [sign, unsign, nbPin, nbUnpin]), unsign.id, 'cross out keeps its sign-up meaning where that is offered');
  // review of #990: a sheet nearby doesn't take the words from the notebook they name, or from a sheet she can't cross off
  assert.equal(resolve('cross out my line in the notebook', [sign, unsign, nbPin, nbUnpin]), nbUnpin.id, 'the words name the notebook');
  const notSigned = {...unsign, available: false, blocked: {code: 'object.state', reason: 'Your name is not on this sheet.'}};
  assert.equal(resolve('cross out my line', [sign, notSigned, nbPin, nbUnpin]), nbUnpin.id, 'the sheet has nothing of hers to cross off');
  // second review of #990: words that name the sheet stay on the sheet, whatever else nearby has a line or a note of hers
  const all = [pin, unpin, sign, unsign, nbPin, nbUnpin];
  assert.equal(resolve('cross off my name from the sign-up sheet', all), unsign.id, '"from" names nothing: not the board\'s note');
  assert.equal(resolve('cross out my name from the sheet', all), unsign.id);
  assert.equal(resolve('strike off my name from the sign-up sheet', all), unsign.id);
  assert.equal(resolve('cross out your name on the sign-up sheet', [sign, unsign, nbPin, nbUnpin]), unsign.id);
  assert.equal(resolve('cross out your name', [sign, unsign, nbPin, nbUnpin]), unsign.id);
  assert.equal(resolve('cross out my line on the sign-up sheet', [sign, unsign, nbPin, nbUnpin]), unsign.id, 'the words name the sheet');
  assert.equal(resolve('cross out my name on the sign-up sheet', [sign, notSigned, nbPin, nbUnpin]), notSigned.id, 'not signed: the sheet says so, nothing else is crossed out');
  assert.equal(resolve('cross off my name from the sign-up sheet', [pin, unpin, sign, notSigned]), notSigned.id, 'not signed: the board keeps her note');
  assert.equal(resolve('cross out my line', [sign, unsign, nbPin, nbUnpin]), nbUnpin.id, 'a line is the notebook\'s');
  // what the words name decides, in order: a target's name, then a label's noun; "from" and "your" name nothing
  assert.equal(resolve('cross out my name in the notebook', all), nbUnpin.id, 'the notebook is named, whatever "name" says');
  assert.equal(resolve('cross out my name on the notice board', all), unpin.id);
  assert.equal(resolve('cross off my name from the sign-up sheet', [pin, unpin]), 'capability.unknown', 'no sheet here: the board keeps her note');
  assert.equal(resolve('cross out my name from the notebook', [pin, unpin]), 'capability.unknown');
  assert.equal(resolve('cross out', [nbPin, nbUnpin]), nbUnpin.id, 'nothing else to cross out');
  // a thing named beats a label's noun, and a blocked offer answers for itself
  assert.equal(resolve('cross off my name from the notice board', all), unpin.id);
  assert.equal(resolve('strike off my name from the board', all), unpin.id);
  const noLine = {...nbUnpin, available: false, blocked: {code: 'object.not-yours', reason: 'You have no line in this notebook.'}};
  assert.equal(resolve('cross out my line in the notebook', [sign, unsign, nbPin, noLine]), noLine.id, 'the notebook says why not');
  assert.equal(resolve('cross out my note on the sheet', [pin, unpin]), 'capability.unknown', 'a sheet that is not here');
  // bare words at something blocked get its reason; words for a thing that isn't here do nothing
  assert.equal(resolve('cross out', [nbPin, noLine]), noLine.id, 'the notebook says why not');
  assert.equal(resolve('cross out my note in the notebook', [pin, unpin]), 'capability.unknown', 'the board keeps her note');
  assert.equal(resolve('cross out my line on the board', [nbPin, nbUnpin]), 'capability.unknown');
  assert.equal(resolve('cross out my name from the notice board', [sign, unsign]), 'capability.unknown', 'the sheet keeps her name');
  assert.equal(resolve('cross out my name in the notebook', [sign, unsign]), 'capability.unknown');
  // "from" names nothing here either, and a thing's other words are that thing
  assert.equal(resolve('cross off my signature from the list', [pin, unpin]), 'capability.unknown', 'the board keeps her note');
  assert.equal(resolve('cross off my entry from the list', [pin, unpin]), 'capability.unknown');
  assert.equal(resolve('cross off the milk from the list', [pin, unpin]), 'capability.unknown');
  assert.equal(resolve('cross out my note on the noticeboard', [pin, unpin]), unpin.id);
  assert.equal(resolve('cross out my line in the journal', [nbPin, nbUnpin]), nbUnpin.id);
  assert.equal(resolve('cross out my line in the guestbook', [nbPin, nbUnpin]), 'capability.unknown', 'a guestbook is not this notebook');
  // two of a kind: the one named answers, blocked or not, and the other keeps her line or note
  const log = mk('e_eeee0005', 'unpin', 'Cross out your line in the notebook (visitors-log)', ''), journal = {...mk('e_ffff0006', 'unpin', 'Cross out your line in the notebook (journal)', ''), available: false, blocked: {code: 'object.not-yours', reason: 'You have no line in this notebook.'}};
  assert.equal(resolve('cross out my line in the journal', [log, journal]), journal.id, 'her line in the visitors log stays');
  const market = mk('e_gggg0007', 'unpin', 'Take down your note from the notice board (market-board)', ''), hall = {...mk('e_hhhh0008', 'unpin', 'Take down your note from the notice board (noticeboard)', ''), available: false, blocked: {code: 'object.not-yours', reason: 'You have no note here.'}};
  assert.equal(resolve('cross out my note on the noticeboard', [market, hall]), hall.id, 'her note on the market board stays');
  // a board and a notebook together: the word that names one never takes the other's
  const both = [pin, unpin, nbPin, nbUnpin];
  assert.equal(resolve('cross out my note in the journal', both), 'unknown', 'the note stays on the board');
  assert.equal(resolve('cross out my line on the noticeboard', both), 'unknown', 'the line stays in the notebook');
  assert.equal(resolve('remove my note from the journal', both), 'unknown');
  assert.equal(resolve('take down my line from the noticeboard', both), 'unknown');
  // nor for a thing that isn't here, in any spelling
  assert.equal(resolve('remove my line from the guestbook', [nbPin, nbUnpin]), 'capability.unknown');
  assert.equal(resolve('take down my line from the guest book', [nbPin, nbUnpin]), 'capability.unknown');
  assert.equal(resolve('cross out my line in the visitors book', [nbPin, nbUnpin]), 'capability.unknown');
  assert.equal(resolve('take down my note from the notebook', [pin, unpin]), 'capability.unknown');
  // any other word for a thing that isn't offered, not only the ones listed
  for (const w of ["visitors' book", "visitor's book", 'guest-book', 'logbook', 'diary', 'log']) assert.equal(resolve(`cross out my note in the ${w}`, [pin, unpin]), 'capability.unknown', w);
  assert.equal(resolve("cross out my line in the visitors' book", both), 'capability.unknown');
  assert.equal(resolve('cross out my note in the diary', both), 'capability.unknown');
  assert.equal(resolve('remove my line from the whiteboard', [nbPin, nbUnpin]), 'capability.unknown');
  assert.equal(resolve('take down my note from the note book', [pin, unpin]), 'capability.unknown');
  assert.equal(resolve('cross out my line in the logbook', [nbPin, nbUnpin]), nbUnpin.id);
});
