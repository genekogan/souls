import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPlay, nextIntervalMs, cardResultFor, budgetMsFor } from './director.mjs';
import { fakeClock, fakeSeat, fakeOwner, fakeObserver, fakePersona } from './fakes.mjs';
import { rng } from '../lib/hash.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'pt-director-test-'));
const jsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);
const world = { base: 'http://127.0.0.1:4990', slug: 'pt-eden-a', name: 'Eden 2026' };
function rig({ ids = ['a'], turnMs = 5000, ownerOpts = {}, legibleFor, secrets = {} } = {}) {
  const clock = fakeClock();
  const seats = ids.map((id) => fakeSeat({ id, clock, turnMs, secret: secrets[id] ?? '' }));
  return { clock, seats, owner: fakeOwner({ clock, ...ownerOpts }), observer: fakeObserver({ clock, ...(legibleFor ? { legibleFor } : {}) }), runDir: tmp(), pollSec: 5 };
}
const scen = (o) => ({ name: 't', durationSec: 120, seats: [{ id: 'a', persona: 'newcomer' }], director: { mode: 'persona' }, rails: { maxTurnsPerRequest: 6 }, ...o });
const noQuota = async () => ({ allowed: true });

test('scripted mode delivers at offsets on the right channel, captures shown, closes on result', async () => {
  const r = rig({ ids: ['a', 'b'] });
  const scenario = scen({ seats: [{ id: 'a' }, { id: 'b' }], director: { mode: 'scripted', script: [
    { seat: 'a', atSec: 5, channel: 'card', text: 'sit down', budgetSec: 90 },
    { seat: 'b', atSec: 12, channel: 'card', text: 'go to the pond' },
    { seat: 'a', atSec: 30, channel: 'chat', text: 'what are you doing?' }] } });
  const t0 = Date.now();
  const out = await runPlay({ ...r, scenario, world, quotaCheck: noQuota });
  assert.ok(Date.now() - t0 < 10000);
  assert.deepEqual(r.owner.sent.map((m) => [m.soulId, m.text, m.sentAt]), [['soul-a', 'sit down', 5000], ['soul-b', 'go to the pond', 12000]]);
  assert.deepEqual(r.seats[0].calls.map((c) => [c.text, c.reason, c.at]), [['what are you doing?', 'chat', 30000]]);
  assert.equal(r.seats[1].calls.length, 0);
  assert.equal(r.observer.opened.length, 3);
  const closedA1 = r.observer.closed.find((c) => c.requestId === 'a-001');
  assert.equal(closedA1.cutoffReason, 'result'); assert.ok(closedA1.at >= 25000 && closedA1.at <= 31000, String(closedA1.at));
  assert.ok(existsSync(join(r.runDir, 'personas/a/shown/1.json')) && existsSync(join(r.runDir, 'personas/a/shown/1.png')));
  assert.equal(jsonl(join(r.runDir, 'personas/a/decisions.jsonl')).length, 2);
  assert.ok(['script-complete', 'duration'].includes(out.stoppedBy));
});

test('scripted mode delivers a seat "*" broadcast to every seat, each on its own record', async () => {
  const r = rig({ ids: ['a', 'b'] });
  const scenario = scen({ seats: [{ id: 'a' }, { id: 'b' }], director: { mode: 'scripted', script: [{ seat: '*', atSec: 5, channel: 'card', text: 'wave hello' }] } });
  await runPlay({ ...r, scenario, world, quotaCheck: noQuota });
  assert.deepEqual(r.owner.sent.map((m) => [m.soulId, m.text, m.sentAt]).sort(), [['soul-a', 'wave hello', 5000], ['soul-b', 'wave hello', 5000]]);
  for (const id of ['a', 'b']) assert.equal(jsonl(join(r.runDir, `personas/${id}/decisions.jsonl`)).find((d) => d.scripted)?.scripted.broadcast, true);
});

