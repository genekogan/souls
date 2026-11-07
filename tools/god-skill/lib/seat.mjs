// Where a god's files live. A legacy folder keeps them beside the agent, as ever. Inside a Souls home a god holds a seat,
// `.souls/gods/<world>/`, with its token in the shared credentials.json. The working directory stays the person's, because
// god commands take relative file arguments: only this CLI's own files move. Never reads anything under souls/.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findHome, keyOf, openHome } from '../../world-launcher/soul/home.mjs';

let seat = null;   // {key, dir, secrets()} once this run sits in a home
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

/** Pick the seat for this run, before any command. Returns the command line without its world selector. */
export function enterGodSeat(argv, commands, { cwd = process.cwd(), env = process.env, home = homedir() } = {}) {
  const found = findHome({ cwd, env, homedir: home });
  if (found.kind !== 'home') return argv;
  const h = openHome(found.root);
  if (env.EDEN_GOD_SEAT) { sit(h, env.EDEN_GOD_SEAT); return argv; }
  const cfg = h.config(), [first] = argv, known = (w) => !commands[w] && (cfg.gods[w] || cfg.worlds[w]);
  const line = first && known(first) ? argv.slice(1) : argv, cmd = line[0], asked = line === argv ? null : first;
  // A legacy file here is this folder's god until `import` moves it: a seat is never lost from view.
  if (existsSync(join(cwd, LEGACY))) { const key = keyOf(cfg.worlds, legacyWorld()); if (!key || !cfg.gods[key]) return argv; }
  if (cmd === 'register' && line[1]) { const key = h.ensureGod(line[1].replace(/[?#].*$/, '').replace(/\/$/, '')); sit(h, key); return line; }
  if (asked) {
    if (!cfg.gods[asked]) throw new Error(`No god seat for ${asked} here. Run: node eden-god.mjs register <world-url>`);
    sit(h, asked); return line;
  }
  const seats = Object.keys(cfg.gods);
  if (seats.length === 1 && cmd !== 'help') sit(h, seats[0]);
  else if (seats.length > 1 && commands[cmd] && cmd !== 'help') throw new Error(`Several god seats here: ${seats.join(', ')}. Say which: node eden-god.mjs ${seats[0]} ${cmd}`);
  return line;
}
