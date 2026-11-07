// WD7 slices 2–3 (Y4): helper child tokens and journal attribution, in-process (Hono app.request, :memory: SQLite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono, type Context } from 'hono';
import { CREATION_LIMITS } from '@souls/generators';
import { hashToken } from '../auth.ts';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode, type Genesis } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { mountEnvRoutes } from './world-env.ts';
import { HELPER_LIMITS, helperRoute } from './helpers.ts';
import type { BuildField } from './builds.ts';

const partDef = (name = 'part') => ({ schema: 'def/1', name, size: { box: [1, 1, 1] }, layer: 'decor', make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0, 0], size: [1, 1, 1] }] } } });
const place = (name: string, x = 0, z = 0, parent = 'world', def = 'part@1') => ({ op: 'place', def, name, p: [x, z], in: { parent } });
const code = (r: any) => r.failures?.[0]?.code;
const owner = { id: 'owner', role: 'user' };

function fixture(opts: { genesis?: Genesis; pauseMs?: number } = {}) {
  const db = new Db(':memory:'); let now = 1_000_000;
  const god = new GodMode(db, { worldId: 'helpers', ownerId: 'owner', tick: () => 0, now: () => now, buildPauseMs: opts.pauseMs ?? 120_000, assetDir: join(tmpdir(), 'y4-assets'), emit: () => {}, ...(opts.genesis ? { genesis: opts.genesis } : {}) });
  const lead = god.mintFor(owner, 'lead'), rival = god.mintFor(owner, 'rival');
  const leadId = god.godIdentity(lead)!;
  assert.equal(god.as({ identity: leadId }, () => god.act({ ops: [{ op: 'define', def: partDef() }] })).accepted, true);
  const app = new Hono();
  mountGodRoutes(app, { god, worldName: 'Helpers', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'owner only'); }, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1:5399', limitIp: () => {} });
  // Same requireGod as http.ts (mounted after the god routes there too).
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  mountEnvRoutes(app, { god, host: { engine: { world: { tick: 0, env: { datetime: '2026-10-03T06:00:00.000Z' } } } } as never, requireGod: (c) => { const who = god.godIdentity(bearer(c)); if (!who) throw new ApiError(401, 'unauthorized', 'god token'); if (who.child) throw new ApiError(403, 'helper.scope', 'helpers cannot change the environment'); return who; } });
  app.onError((e, c) => e instanceof ApiError ? c.json({ ok: false, code: e.code, message: e.message, ...e.extra }, e.status as 400) : c.json({ internal: String(e) }, 500));
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await r.text(); return { status: r.status, text, data: JSON.parse(text) as any };
  };
  const post = async (path: string, token: string, body: unknown = {}) => { const r = await call('POST', path, token, body); assert.equal(r.status, 200, r.text); return r.data; };
  const started = god.builds.start({ id: 'church', title: 'Church', steps: ['shell', 'roof'], site: { at: [0, 0], size: [200, 200] } }, leadId) as any; assert.equal(started.ok, true);
  const leadField: BuildField = { id: 'church', lease: started.lease };
  for (const ops of [[place('shell')], [place('east', 10, 0, 'shell'), place('west', -10, 0, 'shell'), place('outside', 40, 40)]]) assert.equal(god.as({ identity: leadId }, () => god.act({ ops, build: leadField })).accepted, true);
  const claim = async (part: string, root: string, token = lead) => { const r = await post('/v1/god/builds/church/claims', token, { part, root }); assert.equal(r.ok, true, JSON.stringify(r)); return r.claim.id as string; };
  const mint = async (cid: string, body: unknown = {}, token = lead) => { const r = await post(`/v1/god/builds/church/claims/${cid}/helper`, token, body); assert.equal(r.ok, true, JSON.stringify(r)); return r as { token: string; helper: { label: string; hash8: string; expiresAt: number; verifyBudget: number; part: string } }; };
  return { db, god, lead, rival, leadId, leadField, call, post, claim, mint, now: () => now, advance: (ms: number) => { now += ms; } };
}

