import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WorldCameraMode } from './WorldBroadcast.ts';
import { editableEvent,manualCameraKeys,manualCameraStep,stickStep,MANUAL_FAR_LIMIT } from './WorldNavigation.ts';
import { cameraGround, CAMERA_GROUND_MARGIN } from './WorldCameraGround.ts';

/** One manual camera: default drag orbits, RMB looks in place, WASD moves horizontally (faster the higher the eye),
 * arrows rotate the head, Q/E (or F/R) lower/raise, Shift boosts and Alt gives precision. C1: the wheel zooms
 * toward/away from the point under the cursor without turning the view (stopping at the ground, never re-tilting),
 * out to the edge of the map; B1: a click (or tap) on the ground or a thing makes that point the pivot and the view turns
 * to it without the eye moving; B2: arrows and right-drag turn the head over the fixed pivot (LOOK_MODEL); Home/H shows
 * everything. B2a: the pivot (what the ring shows, what orbit and zoom turn around) is this module's own state;
 * controls.target is kept equal to it, and an outside re-frame of controls.target is adopted as the new pivot.
 * Deliberate movement takes over from Follow/Broadcast at the same eye and gaze.
 * Orbit gestures in Follow keep the tracked Soul centred. Presentation only. */
export type RtsOptions = {
  controls: () => OrbitControls;
  mode: () => WorldCameraMode;
  /** Switch to "your camera" (Broadcast/Follow off). */
  takeOver: () => void;
  scene: () => THREE.Object3D;
  /** Pickable roots for double-click (bodies, scenery); first visible hit wins. */
  pickRoots: () => readonly THREE.Object3D[];
  /** Whether the user is in "your camera" with this module in charge (not Free, not Advanced). */
  enabled?: () => boolean;
  /** Subject centre and enclosing world-space radius, never a requested camera distance. */
  focusAt?:(x:number,y:number)=>{center:THREE.Vector3;radius:number}|null;
  /** C1: the world's ground rectangle [x0, z0, x1, z1] (far zoom limit, pivot bounds); null when unknown. */
  extent?: () => readonly [number, number, number, number] | null;
  /** C1: Home or H: back to the overview ("see everything"). */
  home?: () => void;
};
const FLY_SECONDS = .8, MARKER_SECONDS = .9, REANCHOR_IDLE = .25;
/** C1 zoom. One wheel notch (100 px) moves the eye ZOOM_PER_PIXEL*100 ≈ 12% of the way toward (or away from) the point
 * under the cursor, eased over ~ZOOM_EASE s; a trackpad pinch (ctrl+wheel) counts 10x per pixel like OrbitControls. With
 * ZOOM_TO_CURSOR false the wheel zooms along the view axis toward the pivot instead. */
export const ZOOM_PER_PIXEL = .0012, ZOOM_EASE = .08, ZOOM_TO_CURSOR = true;
/** C1: the nearest the eye comes to its pivot; the farthest is the map's half-size × FAR_PER_RADIUS (320 m at least, MANUAL_FAR_LIMIT at most). */
export const NEAR_LIMIT = 2, FAR_PER_RADIUS = 2.5;
/** C1: a click waits out the double-click window before it sets its pivot (a double-click only flies). */
export const CLICK_PIVOT_DELAY_MS = 300;
/** B1: where a click on `point` leaves the camera: the pivot becomes the point and the eye stays where it is, lifted only
 * when it is less than `minHeight` above the point. The view then turns to the pivot over LOOK_BLEND_SECONDS. */
export function clickPivotPose(eye:THREE.Vector3,point:THREE.Vector3,minHeight=1):{eye:THREE.Vector3;pivot:THREE.Vector3}{
  const e=eye.clone();if(e.y<point.y+minHeight)e.y=point.y+minHeight;
  return {pivot:point.clone(),eye:e};
}
/** B2 / Q1 (Gene, open): what arrows and right-drag do over the fixed pivot. 'head' (default): the head turns in place by a
 * {yaw, pitch} offset over the gaze at the pivot, and the next orbit or zoom eases it back onto the pivot over
 * LOOK_BLEND_SECONDS. 'orbit': the eye orbits the pivot (orbitEye). Both keep the pivot and the ring where they are; switching
 * is this constant (turnHead reads it). */
