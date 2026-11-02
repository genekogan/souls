// Lane L3h: a new world's snapshot GET starts at page entry, not after the Shell chunk, /v1/config, sign-in and the
// socket's welcome (live: 2.7 s in, 0.35 s locally). vite.config.ts writes entryPrefetchScript() into index.html's head
// as a classic inline script, so the request leaves while the module chunks download; WorldEntityLayer.start then takes
// that one response (takeSnapshotPrefetch) instead of fetching again. Same URL, same fetch defaults (a plain GET with
// the page's same-origin credentials, as WorldEntityLayer has always sent it), so the same bytes and visibility.
// No imports: vite.config.ts loads this file in node, and worldKeyFrom is serialised into the page as it stands.

/** Old worlds (main's e8 behaviour; no entity layer, so nothing to prefetch). world-kind.ts re-exports it. */
export const OLD_WORLD_KEYS: readonly string[] = ['eden', 'mars', 'littlemartians', 'toy'];

/** The world key of a page path under BASE ('' or e.g. '/worlds'); 'toy' when the path names none. Self-contained: it is
 *  also serialised into index.html (no free identifiers, plain JS once its types are stripped). */
export function worldKeyFrom(pathname: string, base: string): string {
  const m = (base && pathname.startsWith(base + '/') ? pathname.slice(base.length) : pathname).match(/^\/w\/([a-z][a-z0-9-]{0,31})(?:\/|$)/);
  return m ? m[1] : 'toy';
}

/** P7b (phased-entry.ts): whether this page loads in two phases, the early layer's code and the snapshot first, then the
 *  rest of the page and the socket. The early layer's gate (early-layer.ts: a new world on a phone-tier page with lever D's
 *  early arrival, not a picture) as the page's tier picks it (quality-tier.ts), unless `?phased=0` or `?earlyLayer=0`.
 *  Self-contained: also serialised into index.html (no free identifiers, plain JS once its types are stripped). */
export function phasedEntryWanted(search: string, coarsePointer: boolean, screenW: number, screenH: number, deviceMemory?: number): boolean {
  const q = new URLSearchParams(search), early = q.get('early'), forced = q.get('quality'), short = Math.min(screenW, screenH);
  if (q.has('shot') || early === '0' || q.get('earlyLayer') === '0' || q.get('phased') === '0') return false;
  if (early === '1') return true;
  if (forced === 'phone' || forced === 'full') return forced === 'phone';
  return coarsePointer && (short > 0 && short <= 820 || deviceMemory !== undefined && deviceMemory <= 2);
}
/** The window property the inline script leaves its decision on (true: two phases). */
export const PHASED_GLOBAL = '__simPhased';
/** On a two-phase page, the entry socket opens with the second phase (phased-entry.ts calls this), so its join does not
 *  cross the link between the two phases. */
export const OPEN_SOCKET_GLOBAL = '__simOpenSocket';

/** The window properties the inline script leaves its requests on. */
export const PREFETCH_GLOBAL = '__simSnapshotPrefetch';
export const CONFIG_GLOBAL = '__simConfigPrefetch';
export const SOCKET_GLOBAL = '__simSocketPrefetch';
export type PrefetchRequest = { response: Promise<Response>; abort?: () => void };
type Prefetch = PrefetchRequest & { url: string };
type PrefetchPart = Promise<Response> | PrefetchRequest;
type SnapshotPrefetch = Prefetch & { parts?: Record<string, PrefetchPart>; discard?: () => void };
/** Lane W1: the world's WebSocket, opened at page entry with an anonymous hello (P7: in its URL, `?hello=`, said by the
 *  server at the upgrade); useSim's Connection adopts it (queue:
 *  every message that arrived before then, in order). Closed after 20 s if nothing adopted it. */
export type BootSocket = { url: string; ws: WebSocket; queue: unknown[]; hello: string; sent: boolean; adopted?: boolean };

/** index.html's inline head script: on a new world's page, GET its snapshot and /v1/config now, and (with `hello`, the
 *  exact anonymous hello the page's Connection would send) open the world's socket and say hello, so the page's first
 *  round trips to the server all leave at once instead of one after another (research B, 2026-10-19). */
