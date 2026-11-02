// Shared loader for the Node tools: a strict mock of Tone plus the engine and all pieces.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
// ---------- strict mock Tone ----------
const CLASSES = ["Gain", "Volume", "Filter", "Reverb", "Freeverb", "JCReverb", "PolySynth", "Synth", "FMSynth", "AMSynth", "MonoSynth", "DuoSynth",
  "NoiseSynth", "MembraneSynth", "MetalSynth", "PluckSynth", "FeedbackDelay", "PingPongDelay", "Chorus", "Tremolo", "Vibrato", "AutoFilter",
  "AutoPanner", "AutoWah", "Phaser", "StereoWidener", "Panner", "Panner3D", "Channel", "Compressor", "Limiter", "EQ3", "Distortion", "BitCrusher",
  "Chebyshev", "LFO", "Oscillator", "OmniOscillator", "FatOscillator", "Noise", "Player", "Sampler", "Envelope", "AmplitudeEnvelope", "FrequencyEnvelope",
  "Signal", "Multiply", "Add", "Scale", "Merge", "Split", "Mono", "Convolver", "Waveform", "Meter", "Loop", "Part", "Sequence", "Pattern", "CrossFade", "Follower", "Gate", "MidSideCompressor", "MultibandCompressor", "PitchShift", "FrequencyShifter", "Delay", "OnePoleFilter", "LowpassCombFilter", "FeedbackCombFilter", "BiquadFilter", "Solo", "PanVol"];
const calls = { constructed: {} };
function universal(label) {
  const fn = function () { return proxy; };
  const store = {};
  const proxy = new Proxy(fn, {
    get(_, k) {
      if (k === "ready") return Promise.resolve();
      if (k === "then") return undefined;
      if (k === Symbol.toPrimitive) return () => 0;
      if (k in store) return store[k];
      if (k === "value") return 0;
      return (store[k] = universal(`${label}.${String(k)}`));
    },
    set(_, k, v) { store[k] = v; return true; },
    apply() { return proxy; },
  });
  return proxy;
}
const Tone = new Proxy({}, {
  get(_, k) {
    if (CLASSES.includes(k)) return function (...a) { calls.constructed[k] = (calls.constructed[k] || 0) + 1; return universal(k); };
    if (["now", "dbToGain", "gainToDb", "Frequency", "Time", "start", "getTransport", "getDestination", "getContext", "Destination", "Transport", "context", "Offline", "Draw", "loaded", "ToneAudioBuffer", "setContext"].includes(k)) return universal(k);
    throw new Error(`Tone.${String(k)} is not a Tone export the linter knows (typo?)`);
  },
});

const sandbox = { console, Math, Tone, Promise, setTimeout, Set, Map, Array, Object, JSON, Number, String, Error };
sandbox.globalThis = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), sandbox, { filename: f });
["engine/theory.js", "engine/compose.js", "engine/instruments.js", "engine/more-instruments.js", "engine/conductor.js"].forEach(load);
// Optional engine extensions (one per composer lane); skipped when the file does not exist yet.
["phrasing", "spc", "dialogue", "groove"].forEach((m) => { if (fs.existsSync(path.join(root, `engine/${m}.js`))) load(`engine/${m}.js`); });
/** Load piece files (pieces/<id>.js); all of them when ids is empty. Returns load errors. */
export function loadPieces(ids = []) {
  const files = fs.readdirSync(path.join(root, "pieces")).filter((f) => f.endsWith(".js")).sort()
    .filter((f) => !ids.length || ids.includes(f.replace(/\.js$/, "")));
  const errors = [];
  for (const f of files) {
    try { load(`pieces/${f}`); } catch (e) { errors.push(`${f}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); }
  }
  return errors;
}
export const Sim = sandbox.Sim;
export { universal };
