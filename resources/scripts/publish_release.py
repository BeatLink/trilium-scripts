#!/usr/bin/env python3
"""Publish built ZIP exports to GitHub Releases.

Run from the repository root, after tam_to_zip.py --all has produced the
{id}.zip files to upload. Requires `gh` authenticated (GITHUB_TOKEN in the
environment); GITHUB_SHA/GITHUB_RUN_NUMBER are read from the environment
that GitHub Actions provides on every run.

Manifests are no longer published here at all — TAM installs directly from
each addon's own manifestSourceUrl (a raw.githubusercontent URL), so there's
nothing left to inline/upload for that path. This script exists purely for
the "grab an older version's zip and import it by hand" path: every publish
cuts a new, permanently-addressable numbered release (so an old zip stays
downloadable forever) and also refreshes a floating 'latest' release with
the same assets, so "download current" links don't need to know a specific
version tag.
"""

import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(".")


def publish_to(tag, title, notes, files, *, latest):
    subprocess.run(
        [
            "gh", "release", "create", tag,
            "--title", title,
            "--notes", notes,
            *(["--latest"] if latest else []),
        ],
        stderr=subprocess.DEVNULL,
    )
    subprocess.run(["gh", "release", "upload", tag, *files, "--clobber"], check=True)


def main():
    sha = os.environ.get("GITHUB_SHA", "unknown")
    run_number = os.environ.get("GITHUB_RUN_NUMBER", "0")

    files = sorted(str(p) for p in REPO_ROOT.glob("*.zip"))
    if not files:
        print("No *.zip files found to upload", file=sys.stderr)
        sys.exit(1)

    version_tag = f"publish-{run_number}"
    notes = f"Auto-published from `{sha}`"

    # A specific, permanently-addressable release for this exact publish —
    # this is how a user gets an older version: grab the zip from here and
    # import it manually.
    publish_to(version_tag, f"Publish {run_number}", notes, files, latest=False)

    # The floating alias every "download current zip" link points at.
    # Creation fails if it already exists — that's fine, upload still runs.
    publish_to("latest", "Latest", notes, files, latest=True)


if __name__ == "__main__":
    main()