export function entryPrefetchScript(base: string, oldKeys: readonly string[] = OLD_WORLD_KEYS, hello?: string): string {
  return `(function(){try{var b=${JSON.stringify(base)},k=(${worldKeyFrom.toString()})(location.pathname,b);`
    + `if((window.__simConfig&&typeof window.__simConfig.worldEngine==='boolean'?!window.__simConfig.worldEngine:${JSON.stringify(oldKeys)}.indexOf(k)>=0)||typeof fetch!=='function')return;`
    + `var w=b+'/w/'+k,rq=function(u){var c=typeof AbortController==='function'?new AbortController():null,p=c?fetch(u,{signal:c.signal}):fetch(u);p.catch(function(){});return {response:p,abort:function(){if(c)c.abort();}};},g=function(n,u){var r=rq(u);r.url=u;window[n]=r;};`
    // W3: the wire form (snapshot-wire.ts); its defs/ground part fetches start as soon as the response headers name them
    + `var x=window.__simSnapshotKey,n=w+'/v1/world/snapshot?defs=ref&cols=1';g(${JSON.stringify(PREFETCH_GLOBAL)},typeof x==='string'&&x?n+'&v='+encodeURIComponent(x):n);g(${JSON.stringify(CONFIG_GLOBAL)},w+'/v1/config');`
    // P7: the parts the HTML names (window.__simSnapshotParts) leave at once; any other the snapshot's headers name, then
    + `var sp=window[${JSON.stringify(PREFETCH_GLOBAL)}],pp=sp.parts={},closed=false;sp.discard=function(){closed=true;sp.abort();Object.keys(pp).forEach(function(f){pp[f].abort();});};var pf=function(f){if(!closed&&typeof f==='string'&&/^[0-9a-f]{32}$/.test(f)&&!pp[f])pp[f]=rq(w+'/v1/world/part/'+f);},hp=window.__simSnapshotParts;if(hp&&hp.forEach)hp.forEach(pf);`
    + `sp.response.then(function(r){['x-defs-ref','x-ground-ref'].forEach(function(h){pf(r.headers.get(h));});},function(){});`
    // P7: the hello rides in the socket's URL (the server says it at the upgrade), not from the open event: that waited
    // for the page's main thread, busy building the world, and the join with it (~1 s on a phone)
    // P7b: a two-phase page (phasedEntryWanted) opens it with its second phase
    + `var ph=false;try{ph=(${phasedEntryWanted.toString()})(location.search||'',typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches,screen.width,screen.height,navigator.deviceMemory)===true;}catch(e){}window[${JSON.stringify(PHASED_GLOBAL)}]=ph;`
    // lane PAIR-UI: an #approve link may be handed to an open tab (Shell.tsx), so it opens no world socket, not even
    // in a phased (phone) second phase; a full boot opens its own
    + (hello ? `if(typeof WebSocket!=='function')return;var os=function(){if(/^#approve\\//.test(location.hash||''))return;var h=${JSON.stringify(hello)},u=(location.protocol==='https:'?'wss':'ws')+'://'+location.host+w+'/ws',s=new WebSocket(u+'?hello='+encodeURIComponent(h)),o={url:u,ws:s,queue:[],hello:h,sent:true};`
      + `s.onmessage=function(e){o.queue.push(e.data);};`
      + `setTimeout(function(){if(!o.adopted)try{s.close();}catch(e){}},20000);window[${JSON.stringify(SOCKET_GLOBAL)}]=o;};`
      + `if(ph)window[${JSON.stringify(OPEN_SOCKET_GLOBAL)}]=function(){delete window[${JSON.stringify(OPEN_SOCKET_GLOBAL)}];os();};else os();` : '')
    + `}catch(e){}})();`;
}

/** Lane O2: the world server puts the current snapshot's key on the page (window.__simSnapshotKey); the first start
 *  GETs `<snapshot>?v=<key>`, which the edge may cache (the entry prefetch already did); every later fetch (resync) uses
 *  the plain no-store URL. */
