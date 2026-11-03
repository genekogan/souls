import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { entryPrefetchScript } from './src/snapshot-prefetch.ts';
import { rewritePhasedHtml } from './src/phased-entry.ts';
import { anonymousHello } from '../../packages/client/src/hello.ts';
import { PWA_MANIFEST, pwaHeadTags, pwaManifest, type PwaIcons } from './src/pwa-manifest.ts';
import { changelogHtml } from './src/changelog-page.ts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';

// Lane L3h: a new world's /v1/world/snapshot GET leaves from index.html's head, before any chunk downloads
// (src/snapshot-prefetch.ts); WorldEntityLayer.start takes that response. The workbench page has no world.
// Lane W1: the same script GETs /v1/config and opens the world's socket with the anonymous hello useSim's Connection sends
// (packages/client/src/hello.ts, one definition); the Connection adopts that socket.
function snapshotPrefetch(): Plugin {
  let base = '';
  return {
    name: 'sim-snapshot-prefetch',
    configResolved(c) { base = c.base.replace(/\/+$/, ''); },
    // after <title>: the charset meta stays first, and the script runs before the stylesheet links (a classic script
    // after one would wait for it) and the module script Vite adds to the head
    transformIndexHtml(html, ctx) {
      if (!/(^|\/)index\.html$/.test(ctx.path)) return;
      if (!html.includes('</title>')) throw Error('index.html: no </title> to place the snapshot prefetch after');
      return html.replace('</title>', `</title>\n    <script>${entryPrefetchScript(base, undefined, anonymousHello(true))}</script>`);
    },
  };
}

// t4-phone: with the asset CDN on, index.html opens the CDN's connection at once (DNS, TCP, TLS: ~4 round trips, ~0.6 s
// on a phone's 4G) instead of when the first GLB is asked for, which on a world with models at the arrival is on the
// poster's critical path. Build only; the GLB worker's fetches share the page's connection pool.
function cdnPreconnect(): Plugin {
  return {
    name: 'sim-cdn-preconnect',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      if (!/(^|\/)index\.html$/.test(ctx.path) || process.env.SIM_ASSETS_CDN_ENABLED !== '1') return;
      const origin = new URL(process.env.SIM_ASSETS_CDN_ORIGIN ?? 'https://assets.eden.art').origin;
      if (!html.includes('</title>')) throw Error('index.html: no </title> to place the CDN preconnect after');
      return html.replace('</title>', `</title>\n    <link rel="preconnect" href="${origin}" crossorigin>`);
    },
  };
}

// P7b: index.html loads a world page in two phases where that helps (src/phased-entry.ts): early-entry.ts is its own entry
// (rollupOptions.input `early`); this replaces Vite's module script and modulepreload tags with the loader. Build only.
function phasedEntry(): Plugin {
  return {
    name: 'sim-phased-entry',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler(html, ctx) {
      if (!/(^|\/)index\.html$/.test(ctx.path)) return;
      const chunks = Object.values(ctx.bundle ?? {}).flatMap((c) => (c.type === 'chunk' ? [c] : []));
      const byFile = new Map(chunks.map((c) => [c.fileName, c]));
      const early = chunks.find((c) => c.isEntry && (c.facadeModuleId ?? '').replace(/\\/g, '/').endsWith('/src/early-entry.ts'));
      if (!ctx.chunk || !early) throw Error('index.html: the main or the early entry chunk is missing');
      const imports: string[] = [], seen = new Set<string>();
      const walk = (f: string) => { for (const i of byFile.get(f)?.imports ?? []) if (!seen.has(i)) { seen.add(i); walk(i); imports.push(i); } };
      walk(early.fileName);
      return rewritePhasedHtml(html, ctx.chunk.fileName, early.fileName, imports);
    } },
  };
}

