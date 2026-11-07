// Listening HTTP + the downloadable CLIs; two actual local dev-auth accounts,
// fresh SQLite worlds, native bodies and fake minds. No provider or live data.
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {serve} from '@hono/node-server';
import {marsFactory, GREEN_FIELD_WORLD} from '@souls/engine-mars';
import {coreRef} from '@souls/world-compiler';
import {Auth} from './auth.ts';
import {Brain} from './brain.ts';
import {config} from './config.ts';
import {Db} from './db.ts';
import {buildApp} from './http.ts';
import type {Hub} from './hub.ts';
import {Souls} from './souls.ts';
import {WorldHost} from './world.ts';
import {GodMode} from './god/god.ts';
import {tmpdir} from 'node:os';

const factory = await marsFactory({...GREEN_FIELD_WORLD, safeCrewRemoval: true});
const privateText = 'SYNTHETIC_ALICE_PRIVATE_INTENT';
const privatePreview = 'synthetic-alice-unpublished-bench';
const soulCLI = new URL('../../../tools/world-launcher/soul/eden-agent.mjs', import.meta.url).pathname;
const godCLI = new URL('../../../tools/god-skill/eden-god.mjs', import.meta.url).pathname;

async function world(t: TestContext, root: string, slug: string, port: number, owner: string) {
  const worldId = slug + '-1', db = new Db(join(root, slug + '.sqlite'));
  const host = new WorldHost(db, factory, 'safety-isolation', 1e9, worldId);
  host.boot(); host.drainInputs();
  const cfg = {...config, worldId, worldKey: slug, worldPath: '/w/' + slug,
    publicUrl: `http://127.0.0.1:${port}/w/${slug}`, authProvider: 'none' as const,
    accountAuthRequired: false, inviteRequired: false, brainMode: 'fake' as const,
    budgetUsdPerDay: 0, typesafeKey: undefined, anthropicKey: undefined, privyAppId: '', privyAppSecret: '',
    marsWebDir: join(root, 'no-mars'), webDir: join(root, 'no-web')};
  const auth = new Auth(cfg, db); auth.devAuth = true;
  const brain = new Brain(host, db, cfg, {clients: () => 0, onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {}, onTalk() {}});
  brain.quiesce();
  const souls = new Souls(host, db, brain, cfg); souls.enableLifecycle();
  const god = new GodMode(db, {worldId, ownerId: owner, tick: () => host.engine.world.tick, emit() {}, assetDir: join(root, 'assets')});
  const app = buildApp({cfg, db, host, auth, brain, souls, god, hub: {clients: new Map(), refreshMe() {}} as unknown as Hub});
  const server = serve({hostname: '127.0.0.1', port, fetch: request => {
    const url = new URL(request.url); if (url.pathname.startsWith(cfg.worldPath + '/')) url.pathname = url.pathname.slice(cfg.worldPath.length);
    return app.fetch(new Request(url, request));
  }});
  await new Promise<void>((resolve, reject) => {server.once('listening', resolve); server.once('error', reject);});
  // Run only the sequencer, without ticking autonomous minds or the world clock.
  const drain = setInterval(() => host.drainInputs(), 5);
  t.after(async () => {clearInterval(drain); await new Promise<void>(resolve => server.close(() => resolve())); brain.quiesce(); host.stop(); auth.close(); db.close();});
  const request = (path: string, token?: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => fetch(cfg.publicUrl + path, {
    method, headers: {...(token ? {authorization: 'Bearer ' + token} : {}), ...(body === undefined ? {} : {'content-type': 'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  return {db, host, souls, god, request, url: cfg.publicUrl};
}

async function cli(file: string, cwd: string, args: string[]) {
  return new Promise<{status: number | null; out: string; error: string}>((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {cwd, env: {...process.env, BRAIN_MODE: 'fake'}, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '', error = '';
    const timeout = setTimeout(() => {child.kill('SIGKILL'); reject(new Error('Isolation CLI exceeded 10 seconds.'));}, 10000);
    child.stdout.on('data', value => out += value); child.stderr.on('data', value => error += value);
    child.once('error', error => {clearTimeout(timeout); reject(error);}); child.once('close', status => {clearTimeout(timeout); resolve({status, out, error});});
  });
}

test('two dev-auth accounts cannot control, read private state, rename, delete or pair the other account’s residents/world', {timeout: 60000}, async t => {
  const scratch = process.env.SAFETY_ISOLATION_TMP ?? tmpdir(); mkdirSync(scratch, {recursive: true});
  const root = mkdtempSync(join(scratch, 'souls-two-account-'));
  const a = await world(t, root, 'safety-alice', 5880, 'dev:alice');
  const b = await world(t, root, 'safety-bob', 5881, 'dev:bob');
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const json = async (response: Response, status = 200) => {assert.equal(response.status, status, await response.clone().text()); return response.json() as Promise<any>;};
  const alice = (await json(await a.request('/v1/souls', 'dev:alice', {name: 'Alice Resident'}))).soul.id;
  const bob = (await json(await a.request('/v1/souls', 'dev:bob', {name: 'Bob Resident'}))).soul.id;
  await json(await a.request(`/v1/souls/${alice}/intent`, 'dev:alice', {intent: {goal: 'rest', note: privateText}}));
  const ref = a.db.internPrompt(privateText);
  a.db.saveBrainCall(a.host.worldId, {tick: 0, at: Date.now(), tier: 'compile', subject: 'private fixture', soulId: alice,
    model: 'fake', mode: 'fake', request: {system: [{text: ref}]}, response: {}, applied: {}, ms: 0,
    inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0});
  const original = a.db.soul(alice)!, beforeEvents = a.db.events(a.host.worldId).length;
  for (const suffix of ['', '/timeline', '/deck', '/perceive', '/mandate', '/talk']) {
    const response = await a.request('/v1/souls/' + alice + suffix, 'dev:bob');
    assert.equal(response.status, 403, suffix); assert.ok(!(await response.text()).includes(privateText));
  }
  for (const [path, body, method] of [
    [`/v1/souls/${alice}/command`, {text: 'stand up'}, 'POST'],
    [`/v1/souls/${alice}/intent`, {intent: {goal: 'wander'}}, 'POST'],
    [`/v1/souls/${alice}/mandate`, {text: 'do anything'}, 'POST'],
    [`/v1/souls/${alice}/profile`, {name: 'Stolen Name'}, 'PATCH'],
    [`/v1/souls/${alice}/pair`, {}, 'POST'],
    [`/v1/souls/${alice}/revoke`, {}, 'POST'],
    [`/v1/souls/${alice}`, undefined, 'DELETE'],
  ] as const) assert.equal((await a.request(path, 'dev:bob', body, method)).status, 403, path);
  assert.equal((await a.request('/v1/prompt/' + ref.$prompt, 'dev:bob')).status, 404);
  const calls = await json(await a.request('/v1/brain?soul=' + alice, 'dev:bob')); assert.deepEqual(calls.calls, []);
  const me = await json(await a.request('/v1/me', 'dev:bob')); assert.deepEqual(me.me.souls, [bob]);
  const pairing = await json(await a.request('/v1/agent/pair/start', undefined, {agent: 'Bob’s agent'}));
  assert.equal((await a.request('/v1/pair/approve', 'dev:bob', {code: pairing.user_code, soulId: alice})).status, 403);
  assert.equal((await json(await a.request('/v1/agent/pair/poll', undefined, {poll_token: pairing.poll_token}))).status, 'pending');
  assert.deepEqual(a.db.soul(alice), original); assert.equal(a.db.events(a.host.worldId).length, beforeEvents);
  assert.equal(await (await a.request('/v1/prompt/' + ref.$prompt, 'dev:alice')).text(), privateText, 'positive owner private read');
  const bobCode = await json(await a.request(`/v1/souls/${bob}/pair`, 'dev:bob', {}));
  const bobGrant = await json(await a.request('/v1/agent/pair', undefined, {code: bobCode.code}));
  const delegated = await json(await a.request('/v1/agent/account-me?soulId=' + alice, bobGrant.token));
  assert.deepEqual(delegated.me.souls, [bob], 'a supplied foreign ID cannot widen B’s delegated scope');
  assert.ok(!JSON.stringify(delegated).includes(privateText));
  assert.equal((await b.request('/v1/agent/soul', bobGrant.token)).status, 401, 'Soul grant from another world is invalid');
  // Public geometry remains public; private intent/prompt text must not ride along.
  for (const path of ['/v1/debug/world', '/v1/kernel', '/v1/log', '/v1/world', '/v1/world/snapshot']) {
    const response = await a.request(path, 'dev:bob'); assert.equal(response.status, 200, path);
    assert.ok(!(await response.text()).includes(privateText), path);
  }

  const ga = (await json(await a.request('/v1/god/mint', 'dev:alice', {}))).token;
  const gb = (await json(await b.request('/v1/god/mint', 'dev:bob', {}))).token;
  const preview = await json(await a.request('/v1/god/preview', ga, {ops: [{op: 'place', def: coreRef('bench'), name: privatePreview, p: [0, 0]}]}));
  assert.equal(preview.accepted, true, JSON.stringify(preview)); assert.ok(preview.id);
  for (const token of [undefined, 'dev:bob', gb]) {
    for (const path of ['/v1/god/snapshot', '/v1/god/edits', '/v1/god/prayers', '/v1/god/previews', '/v1/god/preview/' + preview.id]) {
      const response = await a.request(path, token); assert.equal(response.status, 401, path); assert.ok(!(await response.text()).includes(privatePreview));
    }
    for (const ops of [[{op: 'remove', id: 'world'}], [{op: 'set', id: 'world', name: 'Stolen World'}]])
      assert.equal((await a.request('/v1/god/act', token, {ops})).status, 401);
  }
  assert.equal((await a.request('/v1/god/mint', 'dev:bob', {})).status, 403);
  assert.equal((await a.request('/v1/god/claim', 'dev:bob', {})).status, 403);
  const godPair = await json(await a.request('/v1/god/pair/start', undefined, {agent: 'Bob world agent'}));
  assert.equal((await a.request('/v1/god/pair/approve', 'dev:bob', {code: godPair.user_code})).status, 403);
  assert.equal((await a.request('/v1/god/pairings', 'dev:bob')).status, 403);
  assert.equal((await json(await a.request('/v1/god/status', 'dev:bob'))).you, 'visitor');
  assert.equal((await a.request('/v1/god/preview/' + preview.id, ga)).status, 200, 'owner’s god token retains preview read');
  assert.ok(!(await (await a.request('/v1/world/snapshot', 'dev:bob')).text()).includes(privatePreview));

  // A forged selected Soul ID in B's own folder is insufficient, even when
  // passed through the actual downloadable CLI rather than hand-written HTTP.
  const soulDir = join(root, 'bob-soul'), godDir = join(root, 'bob-god'); mkdirSync(soulDir); mkdirSync(godDir);
  writeFileSync(join(soulDir, '.eden-agent.json'), JSON.stringify({world: a.url, identity: 'bob', soul: alice}), {mode: 0o600});
  for (const args of [['pair-soul', alice], ['observe'], ['profile', 'name', 'Stolen Name']]) {
    const result = await cli(soulCLI, soulDir, args); assert.ok(!result.out.includes(privateText));
    if (args[0] === 'profile') {const value = JSON.parse(result.out); assert.equal(value.accepted, false); assert.equal(value.code, 'profile.not-owned');}
    else {assert.equal(result.status, 1, result.out); assert.match(result.error, /not owned|HTTP 403/);}
  }
  // B can pair and use its own resident, so the negatives are not broken setup.
  const ownPair = await cli(soulCLI, soulDir, ['pair-soul', bob]); assert.equal(ownPair.status, 0, ownPair.error);
  const ownProfile = await cli(soulCLI, soulDir, ['profile']); assert.equal(JSON.parse(ownProfile.out).profile.soulId, bob);
  writeFileSync(join(godDir, '.eden-god.json'), JSON.stringify({world: a.url, identity: 'dev:bob', token: gb}), {mode: 0o600});
  for (const args of [['mint'], ['snapshot'], ['act', JSON.stringify({ops: [{op: 'remove', id: 'world'}]})]]) {
    const result = await cli(godCLI, godDir, args); assert.equal(result.status, 1, result.out); assert.match(result.error, /HTTP (401|403)/); assert.ok(!result.out.includes(privatePreview));
  }
  assert.deepEqual(a.db.soul(alice), original); assert.equal(a.god.owner, 'dev:alice'); assert.equal(a.god.model.editSeq, 0);
  assert.equal(a.db.paidCost(), 0); assert.equal(b.db.paidCost(), 0);
  t.diagnostic('Loopback5880/5881; two dev-auth users; owner/soul/world HTTP + downloadable CLIs; $0 model spend. Whole-world rename/delete have no public account API; Godmode edits and ownership takeover refused.');
});
