// Deterministic fake producer fixtures shared with World conformance tests.
// No server/provider, renderer, environment copy or filesystem DB is needed.
import type { EngineFactory } from '@souls/engine-contract';
import { marsFactory, GREEN_FIELD_WORLD, LITTLE_MARTIANS_WORLD } from '@souls/engine-mars';
import { newLife } from '@souls/brain';
import { publicEvent } from '@souls/protocol';
import type { Brain } from '../../src/brain.ts';
import { config } from '../../src/config.ts';
import { Db } from '../../src/db.ts';
import { Souls } from '../../src/souls.ts';
import { recordedToyFactory } from '../../src/toy-takes.ts';
import { WorldHost } from '../../src/world.ts';

export async function worldPresentationFixtures() {
  const cases: { key: string; factory: EngineFactory; name: string }[] = [
    { key: 'toy', factory: recordedToyFactory, name: 'Fixture human' },
    { key: 'mars', factory: await marsFactory({ scene: 'eden-camp', arrival: [-3, 18], arrivalPlace: 'arrival', reference: [-1, 17], grounds: { id: 'grounds', name: 'Camp grounds' } }), name: 'Alice' },
    { key: 'littlemartians', factory: await marsFactory(LITTLE_MARTIANS_WORLD), name: 'Verdelis' },
    { key: 'eden', factory: await marsFactory(GREEN_FIELD_WORLD), name: 'Fixture human' },
  ];
  return cases.map(({ key, factory, name }) => {
    const db = new Db(':memory:'), host = new WorldHost(db, factory, 'W-001-fixture', 1e9, `${key}-fixture`);
    try {
      host.boot(); host.engine.configureClock?.({ origin: 0, dayTicks: 72000 });
      const soulId = 's_fixture', entityId = 'h_fixture', marker = `PRIVATE_W_FIXTURE_${key}`;
      db.createSoul({ id: soulId, entityId, worldId: host.worldId, owner: 'fixture-human-owner', name, description: 'Public fixture character', native: false });
      void host.enqueue('birth', 'fixture', { soulId, entityId, owner: 'fixture-human-owner', name, description: 'Public fixture character' }); host.tickOnce();
      if (key !== 'toy') { host.minds.get(soulId)!.life = newLife(host.engine.world.tick); host.minds.get(soulId)!.life!.journal = marker + '_JOURNAL'; }
      void host.enqueue('mandate', `soul:${soulId}`, { soulId, op: 'upsert', rule: { id: 'r_fixture', words: marker + '_WORDS', strict: false,
        understanding: 'Rest when appropriate', agenda: [{ card: 'rest', target: null }], trigger: { kind: 'none' }, status: 'active', report: null } });
      while (host.engine.world.tick < 35) host.tickOnce();
      const cfg = { ...config, brainMode: 'fake' as const, budgetUsdPerDay: 0, typesafeKey: undefined, anthropicKey: undefined };
      // This reusable W fixture has no scheduled mind or maintenance timer.
      // Souls still produces the real owner projection; available_now is empty
      // here. Actual alignment/options are exercised in mandate.test.ts.
      const brain = { midContext: () => ({ options: [] }) } as unknown as Brain;
      const souls = new Souls(host, db, brain, cfg);
      const owner = souls.dashboard(db.soul(soulId)!);
      const projection = { kernel: host.kernelView(), snapshot: host.snapshotView(), log: db.events(host.worldId).map(publicEvent) };
      void host.enqueue('retire', 'fixture', { soulId, entityId });
      while (host.engine.world.tick < 60) host.tickOnce();
      // Capture fresh JSON values, precisely as a process boundary delivers them.
      return JSON.parse(JSON.stringify({ key, soulId, entityId, marker, owner, projection,
        scene: host.engine.renderScene?.() ?? { scene: null },
        stream: { serverTick: host.engine.world.tick, chunks: host.engine.takeChunks?.(-1) ?? [] } }));
    } finally { db.close(); }
  }) as { key: string; soulId: string; entityId: string; marker: string; owner: unknown; projection: unknown; scene: unknown; stream: unknown }[];
}