test('Y4 mint: only the claim holder mints a scoped token; the lead token is never echoed', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const east = await f.claim('east', 'shell/east');
  const stolen = await f.post(`/v1/god/builds/church/claims/${east}/helper`, f.rival); assert.equal(stolen.ok, false); assert.equal(code(stolen), 'build.claimed');
  const raw = await f.call('POST', `/v1/god/builds/church/claims/${east}/helper`, f.lead, { label: 'east-roofer' });
  assert.equal(raw.status, 200); assert.ok(!raw.text.includes(f.lead), 'the response never carries the lead token');
  const m = raw.data; assert.equal(m.ok, true); assert.match(m.token, /^god_helpers_/); assert.notEqual(m.token, f.lead);
  assert.deepEqual({ label: m.helper.label, part: m.helper.part, claim: m.helper.claim, build: m.helper.build, expiresAt: m.helper.expiresAt, verifyBudget: m.helper.verifyBudget, pooledWith: m.helper.pooledWith }, { label: 'east-roofer', part: 'east', claim: east, build: 'church', expiresAt: f.now() + HELPER_LIMITS.defaultTtlMs, verifyBudget: HELPER_LIMITS.verifyBudget, pooledWith: f.leadId.hash.slice(0, 8) });
  assert.equal(m.helper.hash8, hashToken(m.token).slice(0, 8));
  const who = f.god.godIdentity(m.token)!; assert.equal(who.child?.parent, f.leadId.hash); assert.equal(who.label, 'east-roofer');
  // Helpers cannot mint (refused at the route), and only held claims can be minted for.
  const nested = await f.call('POST', `/v1/god/builds/church/claims/${east}/helper`, m.token, {}); assert.equal(nested.status, 403); assert.equal(nested.data.code, 'helper.scope');
  assert.equal(code(await f.post('/v1/god/builds/church/claims/c_00000000/helper', f.lead)), 'build.claim-unknown');
  assert.equal(code(await f.post('/v1/god/builds/nowhere/claims/c_00000000/helper', f.lead)), 'build.unknown');
  assert.equal(code(await f.post(`/v1/god/builds/church/claims/${east}/helper`, f.lead, { ttlMs: 10 })), 'schema');
  assert.equal(code(await f.post(`/v1/god/builds/church/claims/${east}/helper`, f.lead, { token: 'x' })), 'schema');
  for (let i = 1; i < HELPER_LIMITS.perClaim; i++) await f.mint(east);
  assert.equal(code(await f.post(`/v1/god/builds/church/claims/${east}/helper`, f.lead)), 'helper.limit');
  // The helper sees itself as a helper: no pairing codes, agent counts or build summaries.
  const status = (await f.call('GET', '/v1/god/status', m.token)).data; assert.equal(status.you, 'helper'); assert.deepEqual(status.pending, []); assert.equal(status.agents, undefined);
  assert.equal(f.god.store.tokens().length, 2, 'helper tokens never enter the root token table');
});

