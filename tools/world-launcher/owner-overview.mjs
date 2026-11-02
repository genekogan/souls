// /ops is an isolated, read-only surface. It never fetches GitHub or starts worlds.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { presentSnapshot, validateSnapshot } from './owner-overview-data.mjs';
const HEADERS = { 'cache-control': 'private, no-store, max-age=0', vary: 'Authorization, Cookie', 'x-robots-tag': 'noindex, nofollow, noarchive', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' };
export function ownerOverview({ dataDir, auth, allowed, base = '', now = Date.now }) {
  let last = null, signature = null, failure = null;
  const file = join(dataDir, 'owner-overview.json');
  function snapshot() {
    try {
      const s = statSync(file);
      if (s.size > 512 * 1024 || !s.isFile()) throw new Error('invalid snapshot');
      const sig = `${s.ino}:${s.mtimeMs}:${s.size}`;
      if (sig !== signature) { const parsed = validateSnapshot(JSON.parse(readFileSync(file, 'utf8'))); last = parsed; signature = sig; }
      failure = null;
    } catch { failure = 'unavailable'; }
    return presentSnapshot(last, now(), failure);
  }
  async function handle(req, res, url) {
    const respond = (status, value, headers = {}) => res.writeHead(status, { ...HEADERS, 'content-type': 'application/json; charset=utf-8', ...headers }).end(req.method === 'HEAD' ? undefined : JSON.stringify(value));
    if (!['GET', 'HEAD'].includes(req.method)) { respond(405, { ok: false, code: 'read-only' }, { allow: 'GET, HEAD' }); return; }
    if (url.pathname !== '/ops' && url.pathname !== `${base}/ops`) { respond(404, { ok: false, code: 'not-found' }); return; }
    if (!url.searchParams.has('json')) {
      const page = overviewShell(auth?.public, base);
      res.writeHead(200, { ...HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': page.csp }).end(req.method === 'HEAD' ? undefined : page.html); return;
    }
    // Never use health's loopback bypass or its legacy flagship-world owner fallback.
    // Explicit account configuration survives renaming/deleting worlds. No owner config = fail closed.
    const owners = String(process.env.SIM_SITE_OWNERS || process.env.CATALOG_GENE_OWNER_ID || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!auth || !owners.length) { respond(503, { ok: false, code: 'owner-access-unconfigured' }); return; }
    let status; try { status = await allowed(req, false); } catch { status = 401; }
    if (status !== 200) { respond(status, { ok: false, code: status === 403 ? 'not-owner' : status === 429 ? 'busy' : 'sign-in' }); return; }
    respond(200, snapshot());
  }
  return { handle };
}
function browser() {
  const $ = s => document.querySelector(s);
  let clerk = null, clerkReady = null, identity = null, identityVersion = 0;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = v => v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown';
  // Defense in depth: do not navigate arbitrary snapshot URLs, even if a future collector regresses.
  const safe = v => typeof v === 'string' && /^https:\/\/github\.com\/genekogan\/souls\/(issues\/\d+|pull\/\d+|releases\/tag\/[\w.-]+|commit\/[a-f0-9]+)(#[\w-]+)?$/.test(v);
  const link = (url, label) => safe(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label);
  function gate(message, signin = false) {
    $('#board').replaceChildren(); $('#board').hidden = true; $('#gate').hidden = false;
    $('#gate-message').textContent = message; $('#sign-in').hidden = !signin; $('#status').textContent = 'Private owner view';
  }
  const identityOf = (session, user) => session ? String(session.id) + '/' + String(user?.id ?? session.user?.id ?? '') : null;
  async function signIn() {
    if (!CFG.key || !CFG.issuer) { gate('Owner access is not configured.'); return false; }
    try {
      if (!clerkReady) clerkReady = (async () => {
        await new Promise((ok, no) => {
          const s = document.createElement('script'); s.src = CFG.issuer + '/npm/@clerk/clerk-js@5/dist/clerk.browser.js'; s.crossOrigin = 'anonymous'; s.dataset.clerkPublishableKey = CFG.key; s.onload = ok; s.onerror = no; document.head.append(s);
        });
        clerk = window.Clerk;
        const sat = CFG.satellite && location.origin === 'https://' + CFG.satellite.domain ? CFG.satellite : null;
        await clerk.load(sat ? { isSatellite: true, domain: sat.domain, signInUrl: sat.signInUrl } : {});
        identity = identityOf(clerk.session, clerk.user);
        clerk.addListener(({ session, user }) => {
          const next = identityOf(session, user);
          if (identity === next) return;
          identity = next; identityVersion++;
          gate(session ? 'Account changed. Checking owner access…' : 'Owner only. Sign in to see the overview.', !session);
          if (session) load();
        });
      })();
      await clerkReady;
      if (!clerk.session) { gate('Owner only. Sign in to see the overview.', true); return false; }
      return true;
    } catch { gate('Sign-in could not load. Reload to try again.'); return false; }
  }
  function render(d) {
    $('#gate').hidden = true; $('#board').hidden = false;
    $('#status').textContent = `${d.source.state.toUpperCase()} · observed ${when(d.source.observedAt)}`;
    const card = i => {
      const c = i.checkpoint, eta = c?.eta;
      return `<article><div class="eyebrow">${esc(i.domain)} · #${i.number}</div><h3>${link(i.url, i.title)}</h3>
<div class="tags"><span>${esc(i.lifecycle)}</span>${i.relatedLifecycle ? `<span>Related changes: ${esc(i.relatedLifecycle)}</span>` : ''}${c ? `<span>Worker reports: ${esc(c.state)}</span>` : ''}<span class="${i.checkpointStale ? 'warning' : ''}">${i.checkpointStale ? 'Checkpoint missing / stale' : 'Checkpoint recorded'}</span></div>
<p class="owner">Owner: ${esc(i.owner.join(', ') || 'Unassigned in GitHub')}${c?.author ? ' · checkpoint by ' + esc(c.author) : ''}</p>
<p>${esc((c?.changed || i.sourceExcerpt || 'No portable checkpoint. Open the issue for its current evidence and scope.').slice(0, 260))}${(c?.changed || i.sourceExcerpt || '').length > 260 ? '…' : ''}</p>${!c && i.sourceExcerpt ? '<p class="muted">Source excerpt · no portable worker checkpoint.</p>' : ''}
<dl><dt>Next checkpoint</dt><dd>${esc(c?.next || 'Not recorded; owner checkpoint needed.')}</dd><dt>Blocker</dt><dd>${esc(c?.blocker || 'Not recorded')}</dd><dt>ETA</dt><dd>${esc(eta ? `${eta.range} · ${eta.confidence} confidence${eta.covers ? ' · ' + eta.covers : ''}` : 'Unknown · missing owner estimate and remaining validation measurement')}${eta ? `<small>${esc(eta.basis)}</small>` : ''}</dd></dl>
${i.branch || i.sha ? `<p class="code">${esc(i.branch || '')}${i.sha ? ' · ' + esc(i.sha.slice(0, 12)) : ''}</p>` : ''}
<div class="links">${i.pulls.map(p => link(p.url, `PR #${p.number} · ${p.state}`)).join(' ')} ${i.releases.map(r => link(r.url, r.title)).join(' ')} ${c?.url ? link(c.url, 'Checkpoint source') : ''}</div>
${c?.proofs?.length ? `<ul class="proofs">${c.proofs.map(p => `<li>${link(p.url, p.outcome || 'Proof journal')} · ${esc(p.environment || 'environment unknown')}</li>`).join('')}</ul>` : '<p class="muted">Proof: not indexed; see the linked journals. Media is never preloaded.</p>'}
<footer>Worker as of ${when(c?.at)} · issue updated ${when(i.updatedAt)}<br>Release/live verification: ${i.releases.length ? 'release reference found; live verification not qualified here' : 'not established by the indexed records'}</footer></article>`;
    };
    $('#board').innerHTML = `<p class="notice ${d.source.state === 'cached' ? '' : 'warning'}">${esc(d.source.message)}<br>Collection checked ${esc(when(d.source.checkedAt))}; worker timestamps stay unchanged.</p>
<div class="columns">${['Now', 'Next', 'Needs you', 'Recently shipped'].map(group => { const items = d.items.filter(i => i.group === group); return `<section aria-label="${group}"><h2>${group}<span>${items.length}</span></h2>${group === 'Next' ? '<p class="muted">No indexed activity or claim. Existing work may already be active; check its source.</p>' : ''}${items.map(card).join('') || '<p class="empty">No indexed records in this section.</p>'}</section>`; }).join('')}</div>
<aside><h2>Release records</h2>${d.snapshot?.releases?.length ? d.snapshot.releases.map(r => `<p>${link(r.url, r.title)} · ${esc(when(r.at))}</p>`).join('') : '<p>No release records available.</p>'}<p>GitHub releases are source records. Live deployment receipts and heartbeat/load/refusal/error diagnostics stay in ${linkHealth()}. Paging qualification remains <a href="https://github.com/genekogan/souls/issues/461" target="_blank" rel="noopener noreferrer">#461</a>.</p></aside>`;
  }
  function linkHealth() { return `<a href="${esc(CFG.base)}/__sim/health">the existing health dashboard</a>`; }
  async function load() {
    $('#refresh').disabled = true;
    let version = identityVersion;
    try {
      if (!await signIn()) return;
      version = identityVersion;
      const session = clerk.session;
      gate('Checking owner access…');
      const token = await session.getToken();
      if (version !== identityVersion || session !== clerk.session) return;
      const r = await fetch(location.pathname + '?json=1', { credentials: 'same-origin', cache: 'no-store', headers: { authorization: 'Bearer ' + token } });
      if (version !== identityVersion) return;
      if (r.status === 401) return gate('Sign-in expired. Sign in again.', true);
      if (r.status === 403) return gate('Signed in. This account is not a configured site owner.');
      if (r.status === 503) return gate('Owner access is not configured. Ask the operator to configure Clerk and the explicit site owner.');
      if (!r.ok) throw new Error('unavailable');
      const data = await r.json();
      if (version === identityVersion) render(data);
    } catch { if (version === identityVersion) gate('Source unavailable. Reload to try again.'); }
    finally { $('#refresh').disabled = false; }
  }
  $('#sign-in').onclick = () => {
    const target = location.origin + location.pathname;
    if (CFG.satellite && location.origin === 'https://' + CFG.satellite.domain) location.assign(clerk.buildSignInUrl({ signInForceRedirectUrl: target, signUpForceRedirectUrl: target }));
    else clerk?.openSignIn({ afterSignInUrl: target, afterSignUpUrl: target });
  };
  addEventListener('pagehide', () => { identityVersion++; gate('Owner access must be checked again.'); });
  addEventListener('pageshow', event => { if (event.persisted) load(); });
  $('#refresh').onclick = () => load();
  load();
}
export function overviewShell(pub, base = '') {
  const cfg = JSON.stringify({ key: pub?.clerkPublishableKey ?? null, issuer: pub?.clerkIssuer ?? null, satellite: pub?.clerkSatellite ?? null, base }).replaceAll('<', '\\u003c');
  const script = `const CFG=${cfg};(${browser.toString()})();`;
  const hash = createHash('sha256').update(script).digest('base64');
  const issuer = pub?.clerkIssuer ?? '';
  const csp = `default-src 'none'; script-src 'sha256-${hash}' ${issuer} https://challenges.cloudflare.com https://*.protect.clerk.com; connect-src 'self' ${issuer} https://*.clerk.com https://*.clerk.accounts.dev; style-src 'unsafe-inline' https:; font-src https: data:; img-src https: data:; frame-src https:; worker-src blob:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'`;
  return { csp, html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Soul · Owner overview</title><link rel="icon" href="data:,"><style>
:root{color-scheme:light dark;--paper:#f6f5f0;--ink:#232824;--muted:#666d65;--line:#d9ded5;--card:#fff;--accent:#315a44;--warn:#815109}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,sans-serif}body>header,main{max-width:1480px;margin:auto;padding:24px 28px}body>header{display:flex;justify-content:space-between;gap:16px;align-items:center;border-bottom:1px solid var(--line)}h1{font-size:25px;letter-spacing:-.04em;margin:0}h2{font-size:18px;margin:20px 0 14px}h2 span{font-size:12px;background:var(--line);padding:3px 7px;border-radius:10px;margin-left:8px}h3{font-size:17px;line-height:1.35;margin:8px 0 12px}a{color:var(--accent);text-underline-offset:3px}h3 a{text-decoration:none}h3 a:hover{text-decoration:underline}button{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);padding:8px 14px;border-radius:8px;cursor:pointer}.muted,#status,footer,.owner,.empty{font-size:12px;color:var(--muted)}#status{margin:4px 0 0}.columns{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}section{min-width:0}article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:17px;margin-bottom:16px;overflow-wrap:anywhere;box-shadow:0 3px 12px #23372205}.eyebrow{text-transform:uppercase;font-size:10px;letter-spacing:.1em;color:var(--muted);font-weight:650}.tags{display:flex;flex-wrap:wrap;gap:5px}.tags span{padding:2px 6px;border-radius:4px;background:var(--paper);font-size:11px}.warning{color:var(--warn)}article p{font-size:13px}dl{font-size:12px;display:grid;grid-template-columns:1fr;gap:3px}dt{font-weight:650;margin-top:6px}dd{margin:0;color:var(--muted)}small{display:block;margin-top:4px}.code{font:11px/1.5 ui-monospace,monospace;color:var(--muted)}.links{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px}.proofs{font-size:12px;padding-left:16px}footer{border-top:1px solid var(--line);padding-top:10px;margin-top:16px;font-size:10px}.notice{border-left:3px solid var(--line);padding-left:12px;font-size:12px;margin:0 0 20px}aside{border-top:1px solid var(--line);margin-top:28px;padding-top:8px;font-size:13px}#gate{max-width:620px;margin:48px auto;padding:24px;background:var(--card);border:1px solid var(--line);border-radius:12px}.empty{padding:15px;border:1px dashed var(--line);border-radius:10px}@media(max-width:1150px){.columns{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){body>header,main{padding:20px 16px}.columns{grid-template-columns:1fr;gap:0}h1{font-size:22px}body>header{align-items:flex-start}button{font-size:13px}article{padding:16px}h2{margin-top:24px}}@media(prefers-color-scheme:dark){:root{--paper:#171d19;--ink:#edf0e9;--muted:#a6b2a7;--line:#354038;--card:#202923;--accent:#add9b6;--warn:#edc17e}}
</style></head><body><header><div><div class="eyebrow">Soul · private</div><h1>Owner overview</h1><p id="status" role="status">Loading owner access…</p></div><button id="refresh">Refresh view</button></header><main><div id="gate" hidden><p id="gate-message"></p><button id="sign-in" hidden>Sign in</button></div><div id="board" hidden></div></main><script>${script}</script></body></html>` };
}
