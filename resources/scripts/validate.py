#!/usr/bin/env python3
"""Validates addon structure before publishing."""

import json
import re
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

    # --- manifestSourceUrl (soft — a not-yet-published addon won't have one) ---
    if not manifest.get("manifestSourceUrl"):
        warn(manifest_file, "missing 'manifestSourceUrl' — addon can't be installed by TAM until this is set")

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
    by_id = {}
    for note in notes:
        nid = note.get("id") or note.get("title")
        if nid:
            note_ids.add(nid)
            by_id[nid] = note
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

    # settingsNote should point at a render-type note, not the raw JSX/code note
    # (see CLAUDE.md/.claude/rules/tam-gotchas.md — activating a code note opens its source)
    settings_note = by_id.get(m.get("settingsNote"))
    if settings_note and settings_note.get("type") == "code":
        warn(manifest_file, f"settingsNote '{m['settingsNote']}' is a raw code note — point it at the wrapping render note instead")

    # Notes served as static HTTP resources via customResourceProvider are NOT
    # code modules — a browser refuses to execute a <script> whose Content-Type
    # (set verbatim from the note mime) carries the non-standard ;env=frontend
    # parameter, so these deliberately use a bare application/javascript. Exempt
    # them from the env-qualifier check below.
    resource_note_ids = {
        lbl.get("note")
        for lbl in m.get("labels", [])
        if lbl.get("name") == "customResourceProvider"
    }

    # JS notes: mime must declare env=frontend or env=backend, never anything else
    for note in notes:
        nid = note.get("id", note.get("title", "?"))
        mime = note.get("mime") or ""
        if mime.startswith("application/javascript"):
            if "env=hybrid" in mime:
                error(manifest_file, f"note '{nid}': mime declares 'env=hybrid', which does not exist — ship two notes (env=frontend + env=backend) instead")
            elif "env=frontend" not in mime and "env=backend" not in mime and nid not in resource_note_ids:
                warn(manifest_file, f"note '{nid}': mime '{mime}' is missing an env=frontend/env=backend qualifier")

    # plain .js notes (not .jsx) are never transpiled — ES export/import syntax
    # will throw at runtime; they must use CommonJS module.exports/require()
    export_re = re.compile(r"^\s*export\s+(const|let|var|function|class|default|\{)", re.MULTILINE)
    for note in notes:
        nid = note.get("id", note.get("title", "?"))
        source_url = note.get("sourceUrl") or ""
        if source_url.endswith(".js") and not source_url.startswith(("http://", "https://")):
            source_path = addon_dir / source_url
            if source_path.exists() and export_re.search(source_path.read_text(errors="ignore")):
                warn(manifest_file, f"note '{nid}': plain .js source uses ES 'export' syntax, which is not transpiled — use CommonJS module.exports instead")

    # notes unreachable from root via children[] will never be created
    local_children = {c.get("child") for c in m.get("children", []) if c.get("child") and not c.get("addon")}
    for nid in note_ids:
        if nid != root_id and nid not in local_children:
            warn(manifest_file, f"note '{nid}' is not attached under any parent in 'children' — it will never be created")

    # promptOnUpdate silently no-ops without a matching AddonData: relation
    # (collectPendingPrompts in libTAMSync.js skips notes with no such relation)
    addon_data_targets = {rel.get("to") for rel in m.get("relations", []) if str(rel.get("type", "")).startswith("AddonData:")}
    for note in notes:
        nid = note.get("id", note.get("title", "?"))
        if note.get("promptOnUpdate") and nid not in addon_data_targets:
            warn(manifest_file, f"note '{nid}' sets promptOnUpdate but has no matching 'AddonData:{nid}' relation — the keep-mine/use-new prompt will never fire")

    # generic library titles collide globally across every addon that require()s them
    GENERIC_TITLES = {"lib", "library", "libsettings", "settings", "utils", "helper", "helpers"}
    for note in notes:
        title = note.get("title", "")
        if title.lower() in GENERIC_TITLES and note.get("type") == "code":
            warn(manifest_file, f"note title '{title}' is generic — require()/the bundle-global namespace is shared across all addons; use a fully-qualified title")

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

    # --- dependencies: each entry is a bare id string, or an explicit
    # {"id": ..., "manifestSourceUrl": ...} object for a dependency that isn't
    # expected to be resolvable through whatever source this addon itself
    # came from --------------------------------------------------------------
    deps = m.get("dependencies", [])
    if not isinstance(deps, list):
        error(manifest_file, "manifest.dependencies must be an array")
    else:
        for dep in deps:
            if isinstance(dep, str):
                continue
            if isinstance(dep, dict) and isinstance(dep.get("id"), str):
                if not dep.get("manifestSourceUrl"):
                    error(manifest_file, f"dependencies: entry for '{dep['id']}' is missing 'manifestSourceUrl'")
            else:
                error(manifest_file, f"manifest.dependencies entries must be a string or a {{id, manifestSourceUrl}} object, got: {dep!r}")


# --- Summary -----------------------------------------------------------------
for msg in fixes + warnings + errors:
    print(msg)

if not (fixes or warnings or errors):
    print(f"OK — {len(manifest_files)} addon(s) validated successfully")

if errors:
    sys.exit(1)
