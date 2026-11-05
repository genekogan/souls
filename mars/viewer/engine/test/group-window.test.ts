// E2 #2 (2026-10-16): a grouped activity pose under window policy once-v1 opens its shared window once. A body still settling
// after a courtesy step (its `until` stale) is no partner, so a late guest never seeds a second "shared" window from it; the
// late guest does the pose alone at once, marked late. Without the policy (older logs) the legacy behaviour is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../runtime/runtime.ts';
import {DEFAULT_INVARIANTS} from '../runtime/invariants.ts';
import {Spatial} from '../spatial/service.ts';
import {provingGround} from '../scenes/proving-ground.ts';
import {emptyWorld, human, addAll} from '../world/factory.ts';
import {poseV1} from '../social/pose.ts';
import type {ActionDef} from '../actions/types.ts';
import {walkTo} from '../locomotion/walk.ts';

function fixture(extra = false) {
  const scene = provingGround(), world = addAll(emptyWorld('proving-ground', scene), human('a', -6, -6), human('b', -4, -6), human('c', -5, -4), human('d', 6, 6), ...(extra ? [human('e', -4, -3)] : []));
  const registry = new Map<string, ActionDef>([[poseV1.verb, poseV1], [walkTo.verb, walkTo]]), spatial = new Spatial(scene); spatial.sync(world);
  return new Runtime(world, registry, {spatial}, DEFAULT_INVARIANTS);
}
type Policy = 'once-v1' | 'once-v2';
const jj = (actor: string, policy?: Policy) => ({actor, activity: 'jumping-jacks', seconds: 6, group: 'inv_g', waitSeconds: 20, alone: 'start' as const, need: 1, ...(policy ? {windowPolicy: policy} : {})});

/** a and b share a window; b is nudged aside just before it ends, so its stale `until` outlives the window; c arrives late. */
function lateGuest(policy?: 'once-v1') {
  const rt = fixture(), a = rt.submit('pose_v1', jj('a', policy)), b = rt.submit('pose_v1', jj('b', policy));
  for (let i = 0; i < 20 && rt.world.entities.a.human!.together?.phase !== 'active'; i++) rt.step();
  const until = rt.world.entities.a.human!.together!.until!;
  assert.equal(rt.world.entities.b.human!.together!.until, until, 'a and b share one window');
  while (rt.tick < until - 5) rt.step();
  const nudge = rt.submit('walk_to', {actor: 'b', x: -4, z: -10}, {id: 'b:make-way:1'});
  while (rt.tick < until + 3) rt.step();
  assert.ok(rt.isActive(nudge.id), 'b is still stepping aside after the window');
  assert.equal(rt.world.entities.b.human!.together?.until, until, "b's until is stale while it settles");
  const c = rt.submit('pose_v1', jj('c', policy)), startedAt = rt.tick;
  const untils = new Set<number>(), cSeen: {tick: number; activity: string; until?: number; late?: true}[] = [];
  for (let i = 0; i < 1200 && [a, b, c, nudge].some(r => rt.isActive(r.id)); i++) {
    rt.step();
    for (const id of ['a', 'b', 'c']) { const t = rt.world.entities[id].human!.together; if (t?.until !== undefined) untils.add(t.until); }
    const h = rt.world.entities.c.human!; cSeen.push({tick: rt.tick, activity: h.activity, until: h.together?.until, late: h.together?.late});
  }
  return {rt, a, b, c, until, startedAt, untils, cSeen};
}

test('legacy (no window policy): unchanged; the late guest counts the settling body as a partner and opens a second window', () => {
  const r = lateGuest();
  const first = r.cSeen.find(f => f.activity === 'jumping-jacks')!;
  assert.ok(first.tick - r.startedAt <= 2, 'starts at once, because a stale peer counts');
  assert.equal(r.untils.size, 2, 'two deadlines (the recorded E2 #2 symptom)');
  assert.equal(first.late, undefined);
});

test('once-v1: a stale settling peer is no partner; the late guest does it alone at once, marked late; the group keeps one shared window', () => {
  const r = lateGuest('once-v1');
  const first = r.cSeen.find(f => f.activity === 'jumping-jacks')!;
  assert.ok(first, 'c still does jumping jacks');
  assert.ok(first.tick - r.startedAt <= 2, 'no 20 s wait');
  assert.equal(first.late, true, 'marked late in its body state');
  assert.ok(first.until! > r.until, "c's own window starts after the shared one ended");
  assert.deepEqual(r.untils, new Set([r.until, first.until]));
  for (const x of [r.a, r.b, r.c]) assert.equal(x.status, 'completed', x.id + ' ' + JSON.stringify(x.diagnostic));
  assert.deepEqual(r.c.outputs, {seconds: 6, group: 'inv_g', late: true});
  assert.equal(r.a.outputs?.late, undefined); assert.equal(r.b.outputs?.late, undefined);
});

