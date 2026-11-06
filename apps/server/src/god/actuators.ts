// VOCAB-MECH: def actuators as Soul actions. A def's declarative `actions` (vocab ACTUATORS: switch-on/off, open/close,
// lock/unlock, fill/empty, light/put-out, play/stop — or any def/1 action with `when` and `then` on its own state) become
// actions of the god thing's `built` object (perceive.ts), so a Soul near a lamp is offered
// `object:<entity>:switch-off`, walks up to it, reaches out, and the lamp's state changes in the world (an engine edit:
// in the ledger, broadcast to viewers, never the god's to undo). Nothing in the edge changes: the object framework's own
// capabilities, admission, receipts and body plans carry it.
import { PIN_NOTES_MAX, PIN_PER_SOUL, PIN_TEXT_MAX, SIGNUP_MAX, gameSquareOf, gameStatus, pollOptions, containerInside, containerOpen, type Entity, type StoredDef, type WorldModel } from '@sim/world-compiler';
import type { EdgeSoul } from '../edge/contract.ts';
import { isContactActuator, CONTACT_REACH } from './contact-actuator.ts';
import { isPosterAction, isWantedAction, posterProblem, posterPatch, wantedProblem, wantedPatch } from './poster-boards.ts';
import { afterCommit } from '../edge/comms/store.ts';
import { SOURCE_NEAR_VESSEL, asPlant, asTank, drawWater, isWaterAction, waterActions, waterFields, waterPlant, waterRole, type Transfer } from './water.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
type Action = StoredDef['actions'][number];
type Refusal = { code: string; reason: string };

/** Souls act on things within this distance of their body (they walk the rest of the way as part of the act). */
export const ACT_SIGHT = 30;
/** Close enough to reach out and touch it without walking. */
export const ACT_REACH = 1.6;

/** W5 (water.ts): a def's own actions plus those its water role gives it (draw-water at a tank, water a planter). */
export const actionsOf = (def: StoredDef): Action[] => { const w = waterActions(def); return w.length ? [...def.actions, ...w] : def.actions; };

/** The fields of an entity's state the def's actions read or write, with defaults filled (public: Souls see them). */
/** Soul Actions entry 42: a thing kept inside a container that is shut (a bowl in a closed drawer): nobody sees it, walks to
 *  it or names it until the container is opened. */
export function keptShut(m: Pick<WorldModel, 'entities' | 'resolvedDef'>, e: Entity): boolean {
  if (e.in.parent === 'world' || !e.in.slot) return false;
  const p = m.entities.get(e.in.parent), pd = p && m.resolvedDef(p.def), ins = containerInside(pd);
  return !!ins && ins.slots.some((s) => s.id === e.in.slot) && !containerOpen(pd!, actuatedState(p!, pd!));
}
/** #435 (W071): who left each thing in a container whose def declares `leftBy` (a swap shelf): "itemId=soulId" pairs. */
export const leftByOf = (state: Record<string, unknown> | undefined): Map<string, string> =>
  new Map(String(state?.leftBy ?? '').split(',').filter((p) => p.includes('=')).map((p) => p.split('=', 2) as [string, string]));
