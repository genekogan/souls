// Bounded stranger-facing calendar proof: real Chrome input and the public calendar URL, fake disposable worlds.
import './gpu-chrome.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const root = resolve(new URL('../..', import.meta.url).pathname), out = resolve(process.argv[2] ?? '.lane/calendar/browser');
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(new URL('../../mars/viewer/package.json', import.meta.url))('@playwright/test');
const server = spawn(process.execPath, ['tools/bugs/proof-launcher.mjs', `${out}/data`], { cwd: root,
  env: { ...process.env, BRAIN_MODE: 'fake', SEED_NATIVES: '0' }, stdio: ['ignore', 'ignore', 'ignore'] });
const origin = 'http://127.0.0.1:6110', report = { source: process.env.P1_SOURCE_SHA, realm: 'disposable Modal launcher; public calendar API, no new UI', runs: [] };
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(fn, message) { for (let i = 0; i < 300; i++) { const value = await fn(); if (value) return value; await sleep(100); } throw new Error(message); }
try {
  await until(async () => { try { return (await fetch(origin + '/worlds/__sim/healthz')).ok; } catch { return false; } }, 'launcher boot timeout');
  for (const dpr of [1, 2]) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
      await context.addInitScript(() => localStorage.setItem('sim.dev', 'calendar-probe'));
      const page = await context.newPage(), errors = [], run = { dpr, checks: {} };
      page.on('pageerror', err => errors.push(String(err)));
      await page.goto(origin + '/worlds/');
      await page.locator('[data-new-world]').first().click(); await page.locator('[data-world-name]').fill('Calendar probe');
      await page.locator('[data-template="empty"] input').check(); await page.locator('[data-create]').click();
      await page.waitForURL(/\/worlds\/w\//, { timeout: 120000 });
      const url = new URL(page.url()); url.search = ''; url.hash = ''; const base = url.href.replace(/\/$/, '');
      await page.waitForFunction(() => !!window.__soulsEntity?.layer.active, null, { timeout: 120000 });
      await page.locator('.viewer-arrival').waitFor({ state: 'hidden', timeout: 120000 });
      await page.locator('canvas[aria-label="Live 3D view of the world"]').click({ position: { x: 650, y: 470 } });
      await page.keyboard.down('w'); await sleep(400); await page.keyboard.up('w');
      await page.screenshot({ path: `${out}/world-dpr${dpr}.png` });
      let token = 'dev:calendar-probe';
      async function api(path, body) {
        const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        assert.equal(response.status, 200, `${path}: status ${response.status}`); return response.json();
      }
      token = (await api('/v1/god/mint', { label: 'disposable calendar proof' })).token; // Fixture token is never printed or saved.
      const events = [{ name: 'tea', label: 'Tea with neighbours', at: '07:00', minutes: 60 }, { name: 'music', label: 'Music', at: '08:00', minutes: 60 }];
      const act = async ops => assert.equal((await api('/v1/god/act', { ops })).accepted, true, 'god edit accepted');
      const calendar = async () => (await api('/v1/edge/calendar')).items;
      await act([{ op: 'place', def: 'core/bench@1', name: 'calendar-bench', p: [0, 0], schedule: { events } }]);
      const before = await until(async () => { const rows = await calendar(); return rows.length === 2 ? rows : false; }, 'scheduled occurrences missing');
      await page.goto(base + '/v1/edge/calendar'); await page.locator('body').click();
      assert.match(await page.locator('body').innerText(), /Tea with neighbours/); await page.screenshot({ path: `${out}/before-dpr${dpr}.png` });
      await act([{ op: 'set', id: 'calendar-bench', schedule: { events: [events[1]] } }]);
      const remaining = await until(async () => { const rows = await calendar(); return rows.length === 1 && rows[0].title === 'Music' ? rows : false; }, 'deleted event remains');
      run.checks.otherOccurrenceUnchanged = JSON.stringify(remaining[0]) === JSON.stringify(before.find(row => row.title === 'Music'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await until(async () => !/Tea with neighbours/.test(await page.locator('body').innerText()), 'browser still shows removed event');
      await page.screenshot({ path: `${out}/one-left-dpr${dpr}.png` });
      await act([{ op: 'set', id: 'calendar-bench', schedule: null }]);
      await until(async () => (await calendar()).length === 0, 'last removed schedule remains');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await until(async () => !/"title"/.test(await page.locator('body').innerText()), 'browser still shows deleted schedule');
      await page.screenshot({ path: `${out}/empty-dpr${dpr}.png` });
      await act([{ op: 'set', id: 'calendar-bench', schedule: { events } }]);
      await until(async () => (await calendar()).length === 2, 're-added event does not return');
      await act([{ op: 'remove', id: 'calendar-bench' }]);
      await until(async () => (await calendar()).length === 0, 'removed entity calendar remains');
      run.checks.removedEvent = true; run.checks.removedLastSchedule = true; run.checks.readded = true; run.checks.removedEntity = true;
      run.errors = errors; run.ok = Object.values(run.checks).every(Boolean) && !errors.length; report.runs.push(run);
    } finally { await browser.close(); }
  }
  report.ok = report.runs.length === 2 && report.runs.every(run => run.ok);
} catch (error) { report.error = String(error.stack); report.ok = false; }
finally {
  server.kill('SIGTERM');
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); process.exitCode = report.ok ? 0 : 1;
}
