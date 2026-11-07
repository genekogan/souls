// Where a god's files live. A legacy folder keeps them beside the agent, as ever. Inside a Souls home a god holds a seat,
// `.souls/gods/<world>/`, with its token in the shared credentials.json. The working directory stays the person's, because
// god commands take relative file arguments: only this CLI's own files move. Never reads anything under souls/.
import { readFileSync, realpathSync } from 'node:fs';
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
const readWorld = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')).world ?? null; } catch { return null; } };
/** A state file here that is still this folder's god: it has a world (or cannot be read: the file path says why) and `import` has not moved it. */
function fileHolds(h, cfg, cwd) {
  let raw; try { raw = readFileSync(join(cwd, LEGACY), 'utf8'); } catch { return null; }
  let world; try { world = JSON.parse(raw).world; } catch { return { key: null }; }
  if (!world) return null;
  const key = keyOf(cfg.worlds, world);
  return key && cfg.gods[key]?.importedFrom === realpathSync(cwd) ? null : { key };
}

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

/** Pick the seat for this run, before any command. Returns the command line without its world selector. In this order:
 *  1. A seat is named: by a child's EDEN_GOD_SEAT, `@world`, or a bare world word no command shares. It must exist.
 *  2. A helper sits in the world of its helper file, unless its lead is still on a file here, and never pairs or registers.
 *  3. A named seat is used. A named `register` may only repeat that seat's own world.
 *  4. A file here with a world is this folder's god, as on any folder without a home, until `node eden.mjs import` moves
 *     it: the seat records the folder it came from, and that folder then sits there.
 *  5. `register` makes the seat of its URL, once its arguments are parsed and the world answers.
 *  6. One seat needs no name; several must be named; none leaves this run on the folder. */
export function enterGodSeat(argv, commands, { cwd = process.cwd(), env = process.env, home = homedir() } = {}) {
  const found = findHome({ cwd, env, homedir: home });
  if (found.kind !== 'home') return argv;
  const h = openHome(found.root), cfg = h.config(), first = argv[0] ?? '', say = (w) => (commands[w] ? `@${w}` : w);
  const inherited = env.EDEN_GOD_SEAT || null;
  const worded = inherited ? null : first.startsWith('@') ? first.slice(1) : !commands[first] && (cfg.gods[first] || cfg.worlds[first]) ? first : null;
  const asked = inherited ?? worded, line = worded === null ? argv : argv.slice(1), cmd = line[0];
  if (asked !== null && !cfg.gods[asked]) throw new Error(`No god seat for ${asked} here. Run: node eden-god.mjs register <world-url>`);
  if (env.EDEN_GOD_HELPER) {
    if (['register', 'pair', 'mint'].includes(cmd)) throw new Error('A helper works under its lead\'s seat; it does not pair or register.');
    const key = keyOf(cfg.worlds, readWorld(resolve(cwd, env.EDEN_GOD_HELPER)));
    if (asked !== null && asked !== key) throw new Error(`This helper works in ${key ?? 'another world'}, not ${asked}.`);
    if (key && cfg.gods[key] && h.godSecrets(key).token && !fileHolds(h, cfg, cwd)) sit(h, key);
    return line;
  }
  if (asked !== null) {
    if (cmd === 'register') { registering = h; registerAs = asked; } else sit(h, asked);
    return line;
  }
  if (fileHolds(h, cfg, cwd)) return argv;
  const moved = Object.keys(cfg.gods).find((k) => cfg.gods[k].importedFrom === realpathSync(cwd));
  if (moved && cmd !== 'register' && cmd !== 'help') { sit(h, moved); return line; }
  if (cmd === 'register') { registering = h; return line; }
  const seats = Object.keys(cfg.gods);
  if (seats.length === 1 && cmd !== 'help') sit(h, seats[0]);
  else if (seats.length > 1 && commands[cmd] && cmd !== 'help') throw new Error(`Several god seats here: ${seats.join(', ')}. Say which: node eden-god.mjs ${say(seats[0])} ${cmd}`);
  return line;
}