export const keepsLeftBy = (def: StoredDef | undefined): boolean => !!def?.state && Object.hasOwn(def.state, 'leftBy');
export function actuatedState(e: Entity, def: StoredDef): Record<string, unknown> {
  const fields = new Set<string>(waterFields(def));
  for (const a of actionsOf(def)) { for (const w of a.when) fields.add(w.field); for (const t of a.then) if ('field' in t) fields.add(t.field); }
  const out: Record<string, unknown> = {};
  for (const f of fields) { const v = e.state?.[f] ?? (def.state as Record<string, { default?: unknown }>)[f]?.default; if (v !== undefined) out[f] = v; }
  return out;
}
const same = (a: unknown, b: unknown) => a === b || (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);
/** Why an action cannot be taken in this state (null = it can). */
export function whenRefusal(a: Action, state: Record<string, unknown>, name: string): Refusal | null {
  for (const w of a.when) {
    const v = state[w.field];
    if (w.is !== undefined && !same(v, w.is)) return { code: 'object.state', reason: `${name} is ${describeState(w.field, v)}.` };
    if (w.not !== undefined && same(v, w.not)) return { code: 'object.state', reason: `${name} is ${describeState(w.field, v)}.` };
  }
  return null;
}
function describeState(field: string, v: unknown) {
  if (field === 'on') return v ? 'already on' : 'off';
  if (field === 'open') return v ? 'already open' : 'closed';
  if (field === 'locked') return v ? 'locked' : 'not locked';
  if (field === 'lit') return v ? 'already lit' : 'not lit';
  if (field === 'playing') return v ? 'already playing' : 'not playing';
  if (field === 'level') return v === 1 ? 'full' : v === 0 ? 'empty' : `at ${v}`;
  if (field === 'text') return v ? 'already written on' : 'blank';
  if (field === 'moisture') return v === 1 ? 'well watered' : v === 0 ? 'dry' : `at moisture ${v}`;
  return `${field} ${JSON.stringify(v)}`;
}
/** The state patch an action makes (`set`, `toggle` and `cycle`; attach/detach are left to the engine's own verbs). */
export function thenPatch(a: Action, state: Record<string, unknown>, params: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of a.then) {
    if (t.op === 'set') out[t.field] = typeof t.value === 'object' && t.value !== null && 'param' in (t.value as object) ? params[(t.value as { param: string }).param] : t.value;
    else if (t.op === 'increment') out[t.field] = Number(out[t.field] ?? state[t.field] ?? 0) + t.by;
    else if (t.op === 'toggle') out[t.field] = !(out[t.field] ?? state[t.field]);
    else if (t.op === 'cycle') { const i = t.values.indexOf(String(out[t.field] ?? state[t.field])); out[t.field] = t.values[(i + 1) % t.values.length]; }
  }
  return out;
}

export type ActuatorHost = {
  /** The Soul's body position (x, z), or null. */
  bodyAt(soul: EdgeSoul): Vec2 | null;
  deferContacts?: boolean;
  contactPlan?(soul:EdgeSoul,target:string,action:string,params?:Record<string,unknown>):{params:Record<string,unknown>;root:[number,number,number];level?:number;face?:[number,number];/** entry 32: where to step back to afterwards (a knock) */after?:[number,number]}|null;
  /** Commit a state change of a god thing as an engine edit. */
  commit(id: string, patch: Record<string, unknown>, note: string): { accepted: boolean };
  /** The thing's actuator state as the world has it now (the object's copy may lag a sync behind). */
  stateOf?(id: string): Record<string, unknown> | null;
  /** LAYERS: why this Soul may not touch it (a private thing of someone else's), or null. */
  access?(id: string, soul: EdgeSoul): Refusal | null;
  /** Soul Actions entry 32: who may lock, unlock or knock on a lockable door (owner-only lock; knock from outside). */
  policy?(id: string, soul: EdgeSoul, action: string): Refusal | null;
  /** Entry 42: why this action cannot happen now because the thing is in use (a drawer someone is reaching into), or null. */
  busy?(id: string, action: string): Refusal | null;
  /** SOULFIX: a standing point within reach that the body can walk to (front, back, else any side), or null. */
  approach?(id: string, soul: EdgeSoul, front: Vec2 | null, radius?: number): { p: Vec2; level: number } | null;
  /** W5 water (water.ts): the things involved in moving water, and an atomic commit of several state changes. */
  water?: WaterHost;
  /** Entry 34 (watering.ts): "water <plant>" with a watering can from its hook, as one act of native steps; null = W5. */
  watering?(soul: EdgeSoul, plant: string, action: string): { steps: { verb: string; params: Record<string, unknown> }[]; summary: string } | Refusal | null;
  /** The act was accepted: watch this Soul's body for its watering moments. */
  wateringBegun?(soul: EdgeSoul): void;
  /** Entry 43 (tea.ts): "fill the kettle", "put the kettle on", "pour the tea", "make a cup of tea" as acts of native steps. */
  tea?(soul: EdgeSoul, thing: string, action: string): { steps: { verb: string; params: Record<string, unknown> }[]; summary: string } | Refusal | null;
  teaBegun?(soul: EdgeSoul): void;
};
export type Thing = { id: string; name: string; def: StoredDef; state: Record<string, unknown>; params: Record<string, unknown> };
export type WaterHost = {
  /** The god thing in this Soul's hand, or null. */
  held(soul: EdgeSoul): Thing | null;
  thing(id: string): Thing | null;
  /** The nearest water source within `r` metres of a thing (a can standing under a tank's tap). */
  sourceNear(id: string, r: number): Thing | null;
  commit(set: Transfer['set'], note: string): { accepted: boolean };
};

