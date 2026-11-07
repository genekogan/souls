import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SKILL_VERSION, COMMANDS, answer, checkArgs, commit, explainFailure, preview, request, status, undo, verifyUse } from './cli.mjs';
import { view, invalidate, mirror } from './lib/mirror.mjs';
import { build, buildWait, EXAMPLES, examples, group, act, dryrun, importWorld, look, lookOverrides, parseFlags, parseMassing, planBatch } from './cli.mjs';
import { buildSuffix, call, claimFile, helperFile, load, save } from './lib/state.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

function fixture(t, data) {
  const cwd = process.cwd(), originalFetch = globalThis.fetch, dir = mkdtempSync(join(tmpdir(), 'god-cli-offline-')), calls = [];
  process.chdir(dir);
  writeFileSync('.eden-god.json', JSON.stringify({ world: 'https://world.invalid', token: 'fixture-only', group: 'previewed-group' }));
  globalThis.fetch = async (url, options) => { const c = { url, ...options }; calls.push(c); return Response.json(typeof data === 'function' ? data(c) : data); };
  t.after(() => { globalThis.fetch = originalFetch; process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); });
  return calls;
}

test('verify-use posts typed options and returns the full JSON receipt', async t => {
  const receipt = {ok: true, target: 'chapel', uses: [{use: 'enter', ok: true, room: 'nave'}], probe: {removed: true}, ms: 9, notes: []};
  const calls = fixture(t, receipt);
  assert.deepEqual(await COMMANDS['verify-use'](['chapel'], {from: '-2,3.5', seat: 'chapel/pew', uses: 'enter,sit', json: true}), receipt);
  assert.equal(calls[0].url, 'https://world.invalid/v1/god/verify-use');
  assert.deepEqual(JSON.parse(calls[0].body), {target: 'chapel', from: [-2, 3.5], seat: 'chapel/pew', uses: ['enter', 'sit']});
  await verifyUse('chapel', {from: 'plaza', json: true}); assert.equal(JSON.parse(calls[1].body).from, 'plaza');
  checkArgs('verify-use', {seat: 'pew', from: 'plaza', uses: 'sit', json: true}, ['chapel']);
  assert.throws(() => checkArgs('verify-use', {}, ['chapel', 'extra']), /takes one word/);
});

test('verify-use prints each verdict, engine refusal, and cleanup state', async t => {
  fixture(t, {ok: false, uses: [{use: 'enter', ok: true, room: 'nave', door: 'main-door'}, {use: 'sit', ok: false, reason: {code: 'verify.refused', engineCode: 'route.blocked', message: 'No passage.'}}], probe: {removed: true}, ms: 12});
  const output = await verifyUse('chapel');
  assert.match(output, /enter: OK.*nave via main-door/); assert.match(output, /sit: FAILED.*verify.refused.*route.blocked.*No passage/); assert.match(output, /probe removed; 12 ms/);
});

test('verify-use prints phase timings, position proof, planned interior route and pending removal', async t => {
  fixture(t, {ok: true, uses: [{use: 'enter', ok: true, proof: {kind: 'footprint', at: [2, 3], tick: 42, ms: 500}}, {use: 'sit', ok: true, interiorRoute: {reach: {ok: true, length: 22}, relocatedTo: [4, 5], finalApproach: 'physical'}}], probe: {removed: false, removal: 'pending'}, timings: {birth: 10, start: 20, enter: 500, sit: 1000, retire: 100}, ms: 1630, notes: ['Explicit from: full physical walk; this can be slower.']});
  const output = await verifyUse('gazebo');
  assert.match(output, /timings \(ms\): birth 10; start 20; enter 500; sit 1000; retire 100/);
  assert.match(output, /footprint at 2,3; tick 42; 500 ms/);
  assert.match(output, /engine planner OK \(22 m\); relocated to 4,5; final approach physical/);
  assert.match(output, /removal pending \(native retirement accepted\)/); assert.match(output, /full physical walk.*slower/);
});

test('verify-use refusal without a probe never claims removal', async t => {
  fixture(t, {ok: false, uses: [{use: 'sit', ok: false, reason: {code: 'verify.busy', message: 'A verifier is still running.'}}], probe: {created: false, removed: true, removal: 'done'}, ms: 0});
  const output = await verifyUse('chapel');
  assert.match(output, /sit: FAILED.*verify.busy/);
  assert.match(output, /probe not created; 0 ms/);
  assert.doesNotMatch(output, /probe removed/);
});

test('verify-use validates options before contacting the server', async t => {
  const calls = fixture(t, {});
  await assert.rejects(verifyUse(), /usage: verify-use/);
  for (const flags of [{uses: 'fly'}, {uses: 'sit,sit'}, {from: '1,no'}, {from: '1,2,3'}, {from: ',2'}]) await assert.rejects(verifyUse('chapel', flags));
  assert.equal(calls.length, 0);
});

test('repairable refusals show their op, field and concrete fix', () => {
  assert.equal(explainFailure({ op: 2, code: 'def.invalid', detail: 'profile has one point', field: 'make.args.shapes.0.profile', fix: 'lathe profile needs ≥2 points' }), 'def.invalid (op 2): profile has one point — field make.args.shapes.0.profile — fix: lathe profile needs ≥2 points');
  assert.equal(explainFailure({ op: 0, code: 'custom', detail: 'ordinary refusal' }), 'custom (op 0): ordinary refusal');
});

test('preview prints its id and concrete commit command', async (t) => {
  const calls = fixture(t, { accepted: true, id: 'preview-123', summary: { upserts: 1 } });
  const result = await preview({ ops: [{ op: 'remove', id: 'bench' }] });
  assert.equal(result.id, 'preview-123');
  assert.equal(result.commit, 'node eden-god.mjs commit preview-123');
  assert.match(result.tell, /Preview preview-123/);
  assert.match(result.tell, /commit preview-123/);
  assert.equal(JSON.parse(calls[0].body).group, 'previewed-group');
});

test('commit posts only the preview id and a fresh clientRef', async (t) => {
  const calls = fixture(t, { accepted: true, seq: 9 });
  await commit('preview-123');
  await COMMANDS.commit(['preview-123']);
  const [one, two] = calls.map((c) => JSON.parse(c.body));
  assert.equal(calls[0].url, 'https://world.invalid/v1/god/act');
  assert.deepEqual(Object.keys(one).sort(), ['clientRef', 'preview']);
  assert.equal(one.preview, 'preview-123');
  assert.notEqual(one.clientRef, two.clientRef);
  await assert.rejects(commit(), /usage: commit/);
  checkArgs('commit', {}, ['preview-123']);
  assert.throws(() => checkArgs('commit', {}, ['preview-123', 'extra']), /takes one word/);
});

test('request looks up an escaped receipt ref without writing', async (t) => {
  const receipt = { world: 'fixture', clientRef: 'ref/part', payloadHash: 'hash', seq: 9, result: { accepted: true, seq: 9 } };
  const calls = fixture(t, receipt);
  assert.deepEqual(await request('ref/part'), receipt);
  assert.equal(calls[0].url, 'https://world.invalid/v1/god/requests/ref%2Fpart');
  assert.equal(calls[0].method, 'GET');
  await assert.rejects(request(), /usage: request/);
  checkArgs('request', {}, ['ref']);
});

test('status exposes the local skill and server version tuple', async (t) => {
  fixture(t, { you: 'god', entities: 3, seq: 8, versions: { protocol: 'god/1', schema: 'god-schema/1', skill: '1.8', source: 'abc123' } });
  assert.equal(SKILL_VERSION, '1.8');
  const text = await status();
  for (const part of ['skill 1.8', 'protocol god/1', 'schema god-schema/1', 'source abc123']) assert.ok(text.includes(part), part);
});

test('answer and layer commands use receipt-protected acts with fresh refs', async (t) => {
  const calls = fixture(t, { accepted: true, seq: 9 });
  await answer('prayer-1', 'A place to rest');
  await COMMANDS.access(['bench', 'private'], {});
  assert.ok(calls.every((c) => c.url === 'https://world.invalid/v1/god/act'));
  const [one, two] = calls.map((c) => JSON.parse(c.body));
  assert.deepEqual(one.ops, [{ op: 'answer', prayer: 'prayer-1', text: 'A place to rest' }]);
  assert.notEqual(one.clientRef, two.clientRef);
});

test('group undo prints failures and both sides of a partial revert', async t => {
  fixture(t, { accepted: false, reverted: [16], notReverted: [15, 14], failed: 15, failures: [{ op: 0, code: 'undo.conflict', detail: 'bench was redefined later', entity: 'e_bench', field: 'def', fix: 'Undo the later definition first.' }] });
  const text = await undo({ group: 'g' });
  assert.match(text, /incomplete/); assert.match(text, /undone edits: 16/); assert.match(text, /not undone edits: 15, 14/);
  assert.match(text, /undo.conflict/); assert.match(text, /field def/); assert.match(text, /Undo the later definition/);
});

const walkedOut = { soulId: 's_ada', body: 'h_ada', name: 'Ada', how: 'walked', from: [0, 0], to: [3, 0], reason: 'The god is removing the bench; you stood up and stepped aside.', released: ['e_bench'] };
test('G1: undo prints the residents walked out of the way', async t => {
  fixture(t, { accepted: true, reverted: 16, moved: [walkedOut], warnings: [] });
  assert.equal(await undo({}), 'undid edit 16\n  Ada walked out of the way to (3, 0): "The god is removing the bench; you stood up and stepped aside."');
});
test('G1: group undo prints residents relocated when no walking route was open', async t => {
  fixture(t, { accepted: true, reverted: [16, 15], notReverted: [], moved: [{ ...walkedOut, how: 'relocated' }] });
  assert.match(await undo({ group: 'g' }), /^undid group "g": edits 16, 15\n  Ada was moved \(no walking route\) to \(3, 0\)/);
});

test('G1: a resident only on its way to what changed is listed as stopped; upstairs exits name their floor', async t => {
  fixture(t, { accepted: true, reverted: 17, moved: [{ ...walkedOut, how: 'stopped', to: [0, 0], reason: 'The god is moving the bench you were heading for; you stopped.' }, { ...walkedOut, name: 'Cy', level: 1 }], warnings: [] });
  assert.equal(await undo({}), 'undid edit 17\n  Ada stopped where they were (on the way to what changed) at (0, 0): "The god is moving the bench you were heading for; you stopped."\n  Cy walked out of the way to (3, 0, floor level 1): "The god is removing the bench; you stood up and stepped aside."');
});
test('G1: plan names the residents a dry run would walk out', async t => {
  fixture(t, { accepted: true, ids: {}, warnings: [], diff: { upserts: 0, removes: 1, defs: [], tiles: 0 }, wouldMove: [{ name: 'Ada', soulId: 's_ada', how: 'walked', to: [3, 0], reason: walkedOut.reason }] });
  assert.equal(await planBatch({ ops: [{ op: 'remove', id: 'bench' }] }), 'would be accepted: 0 things placed/changed, 1 removed; residents it would walk out (never refused): Ada (walked)');
});

test('group undo never hides failures behind an accepted partial response from an older server', async t => {
  fixture(t, { accepted: true, reverted: [16], failures: [{ op: 0, code: 'undo.conflict', detail: 'edit 15 conflicts' }] });
  const text = await undo({ group: 'g' });
  assert.match(text, /incomplete/); assert.match(text, /undone edits: 16/); assert.match(text, /edit 15 conflicts/);
});

test('a complete group undo prints all reverted edits', async t => {
  fixture(t, { accepted: true, reverted: [16, 15, 14], notReverted: [] });
  assert.equal(await undo({ group: 'g' }), 'undid group "g": edits 16, 15, 14');
});

test('mirror preserves the active named definition when only an older hash-pinned revision is in use', () => {
  const old = { hash: 'old', ref: 'post@1' }, active = { hash: 'active', ref: 'post@1' };
  const v = view({ rows: [], snapshot: { defs: [old], library: [active], entities: [] } });
  assert.equal(v.def('post@1'), active); assert.equal(v.def('sha:old'), old);
});

const steps = ['shell', 'roof and tower', 'openings', 'interior', 'furnish'];
const localBuild = () => ({ id: 'church', lease: 'l_1234abcd', n: 1, label: 'shell', steps });
const serverBuild = (patch = {}) => ({ id: 'church', title: 'Black stone church', plan: { steps }, site: { at: [0, 0], size: [40, 16], yaw: 0 }, massing: [{ name: 'nave', at: [0, 0], size: [22, 10], h: 12, parts: 0 }], roots: [], claims: [], status: 'active', step: { n: 1, label: 'shell' }, current: null, next: { n: 2, label: 'roof and tower' }, ...patch });
const echo = (body, patch = {}) => ({ id: body.build?.id ?? 'church', status: 'active', rev: 2, group: body.group ?? 'church', step: { n: body.build?.step ?? 1, label: body.build?.label ?? 'shell' }, ...patch });

