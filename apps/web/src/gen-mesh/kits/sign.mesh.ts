// Signs, boards, frames and screens (defs tagged `sign-text`): the kit/2 body plus text or media
// faces listed in make.args.faces. Text: entity state `text` (lines split by \n), else the def's
// `sign` component lines; a face with `line: n` shows only line n (signpost arrows). Media faces
// show state `media` (one web link or same-site path per slot: image or looping video) or a small painting. Owner: L4.
import * as THREE from 'three';
import { kitArgs } from '@sim/generators';
import { buildKit } from '../kit.mesh.ts';
import { registerMesh } from '../registry.ts';
import { bindMotionModel } from '../motion.ts';
import { apiPath } from '../../world-path.ts';
import { artOf, brokenLinkLines, coverWhenReady, imageBroken, imageFailed, imageLoaded, videoTexture, whenImageFails } from '../art-media.ts';
import { frameMediaKind, gameSquare, gameStatus, pinSlot, signupSlot, signupPageStart, pollSlot, pollOptions, posterSlot, posterList, posterPaper, wantedSlot, wantedList, POSTER_W, POSTER_H, type WantedRec } from '@sim/world-compiler';
import { posterMesh, posterAgeDays } from '../../../../../mars/viewer/app/engine-view/poster-sheet.ts';

type Face = { at: [number, number, number]; w: number; h: number; yaw?: number; pitch?: number; bg?: string; ink?: string; font?: string; line?: number; media?: boolean; slot?: number; fadeDays?: number };
const texCache = new Map<string, THREE.Texture>();
const loader = typeof document !== 'undefined' ? new THREE.TextureLoader() : null;

/** What a media line loads: an http(s) URL as is, this world's `/assets/<sha>` under its world path, other same-site
 *  paths (e.g. `/w/<world>/art/<sha>.mp4`) as is; null for anything the shared frame-media rule refuses. */
export function signMediaPath(media: unknown): string | null {
  if (!frameMediaKind(media)) return null;
  const m = media as string;
  return /^\/assets\//.test(m) ? apiPath(m) : m;
}


function textTexture(lines: string[], f: Face): THREE.Texture {
  const key = JSON.stringify([lines, f.w, f.h, f.bg, f.ink, f.font]);
  const hit = texCache.get(key); if (hit) return hit;
  const px = 256, cw = Math.max(64, Math.round(px * Math.min(4, f.w / Math.max(f.h, 0.05)))), ch = px;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d')!;
  g.fillStyle = f.bg ?? '#efe2c0'; g.fillRect(0, 0, cw, ch);
  const ls = lines.length ? lines : [''];
  let size = Math.floor((ch * 0.8) / ls.length);
  const font = (s: number) => `${f.font ?? '600'} ${s}px Georgia, 'Iowan Old Style', serif`;
  g.font = font(size); while (size > 10 && Math.max(...ls.map((l) => g.measureText(l).width)) > cw * 0.9) { size -= 2; g.font = font(size); }
  g.fillStyle = f.ink ?? '#3a2a22'; g.textAlign = 'center'; g.textBaseline = 'middle';
  ls.forEach((l, i) => g.fillText(l, cw / 2, ch / 2 + (i - (ls.length - 1) / 2) * size * 1.1));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache.set(key, t); return t;
}
/** Soul Actions entry 19: a pinboard's notes (one per line, "words — Name") as signed paper cards pinned to cork, each in
 *  its slot (pinSlot, the place the hand went). Seeded by the words, so every viewer sees the same tilt and paper. */
