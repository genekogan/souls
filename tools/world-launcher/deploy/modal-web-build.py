"""Build both release web prefixes from a pinned git archive on Modal.

SIM_WEB_BUILD_INPUT contains source.tgz and source.json with sourceSha and
sourceArchiveSha256. Run: modal run modal-web-build.py --out <new output directory>.
Only the reviewed source archive is uploaded; no local env or credentials.
"""
import hashlib
import io
import json
import os
import re
from pathlib import Path
import subprocess
import tarfile

import modal

image = (modal.Image.from_registry('node:22.23.2-bookworm', add_python='3.12')
         .apt_install('build-essential')
         .run_commands('corepack enable && corepack prepare pnpm@10.27.0 --activate'))
if modal.is_local():
    image = image.add_local_dir(os.environ['SIM_WEB_BUILD_INPUT'], '/input')
app = modal.App('sim-release-web-build')


@app.function(image=image, cpu=4, memory=8192, timeout=1800,
              max_containers=1, single_use_containers=True)
def build(base: str = '/worlds/'):
    base = base.rstrip('/') + '/'
    if base != '/' and not re.fullmatch(r'/[a-z][a-z0-9-]{0,31}/', base):
        raise ValueError('base must be / or one path segment')
    pin = json.loads(Path('/input/source.json').read_text())
    archive = Path('/input/source.tgz').read_bytes()
    if hashlib.sha256(archive).hexdigest() != pin['sourceArchiveSha256']:
        raise ValueError('source archive hash mismatch')
    source, output = Path('/source'), Path('/artifacts')
    source.mkdir(); output.mkdir()
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        if tar.pax_headers.get('comment') != pin['sourceSha']:
            raise ValueError('git archive commit does not match sourceSha')
        tar.extractall(source, filter='data')
    receipt = {**pin, 'node': subprocess.check_output(['node', '--version'], text=True).strip(),
               'pnpm': subprocess.check_output(['pnpm', '--version'], text=True).strip(), 'steps': []}

    def run(name, args, env):
        with (output / (name + '.log')).open('w') as log:
            result = subprocess.run(args, cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT)
        receipt['steps'].append({'name': name, 'args': args, 'exit': result.returncode})
        return result.returncode == 0

    env = {**os.environ, 'CI': '1', 'SIM_ASSETS_CDN_ENABLED': '1',
           'SIM_ASSETS_CDN_ORIGIN': 'https://assets.eden.art', 'SIM_GOD_UPLOADS_CDN': '1',
           'SIM_GOATCOUNTER': 'simeden', 'SIM_ARRIVAL_UI_ENABLED': '0',
           'VITE_EDEN_EXPERIENCE_WORLD_IDS': 'pm-preview-eden-20261005'}
    ok = run('install', ['pnpm', 'install', '--frozen-lockfile'], env)
    # media the web build bundles (tools/assets, not in git): the web set from the asset CDN, sha256-checked
    if ok and (source / 'tools/assets/manifest.json').exists():
        ok = run('assets', ['node', 'tools/assets/pull.mjs', '--set', 'web', '--quiet'], env)
    for suffix, web_base in [('', base), ('-root', '/')]:
        if not ok:
            break
        build_id = 'we-' + pin['sourceSha'][:12] + suffix
        target = output / build_id
        target.mkdir()
        env['BUILD_ID'] = build_id
        ok = run(build_id + '-build', ['pnpm', '--filter', '@souls/web', 'exec', 'vite', 'build',
                 '--logLevel', 'warn', '--outDir', str(target / 'dist'), '--emptyOutDir', '--base', web_base], env)
        if ok:
            ok = run(build_id + '-precompress', ['node', 'tools/world-launcher/deploy/precompress.mjs',
                     str(target / 'dist/assets')], env)
        if ok:
            ok = run(build_id + '-seal', ['node', 'tools/world-launcher/deploy/prebuilt-web.mjs',
                     'seal', str(target), '-', pin['sourceSha'], build_id, web_base,
                     env['SIM_ASSETS_CDN_ENABLED'], env['SIM_ASSETS_CDN_ORIGIN'],
                     env['VITE_EDEN_EXPERIENCE_WORLD_IDS'], env['SIM_ARRIVAL_UI_ENABLED'],
                     env['SIM_GOATCOUNTER'], env['SIM_GOD_UPLOADS_CDN']], env)
    receipt['status'] = 'PASS' if ok else 'FAIL'
    receipt['buildFlags'] = {k: env[k] for k in (
        'SIM_ASSETS_CDN_ENABLED', 'SIM_ASSETS_CDN_ORIGIN', 'SIM_GOD_UPLOADS_CDN',
        'SIM_GOATCOUNTER', 'SIM_ARRIVAL_UI_ENABLED', 'VITE_EDEN_EXPERIENCE_WORLD_IDS', 'BUILD_ID') if k in env}
    (output / 'BUILD-RECEIPT.json').write_text(json.dumps(receipt, indent=2) + '\n')
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode='w:gz') as tar:
        tar.add(output, arcname='artifacts')
    return result.getvalue()


@app.local_entrypoint()
def main(out: str, base: str = '/worlds/'):
    destination = Path(out)
    destination.mkdir(parents=True, exist_ok=False)
    data = build.remote(base)
    (destination / 'build-result.tgz').write_bytes(data)
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for member in tar.getmembers():
            if member.name.startswith('/') or '..' in Path(member.name).parts or not (member.isdir() or member.isfile()):
                raise ValueError('unsafe artifact archive entry')
        # The local Modal CLI also runs on Python 3.11.0 (before extraction filters).
        # All members above are constrained to relative regular files/directories;
        # destination is newly created, so no pre-existing symlink can redirect them.
        tar.extractall(destination)
    receipt = json.loads((destination / 'artifacts/BUILD-RECEIPT.json').read_text())
    print(json.dumps({'status': receipt['status'], 'sourceSha': receipt['sourceSha'], 'steps': receipt['steps']}, indent=2))
    if receipt['status'] != 'PASS':
        raise RuntimeError('web build failed; see retained logs')
