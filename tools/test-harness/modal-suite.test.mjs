// The Modal fan-out's static shape (modal_suite.py), read with Python's ast so no Modal client is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REQUIRED_STEPS } from './release-gate.mjs';

const SUITE = fileURLToPath(new URL('./modal_suite.py', import.meta.url));
// Literal constants, the resources of each @app.function, and plan() evaluated without importing modal.
const PY = String.raw`
import ast, json, sys
src = open(sys.argv[1]).read(); tree = ast.parse(src); ns = {}
for node in tree.body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        try: ns[node.targets[0].id] = ast.literal_eval(node.value)
        except ValueError: pass
functions = {}
for node in tree.body:
    if isinstance(node, ast.FunctionDef):
        for d in node.decorator_list:
            if isinstance(d, ast.Call) and getattr(d.func, 'attr', '') == 'function':
                functions[node.name] = {k.arg: ast.get_source_segment(src, k.value) for k in d.keywords}
        if node.name in ('plan', 'runner_for'): exec(ast.get_source_segment(src, node), ns)
ns.update(run='small', run_large='large', run_v5='v5')
calls = json.loads(sys.argv[2])
plans = [ns['plan'](*c) for c in calls]
print(json.dumps({'GROUPS': ns['GROUPS'], 'ORDER': ns['ORDER'], 'LARGE': sorted(ns['LARGE']), 'V5_SHARDS': ns['V5_SHARDS'], 'V5_CONTAINERS': ns['V5_CONTAINERS'], 'MAX_SMALL': ns['MAX_SMALL'], 'functions': functions,
                  'plans': plans, 'runners': [[ns['runner_for'](j[0]) for j in plan] for plan in plans]}))
`;
const shape = (...calls) => JSON.parse(execFileSync('python3', ['-I', '-c', PY, SUITE, JSON.stringify(calls)], { encoding: 'utf8' }));

test('modal fan-out: four V5 tasks queue under the unchanged three-small plus one-large cap', () => {
  const s = shape(['']);
  assert.deepEqual(Object.keys(s.GROUPS), ['a', 's']); assert.deepEqual(s.LARGE, ['a']); assert.equal(s.V5_SHARDS, 4);
  const steps = Object.values(s.GROUPS).flat();
  assert.equal(new Set(steps).size, steps.length, 'a step is in two groups');
  assert.deepEqual([...steps].sort(), s.ORDER.filter(x => !x.startsWith('V5-')).sort());
  for (const step of REQUIRED_STEPS.filter(x => !x.startsWith('V5-'))) assert.ok(steps.includes(step), step);
  assert.deepEqual(s.plans[0].map(j => j[0]), ['a', 's', 'v5-1', 'v5-2', 'v5-3', 'v5-4']);
  assert.deepEqual(s.plans[0].filter(j => j[2]).map(j => j[2]), ['1/4', '2/4', '3/4', '4/4']);
  assert.deepEqual(s.runners[0], ['large', 'small', 'v5', 'v5', 'v5', 'v5']);
  const { run, run_large: large, run_v5: server } = s.functions;
  assert.equal(run.cpu, '4.0'); assert.equal(run.memory, '8192'); assert.equal(large.cpu, '8.0'); assert.equal(large.memory, '16384');
  assert.equal(server.cpu, '4.0'); assert.equal(server.memory, '8192');
  assert.equal(s.MAX_SMALL, 3, 'more queued tasks must not raise the existing small-container cap');
  assert.equal(s.V5_CONTAINERS, 2, 'V5 must keep its existing two-container ceiling');
  assert.equal(run.max_containers, 'MAX_SMALL - V5_CONTAINERS'); assert.equal(server.max_containers, 'V5_CONTAINERS');
  assert.equal(large.max_containers, 'len(LARGE)');
  for (const f of [run, large, server]) { assert.equal(f.single_use_containers, 'True'); assert.ok(f.max_containers); assert.equal(f.timeout, '4 * 3600'); }
});