test('Y4 scope: a helper edits inside its claim; every out-of-scope edit is refused at authorisation', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const east = await f.claim('east', 'shell/east'), west = await f.claim('west', 'shell/west', f.rival), { token: helper, helper: h } = await f.mint(east);
  const ok = await f.post('/v1/god/act', helper, { ops: [place('pew', 1, 0, 'shell/east')] });
  assert.equal(ok.accepted, true, JSON.stringify(ok)); assert.equal(ok.build.claim, east); assert.equal(ok.build.group, 'church/east');
  const row = f.god.store.edits(1)[0]; assert.equal(row.hash8, h.hash8); assert.equal(row.label, h.label); assert.equal(row.grp, 'church/east');
  const seq = f.god.model.editSeq, version = f.god.store.build('church')!.rev;
  const preview = await f.post('/v1/god/preview', f.lead, { ops: [place('lead-thing', 30, 30)], build: f.leadField }); assert.equal(preview.accepted, true);
  const attempts: [string, unknown][] = [
    ['lead lease', { ops: [place('x', 1, 1, 'shell/east')], build: f.leadField }],
    ['another claim', { ops: [place('x', 1, 1, 'shell/west')], build: { id: 'church', claim: west } }],
    ['another build', { ops: [place('x', 1, 1, 'shell/east')], build: { id: 'chapel', claim: east } }],
    ['set outside', { ops: [{ op: 'set', id: 'shell/west', name: 'stolen' }] }],
    ['move outside', { ops: [{ op: 'move', id: 'outside', p: [41, 40] }] }],
    ['remove outside', { ops: [{ op: 'remove', id: 'shell' }] }],
    ['place into another claim', { ops: [place('x', 1, 1, 'shell/west')] }],
    ['world state', { ops: [{ op: 'world', state: { weather: { kind: 'rain' } } }] }],
    ['expand', { ops: [{ op: 'expand', extent: 2000 }] }],
    ['economy', { ops: [{ op: 'economy', currency: 'shell' }] }],
    ['undefine', { ops: [{ op: 'undefine', ref: 'part@1' }] }],
    ['lead preview', { preview: preview.id }],
    // Review fix: where a move or clone puts things is authorised too, not only the thing it names.
    ['move into another claim', { ops: [{ op: 'move', id: 'shell/east/pew', in: { parent: 'shell/west' } }] }],
    ['move to the world root', { ops: [{ op: 'move', id: 'shell/east/pew', in: { parent: 'world' }, p: [70, 70] }] }],
    ['clone the claim root beside itself', { ops: [{ op: 'clone', id: 'shell/east' }] }],
    ['clone into another claim', { ops: [{ op: 'clone', id: 'shell/east/pew', in: { parent: 'shell/west' } }] }],
    ['clone an outside thing in place', { ops: [{ op: 'clone', id: 'outside', p: [45, 45] }] }],
    ['relate', { ops: [{ op: 'relate', a: 'thing:shell/east/pew', rel: 'works-at', b: 'thing:outside' }] }],
  ];
  for (const [what, body] of attempts) for (const path of ['/v1/god/act', '/v1/god/dryrun', '/v1/god/preview']) {
    if (path !== '/v1/god/act' && 'preview' in (body as object)) continue;
    const r = await f.post(path, helper, body); assert.equal(r.accepted, false, `${what} via ${path}: ${JSON.stringify(r)}`);
    assert.equal(code(r), 'helper.scope', `${what} via ${path} must be refused at authorisation: ${JSON.stringify(r.failures)}`);
  }
  assert.equal(code(await f.post('/v1/god/act', helper, { ops: [place('loose', 60, 60)] })), 'helper.scope', 'a root claim adopts no world-root things');
  // A helper step may name only its own claim.
  assert.equal(code(await f.post('/v1/god/builds/church/step', helper, { lease: f.leadField.lease, n: 2 })), 'helper.scope');
  assert.equal(code(await f.post('/v1/god/builds/church/step', helper, { claim: west, n: 2 })), 'helper.scope');
  assert.equal((await f.post('/v1/god/builds/church/step', helper, { claim: east, n: 2, say: 'Carving pews' })).ok, true);
  assert.equal(f.god.model.editSeq, seq, 'no refused attempt entered the journal');
  assert.ok(f.god.store.build('church')!.rev > version);
  assert.equal(f.god.store.edits(1)[0].seq, seq);
  // Geometric escapes that only planning can see (moving into another claim's region) stay refused by the claims themselves.
  const regional = await f.post('/v1/god/builds/church/claims', f.lead, { part: 'yard', region: { at: [-60, -60], size: [20, 20], yaw: 0 } }); assert.equal(regional.ok, true, JSON.stringify(regional));
  assert.equal((await f.post('/v1/god/builds/church/claims', f.rival, { part: 'lawn', region: { at: [-30, -60], size: [20, 20], yaw: 0 } })).ok, true);
  const yard = (await f.mint(regional.claim.id)).token;
  assert.equal((await f.post('/v1/god/act', yard, { ops: [place('bench', -60, -60)] })).accepted, true);
  assert.equal(code(await f.post('/v1/god/act', yard, { ops: [{ op: 'move', id: 'bench', p: [-30, -60] }] })), 'build.claimed');
  // Reading from outside is fine: a clone of an outside thing put into the claim, and a move within it, are accepted.
  const copied = await f.post('/v1/god/act', helper, { ops: [{ op: 'clone', id: 'outside', in: { parent: 'shell/east' }, p: [2, 2] }, { op: 'move', id: 'shell/east/pew', in: { parent: 'shell/east' }, p: [1, 1] }] });
  assert.equal(copied.accepted, true, JSON.stringify(copied)); assert.equal(f.god.store.edits(1)[0].hash8, h.hash8);
});

