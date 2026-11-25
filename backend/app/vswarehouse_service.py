"""Internal VSWarehouse Token Monitor service.

The token monitor's logic (usage CSV parsing, live Google Sheet reading, reconciliation,
PDF report) is the original Node code, kept in backend/vswarehouse. The backend starts it as a
loopback-only child process guarded by a random per-start token, and the routes in
routers/vswarehouse.py are the only way to reach it — after login, and always with the
organization taken from the authenticated session.
"""
import os
import secrets
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from .config import BASE_DIR

SERVICE_DIR = BASE_DIR / "vswarehouse"
PORT = int(os.environ.get("VSW_PORT", "4173"))
BASE_URL = f"http://127.0.0.1:{PORT}"
_TOKEN = secrets.token_hex(24)
_proc: subprocess.Popen | None = None
_log = None


def start() -> None:
    global _proc, _log
    node = shutil.which("node")
    if not node:
        print("VSWarehouse: Node.js not found on PATH — token monitor disabled.")
        return
    if not (SERVICE_DIR / "node_modules").is_dir():
        print("VSWarehouse: run `npm install` in backend/vswarehouse — token monitor disabled.")
        return
    env = dict(os.environ, VSW_PORT=str(PORT), VSW_INTERNAL_TOKEN=_TOKEN)
    env.setdefault("VSW_DATA_DIR", str(SERVICE_DIR / "data"))
    _log = open(BASE_DIR / "vswarehouse.log", "ab")
    _proc = subprocess.Popen([node, "server.js"], cwd=SERVICE_DIR, env=env, stdout=_log, stderr=_log)


def stop() -> None:
    global _proc
    if _proc and _proc.poll() is None:
        _proc.terminate()
        try:
            _proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _proc.kill()
    _proc = None


def request(method: str, path: str, body: bytes | None = None, content_type: str | None = None):
    """Call the internal service. Returns (status, content_type, content_disposition, bytes)."""
    if _proc is None or _proc.poll() is not None:
        return 503, "application/json", None, b'{"error":"Token monitor service is not running."}'
    headers = {"x-internal-token": _TOKEN}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(BASE_URL + path, data=body, method=method, headers=headers)
    last_err = None
    for _ in range(10):  # the service may still be binding its port just after start-up
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.headers.get("Content-Type"), r.headers.get("Content-Disposition"), r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers.get("Content-Type"), None, e.read()
        except urllib.error.URLError as e:
            last_err = e
            time.sleep(0.5)
    return 503, "application/json", None, ('{"error":"Token monitor service unavailable: %s"}' % last_err).encode()