export type LookModel = 'head' | 'orbit';
export const LOOK_MODEL: LookModel = 'head';
export const LOOK_BLEND_SECONDS = .3;
/** Radians: + yaw turns right, + pitch tilts up, relative to the gaze from the eye at the pivot. */
export type HeadLook = { yaw: number; pitch: number };
const PITCH_LIMIT = Math.PI * .47;
const yawOf = (d: THREE.Vector3) => Math.atan2(d.x, -d.z), pitchOf = (d: THREE.Vector3) => Math.asin(Math.max(-1, Math.min(1, d.y)));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const gazeFrom = (yaw: number, pitch: number) => new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
function toPivot(eye: THREE.Vector3, pivot: THREE.Vector3) { const d = pivot.clone().sub(eye); return d.lengthSq() < 1e-12 ? new THREE.Vector3(0, 0, -1) : d.normalize(); }
/** B2: the unit gaze of an eye at `eye` looking at `pivot` with head offset `look` (total pitch within ±85°). */
export function headGaze(eye: THREE.Vector3, pivot: THREE.Vector3, look: HeadLook): THREE.Vector3 {
  const d = toPivot(eye, pivot);
  return gazeFrom(yawOf(d) + look.yaw, Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitchOf(d) + look.pitch)));
}
/** B2: the head offset at which an eye looking at `pivot` sees along `gaze` (headGaze's inverse). */
export function lookFor(eye: THREE.Vector3, pivot: THREE.Vector3, gaze: THREE.Vector3): HeadLook {
  const d = toPivot(eye, pivot), g = gaze.clone().normalize();
  return { yaw: wrap(yawOf(g) - yawOf(d)), pitch: pitchOf(g) - pitchOf(d) };
}
/** Q1's alternative ('orbit'): the eye turned about the fixed pivot so the gaze turns by yaw/pitch, same distance; the gaze
 * stays between straight down (85°) and level. */
export function orbitEye(eye: THREE.Vector3, pivot: THREE.Vector3, yaw: number, pitch: number): THREE.Vector3 {
  const d = toPivot(eye, pivot), r = eye.distanceTo(pivot);
  return pivot.clone().addScaledVector(gazeFrom(yawOf(d) + yaw, Math.max(-PITCH_LIMIT, Math.min(0, pitchOf(d) + pitch))), -r);
}
/** #891 touch: a two-finger vertical drag rises this many metres per pixel (times the WASD height scale); a pinch's spread
 * ratio r zooms like a wheel by -ln(r) × PINCH_GAIN (spreading the fingers glides in toward the point between them). */
export const RISE_PER_PIXEL = .02, PINCH_GAIN = 1;
/** #891: a browser's own dblclick that follows a touch double-tap is the same gesture (it does not fly twice). */
const TOUCH_DBLCLICK_MS = 800;
const unit = (v: number) => Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
/** C1: metres the eye must be above the ground to move at the base WASD speed; higher multiplies it (up to 40x). */
const SPEED_HEIGHT = 8, SPEED_MAX = 40;

/** Where the view ray from `camera` through the screen centre meets the drawn ground (or y = 0). */
export function centreGround(camera: THREE.Camera, scene: THREE.Object3D | null, maxDistance = 600): THREE.Vector3 | null {
  const origin = camera.getWorldPosition(new THREE.Vector3()), dir = camera.getWorldDirection(new THREE.Vector3());
  if (dir.y > -.02) return null; // looking at the horizon: no ground under the centre
  const height = (x: number, z: number) => (scene ? cameraGround.heightAt(scene, x, z) : null) ?? 0;
  let prev = 0, step = 1.5;
  for (let t = step; t <= maxDistance; t += step) {
    const p = origin.clone().addScaledVector(dir, t);
    if (p.y <= height(p.x, p.z)) {
      let lo = prev, hi = t; // refine
      for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2, q = origin.clone().addScaledVector(dir, m); if (q.y <= height(q.x, q.z)) hi = m; else lo = m; }
      const hit = origin.clone().addScaledVector(dir, hi); hit.y = height(hit.x, hit.z); return hit;
    }
    prev = t; step = Math.min(12, step * 1.15);
  }
  return null;
}

/** Old Eden's terrain (±900 m; the far plane is set for it in LiveWorld). */
export const EDEN_TERRAIN_EXTENT = [-900, -900, 900, 900] as const;
/** C1: a wheel over HTML laid on the world (name tags, speech) zooms as it would over the canvas: re-dispatched there,
 * where your camera (or Follow's OrbitControls) reads it. Before, a Soul's tag drifting under the cursor ate every notch. */
export function forwardWheel(from: HTMLElement, canvas: HTMLElement): void {
  from.addEventListener('wheel', (e: WheelEvent) => {
    if (e.target === canvas) return;
    e.preventDefault(); e.stopPropagation();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
      clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
      ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true }));
  }, { passive: false });
}

/** C1: how far the eye may zoom out from its pivot for a world whose ground spans `extent`. */
export function farLimit(extent: readonly [number, number, number, number] | null | undefined): number {
  const r = extent ? Math.max(extent[2] - extent[0], extent[3] - extent[1]) / 2 : 0;
  return Math.min(MANUAL_FAR_LIMIT, Math.max(320, Number.isFinite(r) ? r * FAR_PER_RADIUS : 0));
}

