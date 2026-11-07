// A drum kit a Soul sits at and plays (Soul Actions entry 26). "Play the drums" seats the Soul on the stool through the
// existing play-music activity (instrument drums); the viewer plays and draws a drum part on the piano's own clock, so a
// pianist and a drummer near each other play in time. No new server faculty.
import type { DefInput } from '../schemas.ts';
const drum = (at: number[], r: number, h: number, extra: Record<string, unknown> = {}) => [
  { kind: 'cyl', at, r, h, segments: 18, tint: 'shell', ...extra },
  { kind: 'cyl', at: [at[0], at[1] + h / 2 + 0.002, at[2]], r: r * 0.96, h: 0.004, segments: 18, tint: 'head', ...extra }];
const stand = (x: number, z: number, h: number) => ({ kind: 'cyl', at: [x, h / 2, z], r: 0.012, h, segments: 6, tint: 'chrome' });
const cymbal = (at: number[], r: number) => ({ kind: 'cyl', at, r, h: 0.006, segments: 20, r2: r * 0.9, tint: 'brass' });
export const INSTRUMENTS: DefInput[] = [{
  schema: 'def/1', name: 'core-drum-kit', version: 1,
  description: 'A drum kit with a stool: bass drum, snare, tom, hi-hat and a crash cymbal. A Soul sits and plays the drums; a pianist nearby plays in time with it.',
  tags: ['furniture', 'music', 'instrument', 'percussion'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'cyl', at: [0, 0.3, -0.08], r: 0.28, h: 0.36, segments: 20, tint: 'shell', pitch: Math.PI / 2 },
    { kind: 'cyl', at: [0, 0.3, 0.105], r: 0.26, h: 0.006, segments: 20, tint: 'head', pitch: Math.PI / 2 },
    stand(0.1, 0.18, 0.55), ...drum([0.1, 0.6, 0.18], 0.17, 0.13),
    stand(-0.12, -0.02, 0.62), ...drum([-0.12, 0.68, 0.06], 0.12, 0.14, { pitch: -0.25 }),
    stand(0.32, 0.2, 0.84), cymbal([0.32, 0.84, 0.2], 0.17), cymbal([0.32, 0.81, 0.2], 0.17),
    stand(-0.38, -0.05, 1.05), cymbal([-0.38, 1.06, -0.05], 0.22),
    { kind: 'cyl', at: [0, 0.25, 0.58], r: 0.03, h: 0.5, segments: 8, tint: 'chrome' },
    { kind: 'cyl', at: [0, 0.5, 0.58], r: 0.17, h: 0.06, segments: 14, tint: 'seat' }] } } as unknown as DefInput['make'],
  params: { shell: { type: 'color', default: '#8e2f2a', doc: 'drum shell colour' }, head: { type: 'color', default: '#ece6d6', doc: 'drum head colour' }, chrome: { type: 'color', default: '#a7adb3', doc: 'stand colour' }, brass: { type: 'color', default: '#c9a24a', doc: 'cymbal colour' }, seat: { type: 'color', default: '#242424', doc: 'stool colour' } } as DefInput['params'],
  palette: { shell: '#8e2f2a', head: '#ece6d6', chrome: '#a7adb3', brass: '#c9a24a', seat: '#242424' },
  slots: [{ id: 'stool', kind: 'seat', p: [0, 0.53, 0.58], yaw: Math.PI, height: 0.53, accepts: { tags: ['body'] }, capacity: 1 }],
  components: { instrument: { kind: 'drums' }, seat: { height: 0.53 } } as DefInput['components'],
  size: { box: [1.0, 1.1, 1.0] },
} as unknown as DefInput,
// Entry 36: a microphone on a boom stand. "Sing at the microphone" brings a Soul to the singer's place 0.55 m in front of
// the pole (clear of the base: the place keeps standing room and is never stepped back), facing it; the boom holds the
// mic out to her, where she takes it in her right hand at the clip (the grip is MIC_GRIP, 1.41 m up) and sings along with
// the music playing nearby (the voice is synthesized by the viewer on the score clock). One singer per stand.
{
  schema: 'def/1', name: 'core-mic-stand', version: 1,
  description: 'A microphone on a boom stand. A Soul takes hold of the mic and sings along with the music playing nearby (a piano or drums); one singer at a time.',
  tags: ['furniture', 'music', 'microphone', 'mic-stand'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.004, shapes: [
    { kind: 'cyl', at: [0, 0.012, 0], r: 0.14, h: 0.024, segments: 28, tint: 'base', collide: false },
    { kind: 'cyl', at: [0, 0.035, 0], r: 0.03, h: 0.03, segments: 12, tint: 'base', collide: false },
    { kind: 'cyl', at: [0, 0.54, 0], r: 0.012, h: 1.0, segments: 10, tint: 'stand', collide: false },
    { kind: 'cyl', at: [0, 1.055, 0], r: 0.02, h: 0.05, segments: 12, tint: 'base', collide: false },
    { kind: 'cyl', at: [0, 1.15, 0], r: 0.0085, h: 0.19, segments: 8, tint: 'chrome', collide: false },
    // the boom's swivel, the boom reaching out and up toward the singer, its counterweight behind
    { kind: 'cyl', at: [0, 1.255, 0], r: 0.018, h: 0.04, segments: 12, tint: 'base', pitch: 1.5708, collide: false },
    { kind: 'cyl', at: [0, 1.285, 0.045], r: 0.0075, h: 0.31, segments: 8, tint: 'stand', pitch: 1.064, collide: false },
    { kind: 'cyl', at: [0, 1.205, -0.1], r: 0.022, h: 0.05, segments: 12, tint: 'base', pitch: 1.064, collide: false },
    // the clip at the boom's end, and the mic in it tilted 35 degrees above level: handle, ring, grille
    { kind: 'cyl', at: [0, 1.364, 0.186], r: 0.016, h: 0.03, segments: 10, tint: 'base', pitch: 0.96, collide: false },
    { kind: 'cyl', at: [0, 1.41, 0.252], r: 0.0125, r2: 0.0165, h: 0.16, segments: 14, tint: 'mic', pitch: 0.96, collide: false },
    { kind: 'cyl', at: [0, 1.453, 0.313], r: 0.0215, h: 0.012, segments: 16, tint: 'chrome', pitch: 0.96, collide: false },
    { kind: 'sphere', at: [0, 1.47, 0.338], r: 0.027, tint: 'grille', collide: false }],
    // the body's obstacle is the round base (the boom is overhead, out over the singer's place)
    box: [0.28, 1.52, 0.28] } } as unknown as DefInput['make'],
  params: { base: { type: 'color', default: '#1d1e20', doc: 'base, clutch and clip colour' }, stand: { type: 'color', default: '#2a2c2f', doc: 'pole and boom colour' }, chrome: { type: 'color', default: '#b9bec4', doc: 'inner pole and ring colour' }, mic: { type: 'color', default: '#222326', doc: 'microphone handle colour' }, grille: { type: 'color', default: '#8f969c', doc: 'grille colour' } } as DefInput['params'],
  palette: { base: '#1d1e20', stand: '#2a2c2f', chrome: '#b9bec4', mic: '#222326', grille: '#8f969c' },
  slots: [{ id: 'singer', kind: 'stand', p: [0, 0, 0.55], yaw: Math.PI, accepts: { tags: ['body'] }, capacity: 1 }],
  components: { instrument: { kind: 'mic' } } as DefInput['components'],
  size: { box: [0.28, 1.52, 0.28] },
} as unknown as DefInput];

