#!/usr/bin/env python3
"""Validates addon structure to catch errors before publish.py runs."""

import json
import sys
from pathlib import Path

REQUIRED_FIELDS = ["id", "name", "description", "author", "homepage", "license", "latestVersion", "type"]

root = Path(".")
errors = []
warnings = []


def error(path, msg):
    errors.append(f"ERROR   {path}: {msg}")


def warn(path, msg):
    warnings.append(f"WARNING {path}: {msg}")


metadata_files = [
    f for f in root.glob("**/metadata.json")
    if f.parent != root  # exclude root-level generated output
]

for metadata_file in sorted(metadata_files):
    addon_dir = metadata_file.parent

    # --- Parse JSON ----------------------------------------------------------
    try:
        with metadata_file.open() as f:
            metadata = json.load(f)
    except json.JSONDecodeError as e:
        error(metadata_file, f"invalid JSON — {e}")
        continue

    # --- Format check: must be flat addon record, not merged registry ---------
    if "addons" in metadata and "id" not in metadata:
        error(metadata_file, "uses registry format (has 'addons' key, missing 'id') — should be a flat addon record")
        continue

    # --- Required fields -----------------------------------------------------
    addon_id = metadata.get("id")
    if not addon_id:
        error(metadata_file, "missing required field 'id'")
        continue

    for field in REQUIRED_FIELDS:
        if field not in metadata:
            warn(metadata_file, f"missing field '{field}'")

    # --- id must not contain spaces (publish.py uses it as a folder name) ----
    if " " in addon_id:
        actual_subdirs = [d.name for d in addon_dir.iterdir() if d.is_dir()]
        error(
            metadata_file,
            f"'id' contains spaces: \"{addon_id}\" — publish.py looks for a subfolder with this exact name, "
            f"which will never match (found subfolders: {actual_subdirs or 'none'})"
        )
        continue

    # --- Matching subfolder must exist ---------------------------------------
    expected_subfolder = addon_dir / addon_id
    if not expected_subfolder.is_dir():
        actual_subdirs = [d.name for d in addon_dir.iterdir() if d.is_dir()]
        error(
            metadata_file,
            f"id is \"{addon_id}\" but no subfolder \"{addon_id}\" found "
            f"(found: {actual_subdirs or 'none'})"
        )
        continue

    # --- Trilium export metadata must be present inside the subfolder --------
    trilium_meta = expected_subfolder / "!!!meta.json"
    if not trilium_meta.exists():
        error(expected_subfolder, "missing !!!meta.json (Trilium export metadata)")
        continue

    # --- Check for noImport flags (strip_no_import.py not wired into CI) -----
    try:
        with trilium_meta.open() as f:
            trilium_meta_data = json.load(f)
        no_import_files = [
            e.get("dataFileName") for e in trilium_meta_data.get("files", [])
            if e.get("noImport")
        ]
        if no_import_files:
            warn(
                trilium_meta,
                f"has noImport entries {no_import_files} but strip_no_import.py is not called in publish.yml — "
                "these files will be included in the release zip"
            )
    except (json.JSONDecodeError, KeyError):
        warn(trilium_meta, "could not parse to check for noImport flags")


# --- Summary -----------------------------------------------------------------
all_messages = warnings + errors
for msg in all_messages:
    print(msg)

if not all_messages:
    print(f"OK — {len(metadata_files)} addon(s) validated successfully")

if errors:
    sys.exit(1)
