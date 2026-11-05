#!/usr/bin/env node
// Read-only localhost inspector over a soul-trace/1 file (#624). It serves the
// same reconstruction as `readout.mjs --json` to a small page. It only reads the
// trace file: it never contacts the world, never starts, stops or owns a runner or
// listener, and has no write or control endpoint. Access follows the local-dashboard
// pattern (tools/edge-skill/client-dashboard.mjs): loopback bind, exact Host check,
// cross-site refusal, a per-run token exchanged for a SameSite=Strict cookie and a
// nonce CSP. Every trace string reaches the page as JSON and is rendered as text.
import {createServer} from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {openSync, fstatSync, readSync, closeSync} from 'node:fs';
import {basename, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {reconstruct} from './readout.mjs';

export const MAX_TRACE_BYTES = 16 * 1024 * 1024;
const COOKIE = 'soul_trace_inspector';

// Re-reads and reconstructs only when the file's size or mtime changed.
export function loadTrace(file, cache = {}) {
  let fd;
  try { fd = openSync(file, 'r'); } catch { return {key: 'missing', status: 200, waiting: true, error: 'waiting for the trace file to appear'}; }
  try {
    const s = fstatSync(fd);
    if (!s.isFile()) return {key: 'not-file', status: 400, error: 'trace path is not a regular file'};
    const key = `${s.size}:${s.mtimeMs}`;
    if (cache.key === key) return cache;
    if (s.size > MAX_TRACE_BYTES) return {key, status: 413, error: `trace is ${s.size} bytes; the inspector reads at most ${MAX_TRACE_BYTES}`};
    const buf = Buffer.alloc(s.size);
    let n = 0;
    while (n < s.size) { const r = readSync(fd, buf, n, s.size - n, n); if (!r) break; n += r; }
    const trace = reconstruct(buf.subarray(0, n).toString('utf8'));
    return {key, status: 200, bytes: n, trace};
  } finally { closeSync(fd); }
}

const same = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function startInspector({file, port = 0} = {}) {
  if (!file) throw Error('trace file required');
  file = resolve(file);
  const token = randomBytes(24).toString('hex'), name = basename(file);
  let origin = null, cache = {};
  const sockets = new Set();
  const reply = (res, status, data, extra = {}) => {
    res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra});
    res.end(JSON.stringify(data));
  };
  const server = createServer((req, res) => {
    try {
      const site = req.headers['sec-fetch-site'];
      if (req.headers.host !== origin.slice(7) || (site && !['same-origin', 'none'].includes(site)) || (req.headers.origin && req.headers.origin !== origin)) return reply(res, 403, {error: 'local page required'});
      if (req.method !== 'GET') return reply(res, 405, {error: 'read-only inspector'}, {allow: 'GET'});
      const u = new URL(req.url, origin);
      const cookie = (req.headers.cookie ?? '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
      const session = same(cookie, token);
      if (u.pathname === '/') {
        if (!session && !same(u.searchParams.get('token'), token)) return reply(res, 403, {error: 'open the link the inspector printed'});
        const nonce = randomBytes(16).toString('base64');
        res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
          'set-cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
          'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`});
        return res.end(page(nonce));
      }
      if (u.pathname === '/trace.json') {
        if (!session) return reply(res, 403, {error: 'local session required'});
        cache = loadTrace(file, cache);
        if (cache.status !== 200 || cache.waiting) return reply(res, cache.status, {file: name, key: cache.key, error: cache.error});
        if (u.searchParams.get('known') === cache.key) return reply(res, 200, {file: name, key: cache.key, unchanged: true});
        return reply(res, 200, {file: name, key: cache.key, bytes: cache.bytes, trace: cache.trace});
      }
      if (u.pathname === '/favicon.ico') { res.writeHead(204, {'cache-control': 'no-store'}); return res.end(); }
      return reply(res, 404, {error: 'not found'});
    } catch { return reply(res, 500, {error: 'inspector error'}); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  server.on('connection', s => { sockets.add(s); s.once('close', () => sockets.delete(s)); });
  await new Promise((r, j) => { server.once('error', j); server.listen(port, '127.0.0.1', r); });
  origin = 'http://127.0.0.1:' + server.address().port;
  return {origin, url: origin + '/?token=' + token, address: server.address(),
    close: () => new Promise(r => { server.close(r); for (const s of sockets) s.destroy(); })};
}

// Static page; all data arrives from /trace.json and is placed with text nodes only.
function page(nonce) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Soul trace inspector</title>
<style nonce="${nonce}">
:root{--bg:#f5f3ec;--fg:#203229;--muted:#5b6b62;--card:#fff;--line:#d9d5c8;--warn:#9a4a12;--ok:#2f6b3a}
@media (prefers-color-scheme:dark){:root{--bg:#161b18;--fg:#e4e9e5;--muted:#9aa89f;--card:#1f2622;--line:#34403a;--warn:#e0a060;--ok:#8fcf98}}
body{font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg);max-width:1040px;margin:0 auto;padding:16px}
h1{font-size:1.3em;margin:.2em 0}h2{font-size:1.05em;margin:1.4em 0 .4em}
.muted{color:var(--muted)}.warn{color:var(--warn)}.ok{color:var(--ok)}
input{font:inherit;padding:.35em .5em;width:min(100%,360px);background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px}
details{background:var(--card);border:1px solid var(--line);border-radius:8px;margin:.5em 0;padding:.5em .8em}
summary{cursor:pointer;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;font-size:.93em}td,th{border-top:1px solid var(--line);padding:.25em .4em;text-align:left;vertical-align:top;overflow-wrap:anywhere}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85em;background:var(--bg);padding:.6em;border-radius:6px;max-height:320px;overflow:auto}
.row{margin:.15em 0}.mono{font-family:ui-monospace,monospace}
</style>
<h1>Soul trace inspector</h1>
<p class="muted">Read-only view of a local trace. A reconstruction from captured records, not a replay. Times marked ≈ cross clocks and are approximate; host time between delivery and the next command is unattributed.</p>
<p id="status" class="muted">Loading…</p>
<input id="filter" type="search" placeholder="Filter episodes (id, capability, code, command)" aria-label="Filter episodes">
<h2 id="epH">Episodes</h2><div id="episodes"></div>
<h2 id="unH">Acts with unknown origin</h2><div id="unlinked"></div>
<h2 id="anH">Anomalies</h2><div id="anomalies"></div>
<h2 id="prH">Processes</h2><div id="processes"></div>
<script nonce="${nonce}">
const $=id=>document.getElementById(id);
const h=(tag,cls,...kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of kids.flat())if(k!=null)e.append(k instanceof Node?k:String(k));return e;};
const clock=at=>typeof at==='number'?new Date(at).toISOString().slice(11,23)+'Z':'?';
const secs=ms=>typeof ms==='number'?(ms/1000).toFixed(3)+' s':'?';
const bounded=v=>{const s=JSON.stringify(v,null,1);return s.length>20000?s.slice(0,20000)+'\\n… '+(s.length-20000)+' more characters not shown':s;};
const open=new Set();let known='',data=null;
history.replaceState(null,'','/');
function actRows(a,from){
  const t=h('table');t.append(h('tr',null,h('th',null,'request'),h('th',null,'result'),h('th',null,'duration'),h('th',null,'at')));
  for(const x of a.attempts)t.append(h('tr',null,h('td','mono',(a.op?'op '+String(a.op).slice(0,8)+' ':'')+'attempt '+x.attempt),
    h('td',x.accepted===false||x.status===0||x.status>=400?'warn':null,x.status===0?'unreachable':x.status+(x.accepted===false?' refused':'')+(x.code?' '+x.code:'')),
    h('td',null,(x.durationMs??'?')+' ms (process clock)'),h('td',null,'+'+secs(x.at-from)+' local')));
  const box=h('div');
  if(a.link==='requested')box.append(h('div','row muted','Linked by the CLI\\'s requested for; the world returned no link.'));
  box.append(t);
  if(a.receipt){const r=a.receipt,k=r.ticks;
    box.append(h('div','row','Receipt ',h('span','mono',r.id),' ',r.capability??'',': accepted t'+(k.accepted??'?')+' → started t'+(k.started??'?')+' → ended t'+(k.ended??'?')+' = ',h('b',r.terminal==='completed'?'ok':'warn',r.terminal??'no terminal observed'),r.code?' ('+r.code+')':'',' [world ticks]'));
    if(k.accepted!=null&&k.started!=null)box.append(h('div','row muted','accepted→started '+(k.started-k.accepted)+' ticks; started→ended '+(k.ended!=null?(k.ended-k.started)+' ticks':'open')));}
  return box;}
function actSummary(a){return a.receipt?(a.receipt.capability??a.receipt.id)+' → '+(a.receipt.terminal??'open'):(a.outcome+(a.code?' '+a.code:''));}
function episode(e){
  const id=e.origin.id,d=h('details');d.open=open.has(id);d.ontoggle=()=>{d.open?open.add(id):open.delete(id);};
  const gap=e.firstCommand?e.firstCommand.at-e.deliveredAt:null;
  d.append(h('summary',null,h('b','mono',id),'  sent '+(e.origin.sentAt?clock(e.origin.sentAt)+' (server)':'— time missing'),
    ' · '+(e.acts.length?e.acts.map(actSummary).join(', '):'no linked act')));
  d.append(h('div','row','Delivered '+clock(e.deliveredAt)+' local'+(e.origin.sentAt?' ≈ +'+secs(e.deliveredAt-e.origin.sentAt)+' after send (server→local clocks, skew unknown)':'')));
  d.append(h('div','row',e.firstCommand?['First command ',h('span','mono',e.firstCommand.command??'?'),' +'+secs(gap)+' later: ',h('b',null,'unattributed host time'),' (reasoning, tools, process spawn)']:'No later command captured.'));
  for(const x of e.inbox)d.append(h('div','row muted','inbox '+x.verb+' → '+x.status+' +'+secs(x.at-e.deliveredAt)));
  if(!e.acts.length)d.append(h('div','row muted','No act linked by for to this message.'));
  for(const a of e.acts)d.append(actRows(a,e.deliveredAt));
  const raw=h('details');raw.append(h('summary','muted','Episode JSON (bounded)'),h('pre',null,bounded(e)));d.append(raw);
  return d;}
function haystack(v){return JSON.stringify(v).toLowerCase();}
function draw(){
  if(!data)return;const t=data.trace,q=$('filter').value.trim().toLowerCase();
  const eps=t.episodes.filter(e=>!q||haystack(e).includes(q));
  $('status').replaceChildren(h('span',null,data.file+' — '+t.records+' records, '+t.processes.length+' processes, '+t.episodes.length+' episodes, '),
    h('span',t.anomalies.length?'warn':'ok',t.anomalies.length+' anomalies'),h('span','muted',' · checked '+clock(Date.now())));
  $('epH').textContent='Episodes ('+eps.length+(q?' of '+t.episodes.length:'')+')';
  $('episodes').replaceChildren(...(eps.length?eps.map(episode):[h('p','muted',q?'No episode matches.':'No owner-message episode in this trace yet.')]));
  $('unH').textContent='Acts with unknown origin ('+t.unlinked.length+')';
  $('unlinked').replaceChildren(...t.unlinked.map(a=>{const d=h('details');d.append(h('summary',null,actSummary(a)+(a.origin.for?' (for '+a.origin.for+', not delivered in this trace)':'')),actRows(a,a.attempts[0]?.at));return d;}));
  $('anH').textContent='Anomalies ('+t.anomalies.length+')';
  $('anomalies').replaceChildren(...(t.anomalies.length?t.anomalies.map(x=>h('div','row warn',h('b',null,x.type),' ',h('span','mono',JSON.stringify(x)))):[h('p','ok','None detected.')]));
  const pt=h('table');pt.append(h('tr',null,h('th',null,'command'),h('th',null,'process'),h('th',null,'started'),h('th',null,'duration'),h('th',null,'exit')));
  for(const p of t.processes)pt.append(h('tr',null,h('td','mono',p.command??'?'),h('td','mono',String(p.proc).slice(0,8)),h('td',null,clock(p.startAt)),h('td',null,p.durationMs!=null?p.durationMs+' ms':p.closed?'?':'still open'),h('td',null,p.exitCode??'—')));
  $('processes').replaceChildren(pt);}
async function poll(){
  try{const r=await fetch('/trace.json?known='+encodeURIComponent(known));const d=await r.json();
    if(d.error){$('status').replaceChildren(h('span','warn',(d.file?d.file+': ':'')+d.error));known='';}
    else if(!d.unchanged){data=d;known=d.key;draw();}
    else $('status').lastChild&&($('status').lastChild.textContent=' · checked '+clock(Date.now()));}
  catch{$('status').replaceChildren(h('span','warn','Inspector not reachable; the trace and the world are unaffected.'));}
  setTimeout(poll,1500);}
$('filter').oninput=draw;poll();
</script>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), at = args.indexOf('--port');
  const port = at >= 0 ? Number(args[at + 1]) : 0, file = args.find((a, i) => !a.startsWith('--') && i !== at + 1);
  if (!file || !Number.isSafeInteger(port) || port < 0 || port > 65535) { process.stderr.write('usage: node tools/soul-trace/inspect.mjs <trace.jsonl> [--port N]\n'); process.exit(2); }
  const ins = await startInspector({file, port});
  process.stdout.write(`soul-trace inspector (read-only) at ${ins.url}\n`);
  const stop = () => ins.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
