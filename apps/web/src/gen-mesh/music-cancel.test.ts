// Exercise cancellation through the real coordinator and FilePlayer; defer only browser metadata/play completion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalMark } from '../arrival-marks.ts';
import { musicLog, musicState, syncMusic } from './music.ts';

test('off/focus during startup and off during a deferred crossfade cannot restart files or trigger fallback', async t => {
  let now = 1000, ready = false, deferPlay = false;
  t.mock.method(performance, 'now', () => now);
  const elements: Array<{ src: string; paused: boolean; plays: number; metadata(): void; finish(): void }> = [];
  const names = ['window', 'document', 'AudioContext'] as const, original = names.map(n => Object.getOwnPropertyDescriptor(globalThis, n));
  const on = { on: true, volume: 0.3, unlocked: true }, flush = () => new Promise(resolve => setImmediate(resolve));
  t.after(() => { syncMusic({ ...on, on: false }); names.forEach((n, i) => { if (original[i]) Object.defineProperty(globalThis, n, original[i]!); else Reflect.deleteProperty(globalThis, n); }); });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { requestIdleCallback: (fn: () => void) => fn() } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement(name: string) {
    assert.equal(name, 'audio'); const listeners = new Map<string, Set<() => void>>(); let complete = () => {}; const wait = deferPlay;
    const el = { src: '', currentTime: 0, paused: true, plays: 0, duration: 240, readyState: ready ? 1 : 0, crossOrigin: '', preload: '', load() {},
      addEventListener(n: string, f: () => void) { (listeners.get(n) ?? listeners.set(n, new Set()).get(n)!).add(f); }, removeEventListener(n: string, f: () => void) { listeners.get(n)?.delete(f); },
      removeAttribute() { this.src = ''; }, pause() { this.paused = true; },
      play() { this.plays++; this.paused = false; return wait ? new Promise<void>(ok => { complete = () => { this.paused = false; ok(); }; }) : Promise.resolve(); },
      metadata() { this.readyState = 1; for (const f of [...(listeners.get('loadedmetadata') ?? [])]) f(); }, finish() { complete(); },
    }; elements.push(el); return el;
  } } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class {
    currentTime = 0; state = 'running'; destination = {};
    createGain() { return { gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    createMediaElementSource() { return { connect() {}, disconnect() {} }; } resume() { return Promise.resolve(); }
  } });
  arrivalMark('first-live-frame');
  const starting = async () => { const count = elements.length; for (let i = 0; i < 100 && elements.length === count; i++) { syncMusic(on); await flush(); } assert.equal(elements.length, count + 1); assert.equal(musicState().starting, true); return elements.at(-1)!; };
  const stopped = async (el: typeof elements[number], starts: number) => {
    el.metadata(); el.finish(); await flush(); await flush();
    assert.equal(el.paused, true); assert.equal(el.src, '');
    assert.equal(musicState().playing, null); assert.equal(musicState().starting, false);
    assert.equal(musicState().file.failures, 0); assert.equal(musicState().file.off, false); assert.equal(musicState().toneCtx, 'none');
    assert.equal(musicLog().filter(e => e.ev === 'start').length, starts); assert.equal(musicLog().some(e => e.ev === 'error'), false);
  };
  let el = await starting(); syncMusic({ ...on, on: false }); await stopped(el, 0); assert.equal(el.plays, 0);
  el = await starting(); syncMusic({ ...on, audible: false }); await stopped(el, 0); assert.equal(el.plays, 0);
  ready = true; deferPlay = true;
  el = await starting(); assert.equal(el.plays, 1); syncMusic({ ...on, on: false }); await stopped(el, 0);
  deferPlay = false; syncMusic(on); await flush(); assert.equal(musicState().source, 'file');
  const starts = musicLog().filter(e => e.ev === 'start').length; deferPlay = true;
  now += 220_000; syncMusic(on); const successor = elements.at(-1)!;
  now += 17_000; syncMusic(on); await flush(); assert.equal(successor.plays, 1);
  syncMusic({ ...on, on: false }); await stopped(successor, starts);
  assert.ok(elements.every(e => e.paused && !e.src));
});
