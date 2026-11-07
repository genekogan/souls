// W6: art in world-engine worlds — owners' agents hang and change images and looping videos in frames, screens and
// gallery walls, and the world records who made each piece (provenance, shown on hover in the viewer).
//
// Who may do what:
//   - the world creator's agent (a god token) may hang, change or clear art in any display;
//   - a resident's agent (a Soul token) may hang art in an empty slot, change or clear art it hung itself, and do
//     anything with a display its Soul owns (owner `soul:<id or name>`). It may not overwrite anyone else's art.
// The maker is written by the server from the caller's credential, never taken from the request:
//   `creator:<owner id>:<label>` or `soul:<soul id>:<name>`.
// Media must be an http(s) URL or a same-site path (e.g. one returned by POST /v1/art/media); videos are .mp4/.webm/
// .mov/.m4v and loop muted in the viewer. Every display def stores `media`, `title`, `maker`, one line per slot.
import type { Entity, Op, StoredDef, WorldModel } from '@souls/world-compiler';
import { frameMediaKind } from '@souls/world-compiler';

export type Caller = { kind: 'creator'; owner: string | null; label?: string } | { kind: 'soul'; id: string; name: string };
export type HangRequest = { frame: string; media?: string | null; title?: string; slot?: number };
export type ArtFailure = { ok: false; status: number; code: string; message: string };
export type ArtPlan = { ok: true; id: string; slot: number; ops: Op[]; note: string };
export type DisplayInfo = { id: string; name: string | null; def: string; slots: number; p: [number, number, number]; yaw: number; owner: string | null; art: { slot: number; media: string; kind: 'image' | 'video'; title: string; maker: string }[] };

/** One media reference (the shared frame-media rule in @souls/world-compiler). */
export const mediaKind = (url: string): 'image' | 'video' | null => frameMediaKind(url);
const fail = (status: number, code: string, message: string): ArtFailure => ({ ok: false, status, code, message });
const clean = (s: string, max: number) => s.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const lines = (v: unknown, n: number) => { const a = typeof v === 'string' ? v.split('\n') : []; while (a.length < n) a.push(''); return a.slice(0, n); };

/** A def that shows media: it declares `components.display` and string `media`/`maker` state fields. */
export function displayOf(def: StoredDef | undefined): { slots: number; withMaker: boolean } | null {
  const d = (def?.components as { display?: { slots?: number } } | undefined)?.display;
  if (!def || !d || def.state?.media?.type !== 'string') return null;
  return { slots: Math.max(1, Math.min(8, d.slots ?? 1)), withMaker: def.state.maker?.type === 'string' && def.state.title?.type === 'string' };
}
export function makerOf(c: Caller): string {
  // ids are URI-encoded so the record splits on ':' cleanly (dev owners look like `dev:gene`)
  return c.kind === 'soul' ? `soul:${encodeURIComponent(c.id)}:${clean(c.name, 60)}` : `creator:${encodeURIComponent(c.owner ?? '')}:${clean(c.label ?? '', 60)}`;
}
/** Does the caller's Soul own this display (owner `soul:<id>` or `soul:<name>`)? */
const ownsIt = (e: Entity, c: Extract<Caller, { kind: 'soul' }>) => e.owner === `soul:${c.id}` || e.owner === `soul:${c.name}`;

/** The edit that hangs (or, with media null/'', clears) one slot, or why the caller may not. */
export function planHang(model: WorldModel, caller: Caller, req: HangRequest): ArtPlan | ArtFailure {
  return hang(model, caller, req, false);
}

/** Completion-only permission seam. The activity service checks its original
 * target/canvas binding before calling this; the public hang API never calls it. */
