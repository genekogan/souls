// The god seat: a Seat driving eden-god.mjs, paired by the agent itself (`register <base> dev:admin` + `mint` on a dev
// world, as the onboarding text says), with the god inbox as its card. DESIGN §4.1, §6.
import { join } from 'node:path';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { Seat } from './seat.mjs';

export const GOD_OWNER = 'dev:admin';
/** §6 god onboarding, corrected to the path the world actually serves (verified: <base>/god/SKILL.md and
 *  <base>/god/eden-god.mjs; <base>/god-skill and <base>/eden-god.mjs fall through to the web app). */
export const godOnboardingText = (base) => `You are the god of my world at ${base}/ . Set yourself up from ${base}/god/SKILL.md (register with dev:admin and mint, since this is a local world), then wait for my messages.`;
export const GOD_ALLOWED = ['Bash(node eden-god.mjs:*)', 'Bash(curl:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(mkdir:*)', 'Bash(pwd:*)', 'Bash(test:*)', 'Bash(node --version)',
  'Read(./**)', 'Write(./**)', 'Edit(./**)'];

/** god status prints one line ("<world> — you are …; N entities …") and fails when unpaired. */
const parseGodStatus = (stdout, code) => {
  let line = stdout.trim(); try { const j = JSON.parse(line); if (typeof j === 'string') line = j; } catch { /* plain */ }
  return code === 0 && /you are/.test(line) ? { ok: true, data: { paired: true, line } } : { ok: false, reason: (line || '').slice(0, 300) };
};
export const GOD_CLI = { file: 'eden-god.mjs', fallbackFile: null, status: ['status'], parseStatus: parseGodStatus,
  listen: (after) => ['listen', '--json', ...(after ? ['--after', after] : [])] };

/** createGodSeat({runDir, god, worldBase, serverRoot, preinstall}) → Seat (kind 'god'). By default the folder is empty and the
 *  agent fetches the CLI as the served skill tells it; preinstall copies <serverRoot>/tools/god-skill/eden-god.mjs (used when
 *  the world does not serve /god/eden-god.mjs). */
export function createGodSeat({ runDir, god, worldBase, serverRoot, rails, preinstall = false }) {
  const dir = join(runDir, 'god');
  const s = new Seat({ dir, seat: { id: 'god', soulName: null, ...god }, worldBase, rails, cli: GOD_CLI, allowedTools: GOD_ALLOWED, kind: 'god', infraFile: join(runDir, 'infrastructure-invalid.jsonl') });
  mkdirSync(s.folder, { recursive: true });
  if (preinstall) {
    const src = [join(serverRoot, 'tools/god-skill/build/eden-god.mjs'), join(serverRoot, 'tools/god-skill/eden-god.mjs')].find(existsSync);
    if (!src) throw new Error('no eden-god.mjs under serverRoot');
    copyFileSync(src, join(s.folder, 'eden-god.mjs')); s.info.preinstalled = src;
  }
  s.info.ownerIdentity = GOD_OWNER.replace(/^dev:/, '');
  s.save();
  s.onboardGod = (opts = {}) => s.onboard({ text: godOnboardingText(worldBase), ...opts });
  s.sendGodCard = ({ text }) => { s.noteRequest(); return sendGodCard({ base: worldBase, text }); };
  s.cardView = () => godCardView({ base: worldBase });
  return s;
}

const godAuth = { authorization: `Bearer ${GOD_OWNER}` };
export function sendGodCardRequest({ base, text }) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('sendGodCard: text required');
  return { url: `${base}/v1/god/inbox`, init: { method: 'POST', headers: { ...godAuth, 'content-type': 'application/json' }, body: JSON.stringify({ text }) } };
}
export const godCardViewRequest = ({ base }) => ({ url: `${base}/v1/god/inbox`, init: { method: 'GET', headers: godAuth } });
async function call({ url, init }) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  let body = null; try { body = await r.json(); } catch { /* not json */ }
  if (!r.ok) { const e = new Error(`${init.method} ${new URL(url).pathname} → ${r.status} ${body?.code ?? ''}`); e.status = r.status; e.body = body; throw e; }
  return body;
}
/** sendGodCard({base, text}) → {messageId, sentAt, inbox}: the GodPanel's route (POST /v1/god/inbox as the world owner). */
export async function sendGodCard(opts) { const b = await call(sendGodCardRequest(opts)); const l = b?.inbox?.latest; return { messageId: l?.id ?? null, sentAt: l?.sentAt ?? null, inbox: b?.inbox ?? null }; }
export async function godCardView(opts) { return (await call(godCardViewRequest(opts)))?.inbox ?? null; }
