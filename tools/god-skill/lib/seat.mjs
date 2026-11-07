// Where a god's files live. A legacy folder keeps them beside the agent, as ever. Inside a Souls home a god holds a seat,
// `.souls/gods/<world>/`, with its token in the shared credentials.json. The working directory stays the person's, because
// god commands take relative file arguments: only this CLI's own files move. Never reads anything under souls/.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { findHome, keyOf, openHome } from '../../world-launcher/soul/home.mjs';

let seat = null, registering = null, registerAs = null;   // seat: {home, key, dir} once this run sits in a home
export const godFile = (name) => (seat ? join(seat.dir, name) : name);
export const seatDir = () => seat?.dir ?? null;
export const seatSecrets = () => seat?.home.godSecrets(seat.key) ?? null;
export const keepSecrets = (patch) => seat?.home.saveGodSecrets(seat.key, patch);
function sit(home, key) {
  seat = { home, key, dir: home.godSeat(key) };
  // the look keeper and the shot helper are this same CLI in a child: they sit in the same seat
  process.env.SOULS_HOME = home.root; process.env.EDEN_GOD_SEAT = key;
}
const LEGACY = '.eden-god.json';
const legacyWorld = () => { try { return JSON.parse(readFileSync(LEGACY, 'utf8')).world ?? null; } catch { return null; } };

/** `register` makes its own seat, once its arguments are parsed. Call the answer if the world does not confirm: a typo leaves no seat. */
export function seatForRegister(url) {
  if (!registering) return () => {};
  const h = registering, before = h.config(), known = keyOf(before.worlds, url), held = known && before.gods[known];
  // A seat never changes world: its token belongs to the world it was minted for.
  if (registerAs !== null && known !== registerAs) throw new Error(`The seat ${registerAs} is for ${before.worlds[registerAs]?.url}, not ${url}. For another world: node eden-god.mjs register <world-url>`);
  const key = h.ensureGod(url);
  sit(h, key);
  return held ? () => {} : () => { h.dropGod(key, { world: !known }); seat = null; delete process.env.EDEN_GOD_SEAT; };
}

/** Pick the seat for this run, before any command. Returns the command line without its world selector. */
export function enterGodSeat(argv, commands, { cwd = process.cwd(), env = process.env, home = homedir() } = {}) {
  const found = findHome({ cwd, env, homedir: home });
  if (found.kind !== 'home') return argv;
  const h = openHome(found.root);
  if (env.EDEN_GOD_SEAT) { sit(h, env.EDEN_GOD_SEAT); return argv; }
  const cfg = h.config(), first = argv[0] ?? '', say = (w) => (commands[w] ? `@${w}` : w);
  // `@world` always names a world; a bare word does when no command has that name.
  const asked = first.startsWith('@') ? first.slice(1) : !commands[first] && (cfg.gods[first] || cfg.worlds[first]) ? first : null;
  const line = asked === null ? argv : argv.slice(1), cmd = line[0];
  if (asked !== null && !cfg.gods[asked]) throw new Error(`No god seat for ${asked} here. Run: node eden-god.mjs register <world-url>`);
  // A helper belongs to the world its helper file names, whatever else this home holds.
  if (env.EDEN_GOD_HELPER) {
    let world = null; try { world = JSON.parse(readFileSync(resolve(cwd, env.EDEN_GOD_HELPER), 'utf8')).world; } catch { /* state.mjs says what is wrong */ }
    const key = keyOf(cfg.worlds, world);
    if (asked !== null && asked !== key) throw new Error(`This helper works in ${key ?? world}, not ${asked}.`);
    if (key && cfg.gods[key]) sit(h, key);
    return line;
  }
  // In this order: a named seat; then a legacy file, which outranks anything unnamed; then register; then the only seat.
  if (asked !== null) {
    if (cmd === 'register') { registering = h; registerAs = asked; } else sit(h, asked);
    return line;
  }
  // A legacy file here is this folder's god until `node eden.mjs import` moves it: a seat is never lost from view.
  if (existsSync(join(cwd, LEGACY))) { const key = keyOf(cfg.worlds, legacyWorld()); if (!key || !cfg.gods[key]) return argv; }
  if (cmd === 'register') { registering = h; return line; }
  const seats = Object.keys(cfg.gods);
  if (seats.length === 1 && cmd !== 'help') sit(h, seats[0]);
  else if (seats.length > 1 && commands[cmd] && cmd !== 'help') throw new Error(`Several god seats here: ${seats.join(', ')}. Say which: node eden-god.mjs ${say(seats[0])} ${cmd}`);
  return line;
}
