// Music a Soul turns on and off by hand (Soul Actions entry 20): the hand goes to the knob (the part tinted `valve`, as on
// a tap) and the music starts or stops at contact. Visitors hear a song from a deterministic score at depicted world seconds
// (apps/web/src/gen-mesh/sound.ts playJukeboxes, the piano's score clock), so every viewer hears the same song at the same
// moment. The `music` sound below is only how the sound layer finds it; the generic music loop never plays for it.
import vocab from './vocab.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';

const desk = (vocab.find(d => d.name === 'core-desk-lamp')! as unknown as DefInput).actions!;
const palette = { wood: '#7a4a2a', trim: '#d9b26a', grille: '#3a2f28', dial: '#ffd98a', dark: '#2a2420', valve: '#c9a24a' };
const params = { wood: { type: 'color', default: palette.wood, doc: 'cabinet colour' }, trim: { type: 'color', default: palette.trim, doc: 'trim colour' }, valve: { type: 'color', default: palette.valve, doc: 'knob colour (the hand goes here)' } };

const jukebox: DefInput = {
  schema: 'def/1', name: 'core-jukebox', version: 1,
  description: 'A standing wooden jukebox with a lit dial. A Soul turns it on and off by hand at the knob; it plays songs that everyone nearby hears.',
  tags: ['music', 'jukebox', 'radio', 'hand-operated'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.02, shapes: [
    { kind: 'box', at: [0, 0.65, 0], size: [0.8, 1.3, 0.5], round: 0.03, tint: 'wood' },
    { kind: 'cyl', at: [0, 1.3, 0], r: 0.4, h: 0.5, segments: 16, tint: 'wood', pitch: Math.PI / 2 },
    { kind: 'box', at: [0, 0.45, 0.255], size: [0.6, 0.6, 0.02], round: 0.01, tint: 'grille' },
    ...[0.25, 0.37, 0.49, 0.61].map(y => ({ kind: 'box', at: [0, y, 0.27], size: [0.56, 0.015, 0.012], tint: 'trim' })),
    { kind: 'box', at: [0, 1.05, 0.26], size: [0.5, 0.2, 0.02], round: 0.01, tint: 'dark', when: '!@on' },
    { kind: 'box', at: [0, 1.05, 0.26], size: [0.5, 0.2, 0.02], round: 0.01, tint: 'dial', glow: 1, when: '@on' },
    { kind: 'box', at: [0, 0.9, 0.255], size: [0.72, 0.03, 0.02], tint: 'trim' },
    { kind: 'cyl', at: [0.32, 1.08, 0.28], r: 0.045, h: 0.04, segments: 10, tint: 'valve', pitch: Math.PI / 2 }] } } as unknown as DefInput['make'],
  params: params as DefInput['params'], palette,
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: { sound: { kind: 'music', radius: 22, volume: 0.5, when: 'on', mode: 'loop' } } as DefInput['components'],
  size: { box: [0.8, 1.7, 0.5] },
  actions: desk.map(a => ({ ...structuredClone(a), label: a.name === 'switch-on' ? 'Turn on the jukebox' : 'Turn off the jukebox' })) as DefInput['actions'],
} as DefInput;

