import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WorldModel, coreLibrary, applyBatch } from '../../packages/world-compiler/src/index.ts';
import { contextTargets } from '../../apps/server/src/god/context-view-scene.ts';
import { genesis, cases } from '../context-views/fixture.mjs';
import { bindCases } from '../context-views/bindings.mjs';
import expected from './quality-ground-cover-expected.json' with { type: 'json' };
import { alignQualityFixture, qualityBindings, qualityFixtureFacts, qualityHash, qualityBeforeReceipt, qualityBeforeImage } from './quality-ground-cover-fixture.mjs';

function fixture(seed = 'context-linux-a:genesis') {
  const model = new WorldModel({ constants: { ground: 'land', extent: 1000, ...genesis.constants }, seed,
    assets: sha => sha === 'a'.repeat(64) ? { tris: 0, bytes: 1, textures: 1, box: [0, 0, 0], image: { ext: 'png' } } : undefined });
  model.library = coreLibrary();
  for (const batch of genesis.batches) assert.equal(applyBatch(model, batch, 'god', 0, { trusted: true }).result.accepted, true);
  return model;
}
function snapshot(model) { const value = model.snapshot(); return structuredClone({ ...value, contract: 'world/1', counter: value.seq, seq: value.editSeq }); }
function session(model) {
  const edits = [];
  return { edits, request: async (path, body) => {
    if (path === '/v1/world/snapshot') return { json: async () => snapshot(model) };
    assert.equal(path, '/v1/god/act'); edits.push(structuredClone(body));
    const result = applyBatch(model, body, 'god', 0, { trusted: true }).result;
    return { json: async () => result };
  } };
}

test('raw context targets reproduce the missing-enclosed blocker; production enclosure fixes actual room binding', () => {
  const model = fixture();
  assert.throws(() => bindCases(cases, [...model.entities.values()], contextTargets(model)), /exactly one enclosed room/);
  const { bindings, targets } = qualityBindings(model), binding = bindings.find(row => row.id === 'enclosed-room');
  assert.equal(binding.slot, 'shed'); assert.ok(targets.find(row => row.ref === binding.ref).enclosed);
});

test('source-reconstructed facts pin effective definitions, physical output and every visual instance input across generated IDs', () => {
  assert.deepEqual(qualityFixtureFacts(fixture()), expected.facts);
  assert.deepEqual(qualityFixtureFacts(fixture('context-baseline-1:genesis')), expected.facts);
  for (const field of ['p', 'params', 'state', 'seed']) {
    const model = fixture(), entity = [...model.entities.values()].find(row => row.name === 'artwork');
    if (field === 'p') entity.p = [-3.1, 1.7, -4.7];
    if (field === 'params') entity.params = { ...entity.params, frame: '#000000' };
    if (field === 'state') entity.state = { ...entity.state, title: 'Changed' };
    if (field === 'seed') entity.seed = 7;
    assert.notDeepEqual(qualityFixtureFacts(model), expected.facts, field + ' must remain part of comparison');
  }
});

test('ordinary media alignment restores the exact upload and preserves title/maker and other geometry', async () => {
  const model = fixture('context-baseline-1:genesis'), art = [...model.entities.values()].find(row => row.name === 'artwork');
  const media = '/assets/' + 'a'.repeat(64) + '.png';
  assert.equal(applyBatch(model, { ops: [{ op: 'set', id: art.id, state: { media } }] }, 'god', 0, { trusted: true }).result.accepted, true);
  const original = qualityFixtureFacts(model), owner = session(model);
  const aligned = await alignQualityFixture(owner, snapshot(model), expected.facts);
  assert.equal(aligned.snapshot.entities.find(row => row.name === 'artwork').state.media, '');
  assert.equal(model.get(art.id).state.title, ''); assert.equal(model.get(art.id).state.maker, '');
  assert.equal((await aligned.restore()).restored, true);
  assert.deepEqual(qualityFixtureFacts(model), original);
  assert.equal((await aligned.restore()).changed, false);
  assert.deepEqual(owner.edits.map(row => row.ops[0].state), [{ media: '' }, { media }]);
});

