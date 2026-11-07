import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from '../test/native-owner-fixture.ts';

test('single-controller CLI is distinct from retained legacy CLI and instructions preserve window binding',async t=>{
 const f=fixture(':memory:');f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 const dir=mkdtempSync(join(tmpdir(),'souls-controller-publish-'));
 const legacy='// retained old CLI\n',current='// new thin controller CLI\n';
 f.souls.cfg.cliFile=join(dir,'legacy.mjs');f.souls.cfg.controllerCliFile=join(dir,'eden.mjs');
 f.souls.cfg.skillFile=join(dir,'skill.md');f.souls.cfg.instructionsFile=join(dir,'instructions.md');
 writeFileSync(f.souls.cfg.cliFile,legacy);writeFileSync(f.souls.cfg.controllerCliFile,current);
 writeFileSync(f.souls.cfg.skillFile,'Use {{BASE}}/eden.mjs');
 writeFileSync(f.souls.cfg.instructionsFile,'Fetch {{BASE}}/eden.mjs then node eden.mjs create Wren{{FOR}}. {{APPROVE}}');
 const old=await f.request('/eden-agent.mjs'),next=await f.request('/eden.mjs');
 assert.equal(old.status,200);assert.equal(await old.text(),legacy);
 assert.equal(next.status,200);assert.equal(await next.text(),current);
 assert.match(next.headers.get('content-type')??'',/text\/javascript/);
 const guide=await f.request('/instructions.md?for=ABCD-EFGH');assert.equal(guide.status,200);
 const text=await guide.text();assert.match(text,/node eden.mjs create Wren --for ABCD-EFGH/);assert.doesNotMatch(text,/\{\{/);
 assert.equal(guide.headers.get('cache-control'),'no-store');
 assert.match(await (await f.request('/skill.md')).text(),/\/w\/eden\/eden.mjs/);
 f.souls.cfg.controllerCliFile=undefined;
 assert.equal((await f.request('/eden.mjs')).status,404,'absence cannot serve the old CLI under the new name');
 assert.equal(await (await f.request('/eden-agent.mjs')).text(),legacy);
});