// Entry 37: a valve radio on its own narrow console shelf (the frozen v1 tabletop radio stays as it was). Power knob
// (tinted `valve`) and tuning knob (tinted `tuner`) at 1.13 m, reached standing. Three stations, each a stream the sound
// layer generates from the shared clock (apps/web/src/gen-mesh/radio-stations.ts), so everyone near a radio hears the same
// station at the same moment. "Change the station" steps `station` to the next one at the tuning knob's contact; the needle
// (role `needle`) slides to its mark and the knob (role `knob`) turns (vocab-look.ts, opening-motion.ts).
export const RADIO_STATIONS = ['quiet piano', 'dance band', 'evening talk'] as const;
const R = { wood: '#8a5a33', shelf: '#5b3b24', face: '#3b2a1f', cloth: '#cdb48a', dial: '#ffe2a0', dark: '#2a2420', mark: '#4a3424', needle: '#c8321e', jewel: '#ffb347', valve: '#d9c08a', tuner: '#d9c08a', tick: '#f4ead2' };
const rp = { wood: { type: 'color', default: R.wood, doc: 'case colour' }, shelf: { type: 'color', default: R.shelf, doc: 'shelf colour' }, cloth: { type: 'color', default: R.cloth, doc: 'grille cloth colour' } };
const Y = 0.035, FZ = 0.1;  // the radio sits Y above a 1 m shelf; FZ: the face plate's front
const radio: DefInput = {
  schema: 'def/1', name: 'core-radio', version: 2,
  description: 'A wooden valve radio on a narrow console shelf, with a power knob, a tuning knob, a lit dial and a panel light. A Soul turns it on and off and changes the station by hand; everyone nearby hears the same station.',
  tags: ['music', 'radio', 'hand-operated'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0, shapes: [
    // the console shelf: top, apron, four legs, a lower shelf
    { kind: 'box', at: [0, 1.005, 0], size: [0.62, 0.03, 0.36], tint: 'shelf' },
    { kind: 'box', at: [0, 0.96, 0.165], size: [0.56, 0.06, 0.02], tint: 'shelf' },
    ...[[-0.27, -0.15], [0.27, -0.15], [-0.27, 0.15], [0.27, 0.15]].map(([x, z]) => ({ kind: 'box', at: [x, 0.495, z], size: [0.036, 0.99, 0.036], tint: 'shelf' })),
    { kind: 'box', at: [0, 0.32, 0], size: [0.56, 0.022, 0.31], tint: 'shelf' },
    // the radio case with a rounded top
    { kind: 'box', at: [0, 1.02 + Y + 0.14, -0.02], size: [0.5, 0.28, 0.24], tint: 'wood' },
    { kind: 'cyl', at: [0, 1.02 + Y + 0.27, -0.02], r: 0.12, h: 0.5, segments: 12, tint: 'wood', roll: Math.PI / 2 },
    { kind: 'box', at: [0, 1.02 + Y + 0.135, FZ + 0.002], size: [0.46, 0.25, 0.008], tint: 'face' },
    // speaker grille: cloth behind three slats
    { kind: 'box', at: [-0.11, 1.02 + Y + 0.14, FZ + 0.008], size: [0.19, 0.2, 0.006], tint: 'cloth' },
    ...[-0.15, -0.07].map(x => ({ kind: 'box', at: [x, 1.02 + Y + 0.14, FZ + 0.013], size: [0.014, 0.2, 0.006], tint: 'wood' })),
    // the dial window, lit while on, with a mark per station and a sliding needle
    { kind: 'box', at: [0.11, 1.02 + Y + 0.2, FZ + 0.008], size: [0.2, 0.07, 0.006], tint: 'dark', when: '!@on' },
    { kind: 'box', at: [0.11, 1.02 + Y + 0.2, FZ + 0.008], size: [0.2, 0.07, 0.006], tint: 'dial', glow: 1, when: '@on' },
    ...[0.05, 0.11, 0.17].map(x => ({ kind: 'box', at: [x, 1.02 + Y + 0.226, FZ + 0.0125], size: [0.005, 0.016, 0.003], tint: 'mark' })),
    { kind: 'box', at: [0.11, 1.02 + Y + 0.2, FZ + 0.014], size: [0.005, 0.06, 0.004], tint: 'needle', role: 'needle', pivot: [0.11, 1.02 + Y + 0.2, FZ + 0.014] },
    // the panel light between the knobs: a dark jewel, amber and lit while on
    { kind: 'cyl', at: [0.11, 1.02 + Y + 0.085, FZ + 0.01], r: 0.011, h: 0.012, segments: 6, tint: 'dark', pitch: Math.PI / 2, when: '!@on' },
    { kind: 'cyl', at: [0.11, 1.02 + Y + 0.085, FZ + 0.01], r: 0.011, h: 0.012, segments: 6, tint: 'jewel', glow: 1, pitch: Math.PI / 2, when: '@on' },
    // power knob (the hand goes here for on/off) and tuning knob (for the station), with a white line that turns
    { kind: 'cyl', at: [0.05, 1.02 + Y + 0.07, FZ + 0.02], r: 0.028, h: 0.032, segments: 8, tint: 'valve', pitch: Math.PI / 2 },
    { kind: 'cyl', at: [0.17, 1.02 + Y + 0.07, FZ + 0.02], r: 0.028, h: 0.032, segments: 8, tint: 'tuner', pitch: Math.PI / 2, role: 'knob', pivot: [0.17, 1.02 + Y + 0.07, FZ + 0.02] },
    { kind: 'box', at: [0.17, 1.02 + Y + 0.085, FZ + 0.037], size: [0.005, 0.022, 0.003], tint: 'tick', role: 'knob', pivot: [0.17, 1.02 + Y + 0.07, FZ + 0.02] }] } } as unknown as DefInput['make'],
  params: rp as DefInput['params'], palette: R,
  state: { on: { type: 'bool', default: false }, station: { type: 'enum', values: [...RADIO_STATIONS], default: RADIO_STATIONS[0] } } as DefInput['state'],
  components: { sound: { kind: 'music', radius: 16, volume: 0.5, when: 'on', mode: 'loop' } } as DefInput['components'],
  size: { box: [0.62, 1.46, 0.36] },
  actions: [
    { name: 'switch-on', label: 'Turn on the radio', roles: 'anyone', reach: 'touch', params: {}, when: [{ field: 'on', is: false }], then: [{ op: 'set', field: 'on', value: true }] },
    { name: 'switch-off', label: 'Turn off the radio', roles: 'anyone', reach: 'touch', params: {}, when: [{ field: 'on', is: true }], then: [{ op: 'set', field: 'on', value: false }] },
    { name: 'change-station', label: 'Change the radio station', roles: 'anyone', reach: 'touch', params: {}, when: [{ field: 'on', is: true }], then: [{ op: 'cycle', field: 'station', values: [...RADIO_STATIONS] }] },
  ] as DefInput['actions'],
} as DefInput;

// #494 / #416: v1 above is immutable (worlds keep its geometry); v2 fits the 400-triangle kit budget. The thin trim slats
// and the trim bar lose a rounding nobody sees at 1.5 cm high (a sharp box is 12 triangles, a chamfered one 44); every
// shape, tint, state, sound and action is otherwise v1's.
const jukebox2: DefInput = { ...structuredClone(jukebox), version: 2 };
for (const sh of (jukebox2.make as unknown as { args: { shapes: { tint?: string; round?: number }[] } }).args.shapes) if (sh.tint === 'trim') sh.round = 0;

export const HAND_MUSIC: DefInput[] = [jukebox, radio, jukebox2];
