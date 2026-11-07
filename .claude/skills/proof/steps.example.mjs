// Example --steps module for record.mjs. Copy it under .e2e/ (gitignored), not into the repo.
// Drive the changed journey with real input at real speed; do not add sleeps to pad the clip.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// A take of an owner's card needs an agent listening from before the page opens to after the take ends. Without one the
// Soul reads as disconnected, the card shows the Reconnect box with the local URL and the Soul's id, and the recorder
// fails the take. SOUL_DIR is the Soul's CLI folder. `listen` ends when the owner writes, so it is started again.
// This runs when the recorder loads the module, before the page opens. Leave SOUL_DIR unset when no owner's card is shown.
const { SOUL_DIR, EDEN = 'tools/world-launcher/soul/eden.mjs' } = process.env;
if (SOUL_DIR) {
  const eden = resolve(EDEN);
  let held = null, ended = false;
  const hold = () => {
    if (ended) return;
    held = spawn(process.execPath, [eden, 'listen'], { cwd: SOUL_DIR, stdio: 'ignore' });
    held.unref();                                           // or the recorder would never reach its own exit
    held.once('exit', () => setTimeout(hold, 1000).unref());
  };
  hold();
  process.once('exit', () => { ended = true; held?.kill(); });
}

export default async function steps(page, { viewport, mark }) {
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30_000 });
  mark('world visible');
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw Error('no canvas box');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  if (viewport === 'phone') {
    await page.touchscreen.tap(cx, cy);                     // a real tap on the scene
  } else {
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.move(cx + 160, cy, { steps: 20 }); await page.mouse.up();   // orbit
    await page.mouse.click(cx, cy);
  }
  mark('interacted');
  await page.waitForTimeout(1500);                          // let the result render on camera
}