/** W5: what a water action would do now (a refusal or the transfer); null when the action is not about water. */
export function waterPlan(a: Action, id: string, soul: EdgeSoul, host: ActuatorHost): Transfer | Refusal | null {
  const w = host.water; if (!w) return null;
  const t = w.thing(id); if (!t) return null;
  const role = waterRole(t.def);
  if (!(isWaterAction(a) || (role === 'vessel' && a.name === 'fill'))) return null;
  const vessel = (x: Thing | null) => (x && waterRole(x.def) === 'vessel' ? asTank(x.id, x.name, x.def, x.state, x.params) : null);
  if (role === 'source') return drawWater(asTank(t.id, t.name, t.def, t.state, t.params), vessel(w.held(soul)));
  if (role === 'plant') return waterPlant(asPlant(t.id, t.name, t.def, t.state, t.params), vessel(w.held(soul)));
  if (role === 'vessel') {
    const src = w.sourceNear(id, SOURCE_NEAR_VESSEL);
    if (!src) return { code: 'water.no-source', reason: `There is no water by ${t.name}; carry it to a water tank or a rain barrel and fill it there.` };
    return drawWater(asTank(src.id, src.name, src.def, src.state, src.params), vessel(t));
  }
  return null;
}
const isRefusal = (x: Transfer | Refusal | null): x is Refusal => !!x && 'code' in x;
type BuiltLike = { at: Vec2 | null; state?: Record<string, unknown>; removed?: boolean; key?: string; front?: Vec2 | null };