test('collector retains per-group assets diagnostics and still rejects unexpected file collisions', () => {
  const py = String.raw`
import ast, io, json, os, tarfile, tempfile
src = open(__import__('sys').argv[1]).read()
tree = ast.parse(src)
ns = {'os': os, 'io': io, 'tarfile': tarfile}
for node in tree.body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == 'ORDER':
        ns['ORDER'] = ast.literal_eval(node.value)
    if isinstance(node, ast.FunctionDef) and node.name in ('_rows', 'merge', 'merge_v5'):
        exec(ast.get_source_segment(src, node), ns)
with tempfile.TemporaryDirectory() as root:
    ns['SRC'] = root
    with open(os.path.join(root, 'RUN-METADATA.json'), 'w') as f: json.dump({'source': 'fixture'}, f)
    jobs = [('a', 'V1-types', ''), ('s', 'V3-walk', '')]
    def artifact(name, step, collision):
        files = {
            'out/RUN-METADATA.json': json.dumps({'suiteCompleted': True, 'suiteExit': 0, 'nodeVersion': 'v22', 'pnpmVersion': '10'}),
            'out/suite/SUMMARY.tsv': 'step\texit\tseconds\tlog\n' + step + '\t0\t1\t/out/suite/' + step + '.log\n',
            'out/suite/' + step + '.log': name + ' test output',
            'out/suite/V0-preflight.log': name + ' preflight',
            'out/suite/V0-assets.log': name + ' assets',
        }
        if collision: files['out/suite/unexpected.log'] = name
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w:gz') as archive:
            for path, text in files.items():
                data = text.encode(); info = tarfile.TarInfo(path); info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        return buf.getvalue()
    rows = []
    for collision in (False, True):
        out = os.path.join(root, str(collision))
        problems = ns['merge'](out, jobs, [artifact(name, step, collision) for name, step, _ in jobs])
        def read(path):
            with open(os.path.join(out, 'out', path)) as f: return f.read()
        rows.append({'problems': problems, 'completed': json.loads(read('RUN-METADATA.json'))['suiteCompleted'],
                     'assets': [read('groups/' + name + '/V0-assets.log') for name, _, _ in jobs],
                     'serialAssets': read('suite/V0-assets.log'),
                     'logs': [read('suite/' + step + '.log') for _, step, _ in jobs]})
    print(json.dumps(rows))
`;
  const output = execFileSync('python3', ['-I', '-c', py, SUITE], { encoding: 'utf8' });
  const [valid, invalid] = JSON.parse(output.trim().split('\n').at(-1));
  assert.deepEqual(valid, { problems: [], completed: true, assets: ['a assets', 's assets'], serialAssets: 'a assets', logs: ['a test output', 's test output'] });
  assert.deepEqual(invalid.problems, ['group s: file collision unexpected.log']);
  assert.equal(invalid.completed, false);
  assert.deepEqual(invalid.assets, valid.assets);
});
test('modal fan-out: a bounded --server-files run keeps V5 and its baseline in one container', () => {
  const s = shape(['src/a.test.ts']), [plan] = s.plans;
  assert.deepEqual(plan.map(j => j[0]), ['a', 's', 'v5']); assert.equal(plan[2][1], 'V5-server-full,V5-server-baseline');
  assert.deepEqual(s.runners[0], ['large', 'small', 'v5']);
});
test('dependencies come from an image layer keyed by the lockfile; the install log names the cached layer', () => {
  const src = readFileSync(SUITE, 'utf8'), stage = readFileSync(fileURLToPath(new URL('./remote-suite.sh', import.meta.url)), 'utf8');
  assert.match(stage, /git -C "\$ROOT" show "\$REF:pnpm-lock.yaml" > "\$STAGE\/deps\/pnpm-lock.yaml"/);
  assert.match(src, /add_local_dir\(DEPS, "\/deps", copy=True\)\.run_commands\(/);
  assert.match(src, /pnpm fetch --store-dir \/pnpm-store/);
  // the layer is added before the uncopied /in mount (Modal requires mounts last) and only when the stage has a lockfile
  assert.ok(src.indexOf('add_local_dir(DEPS') < src.indexOf('add_local_dir(SRC, "/in")'));
  assert.match(src, /echo "cached layer \$lock"; pnpm install --frozen-lockfile --offline --store-dir \/pnpm-store/);
  assert.match(src, /no cached layer for lockfile \$lock/);
});