// Only real network in these tests: ephemeral HTTP listeners bound to 127.0.0.1.
// The handler is a wire fixture, not any Sim service or model provider.
async function buildFixture(t, handler = () => null) {
  const cwd = process.cwd(), previousClaim = process.env.EDEN_GOD_CLAIM;
  const dir = mkdtempSync(join(tmpdir(), 'god-build-stub-')), calls = [];
  delete process.env.EDEN_GOD_CLAIM;
  const snapshot = { worldId: 'stub', constants: { extent: 200, ground: 'flat' }, seq: 1, buildsRev: 1, state: { sky: { palette: 'day' } }, entities: [], library: [], defs: [], prayers: [], ground: { landforms: [], waters: [] }, builds: [serverBuild()] };
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const part of req) raw += part;
      const c = { method: req.method, path: req.url, raw, body: raw ? JSON.parse(raw) : undefined, auth: req.headers.authorization };
      calls.push(c);
      let reply = await handler(c, calls);
      if (!reply) {
        if (c.path === '/v1/god/builds' && c.method === 'POST') reply = { ok: true, build: serverBuild({ id: c.body.id, title: c.body.title, plan: { steps: c.body.steps }, site: c.body.site, massing: c.body.massing }), lease: 'l_1234abcd' };
        else if (c.path === '/v1/god/builds') reply = { now: 10, rev: 1, open: [serverBuild()], recent: [] };
        else if (c.path.endsWith('/resume')) reply = { ok: true, build: serverBuild(), lease: 'l_7654abcd' };
        else if (c.path.endsWith('/claims')) reply = { ok: true, build: serverBuild(), claim: { id: 'c_1234abcd', part: c.body.part, step: { n: 1, label: 'shell' }, status: 'held' } };
        else if (c.path.startsWith('/v1/god/builds/')) reply = { ok: true, build: serverBuild({ status: c.path.endsWith('/done') ? 'done' : c.path.endsWith('/abandon') ? 'abandoned' : 'active' }) };
        else if (c.path === '/v1/world/seq') reply = { seq: 1, builds: 1 };
        else if (c.path === '/v1/god/snapshot') reply = snapshot;
        else if (c.path === '/v1/god/status') reply = { you: 'god', entities: 0, seq: 1, builds: [{ id: 'church', status: 'paused' }] };
        else if (c.path === '/v1/god/query') reply = c.body.furnish ? { furnish: { ops: [{ op: 'set', id: 'church', state: { paint: '#fff' } }], notes: [], rooms: [] } } : { layout: { entities: [] } };
        else reply = { accepted: true, seq: 2, reverted: [1], ...(c.body?.build ? { build: echo(c.body) } : {}) };
      }
      res.writeHead(reply.httpStatus ?? 200, { 'content-type': reply.contentType ?? 'application/json' });
      res.end(reply.rawText ?? JSON.stringify(reply.data ?? reply));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
  });
  for (;;) {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const p = server.address().port;
    if (p < 4930 || p > 4970) break;
    await new Promise((resolve) => server.close(resolve));
  }
  process.chdir(dir); invalidate();
  save({ world: `http://127.0.0.1:${server.address().port}`, token: 'fixture-only' });
  t.after(async () => {
    process.chdir(cwd); invalidate();
    if (previousClaim === undefined) delete process.env.EDEN_GOD_CLAIM; else process.env.EDEN_GOD_CLAIM = previousClaim;
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    rmSync(dir, { recursive: true, force: true });
  });
  return { calls, dir, snapshot };
}
const startFlags = () => ({ title: 'Black stone church', steps: steps.join(','), at: '0,0', size: '40,16', mass: 'nave 0,0 22x10 h12 gable; tower -13,0 6x6 h30 pyramid' });

// Exact parts/search shapes from the reuse server; no Sim service is contacted.
const keptPart = (patch = {}) => ({ sha: 'a'.repeat(64), ref: 'gothic-buttress@1', from: [{ build: 'black-church', title: 'Black Gothic church', doneAt: Date.UTC(2026, 9, 15, 18) }], placedNow: 10, firstBy: 'builder#12345678', checks: { buildDone: true, kept: 10, buildUse: 'none-recorded', partUse: 'n/a' }, place: `place sha:${'a'.repeat(64)} …`, ...patch });
const keptDef = (patch = {}) => ({ name: 'gothic-buttress', ref: 'gothic-buttress@1', hash: 'a'.repeat(64), form: 'point', layer: 'solid', size: { box: [2, 8, 2], scale: [0.5, 2] }, make: { kind: 'gen', gen: 'kit/2' }, tags: ['gothic', 'stone'], params: {}, slots: [], description: 'A stepped stone support.', usedIn: [{ build: 'black-church', placedNow: 10 }], ...patch });
const compactPart = (patch = {}) => ({ ref: 'gothic-buttress@1', cat: 'prop', size: '2×8×2', make: 'kit/2', tris: 120, doc: 'A stepped stone support.', usedIn: [{ build: 'black-church', placedNow: 10 }], ...patch });
const startWithParts = (c, parts) => ({ ok: true, build: serverBuild({ id: c.body.id, title: c.body.title, plan: { steps: c.body.steps }, site: c.body.site, massing: c.body.massing }), lease: 'l_1234abcd', parts });

test('parts accepts free text and JSON; help explains pinned reuse', () => {
  checkArgs('parts', {}, ['gothic', 'stone', 'supports']);
  checkArgs('parts', { json: true }, []);
  assert.throws(() => checkArgs('parts', { unknown: true }, []), /no option --unknown/);
  assert.match(COMMANDS.help(), /parts \[words\] \[--json\].*place sha:<hash> --at …/);
});

test('parts searches once and prints provenance, standing, honest checks and full pinned hints', async t => {
  const parts = [keptPart({ from: [...keptPart().from, { build: 'chapel', title: 'Small chapel', doneAt: Date.UTC(2026, 9, 16) }], checks: { buildDone: true, kept: 10, buildUse: [{ target: 'church/door', uses: 'enter', ok: true, editSeq: 24 }, { target: 'church/seat', uses: 'sit', ok: false, editSeq: 25 }], partUse: 'none-recorded' } }), keptPart({ sha: 'b'.repeat(64), ref: 'old-spire@1', placedNow: 0 })];
  const { calls } = await buildFixture(t, c => c.path.startsWith('/v1/god/parts?') ? { parts } : null);
  const output = await COMMANDS.parts(['stone', '&', 'gothic']);
  assert.equal(output.split('\n').length, 2, 'one line per part');
  assert.match(output, /gothic-buttress@1.*gothic buttress/);
  assert.ok(output.includes('sha:' + 'a'.repeat(64)));
  assert.match(output, /Black Gothic church \(done Oct 15\); Small chapel \(done Oct 16\)/);
  assert.match(output, /10 standing.*checks: build done; 10 kept at done/);
  assert.match(output, /enter at church\/door passed/);
  assert.match(output, /sit at church\/seat FAILED/);
  assert.match(output, /part-use: none recorded/);
  assert.match(output.split('\n')[1], /no copies standing.*build-use: none recorded; part-use: n\/a/);
  for (const part of parts) assert.ok(output.includes(`place sha:${part.sha} --at …`));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(new URL(calls[0].path, 'http://127.0.0.1').searchParams.get('q'), 'stone & gothic');
});

test('parts JSON preserves server evidence and empty lists have a useful message', async t => {
  let response = { parts: [keptPart()] };
  const { calls } = await buildFixture(t, c => c.path.startsWith('/v1/god/parts?') ? response : null);
  assert.deepEqual(await COMMANDS.parts([], { json: true }), response);
  assert.equal(calls[0].path, '/v1/god/parts?q=');
  response = { parts: [] };
  assert.equal(await COMMANDS.parts(), 'no parts from finished builds');
  assert.equal(await COMMANDS.parts(['spire']), 'no parts from finished builds matching "spire"');
  assert.deepEqual(await COMMANDS.parts([], { json: true }), { parts: [] });
  assert.ok(calls.every(c => c.method === 'GET'));
});

