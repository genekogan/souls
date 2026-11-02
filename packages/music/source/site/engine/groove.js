// Sim.groove: feel, time and micro-dynamics, all compose-side.
//
// The conductor gives every piece one global swing and symmetric per-track jitter; everything else is a grid.
// Real feel is systematic, not random: the snare sits late on 2 and 4, the hats lean forward, the bass pushes
// its syncopations while the backbeat drags, the singer floats over all of it, and the band breathes at the
// big moments. This module is a set of pure transforms over a cycle's events array, so it slots into the
// existing contract: it writes the existing `delay` field (seconds, added to the scheduled time), scales `vel`,
// and never moves `beat`, so the linter's grid statistics stay meaningful. Nothing changes for a piece that
// doesn't call it. It uses no Tone, so it is lint-safe.
//
//   const G = Sim.groove;
//   // 1. groove templates: per-subdivision timing offsets and velocity weights over a bar, per track (or per
//   //    kit voice inside a drums track):
//   events = G.apply(events, { bpm, bpb: 4, tracks: {
//     bass:  { template: "funk16", late: 4 },                          // 16th swing, syncopations push, +4 ms
//     keys:  { template: "mpc58", late: 12, vels: false },             // sits behind the beat, no accents
//     drums: { voices: { snare: "laidback", hatClosed: "pushed", hatOpen: "pushed", kick: "straight" } },
//   }});
//   // 2. tempo gestures (ritardando into a return, a lift, a breath). The conductor accepts one tempo change
//   //    per cycle, at the cycle's start, ramped over rampBeats; so build a script keyed by cycle-within-lap:
//   const tempo = G.tempoScript(88, [{ at: 14, bpm: 80, rampBeats: 8 }, { at: 15, bpm: 91, rampBeats: 4, hold: true }, { at: 19, bpm: 88 }]);
//   return { events, tempo: tempo(cycleInLap), ... };                  // null when nothing changes
//   // 3. rubato for a line: stretch and compress the lead's timing within a phrase (early–late–early, lingering
//   //    on the high note, a breath after a leap) while the accompaniment keeps time:
//   events = G.rubato(events, { track: "lead", bpm, bpb, amount: 0.8, linger: "high" });
//   // 4. micro-dynamics: accent patterns, ghost-note rules, a crescendo through a fill:
//   events = G.accents(events, { track: "clav", pattern: [1, 0.72, 0.88, 0.7], unit: 0.25 });
//   events = G.ghosts(events, { track: "drums", vel: 0.22, dur: 0.08 });  // events flagged { ghost: true }
//   events = G.crescendo(events, { tracks: ["drums"], from: 14, to: 16, v0: 0.7, v1: 1.1 });
//
// Limits, honestly: `delay` can only push a note later, and the conductor's callback runs about 100 ms ahead of
// the audio, so pulls (early notes) are clamped to maxPull (30 ms by default). Feel is relative, so a template
// whose earliest slot is 0 and whose others are late sounds exactly like one that pulls; think "who waits for
// whom". Tempo changes land at cycle starts only: use a small cycleBars (2 or 4) where tempo gestures matter.
// A fermata cannot stop the transport: compose it (G.hold extends the chord, G.breath inserts the rest, the
// tempo script ramps down into it and snaps back "a tempo" after).
(function (root) {
  "use strict";
  const Sim = (root.Sim = root.Sim || {});
  const G = {};
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const num = (x, d = 0) => (Number.isFinite(x) ? x : d);

  // ------------------------------------------------------------------ templates
  // Each named template is a function of the bar's subdivision count giving { unit, offsets (beats), ms, vels }.
  // Per-beat patterns ([slot0, slot1, slot2, slot3] of 16ths) are tiled across the bar; bar-level patterns are not.
  const tile = (pat, n) => Array.from({ length: n }, (_, i) => pat[i % pat.length]);
  const zeros = (n) => new Array(n).fill(0);
  const SWING16 = (pct, vels = [1, 0.74, 0.88, 0.72]) => ({ unit: 0.25, perBeat: true, offsets: [0, (pct - 0.5) * 0.5, 0, (pct - 0.5) * 0.5], vels });
  const BACKBEAT_MS = (ms, bpb) => { const a = zeros(bpb * 4); for (let b = 1; b < bpb; b += 2) a[b * 4] = ms; return a; };
  const NAMED = {
    /** no offsets, flat velocities */
    straight: () => ({ unit: 0.25, perBeat: true, offsets: [0, 0, 0, 0], vels: [1, 1, 1, 1] }),
    /** MPC-style 16th swing at 54 / 58 / 62 / 66 % (offbeat 16ths late by a fraction of the 8th) */
    mpc54: () => SWING16(0.54), mpc58: () => SWING16(0.58), mpc62: () => SWING16(0.62), mpc66: () => SWING16(0.66),
    /** a shuffle that isn't triplets: the offbeat 8th sits at ~62 %, the "e" is early and soft */
    shuffle: () => ({ unit: 0.25, perBeat: true, offsets: [0, -0.02, 0.12, 0.05], vels: [1, 0.55, 0.85, 0.6] }),
    /** 8th-note boogie: the offbeat 8th a hair late, strong on 1 and 3 */
    boogie: () => ({ unit: 0.25, perBeat: true, offsets: [0, 0.01, 0.07, 0.03], vels: [1, 0.7, 0.86, 0.7] }),
    /** funk 16ths: 56 % swing, the "e" slightly early (pushing), the "a" late (dragging into the next beat) */
    funk16: () => ({ unit: 0.25, perBeat: true, offsets: [0, -0.015, 0.03, 0.045], vels: [1, 0.7, 0.9, 0.78] }),
    /** laid-back backbeat: 2 and 4 sit ~18 ms late and are the loudest things in the bar */
    laidback: (bpb) => ({ unit: 0.25, offsets: zeros(bpb * 4), ms: BACKBEAT_MS(18, bpb), vels: tile([0.92, 0.7, 0.8, 0.7], bpb * 4).map((v, i) => (i % 8 === 4 ? 1 : v)) }),
    /** a deeper drag for a slow funk / half-time snare */
    dragged: (bpb) => ({ unit: 0.25, offsets: zeros(bpb * 4), ms: BACKBEAT_MS(28, bpb), vels: tile([0.9, 0.7, 0.8, 0.7], bpb * 4).map((v, i) => (i % 8 === 4 ? 1 : v)) }),
    /** pushed hats: everything leans forward, the offbeats most; "e" and "a" quieter, the "and" clear */
    pushed: () => ({ unit: 0.25, perBeat: true, offsets: [0, 0, 0, 0], ms: [-5, -9, -6, -9], vels: [1, 0.62, 0.84, 0.66] }),
    /** Latin: the clave side leans. 2-3 son clave positions (1, and-of-2, 4 | 2, 3) sit a touch late and accented;
     *  the offbeat 16ths pull forward, so the whole thing rocks */
    clave: (bpb) => {
      const n = bpb * 4, offsets = tile([0, -0.02, 0.005, -0.02], n), vels = tile([0.92, 0.68, 0.8, 0.7], n);
      [0, 6, 12].forEach((s) => { if (s < n) { offsets[s] = 0.025; vels[s] = 1; } });
      [4, 8].forEach((s) => { if (s < n) { vels[s] = 0.84; } });
      return { unit: 0.25, offsets, vels };
    },
    /** jazz waltz / Viennese lean: beat 2 arrives early, beat 3 a little late and light */
    waltz: () => ({ unit: 0.5, offsets: [0, 0.02, -0.035, 0.0, 0.02, 0.03], vels: [1, 0.66, 0.78, 0.6, 0.7, 0.58] }),
    /** half-time pocket: the backbeat on 3 late and heavy, 16ths swung 56 % */
    halftime: (bpb) => { const t = SWING16(0.56); const o = tile(t.offsets, bpb * 4), ms = zeros(bpb * 4), v = tile(t.vels, bpb * 4); if (bpb >= 4) { ms[8] = 22; v[8] = 1; } return { unit: 0.25, offsets: o, ms, vels: v }; },
    /** disco / four-on-the-floor: tight kick, hats a touch ahead, the open hat on the "and" slightly late */
    disco: () => ({ unit: 0.25, perBeat: true, offsets: [0, -0.01, 0.015, -0.01], ms: [0, -4, 0, -4], vels: [1, 0.6, 0.9, 0.62] }),
  };
  G.templates = Object.keys(NAMED);

  /**
   * Build (or normalise) a groove template.
   *   G.template("mpc58")                       a named template (see G.templates)
   *   G.template({ unit, offsets, ms, vels })   arrays over one bar (unit beats per slot); shorter arrays tile
   *   opts: { bpb = 4, amount = 1 (scales offsets and ms), late = 0 (ms, added to every slot), vels = true }
   * Returns { unit, slots, offsets[beats], ms[ms], vels[multiplier], name }.
   */
  G.template = function (spec, opts = {}) {
    const bpb = opts.bpb ?? 4;
    if (spec && spec.slots && spec.offsets && spec.ms && spec.vels && spec.unit) return spec; // already built
    let raw;
    if (typeof spec === "string") { if (!NAMED[spec]) throw new Error(`Sim.groove: no template "${spec}" (have ${G.templates.join(", ")})`); raw = NAMED[spec](bpb); }
    else raw = spec || NAMED.straight(bpb);
    const unit = raw.unit || 0.25;
    const slots = Math.max(1, Math.round(bpb / unit));
    const amount = num(opts.amount, 1);
    const fill = (arr, def) => (arr && arr.length ? tile(arr.map((x) => num(x, def)), slots) : new Array(slots).fill(def));
    const offsets = fill(raw.offsets, 0).map((x) => x * amount);
    const ms = fill(raw.ms, 0).map((x) => x * amount + num(opts.late, 0));
    const vels = opts.vels === false ? new Array(slots).fill(1) : fill(raw.vels, 1);
    return { unit, slots, offsets, ms, vels, name: typeof spec === "string" ? spec : raw.name || "custom" };
  };

  /** Slot index of a beat position within the bar for a template, or -1 when the note is off the template's grid. */
  function slotOf(beat, tpl, tol = 0.03) {
    const p = beat / tpl.unit, i = Math.round(p);
    if (Math.abs(p - i) > tol / tpl.unit) return -1;
    return ((i % tpl.slots) + tpl.slots) % tpl.slots;
  }
  G.slotOf = slotOf;

  function normSpec(spec, bpb) {
    if (spec == null) return null;
    if (typeof spec === "string" || spec.slots || spec.offsets || spec.unit) return { tpl: G.template(spec, { bpb }) };
    const o = spec;
    const out = { late: num(o.late, 0), when: o.when || null, voices: null, tpl: null };
    if (o.template != null) out.tpl = G.template(o.template, { bpb, amount: o.amount, late: o.late, vels: o.vels });
    if (o.voices) { out.voices = {}; for (const [v, s] of Object.entries(o.voices)) out.voices[v] = normSpec(s, bpb); }
    return out;
  }

  /**
   * Apply groove templates per track. opts: { bpm (required), bpb = 4, tracks: { name: spec }, maxPull = 0.03, cycle }.
   *   spec: a template name, a template, or { template, amount, late (ms), vels (false = timing only),
   *         voices: { kitVoice: spec } (for drums tracks: the event's `note` picks the sub-template),
   *         when: (ev) => bool (only matching events) }.
   * Writes `delay` (seconds, added to any existing delay) and scales `vel`. Events flagged { nogroove: true }
   * and events of tracks not listed pass through untouched. Returns a new array.
   */
  G.apply = function (events, opts = {}) {
    const bpm = opts.bpm, bpb = opts.bpb ?? 4, maxPull = num(opts.maxPull, 0.03);
    if (!(bpm > 0)) throw new Error("Sim.groove.apply: opts.bpm is required");
    const spb = 60 / bpm;
    const specs = {};
    for (const [t, s] of Object.entries(opts.tracks || {})) specs[t] = normSpec(s, bpb);
    return events.map((ev) => {
      let sp = specs[ev.track];
      if (!sp || ev.nogroove) return ev;
      if (sp.when && !sp.when(ev)) return ev;
      if (sp.voices && typeof ev.note === "string" && sp.voices[ev.note]) sp = sp.voices[ev.note];
      if (!sp.tpl) return ev;
      const tpl = sp.tpl;
      const beat = ((ev.beat % bpb) + bpb) % bpb;
      const s = slotOf(beat, tpl);
      let sec = 0, vm = 1;
      if (s >= 0) { sec = tpl.offsets[s] * spb + tpl.ms[s] / 1000; vm = tpl.vels[s]; }
      else sec = tpl.ms.length ? (sp.late || 0) / 1000 : 0; // off-grid notes (triplets, rolls) keep only the constant lag
      let delay = num(ev.delay, 0) + sec;
      const first = opts.cycle === 0 && ev.bar <= 0 && ev.beat <= 0.01;
      delay = Math.max(first ? 0 : -maxPull, delay);
      const vel = ev.vel == null ? ev.vel : clamp(ev.vel * vm, 0.05, 1);
      return { ...ev, delay, vel };
    });
  };

  // ------------------------------------------------------------------ tempo gestures
  /**
   * A tempo script for a lap: gestures keyed by cycle index (within the lap, or absolute if you prefer).
   *   G.tempoScript(base, [{ at, bpm | factor, rampBeats = 0, hold = false }, ...]) -> (cycle) => tempo | null
   * The cycle after a gesture snaps back to `base` ("a tempo") unless the gesture says hold: true (then the
   * tempo stays until the next gesture) or another gesture sits on that cycle. Pass the result's value straight
   * through as compose()'s `tempo`; the conductor ramps linearly over rampBeats from the cycle's first beat.
   */
  G.tempoScript = function (base, gestures = []) {
    const byAt = new Map();
    for (const g of gestures) byAt.set(g.at, { bpm: g.bpm != null ? g.bpm : base * num(g.factor, 1), rampBeats: Math.max(0, num(g.rampBeats, 0)), hold: !!g.hold });
    const restoreAt = new Set();
    for (const [at, g] of byAt) if (!g.hold && !byAt.has(at + 1)) restoreAt.add(at + 1);
    return function (cycle) {
      const g = byAt.get(cycle);
      if (g) return { bpm: g.bpm, rampBeats: g.rampBeats };
      if (restoreAt.has(cycle)) return { bpm: base, rampBeats: 0 };
      return null;
    };
  };
  /** Convenience shapes (all return a gesture object for tempoScript). */
  G.ritardando = (at, toBpm, rampBeats, hold = false) => ({ at, bpm: toBpm, rampBeats, hold });
  G.accelerando = (at, toBpm, rampBeats, hold = true) => ({ at, bpm: toBpm, rampBeats, hold });
  G.aTempo = (at, bpm) => ({ at, bpm, rampBeats: 0, hold: true });
  /** Cumulative ramp over several cycles (an accelerando over a lap): one gesture per cycle, each holding. */
  G.ramp = (fromCycle, toCycle, fromBpm, toBpm, cycleBeats) => {
    const out = [];
    for (let c = fromCycle; c <= toCycle; c++) out.push({ at: c, bpm: fromBpm + ((toBpm - fromBpm) * (c - fromCycle + 1)) / (toCycle - fromCycle + 1), rampBeats: cycleBeats, hold: true });
    return out;
  };

  /**
   * A composed breath: insert `beats` of silence at absolute beat `from` (within the cycle) by moving later
   * events back on the grid. Events pushed past the cycle's end are dropped (returned on `.spilled` so a piece
   * can carry them into the next cycle via state). opts: { bpb = 4, cycleBars, from = 0, tracks (all) }.
   */
  G.breath = function (events, beats, opts = {}) {
    const bpb = opts.bpb ?? 4, from = num(opts.from, 0), only = opts.tracks ? new Set(opts.tracks) : null;
    const end = opts.cycleBars ? opts.cycleBars * bpb : Infinity;
    const out = [], spilled = [];
    for (const ev of events) {
      const abs = ev.bar * bpb + ev.beat;
      if ((only && !only.has(ev.track)) || abs < from - 1e-9) { out.push(ev); continue; }
      const a2 = abs + beats;
      if (a2 >= end - 1e-9) { spilled.push({ ...ev, bar: 0, beat: a2 - end }); continue; }
      const bar = Math.floor(a2 / bpb + 1e-9);
      out.push({ ...ev, bar, beat: +(a2 - bar * bpb).toFixed(4) });
    }
    out.spilled = spilled;
    return out;
  };
  /** A fermata on a chord: lengthen every event starting at (bar, beat) [of `tracks`] by `extra` beats. */
  G.hold = function (events, { bar, beat = 0, extra = 2, tracks = null }) {
    const only = tracks ? new Set(tracks) : null;
    return events.map((ev) => (ev.bar === bar && Math.abs(ev.beat - beat) < 1e-6 && (!only || only.has(ev.track)) ? { ...ev, dur: ev.dur + extra } : ev));
  };

  // ------------------------------------------------------------------ rubato
  /**
   * Rubato for one track: stretch and compress its note timing within each phrase while the band keeps time.
   * opts: { track, bpm (required), bpb = 4, amount = 1, maxLate = 0.12 (s), maxPull = 0.025 (s),
   *         gap = 0.75 (beats of rest that end a phrase), linger = "high" | "long" | "both" | null,
   *         lingerMs = 55, leapMs = 18 (a leap of a 4th or more takes time), shape = "ela" | "late" | "push",
   *         rng (optional; ±8 ms of colour), legato = false (otherwise durations are trimmed so delayed notes
   *         don't swallow the next onset) }.
   * Shape "ela" (early–late–early): the phrase starts a touch ahead, relaxes behind the beat through the middle,
   * and catches up to land its last note on time. The highest (or longest) note of the phrase lingers.
   */
  G.rubato = function (events, opts = {}) {
    const { track } = opts;
    const bpm = opts.bpm, bpb = opts.bpb ?? 4;
    if (!(bpm > 0)) throw new Error("Sim.groove.rubato: opts.bpm is required");
    const spb = 60 / bpm, amount = num(opts.amount, 1);
    const maxLate = num(opts.maxLate, 0.12) * amount, maxPull = num(opts.maxPull, 0.025) * amount;
    const gap = num(opts.gap, 0.75), lingerMs = num(opts.lingerMs, 55) * amount, leapMs = num(opts.leapMs, 18) * amount;
    const linger = opts.linger === undefined ? "high" : opts.linger, shape = opts.shape || "ela";
    const r = opts.rng || null;
    const idx = [];
    events.forEach((ev, i) => { if (ev.track === track && typeof ev.note === "number" && !ev.norubato) idx.push(i); });
    if (idx.length < 2) return events;
    const abs = (ev) => ev.bar * bpb + ev.beat;
    idx.sort((a, b) => abs(events[a]) - abs(events[b]));
    // phrases: split at rests of `gap` beats or more
    const phrases = [[]];
    for (let k = 0; k < idx.length; k++) {
      const ev = events[idx[k]], prev = k ? events[idx[k - 1]] : null;
      if (prev && abs(ev) - (abs(prev) + prev.dur) >= gap - 1e-6) phrases.push([]);
      phrases[phrases.length - 1].push(idx[k]);
    }
    const out = events.slice();
    for (const ph of phrases) {
      const n = ph.length;
      if (n < 2) continue;
      const t0 = abs(events[ph[0]]), t1 = abs(events[ph[n - 1]]);
      const span = Math.max(1e-6, t1 - t0);
      let hi = -1, hiNote = -Infinity, lo = -1, loDur = -1;
      ph.forEach((i, k) => { const e = events[i]; if (e.note > hiNote) { hiNote = e.note; hi = k; } if (e.dur > loDur) { loDur = e.dur; lo = k; } });
      const lingerAt = new Set();
      if (linger === "high" || linger === "both") lingerAt.add(hi);
      if (linger === "long" || linger === "both") lingerAt.add(lo);
      const d = new Array(n).fill(0);
      ph.forEach((i, k) => {
        const u = (abs(events[i]) - t0) / span;
        let w;
        if (shape === "late") w = 0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, u * 1.25));      // behind all the way, most in the middle
        else if (shape === "push") w = -0.4 + 0.6 * Math.sin(Math.PI * u);                      // ahead, relaxing only mid-phrase
        else w = Math.sin(Math.PI * u) - 0.22 * (1 - u) - 0.1 * u;                                // ela: ahead, behind, home
        let sec = w * maxLate;
        if (k > 0) {
          const leap = Math.abs(events[i].note - events[ph[k - 1]].note);
          if (leap >= 5) sec += (leapMs / 1000) * Math.min(1, leap / 9);                       // a big leap takes a breath
        }
        if (lingerAt.has(k)) sec += lingerMs / 1000;
        if (lingerAt.has(k - 1)) sec += (lingerMs / 1000) * 0.6;                                  // the note after the linger waits
        if (lingerAt.has(k - 2)) sec += (lingerMs / 1000) * 0.25;
        if (r) sec += (r() + r() - 1) * 0.008 * amount;
        d[k] = clamp(sec, -maxPull, maxLate + lingerMs / 1000 + leapMs / 1000);
      });
      ph.forEach((i, k) => {
        const e = events[i];
        let dur = e.dur;
        if (!opts.legato && k < n - 1) {
          const nxt = events[ph[k + 1]];
          const room = abs(nxt) + d[k + 1] / spb - (abs(e) + d[k] / spb) - 0.04; // beats until the next (delayed) onset
          if (room > 0.1 && dur > room) dur = room;
        }
        out[i] = { ...e, delay: num(e.delay, 0) + d[k], dur, rubato: +d[k].toFixed(4) };
      });
    }
    return out;
  };

  // ------------------------------------------------------------------ micro-dynamics
  /**
   * Accent pattern: multiply `vel` by a per-slot pattern over the bar (tiled). opts: { track | tracks, pattern,
   * unit = 0.25, bpb = 4, voices (drums: only these kit voices), offGrid = 0.8 (multiplier for notes off the
   * pattern's grid) }. Events flagged { accent: true } get +0.12 after the pattern; { ghost: true } are skipped.
   */
  G.accents = function (events, opts = {}) {
    const tracks = new Set(opts.tracks || (opts.track ? [opts.track] : []));
    const unit = opts.unit ?? 0.25, bpb = opts.bpb ?? 4, slots = Math.round(bpb / unit);
    const pat = tile((opts.pattern || [1]).map((x) => num(x, 1)), slots);
    const voices = opts.voices ? new Set(opts.voices) : null;
    const tpl = { unit, slots };
    return events.map((ev) => {
      if (!tracks.has(ev.track) || ev.ghost || ev.vel == null) return ev;
      if (voices && !(typeof ev.note === "string" && voices.has(ev.note))) return ev;
      const s = slotOf(((ev.beat % bpb) + bpb) % bpb, tpl);
      const m = s >= 0 ? pat[s] : num(opts.offGrid, 0.8);
      return { ...ev, vel: clamp(ev.vel * m + (ev.accent ? 0.12 : 0), 0.05, 1) };
    });
  };
  /**
   * Ghost-note rules: events matching `match` (default: flagged { ghost: true }) get a fixed soft velocity and a
   * short duration. opts: { track | tracks, vel = 0.25, dur = 0.1 (beats; null keeps), relative = null (if set,
   * ghost vel = relative × the loudest non-ghost vel of the same bar and voice), match }.
   */
  G.ghosts = function (events, opts = {}) {
    const tracks = new Set(opts.tracks || (opts.track ? [opts.track] : []));
    const match = opts.match || ((ev) => !!ev.ghost);
    const vel = num(opts.vel, 0.25), dur = opts.dur === undefined ? 0.1 : opts.dur, rel = opts.relative;
    const loud = {};
    if (rel != null) for (const ev of events) { if (!tracks.has(ev.track) || match(ev) || ev.vel == null) continue; const k = `${ev.track}|${ev.bar}|${ev.note}`; loud[k] = Math.max(loud[k] || 0, ev.vel); }
    return events.map((ev) => {
      if (!tracks.has(ev.track) || !match(ev)) return ev;
      const k = `${ev.track}|${ev.bar}|${ev.note}`;
      const v = rel != null && loud[k] ? loud[k] * rel : vel;
      return { ...ev, vel: clamp(v, 0.05, 1), dur: dur == null ? ev.dur : Math.min(ev.dur, dur), ghost: true };
    });
  };
  /**
   * Crescendo (or diminuendo) across a span: `vel` scaled from v0 to v1 over absolute beats [from, to] within
   * the cycle. opts: { track | tracks, from, to, v0 = 0.7, v1 = 1.1, curve = 1 (>1 = late bloom), bpb = 4 }.
   */
  G.crescendo = function (events, opts = {}) {
    const tracks = new Set(opts.tracks || (opts.track ? [opts.track] : []));
    const bpb = opts.bpb ?? 4, from = num(opts.from, 0), to = num(opts.to, from + bpb), v0 = num(opts.v0, 0.7), v1 = num(opts.v1, 1.1), curve = num(opts.curve, 1);
    return events.map((ev) => {
      if (!tracks.has(ev.track) || ev.vel == null) return ev;
      const abs = ev.bar * bpb + ev.beat;
      if (abs < from - 1e-9 || abs > to + 1e-9) return ev;
      const u = to > from ? Math.pow((abs - from) / (to - from), curve) : 1;
      return { ...ev, vel: clamp(ev.vel * (v0 + (v1 - v0) * u), 0.05, 1) };
    });
  };
  /** A whole-band preset of per-track specs for G.apply (edit the result freely). */
  G.band = function (style, tracks = {}) {
    const P = {
      studio: { drums: { voices: { snare: "laidback", rockSnare: "laidback", rim: "laidback", hatClosed: "pushed", hatOpen: "pushed", hatPedal: "pushed", kick: "straight", softKick: "straight", kick808: "straight" } }, bass: { template: "funk16", late: 3 }, keys: { template: "mpc58", late: 10, vels: false }, lead: { template: "mpc54", late: 14, vels: false } },
      boogie: { drums: { voices: { snare: "laidback", hatClosed: "boogie", hatOpen: "boogie", kick: "straight" } }, bass: { template: "boogie", late: 2 }, keys: { template: "boogie", late: 8 } },
      latin: { drums: { template: "clave" }, bass: { template: "clave", late: 4 }, keys: { template: "clave", late: 6, vels: false } },
      waltz: { drums: { template: "waltz" }, bass: { template: "waltz", late: 4 }, keys: { template: "waltz", late: 10 } },
      disco: { drums: { voices: { snare: "laidback", clap: "laidback", hatClosed: "disco", hatOpen: "disco", kick909: "straight", kick: "straight" } }, bass: { template: "disco", late: 2 }, keys: { template: "disco", late: 8, vels: false } },
    };
    if (!P[style]) throw new Error(`Sim.groove.band: no style "${style}" (have ${Object.keys(P).join(", ")})`);
    const base = P[style], out = {};
    for (const [role, spec] of Object.entries(base)) { const name = tracks[role] === undefined ? role : tracks[role]; if (name) out[name] = spec; }
    return out;
  };

  Sim.groove = G;
})(typeof window !== "undefined" ? window : globalThis);
