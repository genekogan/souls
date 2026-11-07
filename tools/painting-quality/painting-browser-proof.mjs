// Source-only suite: root supplies the admitted fixture, browser and custody.
// May run alone or after Q restores its fixture. No launcher, process ownership, teleport, model, forced event or retry.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const PAINTING_BROWSER_LIMITS = Object.freeze({ workMs: 150000, cleanupMs: 5000, contexts: 2, paintings: 2, seconds: 5, contextTargets: 1, contextVersions: 2, newRendererStarts: 4 });
const recipes = [
  { title: 'Amber garden', background: '#eeb644', shapes: [{ kind: 'rect', x: .25, y: .25, width: .5, height: .5, colour: '#173c77' }] },
  { title: 'Blue garden', background: '#173c77', shapes: [{ kind: 'rect', x: .25, y: .25, width: .5, height: .5, colour: '#eeb644' }] },
];
const expectedPixels = [[[238, 182, 68], [23, 60, 119]], [[23, 60, 119], [238, 182, 68]]];

// Independent, bounded reading of this feature's specified RGB8/filter-0 PNG.
// This never calls the production rasterizer to derive its own expected result.
function pixels(bytes) {
  assert.ok(bytes.length < 2 * 1024 * 1024 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'bounded PNG');
  const idat = []; let width, height;
  for (let at = 8; at < bytes.length;) {
    const n = bytes.readUInt32BE(at), kind = bytes.toString('ascii', at + 4, at + 8);
    assert.ok(at + n + 12 <= bytes.length, 'PNG chunk fits');
    if (kind === 'IHDR') { width = bytes.readUInt32BE(at + 8); height = bytes.readUInt32BE(at + 12); assert.equal(bytes[at + 16], 8); assert.equal(bytes[at + 17], 2); }
    if (kind === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + n));
    at += n + 12;
  }
  assert.equal(width, 512); assert.equal(height, 512);
  const stride = width * 3 + 1, raw = inflateSync(Buffer.concat(idat), { maxOutputLength: stride * height });
  assert.equal(raw.length, stride * height);
  for (let y = 0; y < height; y++) assert.equal(raw[y * stride], 0, 'painting renderer PNG row filter');
  return [[25, 25], [256, 256]].map(([x, y]) => [...raw.subarray(y * stride + 1 + x * 3, y * stride + 4 + x * 3)]);
}

/** Call once on root's fresh createFixtureSessions callback, optionally after Q restores its fixture.
 * owner={browser,session,deadline,signal,out,identity:{sourceSha,build,webReceiptPath,webReceiptSha256}}
 * Root owns shared browser/server, registration, render cap and final cleanup.
 * Dev-owner authentication is confined to the already isolated local fixture.
 */
