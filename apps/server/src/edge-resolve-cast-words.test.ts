// #1152: on main's strict contract a Soul's agent asks `resolve` in its owner's words. In #1098's live runs, a bare place word
// answered capability.unknown although the walk was offered, and two seats told their owner the orchard doesn't exist.
// The words below are the S3 casts' own lines and what the seats sent. Hello-hamlet, a real genesis: fixtures have no ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import {bootEden} from '../test/eden-capabilities-timing.ts';

const hamlet = new URL('../../../worlds/templates/hello-hamlet.json', import.meta.url);

test('#1152: words that name a place resolve to its walk; the casts\' own lines reach the same walk', {timeout: 300000}, async t => {
  const w = await bootEden(() => {}, hamlet); t.after(w.close);
  const walks: Record<string, string> = {
    // what the seats sent
    orchard: 'walk:flag-orchard', 'reading room': 'walk:lab-reading-room',
    // the casts' lines
    'stop by the orchard first': 'walk:flag-orchard', 'go on to the pond hall': 'walk:lab-pond-hall', 'could you pop into the reading room?': 'walk:lab-reading-room',
    'walk over to the orchard, please': 'walk:flag-orchard', 'please walk over to the orchard': 'walk:flag-orchard', 'walk to the pond hall': 'walk:lab-pond-hall', "that's all, now walk to the pond hall": 'walk:lab-pond-hall',
    // the same word, however it's put
    'the orchard': 'walk:flag-orchard', 'to the orchard': 'walk:flag-orchard', 'pond hall': 'walk:lab-pond-hall', 'waterside hall': 'walk:lab-pond-hall', cottage: 'walk:cottage', pond: 'walk:pond',
  };
  for (const [words, id] of Object.entries(walks)) {
    const r = w.edge.intents.dryRun(w.soul, {capability: words}) as any;
    assert.equal(r.would?.capability, id, `${words}: ${JSON.stringify(r).slice(0, 300)}`);
  }
});

test('#1152: the casts\' bench lines name the bench, for a Soul that isn\'t beside it', {timeout: 300000}, async t => {
  const w = await bootEden(() => {}, hamlet); t.after(w.close);
  for (const words of ['sit on the bench outside the cottage', 'please go and sit on the bench outside the cottage for a while']) {
    const r = w.edge.intents.dryRun(w.soul, {capability: words}) as any;
    assert.deepEqual(r.did_you_mean?.map((d: {id: string}) => d.id) ?? [r.would?.capability], ['sit:cottage/part-outdoor-bench'], `${words}: ${JSON.stringify(r).slice(0, 300)}`);
  }
});

test('#1152: words that name no place are still refused, and resolving does nothing', {timeout: 300000}, async t => {
  const w = await bootEden(() => {}, hamlet); t.after(w.close);
  for (const [words, code] of [['nowhere-at-all', 'capability.unknown'], ['lovely morning!', 'capability.unknown'], ['do a backflip', 'capability.unknown'], ['bake bread', 'capability.unknown'], ['fly up to the pond hall', 'ride.unavailable'], ['room', 'capability.unknown']] as const) {
    const r = w.edge.intents.dryRun(w.soul, {capability: words}) as any;
    assert.equal(r.ok, false, `${words}: ${JSON.stringify(r).slice(0, 200)}`); assert.equal(r.code, code, words);
  }
  assert.equal((w.edge.intents.dryRun(w.soul, {capability: 'wave'}) as any).would?.capability, 'wave:here', 'a verb stays a verb');
  assert.equal((w.edge.intents.dryRun(w.soul, {capability: 'dance'}) as any).would?.capability, 'dance:here');
  assert.equal((w.edge.intents.dryRun(w.soul, {capability: 'sit down'}) as any).would?.capability?.startsWith('walk:'), false, 'two words of a verb aren\'t a place');
  // a refusal from resolve names what can be done instead, as act's does: that's where a strict client meets it
  const fly = w.edge.intents.dryRun(w.soul, {capability: 'fly up to the pond hall'}) as any;
  assert.equal(fly.alternatives?.[0]?.id, 'walk:lab-pond-hall', JSON.stringify(fly).slice(0, 300));
  assert.ok(JSON.stringify({alternatives: fly.alternatives}).length <= 600, 'bounded bytes');
  // an older client's act on words isn't this path: it stays as it was
  const before = (w.db.db.prepare('SELECT COUNT(*) n FROM edge_receipts_v1').get() as {n: number}).n;
  w.edge.intents.dryRun(w.soul, {capability: 'orchard'});
  assert.equal((w.db.db.prepare('SELECT COUNT(*) n FROM edge_receipts_v1').get() as {n: number}).n, before, 'no receipt from a dry run');
});