test('Y4 measure: seeded fuzz of helper edits — every out-of-scope edit refused before planning', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const east = await f.claim('east', 'shell/east'), { token: helper } = await f.mint(east);
  assert.equal((await f.post('/v1/god/act', helper, { ops: [place('pew', 1, 0, 'shell/east')] })).accepted, true);
  let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const inside = ['shell/east', 'shell/east/pew'], outside = ['shell', 'shell/west', 'outside'];
  const inScopeCodes = new Set<string>();
  const counts = { outOfScope: 0, refused: 0, authorisation: 0, planning: 0, inScope: 0, inScopeAccepted: 0 };
  for (let i = 0; i < 240; i++) {
    const kind = pick(['set', 'move', 'remove', 'place', 'place-root', 'world', 'undefine', 'economy', 'lease', 'other-build'] as const);
    let target = rnd() < 0.4 ? pick(inside) : pick(outside);
    if (kind === 'remove' && target === 'shell/east') target = 'shell/east/pew'; // removing the claim root itself is left to the lead
    const scoped = inside.includes(target) && !['place-root', 'world', 'undefine', 'economy', 'lease', 'other-build'].includes(kind);
    const n = `n${i}`;
    const op = kind === 'set' ? { op: 'set', id: target, params: {} } : kind === 'move' ? { op: 'move', id: target, p: [rnd() * 2, rnd() * 2] } : kind === 'remove' ? { op: 'remove', id: target }
      : kind === 'place' ? place(n, rnd(), rnd(), target) : kind === 'place-root' ? place(n, 60 + rnd() * 20, 60 + rnd() * 20) : kind === 'world' ? { op: 'world', state: { weather: { kind: 'rain' } } }
      : kind === 'undefine' ? { op: 'undefine', ref: 'part@1' } : kind === 'economy' ? { op: 'economy', currency: 'shell' } : place(n, rnd(), rnd(), 'shell/east');
    const build = kind === 'lease' ? f.leadField : kind === 'other-build' ? { id: 'chapel', claim: east } : undefined;
    const before = f.god.model.editSeq;
    // In process (the act route is allowed for helpers); avoids spending the pooled per-minute act window.
    const as = <T>(fn: () => T) => f.god.as({ identity: f.god.godIdentity(helper)! }, fn);
    const r = as(() => f.god.act({ ops: [op], ...(build ? { build } : {}) })) as any;
    if (scoped) { counts.inScope++; if (r.accepted) counts.inScopeAccepted++; else { assert.notEqual(code(r), 'helper.scope', `in-scope ${kind} ${target}: ${JSON.stringify(r.failures)}`); inScopeCodes.add(code(r)); } if (r.accepted && kind === 'remove') assert.equal(as(() => f.god.undo()).accepted, true); continue; }
    counts.outOfScope++;
    if (!r.accepted) { counts.refused++; if (code(r) === 'helper.scope') counts.authorisation++; else if (['build.claim', 'build.claimed'].includes(code(r))) counts.planning++; else assert.fail(`unexpected refusal ${JSON.stringify(r.failures)}`); }
    assert.equal(r.accepted, false, `out-of-scope ${kind} ${target} was accepted`); assert.equal(f.god.model.editSeq, before);
  }
  t.diagnostic(`measure ${JSON.stringify(counts)} in-scope refusals ${[...inScopeCodes].join(',')}`);
  assert.equal(counts.refused, counts.outOfScope); assert.ok(counts.outOfScope > 100);
  assert.equal(counts.authorisation, counts.outOfScope, 'a root claim refuses every out-of-scope edit before planning');
  assert.ok(counts.inScopeAccepted > 0);
});