export async function runPaintingBrowserProof(owner) {
  const { browser, session, signal, identity } = owner;
  assert.ok(browser?.newContext && session?.request && session?.rawGet && session?.jobEvents && signal, 'root browser/session/signal required');
  assert.ok(/^[a-f0-9]{40}$/.test(identity?.sourceSha) && identity.build, 'exact admitted source/build required');
  assert.ok(isAbsolute(owner.out) && isAbsolute(identity.webReceiptPath), 'absolute artifact paths required');
  const base = new URL(session.base), now = Date.now(), deadline = Math.min(owner.deadline, now + PAINTING_BROWSER_LIMITS.workMs);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && /^\/w\/context-(baseline|linux-[ab])$/.test(base.pathname) && !base.search && !base.hash, 'existing loopback context fixture only');
  assert.ok(Number.isFinite(deadline) && deadline - now >= 60000, 'at least 60s of root work budget required');
  assert.equal(sha(readFileSync(identity.webReceiptPath)), identity.webReceiptSha256, 'admitted browser build receipt');
  const out = resolve(owner.out); mkdirSync(out); // Never overwrite retained evidence.
  const contexts = new Set(), closing = new Map(), visitors = [], sensitive = [];
  const report = { schema: 'painting-browser/1', identity, browserVersion: browser.version(), base: base.href, startedAt: new Date(now).toISOString(), deadline: new Date(deadline).toISOString(), limits: PAINTING_BROWSER_LIMITS,
    checks: [], paintings: [], nativeObservations: [], visitors: [], cleanup: { complete: false }, visualQualification: 'pending-root-review',
    notes: ['Source-prepared; execution status comes only from this invocation.', 'Real authenticated native activity completion; no forced successful event, body move or server model.', 'Local seconds:5 uses the existing duration parameter. Separate live acceptance must use the preserved 180s default.', 'Two fresh anonymous visitor contexts; existing visitor must refresh without reload.', 'Root owns the fixture, browser, renderer process custody and final teardown.'] };
  let accepting = true, opening = 0, rejectStop;
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  const save = () => writeFileSync(resolve(out, 'summary.json'), JSON.stringify(report, null, 2));
  const safeError = error => { let text = String(error); for (const secret of sensitive) if (secret) text = text.split(secret).join('[redacted]'); return text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 1200); };
  const budget = () => {
    signal.throwIfAborted(); assert.ok(accepting && Date.now() < deadline, 'painting proof absolute deadline');
    assert.ok(session.jobEvents().filter(e => e.phase === 'start').length - startsBefore <= PAINTING_BROWSER_LIMITS.newRendererStarts, 'painting renderer start ceiling');
  };
  const startsBefore = session.jobEvents().filter(e => e.phase === 'start').length;
  const check = (name, pass, data) => { budget(); report.checks.push({ name, pass: !!pass, ...(data === undefined ? {} : { data }) }); save(); assert.ok(pass, name); };
  const close = context => { if (!closing.has(context)) closing.set(context, context.close().then(() => contexts.delete(context))); return closing.get(context); };
  const closeAll = () => Promise.allSettled([...contexts].map(close));
  const stop = reason => { accepting = false; rejectStop(reason); void closeAll(); };
  const onAbort = () => stop(signal.reason ?? Error('root aborted painting proof'));
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop(Error('painting proof absolute deadline')), deadline - now);
  const bound = promise => Promise.race([promise, stopped]);
  const wait = async ms => { budget(); await bound(delay(ms)); budget(); };
  const json = async (path, body, auth) => { budget(); const response = await bound(session.request(path, body, auth)); budget(); return bound(response.json()); };
  const publicJson = (path, body) => json(path, body, null);
  const raw = async url => {
    budget(); const target = new URL(url.startsWith('/v1/') ? base.pathname + url : url, base.href + '/');
    assert.equal(target.origin, base.origin, 'same fixture media origin');
    assert.ok(target.pathname.startsWith(base.pathname + '/'), 'media stays within fixture world');
    const response = await bound(session.rawGet(target.pathname.slice(base.pathname.length) + target.search)); budget(); return response;
  };
  const snap = () => publicJson('/v1/world/snapshot');
  const snapshot = async (page, name) => { budget(); writeFileSync(resolve(out, name + '.yml'), await bound(page.locator('body').ariaSnapshot())); await bound(page.screenshot({ path: resolve(out, name + '.png'), timeout: Math.min(8000, deadline - Date.now()) })); };
  const createVisitor = async (label, position) => {
    budget(); let context; opening++;
    try { context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 }); } finally { opening--; }
    contexts.add(context); if (!accepting) { await close(context); throw Error('visitor opened after termination'); }
    await bound(context.addInitScript(() => localStorage.setItem('skipgc', 't')));
    const page = await bound(context.newPage()); page.setDefaultTimeout(Math.min(12000, deadline - Date.now()));
    const visitor = { label, context, page, errors: [], resources: [] }; visitors.push(visitor);
    page.on('pageerror', error => visitor.errors.push(safeError(error)));
    page.on('console', message => { if (message.type() === 'error') visitor.errors.push(safeError(message.text())); });
    page.on('response', response => { if (/\/art\/[a-f0-9]{64}\.png/.test(response.url())) visitor.resources.push({ url: response.url(), status: response.status() }); });
    const url = new URL(base.href + '/');
    // View the canvas obliquely from inside the room, clear of the resident's native painting position.
    url.search = new URLSearchParams({ eye: [position[0] + 2.5, position[1] + 1.6, position[2] + 3.5].join(','), at: [position[0], position[1] + 1.15, position[2] + .205].join(',') }).toString();
    await bound(page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: Math.min(20000, deadline - Date.now()) }));
    return visitor;
  };
  const showPainting = async (visitor, target, state, version) => {
    const { page, label } = visitor; budget();
    await bound(page.waitForFunction(({ target, media, title, maker }) => {
      const host = window.__soulsEntity; if (!host?.layer?.active || host.layer.building || host.layer.filling) return false;
      let found = false;
      host.layer.group?.traverse(mesh => {
        const art = mesh.userData.art, map = mesh.material?.map, image = map?.image;
        let visible = true; for (let parent = mesh; parent; parent = parent.parent) if (!parent.visible) visible = false;
        if (visible && art?.frame === target && art.url === media && art.title === title && art.maker === maker && !art.broken && (image?.naturalWidth || image?.width) === 512) found = true;
      }); return found;
    }, { target, media: state.media, title: state.title, maker: state.maker }, { timeout: Math.min(15000, deadline - Date.now()) }));
    const face = await bound(page.evaluate(({ target, media }) => {
      const host = window.__soulsEntity; let result;
      host.layer.group.traverse(mesh => {
        const art = mesh.userData.art; if (result || art?.frame !== target || art.url !== media) return;
        const image = mesh.material.map.image, canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 512, 512);
        const samples = [[25, 25], [256, 256]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3));
        const point = mesh.getWorldPosition(mesh.position.clone()).project(host.camera), bounds = host.renderer.domElement.getBoundingClientRect();
        result = { art: { ...art }, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height, samples,
          x: bounds.x + (point.x + 1) / 2 * bounds.width, y: bounds.y + (1 - point.y) / 2 * bounds.height, visible: point.z > -1 && point.z < 1 && Math.abs(point.x) < 1 && Math.abs(point.y) < 1,
          webglLost: host.renderer.getContext().isContextLost() };
      }); return result;
    }, { target, media: state.media }));
    check(label + ' actual image texture version ' + version, face?.visible && !face.webglLost && face.width === 512 && face.height === 512 && JSON.stringify(face.samples) === JSON.stringify(expectedPixels[version]), face);
    await snapshot(page, `${label}-${version}-before-hover`);
    await bound(page.mouse.move(face.x, face.y));
    const tooltip = page.getByRole('tooltip').filter({ hasText: state.title }); await bound(tooltip.waitFor({ state: 'visible', timeout: Math.min(5000, deadline - Date.now()) }));
    const text = await bound(tooltip.innerText());
    check(label + ' readable title and server credit ' + version, text.includes(state.title) && text.includes('by Painting Witness (a resident)'), { text });
    await snapshot(page, `${label}-${version}-painting`);
    check(label + ' clean browser console ' + version, visitor.errors.length === 0, visitor.errors);
    report.visitors.push({ label, version, face, tooltip: text, resources: [...visitor.resources] }); save();
  };
  const contextReady = async target => {
    const until = Math.min(deadline, Date.now() + 15000); let view;
    do {
      const data = await publicJson('/v1/world/context/views', { refs: [target], detail: false, sheet: false }); view = data.views?.[0];
      if (view?.status !== 'pending') break; await wait(250);
    } while (Date.now() < until);
    check('context painting image ready', view?.status === 'ready', view); return view;
  };
  save();
  try {
    await bound((async () => {
      session.setPhase?.('painting-browser-proof');
      const health = await publicJson('/healthz'); check('runtime matches admitted build', health.build === identity.build, { build: health.build, worldId: health.worldId });
      const initial = await snap(); check('fresh five-subject fixture admitted', initial.entities.length === 5 && ['hall', 'podium', 'artwork', 'landmark', 'lake'].every(name => initial.entities.some(e => e.name === name)));
      const created = await json('/v1/souls', { name: 'Painting Witness', description: 'Isolated native painting proof. No model or directive.' }, 'dev:painting-proof');
      const soul = created.soul; check('ordinary Soul birth admitted', !!soul?.id && !!soul?.entityId, { soulId: soul?.id, entityId: soul?.entityId });
      const pairing = await json(`/v1/souls/${encodeURIComponent(soul.id)}/pair`, {}, 'dev:painting-proof'); sensitive.push(pairing.code);
      const paired = await publicJson('/v1/agent/pair', { code: pairing.code, agent: 'isolated painting proof' }); sensitive.push(paired.token);
      check('real Soul authenticated', paired.soul?.id === soul.id && typeof paired.token === 'string');
      const observe = () => json('/v1/edge/observe', undefined, paired.token);
      const start = await observe(), position = start.self?.position;
      check('actual body position available without teleport', Array.isArray(position) && position.length === 3 && position.every(Number.isFinite), { position });
      // One strict placement beside the real spawn; a collision is a retained failure, never a nudge/retry or body move.
      const p = [position[0] + 3, position[2]], name = 'painting-proof-easel';
      const placed = await json('/v1/god/act', { ops: [{ op: 'place', def: 'core/easel@2', name, p, about: { title: 'Painting proof easel', what: 'A new published easel for the local painting proof.', viewpoint: { eye: [0, 1.5, 3.5], at: [0, 1.15, 0] } } }], note: 'Local B proof: labelled published easel v2' });
      check('published easel v2 ordinary placement accepted', placed.accepted, { accepted: placed.accepted, failures: placed.failures });
      const afterPlace = await snap(), easel = afterPlace.entities.find(e => e.name === name), def = afterPlace.defs.find(d => d.ref === easel?.def || 'sha:' + d.hash === easel?.def);
      check('actual placed definition is published v2', !!easel && def?.name === 'core-easel' && def.version === 2, { entityId: easel?.id, ref: def?.ref, hash: def?.hash });
      report.easel = { entityId: easel.id, def: def.ref, hash: def.hash, position: easel.p }; report.soul = { id: soul.id, entityId: soul.entityId, name: soul.name }; save();
      let capability;
      for (let n = 0; n < 20; n++) {
        const caps = await json('/v1/edge/capabilities', undefined, paired.token); capability = caps.capabilities.find(c => c.id === `paint:paint.${easel.id}`);
        if (capability?.available) break; await wait(250);
      }
      check('actual easel offer has bounded recipe help and preserved default', capability?.available && capability.params?.painting && capability.params?.seconds?.default === 180, { id: capability?.id, params: capability?.params });
      const paint = async version => {
        const maker = `soul:${encodeURIComponent(soul.id)}:${soul.name}`;
        const before = (await snap()).entities.find(e => e.id === easel.id).state;
        const admitted = await json('/v1/edge/act', { capability: capability.id, params: { seconds: PAINTING_BROWSER_LIMITS.seconds, painting: recipes[version] }, clientRef: `painting-browser-${version}` }, paired.token);
        check('native painting admitted ' + version, admitted.accepted && !!admitted.receipt?.id, { accepted: admitted.accepted, receiptId: admitted.receipt?.id, phase: admitted.receipt?.phase, code: admitted.code });
        const until = Math.min(deadline, Date.now() + 35000); let receipt = admitted.receipt, sawPaint = false, sawOldWhilePainting = false;
        while (['waiting', 'started'].includes(receipt.phase) && Date.now() < until) {
          const current = await observe();
          if (current.self?.activity === 'paint') {
            sawPaint = true;
            const canvas = (await snap()).entities.find(e => e.id === easel.id).state;
            if (JSON.stringify(canvas) === JSON.stringify(before)) {
              sawOldWhilePainting = true;
              report.nativeObservations.push({ version, tick: current.tick, activity: current.self.activity, oldCanvas: true, media: canvas.media }); save();
            } else {
              // These are separate HTTP reads: native completion can validly
              // publish between observing the pose and reading the canvas.
              receipt = (await json(`/v1/edge/receipts/${encodeURIComponent(receipt.id)}`, undefined, paired.token)).receipt;
              const published = receipt.outcome?.detail?.painting;
              check('changed canvas has matching successful receipt ' + version, receipt.phase === 'completed' && published?.target === easel.id && published.media === canvas.media && published.title === recipes[version].title && published.maker === maker,
                { receiptId: receipt.id, phase: receipt.phase, media: canvas.media, completionBetweenReads: true });
              report.nativeObservations.push({ version, tick: current.tick, activity: current.self.activity, oldCanvas: false, media: canvas.media, receiptId: receipt.id, receiptPhase: receipt.phase, completionBetweenReads: true }); save();
              break;
            }
          }
          await wait(500); receipt = (await json(`/v1/edge/receipts/${encodeURIComponent(receipt.id)}`, undefined, paired.token)).receipt;
        }
        const state = (await snap()).entities.find(e => e.id === easel.id).state;
        check('genuine native completion publishes credited painting ' + version, sawPaint && sawOldWhilePainting && receipt.phase === 'completed' && state.title === recipes[version].title && state.maker === maker && receipt.outcome?.produced?.some(p => p.kind === 'painting' && p.visibility === 'public'), { sawPaint, sawOldWhilePainting, receiptId: receipt.id, phase: receipt.phase, state, outcome: receipt.outcome });
        const original = await raw(state.media); check('public immutable painting available ' + version, original.status === 200);
        const bytes = Buffer.from(await bound(original.arrayBuffer())), hash = sha(bytes);
        check('exact content hash and independently checked original pixels ' + version, state.media.endsWith(`/art/${hash}.png`) && JSON.stringify(pixels(bytes)) === JSON.stringify(expectedPixels[version]), { hash, bytes: bytes.length, samples: pixels(bytes) });
        writeFileSync(resolve(out, `original-${version}.png`), bytes);
        report.paintings.push({ version, recipe: recipes[version], receiptId: receipt.id, phase: receipt.phase, sawPaint, sawOldWhilePainting, state, sha256: hash }); save();
        return { state, hash };
      };
      const first = await paint(0), firstView = await contextReady(easel.id);
      check('first context exposes current original without internal storage', firstView.original?.source === 'original-image' && firstView.original.version === first.hash && firstView.original.storage === undefined, firstView.original);
      const firstOriginal = await raw(firstView.original.url);
      check('first context original returns exact painting bytes', firstOriginal.status === 200 && sha(Buffer.from(await bound(firstOriginal.arrayBuffer()))) === first.hash);
      const firstImage = await raw(firstView.url); check('first context pixels retrievable', firstImage.status === 200); writeFileSync(resolve(out, 'context-0.png'), Buffer.from(await bound(firstImage.arrayBuffer())));
      report.firstContext = firstView; save();
      const worldPosition = easel.p.length === 3 ? easel.p : [easel.p[0], 0, easel.p[1]];
      const visitor = await createVisitor('existing-visitor', worldPosition); await showPainting(visitor, easel.id, first.state, 0);
      const fresh = await createVisitor('fresh-visitor', worldPosition); await showPainting(fresh, easel.id, first.state, 0); await close(fresh.context);
      const second = await paint(1); check('second completion replaces one canvas with new original', second.state.media !== first.state.media && second.hash !== first.hash);
      // Same page/context/camera: no navigation, reload, pickAt or cache request before the live texture refresh.
      await showPainting(visitor, easel.id, second.state, 1);
      const oldImage = await raw(firstView.url); check('old context URL invalidated by native completion', oldImage.status === 404, { status: oldImage.status });
      const oldOriginal = await raw(firstView.original.url); check('old context original URL invalidated by native completion', oldOriginal.status === 404, { status: oldOriginal.status });
      const secondView = await contextReady(easel.id); report.secondContext = secondView;
      check('stable context ref obtains new cache key', secondView.ref === firstView.ref && secondView.key !== firstView.key, { before: firstView.key, after: secondView.key });
      check('second context exposes current original without internal storage', secondView.original?.source === 'original-image' && secondView.original.version === second.hash && secondView.original.storage === undefined, secondView.original);
      const secondOriginal = await raw(secondView.original.url), secondOriginalBytes = Buffer.from(await bound(secondOriginal.arrayBuffer()));
      check('new context original has exact replacement pixels', secondOriginal.status === 200 && sha(secondOriginalBytes) === second.hash && JSON.stringify(pixels(secondOriginalBytes)) === JSON.stringify(expectedPixels[1]));
      const secondImage = await raw(secondView.url); check('new context pixels retrievable', secondImage.status === 200); writeFileSync(resolve(out, 'context-1.png'), Buffer.from(await bound(secondImage.arrayBuffer())));
      const historical = await raw(first.state.media); check('previous immutable appearance retained after overwrite', historical.status === 200 && sha(Buffer.from(await bound(historical.arrayBuffer()))) === first.hash);
      const starts = session.jobEvents().filter(e => e.phase === 'start').length - startsBefore;
      check('bounded shared architectural work', starts <= PAINTING_BROWSER_LIMITS.newRendererStarts, { starts, rootLimit: session.jobStartLimit });
      report.machinePass = true;
    })());
  } catch (error) {
    report.error = safeError(error); report.machinePass = false;
    for (const visitor of visitors) if (contexts.has(visitor.context) && Date.now() < deadline) {
      try { await snapshot(visitor.page, visitor.label + '-failure'); } catch (captureError) { report.failureCaptureError = safeError(captureError); }
    }
  } finally {
    accepting = false; clearTimeout(timer); signal.removeEventListener('abort', onAbort);
    await Promise.race([closeAll(), delay(PAINTING_BROWSER_LIMITS.cleanupMs)]);
    report.cleanup = { complete: contexts.size === 0 && opening === 0, remainingContexts: contexts.size, openingContexts: opening, finishedWithinRootCleanup: Date.now() <= owner.deadline + PAINTING_BROWSER_LIMITS.cleanupMs };
    report.endedAt = new Date().toISOString(); report.pass = !!report.machinePass && report.cleanup.complete && report.cleanup.finishedWithinRootCleanup; save();
    const images = ['original-0', 'original-1', 'context-0', 'context-1', ...report.visitors.map(v => `${v.label}-${v.version}-painting`)];
    writeFileSync(resolve(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Painting proof</title><style>body{font:16px system-ui;max-width:1200px;margin:24px auto}img{max-width:100%;max-height:720px}pre{white-space:pre-wrap}</style><h1>Painting proof: ${report.pass ? 'machine pass' : 'failure'}</h1><p>Visual acceptance remains pending root review. Local 5-second proof does not replace live 180-second acceptance.</p>${images.map(name => `<figure><figcaption>${escape(name)}</figcaption><img src="${escape(name)}.png"></figure>`).join('')}<pre>${escape(JSON.stringify(report, null, 2))}</pre>`);
  }
  return report;
}
