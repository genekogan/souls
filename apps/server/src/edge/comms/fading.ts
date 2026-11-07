// C9: fading rule (vision §8; Gene §13: yellow at 30 min, red from 50, beam at exactly
// 60, idle clock resets on any accepted action). M2 (2026-10-08): fading measures abandonment —
// a hold (executing plan step, chosen resting posture or activity in progress) keeps the clock at zero. SHIPS FLAG-OFF: with `enabled` false
// nothing is recorded, no events are sent and status() is null. The ledger owns the
// body effects: it listens with onFade() to remove the body at 60 and to land it at a
// starting place on reclaim. Comms owns the clock, stream warnings and narration items.
// LINK BODY (2026-10-24, Gene: "the body never leaves"): the idle beam-up is retired behind SIM_BEAM (off). With the beam
// off nothing warns, nothing is removed and `status()` stays green while the body is here; the idle clock (touch) still
// runs and its listeners (onTouch) feed the presence-driven body rule (edge/ledger/body-rule.ts: zombie, sleep, idle
// reflex). Travel's depart/arrive keep their own removal ('gone' + away), unchanged.
import type {CommsCore} from './core.ts';
import type {Steward} from './steward.ts';
import {tx} from './store.ts';

export type FadeColour = 'green' | 'yellow' | 'red' | 'gone';
export const YELLOW_MS = 30 * 60_000, RED_MS = 50 * 60_000, GONE_MS = 60 * 60_000;
/** Fade by abandonment (EVENTS-v1 / M2): a hold (an executing plan step, or a posture or activity the Soul's own act chose)
 *  keeps the idle clock at zero, so the 60 minutes count from when the hold ends. A hold counts for at most this long
 *  after the Soul's last accepted action, so a body left seated by an agent that never returns still fades eventually. */
export const HOLD_MAX_MS = 12 * 3600_000;
export type FadeChange = {soulId: string; colour: FadeColour; change: 'warn' | 'removed' | 'reclaimed'; idleSeconds: number};
/** SIM_BEAM=1 brings back the idle beam-up (warnings at 30/50 min, removal at 60). Off by default since LINK. */
export const beamEnabled = () => process.env.SIM_BEAM === '1';

const colourAt = (idle: number): FadeColour => idle >= GONE_MS ? 'gone' : idle >= RED_MS ? 'red' : idle >= YELLOW_MS ? 'yellow' : 'green';

export class Fading {
  private core: CommsCore; private steward: Steward; readonly enabled: boolean;
  /** The idle beam-up (SIM_BEAM). Off: no warnings, no removal, never `gone` except by travel. */
  readonly beam: boolean;
  private listeners: ((c: FadeChange) => void)[] = [];
  private touches: ((soulId: string) => void)[] = [];
  constructor(core: CommsCore, steward: Steward, enabled: boolean, beam = beamEnabled()) {
    this.core = core; this.steward = steward; this.enabled = enabled; this.beam = beam;
    if (enabled) {
      core.db.exec('CREATE TABLE IF NOT EXISTS edge_comms_activity (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, last_at INTEGER NOT NULL, colour TEXT NOT NULL, PRIMARY KEY (world_id, soul_id)) WITHOUT ROWID;');
      // contact_at: the last accepted action itself (last_at is the idle clock, which a hold keeps moving)
      if (!(core.db.prepare('PRAGMA table_info(edge_comms_activity)').all() as {name: string}[]).some(c => c.name === 'contact_at')) core.db.exec('ALTER TABLE edge_comms_activity ADD COLUMN contact_at INTEGER');
    }
  }
  private holds: ((soulId: string) => string | null)[] = [];
  /** EVENTS-v1: register a hold source (plans, the Ledger's chosen postures). The first non-null reason holds the Soul. */
  addHold(h: (soulId: string) => string | null) { this.holds.push(h); }
  /** Why this Soul is held at green right now, or null. */
  holdOf(soulId: string): string | null {
    for (const h of this.holds) { try { const r = h(soulId); if (r) return r; } catch { /* a hold source fault never holds */ } }
    return null;
  }
  onFade(l: (c: FadeChange) => void) { this.listeners.push(l); }
  /** LINK BODY: told of every accepted action (whether or not the fading flag is on); the body rule wakes on it. */
  onTouch(l: (soulId: string) => void) { this.touches.push(l); }
  private row(soulId: string) { return this.core.db.prepare('SELECT last_at, colour, contact_at FROM edge_comms_activity WHERE world_id = ? AND soul_id = ?').get(this.core.worldId, soulId) as {last_at: number; colour: FadeColour; contact_at: number | null} | undefined; }
  private set(soulId: string, lastAt: number, colour: FadeColour, contactAt?: number) {
    this.core.db.prepare('INSERT INTO edge_comms_activity (world_id, soul_id, last_at, colour, contact_at) VALUES (?,?,?,?,?) ON CONFLICT (world_id, soul_id) DO UPDATE SET last_at = excluded.last_at, colour = excluded.colour, contact_at = COALESCE(excluded.contact_at, edge_comms_activity.contact_at)').run(this.core.worldId, soulId, lastAt, colour, contactAt ?? null);
  }
  /** A hold that still counts (within HOLD_MAX_MS of the last accepted action). */
  private heldNow(soulId: string, r: {last_at: number; contact_at: number | null} | undefined, now: number): string | null {
    if (!this.holds.length || now - (r?.contact_at ?? r?.last_at ?? now) >= HOLD_MAX_MS) return null;
    return this.holdOf(soulId);
  }
  private announce(c: FadeChange, text: string) {
    const tick = this.core.tick();
    this.core.streams.deliver(c.soulId, 'fade', tick, {colour: c.colour, change: c.change, idleSeconds: c.idleSeconds, text});
    // travel (M3): a Soul gone to another world is marked `away`, so Explore drops it (it is not a resident here now)
    this.core.spectate({kind: 'fade', tick, soulId: c.soulId, colour: c.colour, change: c.change, ...(c.colour === 'gone' && this.isAway(c.soulId) ? {away: true} : {})});
    for (const l of this.listeners) { try { l(c); } catch { /* ledger listener faults never block the rule */ } }
  }

