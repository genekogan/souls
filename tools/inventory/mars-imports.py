#!/usr/bin/env python3
"""Inventory literal import/export specifiers and engine adapter loads. Run at repo root."""
import collections
import pathlib
import os
import sys
import re
import subprocess

root = pathlib.Path(__file__).resolve().parents[2]
files = subprocess.check_output(['git', 'ls-files', 'apps', 'packages', 'tools', 'mars/viewer/engine/test'], cwd=root, text=True).splitlines()
# Import declarations, re-exports, import types and literal dynamic imports. This is
# intentionally a lexical scan, not a TS parser; computed imports need manual review.
pattern = re.compile(r'''(?:\b(?:import|export)\s+(?:type\s+)?(?:[^;]*?\s+from\s+)?|\bimport\s*\()\s*["']([^"']+)["']''', re.S)
rows = collections.defaultdict(lambda: collections.Counter())
consumers = collections.defaultdict(set)
for name in files:
    p = pathlib.Path(name)
    if p.suffix not in ('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'): continue
    src = (root / p).read_text(encoding='utf-8')
    for m in pattern.finditer(src):
        spec = m.group(1).split('?')[0]
        if not spec.startswith('.'): continue
        target = pathlib.Path(os.path.normpath(str(p.parent / spec))).as_posix()
        if not target.startswith('mars/'): continue
        group = 'engine tests' if name.startswith('mars/viewer/engine/test/') else ('web tests' if name.startswith('apps/web/') and re.search(r'\.(?:test|spec)\.', name) else name.split('/')[0])
        rows[target][group] += 1
        consumers[target].add(name)
loader = (root / 'packages/engine-mars/src/load.ts').read_text()
for m in re.finditer(r"\bat\('([^']+)'\)", loader):
    target = 'mars/viewer/engine/' + m.group(1)
    rows[target]['loader'] += 1
    consumers[target].add('packages/engine-mars/src/load.ts')
def classification(path):
    p = path.removeprefix('mars/viewer/')
    if p.startswith(('engine/scenarios/', 'engine/scenes/', 'engine/campus/', 'app/engine-view/content/', 'simulation/')):
        return 'Mars content', 'world content / fixtures'
    if p.startswith(('engine/test/', 'deploy/')):
        return 'general feature to rescue', 'corresponding tests / tooling'
    if p.startswith(('app/', 'cinematography/', 'engine/construction/', 'engine/camera/', 'engine/activities/', 'engine/rehearsal/')):
        return 'general feature to rescue', 'viewer or feature package'
    return 'general engine', 'engine or shared library'

print('| Module | Class | Proposed destination | apps | packages | tools | engine tests | web tests | loader |')
print('|---|---|---|---:|---:|---:|---:|---:|---:|')
for target, counts in sorted(rows.items()):
    nums = ' | '.join(str(counts[k]) for k in ('apps', 'packages', 'tools', 'engine tests', 'web tests', 'loader'))
    kind, destination = classification(target)
    print(f'| `{target}` | {kind} | {destination} | {nums} |')

if '--consumers' in sys.argv:
    print('\n## Consumer files')
    for target in sorted(consumers):
        print(f"- `{target}`: " + ', '.join(f'`{p}`' for p in sorted(consumers[target])))
