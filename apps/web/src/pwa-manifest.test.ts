import test from 'node:test'; import assert from 'node:assert/strict';
import { PWA_MANIFEST, pwaHeadTags, pwaManifest } from './pwa-manifest.ts';

const icons = { icon32: 'sim-icon-32-z.png', icon180: 'sim-icon-180-a.png', icon192: 'sim-icon-192-b.png', icon512: 'sim-icon-512-c.png' };
// what a browser does with the manifest a world page links (URL resolution against the manifest's own URL)
const installed = (pageUrl: string, base: string) => {
  const manifestUrl = new URL(PWA_MANIFEST, pageUrl), m = pwaManifest(base, icons);
  return { start: new URL(m.start_url, manifestUrl).href, scope: new URL(m.scope, manifestUrl).href, icons: m.icons.map((i) => new URL(i.src, manifestUrl).pathname) };
};

test('an app installed from a world opens that world; scope is the release base', () => {
  const w = installed('https://sim.eden.art/worlds/w/eden-2026/#watch', '/worlds/');
  assert.equal(w.start, 'https://sim.eden.art/worlds/w/eden-2026/');
  assert.equal(w.scope, 'https://sim.eden.art/worlds/');
  assert.ok(w.start.startsWith(w.scope));
  assert.deepEqual(w.icons, ['/worlds/assets/sim-icon-192-b.png', '/worlds/assets/sim-icon-512-c.png', '/worlds/assets/sim-icon-512-c.png']);
  assert.equal(installed('https://sim.eden.art/worlds/', '/worlds/').start, 'https://sim.eden.art/worlds/');
});
test('original worlds at the root (legacy stage, base /)', () => {
  const w = installed('https://sim.eden.art/w/eden/', '/');
  assert.equal(w.start, 'https://sim.eden.art/w/eden/'); assert.equal(w.scope, 'https://sim.eden.art/');
  assert.deepEqual(w.icons[0], '/assets/sim-icon-192-b.png');
});
test('standalone, both icon purposes, and head tags', () => {
  const m = pwaManifest('/worlds/', icons);
  assert.equal(m.display, 'standalone');
  assert.equal(m.name, 'Souls');
  assert.equal(m.short_name, 'Souls');
  assert.equal(m.description, "Persistent shared worlds where every Soul is run by its owner's own AI agent.");
  assert.deepEqual(m.icons.map((i) => `${i.sizes}/${i.purpose}`), ['192x192/any', '512x512/any', '512x512/maskable']);
  assert.equal(pwaHeadTags('/worlds/', icons), '<link rel="manifest" href="manifest.webmanifest" />\n    <link rel="icon" type="image/png" sizes="32x32" href="/worlds/assets/sim-icon-32-z.png" />\n    <link rel="apple-touch-icon" href="/worlds/assets/sim-icon-180-a.png" />');
});
