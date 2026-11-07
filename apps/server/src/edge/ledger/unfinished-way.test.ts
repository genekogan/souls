import test from 'node:test';
import assert from 'node:assert/strict';
import {unfinishedWay} from './ledger.ts';

const link = (needs: string) => ({code: 'route.link-unusable', message: `no usable route: it would require ${needs}`});

test('PC16: a walk that needs unfinished stairs says what they are missing', () => {
  assert.equal(unfinishedWay(link('stairs f1#stairs (treads 3–5 missing)')), ' The way there needs stairs that are not finished: treads 3–5 missing.');
  assert.equal(unfinishedWay(link('stairs f1#stairs (no landing at top), stairs f2#stairs (treads 1–5 missing)')), ' The way there needs stairs that are not finished: no landing at top; treads 1–5 missing.');
});

test('PC16: a reason with parentheses of its own stays whole', () => {
  assert.equal(unfinishedWay(link('stairs s1 (top not supported (a; b))')), ' The way there needs stairs that are not finished: top not supported (a; b).');
  assert.equal(unfinishedWay(link('stairs s1 (top not supported (a; b)), stairs s2 (no landing)')), ' The way there needs stairs that are not finished: top not supported (a; b); no landing.');
});

test('PC16: other unusable links are not called unfinished stairs', () => {
  assert.equal(unfinishedWay(link('stairs s1 (floater.stairs-unsupported)')), '');
  assert.equal(unfinishedWay(link('ladder l1 (floater.ladder-unsupported)')), '');
  assert.equal(unfinishedWay(link('ladder l1 (rungs missing)')), '');
  assert.equal(unfinishedWay(link('stairs s1 (not usable)')), '');
  assert.equal(unfinishedWay({code: 'route.unreachable', message: 'stairs s1 (treads 1–5 missing)'}), '');
  assert.equal(unfinishedWay(link('ladder l1 (rungs missing), stairs s1 (treads 2–5 missing)')), ' The way there needs stairs that are not finished: treads 2–5 missing.');
});