export class WorldRtsCamera {
  readonly marker = new THREE.Group();
  private keys = new Set<string>();
  private rightHeld = false;
  private rightPointer:number|null=null;
  private lookPoint:{x:number;y:number}|null=null;
  private manualInput=false;
  private dragging = false;
  private markerAge = Infinity;
  private idle = Infinity;
  private moved = false;
  private flight: { fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3; t: number; seconds?: number } | null = null;
  /** C1 zoom still to apply (natural log of the eye-pivot distance factor; + is out) and the point it scales about. */
  private zoomLog = 0;
  private zoomAt: { x: number; y: number } | null = null;
  private zoomAnchor: THREE.Vector3 | null = null;
  private pendingClick: ReturnType<typeof setTimeout> | null = null;
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];
  private ring: THREE.Mesh;
  private dot: THREE.Mesh;
  private material = new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0, depthTest: false, side: THREE.DoubleSide });
  private boundControls: OrbitControls | null = null;
  private dragFrom: THREE.Vector3 | null = null;
  /** B2a: the pivot; `written` is the eye and controls.target as this module last left them (to tell an outside re-frame). */
  readonly pivot = new THREE.Vector3();
  private written: { eye: THREE.Vector3; target: THREE.Vector3 } | null = null;
  /** B2: the head offset over the gaze at the pivot, and its blend back to zero. */
  private look: HeadLook = { yaw: 0, pitch: 0 };
  private lookBlend: { from: HeadLook; t: number } | null = null;
  /** #891 touch Free camera (touch/WorldTouchFree.ts): the stick's deflection, metres still to rise, whether a finger is
   * down (one take-over per gesture, as the right button keeps), and when a double-tap last flew. */
  private stick = { forward: 0, right: 0 };
  private riseBy = 0;
  private touchHeld = false;
  private touchFlewAt = -Infinity;
  private onStart = () => { this.dragging = true; this.markerAge = 0; this.dragFrom = this.boundControls?.target.clone() ?? null; this.startLookBlend(); };
  /** CAMERA-PIVOT: only a gesture that moved the pivot (pan, cursor zoom) re-anchors it; a pure orbit keeps the chosen point. */
  private onEnd = () => { const t = this.boundControls?.target; this.dragging = false; this.idle = 0; this.moved = !this.dragFrom || !t || t.distanceToSquared(this.dragFrom) > 1e-6; this.dragFrom = null; };
  private onChange = () => { if (this.dragging) this.markerAge = 0; };

  private canvas: HTMLCanvasElement;
  private camera: THREE.PerspectiveCamera;
  private o: RtsOptions;
  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, o: RtsOptions) {
    this.canvas = canvas; this.camera = camera; this.o = o;
    this.marker.name = 'rts-pivot-marker'; this.marker.renderOrder = 999; this.marker.visible = false;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(.42, .5, 40).rotateX(-Math.PI / 2), this.material);
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(.07, 16).rotateX(-Math.PI / 2), this.material);
    this.marker.add(this.ring, this.dot);
    const doc = canvas.ownerDocument, win = doc.defaultView;
    const listen = (t: EventTarget, name: string, cb: (e: any) => void, opt?: AddEventListenerOptions) => { t.addEventListener(name, cb, opt); this.listeners.push([t, name, cb, opt]); };
    // Keys work when the scene has focus, or when nothing else does (a fresh page: just press W).
    // VF6: also when a panel has focus (the Soul card focuses its name; Follow is a button on it), so pressing W
    // while following breaks out. Ordinary buttons also allow head controls immediately after Follow.
    // Arrows/PageUp/PageDown keep scrolling a focused panel; interactive widgets retain their keys below.
    const panelFocus = () => { const a = doc.activeElement; return !!a && a !== canvas && a !== doc.body && a.tagName !== 'BUTTON'; };
    const ours = (e: KeyboardEvent) => !editableEvent(e) && !e.ctrlKey && !e.metaKey && !doc.querySelector('[aria-modal="true"]')
      && (doc.activeElement === canvas || doc.activeElement === doc.body || doc.activeElement === null
        || (!doc.activeElement.closest('[role=dialog],[role=radiogroup],[role=listbox],[role=menu],[role=slider]') && (!panelFocus() || /^Key[WASDQERF]$|^(Shift|Alt)/.test(e.code))));
    if (win) {
      listen(win, 'keydown', (e: KeyboardEvent) => {
        if(e.key==='Escape'&&!editableEvent(e)){this.clearInput();return;}
        if((e.code==='Home'||e.code==='KeyH')&&!e.altKey&&!e.shiftKey&&this.o.home&&ours(e)&&this.enabledNow()!==false&&this.o.mode()!=='follow'){
          e.preventDefault();this.clearInput();this.o.home();return;}
        if (!ours(e) || !manualCameraKeys.has(e.code) || this.enabledNow() === false) return;
        e.preventDefault(); this.keys.add(e.code);this.flight=null;this.stopZoom();this.cancelClick();
      });
      listen(win, 'keyup', (e: KeyboardEvent) => { this.keys.delete(e.code); });
      listen(win, 'blur', () => this.clearInput());
    }
    listen(canvas,'blur',()=>this.clearInput());
    listen(doc,'visibilitychange',()=>{if(doc.hidden)this.clearInput();});
    listen(canvas,'pointerdown',(e:PointerEvent)=>{
      this.flight=null;this.stopZoom();this.cancelClick();if(e.button!==2||this.enabledNow()===false)return;
      this.rightHeld=true;this.rightPointer=e.pointerId;this.lookPoint={x:e.clientX,y:e.clientY};
      canvas.focus({preventScroll:true});canvas.setPointerCapture?.(e.pointerId);
      e.preventDefault();e.stopImmediatePropagation();
    },{capture:true});
    listen(canvas,'pointermove',(e:PointerEvent)=>{
      if(!this.rightHeld||!this.lookPoint||this.enabledNow()===false)return;
      const dx=e.clientX-this.lookPoint.x,dy=e.clientY-this.lookPoint.y;this.lookPoint={x:e.clientX,y:e.clientY};
      if(dx||dy){this.startManualInput();this.turnHead(dx*.004,-dy*.004);this.markerAge=0;}
      e.preventDefault();e.stopImmediatePropagation();
    },{capture:true});
    const endLook=(e:PointerEvent)=>{if(e.pointerId===this.rightPointer){this.releaseLook();this.manualInput=false;}};
    listen(doc,'pointerup',endLook);listen(canvas,'pointercancel',endLook);
    listen(canvas,'lostpointercapture',endLook);
    listen(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    // C1: your camera's wheel (and Broadcast's, which it takes over). Capture: runs before OrbitControls' own dolly, which
    // turned the view at shallow angles (zoomToCursor re-aims below 20°) and stopped at 320 m. Follow keeps OrbitControls'
    // 2.4–40 m zoom; Free camera keeps WorldNavigation's; touch pinch stays OrbitControls'.
    listen(canvas, 'wheel', (e: WheelEvent) => {
      this.cancelClick();
      const mode = this.o.mode();
      if (this.enabledNow() === false || mode === 'follow') return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (mode !== 'manual') this.o.takeOver();
      this.flight = null; this.startLookBlend();
      const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1) * (e.ctrlKey ? 10 : 1);
      if (!Number.isFinite(px) || !px) return;
      if (!this.zoomAt || Math.hypot(e.clientX - this.zoomAt.x, e.clientY - this.zoomAt.y) > 3) { this.zoomAt = { x: e.clientX, y: e.clientY }; this.zoomAnchor = null; }
      this.zoomLog = Math.max(-3, Math.min(3, this.zoomLog + Math.max(-.35, Math.min(.35, px * ZOOM_PER_PIXEL))));
      this.markerAge = 0; this.idle = 0; this.moved = true;
    }, { capture: true, passive: false });
    listen(canvas, 'dblclick', (e: MouseEvent) => { this.cancelClick(); if (performance.now() - this.touchFlewAt < TOUCH_DBLCLICK_MS) return; this.flyToPointer(e); });
  }
  private releaseLook(){
    const id=this.rightPointer;this.rightHeld=false;this.rightPointer=null;this.lookPoint=null;
    if(id!==null&&this.canvas.hasPointerCapture?.(id))this.canvas.releasePointerCapture(id);
  }
  private clearInput(){this.keys.clear();this.releaseLook();this.manualInput=false;this.flight=null;this.stopZoom();this.cancelClick();this.stick={forward:0,right:0};this.riseBy=0;}
  /** #891: touch drives your camera only (Follow and Broadcast keep OrbitControls' touch mapping). */
  private touchable(){return this.enabledNow()!==false&&this.o.mode()==='manual';}
  /** #891: the floating stick's deflection, forward/right in -1..1; WASD's path moves the eye (and pivot) each frame. */
  setStick(forward:number,right:number){
    this.stick={forward:unit(forward),right:unit(right)};
    if(this.walking){this.flight=null;this.stopZoom();this.cancelClick();}
  }
  /** #891: the stick is deflected (walking, or the long-press auto-walk). */
  get walking(){return !!(this.stick.forward||this.stick.right);}
  /** #891: a finger is down in your camera: like the held right button, one take-over for the whole gesture. */
  setTouchHeld(held:boolean){this.touchHeld=held;}
  /** #891: one-finger look, as right-drag: the head turns over the fixed pivot. */
  touchLook(dx:number,dy:number){
    if(!this.touchable()||(!dx&&!dy))return;
    this.flight=null;this.cancelClick();this.startManualInput();this.turnHead(dx*.004,-dy*.004);this.markerAge=0;
  }
  /** #891: a finished touch look keeps where you look: the pivot moves onto the gaze (the ground under the screen centre,
   * else the point along the gaze at the old distance) and the head offset becomes zero, so the next pinch or orbit does not
   * swing the view back. The eye and the view do not move. (Desktop right-drag keeps LOOK_MODEL's blend back.) */
  touchLookEnd(){
    if(!this.touchable()||!this.lookActive())return;
    const c=this.adopt();this.camera.updateMatrixWorld();
    const gaze=this.camera.getWorldDirection(new THREE.Vector3()),d=Math.max(NEAR_LIMIT,this.camera.position.distanceTo(this.pivot));
    const ground=centreGround(this.camera,this.o.scene(),Math.max(600,d*1.5));
    this.pivot.copy(ground&&ground.distanceTo(this.camera.position)>=1?ground:this.camera.position.clone().addScaledVector(gaze,d));
    this.look={yaw:0,pitch:0};this.lookBlend=null;this.write(c);this.camera.up.set(0,1,0);this.camera.lookAt(this.pivot);this.moved=false;
  }
  /** #891: two-finger vertical drag (pixels, + down) rises or lowers the eye on the next frame, as Q/E. */
  touchRise(dy:number){
    if(!this.touchable()||!Number.isFinite(dy)||!dy)return;
    this.flight=null;this.cancelClick();
    this.riseBy=Math.max(-4,Math.min(4,this.riseBy-dy*RISE_PER_PIXEL*this.speedScale()));
  }
  /** #891: pinch, as the wheel: zoom toward the point between the fingers (fixed from the gesture's start). */
  touchPinch(x:number,y:number,ratio:number,start:boolean){
    if(!this.touchable()||!Number.isFinite(ratio)||ratio<=0||ratio===1)return;
    this.flight=null;this.cancelClick();this.startLookBlend();
    if(start||!this.zoomAt){this.zoomAt={x,y};this.zoomAnchor=null;}
    this.zoomLog=Math.max(-3,Math.min(3,this.zoomLog-Math.log(ratio)*PINCH_GAIN));
    this.markerAge=0;this.idle=0;this.moved=true;
  }
  /** #891: our own double-tap (iOS Safari does not fire dblclick reliably): fly there, as a double-click. */
  touchFly(x:number,y:number){
    if(!this.touchable())return;
    this.cancelClick();this.touchFlewAt=performance.now();this.flyToPointer({clientX:x,clientY:y});
  }
  private stopZoom(){this.zoomLog=0;this.zoomAnchor=null;this.zoomAt=null;}
  private cancelClick(){if(this.pendingClick!==null){clearTimeout(this.pendingClick);this.pendingClick=null;}}
  /** C1: the far zoom limit for this world. */
  farLimit(){return farLimit(this.o.extent?.());}
  private pointerRay(x:number,y:number){
    const rect=this.canvas.getBoundingClientRect(),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((x-rect.left)/rect.width)*2-1,-((y-rect.top)/rect.height)*2+1),this.camera);return ray;
  }
  /** The first visible pickable surface under the pointer, else the drawn ground, else y = 0 (within the far limit). */
  private pickPoint(x:number,y:number):THREE.Vector3|null{
    this.camera.updateMatrixWorld();const ray=this.pointerRay(x,y),far=Math.max(600,this.farLimit()*1.5);
    const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
    for (const hit of ray.intersectObjects(this.o.pickRoots() as THREE.Object3D[], true)) if ((hit.object as THREE.Mesh).isMesh && shown(hit.object) && hit.distance > .5) return hit.point.clone();
    const scene=this.o.scene(),ground=scene?cameraGround.along(scene,ray.ray.origin,ray.ray.direction,far):null;if(ground)return ground;
    const g = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return g && ray.ray.origin.distanceTo(g) < far ? g : null;
  }
  /** C1 + B1: a plain click or tap (LiveWorld calls this after its own selection): after the double-click window, the
   * clicked world point (raycast hit on a thing, else the drawn ground, else y = 0) becomes the pivot; the eye stays
   * (clickPivotPose) and the view turns onto the pivot over LOOK_BLEND_SECONDS; later orbit and zoom turn around it.
   * Manual camera only: Follow and Broadcast ignore it. */
  clickPivot(e:{clientX:number;clientY:number;pointerType?:string}){
    this.cancelClick();
    if(this.enabledNow()===false||this.o.mode()!=='manual')return;
    const {clientX:x,clientY:y}=e;
    this.pendingClick=setTimeout(()=>{
      this.pendingClick=null;if(this.enabledNow()===false||this.o.mode()!=='manual'||this.dragging||this.rightHeld||this.keys.size)return;
      const point=this.pickPoint(x,y);if(!point||point.distanceTo(this.camera.position)<1)return;
      const c=this.adopt(),gaze=this.camera.getWorldDirection(new THREE.Vector3()),to=clickPivotPose(this.camera.position,point);
      this.flight=null;this.camera.position.copy(to.eye);this.pivot.copy(to.pivot);this.write(c);
      this.look=lookFor(to.eye,to.pivot,gaze);this.startLookBlend();this.applyLook();this.markerAge=0;this.moved=false;
    },CLICK_PIVOT_DELAY_MS);
  }
  /** Discard an old orbit gesture/damping once, before direct eye-relative controls. */
  private startManualInput(){
    if(!this.manualInput){this.o.takeOver();this.manualInput=true;this.dragging=false;this.moved=false;this.flight=null;}
    return this.bind();
  }
  private enabledNow() { return this.o.enabled ? this.o.enabled() : true; }
  /** B2a: bind the controls and take over an outside change of controls.target as the pivot. An outside re-aim (the eye-to-
   * target direction changed: a framing, Follow, Broadcast) also drops the head offset; eye and target moved together (a
   * pan, a boundary push) keep it. */
  private adopt() {
    const c = this.bind(), w = this.written;
    if (!w || !c.target.equals(w.target)) {
      if (!w || toPivot(w.eye, w.target).angleTo(toPivot(this.camera.position, c.target)) > 1e-4) { this.look = { yaw: 0, pitch: 0 }; this.lookBlend = null; }
      this.pivot.copy(c.target); this.write(c);
    }
    return c;
  }
  /** B2a: controls.target := the pivot (OrbitControls orbits and dollies about it). */
  private write(c: OrbitControls) {
    c.target.copy(this.pivot);
    if (this.written) { this.written.eye.copy(this.camera.position); this.written.target.copy(this.pivot); }
    else this.written = { eye: this.camera.position.clone(), target: this.pivot.clone() };
  }
  private lookActive() { return !!(this.look.yaw || this.look.pitch || this.lookBlend); }
  /** B2: an arrow or right-drag turn. The pivot never moves. */
  private turnHead(yaw: number, pitch: number) {
    if (!yaw && !pitch) return;
    const c = this.adopt();
    if (LOOK_MODEL === 'orbit') { this.camera.position.copy(orbitEye(this.camera.position, this.pivot, yaw, pitch)); this.write(c); if (!this.applyLook()) this.camera.lookAt(this.pivot); return; }
    const base = pitchOf(toPivot(this.camera.position, this.pivot));
    this.look = { yaw: wrap(this.look.yaw + yaw), pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, base + this.look.pitch + pitch)) - base };
    this.lookBlend = null; this.applyLook();
  }
  /** B2: the next orbit or zoom eases the head back onto the pivot (also a click's re-aim). */
  private startLookBlend() { if (this.look.yaw || this.look.pitch) this.lookBlend = { from: { ...this.look }, t: 0 }; }
  private stepLook(dt: number) {
    const b = this.lookBlend; if (!b) return false;
    b.t = Math.min(1, b.t + dt / LOOK_BLEND_SECONDS); const k = 1 - b.t * b.t * (3 - 2 * b.t);
    this.look = { yaw: b.from.yaw * k, pitch: b.from.pitch * k };
    if (b.t >= 1) { this.look = { yaw: 0, pitch: 0 }; this.lookBlend = null; this.camera.up.set(0, 1, 0); this.camera.lookAt(this.pivot); }
    return true;
  }
  /** Orient the camera: the gaze at the pivot turned by the head offset, level horizon. False when there is no offset. */
  private applyLook() {
    if (!this.look.yaw && !this.look.pitch) return false;
    const eye = this.camera.position; this.camera.up.set(0, 1, 0); this.camera.lookAt(eye.clone().add(headGaze(eye, this.pivot, this.look)));
    this.camera.updateMatrixWorld(); return true;
  }
  /** B2: per frame after controls.update() (which aims the camera at controls.target): re-apply the head offset. */
  afterControls() { if (this.o.mode() === 'manual' && this.enabledNow() !== false) this.applyLook(); }
  /** Diagnostics/tests: the current head offset. */
  get headLook(): Readonly<HeadLook> { return this.look; }
  /** Keep the controls' start/end hooks on the current controls object (it is recreated on input release). */
  private bind() {
    const c = this.o.controls();
    if (c === this.boundControls) return c;
    this.boundControls?.removeEventListener('start', this.onStart); this.boundControls?.removeEventListener('end', this.onEnd); this.boundControls?.removeEventListener('change', this.onChange);
    c.addEventListener('start', this.onStart); c.addEventListener('end', this.onEnd); c.addEventListener('change', this.onChange);
    this.boundControls = c; return c;
  }
  get following() { return this.o.mode() === 'follow'; }

  /** Double-click: fly to what is under the pointer and make it the pivot. */
  flyToPointer(e: { clientX: number; clientY: number }) {
    if (this.enabledNow() === false) return;
    const focus=this.o.focusAt?.(e.clientX,e.clientY);if(focus){this.o.takeOver();this.frameSubject(focus.center,focus.radius);return;}
    const point = this.pickPoint(e.clientX, e.clientY);
    if (!point) return;
    this.o.takeOver();
    this.flyTo(point);
  }
  /** Glide the pivot to `point`, coming in to a comfortable distance (6–16 m) at the same angle. */
  frameSubject(center:THREE.Vector3,boundingRadius:number){
    const vfov=this.camera.fov*Math.PI/180,hfov=2*Math.atan(Math.tan(vfov/2)*this.camera.aspect);
    const half=Math.max(.05,Math.min(vfov,hfov)/2),radius=Number.isFinite(boundingRadius)?Math.max(.1,boundingRadius):1;
    this.flyTo(center,Math.max(6,radius/Math.sin(half)*1.15));
  }
  flyTo(point: THREE.Vector3,cameraDistance?:number) {
    this.adopt();const offset = this.camera.position.clone().sub(this.pivot);this.look={yaw:0,pitch:0};this.lookBlend=null;
    const distance=cameraDistance!==undefined&&Number.isFinite(cameraDistance)?Math.max(6,cameraDistance):Math.min(16,Math.max(6,offset.length()));
    if(offset.lengthSq()<1e-6)offset.set(1,.7,1);
    offset.setLength(distance);
    this.flight = { fromT: this.pivot.clone(), toT: point.clone(), fromP: this.camera.position.clone(), toP: point.clone().add(offset), t: 0 };
    this.markerAge = 0;
  }

  /** Per frame, before controls.update(). Returns true when it moved the camera. */
  update(seconds: number): boolean {
    const dt = Number.isFinite(seconds) ? Math.max(0, Math.min(.1, seconds)) : 0;
    const mode=this.o.mode();let c=this.adopt();const pivot=this.pivot;
    let changed = false;
    if (mode !== 'manual' && this.lookActive()) { this.look = { yaw: 0, pitch: 0 }; this.lookBlend = null; }
    if (this.flight) {
      const f = this.flight; f.t = Math.min(1, f.t + dt / (f.seconds ?? FLY_SECONDS)); const k = f.t * f.t * (3 - 2 * f.t);
      pivot.lerpVectors(f.fromT, f.toT, k); this.camera.position.lerpVectors(f.fromP, f.toP, k); this.camera.lookAt(pivot);
      this.markerAge = 0; changed = true;
      if (f.t >= 1) this.flight = null;
    }
    if(this.zoomLog&&mode==='manual'&&this.enabledNow()!==false&&!this.flight)changed=this.stepZoom(dt,pivot)||changed;
    if((this.walking||this.riseBy)&&(mode!=='manual'||this.enabledNow()===false)){this.stick={forward:0,right:0};this.riseBy=0;}
    const touch=this.walking||!!this.riseBy,scale=this.keys.size||touch?this.speedScale():1;
    const movement=manualCameraStep(this.keys,dt,scale);
    if(touch){  // #891: the stick and the two-finger rise take WASD's and Q/E's path (same clamps after it)
      const s=stickStep(this.stick.forward,this.stick.right,dt,scale);
      movement.forward=(movement.forward??0)+(s.forward??0);movement.right=(movement.right??0)+(s.right??0);const up=Math.max(-1,Math.min(1,this.riseBy));this.riseBy=Math.abs(this.riseBy-up)<1e-6?0:this.riseBy-up;movement.up=(movement.up??0)+up;  // at most 1 m a frame
    }
    if(Object.values(movement).some(Boolean)&&this.enabledNow()!==false){
      c=this.startManualInput();
      const forward=this.camera.getWorldDirection(new THREE.Vector3());forward.y=0;
      if(forward.lengthSq()<1e-8)forward.set(0,0,-1);else forward.normalize();
      const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0));
      const delta=forward.multiplyScalar(movement.forward??0).addScaledVector(right,movement.right??0);delta.y=movement.up??0;
      this.camera.position.add(delta);pivot.add(delta);this.write(c);
      this.turnHead(movement.yaw??0,movement.pitch??0);
      this.markerAge=0;this.idle=0;this.moved=false;changed=true;
    }else{this.idle+=dt;if(!this.rightHeld&&!this.touchHeld)this.manualInput=false;}
    if(mode==='manual'&&this.enabledNow()!==false&&!this.flight)changed=this.keepPivotInBounds(pivot)||changed;
    if(mode==='manual')changed=this.stepLook(dt)||changed;
    // The pivot rule: shortly after any movement, re-anchor the pivot to the ground under the screen centre (once the
    // head is back on the pivot, so the screen centre is the gaze at it).
    if (this.moved && !this.dragging && !this.flight && !this.rightHeld && this.idle >= REANCHOR_IDLE && mode === 'manual' && !this.lookActive()) {
      this.moved = false; this.reanchor();
    }
    this.markerAge += dt;
    const fade = this.dragging ? 1 : Math.max(0, 1 - this.markerAge / MARKER_SECONDS);
    this.material.opacity = .85 * fade; this.marker.visible = fade > 0 && mode === 'manual';
    if (this.marker.visible) {
      const scale = Math.max(.5, this.camera.position.distanceTo(pivot) * .035);
      this.marker.position.copy(pivot).add(new THREE.Vector3(0, .04, 0)); this.marker.scale.setScalar(scale);
    }
    this.write(c); if (mode === 'manual' && this.applyLook()) changed = true;
    // Diagnostics for proofs/tests (read-only): where the camera and its pivot are.
    (globalThis as { __simCamera?: unknown }).__simCamera = { p: this.camera.position.toArray().map(v => +v.toFixed(2)), pivot: pivot.toArray().map(v => +v.toFixed(2)), look: [+this.look.yaw.toFixed(3), +this.look.pitch.toFixed(3)], marker: this.marker.visible, far: this.farLimit() };
    return changed;
  }
  /** WASD speed factor: the eye's height above the ground under it over SPEED_HEIGHT, 1–SPEED_MAX. */
  private speedScale(){
    const p=this.camera.position,scene=this.o.scene(),ground=(scene?cameraGround.heightAt(scene,p.x,p.z):null)??0;
    return Math.max(1,Math.min(SPEED_MAX,(p.y-ground)/SPEED_HEIGHT));
  }
  /** One frame of the eased wheel zoom: scale eye and pivot about the anchor (the view does not turn). Stops at the
   * near/far limits and where the eye would come within the ground margin, rather than lifting and re-aiming it. */
  private stepZoom(dt:number,target:THREE.Vector3):boolean{
    let take=Math.abs(this.zoomLog)<1e-3?this.zoomLog:this.zoomLog*(1-Math.exp(-dt/ZOOM_EASE));
    if(!take||!Number.isFinite(take))return false;
    const eye=this.camera.position,d=eye.distanceTo(target);
    if(d<1e-6){this.stopZoom();return false;}
    const anchor=this.zoomAnchorPoint(target);
    const far=this.farLimit();
    if(take>0&&d*Math.exp(take)>far){take=Math.max(0,Math.log(far/d));this.zoomLog=take;}
    if(take<0&&d*Math.exp(take)<NEAR_LIMIT){take=Math.min(0,Math.log(NEAR_LIMIT/d));this.zoomLog=take;}
    const scene=this.o.scene(),ahead=this.camera.getWorldDirection(new THREE.Vector3());ahead.y=0;
    if(ahead.lengthSq()>1e-8)ahead.normalize();
    const at=(k:number)=>anchor.clone().addScaledVector(eye.clone().sub(anchor),Math.exp(k));
    const clear=(q:THREE.Vector3)=>{
      if(!scene)return true;const g0=cameraGround.heightAt(scene,q.x,q.z),g1=cameraGround.heightAt(scene,q.x+ahead.x*1.5,q.z+ahead.z*1.5);
      const g=g0===null?g1:g1===null?g0:Math.max(g0,g1);return g===null||q.y>=g+CAMERA_GROUND_MARGIN+.05;};
    let next=at(take);
    if(next.y<eye.y&&!clear(next)){
      let lo=0,hi=1;for(let i=0;i<10;i++){const m=(lo+hi)/2;if(clear(at(take*m)))lo=m;else hi=m;}
      take*=lo;next=at(take);this.zoomLog=take;
    }
    this.zoomLog-=take;if(Math.abs(this.zoomLog)<1e-4)this.stopZoom();
    if(!take)return false;
    target.sub(anchor).multiplyScalar(Math.exp(take)).add(anchor);eye.copy(next);this.camera.updateMatrixWorld();
    this.markerAge=0;this.idle=0;this.moved=true;return true;
  }
  /** The zoom's fixed point: the ground under the cursor (ZOOM_TO_CURSOR), else the pivot along the view axis;
   * over the sky, the point on the cursor ray as far out as the pivot. */
  private zoomAnchorPoint(target:THREE.Vector3):THREE.Vector3{
    if(this.zoomAnchor)return this.zoomAnchor;
    const eye=this.camera.position,d=eye.distanceTo(target);let p:THREE.Vector3|null=null;
    if(ZOOM_TO_CURSOR&&this.zoomAt&&typeof this.canvas.getBoundingClientRect==='function'){
      this.camera.updateMatrixWorld();const ray=this.pointerRay(this.zoomAt.x,this.zoomAt.y).ray;
      const scene=this.o.scene();p=scene?cameraGround.along(scene,ray.origin,ray.direction,Math.max(600,d*3)):null;
      if(!p){const g=ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());if(g&&g.distanceTo(eye)<Math.max(600,d*3))p=g;}
      p??=ray.origin.clone().addScaledVector(ray.direction,d);
    }
    return this.zoomAnchor=p??target.clone();
  }
  /** Pan/WASD/zoom keep the pivot over the map (its ground rectangle plus a margin); the eye moves with it. */
  private keepPivotInBounds(target:THREE.Vector3):boolean{
    const e=this.o.extent?.();if(!e||!e.every(Number.isFinite))return false;
    const m=Math.max(60,.25*Math.max(e[2]-e[0],e[3]-e[1]));
    const x=Math.max(e[0]-m,Math.min(e[2]+m,target.x)),z=Math.max(e[1]-m,Math.min(e[3]+m,target.z));
    if(x===target.x&&z===target.z)return false;
    this.camera.position.x+=x-target.x;this.camera.position.z+=z-target.z;target.x=x;target.z=z;return true;
  }
  /** Pivot := drawn ground under the screen centre; the camera does not move. */
  reanchor(): boolean {
    const c = this.adopt(); this.camera.updateMatrixWorld();
    const p = centreGround(this.camera, this.o.scene(), Math.max(600, this.camera.position.distanceTo(this.pivot) * 1.5));
    if (!p || p.distanceTo(this.camera.position) < 1) return false;
    this.pivot.copy(p); this.write(c); return true;
  }
  release(){this.clearInput();this.flight=null;}
  dispose() {
    this.clearInput();this.cancelClick();
    for (const [t, name, cb, opt] of this.listeners) t.removeEventListener(name, cb, opt);
    this.listeners = [];
    this.boundControls?.removeEventListener('start', this.onStart); this.boundControls?.removeEventListener('end', this.onEnd); this.boundControls?.removeEventListener('change', this.onChange);
    this.marker.removeFromParent(); this.ring.geometry.dispose(); this.dot.geometry.dispose(); this.material.dispose();
  }
}