test('persona mode respects waitSec and the glance minimum', async () => {
  const r = rig();
  const persona = fakePersona({ decisions: [{ say: null, waitSec: 60 }] });
  await runPlay({ ...r, scenario: scen({ durationSec: 300 }), world, quotaCheck: noQuota, personaFactory: () => persona });
  const times = persona.received.map((s) => s.elapsedSec);
  assert.ok(times.length >= 4, String(times));
  for (let i = 1; i < times.length; i++) { const gap = times[i] - times[i - 1]; assert.ok(gap >= 51 && gap <= 69.5, `gap ${gap}`); }
  const r2 = rig();
  const p2 = fakePersona({ decisions: [{ say: null, waitSec: 1 }] });
  await runPlay({ ...r2, scenario: scen({ durationSec: 60 }), world, quotaCheck: noQuota, personaFactory: () => p2 });
  const t2 = p2.received.map((s) => s.elapsedSec);
  for (let i = 1; i < t2.length; i++) assert.ok(t2[i] - t2[i - 1] >= 10, 'never under the sheet minimum');
});

test('budget closes an unanswered request: 90 s when quick, 180 s otherwise', async () => {
  for (const [quick, want] of [[true, 90000], [false, 180000]]) {
    const r = rig({ ownerOpts: { resultMs: null } });
    const persona = fakePersona({ decisions: [{ say: { channel: 'card', text: 'find treasure' }, quick, waitSec: 400 }, { say: null, waitSec: 400 }] });
    await runPlay({ ...r, scenario: scen({ durationSec: 400 }), world, quotaCheck: noQuota, personaFactory: () => persona });
    const c = r.observer.closed[0];
    assert.equal(c.cutoffReason, 'budget'); assert.ok(c.at >= want && c.at <= want + 5500, `${quick}: ${c.at}`);
  }
  assert.equal(budgetMsFor({ scenario: { director: { budgetSec: { quick: 30 } } }, quick: true }), 30000);
});

test('seat isolation: no persona ever receives another seat’s screen, card, chat or requests', async () => {
  const r = rig({ ids: ['a', 'b'], secrets: { a: 'SECRET-A', b: 'SECRET-B' }, legibleFor: (s) => ({ bubbles: [`LEGIBLE-${s.toUpperCase()}`] }) });
  const personas = {};
  const dec = (id) => (shown, n) => (n === 0 ? { say: { channel: 'chat', text: `hello from ${id.toUpperCase()}-ONLY` }, waitSec: 15 } : n === 1 ? { say: { channel: 'card', text: `card ${id.toUpperCase()}-ONLY` }, waitSec: 15 } : { say: null, waitSec: 15 });
  const scenario = scen({ seats: [{ id: 'a', persona: 'newcomer' }, { id: 'b', persona: 'social' }], durationSec: 150 });
  await runPlay({ ...r, scenario, world, quotaCheck: noQuota, personaFactory: ({ seat }) => (personas[seat] = fakePersona({ decisions: dec(seat) })) });
  const seen = { a: JSON.stringify(personas.a.received), b: JSON.stringify(personas.b.received) };
  assert.ok(seen.a.includes('SECRET-A') && seen.a.includes('LEGIBLE-A') && seen.a.includes('A-ONLY'));
  assert.ok(seen.b.includes('SECRET-B') && seen.b.includes('LEGIBLE-B') && seen.b.includes('B-ONLY'));
  for (const s of ['SECRET-A', 'LEGIBLE-A', 'A-ONLY', 'soul-a', '/shots/a/']) assert.ok(!seen.b.includes(s), `b saw ${s}`);
  for (const s of ['SECRET-B', 'LEGIBLE-B', 'B-ONLY', 'soul-b', '/shots/b/']) assert.ok(!seen.a.includes(s), `a saw ${s}`);
  assert.deepEqual(r.owner.sent.map((m) => [m.soulId, m.text]).sort(), [['soul-a', 'card A-ONLY'], ['soul-b', 'card B-ONLY']]);
});