/** Entry 27: noughts and crosses with honest turns. The first Soul to mark plays X, the second O; then the world keeps turns. */
export const isGameAction = (def: StoredDef, a: { name: string }) => !!def.tags?.includes('tictactoe') && (a.name === 'mark' || a.name === 'erase');
const gameGrid = (state: Record<string, unknown>) => (typeof state.text === 'string' && state.text ? state.text : '').padEnd(9, '.').slice(0, 9);
const gamePlayers = (state: Record<string, unknown>) => ({ ids: typeof state.textBy === 'string' && state.textBy ? state.textBy.split(',') : [], names: typeof state.players === 'string' && state.players ? state.players.split(',') : [] });
/** Why this Soul cannot mark (this square) or wipe the game now; null = it can. `square` undefined = availability only. */
export function gameProblem(a: { name: string }, state: Record<string, unknown>, soul: EdgeSoul, square?: unknown): Refusal | null {
  const g = gameGrid(state), st = gameStatus(g), { ids, names } = gamePlayers(state), me = ids.indexOf(soul.soulId);
  if (a.name === 'erase') return st.winner || st.draw || me >= 0 || ids.length < 2 ? null : { code: 'object.not-yours', reason: `A game between ${names.join(' and ')} is in progress; only they wipe it before it ends.` };
  if (st.winner) return { code: 'object.state', reason: `The game is over: ${names[st.winner === 'X' ? 0 : 1] ?? st.winner} won. Wipe the board for a new game.` };
  if (st.draw) return { code: 'object.state', reason: 'The game is over: a draw. Wipe the board for a new game.' };
  if (ids.length >= 2 && me < 0) return { code: 'object.not-yours', reason: `This game is between ${names.join(' and ')}; wait for the next one.` };
  const mine = me >= 0 ? (me === 0 ? 'X' : 'O') : ids.length === 0 ? 'X' : 'O';
  if (mine !== st.turn) return { code: 'object.state', reason: names[st.turn === 'X' ? 0 : 1] ? `It is ${names[st.turn === 'X' ? 0 : 1]}'s turn.` : `It is O's turn: the next Soul to mark plays O against ${names[0]}.` };
  if (square === undefined) return null;
  const i = gameSquareOf(square);
  if (i < 0) return { code: 'capability.params', reason: 'Say which square: 1-9 (top left is 1), or words like "top left", "centre", "bottom right".' };
  if (g[i] !== '.') return { code: 'object.state', reason: 'That square is taken.' };
  return null;
}
/** The game board's next state after this Soul's mark (or a wipe). */
export function gamePatch(a: { name: string }, state: Record<string, unknown>, soul: EdgeSoul, square: unknown): Record<string, unknown> {
  if (a.name === 'erase') return { text: '', textBy: '', players: '' };
  const g = [...gameGrid(state)], { ids, names } = gamePlayers(state), i = gameSquareOf(square), name = (soul.name || 'a Soul').replace(/[,\n]/g, ' ').slice(0, 40);
  if (!ids.includes(soul.soulId)) { ids.push(soul.soulId); names.push(name); }
  if (i >= 0 && g[i] === '.') g[i] = ids.indexOf(soul.soulId) === 0 ? 'X' : 'O';
  return { text: g.join(''), textBy: ids.join(','), players: names.join(',') };
}
/** After a move a player steps back from the board, so the other can reach it and both can see the game (entry 27). */
function gameStepBack(def: StoredDef, a: Action, motion: { root: [number, number, number]; params: Record<string, unknown> }) {
  const yaw = (motion.params.stroke as { yaw?: number } | undefined)?.yaw;
  if (!isGameAction(def, a) || typeof yaw !== 'number') return [];
  return [{ verb: 'walk_to', params: { to: [motion.root[0] + Math.sin(yaw) * 0.9, motion.root[2] + Math.cos(yaw) * 0.9], standoff: 0 } }];
}
/** Soul-written board text (entry 13): short, at most three lines, printable. Null = acceptable. */
export function boardTextProblem(v: unknown, max = 100, lines = 3): Refusal | null {
  if (typeof v !== 'string' || !v.trim()) return { code: 'capability.params', reason: 'Say what to write: text is required.' };
  const t = v.trim();
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(t)) return { code: 'capability.params', reason: 'Board text cannot contain control characters.' };
  if (t.length > max) return { code: 'capability.params', reason: `That is too long for the board: at most ${max} characters (yours is ${t.length}).` };
  if (t.split('\n').length > lines) return { code: 'capability.params', reason: `At most ${lines} lines fit on the board.` };
  return null;
}
/** Entry 19: a pinboard's notes, one per line of `text`, with the authors' soul ids in `textBy` (same order). */
export const isPinAction = (def: StoredDef, a: { name: string }) => !!def.tags?.includes('pinboard') && (a.name === 'pin' || a.name === 'unpin');
export function pinNotes(state: Record<string, unknown>): { text: string; by: string }[] {
  const lines = typeof state.text === 'string' && state.text ? state.text.split('\n') : [], by = typeof state.textBy === 'string' && state.textBy ? state.textBy.split(',') : [];
  return lines.map((text, i) => ({ text, by: by[i] ?? '' }));
}
/** Why this Soul cannot pin (with these words) or take down a note here now; null = it can. `text` undefined = availability only. */
export function pinProblem(a: { name: string }, state: Record<string, unknown>, soul: EdgeSoul, text?: unknown): Refusal | null {
  const notes = pinNotes(state), mine = notes.filter(n => n.by === soul.soulId).length;
  if (a.name === 'unpin') return mine ? null : { code: 'object.not-yours', reason: 'You have no note on this board; only its author takes a note down.' };
  if (notes.length >= PIN_NOTES_MAX) return { code: 'object.state', reason: `The board is full (${PIN_NOTES_MAX} notes); a note comes down only when its author takes it down.` };
  if (mine >= PIN_PER_SOUL) return { code: 'object.state', reason: `You already have ${PIN_PER_SOUL} notes on this board; take one down first.` };
  if (text === undefined) return null;
  const bad = boardTextProblem(text, PIN_TEXT_MAX, 1); if (bad) return bad.reason.startsWith('At most') ? { ...bad, reason: 'A note is one line.' } : bad;
  return null;
}
/** The pinboard's next `text`/`textBy` after this Soul pins a signed note or takes down its latest one. */
export function pinPatch(a: { name: string }, state: Record<string, unknown>, soul: EdgeSoul, text: unknown): Record<string, unknown> {
  const notes = pinNotes(state), name = (soul.name || 'a Soul').replace(/[\n,—]/g, ' ').slice(0, 40);
  if (a.name === 'pin') notes.push({ text: `${String(text).trim()} — ${name}`, by: soul.soulId });
  else { const i = notes.map(n => n.by).lastIndexOf(soul.soulId); if (i >= 0) notes.splice(i, 1); }
  return { text: notes.map(n => n.text).join('\n'), textBy: notes.map(n => n.by).join(',') };
}
/** Entry 25: a sign-up sheet (one line per signer: their own name) and a poll (one vote per Soul). */
const signerName = (soul: EdgeSoul) => (soul.name || 'a Soul').replace(/[\n,—|:]/g, ' ').trim().slice(0, 40);
export const isSignupAction = (def: StoredDef, a: { name: string }) => !!def.tags?.includes('signup') && (a.name === 'sign' || a.name === 'unsign');
export const isPollAction = (def: StoredDef, a: { name: string }) => !!def.tags?.includes('poll') && a.name === 'vote';
/** A board whose lines several Souls own (pinboard notes, sign-up names, poll votes). */
export const isListAction = (def: StoredDef, a: { name: string }) => isPinAction(def, a) || isSignupAction(def, a) || isPollAction(def, a) || isPosterAction(def, a) || isWantedAction(def, a);
/** The poll option a choice names: exact (any case), else the only option it starts. -1 = none. */
export function pollChoice(state: Record<string, unknown>, choice: unknown): number {
  const opts = pollOptions(state).map(o => o.toLowerCase()), c = typeof choice === 'string' ? choice.trim().toLowerCase().replace(/^(?:for|on)\s+/, '').replace(/^(?:the|a|an)\s+/, '') : '';
  if (!c) return -1; const exact = opts.indexOf(c); if (exact >= 0) return exact;
  const starts = opts.map((o, i) => (o.startsWith(c) || c.startsWith(o) ? i : -1)).filter(i => i >= 0);
  return starts.length === 1 ? starts[0] : -1;
}
/** A poll's votes ("soulId:optionIndex", comma-separated) and the face/read lines they make ("Soup — 2 votes"). */
export function pollVotes(state: Record<string, unknown>): { by: string; i: number }[] {
  return (typeof state.textBy === 'string' && state.textBy ? state.textBy.split(',') : []).map(v => { const [by, i] = v.split(':'); return { by, i: Number(i) }; }).filter(v => v.by && Number.isInteger(v.i));
}
export const pollLines = (state: Record<string, unknown>, votes = pollVotes(state)) => pollOptions(state).map((o, i) => { const n = votes.filter(v => v.i === i).length; return `${o} — ${n} vote${n === 1 ? '' : 's'}`; }).join('\n');
/** Why this Soul cannot do this list action here now (null = it can). `params` undefined = availability only. */
export function listProblem(def: StoredDef, a: { name: string }, state: Record<string, unknown>, soul: EdgeSoul, params?: Record<string, unknown>): Refusal | null {
  if (isPosterAction(def, a)) return posterProblem(a, state, soul, params);   // entry 38
  if (isWantedAction(def, a)) return wantedProblem(a, state, soul, params);
  if (isPinAction(def, a)) return pinProblem(a, state, soul, a.name === 'pin' ? params?.text : undefined);
  if (isSignupAction(def, a)) {
    const names = pinNotes(state), mine = names.some(n => n.by === soul.soulId);
    if (a.name === 'unsign') return mine ? null : { code: 'object.not-yours', reason: 'Your name is not on this sheet; only a signer crosses their own name off.' };
    if (mine) return { code: 'object.state', reason: 'Your name is already on this sheet.' };
    if (names.length >= SIGNUP_MAX) return { code: 'object.state', reason: `The sheet is full (${SIGNUP_MAX} names).` };
    return null;
  }
  if (isPollAction(def, a)) {
    const opts = pollOptions(state);
    if (opts.length < 2) return { code: 'object.state', reason: 'This poll has no options to vote for yet.' };
    if (params === undefined) return null;
    const i = pollChoice(state, params.choice);
    if (i < 0) return { code: 'capability.params', reason: `Say which option to vote for: ${opts.join(', ')}.` };
    if (pollVotes(state).some(v => v.by === soul.soulId && v.i === i)) return { code: 'object.state', reason: `You already voted for ${opts[i]}.` };
    return null;
  }
  return null;
}
/** The list board's next `text`/`textBy` after this Soul's action. */
export function listPatch(def: StoredDef, a: { name: string }, state: Record<string, unknown>, soul: EdgeSoul, params: Record<string, unknown>): Record<string, unknown> {
  if (isPosterAction(def, a)) return posterPatch(a, state, soul, params);   // entry 38
  if (isWantedAction(def, a)) return wantedPatch(a, state, soul, params);
  if (isPinAction(def, a)) return pinPatch(a, state, soul, params.text);
  if (isSignupAction(def, a)) {
    const names = pinNotes(state).filter(n => n.by !== soul.soulId);
    if (a.name === 'sign') names.push({ text: signerName(soul), by: soul.soulId });
    return { text: names.map(n => n.text).join('\n'), textBy: names.map(n => n.by).join(',') };
  }
  const votes = pollVotes(state).filter(v => v.by !== soul.soulId), i = pollChoice(state, params.choice);
  if (i >= 0) votes.push({ by: soul.soulId, i });
  return { text: pollLines(state, votes), textBy: votes.map(v => `${v.by}:${v.i}`).join(',') };
}
/** After pinning or taking down a note a Soul steps back from the cork, so the next Soul can reach its own note. */
function stepBack(def: StoredDef, a: Action, motion: { root: [number, number, number]; params: Record<string, unknown> }) {
  const yaw = (motion.params.stroke as { yaw?: number } | undefined)?.yaw;
  if (!isListAction(def, a) || typeof yaw !== 'number') return [];
  return [{ verb: 'walk_to', params: { to: [motion.root[0] + Math.sin(yaw) * 0.8, motion.root[2] + Math.cos(yaw) * 0.8], standoff: 0 } }];
}
/** #431: the enum fields a def action sets from its params (a record player's `record` from `{param: 'record'}`). */
function enumParamFields(def: StoredDef, a: Action): { param: string; field: string; values: string[] }[] {
  const out: { param: string; field: string; values: string[] }[] = [];
  for (const t of a.then) {
    if (t.op !== 'set' || typeof t.value !== 'object' || t.value === null || !('param' in (t.value as object))) continue;
    const f = (def.state as Record<string, { type?: string; values?: unknown[] }>)[t.field];
    if (f?.type === 'enum' && Array.isArray(f.values)) out.push({ param: (t.value as { param: string }).param, field: t.field, values: f.values.map(String) });
  }
  return out;
}
const enumKey = (v: unknown) => String(v ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
/** #431: a param set into an enum field must name one of its values (case and spacing forgiven); null when every one does. */
export function enumParamProblem(def: StoredDef, a: Action, params: Record<string, unknown>, name: string): Refusal | null {
  for (const e of enumParamFields(def, a)) {
    const k = enumKey(params[e.param]); if (k && e.values.some(v => enumKey(v) === k)) continue;
    const said = String(params[e.param] ?? '').trim().slice(0, 40);
    return { code: 'capability.params', reason: `${name} has no ${e.field} ${said ? `“${said}”` : 'named'}; choose one of: ${e.values.join(', ')}.` };
  }
  return null;
}
/** The params with each enum pick replaced by the field's own spelling of it. */
function canonicalParams(def: StoredDef, a: Action, params: Record<string, unknown>): Record<string, unknown> {
  const picks = enumParamFields(def, a); if (!picks.length) return params;
  const out = { ...params };
  for (const e of picks) { const k = enumKey(params[e.param]), v = k ? e.values.find(v => enumKey(v) === k) : undefined; if (v !== undefined) out[e.param] = v; }
  return out;
}
/** A def action's state patch: the `then` ops, or a pinboard's composed list. */
export function actionPatch(def: StoredDef, a: Action, state: Record<string, unknown>, params: Record<string, unknown>, soul: EdgeSoul): Record<string, unknown> {
  return isListAction(def, a) ? listPatch(def, a, state, soul, params) : thenPatch(a, state, canonicalParams(def, a, params));
}
/** The Soul-facing params of a def action: its declared string params (board text). */
function actionParams(a: Action): Record<string, { type: 'string'; maxLength: number; description?: string; optional?: true }> {
  const out: Record<string, { type: 'string'; maxLength: number; description?: string; optional?: true }> = {};
  // entry 38: a param with a default ('') is optional (a poster's detail, a note's column)
  for (const [k, f] of Object.entries(a.params ?? {})) if (f.type === 'string') out[k] = { type: 'string', maxLength: f.max, ...(f.doc ? { description: f.doc } : {}), ...((f as { default?: unknown }).default !== undefined ? { optional: true } : {}) };
  return out;
}

/** Object-kind actions for a def's actions (the `built` kind of things of that def). */
export function kindActions(def: StoredDef, host: ActuatorHost, nameOf: (s: BuiltLike) => string) {
  const out: Record<string, any> = {};
  for (const a of actionsOf(def)) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(a.name)) continue;
    const check = (s: BuiltLike, ctx: { soul: EdgeSoul }): Refusal | null => {
      if (s.removed || !s.at) return { code: 'object.gone', reason: 'It is not there any more.' };
      const me = host.bodyAt(ctx.soul); if (!me) return { code: 'body.unavailable', reason: 'Your body is unavailable.' };
      const d = Math.hypot(s.at[0] - me[0], s.at[1] - me[1]);
      if (d > ACT_SIGHT) return { code: 'object.out-of-reach', reason: `${nameOf(s)} is ${Math.round(d)} m away; walk closer first.` };
      const denied = s.key ? host.access?.(s.key, ctx.soul) : null; if (denied) return denied;
      const busy = s.key ? host.busy?.(s.key, a.name) : null; if (busy) return busy;
      if(host.deferContacts&&def.tags.includes('wall-window')&&s.key&&!host.contactPlan?.(ctx.soul,s.key,a.name))return {code:'contact.out-of-reach',reason:'This window handle is outside standing hand reach from your floor.'};
      const policy = s.key ? host.policy?.(s.key, ctx.soul, a.name) : null; if (policy) return policy;
      const can = s.key && a.name === 'water' ? host.watering?.(ctx.soul, s.key, a.name) : null; if (can) return 'code' in can ? can : null;
      const tea = s.key ? host.tea?.(ctx.soul, s.key, a.name) : null; if (tea) return 'code' in tea ? tea : null;
      const water = s.key ? waterPlan(a, s.key, ctx.soul, host) : null; if (water) return isRefusal(water) ? water : null;
      const state = (s.key && host.stateOf?.(s.key)) || s.state || {};
      return whenRefusal(a, state, nameOf(s)) ?? (isListAction(def, a) ? listProblem(def, a, state, ctx.soul) : isGameAction(def, a) ? gameProblem(a, state, ctx.soul) : null);
    };
    out[a.name] = {
      label: a.label, roles: 'anyone', reach: 'anywhere', params: actionParams(a), movesBody: true,
      available: (s: BuiltLike, ctx: any) => check(s, ctx),
      validate: (s: BuiltLike, p: Record<string, unknown>, ctx: any) => check(s, ctx) ?? (isListAction(def, a) ? listProblem(def, a, (s.key && host.stateOf?.(s.key)) || s.state || {}, ctx.soul, p ?? {}) : null) ?? (isGameAction(def, a) && a.name === 'mark' ? gameProblem(a, (s.key && host.stateOf?.(s.key)) || s.state || {}, ctx.soul, p?.square ?? '') : null) ?? (a.name === 'write' && 'text' in actionParams(a) ? boardTextProblem(p?.text, actionParams(a).text.maxLength) : null) ?? enumParamProblem(def, a, p ?? {}, nameOf(s)),
      apply: (s: BuiltLike, params: Record<string, unknown>, ctx: any) => {
        const can = s.key && a.name === 'water' ? host.watering?.(ctx.soul, s.key, a.name) : null;
        if (can && !('code' in can)) return { state: s, result: { action: a.name, summary: can.summary }, bodies: [{ label: a.label, steps: can.steps }] };
        const tea = s.key ? host.tea?.(ctx.soul, s.key, a.name) : null;
        if (tea && !('code' in tea)) return { state: s, result: { action: a.name, summary: tea.summary }, bodies: [{ label: a.label, steps: tea.steps }] };
        const contact = host.deferContacts && isContactActuator(def, a);
        const motion=contact&&s.key?host.contactPlan?.(ctx.soul,s.key,a.name,params):null;
        if(motion){const me=host.bodyAt(ctx.soul)!,far=(motion.level??0)>0||Math.hypot(me[0]-motion.root[0],me[1]-motion.root[2])>.1;
          return {state:s,result:{action:a.name,set:actionPatch(def,a,(s.key&&host.stateOf?.(s.key))||s.state||{},params,ctx.soul)},bodies:[{label:a.label,steps:[{verb:'stand',params:{}},...(far?[(motion.level??0)>0||motion.params.stroke?{verb:'mars:walk_to',params:{x:motion.root[0],z:motion.root[2],level:motion.level}}:{verb:'walk_to',params:{to:[motion.root[0],motion.root[2]],standoff:0}}]:[]),...(motion.face?[{verb:'mars:face',params:{target:{point:motion.face}}}]:[]),{verb:'mars:hand_actuator_v1',params:motion.params},...stepBack(def,a,motion),...gameStepBack(def,a,motion),...(motion.after?[{verb:'walk_to',params:{to:motion.after,standoff:0}}]:[])]}]};}

        const me = host.bodyAt(ctx.soul)!, to = s.front ?? s.at!, far = Math.hypot(s.at![0] - me[0], s.at![1] - me[1]) > (contact ? CONTACT_REACH : ACT_REACH);
        const water = s.key ? waterPlan(a, s.key, ctx.soul, host) : null;
        const patch = water && !isRefusal(water) ? { litres: water.litres } : actionPatch(def, a, (s.key && host.stateOf?.(s.key)) || s.state || {}, params, ctx.soul);
        // A door works from either side. Prefer the side the Soul already occupies,
        // so "close behind me" cannot silently walk it back out of the room.
        const front=contact&&def.components.opening&&s.front&&s.at
          &&(me[0]-s.at[0])*(s.front[0]-s.at[0])+(me[1]-s.at[1])*(s.front[1]-s.at[1])<0
          ? [2*s.at[0]-s.front[0],2*s.at[1]-s.front[1]] as Vec2 : s.front??null;
        const ap = far && s.key ? host.approach?.(s.key, ctx.soul, front, contact ? .75 : undefined) : null;
        const walk = !far ? [] : ap ? [ap.level === 0 ? { verb: 'walk_to', params: { to: ap.p, standoff: 0 } } : { verb: 'mars:walk_to', params: { x: ap.p[0], z: ap.p[1], level: ap.level } }] : [{ verb: 'walk_to', params: { to, standoff: 0.5 } }];
        return { state: s, result: { action: a.name, set: patch, ...(water && !isRefusal(water) ? { summary: water.summary } : {}) }, bodies: [{ label: `${a.label}`, steps: contact ? [{verb:'stand',params:{}},...walk,{verb:'mars:pose_v1',params:{activity:'operate',seconds:1.2,face:s.at!}}] : [...walk, { verb: 'wave', params: { at: s.key, seconds: 1 } }] }] };
      },
    };
  }
  return out;
}

