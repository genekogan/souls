// #1166: a phone's new world is drawn before the app's code has downloaded, so the first paint's boot light (index.html) is
// all that visitor sees of the arrival. This keeps it honest: its bar and disc follow the same bytes the app's light would.
import { assetBytes } from './asset-bytes.ts';

const DISC_RADIUS = 146;   // arrival-light.ts; repeated so the first chunk doesn't carry the shader

export function followBootLight(): void {
  let peak = 0;
  // This entry can run before the body's script has made the boot light, so it is looked up at each change.
  const off = assetBytes.subscribe(() => {
    const boot = document.getElementById('boot-arrival');
    if (boot?.dataset.fill) return off();
    const disc = boot?.querySelector<HTMLElement>('.arrival-disc'), bar = boot?.querySelector('progress'), label = boot?.querySelector('.viewer-arrival-progress span');
    const { loaded, total, known } = assetBytes.snapshot();
    if (!disc || !bar || !label || !known || !total) return;
    const next = Math.max(peak, Math.min(1, loaded / total));
    if (next - peak < 0.005 && peak) return;
    peak = next; bar.value = Math.round(peak * 1000); label.textContent = `${Math.round(peak * 100)}%`;
    const corners = Math.hypot(innerWidth, innerHeight) / 2;
    disc.style.setProperty('--s', String((DISC_RADIUS + (corners - DISC_RADIUS) * peak) / DISC_RADIUS));
  });
}
