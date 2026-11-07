// One existing fixture session; no independent server or render policy.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { artwork } from './fixture-artwork.mjs';
import { edits } from './fixture.mjs';
import { correctedWallOps, createdWallBox, segmentIntersectsWall } from './wall-correction.mjs';

const exec = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Browser and CLI use the actual public endpoints; the owner's job trace cap
 * includes their requests, not only session.request calls. No route mocks. */
export async function runUiLifecycleProof({ root, withFixtureSession, report, save, out, remainder = false }) {
  const evidence = report.ui = { startedAt: new Date().toISOString(), checks: [], notes: [
    remainder ? 'Media-only replacement occurs while the actual Explore dialog remains open; no manual refresh or route mocks.' : 'Asset and wall edits precede opening Explore; this proves the UI displays the latest revision, not an in-place media refresh.',
    'The standalone Soul CLI retrieves public context without creating or moving a Soul.',
    'No mocked pagination, inference, extra scenes, or camera battery.',
  ] };
  const check = (name, ok, data = {}) => { evidence.checks.push({ name, ok: !!ok, ...data }); save(); assert.ok(ok, name); };
  const receipt = await withFixtureSession({ variant: remainder ? 'ui-live-media' : 'ui-lifecycle' }, async session => {
    const { request, signal, deadline, base, bindings, setPhase } = session;
    const ref = id => bindings.find(row => row.id === id).ref;
    const landmark = ref('landmark'), art = ref('wall-artwork'), room = ref('enclosed-room');
    const budget = () => { signal.throwIfAborted(); assert.ok(Date.now() < deadline, 'absolute deadline'); assert.ok(session.jobEvents().filter(e => e.phase === 'start').length <= session.jobStartLimit, 'actual job cap'); };
    const wait = ms => delay(ms, undefined, { signal });
    const views = async refs => (await request('/v1/world/context/views', { refs, detail: false, sheet: false }, null)).json();
    const ready = async (refs, label) => {
      setPhase(label); const start = performance.now(); let data;
      for (;;) {
        budget(); data = await views(refs);
        if (data.views.every(v => v.status !== 'pending')) break;
        if (performance.now() - start >= 15000) break;
        await wait(200);
      }
      const ms = performance.now() - start;
      check(label, data.views.every(v => v.status === 'ready') && ms <= 15000, { ms, views: data.views.map(v => ({ ref: v.ref, key: v.key, revision: v.revision, url: v.url, status: v.status,
        photo: v.photo ? { eye: v.photo.eye, at: v.photo.at, provenance: v.photo.provenance, cutaway: v.photo.cutaway } : null })) });
      return data.views;
    };
    const settled = async () => {
      for (;;) {
        budget(); const events = session.jobEvents();
        if (events.filter(e => e.phase === 'start').length === events.filter(e => e.phase === 'finish').length) { await wait(300); if (session.jobEvents().length === events.length) return; }
        await wait(100);
      }
    };
    const firstListing = await (await request('/v1/world/context', undefined, null)).json();
    evidence.initialListing = firstListing.targets.map(t => ({ ref: t.ref, title: t.title }));
    const expectedRefs = [...new Set([...bindings.map(b => b.ref), bindings.find(b => b.id === 'enclosed-room').entity])].sort();
    check('initial default listing has six exact fixture records', firstListing.total === 6 && JSON.stringify(firstListing.targets.map(t => t.ref).sort()) === JSON.stringify(expectedRefs), { expectedRefs });
    if (!remainder) {
    const first = await ready([landmark, art], 'prime-two-nondetail');
    const artBefore = first.find(v => v.ref === art);
    const bytes = artwork(1), uploaded = await session.uploadArtwork(bytes), asset = uploaded.asset ?? uploaded;
    check('replacement asset uses frozen exact bytes', (asset.sha ?? asset.hash) === sha(bytes));
    setPhase('asset-replace');
    const changed = await (await request('/v1/god/act', { ops: [{ op: 'set', id: 'hall/artwork', state: { media: `/assets/${sha(bytes)}.png` } }] })).json();
    evidence.mediaAct = { accepted: changed.accepted, seq: changed.seq, failures: changed.failures }; save();
    check('media-only edit accepted', changed.accepted);
    const second = await ready([art, landmark], 'asset-refresh');
    const artAfter = second.find(v => v.ref === art);
    check('media replaces pixels under stable ref', artAfter.ref === artBefore.ref && artAfter.key !== artBefore.key);
    const oldOriginal = await session.rawGet(artBefore.original.url);
    check('old original version refused', oldOriginal.status === 404, { status: oldOriginal.status });
    const oldArt = await session.rawGet(artBefore.url);
    check('old cached artwork URL refused', oldArt.status === 404, { status: oldArt.status });
    const exact = await (await request('/v1/world/context?ref=' + encodeURIComponent(art), undefined, null)).json();
    const original = exact.targets[0].original, originalBytes = Buffer.from(await (await session.rawGet(original.url)).arrayBuffer());
    check('current original is exact replacement', sha(originalBytes) === sha(bytes), { original });
    setPhase('intervening-wall');
    const ops = correctedWallOps();
    evidence.wallCorrection = { original: edits.find(e => e.id === 'intervening-wall').ops, originalFailure: { code: 'overlap.solid', detail: 'overlaps landmark', suggest: { p: [-19.14, 6.48] } }, corrected: ops,
      reason: 'Original wall overlaps the subject. Corrected real wall crosses the qualified initial eye-to-target ray without changing the subject. God yaw is radians: PI/2 expresses the intended perpendicular wall.' }; save();
    const wall = await (await request('/v1/god/act', { ops })).json();
    evidence.wallAct = { accepted: wall.accepted, seq: wall.seq, failures: wall.failures }; save();
    check('reviewed corrected intervening wall accepted', wall.accepted);
    const wallSnapshot = await (await request('/v1/world/snapshot', undefined, null)).json();
    const actualWall = wallSnapshot.entities.find(e => e.name === 'occluder');
    const wallDefinition = wallSnapshot.defs.find(d => d.ref === actualWall?.def || 'sha:' + d.hash === actualWall?.def);
    const box = createdWallBox(actualWall, wallDefinition);
    const initialPhoto = second.find(v => v.ref === landmark).photo, intersection = segmentIntersectsWall(initialPhoto.eye, initialPhoto.at, box);
    check('actual new wall blocks the prior actual camera-to-subject ray', !!intersection, { box, definition: { ref: wallDefinition.ref, hash: wallDefinition.hash }, eye: initialPhoto.eye, at: initialPhoto.at, intersection });
    const third = await ready([landmark, art], 'wall-refresh');
    check('neighbour wall invalidates landmark key with stable subject ref', third.find(v => v.ref === landmark)?.key !== second.find(v => v.ref === landmark).key && third.some(v => v.ref === landmark));
    const oldFountain = await session.rawGet(second.find(v => v.ref === landmark).url);
    check('old cached fountain URL refused after wall', oldFountain.status === 404, { status: oldFountain.status });
    await settled();
    }
    const listing = await (await request('/v1/world/context', undefined, null)).json();
    evidence.uiListing = listing.targets.map(t => ({ ref: t.ref, title: t.title }));
    check('bounded real default listing before opening UI', listing.total >= 6 && listing.total <= 7 && !listing.nextCursor);

    let browserServer, browser, page, closing;
    const responseTasks = new Set(), browserViews = [], errors = [];
    const snapshot = async name => {
      writeFileSync(resolve(out, name + '.yml'), await page.locator('body').ariaSnapshot());
      await page.screenshot({ path: resolve(out, name + '.png'), fullPage: false });
    };
    const closeBrowser = () => {
      if (!browser && !browserServer) return Promise.resolve();
      return closing ??= (async () => {
      if (browser) await Promise.race([browser.close().catch(() => {}), delay(750)]);
      if (browserServer) await Promise.race([browserServer.close().catch(() => {}), delay(750)]);
      // The fixture owner's identity registry is the final bounded force-cleanup fallback.
      if (browserServer?.process().exitCode === null) await Promise.race([browserServer.kill().catch(() => {}), delay(250)]);
      })();
    };
    const onAbort = () => { void closeBrowser(); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
      budget(); assert.ok(deadline - Date.now() >= 20000, 'enough work budget before browser launch');
      browserServer = await chromium.launchServer({ executablePath: process.env.GOD_LOOK_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--ignore-gpu-blocklist'], timeout: 5000 });
      await session.registerProcess(browserServer.process().pid);
      budget();
      browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 5000 });
      budget();
      const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
      await context.addInitScript(() => localStorage.setItem('skipgc', 't'));
      page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(String(error).slice(0, 300)));
      page.on('response', response => {
        if (!response.url().endsWith('/v1/world/context/views')) return;
        const task = response.json().then(data => browserViews.push(data)).catch(error => errors.push(String(error))).finally(() => responseTasks.delete(task));
        responseTasks.add(task);
      });
      setPhase('explore-ui');
      await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: Math.min(30000, deadline - Date.now()) });
      await page.getByRole('button', { name: /Explore/ }).first().waitFor({ state: 'visible' });
      await snapshot('ui-before-open');
      await page.getByRole('button', { name: /Explore/ }).first().click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor({ state: 'visible' });
      await snapshot('ui-explore-initial');
      for (const target of listing.targets) {
        const button = dialog.getByRole('button', { name: target.title, exact: true });
        await button.scrollIntoViewIfNeeded();
        if (expectedRefs.includes(target.ref)) await button.locator('img').waitFor({ state: 'visible', timeout: 15000 });
        else {
          const started = Date.now(); let terminal;
          while (!(terminal = browserViews.flatMap(v => v.views ?? []).findLast(v => v.ref === target.ref && v.status !== 'pending'))) {
            budget(); assert.ok(Date.now() - started < 17000, 'extra wall card reaches a terminal state'); await wait(100);
          }
          check('extra wall card remains usable as text', ['ready', 'unavailable'].includes(terminal.status), { ref: target.ref, status: terminal.status, reason: terminal.reason });
        }
        const label = await button.getAttribute('aria-description');
        check('architectural disclosure ' + target.ref, /Architectural context.*fixed daylight.*default doors.*no Souls/.test(label ?? ''), { label });
      }
      await Promise.all([...responseTasks]); await settled();
      await snapshot('ui-explore-ready');
      if (remainder) {
        const artTarget = listing.targets.find(t => t.ref === art);
        const artButton = dialog.getByRole('button', { name: artTarget.title, exact: true });
        await artButton.scrollIntoViewIfNeeded();
        const oldSrc = await artButton.locator('img').getAttribute('src');
        const oldView = browserViews.flatMap(v => v.views ?? []).findLast(v => v.ref === art && v.status === 'ready');
        check('open Explore displays initial artwork', !!oldView && new URL(oldSrc, base).href === base + oldView.url);
        const bytes = artwork(1), uploaded = await session.uploadArtwork(bytes), asset = uploaded.asset ?? uploaded;
        check('live replacement bytes match frozen artwork', (asset.sha ?? asset.hash) === sha(bytes));
        setPhase('explore-open-media-edit'); const editedAt = performance.now();
        const changed = await (await request('/v1/god/act', { ops: [{ op: 'set', id: 'hall/artwork', state: { media: `/assets/${sha(bytes)}.png` } }] })).json();
        evidence.liveMediaAct = { accepted: changed.accepted, seq: changed.seq, failures: changed.failures }; save();
        check('open-dialog media-only edit accepted', changed.accepted);
        // Observe the same live UI; never call views(), reload, or reopen here.
        await page.waitForFunction(({ title, oldSrc }) => {
          const dialog = document.querySelector('dialog[open], [role="dialog"]');
          const button = [...(dialog?.querySelectorAll('button') ?? [])].find(b => b.getAttribute('aria-label') === title || b.textContent?.trim() === title);
          const img = button?.querySelector('img');
          return !!img && img.getAttribute('src') !== oldSrc && img.complete && img.naturalWidth > 0;
        }, { title: artTarget.title, oldSrc }, { timeout: Math.max(1, 15000 - (performance.now() - editedAt)) });
        await Promise.all([...responseTasks]);
        const newSrc = await artButton.locator('img').getAttribute('src');
        const newView = browserViews.flatMap(v => v.views ?? []).findLast(v => v.ref === art && v.status === 'ready');
        check('open Explore refreshes stable artwork ref and new pixels within 15s', await dialog.isVisible() && newView?.key !== oldView.key && newView?.revision !== oldView.revision && new URL(newSrc, base).href === base + newView.url && performance.now() - editedAt <= 15000,
          { elapsedMs: performance.now() - editedAt, oldView, newView, oldSrc, newSrc });
        const oldImage = await session.rawGet(oldView.url), oldOriginal = await session.rawGet(oldView.original.url);
        check('live media edit refuses old image and original', oldImage.status === 404 && oldOriginal.status === 404, { imageStatus: oldImage.status, originalStatus: oldOriginal.status });
        const exact = await (await request('/v1/world/context?ref=' + encodeURIComponent(art), undefined, null)).json();
        const original = exact.targets[0].original, originalBytes = Buffer.from(await (await session.rawGet(original.url)).arrayBuffer());
        check('live media original matches exact replacement', sha(originalBytes) === sha(bytes), { original });
        await snapshot('ui-explore-live-media');
        // Let visible UI finish its shared refresh before testing CLI cache reuse.
        for (const target of listing.targets) await dialog.getByRole('button', { name: target.title, exact: true }).locator('img').waitFor({ state: 'visible', timeout: 15000 });
        await settled();
      }

      const roomTarget = listing.targets.find(t => t.ref === room);
      const roomButton = dialog.getByRole('button', { name: roomTarget.title, exact: true });
      const imageUrl = await roomButton.locator('img').getAttribute('src');
      const uiView = browserViews.flatMap(v => v.views ?? []).findLast(v => v.ref === room && v.status === 'ready');
      check('Explore uses ready shared room image', !!uiView && new URL(imageUrl, base).href === base + uiView.url, { uiView, imageUrl });
      const uiBytes = Buffer.from(await (await session.rawGet(uiView.url)).arrayBuffer());
      const cliDir = resolve(out, 'cli-public'); mkdirSync(cliDir);
      writeFileSync(resolve(cliDir, '.eden-agent.json'), JSON.stringify({ world: base }), { mode: 0o600 });
      const startsBefore = session.jobEvents().filter(e => e.phase === 'start').length;
      const cliPath = process.env.CONTEXT_CLI ?? resolve(root, 'tools/world-launcher/soul/eden.mjs');
      const cliSource = readFileSync(cliPath), cliSha = sha(cliSource);
      if (process.env.CONTEXT_CLI_SHA256) check('approved CLI source hash', cliSha === process.env.CONTEXT_CLI_SHA256);
      evidence.cliSource = { path: cliPath, sha256: cliSha, version: cliSource.toString().match(/const VERSION = "([^"]+)"/)?.[1] ?? null };
      const cliImage = resolve(out, 'cli-room.png');
      const { stdout } = await exec(process.execPath, [cliPath, 'views', room, '--out', cliImage], { cwd: cliDir, timeout: Math.min(15000, deadline - Date.now()), signal, maxBuffer: 1024 * 1024 });
      const cli = JSON.parse(stdout), cliView = cli.views[0];
      check('CLI reuses exact non-detail UI image without a render', cliView.key === uiView.key && cliView.revision === uiView.revision && cliView.url === uiView.url && sha(readFileSync(cliImage)) === sha(uiBytes) && session.jobEvents().filter(e => e.phase === 'start').length === startsBefore,
        { ref: room, key: cliView.key, revision: cliView.revision, url: cliView.url, imageSha: sha(uiBytes), cliPath });
      await snapshot('ui-before-room-selection');
      let createdSoul;
      if (remainder) {
        const created = await (await request('/v1/souls', { name: 'Camera Witness', description: 'Isolated explicit camera proof; no model or directive.' }, 'dev:context-ui')).json();
        createdSoul = created.soul;
        check('one real local Soul created', !!createdSoul?.entityId, { soulId: createdSoul?.id, entityId: createdSoul?.entityId });
      }
      const physicalBody = async () => {
        const snapshot = await (await request('/v1/world/snapshot', undefined, null)).json();
        const body = snapshot.entities.find(e => e.id === createdSoul?.entityId);
        return body ? { id: body.id, p: body.p, r: body.r, in: body.in } : null;
      };
      const bodyBefore = remainder ? await physicalBody() : null;
      const worldBefore = await (await request('/v1/world', undefined, null)).json(), soulsBefore = worldBefore.souls;
      check(remainder ? 'populated fixture before selection' : 'fixture has no Souls before selection', Array.isArray(soulsBefore) && soulsBefore.length === (remainder ? 1 : 0) && (!remainder || !!bodyBefore));
      const beforeCamera = await page.evaluate(() => globalThis.__soulsCamera ?? null);
      await roomButton.click();
      await dialog.waitFor({ state: 'hidden' });
      const expectedCamera = roomTarget.viewpoint ?? roomTarget.camera;
      assert.ok(expectedCamera, 'room publishes an inspection camera');
      await page.waitForFunction(expected => {
        const actual = globalThis.__soulsCamera;
        const distance = (a, b) => a && b ? Math.hypot(...a.map((v, i) => v - b[i])) : Infinity;
        return distance(actual?.p, expected.eye) < .05 && distance(actual?.pivot, expected.at) < .05;
      }, expectedCamera);
      const afterCamera = await page.evaluate(() => globalThis.__soulsCamera ?? null);
      await snapshot('ui-room-selected');
      const distance = (a, b) => a && b ? Math.hypot(...a.map((v, i) => v - b[i])) : Infinity;
      check('room selection reaches published inspection eye and target', !!afterCamera && !!expectedCamera && distance(afterCamera.p, expectedCamera.eye) < .05 && distance(afterCamera.pivot, expectedCamera.at) < .05,
        { beforeCamera, afterCamera, expectedCamera, roomRef: room });
      const worldAfter = await (await request('/v1/world', undefined, null)).json(), soulsAfter = worldAfter.souls;
      const bodyAfter = remainder ? await physicalBody() : null;
      check(remainder ? 'camera selection leaves populated Soul body unmoved' : 'Explore never creates or moves a Soul in the empty fixture',
        remainder ? soulsAfter.length === 1 && soulsAfter[0].id === soulsBefore[0].id && JSON.stringify(bodyBefore) === JSON.stringify(bodyAfter) : JSON.stringify(soulsBefore) === JSON.stringify(soulsAfter),
        { before: soulsBefore.length, after: soulsAfter.length, tickBefore: worldBefore.tick, tickAfter: worldAfter.tick, rosterBefore: soulsBefore, rosterAfter: soulsAfter, bodyBefore, bodyAfter, limitation: 'Any change fails; this does not automatically attribute independent autonomous motion to the camera.' });
      evidence.browserErrors = errors;
    } finally { signal.removeEventListener('abort', onAbort); await closeBrowser(); await Promise.race([Promise.all([...responseTasks]), delay(250)]); }
    await settled();
    setPhase('idle-after-browser-close');
    const idleEvents = session.jobEvents().length, idleAt = Date.now(), idleBefore = await session.ownedProcesses();
    await wait(30000);
    const idleAfter = await session.ownedProcesses();
    check('30 seconds idle has no new jobs or owned browser processes', session.jobEvents().length === idleEvents && idleBefore.every(p => p.server) && idleAfter.every(p => p.server), { elapsedMs: Date.now() - idleAt, idleBefore, idleAfter });
  });
  evidence.receipt = receipt;
  evidence.finishedAt = new Date().toISOString();
  evidence.functionalPass = !receipt.error && receipt.cleanup.complete && evidence.checks.every(c => c.ok);
  evidence.resourcePass = receipt.resources?.combinedWithinBound === true;
  evidence.pass = evidence.functionalPass && evidence.resourcePass;
  evidence.error = receipt.error;
  save();
  return evidence;
}
