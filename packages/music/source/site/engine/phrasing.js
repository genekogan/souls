// Sim.phrasing: articulation and phrase shaping, so a line sounds played rather than sequenced.
//
// Every note the conductor plays is an on/off with a velocity. What makes an SNES lead, a CS-80 line or a
// fretless bass feel like a player is what happens inside and between the notes: the scoop into a long note,
// the glide between two slurred notes, vibrato that arrives late and deepens, a fall-off at the end of a
// phrase, a breath before the next one. This module has two halves and a piece may use either or both.
//
// 1. Compose side (pure, deterministic, works on the events array):
//
//   Sim.phrasing.line(bars, { beatsPerBar, track, vel })
//       Notation → events. One string per bar: "r/0.5 G#5/2^v F#5/0.5~ E5/1~". Each token is Note/beats followed
//       by articulation marks (below); "r" is a rest. Bars must add up to beatsPerBar (it throws otherwise).
//   Sim.phrasing.parseArt("^2v~")  → { scoop: 2, vib: 1, legato: true }
//       Marks:  ~ legato (glide in from the previous note)   . staccato   > accent   _ tenuto
//               ^[n] scoop in from n semitones below (2)      f[n] fall-off n semitones at the end (3)
//               b[n] bend up n semitones over the note (2)     v[x] vibrato, x times the voice's depth (1; v0 none)
//               g[n] grace note n semitones before (-2, or a scale step when articulate gets `scale`)
//               m mordent (note, upper neighbour, note)       s swell (crescendo inside the note)   t tremolo
//   Sim.phrasing.phrases(line, { gap = 0.75, beatsPerBar })  → [{ from, to }]  (a new phrase after every rest ≥ gap)
//   Sim.phrasing.articulate(line, phrases, opts) → events (the same objects, mutated, plus inserted grace notes)
//       phrases: [{ from, to, dyn, legato, breath, lengthen }] in beats from bar 0 of the line.
//         dyn: [v0, v1] velocity multipliers across the phrase, or "<" ">" "arch".
//         legato: true slurs every adjacent pair (gap ≤ opts.slurGap); "all" also closes gaps ≤ 0.3 beat.
//         breath (default true): the first note enters a little late (ev.delay) and the previous phrase's last
//         note is cut short to leave a gap; lengthen (default opts.lengthen): the phrase-final note is held longer.
//       opts: { beatsPerBar = 4, scale(pos) → pcs (for g marks), slurGap = 0.02, overlap = 0.05 (beats a slurred
//              note's predecessor overlaps it), staccato = 0.5, accent = 0.12, lengthen = 1.12, breathLate = 0.035 s,
//              breathGap = 0.12 beats, grace = 0.125 beats, mordent = 0.125 beats }
//       Fields written on events (all read by the wrapper below): legato, glide, staccato, tenuto, accent, scoop, fall,
//       bend, bendTime, vib, trem, swell, breath, phraseStart, phraseEnd; and vel / dur / delay are adjusted.
//
// 2. Instrument side:
//
//   const lead = Sim.phrasing.wrap(ctx, new Tone.MonoSynth({...}), { volume: -2, glide: 0.07, vibrato: { rate: 5.4, depth: 0.09, delay: 0.3 } });
//   return { lead: { layer: "melody", play: (t, e, d) => lead.play(t, e, d) } };
//       Chains synth → Vibrato → Tremolo → Gain(out). play() reads the fields above and realizes them: legato via
//       the synth's portamento (Tone glides only while the previous note still sounds, which articulate arranges
//       by overlapping slurred notes); scoop / bend / fall as detune ramps; delayed deepening vibrato; tremolo;
//       swell on the output gain; staccato and tenuto change the release; accent opens the filter envelope.
//       `source` may be a Tone Monophonic (MonoSynth, Synth, FMSynth, AMSynth) or an { synth, out } object such as
//       I.analog returns. Works under tools/load.mjs's Tone mock; never passes NaN to a parameter.
//   Sim.phrasing.breath(ctx, dest, { level: -28, freq: 2200 }) → (time, vel) a pink-noise breath; pass it as
//       opts.breath to wrap() and it sounds on notes marked `breath` (phrase starts).
//
// Pieces that don't call any of this are unaffected.
(function (root) {
  "use strict";
  const Sim = (root.Sim = root.Sim || {});
  const T = Sim.theory, I = Sim.instruments;
  const fin = (x, d) => (typeof x === "number" && Number.isFinite(x) ? x : d);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const db = (x) => Math.pow(10, x / 20);

  // ---------------------------------------------------------------- notation
  /** "^2v~" → articulation fields. Unknown characters are ignored. */
  function parseArt(str) {
    const a = {};
    if (typeof str !== "string") return a;
    const re = /([~.>_^fbvgmst])(-?\d+(?:\.\d+)?)?/g;
    let m;
    while ((m = re.exec(str))) {
      const n = m[2] != null && m[2] !== "" ? parseFloat(m[2]) : null;
      switch (m[1]) {
        case "~": a.legato = true; break;
        case ".": a.staccato = true; break;
        case ">": a.accent = true; break;
        case "_": a.tenuto = true; break;
        case "^": a.scoop = fin(n, 2); break;
        case "f": a.fall = fin(n, 3); break;
        case "b": a.bend = fin(n, 2); break;
        case "v": a.vib = fin(n, 1); break;
        case "g": a.grace = n == null ? "step" : n; break;
        case "m": a.mordent = fin(n, 0) || true; break;
        case "s": a.swell = fin(n, 1); break;
        case "t": a.trem = fin(n, 1); break;
      }
    }
    return a;
  }

  /** Notation → events. bars: array of strings (or one string with | separators). Tokens Note/beats[marks] or r/beats. */
  function line(bars, o = {}) {
    const bpb = o.beatsPerBar ?? 4;
    if (typeof bars === "string") bars = bars.split("|").map((s) => s.trim()).filter(Boolean);
    const out = [];
    bars.forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/(\d+(?:\.\d+)?)(.*)$/.exec(tok); // the duration never eats a staccato dot
        if (!m) throw new Error(`phrasing.line: bad token "${tok}" in bar ${bi + 1}: ${bar}`);
        const dur = parseFloat(m[2]);
        if (m[1] !== "r") {
          const e = { bar: bi, beat: pos, dur, note: T.midi(m[1]), vel: o.vel ?? 0.75 };
          if (o.track) e.track = o.track;
          if (m[3]) e.art = m[3];
          out.push(e);
        }
        pos += dur;
      });
      if (Math.abs(pos - bpb) > 1e-6) throw new Error(`phrasing.line: bar ${bi + 1} has ${pos} beats, not ${bpb}: ${bar}`);
    });
    return out;
  }

  // ---------------------------------------------------------------- phrases
  const posOf = (bpb) => (e) => e.bar * bpb + e.beat;
  /** Phrase marks from the rests in a line: a new phrase wherever the gap before a note is ≥ gap beats. */
  function phrases(evs, o = {}) {
    const bpb = o.beatsPerBar ?? 4, gap = o.gap ?? 0.75, pos = posOf(bpb);
    const xs = evs.filter(isPitched).slice().sort((a, b) => pos(a) - pos(b));
    if (!xs.length) return [];
    const out = [];
    let from = pos(xs[0]);
    for (let i = 1; i < xs.length; i++) {
      const prevEnd = pos(xs[i - 1]) + xs[i - 1].dur;
      if (pos(xs[i]) - prevEnd >= gap - 1e-6) { out.push({ from, to: pos(xs[i]) }); from = pos(xs[i]); }
    }
    out.push({ from, to: pos(xs[xs.length - 1]) + xs[xs.length - 1].dur + 1e-6 });
    return out;
  }
  function isPitched(e) { return typeof e.note === "number" || (Array.isArray(e.note) && typeof e.note[0] === "number"); }
  function dynCurve(dyn) {
    if (Array.isArray(dyn)) return (x) => dyn[0] + (dyn[1] - dyn[0]) * x;
    if (dyn === "<") return (x) => 0.82 + 0.18 * x;
    if (dyn === ">") return (x) => 1 - 0.18 * x;
    if (dyn === "arch") return (x) => 0.86 + 0.14 * Math.sin(Math.PI * Math.min(1, x * 1.15));
    return null;
  }

  /**
   * Write articulation onto a monophonic line. `evs` are conductor events (bar, beat, dur, note, vel, art?);
   * `marks` are phrase marks in beats from the line's bar 0 (see the header). Returns the events sorted, with
   * grace and mordent notes inserted; the original objects are mutated.
   */
  function articulate(evs, marks, o = {}) {
    const bpb = o.beatsPerBar ?? 4, pos = posOf(bpb);
    const place = (e, p) => { e.bar = Math.floor(p / bpb + 1e-9); e.beat = +(p - e.bar * bpb).toFixed(6); return e; };
    const others = evs.filter((e) => !isPitched(e));
    let xs = evs.filter(isPitched).sort((a, b) => pos(a) - pos(b));
    const slurGap = o.slurGap ?? 0.02, overlap = o.overlap ?? 0.05;
    const graceLen = o.grace ?? 0.125, mordLen = o.mordent ?? 0.125;
    // 1. explicit marks: art strings fill in fields the event does not already carry
    for (const e of xs) if (e.art != null) { const a = parseArt(e.art); for (const k in a) if (e[k] === undefined) e[k] = a[k]; }
    // 2. phrases
    if (marks === "auto" || marks == null) marks = phrases(xs, { beatsPerBar: bpb, gap: o.gap });
    marks = marks.slice().sort((a, b) => a.from - b.from);
    marks.forEach((ph, pi) => {
      const inPh = xs.filter((e) => pos(e) >= ph.from - 1e-6 && pos(e) < ph.to - 1e-6);
      if (!inPh.length) return;
      const first = inPh[0], last = inPh[inPh.length - 1];
      first.phraseStart = true; last.phraseEnd = true;
      const span = Math.max(1e-6, pos(last) + last.dur - pos(first));
      const curve = dynCurve(ph.dyn);
      if (curve) for (const e of inPh) e.vel = clamp(fin(e.vel, 0.75) * curve((pos(e) - pos(first)) / span), 0.05, 1);
      // slurs
      if (ph.legato) {
        const close = ph.legato === "all" ? 0.3 : slurGap;
        for (let i = 1; i < inPh.length; i++) {
          const a = inPh[i - 1], b = inPh[i];
          if (b.legato === false || b.staccato || a.staccato || b.grace != null || b.mordent) continue;
          const gap = pos(b) - (pos(a) + a.dur);
          if (gap <= close + 1e-6) { b.legato = true; a.dur = pos(b) - pos(a); } // overlap is added in step 5
        }
      }
      // the phrase-final note is held a little longer (an agogic accent), never into the next phrase
      const lengthen = ph.lengthen === false ? 1 : fin(ph.lengthen, fin(o.lengthen, 1.12));
      if (!last.staccato && lengthen !== 1) {
        const next = marks[pi + 1];
        const cap = next ? next.from - pos(last) - fin(o.breathGap, 0.12) : Infinity;
        last.dur = Math.max(Math.min(last.dur, cap), Math.min(last.dur * lengthen, cap));
      }
      // breath: a late entry, and the previous phrase's last note gives way
      if (ph.breath !== false && (pi > 0 || o.breathFirst)) {
        first.breath = true;
        first.delay = fin(first.delay, 0) + fin(ph.breathLate, fin(o.breathLate, 0.035));
        const before = xs.filter((e) => pos(e) < ph.from - 1e-6);
        const prev = before[before.length - 1];
        if (prev) prev.dur = Math.max(0.1, Math.min(prev.dur, pos(first) - pos(prev) - fin(o.breathGap, 0.12)));
      }
    });
    // 3. per-note shaping
    for (const e of xs) {
      e.vel = fin(e.vel, 0.75);
      if (e.staccato) { e.dur = Math.max(fin(o.minDur, 0.12), e.dur * fin(o.staccato, 0.5)); e.legato = false; }
      if (e.accent) e.vel = clamp(e.vel + fin(o.accent, 0.12), 0.05, 1);
      if (e.tenuto) e.vel = clamp(e.vel * 1.03, 0.05, 1);
    }
    // 4. ornaments: inserted notes steal from the note before (grace) or from the note itself (mordent)
    const inserted = [];
    const stripped = (e) => { const c = { ...e }; for (const k of ["art", "scoop", "fall", "bend", "bendTime", "vib", "trem", "swell", "grace", "mordent", "accent", "staccato", "tenuto", "breath", "phraseStart", "phraseEnd", "legato", "glide", "delay"]) delete c[k]; return c; };
    xs.forEach((e, i) => {
      const main = Array.isArray(e.note) ? e.note[0] : e.note;
      if (e.grace != null) {
        let g;
        if (typeof e.grace === "number") g = main + e.grace;
        else { const pcs = o.scale ? o.scale(pos(e), e) : null; g = pcs && pcs.length ? T.step(main, -1, pcs) : main - 2; }
        const at = pos(e) - graceLen;
        const prev = xs[i - 1];
        if (prev && pos(prev) + prev.dur > at) prev.dur = Math.max(0.1, at - pos(prev));
        inserted.push(place({ ...stripped(e), note: g, dur: graceLen * 0.9, vel: clamp(e.vel * 0.6, 0.05, 1), grace: undefined }, at));
        e.legato = true; e.glide = fin(e.glide, 0.03);
        delete e.grace;
      } else if (e.mordent) {
        const up = typeof e.mordent === "number" && e.mordent > 0 ? main + e.mordent
          : (() => { const pcs = o.scale ? o.scale(pos(e), e) : null; return pcs && pcs.length ? T.step(main, 1, pcs) : main + 2; })();
        if (e.dur > 3 * mordLen) {
          const p0 = pos(e);
          inserted.push(place({ ...stripped(e), note: main, dur: mordLen, vel: e.vel, scoop: e.scoop, breath: e.breath, phraseStart: e.phraseStart, delay: e.delay }, p0));
          inserted.push(place({ ...stripped(e), note: up, dur: mordLen, vel: clamp(e.vel * 0.85, 0.05, 1), legato: true, glide: 0.02 }, p0 + mordLen));
          place(e, p0 + 2 * mordLen); e.dur -= 2 * mordLen; e.legato = true; e.glide = fin(e.glide, 0.02);
          delete e.scoop; delete e.breath; delete e.phraseStart; delete e.delay;
        }
        delete e.mordent;
      }
    });
    xs = xs.concat(inserted).sort((a, b) => pos(a) - pos(b));
    // 5. slurred notes: the note before overlaps them a hair so the synth is still sounding when the glide begins
    for (let i = 1; i < xs.length; i++) {
      const a = xs[i - 1], b = xs[i];
      if (b.legato && !a.staccato && pos(b) - (pos(a) + a.dur) <= 0.3 + 1e-6) a.dur = Math.max(a.dur, pos(b) - pos(a) + overlap);
      if (b.legato && b.glide === undefined && o.glide != null) b.glide = o.glide;
    }
    for (const e of xs) { e.dur = Math.max(0.05, +e.dur.toFixed(6)); delete e.art; }
    return others.concat(xs);
  }

  // ---------------------------------------------------------------- instrument wrapper
  /**
   * Wrap a monophonic Tone synth (or an { synth, out } object) so play(time, ev, durSec) realizes the fields above.
   * Returns { out, synth, play }. Route `out` like any instrument (I.place, I.send).
   */
  function wrap(ctx, source, o = {}) {
    const s = source && source.synth ? source.synth : source;
    if (!s || typeof s.triggerAttackRelease !== "function") throw new Error("phrasing.wrap: source must be a Tone monophonic synth or { synth, out }");
    const out = ctx.keep(new Tone.Gain(db(fin(o.volume, 0))));
    const gain0 = db(fin(o.volume, 0));
    const vo = { rate: 5.4, depth: 0.08, delay: 0.3, rise: 0.4, deepen: 1.25, auto: true, ...(o.vibrato || {}) };
    const to = { rate: 6, depth: 0.5, ...(o.tremolo || {}) };
    const vib = ctx.keep(new Tone.Vibrato({ frequency: fin(vo.rate, 5.4), depth: 0, maxDelay: 0.01 }));
    const trem = ctx.keep(new Tone.Tremolo({ frequency: fin(to.rate, 6), depth: 0, spread: 0 }).start());
    (source && source.out ? source.out : s).connect(vib); vib.connect(trem); trem.connect(out);
    vib.depth.value = 0; trem.depth.value = 0;
    const mono = I.monotonic(out);
    const glide = fin(o.glide, 0.06), scoopT = fin(o.scoopTime, 0.09), fallT = fin(o.fallTime, 0.25), bendT = fin(o.bendTime, 0.5);
    const release = fin(o.release, fin(s.envelope && s.envelope.release, 0.25));
    const staccRel = fin(o.staccatoRelease, 0.05);
    const hasFilt = !!(s.filterEnvelope && typeof s.filterEnvelope === "object");
    const baseOct = hasFilt ? fin(s.filterEnvelope.octaves, 3) : 0;
    const accentBright = fin(o.accentBright, 0.6);
    let lastEnd = -Infinity;
    return {
      out, synth: s, vib, trem,
      play(time, ev, dur) {
        const m = Array.isArray(ev.note) ? ev.note[0] : ev.note;
        if (typeof m !== "number" || !Number.isFinite(m)) return;
        dur = Math.max(0.03, fin(dur, 0.3));
        const vel = clamp(fin(ev.vel, 0.7), 0.05, 1);
        const t = mono(time), f = T.hz(m);
        // the glide only happens if the previous note is still sounding (Tone's rule); articulate() overlaps them
        const slurred = !!ev.legato && lastEnd > t - 0.02;
        s.portamento = slurred ? clamp(fin(ev.glide, glide), 0.005, 2) : 0;
        if (s.envelope) s.envelope.release = ev.staccato ? staccRel : ev.tenuto ? release * 1.5 : release;
        if (hasFilt) s.filterEnvelope.octaves = baseOct + (ev.accent ? accentBright : 0);
        s.triggerAttackRelease(f, dur, t, vel);
        lastEnd = t + dur;
        // pitch: scoop in, bend, fall off (cents on detune)
        const det = s.detune;
        if (det) {
          det.cancelAndHoldAtTime(t);
          let t0 = t, level = 0;
          const scoop = fin(ev.scoop, 0), bend = fin(ev.bend, 0), fall = fin(ev.fall, 0);
          if (scoop) { const st = Math.min(scoopT, dur * 0.5); det.setValueAtTime(-scoop * 100, t); det.linearRampToValueAtTime(0, t + st); t0 = t + st; }
          else det.setValueAtTime(0, t);
          if (bend) { const bt = Math.min(fin(ev.bendTime, bendT), Math.max(0.05, dur - (t0 - t) - 0.05)); det.setValueAtTime(0, t0); det.linearRampToValueAtTime(bend * 100, t0 + bt); level = bend * 100; }
          if (fall) { const tf = Math.max(t0 + 0.02, t + dur - Math.min(fallT, dur * 0.5)); det.setValueAtTime(level, tf); det.linearRampToValueAtTime(level - fall * 100, t + dur + release * 0.6); }
        }
        // vibrato: delayed, then deepening; long notes get it by default
        const vd = ev.vib === undefined ? (vo.auto && dur > vo.delay + 0.15 ? 1 : 0) : fin(ev.vib, 0);
        const depth = clamp(fin(vo.depth, 0.08) * vd, 0, 1);
        vib.depth.cancelAndHoldAtTime(t);
        if (!slurred) vib.depth.setValueAtTime(0, t);
        const delay = slurred ? vo.delay * 0.4 : vo.delay;
        if (depth > 0 && dur > delay + 0.1) {
          const d1 = t + delay, rise = Math.min(vo.rise, Math.max(0.05, dur - delay));
          vib.depth.setValueAtTime(slurred ? Math.min(depth, 0.5 * depth) : 0, d1);
          vib.depth.linearRampToValueAtTime(depth * 0.8, d1 + rise);
          if (dur > delay + rise + 0.2) vib.depth.linearRampToValueAtTime(clamp(depth * fin(vo.deepen, 1.25), 0, 1), t + dur);
        } else if (slurred) vib.depth.linearRampToValueAtTime(0, t + 0.15);
        // tremolo
        trem.depth.cancelAndHoldAtTime(t);
        trem.depth.setValueAtTime(clamp(fin(to.depth, 0.5) * fin(ev.trem, 0), 0, 1), t);
        // swell: the note starts under its level and grows into it
        out.gain.cancelAndHoldAtTime(t);
        const sw = clamp(fin(ev.swell, 0), 0, 1);
        if (sw > 0) { out.gain.setValueAtTime(gain0 * (1 - 0.75 * sw), t); out.gain.linearRampToValueAtTime(gain0, t + Math.max(0.1, dur * 0.7)); }
        else out.gain.setValueAtTime(gain0, t);
        if (ev.breath && typeof o.breath === "function") o.breath(t, vel, ev);
      },
    };
  }

  /** A pink-noise breath through a bandpass; returns (time, vel). */
  function breath(ctx, dest, o = {}) {
    const g = ctx.keep(new Tone.Gain(db(fin(o.level, -28)))).connect(dest);
    const bp = ctx.keep(new Tone.Filter({ frequency: fin(o.freq, 2200), type: "bandpass", Q: fin(o.q, 0.9) })).connect(g);
    const n = ctx.keep(new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: fin(o.attack, 0.04), decay: 0.16, sustain: 0.05, release: 0.12 } })).connect(bp);
    const mono = I.monotonic(g);
    return (time, vel = 0.7) => n.triggerAttackRelease(fin(o.length, 0.18), mono(time - fin(o.lead, 0.02)), clamp(fin(vel, 0.7), 0.05, 1));
  }

  Sim.phrasing = { parseArt, line, phrases, articulate, wrap, breath };
})(typeof window !== "undefined" ? window : globalThis);
