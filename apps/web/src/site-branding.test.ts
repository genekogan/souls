import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DESCRIPTION = "Souls: persistent shared worlds where every character, a Soul, is run by its owner&#39;s own AI agent. Watch a world live, pair your agent with a Soul, or make a world and be its god.";

test('social crawlers receive the Souls identity and immutable supplied halo without JavaScript', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const [attribute, key, value] of [
    ['property', 'og:title', 'Souls'], ['property', 'og:description', DESCRIPTION],
    ['name', 'twitter:title', 'Souls'], ['name', 'twitter:description', DESCRIPTION], ['name', 'description', DESCRIPTION],
  ]) assert.ok(html.includes(`<meta ${attribute}="${key}" content="${value}"`));
  const images = [...html.matchAll(/<meta (?:property="og:image"|name="twitter:image") content="([^"]+)"/g)].map(m => m[1]);
  assert.equal(images.length, 2);
  assert.equal(images[0], images[1]);
  const manifest = JSON.parse(readFileSync(new URL('../../../tools/assets/manifest.json', import.meta.url), 'utf8'));
  assert.equal(images[0], manifest.files.find((file: {path:string}) => file.path === 'apps/web/src/media/halo-social.png').url);
  assert.ok(html.includes('<link rel="canonical" href="https://soul.game/"'));
});
