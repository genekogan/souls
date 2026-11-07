#!/usr/bin/env node
// Explicit operator command, never invoked by page loads, world ticks or an agent scheduler.
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_ISSUES, MAX_ITEMS, POPULATION_LABELS, REPO, projectRecords, selectIssues } from './owner-overview-data.mjs';
const gh = args => new Promise((yes, no) => execFile('gh', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (e, out) => { if (e) no(new Error('GitHub collection failed; previous snapshot preserved.')); else { try { yes(JSON.parse(out)); } catch { no(new Error('Invalid GitHub response; previous snapshot preserved.')); } } }));
export async function collectOverview(output, run = gh, now = () => new Date().toISOString()) {
  // Serial issues keep GitHub/API process concurrency low. No raw response is persisted.
  const labelled = [];
  for (const label of POPULATION_LABELS) labelled.push(await run(['issue', 'list', '--repo', REPO, '--state', 'open', '--label', label, '--limit', String(MAX_ITEMS), '--json', 'number']));
  const issues = [];
  for (const n of selectIssues(DEFAULT_ISSUES, labelled)) issues.push(await run(['issue', 'view', String(n), '--repo', REPO, '--json', 'number,title,body,url,state,updatedAt,assignees,labels,comments']));
  const pulls = await run(['pr', 'list', '--repo', REPO, '--state', 'all', '--limit', '100', '--json', 'number,title,body,url,state,mergedAt,headRefName,headRefOid,updatedAt,closingIssuesReferences']);
  const releases = await run(['api', `repos/${REPO}/releases?per_page=10`]);
  const snapshot = projectRecords({ issues, pulls, releases, observedAt: now() });
  const file = resolve(output), temporary = `${file}.${process.pid}.tmp`;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(temporary, JSON.stringify(snapshot) + '\n', { mode: 0o600, flag: 'wx' });
  chmodSync(temporary, 0o600); renameSync(temporary, file);
  return snapshot;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = process.argv[2];
  if (!output) { console.error('Usage: node tools/world-launcher/owner-overview-collect.mjs <DATA_DIR>/owner-overview.json'); process.exitCode = 1; }
  else { try { const s = await collectOverview(output); console.log(`Collected ${s.items.length} cards at ${s.observedAt}.`); } catch (e) { console.error(e.message); process.exitCode = 1; } }
}
