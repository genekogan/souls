#!/usr/bin/env node
// M2 (lane mars, 2026-10-16): the Chiba field's black fire bowl and gray beanbag (sim.mars.college 2026 reference,
// mars/viewer/app/history/details-2026-ground-life.ts, c49195) are already drawn in Souls — baked into the Chiba mesh — but
// are scenery: the fire never burns and nobody can sit in the beanbag. Two small world-local defs make them usable,
// placed as Chiba children inside the baked shapes. Writes worlds/patches/mars-field-20261016/defs.json (deterministic).
//  - mars-fire-bowl-fire: ash bed and flames for the inside of the baked bowl (ash .63 m up); flames (kit role `flame`)
//    show while lit; light/put-out, light and fire sound as the core campfire. Starts unlit.
//  - mars-beanbag-seat: one low seat inside the baked beanbag (its shape a little smaller, hidden in the original).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const kit = (f) => JSON.parse(readFileSync(`${ROOT}packages/world-compiler/src/core-kit/${f}`, 'utf8'));
const camp = structuredClone(kit('vocab-w2.json').find((d) => d.name === 'core-campfire'));

const bowl = {
  schema: 'def/1', name: 'mars-fire-bowl-fire', version: 1,
  description: 'A fire in the black steel fire bowl in the Chiba field seating; flames show while it burns. Light it and put it out ("light the fire bowl").',
  tags: ['public', 'fire', 'camp', 'mars'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'cyl', at: [0, 0.6, 0], r: 0.37, h: 0.06, segments: 12, tint: 'ash' },
    { kind: 'cyl', at: [0.06, 0.66, -0.04], r: 0.05, h: 0.5, segments: 5, tint: 'log', pitch: 1.5707963267948966, yaw: 0.5 },
    { kind: 'cyl', at: [-0.05, 0.67, 0.05], r: 0.05, h: 0.46, segments: 5, tint: 'log', pitch: 1.5707963267948966, yaw: -0.7 },
    { kind: 'cone', at: [0, 0.9, 0], r: 0.22, h: 0.5, segments: 6, tint: 'flame', glow: 1, role: 'flame', pivot: [0, 0.65, 0] },
    { kind: 'cone', at: [0.1, 0.83, 0.06], r: 0.13, h: 0.34, segments: 6, tint: 'flame2', glow: 1, role: 'flame', pivot: [0.1, 0.65, 0.06] },
    { kind: 'cone', at: [-0.11, 0.81, -0.05], r: 0.11, h: 0.3, segments: 6, tint: 'flame2', glow: 1, role: 'flame', pivot: [-0.11, 0.65, -0.05] },
  ] } },
  params: { ash: { type: 'color', default: '#2a2522', doc: 'ash colour' }, log: camp.params.log, flame: camp.params.flame, flame2: camp.params.flame2 },
  state: { lit: { type: 'bool', default: false } },
  actions: camp.actions.map((a) => ({ ...a, label: a.label.replace('campfire', 'fire bowl') })),
  components: { light: { ...camp.components.light, range: 6, on: false }, sound: { ...camp.components.sound, radius: 8 } },
  palette: { ash: '#2a2522', log: camp.palette.log, flame: camp.palette.flame, flame2: camp.palette.flame2 },
  size: { box: [0.74, 1.15, 0.74] },
};

const bag = {
  schema: 'def/1', name: 'mars-beanbag-seat', version: 1,
  description: 'The large gray beanbag in the Chiba field seating; one person sinks into it.',
  tags: ['furniture', 'seat', 'outdoor', 'mars'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.02, shapes: [
    { kind: 'sphere', at: [0, 0.34, 0], r: 1, segments: 12, tint: 'cloth', scale: [0.79, 0.41, 0.73] },
  ] } },
  params: { cloth: { type: 'color', default: '#817e78', doc: 'cover colour' } },
  slots: [{ id: 'seat-1', kind: 'seat', p: [0, 0.42, 0.1], yaw: 0, height: 0.42, accepts: { tags: ['body'] }, capacity: 1 }],
  components: { seat: { height: 0.42 } },
  palette: { cloth: '#817e78' },
  size: { box: [1.58, 0.75, 1.46] },
};

const out = `${ROOT}worlds/patches/mars-field-20261016`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/defs.json`, JSON.stringify([bowl, bag], null, 1) + '\n');
console.log('wrote', `${out}/defs.json`);
