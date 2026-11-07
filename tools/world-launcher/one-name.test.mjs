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
const RETIRED = [/\bSim\b/, /\bEden worlds?\b/i, /\ban Eden world\b/i, /MMO World Simulator/, /\bEden Soul\b/, /\bin Eden\b(?! \d)/];
/** Still allowed, by name, until #949: "open Sim window" (shared with the pinned CLIs' printed approval lines) and the
 *  headings of the legacy edge skill and the built-in edge stub (pinned by tests on T3 paths). Nothing else may. */
const PENDING = /open(?:, signed-in)? Sim window|^# Eden — (?:skill|basic edge fallback)\b|admitted Eden actions/gm;

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
    for (const re of RETIRED) assert.equal(text.replace(PENDING, '(#949)').match(re), null, String(re));
});