test('build start shows at most eight server suggestions with the same hints in its single response', async t => {
  const suggestions = Array.from({ length: 9 }, (_, i) => keptPart({ ref: `buttress-${i}@1`, sha: String(i).repeat(64) }));
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/builds' ? startWithParts(c, suggestions) : null);
  const output = await build('start', ['church'], startFlags());
  assert.match(output, /parts from earlier builds you can reuse:\n/);
  assert.equal(output.split('\n').filter(line => line.includes(' · sha:')).length, 8);
  assert.ok(output.includes(`place sha:${suggestions[0].sha} --at …`));
  assert.doesNotMatch(output, /buttress-8/);
  assert.ok(output.indexOf('parts from earlier builds') < output.indexOf('every edit now carries'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(load().build.id, 'church');
});

test('build start JSON keeps raw suggestions and empty suggestions add no text', async t => {
  let suggestions = [keptPart()];
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/builds' ? startWithParts(c, suggestions) : null);
  assert.deepEqual((await build('start', ['church'], { ...startFlags(), json: true })).parts, suggestions);
  suggestions = [];
  assert.doesNotMatch(await build('start', ['chapel'], startFlags()), /parts from earlier builds/);
  assert.equal(calls.length, 2);
});

test('find badges the current search wire shape without another request and keeps filters', async t => {
  const rows = [compactPart(), compactPart({ ref: 'core/bench@1', usedIn: undefined })];
  const { calls } = await buildFixture(t, c => c.path.startsWith('/v1/god/defs?') ? { defs: rows } : null);
  const text = await COMMANDS.find(['stone', 'support'], { category: 'prop', has: ['slot:sit', 'comp:light'], tag: 'gothic' });
  assert.match(text, /gothic-buttress@1.*A stepped stone support.*used in: black-church \(done; 10 standing\)/);
  assert.doesNotMatch(text.split('\n')[2], /used in/);
  assert.equal(calls.length, 1);
  const q = new URL(calls[0].path, 'http://127.0.0.1').searchParams;
  assert.equal(q.get('q'), 'stone support');
  assert.equal(q.get('compact'), '1');
  assert.equal(q.get('limit'), '25');
  assert.equal(q.get('category'), 'prop');
  assert.deepEqual(q.getAll('has'), ['slot:sit', 'comp:light']);
  assert.equal(q.get('tag'), 'gothic');
  assert.deepEqual(await COMMANDS.find(['stone'], { json: true, all: true }), JSON.parse(JSON.stringify(rows)));
  assert.equal(new URL(calls[1].path, 'http://127.0.0.1').searchParams.get('limit'), '500');
});

test('find shows supplied titles/dates, supports the used alias and preserves miss hints', async t => {
  let defs = [compactPart({ usedIn: [{ build: 'black-church', title: 'Black Gothic church', doneAt: Date.UTC(2026, 9, 15) }] }), compactPart({ ref: 'spire@1', usedIn: undefined, used: [{ build: 'chapel', placedNow: 0 }] })];
  const { calls } = await buildFixture(t, c => c.path.startsWith('/v1/god/defs?') ? { defs, hint: 'define it here' } : null);
  const text = await COMMANDS.find(['gothic']);
  assert.match(text, /used in: Black Gothic church \(done Oct 15\)/);
  assert.match(text, /used in: chapel \(done; 0 standing\)/);
  defs = [];
  assert.match(await COMMANDS.find(['spire']), /nothing matches "spire"\. define it here.*recommend/);
  assert.doesNotMatch(await COMMANDS.find(['spire']), /ready def/);
  // r2.1 walk: a registry world without core/twinkle-lights@1 answered `find twinkle` with nothing; it now names the served def
  assert.match(await COMMANDS.find(['twinkle']), /nothing matches "twinkle".*\nready def for "twinkle" in every world: curl -s \S+\/god\/examples\/light-motion\.mjs -o light-motion\.mjs && node light-motion\.mjs twinkle > twinkle\.def\.json && node eden-god\.mjs define twinkle\.def\.json$/s);
  await assert.rejects(COMMANDS.find(), /find <words>/);
  assert.equal(calls.length, 4, 'invalid empty searches stay local');
});

test('defs lists keep usedIn evidence in human and JSON output', async t => {
  const row = keptDef();
  const { calls } = await buildFixture(t, c => c.path.startsWith('/v1/god/defs?') ? { defs: [row] } : null);
  assert.match(await COMMANDS.defs(['gothic', 'supports']), /used in: black-church \(done; 10 standing\)/);
  const json = await COMMANDS.defs(['gothic', 'supports'], { json: true });
  assert.deepEqual(json[0].usedIn, row.usedIn);
  assert.equal(calls.length, 2);
});

test('defs exact details show the search badge and old server rows still work', async t => {
  let row = keptDef({ usedIn: [{ build: 'black-church', title: 'Black Gothic church', doneAt: Date.UTC(2026, 9, 15) }] });
  const { calls } = await buildFixture(t, c => c.path.startsWith('/v1/god/defs?') ? { defs: [row] } : c.path === '/v1/god/query' ? { bake: { rooms: [], slots: [] } } : null);
  assert.match(await COMMANDS.defs(['gothic-buttress']), /used in: Black Gothic church \(done Oct 15\)/);
  assert.deepEqual(await COMMANDS.defs(['gothic-buttress'], { json: true }), row);
  row = keptDef({ usedIn: undefined });
  assert.doesNotMatch(await COMMANDS.defs(['gothic', 'supports']), /used in/);
  assert.equal(calls.filter(c => c.path.startsWith('/v1/god/defs?')).length, 3);
});

test('define-kit prints kept matches and pinned hints before its commit, searching name and tags', async t => {
  const notices = [];
  t.mock.method(console, 'error', text => notices.push(text));
  const { calls } = await buildFixture(t, c => {
    if (c.path.startsWith('/v1/god/defs?')) return { defs: [keptDef({ ref: 'unused@1', usedIn: undefined }), keptDef()] };
    if (c.path === '/v1/god/act') {
      assert.equal(notices.length, 1, 'the owner sees the match before the server receives a define');
      assert.match(notices[0], /gothic-buttress@1.*used in: black-church.*place sha:a{64} --at ….*unused@1/);
    }
  });
  const output = await COMMANDS['define-kit']([JSON.stringify({ name: 'new-buttress', tags: ['gothic', 'stone'], shapes: [{ kind: 'box', at: [0, 1, 0], size: [1, 2, 1] }] })]);
  assert.match(output, /^defined new-buttress@1/);
  assert.doesNotMatch(output, /similar defs/);
  assert.equal(notices[0].split('\n').length, 1);
  assert.equal(new URL(calls[0].path, 'http://127.0.0.1').searchParams.get('q'), 'new buttress gothic stone');
  assert.equal(calls.length, 3, 'one search plus the existing schema lookup and define');
  assert.equal(calls[1].path, '/v1/god/schema');
  assert.equal(calls[2].body.ops[0].op, 'define');
});

test('define-kit dry runs return similarities without printing or writing; no-match writes stay quiet', async t => {
  const notices = [];
  t.mock.method(console, 'error', text => notices.push(text));
  let matches = [keptDef()];
  const { calls } = await buildFixture(t, c => c.path.startsWith('/v1/god/defs?') ? { defs: matches } : null);
  const kit = JSON.stringify({ name: 'stone-support', shapes: [{ kind: 'box', at: [0, 1, 0], size: [1, 2, 1] }] });
  const dry = await COMMANDS['define-kit']([kit], { dry: true, json: true });
  assert.deepEqual(dry.similar, ['gothic-buttress@1']);
  assert.equal(dry.def.name, 'stone-support');
  assert.equal(calls.length, 1);
  assert.deepEqual(notices, []);
  matches = [];
  assert.match(await COMMANDS['define-kit']([kit]), /^defined stone-support@1/);
  assert.deepEqual(notices, []);
  assert.equal(calls.length, 4, 'dry search, normal search, schema, define');
});

test('define-kit carries an explicit kit contract separately from the definition version', async t => {
  await buildFixture(t, c => c.path.startsWith('/v1/god/defs?') ? { defs: [] } : null);
  const kit = { name: 'slit-dome', version: 7, shapes: [{ kind: 'lathe', at: [0, 0, 0], profile: [[2, 0], [0, 2]], arc: 5.8 }] };
  const legacy = await COMMANDS['define-kit']([JSON.stringify(kit)], { dry: true });
  assert.equal(Object.hasOwn(legacy.def.make.args, 'v'), false);
  const next = await COMMANDS['define-kit']([JSON.stringify({ ...kit, v: 2 })], { dry: true });
  assert.equal(next.def.make.args.v, 2); assert.equal(next.def.version, 7);
  assert.equal(next.def.make.args.shapes[0].arc, 5.8);
});

test('define-kit preserves optional open and inline footprints in dry and committed definitions', async t => {
  const { calls } = await buildFixture(t, c => c.path.startsWith('/v1/god/defs?') ? { defs: [] } : null);
  const kit = { name: 'walkable-gazebo', shapes: [{ kind: 'box', at: [0, 3, 0], size: [6, 0.2, 6] }] };
  for (const footprint of ['open', { schema: 'lm-building-footprint/1', rooms: [] }]) {
    const dry = await COMMANDS['define-kit']([JSON.stringify({ ...kit, footprint })], { dry: true });
    assert.deepEqual(dry.def.make.args.footprint, footprint);
    await COMMANDS['define-kit']([JSON.stringify({ ...kit, footprint })]);
    assert.deepEqual(calls.filter(c => c.path === '/v1/god/act').at(-1).body.ops[0].def.make.args.footprint, footprint);
  }
  const dry = await COMMANDS['define-kit']([JSON.stringify(kit)], { dry: true });
  assert.equal(Object.hasOwn(dry.def.make.args, 'footprint'), false);
});

test('build done and show report the server reuse summary without another request', async t => {
  const reuse = { newDefs: 3, placedFromParts: 2, fromBuilds: ['chapel'], kept: ['gothic-buttress@1'], recorded: false, code: 'parts.cap' };
  const { calls } = await buildFixture(t, c => c.path.startsWith('/v1/god/builds/church') ? { ok: true, build: serverBuild({ status: 'done', reuse }), reuse } : null);
  save({ build: { id: 'church', lease: 'l_1234abcd', n: 5, label: 'furnish', steps } });
  const done = await build('done');
  assert.match(done, /reuse: 3 new defs, 2 placed from parts; kept as parts: gothic-buttress@1; not fully recorded \(parts.cap\)/);
  assert.equal(load().build, undefined);
  assert.match(await build('show', ['church']), /reuse: 3 new defs, 2 placed from parts/);
  assert.equal(calls.length, 2);
});

test('help defines mass h as wall/eave height and explains pitched and flat roof totals', () => {
  const help = COMMANDS.help();
  assert.match(help, /h = wall\/eave height, not total height/);
  assert.match(help, /Gable\/pyramid roofs add half the shorter side; flat adds none/);
  assert.match(help, /26x12 h15 gable = 15 m walls \+ 6 m roof = 21 m total/);
});

test('build start echoes every mass footprint, wall height and total including its roof', async t => {
  const { calls } = await buildFixture(t);
  const mass = 'nave 1,0 26x12 h15 gable; north-tower -11,-8 4x4 h28 pyramid; terrace 0,10 8x4 h2 flat; 0,12 3x1.5 h.5; canopy 0,-11 2.5x1.5 h1.25 gable';
  const text = await build('start', ['black-church'], { ...startFlags(), size: '40,30', mass });
  assert.match(text, /site \(0, 0\) 40×30 m, yaw 0/);
  assert.match(text, /steps: 1 shell; 2 roof and tower; 3 openings; 4 interior; 5 furnish/);
  for (const summary of [
    'nave 26×12 m, walls 15 m + gable roof ≈ 21 m total',
    'north-tower 4×4 m, walls 28 m + pyramid roof ≈ 30 m total',
    'terrace 8×4 m, walls 2 m + flat roof ≈ 2 m total',
    '4 3×1.5 m, walls 0.5 m + flat roof ≈ 0.5 m total',
    'canopy 2.5×1.5 m, walls 1.25 m + gable roof ≈ 2 m total',
  ]) assert.ok(text.includes(summary), summary);
  assert.match(text, /every edit now carries build black-church, step 1\/5 shell$/);
  assert.doesNotMatch(text, /no committed batches|inspect|finish it first|IN PROGRESS|roots:|claims:|next:|first:|local:|\d parts/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.massing, parseMassing(mass), 'reporting never changes submitted wall heights');
});

test('start without masses reports only the created site and plan; resume retains recovery guidance', async t => {
  const { calls } = await buildFixture(t);
  const text = await build('start', ['church'], { ...startFlags(), mass: undefined });
  assert.match(text, /^church: Black stone church \(active\); site/);
  assert.match(text, /massing: none/);
  assert.equal(text.split('\n').length, 4);
  assert.doesNotMatch(text, /no committed batches|inspect|finish it first|roots:|claims:|next:|local:/);
  const resumed = await build('resume', ['church']);
  assert.match(resumed, /step 1\/5 shell: no committed batches reported; inspect and finish it first/);
  assert.match(resumed, /massing: nave 0 parts/);
  assert.equal(calls.length, 2);
});

test('build start sends one request with massing; step makes none; next act injects current progress', async t => {
  const { calls } = await buildFixture(t);
  const flags = startFlags(), parsed = parseFlags(['start', 'church', '--steps', 'a,b']);
  checkArgs('build', parsed.flags, parsed.rest);
  assert.match(await COMMANDS.build(['start', 'church'], flags), /every edit now carries build church, step 1\/5 shell/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.massing[1], { name: 'tower', at: [-13, 0], size: [6, 6], h: 30, roof: 'pyramid' });
  assert.deepEqual(load().build, { ...localBuild(), status: 'active' });
  await act({ ops: [{ op: 'remove', id: 'wall' }] });
  assert.deepEqual(calls[1].body.build, { id: 'church', lease: 'l_1234abcd', step: 1, label: 'shell' });
  assert.equal(calls[1].body.group, undefined);
  const count = calls.length;
  assert.match(await COMMANDS.build(['step']), /step 2\/5: roof and tower/);
  assert.equal(calls.length, count);
  await act({ ops: [{ op: 'remove', id: 'roof' }], group: 'roof' });
  assert.equal(calls.at(-1).body.build.step, 2);
  assert.equal(calls.at(-1).body.group, 'roof');
});

test('build start resolves named sites and offsets in world metres, and reads brief files', async t => {
  const { calls, snapshot } = await buildFixture(t, c => c.path === '/v1/god/query' ? { layout: { entities: [{ id: 'flag1', name: 'knoll', path: 'knoll', parent: 'world', pose: [20, 0, 30, 0, 1], def: 'core/flag@1' }] } } : null);
  snapshot.entities = [{ id: 'flag1', state: { label: 'knoll' } }];
  writeFileSync('brief.txt', 'A public nave and tower');
  await build('start', ['church'], { ...startFlags(), at: 'flag:knoll', offset: '2,-3', yaw: '1.5707963267948966', brief: 'brief.txt', root: 'old-chapel' });
  const req = calls.find(c => c.path === '/v1/god/builds');
  assert.deepEqual(req.body.site, { at: [22, 27], size: [40, 16], yaw: Math.PI / 2 });
  assert.equal(req.body.brief, 'A public nave and tower'); assert.equal(req.body.root, 'old-chapel');
});

test('preview and dryrun carry build; sealed preview commit sends only preview/clientRef', async t => {
  const { calls } = await buildFixture(t); save({ build: localBuild(), group: 'church/roof' });
  await preview({ ops: [{ op: 'remove', id: 'roof' }] });
  await dryrun({ ops: [{ op: 'remove', id: 'roof' }] });
  await commit('sealed-preview');
  for (const c of calls.slice(0, 2)) { assert.equal(c.body.build.id, 'church'); assert.equal(c.body.group, 'church/roof'); }
  assert.deepEqual(Object.keys(calls[2].body).sort(), ['clientRef', 'preview']);
  assert.equal(calls[2].body.preview, 'sealed-preview');
});

test('direct layers acts inherit build/group and add the short progress suffix', async t => {
  const { calls } = await buildFixture(t); save({ build: localBuild(), group: 'church/interior' });
  const text = await COMMANDS.access(['pew', 'public'], {});
  assert.match(text, / \[church 1\/5 shell\]$/);
  assert.equal(calls.length, 1); assert.equal(calls[0].body.build.id, 'church');
  assert.equal(calls[0].body.group, 'church/interior');
  const suffix = buildSuffix(echo({ build: { id: 'church', step: 3, label: 'roof' } }), localBuild());
  assert.equal(Buffer.byteLength(' ' + suffix), 18);
});

test('accepted edit suffix preserves black-church and ellipsizes ids only beyond 24 characters', async t => {
  const { calls } = await buildFixture(t);
  save({ build: { ...localBuild(), id: 'black-church' } });
  assert.match(await COMMANDS.access(['pew', 'public'], {}), / \[black-church 1\/5 shell\]$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.build.id, 'black-church');
  for (const length of [8, 12, 23, 24, 25, 40]) {
    const id = 'a'.repeat(length), printed = length > 24 ? 'a'.repeat(21) + '...' : id;
    assert.equal(buildSuffix({ id, step: { n: 3, label: 'roof' } }, { id, steps }), `[${printed} 3/5 roof]`);
  }
  const id = 'a'.repeat(40), suffix = buildSuffix({ id, step: { n: 999, label: 'b'.repeat(60) } }, { id, steps: Array(24) });
  assert.equal(suffix, `[${'a'.repeat(21)}... 999/24 ${'b'.repeat(9)}...]`);
  assert.equal(Buffer.byteLength(' ' + suffix), 47);
});

test('world/answer-only batches, imports, env/land/strike and --no-build skip injection', async t => {
  const { calls } = await buildFixture(t); save({ build: localBuild(), group: 'church/subgroup' });
  await act({ ops: [{ op: 'world', state: { sky: {} } }, { op: 'answer', prayer: 'p', text: 'yes' }] });
  await answer('p', 'yes');
  await COMMANDS.sky([], { palette: 'clear-day' });
  for (const p of ['env', 'land', 'strike']) await call('/v1/god/' + p, { body: { value: 1 } });
  await COMMANDS.act(['{"ops":[{"op":"remove","id":"wall"}]}'], { 'no-build': true });
  writeFileSync('world.json', JSON.stringify({ schema: 'genesis/1', batches: [{ ops: [{ op: 'remove', id: 'wall' }] }] }));
  await importWorld('world.json');
  for (const c of calls) assert.equal(c.body?.build, undefined, c.path);
  assert.equal(calls.at(-1).body.group, 'import');
  assert.deepEqual(load().build, localBuild());
  await act({ ops: [{ op: 'remove', id: 'wall' }] });
  assert.equal(calls.at(-1).body.build.id, 'church', 'the bypass does not leak to the next command');
});

test('missing build echo warns once across commands and refused acts never imply completion', async t => {
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/act' ? { accepted: true, seq: 1 } : null);
  save({ build: localBuild() });
  const warn = console.error, warnings = []; console.error = s => warnings.push(s); t.after(() => { console.error = warn; });
  await act({ ops: [{ op: 'remove', id: 'x' }] });
  await act({ ops: [{ op: 'remove', id: 'y' }] });
  assert.deepEqual(warnings, ['this server does not record builds; progress is not shown']);
  assert.equal(calls.length, 2); assert.equal(load().buildEchoWarned, true);
});

test('lease refusal carries server identity/time and a concrete resume command', async t => {
  await buildFixture(t, c => c.path === '/v1/god/act' ? { accepted: false, failures: [{ op: 0, code: 'build.lease', detail: 'church was resumed by Ada at 2026-10-15T12:00:00Z' }] } : null);
  save({ build: localBuild() });
  const result = await COMMANDS.set(['wall'], { name: 'north-wall' });
  assert.match(result, /resumed by Ada at 2026-10-15T12:00:00Z/);
  assert.match(result, /build resume church.*before editing/);
  assert.equal(load().build.id, 'church');
});

test('group --off clears only the subgroup; pause keeps state; done clears build and group', async t => {
  const { calls } = await buildFixture(t); save({ build: localBuild() });
  await group('roof'); assert.equal(load().group, 'church/roof');
  await group(undefined, { off: true }); assert.equal(load().group, undefined); assert.equal(load().build.id, 'church');
  await build('pause', ['waiting for review']);
  assert.deepEqual(calls.at(-1).body, { lease: 'l_1234abcd', note: 'waiting for review' });
  assert.equal(load().build.id, 'church');
  await group('finish'); await build('done', ['nave, tower, pews'], { force: true });
  assert.deepEqual(calls.at(-1).body, { summary: 'nave, tower, pews', force: true });
  assert.equal(load().build, undefined); assert.equal(load().group, undefined);
});

test('abandon clears state only after success and reports partial undo on refusal', async t => {
  let refuse = true;
  const { calls } = await buildFixture(t, c => c.path.endsWith('/abandon') && refuse ? { ok: false, failures: [{ op: 0, code: 'build.undo-incomplete', detail: 'edit 9 conflicts' }], reverted: [10], notReverted: [9] } : null);
  save({ build: localBuild(), group: 'church/roof' });
  const result = await build('abandon', [], { undo: true, force: true });
  assert.match(result, /undone edits: 10; not undone edits: 9/);
  assert.equal(load().build.id, 'church'); assert.equal(load().group, 'church/roof');
  assert.deepEqual(calls.at(-1).body, { undo: true, force: true });
  refuse = false; await build('abandon', [], { undo: true });
  assert.equal(load().build, undefined); assert.equal(load().group, undefined);
});

test('Y5: build rewind previews with --dry, prints removed parts and keeps local progress at the rewound step', async t => {
  const rewind = { to: 1, from: 3, edits: [12, 11, 10], steps: [{ n: 2, label: 'roof and tower' }, { n: 3, label: 'openings', part: 'east' }], removes: { count: 18, names: ['nave', 'tower'], more: 2 }, restores: { count: 0, names: [] }, changes: { count: 1, names: ['oak'] } };
  const { calls } = await buildFixture(t, c => c.path.endsWith('/rewind') ? { ok: true, ...(c.body.dry ? { dry: true } : {}), build: serverBuild({ step: { n: 1, label: 'shell' } }), rewind } : null);
  save({ build: { ...localBuild(), n: 3, label: 'openings' }, group: 'church/roof' });
  const dry = await build('rewind', [], { to: '1', dry: true });
  assert.equal(calls.at(-1).path, '/v1/god/builds/church/rewind'); assert.deepEqual(calls.at(-1).body, { to: 1, dry: true });
  assert.match(dry, /rewind to step 1 — dry run, nothing changed/); assert.match(dry, /would remove 18 parts \(nave, tower \+2 more\)/); assert.match(dry, /apply: build rewind church --to 1/);
  assert.equal(load().build.n, 3, 'a dry run never moves local progress');
  const out = await build('rewind', ['church'], { to: '1', force: true });
  assert.deepEqual(calls.at(-1).body, { to: 1, force: true });
  assert.match(out, /church: rewound to step 1; now at step 1\/5 shell, still open, closure re-armed/);
  assert.match(out, /removes 18 parts \(nave, tower \+2 more\); reverts 1 change \(oak\)/);
  assert.match(out, /3 edits undone \(10, 11, 12\); steps: 2 roof and tower, 3 openings \(east\)/);
  assert.deepEqual([load().build.n, load().build.label, load().build.lease], [1, 'shell', 'l_1234abcd']); assert.equal(load().group, 'church/roof');
  assert.deepEqual((await build('rewind', [], { to: '1', json: true })).rewind, rewind);
});

test('Y5: build rewind validates --to, refuses claim holders and prints dependency refusals with their fix', async t => {
  const failure = { op: -1, code: 'build.depends', field: 'to', entity: 'e_tower', detail: 'edit 14 (ungrouped) changed tower after edit 11 (step 3); rewinding to step 2 would remove it.', fix: 'Rewind to step 3 or later, or undo edit 14 first (`undo` while it is the newest edit), then retry.' };
  const { calls } = await buildFixture(t, c => c.path.endsWith('/rewind') ? { ok: false, failures: [failure], edits: [12, 11] } : null);
  save({ build: localBuild() });
  checkArgs('build', { to: '2', dry: true, force: true }, ['rewind', 'church']);
  assert.match(readFileSync(new URL('./SKILL.md', import.meta.url), 'utf8'), /`build rewind \[id\] --to k \[--dry\]`/);
  for (const to of [undefined, true, '-1', 'two', '1000']) await assert.rejects(build('rewind', [], to === undefined ? {} : { to }), /--to <step>/);
  await assert.rejects(build('rewind', [], { to: '1', undo: true }), /no option --undo/);
  const before = calls.length, refused = await build('rewind', [], { to: '2' });
  assert.equal(calls.length, before + 1); assert.match(refused, /^REFUSED: .*build\.depends/); assert.match(refused, /field to/); assert.match(refused, /Rewind to step 3 or later/); assert.match(refused, /nothing was undone \(2 edit\(s\) checked\)/);
  assert.equal(load().build.n, 1);
  save({ build: { ...localBuild(), claim: 'c_1234abcd', part: 'east' } });
  await assert.rejects(build('rewind', [], { to: '1' }), /claim holders cannot build rewind/);
});

test('Y5: undo --group of the whole open build follows the server back to its first step', async t => {
  const calls = fixture(t, { accepted: true, reverted: [12, 11], notReverted: [], rewound: { to: 0, edits: [12, 11], step: { n: 1, label: 'shell' } } });
  save({ build: { ...localBuild(), n: 4, label: 'interior' } });
  assert.equal(await undo({ group: 'church' }), 'undid group "church": edits 12, 11; build church stays open at step 1 (rewound to the start; closure re-armed)');
  assert.equal(String(calls.at(-1).url).endsWith('/v1/god/undo?group=church'), true); assert.deepEqual([load().build.n, load().build.label], [1, 'shell']);
});

test('resume reconstructs local progress from server and prints unfinished step, roots, claims, masses and next', async t => {
  const current = { n: 3, label: 'openings', batches: 2, firstSeq: 40, lastSeq: 41, recent: [{ seq: 41, note: 'north door' }] };
  const b = serverBuild({ step: { n: 3, label: 'openings' }, current, roots: [{ id: 'e_church', path: 'church' }], claims: [{ id: 'c_11111111', part: 'tower', status: 'held' }], massing: [{ name: 'nave', parts: 7 }], next: { n: 4, label: 'interior' } });
  const { calls } = await buildFixture(t, c => c.path.endsWith('/resume') ? { ok: true, build: b, lease: 'l_99999999', current, next: b.next, massing: b.massing } : null);
  save({ build: localBuild(), group: 'stale-group' });
  const text = await build('resume', ['church'], { take: true });
  assert.deepEqual(calls[0].body, { lease: 'l_1234abcd', take: true }); assert.equal(calls.length, 1);
  assert.equal(load().build.n, 3); assert.equal(load().build.lease, 'l_99999999'); assert.equal(load().group, undefined);
  for (const pattern of [/3\/5 openings IN PROGRESS/, /2 batches, last seq 41/, /41: north door/, /nave 7 parts/, /c_11111111 tower/, /next: 4\/5 interior/, /first: describe church/]) assert.match(text, pattern);
  await build('step'); assert.equal(calls.length, 1); assert.equal(load().build.n, 4);
});

for (const status of ['paused', 'active']) test(`resume without an id restores the only ${status} build with a dead lead`, async t => {
  const current = { n: 2, label: 'roof and tower', batches: 1, lastSeq: 8, recent: [] };
  const b = serverBuild({ status, lead: { label: 'Ada', live: false }, step: current, current });
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/builds' ? { open: [b], recent: [] } : c.path.endsWith('/resume') ? { ok: true, build: { ...b, status: 'active' }, lease: 'l_99999999' } : null);
  save({ build: status === 'paused' ? localBuild() : { ...localBuild(), id: 'stale-local-build' }, group: 'old-group' });
  const output = await COMMANDS.build(['resume'], status === 'active' ? { take: true } : {});
  assert.deepEqual(calls.map(c => [c.method, c.path]), [['GET', '/v1/god/builds'], ['POST', '/v1/god/builds/church/resume']]);
  assert.deepEqual(calls[1].body, status === 'paused' ? { lease: 'l_1234abcd' } : { take: true });
  assert.deepEqual(load().build, { id: 'church', lease: 'l_99999999', n: 2, label: 'roof and tower', steps, status: 'active' });
  assert.equal(load().group, undefined);
  assert.match(output, /step 2\/5 roof and tower IN PROGRESS/);
});

test('resume without an id lists every open build and asks for one when several are open', async t => {
  const open = [serverBuild({ status: 'paused', step: { n: 2, label: 'roof and tower' } }), serverBuild({ id: 'market', title: 'Market hall', lead: { live: true }, step: { n: 3, label: 'openings' } })];
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/builds' ? { open, recent: [] } : null);
  save({ build: localBuild(), group: 'church/roof' });
  const before = readFileSync('.eden-god.json', 'utf8');
  const output = await build('resume');
  assert.match(output, /several open builds; specify one to resume/);
  assert.match(output, /church: Black stone church \(paused\); step 2\/5 roof and tower/);
  assert.match(output, /market: Market hall \(active\); step 3\/5 openings/);
  assert.match(output, /choose an id: build resume <id>/);
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET');
  assert.equal(readFileSync('.eden-god.json', 'utf8'), before);
});

test('resume without an id reports no open builds and never resumes a recent closed build', async t => {
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/builds' ? { open: [], recent: [serverBuild({ status: 'done' })] } : null);
  const output = await build('resume');
  assert.match(output, /no open builds; build start <id>/);
  assert.doesNotMatch(output, /church/);
  assert.equal(calls.length, 1); assert.equal(load().build, undefined);
});

test('resume without an id preserves a live or unknown lead and requires an explicit id', async t => {
  let lead = { label: 'Ada', live: true };
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/builds' ? { open: [serverBuild({ lead })], recent: [] } : null);
  for (const next of [lead, undefined]) {
    lead = next;
    const output = await build('resume', [], { take: true });
    assert.match(output, /specify its id to resume/);
    assert.match(output, /church: Black stone church \(active\); step 1\/5 shell/);
    assert.match(output, /build resume <id>.*--take/);
  }
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.method === 'GET'));
  assert.equal(load().build, undefined);
});

