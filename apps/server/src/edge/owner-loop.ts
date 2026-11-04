// D3 (playtest 2026-10-25, ROOT-CAUSES §C D3): only the agent turned a receipt into its owner's result, and it rarely did
// in time (29 of 75 card messages had a result before the cutoff). An act may now name the owner message it serves
// (`for`, the CLI's `act --for <id>`, by default the newest message it acknowledged); when that act's receipt ends the
// world writes the message's result line itself from the receipt, unless the agent already wrote one. The agent's own
// `result` still replaces the world's line. Links are kept in memory (a restart drops them: the agent can still result).
// D3c (laptop trio-r1 rook-003: "have a little rest, then come back to the balloon" closed Done by a wave): a link the
// CLI made by default (`implicit`, the agent did not choose it) closes the message only with an act of its last step
// (messageSteps); any other act's end posts a progress line ("now: …; not resting yet") and leaves the card open, and the
// act's answer says `open` so the CLI's default serves the next act too. An explicit `for` closes as before.
// D3d (fix-d3c-c trio-r1 rook-003: a walk to a bench closed "…then come back to the balloon" as "walk completed"): in a
// message of several steps the last step's act must also reach the step's target when it names one (the balloon, the
// pavilion, Tam): the receipt's own target is it or a place inside it, or the body ended inside the named place or near
// the named thing or Soul. A last step whose target the world cannot resolve is never closed by default: progress only,
// the agent's `result` closes it. One-step messages and explicit links are unchanged.
import type {EdgeReceipt, EdgeSoul} from './contract.ts';
import {messageSteps, type MessageStep, type StepTarget} from './ledger/vocabulary.ts';

export type OwnerLoopInbox = {
  hasMessage(s: {scope: string; owner: string}, id: string): boolean;
  serverResult(s: {scope: string; owner: string}, id: string, text: string, outcome: 'done' | 'failed'): boolean;
  messageText?(s: {scope: string; owner: string}, id: string): string | null;
  serverProgress?(s: {scope: string; owner: string}, id: string, text: string): boolean;
};
/** D3d: what the world knows to judge a step's target (the ledger): the resolver, what an offered capability points at
 *  (its target's id), a place's id with its ancestors (null: not a place), and where a thing or Soul stands now. */
export type OwnerLoopWorld = {
  stepTarget(soul: EdgeSoul, words: string[]): StepTarget | null;
  actTarget(soul: EdgeSoul, capability: string): string | null;
  placePath(id: string): string[] | null;
  posOf(id: string): [number, number] | null;
};
/** `steps`: the message's steps when the link is implicit and its words name some (else the act closes it, as before). */
type Link = {scope: {scope: string; owner: string}; message: string; steps?: MessageStep[]; act?: string[]};
// #804: an object action (`object:<id>:<action>`) is a step of its action ("sit at the chess table", "ride the balloon":
// ride widens to join), aimed at its object, never the bare `object` verb.
const objectAction = (capability: string) => {const [v, id, action] = capability.split(':'); return v === 'object' && id && action ? {id, action} : null;};
const verbOf = (r: EdgeReceipt) => objectAction(r.capability)?.action ?? r.capability.split(':')[0];
const targetsOf = (capability: string) => {const o = objectAction(capability); return o ? [o.id] : [capability.slice(capability.indexOf(':') + 1)];};
/** What the owner still waits for, said plainly ("not resting yet"); `there` for any way of getting somewhere. */
function pending(step: string[]) {
  const v = step[0];
  return v === 'rest' || v === 'nap' || v === 'lie' ? 'resting' : v === 'sit' ? 'sitting' : step.includes('walk') ? 'there' : v === 'ride' ? 'aboard' : `${v} done`;
}
const MAX_LINKS = 2000;
/** How near a named thing or Soul the body must end to be at it (metres). */
const AT_M = 6;

/** D3d: whether an act reached a step's target: its own target (`act`: the ids its capability points at, else the words
 *  after its verb) is it or a place inside the named place, or (`ended`, a terminal receipt) the body ended inside the
 *  named place or within AT_M of the named thing or Soul. */
export function reachedTarget(r: EdgeReceipt, t: StepTarget, world: Pick<OwnerLoopWorld, 'placePath' | 'posOf'>, ended = false, act?: string[]): boolean {
  const within = (path: string[] | null) => !!path?.some(p => t.places.includes(p));
  for (const id of act ?? targetsOf(r.capability)) if (t.places.includes(id) || t.things.includes(id) || t.souls.includes(id) || within(world.placePath(id))) return true;
  if (!ended || r.phase !== 'completed') return false;
  const end = r.endedAt as {place?: string | null; pos?: [number, number] | null} | undefined;
  if (end?.place && within(world.placePath(end.place))) return true;
  return !!end?.pos && [...t.things, ...t.souls].some(x => {const p = world.posOf(x); return !!p && Math.hypot(p[0] - end.pos![0], p[1] - end.pos![1]) <= AT_M;});
}

