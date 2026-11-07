# Contribution attribution

Record who executed a change, who reviewed it and who authorized its release separately. A GitHub account name,
commit trailer or green check alone does not establish human review. The same convention applies to Claude Code,
Codex and human contributors.

## Current workflow

Git commit author/committer metadata and the authenticated GitHub actor are separate. Work performed through a
maintainer's configured account can appear under that account even when an agent wrote it. Preserve private/noreply
email settings and existing human/source credits. Do not invent accounts, reviewer identities or historical attribution.

The issue claim/checkpoint records the active worker and scope. The PR journal should concisely identify the agent
tool/model when known, the actual review receipt and any maintainer decision being relied on. Record uncertainty
rather than infer a model from the task's requested model. Use existing provider co-author trailers where accurate;
preserve meaningful contribution attribution in squash messages. Do not expose private session links or raw chats.

An automated reviewer is identified as automated. A previous approval applies only within its stated scope; a tool
running as the maintainer does not supply fresh approval. The existing [maintainer gate](agent-workflow.md#the-merge-train)
continues to apply. No attribution policy changes release authority.

## Future automation identity

For shared organization automation, prefer one repository-scoped GitHub App identity over an account for every
temporary worker. Keep the worker/tool details in the journal. Separate execution permissions from maintainer
approval and production authority, and qualify that separation before adopting the identity.

This is a recommendation tracked in [#580](https://github.com/soulsimulation/souls/issues/580), not a claim that an App is
installed or new credentials are provisioned. Existing history is not rewritten for cosmetic attribution changes.