for (const sub of ['resume', 'show']) for (const httpStatus of [200, 404]) test(`build ${sub} unknown id lists open builds after HTTP ${httpStatus}`, async t => {
  const open = [serverBuild({ status: 'paused', step: { n: 2, label: 'roof and tower' } }), serverBuild({ id: 'market', title: 'Market hall', step: { n: 3, label: 'openings' } })];
  const { calls } = await buildFixture(t, c => c.path.startsWith('/v1/god/builds/missing') ? { httpStatus, data: httpStatus === 404 ? { error: 'not-found' } : { ok: false, failures: [{ op: 0, code: 'build.unknown', detail: 'missing does not exist' }] } } : c.path === '/v1/god/builds' ? { open, recent: [serverBuild({ id: 'old', status: 'done' })] } : null);
  save({ build: localBuild(), group: 'church/roof' });
  const before = readFileSync('.eden-god.json', 'utf8');
  const output = await build(sub, ['missing']);
  assert.match(output, /unknown build: missing/);
  assert.match(output, /church: Black stone church \(paused\); step 2\/5 roof and tower/);
  assert.match(output, /market: Market hall \(active\); step 3\/5 openings/);
  assert.ok(output.includes(`choose an id: build ${sub} <id>`));
  assert.doesNotMatch(output, /old:|build\.unknown/);
  assert.deepEqual(calls.map(c => [c.method, c.path]), [[sub === 'resume' ? 'POST' : 'GET', `/v1/god/builds/missing${sub === 'resume' ? '/resume' : ''}`], ['GET', '/v1/god/builds']]);
  assert.equal(readFileSync('.eden-god.json', 'utf8'), before);
});

test('build listings include titles, status and steps while keeping recent history', async t => {
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/builds' ? { open: [serverBuild()], recent: [{ id: 'old', status: 'done' }] } : null);
  const output = await build();
  assert.match(output, /church: Black stone church \(active\); step 1\/5 shell/);
  assert.match(output, /old: done/);
  assert.equal(calls.length, 1);
});

test('build discovery preserves structured JSON for ambiguous and unknown ids', async t => {
  let open = [serverBuild(), serverBuild({ id: 'market', title: 'Market hall', status: 'paused' })];
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/builds' ? { now: 10, rev: 2, open, recent: [] } : c.path.startsWith('/v1/god/builds/missing') ? { httpStatus: 404, data: { error: 'not-found' } } : null);
  const choices = await build('resume', [], { json: true });
  assert.equal(choices.ok, false); assert.deepEqual(choices.open, open);
  assert.match(choices.message, /choose an id: build resume <id>/);
  assert.equal(load().build, undefined);
  open = [];
  const missing = await build('show', ['missing'], { json: true });
  assert.equal(missing.ok, false); assert.deepEqual(missing.open, []);
  assert.match(missing.message, /unknown build: missing\nno open builds/);
  assert.equal(calls.length, 3);
});

