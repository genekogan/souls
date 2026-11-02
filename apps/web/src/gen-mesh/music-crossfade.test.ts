// Exercise the real playlist coordinator and FilePlayer together; only browser media and the unit-test clock are fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalMark } from '../arrival-marks.ts';
import { musicLog, musicState, syncMusic } from './music.ts';

test('automatic multi-performance crossfades advance playlist state, prefetch the following piece, and resume that performance', async t => {
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  const elements: Array<{ src: string; currentTime: number; paused: boolean }> = [];
  const globals = ['window', 'document', 'AudioContext'] as const;
  const original = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  t.after(() => {
    syncMusic({ on: false, volume: 0.3, unlocked: true });
    globals.forEach((name, i) => {
      if (original[i]) Object.defineProperty(globalThis, name, original[i]!);
      else Reflect.deleteProperty(globalThis, name);
    });
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { requestIdleCallback: (fn: () => void) => fn() } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(name: string) {
      assert.equal(name, 'audio');
      const el = { src: '', currentTime: 0, paused: true, duration: 240, readyState: 1,
        crossOrigin: '', preload: '', load() {}, addEventListener() {}, removeEventListener() {},
        removeAttribute() { this.src = ''; }, pause() { this.paused = true; },
        play() { this.paused = false; return Promise.resolve(); },
      };
      elements.push(el); return el;
    },
  } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class {
    currentTime = 0; state = 'running'; destination = {};
    createGain() { return { gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    createMediaElementSource() { return { connect() {}, disconnect() {} }; }
    resume() { return Promise.resolve(); }
  } });
  arrivalMark('first-live-frame');
  const on = { on: true, volume: 0.3, unlocked: true };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 100 && musicState().source !== 'file'; i++) { syncMusic(on); await flush(); }
  const first = musicState();
  assert.equal(first.source, 'file'); assert.equal(first.file.performances, 3);
  const next = (first.index + 1) % first.playlist.length;
  const following = (next + 1) % first.playlist.length;
  const startTime = now;
  now = startTime + 220_000; syncMusic(on);
  assert.equal(elements.length, 2, 'the successor is prefetched');
  const nextUrl = elements[1].src;
  now = startTime + 237_000; syncMusic(on); await flush();
  const cross = musicState();
  assert.equal(cross.playing, first.playlist[next], 'outer playlist adopts the automatically started deck');
  assert.equal(cross.index, next); assert.equal(cross.piece, cross.playing);
  assert.equal(cross.endsInS, 240, 'outer deadline follows the new deck');
  assert.equal(cross.source, 'file'); assert.equal(cross.toneCtx, 'none');
  assert.equal(elements.length, 2, 'crossfade reuses the selected prefetch');
  assert.equal(elements[1].src, nextUrl); assert.equal(elements[1].paused, false);
  assert.equal(elements[0].paused, false, 'the previous piece still fades');
  const crossEvent = musicLog().filter(e => e.ev === 'start').at(-1)!;
  assert.equal(crossEvent.reason, 'crossfade'); assert.equal(crossEvent.piece, cross.playing);
  now += 3100; syncMusic(on);
  assert.equal(elements[0].paused, true, 'the previous deck retires after its original end');
  assert.equal(musicState().playing, cross.playing);
  now += 1000; elements[1].currentTime = 4.1;
  syncMusic({ ...on, on: false });
  const stopped = musicState();
  assert.equal(stopped.playing, null); assert.equal(stopped.paused?.index, next);
  assert.equal(stopped.paused?.perf, cross.file.performance); assert.equal(stopped.paused?.positionS, 4.1);
  syncMusic(on); await flush();
  const resumed = musicState();
  assert.equal(resumed.playing, cross.playing); assert.equal(resumed.file.performance, cross.file.performance);
  assert.equal(elements[2].src, nextUrl); assert.equal(elements[2].currentTime, 4.1);
  assert.equal(resumed.endsInS, 236);
  now += 216_000; syncMusic(on);
  assert.equal(musicLog().filter(e => e.ev === 'load' && e.reason === 'prefetch file').at(-1)?.piece, first.playlist[following], 'prefetch advances past the new current piece');
  now += 17_000; syncMusic(on); await flush();
  assert.equal(musicState().index, following, 'a second automatic crossfade advances again');
  assert.equal(musicState().playing, first.playlist[following]);
  assert.equal(musicState().toneCtx, 'none');
});
