# Publication privacy

GitHub is a publication boundary, including private repositories. Issues, PRs, comments, reviews, commit messages,
source, docs and release assets must not expose a person's device details. This includes personal absolute or
home-relative paths, local usernames, hostnames, device/private-network IP addresses, SSH targets, local service
URLs, process identifiers and operational resource identifiers. Keep their real mappings in approved private
records, outside git. A reproducible command uses a repository-relative input, an environment variable supplied
privately, or a neutral placeholder. Describe capture environments as isolated baseline/candidate, with hardware
class and measured load when relevant, without identifying the machine.

Before **every** GitHub write or upload, review the exact outgoing payload, including quoted logs, handoffs,
filenames and attachment metadata. Run:

```sh
node tools/proof/publication.mjs .local/outgoing/body.md .local/outgoing/proof.json
```

The checker decodes JSON strings and URI escapes and reports categories without repeating matched values. It does
not accept the source guard's fixture bypass marker. Source tests may use documented synthetic values; outgoing
reports use documentation addresses, neutral placeholders and relative paths. Do not weaken the checker to publish
an actual device value. A successful scan is a backstop, not a privacy certificate: arbitrary usernames, machine
nicknames, unusual encodings and identifiers cannot all be recognized. Manually inspect the final content.

`upload.mjs` preflights text/JSON files for the entire batch before its first upload. Proof checking rejects leaking
PR/issue/proof text without echoing it into the bot comment; generated proof comments are checked again before
output. The mandatory manual check also covers connector/CLI issue, review and comment writes, which do not pass
through the proof uploader. These checks take effect for CI from the checked-out base, after integration.

For media, inspect the whole recording and audible content, browser chrome, overlays, terminal panes and file
metadata. Text scanning cannot inspect pixels, audio or binary container metadata. Capture without private material;
if a recording leaks it, preserve the original privately and publish a newly reviewed derivative with the alteration
disclosed, or re-record. Never label an edited derivative as an untouched original, or discard the failed attempt.

Correct exposed descriptions and comments in place, retaining criteria, actual results, evidence provenance and
failed-attempt disclosures. Do not quote the private value in the cleanup report. Editing current text does not
erase GitHub edit histories, caches, clones, old release assets or Git objects. Rewriting shared history disrupts
commit identities and proof links and requires a separately agreed migration; it is not routine text cleanup.

## Video presentation

The original uncut real-speed MP4 is the motion proof. Put a plainly named **Full-resolution uncut video** link
before each reduced GIF preview, with actual encoded dimensions, duration and source commit. GIF previews are
short, low-resolution pointers and cannot qualify timing, contact or physics. Preserve the original capture
resolution; never upscale a low-resolution capture and claim that it contains more detail. Use a readable camera
framing during new captures, retaining the full action and interruption/release context.
