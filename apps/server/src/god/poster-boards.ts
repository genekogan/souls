// Soul Actions entry 38: a poster wall and a wanted/offered board, the rest of packet 34. Both are "list" boards (entry 25's
// frame): several Souls own parts of one board, the hand writes or places at the part it changes, and the board changes at the
// depicted end of the stroke. State: `text` is what a reader reads, `textBy` the parts as a small JSON list.
import { POSTERS_MAX, POSTERS_PER_SOUL, POSTER_TITLE_MAX, POSTER_DETAIL_MAX, POSTER_STALE_DAYS, posterList, WANTED_ROWS, WANTED_TEXT_MAX, WANTED_PER_SOUL, WANTED_REPLY_MAX, WANTED_REPLIES, wantedList, type PosterRec, type WantedRec, type StoredDef } from '@souls/world-compiler';
import type { EdgeSoul } from '../edge/contract.ts';

type Refusal = { code: string; reason: string };
/** The world day now (whole days since the world clock's origin); set by the engine bridge. No clock: day 0. */
let dayNow: () => number = () => 0;
export function setWorldDaySource(fn: () => number) { dayNow = fn; }
export const worldDay = () => { try { const d = dayNow(); return Number.isFinite(d) ? Math.floor(d) : 0; } catch { return 0; } };

export const isPosterAction = (def: StoredDef, a: { name: string }) => !!def.tags?.includes('posters') && (a.name === 'pin' || a.name === 'unpin');
export const isWantedAction = (def: StoredDef, a: { name: string }) => !!def.tags?.includes('wanted') && ['pin', 'unpin', 'reply', 'take-on'].includes(a.name);
export const posterName = (soul: EdgeSoul) => (soul.name || 'a Soul').replace(/[\n—|"]/g, ' ').trim().slice(0, 40);
const line = (v: unknown) => typeof v === 'string' ? v.trim() : '';
function textProblem(v: unknown, what: string, max: number, lines = 1): Refusal | null {
  const t = line(v);
  if (!t) return { code: 'capability.params', reason: `Say what to write: ${what} is required.` };
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(t)) return { code: 'capability.params', reason: 'It cannot contain control characters.' };
  if (t.length > max) return { code: 'capability.params', reason: `That is too long: at most ${max} characters for the ${what} (yours is ${t.length}).` };
  if (t.split('\n').length > lines) return { code: 'capability.params', reason: lines === 1 ? `The ${what} is one line.` : `At most ${lines} lines of ${what}.` };
  return null;
}
const STOP = new Set(['the', 'a', 'an', 'note', 'notes', 'poster', 'posters', 'my', 'about', 'for', 'on', 'wanted', 'offered', 'one', 'of', 'to', 's']);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w));
/** Every word of `query` appears in `hay` (a word, or the start of one: "chair" finds "chairs"). */
const matches = (query: string, hay: string) => { const q = words(query), h = words(hay); return q.length > 0 && q.every(w => h.some(x => x === w || (w.length >= 3 && x.startsWith(w)) || (x.length >= 3 && w.startsWith(x)))); };

