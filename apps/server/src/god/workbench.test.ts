import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { WorldModel, definitionRefs } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { admitWorkbench, unusedDefinitions } from './workbench.ts';
const def = (name = 'bench-trial') => ({ schema: 'def/1', name, version: 1, size: { box: [2, 1, 1] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, .5, 0], size: [2, 1, 1] }], slots: [{ id: 'seat', kind: 'seat', p: [0, 1, 0] }] } } });
function fixture(t: { after(fn: () => void): void }) {
  const db = new Db(':memory:'); t.after(() => db.close());
  const opts = { worldId: 'workbench', ownerId: 'dev:owner', tick: () => 0, emit: () => {} };
  const god = new GodMode(db, opts), token = god.mintFor({ id: 'dev:owner', role: 'user' }, 'bench');
  const app = new Hono(); mountGodRoutes(app, { god, worldName: 'Bench', requireUser: async () => { throw Error('no owner session'); }, soulFromBearer: () => null, baseOf: () => '', limitIp: () => {} });
  app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code }, e.status as 400) : c.json({ error: String(e) }, 500));
  const request = (path: string, body?: unknown, auth = token) => app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { god, request, db, opts };
}
test('kit render uses define admission, resolves beside, and leaves snapshot/journal/seq unchanged over iterations', async t => {
  const { god, request } = fixture(t), snapshot = JSON.stringify(god.model.snapshot()), journal = god.store.edits();
  for (let i = 0; i < 3; i++) {
    const r = await request('/v1/god/kit/render', { def: def(), beside: 'core/church@1' });
    const b = await r.json() as any;
    assert.equal(r.status, 200); assert.equal(b.accepted, true, JSON.stringify(b)); assert.equal(b.def.ref, 'bench-trial@1'); assert.ok(b.beside); assert.ok(b.defs.length >= 2);
    assert.equal(JSON.stringify(god.model.snapshot()), snapshot); assert.deepEqual(god.store.edits(), journal);
  }
  assert.equal(god.model.def('bench-trial@1'), undefined);
  const invalid = admitWorkbench(god, { def: { ...def(), make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'no-such-shape', at: [0, 0, 0] }] } } } });
  assert.equal(invalid.accepted, false);
  assert.equal(admitWorkbench(god, { def: def(), beside: 'no-such@1' }).accepted, false);
});
test('render and cleanup require a god token, and exact unused route precedes catalog wildcard', async t => {
  const { request, god } = fixture(t);
  for (const [path, body] of [['/v1/god/kit/render', { def: def() }], ['/v1/god/defs/unused', undefined], ['/v1/god/defs/unused/remove', {}]] as const) assert.equal((await request(path, body, '')).status, 401);
  assert.equal(god.act({ ops: [{ op: 'define', def: def() }] }).accepted, true);
  const list = await (await request('/v1/god/defs/unused')).json() as any;
  assert.deepEqual(list.defs.map((d: any) => d.ref), ['bench-trial@1']);
});
test('cleanup is one journaled atomic edit, undoable/redoable, and retirement survives reload', async t => {
  const { request, god, db, opts } = fixture(t);
  god.act({ ops: [{ op: 'define', def: def() }, { op: 'define', def: def('second') }] });
  const seq = god.model.editSeq;
  const result = await (await request('/v1/god/defs/unused/remove', {})).json() as any;
  assert.equal(result.accepted, true, JSON.stringify(result)); assert.equal(result.seq, seq + 1); assert.equal(result.removed.length, 2);
  assert.equal(god.model.def('bench-trial@1'), undefined);
  assert.equal(new GodMode(db, opts).model.def('bench-trial@1'), undefined);
  assert.equal(WorldModel.fromSnapshot(god.model.snapshot()).def('second@1'), undefined);
  assert.equal(god.undo().accepted, true); assert.ok(god.model.def('bench-trial@1')); assert.ok(god.model.def('second@1'));
  assert.equal(god.redo().accepted, true); assert.equal(god.model.def('second@1'), undefined);
  const empty = await (await request('/v1/god/defs/unused/remove', {})).json() as any;
  assert.equal(empty.seq, seq + 3); assert.deepEqual(empty.removed, []);
});
test('cleanup excludes library refs, live dependencies, removed and undone placements; direct undefine is guarded', t => {
  const { god } = fixture(t);
  god.act({ ops: [{ op: 'define', def: def() }, { op: 'define', def: def('unused') }] });
  assert.equal(god.act({ ops: [{ op: 'place', def: 'bench-trial@1', p: [0, 0] }] }).accepted, true);
  assert.equal(god.undo().accepted, true);
  assert.deepEqual(unusedDefinitions(god).map(d => d.ref), ['unused@1']);
  const r = god.act({ ops: [{ op: 'undefine', ref: 'bench-trial@1' }] }); assert.equal(r.accepted, false);
  assert.equal(god.act({ ops: [{ op: 'undefine', ref: 'core/church@1' }] }).accepted, false);
  const dependent = { schema: 'def/1', name: 'dependent', size: { box: [2, 1, 1] }, extends: 'unused@1', make: { kind: 'none' } };
  assert.equal(god.act({ ops: [{ op: 'define', def: dependent }] }).accepted, true);
  assert.ok(definitionRefs(god.model.def('dependent@1')).includes('unused@1'));
  assert.equal(unusedDefinitions(god).some(d => d.ref === 'unused@1'), false);
  assert.equal(god.act({ ops: [{ op: 'undefine', ref: 'unused@1' }] }).accepted, false);
});
test('historically used inherited defs stay protected after the derived def changes', t => {
  const { god } = fixture(t);
  const derived = { ...def('derived'), extends: 'bench-trial@1' };
  assert.equal(god.act({ ops: [{ op: 'define', def: def() }, { op: 'define', def: derived }] }).accepted, true);
  assert.equal(god.act({ ops: [{ op: 'place', def: 'derived@1', p: [0, 0], name: 'derived-object' }] }).accepted, true);
  assert.equal(god.undo().accepted, true);
  assert.equal(god.act({ ops: [{ op: 'define', def: def('derived') }] }).accepted, true);
  assert.equal(unusedDefinitions(god).some(d => d.ref === 'bench-trial@1'), false);
  const cleanup = { ops: [{ op: 'undefine', ref: 'bench-trial@1' }] };
  assert.equal(god.dryrun(cleanup).accepted, false); assert.equal(god.preview(cleanup).accepted, false); assert.equal(god.act(cleanup).accepted, false);
});
