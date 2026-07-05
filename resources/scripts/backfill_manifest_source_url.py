#!/usr/bin/env python3
"""One-time backfill: add manifestSourceUrl to every addons/*/_tam_manifest_.json
that's missing one, using the same git-remote detection zip_to_tam.py uses for
freshly-converted addons. Safe to re-run — recomputes and overwrites the field
every time rather than skipping addons that already have it, so it also fixes
up any manifest that moved since it was last set.

Usage:
  backfill_manifest_source_url.py
"""

import json
import sys
from pathlib import Path

from zip_to_tam import detect_manifest_source_url


def main():
    addons_dir = Path("addons")
    if not addons_dir.is_dir():
        print("ERROR: no 'addons/' directory — run from repo root", file=sys.stderr)
        sys.exit(1)

    updated = skipped = 0
    for manifest_file in sorted(addons_dir.glob("*/_tam_manifest_.json")):
        addon_dir = manifest_file.parent
        url = detect_manifest_source_url(addon_dir)
        if not url:
            print(f"SKIP  {manifest_file}: not detectable (no git repo / no github.com origin)")
            skipped += 1
            continue

        manifest = json.loads(manifest_file.read_text())
        if manifest.get("manifestSourceUrl") == url:
            continue

        # Rebuild with manifestSourceUrl placed right after "readme" (or at
        # the end of the top-level fields if there's no readme), matching
        # where zip_to_tam.py places it for freshly-converted addons —
        # purely cosmetic (JSON key order doesn't matter functionally), but
        # keeps every manifest in the repo reading the same way.
        new_manifest = {}
        inserted = False
        for key, value in manifest.items():
            new_manifest[key] = value
            if key == "readme":
                new_manifest["manifestSourceUrl"] = url
                inserted = True
        if not inserted:
            new_manifest["manifestSourceUrl"] = url
        manifest = new_manifest

        manifest_file.write_text(json.dumps(manifest, indent=4) + "\n")
        print(f"SET   {manifest_file}: {url}")
        updated += 1

    print(f"\n{updated} manifest(s) updated, {skipped} skipped")


if __name__ == "__main__":
    main()