/** The one line the owner's card shows when the linked act ends: the receipt's outcome summary, else its phase. */
export function resultLine(r: EdgeReceipt & {outcome?: {summary?: string}; done?: string}): {text: string; outcome: 'done' | 'failed'} | null {
  if (r.phase !== 'completed' && r.phase !== 'failed') return null;   // replaced: the act that replaced it closes the message
  const text = r.done ?? r.outcome?.summary ?? (r.phase === 'completed' ? `${r.capability} done.` : `${r.capability} failed${r.reason ? `: ${r.reason}` : '.'}`);
  return {text, outcome: r.phase === 'completed' ? 'done' : 'failed'};
}

export class OwnerLoop {
  private links = new Map<string, Link>();
  private reached = new Map<string, number>();   // message → steps already served by an implicit link's act
  private inbox: OwnerLoopInbox;
  private read: (soulId: string, receiptId: string) => (EdgeReceipt & {outcome?: {summary?: string}; done?: string}) | null;
  private world: OwnerLoopWorld | null;
  constructor(inbox: OwnerLoopInbox, read: OwnerLoop['read'], onReceipt: (l: (r: EdgeReceipt) => void) => void, world: OwnerLoopWorld | null = null) {
    this.inbox = inbox; this.read = read; this.world = world;
    onReceipt(r => this.ended(r));
  }
  /** D3d: whether this act serves step `i` of a linked message: its verb, and (several steps, last one) its target. */
  private serves(l: Link, i: number, r: EdgeReceipt, ended: boolean): boolean {
    const st = l.steps![i]!;
    if (!st.verbs.includes(verbOf(r))) return false;
    if (l.steps!.length < 2 || i < l.steps!.length - 1) return true;
    if (st.unresolved) return false;   // the agent's own result closes it
    return !st.target || !this.world || reachedTarget(r, st.target, this.world, ended, l.act);
  }
  /** Validate `for` before the act: a message id in this Soul's box, else a refusal reason. */
  check(soul: EdgeSoul, message: unknown): string | null {
    if (typeof message !== 'string' || !message.trim()) return '`for` must be an owner message id from listen';
    return this.inbox.hasMessage(this.scope(soul), message) ? null : `no owner message ${message} for this Soul (it may be too old)`;
  }
  /** Link an accepted act's receipt to its owner message; a receipt already terminal closes the message now. Implicit
   *  (the CLI's default): true when this act cannot close the message (not its last step), so the card stays open. */
  link(soul: EdgeSoul, receipt: EdgeReceipt, message: string, implicit = false): {open: boolean} {
    const scope = this.scope(soul), text = implicit ? this.inbox.messageText?.(scope, message) : null;
    const world = this.world, steps = text ? messageSteps(text, world ? words => world.stepTarget(soul, words) : undefined) : [];
    const aim = world && steps.length > 1 && steps.at(-1)!.target ? world.actTarget(soul, receipt.capability) : null;
    const l: Link = {scope, message, ...(steps.length ? {steps} : {}), ...(aim ? {act: [aim, ...targetsOf(receipt.capability)]} : {})};
    this.links.set(receipt.id, l);
    if (this.links.size > MAX_LINKS) this.links.delete(this.links.keys().next().value!);
    const open = !!l.steps && !this.serves(l, l.steps.length - 1, receipt, false);
    if (receipt.phase !== 'waiting' && receipt.phase !== 'started') this.ended(receipt);
    return {open};
  }
  private ended(r: EdgeReceipt) {
    const l = this.links.get(r.id); if (!l || ['waiting', 'started', 'accepted'].includes(r.phase)) return;
    this.links.delete(r.id);
    const full = this.read(r.soulId, r.id) ?? r, line = resultLine(full); if (!line) return;
    const seen = {...r, ...(full.endedAt !== undefined ? {endedAt: full.endedAt} : {})};
    if (!l.steps || this.serves(l, l.steps.length - 1, seen, true)) { this.reached.delete(l.message); this.inbox.serverResult(l.scope, l.message, line.text, line.outcome); return; }
    // not the last step (or not its target): the owner sees what happened and what is still to come; the message stays open
    const last = l.steps.length - 1, at = l.steps.findIndex((_, i) => i >= (this.reached.get(l.message) ?? 0) && i < last && this.serves(l, i, seen, true));
    const reached = Math.max(this.reached.get(l.message) ?? 0, at >= 0 && line.outcome === 'done' ? at + 1 : 0);
    this.reached.set(l.message, reached); if (this.reached.size > MAX_LINKS) this.reached.delete(this.reached.keys().next().value!);
    this.inbox.serverProgress?.(l.scope, l.message, `now: ${line.text.replace(/[.\s]+$/, '')}; not ${pending(l.steps[Math.min(reached, last)]!.verbs)} yet`);
  }
  private scope(soul: EdgeSoul) {return {scope: `soul:${soul.soulId}`, owner: soul.owner};}
}
