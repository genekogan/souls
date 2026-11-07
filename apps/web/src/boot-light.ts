// #1166: a phone's new world is drawn before the app's code has downloaded, so the first paint's boot light (index.html) is
// all that visitor sees of the arrival. This keeps it honest: its bar and disc follow the same bytes the app's light would.
import { assetBytes } from './asset-bytes.ts';

const DISC_RADIUS = 146;   // arrival-light.ts; repeated so the first chunk doesn't carry the shader

export function followBootLight(): void {
  const boot = document.getElementById('boot-arrival');
  const disc = boot?.querySelector<HTMLElement>('.arrival-disc'), bar = boot?.querySelector('progress'), label = boot?.querySelector('.viewer-arrival-progress span');
  if (!boot || !disc || !bar || !label) return;
  let peak = 0;
  const off = assetBytes.subscribe(() => {
    if (!boot.isConnected || boot.dataset.fill) return off();
    const { loaded, total, known } = assetBytes.snapshot();
    if (!known || !total) return;
    const next = Math.max(peak, Math.min(1, loaded / total));
    if (next - peak < 0.005 && peak) return;
    peak = next; bar.value = Math.round(peak * 1000); label.textContent = `${Math.round(peak * 100)}%`;
    const corners = Math.hypot(innerWidth, innerHeight) / 2;
    disc.style.setProperty('--s', String((DISC_RADIUS + (corners - DISC_RADIUS) * peak) / DISC_RADIUS));
  });
}