export function entryWireUrl(plain: string): string {
  const x = typeof window === 'undefined' ? undefined : (window as unknown as { __simSnapshotKey?: unknown }).__simSnapshotKey;
  return `${plain}?defs=ref&cols=1` + (typeof x === 'string' && x ? `&v=${encodeURIComponent(x)}` : '');
}
export function entrySnapshotUrl(plain: string): string {
  const x = typeof window === 'undefined' ? undefined : (window as unknown as { __simSnapshotKey?: unknown }).__simSnapshotKey;
  return typeof x === 'string' && x ? `${plain}?v=${encodeURIComponent(x)}` : plain;
}

/** The entry socket when it was opened for this exact URL and is still usable, at most once per page. */
export function takeBootSocket(url: string): BootSocket | null {
  const w = (typeof window === 'undefined' ? null : window) as unknown as Record<string, BootSocket | undefined> | null;
  const o = w?.[SOCKET_GLOBAL];
  if (!o) return null;
  delete w![SOCKET_GLOBAL];
  if (o.url !== url || o.ws.readyState > 1) { try { o.ws.close(); } catch { /* already closing */ } return null; }
  o.adopted = true;
  return o;
}

/** The entry config GET when it was for this exact URL, at most once per page (a retry fetches afresh). */
export function takeConfigPrefetch(url: string): Promise<Response> | null { return takePrefetch(CONFIG_GLOBAL, url); }

function takePrefetch(name: string, url: string): Promise<Response> | null {
  const w = (typeof window === 'undefined' ? null : window) as unknown as Record<string, Prefetch | undefined> | null;
  const p = w?.[name];
  if (!p) return null;
  delete w![name];
  return p.url === url ? p.response : null;
}

/** The entry prefetch's response when it was for this exact URL, at most once per page (a later start, a resync or any
 *  other caller fetches afresh). null: there was none (old world, a test, a script-less page) or it is already taken. */
const asRequest = (part: PrefetchPart): PrefetchRequest => 'response' in part ? part : { response: part };
function discardRequest(request: PrefetchRequest) {
  request.abort?.();
  // Older cached HTML has no controller. Its late body can still be released, but its pending headers cannot be aborted.
  void request.response.then(r => r.body?.cancel().catch(() => {}), () => {});
}
/** Claim the exact entry snapshot and its part requests as one loader-owned batch. */
export function takeSnapshotPrefetchBatch(url: string): { request: PrefetchRequest; part(ref: string): PrefetchRequest | null; close(): void } | null {
  const w = (typeof window === 'undefined' ? null : window) as unknown as Record<string, SnapshotPrefetch | undefined> | null;
  const p = w?.[PREFETCH_GLOBAL]; if (!p) return null;
  delete w![PREFETCH_GLOBAL];
  // Transfer the top request too. Cached inline scripts call sp.abort() from discard(); leave that hook harmless
  // while the loader owns the original abort. Claimed parts already leave the inline script's pending collection.
  const request: PrefetchRequest = { response: p.response, abort: p.abort?.bind(p) }; p.abort = () => {};
  const pending = p.parts ?? {}; let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    const unused = Object.keys(pending).map(ref => { const part = asRequest(pending[ref]); delete pending[ref]; return part; });
    p.discard?.(); for (const part of unused) discardRequest(part);
  };
  if (p.url !== url) { close(); discardRequest(request); return null; }
  return { request, part(ref) { if (closed) return null; const part = pending[ref]; delete pending[ref]; return part ? asRequest(part) : null; }, close };
}
// Compatibility API for existing consumers and pre-controller cached entry scripts.
export function takeSnapshotPrefetch(url: string): Promise<Response> | null {
  const batch = takeSnapshotPrefetchBatch(url); parts = batch;
  return batch?.request.response ?? null;
}
let parts: ReturnType<typeof takeSnapshotPrefetchBatch> = null;
/** A part of the snapshot just taken, at most once. New transport code owns its batch directly. */
export function takePartPrefetch(ref: string): Promise<Response> | null { return parts?.part(ref)?.response ?? null; }