  /** PC09 (#688): what keeps a Soul's body at work in the world although its mind is gone (a running shared carry), or
   *  null. Only the words differ: such a body neither reclines on fading nor lands at a starting place on return. */
  private kept: ((soulId: string) => string | null)[] = [];
  addKept(k: (soulId: string) => string | null) { this.kept.push(k); }
  private keptBy(soulId: string): string | null { for (const k of this.kept) { try { const r = k(soulId); if (r) return r; } catch { /* a fault never keeps */ } } return null; }
  private away: ((soulId: string) => boolean)[] = [];
  /** Travel (M3): a Soul whose body is in another world stays faded here; its acts never reclaim it. */
  addAway(a: (soulId: string) => boolean) { this.away.push(a); }
  private isAway(soulId: string) { return this.away.some(a => { try { return a(soulId); } catch { return false; } }); }
  /** Travel (M3): take the body out of this world now (the fade's beam-up), with the Soul's own line. */
  depart(soulId: string, text: string, data: Record<string, unknown> = {}) {
    if (!this.enabled) return false;
    const now = this.core.now();
    tx(this.core.db, () => {
      const prior = this.row(soulId);
      this.set(soulId, prior?.last_at ?? now, 'gone', now);
      if (prior?.colour === 'gone') return;
      this.announce({soulId, colour: 'gone', change: 'removed', idleSeconds: 0}, text);
      this.steward.narrate({soulId, what: 'departed', data});
    });
    return true;
  }
  /** Travel (M3): bring the body back into this world at a starting place, with the Soul's own line. */
  arrive(soulId: string, text: string, data: Record<string, unknown> = {}) {
    if (!this.enabled) return false;
    const now = this.core.now();
    tx(this.core.db, () => {
      const prior = this.row(soulId);
      this.set(soulId, now, 'green', now);
      if (prior?.colour !== 'gone') return;
      this.announce({soulId, colour: 'green', change: 'reclaimed', idleSeconds: 0}, text);
      this.steward.narrate({soulId, what: 'arrived', data});
    });
    return true;
  }