test('rails: duration stop, quota stop, max turns per request, all-done', async () => {
  let r = rig();
  let out = await runPlay({ ...r, scenario: scen({ durationSec: 100 }), world, quotaCheck: noQuota, personaFactory: () => fakePersona({ decisions: [{ say: null, waitSec: 10 }] }) });
  assert.equal(out.stoppedBy, 'duration'); assert.ok(r.clock.now() <= 100000 + 5000, String(r.clock.now()));
  assert.ok(existsSync(join(r.runDir, 'personas/a/ratings.json')));

  r = rig(); let checks = 0;
  out = await runPlay({ ...r, scenario: scen({ durationSec: 2000 }), world, quotaCheck: async () => (++checks >= 2 ? { allowed: false, note: '5h 91%' } : { allowed: true }), personaFactory: () => fakePersona({ decisions: [{ say: null, waitSec: 30 }] }) });
  assert.match(out.stoppedBy, /^quota/); assert.ok(r.clock.now() >= 600000 && r.clock.now() < 640000, String(r.clock.now()));

  r = rig({ ownerOpts: { resultMs: null }, turnMs: 1000 });
  const decs = [{ say: { channel: 'card', text: 'climb the roof' }, waitSec: 10 }, { say: { channel: 'chat', text: 'hello?' }, waitSec: 10 }, { say: { channel: 'chat', text: 'HELLO??' }, waitSec: 10 }, { say: null, waitSec: 50 }];
  await runPlay({ ...r, scenario: scen({ durationSec: 150, rails: { maxTurnsPerRequest: 1 } }), world, quotaCheck: noQuota, personaFactory: () => fakePersona({ decisions: decs }) });
  assert.equal(r.observer.closed.find((c) => c.requestId === 'a-001').cutoffReason, 'max-turns');

  r = rig();
  out = await runPlay({ ...r, scenario: scen({ durationSec: 500 }), world, quotaCheck: noQuota, personaFactory: () => fakePersona({ decisions: [{ say: null, desires: ['I wanted him to fly'], rating: { fun: 2, alive: 3 }, done: true }], final: { rating: { fun: 2, alive: 2 }, desires: ['I wanted him to fly'], complaints: ['boring'] } }) });
  assert.equal(out.stoppedBy, 'all-done');
  const ratings = JSON.parse(readFileSync(join(r.runDir, 'personas/a/ratings.json'), 'utf8'));
  assert.deepEqual(ratings.final, { fun: 2, alive: 2 }); assert.equal(ratings.steps.length, 1);
  assert.deepEqual(jsonl(join(r.runDir, 'personas/a/desires.jsonl')).map((d) => [d.kind, d.text, !!d.final]), [['desire', 'I wanted him to fly', false], ['desire', 'I wanted him to fly', true], ['complaint', 'boring', true]]);
});

test('god seat is driven the same way (chat to the god seat, card to the god inbox)', async () => {
  const r = rig({ ids: [] });
  const god = fakeSeat({ id: 'god', clock: r.clock });
  const decs = [{ say: { channel: 'chat', text: 'make me a cozy village' }, waitSec: 20 }, { say: { channel: 'card', text: 'add sheep' }, waitSec: 20 }, { say: null, waitSec: 100 }];
  await runPlay({ ...r, seats: [], god, scenario: scen({ seats: [], god: { persona: 'first-timer' }, durationSec: 60 }), world, quotaCheck: noQuota, personaFactory: () => fakePersona({ decisions: decs }) });
  assert.deepEqual(god.calls.map((c) => c.text), ['make me a cozy village']);
  assert.deepEqual(god.godCards.map((c) => c.text), ['add sheep']);
});