// Lane P4: the installable-app manifest and icons (src/pwa-manifest.ts). Build only, index.html only (the workbench page is
// not an app). Icons (the supplied halo resized to pwa/icon-<size>.png; 32 is the tab favicon) are hashed files in assets/; the manifest is
// dist/manifest.webmanifest, linked relative to the page and served beside every page (world servers and the launcher).
function pwa(): Plugin {
  let base = '/';
  const icons = new Map<string, Buffer>();
  const hashed = (name: string, data: Buffer) => { const file = `${name}-${createHash('sha256').update(data).digest('hex').slice(0, 10)}.png`; icons.set(file, data); return file; };
  let names: PwaIcons;
  return {
    name: 'sim-pwa',
    apply: 'build',
    configResolved(c) {
      base = c.base;
      const png = (n: number) => hashed(`sim-icon-${n}`, readFileSync(fileURLToPath(new URL(`./pwa/icon-${n}.png`, import.meta.url))));
      names = { icon32: png(32), icon180: png(180), icon192: png(192), icon512: png(512) };
    },
    generateBundle() {
      for (const [file, source] of icons) this.emitFile({ type: 'asset', fileName: `assets/${file}`, source });
      this.emitFile({ type: 'asset', fileName: PWA_MANIFEST, source: JSON.stringify(pwaManifest(base, names), null, 1) + '\n' });
    },
    transformIndexHtml(html, ctx) {
      if (!/(^|\/)index\.html$/.test(ctx.path)) return;
      if (!html.includes('</title>')) throw Error('index.html: no </title> to place the app manifest after');
      return html.replace('</title>', `</title>\n    ${pwaHeadTags(base, names)}`);
    },
  };
}

// Issue #388: the public changelog page (changelog.html, served at <base>/changelog by the world launcher) is the repo's
// CHANGELOG.md rendered at build time (src/changelog-page.ts): static HTML, no script, optional reviewed media. A
// CHANGELOG.md with no release headings fails the build. Dev server too, so `vite` shows the same page.
// #393: SIM_CHANGELOG_FILE names another copy to render; the release workflow points it at CHANGELOG.md with the
// shipping release's section already compiled in (tools/changelog/compile.mjs --out), so the page shows that release.
function changelogPage(): Plugin {
  let base = '/';
  const file = process.env.SIM_CHANGELOG_FILE ? resolvePath(process.env.SIM_CHANGELOG_FILE) : fileURLToPath(new URL('../../CHANGELOG.md', import.meta.url));
  const journalFile = fileURLToPath(new URL('../../tools/changelog/public-journal.json', import.meta.url));
  return {
    name: 'sim-changelog-page',
    configResolved(c) { base = c.base; },
    configureServer(server) { server.watcher.add([file, journalFile]); },
    transformIndexHtml(html, ctx) {
      if (!/(^|\/)changelog\.html$/.test(ctx.path)) return;
      return changelogHtml(html, readFileSync(file, 'utf8'), base, JSON.parse(readFileSync(journalFile, 'utf8')));
    },
  };
}

// Lane VENDOR: the chunk graph vendorGroups promises, checked on every build. Phase one (early's static imports) loads no
// phase-two chunk, and no stable chunk (vendor*, app-shared) imports main, whose hash changes with every app change.
function checkChunks(): Plugin {
  return {
    name: 'sim-check-chunks',
    apply: 'build',
    generateBundle(_o, bundle) {
      const chunks = Object.values(bundle).flatMap((c) => (c.type === 'chunk' ? [c] : []));
      const byFile = new Map(chunks.map((c) => [c.fileName, c]));
      const main = chunks.find((c) => c.isEntry && c.name === 'main'), early = chunks.find((c) => c.isEntry && c.name === 'early');
      if (!main || !early) return; // not the app build
      const seen = new Set<string>(), walk = (f: string) => { for (const i of byFile.get(f)?.imports ?? []) if (!seen.has(i)) { seen.add(i); walk(i); } };
      walk(early.fileName);
      const late = [...seen].filter((f) => ['main', 'app-shared'].includes(byFile.get(f)?.name ?? ''));
      if (late.length) throw Error(`vendor chunks: phase one would load ${late.join(', ')}`);
      const inMain = new Set(Object.keys(main.modules));
      for (const c of chunks) if (['vendor', 'app-shared'].includes(c.name) && c.imports.includes(main.fileName)) {
        const edges = Object.keys(c.modules).flatMap((m) => (this.getModuleInfo(m)?.importedIds ?? []).filter((i) => inMain.has(i)).map((i) => `${m} -> ${i}`));
        throw Error(`vendor chunks: ${c.fileName} imports main, so its hash would change with every app change (${edges.slice(0, 5).join('; ')})`);
      }
    },
  };
}

