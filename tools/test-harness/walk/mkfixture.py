#!/usr/bin/env python3
"""WALK: a small, private-data-free walkability fixture from a compact world copy (read-only source).
usage: mkfixture.py SRC.db OUT.db.gz
Keeps what a boot reads for geometry (world, defs, entities, edits, ground recipes, latest snapshot + later events, souls
with their text/tokens blanked); empties tokens, accounts, comms, inboxes, receipts and other people-data tables."""
import sqlite3, sys, os, gzip, hashlib, json, tempfile, shutil
src, out = sys.argv[1], sys.argv[2]
EMPTY = ['god_tokens_v1', 'users', 'account_identities_v1', 'account_soul_memberships_v1', 'agent_inbox_v1',
         'soul_auto_portraits_v1', 'render_scene_captures', 'welcome_visits_v1', 'god_meals_v1', 'god_lore_visits_v1',
         'gov_seen_v1', 'edge_place_knowledge_v1', 'edge_outcome_contexts_v1', 'edge_outcomes_v1', 'edge_receipts_v1', 'edge_timeline_v1', 'edge_timeline_built_v1',
         'edge_refusals_v1', 'edge_owner_control_v1', 'lifecycle_operations_v1', 'god_verify_receipts_v1']
PREFIX = ('edge_comms_', 'travel_')
tmp = tempfile.mkdtemp(prefix='walk-fixture-'); dst = os.path.join(tmp, 'w.db')
s = sqlite3.connect(f'file:{src}?mode=ro', uri=True); d = sqlite3.connect(dst); s.backup(d); s.close()
tables = [r[0] for r in d.execute("select name from sqlite_master where type='table'")]
gone = [t for t in tables if t in EMPTY or t.startswith(PREFIX)]
for t in gone: d.execute(f'DELETE FROM "{t}"')
top = d.execute('select max(tick) from snapshots').fetchone()[0]
d.execute('DELETE FROM snapshots WHERE tick < ?', (top,))
d.execute("UPDATE souls SET description = '', owner = 'fixture', token_hash = NULL, token_label = NULL, token_generation = NULL")
d.commit(); d.execute('PRAGMA journal_mode=DELETE'); d.execute('VACUUM'); d.close()
raw = open(dst, 'rb').read()
with open(out + '.part', 'wb') as f: f.write(gzip.compress(raw, 9, mtime=0))
os.replace(out + '.part', out); shutil.rmtree(tmp, ignore_errors=True)
b = open(out, 'rb').read()
print(json.dumps({'src': src, 'out': out, 'snapshotTick': top, 'emptied': gone, 'dbBytes': len(raw), 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()}))