test('build discovery does not replace lease refusals or unrelated HTTP errors with a list', async t => {
  let reply;
  const { calls } = await buildFixture(t, () => reply);
  for (const code of ['build.leased', 'build.closed']) {
    reply = { ok: false, failures: [{ op: 0, code, detail: 'original refusal' }] };
    assert.match(await build('resume', ['church']), new RegExp(code.replace('.', '\\.')));
  }
  for (const httpStatus of [401, 500]) {
    reply = { httpStatus, data: { error: 'original error' } };
    await assert.rejects(build('show', ['church']), new RegExp(`HTTP ${httpStatus}`));
  }
  assert.equal(calls.length, 4); assert.ok(calls.every(c => c.path !== '/v1/god/builds'));
});

test('claim bootstrap, per-claim steps, local guards, group undo and release never rewrite lead state', async t => {
  const { calls } = await buildFixture(t); save({ build: localBuild(), group: 'church/lead' });
  const original = readFileSync('.eden-god.json', 'utf8');
  assert.match(await build('claim', ['east-aisle'], { root: 'church/east-aisle' }), /EDEN_GOD_CLAIM=c_1234abcd/);
  assert.deepEqual(calls.at(-1).body, { part: 'east-aisle', root: 'church/east-aisle' });
  assert.equal(readFileSync('.eden-god.json', 'utf8'), original);
  process.env.EDEN_GOD_CLAIM = 'c_1234abcd';
  await build('step', ['pews']);
  const count = calls.length;
  await assert.rejects(build('resume', ['church']), /take the lead lease/);
  await assert.rejects(build('resume'), /take the lead lease/);
  await assert.rejects(undo(), /undo --group church\/east-aisle/);
  assert.equal(calls.length, count);
  await act({ ops: [{ op: 'remove', id: 'pew' }] });
  assert.deepEqual(calls.at(-1).body.build, { id: 'church', claim: 'c_1234abcd', step: 2, label: 'pews' });
  await undo({ group: 'church/east-aisle' }); assert.equal(calls.at(-1).body.build.claim, 'c_1234abcd');
  await build('release', [], { done: true }); assert.deepEqual(calls.at(-1).body, { done: true });
  assert.equal(load().build, null);
  assert.equal(readFileSync('.eden-god.json', 'utf8'), original);
  assert.equal(JSON.parse(readFileSync(claimFile('c_1234abcd'), 'utf8')).build, null);
});

test('WD7 build claim --helper writes a 0600 helper file, prints only its env line, and the helper uses only its own token', async t => {
  const secret = 'god_stub_helper-scoped-fixture', previous = process.env.EDEN_GOD_HELPER;
  t.after(() => { if (previous === undefined) delete process.env.EDEN_GOD_HELPER; else process.env.EDEN_GOD_HELPER = previous; });
  const helper = { label: 'lead/helper:east-aisle', hash8: 'abcd1234', build: 'church', claim: 'c_1234abcd', part: 'east-aisle', expiresAt: Date.UTC(2026, 9, 16, 2), verifyBudget: 3 };
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/builds/church/claims/c_1234abcd/helper' ? { ok: true, token: secret, helper } : null);
  save({ build: localBuild() }); const lead = readFileSync('.eden-god.json', 'utf8');
  await assert.rejects(build('claim', ['east-aisle'], { root: 'church/east-aisle', ttl: '30' }), /needs --helper/);
  await assert.rejects(build('claim', ['east-aisle'], { root: 'church/east-aisle', helper: 'yes' }), /takes no value/);
  assert.equal(calls.length, 0);
  const text = await build('claim', ['east-aisle'], { root: 'church/east-aisle', helper: true, ttl: '30' });
  const file = join(process.cwd(), helperFile('c_1234abcd'));
  assert.ok(text.includes(`export EDEN_GOD_HELPER=${file}`), text);
  for (const token of [secret, 'fixture-only']) assert.ok(!text.includes(token), 'no token is ever printed');
  assert.deepEqual(calls.map(c => [c.path, c.body]), [['/v1/god/builds/church/claims', { part: 'east-aisle', root: 'church/east-aisle' }], ['/v1/god/builds/church/claims/c_1234abcd/helper', { ttlMs: 1_800_000 }]]);
  assert.ok(calls.every(c => c.auth === 'Bearer fixture-only'), 'the lead mints with its own token');
  const saved = JSON.parse(readFileSync(file, 'utf8')); assert.equal(saved.token, secret); assert.equal(saved.world, load().world); assert.equal(saved.helper.claim, 'c_1234abcd'); assert.equal(saved.build.claim, 'c_1234abcd');
  assert.equal(statSync(file).mode & 0o777, 0o600); assert.equal(readFileSync('.eden-god.json', 'utf8'), lead);
  // The sub-agent: only EDEN_GOD_HELPER, never the lead's file credentials.
  process.env.EDEN_GOD_HELPER = file;
  assert.equal(load().token, secret); assert.equal(load().build.claim, 'c_1234abcd'); assert.equal(load().build.lease, undefined);
  await act({ ops: [{ op: 'remove', id: 'pew' }] });
  assert.equal(calls.at(-1).auth, `Bearer ${secret}`); assert.deepEqual(calls.at(-1).body.build, { id: 'church', claim: 'c_1234abcd', step: 1, label: 'shell' });
  const count = calls.length;
  await assert.rejects(build('start', ['chapel'], startFlags()), /claim holders cannot build start/);
  await assert.rejects(build('done'), /claim holders cannot build done/);
  await assert.rejects(undo(), /undo --group church\/east-aisle/);
  assert.equal(calls.length, count);
  await build('release', [], { done: true });
  assert.equal(calls.at(-1).path, '/v1/god/builds/church/claims/c_1234abcd/release'); assert.equal(calls.at(-1).auth, `Bearer ${secret}`);
  assert.equal(readFileSync('.eden-god.json', 'utf8'), lead);
  process.env.EDEN_GOD_CLAIM = 'c_99999999'; assert.throws(() => load(), /differs from the helper file/); delete process.env.EDEN_GOD_CLAIM;
  process.env.EDEN_GOD_HELPER = join(process.cwd(), 'missing.json'); assert.throws(() => load(), /missing file/);
});

test('claim overrides a local claim and independent subprocesses keep all twenty step updates', async t => {
  const { dir, calls } = await buildFixture(t); save({ build: localBuild() });
  const original = readFileSync('.eden-god.json', 'utf8'), moduleURL = new URL('./cli.mjs', import.meta.url).href;
  const run = cid => new Promise((resolve, reject) => {
    const source = `import {build} from ${JSON.stringify(moduleURL)}; for(let i=0;i<20;i++) await build('step');`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: dir, env: { ...process.env, EDEN_GOD_CLAIM: cid }, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; child.stderr.on('data', d => { err += d; }); child.on('error', reject); child.on('exit', code => code ? reject(new Error(err)) : resolve());
  });
  const ids = Array.from({ length: 8 }, (_, i) => `c_${i.toString(16).padStart(8, '0')}`);
  await Promise.all(ids.map(run));
  for (const cid of ids) { const s = JSON.parse(readFileSync(claimFile(cid), 'utf8')); assert.equal(s.build.n, 21); assert.equal(s.build.claim, cid); assert.equal(s.build.lease, undefined); }
  process.env.EDEN_GOD_CLAIM = ids[1]; save({ build: { ...load().build, claim: ids[0] } });
  // The environment is authoritative even if a stale local file names a different claim.
  assert.equal(load().build.claim, ids[1]);
  assert.equal(calls.length, 0); assert.equal(readFileSync('.eden-god.json', 'utf8'), original);
  assert.equal(readdirSync('.').filter(f => f.endsWith('.tmp')).length, 0);
  for (const file of ['.eden-god.json', ...ids.map(claimFile)]) assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('undo/redo bodies carry active progress, and accepted done echo clears state only when closed', async t => {
  let close = false;
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/act' ? { accepted: true, seq: 3, build: echo(c.body, { status: close ? 'done' : 'active' }) } : null);
  save({ build: localBuild(), group: 'church/roof' });
  await undo({ group: 'church/roof' }); await COMMANDS.redo();
  for (const c of calls) assert.equal(c.body.build.lease, 'l_1234abcd');
  await act({ ops: [{ op: 'remove', id: 'old' }], build: { id: 'church', lease: 'l_1234abcd', done: true } });
  assert.equal(load().build.id, 'church', 'other live claims may keep a done:true build open');
  close = true; await act({ ops: [{ op: 'remove', id: 'old' }], build: { id: 'church', lease: 'l_1234abcd', done: true } });
  assert.equal(load().build, undefined); assert.equal(load().group, undefined);
});

test('429 waits and resends identical bytes including clientRef/build; ordinary refusals are single requests', async t => {
  const { calls } = await buildFixture(t, (c, all) => c.path === '/v1/god/act' && all.length === 1 ? { httpStatus: 429, data: { retryAfterMs: 2 } } : null);
  save({ build: localBuild() });
  await act({ ops: [{ op: 'remove', id: 'roof' }] });
  assert.equal(calls.length, 2); assert.equal(calls[0].raw, calls[1].raw);
  assert.ok(calls[0].body.clientRef); assert.equal(calls[0].body.build.step, 1);
});

test('status/map headers use server build status; mirror refreshes on builds rev without an edit seq change', async t => {
  let rev = 1;
  const { calls, snapshot } = await buildFixture(t, c => c.path === '/v1/world/seq' ? { seq: 1, builds: rev } : null);
  save({ build: { ...localBuild(), n: 3, label: 'roof' } });
  assert.match(await status(), /build church 3\/5 roof \(paused, lead: you\)/);
  assert.match(await COMMANDS.map(), /build church 3\/5 roof \(active, lead: you\)/);
  const count = calls.filter(c => c.path === '/v1/god/snapshot').length;
  rev = 2; snapshot.buildsRev = 2; snapshot.builds[0].status = 'paused';
  assert.match(await COMMANDS.map(), /build church 3\/5 roof \(paused, lead: you\)/);
  assert.equal(calls.filter(c => c.path === '/v1/god/snapshot').length, count + 1);
  assert.equal(statSync('.eden-god.cache.json').mode & 0o777, 0o600);
  assert.equal(readdirSync('.').filter(f => f.endsWith('.tmp')).length, 0);
});

test('invalid build options/masses refuse locally before any HTTP request', async t => {
  const { calls } = await buildFixture(t);
  for (const f of [{ steps: true }, { steps: 'a,,b' }, { size: ',3' }, { at: '1,no' }, { offset: '1,no' }, { title: true }, { mass: 'nave 0,0 0x10 h12' }, { mass: 'nave 0,0 10x10 h121' }, { mass: 'nave 0,0 10x10 h12 tent' }, { mass: true }, { steps: ['a', 'b'] }]) await assert.rejects(build('start', ['church'], { ...startFlags(), ...f }));
  assert.throws(() => parseMassing(Array(9).fill('0,0 1x1 h1').join(';')), /at most 8/);
  assert.throws(() => checkArgs('build', { plan: true }, ['start', 'church']), /no option --plan/);
  save({ build: localBuild() });
  await assert.rejects(build('step', [], { mass: 'ignored' }), /needs --say/);
  await assert.rejects(build('resume', ['church'], { take: 'c_11111111' }), /takes no value/);
  assert.equal(calls.length, 0);
});

test('claim replay preserves pending local steps, subgroup and warning state', async t => {
  const { calls } = await buildFixture(t); save({ build: localBuild() });
  await build('claim', ['east-aisle'], { root: 'church/east-aisle' });
  process.env.EDEN_GOD_CLAIM = 'c_1234abcd';
  await build('step', ['finish south pews']); await group('pews'); save({ buildEchoWarned: true });
  const before = readFileSync(claimFile('c_1234abcd'), 'utf8');
  delete process.env.EDEN_GOD_CLAIM;
  await build('claim', ['east-aisle'], { root: 'church/east-aisle' });
  assert.equal(readFileSync(claimFile('c_1234abcd'), 'utf8'), before);
  assert.equal(calls.length, 2);
});

test('a sealed preview with claim done:true clears only that claim without adding commit metadata', async t => {
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/preview' ? { accepted: true, id: 'pv-claim-done' } : c.path === '/v1/god/act' ? { accepted: true, seq: 5, build: echo(c.body, { claim: 'c_1234abcd' }) } : null);
  save({ build: localBuild() }); const lead = readFileSync('.eden-god.json', 'utf8');
  process.env.EDEN_GOD_CLAIM = 'c_1234abcd';
  await preview({ ops: [{ op: 'remove', id: 'old-pew' }], build: { id: 'church', claim: 'c_1234abcd', step: 1, done: true } });
  assert.ok(load().buildPreviews['pv-claim-done']);
  await commit('pv-claim-done');
  assert.deepEqual(Object.keys(calls.at(-1).body).sort(), ['clientRef', 'preview']);
  assert.equal(load().build, null); assert.equal(load().buildPreviews, undefined);
  assert.equal(readFileSync('.eden-god.json', 'utf8'), lead);
});

test('explicit completion of a different claim does not clear this process claim', async t => {
  await buildFixture(t); save({ build: localBuild() }); process.env.EDEN_GOD_CLAIM = 'c_1234abcd';
  await act({ ops: [{ op: 'remove', id: 'old-pew' }], build: { id: 'church', claim: 'c_22222222', done: true } });
  assert.equal(load().build.claim, 'c_1234abcd');
});

test('furnish keeps the explicit subgroup for server mapping and carries build progress', async t => {
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/query' && c.body.layout ? { layout: { entities: [{ id: 'e_church', name: 'church', path: 'church', parent: 'world', pose: [0, 0, 0, 0, 1] }] } } : null);
  save({ build: localBuild() });
  const text = await COMMANDS.furnish(['church'], { style: 'chapel', group: 'interior' });
  assert.match(text, /\[church 1\/5 shell\]$/);
  assert.equal(calls.at(-1).body.group, 'interior'); assert.equal(calls.at(-1).body.build.id, 'church');
});

test('fractional/signed numeric site syntax is resolved locally without mirror requests', async t => {
  const { calls } = await buildFixture(t);
  await build('start', ['church'], { ...startFlags(), at: '.5,+1', offset: '-.25,+.5' });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].body.site.at, [0.25, 1.5]);
});

