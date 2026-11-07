#!/usr/bin/env node
// Operator commands for a running world launcher, from the machine it runs on (the launcher refuses them through a
// reverse proxy: only direct loopback requests are accepted). No credentials are involved or read.
//
//   node tools/world-launcher/op.mjs create-world --port 4620 [--base /worlds] --name "Little Martians (Arium)"
//        --template littlemartians-two (--owner <account id> | --owner-of <slug of a world that account owns>) [--god-name <shown name>] [--slug <slug>] [--unlisted]
//   node tools/world-launcher/op.mjs register-fork --port 4620 [--base /worlds] --slug eden|mars|littlemartians
//        --descriptor <abs fork.json> [--accounts <abs accounts.sqlite>] [--name <shown name>]
//   node tools/world-launcher/op.mjs remove-fork --port 4620 [--base /worlds] --slug <slug>      (its data stays)
//   node tools/world-launcher/op.mjs set-claimable --port 4620 [--base /worlds] --slug <slug> --claimable false
//        (a world with no god that nobody may claim: the homepage stops saying "open it to claim it")
//   node tools/world-launcher/op.mjs set-unlisted --port 4620 [--base /worlds] --slug <slug> --unlisted true|false
//   node tools/world-launcher/op.mjs set-heap --port 4620 [--base /worlds] --slug <slug> --mb 2048|default   (heap from its next boot)
//   node tools/world-launcher/op.mjs set-read-workers --port 4620 [--base /worlds] --slug <slug> --n 0-4|default   (Stage B read workers, next boot)
//        (left out of the public world list, still served at its URL; bench worlds and "… (scratch)" names default to true)
//   node tools/world-launcher/op.mjs archive-world --port 4620 [--base /worlds] --slug <slug> [--reason <text>]
//        (stops it, moves its data to <data>/archive/<id>/world, unregisters it; nothing is deleted)
//   node tools/world-launcher/op.mjs restore-world --port 4620 [--base /worlds] --id <id from list-archive>
//   node tools/world-launcher/op.mjs list-archive --port 4620 [--base /worlds]
//   node tools/world-launcher/op.mjs audit --port 4620 [--base /worlds] [--slug <slug>]
//   node tools/world-launcher/op.mjs client-errors --port 4620 [--base /worlds] [--world <slug>] [--limit N]
//        (what visitors' pages reported: top errors by count, world, browser, first/last seen, build; client-errors.mjs)
//   node tools/world-launcher/op.mjs glitches --port 4620 [--base /worlds] [--world <slug>] [--limit N]
//        (every world's recoveries and halts by rule and rung, from each store; --world adds its records with their evidence)
//   node tools/world-launcher/op.mjs set-test --port 4620 [--base /worlds] --slug <slug> --test true|false
//        (a scratch world operator TEST-Soul commands may use; product worlds and old-world forks are refused)
//   node tools/world-launcher/op.mjs soul-pending --port 4620 [--base /worlds] --slug <test world>
//   node tools/world-launcher/op.mjs soul-approve --port 4620 [--base /worlds] --slug <test world> --request <ap_…> --name <TestName>
//   node tools/world-launcher/op.mjs soul-message --port 4620 [--base /worlds] --slug <test world> --soul <s_…> --name <TestName> --text <text>
//   node tools/world-launcher/op.mjs soul-inbox   --port 4620 [--base /worlds] --slug <test world> --soul <s_…> --name <TestName>
//   node tools/world-launcher/op.mjs soul-delete  --port 4620 [--base /worlds] --slug <test world> --soul <s_…> --name <TestName>
//   node tools/world-launcher/op.mjs god-pending  --port 4620 [--base /worlds] --slug <test world>
//   node tools/world-launcher/op.mjs god-approve  --port 4620 [--base /worlds] --slug <test world> --code <pairing code>
//     (the owner's god pairing on a scratch test world with no Souls a person owns: the release probe's own god folder)
//        (lane OPS2: TEST Souls only, so lanes can test Soul flows unattended: a TEST name is "Test" + a capital, digit or
//        separator, or "test-…"; approve refuses a request sent to a person's window, a repair, or a deny-listed name
//        (Kwyjibo); message/inbox/delete reach only Souls an operator approved (owner op:test-operator), by name + id.
//        The message goes into the inbox exactly as the browser card sends it. Every use is an audit row, by operator.)
//
// create-world: the world is born owned by that existing account (its god), exactly as if that person had created it signed in.
// register-fork: serve the copy of an old world already in <data>/worlds/<slug>/sim.db under <base>/w/<slug> (lane FORKS).
const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const cmd = argv[0];
const usage = () => {
  console.error('usage: op.mjs create-world --port <launcher port> [--base /worlds] --name <name> --template <id> (--owner <account id> | --owner-of <slug>) [--god-name <name>] [--slug <slug>] [--unlisted]\n'
    + '       op.mjs register-fork --port <launcher port> [--base /worlds] --slug <eden|mars|littlemartians> --descriptor <abs path> [--accounts <abs path>] [--name <name>]\n'
    + '       op.mjs remove-fork --port <launcher port> [--base /worlds] --slug <slug>\n'
    + '       op.mjs set-claimable --port <launcher port> [--base /worlds] --slug <slug> --claimable true|false\n'
    + '       op.mjs set-unlisted --port <launcher port> [--base /worlds] --slug <slug> --unlisted true|false\n'
    + '       op.mjs set-limits --port <launcher port> [--base /worlds] --slug <slug> --limits \'{"worldBudgetRps":20,"ipListen":null}\'\n'
    + '       op.mjs set-heap --port <launcher port> [--base /worlds] --slug <slug> --mb <256-8192|default>\n'
    + '       op.mjs set-read-workers --port <launcher port> [--base /worlds] --slug <slug> --n <0-4|default>\n'
    + '       op.mjs resume-world --port <launcher port> [--base /worlds] --slug <slug>   (a world held after 5 failures in 30 min)\n'
    + '       op.mjs archive-world --port <launcher port> [--base /worlds] --slug <slug> [--reason <text>]\n'
    + '       op.mjs restore-world --port <launcher port> [--base /worlds] --id <archive id>\n'
    + '       op.mjs list-archive --port <launcher port> [--base /worlds]\n'
    + '       op.mjs audit --port <launcher port> [--base /worlds] [--slug <slug>]\n'
    + '       op.mjs glitches --port <launcher port> [--base /worlds] [--world <slug>] [--limit N]\n'
    + '       op.mjs set-test --port <launcher port> [--base /worlds] --slug <slug> --test true|false\n'
    + '       op.mjs soul-pending --port <launcher port> [--base /worlds] --slug <test world>\n'
    + '       op.mjs soul-approve --port <launcher port> [--base /worlds] --slug <test world> --request <ap_id> --name <TestName>\n'
    + '       op.mjs soul-message|soul-inbox|soul-delete --port <launcher port> [--base /worlds] --slug <test world> --soul <s_id> --name <TestName> [--text <text> (soul-message)]\n'
    + '       op.mjs god-pending --port <launcher port> [--base /worlds] --slug <test world>\n'
    + '       op.mjs god-approve --port <launcher port> [--base /worlds] --slug <test world> --code <pairing code>');
  process.exit(2);
};
if (cmd === 'glitches' && flag('port')) {
  const q = new URLSearchParams({ ...(flag('world') ? { world: flag('world') } : {}), ...(flag('limit') ? { limit: flag('limit') } : {}) });
  const r = await fetch(`http://127.0.0.1:${Number(flag('port'))}${(flag('base') ?? '').replace(/\/$/, '')}/__sim/glitches?${q}`, { signal: AbortSignal.timeout(30_000) });
  console.log(JSON.stringify(await r.json().catch(() => ({ status: r.status })), null, 2)); process.exit(r.ok ? 0 : 1);
}
if (cmd === 'client-errors' && flag('port')) {
  const q = new URLSearchParams({ ...(flag('world') ? { world: flag('world') } : {}), ...(flag('limit') ? { limit: flag('limit') } : {}) });
  const r = await fetch(`http://127.0.0.1:${Number(flag('port'))}${(flag('base') ?? '').replace(/\/$/, '')}/__sim/client-errors?${q}`, { signal: AbortSignal.timeout(30_000) });
  console.log(JSON.stringify(await r.json().catch(() => ({ status: r.status })), null, 2)); process.exit(r.ok ? 0 : 1);
}
let body;
if (cmd === 'create-world') {
  if (!flag('port') || !flag('name') || !flag('template') || !(flag('owner') || flag('owner-of'))) usage();
  body = { name: flag('name'), template: flag('template'), ...(flag('owner') ? { owner: flag('owner') } : { ownerOf: flag('owner-of') }), ...(flag('god-name') ? { godName: flag('god-name') } : {}), ...(flag('slug') ? { slug: flag('slug') } : {}), ...(argv.includes('--unlisted') ? { unlisted: true } : {}) };
} else if (cmd === 'register-fork') {
  if (!flag('port') || !flag('slug') || !flag('descriptor')) usage();
  body = { slug: flag('slug'), descriptor: flag('descriptor'), ...(flag('accounts') ? { accounts: flag('accounts') } : {}), ...(flag('name') ? { name: flag('name') } : {}) };
} else if (cmd === 'set-claimable') {
  if (!flag('port') || !flag('slug') || !['true', 'false'].includes(flag('claimable'))) usage();
  body = { slug: flag('slug'), claimable: flag('claimable') === 'true' };
} else if (cmd === 'set-unlisted') {
  if (!flag('port') || !flag('slug') || !['true', 'false'].includes(flag('unlisted'))) usage();
  body = { slug: flag('slug'), unlisted: flag('unlisted') === 'true' };
} else if (cmd === 'set-limits') {
  if (!flag('port') || !flag('slug') || !flag('limits')) usage();
  body = { slug: flag('slug'), limits: JSON.parse(flag('limits')) };
} else if (cmd === 'set-heap') {
  if (!flag('port') || !flag('slug') || !flag('mb')) usage();
  body = { slug: flag('slug'), worldHeapMb: flag('mb') === 'default' ? null : Number(flag('mb')) };
} else if (cmd === 'set-read-workers') {
  if (!flag('port') || !flag('slug') || !flag('n')) usage();
  body = { slug: flag('slug'), readWorkers: flag('n') === 'default' ? null : Number(flag('n')) };
} else if (cmd === 'resume-world') {
  if (!flag('port') || !flag('slug')) usage();
  body = { slug: flag('slug') };
} else if (cmd === 'archive-world') {
  if (!flag('port') || !flag('slug')) usage();
  body = { slug: flag('slug'), ...(flag('reason') ? { reason: flag('reason') } : {}) };
} else if (cmd === 'restore-world') {
  if (!flag('port') || !flag('id')) usage();
  body = { id: flag('id') };
} else if (cmd === 'list-archive') {
  if (!flag('port')) usage();
  body = {};
} else if (cmd === 'audit') {
  if (!flag('port')) usage();
  body = flag('slug') ? { slug: flag('slug') } : {};
} else if (cmd === 'remove-fork') {
  if (!flag('port') || !flag('slug')) usage();
  body = { slug: flag('slug') };
} else if (cmd === 'set-test') {
  if (!flag('port') || !flag('slug') || !['true', 'false'].includes(flag('test'))) usage();
  body = { slug: flag('slug'), test: flag('test') === 'true' };
} else if (cmd === 'soul-pending') {
  if (!flag('port') || !flag('slug')) usage();
  body = { slug: flag('slug') };
} else if (cmd === 'soul-approve') {
  if (!flag('port') || !flag('slug') || !flag('request') || !flag('name')) usage();
  body = { slug: flag('slug'), approvalId: flag('request'), name: flag('name') };
} else if (['soul-message', 'soul-inbox', 'soul-delete'].includes(cmd)) {
  if (!flag('port') || !flag('slug') || !flag('soul') || !flag('name') || (cmd === 'soul-message' && !flag('text'))) usage();
  body = { slug: flag('slug'), soulId: flag('soul'), name: flag('name'), ...(cmd === 'soul-message' ? { text: flag('text') } : {}) };
} else if (cmd === 'god-pending') {
  if (!flag('port') || !flag('slug')) usage();
  body = { slug: flag('slug') };
} else if (cmd === 'god-approve') {
  if (!flag('port') || !flag('slug') || !flag('code')) usage();
  body = { slug: flag('slug'), code: flag('code') };
} else usage();
const base = (flag('base') ?? '').replace(/\/$/, '');
const r = await fetch(`http://127.0.0.1:${Number(flag('port'))}${base}/__sim/op/${cmd}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) });
const d = await r.json().catch(() => ({}));
console.log(JSON.stringify({ status: r.status, ...d }, null, 2));
process.exit(r.ok ? 0 : 1);
