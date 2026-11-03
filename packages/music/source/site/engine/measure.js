// Dev helper (not loaded by the page): perceptual-ish loudness of offline renders.
// Loudness = RMS after a one-pole 150 Hz high-pass (rough stand-in for K-weighting).
(function () {
  "use strict";
  function loud(buf) {
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, sr = buf.sampleRate;
    const rc = 1 / (2 * Math.PI * 150), a = rc / (rc + 1 / sr);
    let y = 0, px = 0, s = 0, pk = 0;
    for (let i = 0; i < L.length; i++) { const x = (L[i] + R[i]) / 2; y = a * (y + x - px); px = x; s += y * y; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
    return { loud: +(10 * Math.log10(s / L.length + 1e-12)).toFixed(1), peak: +pk.toFixed(2) };
  }
  Sim.measure = async function (id, { seconds = 40, seed = 7, layers = true } = {}) {
    const p = Sim.pieces.find((x) => x.id === id);
    const out = { all: loud(await Sim.renderOffline(p, { seconds, seed, master: false })) };
    if (layers) for (const l of Sim.LAYERS) { const r = loud(await Sim.renderOffline(p, { seconds, seed, layers: [l], master: false })); if (r.loud > -120) out[l] = r.loud; }
    return out;
  };
})();

// ---------- exports (dev server only): render pieces to renders/<id>.mp3 ----------
(function () {
  "use strict";
  // Offline rendering yields with setTimeout(0); a hidden tab throttles those to once a second or worse.
  if (!window.__fastTimeouts) {
    const ch = new MessageChannel(), q = [];
    ch.port1.onmessage = () => { const f = q.shift(); if (f) f(); };
    const orig = window.setTimeout.bind(window);
    window.setTimeout = (fn, d, ...a) => { if (!d || d <= 4) { q.push(() => fn(...a)); ch.port2.postMessage(0); return -1; } return orig(fn, d, ...a); };
    window.__fastTimeouts = true;
  }
  function wav(buf, fadeIn = 0.05, fadeOut = 6) {
    const sr = buf.sampleRate, n = buf.length, ch = buf.numberOfChannels;
    const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
    const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); out.setUint32(4, 36 + n * ch * 2, true); w(8, "WAVEfmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
    out.setUint16(22, ch, true); out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
    w(36, "data"); out.setUint32(40, n * ch * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) {
      const t = i / sr, g = Math.min(1, t / fadeIn, (n / sr - t) / fadeOut);
      for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, (data[c][i] || 0) * g)); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
    }
    return new Blob([out], { type: "audio/wav" });
  }
  /** Render one piece (with the master bus) and save it as renders/<id>.mp3. */
  Sim.exportPiece = async function (id, { seconds = 180, seed = 1, sampleRate = 44100 } = {}) {
    const p = Sim.pieces.find((x) => x.id === id);
    const buf = await Sim.renderOffline(p, { seconds, seed, sampleRate, master: true });
    const r = await fetch(`/save/${id}.wav`, { method: "POST", body: wav(buf) });
    if (!r.ok) throw new Error(`save failed for ${id}: ${r.status}`);
  };
  /** Export every loaded piece (or the given ids); progress in Sim.exportLog. Writes renders/index.json. */
  Sim.exportAll = async function (ids = Sim.pieces.map((p) => p.id), opts = {}) {
    Sim.exportLog = [];
    for (const id of ids) {
      const t0 = performance.now();
      try { await Sim.exportPiece(id, opts); Sim.exportLog.push({ id, ok: true, s: Math.round((performance.now() - t0) / 1000) }); }
      catch (e) { Sim.exportLog.push({ id, ok: false, err: String(e) }); }
    }
    const meta = Sim.pieces.map((p) => {
      const t = (Sim.catalog && Sim.catalog.tags[p.id]) || {};
      return { id: p.id, file: `${p.id}.mp3`, title: p.title, genre: p.genre, bpm: p.bpm, about: p.about, situations: p.situations || t.situations || [], energy: p.energy ?? t.energy ?? null, seconds: opts.seconds || 180, seed: opts.seed || 1 };
    });
    await fetch("/save/index.json", { method: "POST", body: JSON.stringify(meta, null, 2) });
    return Sim.exportLog;
  };
})();