test('helpers', () => {
  const r = rng(1);
  for (let i = 0; i < 50; i++) { const ms = nextIntervalMs([10, 30], undefined, r); assert.ok(ms >= 10000 && ms <= 30000); }
  assert.equal(nextIntervalMs([10, 30], 2, () => 0.5), 10000);
  assert.deepEqual(cardResultFor({ latest: { id: 'm1', result: 'sat' } }, 'm1'), { resultText: 'sat', state: null });
  assert.equal(cardResultFor({ latest: { id: 'm2', result: 'sat' } }, 'm1'), null);
  assert.equal(cardResultFor({ latest: { id: 'm1', state: 'acked' } }, 'm1'), null);
});

test('chat queued behind a running turn: turn linked, queuedSec recorded, budget clock starts at the carrying turn', async () => {
  const r = rig({ turnMs: 5000 });
  const scenario = scen({ durationSec: 60, director: { mode: 'scripted', sequential: false, script: [
    { seat: 'a', atSec: 5, channel: 'chat', text: 'wave', budgetSec: 30 },
    { seat: 'a', atSec: 6, channel: 'chat', text: 'sit down', budgetSec: 3 }] } });
  await runPlay({ ...r, scenario, world, quotaCheck: noQuota });
  const [o1, o2] = r.observer.opened;
  assert.deepEqual([o1.chatTurns, o2.chatTurns], [[1], [2]]);
  assert.equal(o1.queue.queuedSec, 0);
  assert.equal(o2.queue.queuedSec, 4, 'sent at 6 s, its turn started at 10 s');
  assert.equal(o2.budgetSec, 3);
  const c2 = r.observer.closed.find((c) => c.requestId === 'a-002');
  assert.equal(c2.cutoffReason, 'budget');
  assert.ok(c2.at >= 13000 && c2.at <= 18000, `budget from the turn start (10 s), not sentAt: closed at ${c2.at}`);
  const rec = jsonl(join(r.runDir, 'personas/a/requests.jsonl')).find((x) => x.requestId === 'a-002');
  assert.equal(rec.queuedSec, 4);
});

test('scenario defaults: persona scenarios seed natives; the scripted basics batteries do not; god requests get 600 s', async () => {
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../scenarios/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    if (!s.world) continue; // catalogue/manifests are not runnable scenarios
    if ((s.director?.mode ?? 'persona') === 'persona') assert.equal(s.world.natives, true, f);
    else assert.notEqual(s.world.natives, true, f);
  }
  assert.equal(budgetMsFor({ scenario: {}, god: true }), 600000);
});

