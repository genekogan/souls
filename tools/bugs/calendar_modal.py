"""Bounded GPU calendar proof on a clean main-based branch; shared scenarios and actual browser input dpr1/2."""
import io
import pathlib
import subprocess
import sys
import tarfile
import modal

image = (modal.Image.from_registry("node:22-bookworm", add_python="3.12")
    .apt_install("curl", "ca-certificates", "gnupg", "fonts-liberation", "libvulkan1", "libegl1", "libgl1", "xz-utils")
    .run_commands(
        "curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && apt-get install -y /tmp/chrome.deb && rm /tmp/chrome.deb",
        "npm i -g pnpm@10.27.0",
    ).env({"NVIDIA_DRIVER_CAPABILITIES": "all"}))
app = modal.App("eden-sim-calendar-proof", image=image)


@app.function(gpu="L4", timeout=1800, memory=8192, cpu=4)
def run(bundle: bytes, source: str) -> bytes:
    root = pathlib.Path("/repo")
    root.mkdir()
    with tarfile.open(fileobj=io.BytesIO(bundle), mode="r:gz") as archive:
        archive.extractall(root, filter="data")
    subprocess.run(["pnpm", "install", "--no-frozen-lockfile", "--ignore-scripts"], cwd=root, stdout=subprocess.DEVNULL, check=True)
    # Shared scenarios use the root path; launcher proof uses /worlds. Build both explicitly.
    subprocess.run(["pnpm", "--filter", "@souls/web", "exec", "vite", "build"], cwd=root, stdout=subprocess.DEVNULL, check=True)
    subprocess.run(["pnpm", "--filter", "@souls/web", "exec", "vite", "build", "--base", "/worlds/", "--outDir", "/repo/.lane/web-worlds", "--emptyOutDir"], cwd=root, stdout=subprocess.DEVNULL, check=True)
    out = pathlib.Path("/proof")
    out.mkdir()
    env = {**__import__("os").environ, "P1_SOURCE_SHA": source, "P1_PROOF_DPR": ""}
    commands = [
        ("scenarios", ["node", "--import", "./tools/bugs/gpu-chrome.mjs", "tools/god-skill/e2e/scenarios.mjs", "--port", "6120"]),
        ("calendar", ["node", "tools/bugs/calendar-proof.mjs", "/proof/calendar"]),
    ]
    codes = {}
    for name, command in commands:
        with (out / f"{name}.log").open("w") as log:
            result = subprocess.run(command, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=900)
        codes[name] = result.returncode
        print(f"{name}: exit{result.returncode}", flush=True)
    # Shared suite proof files are ordinary fixture data; preserve them, no live DB is copied.
    import shutil
    if (root / ".lane/e2e").exists():
        shutil.copytree(root / ".lane/e2e", out / "scenarios", dirs_exist_ok=True)
    (out / "codes.json").write_text(__import__("json").dumps({"source": source, "codes": codes}))
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        archive.add(out, arcname="proof")
    return buffer.getvalue()


@app.local_entrypoint()
def main(bundle: str, source: str, out: str):
    data = run.remote(pathlib.Path(bundle).read_bytes(), source)
    target = pathlib.Path(out)
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive.getmembers():
            if not (target / member.name).resolve().is_relative_to(target.resolve()) or not (member.isfile() or member.isdir()):
                raise ValueError("unsafe proof archive")
        try:
            archive.extractall(target, filter="data")
        except TypeError:
            archive.extractall(target)
    codes = __import__("json").loads((target / "proof/codes.json").read_text())
    print(f"proof results: {target}/proof; exits {codes['codes']}")
    sys.exit(1 if any(codes["codes"].values()) else 0)
