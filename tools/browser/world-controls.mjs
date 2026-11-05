/** Real-input helpers shared by browser proofs; modes are explicit, never inferred from a toggle's old label. */
export async function setCameraMode(page, mode) {
  if (!['broadcast', 'manual'].includes(mode)) throw Error(`Unsupported camera mode: ${mode}`);
  await page.getByRole('button', { name: 'Camera modes and help', exact: true }).click();
  await page.getByRole('dialog', { name: 'Camera modes and help', exact: true })
    .getByRole('button', { name: mode === 'broadcast' ? 'Broadcast' : 'Free', exact: true }).click();
}
export async function openAudio(page) {
  const trigger = page.locator('.navbar-audio .navbar-menu-trigger');
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  return page.getByRole('dialog', { name: 'Audio', exact: true });
}
export async function setAudioSwitch(page, label, on) {
  const panel = await openAudio(page);
  const control = panel.getByRole('switch', { name: new RegExp(`^${label} (On|Off)$`) });
  if ((await control.getAttribute('aria-checked') === 'true') !== on) await control.click();
  await page.keyboard.press('Escape');
}
export const setEffects = (page, on) => setAudioSwitch(page, 'Sound effects', on);
export const setMusic = (page, on) => setAudioSwitch(page, 'Music', on);