test('closed build show reports history without telling the operator to finish or advance it', async t => {
  await buildFixture(t, c => c.path === '/v1/god/builds/church' ? { ok: true, build: serverBuild({ status: 'done', current: { n: 5, label: 'furnish', batches: 1, lastSeq: 9, recent: [] }, next: { n: 6, label: 'extra' } }) } : null);
  const text = await build('show', ['church']);
  assert.match(text, /church: Black stone church \(done\)/);
  assert.doesNotMatch(text, /IN PROGRESS|finish it first|next:/);
});

test('accepted remote edits never enter transport recovery when local state finalization fails', async t => {
  const { calls } = await buildFixture(t, c => {
    if (c.path === '/v1/god/act') { writeFileSync('.eden-god.json', '{malformed'); return { accepted: true, seq: 9, build: echo(c.body) }; }
  });
  save({ build: localBuild() });
  await assert.rejects(act({ ops: [{ op: 'remove', id: 'old' }] }), SyntaxError);
  assert.equal(calls.length, 1);
});

test('downloadable bundle runs the build lifecycle and global bypass against only the local stub', async t => {
  let open = [serverBuild({ status: 'paused', lead: { live: false } })];
  const { calls, dir } = await buildFixture(t, c => c.path === '/v1/god/builds' ? c.method === 'GET' ? { open, recent: [] } : startWithParts(c, [keptPart()]) : c.path.startsWith('/v1/god/parts?') ? { parts: [keptPart()] } : c.path.startsWith('/v1/god/defs?') ? { defs: [compactPart()] } : c.path.startsWith('/v1/god/builds/missing') ? { httpStatus: 404, data: { error: 'not-found' } } : null);
  const executable = new URL('./eden-god.mjs', import.meta.url).pathname;
  const cli = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, ...args], { cwd: dir, env: { ...process.env, EDEN_GOD_TRACE: '', EDEN_GOD_TIMING: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject); child.on('exit', code => code ? reject(new Error(stderr)) : resolve({ stdout, stderr }));
  });
  const start = await cli(['build', 'start', 'church', '--title', 'Church', '--steps', 'shell,roof,interior', '--at', '0,0', '--size', '40,16', '--mass', 'nave 0,0 22x10 h5 gable']);
  assert.match(start.stdout, /every edit now carries build church, step 1\/3 shell/);
  assert.match(start.stdout, /nave 22×10 m, walls 5 m \+ gable roof ≈ 10 m total/);
  assert.match(start.stdout, /parts from earlier builds you can reuse:\n.*place sha:a{64} --at …/);
  assert.doesNotMatch(start.stdout, /no committed batches|inspect|finish it first|IN PROGRESS|roots:|claims:|next:|local:/);
  assert.equal(calls.length, 1);
  await cli(['build', 'step']); assert.equal(calls.length, 1);
  const batch = '{"ops":[{"op":"remove","id":"old"}]}';
  const edit = await cli(['act', batch]);
  assert.equal(calls.at(-1).body.build.step, 2);
  assert.equal(edit.stderr.trim(), '[church 2/3 roof]');
  const jsonEdit = await cli(['act', batch, '--json']);
  assert.equal(JSON.parse(jsonEdit.stdout).accepted, true); assert.equal(jsonEdit.stderr, '');
  await cli(['act', batch, '--no-build']); assert.equal(calls.at(-1).body.build, undefined);
  await cli(['build', 'done', 'all listed items exist']); assert.equal(load().build, undefined);
  const resumed = await cli(['build', 'resume']);
  assert.match(resumed.stdout, /church: Black stone church \(active\)/);
  assert.deepEqual(calls.slice(-2).map(c => [c.method, c.path]), [['GET', '/v1/god/builds'], ['POST', '/v1/god/builds/church/resume']]);
  assert.equal(load().build.lease, 'l_7654abcd');
  const before = readFileSync('.eden-god.json', 'utf8');
  for (const sub of ['resume', 'show']) {
    const missing = await cli(['build', sub, 'missing']);
    assert.match(missing.stdout, /unknown build: missing/);
    assert.match(missing.stdout, /church: Black stone church \(paused\); step 1\/5 shell/);
    assert.ok(missing.stdout.includes(`choose an id: build ${sub} <id>`));
  }
  open = [...open, serverBuild({ id: 'market', title: 'Market hall' })];
  const choices = await cli(['build', 'resume']);
  assert.match(choices.stdout, /several open builds/);
  assert.match(choices.stdout, /market: Market hall \(active\); step 1\/5 shell/);
  assert.equal(calls.at(-1).method, 'GET');
  assert.equal(readFileSync('.eden-god.json', 'utf8'), before);
  const parts = await cli(['parts', 'gothic', 'stone']);
  assert.match(parts.stdout, /gothic-buttress@1.*Black Gothic church \(done Oct 15\).*place sha:a{64} --at …/);
  assert.equal(parts.stderr, '');
  assert.deepEqual(JSON.parse((await cli(['parts', '--json'])).stdout), { parts: [keptPart()] });
  assert.match((await cli(['find', 'gothic', 'stone'])).stdout, /used in: black-church \(done; 10 standing\)/);
});

test('narrated build step posts once and prints/saves the server echo before any design edit', async t => {
  const { calls } = await buildFixture(t, c => c.path.endsWith('/step') ? { ok: true, build: serverBuild({ step: { n: 3, label: 'server roof' }, say: 'Server narration', sayAt: 123, designing: ['nave', 'tower'] }) } : null);
  save({ build: localBuild() });
  const out = await COMMANDS.build(['step', 'roof'], { say: 'Copper\nspires', mass: 'nave, tower' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].path, '/v1/god/builds/church/step');
  assert.deepEqual(calls[0].body, { lease: 'l_1234abcd', n: 2, label: 'roof', say: 'Copperspires', masses: ['nave', 'tower'] });
  assert.equal(out, 'step 3/5: server roof — designing: Server narration');
  assert.equal(load().build.n, 3); assert.equal(load().build.label, 'server roof');
  await build('step'); assert.equal(calls.length, 1, 'the legacy step stays local');
  await act({ ops: [{ op: 'remove', id: 'old' }] });
  assert.equal(calls[1].body.build.step, 4);
});

test('narrated claim steps use exactly the claim credential and only rewrite the claim file', async t => {
  const { calls } = await buildFixture(t, c => c.path.endsWith('/step') ? { ok: true, build: serverBuild({ step: { n: 7, label: 'lead' }, claims: [{ id: 'c_1234abcd', step: { n: 2, label: 'pews' } }], say: { text: 'Six pews', at: 123 } }) } : null);
  save({ build: localBuild() }); const lead = readFileSync('.eden-god.json', 'utf8');
  process.env.EDEN_GOD_CLAIM = 'c_1234abcd';
  const r = await build('step', ['pews'], { say: 'Six pews', json: true });
  assert.equal(r.build.step.n, 7);
  assert.deepEqual(calls[0].body, { claim: 'c_1234abcd', n: 2, label: 'pews', say: 'Six pews' });
  assert.equal(load().build.n, 2); assert.equal(load().build.label, 'pews');
  assert.equal(readFileSync('.eden-god.json', 'utf8'), lead);
});

test('narration refuses invalid input locally and preserves progress on server refusal or HTTP error', async t => {
  let http = false;
  const refusal = { ok: false, failures: [{ op: -1, code: 'build.lease', detail: 'superseded' }] };
  const { calls } = await buildFixture(t, () => http ? { httpStatus: 401, data: { error: 'unauthorized' } } : refusal);
  save({ build: localBuild() }); const before = readFileSync('.eden-god.json', 'utf8');
  for (const flags of [{ say: true }, { say: '' }, { say: '\n\t' }, { say: 'x'.repeat(141) }, { say: ['one', 'two'] }, { say: 'roof', mass: '' }, { say: 'roof', mass: true }, { say: 'roof', mass: 'nave,,tower' }, { say: 'roof', mass: Array(9).fill('nave').join(',') }, { mass: 'nave' }]) {
    await assert.rejects(build('step', [], flags));
  }
  assert.equal(calls.length, 0);
  assert.match(await build('step', [], { say: 'Roof' }), /REFUSED: build.lease.*build resume church/);
  assert.deepEqual(await build('step', [], { say: 'Roof', json: true }), refusal);
  http = true; await assert.rejects(build('step', [], { say: 'Roof' }), /HTTP 401/);
  assert.equal(readFileSync('.eden-god.json', 'utf8'), before);
});

test('build wait backs off 2s to 15s, prints only changed claim state and finishes on release', async t => {
  let poll = 0, clock = 0; const waits = [], changes = [];
  const { calls } = await buildFixture(t, () => { poll++; return { ok: true, build: serverBuild({ claims: [{ id: 'c_1234abcd', part: 'tower', status: poll === 10 ? 'done' : 'held', step: { n: poll >= 9 ? 2 : 1, label: 'spire' } }] }) }; });
  const out = await buildWait('church', {}, { now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; }, print: s => changes.push(s) });
  assert.deepEqual(waits, [2000, 3000, 4500, 6750, 10125, 15000, 15000, 15000, 2000]);
  assert.equal(changes.length, 3); assert.match(changes[0], /tower held 1 spire/); assert.match(changes[1], /tower held 2 spire/); assert.match(changes[2], /tower done/);
  assert.match(out, /all claims released/);
  assert.ok(calls.every(c => c.method === 'GET' && c.path === '/v1/god/builds/church' && c.body === undefined));
});

test('build wait stops for abandonment or build end; done/released/taken claims count as released', async t => {
  let b;
  const { calls } = await buildFixture(t, () => ({ ok: true, build: b }));
  for (const [status, claims, reason] of [
    ['active', [], 'released'],
    ['paused', ['done', 'released', 'taken'], 'released'],
    ['active', ['held', 'abandoned'], 'abandoned'],
    ['done', ['held'], 'closed'],
    ['abandoned', ['stale'], 'closed'],
  ]) {
    b = serverBuild({ status, claims: claims.map((status, i) => ({ id: `c_${i}`, part: `part-${i}`, status })) });
    const r = await buildWait('church', { json: true }, { print: () => assert.fail('JSON prints no progress'), sleep: () => assert.fail('terminal state does not wait') });
    assert.equal(r.reason, reason); assert.equal(r.ok, true); assert.equal(r.build.status, status);
  }
  assert.equal(calls.length, 5);
});

test('build wait times out with a final summary, keeps stale claims pending and never changes local state', async t => {
  let clock = 0; const changes = [], waits = [];
  const { calls } = await buildFixture(t, () => ({ ok: true, build: serverBuild({ claims: [{ id: 'c_1234abcd', part: 'tower', status: 'stale' }] }) }));
  save({ build: localBuild() }); const before = readFileSync('.eden-god.json', 'utf8');
  const runtime = { now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; }, print: s => changes.push(s) };
  assert.match(await buildWait('church', { timeout: '3s' }, runtime), /timed out; active; claims: tower stale/);
  assert.deepEqual(waits, [2000, 1000]); assert.equal(changes.length, 1); assert.equal(calls.length, 2);
  assert.equal(readFileSync('.eden-god.json', 'utf8'), before);
  const json = await buildWait('church', { timeout: '3s', json: true }, runtime);
  assert.equal(json.ok, false); assert.equal(json.reason, 'timeout');
});

test('build wait validates locally and propagates server refusal without polling', async t => {
  const refusal = { ok: false, failures: [{ op: -1, code: 'build.unknown', detail: 'no such build' }] };
  const { calls } = await buildFixture(t, () => refusal);
  await assert.rejects(build('wait'), /no current build/);
  save({ build: localBuild() });
  for (const timeout of ['0s', '-1m', 'tomorrow', true, '1', ['1s'], 'Infinityh']) await assert.rejects(build('wait', [], { timeout }));
  await assert.rejects(build('wait', ['church']), /too many arguments/);
  assert.equal(calls.length, 0);
  assert.match(await COMMANDS.build(['wait'], {}), /REFUSED: build.unknown/);
  assert.equal(calls.length, 1);
});

test('reach preserves server refs, parses 2D/3D points and reports engine success/refusal/unsupported', async t => {
  let result = { reachable: true, length: 12, legs: 3, levels: [0, 1] };
  const { calls } = await buildFixture(t, c => c.body?.reach ? { reach: result } : null);
  assert.equal(await COMMANDS.reach(['plaza', 'hall:upstairs'], {}), 'reach: OK (12 m)');
  assert.deepEqual(calls[0].body, { reach: { from: 'plaza', to: 'hall:upstairs' } });
  assert.deepEqual(await COMMANDS.reach(['-1,2', '3,4,5'], { json: true }), result);
  assert.deepEqual(calls[1].body, { reach: { from: [-1, 2], to: [3, 4, 5] } });
  result = { reachable: false, code: 'reach.bad-to', detail: 'no standing room' };
  assert.match(await COMMANDS.reach(['plaza', 'hall'], {}), /FAILED.*reach.bad-to.*no standing room/);
  result = { supported: false, note: 'engine unavailable' };
  assert.match(await COMMANDS.reach(['plaza', 'hall'], {}), /not checked.*engine unavailable/);
  const count = calls.length;
  for (const args of [[], ['plaza'], ['1,', 'hall'], ['1,2,3,4', 'hall'], ['NaN,2', 'hall']]) await assert.rejects(COMMANDS.reach(args, {}));
  assert.equal(calls.length, count);
});

