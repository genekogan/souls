/** #893 phone first-run hints: on a touch screen, the first touch of a page (once per device) shows three glyphs (thumb
 * stick, one-finger drag, pinch) that fade on the first drag or second finger, or after HINT_MS. The device remembers it
 * (localStorage HINT_KEY); with no storage the hint shows once per page. `?shot` and automation (`navigator.webdriver`)
 * never show it; `?hints=1` wins over `navigator.webdriver` only, so a recorded proof can show it. The glyphs are inline
 * SVG; once faded the overlay unmounts and its window listeners are gone. */
import { useEffect, useState } from 'react';
import { HINT_DRAG_PX, HINT_FADE_MS, HINT_KEY, HINT_MS, hintsAllowed } from './hints-policy.ts';

const remembered = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } };
const remember = () => { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* the hint shows once per page */ } };

export function TouchHints() {
  const [phase, setPhase] = useState<'waiting' | 'shown' | 'fading' | 'done'>('waiting');
  useEffect(() => {
    let coarse = false; try { coarse = matchMedia('(pointer: coarse)').matches; } catch { /* no media queries: no hint */ }
    if (!hintsAllowed({ search: location.search, webdriver: navigator.webdriver === true, coarse, seen: remembered() })) { setPhase('done'); return; }
    let first: { id: number; x: number; y: number } | null = null, timer = 0, gone = 0;
    const opts = { capture: true, passive: true } as const;
    const stop = () => { removeEventListener('pointerdown', down, opts); removeEventListener('pointermove', move, opts); clearTimeout(timer); };
    const fade = () => { stop(); setPhase('fading'); gone = window.setTimeout(() => setPhase('done'), HINT_FADE_MS); };
    function down(e: PointerEvent) {
      if (e.pointerType !== 'touch') return;
      if (first) { if (e.pointerId !== first.id) fade(); return; }  // a second finger: a pinch or two-finger rise
      first = { id: e.pointerId, x: e.clientX, y: e.clientY }; remember(); setPhase('shown');
      addEventListener('pointermove', move, opts); timer = window.setTimeout(fade, HINT_MS);
    }
    function move(e: PointerEvent) { if (first && e.pointerType === 'touch' && Math.hypot(e.clientX - first.x, e.clientY - first.y) > HINT_DRAG_PX) fade(); }
    addEventListener('pointerdown', down, opts);
    return () => { stop(); clearTimeout(gone); };
  }, []);
  if (phase === 'waiting' || phase === 'done') return null;
  return <div className="touch-hints" data-phase={phase} role="note" aria-label="Touch controls">
    <figure><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 4"/><circle cx="24" cy="24" r="8" fill="currentColor"/><path d="M24 3v5M24 40v5M3 24h5M40 24h5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg><figcaption>Thumb, lower left: walk</figcaption></figure>
    <figure><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="17" cy="30" r="6" fill="currentColor"/><path d="M24 30h17M36 25l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 30h3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".5"/></svg><figcaption>Drag: look around</figcaption></figure>
    <figure><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="15" cy="33" r="5.5" fill="currentColor"/><circle cx="33" cy="15" r="5.5" fill="currentColor"/><path d="M11 37l-6 6M37 11l6-6M5 37v6h6M37 5h6v6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg><figcaption>Pinch: glide closer</figcaption></figure>
  </div>;
}
