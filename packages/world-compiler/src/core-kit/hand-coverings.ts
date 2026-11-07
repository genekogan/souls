// Curtains and a roller blind a Soul draws by hand (Soul Actions entry 23): a wall section with a glazed window, the
// covering on the inside (+z) and a pull cord whose tassel is tinted `valve` (where the hand goes). State `open`: the
// curtains drawn back / the blind rolled up. The viewer draws the pleated panels bunching to their outer ends (role
// curtain-l / curtain-r scale in x about the pivot at the rod's end) and the blind rolling to its roller (role blind
// scales in y about the top), easing over 1.1 s from the contact (opening-motion.ts).
import type { DefInput } from '../schemas.ts';

type Shape = Record<string, unknown>;
const W = 2.4, H = 2.6, D = 0.16, OW = 1.4, SILL = 0.9, HEAD = 2.2;   // wall, window opening
const wall = (): Shape[] => [
  { kind: 'box', at: [-(W + OW) / 4, H / 2, 0], size: [(W - OW) / 2, H, D], round: 0.005, tint: 'plaster', collide: true },
  { kind: 'box', at: [(W + OW) / 4, H / 2, 0], size: [(W - OW) / 2, H, D], round: 0.005, tint: 'plaster', collide: true },
  { kind: 'box', at: [0, SILL / 2, 0], size: [OW, SILL, D], round: 0.005, tint: 'plaster', collide: true },
  { kind: 'box', at: [0, (H + HEAD) / 2, 0], size: [OW, H - HEAD, D], round: 0.005, tint: 'plaster' },
  { kind: 'box', at: [0, SILL + 0.015, 0.04], size: [OW + 0.08, 0.03, D + 0.1], round: 0.006, tint: 'frame' },
  { kind: 'box', at: [0, (SILL + HEAD) / 2, 0], size: [0.04, HEAD - SILL, 0.05], round: 0.004, tint: 'frame' },
  { kind: 'box', at: [0, (SILL + HEAD) / 2, 0], size: [OW, 0.04, 0.05], round: 0.004, tint: 'frame' },
  { kind: 'box', at: [0, (SILL + HEAD) / 2, 0], size: [OW, HEAD - SILL, 0.012], round: 0, tint: 'glass', material: 'glass' },
];
// the pull cord hangs from the rod on the right; its tassel at 1.25 m is where the hand goes (at 1.17 m the knees bent a little, visual-02)
const cord = (x: number, top: number): Shape[] => [
  { kind: 'cyl', at: [x, (top + 1.29) / 2, 0.15], r: 0.004, h: top - 1.29, segments: 4, tint: 'cord' },
  { kind: 'cyl', at: [x, 1.25, 0.15], r: 0.018, h: 0.08, segments: 8, r2: 0.012, tint: 'valve' },
];
// a panel of ten folds from the rod's end at x0 past the middle (the panels overlap 5 cm): each fold is turned a little,
// alternately, so the cloth zigzags like hanging fabric; all folds share the end pivot, so drawing the panel back (scale x)
// steepens the zigzag as the cloth bunches
const panel = (role: string, x0: number): Shape[] => Array.from({ length: 10 }, (_, i) => {
  const span = Math.abs(x0) + 0.05, w = span / 10, x = x0 + Math.sign(-x0) * (w / 2 + i * w), turn = (i % 2 ? 1 : -1) * 0.42;
  return { kind: 'box', at: [x, (0.95 + 2.3) / 2, 0.125], size: [w / Math.cos(turn) + 0.004, 2.3 - 0.95, 0.012], round: 0.004, yaw: turn, tint: i % 2 ? 'cloth' : 'cloth2', role, pivot: [x0, 2.3, 0.125] };
});
const palette = { plaster: '#d9d2c3', frame: '#f1ede4', glass: '#a9c7d6', cloth: '#a35f48', cloth2: '#8c4e3b', blind: '#e6dcc6', cord: '#e8e2d2', valve: '#c9b98f', rod: '#5b4a3a' };
const params = Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour${k === 'valve' ? ' (the pull cord tassel; the hand goes here)' : ''}` }]));
const actions = (noun: string) => [
  { name: 'open', label: `Open the ${noun}`, roles: 'anyone', reach: 'touch', params: {}, when: [{ field: 'open', is: false }], then: [{ op: 'set', field: 'open', value: true }] },
  { name: 'close', label: `Close the ${noun}`, roles: 'anyone', reach: 'touch', params: {}, when: [{ field: 'open', is: true }], then: [{ op: 'set', field: 'open', value: false }] },
];
const common = { schema: 'def/1', version: 1, form: 'point', params, palette, state: { open: { type: 'bool', default: true } }, size: { box: [W, H, 0.2] } };

const curtainedWindow = {
  ...common, name: 'core-curtained-window',
  description: 'A wall section (2.4 m) with a glazed window and a pair of curtains on a rod inside. A Soul opens and closes the curtains by hand at the pull cord; closed, they keep the room private and hide its light at night.',
  tags: ['window', 'curtains', 'home', 'hand-operated', 'local-fixture'],
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.005, shapes: [...wall(),
    { kind: 'cyl', at: [0, 2.31, 0.13], r: 0.015, h: 1.9, segments: 8, tint: 'rod', roll: Math.PI / 2 },
    ...panel('curtain-l', -0.95), ...panel('curtain-r', 0.95), ...cord(0.88, 2.3)] } },
  actions: actions('curtains'),
} as unknown as DefInput;

const blindWindow = {
  ...common, name: 'core-blind-window',
  description: 'A wall section (2.4 m) with a glazed window and a roller blind inside. A Soul raises and lowers the blind by hand at the pull cord; lowered, it keeps the room private and hides its light at night.',
  tags: ['window', 'blind', 'home', 'hand-operated', 'local-fixture'],
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.005, shapes: [...wall(),
    { kind: 'cyl', at: [0, HEAD + 0.06, 0.1], r: 0.035, h: OW + 0.06, segments: 10, tint: 'blind', roll: Math.PI / 2 },
    { kind: 'box', at: [0, (SILL + 0.04 + HEAD) / 2, 0.1], size: [OW - 0.02, HEAD - SILL - 0.04, 0.008], round: 0, tint: 'blind', role: 'blind', pivot: [0, HEAD + 0.03, 0.1] },
    { kind: 'box', at: [0, SILL + 0.06, 0.1], size: [OW - 0.02, 0.03, 0.02], round: 0.006, tint: 'rod', role: 'blind', pivot: [0, HEAD + 0.03, 0.1] },
    ...cord(0.75, HEAD + 0.06)] } },
  actions: [{ ...actions('blind')[0], label: 'Open the blind' }, { ...actions('blind')[1], label: 'Close the blind' }],
} as unknown as DefInput;

// #494 / #416: v1 above is immutable (worlds keep its geometry); v2 fits the 400-triangle kit budget. Every shape and
// role is v1's (the twenty curtain folds, the tassel the hand goes to); only the sill's 6 mm rounding becomes the 5 mm
// of the rest of the wall (a sharp box: 12 triangles instead of 44), and the rod and the tassel turn with 6 sides.
const curtainedWindow2 = structuredClone(curtainedWindow) as DefInput & { version: number; make: { args: { shapes: Shape[] } } };
curtainedWindow2.version = 2;
for (const sh of curtainedWindow2.make.args.shapes) {
  if (sh.tint === 'frame' && sh.round === 0.006) sh.round = 0.005;
  if (sh.tint === 'rod' || sh.tint === 'valve') sh.segments = 6;
}

export const HAND_COVERINGS: DefInput[] = [curtainedWindow, blindWindow, curtainedWindow2];
