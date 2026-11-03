// Royal Charter: a little baroque suite in D for the guild hall where the charter is granted.
//
// Three movements in a fast-slow-fast round, each composed note by note (counterpoint is too strict an
// art to leave to a random walk) and re-registered every time it returns:
//
// I. Fughetta in 4/4, three voices. Subject (alto): D–A in stately quarters, a dotted fall, a rising
//    sixteenth sequence and an A7 arpeggio into D. Tonal answer in the treble (A–D answers D–A), with a
//    countersubject in invertible counterpoint at the octave: below the answer in bars 3-4, above the
//    bass entry in bars 6-7 and the B-minor entry in 10-11, below the final entry again in 18-19. It
//    ends on a syncopated 9–8 over the dominant (a 2–1 when inverted). Episodes: the subject's
//    sixteenth cell round a circle of fifths to B minor (9–8 into the cadence); a 7–6 suspension chain
//    over a stepwise bass into G; the bass climbing by semitones (G–G♯–A–A♯–B) back to A. Middle
//    entries in B minor (relative) and G (subdominant, in the bass), the final entry in the treble over
//    an A pedal, a tonic pedal with a flat-seven plagal turn, a cadential 6/4 with a 4–3 and a trill.
// II. Largo in B minor, a trio for two trebles and continuo: a chain of sevenths round the circle of
//    fifths over a walking bass, then the voices exchanged and the circle bent into a Neapolitan sixth,
//    closing on a Picardy third. The harpsichord realizes the bass without doubling a suspension.
// III. Gigue in 12/8 (four dotted-quarter beats a bar, written in triplet eighths), two voices, binary
//    with both halves repeated. Subject: a rising D arpeggio, a zig-zag of falling thirds and a
//    stepwise run home. Answer in the bass; the episode sequences the subject's run through a circle of
//    fifths to A. The second half opens with the subject in melodic inversion (in A, then answered in
//    the bass in D), sequences the falling thirds toward B minor, brings the subject in the bass in
//    B minor and ends with the subject at home. Repeats are "doubles": passing notes fill the thirds.
//
// Registration changes on every pass: harpsichord alone (8′), 8′ + 4′, the lute stop for echoes,
// a recorder taking the treble (a trio sonata) or doubling it, an oboe on the alto, cello continuo,
// and timpani in D and A for the closing pedals. After three rounds (about eleven minutes) the suite
// returns a minor third higher, then home, then a step higher. Harpsichord, cello and timpani are
// built here (the harpsichord is additive rather than Karplus-Strong so that it stays in tune).
(function () {
  "use strict";
  const T = Sim.theory;
  const db = (x) => Math.pow(10, x / 20);

  // ---------- notation ----------
  // "D4/4 A4/4 r/2 F#4/6~ F#4/2 E5/4t | ..." -> [{beat, dur, note, orn}] in beats from the start.
  // Durations are in `unit` beats (fughetta: sixteenths, unit 0.25; gigue: triplet eighths, unit 1/3).
  // "~" ties into the next note (same pitch); suffix t = trill, m = mordent. Bars are checked.
  function parse(text, unit, barUnits, where) {
    const out = [];
    let pos = 0, tie = false;
    text.split("|").forEach((bar, bi) => {
      let inBar = 0;
      bar.trim().split(/\s+/).filter(Boolean).forEach((tok) => {
        const m = /^(r|[A-G][#b]?-?\d)\/(\d+)(~?)([tm]?)$/.exec(tok);
        if (!m) throw new Error(`royal-charter: bad token ${tok} in ${where}`);
        const n = Number(m[2]);
        if (m[1] !== "r") {
          const note = T.midi(m[1]);
          const prev = out[out.length - 1];
          if (tie && prev && prev.note === note) prev.dur += n * unit;
          else out.push({ beat: pos * unit, dur: n * unit, note, orn: m[4] || "" });
          if (m[4]) out[out.length - 1].orn = m[4];
        }
        tie = m[3] === "~";
        pos += n; inBar += n;
      });
      if (inBar !== barUnits && bar.trim()) throw new Error(`royal-charter: ${where} bar ${bi + 1} has ${inBar} units, wants ${barUnits}`);
    });
    return out;
  }

  // ---------- I. Fughetta (sixteenth units) ----------
  const FUGUE = [
    { id: "expo1", bars: 2, key: "D", label: "Fughetta · the subject, alone in the alto",
      A: "D4/4 A4/4 B4/3 A4/1 G4/2 F#4/2 | E4/1 F#4/1 G4/1 E4/1 F#4/1 G4/1 A4/1 F#4/1 G4/2 E4/2 C#4/2 A3/2",
      harm: "| D:2 Bm:1 G:1 | A7:1 D:1 Em:1 A7:1 |" },
    { id: "expo2", bars: 2, key: "A", label: "Fughetta · tonal answer in the treble, countersubject below",
      S: "A4/4 D5/4 F#5/3 E5/1 D5/2 C#5/2 | B4/1 C#5/1 D5/1 B4/1 C#5/1 D5/1 E5/1 C#5/1 D5/2 B4/2 G#4/2 E4/2",
      A: "D4/4 F#4/1 E4/1 F#4/1 G4/1 A4/4 F#4/2 A4/2 | G#4/4 A4/4 F#4/6 E4/1 D4/1",
      harm: "| D:2 F#m:1 D:1 | E7:1 A:1 Bm:1 E7:1 |" },
    { id: "codetta", bars: 1, key: "D", label: "Fughetta · codetta",
      S: "A4/2 C#5/2 D5/1 E5/1 F#5/1 D5/1 G5/2 E5/2 C#5/2 A4/2",
      A: "C#4/4 F#4/2 A4/2 B4/2 G4/2 E4/2 G4/2",
      harm: "| A:1 D:1 G:1 A7:1 |" },
    { id: "expo3", bars: 2, key: "D", label: "Fughetta · subject in the bass, countersubject above",
      S: "D5/4 F#5/1 E5/1 D5/1 C#5/1 D5/4 B4/2 D5/2 | C#5/4t D5/4 B4/6 A4/1 G4/1",
      A: "F#4/4 A4/4 F#4/4 G4/4~ | G4/4 A4/4 G4/4 E4/2 C#4/2",
      B: "D3/4 A3/4 B3/3 A3/1 G3/2 F#3/2 | E3/1 F#3/1 G3/1 E3/1 F#3/1 G3/1 A3/1 F#3/1 G3/2 E3/2 C#3/2 A2/2",
      harm: "| D:1 F#m/A:1 Bm:1 G:1 | A7/E:1 D/F#:1 Em/G:1 A7:1 |" },
    { id: "ep1", bars: 2, key: "Bm", label: "Fughetta · episode: the subject's sixteenths round the circle of fifths",
      S: "F#4/2 r/2 B4/1 C#5/1 D5/1 B4/5 A#4/1 B4/1 C#5/1 A#4/1 | B4/4 G4/1 A4/1 B4/1 G4/7 F#4/2",
      A: "D4/2 E4/1 F#4/5 E4/1 F#4/1 G4/1 E4/5 | D4/1 E4/1 F#4/1 D4/5 C#4/2 E4/2 C#4/4",
      B: "D3/2 D2/2 G2/2 G3/2 C#3/2 C#2/2 F#2/2 F#3/2 | B2/4 E3/2 E2/2 E3/2 C#3/2 F#2/2 A#2/2",
      harm: "| D:1 G:1 C#m7b5:1 F#:1 | Bm:1 Em:1 C#m7b5/E:1 F#:1 |" },
    { id: "me1", bars: 2, key: "Bm", label: "Fughetta · middle entry in B minor",
      S: "B4/4 D5/1 C#5/1 B4/1 A4/1 B4/4 G4/2 B4/2 | A#4/4t B4/4 G4/6 F#4/1 E4/1",
      A: "B3/4 F#4/4 G4/3 F#4/1 E4/2 D4/2 | C#4/1 D4/1 E4/1 C#4/1 D4/1 E4/1 F#4/1 D4/1 E4/2 C#4/2 A#3/2 F#3/2",
      B: "B2/8 E2/4 C#3/4 | F#2/4 B2/4 E2/4 F#2/2 A#2/2",
      harm: "| Bm:2 Em:1 C#m7b5:1 | F#7:1 Bm:1 C#dim/E:1 F#7:1 |" },
    { id: "ep2", bars: 2, key: "G", label: "Fughetta · episode: a chain of 7–6 suspensions",
      S: "D4/1 F#4/1 B4/1 D5/1 C#5/1 B4/1 A4/1 B4/1 D5/1 B4/1 G4/1 B4/1 A4/1 G4/1 F#4/1 G4/1 | B4/1 G4/1 E4/1 G4/1 C5/1 B4/1 A4/1 B4/1 D5/1 E5/1 D5/1 C5/5",
      A: "B3/2 G4/4 F#4/4 E4/4 D4/2~ | D4/2 C4/2 E4/4 F#4/4 A4/2 F#4/2",
      B: "B2/4 A2/4 G2/4 F#2/4 | E2/4 A2/4 D3/4 D2/4",
      harm: "| Bm:1 A7:1 Gmaj7:1 F#m7:1 | Em7:1 Am7:1 D7:2 |" },
    { id: "me2", bars: 2, key: "G", label: "Fughetta · middle entry in G, in the bass",
      S: "B4/4 F#5/2 D5/2 B4/4 C5/2 E5/2 | D5/8 C5/4t A4/2 F#4/2",
      A: "G4/4 B4/1 A4/1 G4/1 F#4/1 G4/4 E4/2 G4/2 | F#4/4 G4/4 E4/6 D4/1 C4/1",
      B: "G2/4 D3/4 E3/3 D3/1 C3/2 B2/2 | A2/1 B2/1 C3/1 A2/1 B2/1 C3/1 D3/1 B2/1 C3/2 A2/2 F#2/2 D2/2",
      harm: "| G:1 Bm/D:1 Em:1 C:1 | D7/A:1 G/B:1 Am/C:1 D7:1 |" },
    { id: "ep3", bars: 2, key: "D", label: "Fughetta · episode: the bass climbs by semitones",
      S: "G4/2 D5/6 C#5/2 E5/6 | D5/2 F#5/2 G5/2 E5/2 D5/4 C#5/4",
      A: "B3/1 A3/1 B3/1 D4/1 E4/1 D4/1 B3/1 E4/1 C#4/1 B3/1 C#4/1 E4/1 F#4/1 E4/1 F#4/1 C#4/1 | B3/1 C#4/1 D4/1 B3/1 E4/1 F#4/1 G4/1 E4/5 A3/1 B3/1 C#4/1 E4/1",
      B: "G2/4 G#2/4 A2/4 A#2/4 | B2/4 G2/4 G#2/4 A2/4",
      harm: "| G:1 E7/G#:1 A:1 F#7/A#:1 | Bm:1 Em/G:1 E7/G#:1 A:1 |" },
    { id: "final", bars: 2, key: "D", label: "Fughetta · final entry in the treble over a dominant pedal", pedal: true,
      S: "D5/4 A5/4 B5/3 A5/1 G5/2 F#5/2 | E5/1 F#5/1 G5/1 E5/1 F#5/1 G5/1 A5/1 F#5/1 G5/2 E5/2 C#5/2 A4/2",
      A: "A4/4 F#5/1 E5/1 D5/1 C#5/1 D5/4 B4/2 D5/2 | C#5/4 D5/4 B4/4 A4/2 G4/2",
      B: "A2/4 A2/4 A2/4 A2/4 | A2/4 A2/4 A2/4 A2/2 C#3/2",
      harm: "| D/A:1 F#m/A:1 Bm/A:1 G/A:1 | A7:1 D/A:1 Em/A:1 A7:1 |" },
    { id: "coda", bars: 3, key: "D", label: "Fughetta · tonic pedal, plagal turn and cadence", pedal: true, final: true,
      S: "D5/2 F#5/2 A5/4 B5/3 A5/1 G5/2 F#5/2 | B5/4 G5/4 F#5/4 E5/4t | D5/16",
      A: "F#4/2 A4/2 C5/4 B4/2 D5/2 B4/4 | G4/2 B4/6 D5/6 C#5/2 | A4/16",
      B: "D3/8 D2/8 | G2/4 E2/4 A2/8 | D2/16",
      harm: "| D:1 D7:1 G/D:1 D:1 | G:1 Em:1 D/A:1 A7:1 | D:4 |", roll: [50, 57, 66] },
    { id: "rest", bars: 1, key: "D", label: "Fughetta · tonic pedal, plagal turn and cadence", harm: "| D:4 |" },
  ];

  // ---------- II. Gigue (triplet-eighth units; a bar is four dotted quarters) ----------
  const GIGUE_A = [
    { id: "gS", bars: 2, key: "D", label: "Gigue · the subject in the treble",
      S: "A4/1 D5/1 F#5/1 A5/2 F#5/1 D5/2 B4/1 G5/2 E5/1 | C#5/1 D5/1 E5/1 F#5/1 E5/1 D5/1 G5/1 F#5/1 E5/1 D5/2 r/1",
      harm: "| D:2 Bm:1 Em:1 | A:1 D:1 A7:1 D:1 |" },
    { id: "gAns", bars: 2, key: "A", label: "Gigue · answer in the bass",
      S: "F#5/3 C#5/1 D5/1 E5/1 F#5/1 E5/1 D5/1 B4/1 C#5/1 D5/1 | E5/2 D5/1 C#5/3 B4/1 A4/1 G#4/1 A4/3",
      B: "D2/1 A2/1 C#3/1 E3/2 C#3/1 A2/2 F#2/1 D3/2 B2/1 | G#2/1 A2/1 B2/1 C#3/1 B2/1 A2/1 D3/1 C#3/1 B2/1 A2/2 r/1",
      harm: "| D:1 A:1 F#m:1 Bm:1 | E7:1 A:1 E7:1 A:1 |" },
    { id: "gEp", bars: 2, key: "A", label: "Gigue · episode: the run in sequence",
      S: "D5/1 E5/1 F#5/1 G#5/1 F#5/1 E5/1 C#5/1 D5/1 E5/1 F#5/1 E5/1 D5/1 | B4/1 C#5/1 D5/1 E5/1 D5/1 C#5/1 A4/1 B4/1 C#5/1 D5/1 C#5/1 B4/1",
      B: "B2/2 D3/1 E3/2 B2/1 A2/2 C#3/1 D3/2 A2/1 | G#2/2 B2/1 C#3/2 G#2/1 F#2/2 A2/1 B2/2 C#3/1",
      harm: "| Bm:1 E:1 A:1 D:1 | G#dim:1 C#m:1 F#m:1 Bm:1 |" },
    { id: "gCad", bars: 2, key: "A", label: "Gigue · cadence in A",
      S: "F#5/2 D5/1 E5/2 C#5/1 B4/3t A4/3 | C#5/3 E5/2 C#5/1 A5/2 E5/1 C#5/3",
      B: "D3/2 B2/1 C#3/2 A2/1 E3/2 E2/1 A2/3 | A2/1 C#3/1 E3/1 A3/2 E3/1 C#3/2 A2/1 A2/3",
      harm: "| Bm/D:1 A/C#:1 E:1 A:1 | A:4 |" },
  ];
  const GIGUE_B = [
    { id: "gInv", bars: 2, key: "A", label: "Gigue · second half: the subject upside down",
      S: "A5/1 E5/1 C#5/1 A4/2 C#5/1 E5/2 G#5/1 B4/2 D5/1 | F#5/1 E5/1 D5/1 C#5/1 D5/1 E5/1 B4/1 C#5/1 D5/1 E5/2 r/1",
      B: "r/1 A2/2 A3/2 G#3/1 C#3/2 E3/1 D3/2 B2/1 | D3/2 F#2/1 A2/2 C#3/1 G#2/2 B2/1 E2/2 E3/1",
      harm: "| A:2 C#m:1 Bm:1 | D:1 A:1 E/G#:1 E:1 |" },
    { id: "gInvAns", bars: 2, key: "D", label: "Gigue · the inversion answered in the bass",
      S: "A5/3 F#5/1 E5/1 D5/1 C#5/1 D5/1 E5/1 G5/1 F#5/1 E5/1 | G5/2 D5/3 F#5/1 G5/2 E5/1 C#5/3",
      B: "D3/1 A2/1 F#2/1 D2/2 F#2/1 A2/2 C#3/1 E2/2 G2/1 | B2/1 A2/1 G2/1 F#2/1 G2/1 A2/1 E2/1 F#2/1 G2/1 A2/2 r/1",
      harm: "| D:2 F#m/A:1 Em:1 | G/B:1 D/F#:1 Em:1 A:1 |" },
    { id: "gEp2", bars: 2, key: "Bm", label: "Gigue · episode: falling thirds toward B minor",
      S: "F#5/2 D5/1 G5/2 D5/1 G5/2 B4/1 C#5/2 E5/1 | F#5/2 D5/1 G5/2 B4/1 E5/2 C#5/1 A#4/2 C#5/1",
      B: "D3/1 C#3/1 B2/1 G2/1 A2/1 B2/1 E2/1 F#2/1 G2/1 A2/1 B2/1 C#3/1 | D3/1 C#3/1 B2/1 G2/1 A2/1 B2/1 C#3/1 D3/1 E3/1 F#2/1 C#3/1 A#2/1",
      harm: "| D:1 G:1 Em:1 A:1 | D:1 G:1 C#m7b5:1 F#:1 |" },
    { id: "gMid", bars: 2, key: "Bm", label: "Gigue · the subject in the bass, in B minor",
      S: "F#5/3 D5/1 C#5/1 B4/1 G4/1 A4/1 B4/1 C#5/1 D5/1 E5/1 | F#5/2 E5/1 D5/3 C#5/2t A#4/1 B4/3",
      B: "F#2/1 B2/1 D3/1 F#3/2 D3/1 B2/2 G2/1 E3/2 C#3/1 | A#2/1 B2/1 C#3/1 D3/1 C#3/1 B2/1 E3/1 D3/1 C#3/1 B2/2 r/1",
      harm: "| Bm:2 G:1 C#m7b5:1 | F#:1 Bm:1 F#7:1 Bm:1 |" },
    { id: "gHome", bars: 2, key: "D", label: "Gigue · the subject comes home",
      S: "A4/1 D5/1 F#5/1 A5/2 F#5/1 D5/2 B4/1 G5/2 E5/1 | C#5/1 D5/1 E5/1 F#5/1 E5/1 D5/1 G5/1 F#5/1 E5/1 D5/3",
      B: "D2/3 D3/1 E3/1 F#3/1 B2/1 C#3/1 D3/1 E3/1 F#3/1 G3/1 | A2/3 F#2/3 A2/3 D3/3",
      harm: "| D:2 Bm:1 Em:1 | A:1 D/F#:1 A7:1 D:1 |" },
  ];
  const GIGUE_END = [
    { id: "gEnd", bars: 2, key: "D", label: "Gigue · final cadence", final: true,
      S: "D5/12 | r/12", B: "D2/12 | r/12", harm: "| D:4 | D:4 |", roll: [50, 57, 66] },
  ];

  // ---------- III. Largo (sixteenth units): a trio for two trebles and continuo ----------
  // A chain of sevenths round the circle of fifths: each treble holds its note across the change of
  // harmony (third of one chord, seventh of the next) and resolves down by step, the two trebles a half
  // bar apart over a walking bass. The second phrase exchanges the voices (invertible at the octave)
  // and turns the circle's last fifth into a Neapolitan sixth (C/E), cadencing on a Picardy third.
  const LARGO = [
    { id: "lChain", bars: 4, key: "Bm", label: "Largo · two trebles in a chain of sevenths",
      S: "r/8 G5/8~ | G5/8 F#5/8~ | F#5/8 E5/8~ | E5/8 D5/8",
      A: "D5/16 | C#5/16 | B4/16 | A#4/8 B4/8",
      B: "B2/2 C#3/2 D3/2 D#3/2 E3/2 D3/2 B2/2 C#3/2 | A2/2 B2/2 C#3/2 E3/2 D3/2 C#3/2 A2/2 F#2/2 | G2/2 A2/2 B2/2 D3/2 C#3/2 B2/2 G2/2 A2/2 | F#2/2 A#2/2 C#3/2 F#2/2 B2/2 A2/2 F#2/2 A2/2",
      harm: "| Bm:2 Em7:2 | A7:2 Dmaj7:2 | Gmaj7:2 C#m7b5:2 | F#7:2 Bm:2 |" },
    { id: "lNeap", bars: 4, key: "Bm", label: "Largo · the voices exchanged, a Neapolitan sixth",
      S: "D5/16 | C#5/16 | B4/8 C5/8 | B4/8 A#4/8t",
      A: "B4/8 G4/8~ | G4/8 F#4/8~ | F#4/8 E4/8 | D4/8 E4/8",
      B: "B2/2 C#3/2 D3/2 F#3/2 E3/2 F#3/2 G3/2 E3/2 | A2/2 B2/2 C#3/2 E3/2 D3/2 E3/2 F#3/2 D3/2 | G2/2 A2/2 B2/2 G2/2 E2/2 G2/2 C3/2 G2/2 | F#2/2 D3/2 B2/2 G2/2 F#2/2 A#2/2 C#3/4",
      harm: "| Bm:2 Em7:2 | A7:2 Dmaj7:2 | Gmaj7:2 C/E:2 | Bm/F#:2 F#7:2 |" },
  ];
  const LARGO_END = [
    { id: "lEnd", bars: 2, key: "Bm", label: "Largo · a Picardy third", final: true,
      S: "B4/16 | r/16", A: "D#4/16 | r/16", B: "B2/16 | r/16", harm: "| B:4 | B:4 |", roll: [54, 59, 66] },
  ];

  // ---------- assembling a movement ----------
  function build(sections, unit, barUnits) {
    const voices = { S: [], A: [], B: [] }, harm = [], marks = [];
    let bar = 0;
    for (const s of sections) {
      const at = bar * 4;
      s.start = at;
      marks.push({ beat: at, sec: s });
      for (const v of ["S", "A", "B"]) {
        if (!s[v]) continue;
        parse(s[v], unit, barUnits, `${s.id} ${v}`).forEach((n) => voices[v].push({ ...n, beat: n.beat + at, sec: s }));
      }
      T.progression(s.harm, 4).forEach((h) => harm.push({ beat: at + h.bar * 4 + h.beat, dur: h.dur, chord: h.chord }));
      bar += s.bars;
    }
    return { voices, harm, marks, beats: bar * 4 };
  }
  const tag = (secs, part) => secs.map((s) => ({ ...s, part }));
  const MOVES = {
    fugue: build(FUGUE, 0.25, 16),
    gigue: build([...tag(GIGUE_A, "A1"), ...tag(GIGUE_A, "A2"), ...tag(GIGUE_B, "B1"), ...tag(GIGUE_B, "B2"), ...tag(GIGUE_END, "B2")], 1 / 3, 12),
    largo: build([...tag(LARGO, "L1"), ...tag(LARGO, "L2"), ...tag(LARGO_END, "L2")], 0.25, 16),
  };

  // ---------- registrations ----------
  // reg(sec) -> { four: 4′ coupled, lute: lute stop, rec: recorder takes (or doubles) the treble,
  //               oboeA: oboe takes the alto, oboeS: oboe doubles the treble, cello, double: gigue divisions, timp }
  const FUGUE_REG = [
    { name: "harpsichord, cello continuo", trill: 1, mord: 0,
      reg: (s) => ({ four: s.id === "final" || s.id === "coda", cello: s.id !== "expo1" }) },
    { name: "a trio: recorder, harpsichord and cello", trill: 1, mord: 0.3, recAlone: true,
      reg: (s) => ({ four: true, rec: s.id !== "expo1", cello: s.id !== "expo1" }) },
    { name: "oboe on the alto, lute stop in the episodes, drums at the close", trill: 1, mord: 0.2,
      reg: (s) => ({ lute: /^ep/.test(s.id), oboeA: ["expo2", "codetta", "expo3", "me2", "final"].includes(s.id),
        four: s.id === "final" || s.id === "coda", cello: s.id !== "expo1", timp: s.id === "final" || s.id === "coda" }) },
  ];
  const GIGUE_REG = [
    { names: { A1: "harpsichord", A2: "with 4′ and cello, in divisions", B1: "cello continuo", B2: "recorder doubling, in divisions" }, trill: 1,
      parts: { A1: {}, A2: { four: true, cello: true, double: true }, B1: { cello: true }, B2: { four: true, cello: true, rec: true, double: true, timp: true } } },
    { names: { A1: "lute stop", A2: "8′ and 4′, oboe doubling", B1: "cello, in divisions", B2: "recorder, full harpsichord" }, trill: 1,
      parts: { A1: { lute: true }, A2: { four: true, cello: true, oboeS: true }, B1: { cello: true, double: true }, B2: { four: true, cello: true, rec: true, timp: true } } },
    { names: { A1: "recorder and cello", A2: "lute-stop echo, in divisions", B1: "8′ and 4′", B2: "oboe doubling, in divisions" }, trill: 1,
      parts: { A1: { rec: true, cello: true }, A2: { lute: true, double: true }, B1: { four: true, cello: true }, B2: { four: true, cello: true, oboeS: true, double: true, timp: true } } },
  ];
  // Largo: S/A/B name the track that carries each line; chords = harpsichord realization of the figured bass
  const LARGO_REG = [
    { names: { L1: "recorder above, oboe below", L2: "oboe above, recorder below" }, trill: 1,
      parts: { L1: { S: "rec", A: "oboe", cello: true, chords: true }, L2: { S: "oboe", A: "rec", cello: true, chords: true } } },
    { names: { L1: "recorder and harpsichord", L2: "recorder and oboe" }, trill: 1,
      parts: { L1: { S: "rec", A: "hA", cello: true }, L2: { S: "rec", A: "oboe", cello: true, chords: true } } },
    { names: { L1: "oboe and recorder", L2: "oboe over the lute stop" }, trill: 1,
      parts: { L1: { S: "oboe", A: "rec", cello: true, chords: true }, L2: { S: "oboe", A: "luteA", B: "luteB", cello: true } } },
  ];
  const PART_NAME = { A1: "", A2: " (repeat)", B1: "", B2: " (repeat)", L1: "", L2: " (repeat)" };
  // fast, slow, fast: fughetta, largo, gigue, each time in a new registration
  const SEQ = [["fugue", 0], ["largo", 0], ["gigue", 0], ["fugue", 1], ["largo", 1], ["gigue", 1], ["fugue", 2], ["largo", 2], ["gigue", 2]];

  // ---------- ornaments ----------
  const KEYS = { D: T.scale("D", "ionian"), A: T.scale("A", "ionian"), G: T.scale("G", "ionian"), Bm: T.scale("B", "aeolian") };
  /** Trill from the upper note in 32nds, ending on the main note; mordent main-lower-main. */
  function ornament(n, kind) {
    const pcs = KEYS[n.sec.key];
    if (kind === "t") {
      const up = T.step(n.note, 1, pcs), step = 0.125;
      const k = Math.max(4, 2 * Math.floor((n.dur * 0.7) / (2 * step))); // even: upper, main, ..., upper, then main held
      const out = [];
      for (let i = 0; i < k - 1; i++) out.push({ off: i * step, dur: step, note: i % 2 ? n.note : up });
      out.push({ off: (k - 1) * step, dur: n.dur - (k - 1) * step, note: n.note });
      return out;
    }
    const lo = T.step(n.note, -1, pcs);
    return [{ off: 0, dur: 0.11, note: n.note }, { off: 0.11, dur: 0.11, note: lo }, { off: 0.22, dur: n.dur - 0.22, note: n.note }];
  }

  // ---------- performing a movement ----------
  const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  /** Transpose a chord symbol (root and slash bass) by t semitones. */
  function trChord(sym, t) {
    if (!t) return sym;
    const m = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/.exec(sym);
    const names = t === 3 ? T.NAMES : SHARP;
    const nm = (x) => names[T.mod12(T.PC[x] + t)];
    return nm(m[1]) + m[2] + (m[3] ? "/" + nm(m[3]) : "");
  }
  const KEY_NAME = { 0: "", 2: " · in E", 3: " · in F" };

  /** Continuo realization: the chord tones the trebles are not sounding (never doubling a suspension),
   *  placed between lo and hi near the previous chord. */
  function realize(sym, avoid, lo, hi, prev) {
    const c = T.chord(sym);
    let tones = c.pcs.filter((p) => !avoid.includes(p) && p !== c.bass);
    if (tones.length < 2 && !avoid.includes(c.root)) tones = [...new Set([...tones, c.root])];
    tones = tones.slice(0, 3);
    const center = prev && prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : (lo + hi) / 2;
    let notes = tones.map((p) => T.nearest(Math.round(center), [p], lo, hi)).sort((a, b) => a - b);
    for (let i = 1; i < notes.length; i++) if (notes[i] - notes[i - 1] <= 2 && notes[i - 1] - 12 >= lo) notes[i - 1] -= 12;
    notes = [...new Set(notes)].sort((a, b) => a - b);
    return notes;
  }

  function perform(kind, variant, r, trans = 0) {
    const M = MOVES[kind];
    const fugue = kind === "fugue";
    const cfg = { fugue: FUGUE_REG, gigue: GIGUE_REG, largo: LARGO_REG }[kind][variant];
    const regOf = (sec) => (fugue ? cfg.reg(sec) : cfg.parts[sec.part]);
    const ev = [];
    const add = (track, abs, dur, note, vel, extra) => ev.push({ track, abs, dur, note, vel: Math.max(0.05, Math.min(1, vel)), ...extra });
    // ritardando into the final chord
    const fin = M.marks.find((m) => m.sec.final);
    const ritEnd = fin.sec.start + (fugue ? 8 : 0), ritStart = ritEnd - (fugue ? 2 : 2);
    const delay = (abs) => (abs <= ritStart ? 0 : 0.26 * Math.pow(Math.min(1, (abs - ritStart) / (ritEnd - ritStart)), 1.6));

    const VEL = { S: 0.74, A: 0.7, B: 0.58 };
    for (const v of ["S", "A", "B"]) {
      const notes = M.voices[v];
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i], sec = n.sec, reg = regOf(sec);
        const next = notes[i + 1];
        const inBar = n.beat % 4;
        const vel = (VEL[v] + (inBar < 1e-6 ? 0.04 : 0) + r.gauss(0.015)) * (kind === "largo" && v === "B" ? 0.75 : 1);
        // gigue divisions: fill a long-short third with a passing note
        let segs = [{ off: 0, dur: n.dur, note: n.note, main: true }];
        if (!fugue && reg.double && v === "S" && Math.abs(n.dur - 2 / 3) < 1e-6 && next && Math.abs(next.beat - n.beat - n.dur) < 1e-6
          && [3, 4].includes(Math.abs(next.note - n.note)) && r.chance(0.75)) {
          const pass = T.step(n.note, Math.sign(next.note - n.note), KEYS[sec.key]);
          segs = [{ off: 0, dur: 1 / 3, note: n.note, main: true }, { off: 1 / 3, dur: 1 / 3, note: pass }];
        }
        // largo repeat: the top line turns once round its held note before it becomes a suspension
        if (kind === "largo" && sec.part === "L2" && v === "S" && n.dur >= 3.9 && r.chance(0.7)) {
          segs = [{ off: 0, dur: 1.5, note: n.note, main: true }, { off: 1.5, dur: 0.25, note: T.step(n.note, -1, KEYS[sec.key]) }, { off: 1.75, dur: n.dur - 1.75, note: n.note }];
        }
        let orn = null;
        if (n.orn === "t" && r.chance(cfg.trill)) orn = "t";
        else if (fugue && cfg.mord && v !== "B" && n.dur >= 1 && inBar % 1 < 1e-6 && /^(expo|me)/.test(sec.id) && r.chance(cfg.mord * 0.5)) orn = "m";
        if (orn) segs = ornament(n, orn).map((s) => ({ ...s, main: false }));

        // who plays this line
        const carriers = [];
        const hTrack = "h" + v;
        if (reg[v]) carriers.push(reg[v]);
        else if (v === "S" && reg.rec && cfg.recAlone) carriers.push("rec");
        else if (v === "A" && reg.oboeA) carriers.push("oboe");
        else carriers.push(reg.lute ? "lute" + v : hTrack);
        if (v === "S" && reg.rec && !cfg.recAlone) carriers.push("rec");
        if (v === "S" && reg.oboeS) carriers.push("oboe");
        for (const s of segs) {
          const abs = n.beat + s.off;
          const art = s.dur <= 0.34 ? 0.92 : s.dur <= 0.5 ? 0.94 : 0.96;
          const pedalRestrike = sec.pedal && v === "B";
          carriers.forEach((tr, ci) => {
            const wind = tr === "rec" || tr === "oboe";
            const extra = { delay: delay(abs) };
            if (ci === 0) { extra.v = v; if (!s.main) extra.orn = true; }
            const wv = kind === "largo" ? (v === "S" ? 0.62 : 0.56) : 0.6 + (vel - 0.7) * 0.6;
            add(tr, abs, s.dur * (pedalRestrike ? 0.8 : wind ? 0.97 : art), s.note, wind ? wv : vel * (reg.lute || /^lute/.test(tr) ? 0.9 : 1), extra);
          });
          if (reg.four && !reg.lute && (v !== "S" || !(reg.rec && cfg.recAlone))) add("four", abs, s.dur * art, s.note, vel * 0.8, { delay: delay(abs) });
        }
      }
    }
    // cello continuo doubles the bass line (sustaining through pedals instead of re-striking)
    const bass = M.voices.B;
    for (let i = 0; i < bass.length; i++) {
      const n = bass[i], reg = regOf(n.sec);
      if (!reg.cello) continue;
      let dur = n.dur;
      if (n.sec.pedal) {
        if (i > 0 && bass[i - 1].note === n.note && bass[i - 1].sec.pedal && Math.abs(bass[i - 1].beat + bass[i - 1].dur - n.beat) < 1e-6) continue;
        for (let j = i + 1; j < bass.length && bass[j].note === n.note && Math.abs(bass[j - 1].beat + bass[j - 1].dur - bass[j].beat) < 1e-6; j++) dur += bass[j].dur;
      }
      add("cello", n.beat, dur * (dur >= 1 ? 0.95 : 0.86), n.note, (kind === "largo" ? 0.45 : 0.58) + (n.beat % 4 < 1e-6 ? 0.05 : 0), { delay: delay(n.beat) });
    }
    // final chord: the harpsichordist rolls in the missing chord tones
    const rollSec = fin.sec, rollAt = rollSec.start + (fugue ? 8 : 0);
    rollSec.roll.forEach((m, k) => add("roll", rollAt + 0.06 * (k + 1), 3.6, m, 0.5, { delay: delay(rollAt) + 0.02 }));
    // timpani in D and A for the closing pedals
    const timpOn = M.marks.some((m) => regOf(m.sec).timp);
    if (timpOn) {
      const A2 = 45, D3 = 50;
      const hits = fugue
        ? [[68, A2, 0.6], [70, A2, 0.42], [72, A2, 0.55], [74, A2, 0.42], [75.5, A2, 0.38], [76, D3, 0.62], [80, D3, 0.5], [82, A2, 0.55], [83, A2, 0.3], [83.25, A2, 0.36], [83.5, A2, 0.42], [83.75, A2, 0.48], [84, D3, 0.7]]
        : [[0, D3, 0.55], [4, A2, 0.5], [6, A2, 0.45], [7, D3, 0.5], [8, D3, 0.68]].map(([b, m, x]) => [M.marks.find((mk) => mk.sec.id === "gHome" && mk.sec.part === "B2").beat + b, m, x]);
      hits.forEach(([b, m, x]) => add("timp", b, 0.9, m, x, { delay: delay(b) }));
    }
    // largo: the harpsichordist realizes the bass with quiet chords between bass and trebles
    if (kind === "largo") {
      let prev = null;
      for (const h of M.harm) {
        const sec = M.marks.filter((m) => m.beat <= h.beat + 1e-6).pop().sec;
        if (sec.final || !regOf(sec).chords) { prev = null; continue; }
        const sounding = ["S", "A"].map((v) => M.voices[v].find((n) => n.beat <= h.beat + 1e-6 && n.beat + n.dur > h.beat + 1e-6)).filter(Boolean);
        const hi = Math.max(59, Math.min(62, Math.min(...sounding.map((n) => n.note), 66) - 3));
        const vo = realize(h.chord, sounding.map((n) => T.mod12(n.note)), 52, hi, prev);
        prev = vo;
        vo.forEach((m, k) => add("chords", h.beat + 0.03 * k, h.dur * 0.92 - 0.03 * k, m, 0.34, { delay: delay(h.beat) }));
      }
    }
    const label = (sec) => (fugue ? `${sec.label} · ${cfg.name}` : `${sec.label}${PART_NAME[sec.part] || ""} · ${cfg.names[sec.part]}`) + KEY_NAME[trans];
    ev.forEach((e) => { e.note = Array.isArray(e.note) ? e.note.map((m) => m + trans) : e.note + trans; });
    return { events: ev, harm: M.harm.map((h) => ({ ...h, chord: trChord(h.chord, trans) })), marks: M.marks.map((m) => ({ beat: m.beat, label: label(m.sec) })), beats: M.beats };
  }

  // ---------- instruments built here ----------
  /** Harpsichord: per-register bright plucked spectrum (upper partials decay fast), quill click, damper on key-up. */
  function harpsichord(ctx, o = {}) {
    const { I } = ctx;
    const out = ctx.keep(new Tone.Gain(db((o.volume ?? 0) - 3)));
    const eq = ctx.keep(new Tone.EQ3({ low: -2, mid: 0, high: o.high ?? 1.5, lowFrequency: 220, highFrequency: 3200 })).connect(out);
    const hp = ctx.keep(new Tone.Filter({ frequency: 70, type: "highpass" })).connect(eq);
    const lp = ctx.keep(new Tone.Filter({ frequency: o.cutoff ?? 9000, type: "lowpass", rolloff: -12 })).connect(hp);
    const pans = [-0.2, 0, 0.2].map((p) => ctx.keep(new Tone.Panner(p)).connect(lp));
    const poly = (partials, decay, gainDb, pan, detune = 0) => {
      const s = ctx.keep(new Tone.PolySynth({ voice: Tone.Synth, maxPolyphony: 32, options: {
        detune, oscillator: { type: "custom", partials }, envelope: { attack: 0.001, decay, sustain: 0, release: o.release ?? 0.09 } } }));
      s.volume.value = gainDb;
      s.connect(pans[pan]);
      return s;
    };
    const lute = !!o.lute;
    const BODY = lute ? [1, 0.45, 0.22, 0.1, 0.05] : (o.body ?? [1, 0.85, 0.7, 0.55, 0.4, 0.28, 0.16]);
    const BRIGHT = [0, 0, 0, 0.25, 0.35, 0.35, 0.3, 0.12, 0.16, 0.2, 0.22, 0.2, 0.16, 0.11, 0.06, 0.03];
    const decays = lute ? [1.3, 0.9, 0.6] : (o.decays ?? [4.2, 3, 1.9]);
    const body = [0, 1, 2].map((k) => poly(BODY, decays[k], 0, k, o.detune ?? 0));
    const bright = lute ? null : [0, 1, 2].map((k) => poly(BRIGHT, [0.45, 0.32, 0.22][k], o.brightDb ?? -3, k, o.detune ?? 0));
    let click = null, clickT = null;
    if (!lute && o.click !== false) {
      const bp = ctx.keep(new Tone.Filter({ frequency: 3800, type: "bandpass", Q: 0.9 })).connect(lp);
      click = ctx.keep(new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.0005, decay: 0.012, sustain: 0, release: 0.01 } })).connect(bp);
      click.volume.value = -22;
      clickT = I.monotonic(click);
    }
    if (lute) { lp.frequency.value = o.cutoff ?? 1900; }
    const shift = o.transpose ?? 0;
    return {
      out,
      play(time, notes, dur, vel = 0.7) {
        (Array.isArray(notes) ? notes : [notes]).forEach((m0) => {
          const m = m0 + shift, k = m < 50 ? 0 : m < 70 ? 1 : 2, f = T.hz(m);
          body[k].triggerAttackRelease(f, dur, time, vel);
          if (bright) bright[k].triggerAttackRelease(f, dur, time, vel);
          if (click) click.triggerAttackRelease(0.01, clickT(time), vel * 0.8);
        });
      },
    };
  }
  /** Baroque cello: bowed, slightly nasal, détaché, a little vibrato. */
  function cello(ctx, o = {}) {
    const { I } = ctx;
    const out = ctx.keep(new Tone.Gain(db((o.volume ?? 0) - 11)));
    const vib = ctx.keep(new Tone.Vibrato({ frequency: 4.7, depth: 0.03 })).connect(out);
    const body = ctx.keep(new Tone.Filter({ frequency: 2300, type: "lowpass", rolloff: -12 })).connect(vib);
    const s = ctx.keep(new Tone.MonoSynth({
      oscillator: { type: "custom", partials: [1, 0.62, 0.48, 0.36, 0.27, 0.2, 0.15, 0.11, 0.08, 0.06] },
      filter: { type: "lowpass", rolloff: -24, Q: 0.7 },
      envelope: { attack: 0.045, decay: 0.3, sustain: 0.72, release: 0.16 },
      filterEnvelope: { attack: 0.06, decay: 0.5, sustain: 0.55, release: 0.3, baseFrequency: 230, octaves: 2.3 },
    })).connect(body);
    const mono = I.monotonic(out);
    return { out, play(t, note, dur, vel = 0.6) { s.triggerAttackRelease(T.hz(note), dur, mono(t), vel); } };
  }
  /** Baroque timpani: one tuned kettle per pitch, soft sticks. */
  function timpani(ctx, o = {}) {
    const { I } = ctx;
    const out = ctx.keep(new Tone.Gain(db((o.volume ?? 0) - 6)));
    const lp = ctx.keep(new Tone.Filter({ frequency: 800, type: "lowpass" })).connect(out);
    // two kettles, built up front (nodes made during playback would belong to the wrong context offline)
    const kettles = [0, 1].map(() => {
      const s = ctx.keep(new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 0.8, envelope: { attack: 0.002, decay: 1.6, sustain: 0, release: 1.2 } })).connect(lp);
      return { s, mono: I.monotonic(s) };
    });
    const tuned = new Map();
    return {
      out,
      play(t, note, dur, vel = 0.5) {
        if (!tuned.has(note)) tuned.set(note, tuned.size % 2);
        const d = kettles[tuned.get(note)];
        d.s.triggerAttackRelease(T.hz(note), Math.min(dur, 1.4), d.mono(t), vel);
      },
    };
  }

  Sim.register({
    id: "royal-charter",
    title: "Royal Charter",
    genre: "Baroque counterpoint",
    about: "A three-voice fughetta in D (tonal answer, invertible countersubject, middle entries in B minor and G, a final entry over a dominant pedal), a B-minor Largo on a chain of sevenths, and a gigue whose second half inverts its subject; harpsichord, cello, recorder, oboe and timpani, re-registered on every pass.",
    bpm: 84, beatsPerBar: 4, swing: 0.5, cycleBars: 2, gainDb: 0,

    instruments(ctx) {
      const { I, out } = ctx;
      const hall = I.reverb(ctx, out, { decay: 2.4, preDelay: 0.02, lowcut: 220, highcut: 6000 });
      const room = I.reverb(ctx, out, { decay: 1.1, preDelay: 0.006, lowcut: 300, highcut: 7500 });
      const hpsi = harpsichord(ctx, { volume: 0 });
      const four = harpsichord(ctx, { volume: -9, transpose: 12, body: [1, 0.6, 0.4, 0.25, 0.15], decays: [2.4, 1.8, 1.2], brightDb: -9, detune: 4, click: false });
      const lute = harpsichord(ctx, { volume: -1, lute: true });
      const vc = cello(ctx, { volume: -8 });
      const rec = I.flute(ctx, { volume: -1, vibratoDepth: 0.012, breath: -27, attack: 0.035, glide: 0.012, cutoff: 3000 });
      const oboe = I.oboe(ctx, { volume: -4, vibratoDepth: 0.02, cutoff: 3000 });
      const timp = timpani(ctx, { volume: -6 });
      const hp = I.place(ctx, hpsi, 0, out), fp = I.place(ctx, four, 0.08, out), lp = I.place(ctx, lute, 0, out);
      const cp = I.place(ctx, vc, -0.18, out), rp = I.place(ctx, rec, 0.32, out), op = I.place(ctx, oboe, -0.3, out), tp = I.place(ctx, timp, -0.08, out);
      I.send(ctx, hp, room, -14); I.send(ctx, hp, hall, -15); I.send(ctx, fp, hall, -14); I.send(ctx, lp, hall, -13);
      I.send(ctx, cp, hall, -16); I.send(ctx, rp, hall, -10); I.send(ctx, op, hall, -11); I.send(ctx, tp, hall, -9);
      const H = (inst) => (t, e, d) => inst.play(t, e.note, d, e.vel);
      const hum = { timing: 0.004, vel: 0.03 };
      return {
        hS: { layer: "melody", play: H(hpsi), humanize: hum },
        hA: { layer: "harmony", play: H(hpsi), humanize: hum },
        hB: { layer: "bass", play: H(hpsi), humanize: hum },
        luteS: { layer: "melody", play: H(lute), humanize: hum },
        luteA: { layer: "harmony", play: H(lute), humanize: hum },
        luteB: { layer: "bass", play: H(lute), humanize: hum },
        four: { layer: "texture", play: H(four), humanize: hum },
        roll: { layer: "harmony", play: H(hpsi), humanize: { timing: 0.002 } },
        chords: { layer: "harmony", play: H(lute), humanize: { timing: 0.008 } },
        rec: { layer: "melody", play: H(rec), humanize: { timing: 0.006, vel: 0.04 } },
        oboe: { layer: "harmony", play: H(oboe), humanize: { timing: 0.006, vel: 0.04 } },
        cello: { layer: "bass", play: H(vc), humanize: { timing: 0.006, vel: 0.05 } },
        timp: { layer: "drums", play: H(timp), humanize: { timing: 0.004, vel: 0.06 } },
      };
    },

    compose({ cycle, rng: r, state }) {
      const CB = 8; // beats per cycle
      if (!state.q) Object.assign(state, { q: [], harm: [], marks: [], end: 0, k: 0 });
      const start = cycle * CB, end = start + CB;
      while (state.end < end + 4) { // queue whole movements, one at a time
        const [kind, variant] = SEQ[state.k % SEQ.length];
        // each full rotation of the suite returns in a new key: D, F, D, E
        const trans = [0, 3, 0, 2][Math.floor(state.k / SEQ.length) % 4];
        const p = perform(kind, variant, r.fork(state.k + 17), trans);
        const at = state.end;
        p.events.forEach((e) => state.q.push({ ...e, abs: e.abs + at }));
        p.harm.forEach((h) => state.harm.push({ ...h, beat: h.beat + at }));
        p.marks.forEach((m) => state.marks.push({ ...m, beat: m.beat + at }));
        state.end += p.beats; state.k++;
      }
      const events = [], harmony = [], keep = [];
      for (const e of state.q) {
        if (e.abs >= end - 1e-9) { keep.push(e); continue; }
        const rel = e.abs - start, bar = Math.floor(rel / 4 + 1e-9);
        const { abs, ...ev } = e;
        events.push({ ...ev, bar, beat: +(rel - bar * 4).toFixed(6) });
      }
      state.q = keep;
      state.harm = state.harm.filter((h) => {
        if (h.beat >= end - 1e-9) return true;
        const rel = h.beat - start, bar = Math.floor(rel / 4 + 1e-9);
        harmony.push({ bar, beat: rel - bar * 4, dur: h.dur, chord: h.chord });
        return false;
      });
      let label = "";
      state.marks = state.marks.filter((m) => {
        if (m.beat <= start + 1e-9) { label = m.label; return false; }
        return true;
      });
      if (label) state.label = label;
      return { events, harmony, section: state.label, state };
    },
  });
})();
