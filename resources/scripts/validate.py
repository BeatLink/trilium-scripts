#!/usr/bin/env python3
"""Validates addon structure to catch errors before tam_to_manifest.py runs."""

import json
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse, unquote

REQUIRED_FIELDS = ["id", "name", "description", "author", "homepage", "license", "latestVersion", "type"]

root = Path(".")
errors = []
warnings = []
fixes = []
fix_mode = "--fix" in sys.argv


def error(path, msg):
    errors.append(f"ERROR   {path}: {msg}")


def warn(path, msg):
    warnings.append(f"WARNING {path}: {msg}")


def fix(msg):
    fixes.append(f"FIXED   {msg}")


manifest_files = sorted(root.glob("addons/*/_tam_manifest_.json"))

for manifest_file in manifest_files:
    addon_dir = manifest_file.parent

    try:
        manifest = json.loads(manifest_file.read_text())
    except json.JSONDecodeError as e:
        error(manifest_file, f"invalid JSON — {e}")
        continue

    addon_id = manifest.get("id")
    if not addon_id:
        error(manifest_file, "missing required field 'id'")
        continue

    for field in REQUIRED_FIELDS:
        if field not in manifest:
            warn(manifest_file, f"missing field '{field}'")

    if " " in addon_id:
        error(manifest_file, f"'id' contains spaces: \"{addon_id}\"")
        continue

    # --- folder name must match id -------------------------------------------
    folder_name = addon_dir.name
    if folder_name != addon_id:
        if fix_mode:
            new_dir = addon_dir.parent / addon_id
            addon_dir.rename(new_dir)
            fix(f"renamed folder '{folder_name}' → '{addon_id}'")
            addon_dir = new_dir
            manifest_file = addon_dir / "_tam_manifest_.json"
        else:
            error(manifest_file, f"folder name '{folder_name}' does not match id '{addon_id}' (run --fix to rename)")

    # --- homepage URL must end with addons/{id} (only when URL contains /addons/) ---
    homepage = manifest.get("homepage", "")
    if homepage:
        parsed_url = urlparse(homepage)
        decoded_path = unquote(parsed_url.path).rstrip("/")
        expected_suffix = f"addons/{addon_id}"
        if "/addons/" in decoded_path and not decoded_path.endswith(expected_suffix):
            if fix_mode:
                parts = decoded_path.split("/")
                # Replace everything after the last 'addons' segment with the id
                try:
                    addons_idx = len(parts) - 1 - parts[::-1].index("addons")
                    parts = parts[:addons_idx + 1] + [addon_id]
                except ValueError:
                    parts[-1] = addon_id
                new_path = "/".join(parts)
                new_homepage = urlunparse(parsed_url._replace(path=new_path))
                manifest["homepage"] = new_homepage
                manifest_file.write_text(json.dumps(manifest, indent=4) + "\n")
                fix(f"updated homepage in '{manifest_file}': '{homepage}' → '{new_homepage}'")
            else:
                warn(manifest_file, f"homepage does not end with 'addons/{addon_id}' (run --fix to update)")

    readme_rel = manifest.get("readme")
    if readme_rel and not (addon_dir / readme_rel).exists():
        error(manifest_file, f"'readme' points to \"{readme_rel}\" but file not found")

    m = manifest.get("manifest")
    if m is None:
        continue  # metadata-only addon, no further checks

    # --- manifest.root is required -------------------------------------------
    root_id = m.get("root")
    if not root_id:
        error(manifest_file, "manifest.root is required")
        continue

    # --- notes must be an array ----------------------------------------------
    notes = m.get("notes")
    if not isinstance(notes, list):
        error(manifest_file, "manifest.notes must be an array")
        continue

    note_ids = set()
    for note in notes:
        nid = note.get("id") or note.get("title")
        if nid:
            note_ids.add(nid)
        if not note.get("title"):
            warn(manifest_file, f"note '{nid}' missing 'title'")

    # root must exist in notes
    if root_id not in note_ids:
        error(manifest_file, f"manifest.root '{root_id}' not found in notes")

    # settingsNote/readmeNote, if present, must reference a real note
    for field in ("settingsNote", "readmeNote"):
        local_id = m.get(field)
        if local_id and local_id not in note_ids:
            error(manifest_file, f"manifest.{field} '{local_id}' not found in notes")

    # --- sourceUrl files must exist ------------------------------------------
    for note in notes:
        nid = note.get("id", note.get("title", "?"))
        source_url = note.get("sourceUrl")
        if source_url and not source_url.startswith(("http://", "https://")):
            if not (addon_dir / source_url).exists():
                error(manifest_file, f"note '{nid}': sourceUrl '{source_url}' not found on disk")

    # --- children references -------------------------------------------------
    for c in m.get("children", []):
        parent = c.get("parent")
        child  = c.get("child")
        if c.get("addon"):
            # cross-addon child — only local parent must exist
            if parent and parent not in note_ids:
                error(manifest_file, f"children: parent '{parent}' not found in notes")
        else:
            if parent and parent not in note_ids:
                error(manifest_file, f"children: parent '{parent}' not found in notes")
            if child and child not in note_ids:
                error(manifest_file, f"children: child '{child}' not found in notes")

    # --- relations references ------------------------------------------------
    for rel in m.get("relations", []):
        from_id = rel.get("from")
        to_id   = rel.get("to")
        if from_id and from_id not in note_ids:
            error(manifest_file, f"relations: from '{from_id}' not found in notes")
        if to_id and not rel.get("addon") and to_id not in note_ids:
            warn(manifest_file, f"relations: to '{to_id}' not found in notes (may be a literal noteId)")

    # --- labels references ---------------------------------------------------
    for label in m.get("labels", []):
        nid = label.get("note")
        if nid and nid not in note_ids:
            error(manifest_file, f"labels: note '{nid}' not found in notes")

    # --- dependencies must be a string array --------------------------------
    deps = m.get("dependencies", [])
    if not isinstance(deps, list):
        error(manifest_file, "manifest.dependencies must be an array")
    elif not all(isinstance(d, str) for d in deps):
        error(manifest_file, "manifest.dependencies must be an array of strings")


# --- Summary -----------------------------------------------------------------
for msg in fixes + warnings + errors:
    print(msg)

if not (fixes or warnings or errors):
    print(f"OK — {len(manifest_files)} addon(s) validated successfully")

if errors:
    sys.exit(1)
