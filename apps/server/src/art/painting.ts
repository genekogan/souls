// paintings/1: bounded drawing data, never SVG, code, fonts or remote media.
// Version 1 uses pixel-centre coverage on a 512 square RGB canvas; preserve this
// renderer when adding versions so a journal recipe can recover its appearance.
import { deflateSync } from 'node:zlib';

export const PAINTING_RENDERER = 'painting-rgb/1' as const;
export const PAINTING_SIZE = 512, PAINTING_SHAPES_MAX = 64, PAINTING_BYTES_MAX = 16 * 1024;
export type PaintingShape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; colour: string }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; colour: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number; colour: string };
export type Painting = { title: string; background: string; shapes: PaintingShape[] };
export type PaintingPublication = { worldId: string; receiptId: string };
export class PaintingRejected extends Error { readonly code = 'painting.invalid'; }
const reject = (message: string): never => { throw new PaintingRejected(message); };
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : reject('painting and shapes must be objects');
const keys = (v: Record<string, unknown>, expected: string[]) => { if (Object.keys(v).length !== expected.length || expected.some(k => !Object.hasOwn(v, k))) reject(`expected only ${expected.join(', ')}`); };
const colour = (v: unknown): string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : reject('colours must be #RRGGBB hex');
const number = (v: unknown, positive = false, max = 1): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && (!positive || v > 0) && v <= max ? v : reject(`coordinates must be finite 0..1; sizes must be positive and at most ${max}`);

/** Validate at admission, copy only known data, and validate again on completion. */
export function validatePainting(raw: unknown): Painting {
  let json: string | undefined; try { json = JSON.stringify(raw); } catch { return reject('painting must be JSON'); }
  if (!json || Buffer.byteLength(json) > PAINTING_BYTES_MAX) reject('painting must be at most 16 KiB of JSON');
  const p = object(raw); keys(p, ['title', 'background', 'shapes']);
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 120 || /[\u0000-\u001f\u007f\u2028\u2029]/.test(p.title)) reject('title must be one nonempty line, at most 120 characters');
  if (!Array.isArray(p.shapes) || p.shapes.length > PAINTING_SHAPES_MAX) reject('shapes must be a list of at most 64 rectangles, ellipses and lines');
  const shapes = (p.shapes as unknown[]).map((raw): PaintingShape => {
    const s = object(raw), c = colour(s.colour);
    if (s.kind === 'rect') { keys(s, ['kind', 'x', 'y', 'width', 'height', 'colour']); return { kind: 'rect', x: number(s.x), y: number(s.y), width: number(s.width, true), height: number(s.height, true), colour: c }; }
    if (s.kind === 'ellipse') { keys(s, ['kind', 'cx', 'cy', 'rx', 'ry', 'colour']); return { kind: 'ellipse', cx: number(s.cx), cy: number(s.cy), rx: number(s.rx, true), ry: number(s.ry, true), colour: c }; }
    if (s.kind === 'line') { keys(s, ['kind', 'x1', 'y1', 'x2', 'y2', 'width', 'colour']); return { kind: 'line', x1: number(s.x1), y1: number(s.y1), x2: number(s.x2), y2: number(s.y2), width: number(s.width, true, 0.25), colour: c }; }
    return reject('shape kind must be rect, ellipse or line');
  });
  return { title: (p.title as string).trim(), background: colour(p.background), shapes };
}

/** Help exists only on an offer bound to a real painting easel. */
export const paintingParam = (fadeDays?: number) => ({ type: 'object', optional: true, maxBytes: PAINTING_BYTES_MAX,
  description: fadeDays ? `Optional chalk drawing on the ground, published only when this activity finishes. ${PAINTING_HELP} Drawing over replaces the drawing and preserves the old one in history. It fades over ${fadeDays} world days, then washes away.`
    : `Optional lasting painting, published only when this activity finishes. ${PAINTING_HELP} Painting over replaces the canvas and preserves the old picture in history.` });
