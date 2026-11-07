// The clock announces moments and holds finished bodies for durability. It chooses no activities.
import { clockAt, DAY_TICKS } from '@souls/brain';
import type { WorldHost } from './world.ts';

export class LivingWorld {
  private queued = false;
  private capture = false;
  host: WorldHost;
  camp = false;
  constructor(host: WorldHost) {
    this.host = host;
    host.listeners.push({ onApplied: e => {
      if (e.kind !== 'rules') return;
      if (e.payload?.quiet || e.payload?.compact || e.payload?.quietEnded || e.payload?.dayTurn) this.queued = false;
      if (e.payload?.compact) this.capture = true;
    }, afterTick: tick => this.afterTick(tick) });
  }
  install(customs: string[]) {
    if (!this.host.living) return this.host.enqueue('rules', 'world', { dayConfig: { origin: this.host.engine.world.tick, dayTicks: DAY_TICKS, customs }, why: 'one world day per real hour; customs inform choices' });
    return Promise.resolve();
  }
  private afterTick(tick: number) {
    const h = this.host, living = h.living; if (!living) return;
    if (this.capture) { this.capture = false; h.saveSnapshot(true); }
    const c = clockAt(tick, living.origin, living.dayTicks);
    if (h.extra.continuousDayV1) {
      // Gene: no nightly quiet hours. Nothing pauses or holds anyone; the day turns as a plain event.
      if (!this.queued && living.quiet) { this.queued = true; void h.enqueue('rules', 'world', { quietEnded: true, day: c.day, why: 'continuous day: a legacy quiet ends at once, without compaction' }); return; }
      if (!this.queued && !living.quiet && c.day > living.lastDay) {
        this.queued = true;
        void h.enqueue('rules', 'world', { dayTurn: true, day: c.day, worldEvent: { id: 'first-light', text: 'First light. A new day begins.' }, why: 'continuous day: the day turns without pausing anyone' });
        return;
      }
    } else if (living.quiet) {
      if (!this.queued && h.engine.isQuiet?.()) {
        this.queued = true;
        const firstLight = c.day > living.lastDay;
        const adoptCamp = this.camp && h.engine.world.base.campus !== 'eden-camp';
        void h.enqueue('rules', 'world', { compact: true, day: c.day, firstLight, adoptCamp, ...(adoptCamp ? {anchors: h.engine.campAnchors?.()} : {}), restockCamp: firstLight,
          ...(firstLight ? { worldEvent: { id: 'first-light', text: 'First light. The place is quiet and a new day begins.' } } : {}), why: 'all controllers released; fresh Runtime from WorldState' });
      }
      return;
    }
    if (!h.extra.continuousDayV1 && !this.queued && (c.day > living.lastDay || (tick - h.lastSnapshotTick > 12000 && h.engine.canSnapshot && !h.engine.canSnapshot()))) {
      this.queued = true;
      void h.enqueue('rules', 'world', { quiet: true, day: c.day, why: c.day > living.lastDay ? 'renew the engine before first light' : 'overdue quiet checkpoint' });
      return;
    }
    const moments = [
      { phase: 0.25, id: 'midday', text: 'Midday. There is time to notice what is unfinished.' },
      { phase: 0.48, id: 'supper-bell', text: this.camp?'The supper bell rings. People often share food around this time; anyone may host or join.':'The evening light changes. People sometimes meet to share stories or enjoy the view.' },
      { phase: 0.55, id: 'dusk', text: 'Dusk. Lamps and the fire are inviting; it is a chance to reflect on the day.' },
      { phase: 0.75, id: 'night', text: 'Night. Some people seek sleep and others enjoy the quiet hours.' },
    ];
    const fired = (h.extra.moments ??= {}) as Record<string, number>;
    for (const moment of moments) if (c.phase >= moment.phase && fired[moment.id] !== c.day) {
      // A transient queue guard only; the applied event pins the durable marker.
      fired[moment.id] = c.day;
      void h.enqueue('rules', 'world', { worldEvent: { ...moment, day: c.day }, why: 'an observable world moment, never an instruction' });
    }
  }
}
