// VOCAB-W3: buildings people live and work in, furnished (docs/god/VOCAB.md; lane brief team/lanes/vocab-w3.md).
// Two halves:
//  1. FIXTURES (kit/2): the interior things the existing library lacked: bathroom fixtures, office desks and chairs,
//     pews, lockers, hospital beds, school desks, boards, shop counters, shelving, display cases, theatre seats,
//     bleachers, gravestones, tents, fuel pumps, cell bars, vault doors ….
//  2. FURNISHED TYPES: a building/1 def with an explicit floor plan (`plan` default), a furnish recipe
//     (tools/god-skill/recipes/furnish/<name>.json, so `furnish <it>` refurnishes after a resize) and `contents`: the
//     recipe laid out at build time by the same furnishBatch the god's `furnish` runs, so placing the type places
//     its furniture too (each piece its own entity: Souls sit, buy, open). `layers` = LAYERS defaults (opening hours,
//     an owner placeholder; prices sit on the counters/fridges among the contents). Outdoor recreation types are sets.
// Origin on the floor at the footprint centre, front +z, metres.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { box, cbox, cyl, cone, sph, tor, limb, lathe, seat, stand, surface, shelf, hang, bedSlot, withRole as dslWithRole } from './dsl.mjs';
import { vocabDef, setDef } from './vocab-dsl.mjs';
import { GENERATORS } from '../../../../generators/src/index.ts';
import { furnishBatch } from '../../../../../tools/god-skill/lib/furnish.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PI = Math.PI;
const C = { oak: '#9a6b43', walnut: '#5e3d27', pine: '#c79a63', iron: '#3b3d40', steel: '#8a8f94', chrome: '#c9ccd0', brass: '#b8913f', cream: '#f2ead8',
  white: '#f4f2ec', porcelain: '#eef0ee', glass: '#9fc4cc', red: '#b0352b', navy: '#2f4a6b', sage: '#3f6b5c', teal: '#2f6b6b', soot: '#2b2623',
  mustard: '#d9a63a', stone: '#b9b3a6', granite: '#8d8a86', felt: '#2f6b4a', plum: '#6b3a55', sky: '#7fb3d0' };
const withRole = (role, pivot, shapes) => dslWithRole(role, pivot, shapes).map((s) => (s.__cbox ? { ...s, o: { ...s.o, role: s.role, pivot: s.pivot } } : s));
const when = (w, shapes) => shapes.map((s) => (s.__cbox ? { ...s, o: { ...s.o, when: w } } : { ...s, when: w }));
const legs4 = (w, d, h, c, r = 0.025) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => cyl([a * w / 2, h / 2, b * d / 2], r, h, c, { seg: 5 }));

// ======================================================================= 1. FIXTURES
const BATH = { category: 'furniture.bath', tags: ['furniture', 'bath'] };
const fixtures = [
  vocabDef({ ...BATH, name: 'toilet', synonyms: ['loo', 'wc', 'lavatory', 'water closet', 'john', 'commode'],
    description: 'A white porcelain toilet (0.4 × 0.7 m, seat at 0.42 m) with a cistern and a lid; for a bathroom, a washroom or a cell. Souls can sit on it.',
    ranges: { sx: [0.9, 1.2], sy: [0.9, 1.1], sz: [0.9, 1.2] },
    shapes: [cyl([0, 0.2, 0.05], 0.15, 0.4, 'porcelain', { r2: 0.19, seg: 10 }), cyl([0, 0.42, 0.06], 0.2, 0.04, 'seat', { seg: 10 }), cbox([0, 0.62, -0.25], [0.42, 0.4, 0.18], 'porcelain'),
      cbox([0, 0.83, -0.25], [0.44, 0.04, 0.2], 'porcelain'), cyl([0.14, 0.86, -0.25], 0.02, 0.03, 'chrome', { seg: 5 })],
    palette: { porcelain: C.porcelain, seat: '#e8e6e0', chrome: C.chrome }, slots: [seat('seat', [0, 0.44, 0.08])], components: { seat: {} } }),
  vocabDef({ ...BATH, name: 'bathtub', synonyms: ['bath', 'tub', 'clawfoot tub', 'bathing tub', 'soaking tub'],
    description: 'A white bathtub (0.8 × 1.7 m, 0.6 m tall) with chrome taps; fill it and empty it, and lie in it. Variants: built-in, clawfoot.',
    variants: ['built-in', 'clawfoot'], actuators: [['fill', { default: 0 }]], label: 'the bath', ranges: { sx: [0.85, 1.2], sy: [0.9, 1.1], sz: [0.85, 1.25] },
    shapes: [...when('variant=built-in', [cbox([0, 0.28, 0], [0.8, 0.56, 1.7], 'porcelain')]),
      ...when('variant=clawfoot', [cbox([0, 0.4, 0], [0.76, 0.42, 1.62], 'porcelain'), ...[[-0.3, -0.65], [0.3, -0.65], [-0.3, 0.65], [0.3, 0.65]].map(([x, z]) => sph([x, 0.1, z], 0.07, 'brass', { seg: 5 }))]),
      cbox([0, 0.57, 0], [0.62, 0.04, 1.5], 'inside'), ...withRole('fill', [0, 0.3, 0], [box([0, 0.5, 0], [0.6, 0.06, 1.46], 'water')]),
      cyl([0, 0.7, -0.78], 0.025, 0.25, 'chrome', { seg: 5 }), cyl([0, 0.82, -0.7], 0.02, 0.14, 'chrome', { seg: 5, pitch: PI / 2 })],
    palette: { porcelain: C.porcelain, inside: '#dfe4e4', water: '#8ec5d6', chrome: C.chrome, brass: C.brass }, slots: [bedSlot('soak', [0, 0.35, 0])], components: { bed: {} } }),
  vocabDef({ ...BATH, name: 'shower', synonyms: ['shower stall', 'shower cubicle', 'walk-in shower', 'shower cabin', 'wet room'],
    description: 'A glass shower cubicle (0.9 × 0.9 m, 2.1 m tall) with a tray, a chrome head and a door; switch it on and the water runs. Stand in it.',
    actuators: [['power', { default: false }]], label: 'the shower', ranges: { sx: [0.9, 1.4], sy: [0.95, 1.1], sz: [0.9, 1.4] },
    shapes: [cbox([0, 0.05, 0], [0.9, 0.1, 0.9], 'porcelain'), box([0, 1.1, -0.44], [0.9, 2.0, 0.03], 'tile'), box([-0.44, 1.1, 0], [0.03, 2.0, 0.9], 'tile'),
      box([0.44, 1.1, 0], [0.02, 2.0, 0.9], 'glass'), box([0, 1.1, 0.44], [0.86, 2.0, 0.02], 'glass'), box([0, 2.1, 0.44], [0.9, 0.04, 0.04], 'chrome'),
      limb([0, 1.6, -0.42], [0, 2.0, -0.25], 0.015, 'chrome', { kind: 'cyl', seg: 4 }), cyl([0, 1.98, -0.22], 0.08, 0.03, 'chrome', { seg: 8 }),
      ...when('@on', [cyl([0, 1.0, -0.22], 0.07, 1.9, 'water', { r2: 0.05, seg: 6, glow: 0.2 })])],
    palette: { porcelain: C.porcelain, tile: '#cfe0dc', glass: '#c8e0e4', chrome: C.chrome, water: '#a8d8e8' }, slots: [stand('in', [0, 0.1, 0], 0)] }),
  vocabDef({ ...BATH, name: 'washbasin', synonyms: ['basin', 'sink basin', 'wash basin', 'lavatory sink', 'vanity', 'hand basin'],
    description: 'A pedestal washbasin (0.55 × 0.45 m, rim at 0.85 m) with a tap and a mirror above; for bathrooms and washrooms. Option: mirror.',
    params: { mirror: { type: 'bool', default: true, doc: 'a mirror on the wall above' } }, ranges: { sx: [0.8, 1.4], sy: [0.9, 1.1], sz: [0.9, 1.2] },
    shapes: [cyl([0, 0.4, -0.05], 0.09, 0.8, 'porcelain', { r2: 0.07, seg: 8 }), cbox([0, 0.82, 0], [0.55, 0.12, 0.42], 'porcelain'), cbox([0, 0.87, 0.02], [0.42, 0.03, 0.3], 'inside'),
      cyl([0, 0.95, -0.15], 0.018, 0.14, 'chrome', { seg: 5 }), cyl([0, 1.01, -0.1], 0.014, 0.1, 'chrome', { seg: 4, pitch: PI / 2 }),
      ...when('mirror', [box([0, 1.45, -0.21], [0.5, 0.65, 0.02], 'mirror'), box([0, 1.45, -0.22], [0.56, 0.71, 0.01], 'frame')])],
    palette: { porcelain: C.porcelain, inside: '#dfe4e4', chrome: C.chrome, mirror: '#b8ccd4', frame: C.walnut }, slots: [surface('rim', [0.2, 0.88, -0.1], 2, [0.2, 0.2, 0.2]), stand('wash', [0, 0, 0.55], PI)] }),
  vocabDef({ category: 'furniture.work', tags: ['furniture', 'office'], name: 'office-desk', synonyms: ['computer desk', 'workstation', 'pc desk', 'writing desk', 'work desk', 'bureau'],
    description: 'An office desk (1.4 × 0.7 m) with its swivel chair and a computer: a screen that glows while on, a keyboard, a mouse and a drawer unit; for offices, receptions and studies. Work at it; switch the computer on and off.',
    actuators: [['power', { default: true }]], label: 'the computer', ranges: { sx: [0.8, 1.4], sy: [0.9, 1.1], sz: [0.85, 1.3] },
    shapes: [cbox([0, 0.73, 0], [1.4, 0.04, 0.7], 'top'), cbox([0.48, 0.36, 0], [0.4, 0.7, 0.62], 'body'), ...[[-0.65, -0.3], [-0.65, 0.3]].map(([x, z]) => box([x, 0.36, z], [0.04, 0.72, 0.04], 'iron')),
      box([-0.65, 0.05, 0], [0.04, 0.04, 0.62], 'iron'), ...[0.15, 0.36, 0.57].map((y) => box([0.48, y, 0.315], [0.3, 0.02, 0.01], 'iron')),
      cyl([-0.1, 0.8, -0.18], 0.1, 0.03, 'iron', { seg: 6 }), box([-0.1, 0.92, -0.18], [0.04, 0.2, 0.03], 'iron'), cbox([-0.1, 1.08, -0.17], [0.56, 0.34, 0.03], 'case'),
      box([-0.1, 1.08, -0.152], [0.52, 0.3, 0.005], 'screen', { glow: 0.9, when: '@on' }), box([-0.1, 1.08, -0.152], [0.52, 0.3, 0.005], 'dark', { when: '!@on' }),
      cbox([-0.1, 0.765, 0.08], [0.44, 0.02, 0.14], 'case'), cbox([0.25, 0.765, 0.1], [0.06, 0.02, 0.1], 'case'),
      ...[0, 1, 2, 3, 4].map((i) => { const a = (i * 2 * PI) / 5; return limb([-0.1, 0.08, 0.62], [-0.1 + 0.26 * Math.sin(a), 0.03, 0.62 + 0.26 * Math.cos(a)], 0.02, 'iron', { kind: 'cyl', seg: 4 }); }),
      cyl([-0.1, 0.27, 0.62], 0.025, 0.4, 'iron', { seg: 5 }), cbox([-0.1, 0.48, 0.62], [0.48, 0.08, 0.46], 'pad'), cbox([-0.1, 0.8, 0.84], [0.44, 0.5, 0.07], 'pad', { pitch: 0.12 })],
    palette: { top: C.oak, body: '#d8d2c4', iron: C.iron, case: '#2b2d30', screen: '#7fc8e8', dark: '#15171a', pad: '#2f3a4a' }, slots: [surface('top', [0.3, 0.75, 0.1], 4), stand('user', [-0.1, 0, 1.05], PI)], components: { surface: { height: 0.75 }, workstation: { kind: 'computer' } } }),
  vocabDef({ category: 'furniture.seat', tags: ['furniture', 'office'], name: 'office-chair', synonyms: ['swivel chair', 'desk chair', 'task chair', 'computer chair', 'executive chair'],
    description: 'A swivel office chair (0.6 m across, seat at 0.48 m) on a five-star base with castors, a padded seat and back; goes with an office desk.',
    ranges: { sx: [0.9, 1.2], sy: [0.9, 1.15], sz: [0.9, 1.2] },
    shapes: [...[0, 1, 2, 3, 4].flatMap((i) => { const a = (i * 2 * PI) / 5, x = 0.28 * Math.sin(a), z = 0.28 * Math.cos(a); return [limb([0, 0.08, 0], [x, 0.05, z], 0.02, 'iron', { kind: 'cyl', seg: 4 }), sph([x, 0.03, z], 0.03, 'iron', { seg: 4 })]; }),
      cyl([0, 0.27, 0], 0.025, 0.4, 'chrome', { seg: 6 }), cbox([0, 0.48, 0.02], [0.5, 0.08, 0.48], 'pad'), cbox([0, 0.82, -0.22], [0.46, 0.55, 0.07], 'pad', { pitch: -0.12 }),
      box([0, 0.55, -0.2], [0.05, 0.2, 0.04], 'iron')],
    palette: { pad: '#2f3a4a', iron: C.iron, chrome: C.chrome }, slots: [seat('seat', [0, 0.52, 0.03])], components: { seat: {} } }),
  vocabDef({ category: 'furniture.storage', tags: ['furniture', 'office'], name: 'filing-cabinet', synonyms: ['file cabinet', 'filing drawers', 'file drawers', 'records cabinet'],
    description: 'A four-drawer steel filing cabinet (0.47 × 1.3 × 0.62 m) with handles and label slots; for offices, police stations and banks. Holds papers.',
    ranges: { sx: [0.8, 1.6], sy: [0.55, 1.1], sz: [0.9, 1.1] },
    shapes: [cbox([0, 0.65, 0], [0.47, 1.3, 0.62], 'paint'), ...[0.18, 0.5, 0.82, 1.14].flatMap((y) => [box([0, y, 0.312], [0.43, 0.29, 0.01], 'paint'), box([0, y + 0.07, 0.32], [0.14, 0.025, 0.02], 'chrome'), box([0, y - 0.04, 0.318], [0.08, 0.04, 0.005], 'label')])],
    palette: { paint: '#8a9590', chrome: C.chrome, label: C.cream }, slots: [surface('top', [0, 1.31, 0], 3)], components: { container: { capacity: 40 }, surface: { height: 1.31 } } }),
  vocabDef({ category: 'furniture.seat', tags: ['furniture', 'church'], name: 'pew', synonyms: ['church pew', 'church bench', 'chapel bench', 'long bench', 'settle'],
    description: 'A wooden church pew (2.4 m long, seat at 0.45 m) with a high back, end panels and a kneeler; three people sit on it. Rows of them fill a church, a court or a hall.',
    ranges: { sx: [0.6, 1.6], sy: [0.9, 1.1], sz: [0.9, 1.2] },
    shapes: [cbox([0, 0.44, 0.05], [2.4, 0.06, 0.42], 'wood'), cbox([0, 0.8, -0.17], [2.4, 0.62, 0.05], 'wood', { pitch: -0.1 }), ...[-1.2, 1.2].map((x) => cbox([x, 0.5, 0], [0.06, 1.0, 0.55], 'wood')),
      box([0, 0.2, 0.0], [2.3, 0.04, 0.04], 'wood'), box([0, 0.14, 0.42], [2.3, 0.08, 0.14], 'cushion'), box([0, 1.08, -0.2], [2.4, 0.05, 0.1], 'wood')],
    palette: { wood: C.walnut, cushion: '#7a2f2f' }, slots: [-0.75, 0, 0.75].map((x, i) => seat(`seat-${i + 1}`, [x, 0.47, 0.05])), components: { seat: {} } }),
  vocabDef({ category: 'furniture.table', tags: ['furniture', 'church'], name: 'altar', synonyms: ['communion table', 'altar table', 'shrine table', 'holy table'],
    description: 'An altar (1.8 × 0.8 m, 1 m tall) of stone under a white cloth, with two candlesticks and a cross; the focus at the front of a church, a temple or a shrine.',
    ranges: { sx: [0.7, 1.4], sy: [0.9, 1.1], sz: [0.8, 1.3] },
    shapes: [cbox([0, 0.48, 0], [1.8, 0.96, 0.8], 'stone'), cbox([0, 0.98, 0], [1.86, 0.04, 0.86], 'cloth'), box([0, 0.75, 0.43], [1.0, 0.45, 0.01], 'runner'),
      ...[-0.6, 0.6].flatMap((x) => [cyl([x, 1.08, -0.15], 0.05, 0.16, 'brass', { seg: 6, r2: 0.02 }), cyl([x, 1.25, -0.15], 0.02, 0.18, 'wax', { seg: 5 }), cone([x, 1.38, -0.15], 0.015, 0.05, 'flame', { seg: 4, glow: 1 })]),
      box([0, 1.25, -0.25], [0.04, 0.5, 0.03], 'brass'), box([0, 1.36, -0.25], [0.24, 0.04, 0.03], 'brass')],
    palette: { stone: '#d8cfbd', cloth: C.white, runner: '#7a2f2f', brass: C.brass, wax: C.cream, flame: '#ffb347' }, slots: [surface('top', [0, 1.0, 0.15], 6)], components: { surface: { height: 1.0 } } }),
  vocabDef({ category: 'furniture.work', tags: ['furniture'], name: 'lectern', synonyms: ['pulpit', 'reading stand', 'speaker stand', 'ambo', 'book stand'],
    description: 'A wooden lectern (0.6 × 0.5 m, 1.2 m tall) with a sloped reading top holding an open book; to read from in a church, a court, a classroom or a lecture hall.',
    ranges: { sx: [0.8, 1.3], sy: [0.85, 1.15], sz: [0.8, 1.3] },
    shapes: [cbox([0, 0.04, 0], [0.5, 0.08, 0.45], 'wood'), cbox([0, 0.55, 0], [0.14, 1.0, 0.14], 'wood'), cbox([0, 1.12, 0], [0.6, 0.06, 0.45], 'wood', { pitch: 0.3 }),
      box([0, 1.16, 0.0], [0.42, 0.03, 0.3], 'page', { pitch: 0.3 })],
    palette: { wood: C.walnut, page: C.cream }, slots: [stand('reader', [0, 0, 0.55], PI)], components: { readable: { pages: 4 } } }),
  vocabDef({ category: 'furniture.storage', tags: ['furniture'], name: 'lockers', synonyms: ['locker', 'locker bank', 'school lockers', 'gym lockers', 'staff lockers'],
    description: 'A bank of three steel lockers (0.95 × 1.8 × 0.45 m) with vents and handles; the first door opens and locks. For schools, changing rooms, fire and police stations.',
    actuators: ['door', 'lock'], label: 'the locker', ranges: { sx: [0.6, 2], sy: [0.8, 1.1], sz: [0.9, 1.2] },
    shapes: [cbox([0, 0.9, 0], [0.95, 1.8, 0.45], 'paint'), ...[0, 0.31].flatMap((x) => [box([x, 0.9, 0.226], [0.29, 1.7, 0.01], 'door'), ...[1.5, 1.55, 1.6].map((y) => box([x, y, 0.232], [0.18, 0.015, 0.005], 'iron')), box([x + 0.1, 0.95, 0.235], [0.02, 0.1, 0.02], 'chrome')]),
      ...withRole('door', [-0.455, 0, 0.23], [box([-0.31, 0.9, 0.236], [0.29, 1.7, 0.012], 'door'), ...[1.5, 1.55, 1.6].map((y) => box([-0.31, y, 0.244], [0.18, 0.015, 0.005], 'iron')), box([-0.21, 0.95, 0.247], [0.02, 0.1, 0.02], 'chrome')])],
    palette: { paint: '#3f6b8a', door: '#4a7a9a', iron: '#2a3a46', chrome: C.chrome }, slots: [stand('front', [0, 0, 0.6], PI)], components: { container: { capacity: 12 } } }),
  vocabDef({ category: 'furniture.bed', tags: ['furniture', 'medical'], name: 'hospital-bed', synonyms: ['sickbed', 'ward bed', 'medical bed', 'patient bed', 'infirmary bed', 'gurney'],
    description: 'A hospital bed (1 × 2.1 m) on castors with a raised back, side rails and a white mattress; a patient lies in it; visitors sit on a chair beside it. For wards and clinics.',
    ranges: { sx: [0.9, 1.1], sy: [0.9, 1.1], sz: [0.9, 1.1] },
    shapes: [cbox([0, 0.45, 0], [0.95, 0.1, 2.05], 'frame'), cbox([0, 0.56, 0.25], [0.9, 0.12, 1.5], 'mattress'), cbox([0, 0.72, -0.72], [0.9, 0.1, 0.62], 'mattress', { pitch: -0.5 }),
      ...legs4(0.85, 1.9, 0.4, 'chrome', 0.02), ...[[-0.42, -0.95], [0.42, -0.95], [-0.42, 0.95], [0.42, 0.95]].map(([x, z]) => sph([x, 0.05, z], 0.05, 'iron', { seg: 5 })),
      cbox([0, 0.8, -1.02], [0.95, 0.6, 0.05], 'frame'), cbox([0, 0.68, 1.02], [0.95, 0.35, 0.05], 'frame'), ...[-0.5, 0.5].map((x) => box([x, 0.75, 0.1], [0.03, 0.2, 1.0], 'chrome')),
      cyl([0.55, 1.2, -0.95], 0.015, 1.5, 'chrome', { seg: 4 }), cbox([0.55, 1.85, -0.95], [0.14, 0.2, 0.05], 'bag')],
    palette: { frame: '#e4e6e4', mattress: '#f8f8f6', chrome: C.chrome, iron: C.iron, bag: '#cfe6ee' }, slots: [bedSlot('patient', [0, 0.64, 0.1])], components: { bed: {} } }),
  vocabDef({ category: 'furniture.table', tags: ['furniture', 'school'], name: 'school-desk', synonyms: ['pupil desk', 'student desk', 'classroom desk', 'exam desk', 'school table'],
    description: 'A pupil\'s desk (0.7 × 0.5 m, 0.72 m high) on steel legs with a shelf under the top; rows of them, each with a chair behind, fill a classroom. Put a book on it.',
    ranges: { sx: [0.8, 1.6], sy: [0.8, 1.15], sz: [0.9, 1.3] },
    shapes: [cbox([0, 0.72, 0], [0.7, 0.03, 0.5], 'top'), ...legs4(0.62, 0.42, 0.71, 'iron', 0.015), box([0, 0.5, 0], [0.62, 0.02, 0.42], 'iron')],
    palette: { top: C.pine, iron: '#5a5f62' }, slots: [surface('top', [0, 0.74, 0], 3, [0.4, 0.3, 0.3])], components: { surface: { height: 0.74 } } }),
  vocabDef({ category: 'furniture.work', tags: ['furniture', 'school'], name: 'wall-board', synonyms: ['whiteboard', 'blackboard', 'chalkboard', 'pinboard', 'corkboard', 'notice board'],
    description: 'A board on a slim metal floor stand (2.4 × 1.2 m, 0.9–2.1 m up) with a tray: a whiteboard, a blackboard or a corkboard for a classroom, an office or a meeting room. Stand at it to write. Variants: whiteboard, blackboard, corkboard.',
    variants: ['whiteboard', 'blackboard', 'corkboard'], ranges: { sx: [0.5, 2], sy: [0.7, 1.4], sz: [1, 1] },
    shapes: [box([0, 1.5, 0], [2.46, 1.26, 0.04], 'frame'), ...when('variant=whiteboard', [box([0, 1.5, 0.022], [2.36, 1.16, 0.01], 'white')]), ...when('variant=blackboard', [box([0, 1.5, 0.022], [2.36, 1.16, 0.01], 'black'), box([-0.5, 1.6, 0.03], [0.6, 0.02, 0.003], 'chalk'), box([0.3, 1.4, 0.03], [0.8, 0.02, 0.003], 'chalk')]),
      ...when('variant=corkboard', [box([0, 1.5, 0.022], [2.36, 1.16, 0.01], 'cork'), ...[[-0.8, 1.7], [-0.3, 1.45], [0.4, 1.75], [0.85, 1.35], [0.1, 1.25]].map(([x, y], i) => box([x, y, 0.03], [0.3, 0.22, 0.003], i % 2 ? 'paper' : 'note'))]),
      box([0, 0.86, 0.05], [2.0, 0.03, 0.08], 'frame'), ...[-1.05, 1.05].flatMap((x) => [box([x, 0.7, -0.04], [0.035, 1.4, 0.035], 'frame'), box([x, 0.025, 0], [0.35, 0.05, 0.5], 'frame')])],
    palette: { frame: '#9aa0a0', white: '#f6f7f6', black: '#2a3a32', chalk: '#e8e8e0', cork: '#b8875a', paper: C.cream, note: '#f2d86a' }, layer: 'solid',
    slots: [stand('writer', [0, 0, 0.6], PI)], components: { sign: { lines: [] } } }),
];

