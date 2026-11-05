import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WorldTouchFree, inStickZone, stickDeflection, STICK_RADIUS, LONG_PRESS_MS, type TouchCamera } from '../src/touch/WorldTouchFree.ts';
import { WorldRtsCamera, RISE_PER_PIXEL } from '../src/WorldRtsCamera.ts';
import { createWorldOrbitControls, stickStep, manualCameraStep, type NavigationContext } from '../src/WorldNavigation.ts';

// #891 touch Free camera. A 400 × 800 phone view: the stick zone is x ≤ 180, y ≥ 440.
const VIEW = { left: 0, top: 0, width: 400, height: 800 };

test('stick zone: left 45 % × bottom 45 % of the view only', () => {
  assert.equal(inStickZone(60, 700, VIEW), true);
  assert.equal(inStickZone(180, 440, VIEW), true);
  assert.equal(inStickZone(200, 700, VIEW), false, 'right of the zone');
  assert.equal(inStickZone(60, 300, VIEW), false, 'above the zone');
  assert.equal(inStickZone(60, 700, { left: 0, top: 0, width: 0, height: 0 }), false, 'no view');
});

test('stick deflection: dead zone, forward is up the screen, capped at full deflection', () => {
  assert.deepEqual(stickDeflection(3, -3), { forward: 0, right: 0 });
  const up = stickDeflection(0, -STICK_RADIUS);assert.ok(Math.abs(up.forward - 1) < 1e-9 && Math.abs(up.right) < 1e-9);
  const far = stickDeflection(STICK_RADIUS * 3, 0);assert.ok(Math.abs(far.right - 1) < 1e-9, 'beyond the radius stays at full');
  const half = stickDeflection(0, STICK_RADIUS / 2);assert.ok(half.forward < -.3 && half.forward > -.5, 'half way back walks back, slower');
});

test('stick speed at full deflection equals WASD speed, scaled the same way', () => {
  const w = manualCameraStep(new Set(['KeyW']), .05, 2), s = stickStep(1, 0, .05, 2);
  assert.ok(Math.abs((s.forward ?? 0) - (w.forward ?? 0)) < 1e-12);
  const d = stickStep(1, 1, .05);assert.ok(Math.abs(Math.hypot(d.forward ?? 0, d.right ?? 0) - .15) < 1e-12, 'diagonal never faster');
});

test('OrbitControls leave touch to the gestures in Free only; Follow and Broadcast keep their touch mapping', () => {
  const doc = Object.assign(new EventTarget(), { defaultView: new EventTarget() });
  const canvas = Object.assign(new EventTarget(), { ownerDocument: doc, style: {}, getRootNode: () => doc }) as never;
  const camera = new THREE.PerspectiveCamera();
  const touches = (c: NavigationContext) => { const o = createWorldOrbitControls(camera, canvas, undefined, c); const t = { ...o.touches }; o.dispose(); return t; };
  assert.deepEqual(touches({ mode: 'manual', navigation: 'orbit', lifecycle: '' }), { ONE: null, TWO: null });
  assert.equal(touches({ mode: 'follow', navigation: 'orbit', lifecycle: '' }).ONE, THREE.TOUCH.ROTATE);
  assert.equal(touches({ mode: 'broadcast', navigation: 'orbit', lifecycle: '' }).TWO, THREE.TOUCH.DOLLY_PAN);
});

// ---- the gesture module against a recording camera port

