// A deterministic, bounded projection. Raw GitHub bodies and comments never enter the served snapshot.
export const REPO = 'soulsimulation/souls';
export const DEFAULT_ISSUES = [26, 415, 556, 560, 577, 583];
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Open issues carrying these labels join the initial cards, in this order: decisions waiting on the maintainer, then
// tracking epics. `agent:claimed` is not one: claims outlive work, and stale claims would crowd out the epics.
export const POPULATION_LABELS = ['needs:gene', 'type:epic'];
export const MAX_ITEMS = 30;
/** The issues to collect: the initial records, then each label's issues newest first (label order is priority), without
 *  duplicates, at most `max`. A cap drops the oldest epics, never the initial records or a pending decision first. */
export function selectIssues(defaults = DEFAULT_ISSUES, labelled = [], max = MAX_ITEMS) {
  const numbers = labelled.flatMap(list => (Array.isArray(list) ? list : []).map(i => typeof i === 'number' ? i : i?.number).filter(Number.isSafeInteger).sort((a, b) => b - a));
  return [...new Set([...defaults, ...numbers])].slice(0, max);
}
const STATES = ['planned', 'active', 'blocked', 'ready for review', 'merged', 'released', 'live-verified'];
const text = (v, max = 600) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, max) : null;
export const timestamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
export function recordUrl(v) {
  // Only source journals on this repository. Arbitrary URLs/media, credentials and query tokens are never exported.
  return typeof v === 'string' && /^https:\/\/github\.com\/(?:soulsimulation|genekogan)\/souls\/(?:issues\/\d+(?:#issuecomment-\d+)?|pull\/\d+(?:#(?:issuecomment|discussion_r)-\d+)?|releases\/tag\/[a-zA-Z0-9._-]+|commit\/[a-f0-9]{7,40})$/.test(v) ? v : null;
}
export function checkpointFrom(comments = [], observedAt, trustedAuthors = ['genekogan']) {
  const found = [];
  for (const c of comments.slice(-100)) {
    if (c.isMinimized || !(['OWNER', 'MEMBER', 'COLLABORATOR'].includes(c.authorAssociation) || trustedAuthors.includes(c.author?.login))) continue;
    const matches = [...String(c.body ?? '').matchAll(/```ops-checkpoint\s*\n([\s\S]*?)\n```/g)];
    for (const match of matches) {
      try {
        const v = JSON.parse(match[1]), updatedAt = timestamp(c.updatedAt), at = timestamp(v.at);
        if (!at || updatedAt && Date.parse(at) > Date.parse(updatedAt) + 60_000 || Date.parse(at) > Date.parse(observedAt) + 60_000 || !STATES.includes(v.state) || !text(v.changed) || !text(v.next)) continue;
        const eta = v.eta && text(v.eta.range) && text(v.eta.basis) && ['low', 'medium', 'high', 'unknown'].includes(v.eta.confidence)
          ? { range: text(v.eta.range, 160), confidence: v.eta.confidence, basis: text(v.eta.basis, 300), covers: text(v.eta.covers, 160) } : null;
        found.push({ at, state: v.state, changed: text(v.changed), next: text(v.next), blocker: text(v.blocker), eta,
          branch: text(v.branch, 200), sha: /^[a-f0-9]{7,40}$/.test(v.sha) ? v.sha : null,
          author: text(c.author?.login, 80), authorAssociation: ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(c.authorAssociation) ? c.authorAssociation : null, url: recordUrl(c.url),
          proofs: (Array.isArray(v.proofs) ? v.proofs : []).slice(0, 4).map(p => ({ url: recordUrl(p.url), outcome: text(p.outcome, 120), environment: text(p.environment, 120) })).filter(p => p.url) });
      } catch { /* malformed checkpoint is absent, never guessed from prose */ }
    }
  }
  return found.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
}
const excerpt = body => text(String(body ?? '').split(/\n\s*\n/).find(p => p.trim() && !/^\s*(?:#|[-*] \[|```)/.test(p) && !/^Part of #/.test(p))?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, ''), 500);
const KNOWN_DOMAINS = { 26: 'Soul Actions', 415: 'Soul Actions', 556: 'Performance', 560: 'Coordination', 577: 'Standards', 583: 'Project visibility' };
// The initial records keep their names; any other issue takes its epic (then area) label, e.g. `epic:dev-flow` -> "Dev flow".
export function domainFor(issue) {
  if (KNOWN_DOMAINS[issue.number]) return KNOWN_DOMAINS[issue.number];
  const names = (issue.labels ?? []).map(l => l?.name).filter(n => typeof n === 'string');
  const label = names.find(n => /^epic:[a-z0-9-]+$/.test(n)) ?? names.find(n => /^area:[a-z0-9-]+$/.test(n));
  if (!label) return 'Other';
  const words = label.split(':')[1].replace(/-/g, ' ');
  return words[0].toUpperCase() + words.slice(1);
}
const refs = (body, n) => new RegExp(`(?:^|[^\\w])#${n}(?!\\d)|https://github\\.com/soulsimulation/souls/(?:issues|pull)/${n}(?!\\d)`).test(String(body ?? ''));
export function projectRecords({ issues, pulls = [], releases = [], observedAt }) {
  const at = timestamp(observedAt);
  if (!at || !Array.isArray(issues)) throw new Error('invalid source records');
  const items = issues.map(i => {
    const checkpoint = checkpointFrom(i.comments, at, ['genekogan', ...(i.assignees ?? []).map(a => a.login)]);
    const prs = pulls.filter(p => p.closingIssuesReferences?.some(x => x.number === i.number) || new RegExp(`(?:^|\\n)\\s*(?:Refs|Part of|Tracking issue):?\\s+#${i.number}(?!\\d)`, 'i').test(String(p.body ?? ''))).slice(0, 8);
    const shipped = releases.filter(r => prs.some(p => p.mergedAt && refs(r.body, p.number))).slice(0, 3);
    const owner = (i.assignees ?? []).map(a => text(a.login, 80)).filter(Boolean);
    const latest = prs.find(p => p.state === 'OPEN') ?? prs[0];
    const openPR = prs.some(p => p.state === 'OPEN');
    const relatedLifecycle = shipped.length ? 'released' : prs.some(p => p.mergedAt) ? 'merged' : null;
    const lifecycle = openPR ? 'branch-only' : i.state === 'CLOSED' ? relatedLifecycle ?? 'closed issue; release unknown' : 'source issue only';
    const reported = checkpoint?.state;
    const group = reported === 'blocked' || i.labels?.some(l => /^(needs:(?:maintainer|decision|gene)|blocked)$/.test(l.name)) ? 'Needs you'
      : ['active', 'ready for review'].includes(reported) || openPR || i.labels?.some(l => l.name === 'agent:claimed') ? 'Now'
      : i.state === 'CLOSED' && shipped.length ? 'Recently shipped' : 'Next';
    return { number: i.number, title: text(i.title, 250), url: recordUrl(i.url), domain: domainFor(i), group, lifecycle, relatedLifecycle,
      owner, updatedAt: timestamp(i.updatedAt), sourceExcerpt: excerpt(i.body), checkpoint,
      branch: latest?.headRefName ? text(latest.headRefName, 200) : checkpoint?.branch ?? null,
      sha: /^[a-f0-9]{7,40}$/.test(latest?.headRefOid) ? latest.headRefOid : checkpoint?.sha ?? null,
      pulls: prs.map(p => ({ number: p.number, title: text(p.title, 250), url: recordUrl(p.url), state: p.mergedAt ? 'merged' : p.state === 'OPEN' ? 'branch-only' : 'closed', at: timestamp(p.mergedAt ?? p.updatedAt) })),
      releases: shipped.map(r => ({ title: text(r.name ?? r.tag_name, 160), url: recordUrl(r.html_url), at: timestamp(r.published_at) })) };
  });
  return { version: 1, observedAt: at, repo: REPO, items, releases: releases.slice(0, 5).map(r => ({ title: text(r.name ?? r.tag_name, 160), url: recordUrl(r.html_url), at: timestamp(r.published_at) })) };
}
export function validateSnapshot(v) {
  if (v?.version !== 1 || v.repo !== REPO || !timestamp(v.observedAt) || !Array.isArray(v.items) || v.items.length > MAX_ITEMS || !Array.isArray(v.releases)) throw new Error('invalid snapshot');
  // Project again from allowlisted fields; unknown/raw fields cannot leak through a hand-edited cache.
  const cleanLink = x => ({ title: text(x.title, 250), url: recordUrl(x.url), at: timestamp(x.at) });
  return { version: 1, repo: REPO, observedAt: timestamp(v.observedAt), releases: v.releases.slice(0, 5).map(cleanLink), items: v.items.map(i => {
    if (!Number.isSafeInteger(i.number) || !['Now', 'Next', 'Needs you', 'Recently shipped'].includes(i.group)) throw new Error('invalid card');
    const c = i.checkpoint;
    const checkpoint = c ? checkpointFrom([{ body: '```ops-checkpoint\n' + JSON.stringify(c) + '\n```', updatedAt: c.at, author: { login: c.author }, authorAssociation: c.authorAssociation, url: c.url }], v.observedAt, ['genekogan', ...(i.owner ?? [])]) : null;
    return { number: i.number, title: text(i.title, 250), url: recordUrl(i.url), domain: text(i.domain, 80) ?? 'Other', group: i.group,
      sourceExcerpt: text(i.sourceExcerpt, 500), relatedLifecycle: ['merged', 'released'].includes(i.relatedLifecycle) ? i.relatedLifecycle : null, lifecycle: ['released', 'merged', 'branch-only', 'source issue only', 'closed issue; release unknown'].includes(i.lifecycle) ? i.lifecycle : 'unknown', owner: (Array.isArray(i.owner) ? i.owner : []).slice(0, 10).map(x => text(x, 80)).filter(Boolean), updatedAt: timestamp(i.updatedAt), checkpoint,
      branch: text(i.branch, 200), sha: /^[a-f0-9]{7,40}$/.test(i.sha) ? i.sha : null,
      pulls: (Array.isArray(i.pulls) ? i.pulls : []).slice(0, 8).map(p => ({ ...cleanLink(p), number: Number.isSafeInteger(p.number) ? p.number : null, state: ['merged', 'branch-only', 'closed'].includes(p.state) ? p.state : 'unknown' })),
      releases: (Array.isArray(i.releases) ? i.releases : []).slice(0, 3).map(cleanLink) };
  }) };
}
export function presentSnapshot(snapshot, now = Date.now(), failure = null) {
  const s = snapshot ? validateSnapshot(snapshot) : null;
  return { ok: true, snapshot: s ? { observedAt: s.observedAt, releases: s.releases } : null, source: { state: !s ? 'unavailable' : failure || now - Date.parse(s.observedAt) > MAX_AGE_MS || Date.parse(s.observedAt) > now + 60_000 ? 'stale' : 'cached', observedAt: s?.observedAt ?? null, checkedAt: new Date(now).toISOString(), message: failure ? 'Snapshot unavailable or invalid; last valid observation retained.' : !s ? 'No snapshot collected. An authorized operator must run the collector.' : 'Cached GitHub records; collection time is separate from worker updates.' },
    items: s?.items.map(i => ({ ...i, checkpointStale: !i.checkpoint || now - Date.parse(i.checkpoint.at) > MAX_AGE_MS })) ?? [] };
}
