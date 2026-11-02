# Public visual journals

`public-journal.json` is the reviewed public projection for the static `/changelog` page. It is independent of the
private owner board. `changes/*.md` and the compiled `CHANGELOG.md` remain authoritative release notes; the web build
rejects an entry unless its exact version and release date match a compiled release. Do not add an unreleased entry
before its release section exists. Removing media does not remove the release notes.

Each entry explicitly names `id`, `version`, `date`, `title`, `result`, `limitations`, `source` and `media`. The id is a
stable lowercase hyphenated slug, unique within its release. Its anchor is `v<version>-journal-<id>`. Source fields
are a public repository PR/commit/release URL, exact original 40-character commit, capture date and environment
(`historical-test`, `isolated-test` or `production`). The environment describes the capture, not deployment status.
Historical branch footage must state that it does not establish production verification. Describe excerpts and
other limitations explicitly. Do not present an illustrative still as motion proof.

Media fields are `kind` (`video` or `image`), `url`, optional `poster`, `alt` and `status` (`available` or `retired`).
Available video requires an existing reviewed poster; MP4 playback has native controls, inline phone support and
`preload="none"`. There is no autoplay or page script. Images use lazy loading. The poster may load on the changelog;
world arrival imports neither the publication input nor these media. Retired entries render text and provenance
without media elements. For a newly broken link, retain the entry id/source and set `status` to `retired` until it
is repaired; the page always retains a text fallback. There is no runtime availability probe or GitHub/API fetch.

URLs must be canonical HTTPS, without credentials, nondefault port, query or fragment. Media is restricted to
`https://assets.eden.art/public-journal/…` or this repository's `releases/download/proofs/…` assets. Source links are
restricted to this repository's PRs, exact commits or release tags. Unknown fields fail the build. All prose is
escaped, including captions. These checks do not replace human publication review: never copy private board cards,
plans, transcripts, host paths, account information, credentials, failed or rejected proof into the input.

Before publication, review original source/run acceptance, capture identity/date, rights, privacy and limitations;
verify the selected existing media URLs actually play and the poster is suitable. Keep the complete source map and
rejected takes private. A continuous excerpt may illustrate a released feature, but must not be relabeled as an
uncut complete take or production verification. Do not create substitute historical footage to fill a gap.

Run `node --test apps/web/src/changelog-page.test.ts` and the web build. Review desktop and phone release → journal →
media → return with real input; record proof through the repo proof workflow. Public publication does not depend on
a live owner-board request. An empty array remains valid for text-only releases.