type Call = [string, ...number[]];
function gestures(opts: { free?: () => boolean; soul?: (x: number, y: number) => boolean } = {}) {
  const docListeners = new Map<string, number>();
  const doc = Object.assign(new EventTarget(), { createElement: undefined });
  const add = doc.addEventListener.bind(doc), remove = doc.removeEventListener.bind(doc);
  doc.addEventListener = ((n: string, f: EventListener, o?: unknown) => { docListeners.set(n, (docListeners.get(n) ?? 0) + 1); add(n, f, o as never); }) as never;
  doc.removeEventListener = ((n: string, f: EventListener, o?: unknown) => { docListeners.set(n, Math.max(0, (docListeners.get(n) ?? 0) - 1)); remove(n, f, o as never); }) as never;
  const canvas = Object.assign(new EventTarget(), { ownerDocument: doc, getBoundingClientRect: () => VIEW }) as unknown as HTMLCanvasElement;
  const host = { ownerDocument: doc, getBoundingClientRect: () => VIEW } as unknown as HTMLElement;
  const calls: Call[] = [];let walking = false;let pending: (() => void) | null = null;
  const camera: TouchCamera = {
    setStick: (f, r) => { walking = !!(f || r); calls.push(['stick', f, r]); }, get walking() { return walking; },
    setTouchHeld: h => calls.push(['held', Number(h)]), touchLook: (dx, dy) => calls.push(['look', dx, dy]), touchLookEnd: () => calls.push(['lookEnd']),
    touchPinch: (x, y, r, s) => calls.push(['pinch', x, y, r, Number(s)]), touchRise: dy => calls.push(['rise', dy]), touchFly: (x, y) => calls.push(['fly', x, y]),
  };
  const touch = new WorldTouchFree(canvas, host, { camera, free: opts.free ?? (() => true), soulAt: opts.soul ?? (() => false) },
    { set: f => { pending = f; return 1; }, clear: () => { pending = null; } });
  // A later canvas listener stands for OrbitControls / the viewer's tap: it sees only what the module lets through.
  const passed: number[] = [];canvas.addEventListener('pointerdown', e => passed.push((e as PointerEvent).pointerId));
  let clock = 0;
  const ev = (type: string, id: number, x: number, y: number, t = clock) => Object.defineProperty(Object.assign(new Event(type, { cancelable: true }), { pointerType: 'touch', pointerId: id, clientX: x, clientY: y }), 'timeStamp', { value: t });
  const down = (id: number, x: number, y: number) => canvas.dispatchEvent(ev('pointerdown', id, x, y));
  const move = (id: number, x: number, y: number) => doc.dispatchEvent(ev('pointermove', id, x, y));
  const up = (id: number, x: number, y: number, type = 'pointerup') => doc.dispatchEvent(ev(type, id, x, y));
  return { touch, calls, passed, down, move, up, tick: (ms: number) => { clock += ms; }, fire: () => { const f = pending; pending = null; f?.(); }, docListeners, last: (k: string) => calls.filter(c => c[0] === k).at(-1) };
}

test('a lower-left touch spawns the stick, walks by deflection and stops on lift; nothing else sees it', () => {
  const g = gestures();
  g.down(1, 80, 700);assert.equal(g.touch.state.stick, true);assert.deepEqual(g.passed, [], 'no orbit, tap selection or hover for a stick touch');
  g.move(1, 80, 700 - STICK_RADIUS);const s = g.last('stick')!;assert.ok(Math.abs(s[1] - 1) < 1e-9 && Math.abs(s[2]) < 1e-9, 'thumb up: full forward');
  g.move(1, 80 + 20, 700 - STICK_RADIUS - 60);assert.ok((g.last('stick')![1]) > .8, 'past the radius the base follows the thumb');
  g.up(1, 100, 590);assert.deepEqual(g.last('stick'), ['stick', 0, 0]);assert.equal(g.touch.state.stick, false);
  assert.equal(g.touch.consumed(1), false, 'claims end with the touch');
});

test('A2: no stick on a Soul, outside the zone, or outside Free; tapping a Soul reaches the viewer', () => {
  let free = true;const g = gestures({ free: () => free, soul: (x, y) => x < 100 && y > 650 });
  g.down(1, 60, 700);assert.equal(g.touch.state.stick, false, 'on a Soul');assert.deepEqual(g.passed, [1]);
  assert.equal(g.touch.consumed(1), false, 'a tap on a Soul is the viewer\'s (opens its card)');g.up(1, 60, 700);
  g.down(2, 300, 700);assert.equal(g.touch.state.stick, false, 'outside the zone');g.up(2, 300, 700);
  free = false;g.down(3, 150, 700);assert.equal(g.touch.state.stick, false, 'Follow or Broadcast');assert.equal(g.touch.state.fingers, 0, 'not tracked at all');
  assert.ok(!g.calls.some(c => c[0] === 'stick'));
});

test('one finger elsewhere looks once past the tap slop; a stick touch and a look work together', () => {
  const g = gestures();
  g.down(1, 300, 300);g.move(1, 303, 300);assert.equal(g.last('look'), undefined, 'within the tap slop');
  g.move(1, 320, 290);assert.deepEqual(g.last('look'), ['look', 17, -10]);assert.equal(g.touch.consumed(1), true, 'a look is not a tap');
  g.up(1, 320, 290);assert.deepEqual(g.calls.at(-2), ['lookEnd']);
  g.down(2, 80, 700);g.down(3, 300, 300);g.move(2, 80, 640);g.move(3, 340, 300);
  assert.ok(g.last('stick')![1] > .9);assert.deepEqual(g.last('look'), ['look', 40, 0], 'twin thumbs');
});