// Lane VENDOR (2026-10-22): caching grain. A chunk's file name carries a hash of its bytes and of the file names it imports,
// so before this one changed line in Shell.tsx renamed main-*.js and every lazy chunk that imports main (~2.35 MB a returning
// visitor downloaded again after each release). Now:
// - `vendor`: three's build, the three examples phase one surely uses, and zod: library code only phase one (early-entry.ts
//   and the early-render.ts it imports) loads, out of give-way-*.js. Same bytes before the arrival card, one more request.
// - `app-shared`: react/react-dom/scheduler and the app modules main shares with lazy chunks and the workbench page, so a
//   lazy chunk imports app-shared, not main; main keeps Shell.tsx and what only it uses. It replaces phase two's former
//   react chunk (same requests). A change to a module in it still renames it and its importers, as before.
// What is eager vs lazy does not change. checkChunks fails the build if phase one would load a phase-two chunk.
type ModuleGraph = { getModuleInfo(id: string): { code: string | null; importers: readonly string[]; importedIds: readonly string[]; dynamicallyImportedIds: readonly string[]; dynamicImporters: readonly string[] } | null };
function vendorGroups() {
  const pkg = (id: string) => id.match(/\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\//)?.[1];
  const isReact = (id: string) => ['react', 'react-dom', 'scheduler'].includes(pkg(id) ?? '');
  const src = (f: string) => fileURLToPath(new URL(`./src/${f}`, import.meta.url));
  let graph: { vendor: (id: string) => boolean; shared: Set<string> } | undefined;
  const sets = (ctx: ModuleGraph) => {
    if (graph) return graph;
    // static closure from `roots`; `follow(id)` lists dynamic imports to follow as well
    const closure = (roots: string[], follow: (id: string, dyn: readonly string[]) => readonly string[] = () => [], stop = new Set<string>(), leaf = (_id: string) => false) => {
      const seen = new Set<string>(), stack = [...roots];
      while (stack.length) {
        const m = stack.pop()!;
        if (seen.has(m) || stop.has(m)) continue;
        const info = ctx.getModuleInfo(m);
        if (!info) continue;
        seen.add(m);
        if (!leaf(m)) stack.push(...info.importedIds, ...follow(m, info.dynamicallyImportedIds));
      }
      return seen;
    };
    const earlyEntry = src('early-entry.ts'), mainEntry = src('main.tsx'), workbench = src('gen-mesh/kits/workbench.ts');
    const isEarlyRender = (m: string) => m.endsWith('/src/early-render.ts');
    // zod and three's build: phase one parses kits and renders, so all of them it reaches is phase one's (the walk also
    // reaches them through barrels); three's examples only when phase one surely imports them
    const inVendor = (m: string) => (pkg(m) === 'zod' || (pkg(m) === 'three' && !m.includes('/examples/'))) ? phaseOne.has(m) : pkg(m) === 'three' && surely.has(m);
    const earlyFollow = (id: string, dyn: readonly string[]) => (id === earlyEntry ? dyn.filter(isEarlyRender) : []);
    // The module graph keeps edges the bundle's tree-shaking drops, so it over-states what phase one loads: a barrel's
    // unused re-exports (phase one imports @sim/world-compiler's index, which re-exports core-kit.ts, which main loads), and
    // modules something imports dynamically. `phaseOne` (walk into both) is a superset of the truth: nothing in it leaves
    // for a phase-two chunk. `surely` (walk into neither) is what phase one certainly loads.
    const every = closure([mainEntry, earlyEntry, workbench], (_id, dyn) => dyn);
    const lazyRoots = [...every].filter((m) => (ctx.getModuleInfo(m)?.dynamicImporters.length ?? 0) > 0 && !isEarlyRender(m));
    const stop = new Set(lazyRoots);
    const barrel = (m: string) => { const c = ctx.getModuleInfo(m)?.code; return !!c && /\bfrom\b/.test(c) && c.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replace(/export\s[^;]*?\sfrom\s*["'][^"']+["'];?/g, '').trim() === ''; };
    const phaseOne = closure([earlyEntry], earlyFollow);
    const surely = closure([earlyEntry], earlyFollow, stop, barrel);
    const main = closure([mainEntry], undefined, stop);
    if (surely.size < 10 || main.size < 50) throw Error(`vendor chunks: entry module graphs not found (${surely.size}, ${main.size} modules)`);
    // Shell.tsx is the app itself (most of main): the one lazy chunk that imports it (the 0.5 KB PrivyAuth stub) keeps
    // importing main and changes with it, rather than Shell and all it imports leaving main for app-shared.
    const lazy = closure([workbench, ...lazyRoots.filter((m) => !main.has(m) && !phaseOne.has(m))], undefined, new Set([src('Shell.tsx')]));
    const shared = new Set([...lazy].filter((m) => main.has(m) && !phaseOne.has(m)));
    // app-shared must not import main: a candidate that imports a module whose chunk is unsure (not app-shared, not surely
    // phase one, not a vendor chunk) stays in main, and so do the candidates that import it.
    const vendorPkg = (m: string) => isReact(m) || inVendor(m);
    const out = [...shared].filter((m) => ctx.getModuleInfo(m)!.importedIds.some((i) => !shared.has(i) && !surely.has(i) && !vendorPkg(i)));
    while (out.length) { const m = out.pop()!; if (shared.delete(m)) out.push(...ctx.getModuleInfo(m)!.importers.filter((i) => shared.has(i))); }
    return (graph = { vendor: inVendor, shared });
  };
  return [
    { name: (id: string, ctx: ModuleGraph) => (sets(ctx).vendor(id) ? 'vendor' : null), priority: 3 },
    { name: (id: string, ctx: ModuleGraph) => (sets(ctx).shared.has(id) || isReact(id) ? 'app-shared' : null), priority: 1, includeDependenciesRecursively: false },
  ];
}

// PERF-EDEN: with SIM_DEV_API set, a world page carries the live world's inline config (apps/server/src/inline-config.ts
// writes `window.__simConfig` into <head>; without it the page takes `eden` for an old-engine world and never mounts the
// entity layer). The page is read from Vite (dev) or dist (preview) and the remote /v1/config is inlined the same way.
function remoteInlineConfig(): Plugin {
  const remote = process.env.SIM_DEV_API?.replace(/\/+$/, '');
  const serve = (html: (url: string) => Promise<string | null>) => async (req: { url?: string; method?: string }, res: { setHeader(k: string, v: string): void; end(b: string): void }, next: () => void) => {
    const m = req.method === 'GET' ? /^\/w\/([^/?#]+)\/?(?:[?#].*)?$/.exec(req.url ?? '') : null;
    if (!remote || !m) return next();
    try {
      const r = await fetch(`${remote}/w/${m[1]}/v1/config`); const config = r.ok ? await r.json() : null;
      const page = await html(req.url!); if (page === null) return next();
      const json = JSON.stringify(config).replace(/</g, '\\u003c');
      const at = page.search(/<head[^>]*>/i), end = page.indexOf('>', at) + 1;
      res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(at < 0 || !config ? page : page.slice(0, end) + `<script>window.__simConfig=${json}</script>` + page.slice(end));
    } catch { next(); }
  };
  return {
    name: 'sim-remote-inline-config',
    configureServer(server) { if (remote) server.middlewares.use(serve(async (url) => server.transformIndexHtml(url, readFileSync(resolvePath(server.config.root, 'index.html'), 'utf8')))); },
    configurePreviewServer(server) { if (remote) server.middlewares.use(serve(async () => { try { return readFileSync(resolvePath(server.config.root, server.config.build.outDir, 'index.html'), 'utf8'); } catch { return null; } })); },
  };
}

// `pnpm dev` (issue #395): Vite serves the page and hands the server's routes to the server on PORT (the server's own
// variable, default 4500; WEB_PORT moves Vite off :5173). Under a world's path (/w/toy/) everything but the page itself is
// the server's: /w/toy/v1/config, the socket. At the root: the API, and the Mars web assets the server serves from
// mars/viewer/dist/client (src/mars-static.ts), among them the people's character set under /modular.
// PERF-EDEN: `SIM_DEV_API=https://souls.game pnpm --filter @sim/web dev` points the same proxy at a deployed site, so a local
// build can be measured against a live world (as an anonymous visitor) without copying its data.
function devProxy() {
  // One RegExp key (a key starting with ^ is one) matching whole path segments: /history/… goes to the server, a page
  // /history-x stays with Vite.
  const roots = 'v1|__sim|skill\\.md|cards\\.md|mcp|healthz|modular|mars-assets|engine|models|history|2020|browser|data/manifest\\.json';
  const remote = process.env.SIM_DEV_API?.replace(/\/+$/, '');
  if (remote) { const opts = { target: remote, changeOrigin: true, secure: true, ws: true }; return { '^/w/[^/]+/[^?]+': opts, [`^/(?:${roots})(?:[/?]|$)`]: opts, '^/ws(?:[/?]|$)': opts }; }
  const http = `http://127.0.0.1:${process.env.PORT ?? 4500}`;
  return { '^/w/[^/]+/[^?]+': { target: http, ws: true }, [`^/(?:${roots})(?:[/?]|$)`]: http, '^/ws(?:[/?]|$)': { target: http.replace(/^http/, 'ws'), ws: true } };
}

export default defineConfig({
  plugins: [snapshotPrefetch(), cdnPreconnect(), pwa(), phasedEntry(), checkChunks(), changelogPage(), react(), remoteInlineConfig()],
  define: { __BUILD__: JSON.stringify(process.env.BUILD_ID ?? 'dev'), __SIM_ARRIVAL_ENABLED__: process.env.SIM_ARRIVAL_UI_ENABLED==='1', __SIM_GOATCOUNTER__: JSON.stringify(process.env.SIM_GOATCOUNTER ?? 'simeden'),
    __SIM_ASSETS_CDN_ENABLED__: process.env.SIM_ASSETS_CDN_ENABLED==='1',
    // CDN4: god uploads via the pull-through Worker on assets.eden.art/w/* (default on; needs the CDN switch above)
    __SIM_GOD_UPLOADS_CDN__: process.env.SIM_GOD_UPLOADS_CDN!=='0',
    __SIM_ASSETS_CDN_ORIGIN__: JSON.stringify(process.env.SIM_ASSETS_CDN_ORIGIN ?? 'https://assets.eden.art') },
  server: { port: Number(process.env.WEB_PORT ?? 5173), proxy: devProxy() },
  preview: { port: Number(process.env.WEB_PORT ?? 5173), proxy: devProxy() },   // PERF-EDEN: `vite preview` serves a production build through the same proxy (SIM_DEV_API: a live world)
  // W1: standalone world-free studio, served by /god/workbench.
  // chunkSizeWarningLimit (kB, lane BUDGET 2026-10-22): just above the largest legitimate chunk, core-kit (1,491 kB raw /
  // 221 kB gzip on 3.62: the shared three.js + catalogue kit every world loads), so any chunk past it warns at build time.
  // The hard limit is the release gate's V3-bundle step (tools/test-harness/bundle-budget): +10% per chunk or total fails.
  build: { manifest: true, chunkSizeWarningLimit: 1600, rollupOptions: { input: { main: 'index.html', workbench: 'workbench.html', contextView: 'context-view.html', changelog: 'changelog.html', early: 'src/early-entry.ts' },
    output: { codeSplitting: { groups: vendorGroups() } } } },
});
