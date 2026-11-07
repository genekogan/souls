// G2 (tranche 2026-10-19): one warm connection to the world for every CLI process in this folder.
//
// A CLI process lives for one command, so each opened its own TCP + TLS connection: ~0.22 s at 107 ms from the world,
// on every call. The folder's look keeper (warm.mjs, a long-lived background process) also runs a tiny localhost
// relay: it holds one HTTP/2 connection to the world (HTTP/1.1 keep-alive for plain-http worlds) and forwards the
// CLI's requests over it. The CLI finds it in .eden-god.wire.json (0600: a per-start secret, the world, the port).
// No keeper, a keeper for another world, a dead relay: the CLI goes direct, silently, as before.
import { createServer } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { atomicWrite } from './state.mjs';

import { godFile } from './seat.mjs';
export const WIRE = '.eden-god.wire.json';
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'host', 'http2-settings', 'te']);
const pidAlive = (pid) => { if (!Number.isSafeInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// ---------------------------------------------------------------- the relay (inside the keeper process)

/** Start the relay for `world` (the folder's world URL). Returns { port, close(), usedAt() }. Never throws for upstream trouble:
 *  a request that cannot reach the world answers 502 with `x-eden-god-wire-error: unsent|sent`. */
export async function startWire(world, { file = godFile(WIRE) } = {}) {
  const origin = new URL(world).origin, secret = randomBytes(18).toString('base64url');
  let used = 0, closed = false, mode = origin.startsWith('https:') ? 'h2' : 'h1', session = null;
  const agent = new (origin.startsWith('https:') ? https : http).Agent({ keepAlive: true, maxSockets: 8, keepAliveMsecs: 30_000 });
  // HTTP/2: one session; reconnect eagerly when the server closes an idle one, so the next call finds it warm
  const h2 = () => {
    if (session && !session.closed && !session.destroyed) return session;
    const s = http2.connect(origin);
    let up = false, born = 0;
    s.on('connect', () => { up = true; born = Date.now(); if (s.alpnProtocol && s.alpnProtocol !== 'h2') { mode = 'h1'; s.close(); } });
    s.on('error', () => { if (!up) mode = 'h1'; }); // a world that cannot speak HTTP/2: keep-alive HTTP/1.1 from now on
    s.on('close', () => { if (session === s) session = null; if (up && !closed && mode === 'h2' && Date.now() - born > 30_000) setTimeout(() => { if (!closed && !session) { try { h2(); } catch { /* lazily next time */ } } }, 1000).unref(); });
    s.unref();
    session = s;
    return s;
  };
  const fail = (res, phase) => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json', 'x-eden-god-wire-error': phase }); res.end(JSON.stringify({ ok: false, code: 'wire', phase })); } else res.destroy(); };
  const server = createServer((req, res) => {
    if (req.headers['x-eden-god-wire'] !== secret) { res.writeHead(403, { 'x-eden-god-wire-error': 'unsent' }); return res.end(); }
    const target = String(req.headers['x-eden-god-target'] ?? '');
    if (!target.startsWith(world + '/') && target !== world) { res.writeHead(400, { 'x-eden-god-wire-error': 'unsent' }); return res.end(); }
    used = Date.now();
    const u = new URL(target), headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && !k.startsWith('x-eden-god-wire') && k !== 'x-eden-god-target') headers[k] = v;
    const pipeBack = (status, h, body) => {
      const out = {}; for (const [k, v] of Object.entries(h)) if (!k.startsWith(':') && !HOP.has(k)) out[k] = v;
      res.writeHead(status, out); body.pipe(res);
    };
    if (mode === 'h2') {
      let s; try { s = h2(); } catch { return fail(res, 'unsent'); }
      const go = () => {
        let stream; try { stream = s.request({ ...headers, ':method': req.method, ':path': u.pathname + u.search, ':authority': u.host }); } catch { return fail(res, 'unsent'); }
        stream.on('response', (h) => pipeBack(h[':status'], h, stream));
        stream.on('error', () => fail(res, 'sent'));
        res.on('close', () => { if (!res.writableFinished) stream.close(http2.constants.NGHTTP2_CANCEL); });
        req.pipe(stream);
      };
      if (s.connecting) { // whichever comes first decides, once: a later session error must never resend this request
        let decided = false;
        const decide = (fn) => () => { if (decided) return; decided = true; s.off('connect', onConnect); s.off('error', onError); fn(); };
        const onConnect = decide(() => (mode === 'h2' ? go() : relayH1())), onError = decide(() => relayH1());
        s.once('connect', onConnect); s.once('error', onError);
      } else go();
      return;
    }
    relayH1();
    function relayH1() {
      if (res.headersSent) return;
      const up = (u.protocol === 'https:' ? https : http).request(u, { method: req.method, headers, agent }, (r) => pipeBack(r.statusCode, r.headers, r));
      up.on('error', () => fail(res, up.reusedSocket || up.writableEnded ? 'sent' : 'unsent'));
      res.on('close', () => { if (!res.writableFinished) up.destroy(); });
      req.pipe(up);
    }
  });
  server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.unref();
  const port = server.address().port;
  atomicWrite(file, JSON.stringify({ world, port, pid: process.pid, secret, at: Date.now() }));
  if (mode === 'h2') try { h2(); } catch { /* lazily */ } // warm now: the first CLI call should not pay the handshake
  else { const r = http.request(origin + '/', { method: 'HEAD', agent }); r.on('error', () => {}); r.on('response', (x) => x.resume()); r.end(); }
  return {
    port, usedAt: () => used,
    close() {
      closed = true; server.close(); session?.close(); agent.destroy();
      try { if (JSON.parse(readFileSync(file, 'utf8')).pid === process.pid) rmSync(file, { force: true }); } catch { /* gone */ }
    },
  };
}

// ---------------------------------------------------------------- the CLI side

let known; // undefined: not read yet; null: none (or found dead in this process)
function relayFor(url) {
  if (known === undefined) {
    known = null;
    if (!/^(0|off|false|no)$/i.test(process.env.EDEN_GOD_WIRE ?? '')) try {
      const w = JSON.parse(readFileSync(godFile(WIRE), 'utf8'));
      if (w?.port && w.secret && w.world && pidAlive(w.pid)) known = w;
    } catch { /* none */ }
  }
  return known && (url.startsWith(known.world + '/') || url === known.world) ? known : null;
}

/** fetch(), through the folder's relay when one serves this world. Falls back to a direct fetch when the relay is gone
 *  or says it sent nothing; a request it may have sent (a POST that failed mid-way) fails like a lost connection. */
export async function wireFetch(url, init = {}) {
  const w = relayFor(String(url));
  if (!w) return fetch(url, init);
  const headers = { ...(init.headers ?? {}), 'x-eden-god-wire': w.secret, 'x-eden-god-target': String(url) };
  let r;
  try { r = await fetch(`http://127.0.0.1:${w.port}/`, { ...init, headers }); }
  catch (e) {
    if (init.signal?.aborted) throw e;
    const refused = /ECONNREFUSED|ECONNRESET|EPIPE|ENOTFOUND/.test(String(e?.cause?.code ?? e?.code ?? ''));
    if (refused || !init.method || init.method === 'GET') { known = null; return fetch(url, init); }
    throw e;
  }
  const failed = r.headers.get('x-eden-god-wire-error'); // only the relay sets it
  if (failed === 'unsent' || (failed && (!init.method || init.method === 'GET'))) { await r.body?.cancel(); known = null; return fetch(url, init); }
  if (failed) { await r.body?.cancel(); throw new TypeError('fetch failed (the folder relay lost the connection to the world)'); }
  return r;
}
export const _resetWire = () => { known = undefined; };
