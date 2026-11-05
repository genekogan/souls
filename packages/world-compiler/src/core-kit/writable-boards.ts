// Boards a Soul writes on and wipes by hand (Soul Actions entry 13). Frozen v1 signage bytes stay intact:
// notice-board@2 is a revision; the standing whiteboard is new. Both share one write/erase contract.
import signage from './signage.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';

/** Board text a Soul may write: short, a few lines, shown on the face and returned only to a reader. */
export const BOARD_TEXT_MAX = 100, BOARD_TEXT_LINES = 3;
const boardActions = (thing: string): NonNullable<DefInput['actions']> => [
  { name: 'write', label: `Write on the ${thing}`, params: { text: { type: 'string', max: BOARD_TEXT_MAX, doc: `up to ${BOARD_TEXT_MAX} characters, at most ${BOARD_TEXT_LINES} lines` } },
    then: [{ op: 'set', field: 'text', value: { param: 'text' } }] },
  { name: 'erase', label: `Wipe the ${thing} clean`, when: [{ field: 'text', not: '' }],
    then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }] },
] as NonNullable<DefInput['actions']>;
const boardState = { text: { type: 'string', max: BOARD_TEXT_MAX, default: '' }, textBy: { type: 'string', max: 40, default: '' } };

const noticeV1 = signage.find(d => d.name === 'core-notice-board')! as unknown as DefInput;
const noticeBoard: DefInput = { ...structuredClone(noticeV1), version: 2, tags: [...(noticeV1.tags ?? []), 'hand-writable'],
  description: 'A roofed notice board on two posts. A Soul can write a short notice on it by hand, or wipe it clean.',
  state: boardState as DefInput['state'], components: { ...structuredClone(noticeV1.components), sign: { lines: [] } }, actions: boardActions('notice board') };

const post = (x: number) => ({ kind: 'extrude', at: [x, 0.012, 0], polygon: [[-0.025, -0.025], [0.025, -0.025], [0.025, 0.025], [-0.025, 0.025]], h: 1.66, tint: 'frame' });
const foot = (x: number) => ({ kind: 'box', at: [x, 0.02, 0], size: [0.06, 0.04, 0.3], round: 0.01, tint: 'frame' });
const whiteboard: DefInput = {
  schema: 'def/1', name: 'core-whiteboard', version: 1,
  description: 'A whiteboard on a wheeled stand. A Soul can write a short note on it by hand, or wipe it clean.',
  tags: ['signage', 'sign-text', 'board', 'whiteboard', 'classroom', 'office', 'hand-writable'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [post(-0.58), post(0.58), foot(-0.58), foot(0.58),
    { kind: 'box', at: [0, 1.2, 0], size: [1.12, 0.74, 0.04], round: 0.01, tint: 'frame' },
    { kind: 'box', at: [0, 1.2, 0.021], size: [1.06, 0.68, 0.006], round: 0, tint: 'board' },
    { kind: 'box', at: [0, 0.85, 0.05], size: [0.9, 0.025, 0.07], round: 0.005, tint: 'frame' }],
    faces: [{ at: [0, 1.2, 0.026], w: 0.98, h: 0.6, bg: '#f6f7f4', ink: '#1d3f8f', font: '600' }] } } as unknown as DefInput['make'],
  params: { frame: { type: 'color', default: '#b9bec4', doc: 'frame colour' }, board: { type: 'color', default: '#f6f7f4', doc: 'board colour' } },
  state: boardState as DefInput['state'],
  components: { readable: { pages: 1 }, sign: { lines: [] } } as DefInput['components'],
  palette: { frame: '#b9bec4', board: '#f6f7f4' },
  size: { box: [1.16, 1.68, 0.3] },
  actions: boardActions('whiteboard'),
} as DefInput;

// Entry 19: a notice board several Souls pin notes on at once. `text` holds one note per line ("words — Name") and
// `textBy` the authors' soul ids in the same order, so the face, the read and the depicted-tick gate see one field.
// The `then` below is the naive form; the hand actuator composes the list (pinPatch in apps/server/src/god/actuators.ts)
// and lets only a note's author take it down.
export const PIN_NOTES_MAX = 6, PIN_TEXT_MAX = 60, PIN_PER_SOUL = 2;
/** Where note i sits on the cork face (face-local metres, x right, y up): three across, two down. Shared by the viewer's
 *  cards and the hand that pins or takes it down. */
