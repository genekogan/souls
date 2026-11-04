# The one-validation suite on Modal CPU containers instead of the laptop (lane OPS2). Driven by remote-suite.sh,
# which stages head.tgz (+ base.tgz, REFS.txt) in $REMOTE_SUITE_SRC; don't run this file by hand.
# Fan-out (lane t4-o1, 2026-10-19): the steps run as GROUPS in separate containers at once (SUITE_ONLY), and V5 as
# V5_SHARDS contiguous shards (V5_SHARD); merge() then rebuilds the serial run's out/ layout exactly: one SUMMARY.tsv
# in the serial step order, one V5-server-full.log (the shard logs concatenated in order, i.e. the serial TAP), one
# RUN-METADATA.json (suiteCompleted only if every group completed). Each group's own SUMMARY/metadata/V0/install
# logs stay under out/groups/<name>/ for audit. A missing group, step or shard fails closed in the gate.
# Inside: node $REMOTE_SUITE_NODE + pnpm 10.27.0, `pnpm install --frozen-lockfile` (offline from the image's cached
# dependency layer when the lockfile matches it), then
# tools/test-harness/one-validation.sh --skip <skip> (V7 real-Chrome walks and V8 laptop-history boot are skipped by
# default: no GPU, and the production histories live on the laptop). The container has its own network namespace, so
# the test ports can't collide with anything. Returns /out as a tarball that remote-suite.sh unpacks into <outDir>.
import io
import os
import re
import subprocess
import tarfile

import modal

SRC = os.environ.get("REMOTE_SUITE_SRC")
NODE = os.environ.get("REMOTE_SUITE_NODE", "22")

image = (
    modal.Image.from_registry(f"node:{NODE}-bookworm", add_python="3.12")
    .apt_install("git", "perl", "bsdextrautils", "lsof", "procps", "curl", "build-essential")
    # restic 0.16.4 = eden2's apt version (Ubuntu 24.04), so backup-restic.test.mjs runs against the flags production has
    # (bookworm's apt restic is 0.14). Upstream release binary, pinned by its published sha256 (lane BK, 2026-10-20).
    .run_commands("curl -fsSL -o /tmp/restic.bz2 https://github.com/restic/restic/releases/download/v0.16.4/restic_0.16.4_linux_amd64.bz2"
                  " && echo '3d4d43c169a9e28ea76303b1e8b810f0dcede7478555fdaa8959971ad499e324  /tmp/restic.bz2' | sha256sum -c -"
                  " && bunzip2 -c /tmp/restic.bz2 > /usr/local/bin/restic && chmod 755 /usr/local/bin/restic && rm /tmp/restic.bz2"
                  " && restic version")
    # Node 25+ images ship no corepack: install the same pnpm with npm there (the Node 22 image command is unchanged)
    .run_commands("corepack enable && corepack prepare pnpm@10.27.0 --activate && pnpm --version" if int(NODE.split(".")[0]) < 25
                  else "npm install -g pnpm@10.27.0 && pnpm --version")
)
# Media layer (tools/assets): remote-suite.sh stages the source ref's asset manifest + pull.mjs in <stage>/assets. Copied into
# the image they key a cached layer holding the content-addressed media cache (/asset-cache, filled from the asset CDN and
# sha256-checked), so the media is downloaded once per manifest change; prep() then pulls each tree from it. Placed before
# the dependency layer so a lockfile change does not download the media again.
ASSETS = os.path.join(SRC, "assets") if SRC else None
if ASSETS and os.path.exists(os.path.join(ASSETS, "manifest.json")):
    image = image.add_local_dir(ASSETS, "/assets-in", copy=True).run_commands(
        "node /assets-in/pull.mjs --manifest /assets-in/manifest.json --dest /tmp/assets-tree --cache /asset-cache --quiet"
        " && rm -rf /tmp/assets-tree && echo \"cached assets $(sha256sum /assets-in/manifest.json | cut -d' ' -f1)\"")
