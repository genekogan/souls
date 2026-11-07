// Lane P4 (2026-10-19): the installable-app manifest and head tags, made at build time by vite.config.ts (souls-pwa).
//
// One static file, dist/manifest.webmanifest, served beside every page: each world's server answers
// <world>/manifest.webmanifest and the launcher answers <base>manifest.webmanifest (the world list). Pages link it
// relative to themselves, so a world's page gets /worlds/w/<slug>/manifest.webmanifest, and the relative start_url "./"
// resolves against that URL: an app installed from a world opens that world, and each world installs as its own app
// (id defaults to start_url). Chrome on Android refuses a manifest without a start_url as an app (start-url-not-valid).
// Scope is the release's base (/worlds/ or /), so moving between worlds, the world list and the Clerk sign-in round trip
// stay inside the app. Icons are hashed files in <base>assets/ (absolute URLs; cached like every other asset).

export const PWA_MANIFEST = 'manifest.webmanifest';
export const PWA_COLOR = '#101110';   // the dark page colour (styles.css --bg, dark scheme)

export type PwaIcons = { icon32: string; icon180: string; icon192: string; icon512: string };

export function pwaManifest(base: string, icons: PwaIcons) {
  const at = (f: string) => `${base}assets/${f}`;
  return {
    name: 'Souls',
    short_name: 'Souls',
    description: "Persistent shared worlds where every Soul is run by its owner's own AI agent.",
    start_url: './',
    scope: base,
    display: 'standalone',
    theme_color: PWA_COLOR,
    background_color: PWA_COLOR,
    icons: [
      { src: at(icons.icon192), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: at(icons.icon512), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: at(icons.icon512), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/** The head tags that need built names (the static meta tags are in index.html). */
export function pwaHeadTags(base: string, icons: PwaIcons): string {
  return [
    `<link rel="manifest" href="${PWA_MANIFEST}" />`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${base}assets/${icons.icon32}" />`,
    `<link rel="apple-touch-icon" href="${base}assets/${icons.icon180}" />`,
  ].join('\n    ');
}
