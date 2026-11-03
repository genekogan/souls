// Sim.Houseband: picks the piece that fits what is happening in the world and segues to it.
//   const band = new Sim.Houseband(conductor, { onChange })
//   band.cue("party", { energy: 0.8 })   // pick and play something for a party
//   band.setEnergy(0.3)                  // the room calms down: drums (then bass) drop out if the tune is hotter
//   band.next()                          // another tune for the same situation
// Tags come from the piece (`situations`, `energy`) or from Sim.catalog.tags.
(function (root) {
  "use strict";
  const Sim = root.Sim;

  class Houseband {
    constructor(conductor, hooks = {}) {
      this.conductor = conductor;
      this.hooks = hooks;
      this.situation = null;
      this.energy = 0.5;
      this.recent = [];
      this.busy = false;
    }

    tags(p) {
      const t = (Sim.catalog && Sim.catalog.tags[p.id]) || {};
      return { situations: p.situations || t.situations || [], energy: p.energy ?? t.energy ?? 0.5 };
    }

    /** Pieces for a situation, best first: situation rank, closeness in energy, and not just played. */
    candidates(situation, energy = this.energy) {
      return Sim.pieces.map((p) => {
        const t = this.tags(p), rank = t.situations.indexOf(situation);
        if (rank < 0) return null;
        const fit = [1, 0.8, 0.65][rank] ?? 0.5;
        const close = 1 - Math.min(1, Math.abs(t.energy - energy) * 1.6);
        const recent = this.recent.indexOf(p.id);
        const score = 0.55 * fit + 0.45 * close - (recent >= 0 ? 0.6 - 0.15 * recent : 0);
        return { piece: p, score };
      }).filter(Boolean).sort((a, b) => b.score - a.score);
    }

    /** Choose among the top few, weighted towards the best. */
    pick(situation, energy, exclude) {
      const c = this.candidates(situation, energy).filter((x) => x.piece !== exclude);
      if (!c.length) return null;
      const top = c.slice(0, 3), w = top.map((x, i) => Math.max(0.05, x.score) * [3, 1.6, 1][i]);
      let r = Math.random() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < top.length; i++) if ((r -= w[i]) <= 0) return top[i].piece;
      return top[0].piece;
    }

    async cue(situation, { energy = this.energy, piece = null } = {}) {
      if (this.busy) return null;
      this.situation = situation; this.energy = energy;
      const p = piece || this.pick(situation, energy, this.conductor.piece);
      if (!p) return null;
      await this.segue(p);
      return p;
    }
    next() { return this.situation ? this.cue(this.situation) : null; }

    /** Fade the current tune out, then start the next one; apply the energy trim. */
    async segue(p) {
      this.busy = true;
      try {
        const c = this.conductor;
        if (c.piece && c.out) {
          const now = Tone.now();
          c.out.gain.cancelScheduledValues(now);
          c.out.gain.setValueAtTime(c.out.gain.value, now);
          c.out.gain.linearRampToValueAtTime(0, now + 1.6);
          await new Promise((r) => setTimeout(r, 1600));
        }
        this.recent = [p.id, ...this.recent.filter((id) => id !== p.id)].slice(0, 4);
        if (this.hooks.play) await this.hooks.play(p); else await c.play(p);
        this.applyEnergy();
        if (this.hooks.onChange) this.hooks.onChange({ piece: p, situation: this.situation, energy: this.energy });
      } finally { this.busy = false; }
    }

    setEnergy(e) { this.energy = Math.max(0, Math.min(1, e)); this.applyEnergy(); }
    /** When the room is calmer than the tune, the drummer lays out, then the bass. */
    applyEnergy() {
      const c = this.conductor;
      if (!c.piece) return;
      const gap = this.tags(c.piece).energy - this.energy;
      c.autoMuted.clear();
      if (gap > 0.3) c.autoMuted.add("drums");
      if (gap > 0.5) c.autoMuted.add("bass");
    }
  }
  Sim.Houseband = Houseband;
})(typeof window !== "undefined" ? window : globalThis);
