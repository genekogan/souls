import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import type { Session } from '../auth-session.ts';

// Separate bundles model separate world documents; storage remains origin-shared.
const code = buildSync({ stdin: { contents: 'export * from "./god-api.ts"; export {publishSession} from "../auth-session.ts";', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
type Api = typeof import('./god-api.ts') & Pick<typeof import('../auth-session.ts'), 'publishSession'>;
const account = (scope = 'one'): Session => ({ mode: 'clerk', ready: true, authed: true, scope, label: 'Same label', getToken: async () => scope, login() {}, logout() {} });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const response = (token: string) => Response.json({ token });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(t: TestContext) {
  const storage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
  for (const [key, value] of Object.entries({ location: { pathname: '/w/first' }, window: {}, localStorage: storage(), sessionStorage: storage() })) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (before) Object.defineProperty(globalThis, key, before); else Reflect.deleteProperty(globalThis, key); });
  }
  const load = (world = 'first', publications = [account()]) => {
    Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: { pathname: `/w/${world}` } });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(createRequire(import.meta.url), module, module.exports);
    const api = module.exports as Api; for (const state of publications) api.publishSession(state); return api;
  };
  return { load };
}

test('concurrent owner callers share one mint; a stored token makes no request', async t => {
  const api = fixture(t).load(), mint = deferred<Response>();
  const fetch = t.mock.method(globalThis, 'fetch', () => mint.promise);
  const callers = Array.from({ length: 8 }, () => api.ensureToken());
  await flush(); assert.equal(fetch.mock.callCount(), 1);
  mint.resolve(response('god_first-1_ready'));
  assert.deepEqual(await Promise.all(callers), Array(8).fill('god_first-1_ready'));
  assert.equal(await api.ensureToken(), 'god_first-1_ready'); assert.equal(fetch.mock.callCount(), 1);
});

for (const placeholderReady of [false, true]) test(`remembered token survives Clerk binding startup (placeholder ready=${placeholderReady})`, async t => {
  const { load } = fixture(t);
  localStorage.setItem('sim.godToken:first', 'god_first-1_remembered');
  sessionStorage.setItem('sim.godToken', 'god_first-1_remembered');
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw Error('must reuse the adopted token'); });
  const binding = { ...account(), authed: false, scope: null, label: null, getToken: async () => null };
  const api = load('first', [{ ...binding, ready: placeholderReady }, { ...binding, label: 'Same label' }, account()]);
  assert.equal(await api.ensureToken(), 'god_first-1_remembered'); assert.equal(fetch.mock.callCount(), 0);
  api.forgetToken(); assert.equal(api.storedToken(), null, 'explicit sign-out still clears stored authority');
});

test('a rejected mint rejects all callers and permits an explicit retry', async t => {
  const api = fixture(t).load(), mint = deferred<Response>();
  const fetch = t.mock.method(globalThis, 'fetch', () => mint.promise);
  const callers = Promise.allSettled([api.ensureToken(), api.ensureToken()]);
  await flush(); mint.resolve(Response.json({ message: 'busy' }, { status: 429 }));
  const results = await callers;
  assert.ok(results.every(r => r.status === 'rejected' && r.reason.message === 'busy'));
  assert.equal(api.storedToken(), null); assert.equal(fetch.mock.callCount(), 1, 'no automatic retry');
  fetch.mock.mockImplementation(async () => response('god_first-1_retry'));
  assert.equal(await api.ensureToken(), 'god_first-1_retry'); assert.equal(fetch.mock.callCount(), 2);
});

test('an old account result cannot reach callers, populate storage or clear the new flight', async t => {
  const api = fixture(t).load(), first = deferred<Response>(), second = deferred<Response>();
  const fetch = t.mock.method(globalThis, 'fetch', () => first.promise);
  const old = assert.rejects(api.ensureToken(), /Sign-in changed/); await flush();
  api.publishSession(account('two'));
  fetch.mock.mockImplementation(() => second.promise);
  const current = api.ensureToken(); await flush(); assert.equal(fetch.mock.callCount(), 2);
  first.resolve(response('god_first-1_old')); await old;
  assert.equal(api.storedToken(), null);
  const joined = api.ensureToken(); await flush(); assert.equal(fetch.mock.callCount(), 2);
  second.resolve(response('god_first-1_new'));
  assert.deepEqual(await Promise.all([current, joined]), ['god_first-1_new', 'god_first-1_new']);
});

