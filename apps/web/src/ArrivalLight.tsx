import { useEffect, useLayoutEffect, useRef } from 'react';
import { DISC_RADIUS, DISSOLVE_MS, FILL_MS, FRAME_MS, TEXT_MARGIN, easeFraction, lightRadius, lightScale, startLight, type Light } from './arrival-light.ts';

/** #1166: black, with the world's name and a bar on a white light that grows with the download until the screen is
 *  white, then dissolves into the world. The last of the light is a compositor transition on the disc, started the moment
 *  the bar is full: the world's preparation can hold the main thread for seconds then, and frames would stop with it.
 *  `done` means the world is drawn; the dissolve needs that and full white. `instant` (a ?shot page) never dissolves, so a
 *  picture is never taken through it. */
export function ArrivalLight({ title, progress, done, card, instant, onGone }: { title: string; progress: number | null; done: boolean; card: boolean; instant: boolean; onGone: () => void }) {
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), disc = useRef<HTMLDivElement>(null), text = useRef<HTMLDivElement>(null);
  const live = useRef({ progress, done, onGone }); live.current = { progress, done, onGone };
  const run = useRef<{ fill(): void; settle(): void } | null>(null);
  useEffect(() => {
    const frame = root.current, picture = canvas.current, plain = disc.current, words = text.current;
    if (!frame || !picture || !plain || !words || instant) return;
    let light: Light | null = null, raf = 0, fillTimer = 0, goneTimer = 0, fraction = 0, last = 0, drawn = false, filling = false, white = false, dissolving = false;
    light = startLight(picture, () => { light = null; picture.hidden = true; plain.hidden = false; });
    if (!light) picture.hidden = true;
    const still = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
    const first = performance.now();
    const size = () => { const box = words.getBoundingClientRect(); return { w: frame.clientWidth, h: frame.clientHeight, half: Math.hypot(box.width, box.height) / 2 + TEXT_MARGIN }; };
    const stopLight = () => { cancelAnimationFrame(raf); raf = 0; light?.stop(); light = null; };
    const settle = () => {
      if (!white || dissolving || !live.current.done) return;
      dissolving = true; frame.dataset.dissolving = 'true';
      goneTimer = window.setTimeout(() => live.current.onGone(), DISSOLVE_MS);
    };
    const fill = () => {
      if (filling) return; filling = true;
      const { w, h, half } = size();
      // from where the light is now, on the compositor: nothing after this needs the main thread to reach white
      plain.hidden = false; plain.style.setProperty('--s', String(lightRadius(fraction, w, h, half) / DISC_RADIUS)); void plain.offsetWidth;
      frame.dataset.fill = 'true'; plain.style.setProperty('--s', String(lightRadius(1, w, h, half) / DISC_RADIUS));
      fillTimer = window.setTimeout(() => { stopLight(); white = true; frame.dataset.white = 'true'; settle(); }, FILL_MS);
    };
    run.current = { fill, settle };
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      if (now - last < FRAME_MS) return;
      const seconds = last ? (now - last) / 1000 : 0; last = now;
      fraction = easeFraction(fraction, live.current.progress ?? 0, seconds);
      const { w, h, half } = size(), radius = lightRadius(fraction, w, h, half);
      if (light) { light.draw(lightScale(radius, w, h), still ? 0 : (now - first) / 1000); if (!drawn) { drawn = true; if (!filling) plain.hidden = true; } }
      else plain.style.setProperty('--s', String(radius / DISC_RADIUS));
    };
    raf = requestAnimationFrame(step);
    if ((live.current.progress ?? 0) >= 1 || live.current.done) fill();
    return () => { run.current = null; stopLight(); clearTimeout(fillTimer); clearTimeout(goneTimer); };
  }, [instant]);
  // from the props, not a frame: this commit may be the last the main thread makes for a while
  useLayoutEffect(() => { if ((progress ?? 0) >= 1 || done) run.current?.fill(); if (done) run.current?.settle(); }, [progress, done]);
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
