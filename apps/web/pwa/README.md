# Souls halo icons

The favicon and installable-app PNGs are resized from the supplied halo image, preserved as the CDN-backed `apps/web/src/media/halo-social.png` in `tools/assets/manifest.json`. Resize that source to the filename's dimensions when regenerating them. The header uses `halo-transparent.png`, a transparent extraction of the same mark; its glow is preserved on light and dark backgrounds.

The launcher serves Worlds at `/` directly. Its loading and error states never render legacy cards. `/old` redirects directly to Worlds; no legacy cards are shipped.
