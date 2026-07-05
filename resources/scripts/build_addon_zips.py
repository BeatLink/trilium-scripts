#!/usr/bin/env python3
"""Build a Trilium-importable ZIP for every TAM-managed addon.

Run from the repository root. Writes {addon-id}.zip into the current
directory for each addons/*/_tam_manifest_.json found, via export_zip.py.
"""

import json
import subprocess
import sys
from pathlib import Path

ADDONS_DIR = Path("addons")
EXPORT_ZIP = Path(__file__).resolve().parent / "export_zip.py"


def main():
    for manifest_path in sorted(ADDONS_DIR.glob("*/_tam_manifest_.json")):
        addon_id = json.loads(manifest_path.read_text())["id"]
        subprocess.run(
            [sys.executable, str(EXPORT_ZIP), str(manifest_path.parent), "--out", f"{addon_id}.zip"],
            check=True,
        )


if __name__ == "__main__":
    main()