# Prebuilt dependency layer (lane gate-cost, 2026-10-26, MODAL-POLICY rule 3): remote-suite.sh stages the source ref's
# pnpm-lock.yaml (+ pnpm-workspace.yaml, whose overrides the lockfile records) in <stage>/deps. Copied into the image,
# they key a cached layer holding the `pnpm fetch` store for exactly that lockfile, so a container only links
# node_modules offline (prep() below) and nothing is downloaded unless the lockfile changed.
DEPS = os.path.join(SRC, "deps") if SRC else None
if DEPS and os.path.exists(os.path.join(DEPS, "pnpm-lock.yaml")):
    image = image.add_local_dir(DEPS, "/deps", copy=True).run_commands(
        "cd /deps && sha256sum pnpm-lock.yaml | cut -d' ' -f1 > LOCK.sha256"
        " && pnpm fetch --store-dir /pnpm-store > fetch.log 2>&1 && tail -n 2 fetch.log && echo \"cached layer $(cat LOCK.sha256)\"")
if SRC:
    image = image.add_local_dir(SRC, "/in")

app = modal.App("eden4-remote-suite")

INNER = r"""
set -u
cat /in/REFS.txt
prep() {  # prep <tgz> <dir>: unpack, make it a git repo (one-validation's V0 reads HEAD), install deps
  mkdir -p "$2" && tar xzf "$1" -C "$2" && cd "$2" || return 1
  # The invocation's committed harness tests both source refs with identical rules.
  tar xzf /in/harness.tgz -C "$2" || return 1
  # media (tools/assets): this tree's own manifest, from the image's asset cache (network only for objects it lacks)
  if [ -f tools/assets/manifest.json ] && [ -f tools/assets/pull.mjs ]; then
    local alog="/out/assets-$(basename "$2").log"
    node tools/assets/pull.mjs --cache /asset-cache > "$alog" 2>&1 || { echo "asset pull $(basename "$2") failed"; tail -n 20 "$alog"; return 1; }
    tail -n 1 "$alog"
  fi
  git init -q -b main && git add -A && git -c user.email=suite@local -c user.name=suite commit -qm "$(basename "$2")" || return 1
  if [ -f /in/historical-inputs.pack ]; then
    git index-pack --stdin < /in/historical-inputs.pack || return 1
  fi
  # the image's dependency layer serves this tree when it was fetched for the identical lockfile (sha256)
  local log="/out/install-$(basename "$2").log" lock; lock=$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)
  if [ -f /deps/LOCK.sha256 ] && [ "$lock" = "$(cat /deps/LOCK.sha256)" ]; then
    { echo "cached layer $lock"; pnpm install --frozen-lockfile --offline --store-dir /pnpm-store ||
      { echo "offline install from cached layer $lock failed; installing online"; pnpm install --frozen-lockfile; }; } > "$log" 2>&1
  else
    { echo "no cached layer for lockfile $lock (layer: $(cat /deps/LOCK.sha256 2>/dev/null || echo none)); full install"
      pnpm install --frozen-lockfile; } > "$log" 2>&1
  fi; local rc=$?
  echo "install $(basename "$2") rc=$rc"; head -n 1 "$log"; tail -n 3 "$log"
  return "$rc"
}
rm -rf /out /work  # never inherit a previous input's tree or results (see single_use_containers below)
mkdir -p /out
cp /in/RUN-METADATA.json /out/
cp /in/historical-inputs.pack.json /out/ 2>/dev/null || true
prep /in/head.tgz /work/head || exit 1
BASE=none
if [ -f /in/base.tgz ]; then prep /in/base.tgz /work/base || exit 1; BASE=/work/base; fi
node --version; nproc; grep MemTotal /proc/meminfo
bash /work/head/tools/test-harness/one-validation.sh /out/suite --baseline "$BASE" --skip "$SKIP"
rc=$?
python - "$rc" <<'PY'
import json, sys, subprocess
p = '/out/RUN-METADATA.json'
with open(p) as f: data = json.load(f)
data['suiteCompleted'] = sys.argv[1] == '0'
data['suiteExit'] = int(sys.argv[1])
data['nodeVersion'] = subprocess.check_output(['node', '--version'], text=True).strip()
data['pnpmVersion'] = subprocess.check_output(['pnpm', '--version'], text=True).strip()
with open(p, 'w') as f: json.dump(data, f, indent=2)
PY
"""