test('clear sends footprint size and resolved reference position; where labels bounds honestly', async t => {
  let clearance = { clear: true, blockedBy: [] };
  const layout = { layout: { entities: [{ id: 'e_gate', path: 'gate', name: 'gate', parent: 'world', pose: [4, 0, 6, 0, 1], aabb: [0, 0, 8, 12], layer: 'solid' }] } };
  const { calls } = await buildFixture(t, c => c.body?.where ? { where: { x: 4, z: 6, y: 0, slopeDeg: 0, medium: 'dry', inside: [{ path: 'gate', layer: 'solid' }, { path: 'road', layer: 'surface' }, { path: 'wall', layer: 'solid' }], near: [] }, clearance: { clear: false, blockedBy: ['wall'] } } : c.body?.clearance ? { clearance } : c.body?.layout ? layout : null);
  assert.equal(await COMMANDS.clear(['-1,2'], { size: '2×3' }), 'clear: 2×3 m at -1,2');
  assert.deepEqual(calls[0].body, { clearance: { at: [-1, 2], size: [2, 3] } });
  clearance = { clear: false, blockedBy: ['gate/wall'] };
  assert.match(await COMMANDS.clear(['gate'], { size: '2x3' }), /blocked: gate\/wall/);
  assert.deepEqual(calls.at(-1).body, { clearance: { at: [4, 6], size: [2, 3] } });
  assert.deepEqual(await COMMANDS.clear(['4,6'], { size: '2,3', json: true }), clearance);
  assert.match(await COMMANDS.where(['gate'], {}), /gate \[bounds\] \(solid\), road \[bounds\] \(surface\), wall \[collider\] \(solid\)/);
  assert.deepEqual(calls.at(-1).body, { where: [4, 6], clearance: { at: [4, 6], size: [0, 0] } });
  const count = calls.length;
  for (const size of [undefined, true, '0x3', '2x-3', '2x', 'NaNx3', ['2x3']]) await assert.rejects(COMMANDS.clear(['gate'], { size }));
  await assert.rejects(COMMANDS.clear(['1,'], { size: '2x3' }));
  assert.equal(calls.length, count);
  checkArgs('reach', {}, ['a', 'b']); checkArgs('clear', { size: '2x3' }, ['gate']);
  assert.throws(() => checkArgs('reach', {}, ['a', 'b', 'c']), /takes 2 words/);
});

test('time, weather and sky print server shared-clock warnings and preserve the applied clock', async t => {
  const warning = "this changes the world's clock for everyone; for a picture use look --hour";
  const env = { time: { clock: '21:03', datetime: '2026-10-15', paused: false, timeScale: 24 }, weather: { kind: 'clear', intensity: 1, clouds: 0, rain: 0, wind: 0, fog: 0 } };
  const { calls } = await buildFixture(t, c => ['/v1/god/env', '/v1/god/act'].includes(c.path) ? { accepted: true, seq: 7, env, warnings: c.path.endsWith('/env') ? [{ code: 'env.shared-clock', detail: warning }] : [`env.shared-clock: ${warning}`] } : null);
  const notices = []; t.mock.method(console, 'error', s => notices.push(s));
  save({ build: localBuild() });
  assert.match(await COMMANDS.time(['21:00'], {}), /^21:03/);
  assert.match(await COMMANDS.weather([], { kind: 'clear' }), /^21:03/);
  await COMMANDS.sky([], { palette: 'clear-day', sun: '.5' });
  assert.deepEqual(notices, Array(3).fill(`env.shared-clock: ${warning}`));
  assert.ok(calls.filter(c => c.body).every(c => !c.body.build));
});

test('examples catalogue is linted against recorded files and every listed example is served', async t => {
  const root = new URL('./examples/', import.meta.url);
  const recorded = readdirSync(new URL('shots/', root)).filter(f => f.endsWith('.log')).map(f => f.slice(0, -4));
  assert.deepEqual(Object.keys(EXAMPLES).sort(), recorded.sort());
  const contents = new Map();
  for (const name of Object.keys(EXAMPLES)) for (const ext of ['log', 'mjs']) contents.set(`${name}.${ext}`, readFileSync(new URL(`${ext === 'log' ? 'shots/' : ''}${name}.${ext}`, root), 'utf8'));
  const { calls } = await buildFixture(t, c => {
    const file = c.path.replace('/god/examples/', '');
    return contents.has(file) ? { rawText: contents.get(file), contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/plain' } : { httpStatus: 404, data: {} };
  });
  const listing = await examples();
  const listed = [...listing.matchAll(/^- ([a-z0-9-]+):/gm)].map(m => m[1]);
  assert.deepEqual(listed, Object.keys(EXAMPLES));
  for (const name of listed) {
    assert.match(await examples(name), /saved examples\//);
    for (const ext of ['log', 'mjs']) assert.equal(readFileSync(`examples/${name}.${ext}`, 'utf8'), contents.get(`${name}.${ext}`));
  }
  assert.equal(calls.length, listed.length * 2);
  await assert.rejects(examples('church-massing'), /no example/);
});

test('look validates and normalizes hour/weather, forwards only shot options and never edits the clock', async t => {
  const calls = fixture(t, c => {
    const path = new URL(c.url).pathname;
    if (path === '/v1/world/seq') return { seq: 1, builds: 1 };
    if (path === '/v1/god/snapshot') return { seq: 1, buildsRev: 1, constants: { extent: 200 }, entities: [], library: [], defs: [] };
    if (path === '/v1/god/query') return JSON.parse(c.body).points ? { points: [{ y: 0, water: 0 }] } : { layout: { entities: [] } };
    assert.fail(`unexpected request: ${c.method} ${path}`);
  });
  invalidate(); t.after(invalidate);
  assert.deepEqual(lookOverrides({ hour: '0' }), { hour: '00:00' });
  assert.deepEqual(lookOverrides({ hour: '9:05', weather: 'rain' }), { hour: '09:05', weather: 'rain' });
  assert.deepEqual(lookOverrides({ weather: 'clear' }), { weather: 'clear' });
  assert.deepEqual(lookOverrides(), {});
  for (const hour of [true, ['21', '22'], '24', '-1', '21:60', '2:3', '21.5', '', 'NaN']) await assert.rejects(look({ hour }));
  for (const weather of [true, ['rain'], '', 'rain&hour=2']) await assert.rejects(look({ weather }));
  assert.equal(calls.length, 0);
  const seen = [];
  const shot = args => { seen.push(args); return { file: args.out, ms: 1 }; };
  const result = await look({ at: '0,0', hour: '21', weather: 'rain', json: true }, { shoot: shot });
  assert.equal(seen[0].hour, '21:00'); assert.equal(seen[0].weather, 'rain');
  assert.equal(result.file, seen[0].out);
  assert.ok(calls.every(c => c.method === 'GET' || new URL(c.url).pathname === '/v1/god/query'));
  assert.ok(calls.every(c => !['/v1/god/env', '/v1/god/act'].includes(new URL(c.url).pathname)));
  checkArgs('look', { hour: '21', weather: 'rain' }, []);
  assert.match(COMMANDS.help(), /--hour HH\[:MM\].*never the world clock/);
});

test('build wait prints a timeout summary even when its first read never answers', async t => {
  fixture(t, {});
  globalThis.fetch = async () => { throw new DOMException('deadline elapsed', 'TimeoutError'); };
  const notices = [];
  const r = await buildWait('church', { timeout: '1s' }, { print: s => notices.push(s) });
  assert.equal(r, 'church: timed out; claim state not received');
  assert.deepEqual(notices, []);
});

test('downloadable commands run narration, wait, reach, clear and clock warnings on the loopback stub', async t => {
  const env = { time: { clock: '21:02', timeScale: 24 }, weather: { kind: 'clear', intensity: 1, clouds: 0, rain: 0, wind: 0, fog: 0 } };
  const { calls, dir } = await buildFixture(t, c => {
    if (c.path.endsWith('/step')) return { ok: true, build: serverBuild({ step: { n: c.body.n, label: 'roof echo' }, say: 'Copper spires' }) };
    if (c.body?.reach) return { reach: { reachable: true, length: 4 } };
    if (c.body?.clearance) return { clearance: { clear: true, blockedBy: [] } };
    if (c.path === '/v1/god/env') return { accepted: true, seq: 4, env, warnings: [{ code: 'env.shared-clock', detail: 'use look --hour' }] };
  });
  save({ build: localBuild() });
  const executable = new URL('./eden-god.mjs', import.meta.url).pathname;
  const cli = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, ...args], { cwd: dir, env: { ...process.env, EDEN_GOD_TRACE: '', EDEN_GOD_TIMING: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject); child.on('exit', code => code ? reject(new Error(stderr)) : resolve({ stdout, stderr }));
  });
  const before = calls.length;
  assert.match((await cli(['build', 'step', 'roof', '--say', 'Copper spires', '--mass', 'nave'])).stdout, /step 2\/5: roof echo — designing: Copper spires/);
  assert.equal(calls.length, before + 1); assert.equal(load().build.label, 'roof echo');
  const waited = await cli(['build', 'wait', '--timeout', '15m']);
  assert.match(waited.stdout, /all claims released/); assert.match(waited.stderr, /claims: none/);
  assert.match((await cli(['reach', '0,0', 'hall:nave'])).stdout, /reach: OK \(4 m\)/);
  assert.match((await cli(['clear', '2,3', '--size', '4x5'])).stdout, /clear: 4×5 m at 2,3/);
  const time = await cli(['time', '21:00']);
  assert.match(time.stdout, /^21:02/); assert.match(time.stderr, /env.shared-clock: use look --hour/);
  assert.ok(calls.every(c => c.path !== '/v1/god/act'));
});

test('skill preserves stopping/use evidence and teaches the C7 construction workflow', () => {
  const skill = readFileSync(new URL('./SKILL.md', import.meta.url), 'utf8');
  for (const expected of ["owner's words as `--brief`", '`build start <id>-2 --root <id>`', '`build step <label> --say', '`look --hour 21`', "never change the world's clock for a picture", 'trust', '`walk:`', '"reachable from outside"', '>3 minutes', 'first minute', 'about 5 minutes, ≤ 30 shapes', 'Lead takes the largest part', 'Never poll: `build wait', '`reach <from> <to>`', '`clear <x,z|ref> --size WxD`', 'Stop when every listed item exists', 'offers instead of']) assert.ok(skill.toLowerCase().includes(expected.toLowerCase()), expected);
  assert.doesNotMatch(skill, /time 21:00|set the time back/);
});

test('CE4/WD4: CLI records verbatim briefs, asks and includes; later asks/includes are one metadata call', async t => {
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/builds' && c.method === 'POST' ? { ok: true, build: serverBuild({ plan: { steps, brief: c.body.brief, asks: c.body.asks } }), lease: 'l_1234abcd' } : c.path.endsWith('/step') ? { ok: true, build: serverBuild({ step: { n: c.body.n, label: c.body.label } }) } : null);
  await build('start', ['church'], { ...startFlags(), brief: 'The owner’s exact words', asks: 'black walls; walk inside [use]', include: 'oak-4,old-seat' });
  assert.equal(calls.length, 1); assert.equal(calls[0].body.brief, 'The owner’s exact words'); assert.deepEqual(calls[0].body.asks, ['black walls', 'walk inside [use]']); assert.deepEqual(calls[0].body.include, ['oak-4', 'old-seat']);
  await build('step', [], { asks: 'sit by a window [use]', include: 'old-window' });
  assert.equal(calls.length, 2); assert.deepEqual(calls[1].body.asks, ['sit by a window [use]']); assert.deepEqual(calls[1].body.include, ['old-window']); assert.equal(calls[1].body.say, undefined); assert.equal(calls[1].body.n, 1); assert.equal(load().build.n, 1);
  checkArgs('build', { include: 'oak-4', asks: 'green roof' }, ['step']);
  for (const f of [{ asks: 'a;;b' }, { include: 'a,,b' }, { asks: true }, { include: true }]) await assert.rejects(build('step', [], f));
  assert.equal(calls.length, 2);
});

test('CE4: show and resume lead with original wording and asks; missing brief warns once after success', async t => {
  const warnings = [], original = console.error; console.error = s => warnings.push(s); t.after(() => { console.error = original; });
  await buildFixture(t, c => c.path === '/v1/god/builds/church' || c.path.endsWith('/resume') ? { ok: true, build: serverBuild({ plan: { steps, brief: 'Original owner words', asks: ['Sit inside'] } }), lease: 'l_1234abcd' } : null);
  assert.match(await build('show', ['church']), /^brief: Original owner words\nask: Sit inside\n/);
  assert.match(await build('resume', ['church']), /^brief: Original owner words\nask: Sit inside\n/);
  await build('start', ['church'], startFlags()); await build('start', ['chapel'], startFlags());
  assert.equal(warnings.filter(x => /without --brief/.test(x)).length, 1);
});