test('sign-out while reading auth prevents dispatch; rejected flight is recoverable', async t => {
  const api = fixture(t).load(), auth = deferred<string | null>();
  api.publishSession({ ...account(), getToken: () => auth.promise });
  const fetch = t.mock.method(globalThis, 'fetch', async () => response('god_first-1_again'));
  const old = assert.rejects(api.ensureToken(), /Sign-in changed/);
  api.publishSession({ ...account(), authed: false, scope: null, getToken: async () => null });
  auth.resolve('old-account'); await old; assert.equal(fetch.mock.callCount(), 0);
  api.publishSession(account());
  assert.equal(await api.ensureToken(), 'god_first-1_again'); assert.equal(fetch.mock.callCount(), 1);
});

test('same-account token-reader refresh keeps a pending flight', async t => {
  const api = fixture(t).load(), mint = deferred<Response>();
  const fetch = t.mock.method(globalThis, 'fetch', () => mint.promise);
  const first = api.ensureToken(); await flush();
  api.publishSession({ ...account(), getToken: async () => 'refreshed-bearer' });
  const second = api.ensureToken(); await flush(); assert.equal(fetch.mock.callCount(), 1);
  mint.resolve(response('god_first-1_current'));
  assert.deepEqual(await Promise.all([first, second]), ['god_first-1_current', 'god_first-1_current']);
});

test('explicit token clearing invalidates an in-flight mint before it can restore storage', async t => {
  const api = fixture(t).load(), mint = deferred<Response>();
  t.mock.method(globalThis, 'fetch', () => mint.promise);
  const pending = assert.rejects(api.ensureToken(), /Sign-in changed/); await flush();
  api.forgetToken(); mint.resolve(response('god_first-1_obsolete')); await pending;
  assert.equal(api.storedToken(), null);
});

test('different world documents never share a pending mint or the other world token', async t => {
  const { load } = fixture(t), first = load('first'), a = deferred<Response>(), b = deferred<Response>();
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', (url: string | URL | Request) => { paths.push(String(url)); return String(url).includes('/w/first/') ? a.promise : b.promise; });
  const one = first.ensureToken(); await flush();
  const second = load('second'), two = second.ensureToken(); await flush();
  assert.deepEqual(paths, ['/w/first/v1/god/mint', '/w/second/v1/god/mint']);
  a.resolve(response('god_first-1_ready')); b.resolve(response('god_second-1_ready'));
  assert.deepEqual(await Promise.all([one, two]), ['god_first-1_ready', 'god_second-1_ready']);
  assert.equal(first.storedToken(), 'god_first-1_ready'); assert.equal(second.storedToken(), 'god_second-1_ready');
});

test('concurrent 401s share replacement mint and a late old-token 401 cannot erase it', async t => {
  const api = fixture(t).load(); api.keepToken('god_first-1_expired');
  const mint = deferred<Response>(), late = deferred<Response>(); let mints = 0, expired = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/mint')) { mints++; return mint.promise; }
    if ((init?.headers as Record<string, string>).authorization === 'Bearer god_first-1_expired') {
      if (++expired === 3) return late.promise;
      return Response.json({}, { status: 401 });
    }
    return Response.json({ ok: true });
  });
  const requests = [api.god('/v1/god/edits'), api.god('/v1/god/edits'), api.god('/v1/god/edits')];
  await flush(); assert.equal(mints, 1);
  mint.resolve(response('god_first-1_replacement')); await requests[0]; await requests[1];
  late.resolve(Response.json({}, { status: 401 })); await requests[2];
  assert.equal(mints, 1); assert.equal(api.storedToken(), 'god_first-1_replacement');
});
