#!/usr/bin/env python3
"""Convert _tam_manifest_.json to a Trilium-compatible ZIP export.

Dependencies (children/relations with an "addon" field) are resolved
automatically by reading sibling manifests from the addons/ directory.
The addons/ dir is auto-discovered as the parent of the addon being built;
override with --addons-dir if needed.

Usage:
  export_zip.py path/to/_tam_manifest_.json [--out my-addon.zip]
  export_zip.py path/to/addon-dir/
  export_zip.py path/to/addon-dir/ --addons-dir /path/to/addons/
"""

import argparse
import json
import random
import string
import sys
import zipfile
from pathlib import Path


MIME_TO_EXT = {
    "text/html":                           ".html",
    "text/markdown":                       ".md",
    "text/jsx":                            ".jsx",
    "text/css":                            ".css",
    "text/x-python":                       ".py",
    "text/plain":                          ".txt",
    "application/json":                    ".json",
    "application/javascript":             ".js",
    "application/javascript;env=frontend": ".js",
    "application/javascript;env=backend":  ".js",
    "application/javascript;env=hybrid":   ".js",
    "audio/wav":                           ".wav",
}

TRILIUM_APP_VERSION = "0.103.0"
ID_CHARS = string.ascii_letters + string.digits


def ext_for_mime(mime):
    return MIME_TO_EXT.get(mime, ".html")


def safe_name(title):
    return title.replace("/", "-").replace("\\", "-")


def gen_note_id():
    return "".join(random.choices(ID_CHARS, k=12))