// ---- shops, bars, banks: counters, shelving, cases, coolers
const goods = (x0, x1, y, z, n, seed) => Array.from({ length: n }, (_, i) => { const w = (x1 - x0) / n; const h = 0.2 + ((i * 7 + seed) % 3) * 0.04; return box([x0 + w * (i + 0.5), y + 0.02 + h / 2, z], [w * 0.8, h, 0.3], `g${(i + seed) % 4}`); });
fixtures.push(
  vocabDef({ category: 'furniture.table', tags: ['furniture', 'shop'], name: 'shop-counter', synonyms: ['counter', 'bar counter', 'till', 'checkout', 'reception desk', 'service counter', 'bank counter', 'cash desk'],
    description: 'A service counter (2 × 0.7 m, 1 m tall): one Soul serves from behind it, customers stand in front. Variants: shop (a till), bar (beer taps and a foot rail), cafe (a coffee machine and a cake dome), reception (a bell and a raised ledge), bank (a glass screen).',
    variants: ['shop', 'bar', 'cafe', 'reception', 'bank'], ranges: { sx: [0.6, 2], sy: [0.9, 1.15], sz: [0.9, 1.3] },
    shapes: [cbox([0, 0.5, 0], [2.0, 1.0, 0.7], 'body'), cbox([0, 1.02, 0], [2.06, 0.05, 0.76], 'top'), box([0, 0.5, 0.355], [1.9, 0.9, 0.01], 'panel'),
      ...when('variant=shop', [cbox([-0.55, 1.12, -0.05], [0.4, 0.16, 0.36], 'till'), cbox([-0.55, 1.26, -0.12], [0.3, 0.16, 0.04], 'till', { pitch: -0.4 }), box([-0.55, 1.26, -0.1], [0.24, 0.1, 0.005], 'screen', { pitch: -0.4, glow: 0.6 })]),
      ...when('variant=bar', [box([0, 0.12, 0.42], [1.9, 0.04, 0.04], 'brass'), ...[-0.3, 0, 0.3].flatMap((x) => [cyl([x, 1.2, -0.15], 0.03, 0.3, 'brass', { seg: 6 }), box([x, 1.33, -0.1], [0.03, 0.08, 0.1], 'tap')]), ...[0.6, 0.72, 0.84].map((x) => cyl([x, 1.12, 0.05], 0.035, 0.15, 'beer', { seg: 6 }))]),
      ...when('variant=cafe', [cbox([-0.55, 1.25, -0.12], [0.5, 0.42, 0.4], 'machine'), box([-0.55, 1.2, 0.09], [0.3, 0.12, 0.02], 'chrome'), cyl([0.5, 1.07, 0.05], 0.2, 0.04, 'chrome', { seg: 10 }), lathe([0.5, 1.09, 0.05], [[0.18, 0], [0.18, 0.12], [0.12, 0.22], [0, 0.26]], 'glass', { seg: 10 }), cyl([0.5, 1.13, 0.05], 0.12, 0.08, 'cake', { seg: 8 })]),
      ...when('variant=reception', [cbox([0, 1.12, 0.25], [2.0, 0.2, 0.25], 'body'), cbox([0, 1.23, 0.25], [2.06, 0.03, 0.3], 'top'), sph([0.6, 1.27, 0.25], 0.04, 'brass', { seg: 6 })]),
      ...when('variant=bank', [box([0, 1.45, 0.05], [2.0, 0.8, 0.02], 'glass'), ...[-1, 0, 1].map((x) => box([x, 1.45, 0.05], [0.04, 0.82, 0.05], 'brass')), box([0, 1.07, 0.15], [0.4, 0.04, 0.2], 'brass')])],
    palette: { body: C.walnut, top: '#c9b38a', panel: '#6b4a32', till: '#3a3d42', screen: '#7fe0a0', brass: C.brass, tap: C.soot, beer: '#d9a63a', machine: '#2f3236', chrome: C.chrome, glass: '#d8eef0', cake: '#c47a5a' },
    slots: [surface('top', [0.3, 1.05, 0.15], 6), stand('server', [0, 0, -0.7], 0), stand('customer', [0, 0, 0.75], PI)], components: { surface: { height: 1.04 }, workstation: { kind: 'serve' } } }),
  vocabDef({ category: 'furniture.storage', tags: ['furniture', 'shop'], name: 'shop-shelving', synonyms: ['shelving', 'gondola', 'shop shelves', 'store shelf', 'aisle shelf', 'display shelving', 'shelf unit'],
    description: 'A shop shelving unit (2 × 1.6 × 0.55 m) with four shelves of goods; stand in front to browse, take something. Rows of them make supermarket aisles. Variants: groceries, goods, bottles, books, empty.',
    variants: ['groceries', 'goods', 'bottles', 'books', 'empty'], ranges: { sx: [0.5, 2], sy: [0.7, 1.3], sz: [0.8, 1.6] },
    shapes: [cbox([0, 0.8, -0.24], [2.0, 1.6, 0.06], 'frame'), ...[-0.98, 0.98].map((x) => cbox([x, 0.8, 0], [0.05, 1.6, 0.55], 'frame')), ...[0.1, 0.5, 0.9, 1.3].map((y) => box([0, y, 0], [1.92, 0.03, 0.52], 'shelf')),
      cbox([0, 0.05, 0.02], [1.96, 0.1, 0.5], 'frame'),
      ...when('variant=groceries', [0.1, 0.5, 0.9, 1.3].flatMap((y, k) => goods(-0.9, 0.9, y, 0.05, 6, k))),
      ...when('variant=goods', [0.1, 0.5, 0.9, 1.3].flatMap((y, k) => goods(-0.9, 0.9, y, 0.05, 4, k + 2))),
      ...when('variant=bottles', [0.1, 0.5, 0.9, 1.3].flatMap((y, k) => Array.from({ length: 6 }, (_, i) => cyl([-0.8 + i * 0.32, y + 0.13, 0.05], 0.06, 0.24, `g${(i + k) % 4}`, { seg: 5 })))),
      ...when('variant=books', [0.1, 0.5, 0.9, 1.3].flatMap((y, k) => Array.from({ length: 5 }, (_, i) => box([-0.72 + i * 0.36, y + 0.14, 0.05], [0.3, 0.26, 0.24], `g${(i + k) % 4}`))))],
    palette: { frame: '#d8d4cc', shelf: '#bfbab0', g0: '#c46a43', g1: '#3f6b5c', g2: '#d9a63a', g3: '#2f4a6b' },
    slots: [0.1, 0.5, 0.9, 1.3].map((y, i) => shelf(`shelf-${i + 1}`, [0, y + 0.02, 0.05], 8)).concat([stand('browse', [0, 0, 0.7], PI)]), components: { container: { capacity: 60 } } }),
  vocabDef({ category: 'furniture.storage', tags: ['furniture', 'shop'], name: 'clothes-rail', synonyms: ['clothes rack', 'garment rail', 'dress rail', 'coat rail', 'rail of clothes'],
    description: 'A chrome clothes rail (1.5 m long, 1.6 m tall) on castors hung with eight garments; for a clothes shop, a theatre dressing room or a hotel. Hang things on it.',
    ranges: { sx: [0.6, 1.6], sy: [0.9, 1.1], sz: [0.9, 1.2] },
    shapes: [...[-0.72, 0.72].flatMap((x) => [cyl([x, 0.8, 0], 0.018, 1.6, 'chrome', { seg: 5 }), box([x, 0.04, 0], [0.04, 0.03, 0.5], 'chrome')]), cyl([0, 1.58, 0], 0.016, 1.46, 'chrome', { seg: 5, roll: PI / 2 }),
      ...Array.from({ length: 8 }, (_, i) => cbox([-0.6 + i * 0.17, 1.15, 0], [0.05, 0.75, 0.42], `g${i % 4}`))],
    palette: { chrome: C.chrome, g0: '#7a2f3f', g1: '#2f4a6b', g2: '#d8c9a8', g3: '#3f6b5c' }, slots: [hang('rail', [0, 1.58, 0]), stand('browse', [0, 0, 0.6], PI)], components: { container: { capacity: 20 } } }),
  vocabDef({ category: 'furniture.storage', tags: ['furniture', 'shop', 'museum'], name: 'display-case', synonyms: ['vitrine', 'glass case', 'showcase', 'cabinet', 'cake cabinet', 'museum case', 'jewellery case'],
    description: 'A glass display case: counter-high (1.4 × 0.6 m) for a shop or a café, tall for a museum wall, or a plinth with a glass cube for one treasure. Look in it; things sit on its shelves. Variants: counter, tall, plinth.',
    variants: ['counter', 'tall', 'plinth'], ranges: { sx: [0.6, 1.6], sy: [0.8, 1.2], sz: [0.8, 1.3] },
    shapes: [...when('variant=counter', [cbox([0, 0.35, 0], [1.4, 0.7, 0.6], 'body'), box([0, 0.85, 0], [1.38, 0.3, 0.58], 'glass'), box([0, 0.72, 0], [1.3, 0.02, 0.5], 'shelf'), ...[-0.45, 0, 0.45].map((x, i) => cyl([x, 0.76, 0], 0.11, 0.07, `g${i}`, { seg: 8 }))]),
      ...when('variant=tall', [cbox([0, 0.2, 0], [1.2, 0.4, 0.5], 'body'), box([0, 1.15, 0], [1.18, 1.5, 0.48], 'glass'), cbox([0, 1.93, 0], [1.22, 0.06, 0.52], 'body'), ...[0.7, 1.2, 1.6].map((y) => box([0, y, 0], [1.1, 0.02, 0.44], 'shelf')), ...[0.7, 1.2].flatMap((y, k) => [-0.3, 0.3].map((x, i) => lathe([x, y + 0.01, 0], [[0.08, 0], [0.1, 0.1], [0.05, 0.2], [0.06, 0.26]], `g${(i + k) % 3}`, { seg: 7 })))]),
      ...when('variant=plinth', [cbox([0, 0.5, 0], [0.6, 1.0, 0.6], 'stone'), box([0, 1.25, 0], [0.5, 0.5, 0.5], 'glass'), lathe([0, 1.0, 0], [[0.1, 0], [0.13, 0.12], [0.06, 0.28], [0.08, 0.36]], 'g1', { seg: 8 })])],
    palette: { body: C.walnut, glass: '#d8eef0', shelf: '#e8e4dc', stone: '#e4dccb', g0: '#c47a5a', g1: C.brass, g2: '#7a9ab0' },
    slots: [shelf('shelf', [0, 0.73, 0], 6), stand('look', [0, 0, 0.6], PI)], components: { container: { capacity: 12 } } }),
  vocabDef({ category: 'furniture.kitchen', tags: ['furniture', 'shop'], name: 'drinks-fridge', synonyms: ['drinks cooler', 'display fridge', 'chiller', 'beverage cooler', 'glass-door fridge', 'cooler'],
    description: 'A glass-door drinks fridge (0.7 × 2 × 0.7 m) lit inside, rows of bottles and cans; open the door to take one. For shops, cafés, bars and petrol stations.',
    actuators: ['door', ['power', { default: true }]], label: 'the fridge', ranges: { sx: [0.7, 2], sy: [0.8, 1.1], sz: [0.9, 1.2] },
    shapes: [cbox([0, 1.0, -0.02], [0.7, 2.0, 0.66], 'body'), box([0, 1.0, 0.2], [0.6, 1.7, 0.4], 'inside', { glow: 0.35, when: '@on' }), box([0, 1.0, 0.2], [0.6, 1.7, 0.4], 'dark', { when: '!@on' }),
      ...[0.35, 0.75, 1.15, 1.55].flatMap((y, k) => Array.from({ length: 4 }, (_, i) => cyl([-0.21 + i * 0.14, y + 0.12, 0.25], 0.04, 0.22, `g${(i + k) % 4}`, { seg: 5 }))), cbox([0, 1.93, 0.3], [0.7, 0.14, 0.06], 'sign'),
      ...withRole('door', [-0.34, 0, 0.34], [box([0, 0.95, 0.335], [0.66, 1.75, 0.02], 'glass'), box([0.27, 1.0, 0.36], [0.03, 0.5, 0.03], 'chrome')])],
    palette: { body: '#e4e6e4', inside: '#eaf6fa', dark: '#c8d0d0', glass: '#d8eef0', chrome: C.chrome, sign: '#c23a2b', g0: '#c23a2b', g1: '#3f8a5c', g2: '#d9a63a', g3: '#2f6b8a' },
    slots: [stand('front', [0, 0, 0.7], PI)], components: { container: { capacity: 48 } } }),
  vocabDef({ category: 'object.street', tags: ['object', 'shop'], name: 'vending-machine', synonyms: ['vending machine', 'snack machine', 'drinks machine', 'soda machine', 'coin machine'],
    description: 'A vending machine (0.9 × 1.9 × 0.8 m) with a lit front of snacks and drinks; it sells a snack for 2 by default (its price, which the god can change). For stations, schools, hospitals and lobbies.',
    actuators: [['power', { default: true }]], label: 'the vending machine', ranges: { sx: [0.8, 1.2], sy: [0.9, 1.1], sz: [0.9, 1.1] },
    shapes: [cbox([0, 0.95, 0], [0.9, 1.9, 0.8], 'paint'), box([-0.1, 1.15, 0.405], [0.58, 1.2, 0.01], 'window', { glow: 0.5, when: '@on' }), box([-0.1, 1.15, 0.405], [0.58, 1.2, 0.01], 'dark', { when: '!@on' }),
      ...[0.7, 1.0, 1.3, 1.6].flatMap((y, k) => [-0.3, -0.1, 0.1].map((x, i) => cbox([x, y, 0.36], [0.14, 0.18, 0.06], `g${(i + k) % 4}`))), cbox([0.32, 1.2, 0.41], [0.16, 0.5, 0.03], 'panel'), cbox([-0.1, 0.3, 0.41], [0.58, 0.2, 0.03], 'panel')],
    palette: { paint: '#b0352b', window: '#eaf6fa', dark: '#3a3d42', panel: '#2b2d30', g0: '#d9a63a', g1: '#3f8a5c', g2: '#2f6b8a', g3: '#f2ead8' },
    slots: [stand('front', [0, 0, 0.7], PI)] }),
);
// vending: a def-level LAYERS default (a price) — the god overrides with `set <it> --price …`
fixtures.at(-1).layers = { price: { amount: 2, service: 'a snack' } };