test('Y4 routes: helper tokens never reach env, land, strike, prayers, lifecycle, minting, pairing or the doctor', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const east = await f.claim('east', 'shell/east'), west = await f.claim('west', 'shell/west'), { token: helper } = await f.mint(east);
  const seq = f.god.model.editSeq, open = f.god.builds.list().open.length;
  const denied: [string, string, unknown?][] = [
    ['POST', '/v1/god/env', { weather: { kind: 'rain' } }], ['POST', '/v1/god/land', { verb: 'raise', at: [0, 0] }], ['POST', '/v1/god/strike', { at: [0, 0] }],
    ['POST', '/v1/god/answer', { prayer: 'p_1', text: 'no' }], ['GET', '/v1/god/prayers'], ['GET', '/v1/god/stream'], ['GET', '/v1/god/layers'],
    ['POST', '/v1/god/builds', { id: 'chapel', title: 'Chapel', steps: ['shell'], site: { at: [300, 300], size: [10, 10] } }],
    ['POST', '/v1/god/builds/church/done', {}], ['POST', '/v1/god/builds/church/abandon', { undo: true, force: true }], ['POST', '/v1/god/builds/church/pause', {}], ['POST', '/v1/god/builds/church/resume', { take: true }],
    ['POST', '/v1/god/builds/church/claims', { part: 'tower', root: 'shell' }], ['POST', `/v1/god/builds/church/claims/${east}/helper`, {}], ['POST', `/v1/god/builds/church/claims/${west}/release`, {}],
    ['POST', '/v1/god/builds/chapel/step', { claim: east }], ['GET', '/v1/god/doctor'], ['POST', '/v1/god/doctor', { fix: true }],
    ['POST', '/v1/god/defs/unused/remove', {}], ['POST', '/v1/god/defs/part@1/thumb.png', {}], ['POST', '/v1/god/pair/approve', { code: 'ABCD-EFGH' }], ['POST', '/v1/god/mint', {}], ['POST', '/v1/god/claim', {}],
  ];
  for (const [method, path, body] of denied) { const r = await f.call(method, path, helper, body); assert.equal(r.status, 403, `${method} ${path}: ${r.text}`); assert.equal(r.data.code, 'helper.scope'); }
  assert.equal(f.god.model.editSeq, seq); assert.equal(f.god.builds.list().open.length, open);
  assert.equal(f.god.builds.claimState('church', west), 'held', 'a helper cannot release another claim');
  for (const path of ['/v1/god/builds', '/v1/god/builds/church', '/v1/god/edits', '/v1/god/schema', '/v1/god/status', '/v1/god/previews']) assert.equal((await f.call('GET', path, helper)).status, 200, path);
  const snapshot = (await f.call('GET', '/v1/god/snapshot', helper)).data; assert.deepEqual(snapshot.prayers, []); assert.ok(snapshot.entities.length);
  assert.equal((await f.call('POST', '/v1/god/query', helper, { describe: 'shell' })).status, 200);
  // Unit: a mounted world prefix does not change the decision.
  const scope = f.god.godIdentity(helper)!.child!;
  assert.equal(helperRoute('POST', '/w/helpers/v1/god/act', scope), null); assert.match(helperRoute('POST', '/w/helpers/v1/god/env', scope)!, /cannot use POST \/v1\/god\/env/);
  assert.equal(helperRoute('POST', `/v1/god/builds/church/claims/${east}/release`, scope), null);
  // Gene 2026-10-16: helper agents may read the god trace (read-only).
  assert.equal(helperRoute('GET', '/v1/god/trace', scope), null); assert.match(helperRoute('POST', '/v1/god/trace', scope)!, /cannot use POST/);
});

