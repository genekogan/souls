// #1181: the release build refuses a source outside its list, and nothing ran it, so a new import stopped it unseen for months.
// This runs the same bundling on every change. build.mjs itself needs a clean tree and writes a release, so it isn't run here.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {relative,resolve} from 'node:path';
import {isRuntimeSource} from './build-inputs.mjs';
const root=realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
const {build}=createRequire(realpathSync(resolve(root,'apps/web/node_modules/vite/package.json')))('esbuild');
test('both runtime entry points bundle from listed sources only',async()=>{
 for(const file of ['run.mjs','launch.mjs']){
  const {metafile}=await build({absWorkingDir:root,entryPoints:['tools/soul-runtime/'+file],bundle:true,platform:'node',format:'esm',target:'node22',write:false,metafile:true,outfile:file});
  const unlisted=Object.keys(metafile.inputs).map(p=>relative(root,realpathSync(resolve(root,p)))).filter(p=>!isRuntimeSource(p));
  assert.deepEqual(unlisted,[],file);
 }
});
test('the rest of soul-trace stays out',()=>{
 for(const local of ['tools/soul-trace/tap.mjs','tools/soul-trace/readout.mjs','tools/soul-trace/inspect.mjs','../tools/soul-runtime/run.mjs','apps/server/src/main.ts'])assert.equal(isRuntimeSource(local),false,local);
 for(const local of ['tools/soul-runtime/run.mjs','tools/soul-trace/sink.mjs','tools/soul-trace/host.mjs'])assert.equal(isRuntimeSource(local),true,local);
});