// ---- seats for audiences, sport, the dead, the outdoors
fixtures.push(
  vocabDef({ category: 'furniture.seat', tags: ['furniture', 'theatre'], name: 'theatre-seats', synonyms: ['auditorium seats', 'cinema seats', 'row of seats', 'stalls', 'folding seats', 'tip-up seats'],
    description: 'A row of four upholstered tip-up seats (2.2 m long) with armrests on a steel rail; rows of them face a stage in a theatre, a cinema or a lecture hall. Four Souls sit on it.',
    ranges: { sx: [0.5, 2], sy: [0.9, 1.1], sz: [0.9, 1.1] },
    shapes: [box([0, 0.06, 0], [2.2, 0.06, 0.4], 'iron'), ...[-1.1, -0.55, 0, 0.55, 1.1].map((x) => cbox([x, 0.45, -0.02], [0.06, 0.65, 0.5], 'arm')),
      ...[-0.825, -0.275, 0.275, 0.825].flatMap((x) => [cbox([x, 0.44, 0.04], [0.48, 0.1, 0.44], 'pad'), cbox([x, 0.78, -0.2], [0.48, 0.62, 0.1], 'pad', { pitch: -0.12 })])],
    palette: { pad: '#8a2f35', arm: '#3a2a22', iron: C.iron }, slots: [-0.825, -0.275, 0.275, 0.825].map((x, i) => seat(`seat-${i + 1}`, [x, 0.5, 0.04])), components: { seat: {} } }),
  vocabDef({ category: 'public.sport', tags: ['public', 'sport'], name: 'bleachers', synonyms: ['grandstand', 'stands', 'terrace seating', 'spectator stand', 'tiered seating', 'stadium seats'],
    description: 'Aluminium bleachers (6 × 2.6 m, 1.5 m high): three stepped benches for 18 spectators, with a back rail; line a pitch, a court or a parade route with them.',
    ranges: { sx: [0.5, 3], sy: [0.8, 1.2], sz: [0.8, 1.2] },
    shapes: [...[0, 1, 2].flatMap((k) => [box([0, 0.45 + k * 0.45, 0.85 - k * 0.8], [6.0, 0.05, 0.32], 'bench'), box([0, 0.2 + k * 0.45, 1.05 - k * 0.8], [6.0, 0.04, 0.4], 'step')]),
      ...[-2.95, -1, 1, 2.95].flatMap((x) => [limb([x, 0.04, 1.2], [x, 1.4, -0.9], 0.04, 'iron', { kind: 'cyl', seg: 4 }), box([x, 0.75, -0.9], [0.06, 1.5, 0.06], 'iron')]), box([0, 1.85, -1.1], [6.0, 0.05, 0.05], 'iron')],
    palette: { bench: '#c9ccd0', step: '#9aa0a4', iron: '#5a5f62' },
    slots: [0, 1, 2].flatMap((k) => [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((x, i) => seat(`seat-${k + 1}-${i + 1}`, [x, 0.5 + k * 0.45, 0.85 - k * 0.8], 0, 0.28))), components: { seat: {} } }),  // SEATDEF: height = over the bench's own footboard (0.22 m lower)
  vocabDef({ category: 'public.monument', tags: ['public', 'cemetery'], name: 'gravestone', synonyms: ['headstone', 'tombstone', 'grave', 'grave marker', 'tomb', 'burial stone'],
    description: 'A gravestone (0.6 × 0.9 m) with its grave: a rounded headstone, a stone cross, a flat slab or a little obelisk, with flowers; rows of them make a cemetery or a churchyard. Variants: headstone, cross, slab, obelisk.',
    variants: ['headstone', 'cross', 'slab', 'obelisk'], conventions: ['stretch', 'paint', 'wear', 'warp'], ranges: { sx: [0.7, 1.5], sy: [0.6, 1.6], sz: [0.7, 1.4] },
    shapes: [cbox([0, 0.04, 0.55], [0.7, 0.08, 1.4], 'grass'),
      ...when('variant=headstone', [cbox([0, 0.4, -0.1], [0.6, 0.8, 0.14], 'stone'), cyl([0, 0.8, -0.1], 0.3, 0.14, 'stone', { seg: 10, pitch: PI / 2 }), box([0, 0.55, -0.025], [0.36, 0.2, 0.005], 'letters')]),
      ...when('variant=cross', [cbox([0, 0.1, -0.1], [0.45, 0.2, 0.3], 'stone'), cbox([0, 0.65, -0.1], [0.12, 0.95, 0.12], 'stone'), cbox([0, 0.85, -0.1], [0.5, 0.12, 0.12], 'stone')]),
      ...when('variant=slab', [cbox([0, 0.12, 0.45], [0.7, 0.24, 1.6], 'stone'), box([0, 0.245, 0.0], [0.4, 0.005, 0.3], 'letters')]),
      ...when('variant=obelisk', [cbox([0, 0.15, -0.1], [0.5, 0.3, 0.5], 'stone'), cyl([0, 0.85, -0.1], 0.17, 1.1, 'stone', { r2: 0.08, seg: 4 }), cone([0, 1.45, -0.1], 0.08, 0.15, 'stone', { seg: 4 })]),
      cyl([0.2, 0.12, 0.25], 0.06, 0.12, 'vase', { seg: 6 }), ...[0, 1, 2].map((i) => sph([0.2 + 0.04 * Math.cos(i * 2.1), 0.22, 0.25 + 0.04 * Math.sin(i * 2.1)], 0.04, 'flower', { seg: 4 }))],
    palette: { stone: '#a9a49a', letters: '#5a5752', grass: '#5f7f45', vase: '#7a7a74', flower: '#d84a5a' }, slots: [stand('mourner', [0, 0, 1.5], PI)], components: { sign: { lines: [] } } }),
  vocabDef({ category: 'building.shelter', tags: ['building', 'camping'], name: 'tent', synonyms: ['camping tent', 'pup tent', 'dome tent', 'bivouac', 'ridge tent', 'tepee'],
    description: 'A two-person tent (2.2 × 2.6 m, 1.3 m tall) with a door flap that opens and a sleeping mat inside; pitch a few round a campfire. Variants: ridge, dome.',
    variants: ['ridge', 'dome'], actuators: ['door'], label: 'the tent flap', ranges: { sx: [0.8, 1.6], sy: [0.8, 1.4], sz: [0.8, 1.6] },
    shapes: [box([0, 0.02, 0], [1.9, 0.04, 2.3], 'floor'), cbox([0, 0.06, -0.2], [1.2, 0.05, 1.8], 'mat'),
      ...when('variant=ridge', [cbox([-0.5, 0.62, 0], [0.06, 1.42, 2.4], 'canvas', { roll: -0.72 }), cbox([0.5, 0.62, 0], [0.06, 1.42, 2.4], 'canvas', { roll: 0.72 }), cbox([0, 0.62, -1.2], [1.95, 1.2, 0.04], 'canvas2'), cyl([0, 1.3, 0], 0.03, 2.5, 'pole', { seg: 5, pitch: PI / 2 })]),
      ...when('variant=dome', [lathe([0, 0, -0.1], [[1.05, 0], [1.0, 0.5], [0.75, 0.95], [0.35, 1.22], [0, 1.3]], 'canvas', { seg: 9 }), ...[0, 1].map((i) => tor([0, 0, -0.1], 1.05, 0.02, 'pole', { seg: 10, yaw: i * PI / 2 + PI / 4, pitch: PI / 2 }))]),
      ...withRole('door', [-0.5, 0, 1.15], [cbox([0, 0.55, 1.12], [1.0, 1.05, 0.03], 'flap')])],
    palette: { canvas: '#d06a3a', canvas2: '#b85a30', flap: '#e08a50', floor: '#4a4f42', mat: '#3f6b8a', pole: '#5a5f62' },
    slots: [bedSlot('sleep', [0, 0.1, -0.3]), stand('door', [0, 0, 1.6], PI)], components: { bed: {}, place: { kind: 'tent', enclosed: true, capacity: 2 } } }),
  vocabDef({ category: 'public.sport', tags: ['public', 'sport'], name: 'basketball-hoop', synonyms: ['basketball net', 'hoop', 'basket', 'backboard', 'netball post'],
    description: 'A basketball hoop on a padded pole (3.9 m tall): a white backboard, an orange rim at 3.05 m and a net; one at each end of a court. Stand under it to shoot.',
    ranges: { sx: [0.8, 1.2], sy: [0.8, 1.05], sz: [0.8, 1.2] },
    shapes: [cbox([0, 0.15, -0.6], [0.6, 0.3, 0.6], 'base'), cyl([0, 1.6, -0.6], 0.07, 3.0, 'pole', { seg: 8 }), box([0, 1.0, -0.6], [0.2, 1.6, 0.2], 'pad'), limb([0, 3.0, -0.6], [0, 3.2, -0.05], 0.05, 'pole', { kind: 'cyl', seg: 5 }),
      box([0, 3.3, 0], [1.8, 1.05, 0.04], 'board'), box([0, 3.2, 0.025], [0.59, 0.45, 0.01], 'line'), box([0, 3.2, 0.03], [0.53, 0.39, 0.01], 'board'),
      tor([0, 3.05, 0.25], 0.23, 0.015, 'rim', { seg: 12, pitch: PI / 2 }), cyl([0, 2.88, 0.25], 0.22, 0.32, 'net', { r2: 0.15, seg: 8 })],
    palette: { base: '#4a4f52', pole: '#3b3d40', pad: '#2f4a6b', board: '#f4f2ec', line: '#c23a2b', rim: '#e0602a', net: '#f4f2ec' }, slots: [stand('shoot', [0, 0, 2.5], PI)] }),
);

// ---- garages, petrol stations, prisons, banks, laundries
fixtures.push(
  vocabDef({ category: 'utility.power', tags: ['utility', 'fuel'], name: 'fuel-pump', synonyms: ['petrol pump', 'gas pump', 'fuel dispenser', 'bowser', 'charging pump'],
    description: 'A fuel pump (0.8 × 1.9 × 0.5 m) on an island kerb, with a lit price display, two nozzles on hoses and a canopy pillar look; line two or three under a petrol station canopy.',
    actuators: [['power', { default: true }]], label: 'the pump', ranges: { sx: [0.8, 1.3], sy: [0.9, 1.1], sz: [0.8, 1.3] },
    shapes: [cbox([0, 0.08, 0], [1.2, 0.16, 0.8], 'kerb'), cbox([0, 0.95, 0], [0.75, 1.6, 0.45], 'body'), cbox([0, 1.82, 0], [0.8, 0.22, 0.5], 'top'),
      box([0, 1.4, 0.23], [0.5, 0.25, 0.01], 'display', { glow: 0.8, when: '@on' }), box([0, 1.4, 0.23], [0.5, 0.25, 0.01], 'dark', { when: '!@on' }),
      ...[-0.42, 0.42].flatMap((x) => [cbox([x, 1.0, 0.05], [0.08, 0.2, 0.12], 'nozzle'), limb([x, 0.92, 0.05], [x * 1.1, 0.5, 0.3], 0.02, 'hose', { kind: 'cyl', seg: 4 }), limb([x * 1.1, 0.5, 0.3], [x * 0.6, 0.3, 0.2], 0.02, 'hose', { kind: 'cyl', seg: 4 })])],
    palette: { kerb: '#d8d4cc', body: '#e8e6e0', top: '#c23a2b', display: '#7fe0a0', dark: '#1a1c1e', nozzle: '#2b2d30', hose: '#1f2022' },
    slots: [stand('fill', [0, 0, 1.0], PI)], components: { workstation: { kind: 'fuel' } } }),
  vocabDef({ category: 'furniture.work', tags: ['furniture', 'garage'], name: 'car-lift', synonyms: ['vehicle lift', 'car hoist', 'two-post lift', 'garage lift', 'ramp lift'],
    description: 'A two-post car lift (3.6 × 2.4 × 1 m) with swing arms, for a garage bay: drive a car between the posts and raise it to work underneath. Stand at it to work.',
    ranges: { sx: [0.8, 1.3], sy: [0.8, 1.2], sz: [0.8, 1.3] },
    shapes: [...[-1.6, 1.6].flatMap((x) => [cbox([x, 0.05, 0], [0.5, 0.1, 0.6], 'base'), cbox([x, 1.2, 0], [0.26, 2.4, 0.3], 'post'), cbox([x, 2.38, 0], [0.32, 0.06, 0.36], 'cap'),
      limb([x, 0.5, 0], [x * 0.55, 0.45, 0.7], 0.04, 'arm', { kind: 'cyl', seg: 4 }), limb([x, 0.5, 0], [x * 0.55, 0.45, -0.7], 0.04, 'arm', { kind: 'cyl', seg: 4 }), box([x * 0.97, 1.2, 0.16], [0.08, 1.8, 0.02], 'stripe')]),
      box([0, 2.42, 0], [3.4, 0.06, 0.08], 'post'), cbox([1.6, 0.9, 0.3], [0.2, 0.25, 0.1], 'control')],
    palette: { base: '#4a4f52', post: '#2f6b8a', cap: '#2b2d30', arm: '#3b3d40', stripe: '#d9a63a', control: '#c23a2b' }, slots: [stand('mechanic', [1.6, 0, 0.8], PI)], components: { workstation: { kind: 'mechanic' } } }),
  vocabDef({ category: 'component.wall', tags: ['component', 'prison'], name: 'cell-bars', synonyms: ['jail bars', 'prison bars', 'cell door', 'cell front', 'barred door', 'grille'],
    description: 'A steel cell front (2.6 m wide, 2.4 m tall) of vertical bars with a barred door that opens and locks; closes off a cell in a police station or a prison.',
    actuators: ['door', 'lock'], label: 'the cell door', ranges: { sx: [0.6, 1.6], sy: [0.9, 1.1], sz: [1, 1] },
    shapes: [box([0, 2.37, 0], [2.6, 0.06, 0.08], 'steel'), box([0, 0.03, 0], [2.6, 0.06, 0.08], 'steel'), ...Array.from({ length: 9 }, (_, i) => cyl([-1.25 + i * 0.13, 1.2, 0], 0.016, 2.3, 'steel', { seg: 4 })),
      box([-0.05, 1.2, 0], [0.06, 2.34, 0.08], 'steel'), box([1.27, 1.2, 0], [0.06, 2.34, 0.08], 'steel'),
      ...withRole('door', [1.25, 0, 0], [box([0.6, 2.25, 0.02], [1.24, 0.05, 0.05], 'steel'), box([0.6, 1.1, 0.02], [1.24, 0.05, 0.05], 'steel'), box([0.6, 0.12, 0.02], [1.24, 0.05, 0.05], 'steel'),
        ...Array.from({ length: 9 }, (_, i) => cyl([0.04 + i * 0.13, 1.2, 0.02], 0.016, 2.2, 'steel', { seg: 4 })), cbox([0.1, 1.1, 0.05], [0.12, 0.18, 0.08], 'lock')])],
    palette: { steel: '#5a5f62', lock: '#3b3d40' }, slots: [stand('door', [0.6, 0, 0.6], PI)] }),
  vocabDef({ category: 'component.opening', tags: ['component', 'bank'], name: 'vault-door', synonyms: ['safe door', 'bank vault', 'strongroom door', 'vault', 'safe'],
    description: 'A round steel vault door (2.2 m across) in a heavy frame, with a spoked wheel and bolts; it swings open and locks. For a bank\'s strongroom, a bunker or a treasury.',
    actuators: ['door', ['lock', { default: true }]], label: 'the vault door', ranges: { sx: [0.6, 1.3], sy: [0.6, 1.3], sz: [0.8, 1.2] },
    shapes: [box([0, 1.25, -0.1], [2.6, 2.5, 0.3], 'frame'),
      ...withRole('door', [-1.1, 0, 0.1], [cyl([0, 1.2, 0.12], 1.05, 0.35, 'steel', { seg: 14, pitch: PI / 2 }), cyl([0, 1.2, 0.31], 0.7, 0.04, 'ring', { seg: 12, pitch: PI / 2 }), tor([0, 1.2, 0.38], 0.32, 0.03, 'chrome', { seg: 12 }),
        ...[0, 1, 2].map((i) => box([0, 1.2, 0.38], [0.64, 0.04, 0.04], 'chrome', { roll: i * PI / 3 })), cyl([0, 1.2, 0.38], 0.06, 0.08, 'chrome', { seg: 6, pitch: PI / 2 })])],
    palette: { frame: '#6a6e72', steel: '#9aa0a4', ring: '#80868a', chrome: C.chrome }, slots: [stand('front', [0, 0, 1.4], PI)] }),
  vocabDef({ category: 'furniture.kitchen', tags: ['furniture', 'laundry'], name: 'washing-machine', synonyms: ['washer', 'laundry machine', 'tumble dryer', 'dryer', 'washer dryer'],
    description: 'A front-loading washing machine (0.6 × 0.85 × 0.6 m) with a round glass door and a dial; switch it on and the drum spins. For kitchens, bathrooms, laundrettes and hotels.',
    actuators: [['power', { default: false }]], label: 'the washing machine', ranges: { sx: [0.9, 1.1], sy: [0.9, 1.1], sz: [0.9, 1.1] },
    shapes: [cbox([0, 0.43, 0], [0.6, 0.85, 0.6], 'body'), cyl([0, 0.42, 0.3], 0.2, 0.03, 'chrome', { seg: 12, pitch: PI / 2 }), ...withRole('blade', [0, 0.42, 0.31], [cyl([0, 0.42, 0.31], 0.16, 0.01, 'glass', { seg: 10, pitch: PI / 2 }), box([0, 0.42, 0.317], [0.24, 0.03, 0.005], 'clothes')]),
      box([0, 0.78, 0.301], [0.56, 0.1, 0.005], 'panel'), cyl([0.18, 0.78, 0.305], 0.035, 0.02, 'chrome', { seg: 8, pitch: PI / 2 })],
    palette: { body: '#f2f2ee', chrome: C.chrome, glass: '#3b4b55', clothes: '#c46a43', panel: '#d8dcdc' }, slots: [surface('top', [0, 0.86, 0], 3), stand('front', [0, 0, 0.6], PI)], components: { spin: { axis: 'z', rpm: 40, role: 'blade' }, surface: { height: 0.86 } } }),
);

// ======================================================================= 2. FURNISHED TYPES
// Recipe items (furnish/1, tools/god-skill/lib/furnish.mjs): `try` = [fx, fz, face] fractions of the room's free range in
// the building frame (fx 0 = west wall … 1 = east; fz 0 = back wall … 1 = front wall; face s = toward the front door).
const T = (s) => s.split(' ').map((t) => { const [x, z, f] = t.split(','); return [Number(x), Number(z), f ?? 's']; });
const it = (name, def, tries, extra = {}) => ({ name, def: [].concat(def).map((d) => (d.includes('/') ? d : `core/${d}@1`)), try: T(tries), ...extra });
const on = (name, def, host, extra = {}) => ({ name, def: [`core/${def}@1`], on: host, ...extra });
/** n items in a row at depth fz (fx from a to b), all facing `face`. */
const row = (base, def, n, fz, face, a = 0.1, b = 0.9, extra = {}) => Array.from({ length: n }, (_, i) => it(`${base}-${i + 1}`, def, `${n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1)},${fz},${face}`, extra));
/** cols × rows items over [a..b] × [c..d]. */
const grid = (base, def, cols, rows, a, b, c, d, face, extra = {}) => Array.from({ length: rows }, (_, r) => row(`${base}${rows > 1 ? `-${r + 1}` : ''}`, def, cols, rows === 1 ? (c + d) / 2 : c + ((d - c) * r) / (rows - 1), face, a, b, extra)).flat();
const dining = (n, a = 0.15, b = 0.85, c = 0.3, d = 0.85, cols = 2) => Array.from({ length: n }, (_, i) => {
  const fx = cols === 1 ? 0.5 : a + ((b - a) * (i % cols)) / (cols - 1), rows = Math.ceil(n / cols), fz = rows === 1 ? (c + d) / 2 : c + ((d - c) * Math.floor(i / cols)) / (rows - 1);
  return [it(`table-${i + 1}`, ['round-table', 'table'], `${fx},${fz},s`), it(`chair-${i + 1}a`, 'chair', `${fx - 0.11},${fz},e ${fx - 0.14},${fz},e ${fx},${fz - 0.16},s`), it(`chair-${i + 1}b`, 'chair', `${fx + 0.11},${fz},w ${fx + 0.14},${fz},w ${fx},${fz + 0.16},n`)];
}).flat();
const BATHROOM = [it('toilet', 'toilet', '0.15,0,s 0.85,0,s 0,0.5,e'), it('basin', 'washbasin', '0.85,0,s 0.5,0,s 1,0.5,w'), it('bath', ['bathtub'], '1,1,w 0,1,e 0.5,1,n')];
const WASHROOM = [...row('toilet', 'toilet', 2, 0, 's', 0.1, 0.45), ...row('basin', 'washbasin', 2, 0, 's', 0.65, 0.95)];
const BEDROOM = (bed = 'bed') => [it('bed', bed, '0.5,0,s 0,0.5,e 1,0.5,w 0.5,1,n 1,1,w 0,1,e 1,0,w'), it('wardrobe', 'wardrobe', '1,0.9,w 0,0.9,e 1,0.1,w'), it('dresser', 'dresser', '0,0.85,e 1,0.85,w 0,0.15,e'), it('rug', 'rug', '0.5,0.7,s'), it('lamp', 'floor-lamp', '0,0,s 1,0,s')];
const KITCHEN = [it('stove', 'stove', '0.2,0,s 0,0.3,e'), it('counter', 'counter', '0.45,0,s 0.6,0,s'), it('sink', 'sink', '0.7,0,s 0.85,0,s'), it('fridge', 'fridge', '1,0,s 1,0.3,w 0,0.6,e'), it('table', 'table', '0.5,0.65,s 0.5,0.8,s'), on('bowl', 'bowl', 'table'),
  it('chair-1', 'chair', '0.3,0.65,e 0.4,0.85,n'), it('chair-2', 'chair', '0.7,0.65,w 0.6,0.85,n')];
const LIVING = [it('rug', 'rug', '0.5,0.55,s'), it('sofa', 'sofa', '0.5,0,s 0,0.5,e 1,0.5,w'), it('armchair', 'armchair', '1,0.6,w 0,0.6,e'), it('table', 'round-table', '0.5,0.5,s'), it('tv', 'television', '0.5,1,n 1,0.3,w'),
  it('shelf', ['bookcase', 'bookshelf'], '0,0.3,e 1,0.3,w'), it('lamp', 'floor-lamp', '0,0,s 1,0,s')];
const OFFICE = (n = 4) => [...Array.from({ length: n }, (_, i) => { const cols = n > 4 ? 3 : 2, fx = n === 1 ? 0.5 : 0.1 + (0.8 * (i % cols)) / (cols - 1), fz = 0.15 + 0.6 * Math.floor(i / cols);
  return [it(`desk-${i + 1}`, 'office-desk', `${fx},${fz},s ${fx},${fz + 0.2},s ${fx},${Math.max(0, fz - 0.15)},s`)]; }).flat(),
  it('cabinet-1', 'filing-cabinet', '1,0.5,w 1,1,w 0,1,e'), it('cabinet-2', 'filing-cabinet', '0,0.5,e 0,1,e 1,0.8,w'), it('board', 'wall-board', '0.5,0,s', { params: { variant: 'corkboard' } })];

const buildingDefaults = (o) => ({ ...buildingParamsDefaults(), ...o });
let BP;
const buildingParamsDefaults = () => (BP ??= Object.fromEntries(Object.entries(GENERATORS['building/1'].params).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default])));
const RECIPE_DIR = resolve(here, '../../../../../tools/god-skill/recipes/furnish');
const coreKit = () => {
  const dir = resolve(here, '..'), out = new Map();
  for (const f of ['furniture', 'props', 'kitchen', 'work', 'signage', 'civic', 'play', 'plants', 'vocab', 'vocab-2', 'vocab-w1', 'vocab-w2']) {
    const file = resolve(dir, `${f}.json`); if (!existsSync(file)) continue;
    for (const d of JSON.parse(readFileSync(file, 'utf8'))) out.set(`core/${d.name.replace(/^core-/, '')}@${d.version ?? 1}`, d);
  }
  for (const d of fixtures) out.set(`core/${d.name.replace(/^core-/, '')}@1`, d);
  return out;
};
let KIT;
/** Lay out a recipe in the building's rooms at build time with the god's own furnish logic → `contents` parts. */
function layOut(name, def, params, recipe) {
  KIT ??= coreKit();
  const ref = `core/${name}@1`, baked = GENERATORS['building/1'].physics({ params, args: def.make.args, seed: 0 });
  const bad = (baked.notes ?? []).filter((n) => n.startsWith('violation'));
  if (bad.length) throw new Error(`${name}: ${bad.join('; ')}`);
  const ent = { id: 'B', def: ref, params };
  const bakeItem = (d, values = {}) => {
    const g = d.make?.kind === 'gen' && GENERATORS[d.make.gen];
    const defaults = Object.fromEntries(Object.entries({ ...g?.params, ...d.params }).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default]));
    // as WorldModel.bake: the def's own slots win over the generator's (lane FUZZ2: without them furnish saw no seat or bed
    // on a kit/2 chair or bed and laid out pieces nobody could sit on or lie in)
    const b = g ? g.physics({ params: { ...defaults, ...values }, args: d.make.args ?? {}, seed: 0 }) : { box: d.size.box };
    return d.slots?.length ? { ...b, slots: d.slots } : b;
  };
  const model = { get: (id) => (id === 'B' ? ent : undefined), resolvedDef: (r) => (r === ref ? def : KIT.get(r)), bake: (d, values) => (d === def ? baked : bakeItem(d, values)),
    children: new Map(), entities: new Map(), pathOf: () => name };
  const f = furnishBatch(model, 'B', name, { recipe });
  const byTmp = {}, parts = [], roomOf = new Map(f.placed.map((x) => [x.name, x.room]));
  for (const op of f.ops) {
    const room = roomOf.get(op.name), item = (recipe.rooms[room.replace(/-\d+$/, '').replace(/-room$/, '')] ?? []).find((x) => `${room}-${x.name}`.slice(0, 48) === op.name) ?? {};
    const extra = { ...(item.params ? { params: item.params } : {}), ...(item.price ? { price: item.price } : {}) };
    if (op.tmp) byTmp[op.tmp] = op.name;
    if (op.in.parent === 'B') parts.push({ id: op.name, def: op.def, slot: op.in.slot, p: op.p, r: op.r, ...extra });
    else parts.push({ id: op.name, def: op.def, in: byTmp[op.in.parent], slot: op.in.slot, ...extra });
  }
  return { parts, baked, dropped: f.dropped, rooms: baked.rooms.map((r) => r.id) };
}
const report = [];
/** A published revision keeps its bytes, and furnish has moved on since most of these were laid out (#1114). So the build
 *  takes a published revision's contents from the committed file and lays out only a revision that isn't there yet. To
 *  change what a type contains, publish a new revision with a conformance supplement. */
