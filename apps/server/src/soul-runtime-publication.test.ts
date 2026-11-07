import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Hono} from 'hono';
import {mountSoulRuntimePublication} from './soul-runtime-publication.ts';
test('runtime publication serves only named artifacts from configured controller directory',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-runtime-publication-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));mkdirSync(join(dir,'runtime'));writeFileSync(join(dir,'runtime/run.mjs'),'// pinned runtime');writeFileSync(join(dir,'runtime/manifest.json'),'{"version":"test"}');writeFileSync(join(dir,'private.json'),'private');
 const app=new Hono();let controller:string|undefined=join(dir,'eden.mjs');mountSoulRuntimePublication(app,()=>controller);
 const run=await app.request('/soul-runtime/run.mjs');assert.equal(run.status,200);assert.equal(await run.text(),'// pinned runtime');assert.match(run.headers.get('content-type')??'',/javascript/);assert.equal(run.headers.get('cache-control'),'public, max-age=60');
 assert.equal((await app.request('/soul-runtime/launch.mjs')).status,404);assert.equal((await app.request('/soul-runtime/private.json')).status,404);assert.equal((await app.request('/soul-runtime/../private.json')).status,404);assert.equal((await (await app.request('/soul-runtime/manifest.json')).json()).version,'test');
 controller=undefined;assert.equal((await app.request('/soul-runtime/run.mjs')).status,404);
});