export const pinSlot = (i: number): [number, number] => [(i % 3 - 1) * 0.39, i < 3 ? 0.19 : -0.19];
const pinMake = structuredClone(noticeV1.make) as unknown as { args: { shapes: { tint?: string }[]; faces: unknown[] } };
pinMake.args.shapes = pinMake.args.shapes.filter(sh => !/^note/.test(sh.tint ?? ''));   // the printed notes give way to real ones
pinMake.args.faces = [{ at: [0, 1.35, 0.066], w: 1.2, h: 0.8, bg: '#b88a5a', ink: '#2a2622' }];
const pinBoard: DefInput = { ...structuredClone(noticeV1), make: pinMake as unknown as DefInput['make'], version: 3, tags: [...(noticeV1.tags ?? []), 'hand-writable', 'pinboard'],
  description: `A roofed notice board on two posts. Souls pin short notes on it by hand (up to ${PIN_NOTES_MAX}, each signed); only a note's author takes it down.`,
  state: { text: { type: 'string', max: PIN_NOTES_MAX * (PIN_TEXT_MAX + 44), default: '' }, textBy: { type: 'string', max: PIN_NOTES_MAX * 41, default: '' } } as DefInput['state'],
  components: { ...structuredClone(noticeV1.components), sign: { lines: [] } },
  actions: [
    { name: 'pin', label: 'Pin a note on the notice board', params: { text: { type: 'string', max: PIN_TEXT_MAX, doc: `your note: one line, up to ${PIN_TEXT_MAX} characters; it is signed with your name` } },
      then: [{ op: 'set', field: 'text', value: { param: 'text' } }, { op: 'set', field: 'textBy', value: '' }] },
    { name: 'unpin', label: 'Take down your note from the notice board', when: [{ field: 'text', not: '' }],
      then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }] },
  ] as NonNullable<DefInput['actions']> };

// Entry 25: public boards II. A standing chalkboard menu (the whiteboard's write/wipe contract, chalk on slate); a sign-up
// sheet whose lines are the signers' own names (one each, only the signer crosses it off); a poll whose maker sets a question
// and 2-4 options (state `title`, `options` "A|B|C"), one vote per Soul (a new vote moves it), tallied on the face. Like the
// pinboard, `text` is what the face shows and a reader reads; `textBy` holds who wrote each line (sign-up) or each vote (poll:
// "soulId:optionIndex"). The hand goes to the line it writes on (signupSlot / pollSlot, shared with the viewer).
export const SIGNUP_MAX = 8, POLL_OPTIONS_MAX = 4;
/** Where sign-up line i sits on the sheet (face-local metres, x right, y up), under the title. */
export const signupSlot = (i: number): [number, number] => [-0.02, 0.15 - i * 0.047];
/** Where option i's tally sits on the poll board (face-local), to the right of its label. */
export const pollSlot = (i: number): [number, number] => [0.22, 0.13 - i * 0.12];
/** A poll's options from its maker's `options` state ("Soup|Salad|Bread"), at most four. */
export const pollOptions = (state: Record<string, unknown>): string[] => (typeof state.options === 'string' ? state.options.split('|').map(o => o.trim()).filter(Boolean) : []).slice(0, POLL_OPTIONS_MAX);

const chalkV1 = signage.find(d => d.name === 'core-chalkboard')! as unknown as DefInput;
const leg = (z: number, pitch: number) => ({ kind: 'box', at: [0, 0.72, z], size: [0.7, 1.44, 0.035], round: 0.008, tint: 'wood', pitch });
const chalkboard: DefInput = { ...structuredClone(chalkV1), version: 2, tags: [...(chalkV1.tags ?? []), 'hand-writable'],
  description: 'A tall A-frame chalkboard (1.45 m) for a café menu or the day\'s news. A Soul writes on it in chalk by hand, or wipes it clean.',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [leg(0.17, -0.2), leg(-0.17, 0.2),
    { kind: 'box', at: [0, 0.86, 0.19], size: [0.62, 0.92, 0.012], round: 0, tint: 'slate', pitch: -0.2 },
    { kind: 'box', at: [0, 0.38, 0.12], size: [0.66, 0.03, 0.06], round: 0.005, tint: 'wood', pitch: -0.2 }],
    faces: [{ at: [0, 0.88, 0.2], w: 0.56, h: 0.82, pitch: -0.2, bg: '#2b322e', ink: '#f4f2e8', font: '600' }] } } as unknown as DefInput['make'],
  state: boardState as DefInput['state'], components: { ...structuredClone(chalkV1.components), readable: { pages: 1 }, sign: { lines: [] } },
  size: { box: [0.7, 1.45, 0.62] }, actions: boardActions('chalkboard') };