test('pinch glides (ratio, fixed start point) and a two-finger vertical drag rises', () => {
  const g = gestures();
  g.down(1, 150, 300);g.down(2, 250, 300);assert.equal(g.touch.state.pair, 'pending');
  g.move(2, 280, 300);const p = g.last('pinch')!;assert.equal(p[4], 1, 'the first pinch step starts the anchor');assert.ok(Math.abs(p[3] - 130 / 100) < 1e-9);
  g.move(1, 120, 300);assert.ok(Math.abs(g.last('pinch')![3] - 160 / 130) < 1e-9);assert.equal(g.last('rise'), undefined);
  g.up(1, 120, 300);g.move(2, 400, 100);assert.equal(g.calls.filter(c => c[0] === 'pinch').length, 2, 'the gesture ends with either finger');g.up(2, 400, 100);
  g.down(3, 150, 400);g.down(4, 250, 400);g.move(3, 150, 380);g.move(4, 250, 380);
  assert.equal(g.touch.state.pair, 'rise');assert.ok(g.calls.filter(c => c[0] === 'rise').reduce((a, c) => a + c[1], 0) === -20, 'fingers up 20 px: rise');
  assert.equal(g.touch.consumed(3), true);assert.equal(g.touch.consumed(4), true);
});

test('double-tap flies (own detector); a slow second tap does not', () => {
  const g = gestures();
  g.down(1, 300, 300);g.tick(80);g.up(1, 300, 300);g.tick(150);
  g.down(2, 305, 304);assert.equal(g.touch.consumed(2), true, 'the second tap is not a second selection');g.tick(80);g.up(2, 305, 304);
  assert.deepEqual(g.last('fly'), ['fly', 305, 304]);
  g.tick(1000);g.down(3, 300, 300);g.tick(80);g.up(3, 300, 300);g.tick(400);g.down(4, 300, 300);g.tick(80);g.up(4, 300, 300);
  assert.equal(g.calls.filter(c => c[0] === 'fly').length, 1);
});

test('long-press locks auto-walk until the next touch, which only stops it', () => {
  const g = gestures();
  g.down(1, 80, 700);g.tick(LONG_PRESS_MS);g.fire();assert.equal(g.touch.state.armed, true);
  g.move(1, 80, 640);g.up(1, 80, 640);assert.equal(g.touch.state.locked, true);assert.ok(g.last('stick')![1] > .9, 'still walking');
  g.down(2, 300, 200);assert.deepEqual(g.last('stick'), ['stick', 0, 0]);assert.deepEqual(g.passed, [], 'the stopping tap does nothing else');
  assert.equal(g.touch.state.locked, false);g.up(2, 300, 200);
  g.down(3, 80, 700);g.move(3, 80, 600);g.up(3, 80, 600);assert.deepEqual(g.last('stick'), ['stick', 0, 0], 'without the long-press, lifting stops');
});

test('long-press is decided by input times: a busy page that runs the timer before the moves does not lock', () => {
  const g = gestures();
  g.down(1, 80, 700);g.tick(100);g.fire();  // the timer ran late in page time, but the thumb moved 100 ms after touching
  g.move(1, 80, 640);assert.equal(g.touch.state.armed, false);g.up(1, 80, 640);
  assert.equal(g.touch.state.locked, false);assert.deepEqual(g.last('stick'), ['stick', 0, 0]);
  g.down(2, 300, 300);g.move(2, 330, 300);assert.deepEqual(g.last('look'), ['look', 30, 0], 'the next finger looks (it is not eaten as a stop)');g.up(2, 330, 300);
  g.tick(1000);g.down(3, 80, 700);g.tick(LONG_PRESS_MS + 50);g.move(3, 80, 640);assert.equal(g.touch.state.armed, true, 'held still past 0.5 s by input time arms it even before the timer');
  g.up(3, 80, 640);assert.equal(g.touch.state.locked, true);
});

test('A5: at rest no document listeners or timers; they exist only while a finger is down', () => {
  const g = gestures();
  const live = () => [...g.docListeners.values()].reduce((a, b) => a + b, 0);
  assert.equal(live(), 0);
  g.down(1, 80, 700);assert.equal(live(), 3);g.up(1, 80, 700);assert.equal(live(), 0);
  g.down(2, 80, 700);g.up(2, 80, 700, 'pointercancel');assert.equal(live(), 0);assert.equal(g.touch.state.fingers, 0);
  assert.deepEqual(g.calls.filter(c => c[0] === 'held').map(c => c[1]), [1, 0, 1, 0]);
});

// ---- the camera side: every gesture goes through WorldRtsCamera's own paths

