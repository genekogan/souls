// Sim.dialogue: compose-side tools for passing a line between instruments.
//
// The default formula is one instrument singing a line while the others accompany. In the music this
// library is after, lines are shared: a reed starts a phrase and a flute finishes it, two voices hocket
// one tune note by note, a chord is broken across instruments, the bass answers the lead, parts enter
// and leave mid-phrase. Everything here is pure: notes in, notes out, no Tone. A piece calls it from
// compose() and pushes the result as ordinary events (every note comes back with `track` set).
//
// A "line" is an array of notes { at, dur, note, vel?, phrase? }: `at` in beats from the line's origin
// (a section start, usually). Notes written as { bar, beat } are accepted too (beatsPerBar via `bpb`).
// Every result note also carries `bar` and `beat` (from `at` and `bpb`), so it can be pushed straight
// into a cycle after subtracting the cycle's offset: see toEvents() and window().
//
//   const V = [{ track: "reed", range: [57, 83] }, { track: "flute", range: [62, 91] }, { track: "cello", range: [48, 69] }];
//   Sim.dialogue.distribute(TUNE, { voices: V, mode: "handoff", rng: r })      // one line, several players
//   Sim.dialogue.respond(TUNE, { track: "cello", transform: { steps: -2, invert: true }, scaleAt })   // answers in the rests
//   Sim.dialogue.separate(lead, counter, { range: [48, 69], prefer: "below" })  // keep a counter-line out of the lead's way
(function (root) {
  "use strict";
  const Sim = (root.Sim = root.Sim || {});
  const D = {};
  const mod12 = (x) => ((x % 12) + 12) % 12;
  const EPS = 1e-6;
  const pitchOf = (n) => (Array.isArray(n.note) ? Math.max(...n.note) : n.note);
  const pitchesOf = (n) => (Array.isArray(n.note) ? n.note : [n.note]);
  const end = (n) => n.at + n.dur;
  const isPitched = (n) => typeof n.note === "number" || (Array.isArray(n.note) && n.note.length && n.note.every((m) => typeof m === "number"));
  const clamp01 = (v) => Math.max(0.05, Math.min(1, v));

  // ---------- notes and phrases ----------
  /** Normalise a line: absolute `at`, numeric `dur`, time order. Unpitched notes are dropped. */
  function norm(line, bpb = 4) {
    return (line || [])
      .filter(isPitched)
      .map((n, i) => ({ ...n, at: n.at ?? (n.bar ?? 0) * bpb + (n.beat ?? 0), dur: n.dur ?? 1, idx: n.idx ?? i }))
      .sort((a, b) => a.at - b.at || a.idx - b.idx);
  }
  D.norm = norm;

  /**
   * Group a line into phrases (arrays of notes, in time order).
   * Marks, in priority: o.phrases = [[start, end), ...] in beats; a `phrase` id on each note; otherwise a rest of
   * at least o.breath beats (default 0.5) between a note's end and the next start begins a new phrase.
   */
  function phrases(line, o = {}) {
    const notes = norm(line, o.bpb);
    if (!notes.length) return [];
    if (o.phrases) {
      const groups = o.phrases.map(() => []);
      const stray = [];
      for (const n of notes) {
        const i = o.phrases.findIndex(([s, e]) => n.at >= s - EPS && n.at < e - EPS);
        (i >= 0 ? groups[i] : stray).push(n);
      }
      return groups.concat(stray.length ? [stray] : []).filter((g) => g.length);
    }
    if (notes.some((n) => n.phrase != null)) {
      const order = [], by = new Map();
      for (const n of notes) {
        const k = n.phrase ?? "_";
        if (!by.has(k)) { by.set(k, []); order.push(k); }
        by.get(k).push(n);
      }
      return order.map((k) => by.get(k));
    }
    const breath = o.breath ?? 0.5;
    const out = [[notes[0]]];
    let last = end(notes[0]);
    for (let i = 1; i < notes.length; i++) {
      const n = notes[i];
      if (n.at - last >= breath - EPS) out.push([n]); else out[out.length - 1].push(n);
      last = Math.max(last, end(n));
    }
    return out;
  }
  D.phrases = phrases;

  /** Notes with `at` in [start, end): the slice of a line that belongs to one cycle. */
  D.window = (notes, start, stop) => norm(notes).filter((n) => n.at >= start - EPS && n.at < stop - EPS);

  /** Turn notes into conductor events: bar/beat from `at` minus `offset` (the cycle's first beat). */
  D.toEvents = function (notes, o = {}) {
    const bpb = o.bpb ?? 4, off = o.offset ?? 0;
    return norm(notes, bpb).map((n) => {
      const rel = n.at - off, bar = Math.floor(rel / bpb + EPS);
      const { at, idx, ...rest } = n;
      return { ...rest, track: o.track ?? n.track, bar, beat: +(rel - bar * bpb).toFixed(4), vel: clamp01(n.vel ?? 0.75), at };
    });
  };

  const withBarBeat = (n, bpb) => { const bar = Math.floor(n.at / bpb + EPS); return { ...n, bar, beat: +(n.at - bar * bpb).toFixed(4) }; };

  // ---------- ranges ----------
  const SHIFTS = [0, 12, -12, 24, -24];
  const inRange = (m, range) => !range || (m >= range[0] && m <= range[1]);
  /** One octave shift (0, ±12, ±24; `prefer` tried first) that puts every note of `seg` inside `range`; null if none does. */
  function segShift(seg, range, octaves = true, prefer = 0) {
    if (!range) return prefer;
    const order = octaves === false ? [0] : [prefer].concat(SHIFTS.filter((s) => s !== prefer));
    for (const s of order) if (seg.every((n) => pitchesOf(n).every((m) => inRange(m + s, range)))) return s;
    return null;
  }
  /** The shift with the fewest notes out of range (used only when nothing fits). */
  function bestEffortShift(seg, range, octaves = true) {
    let best = 0, bs = Infinity;
    for (const s of octaves === false ? [0] : SHIFTS) {
      const bad = seg.reduce((a, n) => a + pitchesOf(n).filter((m) => !inRange(m + s, range)).length, 0) + Math.abs(s) / 100;
      if (bad < bs) { bs = bad; best = s; }
    }
    return best;
  }
  const shifted = (n, s) => (s ? { ...n, note: Array.isArray(n.note) ? n.note.map((m) => m + s) : n.note + s, shift: (n.shift || 0) + s } : n);

  // ---------- randomness ----------
  /** Accept a Sim.theory rng, a plain () => [0,1) function, or nothing (deterministic middle choices). */
  function rand(r) { return typeof r === "function" ? r : () => 0.5; }
  function weightedPick(pairs, r) {
    const total = pairs.reduce((a, p) => a + p[1], 0);
    if (total <= 0) return pairs[0][0];
    let x = r() * total;
    for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; }
    return pairs[pairs.length - 1][0];
  }

  // ---------- the line router ----------
  /**
   * Choose a voice for a segment of notes. Candidates are voices whose range holds the segment (after an
   * octave shift if the voice allows one); the previous voice is discouraged (o.repeat, default 0.15), a shift
   * costs weight, an explicit o.order cycles through tracks. Returns { v, s }.
   */
  function choose(seg, voices, prev, r, o, segIndex, baseShift = 0) {
    if (o.order && o.order.length) {
      const want = o.order[segIndex % o.order.length];
      const v = voices.find((x) => x.track === want);
      if (v) { const s = segShift(seg, v.range, v.octaves); if (s != null) return { v, s }; }
    }
    const cands = [];
    for (const v of voices) {
      const s = segShift(seg, v.range, v.octaves, baseShift);
      if (s == null) continue;
      let w = v.weight * (s === baseShift ? 1 : o.shiftWeight ?? 0.45);
      if (prev && v === prev) w *= o.repeat ?? 0.15;
      cands.push([{ v, s }, w]);
    }
    const live = cands.filter(([, w]) => w > 0);
    if (o.noShift && live.some(([c]) => c.s === baseShift)) return weightedPick(live.filter(([c]) => c.s === baseShift), r);
    if (live.length) return weightedPick(live, r);
    if (cands.length) return cands[0][0];
    // nothing fits: the voice whose range centre is nearest the segment's mean, shifted as well as it can be
    const mean = seg.reduce((a, n) => a + pitchOf(n), 0) / seg.length;
    let best = voices[0], bd = Infinity;
    for (const v of voices) {
      const c = v.range ? (v.range[0] + v.range[1]) / 2 : mean;
      const d = Math.abs(c - mean) + (v === prev ? 6 : 0);
      if (d < bd) { bd = d; best = v; }
    }
    return { v: best, s: bestEffortShift(seg, best.range, best.octaves) };
  }

  /** Stamp a segment with its voice: track, octave shift, gain, entrance accent on the first note. */
  function assign(seg, v, s, o, prevVoice) {
    const entrance = prevVoice !== v;
    return seg.map((n, i) => {
      const m = shifted(n, s);
      const vel = (n.vel ?? o.vel ?? 0.75) * (v.gain ?? 1) + (i === 0 && entrance ? o.entranceVel ?? 0.03 : 0);
      return { ...m, track: v.track, voice: v.i, vel: clamp01(vel), entrance: i === 0 && entrance };
    });
  }

  /**
   * Route one hand-written line across several instruments.
   *   line    notes (see the header); phrase marks via o.phrases, note.phrase or rests (phrases()).
   *   o.voices  [{ track, range: [lo, hi], weight = 1, gain = 1, octaves = true }]  (gain scales vel)
   *   o.mode    "phrase"   each phrase to one voice, alternating (o.order: tracks to cycle through)
   *             "handoff"  the line changes hands at phrase boundaries and after long notes
   *                        (o.handoffDur = 1.5 beats, o.minNotes = 2 notes before a handoff is allowed,
   *                        o.handoffChance = 1, o.stay = chance to keep the voice across a phrase boundary = 0.25),
   *                        joining seamlessly: o.join = "extend" (the outgoing note rings o.overlap = 0.3 beats into
   *                        the entrance), "double" (the incoming voice also plays the tail of the outgoing note, softly),
   *                        or "none"
   *             "hocket"   alternating notes, o.group notes at a time (1), o.pattern voice indices to cycle
   *                        ([0, 1, ...]), o.rotate: start one voice later each phrase (true)
   *             "interval" by register: notes above o.pivot (or between o.pivots, ascending) go to the higher
   *                        voice(s); chords (array notes) are split across voices; without a pivot, the voice
   *                        whose range centre is nearest, keeping the current voice while the note fits it
   *   o.rng    a Sim.theory rng or () => [0,1); o.bpb beats per bar (4); o.vel default velocity (0.75)
   * Returns notes in time order with track, voice, shift, entrance, phrase (index) and bar/beat set.
   */
  D.distribute = function (line, o = {}) {
    const bpb = o.bpb ?? 4, r = rand(o.rng);
    const voices = (o.voices || []).map((v, i) => ({ weight: 1, gain: 1, octaves: true, ...v, i }));
    if (!voices.length) throw new Error("Sim.dialogue.distribute: no voices");
    const mode = o.mode || "phrase";
    const ph = phrases(line, { bpb, phrases: o.phrases, breath: o.breath });
    const out = [];
    let prev = null, segIndex = 0;

    if (mode === "phrase") {
      ph.forEach((seg, pi) => {
        const { v, s } = choose(seg, voices, prev, r, o, segIndex++);
        out.push(...assign(seg, v, s, o, prev).map((n) => ({ ...n, phrase: pi })));
        prev = v;
      });
    } else if (mode === "handoff") {
      const longDur = o.handoffDur ?? 1.5, minNotes = o.minNotes ?? 2, chance = o.handoffChance ?? 1, overlap = o.overlap ?? 0.3, join = o.join ?? "extend";
      o = { shiftWeight: 0.15, ...o }; // a line passed from hand to hand should stay in its own register
      let cur = null, curShift = 0;
      ph.forEach((seg, pi) => {
        // split the phrase into runs: after a long note (not the last), or where the current voice runs out of range
        let run = [];
        const flush = (reason, next) => {
          if (!run.length) return;
          let v, s;
          if (!cur) ({ v, s } = choose(run, voices, prev, r, o, segIndex++));
          else { v = cur; s = curShift; }
          const stamped = assign(run, v, s, o, prev).map((n) => ({ ...n, phrase: pi }));
          out.push(...stamped);
          prev = v;
          if (reason === "handoff" || reason === "range") {
            const last = stamped[stamped.length - 1];
            // choose the incoming voice from the upcoming run (look ahead to the next long note or the phrase end)
            // the incoming voice is chosen from the upcoming run (up to the next long note or the phrase end);
            // a mid-line handoff should not jump octaves, so a voice that needs a shift is used only when no other fits
            const pick = choose(next, voices, v, r, { ...o, repeat: 0, noShift: true }, segIndex++, s);
            cur = pick.v; curShift = pick.s;
            if (cur !== v && reason === "handoff") {
              const was = last.dur;
              last.handoff = true;
              if (join !== "none") last.dur = was + overlap;
              if (join === "double") out.push({ ...shifted(run[run.length - 1], pick.s), at: last.at + was - overlap, dur: overlap + 0.12, track: cur.track, voice: cur.i, vel: clamp01(last.vel * 0.45), join: true, phrase: pi });
            }
          }
          run = [];
        };
        // at a phrase boundary the line may stay with the same player, or move on
        if (cur && !(o.stay != null ? r() < o.stay : r() < 0.25)) cur = null;
        if (cur && segShift(seg.slice(0, Math.min(seg.length, 3)), cur.range, cur.octaves) == null) cur = null;
        if (!cur) { const pick = choose(seg, voices, prev, r, o, segIndex++); cur = pick.v; curShift = pick.s; }
        for (let i = 0; i < seg.length; i++) {
          const n = seg[i];
          const fits = pitchesOf(n).every((m) => inRange(m + curShift, cur.range));
          if (!fits && run.length) { flush("range", seg.slice(i)); }
          else if (!fits) { const pick = choose(seg.slice(i), voices, prev, r, { ...o, repeat: 0 }, segIndex++); cur = pick.v; curShift = pick.s; }
          run.push(n);
          const rest = seg.slice(i + 1);
          if (rest.length && n.dur >= longDur - EPS && run.length >= minNotes && r() < chance) {
            // the incoming player need only manage the notes up to the next possible handoff
            let k = 0;
            while (k < rest.length - 1 && !(k + 1 >= minNotes && rest[k].dur >= longDur - EPS)) k++;
            flush("handoff", rest.slice(0, k + 1));
          }
        }
        flush("phrase", []);
      });
    } else if (mode === "hocket") {
      const group = Math.max(1, o.group ?? 1);
      const pattern = o.pattern && o.pattern.length ? o.pattern : voices.map((_, i) => i);
      ph.forEach((seg, pi) => {
        let k = o.rotate === false ? 0 : pi % pattern.length;
        seg.forEach((n, i) => {
          if (i && i % group === 0) k++;
          let v = null, s = 0;
          // the next voice in the pattern that holds the note at pitch; failing that, one that holds it an octave away
          for (const strict of [true, false]) {
            for (let t = 0; t < pattern.length && !v; t++) {
              const cand = voices[pattern[(k + t) % pattern.length] % voices.length];
              const sh = segShift([n], cand.range, strict ? false : cand.octaves);
              if (sh != null) { v = cand; s = sh; k = k + t; }
            }
            if (v) break;
          }
          if (!v) { v = voices[pattern[k % pattern.length] % voices.length]; s = bestEffortShift([n], v.range, v.octaves); }
          out.push({ ...assign([n], v, s, o, prev)[0], phrase: pi, entrance: prev !== v });
          prev = v;
        });
      });
    } else if (mode === "interval") {
      const sorted = voices.slice().sort((a, b) => ((a.range ? a.range[0] + a.range[1] : 0) - (b.range ? b.range[0] + b.range[1] : 0)));
      const pivots = o.pivots || (o.pivot != null ? [o.pivot] : null);
      const byPivot = (m) => { let i = 0; if (pivots) while (i < pivots.length && m >= pivots[i]) i++; return sorted[Math.min(i, sorted.length - 1)]; };
      let curV = null;
      ph.forEach((seg, pi) => {
        for (const n of seg) {
          for (const m of pitchesOf(n)) {
            let v;
            if (pivots) v = byPivot(m);
            else if (curV && inRange(m, curV.range)) v = curV;
            else {
              let bd = Infinity;
              for (const c of sorted) { const mid = c.range ? (c.range[0] + c.range[1]) / 2 : m; const d = Math.abs(mid - m) + (inRange(m, c.range) ? 0 : 24); if (d < bd) { bd = d; v = c; } }
            }
            const s = segShift([{ note: m }], v.range, v.octaves) ?? bestEffortShift([{ note: m }], v.range, v.octaves);
            const one = { ...n, note: m };
            out.push({ ...assign([one], v, s, o, curV)[0], phrase: pi, entrance: curV !== v, split: Array.isArray(n.note) || undefined });
            curV = v;
          }
        }
      });
    } else throw new Error(`Sim.dialogue.distribute: unknown mode ${mode}`);
    return out.map((n) => withBarBeat(n, bpb)).sort((a, b) => a.at - b.at || a.idx - b.idx);
  };

  // ---------- call and response ----------
  /** Nearest pitch to m whose class is in pcs (ties go up); m itself when it already is. */
  function snapTo(m, pcs) {
    if (!pcs || !pcs.length) return m;
    const set = new Set(pcs.map(mod12));
    for (let d = 0; d <= 6; d++) { if (set.has(mod12(m + d))) return m + d; if (set.has(mod12(m - d))) return m - d; }
    return m;
  }
  /** Move `steps` scale steps from m within pcs. */
  function stepIn(m, steps, pcs) {
    const set = new Set(pcs.map(mod12));
    if (!set.size) return m + Math.round(steps * 12 / 7);
    let x = snapTo(m, pcs), n = Math.abs(steps), dir = Math.sign(steps);
    while (n > 0) { x += dir; if (set.has(mod12(x))) n--; }
    return x;
  }

  /**
   * Derive an answering phrase from a call and place it where the caller is silent.
   *   call         notes (one phrase; the first note's `at` is the origin of the rhythm)
   *   o.track      the responder
   *   o.transform  one object or an array applied in order:
   *                { transpose: semitones } { steps: scaleSteps } (in o.scale / scaleAt(callStart))
   *                { invert: axisMidi | true (the first note) } { retrograde: true } { augment: factor }
   *                { truncate: n (first n notes) } { tail: n (last n) } { displace: beats } { even: dur (all notes this long) }
   *   o.at         where the answer starts (default: the call's end + o.gap, gap 0)
   *   o.before     the answer must be over by here minus o.breath (0.25): notes that would start too late are
   *                dropped and the last note is trimmed. Use the caller's next entrance, so the responder only
   *                speaks while the caller rests.
   *   o.scale      pcs, or o.scaleAt(beat) => pcs: every answer note is snapped to the scale at its own time
   *   o.range      [lo, hi]: the whole answer is octave-shifted to fit
   *   o.vel        number (velocity) or factor < 0 ... treated as a multiplier when o.velScale is given
   * Returns notes with track and `answer: true`, bar/beat set.
   */
  D.answer = function (call, o = {}) {
    const bpb = o.bpb ?? 4;
    let notes = norm(call, bpb);
    if (!notes.length) return [];
    const origin = notes[0].at, callEnd = Math.max(...notes.map(end));
    const scaleAtCall = o.scaleAt ? o.scaleAt(origin) : o.scale;
    let rel = notes.map((n) => ({ ...n, at: n.at - origin }));
    const tfs = Array.isArray(o.transform) ? o.transform : o.transform ? [o.transform] : [];
    for (const tf of tfs) {
      if (!tf) continue;
      if (tf.truncate != null) rel = rel.slice(0, Math.max(1, tf.truncate));
      if (tf.tail != null) { rel = rel.slice(-Math.max(1, tf.tail)); const o0 = rel[0].at; rel = rel.map((n) => ({ ...n, at: n.at - o0 })); }
      if (tf.retrograde) {
        const total = Math.max(...rel.map(end));
        rel = rel.map((n) => ({ ...n, at: total - end(n) })).sort((a, b) => a.at - b.at);
      }
      if (tf.augment) rel = rel.map((n) => ({ ...n, at: n.at * tf.augment, dur: n.dur * tf.augment }));
      if (tf.even) rel = rel.map((n, i) => ({ ...n, at: i * tf.even, dur: tf.even }));
      if (tf.transpose) rel = rel.map((n) => shifted(n, tf.transpose));
      if (tf.steps) rel = rel.map((n) => ({ ...n, note: Array.isArray(n.note) ? n.note.map((m) => stepIn(m, tf.steps, scaleAtCall || [])) : stepIn(n.note, tf.steps, scaleAtCall || []) }));
      if (tf.invert) {
        const axis = tf.invert === true ? pitchOf(rel[0]) : tf.invert;
        rel = rel.map((n) => ({ ...n, note: Array.isArray(n.note) ? n.note.map((m) => 2 * axis - m) : 2 * axis - n.note }));
      }
      if (tf.displace) rel = rel.map((n) => ({ ...n, at: n.at + tf.displace }));
    }
    const start = o.at ?? callEnd + (o.gap ?? 0);
    let ans = rel.map((n) => ({ ...n, at: start + n.at }));
    if (o.before != null) {
      const limit = o.before - (o.breath ?? 0.25);
      ans = ans.filter((n) => n.at < limit - 0.1).map((n) => ({ ...n, dur: Math.min(n.dur, limit - n.at) })).filter((n) => n.dur >= 0.2);
    }
    if (!ans.length) return [];
    if (o.scale || o.scaleAt) ans = ans.map((n) => { const pcs = o.scaleAt ? o.scaleAt(n.at) : o.scale; return { ...n, note: Array.isArray(n.note) ? n.note.map((m) => snapTo(m, pcs)) : snapTo(n.note, pcs) }; });
    if (o.range) { const s = segShift(ans, o.range) ?? bestEffortShift(ans, o.range); ans = ans.map((n) => shifted(n, s)); }
    return ans.map((n) => withBarBeat({ ...n, track: o.track ?? n.track, vel: clamp01(o.vel != null ? (o.velScale ? (n.vel ?? 0.75) * o.vel : o.vel) : (n.vel ?? 0.75) * 0.85), answer: true }, bpb));
  };

  /**
   * Answer every phrase of a line in the rest that follows it (the responder only speaks when the caller
   * rests). o as for answer(), plus: o.minGap (1 beat: shorter rests get no answer), o.end (the beat the
   * last answer must be over by), and o.transform / o.track / o.gap / o.range may be functions of (phraseIndex, phrase).
   */
  D.respond = function (line, o = {}) {
    const ph = phrases(line, o);
    const out = [];
    const f = (x, i, p) => (typeof x === "function" ? x(i, p) : x);
    ph.forEach((p, i) => {
      const pEnd = Math.max(...p.map(end));
      const next = i + 1 < ph.length ? ph[i + 1][0].at : o.end;
      if (next == null) return;
      if (next - pEnd < (o.minGap ?? 1) - EPS) return;
      const tf = f(o.transform, i, p);
      if (tf === null) return;
      out.push(...D.answer(p, { ...o, transform: tf, track: f(o.track, i, p), gap: f(o.gap, i, p) ?? 0, range: f(o.range, i, p), before: next, at: undefined }));
    });
    return out;
  };

  // ---------- register sharing ----------
  /** Pairs of (a, b) notes that sound at the same time. */
  function overlaps(a, b) {
    const out = [];
    for (const x of a) for (const y of b) if (Math.max(x.at, y.at) < Math.min(end(x), end(y)) - 0.05) out.push([x, y]);
    return out;
  }
  D.overlaps = overlaps;

  /**
   * Keep a counter-line out of a lead's way: each phrase of `counter` is moved by whole octaves so that
   * notes sounding together stay at least o.min semitones apart (3), it sits o.prefer = "below" | "above"
   * the lead (or either), within o.range, ideally o.gap = [lo, hi] semitones away (default [5, 16]).
   * Returns the counter with notes shifted (and `shift` set); the lead is untouched.
   */
  D.separate = function (lead, counter, o = {}) {
    const bpb = o.bpb ?? 4;
    const L = norm(lead, bpb);
    const min = o.min ?? 3, gap = o.gap ?? [5, 16];
    const shifts = o.shifts || [0, -12, 12, -24, 24];
    const out = [];
    for (const seg of phrases(counter, { bpb, phrases: o.phrases, breath: o.breath ?? 0.5 })) {
      let best = 0, bs = Infinity;
      for (const s of shifts) {
        let cost = Math.abs(s) / 12 * 0.8;
        const moved = seg.map((n) => shifted(n, s));
        for (const n of moved) for (const m of pitchesOf(n)) if (!inRange(m, o.range)) cost += 20;
        for (const [l, c] of overlaps(L, moved)) {
          for (const lm of pitchesOf(l)) for (const cm of pitchesOf(c)) {
            const d = Math.abs(lm - cm), signed = cm - lm;
            if (d === 0) cost += 4;
            else if (d < min) cost += d === 1 ? 8 : 5;
            else if (d % 12 === 1 || d % 12 === 11) cost += 1.5; // minor ninths and sevenths across octaves still rub
            if (o.prefer === "below" && signed > 0) cost += 3;
            if (o.prefer === "above" && signed < 0) cost += 3;
            if (o.prefer) { const dist = o.prefer === "below" ? -signed : signed; if (dist < gap[0]) cost += (gap[0] - dist) * 0.15; if (dist > gap[1]) cost += (dist - gap[1]) * 0.1; }
          }
        }
        if (cost < bs - EPS) { bs = cost; best = s; }
      }
      out.push(...seg.map((n) => withBarBeat(shifted(n, best), bpb)));
    }
    return out.sort((a, b) => a.at - b.at || a.idx - b.idx);
  };

  Sim.dialogue = D;
})(typeof window !== "undefined" ? window : globalThis);
