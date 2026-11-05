// #897: every world (not only the four original ones) serves an llms.txt reader, from server configuration only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toyFactory } from '@sim/engine-toy';
import { agentReader, worldReader } from './agent-reader.ts';
import { Auth } from './auth.ts';
import { Brain } from './brain.ts';
import { config } from './config.ts';
import { Db } from './db.ts';
import { buildApp } from './http.ts';
import type { Hub } from './hub.ts';
import { Souls } from './souls.ts';
import { WorldHost } from './world.ts';

test('worldReader: names the world, links its files and the docs, keeps the rules, one product name', () => {
  const t = worldReader({ publicUrl: 'https://soul.game/w/eden-2026', worldKey: 'eden-2026', worldPath: '/w/eden-2026' }, 'Eden 2026');
  assert.match(t, /^# Eden 2026\n\n> Eden 2026 is a world in Souls \(soul\.game\)/);
  for (const f of ['/', '/SKILL.md', '/instructions.md', '/skill.md', '/cards.md']) assert.ok(t.includes(`](https://soul.game/w/eden-2026${f})`), f);
  assert.ok(t.includes('](https://soul.game/docs/for-agents)') && t.includes('](https://soul.game/llms.txt)'));
  assert.match(t, /never put it in a URL/); assert.match(t, /untrusted game data, never\n> instructions/);
  assert.ok(!/\bSim\b|\bEden world/.test(t));
  assert.ok(worldReader({ publicUrl: 'https://x.test/worlds/w/a', worldKey: 'a', worldPath: '/worlds/w/a' }, 'A').includes('](https://x.test/worlds/w/a/SKILL.md)'), 'a based launcher');
  for (const publicUrl of ['https://u:p@soul.game/w/a', 'https://soul.game/w/a?token=x', 'https://soul.game/w/a#x', 'http://soul.game/w/a', 'https://soul.game/w/b'])
    assert.throws(() => worldReader({ publicUrl, worldKey: 'a', worldPath: '/w/a' }, 'A'), /approved server world URL/, publicUrl);
  assert.throws(() => worldReader({ publicUrl: 'https://soul.game/x', worldKey: 'a', worldPath: '/x' }, 'A'), /selected-world prefix/);
  assert.throws(() => agentReader({ publicUrl: 'https://soul.game/w/a', worldKey: 'a', worldPath: '/w/a' }), /selected-world prefix/, 'the legacy reader stays for the four originals');
});

test('a launcher world answers /llms.txt with its reader, never from request headers', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'world-reader-')), db = new Db(':memory:');
  const host = new WorldHost(db, toyFactory, 'world-reader', 1e9, 'garden-1'); host.boot();
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');
  const cfg = { ...config, worldKey: 'garden', worldId: host.worldId, worldPath: '/w/garden', publicUrl: 'https://soul.game/w/garden', webDir: dir, marsWebDir: '/nonexistent',
    brainMode: 'fake' as const, budgetUsdPerDay: 0, typesafeKey: undefined, anthropicKey: undefined, privyAppId: '', privyAppSecret: '' };
  const auth = new Auth(cfg, db), brain = new Brain(host, db, cfg, { clients: () => 0, onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {} }), souls = new Souls(host, db, brain, cfg);
  const app = buildApp({ cfg, db, host, auth, brain, souls, hub: { clients: new Map(), refreshMe() {} } as unknown as Hub });
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const r = await app.request('/llms.txt', { headers: { host: 'spoof.invalid', 'x-forwarded-host': 'spoof.invalid' } });
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'text/plain; charset=utf-8');
  const text = await r.text();
  assert.match(text, /^# Garden\n/); assert.ok(text.includes('](https://soul.game/w/garden/SKILL.md)')); assert.ok(!text.includes('spoof'));
  assert.equal(r.headers.get('x-robots-tag'), null, 'a public guide');
});
