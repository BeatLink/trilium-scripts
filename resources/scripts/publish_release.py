#!/usr/bin/env python3
"""Publish built distribution files to the 'latest' GitHub release.

Run from the repository root, after publish.py and build_addon_zips.py have
produced the *.json / *.zip files to upload. Requires `gh` authenticated
(GITHUB_TOKEN in the environment); GITHUB_SHA is read from the environment
that GitHub Actions provides on every run.
"""

import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(".")


def main():
    sha = os.environ.get("GITHUB_SHA", "unknown")

    # Creation fails if the 'latest' release already exists — that's fine,
    # we just upload to it below.
    subprocess.run(
        [
            "gh", "release", "create", "latest",
            "--title", "Latest",
            "--notes", f"Auto-published from `{sha}`",
            "--latest",
        ],
        stderr=subprocess.DEVNULL,
    )

    files = sorted(str(p) for p in REPO_ROOT.glob("*.json")) + sorted(str(p) for p in REPO_ROOT.glob("*.zip"))
    if not files:
        print("No *.json/*.zip files found to upload", file=sys.stderr)
        sys.exit(1)

    subprocess.run(["gh", "release", "upload", "latest", *files, "--clobber"], check=True)


if __name__ == "__main__":
    main()