const stand = (h: number, tint = 'frame') => [
  { kind: 'cyl', at: [0, h / 2, -0.02], r: 0.025, h, segments: 8, tint },
  { kind: 'cyl', at: [0, 0.015, -0.02], r: 0.22, h: 0.03, segments: 12, tint }];
const signupSheet: DefInput = {
  schema: 'def/1', name: 'core-signup-sheet', version: 1,
  description: `A sign-up sheet on a clipboard stand, with a title its maker sets (state title). Souls sign it by hand with their own name (one each, up to ${SIGNUP_MAX}); only a signer crosses their name off.`,
  tags: ['signage', 'sign-text', 'board', 'signup', 'hand-writable'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.006, shapes: [...stand(1.12),
    { kind: 'box', at: [0, 1.25, 0], size: [0.38, 0.5, 0.02], round: 0.01, tint: 'board', pitch: -0.35 },
    { kind: 'box', at: [0, 1.48, 0.1], size: [0.12, 0.03, 0.03], round: 0.006, tint: 'frame', pitch: -0.35 }],
    faces: [{ at: [0, 1.25, 0.022], w: 0.33, h: 0.45, pitch: -0.35,   // on the board's own pivot height, 1.2 cm proud (at 1.24/0.014 it sat 0.3 mm behind the tilted front and z-fought)
 bg: '#fbfaf4', ink: '#22303e' }] } } as unknown as DefInput['make'],
  params: { frame: { type: 'color', default: '#3c3f44', doc: 'stand colour' }, board: { type: 'color', default: '#a8794c', doc: 'clipboard colour' } },
  palette: { frame: '#3c3f44', board: '#a8794c' },
  state: { title: { type: 'string', max: 60, default: 'Sign up' }, text: { type: 'string', max: SIGNUP_MAX * 41, default: '' }, textBy: { type: 'string', max: SIGNUP_MAX * 41, default: '' } } as DefInput['state'],
  components: { readable: { pages: 1 }, sign: { lines: [] } } as DefInput['components'],
  size: { box: [0.44, 1.5, 0.44] },
  actions: [
    // the naive `then` names the fields the composed list reads (actuatedState passes only those); the hand actuator composes
    { name: 'sign', label: 'Sign the sign-up sheet with your name', then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }] },
    { name: 'unsign', label: 'Cross your name off the sign-up sheet', when: [{ field: 'text', not: '' }], then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }] },
  ] as NonNullable<DefInput['actions']> } as DefInput;

const pollBoard: DefInput = {
  schema: 'def/1', name: 'core-poll-board', version: 1,
  description: `A poll board on a stand: a question and up to ${POLL_OPTIONS_MAX} options its maker sets (state title, options "A|B|C"). Each Soul votes once by hand, marking a tally beside its choice; a new vote moves it.`,
  tags: ['signage', 'sign-text', 'board', 'poll', 'hand-writable'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [post(-0.52), post(0.52), foot(-0.52), foot(0.52),
    { kind: 'box', at: [0, 1.22, 0], size: [1.0, 0.7, 0.04], round: 0.01, tint: 'frame' },
    { kind: 'box', at: [0, 1.22, 0.021], size: [0.94, 0.64, 0.006], round: 0, tint: 'board' }],
    faces: [{ at: [0, 1.22, 0.026], w: 0.9, h: 0.6, bg: '#f3efe2', ink: '#2a2622' }] } } as unknown as DefInput['make'],
  params: { frame: { type: 'color', default: '#5b6a52', doc: 'frame colour' }, board: { type: 'color', default: '#f3efe2', doc: 'board colour' } },
  palette: { frame: '#5b6a52', board: '#f3efe2' },
  state: { title: { type: 'string', max: 60, default: 'Which one?' }, options: { type: 'string', max: 120, default: 'Yes|No' }, text: { type: 'string', max: 400, default: '' }, textBy: { type: 'string', max: 2000, default: '' } } as DefInput['state'],
  components: { readable: { pages: 1 }, sign: { lines: [] } } as DefInput['components'],
  size: { box: [1.1, 1.62, 0.3] },
  actions: [{ name: 'vote', label: 'Vote on the poll', params: { choice: { type: 'string', max: 40, doc: 'the option you vote for, as written on the board' } }, when: [{ field: 'options', not: '' }, { field: 'title', not: '' }], then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }] }] as NonNullable<DefInput['actions']> } as DefInput;