/** Wrap the framework's `act` (what the ledger's commit calls) so an accepted actuator action changes the world. */
export function wrapAct(objects: { act(id: string, soul: EdgeSoul, input: Record<string, unknown>): any } & { __vocabAct?: boolean }, find: (id: string) => { def: StoredDef; state: Record<string, unknown>; name: string } | null, host: ActuatorHost, log: (m: string) => void) {
  if (objects.__vocabAct) return; objects.__vocabAct = true;
  const orig = objects.act.bind(objects);
  objects.act = (id: string, soul: EdgeSoul, input: Record<string, unknown>) => {
    const out = orig(id, soul, input);
    if (!out?.accepted) return out;
    const t = find(id), a = t ? actionsOf(t.def).find((x) => x.name === input.action) : undefined;
    if (!t || !a) return out;
    if (host.deferContacts && isContactActuator(t.def, a)) return out;
    // Entry 34: the watering-can act changes the world at its own native moments (watering.ts), never here
    if (a.name === 'water' && host.watering?.(soul, id, a.name)) { host.wateringBegun?.(soul); return out; }
    // Entry 43: so does a tea act (tea.ts)
    if (host.tea?.(soul, id, a.name)) { host.teaBegun?.(soul); return out; }
    // W5: water moves between two things (tank → can, can → planter) in one commit, planned again at commit time
    const water = waterPlan(a, id, soul, host);
    if (water) {
      if (isRefusal(water)) { log(`water ${a.name} on ${id}: ${water.reason}`); return out; }
      const go = () => { try { const now = waterPlan(a, id, soul, host); if (!now || isRefusal(now)) { log(`water ${a.name} on ${id}: by commit time ${now ? now.reason : 'not water'}`); return; } const r = host.water!.commit(now.set, `${soul.soulId} ${a.name} ${t.name}: ${now.litres} L`); if (!r.accepted) log(`water ${a.name} on ${id}: the world refused ${JSON.stringify(now.set)}`); } catch (e) { log(`water ${a.name} on ${id}: ${(e as Error).message}`); } };
      const db0 = (objects as unknown as { core?: { db?: unknown } }).core?.db;
      try { if (db0) afterCommit(db0 as never, go); else setImmediate(go); } catch { setImmediate(go); }
      return out;
    }
    const patch = actionPatch(t.def, a, t.state, (input.params ?? {}) as Record<string, unknown>, soul);
    if (!Object.keys(patch).length) return out;
    // the object act runs inside the ledger's transaction (and may still roll back with the body's admission): change the
    // world only once that transaction has committed, never inside it (the world store has its own transaction)
    const apply = () => { try { const r = host.commit(id, patch, `${soul.soulId} ${a.name} ${t.name}`); if (!r.accepted) log(`actuator ${a.name} on ${id}: the world refused ${JSON.stringify(patch)}`); } catch (e) { log(`actuator ${a.name} on ${id}: ${(e as Error).message}`); } };
    const db = (objects as unknown as { core?: { db?: unknown } }).core?.db;
    try { if (db) afterCommit(db as never, apply); else setImmediate(apply); } catch { setImmediate(apply); }
    return out;
  };
}
