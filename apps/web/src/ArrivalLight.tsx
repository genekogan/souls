import { useEffect, useRef } from 'react';
import { DISSOLVE_MS, FRAME_MS, TEXT_MARGIN, easeFraction, lightRadius, lightScale, startLight, whiteAmount, type Light } from './arrival-light.ts';

/** #1166: black, with the world's name and a bar on a white light that grows with the download until the screen is
 *  white, then dissolves into the world. `done` means the world is drawn; the dissolve waits for it and for full white.
 *  `instant` (a ?shot page) never dissolves, so a picture is never taken through it. */
export function ArrivalLight({ title, progress, done, card, instant, onGone }: { title: string; progress: number | null; done: boolean; card: boolean; instant: boolean; onGone: () => void }) {
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), disc = useRef<HTMLDivElement>(null), text = useRef<HTMLDivElement>(null);
  const live = useRef({ progress, done, onGone }); live.current = { progress, done, onGone };
  useEffect(() => {
    const frame = root.current, picture = canvas.current, plain = disc.current, words = text.current;
    if (!frame || !picture || !plain || !words) return;
    if (instant) { if (live.current.done) live.current.onGone(); return; }
    let light: Light | null = null, raf = 0, timer = 0, fraction = 0, last = 0, drawn = false;
    light = startLight(picture, () => { light = null; picture.hidden = true; plain.hidden = false; });
    if (!light) picture.hidden = true;
    const still = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
    const first = performance.now();
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      if (now - last < FRAME_MS) return;
      const seconds = last ? (now - last) / 1000 : 0; last = now;
      const { progress, done } = live.current;
      fraction = easeFraction(fraction, progress ?? 0, seconds, done);
      const box = words.getBoundingClientRect(), w = frame.clientWidth, h = frame.clientHeight;
      const radius = lightRadius(fraction, w, h, Math.hypot(box.width, box.height) / 2 + TEXT_MARGIN);
      if (light) { light.draw(lightScale(radius, w, h), whiteAmount(fraction), still ? 0 : (now - first) / 1000); if (!drawn) { drawn = true; plain.hidden = true; } }
      else plain.style.setProperty('--r', `${radius}px`);
      if (fraction < 1 || !done) return;
      // white: nothing moves from here, so the light stops now and the page holds the white while it dissolves
      cancelAnimationFrame(raf); raf = 0; light?.stop(); light = null;
      frame.dataset.white = 'true'; frame.dataset.dissolving = 'true';
      timer = window.setTimeout(() => live.current.onGone(), DISSOLVE_MS);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); light?.stop(); };
  }, [instant]);
  useEffect(() => { if (instant && done) onGone(); }, [instant, done, onGone]);
  return <div ref={root} className="viewer-arrival" data-done={!card} role="status" aria-live="polite">
    <canvas ref={canvas} aria-hidden="true" />
    <div ref={disc} className="arrival-disc" aria-hidden="true" />
    <div ref={text} className="arrival-text">
      <p className="viewer-arrival-title">{title}</p>
      <div className="viewer-arrival-progress"><progress aria-label="World loading progress" max={1000} value={Math.round((progress ?? 0) * 1000)} /><span>{progress === null ? '' : `${Math.round(progress * 100)}%`}</span></div>
    </div>
  </div>;
}