test('Y4 undo: helpers undo and redo only their own edits inside their claim group', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const east = await f.claim('east', 'shell/east'), { token: helper } = await f.mint(east);
  assert.equal((await f.post('/v1/god/act', helper, { ops: [place('pew', 1, 0, 'shell/east')] })).accepted, true);
  const undone = await f.post('/v1/god/undo', helper); assert.equal(undone.accepted, true, JSON.stringify(undone)); assert.equal(f.god.model.get('shell/east/pew'), undefined);
  assert.equal((await f.post('/v1/god/redo', helper)).accepted, true); assert.ok(f.god.model.get('shell/east/pew'));
  // The lead's newest edit is not the helper's to undo, even though plain undo targets the stack head.
  assert.equal((await f.post('/v1/god/act', f.lead, { ops: [place('gate', 30, 30)], build: f.leadField })).accepted, true);
  const seq = f.god.model.editSeq;
  const head = await f.post('/v1/god/undo', helper); assert.equal(code(head), 'helper.scope'); assert.match(head.failures[0].detail, /lead#/);
  assert.equal(code(await f.post('/v1/god/undo?group=church', helper)), 'helper.scope');
  // The lead holds the same claim; its edit through the claim lands in the claim group but is still not the helper's.
  assert.equal((await f.post('/v1/god/act', f.lead, { ops: [place('lectern', 2, 0, 'shell/east')], build: { id: 'church', claim: east } })).accepted, true);
  const group = await f.post('/v1/god/undo?group=church/east', helper); assert.equal(code(group), 'helper.scope'); assert.deepEqual(group.reverted, []);
  assert.equal(f.god.model.editSeq, seq + 1); assert.ok(f.god.model.get('shell/east/lectern')); assert.ok(f.god.model.get('gate'));
  // The lead may still undo everything (its own token, ordinary rules).
  assert.equal((await f.post('/v1/god/undo', f.lead, { build: { id: 'church', claim: east } })).accepted, true);
});

test('Y4 TTL: a helper token ends at its time limit, with its claim (release, take) and with its build', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const expired = async (token: string, why: RegExp) => { const r = await f.call('GET', '/v1/god/builds', token); assert.equal(r.status, 401, r.text); assert.equal(r.data.code, 'helper.expired'); assert.match(r.data.message, why); assert.equal(f.god.godIdentity(token), null); };
  let east = await f.claim('east', 'shell/east');
  const short = await f.mint(east, { ttlMs: HELPER_LIMITS.minTtlMs });
  assert.equal((await f.call('GET', '/v1/god/builds', short.token)).status, 200);
  f.advance(HELPER_LIMITS.minTtlMs); await expired(short.token, /expired at/);
  const released = await f.mint(east);
  await f.post(`/v1/god/builds/church/claims/${east}/release`, released.token, { done: true });
  await expired(released.token, /is done/);
  east = await f.claim('east', 'shell/east'); const taken = await f.mint(east);
  f.advance(130_000); const take = await f.post('/v1/god/builds/church/claims', f.rival, { part: 'east', take: east }); assert.equal(take.ok, true, JSON.stringify(take));
  await expired(taken.token, /is taken/);
  const tower = await f.claim('tower', 'shell/west'), closed = await f.mint(tower);
  assert.equal((await f.post('/v1/god/builds/church/done', f.lead, { force: true })).ok, true);
  await expired(closed.token, /is closed/);
  assert.equal(f.god.helpers.live().length, 1, 'each mint prunes ended helper rows; only the last (ended) one remains');
});

