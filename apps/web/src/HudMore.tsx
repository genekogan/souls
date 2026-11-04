import { useEffect, useReducer, useRef, useState } from 'react';
import { requestFeedback } from './feedback-request.ts';

// Lane P6 (2026-10-19, Gene): "a light pass to cut button clutter on small screens. Hide secondary controls behind one
// menu and keep watch mode clean. Don't redesign." On small screens only, the world page's secondary controls (Sign in,
// Claim/God mode card, Constitution chip, Feedback, Since your last visit, Sound, Music) are hidden with one class on
// <html> and offered from one "More" button in the HUD; each menu item clicks the existing (hidden) control, so every
// component and its behaviour stay as they are. Desktop renders no button and no class: unchanged.

export const SMALL_SCREEN = '(max-width: 700px), (pointer: coarse)';
export const TIDY_CLASS = 'phone-tidy';

/** The secondary controls the menu offers, in menu order. The selectors are the existing controls' own. A control is
 * offered only while it is not on screen (hidden on small screens, folded into a closed menu, or moved off the one-line
 * top bar by hud-fit.ts), so nothing is offered twice; `fallback` stands in when the page has no such control. */
export const MORE_TARGETS: readonly { key: string; selector: string; label?: string; fallback?: () => void }[] = [
  { key: 'sign-in', selector: '.account-sign-in', label: 'Sign in' },
  { key: 'claim', selector: '[data-god-panel-toggle]' },
  // U3: only the world's god has a God button; on a narrow phone bar it moves here
  { key: 'god', selector: '[data-god-open]', label: 'God' },
  // U2: in the account menu when signed in; U3: signed out there is no desktop menu for it, so the phone's More asks directly
  { key: 'feedback', selector: '[data-feedback-open]', label: 'Feedback', fallback: requestFeedback },
  { key: 'visitor', selector: '.visitor-controls button' },  // Since your last visit, when VisitorWelcome.RETURN_HISTORY is on
  // The wrapping navbar keeps these visible; offer their current controls only when actually hidden.
  { key: 'fullscreen', selector: '.camera-menu .fullscreen-toggle' },
  { key: 'follow', selector: '.hud-camera-slot .camera-main' },
  { key: 'camera', selector: '.camera-menu .navbar-menu-trigger', label: 'Camera modes and help' },
  { key: 'souls', selector: '.hud-explore-group .my-souls > button, .souls-menu .navbar-menu-trigger' },
  { key: 'sound', selector: '.navbar-audio .navbar-menu-trigger' },
];

type Target = Pick<HTMLElement, 'click' | 'textContent' | 'getAttribute' | 'hidden'> & { checkVisibility?: (o?: { visibilityProperty?: boolean }) => boolean; getClientRects?: () => { length: number } };
export type MoreItem = { key: string; label: string; target: Pick<Target, 'click'> };

/** On screen now: not display:none, not inside a closed <details> (whose contents still have boxes in Chrome) and not
 * visibility:hidden. Test doubles without layout count as off screen. */
const shown = (t: Target) => t.checkVisibility ? t.checkVisibility({ visibilityProperty: true }) : !!t.getClientRects && t.getClientRects().length > 0;

/** The menu's items: each existing control that is on the page but not on screen (a hidden Music button is skipped). */
export function collectMoreItems(root: { querySelectorAll(selector: string): ArrayLike<Target> }): MoreItem[] {
  const items: MoreItem[] = [];
  for (const t of MORE_TARGETS) {
    const found = Array.from(root.querySelectorAll(t.selector));
    found.forEach((target, i) => {
      if (target.hidden || shown(target)) return;
      const label = t.label ?? target.getAttribute('aria-label') ?? (target.textContent ?? '').replace(/^\s*✦\s*/, '').trim();
      if (label) items.push({ key: i ? `${t.key}-${i}` : t.key, label, target });
    });
    if (!found.length && t.fallback && t.label) items.push({ key: t.key, label: t.label, target: { click: t.fallback } });
  }
  return items;
}

export type MoreEvent = 'toggle' | 'close';
/** Open/close: the button toggles; Escape, a tap outside and choosing an item close. */
export const moreMenu = (open: boolean, e: MoreEvent) => (e === 'toggle' ? !open : false);

function querySmall() { try { return typeof matchMedia === 'function' && matchMedia(SMALL_SCREEN).matches; } catch { return false; } }

export function useSmallScreen() {
  const [small, setSmall] = useState(querySmall);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(SMALL_SCREEN), f = () => setSmall(m.matches);
    f(); m.addEventListener?.('change', f);
    return () => m.removeEventListener?.('change', f);
  }, []);
  return small;
}

const DOTS = <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><circle cx="15.5" cy="10" r="1.6" fill="currentColor"/></svg>;

/** The HUD's "More" button and menu; renders nothing on desktop. `small`/`initialOpen` are for tests. */
export function HudMore({ small: forced, initialOpen = false }: { small?: boolean; initialOpen?: boolean }) {
  const detected = useSmallScreen(), small = forced ?? detected;
  const [open, send] = useReducer(moreMenu, initialOpen);
  const [items, setItems] = useState<MoreItem[]>([]);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!small) return;
    const html = document.documentElement; html.classList.add(TIDY_CLASS);
    return () => html.classList.remove(TIDY_CLASS);
  }, [small]);
  useEffect(() => {
    if (!open) return;
    setItems(collectMoreItems(document));
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) send('close'); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { send('close'); root.current?.querySelector<HTMLElement>('.hud-more')?.focus(); } };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!small) return null;
  return (
    <span ref={root} className="hud-more-wrap">
      <button type="button" className="hud-camera hud-more" aria-label="More" title="More" aria-haspopup="menu" aria-expanded={open} onClick={() => send('toggle')}>{DOTS}</button>
      {open && <div className="hud-more-menu" role="menu" aria-label="More">
        {items.map((it) => <button key={it.key} type="button" role="menuitem" data-more={it.key} onClick={() => { send('close'); it.target.click(); }}>{it.label}</button>)}
        {!items.length && <span className="hud-more-empty">Nothing else here yet</span>}
      </div>}
    </span>
  );
}
