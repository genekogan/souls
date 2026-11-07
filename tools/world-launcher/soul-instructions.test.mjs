// #1145: instructions.md is what a new Soul's agent follows first. `act` takes an offered id and refuses words.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the guide shows act with an offered id, never with quoted words', () => {
  const guide = readFileSync(new URL('./soul/instructions.md', import.meta.url), 'utf8');
  assert.doesNotMatch(guide, /\bact\s+["']/);
  assert.match(guide, /`node eden\.mjs act wave:here --wait`/);
});