test('Y4 TTL: a helper token ends when its lead token is gone; the claim and other tokens are unaffected', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const east = await f.claim('east', 'shell/east', f.rival), { token: helper } = await f.mint(east, {}, f.rival);
  assert.equal((await f.call('GET', '/v1/god/builds', helper)).status, 200);
  f.db.db.prepare('DELETE FROM god_tokens_v1 WHERE world_id=? AND token_hash=?').run('helpers', hashToken(f.rival));
  const r = await f.call('POST', '/v1/god/act', helper, { ops: [place('pew', 1, 0, 'shell/east')] });
  assert.equal(r.status, 401, r.text); assert.equal(r.data.code, 'helper.expired'); assert.match(r.data.message, /lead token is no longer valid/);
  assert.equal(f.god.builds.claimState('church', east), 'held'); assert.equal((await f.call('GET', '/v1/god/builds', f.lead)).status, 200);
});

test('Y4 pooled limits: helpers draw from the lead\'s buckets; verify-use has a small per-helper budget', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const east = await f.claim('east', 'shell/east'), a = await f.mint(east, { verify: 10 }), b = await f.mint(east, { verify: 10 });
  const verify = (token: string) => f.call('POST', '/v1/god/verify-use', token, { target: 'shell' });
  const pool = [f.lead, a.token, b.token];
  for (let i = 0; i < CREATION_LIMITS.verifyPerMinute; i++) assert.equal((await verify(pool[i % 3])).status, 200);
  for (const token of pool) { const r = await verify(token); assert.equal(r.status, 429, r.text); assert.equal(r.data.code, 'rate-limited'); }
  assert.equal((await verify(f.rival)).status, 200, 'another root token keeps its own allowance');

  const g = fixture(); t.after(() => g.db.close());
  const cid = await g.claim('east', 'shell/east'), once = await g.mint(cid, { verify: 1 });
  assert.equal((await g.call('POST', '/v1/god/verify-use', once.token, { target: 'shell' })).status, 200);
  const spent = await g.call('POST', '/v1/god/verify-use', once.token, { target: 'shell' }); assert.equal(spent.status, 403); assert.equal(spent.data.code, 'helper.budget');
  assert.equal((await g.call('POST', '/v1/god/verify-use', g.lead, { target: 'shell' })).status, 200);
});

test('Y4 fuzz: env, strike and land stay bounded whatever helpers are minted', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const helpers: string[] = [];
  for (const [part, root] of [['east', 'shell/east'], ['west', 'shell/west']]) { const cid = await f.claim(part, root); for (let i = 0; i < HELPER_LIMITS.perClaim; i++) helpers.push((await f.mint(cid)).token); }
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const callers = [f.lead, f.rival, ...helpers], ok = new Map<string, number>(), refusals = new Map<number, number>();
  const kinds = ['env', 'strike', 'land'] as const;
  for (let i = 0; i < 900; i++) {
    // Half the calls come from root tokens so each root bucket is driven well past its window.
    const who = rnd() < 0.5 ? callers[Math.floor(rnd() * 2)] : helpers[Math.floor(rnd() * helpers.length)], kind = kinds[Math.floor(rnd() * kinds.length)];
    const body = kind === 'env' ? { weather: { kind: rnd() < 0.5 ? 'rain' : 'clear' } } : kind === 'strike' ? { at: [Math.round(rnd() * 100 - 50), Math.round(rnd() * 100 - 50)] } : { verb: 'raise', preview: true, at: [0, 0] };
    const r = await f.call('POST', `/v1/god/${kind}`, who, body);
    const family = who === f.lead ? 'lead' : who === f.rival ? 'rival' : 'helper';
    if (r.status === 200 && kind !== 'land') ok.set(`${family}:${kind}`, (ok.get(`${family}:${kind}`) ?? 0) + 1);
    if (family === 'helper') assert.equal(r.status, 403, r.text);
    refusals.set(r.status, (refusals.get(r.status) ?? 0) + 1);
  }
  for (const kind of ['env', 'strike'] as const) {
    const max = kind === 'env' ? CREATION_LIMITS.envEditsPerMinute : CREATION_LIMITS.strikesPerMinute;
    assert.equal(ok.get(`helper:${kind}`) ?? 0, 0);
    for (const family of ['lead', 'rival']) assert.ok((ok.get(`${family}:${kind}`) ?? 0) <= max, `${family} ${kind}: ${ok.get(`${family}:${kind}`)} > ${max}`);
    assert.ok((ok.get(`lead:${kind}`) ?? 0) > 0, 'the lead keeps its own allowance');
  }
  assert.ok((refusals.get(429) ?? 0) > 0, `the fuzz reached the window limit: ${JSON.stringify([...refusals])} ${JSON.stringify([...ok])}`); assert.ok((refusals.get(403) ?? 0) > 0);
  // Every world-state row the fuzz committed is attributed to the root token that made it.
  const rows = f.god.store.edits(200).filter(r => r.ops.some(o => o.op === 'world'));
  assert.ok(rows.length); for (const r of rows) assert.ok(['lead', 'rival'].includes(r.label!) && r.hash8 && [f.leadId.hash, hashToken(f.rival)].some(h => h.startsWith(r.hash8!)), JSON.stringify(r));
});