const PAINTING_HELP = '512×512 canvas. title (one line, <=120), background (#RRGGBB), shapes (<=64). Coordinates 0..1; shapes clip at edges; later shapes cover earlier ones. Every shape has colour (#RRGGBB). rect: x,y,width,height; ellipse: cx,cy,rx,ry; line: x1,y1,x2,y2,width (<=0.25). Sizes >0 and <=1. No other fields. Credit is your Soul.';

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => { let c = i; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); return c >>> 0; });
const chunk = (kind: string, bytes: Uint8Array): Buffer => {
  const b = Buffer.alloc(bytes.length + 12); b.writeUInt32BE(bytes.length, 0); b.write(kind, 4, 'ascii'); b.set(bytes, 8);
  let crc = 0xffffffff; for (let i = 4; i < b.length - 4; i++) crc = crcTable[(crc ^ b[i]) & 255] ^ (crc >>> 8);
  b.writeUInt32BE((crc ^ 0xffffffff) >>> 0, b.length - 4); return b;
};

export function rasterizePainting(raw: unknown, publication?: PaintingPublication): Buffer {
  const p = validatePainting(raw), n = PAINTING_SIZE, stride = n * 3 + 1, scan = Buffer.alloc(stride * n), bg = rgb(p.background);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) scan.set(bg, y * stride + 1 + x * 3);
  for (const s of p.shapes) {
    const c = rgb(s.colour);
    const bounds = s.kind === 'rect' ? [s.x, s.y, s.x + s.width, s.y + s.height] : s.kind === 'ellipse' ? [s.cx - s.rx, s.cy - s.ry, s.cx + s.rx, s.cy + s.ry] : [Math.min(s.x1, s.x2) - s.width / 2, Math.min(s.y1, s.y2) - s.width / 2, Math.max(s.x1, s.x2) + s.width / 2, Math.max(s.y1, s.y2) + s.width / 2];
    for (let y = Math.max(0, Math.floor(bounds[1] * n)); y < Math.min(n, Math.ceil(bounds[3] * n)); y++) {
      for (let x = Math.max(0, Math.floor(bounds[0] * n)); x < Math.min(n, Math.ceil(bounds[2] * n)); x++) {
        const px = (x + 0.5) / n, py = (y + 0.5) / n;
        let inside: boolean;
        if (s.kind === 'rect') inside = px >= s.x && px < s.x + s.width && py >= s.y && py < s.y + s.height;
        else if (s.kind === 'ellipse') inside = ((px - s.cx) / s.rx) ** 2 + ((py - s.cy) / s.ry) ** 2 <= 1;
        else { const dx = s.x2 - s.x1, dy = s.y2 - s.y1, length = dx * dx + dy * dy, t = length ? Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / length)) : 0; inside = (px - s.x1 - t * dx) ** 2 + (py - s.y1 - t * dy) ** 2 <= (s.width / 2) ** 2; }
        if (inside) scan.set(c, y * stride + 1 + x * 3);
      }
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(n, 0); header.writeUInt32BE(n, 4); header[8] = 8; header[9] = 2;
  let provenance: Buffer[] = [];
  if (publication) {
    if (typeof publication.worldId !== 'string' || !publication.worldId || publication.worldId.length > 200 || typeof publication.receiptId !== 'string' || !publication.receiptId || publication.receiptId.length > 200) reject('server publication identity must be bounded world and receipt ids');
    // ASCII JSON in a PNG ancillary text chunk. It changes no raster pixels,
    // but isolates each completion's file from equal recipes in other worlds.
    const text = JSON.stringify({worldId:publication.worldId,receiptId:publication.receiptId,renderer:PAINTING_RENDERER}).replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
    provenance = [chunk('tEXt', Buffer.from(`Painting\0${text}`, 'ascii'))];
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...provenance, chunk('IDAT', deflateSync(scan, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
