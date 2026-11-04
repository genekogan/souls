/** The audio CDN does not admit loopback origins. Use the existing synthesised playlist there unless a local
 * file origin was explicitly supplied for proofs; public origins keep the default CDN player. */
export function useFileMusic(hostname: string, search = ''): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, ''), ipv4 = host.split('.');
  const loopback = host === 'localhost' || host === '[::1]' || host === '::1' ||
    ipv4.length === 4 && ipv4[0] === '127' && ipv4.every(n => /^\d{1,3}$/.test(n) && Number(n) <= 255);
  if (!loopback) return true;
  const audio = new URLSearchParams(search).get('musicAudio');
  if (!audio) return false;
  try { const url = new URL(audio); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; }
}
