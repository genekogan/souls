// XP8 admission: faces and decals may show only image assets registered to this world (the WD8 sign-media rule), and a
// building's decals must name one of its own wall slots and stay on that wall. Refusals are `params.invalid` with the
// field and a fix.
import { FACE_IMAGE, FACE_LIMITS, GENERATORS, decalSchema, faceContentIssues, type Decal, type Slot } from '@souls/generators';
import type { WorldModel } from './model.ts';
import type { Failure, StoredDef } from './schemas.ts';

const UPLOAD = 'Upload the image to this world with POST /v1/god/assets, then use its /assets/<sha>.<ext> path.';
const rank = (id: string) => ['facade-', 'gable-', 'opening-'].findIndex(p => id.startsWith(p)) >>> 0;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
type Fail = (field: string, measured: unknown, detail: string, fix: string) => Failure;
const failer = (op: number, def: StoredDef, entity?: string): Fail => (field, measured, detail, fix) =>
  ({ op, code: 'params.invalid', field, def: def.ref, ...(entity ? { entity } : {}), measured, detail, fix });

function imageFailure(w: WorldModel, image: unknown, field: string, fail: Fail): Failure | null {
  const match = typeof image === 'string' ? FACE_IMAGE.exec(image) : null;
  if (match && w.assets(match[1])?.image?.ext === match[2]) return null;
  return fail(field, image, match ? `${image} is not an image asset of this world.` : 'Face images must be a same-origin image asset of this world (/assets/<sha>.png or .jpg); URLs, data: and other worlds are refused.', UPLOAD);
}

/** kit/2 faces as authored (before programs expand): every image is one of this world's image assets. */
export function kitFaceFailure(w: WorldModel, def: StoredDef, op: number): Failure | null {
  if (def.make.kind !== 'gen' || def.make.gen !== 'kit/2') return null;
  const shapes = def.make.args?.shapes, fail = failer(op, def);
  if (!Array.isArray(shapes)) return null;
  for (const [i, shape] of shapes.entries()) {
    const faces = record(shape) ? shape.faces : undefined;
    if (Array.isArray(faces)) for (const [j, face] of faces.entries()) if (record(face) && face.image !== undefined) {
      const failure = imageFailure(w, face.image, `make.args.shapes.${i}.faces.${j}.image`, fail); if (failure) return failure;
    }
  }
  return null;
}

type Frame = { yaw: number; W: number; D: number; t: number; wallTop: number; roofRise: number; round?: unknown; walls: { a: [number, number]; b: [number, number]; out?: [number, number]; exterior: boolean; thick: number }[] };
const metres = (v: number) => Math.round(v * 100) / 100;
// Fix ranges round inward to the centimetre, so following the fix always passes.
const down = (v: number) => Math.floor(v * 100 + 1e-6) / 100, up = (v: number) => Math.ceil(v * 100 - 1e-6) / 100;
/** The building's canonical layout, from the params the bake sees (generator defaults under the instance's own). */
function frameOf(def: StoredDef, params: Record<string, unknown>): Frame {
  const g = GENERATORS['building/1'] as unknown as { params: Record<string, { default?: unknown }>; layout(p: Record<string, unknown>, a: Record<string, unknown>): Frame };
  const defaults = Object.fromEntries(Object.entries(g.params).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default]));
  return g.layout({ ...defaults, ...params }, (def.make.kind === 'gen' ? def.make.args : undefined) ?? {});
}
/** A decal stays on its slot's wall: along the facade line it shares with that wall (a round tower's flat chord), and
 *  between the ground and the eaves plus roof rise (which covers gables and parapets). */