test('a mismatched material or entity seed is refused before any fixture write', async () => {
  for (const change of ['material', 'seed']) {
    const model = fixture(), art = [...model.entities.values()].find(row => row.name === 'artwork'), owner = session(model);
    if (change === 'material') art.params.frame = '#000000'; else art.seed = 1;
    await assert.rejects(alignQualityFixture(owner, snapshot(model), expected.facts), /differs beyond/);
    assert.equal(owner.edits.length, 0);
  }
});

test('empty original media needs no God edits; source fixture and relevant renderer inputs remain pinned', async () => {
  const model = fixture(), owner = session(model), aligned = await alignQualityFixture(owner, snapshot(model), expected.facts);
  assert.deepEqual(await aligned.restore(), { changed: false, restored: true }); assert.equal(owner.edits.length, 0);
  for (const [path, pin] of Object.entries(expected.sourcePins)) assert.equal(qualityHash(readFileSync(new URL('../../' + path, import.meta.url))), pin, path);
  // A pin is a reviewed candidate (quality-ground-cover-browser.mjs): a re-hashed pin that drifted from the retained baseline must say so in the receipt (#1171).
  for (const [path, pin] of Object.entries(expected.sourcePins)) if (pin !== expected.baselineSourcePins[path]) assert.ok(expected.sourceExceptions.some(row => row.path === path && row.candidateSha256 === pin), path + ' differs from the baseline with no exception');
});

test('interrupted alignment response restores the original media through the ordinary God operation', async () => {
  const model = fixture(), art = [...model.entities.values()].find(row => row.name === 'artwork');
  const media = '/assets/' + 'a'.repeat(64) + '.png';
  assert.equal(applyBatch(model, { ops: [{ op: 'set', id: art.id, state: { media } }] }, 'god', 0, { trusted: true }).result.accepted, true);
  const original = qualityFixtureFacts(model), owner = session(model), request = owner.request;
  let interrupted = false;
  owner.request = async (path, body) => {
    const response = await request(path, body);
    if (body?.ops[0]?.state.media === '' && !interrupted) { interrupted = true; throw Error('response interrupted after commit'); }
    return response;
  };
  await assert.rejects(alignQualityFixture(owner, snapshot(model), expected.facts), /response interrupted/);
  assert.deepEqual(qualityFixtureFacts(model), original);
  assert.deepEqual(owner.edits.map(row => row.ops[0].state), [{ media: '' }, { media }]);
});

// The retained linux-preflight-v1 receipt and PNGs are not in the repo; point QUALITY_PREFLIGHT_DIR at a copy to run this.
const preflightRoot = process.env.QUALITY_PREFLIGHT_DIR;
test('retained camera/build receipt and both PNGs enforce fixed pins and receipt pins', { skip: !preflightRoot && 'set QUALITY_PREFLIGHT_DIR' }, () => {
  const root = preflightRoot;
  const bytes = readFileSync(root + '/receipt.json'), before = qualityBeforeReceipt(bytes, expected);
  assert.throws(() => qualityBeforeReceipt(Buffer.from(bytes.toString().replace(before.source, 'f'.repeat(40))), expected), /identity/);
  for (const role of ['a', 'b']) {
    const image = readFileSync(root + '/' + role + '/context.png');
    assert.equal(qualityBeforeImage(role, image, before, expected), expected.baselinePngs[role]);
    assert.throws(() => qualityBeforeImage(role, Buffer.from('wrong image'), before, expected), /fixed pin/);
    const wrongReceipt = structuredClone(before);
    wrongReceipt.checks.find(row => row.name === role + ' exact cached key/URL/bytes with no render').data.sha256 = 'f'.repeat(64);
    assert.throws(() => qualityBeforeImage(role, image, wrongReceipt, expected), /receipt identity/);
  }
});