export function pinboardTexture(lines: string[], f: Face): THREE.Texture {
  const key = JSON.stringify(['pinboard', lines, f.w, f.h, f.bg]);
  const hit = texCache.get(key); if (hit) return hit;
  const cw = 1024, ch = Math.round(cw * f.h / f.w), px = cw / f.w, c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d')!; let seed = 7; const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345 | 0) >>> 0) / 4294967296;
  g.fillStyle = f.bg ?? '#b88a5a'; g.fillRect(0, 0, cw, ch);
  for (let i = 0; i < 2600; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(70,40,15,0.22)' : 'rgba(235,200,150,0.18)'; g.fillRect(rnd() * cw, rnd() * ch, 2 + rnd() * 3, 2 + rnd() * 3); }
  const hash = (t: string) => { let h = 2166136261; for (const ch of t) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
  const papers = ['#fbf6e4', '#fdf0a6', '#d9ecf7', '#f8dbe0', '#e3f2d6'];
  lines.slice(0, 6).forEach((line, i) => {
    if (!line.trim()) return;
    const cut = line.lastIndexOf(' — '), words = cut >= 0 ? line.slice(0, cut) : line, who = cut >= 0 ? line.slice(cut + 3) : '', r = hash(line);
    const [sx, sy] = pinSlot(i), x = (sx / f.w + 0.5) * cw, y = (0.5 - sy / f.h) * ch, w = 0.33 * px, h = 0.31 * px;
    g.save(); g.translate(x, y); g.rotate((r - 0.5) * 0.12);
    g.fillStyle = 'rgba(30,15,5,0.35)'; g.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
    g.fillStyle = papers[Math.floor(r * papers.length)]; g.fillRect(-w / 2, -h / 2, w, h);
    // the words, wrapped to the card at the largest size that fits four lines; the author's name signs the bottom
    g.fillStyle = '#26221e'; g.textAlign = 'left'; g.textBaseline = 'top';
    let size = 34, wrapped: string[] = [];
    for (; size >= 16; size -= 2) {
      g.font = `500 ${size}px 'Comic Sans MS', 'Segoe Print', 'Bradley Hand', cursive`; wrapped = [];
      for (const word of words.split(/\s+/)) { const last = wrapped.at(-1); if (last !== undefined && g.measureText(last + ' ' + word).width <= w - 28) wrapped[wrapped.length - 1] = last + ' ' + word; else wrapped.push(word); }
      if (wrapped.length * size * 1.15 <= h - 70 && wrapped.every(l => g.measureText(l).width <= w - 28)) break;
    }
    wrapped.slice(0, 5).forEach((l, k) => g.fillText(l, -w / 2 + 14, -h / 2 + 26 + k * size * 1.15));
    if (who) { g.font = `italic 600 24px Georgia, serif`; g.fillStyle = '#5a3d22'; g.textAlign = 'right'; g.fillText('— ' + who, w / 2 - 14, h / 2 - 36); }
    g.fillStyle = ['#c62f2a', '#2a62c6', '#2f9a4a'][Math.floor(r * 3)]; g.beginPath(); g.arc(0, -h / 2 + 12, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(-3, -h / 2 + 9, 3, 0, Math.PI * 2); g.fill();
    g.restore();
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; texCache.set(key, t); return t;
}
/** Soul Actions entry 25: chalk on slate (a dusty board, hand lettering left-aligned), a sign-up sheet (printed title, ruled
 *  numbered lines, each name in its signer's hand at signupSlot), a poll (question, options, tally marks at pollSlot). */
const HAND = "'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive", CHALK = "'Chalkboard SE', 'Chalkboard', 'Marker Felt', 'Comic Sans MS', cursive";
const hashOf = (t: string) => { let h = 2166136261; for (const ch of t) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
function canvasOf(f: Face, w = 1024) { const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * f.h / f.w); return { c, g: c.getContext('2d')!, cw: c.width, ch: c.height, px: c.width / f.w }; }
function done(c: HTMLCanvasElement, key: string) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; texCache.set(key, t); return t; }
export function chalkTexture(lines: string[], f: Face): THREE.Texture {
  const key = JSON.stringify(['chalk', lines, f.w, f.h, f.bg]); const hit = texCache.get(key); if (hit) return hit;
  const { c, g, cw, ch } = canvasOf(f, 768); let seed = 11; const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345 | 0) >>> 0) / 4294967296;
  g.fillStyle = f.bg ?? '#2b322e'; g.fillRect(0, 0, cw, ch);
  // old wiping: a few broad, faint horizontal smears, then fine chalk dust
  for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(235,235,225,${0.015 + rnd() * 0.02})`; g.beginPath(); g.ellipse(rnd() * cw, rnd() * ch, 120 + rnd() * 200, 18 + rnd() * 26, (rnd() - 0.5) * 0.25, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(240,240,230,${0.04 + rnd() * 0.08})`; g.fillRect(rnd() * cw, rnd() * ch, 1.5, 1.5); }
  const ls = lines.filter((l) => l.trim()).slice(0, 6); let size = 74; g.font = `600 ${size}px ${CHALK}`;
  while (size > 22 && (ls.some((l) => g.measureText(l).width > cw * 0.86) || ls.length * size * 1.25 > ch * 0.85)) { size -= 2; g.font = `600 ${size}px ${CHALK}`; }
  g.fillStyle = f.ink ?? '#f4f2e8'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(255,255,255,0.35)'; g.shadowBlur = 3;
  ls.forEach((l, i) => g.fillText(l, cw * 0.07, ch / 2 + (i - (ls.length - 1) / 2) * size * 1.25));
  return done(c, key);
}
export function signupTexture(title: string, names: string[], f: Face): THREE.Texture {
  const key = JSON.stringify(['signup', title, names, f.w, f.h]); const hit = texCache.get(key); if (hit) return hit;
  const { c, g, cw, ch, px } = canvasOf(f, 768);
  g.fillStyle = f.bg ?? '#fbfaf4'; g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#22303e'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${Math.round(0.034 * px)}px Georgia, serif`; g.fillText(title || 'Sign up', cw / 2, ch * 0.09, cw * 0.9);
  for (let i = 0; i < 8; i++) {
    const [, sy] = signupSlot(i), y = (0.5 - sy / f.h) * ch;
    g.strokeStyle = 'rgba(70,110,160,0.45)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cw * 0.1, y + 0.014 * px); g.lineTo(cw * 0.92, y + 0.014 * px); g.stroke();
    g.fillStyle = '#7a8796'; g.textAlign = 'right'; g.font = `500 ${Math.round(0.022 * px)}px Georgia, serif`; g.fillText(`${i + 1}.`, cw * 0.17, y);
    const name = names[i]; if (!name) continue;
    const r = hashOf(name); g.save(); g.translate(cw * 0.21, y); g.rotate((r - 0.5) * 0.06);
    g.fillStyle = ['#1d2f6e', '#2a2622', '#6b1d1d'][Math.floor(r * 3)]; g.textAlign = 'left'; g.font = `600 ${Math.round(0.032 * px)}px ${HAND}`; g.fillText(name, 0, 0, cw * 0.68); g.restore();
  }
  return done(c, key);
}
export function pollTexture(title: string, options: string[], counts: number[], f: Face): THREE.Texture {
  const key = JSON.stringify(['poll', title, options, counts, f.w, f.h]); const hit = texCache.get(key); if (hit) return hit;
  const { c, g, cw, ch, px } = canvasOf(f, 1024);
  g.fillStyle = f.bg ?? '#f3efe2'; g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#2a2622'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${Math.round(0.06 * px)}px Georgia, serif`; g.fillText(title || 'Poll', cw / 2, ch * 0.12, cw * 0.92);
  options.forEach((o, i) => {
    const [tx, ty] = pollSlot(i), y = (0.5 - ty / f.h) * ch, x0 = (tx / f.w + 0.5) * cw - 0.06 * px;
    g.fillStyle = '#2a2622'; g.textAlign = 'right'; g.font = `600 ${Math.round(0.05 * px)}px Georgia, serif`; g.fillText(o, x0 - 0.04 * px, y, cw * 0.5);
    g.strokeStyle = 'rgba(40,40,40,0.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 - 0.02 * px, y + 0.04 * px); g.lineTo(cw * 0.95, y + 0.04 * px); g.stroke();
    // tally marks in fives, each stroke a little crooked, in marker
    g.strokeStyle = '#1d4f8f'; g.lineWidth = 0.009 * px; g.lineCap = 'round';
    for (let k = 0; k < (counts[i] ?? 0); k++) {
      const grp = Math.floor(k / 5), j = k % 5, gx = x0 + grp * 0.085 * px, r = hashOf(`${o}${k}`), h = 0.036 * px;
      g.beginPath();
      if (j < 4) { const xx = gx + j * 0.016 * px; g.moveTo(xx + (r - 0.5) * 4, y - h); g.lineTo(xx - (r - 0.5) * 4, y + h); }
      else { g.moveTo(gx - 0.008 * px, y + h * 0.7); g.lineTo(gx + 0.056 * px, y - h * 0.7); }
      g.stroke();
    }
  });
  return done(c, key);
}
/** Soul Actions entry 27: noughts and crosses in chalk: the grid, each X and O at its square (gameSquare, where the hand went),
 *  drawn a little differently per square, and a line through a winning row. */
export function tictactoeTexture(grid: string, f: Face): THREE.Texture {
  const key = JSON.stringify(['ttt', grid, f.w, f.h, f.bg]); const hit = texCache.get(key); if (hit) return hit;
  const c = document.createElement('canvas'); c.width = 840; c.height = Math.round(840 * f.h / f.w); const g = c.getContext('2d')!, cw = c.width, ch = c.height, px = cw / f.w;
  let seed = 5; const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345 | 0) >>> 0) / 4294967296;
  g.fillStyle = f.bg ?? '#2b322e'; g.fillRect(0, 0, cw, ch);
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(240,240,230,${0.03 + rnd() * 0.06})`; g.fillRect(rnd() * cw, rnd() * ch, 1.5, 1.5); }
  const X = (fx: number) => (fx / f.w + 0.5) * cw, Y = (fy: number) => (0.5 - fy / f.h) * ch, cell = 0.17 * px;
  g.strokeStyle = 'rgba(244,242,232,0.9)'; g.lineCap = 'round'; g.lineWidth = 7;
  for (const k of [-0.5, 0.5]) { g.beginPath(); g.moveTo(X(k * 0.17) + (rnd() - 0.5) * 4, Y(0.26)); g.lineTo(X(k * 0.17) + (rnd() - 0.5) * 4, Y(-0.26)); g.stroke(); g.beginPath(); g.moveTo(X(-0.26), Y(k * 0.17)); g.lineTo(X(0.26), Y(k * 0.17) + (rnd() - 0.5) * 4); g.stroke(); }
  const gg = (grid || '').padEnd(9, '.').slice(0, 9);
  for (let i = 0; i < 9; i++) {
    const [sx, sy] = gameSquare(i), x = X(sx), y = Y(sy), r = cell * 0.3, j = () => (rnd() - 0.5) * 5;
    g.lineWidth = 8; g.strokeStyle = gg[i] === 'X' ? '#f6efe0' : '#f3e3b0';
    if (gg[i] === 'X') { g.beginPath(); g.moveTo(x - r + j(), y - r + j()); g.lineTo(x + r + j(), y + r + j()); g.moveTo(x + r + j(), y - r + j()); g.lineTo(x - r + j(), y + r + j()); g.stroke(); }
    else if (gg[i] === 'O') { g.beginPath(); g.ellipse(x + j(), y + j(), r * 1.05, r * 0.95, rnd(), 0.15, Math.PI * 2.05); g.stroke(); }
  }
  const st = gameStatus(gg);
  if (st.line) { const [a, , b] = st.line, [ax, ay] = gameSquare(a), [bx, by] = gameSquare(b), ex = (bx - ax) * 0.18, ey = (by - ay) * 0.18; g.strokeStyle = 'rgba(232,120,96,0.95)'; g.lineWidth = 9; g.beginPath(); g.moveTo(X(ax - ex), Y(ay - ey)); g.lineTo(X(bx + ex), Y(by + ey)); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; texCache.set(key, t); return t;
}
/** Soul Actions entry 38: the poster wall's own face: painted vertical boards with gaps, the torn scraps and staple marks of
 *  older posters, a little grime toward the foot. The posters themselves are separate meshes (poster-sheet.ts). */
export function posterWallTexture(f: Face): THREE.Texture {
  const key = JSON.stringify(['poster-wall', f.w, f.h, f.bg]); const hit = texCache.get(key); if (hit) return hit;
  const { c, g, cw, ch, px } = canvasOf(f, 2048); let seed = 23; const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345 | 0) >>> 0) / 4294967296;
  g.fillStyle = f.bg ?? '#4c6a58'; g.fillRect(0, 0, cw, ch);
  const plank = 0.16 * px;
  for (let x = 0, i = 0; x < cw; x += plank, i++) {
    g.fillStyle = `rgba(${i % 2 ? '255,255,255' : '0,0,0'},${0.025 + rnd() * 0.04})`; g.fillRect(x, 0, plank, ch);
    for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`; g.lineWidth = 1 + rnd() * 2; const xx = x + rnd() * plank; g.beginPath(); g.moveTo(xx, 0); g.bezierCurveTo(xx + (rnd() - 0.5) * 12, ch * 0.3, xx + (rnd() - 0.5) * 12, ch * 0.7, xx + (rnd() - 0.5) * 10, ch); g.stroke(); }
    g.fillStyle = 'rgba(15,20,16,0.55)'; g.fillRect(x - 2, 0, 4, ch);
  }
  // scraps of older posters: pale torn fragments with a hint of print, and the staples that held them
  const scrapInk = ['#b8432f', '#2f4f8f', '#30614a', '#2b2118'];
  for (let i = 0; i < 26; i++) {
    const x = rnd() * cw, y = rnd() * ch, w = (0.03 + rnd() * 0.09) * px, h = (0.02 + rnd() * 0.07) * px;
    g.save(); g.translate(x, y); g.rotate((rnd() - 0.5) * 0.5); g.fillStyle = ['#e9e1c8', '#ece4a8', '#d4dfe2', '#e8cfd0', '#efede4'][Math.floor(rnd() * 5)]; g.globalAlpha = 0.55 + rnd() * 0.3;
    g.beginPath(); g.moveTo(-w / 2, -h / 2); for (let k = 0; k <= 8; k++) g.lineTo(-w / 2 + (w * k) / 8, -h / 2 + (rnd() - 0.5) * 10); for (let k = 8; k >= 0; k--) g.lineTo(-w / 2 + (w * k) / 8, h / 2 + (rnd() - 0.5) * 14); g.closePath(); g.fill();
    if (rnd() < 0.6) { g.fillStyle = scrapInk[Math.floor(rnd() * 4)]; g.globalAlpha *= 0.5; g.fillRect(-w * 0.35, -h * 0.2, w * 0.7 * rnd(), h * 0.18); }
    g.restore();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 90; i++) { const x = rnd() * cw, y = rnd() * ch; g.strokeStyle = 'rgba(190,190,180,0.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 9, y + (rnd() - 0.5) * 3); g.stroke(); }
  const grime = g.createLinearGradient(0, ch * 0.7, 0, ch); grime.addColorStop(0, 'rgba(30,25,15,0)'); grime.addColorStop(1, 'rgba(30,25,15,0.35)'); g.fillStyle = grime; g.fillRect(0, 0, cw, ch);
  return done(c, key);
}
/** Entry 38: the wanted/offered board: cork, two painted headers (WANTED, OFFERED), each note a signed card in its column's
 *  slot (wantedSlot, where the hand went), replies under it in a different hand, "TAKEN" stamped across a taken note. */