export function planFinishedPainting(model: WorldModel, caller: Extract<Caller, { kind: 'soul' }>, req: HangRequest): ArtPlan | ArtFailure {
  const e = model.entities.get(req.frame);
  if (!e || !paintingEasel(model.resolvedDef(e.def))) return fail(409, 'painting.target-changed', 'The original painting easel is no longer available.');
  if (!req.media || !/^\/(?!\/)(?:[^\s?#]*\/)?art\/[0-9a-f]{64}\.png$/.test(req.media)) return fail(400, 'painting.media', 'A completed painting must use its server-rendered PNG.');
  return hang(model, caller, { ...req, slot: 0 }, true);
}

/** Only actual single-canvas painting workstations opt in. */
export function paintingEasel(def: StoredDef | undefined): boolean {
  const disp = displayOf(def);
  return !!disp && disp.slots === 1 && disp.withMaker && (def?.components as { workstation?: { kind?: string } } | undefined)?.workstation?.kind === 'painting';
}

/** A painting workstation's canvas: its media face for slot 0 (def data, make.args.faces). */
export type CanvasFace = { at?: number[]; w?: number; h?: number; pitch?: number; media?: boolean; slot?: number; fadeDays?: number };
export function canvasFace(def: StoredDef | undefined): CanvasFace | null {
  const faces = def?.make.kind === 'gen' && Array.isArray(def.make.args?.faces) ? def.make.args.faces as CanvasFace[] : [];
  return faces.find(f => f && f.media && (f.slot ?? 0) === 0) ?? null;
}
/** #430: a canvas lying flat, facing up (pitch -90°), is on the ground: drawn in chalk, stooping. */
export const flatCanvas = (face: CanvasFace | null | undefined) => !!face && typeof face.pitch === 'number' && Math.abs(face.pitch + Math.PI / 2) < 0.05;
/** #430: whole world days since a fading canvas was drawn (its state `day`), or null when it does not fade. */
export function canvasAge(e: Entity, face: CanvasFace | null | undefined, today: number): number | null {
  const days = face?.fadeDays;
  if (typeof days !== 'number' || !(days > 0) || typeof e.state?.day !== 'number') return null;
  return Math.max(0, Math.floor(today) - e.state.day);
}

/** #430: drawn fading canvases whose perceived line may differ between world day `prev` and `today` (either way: a clock
 *  can jump several days forward on a catch-up, or be set back): those not yet washed away on one of the two days. */
export function fadingIds(model: WorldModel, today: number, prev = today): string[] {
  const ids: string[] = [];
  for (const e of model.entities.values()) {
    if (typeof e.state?.day !== 'number' || !e.state.media) continue;
    const def = model.resolvedDef(e.def); if (!paintingEasel(def)) continue;
    const face = canvasFace(def), age = canvasAge(e, face, Math.min(today, prev)); if (age !== null && age <= face!.fadeDays!) ids.push(e.id);
  }
  return ids;
}

/** Compact nearby projection; the private drawing recipe is never perception. `today`: the world day (fading canvases). */
export function paintingLine(e: Entity, def: StoredDef | undefined, today = 0): string | null {
  if (!paintingEasel(def) || typeof e.state?.media !== 'string' || !e.state.media || typeof e.state.maker !== 'string') return null;
  const parts = e.state.maker.split(':');
  if (parts[0] !== 'soul' || parts.length < 3) return null;
  const face = canvasFace(def), age = canvasAge(e, face, today);
  if (age !== null && age >= face!.fadeDays!) return null;
  const oneLine = (v: unknown, max: number) => clean(String(v ?? '').replace(/[\u0085\u2028\u2029]/g, ' '), max);
  const maker = oneLine(parts.slice(2).join(':'), 32) || 'a Soul', title = oneLine(e.state.title, 50) || 'Untitled';
  const wear = age === null || age < 1 ? '' : age >= face!.fadeDays! - 1 ? ', nearly washed away' : ', fading';
  return flatCanvas(face) ? `${maker}’s chalk drawing “${title}” on the pavement${wear}` : `an easel with ${maker}’s painting “${title}”${wear}`;
}

function hang(model: WorldModel, caller: Caller, req: HangRequest, painting: boolean): ArtPlan | ArtFailure {
  const e = model.entities.get(req.frame) ?? (model as unknown as { get?(n: string): Entity | undefined }).get?.(req.frame);
  if (!e) return fail(404, 'art.no-frame', `no display ${req.frame}`);
  const def = model.resolvedDef(e.def), disp = displayOf(def);
  if (!def || !disp) return fail(400, 'art.not-display', `${req.frame} is not a frame, screen or gallery wall`);
  if (!disp.withMaker) return fail(409, 'art.old-frame', `${req.frame} was placed from an older revision without a maker record; place a new frame to hang art with provenance`);
  const slot = req.slot ?? 0;
  if (!Number.isInteger(slot) || slot < 0 || slot >= disp.slots) return fail(400, 'art.slot', `slot must be 0..${disp.slots - 1}`);
  const clear = req.media === null || req.media === '' || req.media === undefined;
  // #430: a fading canvas (chalk) holds only what was drawn on it; hanging an image there is refused (clearing is not)
  if (!clear && !painting && typeof canvasFace(def)?.fadeDays === 'number') return fail(409, 'art.drawn-only', `${req.frame} takes only drawings made on it by hand; draw on it instead`);
  if (!clear && !mediaKind(req.media!)) return fail(400, 'art.media', 'media must be an https URL or a same-site path (images, or .mp4/.webm/.mov/.m4v video), at most 480 characters, no spaces');
  const st = e.state ?? {}, media = lines(st.media, disp.slots), title = lines(st.title, disp.slots), maker = lines(st.maker, disp.slots);
  if (caller.kind === 'soul' && !painting && !ownsIt(e, caller)) {
    const mine = maker[slot].startsWith(`soul:${encodeURIComponent(caller.id)}:`);
    if (media[slot].trim() && !mine) return fail(403, 'art.not-yours', `slot ${slot} of ${req.frame} holds someone else's art; residents may fill empty slots and change their own`);
    if (clear && !mine) return fail(403, 'art.not-yours', 'you may only clear art you hung');
  }
  media[slot] = clear ? '' : req.media!;
  title[slot] = clear ? '' : clean(req.title ?? '', 120);
  maker[slot] = clear ? '' : makerOf(caller);
  const join = (a: string[]) => a.join('\n').replace(/\n+$/, '');
  const state = { media: join(media), title: join(title), maker: join(maker) };
  for (const [k, v] of Object.entries(state)) { const max = (def.state[k] as { max?: number }).max ?? 500; if (v.length > max) return fail(413, 'art.too-long', `${k} would exceed ${max} characters on this display`); }
  const who = caller.kind === 'soul' ? `${caller.name} (${caller.id})` : 'the world creator';
  return { ok: true, id: e.id, slot, ops: [{ op: 'set', id: e.id, state } as Op], note: `art: ${who} ${clear ? 'cleared' : 'hung'} ${req.frame}#${slot}${clear ? '' : ` ${state.title ? `"${title[slot]}" ` : ''}${req.media}`}` };
}

/** Every display in the world and what hangs in it (public: placements and art are visible to every viewer). */
export function listDisplays(model: WorldModel): DisplayInfo[] {
  const out: DisplayInfo[] = [];
  for (const e of model.entities.values()) {
    const def = model.resolvedDef(e.def), disp = displayOf(def); if (!disp) continue;
    const st = e.state ?? {}, media = lines(st.media, disp.slots), title = lines(st.title, disp.slots), maker = lines(st.maker, disp.slots);
    let p: { x: number; y: number; z: number; yaw: number }; try { p = model.worldPose(e); } catch { p = { x: 0, y: 0, z: 0, yaw: 0 }; }
    out.push({ id: e.id, name: (e as { name?: string }).name ?? null, def: e.def, slots: disp.slots, p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], yaw: +p.yaw.toFixed(3), owner: e.owner ?? null,
      art: media.flatMap((m, slot) => { const kind = mediaKind(m.trim()); return kind ? [{ slot, media: m.trim(), kind, title: title[slot], maker: maker[slot] }] : []; }) });
  }
  return out;
}