# Serial step order (one-validation.sh); merge() writes SUMMARY rows in this order. Unknown rows follow, in group order.
ORDER = ["V1-types", "V2-build-root", "V2-build-worlds", "V3-harness", "V3-walk", "V3-bundle", "V3-packages", "V3-mars-engine", "V3-client-cli",
         "V3-launcher-unit", "V4-web", "V4-web-baseline", "V5-server-full", "V5-server-baseline", "V6-scenarios", "V6-party",
         "V6-souls-r2", "V6-join-clerk", "V6-join-dev", "V6-souls-ux", "V6-mars-two", "V6-lm-two",
         "V7-old-worlds", "V7-new-world", "V7-camera-dpr2", "V7-god-modal", "V8-history-boot"]
# Right-sized fan-out (lane gate-cost, 2026-10-26, team/lanes/MODAL-POLICY.md rule 3). Step times of the 7696422b0 gate
# (seconds): V3-mars-engine 421, V3-client-cli 393, V6-souls-r2 286, V3-launcher-unit 214, V4-web 211, V6-lm-two 187,
# V3-packages 171, V6-party 146, V6-mars-two 127, V3-walk 97, V1-types 70. Group a builds the web twice (prep + V2) and
# keeps 8 CPU; every other container is 4 CPU / 8 GB. The former small groups b, c, d, e, f, w run as one container "s"
# (serial sum ~1870 s, i.e. ~31-40 min at 4 CPU). Four shorter V5 tasks queue under the same three-small-container
# cap: interrupted tasks lose less work without raising simultaneous resources. Tests remain serial within a task.
# Every step of ORDER is in exactly one group. Ports differ per V6 step, but each group still runs its steps serially.
GROUPS = {
    "a": ["V1-types", "V2-build-root", "V2-build-worlds", "V3-harness", "V3-bundle", "V3-packages", "V4-web", "V4-web-baseline",
          "V6-scenarios", "V6-join-clerk", "V6-join-dev", "V7-old-worlds", "V7-new-world",
          "V7-camera-dpr2", "V7-god-modal", "V8-history-boot"],
    # the former groups b, c, d, e, f and w; one-validation.sh runs them in its serial order (V3-walk's ~10 shard
    # processes now share 4 cores: 97 s at 8 CPU)
    "s": ["V3-walk", "V3-mars-engine", "V3-client-cli", "V3-launcher-unit", "V6-party", "V6-souls-r2", "V6-souls-ux",
          "V6-mars-two", "V6-lm-two"],
}
LARGE = {"a"}  # groups on the 8 CPU / 16 GB function; all others use 4 CPU / 8 GB
V5_SHARDS = 4
V5_CONTAINERS = 2
assert sorted(s for g in GROUPS.values() for s in g) == sorted(set(ORDER) - {"V5-server-full", "V5-server-baseline"})


# max_containers (lane GATECAP, 2026-10-23; Modal 1.5.2 keyword): the Modal workspace has a 100-container limit.
# `modal run` makes a fresh ephemeral app per run, so this caps ONE run, not all of them. Keep the existing peak of
# three small containers plus one large container independent of V5 task count. V5 keeps its two-container ceiling;
# the other small steps keep one slot. The cross-gate bound is the ledger team/lanes/GATES.inflight.
MAX_SMALL = 3


