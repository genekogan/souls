import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,copyFileSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {recordedTakeChunkSchema,decodeSceneCapturePublication} from '@souls/protocol';
import {decodeSceneCapturePublication as leafDecode} from '@souls/protocol/scene-capture';
import {sampleTake} from '../../../mars/viewer/engine/take/replay.ts';
import {takeIdOf} from '../../../mars/viewer/engine/take/recorder.ts';
import {campSceneFixture,CAMP_SCENE_PRODUCER_PIN} from '../test/fixtures/camp-scene.ts';

const directory=new URL('../test/fixtures/recorded-scene/',import.meta.url);
const bytes=readFileSync(new URL('camp-transition.v1.json',directory)),fixture=JSON.parse(bytes.toString());
const pin=JSON.parse(readFileSync(new URL('camp-source.v1.json',directory),'utf8'));
const root=fileURLToPath(new URL('../../../',import.meta.url));

test('serialized camp fixture is exact reproducible native producer output with original old/new take addresses',async()=>{
  assert.equal(pin.producerCommit,CAMP_SCENE_PRODUCER_PIN);assert.equal(pin.bytes,bytes.byteLength);
  assert.equal(pin.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await campSceneFixture(),fixture);
  assert.equal(fixture.serverTick,27);assert.deepEqual(fixture.chunks.map((c:any)=>[c.fromTick,c.toTick]),[[0,7],[7,27]]);
  assert.deepEqual(fixture.violations,[]);assert.equal(fixture.paid,0);
  for(const chunk of fixture.chunks) {
    recordedTakeChunkSchema.parse(chunk);assert.equal(takeIdOf(chunk.take),chunk.take.id);
    const capture=fixture.captures.find((c:any)=>c.ref.hash===chunk.take.renderSceneRef.hash);
    assert.ok(capture);assert.deepEqual(decodeSceneCapturePublication(capture),leafDecode(capture));
    assert.equal(capture.worldId,fixture.worldId);assert.equal(capture.ref.rulesVersion,chunk.take.rulesVersion);
    assert.ok(sampleTake(chunk.take,chunk.take.ticks*chunk.take.dt).entities['fixture-person']);
  }
  assert.notEqual(fixture.captures[0].ref.hash,fixture.captures[1].ref.hash);
  assert.notEqual(fixture.chunks[0].take.finalState.base.campus,fixture.chunks[1].take.finalState.base.campus);
});

test('public five-file leaf dependency input executes in an isolated subprocess without engine/storage/kernel/index modules',t=>{
  const dir=mkdtempSync(join(tmpdir(),'core-scene-leaf-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const files=['packages/engine-contract/package.json','packages/engine-contract/src/hash.ts','packages/engine-contract/src/scene-capture.ts',
    'packages/protocol/package.json','packages/protocol/src/scene-capture.ts'];
  const input=JSON.parse(readFileSync(new URL('codec-input.v1.json',directory),'utf8'));
  assert.deepEqual(input.files.map((f:any)=>f.path),files);assert.equal(input.semanticsParent,CAMP_SCENE_PRODUCER_PIN);
  const codecPublication='4ecb87dc96133f180e03dc5bc336e6d9deba64c5';
  for(const f of input.files) {
    // The published five-file closure is immutable. Later additive codecs
    // have their own inputs; do not substitute current source for this proof.
    const bytes=execFileSync('git',['show',`${codecPublication}:${f.path}`],{cwd:root});assert.equal(bytes.byteLength,f.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);
    const target=join(dir,f.path);mkdirSync(join(target,'..'),{recursive:true});writeFileSync(target,bytes);
  }
  mkdirSync(join(dir,'node_modules/@sim'),{recursive:true});
  symlinkSync(join(dir,'packages/engine-contract'),join(dir,'node_modules/@sim/engine-contract'));
  symlinkSync(join(dir,'packages/protocol'),join(dir,'node_modules/@sim/protocol'));
  // Existing dependency, exact files unchanged; no download/install/root edit.
  symlinkSync(join(root,'apps/server/node_modules/zod'),join(dir,'node_modules/zod'));
  copyFileSync(new URL('camp-transition.v1.json',directory),join(dir,'fixture.json'));
  const script=`import {readFileSync} from 'node:fs';
    import {decodeSceneCapturePublication} from '@sim/protocol/scene-capture';
    const fixture=JSON.parse(readFileSync(new URL('./fixture.json',import.meta.url),'utf8'));
    for(const capture of fixture.captures){const parsed=decodeSceneCapturePublication(capture);if(parsed.ref.hash!==capture.ref.hash)throw Error('Wrong reference');}
    console.log(JSON.stringify({captures:fixture.captures.length,worldId:fixture.worldId}));`;
  // A saved module resolves scoped packages from the isolated tree, not cwd.
  writeFileSync(join(dir,'proof.mjs'),script);
  const output=execFileSync(process.execPath,[join(dir,'proof.mjs')],{encoding:'utf8'});
  assert.deepEqual(JSON.parse(output),{captures:2,worldId:fixture.worldId});
});
