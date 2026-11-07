// G8 moderation: the classifier hook every upload passes after validation. No paid APIs.
//
// A classifier sees the validated facts (format, budgets, the metadata text found before stripping,
// the images) and returns a verdict:
//   allow       — stored and shown;
//   quarantine  — stored but hidden everywhere until the site admin releases it (logged);
//   reject      — refused; nothing is stored (the refusal is logged by sha).
// Default: `none` (allows everything). `SIM_UPLOAD_CLASSIFIER=heuristic` selects the local stub below.
// A real model (local NSFW/CSAM hash matcher, or a service) plugs in through `setUploadClassifier`.
// A classifier that throws or takes longer than `timeoutMs` quarantines (fail closed, never silently allow).
import { pngRows, type UploadFormat, type UploadImage } from './validate.ts';

export type UploadSurface = 'body' | 'asset' | 'thumbnail';
export type UploadFacts = {
  surface: UploadSurface; format: UploadFormat; sha: string; bytes: number;
  tris: number; textures: number; texPx: number;
  /** Uploader-supplied words (name, source, licence) and metadata text seen before stripping. */
  text: string[];
  images: UploadImage[];
};
export type Verdict = { action: 'allow' | 'quarantine' | 'reject'; classifier: string; labels: string[]; reason?: string; score?: number };
export interface UploadClassifier {
  readonly name: string;
  classify(facts: UploadFacts): Verdict | Promise<Verdict>;
}

export const noopClassifier: UploadClassifier = { name: 'none', classify: () => ({ action: 'allow', classifier: 'none', labels: [] }) };

/** Words that put an upload in front of a person. Matching is on whole words, case-insensitive. */
const FLAG_WORDS = ['nsfw', 'porn', 'porno', 'pornographic', 'xxx', 'nude', 'nudes', 'nudity', 'naked', 'hentai', 'explicit', 'sexual', 'csam', 'gore', 'beheading'];
const FLAG = new RegExp(`\\b(${FLAG_WORDS.join('|')})\\b`, 'i');

function paeth(a: number, b: number, c: number) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
/** Share of skin-coloured pixels (Kovač RGB rule) in an 8-bit RGB/RGBA PNG, sampling at most ~65k pixels. */
export function skinRatio(image: UploadImage): number | null {
  const d = pngRows(image); if (!d) return null;
  const { w, h, data, channels, stride } = d;
  // unfilter row by row (filters 0–4), sampling every k-th row/column
  const k = Math.max(1, Math.ceil(Math.sqrt((w * h) / 65536)));
  let prev = new Uint8Array(stride - 1), cur = new Uint8Array(stride - 1), skin = 0, seen = 0;
  for (let y = 0; y < h; y++) {
    const f = data[y * stride], row = data.subarray(y * stride + 1, (y + 1) * stride);
    for (let i = 0; i < row.length; i++) {
      const a = i >= channels ? cur[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, c) : 0;
      cur[i] = (row[i] + pred) & 255;
    }
    if (y % k === 0) for (let x = 0; x < w; x += k) {
      const o = x * channels, r = cur[o], g = cur[o + 1], bl = cur[o + 2];
      if (channels === 4 && cur[o + 3] < 128) continue;
      seen++;
      if (r > 95 && g > 40 && bl > 20 && Math.max(r, g, bl) - Math.min(r, g, bl) > 15 && Math.abs(r - g) > 15 && r > g && r > bl) skin++;
    }
    [prev, cur] = [cur, prev];
  }
  return seen ? skin / seen : null;
}

/**
 * A local stub, not a real detector: flags words in names/metadata and PNGs that are mostly skin-coloured.
 * It has false positives (sand, wood, peach paint) and misses JPEGs entirely, so it never rejects:
 * it only quarantines for a person to look at.
 */
export const heuristicClassifier: UploadClassifier = {
  name: 'heuristic',
  classify(f) {
    const labels: string[] = [];
    const words = f.text.join(' ').match(FLAG);
    if (words) labels.push(`keyword:${words[1].toLowerCase()}`);
    let score = 0;
    for (const im of f.images) {
      if (im.w * im.h < 64 * 64) continue;
      const r = skinRatio(im);
      if (r !== null) score = Math.max(score, r);
    }
    if (score > 0.6) labels.push(`skin-tone:${score.toFixed(2)}`);
    return labels.length ? { action: 'quarantine', classifier: 'heuristic', labels, score, reason: 'flagged for review by the local heuristic' } : { action: 'allow', classifier: 'heuristic', labels, score };
  },
};

let selected: UploadClassifier | null = null;
/** The classifier in force: one set in code, else `SIM_UPLOAD_CLASSIFIER` (`none` | `heuristic`). */
export function uploadClassifier(env = process.env): UploadClassifier {
  if (selected) return selected;
  return env.SIM_UPLOAD_CLASSIFIER === 'heuristic' ? heuristicClassifier : noopClassifier;
}
export function setUploadClassifier(c: UploadClassifier | null) { selected = c; }

/** Run the classifier with a deadline. Errors and timeouts quarantine. */
export async function classify(facts: UploadFacts, c = uploadClassifier(), timeoutMs = 5000): Promise<Verdict> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const v = await Promise.race([
      Promise.resolve().then(() => c.classify(facts)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    if (!v || !['allow', 'quarantine', 'reject'].includes(v.action)) throw new Error('bad verdict');
    return { action: v.action, classifier: c.name, labels: Array.isArray(v.labels) ? v.labels.map(String).slice(0, 16) : [], ...(v.reason ? { reason: String(v.reason).slice(0, 300) } : {}), ...(typeof v.score === 'number' && Number.isFinite(v.score) ? { score: v.score } : {}) };
  } catch (e) {
    return { action: 'quarantine', classifier: c.name, labels: ['classifier-error'], reason: `classifier failed (${e instanceof Error ? e.message : 'unknown'}); held for review` };
  } finally { if (timer) clearTimeout(timer); }
}