const publishedFile = resolve(here, '../vocab-w3.json');
const PUBLISHED = new Map(existsSync(publishedFile) ? JSON.parse(readFileSync(publishedFile, 'utf8')).map((d) => [`${d.name}@${d.version}`, d]) : []);
/** Z2: each furnished type's smallest footprint, as a fraction of its authored w and d: the smallest 0.05 step from which
 *  every step up to the authored size still places (w alone, d alone and both; never under 3 m). Measured on the resizing
 *  plans by team/scratch/t4/z2/looks/floor.mts; the earlier blanket 0.85 refused sizes that place (a 10 x 12 church). */
const FURNISHED_MIN = { house: 0.45, 'apartment-block': 0.85, 'townhouse-row': 0.7, cabin: 0.6, mansion: 0.35, dormitory: 0.4, hotel: 0.55,
  'mobile-home': 0.75, 'corner-shop': 0.5, supermarket: 0.35, restaurant: 0.35, cafe: 0.7, bar: 0.4, bank: 0.3, 'office-block': 0.55, mall: 0.3,
  garage: 0.45, 'petrol-station': 0.45, school: 0.75, hospital: 0.4, library: 0.35, 'town-hall': 0.4, 'police-station': 0.75, 'fire-station': 0.4,
  church: 0.3, prison: 0.4, theatre: 0.55, museum: 0.3 };
/** A furnished building type: building/1 with an explicit plan, its recipe and LAYERS defaults. */
function furnished({ name, category, synonyms, description, params: p0, plan, recipe, layers, outside = [], tags = [] }) {
  if (!FURNISHED_MIN[name]) throw new Error(`furnished ${name}: measure its smallest footprint (FURNISHED_MIN)`);
  // These plans preserve their room proportions when the creator resizes the footprint.
  plan = { ...plan, size: [p0.w, p0.d] };
  const params = buildingDefaults({ ...p0, plan });
  const genParams = GENERATORS['building/1'].params;
  const def = { schema: 'def/1', name: `core-${name}`, version: 1, description, tags: [...new Set([...category.split('.'), 'furnished', ...tags])], category, synonyms,
    form: 'point', make: { kind: 'gen', gen: 'building/1', args: { style: 'plan', furnish: name } },
    params: Object.fromEntries(Object.entries({ ...p0, plan }).map(([k, v]) => [k, { ...genParams[k], ...(['w', 'd'].includes(k) ? { min: Math.max(3, Math.round(v * FURNISHED_MIN[name] * 100) / 100) } : {}), ...(name === 'townhouse-row' && k === 'floorHeight' ? { max: 4.6 } : {}), default: v }])) };
  const rec = { schema: 'furnish/1', style: name, rooms: recipe };
  const L = layOut(name, def, params, rec);
  def.contents = PUBLISHED.get(`${def.name}@${def.version}`)?.contents ?? [...L.parts, ...outside];
  if (layers) def.layers = layers;
  def.size = { box: L.baked.box.map((v) => Math.round(v * 100) / 100) };
  report.push({ name, rooms: L.rooms.length, pieces: L.parts.length, dropped: L.dropped.map((d) => `${d.name}: ${d.why}`) });
  const file = resolve(RECIPE_DIR, `${name}.json`), json = JSON.stringify(rec, null, 1) + '\n';
  if (!existsSync(file) || readFileSync(file, 'utf8') !== json) writeFileSync(file, json);
  return def;
}
/** plan helper: floors = [{ rooms: [[id, x0, z0, x1, z1]], doors?: [[a, b]], ext?: [[room, wall, at?, width?]] }], stairs = [[from, room, wall, at]]. */
const plan = (floors, stairs = []) => ({
  floors: floors.map((f) => ({ rooms: f.rooms.map(([id, x0, z0, x1, z1]) => ({ id, rect: [x0, z0, x1, z1] })), ...(f.doors ? { doors: f.doors.map(([a, b, at]) => ({ between: [a, b], ...(at !== undefined ? { at } : {}) })) } : {}),
    exterior: (f.ext ?? []).map(([room, wall, at, width]) => ({ room, wall, kind: 'door', ...(at !== undefined ? { at } : {}), ...(width ? { width } : {}) })) })),
  stairs: stairs.map(([from, room, wall, at]) => ({ from, to: from + 1, room, wall, ...(at !== undefined ? { at } : {}) })),
});
const HOURS = (from, to, days) => ({ open: [{ from, to, ...(days ? { days } : {}) }] });
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