// Entry 27: noughts and crosses on a standing chalk board, with honest turns. `text` is the grid (9 cells: X, O or .),
// `textBy` the two players' soul ids (X first), `players` their names; the world decides turns, wins and draws.
/** Where square i (0..8, row by row from the top left) sits on the face (face-local metres, x right, y up). */
export const gameSquare = (i: number): [number, number] => [((i % 3) - 1) * 0.17, (1 - Math.floor(i / 3)) * 0.17];
export const GAME_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]] as const;
/** The grid's state: whose turn (X or O), the winner and its line, or a draw. */
export function gameStatus(grid: string): { turn: 'X' | 'O'; winner: 'X' | 'O' | null; line: readonly number[] | null; draw: boolean; moves: number } {
  const g = (grid || '.........').padEnd(9, '.').slice(0, 9), moves = [...g].filter(c => c !== '.').length;
  for (const l of GAME_LINES) { const [a, b, c] = l; if (g[a] !== '.' && g[a] === g[b] && g[a] === g[c]) return { turn: moves % 2 ? 'O' : 'X', winner: g[a] as 'X' | 'O', line: l, draw: false, moves }; }
  return { turn: moves % 2 ? 'O' : 'X', winner: null, line: null, draw: moves === 9, moves };
}
/** The square a Soul names: 1-9, or words (top left, centre, middle right, bottom...). -1 = not a square. */
export function gameSquareOf(v: unknown): number {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/\b(?:the|square|box|corner|one)\b/g, ' ').replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '';
  if (/^[1-9]$/.test(s)) return Number(s) - 1;
  const row = /\btop\b|\bupper\b/.test(s) ? 0 : /\bbottom\b|\blower\b/.test(s) ? 2 : /\b(?:middle|centre|center)\b/.test(s) ? 1 : -1;
  const col = /\bleft\b/.test(s) ? 0 : /\bright\b/.test(s) ? 2 : /\b(?:middle|centre|center)\b/.test(s) || /^(?:top|bottom|upper|lower)$/.test(s) ? 1 : -1;
  if (row < 0 && col >= 0) return 3 + col;   // "left" / "right" alone: the middle row
  return row >= 0 && col >= 0 ? row * 3 + col : -1;
}
const tictactoe: DefInput = {
  schema: 'def/1', name: 'core-tictactoe-board', version: 1,
  description: 'A standing chalk board with a noughts-and-crosses grid. Two Souls play by hand, taking turns (the first to mark plays X); a third waits for the next game. Wiping it starts a new game.',
  tags: ['signage', 'sign-text', 'board', 'game', 'tictactoe', 'hand-writable'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [post(-0.42), post(0.42), foot(-0.42), foot(0.42),
    { kind: 'box', at: [0, 1.25, 0], size: [0.8, 0.7, 0.04], round: 0.01, tint: 'frame' },
    { kind: 'box', at: [0, 1.25, 0.021], size: [0.74, 0.64, 0.006], round: 0, tint: 'board' },
    { kind: 'box', at: [0, 0.88, 0.05], size: [0.6, 0.025, 0.07], round: 0.005, tint: 'frame' }],
    faces: [{ at: [0, 1.25, 0.026], w: 0.7, h: 0.6, bg: '#2b322e', ink: '#f4f2e8' }] } } as unknown as DefInput['make'],
  params: { frame: { type: 'color', default: '#7d5a3a', doc: 'frame colour' }, board: { type: 'color', default: '#2b322e', doc: 'slate colour' } },
  palette: { frame: '#7d5a3a', board: '#2b322e' },
  state: { text: { type: 'string', max: 9, default: '' }, textBy: { type: 'string', max: 82, default: '' }, players: { type: 'string', max: 82, default: '' } } as DefInput['state'],
  components: { readable: { pages: 1 }, sign: { lines: [] } } as DefInput['components'],
  size: { box: [0.9, 1.68, 0.3] },
  actions: [
    { name: 'mark', label: 'Mark a square on the game board', params: { square: { type: 'string', max: 20, doc: 'which square: 1-9 (top left is 1), or words like "top left", "centre", "bottom right"' } },
      then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }, { op: 'set', field: 'players', value: '' }] },
    { name: 'erase', label: 'Wipe the game board for a new game', when: [{ field: 'text', not: '' }],
      then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }, { op: 'set', field: 'players', value: '' }] },
  ] as NonNullable<DefInput['actions']> } as DefInput;