function decalFit(L: Frame, slot: Slot, d: Decal, at: string, fail: Fail): Failure | null {
  const c = Math.cos(L.yaw), s = Math.sin(L.yaw), [px, py, pz] = slot.p, [ax, ay] = d.at ?? [0, 0];
  const x = px * c - pz * s, z = px * s + pz * c, a = slot.yaw - L.yaw, n = [Math.sin(a), Math.cos(a)], right = [Math.cos(a), -Math.sin(a)];
  let lo = Infinity, hi = -Infinity;
  for (const wall of L.walls) {
    if (!wall.exterior || !wall.out || wall.out[0] * n[0] + wall.out[1] * n[1] < 0.999) continue;
    const off = (x - wall.a[0]) * wall.out[0] + (z - wall.a[1]) * wall.out[1]; // slots sit just outside the wall's face
    if (off < -0.05 || off > wall.thick / 2 + 0.1) continue;
    for (const p of [wall.a, wall.b]) { const t = (p[0] - x) * right[0] + (p[1] - z) * right[1]; lo = Math.min(lo, t); hi = Math.max(hi, t); }
  }
  // Rectangular walls end at the corner's centreline (half a wall short of the outer face); round chords already overlap.
  const tol = L.round ? 0.02 : L.t / 2 + 0.02;
  if (!Number.isFinite(lo)) { // no wall line found: at least keep the decal at the building's box
    const qx = x + right[0] * ax, qz = z + right[1] * ax;
    if (Math.abs(qx) > L.W / 2 + 0.5 || Math.abs(qz) > L.D / 2 + 0.5) return fail(`${at}.at`, d.at, `The decal on ${slot.id} sits ${metres(Math.hypot(qx, qz))} m from the building's centre, outside its walls.`, 'Keep at[0] near 0 so the decal stays on the wall.');
  } else {
    lo -= tol; hi += tol;
    if (d.w > hi - lo + 1e-6) return fail(`${at}.w`, d.w, `A ${d.w} m decal is wider than the wall it sits on (${metres(hi - lo)} m at ${slot.id}).`, `Shrink w to at most ${down(hi - lo)}, or use a wider wall.`);
    if (ax - d.w / 2 < lo - 1e-6 || ax + d.w / 2 > hi + 1e-6) return fail(`${at}.at`, d.at, `The decal runs off its wall: it spans ${metres(ax - d.w / 2)}..${metres(ax + d.w / 2)} m along ${slot.id}, the wall ${metres(lo)}..${metres(hi)} m.`, `Keep at[0] between ${up(lo + d.w / 2)} and ${down(hi - d.w / 2)}.`);
  }
  const top = L.wallTop + L.roofRise, y0 = py + ay - d.h / 2, y1 = py + ay + d.h / 2;
  if (d.h > top + 1e-6) return fail(`${at}.h`, d.h, `A ${d.h} m decal is taller than the building (${metres(top)} m to the roof top).`, `Shrink h to at most ${down(top)}.`);
  if (y0 < -1e-6 || y1 > top + 1e-6) return fail(`${at}.at`, d.at, `The decal floats off the building: it spans ${metres(y0)}..${metres(y1)} m high; walls and roof span 0..${metres(top)} m.`, `Keep at[1] between ${up(d.h / 2 - py)} and ${down(top - d.h / 2 - py)} (measured up from ${slot.id}, ${metres(py)} m above the base).`);
  return null;
}

/** building/1 decals: a short list of faces, each on one of this building's wall slots and within that wall, images from
 *  this world. `site.params` are the params the bake sees; `site.slots` its slots. */
export function decalFailure(w: WorldModel, def: StoredDef, decals: unknown, site: { params: Record<string, unknown>; slots: () => readonly Slot[] }, op: number, entity?: string): Failure | null {
  if (def.make.kind !== 'gen' || def.make.gen !== 'building/1' || decals === undefined || decals === null) return null;
  const fail = failer(op, def, entity);
  if (!Array.isArray(decals) || decals.length > FACE_LIMITS.decals) return fail('params.decals', Array.isArray(decals) ? decals.length : typeof decals, `decals must be a list of at most ${FACE_LIMITS.decals} faces`, 'Pass decals as a JSON list: [{"slot":"facade-f0-s-1","w":2,"h":0.5,"text":"BAKERY"}].');
  let walls: Slot[] | undefined, frame: Frame | undefined;
  for (const [i, decal] of decals.entries()) {
    const at = `params.decals.${i}`;
    if (record(decal) && decal.image !== undefined) { const failure = imageFailure(w, decal.image, `${at}.image`, fail); if (failure) return failure; }
    const parsed = decalSchema.safeParse(decal);
    if (!parsed.success) {
      const issue = parsed.error.issues[0], field = [at, ...issue.path].join('.');
      return fail(field, record(decal) && issue.path.length ? decal[String(issue.path[0])] ?? 'missing' : typeof decal, `${field}: ${issue.message}`, 'Each decal is {slot, w, h (metres), at?:[right, up], and one of text, image or pattern}.');
    }
    const content = faceContentIssues(decal as Record<string, unknown>, true)[0];
    if (content) return fail([at, ...content.path].join('.'), (decal as Record<string, unknown>)[String(content.path[0])], content.message, content.fix);
    // Facade frames first (the usual homes for a sign), then opening sills and legacy hang points.
    walls ??= site.slots().filter(s => s.kind === 'wall').sort((a, b) => rank(a.id) - rank(b.id));
    const slot = walls.find(s => s.id === parsed.data.slot);
    if (!slot) return fail(`${at}.slot`, parsed.data.slot, `${parsed.data.slot} is not a wall slot of this building`, `Use one of its wall slots (describe <building> lists them): ${walls.slice(0, 10).map(s => s.id).join(', ')}${walls.length > 10 ? ', …' : ''}.`);
    const misfit = decalFit(frame ??= frameOf(def, site.params), slot, parsed.data, at, fail);
    if (misfit) return misfit;
  }
  return null;
}
