// D2 (playtest 2026-10-25, ROOT-CAUSES §C D2): "walk to the pavilion" resolved to walk:commons-pavilion, "to its front door
// (closed)", and 4 of 4 such walks ended at [9, -1.5], outside the pavilion's floor (z in [-7, -3]); only the room id
// walk:commons-pavilion/pavilion got in. A building with a single room is now walked into that room.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {bootEden} from '../test/eden-capabilities-timing.ts';
import {accept} from '../test/native-owner-fixture.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json';
test('D2 Eden 2026: "walk to the pavilion on the commons" ends inside the pavilion room', {timeout: 900_000, skip: NO_EDEN}, async t => {
  const w = await bootEden();
  t.after(() => w.close());
  const e = () => (w.host.engine.world.entities as Record<string, {pose: {p: number[]}}>)[w.soul.entityId];
  e().pose.p = [15.5, e().pose.p[1], 4.8]; await w.settle(2);   // where the 071922/111032 batteries asked
  const L = w.edge as unknown as {act: (s: unknown, i: unknown) => unknown; receipt: (soul: string, id: string) => {phase: string} | null; placePathOf: (soul: string) => {id: string}[];
    coreA: {binds(s: unknown): {caps: {id: string; label: string}[]}}};
  const cap = L.coreA.binds(w.soul).caps.find(c => c.id === 'walk:commons-pavilion')!;
  // F8 (#958): the room by its display name, its exact ref in brackets
  assert.match(cap.label, /inside, into Commons Pavilion \/ Pavilion \[commons-pavilion\/pavilion\]/);
  const out = await accept(w.host, Promise.resolve(L.act(w.soul, {capability: 'walk to the pavilion on the commons'}))) as {accepted?: boolean; receipt?: {id: string; capability: string}};
  assert.equal(out.accepted, true, JSON.stringify(out));
  assert.equal(out.receipt?.capability, 'walk:commons-pavilion', JSON.stringify(out));
  const t0 = w.host.engine.world.tick;
  let phase = 'started';
  while (w.host.engine.world.tick - t0 < 60 * 20 && ['accepted', 'started'].includes(phase)) {await w.settle(20); phase = L.receipt(w.soul.soulId, out.receipt!.id)!.phase;}
  assert.equal(phase, 'completed');
  const path = L.placePathOf(w.soul.soulId).map(p => p.id), p = e().pose.p;
  assert.ok(path.includes('g-commons-pavilion.pavilion'), `ended inside the pavilion: ${path.join(' < ')} at ${p[0].toFixed(1)}, ${p[2].toFixed(1)}`);
});
