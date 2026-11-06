import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('social crawlers receive the Souls identity and immutable supplied halo without JavaScript', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const [attribute, key, value] of [
    ['property', 'og:title', 'Souls'], ['property', 'og:description', 'MMO World Simulator'],
    ['name', 'twitter:title', 'Souls'], ['name', 'twitter:description', 'MMO World Simulator'],
  ]) assert.ok(html.includes(`<meta ${attribute}="${key}" content="${value}"`));
  const images = [...html.matchAll(/<meta (?:property="og:image"|name="twitter:image") content="([^"]+)"/g)].map(m => m[1]);
  assert.equal(images.length, 2);
  assert.equal(images[0], images[1]);
  const manifest = JSON.parse(readFileSync(new URL('../../../tools/assets/manifest.json', import.meta.url), 'utf8'));
  assert.equal(images[0], manifest.files.find((file: {path:string}) => file.path === 'apps/web/src/media/halo-social.png').url);
  assert.ok(html.includes('<link rel="canonical" href="https://soul.game/"'));
});

test('the top-left Souls halo always sits in a solid black circle, in a world and on the world list (#1034)', () => {
  const css = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [path, selector] of [['./world-chrome.css', '.human-world .eden-mark'], ['./god-ui/launcher-home.css', '.lh-title .eden-mark']]) {
    const rules = [...css(path).matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter(m => m[1].split(',').some(s => s.trim() === selector));
    assert.ok(rules.length > 0, `${path} styles ${selector}`);
    const backgrounds = rules.flatMap(m => [...m[2].matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/g)].map(b => b[1].trim()));
    assert.deepEqual(backgrounds, ['#000'], `${selector} has one background, solid black, not a theme token`);
    assert.ok(rules.some(m => /border-radius:\s*50%/.test(m[2])), `${selector} is a circle`);
  }
});
