// B-facade: the Soul read code reaches the world only through a MenuWorld (split/menu-world.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LiveMenuWorld, ReplicaMenuWorld, VerdictTable, menuWorldOf, planKey, setMenuWorld} from './menu-world.ts';

const SRC = new URL('../', import.meta.url);
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'return', 'const', 'let', 'try', 'catch', 'else', 'do']);
const decl = /^  (?:private |async |static |get |readonly |protected )*([A-Za-z_#$][\w$]*)\s*[(<=:]/;
/** `host.engine` reaches per class member of a file (members at two-space indent; `<top>` before the first). */
function reaches(file: string, pattern: RegExp): Map<string, number> {
  const out = new Map<string, number>(); let cur = '<top>';
  for (const l of readFileSync(new URL(file, SRC), 'utf8').split('\n')) {
    const m = decl.exec(l), f = /^(?:export )?(?:async )?function ([A-Za-z_]\w*)/.exec(l);
    if (f) cur = f[1]; else if (m && !CONTROL.has(m[1])) cur = m[1];
    const n = l.match(pattern)?.length ?? 0; if (n) out.set(cur, (out.get(cur) ?? 0) + n);
  }
  return out;
}

// The act/tick path stays on main and keeps the engine (launch, receipts, program events, ambient life, rides' steering).
const LEDGER_MAIN_ONLY = new Set(['constructor', 'attachComms', 'attachPresence', 'migrateGone', 'startingPoint', 'loadPlaces', 'insert', 'update',
  'onDecision', 'onRecovery', 'onProgram', 'afterTick', 'contactTicks', 'ambientLife', 'unstick', 'arm', 'decide', 'recordRefusal', 'metrics', 'actVerificationSit',
  'act', 'actMenu', 'actOnce', 'standIfSeated', 'launch', 'relaunchStuck', 'acceptInvite', 'performBodies', 'performAtomicObjectBodies',
  'syncCarrierPlaces', 'boardingIssue', 'steerTarget', 'steerCheck', 'rideFrames', 'godInterrupted', 'setDetail', 'stallGuard', 'conversationPartners', 'posture',
  'ambientChoice', 'navWarmFor']);

test('grep: no engine reach in the read code (ledger read methods, perception, together, god-nav, human capabilities, deck)', () => {
  const ledger = [...reaches('edge/ledger/ledger.ts', /host\.engine/g)].filter(([m]) => !LEDGER_MAIN_ONLY.has(m));
  assert.deepEqual(ledger, [], 'ledger read methods reach host.engine');
  for (const f of ['edge/perception/here.ts', 'edge/perception/around.ts', 'edge/perception/knowledge.ts', 'edge/perception/route.ts',
    'edge/perception/geometry.ts', 'edge/ledger/together.ts', 'edge/ledger/activities.ts', 'edge/ledger/places.ts', 'edge/ledger/vocabulary.ts',
    'edge/ledger/focus.ts', 'edge/ledger/listing.ts', 'human-capabilities.ts', 'deck.ts', 'edge/eyes/view.ts'])
    assert.deepEqual([...reaches(f, /host\.engine|\.engine\.canPerform/g)], [], `${f} reaches host.engine`);
  assert.deepEqual([...reaches('god/nav.ts', /\.h\.engine\b|\.reachV1\(/g)].filter(([m]) => m !== 'E'), [], 'god/nav.ts reaches its engine outside the facade getter');
  const bridge = reaches('god/engine-bridge.ts', /this\.engine\b/g);
  assert.equal(bridge.get('listCapabilities') ?? 0, 0, 'engine-bridge listCapabilities reaches this.engine');
});

test('contactTicks is exclusively a main tick helper, never called by ledger read methods', () => {
  // It commits contact effects/receipt changes and can stop an engine program. Keep that write helper on main;
  // naming it anywhere beyond its declaration and sole afterTick call must trigger a boundary review.
  assert.deepEqual([...reaches('edge/ledger/ledger.ts', /\bcontactTicks\b/g)], [['contactTicks', 1], ['afterTick', 1]]);
});

const fakeEngine = (over: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const e = {world: {tick: 7, entities: {}, regions: {}}, runtime: {tick: 7, records: new Map(), violations: [], liveIds: () => []}, rulesVersion: 'r1',
    describeVerbs: () => [], anchors: () => [], programOf: () => null,
    canPerform: (p: {label: string}) => {calls.push(p.label); return p.label === 'bad' ? {code: 'x', message: 'no'} : null;},
    clearanceAtV1(this: unknown) {return this === e ? 1 : -1;}, ...over};
  return {e, calls};
};

test('LiveMenuWorld: delegates with the engine as `this`; an absent optional read stays absent', () => {
  const {e} = fakeEngine();
  const mw = new LiveMenuWorld(e as never);
  assert.equal(mw.clearanceAtV1!(0, 0), 1);
  assert.equal(mw.nearestStandableV1, undefined);
  assert.equal(mw.world, e.world);
  assert.equal(mw.feasibility.reaches, false);
});

test('LiveFeasibility: cached per (tick, log seq); a new tick or log entry asks the engine again', () => {
  const {e, calls} = fakeEngine(), host = {engine: e, seq: 1};
  const mw = menuWorldOf(host), p = {actor: 'a', label: 'bad', steps: []};
  assert.deepEqual(mw.feasibility.canPerform(p), {code: 'x', message: 'no'});
  assert.deepEqual(mw.feasibility.canPerform(p), {code: 'x', message: 'no'});
  assert.equal(calls.length, 1);
  host.seq = 2; mw.feasibility.canPerform(p); assert.equal(calls.length, 2);
  (e.world as {tick: number}).tick = 8; mw.feasibility.canPerform(p); assert.equal(calls.length, 3);
  assert.equal(menuWorldOf(host), mw, 'one facade per engine');
});

test('menuWorldOf: a registered replica wins; an injected MenuWorld as `engine` is used as is', () => {
  const verdicts = new VerdictTable();
  const r = new ReplicaMenuWorld({world: () => ({tick: 3, entities: {}, regions: {}}) as never, runtime: () => ({tick: 3, records: new Map(), violations: [], liveIds: () => []}),
    programOf: () => null, programAction: () => null, statics: {rulesVersion: 'r', verbs: [], anchors: () => []}, spatial: {clearanceAtV1: () => 2}, verdicts});
  const host = {engine: fakeEngine().e};
  setMenuWorld(host, r); assert.equal(menuWorldOf(host), r); setMenuWorld(host, null);
  assert.notEqual(menuWorldOf(host), r);
  assert.equal(menuWorldOf({engine: r}), r);
  assert.equal(r.clearanceAtV1!(0, 0), 2);
  assert.equal(r.withFeasibilityRead!(() => 5), 5);
});

test('VerdictTable: a shipped verdict answers; a miss answers feasible and is queued for main', () => {
  const t = new VerdictTable(), p = {actor: 'a', label: 'walk', steps: [{verb: 'walk_to', params: {to: 'x'}}]};
  assert.equal(t.canPerform(p, 'route|1|0,0,0'), null);
  assert.equal(t.missCount, 1); assert.equal(t.misses.size, 1);
  t.apply([{soulId: 's', actor: 'a', key: 'route|1|0,0,0\u0002' + planKey(p), verdict: {code: 'route.unreachable', message: 'm'}, tick: 1}]);
  assert.equal(t.misses.size, 0);
  assert.deepEqual(t.canPerform(p, 'route|1|0,0,0'), {code: 'route.unreachable', message: 'm'});
  assert.equal(t.canPerform(p, 'route|1|0,0,1'), null, 'another cell is another verdict');
  t.forget('a'); assert.equal(t.canPerform(p, 'route|1|0,0,0'), null);
});