def process_manifest(full_manifest, addon_dir, deps_map):
    """
    Build ZIP entries for one manifest.
    Returns (root_entry, zip_files, warnings, uuid_map).
    uuid_map maps local note IDs → generated Trilium note UUIDs.
    """
    m = full_manifest.get("manifest") or {}

    notes_by_id = {n["id"]: n for n in m.get("notes", [])}
    uuid_map    = {lid: gen_note_id() for lid in notes_by_id}

    # A local child can be listed under more than one parent (a same-addon
    # clone, e.g. a shared settings note pulled into several widgets). Only
    # the first occurrence actually builds/writes the note; every later
    # occurrence becomes a plain isClone reference to the same generated
    # noteId, mirroring how cross-addon dependency children already work.
    children_map = {}
    seen_local_children = set()
    for c in m.get("children", []):
        if c.get("addon"):
            continue
        child_lid = c["child"]
        is_clone_ref = child_lid in seen_local_children
        seen_local_children.add(child_lid)
        children_map.setdefault(c["parent"], []).append((child_lid, is_clone_ref))

    dep_children_map = {}
    for c in m.get("children", []):
        if c.get("addon"):
            dep_children_map.setdefault(c["parent"], []).append(c)

    note_labels    = {}
    note_relations = {}
    for lbl in m.get("labels", []):
        note_labels.setdefault(lbl["note"], []).append(lbl)
    for rel in m.get("relations", []):
        note_relations.setdefault(rel["from"], []).append(rel)

    zip_files  = []
    warnings   = []
    used_bases = {}

    def unique_base(dir_prefix, base):
        bucket = used_bases.setdefault(dir_prefix, set())
        if base not in bucket:
            bucket.add(base)
            return base
        i = 2
        while f"{base}-{i}" in bucket:
            i += 1
        result = f"{base}-{i}"
        bucket.add(result)
        return result

    def build_entry(local_id, note_position, dir_prefix, note_path):
        note_def   = notes_by_id[local_id]
        note_uuid  = uuid_map[local_id]
        note_type  = note_def.get("type", "text")
        note_mime  = note_def.get("mime", "text/html")
        title      = note_def["title"]

        local_children = children_map.get(local_id, [])
        dep_children   = dep_children_map.get(local_id, [])
        has_children   = bool(local_children or dep_children)

        current_path = note_path + [note_uuid]

        if note_type == "render":
            ext = ".html"
        else:
            ext = ext_for_mime(note_mime)

        base = unique_base(dir_prefix, safe_name(title))

        if base.lower().endswith(ext.lower()):
            data_name = base
        else:
            data_name = base + ext

        dir_name = base if has_children else None

        if note_type == "render":
            content = b""
        else:
            source_url = note_def.get("sourceUrl")
            if source_url and not source_url.startswith(("http://", "https://")):
                src = addon_dir / source_url
                if src.exists():
                    content = src.read_bytes()
                else:
                    warnings.append(f"note '{local_id}': sourceUrl '{source_url}' not found — empty content used")
                    content = b""
            elif note_def.get("content") is not None:
                c = note_def["content"]
                content = c.encode() if isinstance(c, str) else c
            else:
                content = b""

        zip_files.append((dir_prefix + data_name, content))

        child_prefix = dir_prefix + dir_name + "/" if dir_name else dir_prefix

        attrs = []
        pos   = 10
        for lbl in note_labels.get(local_id, []):
            attrs.append({
                "type": "label",
                "name": lbl["name"],
                "value": lbl.get("value", ""),
                "isInheritable": False,
                "position": pos,
            })
            pos += 10

        for rel in note_relations.get(local_id, []):
            if rel.get("addon"):
                dep_id   = rel["addon"]
                exp_name = rel["to"]
                target   = (deps_map.get(dep_id) or {}).get(exp_name)
                if not target:
                    warnings.append(
                        f"relation '{local_id}' type '{rel['type']}': "
                        f"dep '{dep_id}' export '{exp_name}' not resolved — skipped"
                    )
                    continue
            else:
                target = uuid_map.get(rel["to"], rel["to"])

            attrs.append({
                "type": "relation",
                "name": rel["type"],
                "value": target,
                "isInheritable": False,
                "position": pos,
            })
            pos += 10

        child_entries = []
        for i, (child_lid, is_clone_ref) in enumerate(local_children, start=1):
            if is_clone_ref:
                child_entries.append({
                    "isClone":      True,
                    "noteId":       uuid_map[child_lid],
                    "notePath":     current_path + [uuid_map[child_lid]],
                    "notePosition": i * 10,
                    "prefix":       None,
                    "isExpanded":   False,
                })
            else:
                child_entries.append(
                    build_entry(child_lid, i * 10, child_prefix, current_path)
                )

        for j, dep_c in enumerate(dep_children, start=len(local_children) + 1):
            dep_id      = dep_c["addon"]
            exp_name    = dep_c["child"]
            dep_note_id = (deps_map.get(dep_id) or {}).get(exp_name)
            if not dep_note_id:
                warnings.append(
                    f"child clone: parent '{local_id}' addon '{dep_id}' "
                    f"export '{exp_name}' not resolved — skipped"
                )
                continue
            child_entries.append({
                "isClone":      True,
                "noteId":       dep_note_id,
                "notePath":     [dep_note_id],
                "notePosition": j * 10,
                "prefix":       None,
                "isExpanded":   False,
            })

        entry = {
            "isClone":      False,
            "noteId":       note_uuid,
            "notePath":     current_path,
            "title":        title,
            "notePosition": note_position,
            "prefix":       None,
            "isExpanded":   has_children,
            "type":         note_type,
            "mime":         note_mime,
            "attributes":   attrs,
            "attachments":  [],
            "dataFileName": data_name,
        }
        if dir_name:
            entry["dirFileName"] = dir_name
        if child_entries:
            entry["children"] = child_entries
        if note_type == "text":
            entry["format"] = "markdown" if note_mime == "text/markdown" else "html"

        return entry

    root_lid   = m["root"]
    root_entry = build_entry(root_lid, 10, "", [])

    if "dirFileName" not in root_entry:
        root_entry["dirFileName"] = safe_name(notes_by_id[root_lid]["title"])

    return root_entry, zip_files, warnings, uuid_map


