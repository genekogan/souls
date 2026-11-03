(async function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const cat = Sim.catalog;

  // ---------- load the pieces listed in the catalog (missing files are skipped) ----------
  await Promise.all(cat.ids().map((id) => new Promise((res) => {
    const s = document.createElement("script");
    s.src = `pieces/${id}.js`; s.charset = "utf-8"; s.onload = s.onerror = res;
    document.head.append(s);
  })));
  const byId = Object.fromEntries(Sim.pieces.map((p) => [p.id, p]));
  const FAMILIES = cat.families.map(([name, ids]) => [name, ids.filter((id) => byId[id])]).filter(([, ids]) => ids.length);
  const listed = new Set(FAMILIES.flatMap(([, ids]) => ids));
  const extras = Sim.pieces.filter((p) => !listed.has(p.id)).map((p) => p.id);
  if (extras.length) FAMILIES.push(["More", extras]);
  const pieces = [...new Set(FAMILIES.flatMap(([, ids]) => ids))].map((id) => byId[id]); // a piece may be listed in two families
  const genres = new Set(pieces.map((p) => p.genre));
  const words = (n) => (["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"][n] || String(n));
  $("lede").textContent = `${pieces.length} pieces of music written as code, in ${genres.size} genres, in the spirit of SimCity, Spore, The Sims and their neighbours, and a houseband that plays whatever fits what is happening. Nothing is recorded. Every note is composed in your browser a few bars before it plays, so each performance is new and none of them ends.`;

  const LAYER_LABEL = { melody: "Melody", harmony: "Harmony", bass: "Bass", drums: "Drums", texture: "Texture" };
  const SIT = Object.fromEntries(cat.situations.map((s) => [s.id, s]));
  const TOUR_SECONDS = 240;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("simscore:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("simscore:" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  // Background music favours stability over latency: bigger audio buffers and a longer scheduling lookahead.
  try { Tone.setContext(new Tone.Context({ latencyHint: "playback", lookAhead: 0.2 })); } catch (e) { /* keep default context */ }
  const audioNow = () => Tone.getContext().currentTime; // the sound's clock (Tone.now() adds the lookahead)

  const notes = []; // {time, end, note, layer, vel}
  const conductor = new Sim.Conductor({
    onNote(n) {
      const ns = n.note == null ? [null] : Array.isArray(n.note) ? n.note : [n.note];
      ns.forEach((m) => notes.push({ time: n.time, end: n.time + n.dur, note: m, layer: n.layer, vel: n.vel }));
      if (notes.length > 1800) notes.splice(0, notes.length - 1800);
    },
  });
  let current = null, playing = false, startedAt = 0;
  const band = new Sim.Houseband(conductor, { play: (p) => start(p), onChange: () => showBand() });

  // ---------- chord typesetting ----------
  const pretty = (sym) => sym
    .replace(/^([A-G])b/, "$1♭").replace(/\/([A-G])b/, "/$1♭").replace(/^([A-G])#/, "$1♯").replace(/\/([A-G])#/, "/$1♯")
    .replace(/b(5|9|13)/g, "♭$1").replace(/#(5|9|11)/g, "♯$1").replace(/69/, "6/9");

  // ---------- houseband ----------
  const sitsEl = $("sits");
  const sitButtons = new Map();
  cat.situations.forEach((s) => {
    const n = pieces.filter((p) => band.tags(p).situations.includes(s.id)).length;
    if (!n) return;
    const b = document.createElement("button");
    b.className = "sit"; b.setAttribute("aria-pressed", "false");
    b.innerHTML = "<b></b><span></span><small></small>";
    b.querySelector("b").textContent = s.label;
    b.querySelector("span").textContent = s.hint;
    b.querySelector("small").textContent = `${n} tune${n > 1 ? "s" : ""}`;
    b.addEventListener("click", () => cueSituation(s.id));
    sitsEl.append(b);
    sitButtons.set(s.id, b);
  });
  const energyEl = $("energy");
  energyEl.value = Math.round(store.get("energy", 0.5) * 100);
  band.energy = energyEl.value / 100;
  async function cueSituation(id) {
    store.set("situation", id);
    sitButtons.forEach((b, k) => b.setAttribute("aria-pressed", String(k === id)));
    $("band-status").textContent = `Finding something for ${SIT[id].label.toLowerCase()}…`;
    highlight(id);
    await band.cue(id, { energy: energyEl.value / 100 });
  }
  energyEl.addEventListener("input", () => { band.setEnergy(energyEl.value / 100); store.set("energy", band.energy); showBand(); });
  energyEl.addEventListener("change", () => {
    // a big change of mood calls for a different tune, not just a quieter drummer
    if (!band.situation || !current) return;
    const d = band.tags(current).energy - band.energy;
    if (d > 0.45 || d < -0.35) band.next();
  });
  $("another").addEventListener("click", () => (band.situation ? band.next() : next()));
  function showBand() {
    const el = $("band-status");
    if (!current) return;
    const t = band.tags(current), lay = [...conductor.autoMuted];
    const sit = band.situation ? `for ${SIT[band.situation].label.toLowerCase()} · ` : "";
    el.textContent = `${sit}${current.title} · energy ${Math.round(t.energy * 100)}${lay.length ? ` · ${lay.join(" and ")} laying out` : ""}`;
  }
  function highlight(id) {
    cards.forEach((c, pid) => {
      const fits = !!id && band.tags(byId[pid]).situations.includes(id);
      c.classList.toggle("fits", fits);
      c.classList.toggle("dim", !!id && !fits);
    });
  }

  // ---------- stations: a directory grouped by family ----------
  const dir = $("stations");
  dir.replaceChildren();
  const cards = new Map();
  const meterOf = (p) => p.meter || (p.beatsPerBar === 3 ? "3/4" : p.beatsPerBar === 6 && p.strongBeats ? "12/8" : `${p.beatsPerBar}/4`);
  FAMILIES.forEach(([family, ids]) => {
    const ps = ids.map((id) => byId[id]);
    const row = document.createElement("div");
    row.className = "genre";
    const name = document.createElement("div");
    name.className = "genre-name";
    name.innerHTML = `<b></b>${ps.length} piece${ps.length > 1 ? "s" : ""}`;
    name.querySelector("b").textContent = family;
    const list = document.createElement("div");
    list.className = "pieces";
    ps.forEach((p) => {
      const t = band.tags(p);
      const btn = document.createElement("button");
      btn.className = "station";
      btn.innerHTML = `<div class="st-top"><span class="st-title"></span><span class="st-meta"></span></div><div class="st-about"></div><div class="st-tags"><span class="meter" title="energy"></span><span class="st-sit"></span></div>`;
      btn.querySelector(".st-title").textContent = p.title;
      btn.querySelector(".st-meta").textContent = `${p.genre} · ${Math.round(p.bpm)} · ${meterOf(p)}`;
      btn.querySelector(".st-about").textContent = p.about;
      const m = btn.querySelector(".meter");
      for (let i = 0; i < 5; i++) { const seg = document.createElement("i"); if (t.energy > i * 0.2 + 0.02) seg.className = "on"; m.append(seg); }
      m.title = `energy ${Math.round(t.energy * 100)}`;
      btn.querySelector(".st-sit").textContent = t.situations.map((s) => (SIT[s] ? SIT[s].label.toLowerCase() : s)).join(" · ");
      btn.addEventListener("click", () => { band.situation = null; sitButtons.forEach((b) => b.setAttribute("aria-pressed", "false")); highlight(null); start(p); });
      list.append(btn);
      cards.set(p.id, btn);
    });
    row.append(name, list);
    dir.append(row);
  });

  // ---------- layers ----------
  const chipsEl = $("layers");
  const layerOn = Object.fromEntries(Sim.LAYERS.map((l) => [l, true]));
  Sim.LAYERS.forEach((l) => {
    const b = document.createElement("button");
    b.className = "chip"; b.style.setProperty("--c", `var(--${l})`);
    b.setAttribute("aria-pressed", "true"); b.dataset.layer = l;
    b.innerHTML = `<i></i>${LAYER_LABEL[l]}`;
    b.addEventListener("click", () => {
      layerOn[l] = !layerOn[l];
      b.setAttribute("aria-pressed", String(layerOn[l]));
      conductor.setLayer(l, layerOn[l]);
    });
    chipsEl.append(b);
  });
  function showLayers(p) {
    const used = new Set(p ? p.layersUsed || Sim.LAYERS : Sim.LAYERS);
    chipsEl.querySelectorAll(".chip").forEach((c) => { c.hidden = !used.has(c.dataset.layer); });
  }

  // ---------- transport ----------
  async function start(p, seed, cycle = 0) {
    current = p;
    store.set("piece", p.id);
    cards.forEach((c, id) => c.setAttribute("aria-current", String(id === p.id)));
    $("np-title").textContent = p.title;
    $("np-sub").textContent = `${p.genre} · starting…`;
    notes.length = 0;
    await conductor.play(p, { ...(seed != null ? { seed } : {}), cycle });
    Sim.LAYERS.forEach((l) => conductor.setLayer(l, layerOn[l]));
    if (band.situation) band.applyEnergy(); else conductor.autoMuted.clear();
    applyVolume();
    p.layersUsed = [...new Set(Object.values(conductor.tracks).map((t) => t.layer))];
    showLayers(p);
    playing = true; startedAt = Tone.now();
    $("play").textContent = "Stop";
    $("ribbon-hint").hidden = true;
    showBand();
  }
  function stop() {
    conductor.stop(); playing = false;
    $("play").textContent = "Play";
    if (current) $("np-sub").textContent = `${current.genre} · stopped`;
  }
  function next() {
    if (band.situation) return band.next();
    const i = current ? pieces.indexOf(current) : -1;
    start(pieces[(i + 1) % pieces.length]);
  }
  $("play").addEventListener("click", () => (playing ? stop() : band.situation && !current ? cueSituation(band.situation) : start(current || pieces[0])));
  $("next").addEventListener("click", next);
  $("reseed").addEventListener("click", () => start(current || pieces[0]));

  const vol = $("volume");
  vol.value = store.get("volume", -6);
  function applyVolume() {
    if (!conductor.master) return;
    conductor.master.input.gain.rampTo(Math.pow(10, Number(vol.value) / 20), 0.1);
  }
  vol.addEventListener("input", () => { store.set("volume", Number(vol.value)); applyVolume(); });
  const tour = $("tour");
  tour.checked = store.get("tour", false);
  tour.addEventListener("change", () => store.set("tour", tour.checked));

  // ---------- timeline: position in the performance, and a handle to jump ahead ----------
  // Pieces never end, so the slider spans the first five minutes; dragging restarts the same performance (same seed)
  // from the cycle under the handle, with the skipped cycles composed silently so the memory is right.
  const seek = $("seek");
  const SEEK_SECONDS = Number(seek.max);
  let scrubbing = false;
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const cycleSeconds = (p) => (p.cycleBars * p.beatsPerBar * 60) / p.bpm;
  seek.addEventListener("pointerdown", () => { scrubbing = true; });
  seek.addEventListener("input", () => { scrubbing = true; $("np-time").textContent = mmss(Number(seek.value)); });
  seek.addEventListener("change", () => {
    scrubbing = false;
    if (!current) return;
    const cycle = Math.floor(Number(seek.value) / cycleSeconds(current));
    start(current, conductor.seed, cycle);
  });
  function showTime() {
    if (!current) return;
    const secs = conductor.beat() * (60 / current.bpm); // nominal tempo: a lap's position, not a stopwatch
    if (!scrubbing) { seek.value = Math.min(SEEK_SECONDS, Math.round(secs)); $("np-time").textContent = mmss(secs); }
    $("np-cycle").textContent = `cycle ${Math.floor(conductor.beat() / conductor.cycleBeats) + 1}`;
  }

  // ---------- ribbon ----------
  const cv = $("ribbon");
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let colors = {};
  const readColors = () => { colors = Object.fromEntries(Sim.LAYERS.map((l) => [l, css(`--${l}`)])); colors.ink = css("--muted"); };
  readColors();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const WINDOW = 9; // seconds of history shown
  function draw() {
    requestAnimationFrame(draw);
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const g = cv.getContext("2d"), w = cv.width, h = cv.height;
    g.clearRect(0, 0, w, h);
    if (!playing) return;
    const now = audioNow(), x0 = now - WINDOW * 0.88, px = w / WINDOW;
    const lane = h * 0.14, top = h * 0.05, pitchH = h - lane - top * 2;
    const y = (m) => top + pitchH * (1 - (Math.min(100, Math.max(24, m)) - 24) / 76);
    for (const n of notes) {
      if (n.end < x0 || n.time > now + 0.05) continue;
      const xa = (n.time - x0) * px, xb = Math.max(xa + 3 * dpr, (Math.min(n.end, now) - x0) * px);
      g.globalAlpha = 0.35 + 0.65 * n.vel;
      g.fillStyle = colors[n.layer] || colors.ink;
      if (n.note == null) { g.fillRect(xa, h - lane + 4 * dpr, 2.5 * dpr, lane - 8 * dpr); continue; }
      const yy = y(n.note), hh = Math.max(3 * dpr, pitchH / 76 * 1.6);
      g.beginPath(); g.roundRect ? g.roundRect(xa, yy - hh / 2, xb - xa, hh, hh / 2) : g.rect(xa, yy - hh / 2, xb - xa, hh); g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = colors.ink;
    g.fillRect((now - x0) * px, 0, 1 * dpr, h);
  }
  requestAnimationFrame(draw);

  // ---------- status ----------
  setInterval(() => {
    if (!playing || !current) return;
    const s = conductor.now();
    if (!s) return;
    const chordEl = $("np-chord");
    if (chordEl.dataset.sym !== s.chord) { // accidentals in a face that has them; the display face doesn't
      chordEl.dataset.sym = s.chord;
      const parts = (s.chord ? pretty(s.chord) : " ").split(/([♭♯])/).filter(Boolean);
      chordEl.replaceChildren(...parts.map((part) => {
        if (part !== "♭" && part !== "♯") return document.createTextNode(part);
        const acc = document.createElement("span"); acc.className = "acc"; acc.textContent = part; return acc;
      }));
    }
    $("np-pos").textContent = `bar ${s.bar} · beat ${s.beatInBar} · ${Math.round(s.bpm)} BPM`;
    showTime();
    $("np-sub").textContent = `${current.genre}${s.section ? " · " + s.section : ""}`;
    if (tour.checked && Tone.now() - startedAt > TOUR_SECONDS && !band.busy) { startedAt = Tone.now(); next(); }
  }, 120);

  // ---------- restore ----------
  const lastSit = store.get("situation", null);
  if (lastSit && sitButtons.has(lastSit)) { band.situation = lastSit; sitButtons.get(lastSit).setAttribute("aria-pressed", "true"); highlight(lastSit); }
  const last = byId[store.get("piece", null)];
  if (last) { current = last; $("np-title").textContent = last.title; $("np-sub").textContent = `${last.genre} · press Play`; cards.get(last.id).setAttribute("aria-current", "true"); }
  else $("np-sub").textContent = "Pick a situation above, or any station below. Sound starts on your click.";
})();
