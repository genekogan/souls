#!/usr/bin/env node
// M2 medium gap (lane M, 2026-10-17): Chiba's gallery screens and the hall projection show the "neon flower".
// Reference: sim.mars.college 2026, mars/viewer/app/studio/gallery.ts (+ history/gallery-2026-anchors.ts). There the
// portrait hall projection (3.2 x 4.3 m on the plywood projection partition) and six small monitors (0.49 x 0.32 m, two
// tiers on pale panels along the gallery wall) run a shader whose default program "art" draws a glowing eight-petal
// ring (blue, r = .22 + .05 sin 8a, slowly turning) round a six-lobed magenta ring (r = .14 + .025 sin 6a) on near-black,
// and whose "talk" program shows a MARS COLLEGE card. Souls' Chiba mesh has the panels, bezels and dark screen glass but
// no picture (marsland-parity residual "gallery screens' logo and the neon flower installation").
// Two world-local defs, drawn as kit tubes (no image asset, no new viewer code; parts appear by state with `when: @…`):
//  - mars-hall-projection: the portrait projection, petals turn (components.spin) while on. Residents switch it on/off
//    and choose the flower or the card ("put the talk card up on the projection").
//  - mars-gallery-monitors: the six monitors as one thing (one switch for the gallery wall, as the reference's
//    gallery channel), same two programs.
// Writes worlds/patches/mars-gallery-20261017/defs.json (deterministic).
import { writeFileSync, mkdirSync } from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const r4 = (n) => Math.round(n * 10000) / 10000;
/** A closed curve r(a) in the screen plane (x right, y up), centred at (cx, cy), at depth z. */
function ring(cx, cy, z, n, f) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = (i % n) / n * Math.PI * 2, r = f(a); pts.push([r4(cx + r * Math.cos(a)), r4(cy + r * Math.sin(a)), r4(z)]); }
  return pts;
}
const NIGHT = '#07051a', BLUE = '#5c9dff', PINK = '#ff4fc6', CARD = '#111829', INK = '#a7e6da';
/** One screen's picture: dark ground, the two neon rings (art) or the card (talk), all hidden while off. */
function screen({ cx, cy, w, h, n, tube, role }) {
  const H = h; // the reference's flower is sized by the screen height (uv units)
  return [
    { kind: 'box', at: [cx, cy, 0.006], size: [w, h, 0.004], round: 0, tint: 'ground', glow: 0.25, collide: false, when: '@on & @program=art' },
    { kind: 'sweep', at: [0, 0, 0], path: ring(cx, cy, 0.013, n, (a) => H * (0.22 + 0.05 * Math.sin(8 * a))), r: tube, segments: 5, tint: 'petal', glow: 1, collide: false, when: '@on & @program=art', ...(role ? { role, pivot: [cx, cy, 0.013] } : {}) },
    { kind: 'sweep', at: [0, 0, 0], path: ring(cx, cy, 0.012, Math.round(n * 0.75), (a) => H * (0.14 + 0.025 * Math.sin(6 * a))), r: tube * 0.85, segments: 5, tint: 'inner', glow: 1, collide: false, when: '@on & @program=art' },
    { kind: 'box', at: [cx, cy, 0.006], size: [w, h, 0.004], round: 0, tint: 'card', glow: 0.25, collide: false, when: '@on & @program=talk',
      faces: [{ side: 'front', text: h > 1 ? ['MARS', 'COLLEGE'] : ['MARS COLLEGE'], font: 'sans', ink: INK, bg: CARD, glow: 1 }] },
  ];
}
const programs = (what) => [
  { name: 'switch-on', label: `Switch on ${what}`, roles: 'anyone', reach: 'touch', params: {}, when: [{ field: 'on', is: false }], then: [{ op: 'set', field: 'on', value: true }] },
  { name: 'switch-off', label: `Switch off ${what}`, roles: 'anyone', reach: 'touch', params: {}, when: [{ field: 'on', is: true }], then: [{ op: 'set', field: 'on', value: false }] },
  { name: 'show-flower', label: `Show the neon flower on ${what}`, roles: 'anyone', reach: 'touch', params: {}, when: [{ field: 'on', is: true }, { field: 'program', is: 'talk' }], then: [{ op: 'set', field: 'program', value: 'art' }] },
  { name: 'show-card', label: `Put the Mars College card up on ${what}`, roles: 'anyone', reach: 'touch', params: {}, when: [{ field: 'on', is: true }, { field: 'program', is: 'art' }], then: [{ op: 'set', field: 'program', value: 'talk' }] },
];
const state = { on: { type: 'bool', default: true }, program: { type: 'enum', values: ['art', 'talk'], default: 'art' } };
const params = { ground: { type: 'color', default: NIGHT, doc: 'screen ground' }, petal: { type: 'color', default: BLUE, doc: 'outer neon ring' }, inner: { type: 'color', default: PINK, doc: 'inner neon ring' }, card: { type: 'color', default: CARD, doc: 'card ground' } };
const palette = { ground: NIGHT, petal: BLUE, inner: PINK, card: CARD };

// Hall projection, local frame: the picture faces +z, centred 2.81 m up (the reference's 2.65 m in its frame + Chiba's
// 0.16 m plinth); the partition's front skin is at local z = 0.
const projection = {
  schema: 'def/1', name: 'mars-hall-projection', version: 1,
  description: 'The portrait projection on the plywood partition at the head of Chiba\'s auditorium (3.2 x 4.3 m). It shows a slowly turning neon flower, or the Mars College card for a talk. Switch it on or off, or change the picture.',
  tags: ['public', 'screen', 'mars', 'art'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { v: 2, round: 0, shapes: screen({ cx: 0, cy: 2.81, w: 3.2, h: 4.3, n: 63, tube: 0.022, role: 'blade' }) } },
  params, state, actions: programs('the hall projection'),
  components: { spin: { axis: 'z', rpm: 0.3, role: 'blade' } },
  layer: 'decor', palette, size: { box: [3.2, 4.96, 0.06] },
  category: 'furniture.music', synonyms: ['projection', 'projector screen', 'big screen', 'neon flower'],
};
// Six monitors on the gallery wall, local frame centred on the middle of the screen glass (Chiba gallery wall, reference
// receiver mounts u = 3.45 / 7.45 / 11.30 m, tiers 1.55 / 4.45 m + 0.16 m); pictures face +z just proud of the glass.
const cols = [-3.902, 0.075, 3.903], rows = [1.734, 4.586];
const monitors = {
  schema: 'def/1', name: 'mars-gallery-monitors', version: 1,
  description: 'The six small monitors along Chiba\'s gallery wall, three on each level. They show the neon flower, or the Mars College card. One switch for the whole wall.',
  tags: ['public', 'screen', 'mars', 'art'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { v: 2, round: 0, shapes: rows.flatMap((cy) => cols.flatMap((cx) => screen({ cx, cy, w: 0.49, h: 0.32, n: 40, tube: 0.0035 }))) } },
  params, state, actions: programs('the gallery monitors'),
  layer: 'decor', palette, size: { box: [8.3, 4.75, 0.06] },
  category: 'furniture.music', synonyms: ['monitors', 'gallery screens', 'screens', 'neon flower'],
};

const out = `${ROOT}worlds/patches/mars-gallery-20261017`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/defs.json`, JSON.stringify([projection, monitors], null, 1) + '\n');
console.log('wrote', `${out}/defs.json`);
