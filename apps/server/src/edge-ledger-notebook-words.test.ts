// #428: the notebook's words ("write in", "cross out") apply only where a notebook's line (or a cross-out) is on offer, so
// "write in the study" still reaches a desk beside a pinboard, and "cross out" keeps meaning a sign-up sheet's name.
//   node --test apps/server/src/edge-ledger-notebook-words.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCapability } from './edge/ledger/vocabulary.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mk = (obj: string, action: string, label: string, name: string) => ({ id: `object:${obj}:${action}`, verb: 'object', object: obj, action, label, available: true, target: { id: obj, kind: 'object' }, _name: name }) as any;
const pin = mk('e_aaaa0001', 'pin', 'Pin a note on the notice board', 'notice board'), unpin = mk('e_aaaa0001', 'unpin', 'Take down your note from the notice board', 'notice board');
const sign = mk('e_bbbb0002', 'sign', 'Sign the sign-up sheet', 'sign-up sheet'), unsign = mk('e_bbbb0002', 'unsign', 'Cross your name off the sign-up sheet', 'sign-up sheet');
const nbPin = mk('e_cccc0003', 'pin', 'Write a line in the notebook', 'notebook'), nbUnpin = mk('e_cccc0003', 'unpin', 'Cross out your line in the notebook', 'notebook');
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
});
