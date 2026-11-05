/** #891 touch Free camera: on a touch screen in Free (your camera), a touch that starts in the lower-left of the view spawns
 * a floating stick under the thumb (shown only while touched) that walks the eye; one finger elsewhere looks in place;
 * pinch glides toward the point between the fingers; a two-finger vertical drag rises or lowers; a double-tap flies there.
 * Long-pressing the stick where it appeared arms an auto-walk lock: lifting while deflected keeps walking until the next touch.
 *
 * This module only reads gestures. Every movement goes through the camera's own paths (WorldRtsCamera: the stick is WASD,
 * the rise is Q/E, the look is right-drag, the pinch is the wheel and the double-tap is the double-click), so its clamps hold.
 * Follow and Broadcast keep OrbitControls' touch mapping: no touch is tracked there. At rest the module holds one canvas
 * `pointerdown` listener: document listeners and the long-press timer exist only while a finger is down. */
export type TouchCamera = {
  setStick(forward: number, right: number): void;
  readonly walking: boolean;
  setTouchHeld(held: boolean): void;
  touchLook(dx: number, dy: number): void;
  touchLookEnd(): void;
  touchPinch(x: number, y: number, ratio: number, start: boolean): void;
  touchRise(dy: number): void;
  touchFly(x: number, y: number): void;
};
export type TouchFreeOptions = {
  camera: TouchCamera;
  /** Your camera is in charge (Free): not Follow, Broadcast or the Advanced free-fly camera. */
  free: () => boolean;
  /** A Soul is under this point (its touch selects it and never spawns the stick). */
  soulAt: (x: number, y: number) => boolean;
};
/** The stick spawns from touches that start in the left STICK_ZONE.width and bottom STICK_ZONE.height of the view. */
export const STICK_ZONE = { width: .45, height: .45 } as const;
/** Pixels of thumb travel for full deflection; deflection below STICK_DEAD (of full) does not walk. */
export const STICK_RADIUS = 56, STICK_DEAD = .12;
/** Holding the stick within LONG_PRESS_SLOP px of where it appeared for LONG_PRESS_MS arms the auto-walk lock. */
export const LONG_PRESS_MS = 700, LONG_PRESS_SLOP = 10;
/** A tap moves at most TAP_SLOP px and lasts under TAP_MS; a second tap within DOUBLE_TAP_MS and DOUBLE_TAP_SLOP px flies. */
export const TAP_SLOP = 6, TAP_MS = 350, DOUBLE_TAP_MS = 300, DOUBLE_TAP_SLOP = 30;
/** A second finger within PAIR_JOIN_MS of a stick touch that has not moved yet makes both a two-finger gesture. */
export const PAIR_JOIN_MS = 250;
/** Two fingers decide pinch or rise once their spread or midpoint has moved this many pixels. */
export const PAIR_LOCK = 12;

type Rect = { left: number; top: number; width: number; height: number };
export function inStickZone(x: number, y: number, r: Rect): boolean {
  if (!(r.width > 0 && r.height > 0)) return false;
  const u = (x - r.left) / r.width, v = (y - r.top) / r.height;
  return u >= 0 && u <= STICK_ZONE.width && v >= 1 - STICK_ZONE.height && v <= 1;
}
/** Thumb offset (px, + right / + down) → stick deflection (forward = up the screen), length 0..1 past the dead zone. */
export function stickDeflection(dx: number, dy: number, radius = STICK_RADIUS): { forward: number; right: number } {
  const len = Math.hypot(dx, dy), m = Math.min(1, len / radius);
  if (!Number.isFinite(m) || m < STICK_DEAD) return { forward: 0, right: 0 };
  const k = (m - STICK_DEAD) / (1 - STICK_DEAD) / len;
  return { forward: -dy * k, right: dx * k };
}

type Role = 'stick' | 'look' | 'pair' | 'spent';
type Finger = { x: number; y: number; x0: number; y0: number; t0: number; role: Role; moved: boolean; second: boolean };
type Pair = { mode: 'pending' | 'pinch' | 'rise'; spread0: number; my0: number; spread: number; my: number };
type Timers = { set: (f: () => void, ms: number) => unknown; clear: (id: unknown) => void };

