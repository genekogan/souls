// Buy Mode: a tiptoeing chamber-pop rondo in Bb, for browsing a catalogue of sofas and lamps.
//
// Contrast with Build Mode (a swung 3/4 waltz in F for clarinet and oboe): this is a straight, bouncy 4/4
// at 112 in Bb, led by flute and a reedy bassoon, with marimba, pizzicato, harp and a walking upright.
//
// The "shopping list" motif: three staccato ticks on one note, then a hop up a fourth that lands on the
// 6th of the chord (D D D G over Bb6), "this, this, this... and that". It is composed out by hand:
//   A (the rondo refrain, a 16-bar parallel period): the list sequenced up a minor third onto the chromatic
//     mediant (Bb6 -> Db6: F F F Bb, the 6th again); a whole-tone climb over G7#5 for the curious moment;
//     borrowed iv (Ebm6) in both halves; the consequent inverts the motif (G G G D, then Gb Gb Gb C as
//     Ebmaj9 darkens to Ebm6) and lands on the 9th of Bb69. The last two notes of each list ("F D") are
//     an answer that another instrument can take, so each return is a new conversation.
//   B (the verse, in Db = bIII): a more legato bassoon tune; the list returns on Db69 and inverted on
//     Fm7/Gbmaj7/Ebm6; it turns home by Dbmaj7 -> Cm9 -> F13.
//   C (the curious episode, G minor): marimba fragments of the inverted list; then whole-tone planing
//     (C9#5, Bb9#5, Ab9#5, Gb9#5: one whole-tone collection) with the motif "warped" to a major third,
//     harp whole-tone glints in the gaps, a descending whole-tone flute line above; Gbmaj7#11 and Ebm9
//     (borrowed) lead to an augmented V (F7#5) and the refrain.
//   Tag: the list in alternation (flute, marimba, bassoon), shrinking to two ticks, then a bVI-bVII-I
//     "checkout" (Gbmaj7, Ab13, Bb69) with the flute climbing to the 6th; the woodblock prints the receipt.
// Form per round: [intro] A B A' C A tag, with the episodes swapped on odd rounds. Each A has its own
// orchestration (who lists, who answers, what comps), and harp glissandi mark the section changes.
(function () {
  "use strict";
  const T = Sim.theory;
  const BPB = 4;
  const mod12 = T.mod12;

  // ---------- notation ----------
  // "D5/.5s G5/1t r/.5 F5/.5sx | -/4" -> [{beat, dur, note, stac, ten, ans}]. Flags: s staccato, t tenuto,
  // x answer (may be played by another instrument). "-/n" ties n more beats onto the previous note.
  function line(text) {
    const out = [];
    text.split("|").forEach((bar, bi) => {
      let pos = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|-|[A-G][#b]?-?\d)\/([\d.]+)([stx]*)$/.exec(tok);
        if (!m) throw new Error(`buy-mode: bad token ${tok}`);
        const dur = parseFloat(m[2]);
        if (m[1] === "-") out[out.length - 1].dur += dur;
        else if (m[1] !== "r") out.push({ beat: bi * BPB + pos, dur, note: T.midi(m[1]), stac: m[3].includes("s"), ten: m[3].includes("t"), ans: m[3].includes("x") });
        pos += dur;
      });
      if (Math.abs(pos - BPB) > 1e-6) throw new Error(`buy-mode: bar ${bi + 1} of "${text}" has ${pos} beats`);
    });
    return out;
  }

  // ---------- the score ----------
  const A_HEAD = "D5/.5s D5/.5s D5/.5s G5/1t r/.5 F5/.5sx D5/.5sx | F5/.5s F5/.5s F5/.5s Bb5/1t r/.5 Ab5/.5sx F5/.5sx | Eb5/1.5t D5/.5s C5/.5s Bb4/.5s G4/1 | A4/.5s C5/.5s Eb5/.5s D5/1.5t r/1";
  const B_HEAD = "r/.5 Ab3/.5s Db4/.5s Eb4/.5s F4/2t | Eb4/.5s Db4/.5s C4/1t Ab3/.5s Bb3/.5s Db4/1 | Gb4/1.5t F4/.5s Eb4/.5s Db4/.5s Bb3/1 | C4/.5s Eb4/.5s F4/.5s Gb4/.5s F4/2t";
  const SRC = {
    intro: {
      harm: "| Bb6 | Db6 | Bb6 | Db6 | Cm9 | F13 | Cm9:2 Ebm6:2 | F9sus4:2 F7#5:2 |",
      // the marimba peeks at the list: on ii (landing on the dorian 6th), on V (landing on the 13th), then just ticks
      mar: "r/4 | r/4 | r/4 | r/4 | Eb5/.5s Eb5/.5s Eb5/.5s A5/1t r/1.5 | A5/.5s A5/.5s A5/.5s D6/1t r/1.5 | G5/.5s G5/.5s G5/.5s r/.5 Gb5/.5s Gb5/.5s Gb5/.5s r/.5 | r/4",
    },
    // antecedent: the list on I and on bIII, a whole-tone climb over V+/ii, borrowed iv, ends on the 9th of V
    Aa: {
      harm: "| Bb6 | Db6 | Cm9 | F13 | Bb6 | G7#5 | Cm9:2 Ebm6:2 | F9sus4:2 F13:2 |",
      mel: A_HEAD + " | D5/.5s D5/.5s D5/.5s G5/1t r/.5 F5/.5sx D5/.5sx | Eb5/.5s F5/.5s G5/.5s A5/.5s B5/1t r/1 | C6/1t Bb5/.5s G5/.5s Gb5/1t Eb5/1 | C5/1t Eb5/.5s F5/.5s G5/1.5t r/.5",
    },
    // consequent: the list inverted (down a fourth), shaded from Ebmaj9 to Ebm6; lands on the 9th of Bb69
    Ab: {
      harm: "| Bb6 | Db6 | Cm9 | F13 | Ebmaj9 | Ebm6 | Cm9:2 F13:2 | Bb69 |",
      mel: A_HEAD + " | G5/.5s G5/.5s G5/.5s D5/1t r/.5 F5/.5sx G5/.5sx | Gb5/.5s Gb5/.5s Gb5/.5s C5/1t r/.5 Bb4/.5sx C5/.5sx | D5/1t Eb5/.5s G5/.5s F5/.5s Eb5/.5s D5/.5s A4/.5s | C5/2.5t r/1.5",
    },
    // verse in Db (bIII), bassoon; half cadence on Ab
    Ba: {
      harm: "| Dbmaj9 | Bbm9 | Ebm9 | Ab13 | Db69 | Fm7 | Gbmaj7 | Ab7sus4:2 Ab13:2 |",
      mel: B_HEAD + " | F4/.5s F4/.5s F4/.5s Bb4/1t r/.5 Ab4/.5sx F4/.5sx | Ab4/.5s Ab4/.5s Ab4/.5s Eb4/1t r/.5 F4/.5sx Ab4/.5sx | Bb4/1.5t Ab4/.5s Gb4/.5s F4/.5s Db4/1 | Eb4/1t Db4/1 C4/2t",
    },
    // second verse phrase turns home: Gbmaj7 Ebm6 (pivots: IV and ii of Db, bVI and iv of Bb), Dbmaj7 slides to Cm9, F13
    Bb: {
      harm: "| Dbmaj9 | Bbm9 | Ebm9 | Ab13 | Gbmaj7 | Ebm6 | Dbmaj7:2 Cm9:2 | F13sus4:2 F13:2 |",
      mel: B_HEAD + " | Bb4/.5s Bb4/.5s Bb4/.5s F4/1t r/.5 Gb4/.5sx Ab4/.5sx | Bb4/.5s Bb4/.5s Bb4/.5s Gb4/1t r/.5 F4/.5sx Eb4/.5sx | F4/1t Ab4/1 G4/1t Eb4/1 | Bb3/1t C4/1 A3/2t",
      // flute counter: list fragments in the bassoon's held notes, then high guide tones
      fl: "r/2 Ab5/.5s Ab5/.5s Ab5/.5s Eb6/.5t | r/1 F5/1t r/2 | Bb5/.5s Bb5/.5s Bb5/.5s r/2.5 | r/2 C6/.5s C6/.5s C6/.5s F6/.5t | r/2 Db6/2t | C6/2t r/2 | r/1 C6/1t r/1 Bb5/1t | r/2 A5/2t",
    },
    // curious episode in G minor: the inverted list in fragments, lydian IV, whole-tone V+
    Ca: {
      harm: "| Gm9 | Ebmaj7#11 | Cm9 | D7#5 | Gm9 | Ebmaj7#11 | Am7b5:2 D7b9:2 | Gm9:2 C9:2 |",
      mel: "Bb5/.5s Bb5/.5s Bb5/.5s F5/.5s r/2 | A5/.5s A5/.5s A5/.5s D5/.5s r/2 | G5/.5s G5/.5s G5/.5s D5/.5s Eb5/.5s D5/.5s C5/.5s A4/.5s | Bb4/.5s C5/.5s D5/.5s E5/.5s F#5/1t r/1 | Bb5/.5s Bb5/.5s Bb5/.5s F5/.5s r/.5 D5/.5s F5/.5s A5/.5s | G5/1t r/.5 A5/.5s Bb5/.5s A5/.5s G5/.5s D5/.5s | C5/.5s Eb5/.5s G5/.5s Eb5/.5s F#5/.5s Eb5/.5s C5/.5s A4/.5s | Bb4/1t A4/1 E5/1t D5/1",
    },
    // whole-tone planing (one collection), the list warped to a major third; then home via bVI and iv
    Cb: {
      harm: "| C9#5 | Bb9#5 | Ab9#5 | Gb9#5 | Gbmaj7#11 | Ebm9 | Cm9 | F7#5 |",
      mel: "E5/.5s E5/.5s E5/.5s G#5/1t r/1.5 | D5/.5s D5/.5s D5/.5s F#5/1t r/1.5 | C5/.5s C5/.5s C5/.5s E5/1t r/1.5 | Bb4/.5s C5/.5s D5/.5s E5/.5s F#5/.5s G#5/.5s Bb5/1t | Db6/1.5t Bb5/.5s F5/.5s Db5/.5s C5/1 | Db5/.5s Db5/.5s Db5/.5s Gb5/1t r/.5 F5/.5s Eb5/.5s | D5/1t Eb5/.5s D5/.5s C5/.5s Bb4/.5s G4/1 | A4/.5s C#5/.5s Eb5/.5s F5/.5s A5/1t r/1",
      fl: "D6/4t | C6/4t | Bb5/3t r/1 | r/4 | F6/4t | -/4 | Eb6/4t | C#6/2t r/2",
    },
    // checkout: the list passed around, shrinking, then bVI-bVII-I
    tag: {
      harm: "| Bb6 | Db6 | Bb6 | Db6 | Ebmaj9 | Cm9:2 F13:2 | Gbmaj7:2 Ab13:2 | Bb69 |",
      fl: "D5/.5s D5/.5s D5/.5s G5/1t r/1.5 | r/4 | D5/.5s D5/.5s D5/.5s G5/1t r/1.5 | r/4 | G5/.5s G5/.5s G5/.5s r/2.5 | Eb5/.5s Eb5/.5s r/3 | Bb5/1t Db6/1t Eb6/1t F6/1t | G6/2t r/2",
      mar: "r/4 | F5/.5s F5/.5s F5/.5s Bb5/1t r/1.5 | r/4 | F5/.5s F5/.5s F5/.5s Bb5/1t r/1.5 | r/2 Bb4/.5s Bb4/.5s Bb4/.5s r/.5 | r/2 A4/.5s A4/.5s r/1 | r/4 | r/4",
      bsn: "r/2.5 F3/.5s D3/.5s Bb2/.5s | r/2.5 Ab3/.5s F3/.5s Db3/.5s | r/2.5 G3/.5s F3/.5s D3/.5s | r/2.5 Bb3/.5s Ab3/.5s F3/.5s | r/4 | r/4 | r/4 | r/4",
    },
  };
  const PH = {};
  for (const [k, s] of Object.entries(SRC)) {
    const p = { prog: T.progression(s.harm, BPB) };
    for (const f of ["mel", "mar", "fl", "bsn"]) if (s[f]) p[f] = line(s[f]);
    PH[k] = p;
  }
  PH.Ar = PH.Ab; // the short return is the consequent alone

  const ROUNDS = [
    ["intro", "Aa", "Ab", "Ba", "Bb", "Ar", "Ca", "Cb", "Aa", "Ab", "tag"],
    ["Aa", "Ab", "Ca", "Cb", "Ar", "Ba", "Bb", "Aa", "Ab", "tag"],
  ];
  // Orchestration of each A (by round parity, then pass: first A, short return, final A).
  //   mel/ans: who lists and who answers ("flute", "mar", "bsn"); comp: pizz | pizzHi | harp | null;
  //   pat: chop (off-beat eighths) | two (backbeat) | charleston; bsn: bassoon doubles the walk (+12);
  //   roll: marimba rolls guide-tone dyads; picc: piccolo doubles the flute an octave up.
  const A_CFG = [
    [
      { mel: "flute", ans: "bsn", comp: "pizz", pat: "chop", perc: 1, desc: "flute lists, bassoon answers · pizz chops" },
      { mel: "mar", ans: "flute", comp: "harp", pat: "two", bsn: 12, perc: 1, desc: "marimba lists, flute answers · bassoon walks" },
      { mel: "flute", ans: "flute", picc: true, roll: true, bsn: 12, perc: 2, desc: "flute and piccolo · marimba rolls · bassoon walks" },
    ],
    [
      { mel: "flute", ans: "mar", comp: "pizz", pat: "charleston", perc: 1, desc: "flute lists, marimba answers · pizz Charleston" },
      { mel: "bsn", ans: "flute", comp: "pizzHi", pat: "two", perc: 0, desc: "bassoon takes the list, flute answers" },
      { mel: "flute", ans: "bsn", picc: true, hop: true, comp: "pizz", pat: "chop", perc: 2, desc: "flute and piccolo, bassoon answers · glock on the hops" },
    ],
  ];
  const MEL = { flute: ["flute", 0], mar: ["marMel", 0], bsn: ["bsnMel", -12] };
  const ANS = { flute: ["flute", 0], mar: ["marMel", 0], bsn: ["bsnMel", -24] };
  const INTENSITY = [1, 0.95, 1.03, 0.97];

  function locate(cycle) {
    let i = cycle, round = 0;
    while (i >= ROUNDS[round % 2].length) { i -= ROUNDS[round % 2].length; round++; }
    const pat = ROUNDS[round % 2], name = pat[i];
    let pass = -1;
    for (let j = 0; j <= i; j++) if (pat[j] === "Aa" || pat[j] === "Ar") pass++;
    const next = i + 1 < pat.length ? pat[i + 1] : ROUNDS[(round + 1) % 2][0];
    return { round, name, i, pass, next };
  }
  const letter = (n) => n[0];

  Sim.register({
    id: "buy-mode",
    title: "Buy Mode",
    genre: "Chamber pop",
    about: "A tiptoeing rondo in B♭: flute and bassoon trade a staccato shopping-list motif over a walking upright and pizzicato, with chromatic-mediant turns (B♭ to D♭), a D♭ verse for bassoon, a whole-tone marimba episode, and harp glissandi at every change.",
    bpm: 112, beatsPerBar: BPB, swing: 0.52, swingUnit: 0.5, cycleBars: 8, gainDb: 1.5,

    instruments(ctx) {
      const { I, out } = ctx;
      const room = I.reverb(ctx, out, { decay: 1.5, preDelay: 0.012, lowcut: 250, highcut: 8000 });
      const hall = I.reverb(ctx, out, { decay: 3.2, preDelay: 0.025, lowcut: 350, highcut: 6500 });
      const flute = I.flute(ctx, { volume: 0, attack: 0.03, release: 0.14, vibratoDepth: 0.05 });
      const picc = I.flute(ctx, { volume: -10, cutoff: 5200, base: 1400, attack: 0.025, release: 0.1, vibratoDepth: 0.035, breath: -28 });
      // Bassoon: the double-reed source with its fundamental weak, played low and darkened, then two
      // formant peaks (~480 Hz and ~1.15 kHz) for the reedy, slightly nasal bassoon colour.
      const bsn = I.oboe(ctx, { volume: -4, cutoff: 1600, base: 280, octaves: 2.2, vibrato: 4.8, vibratoDepth: 0.012, breath: -34, attack: 0.028, release: 0.09, glide: 0.01 });
      const formant = ctx.keep(new Tone.Filter({ type: "peaking", frequency: 480, Q: 1.3, gain: 5 }));
      const nasal = ctx.keep(new Tone.Filter({ type: "peaking", frequency: 1150, Q: 2, gain: 2.5 }));
      bsn.out.connect(formant); formant.connect(nasal);
      const marimba = I.marimba(ctx, { volume: -2, decay: 0.7, hardness: 1.4 });
      const pizz = I.pizz(ctx, { volume: -7, cutoff: 2600, decay: 0.26 });
      const harp = I.harp(ctx, { volume: -6, voices: 16 });
      const bass = I.upright(ctx, { volume: -4 });
      const glock = I.glock(ctx, { volume: -16, decay: 2.4 });
      const kit = I.kit(ctx, { volume: 0, preload: ["brushTap", "brushSweep", "woodblock", "softKick", "rim"] });

      const fp = I.place(ctx, flute, 0.1, out), pcp = I.place(ctx, picc, 0.22, out);
      const bsp = I.place(ctx, { out: nasal }, -0.22, out);
      const mp = I.place(ctx, marimba, -0.36, out), zp = I.place(ctx, pizz, 0.36, out);
      const hp = I.place(ctx, harp, 0.2, out), up = I.place(ctx, bass, 0, out);
      const gp = I.place(ctx, glock, 0.45, out), kp = I.place(ctx, kit, 0.05, out);
      I.send(ctx, fp, room, -11); I.send(ctx, fp, hall, -17); I.send(ctx, pcp, hall, -14);
      I.send(ctx, bsp, room, -12); I.send(ctx, mp, room, -12); I.send(ctx, mp, hall, -18);
      I.send(ctx, zp, room, -12); I.send(ctx, hp, hall, -9); I.send(ctx, up, room, -22);
      I.send(ctx, gp, hall, -8); I.send(ctx, kp, room, -14);

      const wind = { timing: 0.008, vel: 0.05 };
      const fl = (t, e, d) => flute.play(t, e.note, d, e.vel), bs = (t, e, d) => bsn.play(t, e.note, d, e.vel), ma = (t, e, d) => marimba.play(t, e.note, d, e.vel);
      return {
        flute: { layer: "melody", play: fl, humanize: wind },
        picc: { layer: "melody", play: (t, e, d) => picc.play(t, e.note, d, e.vel), humanize: wind },
        bsnMel: { layer: "melody", play: bs, humanize: wind },
        marMel: { layer: "melody", play: ma, humanize: { timing: 0.006 } },
        flCounter: { layer: "texture", play: fl, humanize: wind },
        marRoll: { layer: "harmony", play: ma, humanize: { timing: 0.004, vel: 0.1 } },
        marComp: { layer: "harmony", play: ma, humanize: { timing: 0.007 } },
        pizz: { layer: "harmony", play: (t, e, d) => pizz.play(t, e.note, d, e.vel), humanize: { timing: 0.008 } },
        harpComp: { layer: "harmony", play: (t, e, d) => harp.play(t, e.note, d, e.vel), humanize: { timing: 0.008 } },
        harp: { layer: "texture", play: (t, e, d) => harp.play(t, e.note, d, e.vel), humanize: { timing: 0.003, vel: 0.05 } },
        glock: { layer: "texture", play: (t, e, d) => glock.play(t, e.note, d, e.vel), humanize: { timing: 0.004 } },
        bass: { layer: "bass", play: (t, e, d) => bass.play(t, e.note, d, e.vel), humanize: { timing: 0.005 } },
        bsnBass: { layer: "bass", play: bs, humanize: { timing: 0.006, vel: 0.05 } },
        drums: { layer: "drums", play: (t, e) => kit.hit(e.note, t, e.vel, { dur: e.sweep, pitch: e.pitch }), humanize: { timing: 0.006, vel: 0.12 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      if (state.bass == null) Object.assign(state, { bass: 34, zv: null, hv: null, mv: null, cv: null, land: null });
      const L = locate(cycle);
      const { name, round } = L;
      const P = PH[name];
      const prog = P.prog;
      const chordAt = T.chordAtFactory(prog, BPB);
      const sym = (b) => chordAt(b).chord;
      const nextSym = PH[L.next].prog[0].chord;
      const inten = INTENSITY[round % 4];
      const ev = [];
      const push = (track, abs, dur, note, vel, extra) => {
        const bar = Math.floor(abs / BPB + 1e-9);
        ev.push({ track, bar, beat: +(abs - bar * BPB).toFixed(4), dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
      };
      const sec = letter(name);

      // ---------- melody ----------
      // Velocity rises a little with pitch, leans on beats 1 and 3, tenuto a touch heavier, staccato lighter.
      // o.ans: [track, shift] plays the x-notes; o.dbl: [track, shift, velScale] doubles the main line.
      function play(track, notes, o = {}) {
        if (!notes || !notes.length) return;
        const shift = o.shift || 0;
        const lo = Math.min(...notes.map((n) => n.note)), span = Math.max(1, Math.max(...notes.map((n) => n.note)) - lo);
        notes.forEach((n, i) => {
          const isAns = n.ans && o.ans;
          const tr = isAns ? o.ans[0] : track, sh = isAns ? o.ans[1] : shift;
          const base = isAns ? (o.ansVel ?? o.vel ?? 0.62) : (o.vel ?? 0.64);
          const vel = (base + 0.08 * (n.note - lo) / span + (n.beat % 2 === 0 ? 0.04 : 0) + (n.ten ? 0.04 : 0) - (n.stac ? 0.03 : 0)) * inten;
          const len = n.dur * (n.stac ? 0.42 : n.ten ? 0.95 : 0.84);
          const note = n.note + sh;
          // a crushed chromatic grace into some tenuto landings (later rounds only)
          const before = notes[i - 1];
          if (o.orn && !isAns && n.ten && n.dur >= 1 && before && Math.abs(before.note - n.note) >= 3 && r.chance(0.25)) {
            push(tr, n.beat - 0.12, 0.1, note - 1, vel * 0.7, { straight: true });
          }
          if (tr === "marMel" && n.dur >= 1.5) roll(tr, n.beat, n.dur - 0.1, [note], vel);
          else push(tr, n.beat, len, note, vel);
          if (o.dbl && (!n.ans || !o.ans)) push(o.dbl[0], n.beat, len, n.note + o.dbl[1], vel * o.dbl[2]);
          // the hop that ends a list (three ticks on one note, then up): a glock ping two octaves above
          const t3 = notes.slice(Math.max(0, i - 3), i);
          if (o.hop && t3.length === 3 && t3.every((x) => x.stac && x.note === t3[0].note) && n.note > t3[0].note) {
            const g = n.note + sh + (n.note + sh + 24 <= 100 ? 24 : 12);
            push("glock", n.beat, 1.2, g, 0.2 * inten);
          }
        });
      }
      // Marimba roll: strokes every 1/6 beat, alternating mallets between the notes, with a soft swell.
      function roll(track, at, len, notes, vel) {
        const n = Math.max(2, Math.floor(len * 6));
        for (let k = 0; k < n; k++) {
          const u = k / (n - 1);
          push(track, at + k / 6, 0.2, notes[k % notes.length], vel * (k === 0 ? 1 : 0.62 + 0.14 * Math.sin(Math.PI * u)), { straight: true });
        }
      }

      // ---------- bass: a jaunty walk (staccato quarters) or a two-feel ----------
      const BLO = 33, BHI = 49, BTOP = 55; // roots live in A1-B2; passing notes may climb to G3
      const rootNear = (pc, prev) => T.notesIn([pc], BLO, BHI).sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev) || Math.abs(a - 40) - Math.abs(b - 40))[0];
      const near = (pc, prev) => T.nearest(prev, [pc], BLO, BTOP);
      // the note before the next chord: a chromatic or scale-step approach, or the next chord's fifth,
      // always near the note it follows, never a repeat of it
      function approach(c, nc, R, prev) {
        if (mod12(nc.bass) === mod12(c.bass)) { // same root next: walk to another chord tone instead
          const opts = T.notesIn(c.pcs, prev - 5, prev + 5).filter((m) => m !== prev && m >= BLO && m <= BTOP);
          return opts.length ? r.pick(opts) : prev;
        }
        const nR = rootNear(nc.bass, prev);
        const below = T.step(nR, -1, c.scale), above = T.step(nR, 1, c.scale);
        const fifthBelow = nR - (nc.intervals.find((x) => x === 7 || x === 6 || x === 8) ? 12 - nc.intervals.find((x) => x === 7 || x === 6 || x === 8) : 5);
        const cands = [[nR - 1, 3], [nR + 1, 2], [prev > nR ? above : below, 2.5], [fifthBelow + 12 <= BTOP && Math.abs(fifthBelow + 12 - prev) < Math.abs(fifthBelow - prev) ? fifthBelow + 12 : fifthBelow, 1.2]]
          .filter(([m]) => m !== prev && m !== nR && Math.abs(m - prev) <= 8 && m >= BLO - 2 && m <= BTOP);
        if (cands.length) return r.weighted(cands);
        return [nR - 1, nR + 1, nR + 11, nR + 13].filter((m) => m !== prev).sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev))[0];
      }
      function bassLine(feel, o = {}) {
        const out = [];
        prog.forEach((e, k) => {
          if (o.from != null && e.bar < o.from) return;
          if (o.to != null && e.bar >= o.to) return;
          const c = T.chord(e.chord), nSym = k + 1 < prog.length ? prog[k + 1].chord : nextSym, nc = T.chord(nSym);
          const s0 = e.bar * BPB + e.beat;
          const R = rootNear(c.bass, state.bass);
          const iv = c.intervals;
          const third = iv.includes(4) ? 4 : iv.includes(3) ? 3 : 5;
          const fifth = iv.find((x) => x === 7 || x === 6 || x === 8) ?? 7;
          const upper = iv.find((x) => x === 9 || x === 10 || x === 11) ?? 12;
          if (feel === "walk") {
            if (e.dur >= 4) {
              // rising (R-3-5, R-5-6/7, the jaunty octave hop R-8-5) or, from a high root, falling (R-7-5, R-5-3)
              const shapes = [[[0, third, fifth], 3], [[0, fifth, upper], 2.5], [[0, 12, fifth], 1.5], [[0, upper - 12, fifth - 12], 2.5], [[0, fifth - 12, third - 12], 2]]
                .filter(([sh]) => R + Math.max(...sh) <= BTOP && R + Math.min(...sh) >= BLO - 1)
                .map(([sh, w]) => [sh, w * (R >= 42 ? (sh[1] < 0 ? 1.6 : 0.6) : 1)]);
              const ns = r.weighted(shapes).map((x) => R + x);
              ns.push(approach(c, nc, R, ns[2]));
              ns.forEach((m, j) => out.push({ at: s0 + j, dur: j === 0 ? 0.62 : 0.5, note: m, vel: [0.72, 0.56, 0.64, 0.58][j] }));
              if (o.skip && r.chance(o.skip)) out.push({ at: s0 + 2.5, dur: 0.22, note: ns[2], vel: 0.32 }); // a ghosted bounce
              state.bass = ns[3];
            } else {
              const ap = approach(c, nc, R, R);
              out.push({ at: s0, dur: 0.6, note: R, vel: 0.7 }, { at: s0 + 1, dur: 0.5, note: ap, vel: 0.56 });
              state.bass = ap;
            }
          } else { // two-feel: root and fifth, with an occasional pickup
            out.push({ at: s0, dur: Math.min(e.dur, 2) - 0.4, note: R, vel: 0.7 });
            if (e.dur >= 4) {
              const f = T.nearest(R + 3, [mod12(R + fifth)], BLO, BTOP - 3);
              out.push({ at: s0 + 2, dur: 1.4, note: f, vel: 0.6 });
              state.bass = f;
              if (nSym !== e.chord && r.chance(o.pickup ?? 0.3)) { const ap = approach(c, nc, R, f); out.push({ at: s0 + 3.5, dur: 0.4, note: ap, vel: 0.45 }); state.bass = ap; }
            } else state.bass = R;
          }
        });
        return out;
      }
      function bass(feel, o = {}) {
        const ns = bassLine(feel, o);
        if (!o.bsnOnly) ns.forEach((n) => push("bass", n.at, n.dur, n.note, n.vel * inten));
        if (o.bsn != null) ns.forEach((n) => { if (o.bsnFrom == null || n.at >= o.bsnFrom * BPB) push("bsnBass", n.at, n.dur * 0.85, n.note + o.bsn + (n.note + o.bsn < 34 ? 12 : 0), n.vel * 0.72 * inten); });
      }

      // ---------- comping ----------
      // Short plucked chords sound best without a colour a semitone from a guide tone (the 9th of Cm9, the
      // 13th of F13): the tune supplies those. The 6ths, the #11 and the whole-tone #5 stay.
      function plain(symbol) {
        const c = T.chord(symbol);
        return { ...c, colors: c.colors.filter((p) => c.guide.every((q) => ![1, 11].includes(mod12(p - q)))) };
      }
      const PATS = { chop: [0.5, 1.5, 2.5, 3.5], two: [1, 3], charleston: [0, 1.5], ripple: [0] };
      function comp(track, pat, range, vel, o = {}) {
        const key = { pizz: "zv", harpComp: "hv", marComp: "cv" }[track];
        for (let bar = o.from ?? 0; bar < (o.to ?? 8); bar++) {
          let pos = PATS[pat].slice();
          if (pat === "charleston" && prog.some((e) => e.bar === bar && e.beat === 2)) pos = [0, 1.5, 2, 3.5];
          for (const p of pos) {
            const at = bar * BPB + p, s = sym(at);
            const v = T.voice(plain(s), { lo: range[0], hi: range[1], n: o.aug && /#5/.test(s) ? 4 : o.n ?? 3, prev: state[key], top: [range[1] - 6, range[1]], rng: r });
            state[key] = v;
            const accent = pat === "chop" ? (p % 2 === 1.5 ? 1.12 : 0.92) : 1;
            if (pat === "ripple") v.forEach((m, k) => push(track, at + k * 0.09, 1.6, m, vel * (1 - 0.06 * k) * inten, { straight: true }));
            else push(track, at, track === "harpComp" ? 0.9 : 0.4, v, vel * accent * inten);
          }
        }
      }
      // marimba rolls on guide-tone dyads, voice-led
      function rolls(range, vel) {
        prog.forEach((e) => {
          const c = T.chord(e.chord);
          const v = T.voice({ ...c, colors: [] }, { lo: range[0], hi: range[1], n: 2, prev: state.mv, top: [range[1] - 5, range[1]], rng: r });
          state.mv = v;
          roll("marRoll", e.bar * BPB + e.beat, e.dur - 0.15, v, vel * inten);
        });
      }

      // ---------- harp: glissandi, landing chords and sprinkles ----------
      function gliss(at, len, pcs, lo = 62, hi = 91, vel = 0.3, down = false) {
        const ns = T.notesIn(pcs, lo, hi), step = len / ns.length;
        if (down) ns.reverse();
        ns.forEach((m, k) => push("harp", at + k * step, 0.7, m, vel * (0.7 + 0.5 * k / ns.length) * inten, { straight: true }));
      }
      function glissOut(at) {
        const last = T.chord(prog[prog.length - 1].chord);
        // a dominant glisses through its own colours (whole-tone for an augmented V); a tonic glisses into the new key
        const pcs = last.kind === "dominant" ? (last.scaleName === "wholeTone" ? last.scale : last.pcs) : T.chord(nextSym).pcs;
        gliss(at, 32 - at - 0.1, pcs);
        state.land = true;
      }
      function landing() {
        if (!state.land) return;
        state.land = false;
        const c = T.chord(prog[0].chord);
        const low = T.nearest(45, [c.root], 41, 52), tops = T.notesIn(c.pcs, 79, 88);
        const high = tops.find((m) => mod12(m) === c.guide[0]) ?? tops[tops.length - 1];
        push("harp", 0, 2, [low, high], 0.36 * inten);
        ping(0, 0.22);
      }
      // a triangle-like glock ping on the chord's colour (its 6th or 9th, when it has one)
      function ping(at, vel) {
        const c = T.chord(sym(at));
        const cands = T.notesIn(c.colors.length ? c.colors : c.guide, 89, 100);
        if (cands.length) push("glock", at, 1.5, cands[0], vel * inten);
      }
      // harp answers the melody's rests with a short arpeggio that leans into the coming chord
      function sprinkle(at, len) {
        const c = T.chord(sym(at)), nc = T.chord(sym(Math.min(31.9, at + len)));
        const pool = T.notesIn(c.pcs, 76, 93);
        const n = Math.min(4, Math.floor(len * 2));
        if (pool.length < 4 || n < 2) return;
        const start = r.int(0, pool.length - n);
        for (let k = 0; k < n; k++) {
          let note = pool[start + k];
          if (k === n - 1 && !nc.pcs.includes(mod12(note))) note = T.nearest(note, nc.pcs, note - 2, note + 2);
          push("harp", at + k * 0.5, 1, note, (0.26 + 0.03 * k) * inten);
        }
      }
      function gaps(notes, min) {
        const out = [];
        const xs = notes.slice().sort((a, b) => a.beat - b.beat);
        let t = 0;
        for (const n of xs) { if (n.beat - t >= min) out.push([t, n.beat - t]); t = Math.max(t, n.beat + n.dur); }
        if (32 - t >= min) out.push([t, 32 - t]);
        return out;
      }

      // ---------- light percussion ----------
      // 0: sweeps and soft taps on 2 and 4; 1: brush backbeat, woodblock pickups; 2: plus soft kick on 1 and 3.
      function perc(level, o = {}) {
        for (let bar = o.from ?? 0; bar < (o.to ?? 8); bar++) {
          const B = bar * BPB;
          push("drums", B, 0.1, "brushSweep", 0.18 + 0.04 * level, { sweep: 0.9 });
          push("drums", B + 2, 0.1, "brushSweep", 0.15 + 0.04 * level, { sweep: 0.9 });
          const fill = o.fill && bar === 7;
          const tap = o.rim ? "rim" : "brushTap";
          push("drums", B + 1, 0.1, tap, (o.rim ? 0.2 : 0.17 + 0.07 * level) * inten);
          if (!fill) push("drums", B + 3, 0.1, tap, (o.rim ? 0.17 : 0.15 + 0.07 * level) * inten);
          if (level >= 1 && bar % 2 === 1 && !fill) push("drums", B + 3.5, 0.1, "woodblock", 0.17 * inten, { pitch: 84 });
          if (level >= 2) {
            push("drums", B, 0.1, "softKick", 0.24 * inten);
            push("drums", B + 2, 0.1, "softKick", 0.2 * inten);
            if (r.chance(0.3)) push("drums", B + 2.5, 0.1, "brushTap", 0.12);
          }
          if (fill) [3, 3.25, 3.5, 3.75].forEach((p, k) => push("drums", B + p, 0.1, "brushTap", (0.12 + 0.05 * k) * inten, { straight: true }));
        }
      }
      // the list itself, on the woodblock: tick, tick, tick
      const ticks = (at, vel = 0.2) => [0, 0.5, 1].forEach((p, k) => push("drums", at + p, 0.1, "woodblock", vel * (k === 0 ? 1.1 : 0.9), { pitch: 84 }));

      const leaving = letter(L.next) !== sec || L.next === "Ar";
      let label;
      landing();

      if (name === "intro") {
        // the bassoon tiptoes in alone; the pizz and the upright join; the marimba peeks at the list
        bass("walk", { bsn: 12, bsnOnly: true, to: 4 });
        bass("walk", { bsn: 12, from: 4, skip: 0.15 });
        ticks(2); ticks(2 * BPB + 2);
        comp("pizz", "two", [55, 69], 0.3, { from: 2 });
        perc(0, { from: 4 });
        play("marMel", P.mar, { vel: 0.56 });
        glissOut(30);
        label = "Intro · the bassoon tiptoes in";
      } else if (sec === "A") {
        const v = A_CFG[round % 2][L.pass];
        const [mt, ms] = MEL[v.mel];
        const orn = round >= 1 || L.pass > 0;
        play(mt, P.mel, {
          shift: ms, vel: v.mel === "bsn" ? 0.7 : v.mel === "mar" ? 0.66 : 0.64, orn: orn && mt !== "marMel",
          ans: v.ans !== v.mel ? ANS[v.ans] : null, ansVel: v.ans === "bsn" ? 0.6 : 0.56,
          dbl: v.picc ? ["picc", 12, 0.62] : null, hop: v.hop,
        });
        if (v.comp === "pizz") comp("pizz", v.pat, [55, 69], 0.3);
        else if (v.comp === "pizzHi") comp("pizz", v.pat, [67, 79], 0.28);
        else if (v.comp === "harp") comp("harpComp", v.pat, [55, 70], 0.3);
        if (v.roll) rolls([57, 70], 0.22);
        bass("walk", { bsn: v.bsn, skip: v.perc >= 2 ? 0.18 : 0.08 });
        perc(v.perc, { fill: leaving && name !== "Aa" });
        if (v.perc >= 1 && name === "Aa") ping(4 * BPB, 0.18);
        if (name !== "Aa" && leaving) glissOut(30.75);
        const part = name === "Aa" ? "antecedent" : name === "Ar" ? "short return" : "consequent";
        label = `${L.pass === 0 ? "A" : L.pass === 1 ? "A′" : "A″"} · ${part} · ${v.desc}`;
      } else if (sec === "B") {
        // verse in Db: the bassoon sings; pizz on the backbeat above it; the upright in two
        const odd = round % 2 === 1;
        play("bsnMel", P.mel, { vel: 0.68, orn: round > 0 });
        if (name === "Bb" && !odd) play("flCounter", P.fl, { vel: 0.4 });
        if (name === "Bb" && odd) play("flCounter", P.mel, { shift: 24, vel: 0.36 });
        comp("pizz", "two", [67, 79], 0.26);
        if (odd) comp("harpComp", "ripple", [53, 72], 0.22, { n: 4 });
        bass("two", { pickup: 0.35 });
        for (let bar = 0; bar < 8; bar++) {
          push("drums", bar * BPB, 0.1, "brushSweep", 0.17, { sweep: 1.6 });
          push("drums", bar * BPB + 3, 0.1, "brushTap", 0.14 * inten);
        }
        if (name === "Bb") glissOut(30.5);
        label = `B · verse in D♭ (♭III) · bassoon${name === "Bb" ? (odd ? " with flute two octaves up" : " · flute counter") : ""}`;
      } else if (sec === "C") {
        // curious episode: fragments of the inverted list, whole-tone planing, harp glints in the gaps
        const odd = round % 2 === 1;
        const lead = odd ? "flute" : "marMel";
        play(lead, P.mel, { vel: odd ? 0.62 : 0.66, orn: false });
        if (odd) comp("marComp", "charleston", [55, 67], 0.3, { aug: true });
        else comp("pizz", "charleston", [53, 67], 0.3, { aug: true });
        if (name === "Cb" && !odd) play("flCounter", P.fl, { vel: 0.36 });
        bass("walk", { bsn: odd ? 0 : null, skip: 0.06 });
        perc(1, { rim: true, fill: name === "Cb" });
        if (name === "Ca") gaps(P.mel, 1.5).forEach(([at, len]) => sprinkle(at, Math.min(len, 2)));
        else {
          // whole-tone glints in the gaps: up, down, then up from higher
          [[79, 91, false], [77, 89, true], [83, 96, false]].forEach(([lo, hi, down], bar) => gliss(bar * BPB + 2.5, 1.3, T.chord(sym(bar * BPB)).scale, lo, hi, 0.22, down));
          glissOut(31);
        }
        label = name === "Ca" ? `C · curious, in G minor · ${odd ? "flute" : "marimba"} fragments the list` : `C · whole-tone window-shopping · augmented V${odd ? "" : " · flute descends"}`;
      } else {
        // tag: the list passed around and shrinking, then bVI-bVII-I and the receipt
        play("flute", P.fl, { vel: 0.62 });
        play("marMel", P.mar, { vel: 0.6 });
        play("bsnMel", P.bsn, { vel: 0.56 });
        comp("pizz", "chop", [55, 69], 0.28, { to: 6 });
        comp("pizz", "two", [55, 69], 0.3, { from: 6, to: 7 });
        bass("walk", { to: 7 });
        push("bass", 28, 0.6, 34, 0.74 * inten); push("bsnBass", 28, 0.5, 46, 0.5 * inten); // the button: Bb in octaves
        push("marComp", 28, 1.5, [62, 65, 67, 72], 0.4 * inten);
        push("harp", 28, 2, [46, 62, 74], 0.3 * inten);
        perc(1, { to: 6 });
        for (let bar = 6; bar < 8; bar++) push("drums", bar * BPB, 0.1, "brushSweep", 0.16, { sweep: 1.2 });
        ping(28, 0.26);
        ticks(30, 0.22); // the receipt prints
        state.bass = 34;
        label = "Tag · checkout · ♭VI–♭VII–I";
      }

      return { events: ev, harmony: prog, section: `Round ${round + 1} · ${label}`, state };
    },
  });
})();