// ---- a court or a field to put sport sets on (a flat painted kit: Souls walk on it)
const lines = (w, d, c, t = 0.08) => [box([0, 0.035, d / 2], [w, 0.01, t], c), box([0, 0.035, -d / 2], [w, 0.01, t], c), box([w / 2, 0.035, 0], [t, 0.01, d], c), box([-w / 2, 0.035, 0], [t, 0.01, d], c), box([0, 0.035, 0], [w, 0.01, t], c)];
fixtures.push(
  vocabDef({ category: 'public.sport', tags: ['public', 'sport'], name: 'sports-court', synonyms: ['basketball court', 'netball court', 'games court', 'multi-use court', 'hard court', 'tennis court'],
    description: 'A painted hard court (28 × 15 m) with its lines: basketball (centre circle, keys), tennis (a net across the middle) or five-a-side; put hoops, goals and bleachers round it. Souls walk and play on it. Variants: basketball, tennis, five-a-side.',
    variants: ['basketball', 'tennis', 'five-a-side'], conventions: ['stretch', 'paint', 'wear'], ranges: { sx: [0.4, 1.6], sy: [1, 1], sz: [0.4, 1.6] }, layer: 'surface',
    shapes: [box([0, 0.015, 0], [30, 0.03, 17], 'apron'), box([0, 0.025, 0], [28, 0.02, 15], 'court'), ...lines(28, 15, 'line'),
      ...when('variant=basketball', [tor([0, 0.035, 0], 1.8, 0.04, 'line', { pitch: PI / 2, seg: 16 }), ...[-1, 1].flatMap((sx) => [box([sx * 11.1, 0.034, 0], [5.8, 0.012, 4.9], 'key'), tor([sx * 8.2, 0.035, 0], 1.8, 0.04, 'line', { pitch: PI / 2, seg: 12 })])]),
      ...when('variant=tennis', [box([0, 0.5, 0], [0.04, 1.0, 12.8], 'net'), ...[-6.4, 6.4].map((z) => cyl([0, 0.55, z], 0.04, 1.1, 'post', { seg: 5 })), box([0, 0.035, 0], [12.8, 0.01, 0.06], 'line'), ...[-5.5, 5.5].map((z) => box([0, 0.035, z], [28, 0.01, 0.06], 'line'))]),
      ...when('variant=five-a-side', [tor([0, 0.035, 0], 2.5, 0.05, 'line', { pitch: PI / 2, seg: 16 }), ...[-1, 1].flatMap((sx) => [box([sx * 13.2, 1.0, 0], [0.1, 2.0, 3.0], 'post'), box([sx * 12.0, 0.034, 0], [3.8, 0.012, 7.0], 'key')])])],
    palette: { apron: '#7a8a6a', court: '#3f6b8a', key: '#b0583a', line: '#f4f2ec', net: '#2b2d30', post: '#d8dcdc' },
    slots: [stand('centre', [0, 0.03, 0], 0, 10)], components: { place: { kind: 'court', enclosed: false, capacity: 20 } } }),
  vocabDef({ category: 'public.sport', tags: ['public', 'sport'], name: 'sports-field', synonyms: ['football field', 'soccer pitch', 'playing field', 'rugby pitch', 'pitch markings'],
    description: 'A grass playing field (64 × 40 m) marked for football with goals at both ends; the middle of a stadium, a school field or a park. Souls walk and play on it.',
    conventions: ['stretch', 'paint', 'wear'], ranges: { sx: [0.4, 1.4], sy: [1, 1], sz: [0.4, 1.4] }, layer: 'surface',
    shapes: [box([0, 0.015, 0], [66, 0.03, 42], 'grass'), ...[-24, -8, 8, 24].map((x) => box([x, 0.022, 0], [8, 0.01, 40], 'stripe')), ...lines(64, 40, 'line', 0.12), tor([0, 0.08, 0], 9, 0.08, 'line', { pitch: PI / 2, seg: 20 }),
      ...[-1, 1].flatMap((sx) => [box([sx * 24.5, 0.03, 0], [15, 0.01, 0.12], 'line'), box([sx * 24.5 - sx * 7.5, 0.03, 0], [0.12, 0.01, 0.12], 'line'), box([sx * 25, 0.03, -10], [14, 0.01, 0.12], 'line'), box([sx * 25, 0.03, 10], [14, 0.01, 0.12], 'line'),
        box([sx * 18, 0.03, 0], [0.12, 0.01, 20], 'line'), box([sx * 32, 1.22, 0], [0.12, 0.12, 7.3], 'post'), ...[-3.65, 3.65].map((z) => box([sx * 32, 1.22, z], [0.12, 2.44, 0.12], 'post')), box([sx * 32.8, 1.2, 0], [1.6, 2.3, 7.2], 'net')])],
    palette: { grass: '#5f8f45', stripe: '#6a9a4e', line: '#f4f2ec', post: '#f4f2ec', net: '#dfe4e4' },
    slots: [stand('centre', [0, 0.03, 0], 0, 22)], components: { place: { kind: 'pitch', enclosed: false, capacity: 40 } } }),
);
for (const d of fixtures.slice(-2)) d.layer = 'surface';

// ---------------------------------------------------------------- residential
const RES = { category: 'building.residential', tags: ['home'] };
const OWNED = { owner: 'god' };   // placeholder: `set <home> --owner soul:<name> --access private` makes it someone's
const types = [
  furnished({ ...RES, name: 'house', synonyms: ['family house', 'home', 'detached house', 'two-storey house', 'dwelling', 'residence'],
    description: 'A furnished two-storey family house (9 × 8 m): a living room and a kitchen-diner downstairs, stairs up to two bedrooms and a bathroom. Sofa, beds, kitchen, bath; owner placeholder (give it to a Soul).',
    params: { w: 9, d: 8, floors: 2, floorHeight: 2.8, roof: 'gable', roofPitch: 34, material: 'plaster', wall: '#efe3cf', trim: '#5e412b', roofColor: '#8a3b2a', windows: 0.55 },
    plan: plan([{ rooms: [['living', 0, 3.2, 9, 8], ['kitchen', 0, 0, 9, 3.2]], doors: [['living', 'kitchen', 0.7]], ext: [['living', 's', 0.6]] },
      { rooms: [['landing', 0, 2.6, 9, 4.6], ['bedroom', 0, 4.6, 5.5, 8], ['bath', 5.5, 4.6, 9, 8], ['bedroom-2', 0, 0, 9, 2.6]] }],
      [[0, 'living', 'n', 0]]),
    recipe: { living: LIVING, kitchen: KITCHEN, bedroom: BEDROOM(), bath: BATHROOM }, layers: OWNED }),
  furnished({ ...RES, name: 'apartment-block', synonyms: ['apartments', 'block of flats', 'flats', 'tenement', 'condo', 'apartment building'],
    description: 'A three-storey block of twelve furnished studio flats (12 × 11 m): a stair hall up the middle, four flats a floor, each with a bed, a sofa, a table, a kitchenette and a toilet. Owner placeholder.',
    params: { w: 12, d: 11, floors: 3, floorHeight: 2.8, roof: 'flat', roofPitch: 0, material: 'brick', wall: '#b5704f', trim: '#f0e6d0', roofColor: '#5d6466', windows: 0.6 },
    // plan.landing (lane BSGEN, 2026-10-21): the stair hall's two facing flights narrow to keep a 1.2 m landing strip
    plan: { ...plan([0, 1, 2].map((k) => ({ rooms: [[k ? `landing-${k}` : 'hall', 4.5, 4, 7.5, 11], [`flat-${4 * k + 1}`, 0, 4, 4.5, 11], [`flat-${4 * k + 2}`, 7.5, 4, 12, 11], [`flat-${4 * k + 3}`, 0, 0, 6, 4], [`flat-${4 * k + 4}`, 6, 0, 12, 4]],
      doors: [1, 2, 3, 4].map((i) => [k ? `landing-${k}` : 'hall', `flat-${4 * k + i}`]), ...(k ? {} : { ext: [['hall', 's', 0.5, 1.2]] }) })), [[0, 'hall', 'w', 1], [1, 'landing-1', 'e', 1]]), landing: 1.2 },
    recipe: { flat: [it('bed', 'bed', '0,0,e 1,0,w 0,1,e'), it('sofa', 'sofa', '1,0.6,w 0,0.6,e 0.5,1,n'), it('table', 'round-table', '0.5,0.5,s'), it('chair-1', 'chair', '0.3,0.5,e 0.5,0.3,s'), it('chair-2', 'chair', '0.7,0.5,w 0.5,0.7,n'),
      it('stove', 'stove', '1,1,n 0,1,n 1,0,s'), it('sink', 'sink', '0.75,1,n 0.25,1,n 0.7,0,s'), it('fridge', 'fridge', '0.55,1,n 0.5,0,s'), it('toilet', 'toilet', '0,1,e 1,1,w 0,0.3,e'), it('wardrobe', 'wardrobe', '0.3,0,s 0.6,0,s 1,0.3,w')],
      hall: [it('mailboxes', 'filing-cabinet', '1,0.8,w'), it('plant', ['potted-plant', 'flower-pot'], '0,1,e 1,1,w')], landing: [it('plant', ['potted-plant', 'flower-pot'], '1,0.9,w 0,0.9,e')] }, layers: OWNED }),
  furnished({ ...RES, name: 'townhouse-row', synonyms: ['terrace', 'terraced houses', 'row houses', 'rowhouses', 'townhouses', 'brownstones'],
    description: 'A row of three furnished two-storey terraced houses (15 × 9 m, 5 m each), each with its own front door, living room, kitchen, stairs, two bedrooms and a bathroom. Owner placeholder per house.',
    params: { w: 15, d: 9, floors: 2, floorHeight: 2.8, roof: 'gable', roofPitch: 38, material: 'brick', wall: '#a8664a', trim: '#f2ead8', roofColor: '#4a4f52', windows: 0.55 },
    plan: plan([{ rooms: [0, 1, 2].flatMap((i) => [[`living-${i + 1}`, 5 * i, 3.4, 5 * i + 5, 9], [`kitchen-${i + 1}`, 5 * i, 0, 5 * i + 5, 3.4]]), doors: [1, 2, 3].map((i) => [`living-${i}`, `kitchen-${i}`, 0.8]), ext: [1, 2, 3].flatMap((i) => [[`living-${i}`, 's', 0.7], [`kitchen-${i}`, 'n', 0.5]]) },
      { rooms: [0, 1, 2].flatMap((i) => [[`landing-${i + 1}`, 5 * i, 2.2, 5 * i + 5, 5.6], [`bedroom-${2 * i + 1}`, 5 * i, 5.6, 5 * i + 5, 9], [`bath-${i + 1}`, 5 * i, 0, 5 * i + 2.2, 2.2], [`bedroom-${2 * i + 2}`, 5 * i + 2.2, 0, 5 * i + 5, 2.2]]),
        doors: [1, 2, 3].flatMap((i) => [[`landing-${i}`, `bedroom-${2 * i - 1}`], [`landing-${i}`, `bath-${i}`], [`landing-${i}`, `bedroom-${2 * i}`]]) }], [1, 2, 3].map((i) => [0, `living-${i}`, 'n', 0])),
    recipe: { living: [it('sofa', 'sofa', '1,0.6,w 0.5,1,n'), it('armchair', 'armchair', '0.2,0.75,e 0.1,0.9,e'), it('rug', 'rug', '0.5,0.6,s'), it('lamp', 'floor-lamp', '1,0.15,s')], kitchen: KITCHEN.filter((x) => x.name !== 'counter'),
      bedroom: BEDROOM(), bath: [it('toilet', 'toilet', '0,0,s 0,0.5,e'), it('basin', 'washbasin', '1,0,s 1,0.5,w')] }, layers: OWNED }),
  furnished({ ...RES, name: 'cabin', synonyms: ['log cabin', 'hut', 'shack', 'cottage cabin', 'mountain hut', 'bothy'],
    description: 'A furnished one-room log cabin (6 × 5 m) with a porch: a bed, a hearth that can be lit, a table with two chairs, an armchair and a rug. Owner placeholder.',
    params: { w: 6, d: 5, floors: 1, floorHeight: 2.6, roof: 'gable', roofPitch: 38, material: 'wood', wall: '#8a5a3a', trim: '#e8dcc4', roofColor: '#4a4f42', porch: 1.5, windows: 0.4 },
    plan: plan([{ rooms: [['cabin', 0, 0, 6, 5]], ext: [['cabin', 's', 0.5]] }]),
    recipe: { cabin: [it('bed', 'bed', '0,0,e 1,0,w'), it('hearth', 'hearth', '0.6,0,s 1,0.5,w'), it('table', 'table', '0.75,0.65,s 0.5,0.6,s'), it('chair-1', 'chair', '0.55,0.65,e'), it('chair-2', 'chair', '0.95,0.65,w'),
      it('armchair', 'armchair', '0.15,0.8,e 0.3,0.7,n'), it('rug', 'rug', '0.4,0.55,s'), it('chest', 'chest', '0.05,0.5,e 0.3,0,s')] }, layers: OWNED }),
  furnished({ ...RES, name: 'mansion', synonyms: ['manor', 'manor house', 'villa', 'stately home', 'country house', 'estate house', 'palace'],
    description: 'A furnished two-storey stone mansion (18 × 13 m): a grand stair hall, a parlour with a piano, a library, a dining room and a kitchen downstairs; three bedrooms and a bathroom up. Owner placeholder.',
    params: { w: 18, d: 13, floors: 2, floorHeight: 3.2, roof: 'hip', roofPitch: 30, material: 'stone', wall: '#d8cfbd', trim: '#5e5a57', roofColor: '#4f5559', porch: 2, windows: 0.6 },
    plan: plan([{ rooms: [['hall', 6, 0, 12, 13], ['parlour', 0, 6.5, 6, 13], ['library', 0, 0, 6, 6.5], ['dining', 12, 6.5, 18, 13], ['kitchen', 12, 0, 18, 6.5]], doors: [['hall', 'parlour'], ['hall', 'library'], ['hall', 'dining'], ['dining', 'kitchen']], ext: [['hall', 's', 0.5, 1.6]] },
      { rooms: [['landing', 6, 0, 12, 13], ['bedroom-1', 0, 6.5, 6, 13], ['bedroom-2', 0, 0, 6, 6.5], ['bedroom-3', 12, 6.5, 18, 13], ['bath', 12, 0, 18, 6.5]], doors: [['landing', 'bedroom-1'], ['landing', 'bedroom-2'], ['landing', 'bedroom-3'], ['landing', 'bath']] }],
      [[0, 'hall', 'w', 0.3]]),
    recipe: { hall: [it('rug', 'rug', '0.6,0.6,s'), it('table', 'round-table', '0.65,0.5,s'), it('statue', 'statue', '1,0.1,w'), it('clock', ['street-clock', 'floor-lamp'], '1,0.9,w')],
      parlour: [it('rug', 'rug', '0.5,0.5,s'), it('piano', 'piano', '0.5,0,s'), it('sofa', 'sofa', '1,0.5,w'), it('armchair-1', 'armchair', '0.1,0.4,e'), it('armchair-2', 'armchair', '0.1,0.8,e'), it('table', 'round-table', '0.5,0.6,s'), it('fireplace', 'fireplace', '0.5,1,n')],
      library: [...row('shelf', 'bookcase', 3, 0, 's', 0.1, 0.9), it('desk', 'desk', '0.5,0.6,s'), it('chair', 'chair', '0.5,0.75,n'), it('armchair', 'armchair', '0.1,0.9,e'), it('lamp', 'floor-lamp', '1,1,s')],
      dining: [it('table', 'long-table', '0.5,0.5,s'), ...row('chair-n', 'chair', 3, 0.3, 's', 0.3, 0.7), ...row('chair-s', 'chair', 3, 0.7, 'n', 0.3, 0.7), it('dresser', 'dresser', '0.5,0,s'), on('bowl', 'bowl', 'table')],
      kitchen: KITCHEN, bedroom: BEDROOM(), bath: BATHROOM }, layers: OWNED }),
  furnished({ ...RES, name: 'dormitory', synonyms: ['dorm', 'hostel', 'bunkhouse', 'barracks', 'student hall', 'halls of residence'],
    description: 'A furnished two-storey dormitory (14 × 10 m): a common room, a kitchen and a washroom downstairs, two bunk rooms for sixteen and a washroom upstairs. Owner placeholder.',
    params: { w: 14, d: 10, floors: 2, floorHeight: 2.9, roof: 'gable', roofPitch: 28, material: 'brick', wall: '#c08a64', trim: '#f2ead8', roofColor: '#4a4f52', windows: 0.6 },
    plan: plan([{ rooms: [['common', 0, 4, 14, 10], ['kitchen', 0, 0, 7, 4], ['washroom', 7, 0, 14, 4]], doors: [['common', 'kitchen', 0.2], ['common', 'washroom', 0.8]], ext: [['common', 's', 0.5, 1.2]] },
      { rooms: [['landing', 0, 4, 14, 6], ['dorm-1', 0, 6, 14, 10], ['dorm-2', 0, 0, 7, 4], ['washroom-2', 7, 0, 14, 4]], doors: [['landing', 'dorm-1'], ['landing', 'dorm-2', 0.2], ['landing', 'washroom-2', 0.8]] }],
      [[0, 'common', 'n', 0.5]]),
    recipe: { common: [it('sofa-1', 'sofa', '0,0.6,e'), it('sofa-2', 'sofa', '0.2,1,n'), it('tv', 'television', '0,0.15,e'), ...dining(2, 0.55, 0.9, 0.6, 0.6), it('pool', 'pool-table', '0.75,0.15,s'), it('vending', 'vending-machine', '1,1,n')],
      kitchen: KITCHEN, washroom: [...WASHROOM, it('shower', 'shower', '1,1,w 0,1,e')], dorm: [...row('bunk', 'bunk', 4, 0, 's', 0.05, 0.95), ...row('locker', 'lockers', 2, 1, 'n', 0.2, 0.8)] }, layers: OWNED }),
  furnished({ ...RES, name: 'hotel', synonyms: ['inn', 'guesthouse', 'motel', 'lodge', 'b&b', 'bed and breakfast', 'hostelry'],
    description: 'A furnished three-storey hotel (16 × 12 m): a lobby with a reception desk (a night costs 40), a restaurant and a kitchen downstairs; ten guest rooms with a bed, a wardrobe and an armchair up the stairs. Open all day.',
    params: { w: 16, d: 12, floors: 3, floorHeight: 3, roof: 'hip', roofPitch: 26, material: 'plaster', wall: '#e9d9c4', trim: '#3f4a46', roofColor: '#5e5a57', porch: 1.5, windows: 0.65 },
    plan: plan([{ rooms: [['lobby', 0, 5, 16, 12], ['dining', 0, 0, 10, 5], ['kitchen', 10, 0, 16, 5]], doors: [['lobby', 'dining', 0.6], ['dining', 'kitchen']], ext: [['lobby', 's', 0.5, 1.6]] },
      ...[1, 2].map((k) => ({ rooms: [[`corridor-${k}`, 0, 5, 16, 7], ...[0, 1, 2].map((i) => [`guestroom-${5 * k + i - 4}`, (16 / 3) * i, 7, (16 / 3) * (i + 1), 12]), [`guestroom-${5 * k - 1}`, 0, 0, 8, 5], [`guestroom-${5 * k}`, 8, 0, 16, 5]],
        doors: [0, 1, 2, 3, 4].map((i) => [`corridor-${k}`, `guestroom-${5 * k + i - 4}`, i === 3 ? 0.65 : i === 4 ? 0.2 : undefined]) }))], [[0, 'lobby', 'n', 0], [1, 'corridor-1', 'n', 1]]),
    recipe: { lobby: [it('reception', 'shop-counter', '0.75,0.2,s 0.8,0.3,s', { params: { variant: 'reception' }, price: { amount: 40, service: 'a night' } }), it('sofa-1', 'sofa', '0.3,0.8,s 0.2,0.9,e'), it('sofa-2', 'sofa', '0,0.6,e'), it('table', 'round-table', '0.3,0.6,s'), it('plant-1', ['potted-plant', 'flower-pot'], '1,1,s 0,1,s'), it('rug', 'rug', '0.5,0.7,s')],
      dining: [...dining(4, 0.15, 0.85, 0.3, 0.8), it('dresser', 'dresser', '1,0.5,w')], kitchen: KITCHEN, corridor: [],
      guestroom: [it('bed', 'bed', '0.5,0,s 0,0.5,e 0.5,1,n'), it('wardrobe', 'wardrobe', '1,0.9,w 0,0.9,e 1,0.1,w'), it('armchair', 'armchair', '0,0.85,e 1,0.85,w'), it('desk', 'desk', '0,0.4,e 1,0.4,w'), it('lamp', 'floor-lamp', '1,0,s 0,0,s')] },
    layers: { owner: 'god', schedule: HOURS('00:00', '24:00') } }),
  furnished({ ...RES, name: 'mobile-home', synonyms: ['trailer home', 'park home', 'static caravan', 'manufactured home', 'trailer', 'double-wide'],
    description: 'A furnished mobile home (4 × 11 m, metal, low roof): a living room, a galley kitchen, a little bathroom and a bedroom in a row. Owner placeholder.',
    params: { w: 4.2, d: 11, floors: 1, floorHeight: 2.4, roof: 'flat', roofPitch: 0, material: 'metal', wall: '#d8dcd4', trim: '#5f8f8a', roofColor: '#9aa0a0', windows: 0.5 },
    plan: plan([{ rooms: [['living', 0, 7.2, 4.2, 11], ['kitchen', 0, 4.6, 4.2, 7.2], ['bath', 0, 2.8, 4.2, 4.6], ['bedroom', 0, 0, 4.2, 2.8]], ext: [['living', 's', 0.5]] }]),
    recipe: { living: [it('sofa', 'sofa', '0,0.5,e 0.5,0,s'), it('tv', 'television', '1,0.5,w'), it('rug', 'rug', '0.5,0.5,s')], kitchen: [it('stove', 'stove', '0,0.2,e'), it('sink', 'sink', '0,0.8,e'), it('fridge', 'fridge', '1,0,w'), it('table', 'table', '0.8,0.7,w')],
      bath: [it('toilet', 'toilet', '0,0.5,e'), it('basin', 'washbasin', '1,0.5,w')], bedroom: [it('bed', 'bed', '0.5,0,s'), it('dresser', 'dresser', '1,1,w 0,1,e')] }, layers: OWNED }),
];