test('CE4: continue chooses the next chapter and inherits the latest chapter including mass yaw', async t => {
  const massing = [{ name: 'nave', at: [0, 0], size: [12, 8], h: 5, yaw: .25, roof: 'flat', parts: 8 }];
  const { calls } = await buildFixture(t, c => {
    if (c.path === '/v1/god/builds/church') return { ok: true, build: serverBuild({ status: 'done', massing }) };
    if (c.path === '/v1/god/builds/church-2') return { ok: true, build: serverBuild({ id: 'church-2', status: 'done', title: 'Latest church', massing, chapterOf: 'church' }) };
    if (c.path === '/v1/god/builds/church-3') return { httpStatus: 404, data: { code: 'not-found' } };
    if (c.path === '/v1/god/builds' && c.method === 'POST') return { ok: true, build: serverBuild({ id: c.body.id, plan: { steps, brief: c.body.brief } }), lease: 'l_1234abcd' };
  });
  await build('continue', ['church'], { brief: 'Follow-up: a new window', asks: 'green glass' });
  const request = calls.at(-1).body; assert.equal(request.id, 'church-3'); assert.equal(request.root, 'church-2'); assert.equal(request.title, 'Latest church'); assert.equal(request.brief, 'Follow-up: a new window'); assert.deepEqual(request.asks, ['green glass']); assert.deepEqual(request.massing, massing.map(({ parts, ...m }) => m)); assert.equal(load().build.id, 'church-3');
  await assert.rejects(build('continue', ['church']), /needs --brief/);
});

const integrityReceipt = () => ({ seq: 42, exists: { count: 2, paths: ['church', 'church/seat'] }, preservation: { outside: [{ path: 'oak-4', included: true }] }, undoability: { ok: false, edits: 3, conflicts: [{ op: 0, code: 'undo.conflict', detail: 'oak-4 is missing' }] }, massing: [{ name: 'nave', parts: 2, height: 4, plannedHeight: 8, fits: true }], uses: [{ path: 'church/seat', behaviours: ['sit'] }], viewerCost: { triangles: { added: null, world: 120, share: null }, draws: { added: null }, note: 'not measured' }, refused: { count: 1, recent: [{ code: 'build.outside', entity: 'oak-4', detail: 'outside scope' }] }, warnings: ['1 owner asks remain unverified'] });

test('EF3: build check is one call, done displays warnings and receipt, JSON keeps raw proof', async t => {
  const receipt = integrityReceipt(); const { calls } = await buildFixture(t, c => c.path.endsWith('/check') || c.path.endsWith('/done') ? { ok: true, build: serverBuild({ status: c.path.endsWith('/done') ? 'done' : 'active', done: c.path.endsWith('/done') ? { receipt } : undefined }), receipt } : null);
  save({ build: { id: 'church', lease: 'l_1234abcd', n: 1, steps, label: steps[0] } });
  const output = await build('check'); assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/god/builds/church/check'); assert.match(output, /checked receipt at seq 42.*undo CONFLICT/); assert.match(output, /changed outside: oak-4 \(included\)/); assert.match(output, /build.outside on oak-4/); assert.match(output, /WARNING: 1 owner asks/);
  assert.deepEqual((await build('check', ['church'], { json: true })).receipt, receipt);
  const done = await build('done'); assert.match(done, /checked receipt.*undo CONFLICT/); assert.equal(load().build, undefined);
});

test('EF2: build start prints its server site report without an extra request', async t => {
  const report = { ground: { min: 1, max: 3, sampled: true }, neighbours: [{ path: 'old-home', eave: 4, eaveSource: 'floors', footprint: [{ size: [6, 8] }] }], eaves: { median: 4, max: 4 }, masses: [{ name: 'nave', fits: true, medianRatio: 3, maxRatio: 3 }], closure: { counts: { things: 1, bodies: 0 }, things: [{ path: 'oak-4' }] }, approach: { from: 'Plaza', checked: false }, library: [{ ref: 'core/bench@1', category: 'furniture' }] };
  const { calls } = await buildFixture(t, c => c.path === '/v1/god/builds' && c.method === 'POST' ? { ok: true, build: serverBuild(), lease: 'l_1234abcd', report } : null);
  const output = await build('start', ['church'], { ...startFlags(), brief: 'A quiet place' });
  assert.equal(calls.length, 1); assert.match(output, /site report: ground 1..3 m \(sampled\)/); assert.match(output, /near old-home: 6×8 m/); assert.match(output, /closure: 1 things, 0 bodies; oak-4/); assert.match(output, /approach: Plaza \(not checked\)/); assert.match(output, /library: core\/bench@1/);
});

test('preview preserves the server capability fragment in the human link', async t => {
  process.env.SIM_GOD_FEATURES = 'previews'; t.after(() => { delete process.env.SIM_GOD_FEATURES; });   // G5: the page's ghost is switched off by default
  fixture(t, { accepted: true, id: 'pv_view', url: '?preview=pv_view#previewKey=unguessable-read-key', summary: {} });
  const result = await preview({ ops: [{ op: 'remove', id: 'bench' }] });
  assert.equal(result.url, 'https://world.invalid?preview=pv_view#previewKey=unguessable-read-key'); assert.ok(result.tell.includes(result.url));
});

test('G5: with the page ghost off, preview prints only the commit; flag and Constitution verbs refuse cleanly and leave help', async t => {
  const calls = fixture(t, { accepted: true, id: 'pv_off', url: '?preview=pv_off#previewKey=k', viewKey: 'k', summary: {} });
  const r = await preview({ ops: [{ op: 'remove', id: 'bench' }] });
  assert.equal(r.url, undefined); assert.equal(r.viewKey, undefined); assert.equal(r.commit, 'node eden-god.mjs commit pv_off');
  assert.doesNotMatch(r.tell, /ghost|\?preview=/); assert.match(r.tell, /commit pv_off/);
  const sent = calls.length;
  for (const [verb, args] of [['flag', ['camp']], ['flags', []], ['constitution', ['# Rules']], ['amendments', []], ['decide', ['a_1', 'accept']], ['governance', []]]) {
    const out = await COMMANDS[verb](args, {});
    assert.match(out, /^REFUSED: (flags are|the Constitution is) turned off/, verb);
  }
  assert.equal(calls.length, sent, 'a switched-off verb never reaches the world');
  const help = COMMANDS.help();
  assert.doesNotMatch(help, /flag <label>|constitution <md>|amendments \[--all\]/); assert.match(help, /prayers \[--all\]/);
});

test('dryrun, preview, query, env, land, strike and asset GET/POST calls back off on 429', async t => {
  fixture(t, {});
  for (const path of ['dryrun', 'preview', 'query', 'env', 'land', 'strike', 'assets']) for (const method of ['GET', 'POST']) {
    const sent = [];
    globalThis.fetch = async (url, options) => { sent.push({ url, ...options }); return sent.length === 1 ? Response.json({ retryAfterMs: 1 }, { status: 429 }) : Response.json({ ok: true }); };
    assert.equal((await call(`/v1/god/${path}`, { method, ...(method === 'POST' ? { body: { verb: 'test' } } : {}) })).status, 200, `${method} ${path}`);
    assert.equal(sent.length, 2); assert.equal(sent[0].body, sent[1].body); assert.deepEqual(sent[0].headers, sent[1].headers);
  }
});

test('measure dryruns for a first-choice place and blocked candidate search', async t => {
  fixture(t, {}); invalidate(); let dryruns = 0, successAt = 1; const poses = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/seq')) return Response.json({ seq: 0 });
    if (url.endsWith('/snapshot')) return Response.json({ seq: 0, constants: { extent: 400 }, state: {}, entities: [], defs: [] });
    if (url.endsWith('/query')) {
      const body = JSON.parse(options.body);
      if (body.bake) return Response.json({ bake: { form: 'point', layer: 'solid', box: [2, 1, 1], gen: 'kit/2' } });
      if (body.layout) return Response.json({ layout: { entities: [] } });
      return Response.json({ points: [{ y: 0, water: 0 }] });
    }
    if (url.endsWith('/dryrun')) { dryruns++; poses.push(JSON.parse(options.body).ops[0].p); return Response.json({ accepted: dryruns === successAt, failures: [{ op: 0, code: 'overlap.solid', detail: 'candidate blocked', suggest: { p: [30, 30] } }] }); }
    if (url.endsWith('/act')) return Response.json({ accepted: true, seq: 1, ids: {} });
    throw Error(`unhandled fixture ${url}`);
  };
  await COMMANDS.place(['core/h1-measured@1'], { near: '0,0', json: true }); assert.equal(dryruns, 1);
  dryruns = 0; poses.length = 0; successAt = 6;
  const result = await COMMANDS.place(['core/h1-measured@1'], { near: '0,0', json: true });
  assert.equal(dryruns, 6, JSON.stringify(result)); assert.equal(new Set(poses.map(JSON.stringify)).size, 5, 'four spatial candidates, server suggestion, then nudge');
  console.log('H1 place measurement: first choice 1 dryrun; blocked near search 6 (four candidates + suggestion + nudge); command loop hard cap 12.');
});

// R2F: the release 1.1 walk's describe of a 4-floor lighthouse (r11-walk/diag.txt) said "no way in/out"; the room ends
// were the problem (reach.bad-to in, reach.bad-from out): no floor the engine could stand on.
test('describe walk says "no floor to stand on in room X (floor n)" for missing standing room, and keeps route wording', async () => {
  const { walkLine } = await import('./cli.mjs');
  // what the server sends for a room end with no standing room (stairs-reach.test.ts R2F): both sides carry the endpoint
  const end = (id, floor, side) => ({ code: side === 'to' ? 'reach.bad-to' : 'reach.bad-from', detail: `no standing room in walk-lighthouse:${id}`, endpoint: { side, what: `walk-lighthouse:${id}`, at: [24, 30], y: 3.1 * floor, level: 0, levelY: 0 } });
  const from = [24, 33.99], ok = { in: true, out: true }, floorless = (id, floor) => ({ id, floor, in: 'reach.bad-to', out: 'reach.bad-from', why: { in: end(id, floor, 'to'), out: end(id, floor, 'from') } });
  const walk = { state: 'failed', from, note: '', rooms: [{ id: 'entrance', floor: 0, ...ok }, floorless('room', 1), floorless('room-2', 2), floorless('lantern', 3)] };
  const line = walkLine(walk);
  assert.equal(line, '  walk: NOT WALKABLE — the engine has no floor to stand on in rooms room (floor 1), room-2 (floor 2), lantern (floor 3). This is the engine\'s own route check, so a resident cannot use these rooms whatever "reachable from outside" in the notes says; give those rooms a floor the engine can stand on (the floor may be missing for the engine, or the room filled wall to wall; describe --json shows where it looked), then describe again.');
  // one room (describe house/room); the engine's nearest spot outside the room
  assert.match(walkLine({ ...walk, rooms: [floorless('bedroom', 1)] }), /no floor to stand on in room bedroom \(floor 1\)\. .*give that room a floor/);
  assert.match(walkLine({ ...walk, rooms: [{ id: 'attic', floor: 2, in: 'room.no-standing-room', out: 'room.no-standing-room' }] }), /no floor to stand on in room attic \(floor 2\)/);
  // a bad end for another reason (no such room, a missing entity) or a bare code is not "no floor": its code and detail
  const missing = { code: 'reach.bad-to', detail: 'walk-lighthouse has no room hall' };
  const other = walkLine({ ...walk, rooms: [{ id: 'hall', floor: 0, in: 'reach.bad-to', out: 'reach.bad-from', why: { in: missing, out: { ...missing, code: 'reach.bad-from' } } }, { id: 'den', floor: 0, in: 'reach.bad-to', out: true }, { id: 'loft', floor: 1, in: 'reach.no-route', out: true, why: { in: { code: 'reach.no-route', detail: 'no stairs up' } } }] });
  assert.match(other, /^ {2}walk: NOT WALKABLE — hall \(floor 0\): no way in \(reach\.bad-to: walk-lighthouse has no room hall\), no way out \(reach\.bad-from: walk-lighthouse has no room hall\); den \(floor 0\): no way in \(reach\.bad-to\); loft \(floor 1\): no way in \(reach\.no-route\)\. /);
  assert.match(other, /; fix the stairs, doors or whatever stands in the way, then describe again\.$/); assert.doesNotMatch(other, /no floor|front door \(/);
  // one side without standing room, the other a route failure: both said
  const mixed = walkLine({ ...walk, rooms: [{ id: 'study', floor: 1, in: 'room.no-standing-room', out: 'reach.no-route' }] });
  assert.match(mixed, /no floor to stand on in room study \(floor 1\); study \(floor 1\): no way out \(reach\.no-route\)\. .*give that room a floor .*; fix the stairs/);
});

test('describe <house>/<room> --json carries that room\'s walk verdict with the engine end it could not stand at', async t => {
  const end = (side) => ({ code: side === 'to' ? 'reach.bad-to' : 'reach.bad-from', detail: 'no standing room in walk-lighthouse:room', endpoint: { side, what: 'walk-lighthouse:room', at: [24, 30], y: 3.1, level: 0, levelY: 0 } });
  const why = { in: end('to'), out: end('from') };
  const house = { path: 'walk-lighthouse', rooms: [{ id: 'room', name: 'Room 1', floor: 1, y: 3.1, size: [5.37, 5.37], height: 2.82, occupants: [], doors: [] }], walk: { state: 'failed', from: [24, 33.99], note: '', rooms: [{ id: 'room', floor: 1, in: 'reach.bad-to', out: 'reach.bad-from', why }] } };
  await buildFixture(t, (c) => c.path === '/v1/god/query' && c.body.describe ? { describe: c.body.describe === 'walk-lighthouse' ? house : { error: `no such entity ${c.body.describe}` } } : null);
  const room = await COMMANDS.describe(['walk-lighthouse/room'], { json: true });
  assert.equal(room.id, 'room'); assert.equal(room.walk.state, 'failed'); assert.deepEqual(room.walk.from, [24, 33.99]); assert.deepEqual(room.walk.why, why);
  const text = await COMMANDS.describe(['walk-lighthouse/room'], {});
  assert.match(text, /walk: NOT WALKABLE — the engine has no floor to stand on in room room \(floor 1\)\./); assert.doesNotMatch(text, /no way (in|out)/);
});
