// The real controller (tools/soul-runtime/run.mjs) on the model-free host: only the host's command differs (#487).
import { fileURLToPath } from 'node:url';
import { main } from '../../soul-runtime/run.mjs';
import { CodexHost } from '../../soul-runtime/codex-host.mjs';

const server = fileURLToPath(new URL('./fake-app-server.mjs', import.meta.url));
class ModelFreeHost extends CodexHost { constructor(options) { super({ ...options, command: process.execPath, args: [server] }); } }
main(process.argv.slice(2), { Host: ModelFreeHost }).catch((e) => { console.error(JSON.stringify({ state: 'blocked', code: e.code ?? 'controller.failure' })); process.exitCode = 1; });
