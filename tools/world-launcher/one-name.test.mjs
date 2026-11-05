// #894 (one name, decided 2026-11-04): the product is Souls, at soul.game; a character is a Soul, a world's creator is its god.
// "Sim" is retired and "Eden" is one world, never the product. This reads the text every world serves to agents and the
// pages' meta, as served (templates filled the way the server fills them), and fails on the retired names.
// Code identifiers (eden-god, eden_* tools, eden.mjs, X-Sim-* headers, `name: sim`) are out of scope (#890).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const SERVED = ['tools/world-skill/SKILL.md', 'tools/world-launcher/soul/skill.md', 'tools/world-launcher/soul/instructions.md', 'tools/god-skill/SKILL.md',
  'tools/edge-skill/SKILL.md', 'tools/edge-skill/INSTRUCTIONS.md', 'apps/web/index.html', 'apps/web/changelog.html'];
const RETIRED = [/\bSim\b/, /\bEden worlds?\b/i, /\ban Eden world\b/i, /MMO World Simulator/];
/** The one phrase still allowed, by name: "open Sim window" is shared with the pinned CLIs' printed approval lines and
 *  changes with them in #949. Nothing else may say Sim. */
const PENDING = /open(?:, signed-in)? Sim window/g;

test('served skills, guides and page meta use the one product name', () => {
  for (const p of SERVED) {
    const text = read(p).replace(PENDING, '(#949)');
    for (const re of RETIRED) { const m = text.match(re); assert.equal(m, null, `${p}: "${m?.[0]}" near "${m ? text.slice(Math.max(0, m.index - 40), m.index + 40) : ''}"`); }
  }
});

test('the built-in skills the server writes (central-mind skill, edge stub) use the one product name', async () => {
  const { skillMd } = await import('../../apps/server/src/skill.ts');
  const { edgeSkillStub } = await import('../../apps/server/src/edge/skill-stub.ts');
  for (const text of [skillMd('https://soul.game/w/toy'), edgeSkillStub('https://soul.game/w/toy')])
    for (const re of RETIRED) assert.equal(text.match(re), null, String(re));
});
