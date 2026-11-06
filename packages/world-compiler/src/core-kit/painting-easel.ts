// Paintings that stay: a new revision, preserving every byte of core/easel@1.
// The existing media-face pipeline supplies images and maker/title hover text.
import furniture from './furniture.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';

export const PAINTING_EASEL_DEF: DefInput = /* @__PURE__ */ (() => {
  const old = structuredClone(furniture.find(d => d.name === 'core-easel')!) as unknown as DefInput;
  if (old.make.kind !== 'gen') throw new Error('core/easel@1 must remain a kit definition');
  return { ...old, version: 2,
    tags: [...(old.tags ?? []), 'sign-text'],
    description: 'A painter’s easel. Finish painting to leave a picture on its canvas, with the Soul’s title and credit.',
    make: { ...old.make, args: { ...(old.make.args as Record<string, unknown>),
      // Square preserves the full 512-square recipe; portrait canvas is a mat.
      // Its plane sits in front of the legacy decorative paint patches.
      faces: [{ at: [0, 1.15, 0.205], w: 0.60, h: 0.60, media: true, bg: '#f4f2ec' }] } },
    state: { media: { type: 'string', max: 500, default: '' }, title: { type: 'string', max: 120, default: '' }, maker: { type: 'string', max: 160, default: '' } },
    components: { ...old.components, display: { w: 0.60, h: 0.60 } },
  };
})();

// #430 (W054): pavement chalk on the painting faculty, data only. A painting workstation whose canvas lies flat (pitch
// -90°: facing up) is drawn in chalk, stooping; a canvas face with `fadeDays` fades over world days from the drawn
// `day` (the world day at completion) and reads as washed away from then on. The square is the drawing, 0.9 m.
export const CHALK_FADE_DAYS = 4;
export const CHALK_SQUARE_DEF: DefInput = {
  schema: 'def/1', name: 'core-chalk-square', version: 1,
  description: `A pale paving square set in the ground for chalk drawings, with a tin of chalk at one corner. Draw on it in chalk to leave a picture with your title and credit; it fades over ${CHALK_FADE_DAYS} world days and washes away.`,
  tags: ['art', 'chalk', 'street', 'sign-text', 'fades'], category: 'object.art', form: 'point',
  synonyms: ['chalk square', 'pavement chalk', 'chalk drawing', 'paving square'],
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.004, shapes: [
    { kind: 'box', at: [0, 0.012, 0], size: [1.0, 0.024, 1.0], round: 0, tint: 'stone', collide: true },
    { kind: 'cyl', at: [0.43, 0.058, 0.43], r: 0.035, h: 0.07, segments: 8, tint: 'tin' },
    { kind: 'box', at: [0.43, 0.098, 0.43], size: [0.012, 0.012, 0.05], round: 0, tint: 'chalk1', yaw: 0.6 },
    { kind: 'box', at: [0.35, 0.03, 0.46], size: [0.05, 0.012, 0.012], round: 0, tint: 'chalk2', yaw: 0.3 }],
    // the drawing lies 1 mm above the slab top; its picture's top points away from the front (+z), where the Soul kneels
    faces: [{ at: [0, 0.025, 0], w: 0.9, h: 0.9, pitch: -Math.PI / 2, media: true, bg: '#bdb8ad', fadeDays: CHALK_FADE_DAYS }] } } as unknown as DefInput['make'],
  params: { stone: { type: 'color', default: '#bdb8ad', doc: 'paving colour' }, tin: { type: 'color', default: '#7f8c8d', doc: 'chalk tin colour' } },
  palette: { stone: '#bdb8ad', tin: '#7f8c8d', chalk1: '#f2ede4', chalk2: '#e9a3b6' },
  state: { media: { type: 'string', max: 500, default: '' }, title: { type: 'string', max: 120, default: '' }, maker: { type: 'string', max: 160, default: '' }, day: { type: 'number', default: 0 } } as DefInput['state'],
  components: { workstation: { kind: 'painting' }, display: { w: 0.9, h: 0.9 } } as DefInput['components'],
  size: { box: [1.0, 0.13, 1.0] },
};
