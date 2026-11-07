import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrivalHold } from './arrival-hold.ts';
import { clerkSatelliteSyncs } from './clerk-sync.ts';
import { INLINE_CONFIG_GLOBAL, inlineClerkSatellite, takeInlineConfig } from './inline-config.ts';

const u = 'https://soul.example.test/w/eden/';

test('a satellite syncs on a first visit, and never again once Clerk has been there (#531)', () => {
  assert.equal(clerkSatelliteSyncs(u, ''), true, 'nothing yet');
  assert.equal(clerkSatelliteSyncs(u, 'a=1; theme=dark'), true, 'other cookies say nothing');
  assert.equal(clerkSatelliteSyncs(u + '?__clerk_synced=true', ''), false, 'back from the sync');
  assert.equal(clerkSatelliteSyncs(u + '?x=1&__clerk_synced=false', ''), false);
  assert.equal(clerkSatelliteSyncs(u, '__client_uat=0'), false, 'signed out, but synced: seen on the live site');
  assert.equal(clerkSatelliteSyncs(u, 'a=1; __client_uat_tfPh6Hl2=0'), false);
  assert.equal(clerkSatelliteSyncs(u, '__client_uat=1760000000'), false);
  assert.equal(clerkSatelliteSyncs(u, 'x__client_uat=0'), true, 'only Clerk\'s own cookie counts');
});

test('the hold is bounded, ends at most once, and tells its subscribers', async () => {
  let told = 0; const off = arrivalHold.subscribe(() => { told++; });
  assert.equal(arrivalHold.held(), false);
  const end = arrivalHold.hold(30); assert.equal(arrivalHold.held(), true); assert.equal(told, 1);
  await new Promise(r => setTimeout(r, 80));
  assert.equal(arrivalHold.held(), false, 'a Clerk that never answers cannot hold an arrival'); assert.equal(told, 2);
  end(); assert.equal(told, 2, 'a late release is nothing');
  arrivalHold.hold(1000); arrivalHold.release(); assert.equal(arrivalHold.held(), false); assert.equal(told, 4); off();
});

test('the first phase reads the satellite setting without taking the config the app still needs', async () => {
  const w = globalThis as unknown as Record<string, unknown>, before = w.window;
  w.window = { [INLINE_CONFIG_GLOBAL]: { clerkSatellite: { domain: 'x' } } };
  try {
    assert.equal(inlineClerkSatellite(), true); assert.equal(inlineClerkSatellite(), true);
    assert.ok(await takeInlineConfig(), 'still there for the app'); assert.equal(inlineClerkSatellite(), false);
  } finally { w.window = before; }
  assert.equal(inlineClerkSatellite(), false, 'no page, no satellite');
});

test('a syncing page draws nothing early, starts Clerk at once, and the light waits for it', () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  assert.match(read('./early-layer.ts'), /inlineClerkSatellite\(\) && clerkSatelliteSyncs\(/);
  assert.match(read('./main.tsx'), /useState\(\(\)=>syncs\|\|clerkNow\(/);
  assert.match(read('./ViewerFrame.tsx'), /assetsNear \|\| syncing\)/);
});
