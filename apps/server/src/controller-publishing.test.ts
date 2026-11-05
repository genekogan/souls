import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from '../test/native-owner-fixture.ts';

test('single-controller CLI is distinct from retained legacy CLI and instructions preserve window binding',async t=>{
 const f=fixture(':memory:');f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 const dir=mkdtempSync(join(tmpdir(),'sim-controller-publish-'));
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

// #983: a world started without the launcher (no EDGE_CONTROLLER_CLI_FILE) serves the pinned controller CLI; the variable overrides it.
test('controllerCliFile defaults to the pinned eden.mjs; EDGE_CONTROLLER_CLI_FILE overrides it', async t => {
 const {execFileSync} = await import('node:child_process');
 const {createHash} = await import('node:crypto');
 const {readFileSync} = await import('node:fs');
 const configTs = new URL('./config.ts', import.meta.url).pathname, soulDir = new URL('../../../tools/world-launcher/soul/', import.meta.url).pathname;
 const configured = (value?: string) => { const env = {...process.env}; delete env.EDGE_CONTROLLER_CLI_FILE; if (value) env.EDGE_CONTROLLER_CLI_FILE = value;
  return execFileSync(process.execPath, ['--input-type=module', '-e', `const {config} = await import(${JSON.stringify(configTs)}); process.stdout.write(String(config.controllerCliFile));`], {env, encoding: 'utf8'}); };
 const pinned = JSON.parse(readFileSync(soulDir + 'SOURCES.json', 'utf8')).controllerCli;
 const unset = configured();
 assert.equal(unset, soulDir + pinned.file, 'unset: the pinned file');
 const dir = mkdtempSync(join(tmpdir(), 'sim-controller-default-')), custom = join(dir, 'custom.mjs'); writeFileSync(custom, '// a custom controller\n');
 assert.equal(configured(custom), custom, 'the variable overrides the default');
 const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
 f.souls.cfg.controllerCliFile = unset;
 const served = await f.request('/eden.mjs'); assert.equal(served.status, 200);
 assert.equal(createHash('sha256').update(Buffer.from(await served.arrayBuffer())).digest('hex'), pinned.sha256, 'the bytes SOURCES.json pins');
 f.souls.cfg.controllerCliFile = configured(custom);
 assert.equal(await (await f.request('/eden.mjs')).text(), '// a custom controller\n');
});
