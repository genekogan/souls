#!/usr/bin/env python3
"""Read-only metadata from the release host, for ship.sh: stage link, config hash, registry identity, database filenames
and keeper. It only stats database filenames; it never reads database bytes or credential or Soul files.
Run over ssh on stdin: python3 - <stage link> <data dir> <config file> <unit>"""
import hashlib, json, os, subprocess, sys
from pathlib import Path

link, data, conf, unit = sys.argv[1:5]
p = Path(data)
keeper = json.loads((p / 'keeper.json').read_text())
worlds = json.loads((p / 'worlds.json').read_text())['worlds']
identity = sorted(({'slug': w['slug'], 'dataSlug': w.get('dataSlug', w['slug']), 'worldId': w.get('worldId', w['slug'] + '-1'),
                    'worldKey': w.get('worldKey')} for w in worlds), key=lambda w: w['slug'])
dbs = [str(f.relative_to(p)) for f in (p / 'worlds').glob('*/sim.db') if f.is_file()]
dbs += [f for f in ['accounts.sqlite', 'body-collections.sqlite', 'forks/accounts.sqlite'] if (p / f).is_file()]
target = os.readlink(link)
print(json.dumps({
    'productionTarget': target,
    'configurationSha256': hashlib.sha256(Path(conf).read_bytes()).hexdigest(),
    'worlds': len(worlds),
    'registryIdentitySha256': hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
    'databasePaths': sorted(dbs),
    'databases': len(dbs),
    'keeperPid': keeper.get('keeper', {}).get('pid'),
    'servicePid': int(subprocess.check_output(['systemctl', 'show', '-p', 'MainPID', '--value', unit], text=True).strip()),
    'keeperSha': keeper.get('keeper', {}).get('sha'),
    'activeBuild': keeper.get('active', {}).get('build'),
    'handoverState': (keeper.get('handover') or {}).get('state'),
    'deployedKeeperSha': hashlib.sha256((Path(target) / 'tools/world-launcher/keeper.mjs').read_bytes()).hexdigest(),
}))