// #494 / #416: lighter revisions inside the 400-triangle kit budget. Published revisions are immutable (worlds keep their
// geometry), so v1 above keeps its bytes and these are new revisions with v1's tints, slot, seat and components; every
// piece a hand or stick reaches stays where it was (the drum and cymbal tops, MIC_GRIP, the singer's place). Facet counts
// drop to the 7-14 sides the rest of the kit uses at viewing distance, and thin stands and poles become 3-6 sided rods.
// The drum kit also draws the hi-hat's two cymbals closed, as one shape.
const drum2 = (at: number[], r: number, h: number, segments: number, extra: Record<string, unknown> = {}) => [
  { kind: 'cyl', at, r, h, segments, tint: 'shell', ...extra },
  { kind: 'cyl', at: [at[0], at[1] + h / 2 + 0.002, at[2]], r: r * 0.96, h: 0.004, segments, tint: 'head', ...extra }];
const stand2 = (x: number, z: number, h: number) => ({ kind: 'cyl', at: [x, h / 2, z], r: 0.012, h, segments: 3, tint: 'chrome' });
const [drumV1, micV1] = INSTRUMENTS;
INSTRUMENTS.push({
  ...structuredClone(drumV1), version: 2,
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'cyl', at: [0, 0.3, -0.08], r: 0.28, h: 0.36, segments: 11, tint: 'shell', pitch: Math.PI / 2 },
    { kind: 'cyl', at: [0, 0.3, 0.105], r: 0.26, h: 0.006, segments: 11, tint: 'head', pitch: Math.PI / 2 },
    stand2(0.1, 0.18, 0.55), ...drum2([0.1, 0.6, 0.18], 0.17, 0.13, 9),
    stand2(-0.12, -0.02, 0.62), ...drum2([-0.12, 0.68, 0.06], 0.12, 0.14, 9, { pitch: -0.25 }),
    stand2(0.32, 0.2, 0.81), { kind: 'cyl', at: [0.32, 0.825, 0.2], r: 0.17, h: 0.036, segments: 10, r2: 0.153, tint: 'brass' },
    stand2(-0.38, -0.05, 1.05), { kind: 'cyl', at: [-0.38, 1.06, -0.05], r: 0.22, h: 0.006, segments: 10, r2: 0.198, tint: 'brass' },
    { kind: 'cyl', at: [0, 0.25, 0.58], r: 0.03, h: 0.5, segments: 3, tint: 'chrome' },
    { kind: 'cyl', at: [0, 0.5, 0.58], r: 0.17, h: 0.06, segments: 7, tint: 'seat' }] } },
} as unknown as DefInput, {
  ...structuredClone(micV1), version: 2,
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.004, shapes: [
    { kind: 'cyl', at: [0, 0.012, 0], r: 0.14, h: 0.024, segments: 14, tint: 'base', collide: false },
    { kind: 'cyl', at: [0, 0.035, 0], r: 0.03, h: 0.03, segments: 8, tint: 'base', collide: false },
    { kind: 'cyl', at: [0, 0.54, 0], r: 0.012, h: 1.0, segments: 6, tint: 'stand', collide: false },
    { kind: 'cyl', at: [0, 1.055, 0], r: 0.02, h: 0.05, segments: 8, tint: 'base', collide: false },
    { kind: 'cyl', at: [0, 1.15, 0], r: 0.0085, h: 0.19, segments: 6, tint: 'chrome', collide: false },
    { kind: 'cyl', at: [0, 1.255, 0], r: 0.018, h: 0.04, segments: 8, tint: 'base', pitch: 1.5708, collide: false },
    { kind: 'cyl', at: [0, 1.285, 0.045], r: 0.0075, h: 0.31, segments: 6, tint: 'stand', pitch: 1.064, collide: false },
    { kind: 'cyl', at: [0, 1.205, -0.1], r: 0.022, h: 0.05, segments: 8, tint: 'base', pitch: 1.064, collide: false },
    { kind: 'cyl', at: [0, 1.364, 0.186], r: 0.016, h: 0.03, segments: 6, tint: 'base', pitch: 0.96, collide: false },
    { kind: 'cyl', at: [0, 1.41, 0.252], r: 0.0125, r2: 0.0165, h: 0.16, segments: 8, tint: 'mic', pitch: 0.96, collide: false },
    { kind: 'cyl', at: [0, 1.453, 0.313], r: 0.0215, h: 0.012, segments: 8, tint: 'chrome', pitch: 0.96, collide: false },
    { kind: 'sphere', at: [0, 1.47, 0.338], r: 0.027, segments: 7, tint: 'grille', collide: false }],
    box: [0.28, 1.52, 0.28] } },
} as unknown as DefInput);
/** Entry 36: the mic stand's grip (the handle by the clip) and grille, in its local frame (+z toward the singer). */
export const MIC_GRIP = [0, 1.41, 0.252] as const, MIC_GRILLE = [0, 1.47, 0.338] as const, MIC_SINGER_Z = 0.55;
