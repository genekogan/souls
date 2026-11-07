// Landform generators for the tranche-2 kinds in @souls/ground (forms.ts): cliff/1 (path),
// terrace/1 (area), channel/1 (path), brush/1 (point). Owner: L3. Spec 33 §2 row 5.
// Scales blend by the fold order: natural (hills, ridges, cliffs, raise/lower) → carve (lakes,
// rivers, channels) → smooth → terrace (terraces, flatten) → pad (building terraces). Height field
// only: no caves or overhangs; a cliff is a steep face, never vertical.
import { bounds2, boxOfBounds, n } from './geom.ts';
import { arcLengths } from './terrain-query.ts';
import type { Generator, Vec2 } from './types.ts';

export const cliffGen: Generator = {
  id: 'cliff/1', form: 'path', owner: 'L3', doc: 'A cliff or escarpment along a path: the left side (side 1) or right (−1) rises `height` m over a `face` m face in `steps` ledges, holds a shelf `shelf` m deep, falls back over `back` m.',
  params: {
    height: { type: 'number', min: -120, max: 200, default: 10 }, side: { type: 'int', min: -1, max: 1, default: 1 },
    face: { type: 'number', min: 0.5, max: 60, default: 3 }, steps: { type: 'int', min: 1, max: 12, default: 1 },
    shelf: { type: 'number', min: 0, max: 400, default: 30 }, back: { type: 'number', min: 1, max: 200, default: 12 },
  },
  physics({ params, shape }) {
    const path = shape?.path ?? [[-20, 0], [20, 0]];
    const side = n(params.side, 1) < 0 ? -1 : 1, h = n(params.height, 10), face = n(params.face, 3), w = n(params.shelf, 30), back = n(params.back, 12);
    return { box: boxOfBounds(bounds2(path, face / 2 + w + back), Math.abs(h)), colliders: [], slots: [], tris: 0, landform: { kind: 'cliff', path, h, side, face, w, back, steps: Math.round(n(params.steps, 1)) }, notes: [`${h.toFixed(1)} m ${side > 0 ? 'left' : 'right'} of the path over ${face} m`] };
  },
};

export const terraceGen: Generator = {
  id: 'terrace/1', form: 'area', owner: 'L3', doc: 'A terrace: flatten the area to a named `level` (absolute m), or with `step` cut whatever ground is there into ledges `step` m high (rice terraces, a stepped garden).',
  params: {
    level: { type: 'number', min: -200, max: 400, doc: 'absolute level (m); omit with step for a stepped hillside' }, step: { type: 'number', min: 0.3, max: 20, doc: 'ledge height (m)' },
    riser: { type: 'number', min: 0.05, max: 0.95, default: 0.3, doc: 'fraction of each step that is the riser' }, edge: { type: 'number', min: 0.5, max: 60, default: 4 },
    label: { type: 'string', max: 48, doc: 'a name for the level (describe: "upper lawn at 12 m")' },
  },
  physics({ params, shape }) {
    const area = shape?.area ?? ([[-10, -10], [10, -10], [10, 10], [-10, 10]] as Vec2[]);
    const level = typeof params.level === 'number' ? params.level : undefined, step = typeof params.step === 'number' ? params.step : undefined;
    const lf = { kind: 'terrace' as const, area, edge: n(params.edge, 4), riser: n(params.riser, 0.3), ...(level !== undefined ? { level } : {}), ...(step !== undefined ? { step } : {}), ...(level === undefined && step === undefined ? { level: 0 } : {}), ...(typeof params.label === 'string' && params.label ? { name: params.label } : {}) };
    return { box: boxOfBounds(bounds2(area), 1), colliders: [], slots: [], tris: 0, landform: lf, notes: [step ? `stepped every ${step} m` : `level ${(level ?? 0).toFixed(2)} m${lf.name ? ` (${lf.name})` : ''}`] };
  },
};

export const channelGen: Generator = {
  id: 'channel/1', form: 'path', owner: 'L3', doc: 'Cut (or fill, or set) the ground along a path to levels: a ditch, a dry channel, a cutting, an embankment. `levels` per path point, or `from`→`to` linearly.',
  params: {
    width: { type: 'number', min: 0.5, max: 200, default: 4, doc: 'flat bottom width' }, edge: { type: 'number', min: 0.5, max: 60, default: 3 },
    from: { type: 'number', min: -200, max: 400, default: -1 }, to: { type: 'number', min: -200, max: 400, default: -1 },
    levels: { type: 'json', doc: 'absolute levels per path point (overrides from/to)' }, mode: { type: 'enum', values: ['cut', 'fill', 'set'], default: 'cut' },
    overPads: { type: 'bool', default: false, doc: 'hold these levels over building pads too (folded after them): a graded way past packed buildings' },
  },
  physics({ params, shape }) {
    const path = shape?.path ?? [[-20, 0], [20, 0]], s = arcLengths(path), total = s[s.length - 1] || 1;
    const given = Array.isArray(params.levels) && params.levels.length === path.length && params.levels.every((v) => typeof v === 'number') ? (params.levels as number[]) : null;
    const levels = given ?? s.map((q) => n(params.from, -1) + (n(params.to, -1) - n(params.from, -1)) * (q / total));
    const w = n(params.width, 4);
    return { box: boxOfBounds(bounds2(path, w / 2 + n(params.edge, 3)), 2), colliders: [], slots: [], tris: 0, landform: { kind: 'channel', path, levels, w: w / 2, edge: n(params.edge, 3), mode: (String(params.mode ?? 'cut')) as 'cut' | 'fill' | 'set', ...(params.overPads === true ? { overPads: true } : {}) } };
  },
};

export const brushGen: Generator = {
  id: 'brush/1', form: 'point', owner: 'L3', doc: 'A terrain brush stroke at a point: raise or lower by `amount` m, flatten toward `level`, or smooth (amount 0..1). Small, stackable, undoable like any edit.',
  params: {
    op: { type: 'enum', values: ['raise', 'lower', 'flatten', 'smooth'], default: 'raise' }, radius: { type: 'number', min: 1, max: 400, default: 8 },
    amount: { type: 'number', min: 0, max: 60, default: 1 }, level: { type: 'number', min: -200, max: 400, doc: 'flatten target (absolute m)' },
  },
  physics({ params }) {
    const op = String(params.op ?? 'raise') as 'raise' | 'lower' | 'flatten' | 'smooth', r = n(params.radius, 8);
    const lf = { kind: 'brush' as const, op, c: [0, 0] as Vec2, r, amount: op === 'smooth' || op === 'flatten' ? Math.min(1, n(params.amount, 1)) : n(params.amount, 1), ...(op === 'flatten' ? { level: n(params.level, 0) } : {}) };
    return { box: [2 * r, Math.max(0.1, op === 'raise' || op === 'lower' ? lf.amount : 1), 2 * r], colliders: [], slots: [], tris: 0, landform: lf };
  },
};

export const LANDFORM_GENERATORS = [cliffGen, terraceGen, channelGen, brushGen];
