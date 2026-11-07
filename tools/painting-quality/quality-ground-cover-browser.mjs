// Suite only: R supplies the admitted fixture, browser lease and absolute deadline.
// No process launch, world creation, credentials, cache reset, source patch or retry.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { genesis, cases } from '../context-views/fixture.mjs';
import expected from './quality-ground-cover-expected.json' with { type: 'json' };
import { alignQualityFixture, qualityBindings, qualityHash, qualityBeforeReceipt, qualityBeforeImage } from './quality-ground-cover-fixture.mjs';

const hash = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const samePoint = (a, b) => Array.isArray(a) && Array.isArray(b) && Math.hypot(...a.map((v, i) => v - b[i])) < .0001;
export const QUALITY_BROWSER_LIMITS = Object.freeze({ workMs: 150000, cleanupMs: 5000, architecturalCalls: 2, liveContexts: 2 });

/** Call once, serially, before P adds an easel to the shared fixture.
 * owner={browser,session,deadline,signal,out,identity:{sourceSha,build,webReceiptPath,webReceiptSha256},beforeDir}
 * session is the existing createFixtureSessions callback value. The browser and
 * server remain owner-owned; this function closes only contexts it creates.
 * R must hold the MEASURE.slot/Chrome lease and register its browser process.
 */