export function wantedTexture(notes: WantedRec[], f: Face): THREE.Texture {
  const key = JSON.stringify(['wanted', notes, f.w, f.h, f.bg]); const hit = texCache.get(key); if (hit) return hit;
  const { c, g, cw, ch, px } = canvasOf(f, 1536); let seed = 5; const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345 | 0) >>> 0) / 4294967296;
  g.fillStyle = f.bg ?? '#b88a5a'; g.fillRect(0, 0, cw, ch);
  for (let i = 0; i < 5200; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(70,40,15,0.22)' : 'rgba(235,200,150,0.18)'; g.fillRect(rnd() * cw, rnd() * ch, 2 + rnd() * 3, 2 + rnd() * 3); }
  g.fillStyle = 'rgba(60,35,15,0.5)'; g.fillRect(cw / 2 - 3, 0.1 * px, 6, ch);   // the line between the columns
  for (const [col, label, paint] of [[0, 'WANTED', '#8e2f22'], [1, 'OFFERED', '#2f6046']] as const) {
    const [sx] = wantedSlot(col, 0), x = (sx / f.w + 0.5) * cw, w = 0.5 * px, h = 0.075 * px, y = 0.055 * px;
    g.fillStyle = 'rgba(20,10,5,0.35)'; g.fillRect(x - w / 2 + 5, y - h / 2 + 6, w, h); g.fillStyle = paint; g.fillRect(x - w / 2, y - h / 2, w, h);
    g.fillStyle = '#f3ead2'; g.font = `800 ${Math.round(0.058 * px)}px Georgia, 'Times New Roman', serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, x, y + 2, w * 0.9);
  }
  const papers = ['#fbf6e4', '#fdf0a6', '#d9ecf7', '#f8dbe0', '#e3f2d6'], hash = (t: string) => { let h = 2166136261; for (const ch of t) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
  for (const n of notes) {
    const [sx, sy] = wantedSlot(n.c === 'o' ? 1 : 0, n.r), x = (sx / f.w + 0.5) * cw, y = (0.5 - sy / f.h) * ch, w = 0.62 * px, h = 0.21 * px, r = hash(n.t + n.n);
    g.save(); g.translate(x, y); g.rotate((r - 0.5) * 0.06);
    g.fillStyle = 'rgba(30,15,5,0.35)'; g.fillRect(-w / 2 + 6, -h / 2 + 8, w, h); g.fillStyle = papers[Math.floor(r * papers.length)]; g.fillRect(-w / 2, -h / 2, w, h);
    const words = n.t.replace(/^(?:wanted|offered)\s*[:\-–—]?\s*/i, '');
    g.fillStyle = '#26221e'; g.textAlign = 'left'; g.textBaseline = 'top';
    let size = 58, wrapped: string[] = [];
    for (; size >= 28; size -= 2) { g.font = `700 ${size}px 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive`; wrapped = []; for (const word of words.split(/\s+/)) { const last = wrapped.at(-1); if (last !== undefined && g.measureText(last + ' ' + word).width <= w - 40) wrapped[wrapped.length - 1] = last + ' ' + word; else wrapped.push(word); } if (wrapped.length <= 2) break; }
    wrapped.slice(0, 2).forEach((l, k) => g.fillText(l, -w / 2 + 20, -h / 2 + 12 + k * size * 1.08));
    g.font = `italic 700 32px Georgia, serif`; g.fillStyle = '#5a3d22'; g.textAlign = 'right'; g.fillText('— ' + n.n, w / 2 - 18, -h / 2 + 16 + Math.min(2, wrapped.length) * size * 1.08);
    // replies, each in the replier's own blue ink, signed
    n.re.slice(0, 2).forEach((re, k) => { g.textAlign = 'left'; g.fillStyle = '#1d3f8f'; g.font = `700 36px 'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive`; g.fillText(`↳ ${re.t} — ${re.n}`, -w / 2 + 30, h / 2 - 84 + k * 40, w - 50); });
    g.fillStyle = ['#c62f2a', '#2a62c6', '#2f9a4a'][Math.floor(r * 3)]; g.beginPath(); g.arc(0, -h / 2 + 10, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(-3, -h / 2 + 7, 3.5, 0, Math.PI * 2); g.fill();
    if (n.tk) { g.save(); g.translate(w * 0.17, -h * 0.02); g.rotate(-0.16); g.strokeStyle = 'rgba(178,34,34,0.85)'; g.lineWidth = 6; g.strokeRect(-w * 0.22, -32, w * 0.44, 64); g.fillStyle = 'rgba(178,34,34,0.88)'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `800 34px 'Courier New', monospace`; g.fillText(`TAKEN · ${n.tk.n}`.toUpperCase(), 0, 2, w * 0.42); g.restore(); }
    g.restore();
  }
  return done(c, key);
}
function paintingTexture(seed: number, bg: string): THREE.Texture {
  const key = `painting:${seed}:${bg}`; const hit = texCache.get(key); if (hit) return hit;
  const c = document.createElement('canvas'); c.width = 128; c.height = 96; const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, 128, 96); g.fillStyle = '#e9d9a6'; g.beginPath(); g.arc(92, 28, 14, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#5f8a4a'; g.beginPath(); g.moveTo(0, 70); g.quadraticCurveTo(40, 40 + (seed % 9), 80, 62); g.quadraticCurveTo(110, 50, 128, 66); g.lineTo(128, 96); g.lineTo(0, 96); g.fill();
  g.fillStyle = '#3f6e33'; g.fillRect(0, 82, 128, 14);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; texCache.set(key, t); return t;
}

// Lane PERF-MATERIALS: one material per face texture. Text and pattern textures are cached by their content, so the
// eight street banners that read the same drew eight materials of one map; the material is now shared like the map.
const faceMaterials = new WeakMap<THREE.Texture, { std?: THREE.Material; art?: THREE.Material }>();
function faceMaterialFor(map: THREE.Texture, art: boolean): THREE.Material {
  let e = faceMaterials.get(map); if (!e) faceMaterials.set(map, e = {});
  // video and images glow a little so art reads in dim rooms; text keeps the matte board look
  if (art) return (e.art ??= new THREE.MeshBasicMaterial({ map, toneMapped: false }));
  return (e.std ??= new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0 }));
}
const isFaceMaterial = (m: THREE.Material | undefined) => { const map = (m as THREE.MeshBasicMaterial | undefined)?.map, e = map ? faceMaterials.get(map) : undefined; return !!e && (e.std === m || e.art === m); };