// ---------------------------------------------------------------- commercial
const COM = { category: 'building.commercial', tags: ['shop'] };
const SHOPHOURS = HOURS('08:00', '20:00');
const counter = (name, variant, tries, price) => it(name, 'shop-counter', tries, { params: { variant }, ...(price ? { price } : {}) });
const shelving = (base, variant, n, fz, face, a, b) => row(base, 'shop-shelving', n, fz, face, a, b, { params: { variant } });
const STORE = [...shelving('shelf', 'goods', 3, 0, 's', 0.1, 0.9), it('crate-1', 'crate', '0.1,0.9,s 0.3,0.9,s'), it('crate-2', 'crate', '0.25,0.9,s 0.4,0.9,s'), it('barrel', 'barrel', '0.9,0.9,s 0.7,0.9,s'), it('sack', 'sack', '0.75,0.9,s 0.6,0.9,s')];
types.push(
  furnished({ ...COM, name: 'corner-shop', synonyms: ['shop', 'store', 'convenience store', 'bodega', 'grocer', 'general store', 'deli', 'mini-mart'],
    description: 'A furnished corner shop (8 × 9 m, one floor): a counter with a till, shelves of groceries, a drinks fridge, a display case and a stockroom behind. Open 8–20; a loaf costs 2, a drink 1.',
    params: { w: 8, d: 9, floors: 1, floorHeight: 3, roof: 'gable', roofPitch: 30, material: 'plaster', wall: '#e8d6b5', trim: '#2f5d8b', roofColor: '#7a3d2e', porch: 1.2, windows: 0.7 },
    plan: plan([{ rooms: [['shop', 0, 3, 8, 9], ['store', 0, 0, 8, 3]], doors: [['shop', 'store', 0.8]], ext: [['shop', 's', 0.5, 1.2]] }]),
    recipe: { shop: [counter('counter', 'shop', '0.8,0.75,w 0.85,0.4,w', { amount: 2, service: 'a loaf' }), shelving('shelf-w', 'groceries', 2, 0.35, 'e', 0, 0).map((x, i) => ({ ...x, try: T(`0,${0.2 + 0.4 * i},e`) })), shelving('aisle', 'bottles', 1, 0.3, 's', 0.45, 0.45),
      it('fridge', 'drinks-fridge', '1,0,s 0.75,0,s', { price: { amount: 1, service: 'a drink' } }), it('case', 'display-case', '0.4,0.65,s 0.45,0.75,s'), it('board', 'sandwich-board', '0.15,1,s')].flat(), store: STORE },
    layers: { owner: 'god', schedule: SHOPHOURS } }),
  furnished({ ...COM, name: 'supermarket', synonyms: ['grocery store', 'superstore', 'hypermarket', 'food store', 'grocery', 'market'],
    description: 'A furnished supermarket (22 × 18 m, one tall floor): aisles of shelving (groceries, bottles, goods), a wall of drinks fridges, two checkouts by the door and a stockroom. Open 7–22; a basket of shopping costs 12.',
    params: { w: 22, d: 18, floors: 1, floorHeight: 4.5, roof: 'flat', roofPitch: 0, material: 'metal', wall: '#e4e6e0', trim: '#c23a2b', roofColor: '#9aa0a0', porch: 2.5, windows: 0.35 },
    plan: plan([{ rooms: [['sales', 0, 4, 22, 18], ['store', 0, 0, 22, 4]], doors: [['sales', 'store', 0.1]], ext: [['sales', 's', 0.5, 2.4]] }]),
    recipe: { sales: [...row('checkout', 'shop-counter', 2, 0.85, 'w', 0.62, 0.85, { params: { variant: 'shop' }, price: { amount: 12, service: 'a basket of shopping' } }),
      ...[0.15, 0.35, 0.55].flatMap((fz, r) => [...row(`aisle-${r + 1}a`, 'shop-shelving', 3, fz, 's', 0.08, 0.5, { params: { variant: ['groceries', 'bottles', 'goods'][r] } }), ...row(`aisle-${r + 1}b`, 'shop-shelving', 3, fz + 0.08, 'n', 0.08, 0.5, { params: { variant: ['goods', 'groceries', 'bottles'][r] } })]),
      ...row('fridge', 'drinks-fridge', 5, 0, 's', 0.6, 0.95), it('board', 'notice-board', '0,0.9,e'), it('bin', 'bin', '0.95,1,s')], store: [...STORE, it('pallet', 'pallet-rack', '0.5,0,s')] },
    layers: { owner: 'god', schedule: HOURS('07:00', '22:00') } }),
  furnished({ ...COM, name: 'restaurant', synonyms: ['diner', 'bistro', 'eatery', 'brasserie', 'trattoria', 'canteen', 'dining room'],
    description: 'A furnished restaurant (12 × 10 m): a dining room of six tables for two by a host stand, a kitchen with stoves, counters, a sink and a fridge, and a washroom. Open 12–23; a meal costs 8.',
    params: { w: 12, d: 10, floors: 1, floorHeight: 3.2, roof: 'gable', roofPitch: 26, material: 'brick', wall: '#9b5a43', trim: '#f2ead8', roofColor: '#3f4446', porch: 1.5, windows: 0.7 },
    plan: plan([{ rooms: [['dining', 0, 4, 12, 10], ['kitchen', 0, 0, 8, 4], ['washroom', 8, 0, 12, 4]], doors: [['dining', 'kitchen', 0.5], ['dining', 'washroom']], ext: [['dining', 's', 0.5, 1.4]] }]),
    recipe: { dining: [counter('host', 'reception', '0.85,0.85,w 0.9,0.7,w', { amount: 8, service: 'a meal' }), ...dining(6, 0.12, 0.7, 0.25, 0.85, 2), it('dresser', 'dresser', '1,0.2,w'), it('plant', ['potted-plant', 'flower-pot'], '0,1,s')],
      kitchen: [it('stove-1', 'stove', '0.1,0,s'), it('stove-2', 'stove', '0.25,0,s'), it('counter-1', 'counter', '0.42,0,s'), it('sink', 'sink', '0.6,0,s'), it('counter-2', 'counter', '0.78,0,s'), it('fridge', 'fridge', '1,0,s 1,0.5,w'), it('prep', 'long-table', '0.5,0.65,s'), on('pot', 'pot', 'prep')],
      washroom: [it('toilet', 'toilet', '0,0,s 0,0.5,e'), it('basin', 'washbasin', '1,0,s 1,0.5,w')] },
    layers: { owner: 'god', schedule: HOURS('12:00', '23:00') } }),
  furnished({ ...COM, name: 'cafe', synonyms: ['café', 'coffee shop', 'coffeehouse', 'tea room', 'tearoom', 'espresso bar', 'cafeteria'],
    description: 'A furnished café (8 × 7 m) with a porch and a terrace out front: a counter with a coffee machine (a coffee costs 3), a cake cabinet (a slice of cake 4), small tables and chairs, a sofa, a kitchen and a washroom. Open 7–18.',
    params: { w: 8, d: 7, floors: 1, floorHeight: 3, roof: 'gable', roofPitch: 30, material: 'plaster', wall: '#efd2a8', trim: '#7a3d2e', roofColor: '#b0583a', porch: 1.5, windows: 0.7 },
    plan: plan([{ rooms: [['cafe', 0, 2.8, 8, 7], ['kitchen', 0, 0, 5, 2.8], ['washroom', 5, 0, 8, 2.8]], doors: [['cafe', 'kitchen', 0.85], ['cafe', 'washroom']], ext: [['cafe', 's', 0.5, 1.2]] }]),
    recipe: { cafe: [counter('counter', 'cafe', '0.3,0,s 0.25,0.1,s', { amount: 3, service: 'a coffee' }), it('cakes', 'display-case', '0.62,0,s 0.7,0.1,s', { price: { amount: 4, service: 'a slice of cake' } }), ...dining(2, 0.15, 0.6, 0.75, 0.75), it('sofa', 'sofa', '1,0.65,w'), it('table-3', 'round-table', '0.8,0.65,s'), it('lamp', 'floor-lamp', '1,0.15,s')],
      kitchen: [it('stove', 'stove', '0.15,0,s'), it('sink', 'sink', '0.45,0,s'), it('fridge', 'fridge', '0.75,0,s 1,0,s'), it('counter', 'counter', '1,0.6,w 0.5,1,n')], washroom: [it('toilet', 'toilet', '0.3,0,s 0,0.5,e'), it('basin', 'washbasin', '0.85,0,s 1,0.5,w')] },
    outside: [{ id: 'terrace', def: 'core/cafe-terrace@1', p: [0, 0, 6.5] }, { id: 'menu', def: 'core/sandwich-board@1', p: [3.4, 0, 5.6], r: -0.4 }],
    layers: { owner: 'god', schedule: HOURS('07:00', '18:00') } }),
  furnished({ ...COM, name: 'bar', synonyms: ['pub', 'tavern', 'saloon', 'bar room', 'public house', 'taproom', 'inn bar'],
    description: 'A furnished bar (10 × 9 m): a long bar with beer taps (a pint costs 4) and stools, tables and chairs, a pool table and a dartboard, a cellar of barrels and a washroom. Open 16–01.',
    params: { w: 10, d: 9, floors: 1, floorHeight: 3, roof: 'gable', roofPitch: 34, material: 'brick', wall: '#6b3a2e', trim: '#d9a63a', roofColor: '#3f4446', windows: 0.45 },
    plan: plan([{ rooms: [['bar', 0, 3, 10, 9], ['cellar', 0, 0, 6, 3], ['washroom', 6, 0, 10, 3]], doors: [['bar', 'cellar', 0.2], ['bar', 'washroom', 0.5]], ext: [['bar', 's', 0.3, 1.2]] }]),
    recipe: { bar: [counter('bar', 'bar', '0.55,-0.01,s 0.55,0.1,s', { amount: 4, service: 'a pint' }), ...row('stool', 'stool', 3, 0.3, 's', 0.42, 0.68), it('pool', 'pool-table', '0.75,0.75,s 0.7,0.8,s'), it('darts', 'dartboard', '0,0.4,e'), ...dining(2, 0.1, 0.3, 0.55, 0.9, 1), it('jukebox', ['arcade-cabinet', 'radio'], '1,0.25,w')],
      cellar: [...row('barrel', 'barrel', 4, 0, 's', 0.1, 0.9), it('crate-1', 'crate', '0.6,1,s 0.6,0.6,s'), it('crate-2', 'crate', '0.8,1,s 0.8,0.6,s')], washroom: [it('toilet', 'toilet', '0.3,0,s'), it('basin', 'washbasin', '0.85,0,s')] },
    layers: { owner: 'god', schedule: { open: [{ from: '16:00', to: '01:00' }] } } }),
  furnished({ ...COM, name: 'bank', synonyms: ['bank branch', 'savings bank', 'building society', 'credit union', 'bureau de change', 'treasury'],
    description: 'A furnished stone bank (12 × 10 m): a banking hall with two glass-screened counters and a waiting bench, a strongroom behind a round vault door that locks, and an office. Open weekdays 9–17.',
    params: { w: 12, d: 10, floors: 1, floorHeight: 3.8, roof: 'flat', roofPitch: 0, material: 'stone', wall: '#d8cfbd', trim: '#8a7a5a', roofColor: '#8a8478', porch: 2, windows: 0.45 },
    plan: plan([{ rooms: [['banking-hall', 0, 4, 12, 10], ['vault', 0, 0, 5, 4], ['office', 5, 0, 12, 4]], doors: [['banking-hall', 'vault', 0.15], ['banking-hall', 'office', 0.85]], ext: [['banking-hall', 's', 0.5, 1.6]] }]),
    recipe: { 'banking-hall': [counter('counter-1', 'bank', '0.36,0.1,s 0.36,0.3,s'), counter('counter-2', 'bank', '0.64,0.1,s 0.64,0.3,s'), it('bench', 'bench-seat', '0.5,0.8,s'), it('plant-1', ['potted-plant', 'flower-pot'], '0,1,s'), it('plant-2', ['potted-plant', 'flower-pot'], '1,1,s'), it('rug', 'rug', '0.5,0.6,s')],
      vault: [it('vault-door', 'vault-door', '0.5,0,s'), it('chest-1', 'chest', '0,0.5,e 0.1,0.8,e'), it('chest-2', 'chest', '1,0.5,w 0.9,0.8,w')], office: OFFICE(2) },
    layers: { owner: 'god', schedule: HOURS('09:00', '17:00', WEEKDAYS) } }),
  furnished({ ...COM, name: 'office-block', synonyms: ['office', 'office building', 'offices', 'workplace', 'headquarters', 'business centre', 'tower block'],
    description: 'A furnished three-storey office block (14 × 10 m, glass): a reception, then open-plan offices of desks with computers, swivel chairs and filing cabinets, and meeting rooms with a long table. Open weekdays 9–18.',
    params: { w: 14, d: 10, floors: 3, floorHeight: 3.2, roof: 'flat', roofPitch: 0, material: 'glass', wall: '#cfdde0', trim: '#3f4a46', roofColor: '#6a6e72', windows: 0.9 },
    plan: plan([{ rooms: [['reception', 0, 4, 14, 10], ['meeting', 0, 0, 7, 4], ['office', 7, 0, 14, 4]], doors: [['reception', 'meeting', 0.6], ['reception', 'office', 0.5]], ext: [['reception', 's', 0.5, 1.6]] },
      ...[1, 2].map((k) => ({ rooms: [[`corridor-${k}`, 0, 4, 14, 6], [`office-${2 * k}`, 0, 6, 14, 10], [`office-${2 * k + 1}`, 0, 0, 7, 4], [`meeting-${k + 1}`, 7, 0, 14, 4]], doors: [[`corridor-${k}`, `office-${2 * k}`], [`corridor-${k}`, `office-${2 * k + 1}`, 0.6], [`corridor-${k}`, `meeting-${k + 1}`, 0.2]] }))],
      [[0, 'reception', 'n', 0], [1, 'corridor-1', 'n', 1]]),
    recipe: { reception: [counter('desk', 'reception', '0.6,0.35,s 0.7,0.4,s'), it('sofa', 'sofa', '1,0.6,w'), it('table', 'round-table', '0.85,0.6,s'), it('plant', ['potted-plant', 'flower-pot'], '0,1,s'), it('vending', 'vending-machine', '1,0,s')],
      office: OFFICE(6), meeting: [it('table', 'long-table', '0.5,0.5,s'), ...row('chair-n', 'office-chair', 2, 0.25, 's', 0.35, 0.65), ...row('chair-s', 'office-chair', 2, 0.75, 'n', 0.35, 0.65), it('board', 'wall-board', '0.5,0,s'), it('screen', 'television', '1,0.5,w')], corridor: [] },
    layers: { owner: 'god', schedule: HOURS('09:00', '18:00', WEEKDAYS) } }),
  furnished({ ...COM, name: 'mall', synonyms: ['shopping mall', 'shopping centre', 'arcade', 'galleria', 'shopping center', 'plaza mall'],
    description: 'A furnished shopping mall (32 × 22 m, one tall floor): a central concourse with benches, a food-court counter and tables, and four shops off it: a boutique, a bookshop, a grocer and a gift shop. Open 9–21.',
    params: { w: 32, d: 22, floors: 1, floorHeight: 4.5, roof: 'flat', roofPitch: 0, material: 'plaster', wall: '#ece4d4', trim: '#2f6b6b', roofColor: '#9aa0a0', porch: 3, windows: 0.4 },
    plan: plan([{ rooms: [['concourse', 8, 0, 24, 22], ['boutique', 0, 11, 8, 22], ['bookshop', 0, 0, 8, 11], ['grocer', 24, 11, 32, 22], ['gift-shop', 24, 0, 32, 11]],
      doors: [['concourse', 'boutique'], ['concourse', 'bookshop'], ['concourse', 'grocer'], ['concourse', 'gift-shop']], ext: [['concourse', 's', 0.5, 3], ['concourse', 'n', 0.5, 1.6]] }]),
    recipe: { concourse: [counter('food-counter', 'cafe', '0.5,0.15,s', { amount: 5, service: 'a lunch' }), ...dining(4, 0.2, 0.8, 0.35, 0.55), ...row('bench', 'bench-seat', 2, 0.85, 's', 0.25, 0.75), it('statue', 'statue', '0.5,0.75,s')],
      boutique: [counter('till', 'shop', '0.5,0.1,s', { amount: 15, service: 'some clothes' }), ...row('rail', 'clothes-rail', 3, 0.55, 'e', 0.15, 0.85).map((x, i) => ({ ...x, try: T(`0.4,${0.35 + 0.25 * i},e`) }))],
      bookshop: [counter('till', 'shop', '0.5,1,n', { amount: 6, service: 'a book' }), ...shelving('shelf', 'books', 3, 0, 's', 0.05, 0.95), it('table', 'table', '0.5,0.5,s'), on('books', 'book-stack', 'table')],
      grocer: [counter('till', 'shop', '0.5,0.1,s', { amount: 3, service: 'a bag of fruit' }), ...shelving('shelf', 'groceries', 2, 0.6, 'e', 0.1, 0.1).map((x, i) => ({ ...x, try: T(`0.3,${0.45 + 0.3 * i},e`) })), it('fridge', 'drinks-fridge', '1,0.6,w', { price: { amount: 1, service: 'a drink' } })],
      'gift-shop': [counter('till', 'shop', '0.5,1,n', { amount: 4, service: 'a gift' }), it('case-1', 'display-case', '0.3,0.35,s'), it('case-2', 'display-case', '0.7,0.35,s'), ...shelving('shelf', 'goods', 2, 0, 's', 0.15, 0.85)] },
    layers: { owner: 'god', schedule: HOURS('09:00', '21:00') } }),
  furnished({ ...COM, name: 'garage', synonyms: ['car garage', 'auto repair', 'mechanic', 'body shop', 'service station', 'motor workshop'],
    description: 'A furnished car repair garage (10 × 12 m): a tall workshop bay behind a wide door with a two-post lift, a car in for repair, workbenches and toolboxes; an office and a parts store. Open weekdays 8–18; a repair costs 30.',
    params: { w: 10, d: 12, floors: 1, floorHeight: 4.2, roof: 'shed', roofPitch: 10, material: 'metal', wall: '#8a9590', trim: '#d9a63a', roofColor: '#4f5559', windows: 0.3 },
    plan: plan([{ rooms: [['workshop', 0, 4, 10, 12], ['office', 0, 0, 5, 4], ['parts', 5, 0, 10, 4]], doors: [['workshop', 'office', 0.5], ['workshop', 'parts', 0.5]], ext: [['workshop', 's', 0.45, 3.4]] }]),
    recipe: { workshop: [it('lift', 'car-lift', '0.35,0.3,s'), it('car', 'family-car', '0.8,0.55,s 0.75,0.6,s'), it('bench', 'workbench', '0,0.2,e 0,0.5,e'), it('toolbox', 'toolbox', '0.05,0.75,e'), it('tyres', 'barrel', '1,0,s'), it('counter', 'shop-counter', '1,0.15,w', { params: { variant: 'shop' }, price: { amount: 30, service: 'a repair' } })],
      office: [it('desk', 'office-desk', '0.5,0.3,s'), it('cabinet', 'filing-cabinet', '0,0,s')], parts: STORE },
    layers: { owner: 'god', schedule: HOURS('08:00', '18:00', WEEKDAYS) } }),
  furnished({ ...COM, name: 'petrol-station', synonyms: ['gas station', 'filling station', 'fuel station', 'service station', 'forecourt', 'petrol garage'],
    description: 'A furnished petrol station: a small shop kiosk (9 × 7 m) with a till, snacks and a drinks fridge, and three fuel pumps on the forecourt in front (a tank of fuel costs 20). Open 6–24.',
    params: { w: 9, d: 7, floors: 1, floorHeight: 3, roof: 'flat', roofPitch: 0, material: 'plaster', wall: '#f2f0ea', trim: '#c23a2b', roofColor: '#9aa0a0', porch: 2.5, windows: 0.75 },
    plan: plan([{ rooms: [['kiosk', 0, 2.5, 9, 7], ['store', 0, 0, 9, 2.5]], doors: [['kiosk', 'store', 0.85]], ext: [['kiosk', 's', 0.3, 1.2]] }]),
    recipe: { kiosk: [counter('till', 'shop', '0.55,0.2,s 0.5,0.4,s', { amount: 2, service: 'a snack' }), shelving('shelf', 'groceries', 1, 0.6, 'e', 0, 0).map((x) => ({ ...x, try: T('0,0.5,e') })), it('fridge', 'drinks-fridge', '0.35,0,s', { price: { amount: 1, service: 'a drink' } }), it('vending', 'vending-machine', '1,1,w')].flat(), store: STORE },
    outside: [-4, 0, 4].map((x, i) => ({ id: `pump-${i + 1}`, def: 'core/fuel-pump@1', p: [x, 0, 10.5], price: { amount: 20, service: 'a tank of fuel' } })),
    layers: { owner: 'god', schedule: HOURS('06:00', '24:00') } }),
);


