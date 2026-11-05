// Quality cases 21/27/28/33: a named companion survives `resolve` exactly as it does `act`; walks and ride boardings
// advertise `with`; accepting a ride invitation reads as a boarding, never a finished ride.
import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';
import {confirmedTogetherEffects} from './edge/outcomes/effects.ts';
import {resolveCapability} from './edge/ledger/vocabulary.ts';

test('resolve keeps the companion: walk with X to an ambiguous place, sit with X by the fire; walks list `with`', {timeout: 300000}, async t => {
  const w = await edenNavWorld(2, {cn5: true}); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const [a, b] = w.souls;
  const walk: any = w.ledger.intents.dryRun(a, {capability: `walk with ${b.name} to the library`});
  assert.equal(walk.ok, true, JSON.stringify(walk));
  assert.match(walk.would.capability, /^walk:/); assert.deepEqual(walk.would.params, {with: [b.name]});
  const sit: any = w.ledger.intents.dryRun(a, {capability: `sit with ${b.name} by the fire`});
  assert.equal(sit.ok, true, JSON.stringify(sit));
  assert.deepEqual(sit.would.params?.with, [b.soulId], JSON.stringify(sit)); assert.match(sit.would.resolved, /an act without "with" is solo/);
  const caps = w.ledger.capabilities(a), libraryWalk = caps.find(c => c.id === walk.would.capability)!;
  assert.ok(libraryWalk.params && 'with' in libraryWalk.params, 'walk offers with: ' + JSON.stringify(libraryWalk));
  // act on the same words: one invitation to b, for a walk to that place
  const out: any = await w.act(a, `walk with ${b.name} to the library`);
  assert.equal(out.accepted, true, JSON.stringify(out)); assert.equal(out.receipt.capability, walk.would.capability);
  const invites = w.ledger.together.invitesFor(b.soulId);
  assert.equal(invites.length, 1, JSON.stringify(invites)); assert.equal(invites[0].what, 'walk'); assert.equal(invites[0].hostReceipt, out.receipt.id);
});

test('a guest who accepts a ride invitation is told they boarded, not that the ride is over', () => {
  const inv = {id: 'inv_x', kind: 'ride', what: 'ride', host: {soulId: 's_host', name: 'Sage Vale'}, guests: [{soulId: 's_guest', name: 'Liora Venn'}], responses: {s_guest: 'accepted'},
    guestReceipts: {s_guest: 'r_guest'}, hostReceipt: 'r_host', ride: {object: 'ride-eden-balloon', carrier: 'eden-balloon'}};
  const ledger: any = {outcomes: {context: () => null}, together: {heldBy: () => null, item: () => null, inviteForReceipt: (id: string) => id === 'r_guest' ? inv : null}};
  const guest = confirmedTogetherEffects(ledger, {id: 'r_guest', soulId: 's_guest', capability: 'accept:inv_x', phase: 'completed', programId: 'p1'} as any, null);
  assert.match(String(guest.summary), /boarded the ride; the ride has not left the ground yet and is not finished/, 'no readable ride: "the ride", never its object id');
  // F8 (#379): the guest reads the ride by its public vehicle, as the host's own join does
  const minds = new Map([['s_guest', {soulId: 's_guest', entityId: 'h_guest', name: 'Liora Venn', owner: 'u'}]]);
  const named: any = {...ledger, host: {minds}, comms: {objects: {get: (id: string) => id === 'ride-eden-balloon' ? {object: {id, kind: 'ride', state: {vehicle: 'ferris-wheel'}}} : null}}};
  const wheel = confirmedTogetherEffects(named, {id: 'r_guest', soulId: 's_guest', capability: 'accept:inv_x', phase: 'completed', programId: 'p1'} as any, null);
  assert.match(String(wheel.summary), /^Accepted Sage Vale's invitation and boarded the ferris wheel; the ride has not left the ground yet/);
  const other = confirmedTogetherEffects(ledger, {id: 'r_other', soulId: 's_guest', capability: 'walk:x', phase: 'completed', programId: 'p2'} as any, null);
  assert.equal(other.summary, undefined);
});

test('things that exist nowhere in the world are refused terminally, with nothing chosen in their place (quality 22/29/30)', () => {
  const caps = [{id: 'stroll:here', verb: 'stroll', label: 'Stroll', available: true}, {id: 'sit:here', verb: 'sit', label: 'Sit', available: true}, {id: 'dance:here', verb: 'dance', label: 'Dance', available: true}] as any[];
  const ctx: any = {caps, target: () => ({names: [], around: [], at: null}), places: [], root: [], me: null};
  for (const ask of ['go play on the swings', 'feed the ducks', 'row a boat on the pond', 'ride a bike', 'go skateboarding']) {
    const r: any = resolveCapability(ask, ctx);
    assert.equal(r.kind, 'unknown', ask);
    // Integration with lane todo: swings, punts and bikes can be offered somewhere (todo's place-specific refusals);
    // only what no world offers keeps quality's terminal NOWHERE wording.
    if (ask === 'feed the ducks') assert.match(r.reason, /exists anywhere in this world.*will not help/, ask);
    else assert.match(r.reason, /no swing offered|rowing punt|bicycle is offered|not possible here yet/, ask);
  }
});
