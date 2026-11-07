import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DISC_RADIUS, FILL_MS, SOLID, easeFraction, lightRadius, lightScale } from './arrival-light.ts';

const run = (targets: number[], seconds = 1 / 30) => { let f = 0; const out: number[] = []; for (const t of targets) out.push(f = easeFraction(f, t, seconds)); return out; };

test('the radius eases toward the bar: a clump of progress is a swell, not a jump, and it arrives', () => {
  const steps = run(Array(30 * 8).fill(0.9));
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] - steps[i - 1] <= 0.6 / 30 + 1e-9, `step ${i}`);
  assert.ok(Math.abs(steps.at(-1)! - 0.9) < 0.002, String(steps.at(-1)));
});

test('the radius never shrinks, whatever the target does', () => {
  const steps = run([0.5, 0.5, 0.1, 0, 0.6, 0.2, 0, 1, 0.3].flatMap(t => Array(20).fill(t)));
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] >= steps[i - 1], `step ${i}`);
});

test('a stalled frame never jumps it', () => {
  assert.ok(easeFraction(0, 1, 30) <= 0.6 * 0.25 + 1e-9, 'a long gap between frames moves no further than a short one');
});

test('it runs from just covering the text to the corners, on any aspect ratio, and the disc is sized to cover them', () => {
  for (const [w, h] of [[1920, 1080], [390, 844], [844, 390], [1000, 1000], [320, 1400]]) {
    assert.equal(lightRadius(0, w, h, 140), 140);
    const corner = Math.hypot(w, h) / 2;
    assert.ok(Math.abs(lightRadius(1, w, h, 140) - corner) < 1e-9);
    assert.ok(Math.abs(lightScale(corner, w, h) * SOLID * Math.min(w, h) - corner) < 1e-9, 'the solid part reaches the corners');
  }
});

test('first paint is the same picture: black, the disc and the words, and no card', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8'), css = readFileSync(new URL('./world-chrome.css', import.meta.url), 'utf8');
  assert.match(html, /class="arrival-disc"/); assert.match(html, /Loading the world/);
  assert.doesNotMatch(html, /viewer-arrival-card|viewer-arrival-spinner|Arriving/);
  assert.match(html, /early-world-poster[\s\S]*dataset\.fill/, 'a phone\'s poster does not wait for the app\'s code: the boot light finishes the arrival');
  assert.match(html, /worldName[\s\S]*textContent='Loading '\+n/, 'it names the world from the page, as text');
  assert.match(css, /\.viewer-arrival\{[^}]*background:#000/);
});

test('the light sits above the early poster, or a phone never sees it', () => {
  const css = readFileSync(new URL('./world-chrome.css', import.meta.url), 'utf8'), early = readFileSync(new URL('./early-render.ts', import.meta.url), 'utf8');
  const poster = Number(/zIndex: '(\d+)'/.exec(early)?.[1]), light = Number(/\.viewer-arrival\{[^}]*z-index:(\d+)/.exec(css)?.[1]);
  assert.ok(poster > 0 && light > poster, `${light} over ${poster}`);
});

test('the end of the light does not need frames: it starts from the props, on a compositor transition (#1166 review)', () => {
  const css = readFileSync(new URL('./world-chrome.css', import.meta.url), 'utf8'), view = readFileSync(new URL('./ArrivalLight.tsx', import.meta.url), 'utf8');
  assert.match(css, /\[data-fill="true"\] \.arrival-disc\{transition:transform 1\.2s/); assert.equal(FILL_MS, 1200);
  assert.match(css, /\.arrival-disc\{[^}]*will-change:transform/);
  assert.match(css, new RegExp(`width:calc\\(${DISC_RADIUS}px\\*2/\\.52\\)`));
  assert.match(view, /useLayoutEffect\(\(\) => \{ if \(\(progress \?\? 0\) >= 1 \|\| done\) run\.current\?\.fill\(\)/);
  const step = view.slice(view.indexOf('const step ='), view.indexOf('raf = requestAnimationFrame(step);\n    if'));
  assert.doesNotMatch(step, /fill\(\)|settle\(\)|dataset/, 'the frame loop only draws');
});
