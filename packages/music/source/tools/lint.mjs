// Lint pieces without audio: node tools/lint.mjs [pieceId ...] [--cycles N] [--verbose]
// 1. builds each piece's instruments against a strict mock of Tone (catches typos / bad calls)
// 2. composes N cycles and reports, per track: note count, range, % in chord scale, % chord tones
//    on strong beats, largest leap, notes per bar; plus low-register clashes in chords.
import { Sim, universal, loadPieces } from "./load.mjs";
const args = process.argv.slice(2);
const cycles = Number(args.includes("--cycles") ? args[args.indexOf("--cycles") + 1] : 24);
const verbose = args.includes("--verbose");
const seed = Number(args.includes("--seed") ? args[args.indexOf("--seed") + 1] : 12345);
const only = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--cycles" && args[i - 1] !== "--seed");

const T = Sim.theory;
const loadErrors = loadPieces(only);
loadErrors.forEach((e) => { console.log(`\u2717 failed to load ${e}`); process.exitCode = 1; });

let failures = 0;
for (const p of Sim.pieces) {
  if (only.length && !only.includes(p.id)) continue;
  const problems = [];
  const bpb = p.beatsPerBar;
  // instruments
  let tracks = {};
  try {
    const nodes = [];
    tracks = p.instruments({ keep: (n) => (nodes.push(n), n), out: universal("out"), I: Sim.instruments, T, bpm: p.bpm });
    for (const [name, tr] of Object.entries(tracks)) {
      if (!Sim.LAYERS.includes(tr.layer)) problems.push(`track ${name}: layer "${tr.layer}" not one of ${Sim.LAYERS.join(", ")}`);
      if (typeof tr.play !== "function") problems.push(`track ${name}: no play()`);
    }
  } catch (e) { problems.push(`instruments() threw: ${e.message}`); }
  for (const k of ["id", "title", "genre", "about", "bpm"]) if (!p[k]) problems.push(`missing ${k}`);

  // compose
  const rng = T.rng(seed);
  let state = {};
  const stats = {};
  const harmony = [];
  const played = new Set();
  const cycleBeats = p.cycleBars * bpb;
  const sections = [];
  const spans = [];
  let lastNoteByTrack = {};
  for (let c = 0; c < cycles; c++) {
    let res;
    try { res = p.compose({ cycle: c, rng: rng.fork(c), state, T }) || {}; } catch (e) { problems.push(`compose(cycle ${c}) threw: ${e.stack.split("\n").slice(0, 2).join(" | ")}`); break; }
    if (res.state) state = res.state;
    sections.push(res.section || "");
    const base = c * cycleBeats;
    (res.harmony || []).forEach((h) => harmony.push({ start: base + h.bar * bpb + h.beat, dur: h.dur, chord: h.chord }));
    for (const ev of res.events || []) {
      const tr = tracks[ev.track];
      if (!tr) { problems.push(`event on unknown track "${ev.track}"`); continue; }
      for (const k of ["bar", "beat", "dur"]) if (!Number.isFinite(ev[k])) { problems.push(`${ev.track}: non-numeric ${k} (${ev[k]})`); }
      if (ev.dur <= 0) problems.push(`${ev.track}: dur <= 0`);
      const abs = base + ev.bar * bpb + ev.beat;
      if (abs < base - bpb || abs > base + cycleBeats + 1e-6) problems.push(`${ev.track}: event outside its cycle window (bar ${ev.bar}, beat ${ev.beat})`);
      if (!played.has(ev.track)) { try { tr.play(0, { vel: 0.7, ...ev }, 0.5); played.add(ev.track); } catch (e) { problems.push(`${ev.track}.play threw: ${e.message}`); } }
      const s = (stats[ev.track] ||= { n: 0, lo: 999, hi: -999, inScale: 0, pitched: 0, strong: 0, strongChord: 0, maxLeap: 0, leaps: [], layer: tr.layer, chordEvents: 0, mud: 0 });
      s.n++;
      const ns = typeof ev.note === "number" ? [ev.note] : Array.isArray(ev.note) ? ev.note : null;
      if (!ns) continue;
      if (ns.some((m) => !Number.isFinite(m))) { problems.push(`${ev.track}: non-numeric note`); continue; }
      s.pitched++;
      ns.forEach((m) => { s.lo = Math.min(s.lo, m); s.hi = Math.max(s.hi, m); });
      ev._abs = abs; ev._ns = ns; (s.events ||= []).push(ev);
      if (tr.layer !== "drums") spans.push({ track: ev.track, a: abs, b: abs + ev.dur, ns });
      if (ns.length > 1) {
        s.chordEvents++;
        const v = ns.slice().sort((a, b) => a - b);
        for (let i = 1; i < v.length; i++) if (v[i - 1] < 52 && v[i] - v[i - 1] < 3) { s.mud++; break; }
      }
    }
  }
  // harmony conformance
  harmony.sort((a, b) => a.start - b.start);
  const chordAt = (b) => { let cur = null; for (const h of harmony) { if (h.start <= b + 1e-6) cur = h; else break; } return cur; };
  for (const [name, s] of Object.entries(stats)) {
    if (!s.events) continue;
    let prev = null;
    for (const ev of s.events.sort((a, b) => a._abs - b._abs)) {
      const h = chordAt(ev._abs);
      if (h) {
        const c = T.chord(h.chord), scale = new Set(c.scale.concat(c.pcs, [c.bass])); // a slash bass is a chord tone too
        ev._ns.forEach((m) => { if (scale.has(T.mod12(m))) s.inScale++; });
        const inBar = ((ev._abs % bpb) + bpb) % bpb;
        const onBeat = p.strongBeats ? p.strongBeats.some((x) => Math.abs(inBar - x) < 1e-6) : Math.abs(ev._abs - Math.round(ev._abs)) < 1e-6;
        if (onBeat && ev._ns.length === 1) { s.strong++; if (c.pcs.includes(T.mod12(ev._ns[0])) || c.bass === T.mod12(ev._ns[0])) s.strongChord++; }
      } else s.noHarmony = true;
      if (ev._ns.length === 1 && prev != null) { const leap = Math.abs(ev._ns[0] - prev); if (leap > s.maxLeap) s.maxLeap = leap; }
      if (ev._ns.length === 1) prev = ev._ns[0];
    }
    s.notesTotal = s.events.reduce((a, e) => a + e._ns.length, 0);
  }
  // cross-part clash audit: semitone / minor-9th rubs between different tracks, overlapping >= 1/4 beat,
  // where the two notes are not both tones of the current chord (so C13b9's C and Db are fine)
  spans.sort((x, y) => x.a - y.a);
  let clashes = 0;
  const clashPairs = {};
  const active = [];
  for (const sp of spans) {
    for (let i = active.length - 1; i >= 0; i--) if (active[i].b <= sp.a + 0.25) active.splice(i, 1);
    for (const o of active) {
      if (o.track === sp.track || Math.min(o.b, sp.b) - sp.a < 0.25) continue;
      const h = chordAt(sp.a);
      const c = h ? T.chord(h.chord) : null;
      const ok = (m) => c && (c.pcs.includes(T.mod12(m)) || c.bass === T.mod12(m));
      for (const x of o.ns) for (const y of sp.ns) {
        const d = Math.abs(x - y);
        if (d % 12 === 1 && d < 26 && !(ok(x) && ok(y))) { clashes++; const k = [o.track, sp.track].sort().join("/"); clashPairs[k] = (clashPairs[k] || 0) + 1; }
      }
    }
    active.push(sp);
  }
  const bars = cycles * p.cycleBars;
  const ok = problems.length === 0;
  if (!ok) failures++;
  console.log(`\n${ok ? "✓" : "✗"} ${p.id}  "${p.title}" (${p.genre})  ${p.bpm} BPM  ${bpb}/bar  ${cycles} cycles = ${bars} bars, ${(bars * bpb * 60 / p.bpm / 60).toFixed(1)} min`);
  if (!harmony.length) console.log("   (no harmony timeline returned: scale checks skipped)");
  for (const [name, s] of Object.entries(stats)) {
    if (!s.pitched) { console.log(`   ${name.padEnd(12)} ${s.layer.padEnd(8)} ${String(s.n).padStart(5)} hits   ${(s.n / bars).toFixed(1)}/bar`); continue; }
    const inScale = s.notesTotal ? (100 * s.inScale / s.notesTotal).toFixed(0) : "-";
    const strongChord = s.strong ? (100 * s.strongChord / s.strong).toFixed(0) : "-";
    console.log(`   ${name.padEnd(12)} ${s.layer.padEnd(8)} ${String(s.n).padStart(5)} notes  ${T.noteName(s.lo)}–${T.noteName(s.hi)}  in-scale ${inScale}%  strong-beat chord tones ${strongChord}%  max leap ${s.maxLeap}  ${(s.n / bars).toFixed(1)}/bar${s.chordEvents ? `  chords ${s.chordEvents}${s.mud ? `  MUDDY ${s.mud}` : ""}` : ""}`);
  }
  const minutes = bars * bpb * 60 / p.bpm / 60;
  const top = Object.entries(clashPairs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ");
  console.log(`   clashes: ${(clashes / minutes).toFixed(1)}/min (${clashes})${top ? "  worst: " + top : ""}`);
  if (verbose) console.log("   sections: " + [...new Set(sections)].slice(0, 12).join(" | "));
  if (Object.keys(tracks).length && Object.keys(stats).length < Object.keys(tracks).length) {
    const silent = Object.keys(tracks).filter((t) => !stats[t]);
    console.log(`   (tracks never used in ${cycles} cycles: ${silent.join(", ")})`);
  }
  problems.slice(0, 12).forEach((x) => console.log(`   ! ${x}`));
  if (problems.length > 12) console.log(`   ! …and ${problems.length - 12} more`);
}
if (failures) { console.log(`\n${failures} piece(s) with problems`); process.exitCode = 1; }
