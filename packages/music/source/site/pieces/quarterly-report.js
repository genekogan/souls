// Quarterly Report: hold music / a 1993 corporate training video, professionally cheerful and a
// little uncanny. B♭ major, 100 BPM, lightly swung 16ths.
//
// The meeting has an agenda. Each agenda item is a three-part segment, opened by a sting (brass stab +
// bell + crash, with a brass pickup on the "and" of four):
//   a  the theme on alto sax: maj9 chords, a ii-V into IV, a G7#5 that leans on the relative minor,
//      ending on the 90s "Eb/F" slash chord;
//   b  the hook on flute (doubled an octave up by the DX piano): IV, V/IV in third inversion, iii, vi,
//      then the uncanny moment, a lydian Gbmaj7#11 (the chromatic bVI) and Ab13 (bVII) backing into I;
//   c  "bullet points": a DX electric piano solo over a vamp, a bar of stop-time band hits and a tom
//      fill over the dominant of the NEXT item's key.
// Items 1-3 step up a half step each (B♭, B, C); item 4 is a half-time coffee break in A♭ (flute,
// shaker, a drums-and-bass breakdown that builds back up); item 5, closing remarks, returns home with the
// theme harmonised in sixths and lifts the last hook up another half step before the outro vamp hands
// back to the top. One meeting is 15 cycles (~4.8 minutes); later meetings swap the sax and flute.
// Drums: a polite LinnDrum-ish kit (kick locked to the fretless bass, snare on 2 and 4, 16th hats with
// accents and open-hat lifts, ghost notes), plus shaker, tambourine, a little 808 cowbell, crashes on
// arrivals and fills at section ends.
(function () {
  "use strict";
  const T = Sim.theory, C = Sim.compose;
  const { mod12 } = T;
  const BPB = 4;

  // "F4/.5 Bb4/.5 | r/4" -> [{beat, dur, note}] (rests dropped); every bar must add up to 4 beats.
  function line(text) {
    const out = [];
    text.split("|").forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/([\d.]+)$/.exec(tok);
        if (!m) throw new Error(`quarterly-report: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        if (m[1] !== "r") out.push({ beat: bi * BPB + pos, dur, note: T.midi(m[1]) });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`quarterly-report: bar ${bi + 1} of "${text}" has ${pos} beats`);
    });
    return out;
  }

  // ---------- the tunes (concert pitch, in Bb) ----------
  const THEME = line("r/2 F4/.5 Bb4/.5 C5/.5 D5/.5 | F5/1.25 Eb5/.25 D5/.5 Bb4/1 A4/1 | r/.5 G4/.5 Bb4/.5 C5/.5 D5/1.5 Bb4/.5 | C5/1.5 Bb4/.5 G4/2 | r/2 F4/.5 Bb4/.5 C5/.5 D5/.5 | F5/1.5 C5/.5 Eb5/1 B4/1 | C5/.5 D5/.5 Eb5/1 D5/.5 C5/.5 Bb4/1 | Bb4/1.5 G4/.5 A4/2");
  const HOOK = line("Bb4/.5 Eb5/.5 F5/.5 G5/1.5 F5/.5 Eb5/.5 | F5/1.5 C5/.5 A4/2 | r/.5 A4/.5 D5/.5 E5/.5 F5/1.5 E5/.5 | D5/1.5 C5/.5 Bb4/2 | Bb4/.5 Eb5/.5 F5/.5 G5/1.5 F5/.5 Eb5/.5 | F5/1.5 D5/.5 A4/2 | r/.5 Db5/.5 F5/.5 Gb5/.5 F5/1 C5/1 | Eb5/1 F5/.5 Eb5/.5 C5/2");

  const H = {
    A: "| Bbmaj9 | Gm9 | Ebmaj9 | F13sus4 | Bbmaj9 | Dm7 G7#5 | Cm9 | Eb/F F13 |",
    B: "| Ebmaj9 | F/Eb | Dm9 | Gm9 | Cm11 | Dm7 | Gbmaj7#11 | Ab13 |",
    C: "| Bbmaj9 | Gm9 | Ebmaj9 | Dm7 | Cm9 | Dm7 | Ebmaj9 | F13sus4 F13 |", // last bar is replaced by the pivot
  };
  const PIVOT = "| F13sus4 F13 |"; // V of the next item's key, transposed

  // ---------- the meeting: 5 agenda items x 3 parts ----------
  const SEGS = [
    { k: 0, parts: ["a", "b", "c"] },
    { k: 1, parts: ["a", "b", "c"] },
    { k: 2, parts: ["a", "b", "c"] },
    { k: -2, parts: ["ca", "cb", "cc"] },
    { k: 0, parts: ["za", "zb", "zc"] },
  ];
  const AGENDA = [
    ["Welcome", "Market Overview", "Synergy", "Coffee Break", "Closing Remarks"],
    ["Housekeeping", "Q3 Outlook", "Customer Focus", "Coffee Break", "Next Steps"],
    ["Introductions", "Core Values", "Teamwork", "Coffee Break", "Q&A"],
  ];
  const PART = {
    a: { h: "A", mel: "theme", drums: "groove", sting: 2, e: 0.76, d: "theme" },
    b: { h: "B", mel: "hook", drums: "lift", guitar: 1, e: 0.86, d: "hook" },
    c: { h: "C", solo: "dx", drums: "bullets", guitar: 1, pivot: 1, e: 0.8, d: "bullet points, DX solo" },
    ca: { h: "A", mel: "theme", lead: "flute", drums: "half", sting: 1, e: 0.55, d: "half-time, flute" },
    cb: { h: "B", mel: "hook", lead: "flute", drums: "half", e: 0.6, d: "half-time" },
    cc: { h: "C", solo: "late", drums: "breakdown", pivot: 1, e: 0.6, d: "drums and bass, then the build" },
    za: { h: "A", mel: "theme", lead: "both", drums: "full", sting: 2, guitar: 1, e: 0.9, d: "theme in sixths", liftLast: 1 },
    zb: { h: "B", mel: "hook", lead: "both", drums: "full", sting: 2, guitar: 1, e: 1, d: "the last hook, up a half step" },
    zc: { h: "C", solo: "sax", drums: "bullets", guitar: 1, pivot: 1, e: 0.84, d: "thank you for your time" },
  };

  // Bass + kick cells: [pos, dur, role, kick]. R root, O octave, F fifth, S seventh, G ghost, A approach.
  const BASS4 = [
    [[[0, 0.7, "R", 1], [0.75, 0.25, "R", 0], [1.5, 0.45, "O", 0], [2, 0.7, "R", 1], [2.75, 0.5, "F", 0], [3.5, 0.5, "A", 0]], 3],
    [[[0, 1.25, "R", 1], [1.5, 0.45, "F", 0], [2.5, 0.45, "R", 1], [3, 0.45, "O", 0], [3.5, 0.45, "F", 0]], 2.5],
    [[[0, 0.45, "R", 1], [0.75, 0.6, "R", 1], [1.5, 0.15, "G", 0], [2, 0.9, "F", 1], [3, 0.45, "O", 0], [3.75, 0.25, "A", 0]], 2],
    [[[0, 1.4, "R", 1], [1.75, 0.25, "R", 0], [2.5, 0.9, "F", 1], [3.5, 0.45, "S", 0]], 1.5],
  ];
  const BASS2 = [
    [[[0, 0.7, "R", 1], [0.75, 0.25, "R", 0], [1.5, 0.5, "A", 0]], 2],
    [[[0, 1.4, "R", 1], [1.5, 0.45, "O", 0]], 2],
    [[[0, 0.45, "R", 1], [0.75, 0.7, "F", 1]], 1],
  ];
  const BASS_HALF = [[0, 1.5, "R", 1], [1.75, 0.25, "R", 0], [2.5, 1, "F", 1], [3.5, 0.5, "A", 0]];
  // DX comping for a chord span: [beat, dur]; -0.25 is a pushed 16th.
  const COMP4 = [
    [[[0, 1.4], [1.75, 0.45], [2.5, 1.3]], 3], [[[-0.25, 1.6], [2.5, 0.4], [3.25, 0.6]], 2], [[[0, 0.4], [0.75, 1], [2.75, 1.1]], 2],
    [[[0, 3.6]], 1], [[[0.5, 1.2], [2, 0.4], [2.75, 1]], 1.5],
  ];
  const COMP2 = [[[[0, 1.6]], 2], [[[-0.25, 1.7]], 1.5], [[[0, 0.4], [0.75, 1]], 1.5]];
  const SPARSE4 = [[[[0, 3.6]], 2], [[[0, 1.9], [2.5, 1.3]], 1]];
  // muted-guitar chicken scratch: [16th position, vel]
  const SCRATCH = [
    [[0.5, 0.5], [1.5, 0.42], [1.75, 0.55], [2.5, 0.5], [3.25, 0.36], [3.5, 0.55]],
    [[0.25, 0.4], [0.75, 0.52], [1.5, 0.55], [2.25, 0.38], [2.75, 0.52], [3.5, 0.55]],
  ];
  const HAT16 = [0.42, 0.17, 0.3, 0.2];

  const nm = (pc) => T.NAMES[mod12(pc)];
  function tsym(sym, k) {
    if (!k) return sym;
    return sym.replace(/^([A-G][b#]?)/, (m) => nm(T.PC[m] + k)).replace(/\/([A-G][b#]?)$/, (_, m) => "/" + nm(T.PC[m] + k));
  }
  /** Keys voicing: the smoothest candidate with no semitone low down and no doubled pitch. */
  // semi: the pitch below which a semitone between neighbours counts as mud (99 = never allow one)
  const muddy = (v, semi = 66) => v.some((m, i) => i > 0 && ((v[i - 1] < 55 && m - v[i - 1] < 3) || (v[i - 1] < semi && m - v[i - 1] === 1)));
  function voiceKeys(sym, prev, n, r, lo = 52, hi = 74, top = [64, 72], semi = 66) {
    let best = null, bestS = Infinity;
    for (const spread of ["any", "close", "drop2"]) for (const l of [lo, lo + 3, lo + 6]) for (const nn of n > 3 ? [n, n - 1] : [n]) {
      const v = T.voice(sym, { lo: l, hi, n: nn, prev, top, spread, rng: r, omitBass: true });
      if (muddy(v, semi) || new Set(v).size < v.length) continue;
      let s = nn < n ? 3 : 0;
      if (prev && prev.length) {
        const b = prev.slice().sort((x, y) => x - y), m = Math.min(v.length, b.length);
        for (let i = 0; i < m; i++) s += Math.abs(v[v.length - 1 - i] - b[b.length - 1 - i]);
      } else s += Math.abs((v[0] + v[v.length - 1]) / 2 - (lo + hi) / 2);
      const t = v[v.length - 1];
      if (t > top[1]) s += (t - top[1]) * 1.5;
      if (t < top[0]) s += (top[0] - t) * 1.5;
      if (s < bestS) { bestS = s; best = v; }
    }
    return best || T.voice(sym, { lo: 55, hi: 76, n: 3, prev, omitBass: true });
  }
  /** A chord tone, or a scale tone that is not a half step above or below one (no avoid notes). */
  const safe = (c, m) => c.pcs.includes(mod12(m)) || (c.scale.includes(mod12(m)) && !c.pcs.some((p) => [1, 11].includes(mod12(m - p))));
  const safeScale = (sym) => { const c = T.chord(sym); return c.scale.filter((p) => safe(c, p)); };

  function locate(cycle) {
    const idx = cycle % 15, round = Math.floor(cycle / 15);
    const seg = Math.floor(idx / 3), pi = idx % 3;
    const name = SEGS[seg].parts[pi];
    const k = SEGS[seg].k + (name === "zb" || name === "zc" ? 1 : 0);
    return { idx, round, seg, pi, name, k, part: PART[name] };
  }

  Sim.register({
    id: "quarterly-report",
    title: "Quarterly Report",
    genre: "Corporate muzak",
    about: "A 1993 training video on hold: DX electric piano, fretless bass and a polite LinnDrum groove with shaker and a little cowbell, a sax theme and a flute hook, and a brass-and-bell sting announcing each agenda item a half step higher.",
    situations: ["presentation", "shopping", "work"],
    energy: 0.45,
    bpm: 100, beatsPerBar: BPB, swing: 0.54, swingUnit: 0.25, cycleBars: 8, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.6, preDelay: 0.012, lowcut: 300, highcut: 7500 });
      const hall = I.reverb(ctx, out, { decay: 3.4, preDelay: 0.03, lowcut: 350, highcut: 6500 });
      const echo = I.delay(ctx, out, { time: "8n.", feedback: 0.24, highcut: 3200, pingPong: true });

      const keys = I.rhodes(ctx, { volume: -7, bark: 3.6, tine: -9, cutoff: 4600, tremolo: 0.6, tremoloDepth: 0.08 });
      const dx = I.rhodes(ctx, { volume: -3, bark: 4, tine: -7, cutoff: 5200, tremolo: 0.5, tremoloDepth: 0.05 });
      const sax = I.sax(ctx, { volume: -1, vibratoDepth: 0.06 });
      const flute = I.flute(ctx, { volume: -3, breath: -22 });
      const pad = I.pad(ctx, { volume: -17, cutoff: 1500, attack: 0.9, release: 2.2, detune: 18 });
      const bass = I.ebass(ctx, { volume: -4, fretless: true, base: 130 });
      const gtr = I.guitar(ctx, { kind: "muted", volume: -15, chorus: true });
      const bell = I.bell(ctx, { volume: -9, decay: 3.5 });
      const brass = I.brassStab(ctx, { volume: -6 });
      const kit = I.kit(ctx, { volume: -3, kickNote: 32, preload: ["kick", "snare", "clap", "hatClosed", "hatOpen", "shaker", "tambourine", "cowbell", "crash", "tom", "rim"] });

      // the DX sheen: a stereo chorus on both electric pianos
      const sheen = ctx.keep(new Tone.Chorus({ frequency: 0.8, delayTime: 3.5, depth: 0.45, spread: 180, wet: 0.4 }).start()).connect(out);
      const kp = ctx.keep(new Tone.Panner(-0.22)); keys.out.connect(kp); kp.connect(sheen);
      const dp = ctx.keep(new Tone.Panner(0.18)); dx.out.connect(dp); dp.connect(sheen);
      const sp = I.place(ctx, sax, 0.08, out), fp = I.place(ctx, flute, -0.1, out);
      const pp = I.place(ctx, pad, 0.25, out), gp = I.place(ctx, gtr, 0.42, out);
      I.place(ctx, bass, 0, out);
      const bp = I.place(ctx, bell, -0.3, out), brp = I.place(ctx, brass, 0.12, out);
      const kitp = I.place(ctx, kit, 0, out);
      I.send(ctx, kp, room, -12); I.send(ctx, dp, room, -10); I.send(ctx, dp, echo, -18);
      I.send(ctx, sp, hall, -11); I.send(ctx, sp, echo, -17); I.send(ctx, fp, hall, -9); I.send(ctx, fp, echo, -15);
      I.send(ctx, pp, hall, -10); I.send(ctx, gp, room, -12);
      I.send(ctx, bp, hall, -6); I.send(ctx, brp, hall, -10);
      I.send(ctx, kitp, room, -15); I.send(ctx, bass.out, room, -26);

      const wind = { timing: 0.01, vel: 0.05 };
      return {
        sax: { layer: "melody", play: (t, e, d) => sax.play(t, e.note, d, e.vel), humanize: wind },
        flute: { layer: "melody", play: (t, e, d) => flute.play(t, e.note, d, e.vel), humanize: wind },
        dx: { layer: "melody", play: (t, e, d) => dx.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.06 } },
        keys: { layer: "harmony", play: (t, e, d) => keys.play(t, e.note, d, e.vel), humanize: { timing: 0.008, vel: 0.05 } },
        pad: { layer: "harmony", play: (t, e, d) => pad.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0 } },
        guitar: { layer: "harmony", play: (t, e, d) => gtr.play(t, e.note, d, e.vel, 0.006), humanize: { timing: 0.005, vel: 0.1 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.05 } },
        brass: { layer: "texture", play: (t, e, d) => brass.play(t, e.note, d, e.vel), humanize: { timing: 0.004, vel: 0.03 } },
        bell: { layer: "texture", play: (t, e, d) => bell.play(t, e.note, d, e.vel), humanize: { timing: 0, vel: 0.03 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { pitch: e.pitch, dur: e.len }), humanize: { timing: 0.004, vel: 0.07 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const L = locate(cycle), N = locate(cycle + 1);
      const P = L.part, k = L.k, e = P.e;
      const swapLead = L.round % 2 === 1;

      // ---- harmony: bars carry their own key (the closing theme pivots up in its last bar) ----
      let harmony = T.progression(H[P.h], BPB).map((h) => ({ ...h, chord: tsym(h.chord, k) }));
      const pivotKey = P.pivot ? N.k : P.liftLast ? k + 1 : null;
      if (pivotKey != null) {
        harmony = harmony.filter((h) => h.bar < 7);
        const src = P.pivot ? PIVOT : "| Eb/F F13 |";
        T.progression(src, BPB).forEach((h) => harmony.push({ bar: 7, beat: h.beat, dur: h.dur, chord: tsym(h.chord, pivotKey) }));
      }
      const barKey = (bar) => (bar === 7 && pivotKey != null ? pivotKey : k);
      const hAbs = harmony.map((h) => ({ ...h, start: h.bar * BPB + h.beat, end: h.bar * BPB + h.beat + h.dur }));
      const chordAt = (b) => { let cur = hAbs[0]; for (const h of hAbs) { if (h.start <= b + 1e-6) cur = h; else break; } return cur; };
      const sym = (b) => chordAt(b).chord;

      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: abs - bar * BPB, dur, note, vel, ...extra });
      };

      // ---- melody ----
      const busy = new Set();
      if (P.mel) {
        const src = P.mel === "theme" ? THEME : HOOK;
        let lead = P.lead || (P.mel === "theme" ? "sax" : "flute");
        if (swapLead && lead !== "both") lead = lead === "sax" ? "flute" : "sax";
        if (P.lead === "flute" && P.mel === "theme") lead = "flute";
        const notes = src.map((n) => ({ ...n, note: n.note + barKey(Math.floor(n.beat / BPB)) }));
        notes.forEach((n, i) => {
          const h = chordAt(n.beat), c = T.chord(h.chord);
          const long = n.dur >= 1.5;
          const strong = Math.abs(n.beat - Math.round(n.beat)) < 1e-6;
          const gap = i > 0 && notes[i - 1].beat + notes[i - 1].dur < n.beat - 0.4;
          const vel = Math.min(0.85, (0.6 + (strong ? 0.05 : 0) + (long ? 0.04 : 0) - (gap ? 0.03 : 0)) * (0.88 + e * 0.15) + r.gauss(0.02));
          const dur = Math.min(n.dur * (n.dur <= 0.5 ? 0.85 : 0.95), 31.9 - n.beat);
          busy.add(Math.floor(n.beat / BPB));
          const play = (track, note, v) => {
            if (track === "sax" && long && r.chance(0.3)) { // the cheesy scoop
              push(track, n.beat, 0.12, note - 1, v * 0.7);
              push(track, n.beat, dur, note, v, { delay: 0.045 });
            } else push(track, n.beat, dur, note, v);
          };
          if (lead === "both") {
            // sax on the tune, flute a sixth above (else the nearest chord tone a fifth to a third above)
            play("sax", n.note, vel);
            const up = [9, 8, 7, 5, 4, 3].map((x) => n.note + x).find((m) => c.pcs.includes(mod12(m)) || (!strong && safe(c, m)));
            push("flute", n.beat, dur, up ?? n.note + 12, vel * 0.82);
          } else if (lead === "flute") {
            const oct = P.mel === "theme" ? 12 : 0;
            push("flute", n.beat, dur, n.note + oct, vel * (oct ? 0.85 : 0.95));
          } else play("sax", n.note, vel);
          // the DX doubles the flute hook an octave up, very 1993
          if (P.mel === "hook" && lead === "flute" && L.name === "b") push("dx", n.beat, Math.min(dur, 0.9), n.note + (n.note + 12 <= 89 ? 12 : 0), 0.3 + r.range(0, 0.04));
        });
      }

      // ---- solos: the DX in "bullet points", the sax ad-libbing in the outro ----
      if (P.solo) {
        const isSax = P.solo === "sax";
        const start = P.solo === "late" ? 16 : 0.5, end = P.solo === "late" ? 23.5 : 23.5;
        const m = C.line({
          start, end, chordAt: sym, rng: r.fork(7), lo: isSax ? 63 + Math.max(0, k) : 67, hi: isSax ? 79 : 86,
          density: isSax ? 0.35 : P.solo === "late" ? 0.3 : 0.55, phrase: [3, 7], rest: [1, 2.5],
          motif: isSax ? state.saxMotif : state.dxMotif, motifProb: 0.45, chromatic: 0.08, register: 0.5,
          prev: isSax ? state.saxLast : state.dxLast, upbeatStart: 0.5, scaleFor: safeScale,
        });
        if (isSax) { state.saxMotif = m.motif; state.saxLast = m.last; } else { state.dxMotif = m.motif; state.dxLast = m.last; }
        m.notes.forEach((n) => {
          busy.add(Math.floor(n.beat / BPB));
          push(isSax ? "sax" : "dx", n.beat, n.dur, n.note, isSax ? 0.55 + (n.vel - 0.6) : 0.5 + (n.vel - 0.6) * 1.2);
        });
      }

      // ---- stings: brass + bell + crash on the new item's downbeat ----
      const stingV = (s) => voiceKeys(s, null, 4, null, 58, 77, [70, 76], 99);
      if (P.sting) {
        const c = T.chord(hAbs[0].chord);
        const tonic = T.nearest(70 + k, [c.root], 68, 74);
        push("bell", 0, 2, [tonic + 7, tonic + 12], P.sting === 2 ? 0.42 : 0.3);
        push("brass", 0, P.sting === 2 ? 1.25 : 0.6, stingV(hAbs[0].chord), P.sting === 2 ? 0.62 : 0.4);
        if (P.sting === 2) push("brass", 1.5, 0.3, stingV(hAbs[0].chord), 0.42);
      }
      if (N.part.sting && P.pivot) push("brass", 31.5, 0.3, stingV(sym(31.5)), 0.45);
      if (N.name === "zb") push("brass", 31.5, 0.3, stingV(sym(31.5)), 0.45); // the lift into the last hook

      // ---- DX comping ----
      const quiet = P.drums === "half" || P.drums === "breakdown";
      const hits = [];
      hAbs.forEach((h, i) => {
        const s0 = h.start;
        if (P.drums === "breakdown" && h.bar < 4) return; // drums and bass alone
        if ((P.drums === "bullets" || P.drums === "breakdown") && h.bar === 6) return; // stop-time bar is scored below
        const v = voiceKeys(h.chord, state.keysV, r.chance(0.3) ? 5 : 4, r);
        state.keysV = v;
        let pats = quiet ? (h.dur >= 4 ? SPARSE4 : COMP2) : (h.dur >= 4 ? COMP4 : COMP2);
        if (s0 === 0 || (h.bar === 4 && P.drums === "breakdown")) pats = pats.filter(([p]) => p[0][0] >= 0);
        if (busy.has(h.bar) && h.dur >= 4 && !quiet) pats = pats.filter(([p]) => p.length <= 2 || r.chance(0.3));
        const pat = r.weighted(pats.length ? pats : COMP2);
        hits.push(pat.map(([b, d]) => ({ at: s0 + b, d, v })));
      });
      hits.forEach((hs, i) => {
        const nextStart = i + 1 < hits.length ? Math.min(...hits[i + 1].map((x) => x.at)) : 32;
        hs.filter((x) => x.at < nextStart - 0.2).forEach((x) => push("keys", x.at, Math.min(x.d, nextStart - x.at - 0.05), x.v, (quiet ? 0.42 : 0.5) + r.range(-0.04, 0.05)));
      });

      // ---- pad ----
      hAbs.forEach((h) => {
        if (P.drums === "breakdown" && h.bar < 4) return;
        const v = voiceKeys(h.chord, state.padV, 3, null, 55, 76, [67, 74], 99);
        state.padV = v;
        push("pad", h.start, h.dur - 0.05, v, quiet ? 0.42 : P.h === "B" ? 0.36 : 0.28);
      });

      // ---- muted guitar ----
      if (P.guitar) {
        const pat = SCRATCH[L.idx % 2];
        for (let bar = 0; bar < 8; bar++) {
          if ((P.drums === "bullets") && bar >= 6) continue;
          pat.forEach(([p, v]) => {
            const h = chordAt(bar * BPB + p);
            if (!state.gtr || state.gtrSym !== h.chord) { state.gtr = voiceKeys(h.chord, state.gtr, 3, null, 62, 77, [70, 76], 99); state.gtrSym = h.chord; }
            push("guitar", bar * BPB + p, 0.15, state.gtr, v * (0.85 + e * 0.2));
          });
        }
      }

      // ---- fretless bass and the kick that locks to it ----
      if (!state.groove || L.idx % 3 === 0) {
        const a = r.weighted(BASS4); let b = r.weighted(BASS4);
        for (let t = 0; t < 6 && b === a; t++) b = r.weighted(BASS4);
        state.groove = [a, b, r.weighted(BASS2)];
      }
      const kicks = Array.from({ length: 8 }, () => []);
      let root = state.bassRoot ?? 34 + k;
      let last = state.bassLast ?? root;
      const rootOf = (s, ref) => T.nearest(ref, [T.chord(s).bass], 31, 45);
      const nextFirst = (() => { const nh = T.progression(H[N.part.h], BPB)[0].chord; return tsym(nh, N.k); })();
      for (let bar = 0; bar < 8; bar++) {
        const spans = [];
        hAbs.filter((h) => h.bar === bar).forEach((h) => {
          const pv = spans[spans.length - 1];
          if (pv && T.chord(pv.chord).bass === T.chord(h.chord).bass) pv.end = h.end;
          else spans.push({ start: h.start, end: h.end, chord: h.chord });
        });
        const stop = (P.drums === "bullets" || P.drums === "breakdown") && bar === 6;
        spans.forEach((sp, si) => {
          const len = sp.end - sp.start;
          let cell;
          if (stop) cell = [[0, 0.45, "R", 1], [0.75, 0.45, "R", 1], [1.5, 0.4, "O", 1]];
          else if (P.drums === "half" || (P.drums === "breakdown" && bar < 4)) cell = len >= 4 ? BASS_HALF : [[0, len - 0.3, "R", 1]];
          else if (len >= 4) cell = bar === 7 && r.chance(0.4) ? r.weighted(BASS4) : state.groove[bar % 2];
          else cell = state.groove[2];
          const c = T.chord(sp.chord);
          root = rootOf(sp.chord, root);
          const nextSym = si + 1 < spans.length ? spans[si + 1].chord : bar < 7 ? sym(sp.end) : nextFirst;
          const nextRoot = rootOf(nextSym, root);
          const sev = c.intervals.includes(10) ? 10 : c.intervals.includes(11) ? 11 : 9;
          const fifth = c.intervals.find((x) => x >= 6 && x <= 8) ?? 7;
          cell.forEach(([pos, dur, role, kick]) => {
            if (pos >= len - 0.01) return;
            let n;
            if (role === "R") n = root;
            else if (role === "O") n = root + 12 <= 52 && Math.abs(root + 12 - last) <= 12 ? root + 12 : root + fifth <= 52 ? root + fifth : root;
            else if (role === "F") { const up = root + fifth, dn = up - 12; n = up > 50 || (dn >= 28 && Math.abs(dn - last) < Math.abs(up - last)) ? dn : up; }
            else if (role === "S") n = T.nearest(last, [root + sev], 31, 50);
            else if (role === "G") n = last;
            else {
              // chromatic approaches only when they don't rub against the chord still sounding
              const below5 = nextRoot - 5 >= 28 ? -5 : 7; // from the fifth below (or above, near the low E)
              const opts = [[-1, 3], [1, 2], [-2, 1.5], [2, 1], [below5, 1.5]].filter(([s]) => nextRoot + s !== last && safe(c, nextRoot + s));
              n = nextRoot + (nextRoot === root ? below5 : opts.length ? r.weighted(opts) : below5);
              dur = Math.min(dur, len - pos - 0.02);
            }
            const vel = role === "G" ? 0.3 : role === "A" ? 0.55 : pos === 0 ? 0.82 : 0.68;
            push("bass", sp.start + pos, Math.min(dur, len - pos - 0.02), n, vel * (0.9 + e * 0.12));
            if (kick) kicks[bar].push([sp.start + pos - bar * BPB, pos === 0 ? 0.8 : 0.62]);
            last = n;
          });
        });
      }
      state.bassRoot = root; state.bassLast = last;

      // ---- drums ----
      const ve = 0.85 + e * 0.2;
      const D = (abs, voice, vel, extra) => push("drums", abs, 0.1, voice, Math.min(1, vel * ve), extra);
      const mode = P.drums;
      const fill7 = mode === "bullets" ? "toms" : mode === "breakdown" ? "build" : mode === "half" ? (L.pi === 1 ? "flam" : null) : r.weighted([["run", 2], ["toms", 1.5], ["flam", 1]]);
      for (let bar = 0; bar < 8; bar++) {
        const B = bar * BPB;
        const fill = bar === 7 ? fill7 : bar === 3 && mode !== "half" && mode !== "breakdown" && r.chance(0.3) ? "flam" : null;
        const stopAt = fill === "toms" ? 2 : fill === "run" ? 3 : fill === "build" ? 0 : 4;
        const kickSet = new Set(kicks[bar].map(([p]) => p));
        // stop-time bar: band hits, then just the hats
        if ((mode === "bullets" || mode === "breakdown") && bar === 6) {
          [0, 0.75, 1.5].forEach((p, i) => { D(B + p, "kick", 0.8); D(B + p, i === 2 ? "snare" : "rim", i === 2 ? 0.66 : 0.5); });
          D(B, "crash", 0.5);
          for (let s = 8; s < 16; s += 2) D(B + s / 4, "hatClosed", s % 4 === 0 ? 0.36 : 0.22);
          const v = voiceKeys(sym(B), state.keysV, 4, r);
          [0, 0.75, 1.5].forEach((p) => push("keys", B + p, 0.4, v, 0.55));
          push("brass", B + 1.5, 0.35, stingV(sym(B)), 0.4);
          continue;
        }
        const half = mode === "half" || (mode === "breakdown" && bar < 4);
        // kick
        kicks[bar].forEach(([p, v]) => { if (p < stopAt || fill === "build") D(B + p, "kick", v); });
        if (!kickSet.has(0)) D(B, "kick", 0.75);
        // snare / backbeat
        if (half) {
          if (mode === "breakdown" || (L.pi === 0 && bar < 4)) D(B + 2, "rim", 0.55);
          else D(B + 2, "snare", 0.62);
        } else if (fill !== "build") {
          D(B + 1, "snare", 0.66);
          if (stopAt > 3) D(B + 3, "snare", 0.7);
          if (mode === "lift" || mode === "full") { D(B + 1, "clap", 0.26); if (stopAt > 3) D(B + 3, "clap", 0.28); } // the 1993 sheen
        }
        // ghost notes
        if (!half && fill !== "build" && r.chance(0.55)) {
          const cands = [0.75, 1.75, 2.25, 2.75, 3.25].filter((p) => !kickSet.has(p) && p < stopAt);
          r.shuffle(cands).slice(0, r.chance(0.4) ? 2 : 1).forEach((p) => D(B + p, "snare", 0.1 + r.range(0, 0.06)));
        }
        // hats
        const openBar = !half && bar % 2 === 1 && fill !== "toms";
        if (mode === "breakdown" && bar < 4) {
          for (let s = 0; s < 16; s += 2) D(B + s / 4, "hatClosed", s % 4 === 0 ? 0.3 : 0.18);
        } else if (half) {
          for (let s = 0; s < 16; s += 2) { if (s === 14 && bar % 2 === 1) break; D(B + s / 4, "hatClosed", s % 4 === 0 ? 0.32 : 0.2); }
          if (bar % 2 === 1) D(B + 3.5, "hatOpen", 0.26);
        } else if (fill !== "build") {
          const eighths = mode === "lift" || mode === "full";
          for (let s = 0; s < 16; s++) {
            const p = s / 4;
            if (p >= stopAt || (openBar && p >= 3.5)) break;
            if (eighths && (s % 2 === 1 || s === 6)) continue; // the open hat takes the "and" of 2
            D(B + p, "hatClosed", (eighths ? (s % 4 === 0 ? 0.42 : 0.3) : HAT16[s % 4]) + r.gauss(0.02));
          }
          if (openBar) D(B + 3.5, "hatOpen", 0.32);
          if (mode === "lift" || mode === "full") [1.5].forEach((p) => { if (p < stopAt) D(B + p, "hatOpen", 0.18); });
        }
        // auxiliary percussion
        const shaker = mode === "lift" || mode === "full" || mode === "half";
        if (shaker) for (let s = 0; s < 16 && s / 4 < stopAt; s++) D(B + s / 4, "shaker", [0.28, 0.12, 0.2, 0.15][s % 4] + r.gauss(0.02));
        if ((mode === "lift" || mode === "full") && fill !== "build") { if (stopAt > 1) D(B + 1, "tambourine", 0.42); if (stopAt > 3) D(B + 3, "tambourine", 0.46); if (r.chance(0.3) && stopAt > 3.75) D(B + 3.75, "tambourine", 0.2); }
        if (mode === "bullets" || (mode === "full" && L.name === "za")) {
          [[1.5, 0.3], [3.5, 0.32], [2.75, 0.16]].forEach(([p, v]) => { if (p < stopAt) D(B + p, "cowbell", v); });
          if (bar % 2 === 1 && 0.75 < stopAt) D(B + 0.75, "cowbell", 0.14);
        }
        if (mode === "breakdown" && bar >= 4 && bar < 6) for (let s = 0; s < 16; s++) D(B + s / 4, "shaker", [0.26, 0.1, 0.18, 0.12][s % 4]);
        // fills
        if (fill === "run") [[3, 0.36], [3.25, 0.44], [3.5, 0.52], [3.75, 0.6]].forEach(([p, v]) => D(B + p, "snare", v));
        else if (fill === "toms") {
          [[2, 50, 0.55], [2.25, 50, 0.45], [2.5, 47, 0.58], [2.75, 47, 0.48], [3, 43, 0.62], [3.25, 43, 0.52]].forEach(([p, pitch, v]) => D(B + p, "tom", v, { pitch }));
          D(B + 3.5, "snare", 0.62); D(B + 3.75, "snare", 0.7); D(B + 3.5, "kick", 0.7);
        } else if (fill === "flam") { D(B + 3.5, "snare", 0.38); D(B + 3.75, "snare", 0.46); }
        else if (fill === "build") {
          for (let s = 0; s < 16; s++) D(B + s / 4, "snare", 0.16 + 0.5 * (s / 15));
          [0, 1, 2, 3].forEach((p) => D(B + p, "kick", 0.62 + p * 0.05));
        }
        // crashes on arrivals
        if (bar === 0 && (P.sting || L.pi === 0 || L.name === "b" || L.name === "zb")) D(B, "crash", P.sting === 2 ? 0.55 : 0.4);
      }

      const item = L.seg + 1, title = AGENDA[L.round % AGENDA.length][L.seg];
      return { events: ev, harmony, section: `Item ${item}: ${title} · ${P.d}`, state };
    },
  });
})();