test('WD7.2 attribution: every journal row and def origin names its token or system (100%)', async t => {
  const f = fixture({ genesis: { schema: 'genesis/1', state: { weather: { kind: 'clear' } }, batches: [] } }); t.after(() => f.db.close());
  const east = await f.claim('east', 'shell/east'), { token: helper, helper: h } = await f.mint(east);
  assert.equal((await f.post('/v1/god/act', helper, { ops: [{ op: 'define', def: partDef('pew') }, place('pew', 1, 0, 'shell/east', 'pew@1')] })).accepted, true);
  assert.equal((await f.post('/v1/god/undo', helper)).accepted, true); assert.equal((await f.post('/v1/god/redo', helper)).accepted, true);
  assert.equal((await f.post('/v1/god/env', f.lead, { weather: { kind: 'rain' } })).accepted, true);
  assert.equal((await f.post('/v1/god/strike', f.rival, { at: [5, 5] })).accepted, true);
  assert.equal(f.god.engineAct([{ op: 'move', id: 'outside', p: [42, 40], mode: 'strict' }], 'a resident nudged it').accepted, true);
  assert.equal(f.god.as({ identity: f.leadId }, () => f.god.undo()).accepted, true, 'a root token may undo the rival strike (engine rows are skipped)');
  const rows = f.god.store.edits(200), expected = new Map([[f.leadId.hash.slice(0, 8), 'lead'], [hashToken(f.rival).slice(0, 8), 'rival'], [h.hash8, h.label]]);
  const attributable = rows.filter(r => r.label === 'engine' ? r.by === 'engine' && r.hash8 === null : r.label === 'genesis' ? r.hash8 === null : !!r.hash8 && expected.get(r.hash8) === r.label);
  assert.equal(attributable.length, rows.length, `attributable ${attributable.length}/${rows.length}: ${JSON.stringify(rows.filter(r => !attributable.includes(r)).map(r => [r.seq, r.kind, r.by, r.label, r.hash8]))}`);
  assert.deepEqual(new Set(rows.map(r => r.label)), new Set(['genesis', 'lead', h.label, 'rival', 'engine']));
  assert.deepEqual(rows.filter(r => r.hash8 === h.hash8).map(r => r.kind).sort(), ['edit', 'redo', 'undo']);
  const origin = f.db.db.prepare("SELECT label,hash8 FROM god_def_origins_v1 WHERE world_id='helpers' AND ref='pew@1'").get() as { label: string; hash8: string };
  assert.deepEqual({ ...origin }, { label: h.label, hash8: h.hash8 });
  const journal = (await f.call('GET', '/v1/god/builds/church', f.lead)).data.journal as { by?: string; grp: string }[];
  assert.ok(journal.length && journal.every(j => j.by), JSON.stringify(journal)); assert.ok(journal.some(j => j.by === `${h.label}#${h.hash8}`));
  const listed = (await f.call('GET', '/v1/god/edits?limit=200', f.rival)).data.edits as { label: string }[]; assert.ok(listed.every(e => e.label));
});
