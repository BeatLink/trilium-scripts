#!/usr/bin/env python3
"""Import a Trilium addon export ZIP into the repo's addons/ folder structure."""

import argparse
import json
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path


def find_meta(directory: Path) -> Path | None:
    """Find !!!meta.json — either at the directory root or one level deep."""
    root_meta = directory / "!!!meta.json"
    if root_meta.exists():
        return root_meta
    for child in directory.iterdir():
        if child.is_dir():
            nested = child / "!!!meta.json"
            if nested.exists():
                return nested
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Import a Trilium export ZIP into addons/",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  import_addon path/to/my-addon.zip
  import_addon path/to/my-addon.zip --name "My Addon"
        """
    )
    parser.add_argument("zip_path", help="Path to the Trilium export ZIP")
    parser.add_argument("--name", help="Outer folder name under addons/ (defaults to the root note title)")
    args = parser.parse_args()

    zip_path = Path(args.zip_path)
    if not zip_path.exists():
        print(f"ERROR: file not found: {zip_path}")
        sys.exit(1)
    if not zipfile.is_zipfile(zip_path):
        print(f"ERROR: not a valid ZIP file: {zip_path}")
        sys.exit(1)

    addons_dir = Path("addons")
    if not addons_dir.is_dir():
        print("ERROR: no 'addons/' directory found — run this script from the repo root")
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmp_path)

        meta_file = find_meta(tmp_path)
        if not meta_file:
            print("ERROR: !!!meta.json not found in the ZIP (checked root and one level deep)")
            sys.exit(1)

        with meta_file.open() as f:
            meta = json.load(f)

        root_entry = meta.get("files", [{}])[0]
        note_title = root_entry.get("title", "").strip()
        if not note_title:
            print("ERROR: could not read root note title from !!!meta.json")
            sys.exit(1)

        outer_name = args.name or note_title
        outer_dir = addons_dir / outer_name
        scripts_dir = outer_dir / note_title
        extract_root = meta_file.parent

        if scripts_dir.exists():
            print(f"ERROR: destination already exists: {scripts_dir}")
            print("Remove it first or choose a different --name")
            sys.exit(1)

        outer_dir.mkdir(parents=True, exist_ok=True)
        shutil.copytree(extract_root, scripts_dir)

    print(f"Imported '{note_title}' → {scripts_dir}")

    metadata_path = outer_dir / "metadata.json"
    if not metadata_path.exists():
        stub = {
            "id": note_title,
            "name": outer_name,
            "description": "",
            "author": "",
            "homepage": "",
            "license": "GPL-3.0-or-later",
            "latestVersion": "1.0.0",
            "type": "widget",
            "scripts": note_title
        }
        with metadata_path.open("w") as f:
            json.dump(stub, f, indent=4)
            f.write("\n")
        print(f"Created stub metadata: {metadata_path}")
        print(f"  → fill in: name, description, author, homepage, latestVersion, type")


if __name__ == "__main__":
    main()