// ---- posters ----
export const posterStale = (p: PosterRec, today = worldDay()) => today - p.day >= POSTER_STALE_DAYS;
export const posterAge = (p: PosterRec, today = worldDay()) => Math.max(0, today - p.day);
export function posterText(list: PosterRec[]) { return [...list].sort((a, b) => a.s - b.s).map(p => `${p.t}${p.d ? ' — ' + p.d.replace(/\s*\n\s*/g, ' / ') : ''} (${p.n})`).join('\n'); }
/** The poster a take-down means: the named one, else this Soul's latest, else the oldest out-of-date one. */
export function posterTarget(state: Record<string, unknown>, soul: EdgeSoul, which?: unknown): PosterRec | null {
  const list = posterList(state), w = line(which);
  if (w) return list.find(p => matches(w, p.t)) ?? list.find(p => matches(w, `${p.t} ${p.d} ${p.n}`)) ?? null;
  const mine = list.filter(p => p.by === soul.soulId); if (mine.length) return mine.reduce((a, b) => (b.day > a.day || (b.day === a.day && list.indexOf(b) > list.indexOf(a)) ? b : a));
  const stale = list.filter(p => posterStale(p)); return stale.length ? stale.reduce((a, b) => (b.day < a.day ? b : a)) : null;
}
export const posterFreeSlot = (list: PosterRec[]) => { for (let i = 0; i < POSTERS_MAX; i++) if (!list.some(p => p.s === i)) return i; return -1; };
export function posterProblem(a: { name: string }, state: Record<string, unknown>, soul: EdgeSoul, params?: Record<string, unknown>): Refusal | null {
  const list = posterList(state);
  if (a.name === 'pin') {
    if (list.length >= POSTERS_MAX) { const stale = list.filter(p => posterStale(p)); return { code: 'object.state', reason: `The poster wall is full (${POSTERS_MAX} posters).${stale.length ? ` "${stale[0].t}" is out of date, so anyone may take it down first.` : ' A poster comes down when its author takes it down, or anyone may once it is out of date.'}` }; }
    if (list.filter(p => p.by === soul.soulId).length >= POSTERS_PER_SOUL) return { code: 'object.state', reason: `You already have ${POSTERS_PER_SOUL} posters on this wall; take one down first.` };
    if (params === undefined) return null;
    return textProblem(params.title, 'title', POSTER_TITLE_MAX) ?? (line(params.detail) ? textProblem(params.detail, 'detail', POSTER_DETAIL_MAX, 2) : null);
  }
  if (params === undefined) return list.some(p => p.by === soul.soulId || posterStale(p)) ? null : { code: 'object.not-yours', reason: `None of these posters is yours and none is out of date; only its author takes a poster down until ${POSTER_STALE_DAYS} world days after it went up.` };
  const p = posterTarget(state, soul, params.which);
  if (!p) return { code: 'capability.params', reason: line(params.which) ? `No poster on this wall matches "${line(params.which)}".` : `You have no poster here and none is out of date; only its author takes a poster down until it is out of date.` };
  if (p.by !== soul.soulId && !posterStale(p)) return { code: 'object.not-yours', reason: `Only ${p.n} takes "${p.t}" down until it is out of date (${POSTER_STALE_DAYS} world days after it went up; it has been up ${posterAge(p)}).` };
  return null;
}
export function posterPatch(a: { name: string }, state: Record<string, unknown>, soul: EdgeSoul, params: Record<string, unknown>): Record<string, unknown> {
  let list = posterList(state);
  if (a.name === 'pin') { const s = posterFreeSlot(list); if (s >= 0) list.push({ s, t: line(params.title), d: line(params.detail), by: soul.soulId, n: posterName(soul), day: worldDay() }); }
  else { const p = posterTarget(state, soul, params.which); if (p) list = list.filter(x => x !== p && !(x.s === p.s && x.by === p.by && x.t === p.t)); }
  return { text: posterText(list), textBy: list.length ? JSON.stringify(list) : '' };
}