registerMesh({
  gen: 'tag:sign-text',
  build(ctx) {
    bindMotionModel(ctx.model);
    const parsed = kitArgs.safeParse(ctx.args); if (!parsed.success) return null;
    const root = buildKit(parsed.data, ctx);
    if (typeof document === 'undefined') return root;
    const faces = (ctx.args.faces ?? []) as Face[];
    const st = ctx.entity.state ?? {};
    const poweredOff=ctx.def.tags.includes('hand-powered-display')&&st.on===false;
    const text = typeof st.text === 'string' && st.text.trim() ? st.text.split('\n') : (ctx.def.components.sign?.lines ?? []);
    for (const f of faces) {
      let map: THREE.Texture;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.h));
      // An off display does not resolve or request its saved media.
      if(poweredOff&&f.media){
        plane.material=new THREE.MeshBasicMaterial({color:'#090c10',toneMapped:false});
        plane.position.set(...f.at);plane.rotation.set(f.pitch??0,f.yaw??0,0,'YXZ');plane.name='sign-face';plane.userData.poweredOff=true;root.add(plane);continue;
      }
      // W6: a media face shows its slot's image or looping video; a gallery wall's empty slots stay plain
      // #430: a fading canvas (chalk) ages by the world day shown from the day it was drawn; from fadeDays it is washed away
      const age = f.media && f.fadeDays && typeof st.day === 'number' ? posterAgeDays(st.day) : null, washed = age !== null && age >= f.fadeDays!;
      const found = f.media && !washed ? artOf(ctx.entity.id, st, f.slot) : null, src = found ? signMediaPath(found.url) : null;
      const art = found && src ? { ...found, url: src } : null;
      // a link the page cannot load (most often a web host without a CORS header, which WebGL needs) says so on the
      // face instead of staying black; hover still names the piece and its maker
      const broken = () => { const old = plane.material as THREE.MeshBasicMaterial; const t = textTexture(brokenLinkLines(art!.url), { ...f, bg: '#2f2a26', ink: '#e8dcc8' }); plane.material = faceMaterialFor(t, false); if (!isFaceMaterial(old)) old?.dispose?.(); plane.userData.art = { ...plane.userData.art, broken: true }; const uv = (plane.geometry as THREE.PlaneGeometry).attributes.uv as THREE.BufferAttribute; uv.setXY(0, 0, 1); uv.setXY(1, 1, 1); uv.setXY(2, 0, 0); uv.setXY(3, 1, 0); uv.needsUpdate = true; };
      if (art && art.kind === 'video') map = videoTexture(art.url, plane, broken);
      else if (art && loader && imageBroken(art.url)) { map = textTexture(brokenLinkLines(art.url), { ...f, bg: '#2f2a26', ink: '#e8dcc8' }); art.broken = true; }
      else if (art && loader) { const url = art.url; map = texCache.get(url) ?? loader.load(url, () => imageLoaded(url), undefined, () => { texCache.delete(url); imageFailed(url); }); map.colorSpace = THREE.SRGBColorSpace; texCache.set(url, map); whenImageFails(url, broken); }
      else if (f.media && (f.slot !== undefined || f.fadeDays)) map = textTexture([''], f);
      else if (f.media && text.length && typeof st.text === 'string' && st.text.trim()) map = textTexture(text.slice(0, 6), f);
      else if (f.media) map = paintingTexture(ctx.def.name.length + (ctx.entity.seed ?? 0), f.bg ?? '#7fa7c9');
      else if (ctx.def.tags.includes('tictactoe')) map = tictactoeTexture(typeof st.text === 'string' ? st.text : '', f);
      else if (ctx.def.tags.includes('posters')) map = posterWallTexture(f);
      else if (ctx.def.tags.includes('wanted')) map = wantedTexture(wantedList(st), f);
      else if (ctx.def.tags.includes('pinboard')) map = pinboardTexture(typeof st.text === 'string' ? st.text.split('\n') : [], f);
      else if (ctx.def.tags.includes('signup')) { const names = typeof st.text === 'string' && st.text ? st.text.split('\n') : []; map = signupTexture(String(st.title ?? ''), names.slice(signupPageStart(names.length)), f); }   // #429: a guestbook shows its current page
      else if (ctx.def.tags.includes('poll')) { const opts = pollOptions(st), votes = typeof st.textBy === 'string' && st.textBy ? st.textBy.split(',').map((v) => Number(v.split(':')[1])) : []; map = pollTexture(String(st.title ?? ''), opts, opts.map((_, i) => votes.filter((v) => v === i).length), f); }
      else if (ctx.def.tags.includes('chalkboard') && ctx.def.tags.includes('hand-writable')) map = chalkTexture(text, f);
      else map = textTexture((f.line !== undefined ? [text[f.line] ?? ''] : text).slice(0, 6), f);
      // video and images glow a little so art reads in dim rooms; text keeps the matte board look
      plane.material = faceMaterialFor(map, !!art);
      // #430: fainter by a share of its fade per world day (its own material: the shared one may serve a fresher copy)
      if (art && age !== null && age > 0) plane.material = new THREE.MeshBasicMaterial({ map, toneMapped: false, transparent: true, depthWrite: false, opacity: Math.max(0.1, 1 - age / f.fadeDays!) });
      plane.position.set(...f.at); plane.rotation.set(f.pitch ?? 0, f.yaw ?? 0, 0, 'YXZ'); plane.name = 'sign-face';
      if (art) { plane.userData.art = art; coverWhenReady(map, plane.geometry as THREE.PlaneGeometry, f.w / f.h); }
      root.add(plane);
      // entry 38: each poster is its own paper on the wall, in its slot (the place the hands put it)
      if (ctx.def.tags.includes('posters')) for (const p of posterList(st)) {
        const [dx, dy] = posterSlot(p.s), mesh = posterMesh({ t: p.t, d: p.d, n: p.n, paper: posterPaper(p.t, p.n), age: posterAgeDays(p.day) }, POSTER_W, POSTER_H);
        mesh.position.set(f.at[0] + dx, f.at[1] + dy, f.at[2] + 0.004); mesh.name = 'poster-slot-' + p.s; mesh.userData.poster = p; root.add(mesh);
      }
    }
    return root;
  },
});
