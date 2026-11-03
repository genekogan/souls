"""Local dev server for site/ that labels text files as UTF-8.  python3 tools/serve.py [port]

Dev only (binds 127.0.0.1): POST /save/<id>.wav stores an offline render in renders/ and encodes
renders/<id>.mp3 with ffmpeg (see Sim.exportAll in site/engine/measure.js)."""
import functools, http.server, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RENDERS = ROOT / "renders"

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript; charset=utf-8", ".html": "text/html; charset=utf-8",
                      ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8"}
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        m = re.fullmatch(r"/save/([a-z0-9-]+)\.(wav|json)", self.path)
        if not m:
            self.send_error(404); return
        name, ext = m.groups()
        data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        RENDERS.mkdir(exist_ok=True)
        out = RENDERS / f"{name}.{ext}"
        out.write_bytes(data)
        if ext == "wav":
            mp3 = RENDERS / f"{name}.mp3"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(out), "-codec:a", "libmp3lame", "-b:a", "192k",
                            "-metadata", f"title={name}", "-metadata", "artist=Sim Score", str(mp3)], check=True)
            out.unlink()
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")

http.server.ThreadingHTTPServer.request_queue_size = 128  # batch renders open many connections at once
port = int(sys.argv[1]) if len(sys.argv) > 1 else 4802
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=str(ROOT / "site"))).serve_forever()