def main():
    parser = argparse.ArgumentParser(
        description="Convert _tam_manifest_.json to a Trilium ZIP import"
    )
    parser.add_argument("manifest", help="_tam_manifest_.json path or its containing directory")
    parser.add_argument("--out", help="Output ZIP path (default: {id}.zip next to the manifest)")
    parser.add_argument(
        "--addons-dir",
        metavar="DIR",
        help="Path to addons/ directory for auto-resolving dependencies (default: parent of addon dir)",
    )
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    if manifest_path.is_dir():
        manifest_path = manifest_path / "_tam_manifest_.json"
    if not manifest_path.exists():
        print(f"ERROR: {manifest_path} not found", file=sys.stderr)
        sys.exit(1)

    addon_dir     = manifest_path.parent
    full_manifest = json.loads(manifest_path.read_text())

    m = full_manifest.get("manifest")
    if not m:
        print("ERROR: no 'manifest' key — metadata-only addons cannot be exported as a Trilium ZIP", file=sys.stderr)
        sys.exit(1)
    if not m.get("root"):
        print("ERROR: manifest.root is required", file=sys.stderr)
        sys.exit(1)

    # Resolve addons dir for dep auto-discovery
    addons_dir = Path(args.addons_dir) if args.addons_dir else addon_dir.parent

    def direct_deps(mf):
        ids = set()
        for c in mf.get("children", []):
            if c.get("addon"):
                ids.add(c["addon"])
        for r in mf.get("relations", []):
            if r.get("addon"):
                ids.add(r["addon"])
        # Some dependencies are never cloned as a child/relation (e.g. a
        # static-resource-only vendor library referenced by a fixed URL
        # string rather than a note id) — manifest.dependencies is the
        # source of truth for "must be installed", independent of cloning.
        for dep_id in mf.get("dependencies", []):
            ids.add(dep_id)
        return ids

    all_warnings = []

    # Discover the full transitive dependency set (deps of deps of ...), not
    # just the main manifest's direct deps — a dep's own cross-addon children
    # need resolving too (e.g. libagendatask -> librecurrence -> librrule).
    dep_manifests = {}
    to_visit = list(direct_deps(m))
    visited = set()
    while to_visit:
        dep_id = to_visit.pop()
        if dep_id in visited:
            continue
        visited.add(dep_id)

        dep_dir   = addons_dir / dep_id
        dep_mpath = dep_dir / "_tam_manifest_.json"
        if not dep_mpath.exists():
            all_warnings.append(f"dep '{dep_id}': manifest not found at {dep_mpath} — skipped")
            continue
        dep_full = json.loads(dep_mpath.read_text())
        dep_m    = dep_full.get("manifest") or {}
        if not dep_m.get("root"):
            all_warnings.append(f"dep '{dep_id}': no manifest.root — skipped")
            continue

        dep_manifests[dep_id] = (dep_dir, dep_full, dep_m)
        to_visit.extend(direct_deps(dep_m) - visited)

    # Process deps in dependency order (a dep's own deps must already be in
    # deps_map before we process it, so its cross-addon children resolve).
    deps_map         = {}
    dep_root_entries = []
    dep_zip_files    = []
    remaining        = dict(dep_manifests)

    while remaining:
        progressed = False
        for dep_id, (dep_dir, dep_full, dep_m) in list(remaining.items()):
            if not direct_deps(dep_m).issubset(deps_map.keys()):
                continue

            dep_root, dep_zf, dep_w, dep_uuids = process_manifest(dep_full, dep_dir, deps_map)
            dep_root_entries.append(dep_root)
            dep_zip_files.extend(dep_zf)
            all_warnings.extend([f"[dep:{dep_id}] {w}" for w in dep_w])

            # Map export-name → UUID via exports: {export_name: local_note_id}
            dep_exports = dep_m.get("exports", {})
            deps_map[dep_id] = {
                exp_name: dep_uuids[local_id]
                for exp_name, local_id in dep_exports.items()
                if local_id in dep_uuids
            }
            del remaining[dep_id]
            progressed = True

        if not progressed:
            for dep_id in remaining:
                all_warnings.append(f"dep '{dep_id}': could not resolve its own dependencies (cycle or missing) — skipped")
            break

    # Process main manifest
    root_entry, zip_files, warnings, _ = process_manifest(full_manifest, addon_dir, deps_map)
    all_warnings.extend(warnings)

    addon_id = full_manifest.get("id", "export")
    out_path = Path(args.out) if args.out else addon_dir / f"{addon_id}.zip"

    trilium_meta = {
        "formatVersion": 2,
        "appVersion":    TRILIUM_APP_VERSION,
        "files":         [root_entry] + dep_root_entries,
    }

    all_zip_files = zip_files + dep_zip_files

    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("!!!meta.json", json.dumps(trilium_meta, indent=2))
        for zip_path, content in all_zip_files:
            zf.writestr(zip_path, content)

    if all_warnings:
        print("Warnings:")
        for w in all_warnings:
            print(f"  {w}")

    skipped = sum(1 for w in all_warnings if "skipped" in w)
    bundled = f", {len(dep_root_entries)} dep(s) bundled" if dep_root_entries else ""
    skipped_str = f", {skipped} skipped" if skipped else ""
    print(f"Written: {out_path}  ({len(all_zip_files)} content files{bundled}{skipped_str})")


if __name__ == "__main__":
    main()