test('once-v1: a guest that arrives inside the window joins it (one deadline for all three)', () => {
  const rt = fixture(), a = rt.submit('pose_v1', jj('a', 'once-v1')), b = rt.submit('pose_v1', jj('b', 'once-v1'));
  for (let i = 0; i < 40; i++) rt.step();
  const c = rt.submit('pose_v1', jj('c', 'once-v1')), untils = new Set<number>();
  for (let i = 0; i < 400 && [a, b, c].some(r => rt.isActive(r.id)); i++) { rt.step(); for (const id of ['a', 'b', 'c']) { const t = rt.world.entities[id].human!.together; if (t?.until !== undefined) untils.add(t.until); } }
  assert.equal(untils.size, 1); for (const x of [a, b, c]) { assert.equal(x.status, 'completed'); assert.equal(x.outputs?.late, undefined); }
});

test('once-v1 with alone:fail refuses a late arrival with a reason; the policy is refused on paired gestures and games', () => {
  const rt = fixture();
  assert.equal(rt.submit('pose_v1', {actor: 'a', activity: 'hug', seconds: 2, group: 'p', gap: .52, pairedPolicy: 'ready-v1', windowPolicy: 'once-v1'}).diagnostic?.code, 'action.invalid-params');
  assert.equal(rt.submit('pose_v1', {actor: 'a', activity: 'jumping-jacks', seconds: 2, windowPolicy: 'once-v1'}).diagnostic?.code, 'action.invalid-params', 'needs a group');
  assert.equal(rt.submit('pose_v1', {actor: 'a', activity: 'hug', seconds: 2, group: 'p', gap: .52, pairedPolicy: 'ready-v1', windowPolicy: 'once-v2'}).diagnostic?.code, 'action.invalid-params');
  assert.equal(rt.submit('pose_v1', {actor: 'a', activity: 'jumping-jacks', seconds: 2, group: 'g', windowPolicy: 'once-v3'}).diagnostic?.code, 'action.invalid-params', 'unknown policy');
  const r = lateGuestFail();
  assert.equal(r.status, 'failed'); assert.equal(r.diagnostic?.code, 'pose.window-closed');
});
function lateGuestFail() {
  const rt = fixture(); rt.submit('pose_v1', jj('a', 'once-v1')); rt.submit('pose_v1', jj('b', 'once-v1'));
  for (let i = 0; i < 20 && rt.world.entities.a.human!.together?.phase !== 'active'; i++) rt.step();
  const until = rt.world.entities.a.human!.together!.until!;
  while (rt.tick < until - 5) rt.step();
  rt.submit('walk_to', {actor: 'b', x: -4, z: -10}, {id: 'b:make-way:1'});
  while (rt.tick < until + 3) rt.step();
  const c = rt.submit('pose_v1', {...jj('c', 'once-v1'), alone: 'fail' as const});
  for (let i = 0; i < 10 && rt.isActive(c.id); i++) rt.step();
  return c;
}

// #508 (2026-11-05): the guest arrives after the window closed AND after every member cleared its state (the last
// courtesy step ended before the guest's first step). once-v1 sees nobody, waits 20 s and opens a second, unmarked window
// (the CI failure); once-v2 knows the window ran from the completed grouped records: late at once.
function afterAllLeft(policy: Policy, guest = 'c', alone: 'start' | 'fail' = 'start') {
  const rt = fixture(), a = rt.submit('pose_v1', jj('a', policy)), b = rt.submit('pose_v1', jj('b', policy));
  for (let i = 0; i < 20 && rt.world.entities.a.human!.together?.phase !== 'active'; i++) rt.step();
  const until = rt.world.entities.a.human!.together!.until!;
  while (rt.isActive(a.id) || rt.isActive(b.id)) rt.step();
  for (const id of ['a', 'b']) assert.equal(rt.world.entities[id].human!.together, undefined, id + ' cleared its group state');
  for (let i = 0; i < 10; i++) rt.step();
  const c = rt.submit('pose_v1', {...jj(guest, policy), alone}), startedAt = rt.tick, untils = new Set<number>([until]);
  let first: {tick: number; until?: number; late?: true} | undefined;
  for (let i = 0; i < 1200 && rt.isActive(c.id); i++) {
    rt.step(); const h = rt.world.entities[guest].human!;
    if (h.together?.until !== undefined) untils.add(h.together.until);
    if (!first && h.activity === 'jumping-jacks') first = {tick: rt.tick, until: h.together?.until, late: h.together?.late};
  }
  return {c, until, startedAt, untils, first};
}

test('once-v1 (unchanged, #508): a guest arriving after every member left waits 20 s and opens a second, unmarked window', () => {
  const r = afterAllLeft('once-v1');
  assert.ok(r.first!.tick - r.startedAt >= 400, 'waits out its 20 s ' + (r.first!.tick - r.startedAt));
  assert.equal(r.first!.late, undefined); assert.equal(r.untils.size, 2, 'two deadlines: the #508 symptom, kept for older logs');
  assert.deepEqual(r.c.outputs, {seconds: 6, group: 'inv_g'});
});

