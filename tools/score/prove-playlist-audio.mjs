#!/usr/bin/env node
// PERF-MUSIC proof: on a world page (a local build against the live world, or the live site) the music plays from a file,
// sounds (musicLevel > 0), crossfades into the next piece, and the main thread runs no score engine or Tone code while it
// plays (a CPU profile over the playback, by script URL). Writes a JSON proof and prints a summary.
//
//   cd apps/web && npx vite build && SIM_DEV_API=https://souls.game WEB_PORT=5212 npx vite preview --port 5212 --strictPort
//   node tools/score/serve-playlist-audio.mjs                   # the rendered files with open CORS (a local page cannot use the CDN's)
//   node tools/score/prove-playlist-audio.mjs [http://localhost:5212/w/eden/] [--audio http://127.0.0.1:5213] [--out .local/proof-music.json]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findPlaywright } from '../god-skill/lib/look.mjs';

const args = process.argv.slice(2), value = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const url = args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:5212/w/eden/', audio = value('--audio', 'http://127.0.0.1:5213'), out = resolve(value('--out', '.local/proof-music.json'));
const profileS = +value('--profile', 12), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pw = findPlaywright(); if (!pw) throw Error('no Playwright');
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const consoleErrors = []; page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200))); page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
const target = new URL(url); if (audio) target.searchParams.set('musicAudio', audio);
const t0 = Date.now(), at = () => +((Date.now() - t0) / 1000).toFixed(1);
console.log(`open ${target}`);
await page.goto(target.href, { waitUntil: 'load', timeout: 60_000 });
await page.waitForSelector('.world-scene canvas', { timeout: 60_000 });
const state = () => page.evaluate(() => { const m = window.__edenMusic, s = window.__edenSound; return { music: m?.state?.() ?? null, sound: s?.state?.() ?? null, level: m?.level?.() ?? null }; });
// the gesture that unlocks sound (and music on, unmuted, as a visitor who turned it on)
for (let i = 0; i < 40; i++) {
  await page.mouse.click(640, 400); await sleep(500);
  await page.evaluate(() => { const s = window.__edenSound; s?.unlock?.(); s?.mute?.(false); s?.music?.(true); });
  const s = await state(); if (s.sound?.ctx === 'running' && s.music) break;
}
console.log(`${at()} s: sound ${JSON.stringify((await state()).sound?.ctx)}, waiting for the music to play from a file`);
let s = null;
for (let i = 0; i < 180; i++) {
  s = await state(); if (s.music?.playing && s.music.source === 'file') break;
  if (s.music?.playing && s.music.source === 'tone') { console.log(`${at()} s: ${s.music.playing} plays from Tone (no file in this build's index); skipping`); await page.evaluate(() => window.__edenMusic.next()); await sleep(1500); }
  await sleep(500);
}
if (!s?.music?.playing) { console.log(JSON.stringify(s, null, 1)); throw Error('music did not start'); }
console.log(`${at()} s: playing ${s.music.playing} (${s.music.source}), position ${s.music.file.positionS} s, tone ctx ${s.music.toneCtx}, file ctx ${s.music.file.ctx}`);
const levels = []; for (let i = 0; i < 10; i++) { levels.push((await state()).level); await sleep(300); }
console.log(`${at()} s: level samples ${levels.join(' ')}`);

// a CPU profile of the main thread while it plays: which scripts take the samples
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start');
await sleep(profileS * 1000);
const { profile } = await cdp.send('Profiler.stop');
const byUrl = new Map(), self = new Map(); let total = 0;
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) { const n = nodes.get(profile.samples[i]); const dt = profile.timeDeltas[i] ?? 0; total += dt; const u = n.callFrame.url || `(${n.callFrame.functionName || 'program'})`; self.set(u, (self.get(u) ?? 0) + dt); }
for (const [u, dt] of self) byUrl.set(u.replace(/^https?:\/\/[^/]+/, '').replace(/-[A-Za-z0-9_-]{8}\.js$/, '.js'), (byUrl.get(u) ?? 0) + dt);
const top = [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([u, dt]) => ({ url: u, ms: +(dt / 1000).toFixed(1), pct: +((100 * dt) / total).toFixed(1) }));
const scoreMs = [...byUrl.entries()].filter(([u]) => /\/(engine|tone|Tone|pieces\/|order|skylight|harbour|branch|lantern|nightside|hydroponics|section|citronella|heron|second-ring|sunken|cheese|firn|aerial|service|after-the|night-|headland|evening|velour|halogen|cloud-street|lamplighter|frost|heat-|under-glass|flying|coin|clock|milonga|ridge|riverboat|pixel|downtown|neon|departure|line-clear|mirror|plaza|grand|magic|montage)[^/]*\.js$/.test(u)).reduce((a, [, dt]) => a + dt, 0) / 1000;
console.log(`${at()} s: profile ${(total / 1000).toFixed(0)} ms sampled; score engine / Tone self time ${scoreMs.toFixed(1)} ms; top scripts:`);
for (const t of top) console.log(`    ${t.pct.toString().padStart(5)} %  ${t.ms.toString().padStart(8)} ms  ${t.url}`);