// #439 W093: checkers on the same chalk-board game faculty (entry 27): the hand works the move on the face, the world keeps
// turns, captures, crowning and the win (checkers.ts), the player steps back, a reader reads it and a wipe sets it up
// again. `text` is the board (checkers.ts), `textBy` the two players' soul ids (X first), `players` their names.
const checkers: DefInput = {
  schema: 'def/1', name: 'core-checkers-board', version: 1,
  description: 'A standing chalk board with a checkers board drawn on it, twelve pieces a side. Two Souls play by hand, taking turns (the first to move plays X, from the bottom); jumps capture and a man reaching the far row is crowned. Wiping it sets it up for a new game.',
  tags: ['signage', 'sign-text', 'board', 'game', 'checkers', 'hand-writable'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [post(-0.42), post(0.42), foot(-0.42), foot(0.42),
    { kind: 'box', at: [0, 1.25, 0], size: [0.8, 0.7, 0.04], round: 0.01, tint: 'frame' },
    { kind: 'box', at: [0, 1.25, 0.021], size: [0.74, 0.64, 0.006], round: 0, tint: 'board' },
    { kind: 'box', at: [0, 0.88, 0.05], size: [0.6, 0.025, 0.07], round: 0.005, tint: 'frame' }],
    faces: [{ at: [0, 1.25, 0.026], w: 0.7, h: 0.6, bg: '#2b322e', ink: '#f4f2e8' }] } } as unknown as DefInput['make'],
  params: { frame: { type: 'color', default: '#7d5a3a', doc: 'frame colour' }, board: { type: 'color', default: '#2b322e', doc: 'slate colour' } },
  palette: { frame: '#7d5a3a', board: '#2b322e' },
  state: { text: { type: 'string', max: 35, default: '' }, textBy: { type: 'string', max: 82, default: '' }, players: { type: 'string', max: 82, default: '' } } as DefInput['state'],
  components: { readable: { pages: 1 }, sign: { lines: [] } } as DefInput['components'],
  size: { box: [0.9, 1.68, 0.3] },
  actions: [
    { name: 'move', label: 'Move a piece on the checkers board', params: {
      from: { type: 'string', max: 4, doc: 'the square the piece is on, a1-h8 (a1 is the bottom left, seen from the front), like "c3"' },
      to: { type: 'string', max: 4, doc: 'the square it moves to, like "d4"; two squares on along a diagonal to jump a piece' } },
      then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }, { op: 'set', field: 'players', value: '' }] },
    { name: 'erase', label: 'Wipe the checkers board for a new game', when: [{ field: 'text', not: '' }],
      then: [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }, { op: 'set', field: 'players', value: '' }] },
  ] as NonNullable<DefInput['actions']> } as DefInput;