// Owner-card native autoresults are sub-action progress, not a multi-step journey boundary.
async function journeyRig({ turnEnd=30000, actionEnd=30000, observeTurn=true, budgetSec=60, actionStart=0, sampleSec=2, finalCard=true, finalOutcome='failed' }={}) {
 const r=rig({ownerOpts:{resultMs:5000},turnMs:30000});const seat=r.seats[0];
 const sent=()=>r.owner.sent[0]?.sentAt??Infinity;
 Object.defineProperty(seat,'inTurn',{get:()=>observeTurn&&r.clock.now()>=sent()&&r.clock.now()<sent()+turnEnd});
 seat.turnCount=()=>observeTurn&&r.clock.now()>=sent()+turnEnd?1:0;
 r.observer.truth={snapshotSoul:async()=>({t:new Date(r.clock.now()).toISOString(),receipts:r.clock.now()<sent()+actionStart?[]:r.clock.now()<sent()+actionEnd?[{id:'act',phase:'running'}]:[{id:'act',phase:'failed',code:'seat.inside'}],posture:'standing'})};
 const original=r.owner.cardView;r.owner.cardView=async args=>{const v=await original(args);if(v.latest?.result){Object.assign(v.latest,{outcome:'done',resultBy:'server',resultAt:sent()+5000});if(finalCard&&r.clock.now()>=sent()+turnEnd)Object.assign(v.latest,{result:'Unable to sit: seat.inside; I remain standing.',outcome:finalOutcome,resultBy:undefined,resultAt:sent()+turnEnd});}return v;};
 const recorded=[];r.observer.evidence.openRequest=args=>{const ev={...args,recorded,samples:[]};r.observer.opened.push(ev);return{evidence:ev,sample({snap}){ev.samples.push(snap)},recordCard(m){if(m?.result)recorded.push({at:r.clock.now(),text:m.result,by:m.resultBy})},close({cutoffReason}){r.observer.closed.push({requestId:args.requestId,cutoffReason,at:r.clock.now()});}};};
 const scenario=scen({durationSec:90,observer:{sampleSec},director:{mode:'scripted',script:[{id:'podium',seat:'a',atSec:0,channel:'card',text:'Walk to the podium and sit',budgetSec,expect:{journey:{}}}]}});
 await runPlay({...r,scenario,world,quotaCheck:noQuota});return r;
}
test('journey waits through intermediate native done until requesting turn ends; terminal failure and final sample retained',async()=>{
 const r=await journeyRig();const closed=r.observer.closed[0];assert.equal(closed.cutoffReason,'turn-complete');assert.ok(closed.at>=30000&&closed.at<=35000);
 assert.ok(r.observer.opened[0].recorded.some(x=>x.by==='server'&&x.at<30000));assert.match(r.observer.opened[0].recorded.at(-1).text,/Unable to sit/);
 assert.equal(r.observer.opened[0].samples.at(-1).receipts[0].code,'seat.inside');
});
test('journey keeps an asynchronous action open beyond the model turn, but never extends frozen budget',async()=>{
 let r=await journeyRig({turnEnd:10000,actionEnd:40000,finalCard:false});assert.equal(r.observer.closed[0].cutoffReason,'turn-complete');assert.ok(r.observer.closed[0].at>=40000);
 r=await journeyRig({turnEnd:80000,actionEnd:80000,budgetSec:20});assert.equal(r.observer.closed[0].cutoffReason,'budget');assert.ok(r.observer.closed[0].at>=20000&&r.observer.closed[0].at<=25000);
});
test('journey with automatic result but no observed agent turn stays open to budget',async()=>{
 const r=await journeyRig({observeTurn:false,actionEnd:0,budgetSec:20});assert.equal(r.observer.closed[0].cutoffReason,'budget');assert.ok(r.observer.closed[0].at>=20000);
});

test('terminal refresh catches an async action started after the last idle sample without a card change',async()=>{
 const r=await journeyRig({turnEnd:8000,actionStart:7000,actionEnd:30000,sampleSec:20,finalCard:false});
 const samples=r.observer.opened[0].samples;
 assert.ok(samples.some(s=>Date.parse(s.t)<=5000&&s.receipts.length===0),'a preceding idle sample could permit premature closure');
 assert.ok(samples.some(s=>Date.parse(s.t)===10000&&s.receipts[0]?.phase==='running'),'terminal refresh sees the intervening async action');
 assert.ok(r.observer.closed[0].at>=30000,`must not close while action runs: ${r.observer.closed[0].at}`);
 assert.equal(r.observer.closed[0].cutoffReason,'turn-complete');
});

test('explicit agent terminal result closes a held activity after its turn, while server progress waits',async()=>{
 const done=await journeyRig({turnEnd:10000,actionEnd:80000,finalOutcome:'done'});
 assert.equal(done.observer.closed[0].cutoffReason,'turn-complete');
 assert.ok(done.observer.closed[0].at>=10000&&done.observer.closed[0].at<=15000);
 assert.equal(done.observer.opened[0].samples.at(-1).receipts[0].phase,'running');
 const progress=await journeyRig({turnEnd:10000,actionEnd:80000,finalCard:false,budgetSec:20});
 assert.equal(progress.observer.closed[0].cutoffReason,'budget');
 assert.ok(progress.observer.closed[0].at>=20000);
});