// audio focus: a hidden tab ducks the piece for the 12 s grace and brings it back; hidden longer, the piece stops and the
// next start resumes it at the same position in its file
const hide = (h) => page.evaluate((h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, h);
const before = (await state()).music;
await hide(true); await sleep(4000); const ducked = await state(); await hide(false); await sleep(2000); const back = await state();
const shortHide = { piece: before.playing, duckedLevel: ducked.level, grace: ducked.music.graceLeftS, sameAfter: back.music.playing === before.playing, levelAfter: back.level };
console.log(`${at()} s: hidden 4 s: level ${ducked.level} (grace ${ducked.music.graceLeftS} s left); visible: ${back.music.playing} ${shortHide.sameAfter ? 'continued' : 'CHANGED'}, level ${back.level}`);
await hide(true); await sleep(14_000); const gone = await state();
const pausedAt = gone.music.paused?.positionS;
await hide(false);
let resumed = null; for (let i = 0; i < 40; i++) { resumed = await state(); if (resumed.music.playing) break; await sleep(250); }
const resumeLog = (await page.evaluate(() => window.__edenMusic.log())).filter((e) => e.ev === 'start').at(-1);
const longHide = { piece: gone.music.paused ? gone.music.playlist[gone.music.paused.index] : null, stoppedWhileHidden: !gone.music.playing, pausedAtS: pausedAt, pausedPerf: gone.music.paused?.perf ?? null, resumed: resumed.music.playing, resumedPositionS: resumed.music.file.positionS, resumedPerf: resumed.music.file.performance, start: resumeLog };
console.log(`${at()} s: hidden 14 s: stopped ${longHide.stoppedWhileHidden}, remembered ${longHide.piece} performance ${longHide.pausedPerf} at ${pausedAt?.toFixed?.(1)} s; visible: ${resumed.music.playing} performance ${longHide.resumedPerf} at ${resumed.music.file.positionS} s (${resumeLog?.reason})`);

// a fresh start of a piece (next, replay) picks a random performance: several starts, the performances they picked
const picks = [];
for (let i = 0; i < 8; i++) {
  await page.evaluate(() => window.__edenMusic.next());
  let m = null; for (let j = 0; j < 60; j++) { m = (await state()).music; if (m.playing && !m.starting && m.source === 'file') break; await sleep(250); }
  picks.push({ piece: m.playing, performance: m.file.performance, of: m.file.performances });
}
const multi = picks.filter((p) => p.of > 1), distinct = new Set(multi.map((p) => p.performance)).size;
console.log(`${at()} s: ${picks.length} starts picked performances ${picks.map((p) => `${p.piece}:${p.performance}/${p.of}`).join(' ')} (${distinct} distinct)`);

// a crossfade: shorten the piece and watch the next file take over while the current fades
await page.evaluate(() => window.__edenMusic.trackSeconds(24));
let cross = null, ended = null;
for (let i = 0; i < 120; i++) {
  const log = await page.evaluate(() => window.__edenMusic.log());
  cross = log.find((e) => e.ev === 'start' && e.reason === 'crossfade'); ended = cross && log.find((e) => e.ev === 'stop' && e.reason === 'end' && e.t > cross.t);
  if (cross && ended) break; await sleep(500);
}
s = await state();
const log = await page.evaluate(() => window.__edenMusic.log());
console.log(`${at()} s: crossfade ${cross ? `${cross.piece} started at +${cross.t} ms, previous ended at +${ended?.t} ms` : 'NOT SEEN'}; now ${s.music.playing} (${s.music.source}), level ${s.level}`);
const proof = { at: new Date().toISOString(), url: target.href, playing: s.music, levels, picks, distinctPerformances: distinct, levelOk: levels.some((l) => l > 0.001), fileSource: s.music.source === 'file', toneNeverLoaded: s.music.toneCtx === 'none' && s.music.fetched.length === 0, profile: { sampledMs: +(total / 1000).toFixed(0), scoreEngineMs: +scoreMs.toFixed(1), top }, crossfade: cross ? { start: cross, previousEnd: ended } : null, focus: { shortHide, longHide }, log, consoleErrors: consoleErrors.slice(0, 20) };
writeFileSync(out, JSON.stringify(proof, null, 1) + '\n');
const focusOk = shortHide.sameAfter && shortHide.duckedLevel < shortHide.levelAfter && longHide.stoppedWhileHidden && longHide.resumed === longHide.piece && longHide.resumedPerf === longHide.pausedPerf && Math.abs((longHide.resumedPositionS ?? 0) - (longHide.pausedAtS ?? -99)) < 3;
const ok = proof.levelOk && distinct > 1 && proof.fileSource && proof.toneNeverLoaded && proof.crossfade && focusOk && scoreMs < 5;
console.log(`${ok ? 'PROOF OK' : 'PROOF INCOMPLETE'}: ${out}`);
await browser.close();
process.exitCode = ok ? 0 : 1;