# single_use_containers: a preempted input is restarted by Modal, and without this it can land on a warm container that
# already ran another group (2026-10-19, R's 3.9 gate: group b's suite came back as shard v5-1). One input per container.
@app.function(image=image, cpu=8.0, memory=16384, timeout=4 * 3600, single_use_containers=True, max_containers=len(LARGE))
def run_large(skip: str, server_files: str = "", only: str = "", shard: str = "") -> bytes:
    return suite(skip, server_files, only, shard)


@app.function(image=image, cpu=4.0, memory=8192, timeout=4 * 3600, single_use_containers=True, max_containers=MAX_SMALL - V5_CONTAINERS)
def run(skip: str, server_files: str = "", only: str = "", shard: str = "") -> bytes:
    return suite(skip, server_files, only, shard)


@app.function(image=image, cpu=4.0, memory=8192, timeout=4 * 3600, single_use_containers=True, max_containers=V5_CONTAINERS)
def run_v5(skip: str, server_files: str = "", only: str = "", shard: str = "") -> bytes:
    return suite(skip, server_files, only, shard)


def runner_for(name):
    if name in LARGE:
        return run_large
    return run_v5 if name == "v5" or name.startswith("v5-") else run


def suite(skip: str, server_files: str, only: str, shard: str) -> bytes:
    files = server_files.split()
    if any(not re.fullmatch(r"src/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+\.test\.ts", f) for f in files):
        raise ValueError("server files must be src/<safe path>/<name>.test.ts")
    if not re.fullmatch(r"[A-Za-z0-9_,-]*", only) or not re.fullmatch(r"(\d+/\d+)?", shard):
        raise ValueError("invalid group/shard")
    subprocess.run(["bash", "-c", INNER], env={**os.environ, "SKIP": skip, "SERVER_TEST_FILES": " ".join(files), "CI": "1", "REMOTE_SUITE_CPU": "1",
                                               "SUITE_ONLY": only, "V5_SHARD": shard}, check=False)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        t.add("/out", arcname="out")
    return buf.getvalue()


def plan(server_files: str, only: str = ""):
    """(name, only, shard) per container. A bounded --server-files run keeps V5 (and its baseline) in one container.
    A scoped run (only = the contract steps release-gate.sh --scope auto picked) launches only the groups and V5 shards
    holding those steps."""
    pick = set(only.split(",")) - {""}
    jobs = []
    for name, steps in GROUPS.items():
        chosen = [s for s in steps if not pick or s in pick]
        if chosen: jobs.append((name, ",".join(chosen), ""))
    if pick and "V5-server-full" not in pick:
        return jobs
    if server_files.split():
        jobs.append(("v5", "V5-server-full,V5-server-baseline", ""))
    else:
        jobs += [(f"v5-{i}", "V5-server-full", f"{i}/{V5_SHARDS}") for i in range(1, V5_SHARDS + 1)]
    return jobs


def _rows(path):
    with open(path) as f:
        lines = f.read().strip().split("\n")
    assert lines[0] == "step\texit\tseconds\tlog", f"bad SUMMARY header in {path}"
    return [line.split("\t") for line in lines[1:] if line]