export async function runQualityGroundCoverProof(owner) {
  const { browser, session, signal, identity } = owner;
  assert.ok(browser?.newContext && session?.request && signal, 'owner browser/session/signal required');
  assert.ok(/^[a-f0-9]{40}$/.test(identity?.sourceSha) && identity.build, 'exact source and expected runtime build required');
  assert.ok(isAbsolute(owner.out) && isAbsolute(owner.beforeDir) && isAbsolute(identity.webReceiptPath), 'absolute artifact paths required');
  const now = Date.now(), deadline = Math.min(owner.deadline - QUALITY_BROWSER_LIMITS.cleanupMs, now + QUALITY_BROWSER_LIMITS.workMs);
  assert.ok(Number.isFinite(deadline) && deadline - now >= 30000, 'at least 30s of owner work budget required');
  const base = new URL(session.base);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && /^\/w\/context-(baseline|linux-[ab])$/.test(base.pathname) && !base.search && !base.hash, 'existing loopback context fixture only');
  const webReceipt = readFileSync(identity.webReceiptPath);
  assert.equal(createHash('sha256').update(webReceipt).digest('hex'), identity.webReceiptSha256, 'admitted browser build receipt hash');
  const out = resolve(owner.out); mkdirSync(out); // Refuse overwriting any prior proof.
  const beforeBytes = readFileSync(resolve(owner.beforeDir, 'receipt.json'));
  const before = qualityBeforeReceipt(beforeBytes, expected), contexts = new Set(), closing = new Map();
  for (const [path, pin] of Object.entries(expected.sourcePins)) {
    const bytes = readFileSync(fileURLToPath(new URL('../../' + path, import.meta.url)));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin, 'reviewed candidate geometry/material source pin: ' + path);
  }
  let accepting = true, openingContexts = 0;
  let alignment, alignmentTask;
  const report = { schema: 'quality-ground-cover-browser/1', identity, browserVersion: browser.version(), base: base.href, startedAt: new Date(now).toISOString(),
    deadline: new Date(deadline).toISOString(), limits: QUALITY_BROWSER_LIMITS, fixtureSha256: hash({ genesis, cases }),
    before: { source: before.source, receiptSha256: createHash('sha256').update(beforeBytes).digest('hex'), sourcePins: expected.baselineSourcePins, expectedFactsSha256: qualityHash(expected.facts), cases: [] },
    candidateSourcePins: expected.sourcePins, sourceExceptions: expected.sourceExceptions,
    checks: [], architectural: [], live: [], cleanup: { complete: false }, visualQualification: 'pending-root-review',
    scope: 'First contextRender invocation per fresh renderer; the normal architecture pipeline may perform occlusion passes. No warmup capture and no throughput/performance claim.' };
  const save = () => writeFileSync(resolve(out, 'summary.json'), JSON.stringify(report, null, 2));
  const check = (name, pass, data) => { budget(); report.checks.push({ name, pass: Boolean(pass), ...(data === undefined ? {} : { data }) }); save(); assert.ok(pass, name); };
  const budget = () => { signal.throwIfAborted(); assert.ok(Date.now() < deadline, 'quality proof absolute deadline'); };
  const close = context => {
    if (!closing.has(context)) closing.set(context, context.close().then(() => { contexts.delete(context); }));
    return closing.get(context);
  };
  const closeAll = () => Promise.allSettled([...contexts].map(close));
  let abortReject;
  const aborted = new Promise((_, reject) => { abortReject = reject; });
  const onAbort = () => { accepting = false; abortReject(signal.reason ?? Error('owner aborted')); void closeAll(); };
  const timer = setTimeout(() => { accepting = false; abortReject(Error('quality proof absolute deadline')); void closeAll(); }, deadline - now);
  signal.addEventListener('abort', onAbort, { once: true });
  const createContext = async options => {
    budget(); let context; openingContexts++;
    try { context = await browser.newContext(options); } finally { openingContexts--; }
    contexts.add(context);
    if (!accepting) { await close(context); throw Error('context opened after proof termination'); }
    await context.addInitScript(() => localStorage.setItem('skipgc', 't'));
    const page = await context.newPage(); page.setDefaultTimeout(Math.min(12000, deadline - Date.now()));
    const errors = [], resources = [];
    page.on('pageerror', error => errors.push(String(error).slice(0, 500)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 500)); });
    page.on('response', response => { if (/\.(?:js|css)(?:\?|$)/.test(response.url())) resources.push({ url: response.url(), status: response.status() }); });
    return { context, page, errors, resources };
  };
  const snapshot = async (page, id) => {
    budget(); writeFileSync(resolve(out, id + '.yml'), await page.locator('body').ariaSnapshot());
    await page.screenshot({ path: resolve(out, id + '.png'), fullPage: false, timeout: Math.min(10000, deadline - Date.now()) });
  };
  const failure = async (page, id, errors, resources, error) => {
    const evidence = { error: String(error), errors, resources };
    try { await snapshot(page, id + '-failure'); } catch (captureError) { evidence.captureError = String(captureError); }
    writeFileSync(resolve(out, id + '-failure.json'), JSON.stringify(evidence, null, 2));
  };
  save();
  try {
    const work = async () => {
      budget(); session.setPhase?.('quality-ground-cover');
      const health = await (await session.request('/healthz', undefined, null)).json();
      check('runtime matches admitted build', health.build === identity.build, { build: health.build, worldId: health.worldId });
      const originalSnapshot = await (await session.request('/v1/world/snapshot', undefined, null)).json();
      alignmentTask = alignQualityFixture(session, originalSnapshot, expected.facts);
      alignment = await alignmentTask;
      report.mediaAlignment = alignment.evidence; save();
      const sourceSnapshot = alignment.snapshot;
      check('shared fixture still has exactly the five frozen subjects', sourceSnapshot.entities.length === 5 && ['hall', 'podium', 'artwork', 'landmark', 'lake'].every(name => sourceSnapshot.entities.some(e => e.name === name)));
      writeFileSync(resolve(out, 'snapshot.json'), JSON.stringify(sourceSnapshot)); report.snapshotSha256 = hash(sourceSnapshot);
      // Reuse production architectural snapshot and room/frame derivation, never freeze the running simulation.
      const [{ WorldModel }, scene] = await Promise.all([import('../../packages/world-compiler/src/index.ts'), import('../../apps/server/src/god/context-view-scene.ts')]);
      const model = WorldModel.fromSnapshot({ ...sourceSnapshot, seq: sourceSnapshot.counter ?? 0, editSeq: sourceSnapshot.seq });
      const immutable = scene.contextScene({ model, publicSnapshot: () => sourceSnapshot }, new Set()).snapshot;
      const { targets, bindings } = qualityBindings(model);
      for (const [role, id] of [['a', 'enclosed-room'], ['b', 'landmark']]) {
        budget(); const prior = before.units?.find(unit => unit.role === role);
        assert.ok(prior?.view?.photo?.status === 'ready', 'retained before camera metadata required');
        const priorImage = readFileSync(resolve(owner.beforeDir, role, 'context.png'));
        qualityBeforeImage(role, priorImage, before, expected);
        check(id + ' before PNG matches pinned hash and retained receipt', true, { sha256: hash(priorImage) });
        copyFileSync(resolve(owner.beforeDir, role, 'context.png'), resolve(out, `before-${id}.png`));
        report.before.cases.push({ id, imageSha256: hash(priorImage), camera: prior.view.photo, target: prior.target }); save();
        const binding = bindings.find(row => row.id === id), target = targets.find(row => row.ref === binding.ref);
        const interior = scene.contextEnclosed(model, target), room = scene.contextRoom(model, target);
        const camera = { eye: prior.view.photo.eye, at: prior.view.photo.at };
        const payload = { snapshot: immutable, detail: false, target: { ...target, interior, room, subjectKind: interior ? 'room' : 'exterior',
          front: scene.contextFront(model, model.entities.get(target.entity)), viewpoint: camera, fixedCamera: true } };
        writeFileSync(resolve(out, `${id}-input.json`), JSON.stringify(payload));
        const { context, page, errors, resources } = await createContext({ viewport: { width: 640, height: 448 }, deviceScaleFactor: 1 });
        try {
          const url = new URL(base.href + '/context-view'); url.search = new URLSearchParams({ shot: '1', quality: 'full', eye: camera.eye.join(','), at: camera.at.join(',') }).toString();
          await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: Math.min(20000, deadline - Date.now()) });
          await page.waitForFunction(() => typeof window.contextRender === 'function');
          const result = await page.evaluate(payload => window.contextRender(payload), payload);
          const row = { id, inputSha256: hash(payload), camera, photo: result.photo, reason: result.reason, errors, resources,
            captureMode: 'first-contextRender-call-no-warmup', visualInspection: 'pending-root-review' };
          if (/^data:image\/png;base64,/.test(result.data ?? '')) {
            const bytes = Buffer.from(result.data.split(',')[1], 'base64'); writeFileSync(resolve(out, `after-${id}.png`), bytes); row.imageSha256 = hash(bytes); row.bytes = bytes.length;
          }
          report.architectural.push(row); save();
          check(id + ' architecture ready at exact retained camera', result.photo?.status === 'ready' && samePoint(result.photo.eye, camera.eye) && samePoint(result.photo.at, camera.at) && result.photo.fov === prior.view.photo.fov);
          check(id + ' architectural PNG and clean console', /^data:image\/png;base64,/.test(result.data ?? '') && errors.length === 0, errors);
        } catch (error) { await failure(page, id, errors, resources, error); throw error; }
        finally { await close(context); }
      }
      for (const [id, options] of [['desktop', { viewport: { width: 1400, height: 1000 } }], ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
        budget(); const { context, page, errors, resources } = await createContext(options);
        const camera = cases.find(row => row.id === 'landmark'), url = new URL(base.href + '/');
        url.search = new URLSearchParams({ eye: camera.eye.join(','), at: camera.at.join(',') }).toString();
        try {
          await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: Math.min(25000, deadline - Date.now()) });
          await page.waitForFunction(() => { const e = window.__soulsEntity; return e?.layer.active && !e.layer.building && !e.layer.filling && !e.layer.stats.lastError && (!e.layer.cover.stats.enabled || e.layer.cover.stats.rebuilds > 0) && [...document.querySelectorAll('canvas')].filter(c => c.getBoundingClientRect().width > 0 && c.getBoundingClientRect().height > 0).length === 1; });
          const inspect = () => page.evaluate(() => { const e = window.__soulsEntity, gl = e.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return {
            camera: e.camera.position.toArray(), pivot: e.controls.target.toArray(), cover: { ...e.layer.cover.stats }, tier: window.__soulsQuality?.tier,
            lost: gl.isContextLost(), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            canvases: [...document.querySelectorAll('canvas')].filter(canvas => canvas.getBoundingClientRect().width > 0 && canvas.getBoundingClientRect().height > 0).length,
            overflow: document.documentElement.scrollWidth > innerWidth + 1 };
          });
          await snapshot(page, id + '-before-input'); const initial = await inspect();
          const row = { id, device: id === 'phone' ? 'viewport/touch emulation on owner browser' : 'owner desktop browser', viewport: options, expectedCamera: { eye: camera.eye, at: camera.at }, initial, errors, resources, visualInspection: 'pending-root-review' };
          report.live.push(row); save();
          check(id + ' live viewer ready without overflow or context loss', !initial.lost && !initial.overflow && initial.canvases === 1 && errors.length === 0, initial);
          check(id + ' begins at explicit fixture camera', samePoint(initial.camera, camera.eye) && samePoint(initial.pivot, camera.at), { actual: initial.camera, pivot: initial.pivot });
          check(id + ' cover respects existing quality policy', id === 'desktop' ? initial.cover.enabled && Object.values(initial.cover.instances).some(n => n > 0) : initial.tier === 'phone' && !initial.cover.enabled, initial.cover);
          const canvas = page.locator('canvas:visible').first(), box = await canvas.boundingBox(); assert.ok(box, 'visible live canvas');
          const x = box.x + box.width * .5, y = box.y + box.height * .5;
          if (id === 'phone') {
            const cdp = await context.newCDPSession(page);
            try { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 70, y: y + 10 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
            finally { await cdp.detach(); }
          } else { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 90, y + 10, { steps: 8 }); await page.mouse.up(); }
          await page.waitForFunction(prior => { const p = window.__soulsEntity?.camera.position.toArray(); return p && Math.hypot(...p.map((v, i) => v - prior[i])) > .05; }, initial.camera);
          await snapshot(page, id + '-after-input'); row.afterInput = await inspect();
          check(id + ' real input changes camera and retains live WebGL', !row.afterInput.lost && errors.length === 0, row.afterInput); save();
        } catch (error) { await failure(page, id, errors, resources, error); throw error; }
        finally { await close(context); }
      }
      report.machinePass = report.checks.every(row => row.pass); save();
    };
    await Promise.race([work(), aborted]);
  } catch (error) { report.error = String(error); report.machinePass = false; if (error.restorationFailed) report.mediaRestore = { restored: false, error: String(error) }; }
  finally {
    accepting = false; clearTimeout(timer); signal.removeEventListener('abort', onAbort);
    let cleanupTimer;
    const restore = alignmentTask ? alignmentTask.then(value => value.restore()).then(result => { report.mediaRestore = result; }).catch(error => { report.mediaRestore = { restored: !error.restorationFailed && !alignment, error: String(error) }; }) : Promise.resolve();
    const settled = await Promise.race([Promise.all([closeAll(), restore]).then(results => ({ results })), new Promise(resolve => { cleanupTimer = setTimeout(() => resolve({ timeout: true }), QUALITY_BROWSER_LIMITS.cleanupMs); })]);
    clearTimeout(cleanupTimer);
    report.cleanup = { complete: contexts.size === 0 && openingContexts === 0 && !settled.timeout && report.mediaRestore?.restored !== false && (!alignment || report.mediaRestore?.restored === true), remainingOwnedContexts: contexts.size, openingContexts, ownerBrowserAndServerLifetimeUntouched: true };
    report.finishedAt = new Date().toISOString(); report.machinePass &&= report.cleanup.complete; report.status = report.machinePass ? 'partial' : 'fail'; save();
    writeFileSync(resolve(out, 'run.md'), '# Ground-cover browser proof\n\nStatus: ' + report.status.toUpperCase() + '. Visual acceptance remains pending root review.\n\nSource: `' + identity.sourceSha + '`; expected runtime build: `' + identity.build + '`.\n\nThe runner used two first-invocation architectural captures at retained cameras and two ordinary live viewer viewport checks. Normal architectural occlusion passes remain enabled. No performance claim.\n\n| Assertion | Result |\n| --- | --- |\n' + report.checks.map(row => '| ' + row.name + ' | ' + (row.pass ? 'pass' : 'fail') + ' |').join('\n') + '\n\nCleanup: ' + JSON.stringify(report.cleanup) + '.\n\n' + (report.error ? 'Failure: ' + report.error + '\n\n' : '') + 'Evidence: [gallery](index.html), [machine receipt](summary.json), exact input/snapshot files and before/after PNGs. Root must separately review origin grass absence, legitimate outdoor grass and live viewport usability.\n');
    const cards = ['before-enclosed-room', 'after-enclosed-room', 'before-landmark', 'after-landmark', 'desktop-before-input', 'desktop-after-input', 'phone-before-input', 'phone-after-input'];
    writeFileSync(resolve(out, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Ground cover proof</title><h1>Ground cover proof — visual review pending</h1><p>Machine checks: ' + String(report.machinePass) + '. <a href="summary.json">Receipt</a>. Fresh architectural capture includes normal occlusion passes; no warmup capture.</p>' + cards.map(id => `<figure><figcaption>${id}</figcaption><a href="${id}.png"><img style="max-width:600px" src="${id}.png"></a></figure>`).join(''));
  }
  return report;
}