export class WorldTouchFree {
  private fingers = new Map<number, Finger>();
  /** Touches this module turned into a gesture: the viewer's tap (select, pivot) skips them (consumed()). */
  private claimed = new Set<number>();
  private origin: { x: number; y: number } | null = null;
  private pressTimer: unknown = null;
  private lockArmed = false;
  /** The stick's thumb has left the long-press slop. */
  private pressMoved = false;
  private locked = false;
  private lastTap: { x: number; y: number; t: number } | null = null;
  private pair: Pair | null = null;
  private documentListening = false;
  private stickEl: HTMLDivElement | null = null;
  private knobEl: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement;
  private host: HTMLElement;
  private o: TouchFreeOptions;
  private timers: Timers;
  constructor(canvas: HTMLCanvasElement, host: HTMLElement, o: TouchFreeOptions, timers: Timers = { set: (f, ms) => setTimeout(f, ms), clear: id => clearTimeout(id as ReturnType<typeof setTimeout>) }) {
    this.canvas = canvas; this.host = host; this.o = o; this.timers = timers;
    // Capture: a stick touch is the stick's alone (no orbit, tap selection, hover long-press or keyboard focus).
    canvas.addEventListener('pointerdown', this.onDown, { capture: true });
  }
  /** The viewer's tap handler asks before it selects or sets the pivot: true when this touch was a gesture. */
  consumed(pointerId: number): boolean { return this.claimed.delete(pointerId); }
  /** Diagnostics/tests: the stick is shown, the auto-walk lock is on, fingers tracked. */
  get state() { return { stick: !!this.origin, locked: this.locked, armed: this.lockArmed, fingers: this.fingers.size, pair: this.pair?.mode ?? null }; }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    const id = e.pointerId, x = e.clientX, y = e.clientY;
    if (this.locked) {  // any touch stops the auto-walk, and does nothing else
      this.locked = false; this.o.camera.setStick(0, 0);
      if (this.fingers.size === 0) {
        this.track(id, { x, y, x0: x, y0: y, t0: e.timeStamp, role: 'spent', moved: false, second: false });
        this.claimed.add(id); e.stopImmediatePropagation(); e.preventDefault(); return;
      }
    }
    if (!this.o.free()) return;
    let live = [...this.fingers.values()].filter(f => f.role !== 'spent');
    const early = live.length === 1 && live[0].role === 'stick' && !live[0].moved && e.timeStamp - live[0].t0 < PAIR_JOIN_MS ? live[0] : null;
    if (early) {  // a pinch or rise that happened to start in the stick's corner
      if (this.pressTimer !== null) { this.timers.clear(this.pressTimer); this.pressTimer = null; }
      this.lockArmed = false; this.hideStick(); this.o.camera.setStick(0, 0); early.role = 'look';
      live = [early];
    }
    const stick = live.some(f => f.role === 'stick'), looks = live.filter(f => f.role === 'look'), paired = live.some(f => f.role === 'pair');
    const finger: Finger = { x, y, x0: x, y0: y, t0: e.timeStamp, role: 'look', moved: false, second: false };
    if (!live.length && inStickZone(x, y, this.canvas.getBoundingClientRect()) && !this.o.soulAt(x, y)) {
      finger.role = 'stick'; this.claimed.add(id); this.showStick(x, y);
      this.pressMoved = false;
      this.pressTimer = this.timers.set(() => { this.pressTimer = null; if (!this.pressMoved) { this.lockArmed = true; this.paint(); } }, LONG_PRESS_MS);
      e.stopImmediatePropagation(); e.preventDefault();
    } else if (!stick && looks.length === 1 && !paired) {  // a second finger: pinch or rise
      const first = looks[0];
      for (const [fid, f] of this.fingers) if (f === first) this.claimed.add(fid);
      first.role = 'pair'; finger.role = 'pair'; this.claimed.add(id); this.lastTap = null;
      const spread = Math.hypot(x - first.x, y - first.y), my = (y + first.y) / 2;
      this.pair = { mode: 'pending', spread0: spread, my0: my, spread, my };
    } else if (looks.length || paired) {
      finger.role = 'spent'; this.claimed.add(id);  // a third finger is ignored
    } else {
      // A look (beside the stick, or alone). A quick second tap where the last one landed is a double-tap.
      const last = this.lastTap;
      if (!stick && last && e.timeStamp - last.t <= DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) <= DOUBLE_TAP_SLOP) { finger.second = true; this.claimed.add(id); }
    }
    this.track(id, finger);
  };
  private track(id: number, finger: Finger) {
    this.fingers.set(id, finger);
    if (!this.documentListening) {
      const doc = this.canvas.ownerDocument;
      doc.addEventListener('pointermove', this.onMove, { passive: true });
      doc.addEventListener('pointerup', this.onUp); doc.addEventListener('pointercancel', this.onUp);
      this.documentListening = true;
    }
    this.o.camera.setTouchHeld(true);
  }
  private onMove = (e: PointerEvent) => {
    const f = this.fingers.get(e.pointerId); if (!f) return;
    const dx = e.clientX - f.x, dy = e.clientY - f.y; f.x = e.clientX; f.y = e.clientY;
    if (!f.moved && Math.hypot(f.x - f.x0, f.y - f.y0) > TAP_SLOP) f.moved = true;
    if (f.role === 'stick') {
      // The long-press is decided by the input's own times, not by when this page got round to the events: a thumb that left
      // the slop before LONG_PRESS_MS never arms the lock, even if a busy page ran the timer first.
      if (!this.pressMoved && Math.hypot(f.x - f.x0, f.y - f.y0) > LONG_PRESS_SLOP) {
        this.pressMoved = true;
        this.lockArmed = e.timeStamp - f.t0 >= LONG_PRESS_MS;
        if (this.pressTimer !== null) { this.timers.clear(this.pressTimer); this.pressTimer = null; }
      }
      const o = this.origin!; let ox = f.x - o.x, oy = f.y - o.y; const len = Math.hypot(ox, oy);
      if (len > STICK_RADIUS) { const k = (len - STICK_RADIUS) / len; o.x += ox * k; o.y += oy * k; ox = f.x - o.x; oy = f.y - o.y; }  // floating: the base follows the thumb
      const d = stickDeflection(ox, oy); this.o.camera.setStick(d.forward, d.right); this.paint();
    } else if (f.role === 'look') {
      if (!f.moved) return;
      for (const [id, g] of this.fingers) if (g === f) this.claimed.add(id);
      this.o.camera.touchLook(dx, dy);
    } else if (f.role === 'pair' && this.pair) {
      const other = [...this.fingers.values()].find(g => g !== f && g.role === 'pair'); if (!other) return;
      const p = this.pair, spread = Math.hypot(f.x - other.x, f.y - other.y), mx = (f.x + other.x) / 2, my = (f.y + other.y) / 2;
      if (p.mode === 'pending') {
        const ds = Math.abs(spread - p.spread0), dm = Math.abs(my - p.my0);
        if (Math.max(ds, dm) < PAIR_LOCK) return;
        p.mode = ds > dm ? 'pinch' : 'rise';
        if (p.mode === 'pinch' && p.spread0 > 1 && spread > 1) this.o.camera.touchPinch(mx, my, spread / p.spread0, true);
        else if (p.mode === 'rise') this.o.camera.touchRise(my - p.my0);
      } else if (p.mode === 'pinch') { if (p.spread > 1 && spread > 1) this.o.camera.touchPinch(mx, my, spread / p.spread, false); }
      else this.o.camera.touchRise(my - p.my);
      p.spread = spread; p.my = my;
    }
  };
  private onUp = (e: PointerEvent) => {
    const id = e.pointerId, f = this.fingers.get(id); if (!f) return;
    this.fingers.delete(id); this.claimed.delete(id);  // the canvas's own pointerup (the viewer's tap) has already run
    if (f.role === 'stick') {
      if (this.pressTimer !== null) { this.timers.clear(this.pressTimer); this.pressTimer = null; }
      if (this.lockArmed && e.type === 'pointerup' && this.o.camera.walking && this.o.free()) this.locked = true;
      else this.o.camera.setStick(0, 0);
      this.lockArmed = false; this.hideStick();
    } else if (f.role === 'look') {
      const tap = e.type === 'pointerup' && !f.moved && e.timeStamp - f.t0 < TAP_MS;
      if (f.moved) this.o.camera.touchLookEnd();
      if (tap && f.second) { this.lastTap = null; this.o.camera.touchFly(e.clientX, e.clientY); }
      else this.lastTap = tap ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
    } else if (f.role === 'pair') {
      for (const g of this.fingers.values()) if (g.role === 'pair') g.role = 'spent';  // the other finger finishes the gesture
      this.pair = null;
    }
    if (!this.fingers.size) {
      const doc = this.canvas.ownerDocument;
      doc.removeEventListener('pointermove', this.onMove); doc.removeEventListener('pointerup', this.onUp); doc.removeEventListener('pointercancel', this.onUp);
      this.documentListening = false; this.o.camera.setTouchHeld(false);
    }
  };
  private showStick(x: number, y: number) {
    this.origin = { x, y }; this.lockArmed = false;
    if (!this.stickEl && typeof this.host.ownerDocument?.createElement === 'function') {
      const doc = this.host.ownerDocument, base = doc.createElement('div'), knob = doc.createElement('div');
      base.className = 'world-touch-stick'; base.setAttribute('aria-hidden', 'true'); knob.className = 'world-touch-stick-knob';
      const size = STICK_RADIUS * 2;
      Object.assign(base.style, { position: 'absolute', left: '0', top: '0', width: `${size}px`, height: `${size}px`, margin: `${-STICK_RADIUS}px 0 0 ${-STICK_RADIUS}px`, borderRadius: '50%',
        border: '2px solid rgba(255,255,255,.55)', background: 'rgba(20,24,28,.22)', pointerEvents: 'none', zIndex: '2', boxSizing: 'border-box' });
      Object.assign(knob.style, { position: 'absolute', left: `${STICK_RADIUS - 22}px`, top: `${STICK_RADIUS - 22}px`, width: '44px', height: '44px', borderRadius: '50%',
        background: 'rgba(255,255,255,.7)', boxShadow: '0 1px 6px rgba(0,0,0,.35)', boxSizing: 'border-box' });
      base.append(knob); this.host.append(base); this.stickEl = base; this.knobEl = knob;
    }
    if (this.stickEl) this.stickEl.hidden = false;
    this.paint();
  }
  private hideStick() { this.origin = null; if (this.stickEl) this.stickEl.hidden = true; }
  private paint() {
    const o = this.origin, base = this.stickEl, knob = this.knobEl; if (!o || !base || !knob) return;
    const r = this.host.getBoundingClientRect(), f = [...this.fingers.values()].find(g => g.role === 'stick');
    base.style.transform = `translate(${o.x - r.left}px, ${o.y - r.top}px)`;
    base.style.borderColor = this.lockArmed ? 'rgba(255,214,102,.95)' : 'rgba(255,255,255,.55)';
    let kx = f ? f.x - o.x : 0, ky = f ? f.y - o.y : 0; const len = Math.hypot(kx, ky);
    if (len > STICK_RADIUS) { kx *= STICK_RADIUS / len; ky *= STICK_RADIUS / len; }
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
  }
  dispose() {
    this.canvas.removeEventListener('pointerdown', this.onDown, { capture: true });
    const doc = this.canvas.ownerDocument;
    doc.removeEventListener('pointermove', this.onMove); doc.removeEventListener('pointerup', this.onUp); doc.removeEventListener('pointercancel', this.onUp);
    if (this.pressTimer !== null) this.timers.clear(this.pressTimer);
    this.pressTimer = null; this.fingers.clear(); this.claimed.clear(); this.documentListening = false;
    this.stickEl?.remove(); this.stickEl = null; this.knobEl = null;
  }
}
