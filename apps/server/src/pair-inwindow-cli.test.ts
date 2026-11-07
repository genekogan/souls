// Lane PAIR-INWINDOW (Gene's review 2026-10-22 #1 + #2), the server half of his walk with the real CLI over listening HTTP:
// a fresh folder runs `pair-soul <id>` with no name and no window code; the request lands in the owner's window list within
// one poll, titled with the Soul's real name; another account never sees it or approves it; the owner's Approve succeeds and
// the agent's `approval wait` connects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serve} from '@hono/node-server';
import {marsFactory, GREEN_FIELD_WORLD} from '@souls/engine-mars';
import {buildApp} from './http.ts';
import type {Hub} from './hub.ts';
import type {AccountIdentity} from './accounts/store.ts';
import {fixture as worldFixture} from '../test/native-owner-fixture.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();

const CLI = process.env.PAIR_CLI ?? new URL('../../../tools/edge-skill/eden-agent.mjs', import.meta.url).pathname;
const cli = (cwd: string, args: string[], ms = 20000) => new Promise<{status: number | null; out: string; error: string}>((resolve, reject) => {
  const child = spawn(process.execPath, [CLI, ...args], {cwd, env: {...process.env, BRAIN_MODE: 'fake'}, stdio: ['ignore', 'pipe', 'pipe']});
  let out = '', error = ''; const timer = setTimeout(() => {child.kill('SIGKILL'); reject(new Error(`CLI ${args[0]} exceeded ${ms} ms: ${out}${error}`));}, ms);
  child.stdout.on('data', v => out += v); child.stderr.on('data', v => error += v);
  child.once('close', status => {clearTimeout(timer); resolve({status, out, error});});
});

test('pair-soul <id> from a fresh folder: owner window within one poll, real name, nobody else, Approve connects', {timeout: 90000}, async t => {
  const f = worldFixture(':memory:', await marsFactory({...GREEN_FIELD_WORLD, safeCrewRemoval: true})); f.brain.quiesce(); f.souls.enableLifecycle();
  f.souls.cfg.accountAuthRequired = true; f.souls.cfg.inviteRequired = false;
  const port = TEST_PORT, wp = '/w/pairtest', base = `http://127.0.0.1:${port}${wp}`; Object.assign(f.souls.cfg, {publicUrl: base, worldPath: wp});
  const ids = new Map<string, AccountIdentity>();
  for (const name of ['gene', 'other']) { const id = 'did:privy:' + name; f.db.upsertUser({id, email: null, wallet: null, role: 'user'}); ids.set(name, {id, issuer: 'privy.io/test-app', subject: id, verifiedAt: Date.now(), expiresAt: Date.now() + 600_000}); }
  f.auth.accountFromToken = async token => { const identity = ids.get(token ?? ''); return identity ? {identity, user: f.db.user(identity.id)!} : null; };
  const original = f.auth.userFromToken.bind(f.auth); f.auth.userFromToken = async token => ids.has(token ?? '') ? f.db.user(ids.get(token!)!.id)! : original(token);
  Object.defineProperty(f.auth, 'ready', {value: true}); // the provider is stood in for by accountFromToken above
  const app = buildApp({cfg: f.souls.cfg, db: f.db, host: f.host, souls: f.souls, brain: f.brain, auth: f.auth, hub: {clients: new Map(), refreshMe() {}} as unknown as Hub});
  const server = serve({hostname: '127.0.0.1', port, fetch: request => { const url = new URL(request.url); if (url.pathname.startsWith(wp + '/')) url.pathname = url.pathname.slice(wp.length); return app.fetch(new Request(url, request)); }});
  await new Promise<void>((resolve, reject) => {server.once('listening', resolve); server.once('error', reject);});
  const drain = setInterval(() => f.host.drainInputs(), 5);
  const root = mkdtempSync(join(tmpdir(), 'pair-inwindow-'));
  t.after(async () => {clearInterval(drain); await new Promise<void>(r => server.close(() => r())); f.host.stop(); f.db.close(); rmSync(root, {recursive: true, force: true});});
  const call = async (path: string, token?: string, body?: unknown) => { const r = await fetch(`${base}${path}`, {method: body === undefined ? 'GET' : 'POST', headers: {...(token ? {authorization: 'Bearer ' + token} : {}), ...(body === undefined ? {} : {'content-type': 'application/json'})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})}); return {status: r.status, data: await r.json().catch(() => null) as any}; };
  const wait = async (dir: string) => { for (let i = 0; i < 60; i++) { const r = await cli(dir, ['approval', 'status']); if (/"token"|"status":\s*"ready"/.test(r.out)) return r; await new Promise(res => setTimeout(res, 250)); } return cli(dir, ['approval', 'status']); };

  // the owner's Soul, made the ordinary way: a create request the owner approves
  const first = join(root, 'first'); (await import('node:fs')).mkdirSync(first);
  const reg = await cli(first, ["register", base]); assert.equal(reg.status, 0, reg.out + reg.error);
  const made = await cli(first, ['create-soul', 'Longrun Test']); assert.equal(made.status, 0, made.out + made.error);
  const createId = JSON.parse(made.out).approvalId;
  assert.equal((await call(`/v1/account/approvals/${createId}/approve`, 'gene', {})).status, 200);
  const ready = await wait(first); const soulId = (await call(`/v1/account/approvals/${createId}`, 'gene')).data.approval.soulId;
  assert.match(soulId, /^s_/, ready.out);

  // Gene's path: a fresh folder knows only the ID
  const fresh = join(root, 'fresh'); (await import('node:fs')).mkdirSync(fresh);
  assert.equal((await cli(fresh, ['register', base])).status, 0);
  const t0 = Date.now(), pair = await cli(fresh, ['pair-soul', soulId]);
  assert.equal(pair.status, 0, pair.out + pair.error);
  const printed = JSON.parse(pair.out);
  assert.equal(printed.delivery, 'window'); assert.equal(printed.name, 'Longrun Test'); assert.match(printed.next, /open Sim window/);
  const listed = (await call('/v1/account/approvals', 'gene')).data.approvals, ms = Date.now() - t0;
  assert.deepEqual(listed.map((a: any) => [a.id, a.name, a.soulId, a.mode]), [[printed.approvalId, 'Longrun Test', soulId, 'repair']]);
  assert.ok(ms < 3000, `in the owner's window list within one poll interval (${ms} ms)`);
  assert.deepEqual((await call('/v1/account/approvals', 'other')).data.approvals, [], 'another account never sees it');
  assert.equal((await call(`/v1/account/approvals/${printed.approvalId}`, 'other')).status, 403);
  assert.equal((await call(`/v1/account/approvals/${printed.approvalId}/approve`, 'other', {})).status, 403);
  const approved = await call(`/v1/account/approvals/${printed.approvalId}/approve`, 'gene', {});
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const connected = await wait(fresh);
  assert.match(connected.out, /ready/, connected.out + connected.error);
  console.log(JSON.stringify({pairToWindowListMs: ms, delivery: printed.delivery, title: listed[0].name, approve: approved.status, wait: JSON.parse(connected.out).status}));
});
