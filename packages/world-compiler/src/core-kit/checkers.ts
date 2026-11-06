// #439 W093: checkers (English draughts) on the chalk-board game faculty. Pure rules, shared by the server (turns, moves,
// reads) and the viewer (the face). The board's `text` is its 32 dark squares row by row from the top (rank 8 first, left
// to right; x / o a man, X / O a king, . empty), then whose turn it is (X or O), then the square of a piece that must jump
// on (two digits) while a multi-jump is under way. An empty `text` is a board set up for a new game, X to move.
// Squares are named a1-h8 with a1 at the bottom left as seen from the front; X starts on ranks 1-3 and moves up.

/** A board just set up: O on ranks 8-6, X on ranks 3-1. */
export const CHECKERS_START = 'o'.repeat(12) + '.'.repeat(8) + 'x'.repeat(12);
/** One square's side on the board's face (metres): 8 squares fill 0.53 m of the slate. */
export const CHECKERS_CELL = 0.066;
export type CheckersSide = 'X' | 'O';
export type CheckersBoard = { cells: string; turn: CheckersSide; chain: number; fresh: boolean };
export type CheckersMove = { from: number; to: number; over: number };

const fileRankOf = (i: number): [number, number] => { const rank = 8 - Math.floor(i / 4), k = i % 4; return [rank % 2 === 1 ? 2 * k : 2 * k + 1, rank]; };
const indexOf = (file: number, rank: number) => file < 0 || file > 7 || rank < 1 || rank > 8 || (file + rank) % 2 !== 1 ? -1 : (8 - rank) * 4 + Math.floor(file / 2);
/** The square's name, a1-h8. */
export const checkersName = (i: number) => { const [f, r] = fileRankOf(i); return String.fromCharCode(97 + f) + r; };
/** Where dark square i sits on the face (face-local metres, x right, y up). */
export const checkersSquare = (i: number): [number, number] => { const [f, r] = fileRankOf(i); return [(f - 3.5) * CHECKERS_CELL, (r - 4.5) * CHECKERS_CELL]; };
/** A named square: its index (0..31), -1 = not a square of the board, -2 = a light square. */
export function checkersCellOf(v: unknown): number {
  const m = /^\s*([a-h])\s*([1-8])\s*$/i.exec(typeof v === 'string' ? v : ''); if (!m) return -1;
  const f = m[1]!.toLowerCase().charCodeAt(0) - 97, r = Number(m[2]);
  return indexOf(f, r) < 0 ? -2 : indexOf(f, r);
}
export function checkersBoard(text: unknown): CheckersBoard {
  const t = typeof text === 'string' ? text : '';
  if (!/^[xXoO.]{32}[XO](?:[0-3]\d)?$/.test(t)) return { cells: CHECKERS_START, turn: 'X', chain: -1, fresh: true };
  return { cells: t.slice(0, 32), turn: t[32] as CheckersSide, chain: t.length > 33 ? Number(t.slice(33)) : -1, fresh: false };
}
export const checkersText = (b: CheckersBoard) => b.cells + b.turn + (b.chain >= 0 ? String(b.chain).padStart(2, '0') : '');
const sideOf = (c: string): CheckersSide | null => c === 'x' || c === 'X' ? 'X' : c === 'o' || c === 'O' ? 'O' : null;
const isKing = (c: string) => c === 'X' || c === 'O';
/** The plain steps and the jumps the piece on square i can make (no compulsory-capture filter). */
function pieceMoves(cells: string, i: number): { steps: CheckersMove[]; jumps: CheckersMove[] } {
  const c = cells[i]!, side = sideOf(c), steps: CheckersMove[] = [], jumps: CheckersMove[] = []; if (!side) return { steps, jumps };
  const [f, r] = fileRankOf(i), dirs = isKing(c) ? [1, -1] : [side === 'X' ? 1 : -1];
  for (const dr of dirs) for (const df of [-1, 1]) {
    const one = indexOf(f + df, r + dr); if (one < 0) continue;
    if (cells[one] === '.') { steps.push({ from: i, to: one, over: -1 }); continue; }
    const two = indexOf(f + 2 * df, r + 2 * dr);
    if (two >= 0 && cells[two] === '.' && sideOf(cells[one]!) && sideOf(cells[one]!) !== side) jumps.push({ from: i, to: two, over: one });
  }
  return { steps, jumps };
}
/** Every legal move for the side to move: only jumps when one is open, only the jumping piece's jumps mid-chain. */
export function checkersMoves(b: CheckersBoard): CheckersMove[] {
  if (b.chain >= 0) return pieceMoves(b.cells, b.chain).jumps;
  const steps: CheckersMove[] = [], jumps: CheckersMove[] = [];
  for (let i = 0; i < 32; i++) if (sideOf(b.cells[i]!) === b.turn) { const m = pieceMoves(b.cells, i); steps.push(...m.steps); jumps.push(...m.jumps); }
  return jumps.length ? jumps : steps;
}
export type CheckersStatus = { turn: CheckersSide; winner: CheckersSide | null; men: Record<CheckersSide, number>; kings: Record<CheckersSide, number>; fresh: boolean; chain: number };
export function checkersStatus(text: unknown): CheckersStatus {
  const b = checkersBoard(text), men = { X: 0, O: 0 }, kings = { X: 0, O: 0 };
  for (const c of b.cells) { const s = sideOf(c); if (s) (isKing(c) ? kings : men)[s]++; }
  const winner = b.fresh ? null : checkersMoves(b).length ? null : b.turn === 'X' ? 'O' : 'X';
  return { turn: b.turn, winner, men, kings, fresh: b.fresh, chain: b.chain };
}
const named = (m: CheckersMove) => `${checkersName(m.from)} to ${checkersName(m.to)}`;
/** Why this move is not legal now (null = it is). The side to move is assumed to be the mover. */
export function checkersMoveProblem(text: unknown, from: unknown, to: unknown): { code: string; reason: string } | null {
  const b = checkersBoard(text), legal = checkersMoves(b), a = checkersCellOf(from), z = checkersCellOf(to);
  const ask = 'Say the move as two squares, like "c3 to d4" (a1 is the bottom left).';
  if (typeof from !== 'string' || typeof to !== 'string' || !from.trim() || !to.trim()) return { code: 'capability.params', reason: ask };
  for (const [v, i] of [[from, a], [to, z]] as const) {
    if (i === -1) return { code: 'capability.params', reason: `"${v.trim()}" is not a square of the board (a1 to h8). ${ask}` };
    if (i === -2) return { code: 'object.state', reason: `${v.trim().toLowerCase()} is a light square; the pieces stand on the dark squares only.` };
  }
  const piece = b.cells[a]!, side = sideOf(piece), fn = checkersName(a), tn = checkersName(z);
  if (a === z) return { code: 'capability.params', reason: `${fn} to ${tn} does not move the piece: name the square it moves to.` };
  if (!side) return { code: 'object.state', reason: `There is no piece on ${fn}.` };
  if (side !== b.turn) return { code: 'object.state', reason: `The piece on ${fn} is ${side}'s; you play ${b.turn}.` };
  if (b.chain >= 0 && a !== b.chain) return { code: 'object.state', reason: `The piece on ${checkersName(b.chain)} is jumping and must jump again: ${legal.map(named).join(' or ')}.` };
  const hit = legal.find(m => m.from === a && m.to === z); if (hit) return null;
  if (b.cells[z] !== '.') return { code: 'object.state', reason: `${tn} is taken.` };
  const [f0, r0] = fileRankOf(a), [f1, r1] = fileRankOf(z), df = Math.abs(f1 - f0), dr = r1 - r0;
  if (df !== Math.abs(dr) || df > 2) return { code: 'object.state', reason: 'A piece moves diagonally: one square, or two to jump over a piece.' };
  if (!isKing(piece) && (side === 'X' ? dr < 0 : dr > 0)) return { code: 'object.state', reason: `A man moves forward only (toward rank ${side === 'X' ? 8 : 1}); it moves back once it is crowned.` };
  const jumps = legal.filter(m => m.over >= 0);
  if (df === 2) { const over = indexOf((f0 + f1) / 2, (r0 + r1) / 2); if (!sideOf(b.cells[over]!) || sideOf(b.cells[over]!) === side) return { code: 'object.state', reason: `There is no ${side === 'X' ? 'O' : 'X'} piece on ${checkersName(over)} to jump.` }; }
  if (jumps.length) return { code: 'object.state', reason: `A jump is open, so it must be taken: ${jumps.map(named).join(' or ')}.` };
  return { code: 'object.state', reason: `${fn} to ${tn} is not a legal move.` };
}
/** The board after a legal move: the jumped piece taken, a man on the far row crowned (which ends the turn), the turn
 *  kept while the same piece can jump again. */
