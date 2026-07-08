#!/usr/bin/env python3
"""Start/stop the standalone trilium-server test instance.

Usage:
    python3 resources/testing/run_server.py start [--real]
    python3 resources/testing/run_server.py stop

`trilium-server` must already be on PATH — provided by this repo's flake
devShell (`nix develop`), not installed separately. Data lives in
resources/testing/data/ by default (override with TRILIUM_TESTING_DATA_DIR).

Runs with TRILIUM_INTEGRATION_TEST=memory by default: the server loads
data/document.db into an in-memory copy on boot, so nothing that happens
during a test run ever touches the file on disk — the golden seed snapshot
built by seed.py can't be corrupted by a test. Pass --real to run against the
file for real (writes persist); only seed.py itself should need this.
"""
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("TRILIUM_TESTING_DATA_DIR", REPO_ROOT / "resources" / "testing" / "data"))
PORT = int(os.environ.get("TRILIUM_TESTING_PORT", "8090"))
PIDFILE = DATA_DIR.parent / ".server.pid"
LOGFILE = DATA_DIR.parent / "server.log"


def is_running():
    if not PIDFILE.exists():
        return None
    try:
        pid = int(PIDFILE.read_text().strip())
    except ValueError:
        return None
    try:
        os.kill(pid, 0)
    except OSError:
        return None
    return pid


def start(real=False):
    running = is_running()
    if running:
        print(f"Already running (pid {running})")
        return

    if not DATA_DIR.exists():
        sys.exit(f"No data dir at {DATA_DIR} -- run trilium_seed first")

    if shutil.which("trilium-server") is None:
        sys.exit("trilium-server not on PATH -- run inside `nix develop`")

    env = os.environ.copy()
    env["TRILIUM_DATA_DIR"] = str(DATA_DIR)
    env["TRILIUM_NETWORK_PORT"] = str(PORT)
    if not real:
        env["TRILIUM_INTEGRATION_TEST"] = "memory"

    with open(LOGFILE, "w") as log:
        proc = subprocess.Popen(["trilium-server"], env=env, stdout=log, stderr=subprocess.STDOUT)
    PIDFILE.write_text(str(proc.pid))

    url = f"http://127.0.0.1:{PORT}/"
    for _ in range(60):
        try:
            urllib.request.urlopen(url, timeout=1)
            print(f"Server ready at {url} (pid {proc.pid})")
            return
        except Exception:
            time.sleep(1)
    sys.exit(f"Server didn't come up in time -- check {LOGFILE}")


def stop():
    pid = is_running()
    if not pid:
        print("Not running")
        PIDFILE.unlink(missing_ok=True)
        return
    os.kill(pid, 15)
    for _ in range(10):
        try:
            os.kill(pid, 0)
            time.sleep(0.5)
        except OSError:
            break
    PIDFILE.unlink(missing_ok=True)
    print("Stopped")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else None
    if cmd == "start":
        start(real="--real" in sys.argv)
    elif cmd == "stop":
        stop()
    else:
        sys.exit(__doc__)