  /** Any accepted action by the Soul. Reclaims a faded Soul. */
  touch(soulId: string) {
    for (const l of this.touches) { try { l(soulId); } catch { /* a body-rule fault never blocks an action */ } }
    if (!this.enabled || this.isAway(soulId)) return;
    const now = this.core.now();
    tx(this.core.db, () => {
      const prior = this.row(soulId);
      this.set(soulId, now, 'green', now);
      if (prior?.colour === 'gone') {
        const c: FadeChange = {soulId, colour: 'green', change: 'reclaimed', idleSeconds: 0};
        const kept = this.keptBy(soulId);
        this.announce(c, kept ? `You are back, where your body is: it is still in ${kept}, and you are free once that ends.` : 'You are back: you land on your feet at a starting place.');
        this.steward.narrate({soulId, what: 'reclaimed', data: {after: 'fading'}});
      }
    });
  }

  sweep() {
    if (!this.enabled || !this.beam) return;
    const now = this.core.now();
    for (const soulId of this.core.liveSoulIds()) tx(this.core.db, () => {
      const r = this.row(soulId);
      if (!r) { this.set(soulId, now, 'green', now); return; }    // first sight after the flag goes on starts the clock
      // fade by abandonment: while held (and not yet faded) the idle clock stays at zero
      if (r.colour !== 'gone' && this.heldNow(soulId, r, now)) { this.set(soulId, now, 'green'); return; }
      const idle = now - r.last_at, colour = colourAt(idle);
      if (colour === r.colour || r.colour === 'gone' || colour === 'green') return;
      this.set(soulId, r.last_at, colour);
      const c: FadeChange = {soulId, colour, change: colour === 'gone' ? 'removed' : 'warn', idleSeconds: Math.floor(idle / 1000)};
      if (colour === 'gone') { const kept = this.keptBy(soulId); this.announce(c, kept ? `Your mind has been away too long, so you fade; your body stays in ${kept} until it ends safely. Act again to return.` : 'A light comes down; you recline, rise and fade from the world. Act again to return.'); this.steward.narrate({soulId, what: 'faded', data: {idleSeconds: c.idleSeconds}}); }
      else this.announce(c, colour === 'yellow' ? 'You have been idle 30 minutes. Act within 30 more to stay.' : 'Mist gathers; you fade at 60 minutes idle. Act now to stay.');
    });
  }

  /** LINK BODY migration: with the beam off, Souls the old idle beam took (`gone`, not away by travel) come back. Their rows
   *  turn green (no announcement: the body rule places them asleep); returns their ids. `dryRun` only lists them. */
  restoreGone(dryRun = false): string[] {
    if (!this.enabled || this.beam) return [];
    const ids = this.gone().filter(id => !this.isAway(id));
    if (!dryRun) for (const id of ids) tx(this.core.db, () => { const r = this.row(id); if (r?.colour === 'gone') this.set(id, this.core.now(), 'green'); });
    return ids;
  }
  /** Souls currently faded out (colour `gone`). Durable, so a restarted Ledger re-learns who is absent. */
  gone(): string[] {
    if (!this.enabled) return [];
    const live = new Set(this.core.liveSoulIds());
    return (this.core.db.prepare("SELECT soul_id FROM edge_comms_activity WHERE world_id = ? AND colour = 'gone'").all(this.core.worldId) as {soul_id: string}[]).map(r => r.soul_id).filter(id => live.has(id));
  }
  /** Spectator roster: every live Soul that is not green (yellow/red warn rings, gone hidden). Empty when off. */
  roster(): {soulId: string; colour: FadeColour; idleSeconds: number; away?: true}[] {
    if (!this.enabled) return [];
    return this.core.liveSoulIds().flatMap(soulId => { const s = this.status(soulId); return s && s.colour !== 'green' ? [{soulId, ...s, ...(s.colour === 'gone' && this.isAway(soulId) ? {away: true as const} : {})}] : []; });
  }

  status(soulId: string): {colour: FadeColour; idleSeconds: number; held?: string} | null {
    if (!this.enabled) return null;
    const r = this.row(soulId);
    if (!r) return {colour: 'green', idleSeconds: 0};
    if (!this.beam) return r.colour === 'gone' ? {colour: 'gone', idleSeconds: Math.floor((this.core.now() - r.last_at) / 1000)} : {colour: 'green', idleSeconds: 0};
    const now = this.core.now(), held = r.colour === 'gone' ? null : this.heldNow(soulId, r, now);
    if (held) return {colour: 'green', idleSeconds: 0, held};
    const idle = now - r.last_at;
    return {colour: r.colour === 'gone' ? 'gone' : colourAt(idle), idleSeconds: Math.floor(idle / 1000)};
  }
}