export function checkersPlay(text: unknown, from: unknown, to: unknown): { text: string; captured: string | null; crowned: boolean; again: boolean } {
  const b = checkersBoard(text), a = checkersCellOf(from), z = checkersCellOf(to), m = checkersMoves(b).find(x => x.from === a && x.to === z);
  if (!m) return { text: checkersText(b), captured: null, crowned: false, again: false };
  const cells = [...b.cells], piece = cells[a]!, rank = fileRankOf(z)[1];
  cells[z] = piece; cells[a] = '.'; if (m.over >= 0) cells[m.over] = '.';
  const crowned = !isKing(piece) && (piece === 'x' ? rank === 8 : rank === 1); if (crowned) cells[z] = piece.toUpperCase();
  const after = cells.join(''), again = m.over >= 0 && !crowned && pieceMoves(after, z).jumps.length > 0;
  const next: CheckersBoard = { cells: after, turn: again ? b.turn : b.turn === 'X' ? 'O' : 'X', chain: again ? z : -1, fresh: false };
  return { text: checkersText(next), captured: m.over >= 0 ? checkersName(m.over) : null, crowned, again };
}
/** The board as eight rows from rank 8 down, for a reader: x o men, X O kings, · an empty dark square, a space a light one. */
export function checkersRows(text: unknown): string[] {
  const b = checkersBoard(text), rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) { let row = `${rank} `; for (let f = 0; f < 8; f++) { const i = indexOf(f, rank); row += (i < 0 ? ' ' : b.cells[i] === '.' ? '·' : b.cells[i]) + (f < 7 ? ' ' : ''); } rows.push(row); }
  rows.push('  a b c d e f g h'); return rows;
}
