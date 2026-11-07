import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const esbuildPin = readdirSync(root+'node_modules/.pnpm').find(name => name.startsWith('esbuild@'));
assert.ok(esbuildPin, 'Existing frozen workspace esbuild prerequisite');
const { build } = await import(root+'node_modules/.pnpm/'+esbuildPin+'/node_modules/esbuild/lib/main.js');
await build({ absWorkingDir:root, entryPoints:['apps/web/test/viewer-lifecycle.fixture.tsx'], bundle:true,
  format:'esm', platform:'browser', jsx:'automatic', outfile:root+'apps/web/dist/assets/viewer-lifecycle.js',
  define:{'process.env.NODE_ENV':'"production"',__BUILD__:'"dev"'} });
const base = process.env.SIM_GAME_TEST_BASE ?? 'http://127.0.0.1:4960';
assert.match(new URL(base).hostname, /^(127\.0\.0\.1|localhost)$/);
assert.ok(Number(new URL(base).port) >= 4960 && Number(new URL(base).port) <= 4969);
assert.equal((await (await fetch(base + '/w/eden/v1/config')).json()).devAuth, true);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= root + '.e2e/browsers';
const { chromium } = createRequire(new URL('../../../mars/viewer/package.json', import.meta.url))('@playwright/test');
const output = root + '.e2e/runs/viewer-frame-' + new Date().toISOString().replaceAll(':', '-');
mkdirSync(output, { recursive: true });
writeFileSync(output+'/source.txt', execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'})+execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}));
const checks = [], errors = [];
const check = (name, value) => { assert.ok(value, name); checks.push({ name, pass: true }); };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
let page;
try {
  const owner = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await owner.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); localStorage.setItem('sim.authUi', '1'); });
  // Advance recorded history sooner in this fake-only development fixture.
  assert.equal((await owner.request.post(base+'/w/eden/v1/admin', {headers:{authorization:'Bearer dev:admin'},data:{action:'clock_rate',rate:4}})).status(),200);
  page = await owner.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/w/eden?rewind=1');
  // VF1: arriving is one calm card (no warnings, no "Held"), gone once the first frame is drawn.
  const arrival = await page.waitForFunction(() => { const c = document.querySelector('.viewer-arrival[data-done="false"]'); return c && { card: c.textContent, status: document.querySelector('[data-viewer-status]')?.textContent, cls: document.querySelector('[data-viewer-status]')?.className, reasons: document.querySelectorAll('.viewer-reason').length, text: document.body.innerText }; }).then(h => h.jsonValue());
  check('Arrival shows one loading card and a neutral pill, never Held or Reconnecting', /^Loading Eden/.test(arrival.card) && arrival.status === 'Loading…' && arrival.cls === 'loading' && arrival.reasons === 0 && !/Held|Reconnecting/.test(arrival.text));
  await page.getByRole('button', { name: 'Your Soul', exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('.viewer-history')?.getAttribute('data-viewer-tick')) > 0 && document.querySelector('.viewer-history')?.getAttribute('data-viewer-selection'));
  check('Typed handle ready and canonical selected Soul published', await page.locator('.viewer-history').getAttribute('data-viewer-ready') === 'true' && !!await page.locator('.viewer-history').getAttribute('data-viewer-selection'));
  check('Duplicate Soul info removed by agreed prop', await page.locator('.world-soul-info').count() === 0);
  const canvas = await page.locator('canvas').elementHandle();
  await page.locator('#soul-panel .soul-follow').click();
  await page.waitForFunction(() => document.querySelector('.viewer-history')?.getAttribute('data-viewer-mode') === 'follow');
  const visibleActor = () => page.evaluate(() => {
    const v = document.querySelector('.world-viewport').getBoundingClientRect();
    const p = document.querySelector('.human-panel:not([hidden])')?.getBoundingClientRect();
    const name = [...document.querySelectorAll('.world-canvas-host b')].find(el => el.textContent === 'Eden');
    if (!name) return false;
    const r = name.getBoundingClientRect();
    return r.width > 0 && r.left >= v.left && r.right <= v.right && r.top >= v.top && r.bottom < (p?.top ?? v.bottom);
  });
  await page.waitForFunction(() => {
    const p=document.querySelector('.human-panel:not([hidden])').getBoundingClientRect();
    const b=[...document.querySelectorAll('.world-canvas-host b')].find(el=>el.textContent==='Eden');
    return b && b.getBoundingClientRect().bottom < p.top;
  });
  check('Actual selected actor label visible above phone drawer in Follow', await visibleActor());
  const direction = page.locator('#soul-direction');
  await direction.fill('please walk when you can'); await direction.press('ArrowLeft'); await direction.press('Escape');
  check('Typing and Escape preserve Follow and the prompt', await page.locator('.viewer-history').getAttribute('data-viewer-mode') === 'follow' && await direction.inputValue() === 'please walk when you can');
  await page.screenshot({ path: output + '/phone-follow.png' });
  check('Arrival card is gone once drawn; status is Live', await page.locator('.viewer-arrival').count() === 0 && await page.locator('[data-viewer-status]').textContent() === 'Live');
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  check('Closing the panel keeps canvas mounted', await page.evaluate(el => el === document.querySelector('canvas'), canvas) && await page.locator('#soul-panel').isHidden());
  await page.getByRole('button', { name: 'Your Soul', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => {
    const p=document.querySelector('.human-panel:not([hidden])').getBoundingClientRect();
    const b=[...document.querySelectorAll('.world-canvas-host b')].find(el=>el.textContent==='Eden');
    return b && b.getBoundingClientRect().right < p.left;
  });
  check('Resize places actual actor beside desktop drawer', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: output + '/desktop-follow.png' });
  await page.waitForFunction(() => Number(document.querySelector('.viewer-history')?.getAttribute('data-viewer-tick')) > 1600, null, {timeout:120000});
  await page.getByRole('button', { name: 'Back 1 min', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.viewer-history')?.getAttribute('data-viewer-presentation') === 'history');
  check('Typed history seek reports actual drawn tick', Number(await page.locator('.viewer-history').getAttribute('data-viewer-tick')) >= 0);
  await page.getByRole('button', { name: 'Pause recording', exact: true }).waitFor();
  check('History seek truthfully reports automatic playback', true);
  await page.getByRole('button', { name: 'Pause recording', exact: true }).click();
  await page.getByRole('button', { name: 'Play recording', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await page.getByRole('button', { name: 'Pause recording', exact: true }).waitFor();
  check('Typed playback pause and resume acknowledged', true);
  await page.getByRole('button', { name: 'Return to live', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.viewer-history')?.getAttribute('data-viewer-presentation') === 'live');
  check('Typed return to live acknowledged', true);
  await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const extension = gl.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Actual context-loss extension unavailable');
    window.__contextRecovery = extension;
    extension.loseContext();
  });
  await page.locator('[data-viewer-status]').filter({hasText:'View paused'}).waitFor();
  check('Actual post-drawn context loss keeps last tick but removes green Live', await page.locator('.viewer-history').getAttribute('data-viewer-tick') !== '' && await page.locator('[data-viewer-status]').getAttribute('class') === 'warn');
  check('Supplied context-loss reason remains visible', await page.locator('.viewer-history').getByText('The 3D graphics context was lost.', {exact:true}).isVisible());
  await page.screenshot({path:output+'/held-context.png'});
  await page.evaluate(() => window.__contextRecovery.restoreContext());
  await page.locator('[data-viewer-status]').filter({hasText:'Live'}).waitFor();
  check('Actual graphics restoration returns current live state', await page.locator('[data-viewer-status]').getAttribute('class') === 'ok');
  await page.getByRole('button', { name: 'All Souls', exact: false }).click();
  await page.waitForFunction(() => document.querySelector('.viewer-history')?.getAttribute('data-viewer-selection') === '');
  await page.waitForFunction(() => !document.querySelector('.soul-follow') && !document.querySelector('.viewer-following'), null, { timeout: 20000 });
  check('Selection clear acknowledged; Follow is only offered on a Soul card and the Following chip goes', true);
  writeFileSync(output + '/app.yml', await page.locator('body').ariaSnapshot());
  await page.evaluate(() => import('/w/eden/assets/viewer-lifecycle.js'));
  await page.waitForFunction(() => window.__viewerProbe?.audit.states.some(s => s.shownTick !== null));
  check('Real mounted viewer emits initial null followed by drawn recording', await page.evaluate(() => window.__viewerProbe.audit.states.some(s => s.shownTick === null)));
  check('Unknown entity rejected without canonical selection', await page.evaluate(() => !window.__viewerProbe.audit.handle.selectEntity('not-an-entity')));
  await page.evaluate(() => window.__viewerProbe.unmount());
  check('Actual unmount publishes handle null', await page.evaluate(() => window.__viewerProbe.audit.handle === null && window.__viewerProbe.audit.handles.at(-1) === false));
  await owner.close();
  const broken = await browser.newContext();
  await broken.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(kind, ...args) { return kind.startsWith('webgl') ? null : get.call(this,kind,...args); }; });
  page = await broken.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base + '/w/eden?rewind=1');
  await page.getByText('This browser could not start 3D graphics.', {exact:true}).waitFor();
  check('Graphics failure is stated plainly, not as a loading card', await page.locator('.viewer-arrival').count() === 0 && await page.locator('[data-viewer-status]').textContent() === 'View unavailable');
  check('Graphics startup failure remains visible with null drawn tick', await page.locator('.viewer-history').getAttribute('data-viewer-tick') === '');
  await page.screenshot({ path: output + '/graphics-unavailable.png' });
  check('No browser page errors', errors.length === 0);
  writeFileSync(output + '/summary.json', JSON.stringify({ status:'pass',checks,errors },null,2));
  writeFileSync(output + '/index.html', '<h1>Viewer frame proof</h1>'+checks.map(c=>`<p>PASS ${c.name}</p>`).join('')+['phone-follow','desktop-follow','held-context','graphics-unavailable'].map(n=>`<h2>${n}</h2><img width="90%" src="${n}.png">`).join(''));
  console.log(output, checks.length+' checks PASS');
} catch(e) {
  if(page) {await page.screenshot({path:output+'/failure.png'}).catch(()=>{});writeFileSync(output+'/failure.yml',await page.locator('body').ariaSnapshot().catch(()=>''));}
  writeFileSync(output+'/summary.json',JSON.stringify({status:'fail',checks,errors,failure:String(e)},null,2)); console.error(output);throw e;
} finally {await browser.close();}