// ---------------------------------------------------------------- civic
const CIV = { category: 'building.civic', tags: ['civic'] };
const CLASSROOM = [it('board', 'wall-board', '0.5,0,s', { params: { variant: 'whiteboard' } }), it('teacher', 'office-desk', '0.2,0.12,n 0.8,0.12,n'), ...[0.22, 0.52, 0.82].flatMap((fz, r) => [0.2, 0.5, 0.8].flatMap((fx, c) => [it(`desk-${r + 1}-${c + 1}`, 'school-desk', `${fx},${fz},n`), it(`chair-${r + 1}-${c + 1}`, 'chair', `${fx},${fz + 0.1},n ${fx},${fz + 0.13},n`)])), it('shelf', 'bookcase', '1,0.6,w 0,0.6,e'), it('lockers', 'lockers', '0,0.9,e 1,0.95,w')];
types.push(
  furnished({ ...CIV, name: 'school', synonyms: ['schoolhouse', 'primary school', 'secondary school', 'academy', 'college', 'classrooms', 'high school'],
    description: 'A furnished two-storey school (20 × 12 m): four classrooms of nine pupil desks facing a whiteboard and the teacher\'s desk, a corridor with side entrances, a staff room, an office, washrooms and a library upstairs. Open weekdays 8:30–15:30.',
    params: { w: 20, d: 12, floors: 2, floorHeight: 3.4, roof: 'gable', roofPitch: 22, material: 'brick', wall: '#b5704f', trim: '#f0e6d0', roofColor: '#5a3e2e', porch: 0, windows: 0.75 },
    plan: plan([{ rooms: [['classroom-1', 0, 5, 10, 12], ['classroom-2', 10, 5, 20, 12], ['hall', 0, 3, 20, 5], ['staffroom', 0, 0, 7, 3], ['washroom', 7, 0, 12, 3], ['office', 12, 0, 20, 3]],
      doors: [['hall', 'classroom-1', 0.85], ['hall', 'classroom-2', 0.15], ['hall', 'staffroom', 0.7], ['hall', 'washroom'], ['hall', 'office']], ext: [['hall', 'w', 0.5, 1.4], ['hall', 'e', 0.5, 1.4], ['classroom-1', 's', 0.5]] },
      { rooms: [['corridor', 0, 3, 20, 5], ['classroom-3', 0, 5, 10, 12], ['classroom-4', 10, 5, 20, 12], ['library', 0, 0, 20, 3]], doors: [['corridor', 'classroom-3', 0.85], ['corridor', 'classroom-4', 0.15], ['corridor', 'library', 0.5]] }],
      [[0, 'hall', 'n', 0]]),
    recipe: { classroom: CLASSROOM, staffroom: [it('table', 'long-table', '0.5,0.6,s'), ...row('chair', 'chair', 3, 1, 'n', 0.15, 0.45), it('kettle-counter', 'counter', '0,0,s'), it('fridge', 'fridge', '1,0,s')], washroom: WASHROOM,
      office: [it('desk', 'office-desk', '0.4,0.2,s'), it('cabinet', 'filing-cabinet', '1,0,s'), it('vending', 'vending-machine', '1,1,w')], library: [...row('shelf', 'bookcase', 5, 0, 's', 0.1, 0.9), ...row('table', 'table', 2, 0.85, 's', 0.6, 0.9)], hall: [], corridor: [] },
    layers: { owner: 'god', schedule: HOURS('08:30', '15:30', WEEKDAYS) } }),
  furnished({ ...CIV, name: 'hospital', synonyms: ['infirmary', 'medical centre', 'clinic', 'sanatorium', 'a and e', 'emergency room', 'health centre'],
    description: 'A furnished two-storey hospital (18 × 12 m): a reception with a waiting area, a consulting room, a pharmacy counter and washrooms downstairs; three wards of hospital beds and an office up. Open all day.',
    params: { w: 18, d: 12, floors: 2, floorHeight: 3.2, roof: 'flat', roofPitch: 0, material: 'plaster', wall: '#f2f0ea', trim: '#3f8a7a', roofColor: '#9aa0a0', porch: 2, windows: 0.65 },
    plan: plan([{ rooms: [['reception', 0, 5, 18, 12], ['consulting', 0, 0, 6, 5], ['pharmacy', 6, 0, 12, 5], ['washroom', 12, 0, 18, 5]], doors: [['reception', 'consulting', 0.7], ['reception', 'pharmacy', 0.5], ['reception', 'washroom', 0.5], ['consulting', 'pharmacy', 0.5]], ext: [['reception', 's', 0.5, 1.8]] },
      { rooms: [['corridor', 0, 5, 18, 7], ['ward-1', 0, 7, 9, 12], ['ward-2', 9, 7, 18, 12], ['ward-3', 0, 0, 9, 5], ['office', 9, 0, 18, 5]], doors: [['corridor', 'ward-1', 0.9], ['corridor', 'ward-2', 0.1], ['corridor', 'ward-3', 0.7], ['corridor', 'office', 0.5]] }],
      [[0, 'reception', 'n', 0]]),
    recipe: { reception: [counter('desk', 'reception', '0.7,0.25,s'), ...row('wait', 'bench-seat', 3, 0.75, 's', 0.15, 0.55), it('vending', 'vending-machine', '1,0.9,w', { price: { amount: 2, service: 'a snack' } }), it('plant', ['potted-plant', 'flower-pot'], '1,0.1,w')],
      consulting: [it('bed', 'hospital-bed', '0,0.5,e 0.2,0,s'), it('desk', 'office-desk', '0.75,0.25,s'), it('basin', 'washbasin', '1,0.9,w'), it('cabinet', 'filing-cabinet', '1,0,s')],
      pharmacy: [counter('counter', 'shop', '0.5,0.7,s', { amount: 3, service: 'medicine' }), ...shelving('shelf', 'bottles', 2, 0, 's', 0.2, 0.8)], washroom: WASHROOM,
      ward: [...row('bed', 'hospital-bed', 3, 0, 's', 0.1, 0.9), ...row('chair', 'chair', 3, 0.5, 'n', 0.1, 0.9), it('bed-4', 'hospital-bed', '0.5,1,n 0.3,1,n'), it('basin', 'washbasin', '1,1,w')], office: OFFICE(2), corridor: [] },
    layers: { owner: 'god', schedule: HOURS('00:00', '24:00') } }),
  furnished({ ...CIV, name: 'library', synonyms: ['public library', 'reading room', 'book library', 'lending library', 'archive', 'athenaeum'],
    description: 'A furnished library (14 × 10 m, one tall floor): a reading room with a lending desk, reading tables and armchairs, the stacks of bookcases behind it and a librarian\'s office. Open 9–19; books are free to read.',
    params: { w: 14, d: 10, floors: 1, floorHeight: 5, roof: 'gable', roofPitch: 32, material: 'brick', wall: '#a8664a', trim: '#f2ead8', roofColor: '#4a4f52', porch: 1.5, windows: 0.55 },
    plan: plan([{ rooms: [['reading', 0, 3.5, 14, 10], ['stacks', 0, 0, 10, 3.5], ['office', 10, 0, 14, 3.5]], doors: [['reading', 'stacks', 0.15], ['reading', 'office', 0.5]], ext: [['reading', 's', 0.5, 1.6]] }]),
    recipe: { reading: [counter('desk', 'reception', '0.8,0.75,w 0.85,0.6,w'), ...[0, 1, 2].flatMap((i) => [it(`table-${i + 1}`, 'long-table', `${0.15 + 0.3 * i},0.35,s`), it(`chair-${i + 1}a`, 'chair', `${0.1 + 0.3 * i},0.15,s`), it(`chair-${i + 1}b`, 'chair', `${0.2 + 0.3 * i},0.55,n`)]),
      it('armchair-1', 'armchair', '0,0.8,e'), it('armchair-2', 'armchair', '0.2,1,n'), it('lamp', 'floor-lamp', '0,1,s'), it('shelf-s', 'bookcase', '0.3,1,n')],
      stacks: [...row('shelf', 'bookcase', 6, 0, 's', 0.25, 1), ...row('stack', 'bookcase', 4, 0.75, 'n', 0.3, 1)], office: [it('desk', 'office-desk', '0.5,0.25,s'), it('shelf', 'bookshelf', '1,0.6,w')] },
    layers: { owner: 'god', schedule: HOURS('09:00', '19:00') } }),
  furnished({ ...CIV, name: 'town-hall', synonyms: ['city hall', 'council house', 'civic centre', 'municipal building', 'guildhall', 'courthouse'],
    description: 'A furnished town hall (16 × 12 m, stone, a tall floor): a council chamber with a long table, chairs, a lectern and pews for the public, a foyer with an enquiries desk and two offices. Open weekdays 9–17; council meets Mondays at 18:00.',
    params: { w: 16, d: 12, floors: 1, floorHeight: 4.6, roof: 'hip', roofPitch: 28, material: 'stone', wall: '#d8cfbd', trim: '#8a7a5a', roofColor: '#4f5559', porch: 2.5, windows: 0.6 },
    plan: plan([{ rooms: [['chamber', 0, 0, 16, 5.5], ['office-1', 0, 5.5, 5, 12], ['foyer', 5, 5.5, 11, 12], ['office-2', 11, 5.5, 16, 12]], doors: [['foyer', 'chamber'], ['foyer', 'office-1'], ['foyer', 'office-2']], ext: [['foyer', 's', 0.5, 1.8]] }]),
    recipe: { chamber: [it('table', 'long-table', '0.5,0.15,s'), ...row('chair', 'chair', 3, 0, 's', 0.42, 0.58), it('lectern', 'lectern', '0.15,0.2,s'), ...row('pew', 'pew', 2, 0.85, 'n', 0.05, 0.3), ...row('pew-e', 'pew', 2, 0.85, 'n', 0.7, 0.95), it('flag', ['flagpole', 'statue'], '1,0,s')],
      foyer: [counter('desk', 'reception', '0.5,0.3,s'), it('board', 'notice-board', '0,0.12,e'), it('bench', 'bench-seat', '1,0.12,w')], office: [it('desk', 'office-desk', '0.5,0.2,s'), it('cabinet', 'filing-cabinet', '0,0,s'), it('shelf', 'bookshelf', '1,0.4,w')] },
    layers: { owner: 'god', schedule: { ...HOURS('09:00', '17:00', WEEKDAYS), events: [{ name: 'council', label: 'Council meeting', at: '18:00', minutes: 90, days: ['mon'] }] } } }),
  furnished({ ...CIV, name: 'police-station', synonyms: ['police station', 'police', 'precinct', 'sheriff office', 'constabulary', 'jail'],
    description: 'A furnished police station (14 × 10 m): a front desk with a waiting bench, an office of desks and filing cabinets, and three holding cells behind barred doors that lock, each with a cot and a toilet. Open all day.',
    params: { w: 14, d: 10, floors: 1, floorHeight: 3.2, roof: 'flat', roofPitch: 0, material: 'brick', wall: '#7a8a9a', trim: '#2f4a6b', roofColor: '#5d6466', porch: 1.5, windows: 0.5 },
    plan: plan([{ rooms: [['front', 0, 5, 9, 10], ['office', 0, 0, 9, 5], ['cell-1', 9, 0, 14, 3.33], ['cell-2', 9, 3.33, 14, 6.67], ['cell-3', 9, 6.67, 14, 10]],
      doors: [['front', 'office', 0.8], ['office', 'cell-1'], ['front', 'cell-3'], ['office', 'cell-2', 0.75]], ext: [['front', 's', 0.4, 1.4]] }]),
    recipe: { front: [counter('desk', 'reception', '0.5,0.2,s'), it('bench', 'bench-seat', '0,0.8,e'), it('board', 'notice-board', '1,0.12,w'), it('plant', ['potted-plant', 'flower-pot'], '0,1,s')], office: OFFICE(4),
      cell: [it('bars', 'cell-bars', '0.25,0.5,w'), it('cot', 'cot', '1,0.5,w 0.8,0.5,s'), it('toilet', 'toilet', '0.8,0,s 0.8,1,n')] },
    layers: { owner: 'god', schedule: HOURS('00:00', '24:00') } }),
  furnished({ ...CIV, name: 'fire-station', synonyms: ['fire station', 'firehouse', 'fire hall', 'engine house', 'fire brigade', 'firefighters'],
    description: 'A furnished two-storey fire station (12 × 16 m): an appliance bay with a fire engine behind a wide door, lockers for the crew, a mess kitchen and a kit room; a bunk room, a washroom and an office upstairs. Open all day.',
    params: { w: 12, d: 16, floors: 2, floorHeight: 3.6, roof: 'flat', roofPitch: 0, material: 'brick', wall: '#a8402e', trim: '#f2ead8', roofColor: '#4a4a48', porch: 0, windows: 0.4 },
    plan: plan([{ rooms: [['bay', 0, 5, 12, 16], ['mess', 0, 0, 6, 5], ['kit', 6, 0, 12, 5]], doors: [['bay', 'mess', 0.7], ['bay', 'kit', 0.5], ['mess', 'kit', 0.5]], ext: [['bay', 's', 0.5, 3.6]] },
      { rooms: [['landing', 0, 5, 12, 7], ['dorm', 0, 7, 12, 16], ['washroom', 0, 0, 6, 5], ['office', 6, 0, 12, 5]], doors: [['landing', 'dorm'], ['landing', 'washroom', 0.7], ['landing', 'office', 0.5], ['washroom', 'office', 0.5]] }],
      [[0, 'bay', 'n', 0]]),
    recipe: { bay: [it('engine', 'fire-engine', '0.62,0.55,s 0.6,0.6,s'), ...row('locker', 'lockers', 3, 1, 'e', 0.05, 0.05).map((x, i) => ({ ...x, try: T(`0,${0.4 + 0.2 * i},e`) })), it('bench', 'workbench', '1,0.1,w')],
      mess: KITCHEN, kit: [...row('rack', 'clothes-rail', 2, 0, 's', 0.2, 0.8), it('lockers', 'lockers', '1,0.8,w'), it('ladder', 'ladder', '0,0.8,e')], dorm: [...row('bunk', 'bunk', 5, 0.95, 'n', 0.05, 0.95)], washroom: [...WASHROOM, it('shower', 'shower', '1,1,w')], office: OFFICE(2), landing: [] },
    layers: { owner: 'god', schedule: HOURS('00:00', '24:00') } }),
  furnished({ ...CIV, name: 'church', synonyms: ['chapel', 'temple', 'place of worship', 'mosque', 'synagogue', 'meeting house', 'kirk', 'shrine'],
    description: 'A furnished stone church (10 × 18 m, a tall nave): rows of pews facing an altar with candles, a lectern and a piano at the front, and a vestry behind. Open 8–20; a service on Sundays at 10:00.',
    params: { w: 10, d: 18, floors: 1, floorHeight: 5, roof: 'gable', roofPitch: 45, material: 'stone', wall: '#e9e4da', trim: '#8f877a', roofColor: '#4f5a60', porch: 2, windows: 0.5 },
    plan: plan([{ rooms: [['nave', 0, 3, 10, 18], ['vestry', 0, 0, 10, 3]], doors: [['nave', 'vestry', 0.85]], ext: [['nave', 's', 0.5, 1.8]] }]),
    recipe: { nave: [it('altar', 'altar', '0.5,0.02,s'), it('lectern', 'lectern', '0.2,0.12,s'), it('piano', 'piano', '0.85,0.15,w'), ...grid('pew', 'pew', 2, 6, 0.1, 0.9, 0.3, 0.92, 'n'), it('lamp-l', 'floor-lamp', '0,0.1,s 0,0.2,s'), it('lamp-r', 'floor-lamp', '1,0.1,s 1,0.2,s')],
      vestry: [it('wardrobe', 'wardrobe', '0,0,s'), it('table', 'table', '0.5,0.5,s'), it('chair', 'chair', '0.5,0.9,n'), it('shelf', 'bookshelf', '1,0,s 0.3,0,s')] },
    layers: { owner: 'god', schedule: { ...HOURS('08:00', '20:00'), events: [{ name: 'service', label: 'Sunday service', at: '10:00', minutes: 60, days: ['sun'] }] } } }),
  furnished({ ...CIV, name: 'prison', synonyms: ['jail', 'gaol', 'penitentiary', 'lock-up', 'detention centre', 'correctional facility'],
    description: 'A furnished prison block (20 × 14 m, stone): six cells off a corridor, each behind a barred door that locks with a bunk, a toilet and a basin; a guard room at the entrance and a visiting room with tables. Visiting 14–16.',
    params: { w: 20, d: 14, floors: 1, floorHeight: 3.2, roof: 'flat', roofPitch: 0, material: 'stone', wall: '#9a958a', trim: '#4f5559', roofColor: '#6a6e72', windows: 0.25 },
    plan: plan([{ rooms: [['guardroom', 0, 9, 8, 14], ['visiting', 8, 9, 20, 14], ['corridor', 0, 6.5, 20, 9], ...[0, 1, 2, 3, 4, 5].map((i) => [`cell-${i + 1}`, (20 / 6) * i, 0, (20 / 6) * (i + 1), 6.5])],
      doors: [['guardroom', 'corridor', 0.5], ['visiting', 'corridor', 0.5], ['guardroom', 'visiting', 0.5], ...[1, 2, 3, 4, 5, 6].map((i) => ['corridor', `cell-${i}`])], ext: [['guardroom', 's', 0.5, 1.2]] }]),
    recipe: { guardroom: [it('desk', 'office-desk', '0.5,0.3,s'), it('lockers', 'lockers', '0,0.5,e'), it('cabinet', 'filing-cabinet', '1,0.2,w'), it('screen', 'television', '0,0.95,e 1,0.95,w')],
      visiting: [...dining(3, 0.15, 0.85, 0.5, 0.5, 3), it('vending', 'vending-machine', '1,1,w')], corridor: [],
      cell: [it('bars', 'cell-bars', '0.5,0.78,s'), it('bunk', 'bunk', '0,0.15,e 0.3,0,s'), it('toilet', 'toilet', '1,0,s'), it('basin', 'washbasin', '1,0.4,w')] },
    layers: { owner: 'god', access: 'private', schedule: { open: [{ from: '14:00', to: '16:00' }] } } }),
);