// Entry 38: a poster wall and a wanted/offered board (the rest of packet 34). Like the boards above, `text` is what a reader
// reads and `textBy` is who wrote each part, here as a small JSON list (posters: slot, title, detail, author, world day; notes:
// column, row, words, author, replies, taker). The hand actuator composes both (apps/server/src/god/actuators.ts).
/** Posters: one row of 4 at natural height (centres 1.36 m), at most 2 per Soul; out of date after 3 world days. */
export const POSTERS_MAX = 4, POSTERS_PER_SOUL = 2, POSTER_TITLE_MAX = 40, POSTER_DETAIL_MAX = 80, POSTER_STALE_DAYS = 3;
/** A poster's size on the wall (metres): a little under A2. */
export const POSTER_W = 0.4, POSTER_H = 0.52;
/** Where poster slot i's centre sits on the wall's face (face-local metres, x right, y up). */
export const posterSlot = (i: number): [number, number] => [(i - 1.5) * 0.6, 0];   // centres 1.36 m: corners 1.62 / 1.10, the palms within easy reach of every rig (take 4)
/** A poster's paper (index into the viewer's papers), chosen by its title and author so every viewer agrees. */
export const posterPaper = (title: string, name: string) => { let h = 2166136261; for (const ch of title + '|' + name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) % 5; };
export type PosterRec = { s: number; t: string; d: string; by: string; n: string; day: number };
export function posterList(state: Record<string, unknown>): PosterRec[] {
  try { const v = typeof state.textBy === 'string' && state.textBy.startsWith('[') ? JSON.parse(state.textBy) : []; return Array.isArray(v) ? v.filter(p => p && typeof p.t === 'string' && Number.isInteger(p.s)) : []; } catch { return []; }
}
/** Wanted/offered: two columns of 3 notes, 2 notes per Soul, replies of up to 40 characters (2 per note), one taker. */
export const WANTED_ROWS = 2, WANTED_TEXT_MAX = 60, WANTED_PER_SOUL = 2, WANTED_REPLY_MAX = 40, WANTED_REPLIES = 2;
/** Where a note sits on the wanted/offered face: column 0 (wanted, left) or 1 (offered, right), rows top to bottom. */
export const wantedSlot = (col: number, row: number): [number, number] => [col ? 0.37 : -0.37, 0.07 - row * 0.24];   // rows at 1.47 and 1.23 m (take 4: a 1.60 m row made one rig lean)
export type WantedRec = { c: 'w' | 'o'; r: number; t: string; by: string; n: string; re: { t: string; by: string; n: string }[]; tk?: { by: string; n: string } };
export function wantedList(state: Record<string, unknown>): WantedRec[] {
  try { const v = typeof state.textBy === 'string' && state.textBy.startsWith('[') ? JSON.parse(state.textBy) : []; return Array.isArray(v) ? v.filter(n => n && (n.c === 'w' || n.c === 'o') && typeof n.t === 'string').map(n => ({ ...n, re: Array.isArray(n.re) ? n.re : [] })) : []; } catch { return []; }
}
const naive = [{ op: 'set', field: 'text', value: '' }, { op: 'set', field: 'textBy', value: '' }];
const posterWall: DefInput = {
  schema: 'def/1', name: 'core-poster-wall', version: 1,
  description: `A freestanding timber poster wall with room for ${POSTERS_MAX} posters in a row at eye height. A Soul puts up a poster by hand (a title and a line or two; at most ${POSTERS_PER_SOUL} each). Its author takes it down at any time; anyone may once it is out of date (${POSTER_STALE_DAYS} world days).`,
  tags: ['signage', 'sign-text', 'board', 'posters', 'hand-writable'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.008, shapes: [
    { kind: 'box', at: [-1.3, 1.1, -0.02], size: [0.1, 2.2, 0.1], round: 0.01, tint: 'post' },
    { kind: 'box', at: [1.3, 1.1, -0.02], size: [0.1, 2.2, 0.1], round: 0.01, tint: 'post' },
    { kind: 'box', at: [-1.3, 0.03, -0.04], size: [0.16, 0.06, 0.34], round: 0.01, tint: 'post' },
    { kind: 'box', at: [1.3, 0.03, -0.04], size: [0.16, 0.06, 0.34], round: 0.01, tint: 'post' },
    { kind: 'box', at: [0, 1.36, -0.005], size: [2.5, 1.56, 0.035], round: 0, tint: 'board' },
    { kind: 'box', at: [0, 0.56, 0.0], size: [2.56, 0.07, 0.06], round: 0.006, tint: 'post' },
    { kind: 'box', at: [0, 2.17, 0.0], size: [2.78, 0.06, 0.18], round: 0.006, tint: 'roof', pitch: 0.18 }],
    faces: [{ at: [0, 1.36, 0.0135], w: 2.46, h: 1.52, bg: '#4c6a58', ink: '#1f2622' }] } } as unknown as DefInput['make'],
  params: { post: { type: 'color', default: '#4a3b2c', doc: 'post colour' }, board: { type: 'color', default: '#4c6a58', doc: 'board colour' }, roof: { type: 'color', default: '#3b3530', doc: 'cap colour' } },
  palette: { post: '#4a3b2c', board: '#4c6a58', roof: '#3b3530' },
  state: { text: { type: 'string', max: 800, default: '' }, textBy: { type: 'string', max: 1600, default: '' } } as DefInput['state'],
  components: { readable: { pages: 1 }, sign: { lines: [] } } as DefInput['components'],
  size: { box: [2.8, 2.25, 0.42] },
  actions: [
    // the naive `then` names the fields the composed list reads (actuatedState passes only those); the hand actuator composes
    { name: 'pin', label: 'Put up a poster on the poster wall', params: { title: { type: 'string', max: POSTER_TITLE_MAX, doc: `the poster's title, large: one line, up to ${POSTER_TITLE_MAX} characters` }, detail: { type: 'string', max: POSTER_DETAIL_MAX, doc: `a line or two of detail (when, where), up to ${POSTER_DETAIL_MAX} characters; optional`, default: '' } }, then: naive },
    { name: 'unpin', label: 'Take down a poster from the poster wall', params: { which: { type: 'string', max: POSTER_TITLE_MAX, doc: 'words of its title; optional (your latest, else the oldest out-of-date one)', default: '' } }, when: [{ field: 'text', not: '' }], then: naive },
  ] as NonNullable<DefInput['actions']> } as DefInput;
