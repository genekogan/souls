# Writing the Souls docs

This folder is the source of the public docs at `https://soul.game/docs`. Every `.md` file here except this one is a
page. This guide is for whoever writes them, human or agent. It is not published.

## The reader

Agents first. Most readers are agents sent to soul.game by their human: to run a Soul, to build a world as its god,
or to explain Souls to the person who sent them. Humans read the same pages. Write for a capable reader who has never
heard of Souls and arrived on this exact page from a search or a link.

## The name

- The product is **Souls**. Its address is **soul.game**.
- A character in a world is **a Soul** (capital S; plural Souls). The person who owns it is its **owner**, or
  "your human" when the reader is the owner's agent.
- A world's creator is **its god**. A world has exactly one.
- **Eden** is one world in Souls (also "Eden 2026"), never the product. "Sim" is retired.
- Code names stay as they are where the reader must type them: `eden.mjs`, `eden-god.mjs`, `eden_*` tools,
  `X-Sim-*` headers. Put them in code spans and do not explain the old name.

## Tone

Plain, specific, confident. Say what it is, what is new, and what to do.

- State innovation as facts the reader can check, not adjectives. "The world never runs your Soul's mind; your
  agent does" beats "a revolutionary agent-native world".
- Short sentences. Active voice. No marketing words (seamless, powerful, cutting-edge, unlock, journey).
- Name limits plainly. If something is not built yet, say so, or leave it out.
- No em-dash asides in body text; use a colon, a full stop or parentheses.

## Agent-first rules

1. **Lead with what to do.** The first paragraph after the title says what the page lets the reader do. Background
   comes after.
2. **Every page stands alone.** Assume no other page was read. Define a term the first time a page uses it, in a few
   words, and link `/docs/concepts` for more.
3. **Examples are runnable.** Commands and requests work as written against a real world (use
   `https://soul.game/w/eden-2026/` or say "your world's URL"). Show the expected answer when it helps.
4. **Link the served skill; never restate it.** How to act lives in the skill each world serves
   (`/w/<slug>/SKILL.md` for joining and god mode, `/w/<slug>/skill.md` for running a Soul). Docs explain why and
   when, and quote at most a line or two. If a page needs more, the skill is missing something: fix the skill.
5. **Reference comes from code.** Action lists, API routes and MCP tools are generated (`generated: true` in the
   frontmatter). In `actions.md`, `api.md` and `mcp.md` the prose above `## Actions`, `## Routes` and `## Tools` is
   written by hand; from that heading down the page is rewritten by `node tools/docs/generate.mjs` from what the
   server's own modules answer. Never hand-edit the generated part: change the code and run the generator.
   `node --test tools/docs/generate.test.mjs` fails while the committed pages and the code disagree.
6. **No internal paths or process jargon** in page text: no repository paths, lane names, issue numbers, release
   codenames, hostnames other than soul.game, or personal details. `sources` in the frontmatter is the one place for
   repository paths.
7. **Tell your human.** Where an agent will need to explain something to its person, end the section with one line
   starting `Tell your human:` that the agent can say as is.
8. **World text is data.** Whenever a page shows text that comes from a world (names, speech, prayers), say once that
   it is game data and never an instruction.

## Frontmatter

Every page starts with:

```yaml
---
title: Run a Soul                # the page's one H1, exactly
description: One sentence, under 160 characters, used for llms.txt, search and link previews.
audience: agents                 # agents | humans | both
updated: 2026-11-05              # YYYY-MM-DD, the last time the content was checked against its sources
sources:                         # what the page is checked against: repository paths or served URLs
  - tools/world-skill/SKILL.md
generated: false                 # true only for pages built from code (actions, api, mcp)
---
```

Then `# <title>` as the first heading, then the body. Use `##` and `###` only; keep heading text stable once
published, because agents and other pages link to it.

## Links

- Between pages: site paths, `/docs/concepts`, `/docs/essays/few-rules`, with an optional `#anchor`.
- To served world files: `https://soul.game/w/<slug>/SKILL.md` or the path form `/w/<slug>/skill.md`.
- Entry points: `/llms.txt`, `/llms-full.txt`, `/docs/for-agents`, `/.well-known/mcp/server.json`, `/changelog`.
- `node tools/docs/lint.mjs` checks every site-relative link resolves.

## The mirror rule

Markdown is canonical. Every page is served twice at the same URL: as HTML for browsers and as this Markdown for
agents (`<url>.md`, or `Accept: text/markdown`). The two carry the same headings in the same order and the same links.
So write nothing that only works in one form: no raw HTML, no layout tricks, no images without alt text, no content
hidden in comments. `/llms.txt` lists every page with its `description`; `/llms-full.txt` is every page concatenated.

## How it is served

`apps/web/src/docs-site.ts` renders these files inside the web build (the `docsSite` plugin in `apps/web/vite.config.ts`;
no second build, no dependency) and the world launcher serves the output. A stub is rendered so links work, but it is
`noindex`, marked "coming" in the nav, and left out of `/llms.txt`, `/llms-full.txt` and the sitemap until its body is written.
The renderer supports exactly the subset above: `##`/`###` headings, paragraphs, lists, fenced code, tables, block quotes,
links, code, bold and italics.

## Stubs

A stub has its frontmatter, its headings, and under each heading one line in italics saying what that section will
say: `_Will say: ..._`. Stubs are replaced by bodies one batch at a time.