// ---------------------------------------------------------------- recreation
const REC = { category: 'public.venue', tags: ['recreation'] };
types.push(
  furnished({ ...REC, category: 'building.civic', name: 'theatre', synonyms: ['theater', 'playhouse', 'opera house', 'auditorium', 'cinema', 'concert hall', 'music hall'],
    description: 'A furnished theatre (16 × 22 m, a tall floor): an auditorium of twelve rows of tip-up seats (48 seats) facing a stage with curtains, and a foyer with a box office (a ticket costs 10). A show every night at 19:30.',
    params: { w: 16, d: 22, floors: 1, floorHeight: 5, roof: 'gable', roofPitch: 24, material: 'brick', wall: '#8a3f3a', trim: '#e8dcc4', roofColor: '#3f4446', porch: 2, windows: 0.2 },
    plan: plan([{ rooms: [['auditorium', 0, 0, 16, 16], ['foyer', 0, 16, 16, 22]], doors: [['foyer', 'auditorium', 0.2], ['foyer', 'auditorium', 0.8]], ext: [['foyer', 's', 0.5, 2]] }]),
    recipe: { auditorium: [it('stage', 'stage', '0.5,0,s'), ...grid('row', 'theatre-seats', 3, 4, 0.12, 0.88, 0.5, 0.95, 'n')],
      foyer: [counter('box-office', 'reception', '0.5,0.15,s', { amount: 10, service: 'a ticket' }), it('sofa-1', 'sofa', '0,0.6,e'), it('sofa-2', 'sofa', '1,0.6,w'), it('poster-1', 'notice-board', '0.15,1,n'), it('poster-2', 'notice-board', '0.85,1,n')] },
    layers: { owner: 'god', schedule: { open: [{ from: '18:00', to: '23:00' }], events: [{ name: 'show', label: 'Tonight\'s show', at: '19:30', minutes: 120 }] } } }),
  furnished({ ...REC, category: 'building.civic', name: 'museum', synonyms: ['gallery', 'art gallery', 'exhibition hall', 'museum building', 'collection', 'heritage centre'],
    description: 'A furnished museum (22 × 16 m, stone, a tall floor): an entrance hall with a ticket desk and a gift shelf, and two galleries of glass display cases, plinths and statues with benches. Open 10–18; entry costs 5.',
    params: { w: 22, d: 16, floors: 1, floorHeight: 5, roof: 'flat', roofPitch: 0, material: 'stone', wall: '#e4dccb', trim: '#9a8a6a', roofColor: '#8a8478', porch: 3, windows: 0.25 },
    plan: plan([{ rooms: [['gallery-1', 0, 0, 11, 10], ['gallery-2', 11, 0, 22, 10], ['hall', 0, 10, 22, 16]], doors: [['hall', 'gallery-1'], ['hall', 'gallery-2'], ['gallery-1', 'gallery-2']], ext: [['hall', 's', 0.5, 2]] }]),
    recipe: { gallery: [it('statue', 'statue', '0.5,0.45,s'), ...row('case', 'display-case', 3, 0, 's', 0.15, 0.85, { params: { variant: 'tall' } }), ...row('plinth', 'display-case', 2, 0.75, 's', 0.2, 0.8, { params: { variant: 'plinth' } }),
      it('bench', 'bench-seat', '0.5,0.8,n'), it('case-w', 'display-case', '0,0.5,e', { params: { variant: 'counter' } })],
      hall: [counter('tickets', 'reception', '0.5,0.2,s', { amount: 5, service: 'a museum ticket' }), ...shelving('gifts', 'books', 2, 0.5, 'e', 0, 0).map((x, i) => ({ ...x, try: T(`0,${0.3 + 0.4 * i},e`) })), it('bench', 'bench-seat', '1,0.6,w')] },
    layers: { owner: 'god', schedule: HOURS('10:00', '18:00') } }),
);
/** An outdoor recreation set: parts are entities placed together (benches Souls sit on, tents they lie in). */
const SPORT = { category: 'public.sport' };
types.push(
  setDef({ ...SPORT, name: 'stadium', synonyms: ['sports ground', 'arena', 'ballpark', 'football ground', 'stadium seating', 'grounds'],
    description: 'A small stadium (76 × 56 m): a grass playing field with goals, eight bleacher stands (144 seats) on the two long sides and the ends, and four floodlights. Souls watch from the stands; a match on Saturdays at 15:00 (schedule on the field).',
    parts: [{ id: 'field', def: 'core/sports-field@1', schedule: { events: [{ name: 'match', label: 'Saturday match', at: '15:00', minutes: 110, days: ['sat'] }] } },
      ...[-21, -7, 7, 21].flatMap((x, i) => [{ id: `stand-n${i + 1}`, def: 'core/bleachers@1', p: [x, 0, -23.5], r: 0 }, { id: `stand-s${i + 1}`, def: 'core/bleachers@1', p: [x, 0, 23.5], r: PI }]),
      ...[[-35, -24], [35, -24], [-35, 24], [35, 24]].map(([x, z], i) => ({ id: `light-${i + 1}`, def: 'core/floodlight@1', p: [x, 0, z], r: z > 0 ? PI : 0 }))],
    size: { box: [76, 10, 56] } }),
  setDef({ ...SPORT, name: 'sports-court-set', synonyms: ['basketball court', 'games court', 'outdoor court', 'playground court', 'streetball court'],
    description: 'A basketball court ready to play (32 × 22 m): the painted court with two hoops, a row of bleachers along one side and a bench and a bin. Souls play on it and sit to watch.',
    parts: [{ id: 'court', def: 'core/sports-court@1' }, { id: 'hoop-w', def: 'core/basketball-hoop@1', p: [-14.6, 0, 0], r: PI / 2 }, { id: 'hoop-e', def: 'core/basketball-hoop@1', p: [14.6, 0, 0], r: -PI / 2 },
      { id: 'stand', def: 'core/bleachers@1', p: [0, 0, 10.2], r: PI }, { id: 'bench', def: 'core/bench@1', p: [-9, 0, -9.2] }, { id: 'bin', def: 'core/bin@1', p: [-11, 0, -9.2] }],
    size: { box: [32, 4, 22] } }),
  setDef({ category: 'public.park', name: 'campground', synonyms: ['campsite', 'camping ground', 'camp', 'caravan park', 'bivouac site'],
    description: 'A campground (16 × 14 m): four tents in a ring round a campfire with log seats, two picnic tables, a water pump, a lantern post and a bin. Souls sleep in the tents and sit by the fire.',
    parts: [{ id: 'fire', def: 'core/campfire@1' }, ...[[-5, -4, 0.6], [5, -4, -0.6], [-5.5, 4, 2.4], [5.5, 4, -2.4]].map(([x, z, r], i) => ({ id: `tent-${i + 1}`, def: 'core/tent@1', p: [x, 0, z], r, params: { variant: i % 2 ? 'dome' : 'ridge' } })),
      { id: 'picnic-1', def: 'core/picnic-table@1', p: [0, 0, -6] }, { id: 'picnic-2', def: 'core/picnic-table@1', p: [0, 0, 6.2] }, { id: 'pump', def: 'core/hand-pump@1', p: [7.5, 0, 0], r: -PI / 2 },
      { id: 'lantern', def: 'core/lantern-post@1', p: [-7.5, 0, 0] }, { id: 'bin', def: 'core/bin@1', p: [7.5, 0, 2] }],
    size: { box: [16, 3, 14] } }),
  setDef({ category: 'public.park', name: 'cemetery', synonyms: ['graveyard', 'churchyard', 'burial ground', 'memorial park', 'necropolis', 'boneyard'],
    description: 'A cemetery (20 × 16 m): four rows of gravestones (headstones, crosses, slabs, a little obelisk), a war memorial, two benches, yew trees and a path down the middle. A quiet place to sit and remember.',
    parts: [...[0, 1, 2, 3].flatMap((r) => [-8, -5, -2, 2, 5, 8].map((x, i) => ({ id: `grave-${r + 1}-${i + 1}`, def: 'core/gravestone@1', p: [x, 0, -6 + r * 3.6], params: { variant: ['headstone', 'cross', 'headstone', 'slab', 'headstone', 'obelisk'][(i + r * 2) % 6] } }))),
      { id: 'memorial', def: 'core/memorial@1', p: [0, 0, -7.5] }, { id: 'bench-1', def: 'core/bench@1', p: [-9.4, 0, 6.5], r: PI / 2 }, { id: 'bench-2', def: 'core/bench@1', p: [9.4, 0, 6.5], r: -PI / 2 },
      { id: 'yew-1', def: 'core/pine@1', p: [-10, 0, -8] }, { id: 'yew-2', def: 'core/pine@1', p: [10, 0, -8] }],
    size: { box: [22, 9, 18] } }),
  setDef({ category: 'public.play', name: 'playground', synonyms: ['play area', 'play park', 'adventure playground', 'tot lot', 'jungle gym', 'kids park'],
    description: 'A playground (16 × 12 m): swings, a slide, a seesaw, a sandpit and a climbing frame, with two benches for the grown-ups and a bin. Children play; Souls sit on the benches and the swings.',
    parts: [{ id: 'swings', def: 'core/swings@1', p: [-4.5, 0, -3] }, { id: 'slide', def: 'core/slide@1', p: [1, 0, -3.5], r: PI / 2 }, { id: 'seesaw', def: 'core/seesaw@1', p: [5.5, 0, -3] },
      { id: 'sandpit', def: 'core/sandpit@1', p: [-4.5, 0, 2.5] }, { id: 'climbing-frame', def: 'core/climbing-frame@1', p: [2, 0, 2.5] },
      { id: 'bench-1', def: 'core/bench@1', p: [-3, 0, 5.6], r: PI }, { id: 'bench-2', def: 'core/bench@1', p: [3, 0, 5.6], r: PI }, { id: 'bin', def: 'core/bin@1', p: [6.5, 0, 5.4] }],
    size: { box: [16, 3.5, 12] } }),
);

export { report }; export default [...fixtures, ...types];