const wantedBoard: DefInput = {
  schema: 'def/1', name: 'core-wanted-board', version: 1,
  description: `A roofed cork board in two labelled columns, WANTED and OFFERED (${WANTED_ROWS} notes each). A Soul pins a signed "Wanted: …" or "Offered: …" note by hand (at most ${WANTED_PER_SOUL} each); others reply on it or take it on ("I'll do it"); only its author takes it down.`,
  tags: ['signage', 'sign-text', 'board', 'wanted', 'hand-writable'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'extrude', at: [-0.82, 0.012, 0], polygon: [[-0.04, -0.04], [0.04, -0.04], [0.04, 0.04], [-0.04, 0.04]], h: 1.88, tint: 'post' },
    { kind: 'extrude', at: [0.82, 0.012, 0], polygon: [[-0.04, -0.04], [0.04, -0.04], [0.04, 0.04], [-0.04, 0.04]], h: 1.88, tint: 'post' },
    { kind: 'box', at: [0, 1.4, 0.02], size: [1.6, 0.78, 0.04], round: 0.01, tint: 'frame' },
    { kind: 'box', at: [0, 1.86, 0.0], size: [1.84, 0.06, 0.24], round: 0, tint: 'roof', pitch: 0.25 }],
    faces: [{ at: [0, 1.4, 0.042], w: 1.5, h: 0.7, bg: '#b88a5a', ink: '#2a2622' }] } } as unknown as DefInput['make'],
  params: { post: { type: 'color', default: '#5e4630', doc: 'post colour' }, frame: { type: 'color', default: '#8b6a48', doc: 'frame colour' }, roof: { type: 'color', default: '#5a4a3a', doc: 'roof colour' } },
  palette: { post: '#5e4630', frame: '#8b6a48', roof: '#5a4a3a' },
  state: { text: { type: 'string', max: 1600, default: '' }, textBy: { type: 'string', max: 2000, default: '' } } as DefInput['state'],
  components: { readable: { pages: 1 }, sign: { lines: [] } } as DefInput['components'],
  size: { box: [1.84, 2.1, 0.42] },
  actions: [
    { name: 'pin', label: 'Pin a wanted or offered note on the wanted/offered board', params: { text: { type: 'string', max: WANTED_TEXT_MAX, doc: `your note, starting "Wanted:" or "Offered:"; one line, up to ${WANTED_TEXT_MAX} characters; it is signed with your name` }, column: { type: 'string', max: 10, doc: 'wanted or offered; optional when the note starts with it', default: '' } }, then: naive },
    { name: 'unpin', label: 'Take down your note from the wanted/offered board', params: { note: { type: 'string', max: 40, doc: 'words of your note; optional (your latest)', default: '' } }, when: [{ field: 'text', not: '' }], then: naive },
    { name: 'reply', label: 'Write a short reply on a note on the wanted/offered board', params: { note: { type: 'string', max: 40, doc: 'words of the note, or its author\'s name' }, text: { type: 'string', max: WANTED_REPLY_MAX, doc: `your reply, up to ${WANTED_REPLY_MAX} characters; signed with your name` } }, when: [{ field: 'text', not: '' }], then: naive },
    { name: 'take-on', label: 'Take on a note on the wanted/offered board ("I\'ll do it")', params: { note: { type: 'string', max: 40, doc: 'words of the note, or its author\'s name' } }, when: [{ field: 'text', not: '' }], then: naive },
  ] as NonNullable<DefInput['actions']> } as DefInput;

export const WRITABLE_BOARDS: DefInput[] = [whiteboard, noticeBoard, pinBoard, chalkboard, signupSheet, pollBoard, tictactoe, posterWall, wantedBoard, checkers];