def merge(out: str, jobs, results):
    """Unpack each group into out/groups/<name>/ and rebuild out/out exactly as one serial container would leave it."""
    import json
    import shutil
    final, suite = os.path.join(out, "out"), os.path.join(out, "out", "suite")
    os.makedirs(suite, exist_ok=True)
    rows, problems, metas, shard_logs = {}, [], {}, []
    for (name, only, shard), data in zip(jobs, results):
        gdir = os.path.join(out, "out", "groups", name)
        if isinstance(data, BaseException) or not isinstance(data, bytes):
            problems.append(f"group {name}: container failed: {data!r}"[:500]); continue
        tmp = os.path.join(out, f".group-{name}")
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as t:
            try: t.extractall(tmp, filter="data")
            except TypeError: t.extractall(tmp)
        gout = os.path.join(tmp, "out")
        os.makedirs(gdir, exist_ok=True)
        try:
            with open(os.path.join(gout, "RUN-METADATA.json")) as f: metas[name] = json.load(f)
        except Exception as e:
            problems.append(f"group {name}: no metadata ({e})")
        gsuite = os.path.join(gout, "suite")
        try: grows = _rows(os.path.join(gsuite, "SUMMARY.tsv"))
        except Exception as e: problems.append(f"group {name}: no SUMMARY ({e})"); grows = []
        for keep in ("RUN-METADATA.json", "suite/SUMMARY.tsv", "suite/V0-preflight.log", "suite/V0-assets.log"):
            src = os.path.join(gout, keep)
            if os.path.exists(src): shutil.move(src, os.path.join(gdir, os.path.basename(keep)))
        for f in os.listdir(gout):
            if f.startswith("install-") or f == "historical-inputs.pack.json":
                dst = final if name == jobs[0][0] else gdir
                shutil.move(os.path.join(gout, f), os.path.join(dst, f))
        if name == jobs[0][0]:
            for diagnostic in ("V0-preflight.log", "V0-assets.log"):
                if os.path.exists(os.path.join(gdir, diagnostic)):
                    shutil.copy(os.path.join(gdir, diagnostic), os.path.join(suite, diagnostic))
        wanted = set(only.split(","))
        for step, exit_, secs, log in grows:
            if step not in wanted and not (step == "V8-history-boot" and exit_ == "SKIP" and "V8-history-boot" in wanted):
                problems.append(f"group {name}: unexpected row {step}"); continue
            if shard:
                shard_logs.append((int(shard.split("/")[0]), step, exit_, secs, gsuite))
                continue
            if step in rows: problems.append(f"duplicate row {step}"); continue
            rows[step] = [step, exit_, secs, log]
        for f in os.listdir(gsuite):  # step logs, case inventories, attribution files
            if f.startswith("prep-"): shutil.move(os.path.join(gsuite, f), os.path.join(gdir, f)); continue
            if shard and f.startswith("V5-"):
                shutil.move(os.path.join(gsuite, f), os.path.join(gdir, f)); continue
            dst = os.path.join(suite, f)
            if os.path.exists(dst): problems.append(f"group {name}: file collision {f}"); continue
            shutil.move(os.path.join(gsuite, f), dst)
        shutil.rmtree(tmp, ignore_errors=True)
    shard_jobs = [j for j in jobs if j[2]]
    if shard_jobs:
        rows["V5-server-full"] = merge_v5(out, shard_jobs, shard_logs, suite, problems)
    # one RUN-METADATA.json: the staged identity, completed only if every group completed on the same runtime
    with open(os.path.join(SRC, "RUN-METADATA.json")) as f:  # local: the staged identity remote-suite.sh wrote
        meta = json.load(f)
    runtimes = {(m.get("nodeVersion"), m.get("pnpmVersion")) for m in metas.values()}
    if len(runtimes) != 1: problems.append(f"groups ran different runtimes: {sorted(map(str, runtimes))}")
    else: meta["nodeVersion"], meta["pnpmVersion"] = next(iter(runtimes))
    missing = [j[0] for j in jobs if j[0] not in metas]
    meta["suiteCompleted"] = not missing and not problems and all(m.get("suiteCompleted") is True for m in metas.values())
    meta["suiteExit"] = next((m.get("suiteExit") for m in metas.values() if m.get("suiteExit") != 0), 0 if not missing else 1)
    meta["fanout"] = {"groups": {j[0]: {"only": j[1], "shard": j[2] or None, "suiteExit": metas.get(j[0], {}).get("suiteExit")} for j in jobs},
                      "problems": problems}
    with open(os.path.join(final, "RUN-METADATA.json"), "w") as f:
        json.dump(meta, f, indent=2)
    order = {s: i for i, s in enumerate(ORDER)}
    with open(os.path.join(suite, "SUMMARY.tsv"), "w") as f:
        f.write("step\texit\tseconds\tlog\n")
        for step in sorted(rows, key=lambda s: order.get(s, len(ORDER))):
            r = rows[step]; r[3] = r[3] if r[3] == "-" else f"/out/suite/{os.path.basename(r[3])}"
            f.write("\t".join(r) + "\n")
    for p in problems: print("MERGE PROBLEM:", p)
    return problems