// ---- wanted / offered ----
export function wantedColumn(params: Record<string, unknown>): 'w' | 'o' | null {
  const c = line(params.column).toLowerCase(), t = line(params.text).toLowerCase();
  if (/^want/.test(c)) return 'w'; if (/^offer/.test(c)) return 'o';
  if (/^(?:wanted|want|looking for|needed|need|seeking|wtb)\b/.test(t)) return 'w';
  if (/^(?:offered|offering|offer|free|for free|giving away|available|can lend)\b/.test(t)) return 'o';
  return null;
}
export const wantedFreeRow = (list: WantedRec[], c: 'w' | 'o') => { for (let r = 0; r < WANTED_ROWS; r++) if (!list.some(n => n.c === c && n.r === r)) return r; return -1; };
export function wantedText(list: WantedRec[]) {
  return [...list].sort((a, b) => (a.c === b.c ? a.r - b.r : a.c === 'w' ? -1 : 1)).map(n => `${n.c === 'w' ? 'Wanted' : 'Offered'}: ${n.t.replace(/^(?:wanted|offered)\s*[:\-–—]?\s*/i, '')} — ${n.n}${n.re.map(r => ` / reply: ${r.t} — ${r.n}`).join('')}${n.tk ? ` / taken by ${n.tk.n}` : ''}`).join('\n');
}
/** The note a reply, take-on or take-down means. `own`: only this Soul's notes (take down), `others`: not its own (take on). */
export function wantedTarget(state: Record<string, unknown>, soul: EdgeSoul, note: unknown, mode: 'own' | 'others' | 'any'): WantedRec | null {
  const all = wantedList(state), q = line(note);
  const pool = mode === 'own' ? all.filter(n => n.by === soul.soulId) : mode === 'others' ? all.filter(n => n.by !== soul.soulId) : all;
  if (q) return pool.find(n => matches(q, n.t)) ?? pool.find(n => matches(q, `${n.n} ${n.c === 'w' ? 'wanted' : 'offered'}`)) ?? pool.find(n => matches(q, `${n.t} ${n.n}`)) ?? null;
  if (mode === 'own') return pool.at(-1) ?? null;
  return pool.length === 1 ? pool[0] : null;
}
export function wantedProblem(a: { name: string }, state: Record<string, unknown>, soul: EdgeSoul, params?: Record<string, unknown>): Refusal | null {
  const list = wantedList(state), mine = list.filter(n => n.by === soul.soulId);
  if (a.name === 'pin') {
    if (mine.length >= WANTED_PER_SOUL) return { code: 'object.state', reason: `You already have ${WANTED_PER_SOUL} notes on this board; take one down first.` };
    if (list.length >= WANTED_ROWS * 2) return { code: 'object.state', reason: 'The board is full; a note comes down only when its author takes it down.' };
    if (params === undefined) return null;
    const bad = textProblem(params.text, 'note', WANTED_TEXT_MAX); if (bad) return bad;
    const c = wantedColumn(params); if (!c) return { code: 'capability.params', reason: 'Start the note with "Wanted:" or "Offered:" (or say which column), so it goes in the right column.' };
    if (wantedFreeRow(list, c) < 0) return { code: 'object.state', reason: `The ${c === 'w' ? 'WANTED' : 'OFFERED'} column is full (${WANTED_ROWS} notes); a note comes down only when its author takes it down.` };
    return null;
  }
  if (a.name === 'unpin') {
    if (!mine.length) return { code: 'object.not-yours', reason: 'You have no note on this board; only its author takes a note down.' };
    if (params === undefined || !line(params.note)) return null;
    if (wantedTarget(state, soul, params.note, 'own')) return null;
    return wantedTarget(state, soul, params.note, 'any') ? { code: 'object.not-yours', reason: 'That note is not yours; only its author takes a note down.' } : { code: 'capability.params', reason: `None of your notes matches "${line(params.note)}".` };
  }
  const others = list.filter(n => n.by !== soul.soulId);
  if (a.name === 'take-on' && !others.some(n => !n.tk)) return { code: 'object.state', reason: others.length ? 'Every other note here is already taken.' : 'There is no note here but your own.' };
  if (a.name === 'reply' && !list.length) return { code: 'object.state', reason: 'There is no note to reply to.' };
  if (params === undefined) return null;
  const n = wantedTarget(state, soul, params.note, a.name === 'take-on' ? 'any' : 'any');
  if (!n) return { code: 'capability.params', reason: line(params.note) ? `No note here matches "${line(params.note)}".` : 'Say which note: words of it, or its author\'s name.' };
  if (a.name === 'take-on') {
    if (n.by === soul.soulId) return { code: 'object.state', reason: 'That is your own note.' };
    if (n.tk) return { code: 'object.state', reason: `${n.tk.by === soul.soulId ? 'You have' : n.tk.n + ' has'} already taken that note on.` };
    return null;
  }
  const bad = textProblem(params.text, 'reply', WANTED_REPLY_MAX); if (bad) return bad;
  if (n.re.some(r => r.by === soul.soulId)) return { code: 'object.state', reason: 'You already replied on that note.' };
  if (n.re.length >= WANTED_REPLIES) return { code: 'object.state', reason: `That note has no room for another reply (${WANTED_REPLIES} already).` };
  return null;
}
export function wantedPatch(a: { name: string }, state: Record<string, unknown>, soul: EdgeSoul, params: Record<string, unknown>): Record<string, unknown> {
  let list = wantedList(state);
  if (a.name === 'pin') { const c = wantedColumn(params), r = c ? wantedFreeRow(list, c) : -1; if (c && r >= 0) list.push({ c, r, t: line(params.text), by: soul.soulId, n: posterName(soul), re: [] }); }
  else {
    const n = wantedTarget(state, soul, params.note, a.name === 'unpin' ? 'own' : 'any'), i = n ? list.findIndex(x => x.c === n.c && x.r === n.r) : -1;
    if (i >= 0) {
      if (a.name === 'unpin') list.splice(i, 1);
      else if (a.name === 'reply') list[i] = { ...list[i], re: [...list[i].re, { t: line(params.text), by: soul.soulId, n: posterName(soul) }] };
      else list[i] = { ...list[i], tk: { by: soul.soulId, n: posterName(soul) } };
    }
  }
  return { text: wantedText(list), textBy: list.length ? JSON.stringify(list) : '' };
}