test('once-v2 (#508): a guest arriving after every member left does it alone at once, marked late; no second shared window', () => {
  const r = afterAllLeft('once-v2');
  assert.ok(r.first && r.first.tick - r.startedAt <= 2, 'no 20 s wait');
  assert.equal(r.first!.late, true, 'marked late in its body state');
  assert.ok(r.first!.until! > r.until, 'its own window, after the shared one');
  assert.equal(r.c.status, 'completed'); assert.deepEqual(r.c.outputs, {seconds: 6, group: 'inv_g', late: true});
});

test('once-v2 (#508): with alone:fail the late arrival is refused with its reason', () => {
  const r = afterAllLeft('once-v2', 'c', 'fail');
  assert.equal(r.c.status, 'failed'); assert.equal(r.c.diagnostic?.code, 'pose.window-closed');
});

test('once-v2 (#508): a guest waiting out of reach while the window runs is late when its wait ends, not a second window', () => {
  const rt = fixture(), d = rt.submit('pose_v1', jj('d', 'once-v2'));
  for (let i = 0; i < 5; i++) rt.step();
  assert.equal(rt.world.entities.d.human!.together?.phase, 'waiting', 'd waits, out of reach of a and b');
  const a = rt.submit('pose_v1', jj('a', 'once-v2')), b = rt.submit('pose_v1', jj('b', 'once-v2'));
  const untils = new Set<number>(); let late: true | undefined;
  for (let i = 0; i < 1200 && [a, b, d].some(r => rt.isActive(r.id)); i++) {
    rt.step();
    for (const id of ['a', 'b', 'd']) { const t = rt.world.entities[id].human!.together; if (t?.until !== undefined && !t.late) untils.add(t.until); if (id === 'd' && t?.late) late = t.late; }
  }
  assert.equal(untils.size, 1, 'one unmarked deadline: the shared one'); assert.equal(late, true);
  assert.deepEqual(d.outputs, {seconds: 6, group: 'inv_g', late: true});
});

test('once-v2 with nobody ever there: the lone first arrival still waits, then starts (no window ran, not late)', () => {
  const rt = fixture(), d = rt.submit('pose_v1', jj('d', 'once-v2'));
  for (let i = 0; i < 1200 && rt.isActive(d.id); i++) rt.step();
  assert.equal(d.status, 'completed'); assert.deepEqual(d.outputs, {seconds: 6, group: 'inv_g'});
});

// #980 review: with two or more late guests, the second must not join the first late guest's window unmarked (nor two
// guests arriving together open a fresh unmarked window): every late guest is late, and the group keeps one unmarked deadline.
function twoAfterAllLeft(policy: Policy, delay: number) {
  const rt = fixture(true), a = rt.submit('pose_v1', jj('a', policy)), b = rt.submit('pose_v1', jj('b', policy));
  for (let i = 0; i < 20 && rt.world.entities.a.human!.together?.phase !== 'active'; i++) rt.step();
  const until = rt.world.entities.a.human!.together!.until!;
  while (rt.isActive(a.id) || rt.isActive(b.id)) rt.step();
  for (let i = 0; i < 10; i++) rt.step();
  const c = rt.submit('pose_v1', jj('c', policy));
  for (let i = 0; i < delay; i++) rt.step();
  const e = rt.submit('pose_v1', jj('e', policy)), unmarked = new Set<number>([until]), late = new Set<string>();
  for (let i = 0; i < 1500 && [c, e].some(r => rt.isActive(r.id)); i++) {
    rt.step();
    for (const id of ['c', 'e']) { const t = rt.world.entities[id].human!.together; if (t?.until !== undefined) (t.late ? late.add(id) : unmarked.add(t.until)); }
  }
  return {c, e, unmarked, late};
}

for (const delay of [0, 3, 60]) test(`once-v2 (#508): two guests after every member left (the second ${delay} ticks later) are both late; one unmarked deadline`, () => {
  const r = twoAfterAllLeft('once-v2', delay);
  assert.deepEqual([...r.unmarked], [[...r.unmarked][0]], 'only the shared window is unmarked: ' + [...r.unmarked].join(','));
  assert.deepEqual([...r.late].sort(), ['c', 'e'], 'both marked late in their body state');
  for (const x of [r.c, r.e]) { assert.equal(x.status, 'completed'); assert.deepEqual(x.outputs, {seconds: 6, group: 'inv_g', late: true}); }
});

test('once-v1 (unchanged): two guests after every member left open a second, unmarked window together', () => {
  const r = twoAfterAllLeft('once-v1', 0);
  assert.equal(r.unmarked.size, 2, 'the #508 symptom, kept for older logs'); assert.equal(r.late.size, 0);
});