function rtsRig(mode: () => 'manual' | 'follow' | 'broadcast' = () => 'manual') {
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { defaultView: win, activeElement: null as unknown, hidden: false, querySelector: () => null });
  const canvas = Object.assign(new EventTarget(), { ownerDocument: doc, focus() { doc.activeElement = canvas; }, setPointerCapture() {}, hasPointerCapture() { return false; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) }) as unknown as HTMLCanvasElement;
  const scene = new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial()));scene.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 500);camera.position.set(0, 1.6, 10);
  const controls = Object.assign(new THREE.EventDispatcher(), { target: new THREE.Vector3(0, 1.6, 0), maxPolarAngle: Math.PI }) as unknown as OrbitControls;
  camera.lookAt(controls.target);camera.updateMatrixWorld();let takeOvers = 0;
  const rts = new WorldRtsCamera(canvas, camera, { controls: () => controls, mode, takeOver: () => { takeOvers++; }, scene: () => scene, pickRoots: () => [], extent: () => [-100, -100, 100, 100] });
  const frame = (dt = .05) => { rts.update(dt); camera.lookAt(controls.target); rts.afterControls(); camera.updateMatrixWorld(); };
  return { rts, camera, controls, frame, canvas, takeOvers: () => takeOvers };
}

test('the stick walks the eye and its pivot along the gaze at the WASD speed; lifting stops', () => {
  const f = rtsRig();try {
    const z0 = f.camera.position.z, pz0 = f.controls.target.z;f.rts.setStick(1, 0);for (let i = 0; i < 20; i++) f.frame(.05);
    assert.ok(Math.abs((z0 - f.camera.position.z) - 3) < 1e-6, '1 s at full deflection: 3 m, as W');
    assert.ok(Math.abs((pz0 - f.controls.target.z) - 3) < 1e-6, 'the pivot moves with it (same path as WASD)');
    assert.equal(f.takeOvers(), 1, 'one take-over for the walk');
    f.rts.setStick(0, 0);const z1 = f.camera.position.z;f.frame();assert.equal(f.camera.position.z, z1);
  } finally { f.rts.dispose(); }
});

test('two-finger rise is Q/E: up without tilting; held touch keeps one take-over; Follow ignores touch input', () => {
  const f = rtsRig();try {
    const d0 = f.camera.getWorldDirection(new THREE.Vector3()), y0 = f.camera.position.y;
    f.rts.setTouchHeld(true);f.rts.touchRise(-100);f.frame();f.frame();f.frame();
    assert.ok(Math.abs(f.camera.position.y - y0 - 100 * RISE_PER_PIXEL) < 1e-6, 'fingers up 100 px: up 2 m, at most 1 m a frame');
    assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).angleTo(d0) < 1e-6);
    f.rts.touchLook(30, 0);f.rts.touchLook(30, 0);f.frame();assert.equal(f.takeOvers(), 1, 'a held gesture takes over once');
    assert.ok(f.rts.headLook.yaw > .2, 'one-finger look turns the head as right-drag');
    const gaze = f.camera.getWorldDirection(new THREE.Vector3()), eye = f.camera.position.clone();f.rts.touchLookEnd();f.rts.setTouchHeld(false);
    for (let i = 0; i < 20; i++) f.frame();
    assert.equal(f.rts.headLook.yaw, 0, 'lifting keeps the look as the new pivot');
    assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).angleTo(gaze) < 1e-6 && f.camera.position.distanceTo(eye) < 1e-9, 'the view does not move');
  } finally { f.rts.dispose(); }
  let mode: 'manual' | 'follow' = 'follow';const g = rtsRig(() => mode);try {
    const p = g.camera.position.clone();g.rts.setStick(1, 0);g.rts.touchRise(-50);g.rts.touchLook(40, 0);g.frame();
    assert.ok(g.camera.position.distanceTo(p) < 1e-9 && g.rts.headLook.yaw === 0 && g.takeOvers() === 0, 'Follow keeps its own touch mapping');
    assert.equal(g.rts.walking, false, 'a stick held into Follow is dropped');
  } finally { g.rts.dispose(); }
});

test('pinch zooms like the wheel toward the point between the fingers; double-tap flies once even if the browser adds dblclick', () => {
  const f = rtsRig();try {
    const d0 = f.camera.position.distanceTo(f.controls.target);
    f.rts.touchPinch(500, 500, 2, true);for (let i = 0; i < 40; i++) f.frame(1 / 30);
    assert.ok(Math.abs(f.camera.position.distanceTo(f.controls.target) - d0 / 2) < .05, 'spreading 2x halves the distance');
    f.rts.touchFly(500, 700);let flights = 0;for (let i = 0; i < 40; i++) f.frame(1 / 30);
    const at = f.controls.target.clone();
    f.canvas.dispatchEvent(Object.assign(new Event('dblclick'), { clientX: 200, clientY: 900 }));for (let i = 0; i < 40; i++) f.frame(1 / 30);
    if (f.controls.target.distanceTo(at) > 1e-6) flights++;assert.equal(flights, 0, 'the browser dblclick after a double-tap does not fly again');
    assert.ok(at.y < .1, 'flew to the ground point under the second tap');
  } finally { f.rts.dispose(); }
});