def merge_v5(out, shard_jobs, shard_logs, suite, problems):
    """Concatenate the shard TAP logs in shard order; check the shards are an exact, ordered cover of the file list."""
    n = len(shard_jobs)
    got = sorted(shard_logs)
    if [g[0] for g in got] != list(range(1, n + 1)):
        problems.append(f"V5 shards missing/duplicated: {[g[0] for g in got]}")
        return ["V5-server-full", "SHARDS-MISSING", "0", "-"]
    if all(g[2] == "SKIP" for g in got):  # --skip V5: every shard skipped the step, like the serial run
        return ["V5-server-full", "SKIP", "0", "-"]
    groups_dir = os.path.join(out, "out", "groups")
    alls, cover = set(), []
    for i, *_ in got:
        g = os.path.join(groups_dir, f"v5-{i}")
        try:
            alls.add(open(os.path.join(g, "V5-all-files.txt")).read())
            cover.append(open(os.path.join(g, "V5-shard-files.txt")).read())
        except Exception as e:
            problems.append(f"V5 shard {i}: no file lists ({e})")
    if len(alls) != 1 or "".join(cover) != next(iter(alls), None):
        problems.append("V5 shards are not an exact ordered cover of the server test files")
        exit_ = "SHARDS-MISMATCH"
    else:
        exits = [g[2] for g in got]
        bad = [e for e in exits if not e.isdigit()]
        exit_ = bad[0] if bad else str(max(int(e) for e in exits))
    with open(os.path.join(suite, "V5-server-full.log"), "wb") as w:
        for i, *_ in got:
            p = os.path.join(groups_dir, f"v5-{i}", "V5-server-full.log")
            if not os.path.exists(p):
                problems.append(f"V5 shard {i}: no log"); exit_ = "SHARD-LOG-MISSING"; continue
            with open(p, "rb") as r:
                shutil_copy(r, w)
    with open(os.path.join(suite, "V5-server-full-files.jsonl"), "wb") as w:
        for i, *_ in got:
            p = os.path.join(groups_dir, f"v5-{i}", "V5-server-full-files.jsonl")
            if os.path.exists(p):
                with open(p, "rb") as r: shutil_copy(r, w)
    secs = str(max(int(g[3]) for g in got if g[3].isdigit()) if any(g[3].isdigit() for g in got) else 0)
    return ["V5-server-full", exit_, secs, "/out/suite/V5-server-full.log"]


def shutil_copy(r, w):
    import shutil
    shutil.copyfileobj(r, w)


@app.local_entrypoint()
def main(out: str, skip: str = "V7,V8", server_files: str = "", only: str = ""):
    import time
    if not re.fullmatch(r"[A-Za-z0-9_,-]*", only) or (set(only.split(",")) - {""}) - set(ORDER):
        raise ValueError(f"--only names unknown steps: {only}")
    jobs = plan(server_files, only)
    t0 = time.time()
    print(f"fan-out: {len(jobs)} tasks, at most {MAX_SMALL + len(LARGE)} concurrent containers (V5: {V5_CONTAINERS}): {', '.join(j[0] for j in jobs)}")
    calls = [runner_for(name).spawn(skip, server_files, only, shard) for name, only, shard in jobs]
    results = []
    for call in calls:  # in job order; a failed container is an exception result, which merge() reports and fails closed
        try: results.append(call.get())
        except Exception as e: results.append(e)
    print(f"all containers returned in {time.time() - t0:.0f} s")
    os.makedirs(out, exist_ok=True)
    problems = merge(out, jobs, results)
    print(f"results in {out}/out (SUMMARY: {out}/out/suite/SUMMARY.tsv){' with merge problems' if problems else ''}")
