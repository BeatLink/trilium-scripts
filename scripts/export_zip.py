#!/usr/bin/env python3
"""Convert _tam_manifest_.json to a Trilium-compatible ZIP export.

Cross-addon dependency wiring (children/relations with an "addon" field)
requires knowing the real Trilium noteIds of the installed dependency notes.
Supply those via --deps; otherwise those entries are skipped with a warning.

Usage:
  export_zip.py path/to/_tam_manifest_.json [--out my-addon.zip]
  export_zip.py path/to/addon-dir/ --deps '{"lib@x": {"mainNote": "NOTEID12"}}'
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
}

TRILIUM_APP_VERSION = "0.103.0"
ID_CHARS = string.ascii_letters + string.digits


def ext_for_mime(mime):
    return MIME_TO_EXT.get(mime, ".html")


def safe_name(title):
    return title.replace("/", "-").replace("\\", "-")


def gen_note_id():
    return "".join(random.choices(ID_CHARS, k=12))


def main():
    parser = argparse.ArgumentParser(
        description="Convert _tam_manifest_.json to a Trilium ZIP import"
    )
    parser.add_argument("manifest", help="_tam_manifest_.json path or its containing directory")
    parser.add_argument("--out", help="Output ZIP path (default: {id}.zip next to the manifest)")
    parser.add_argument(
        "--deps",
        metavar="JSON",
        help=(
            'Real noteIds for cross-addon exports. '
            'Format: \'{"addon-id@x": {"exportName": "NOTEID12"}}\''
        ),
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

    deps_map = {}
    if args.deps:
        try:
            deps_map = json.loads(args.deps)
        except json.JSONDecodeError as e:
            print(f"ERROR: --deps is not valid JSON: {e}", file=sys.stderr)
            sys.exit(1)

    # Index notes and assign fresh Trilium-style IDs
    notes_by_id = {n["id"]: n for n in m["notes"]}
    uuid_map    = {lid: gen_note_id() for lid in notes_by_id}

    # Build parent → [local child id] map (no addon entries)
    children_map = {}
    for c in m.get("children", []):
        if not c.get("addon"):
            children_map.setdefault(c["parent"], []).append(c["child"])

    # Build parent → [dep-child spec] map
    dep_children_map = {}
    for c in m.get("children", []):
        if c.get("addon"):
            dep_children_map.setdefault(c["parent"], []).append(c)

    # Per-note labels and relations
    note_labels    = {}
    note_relations = {}
    for lbl in m.get("labels", []):
        note_labels.setdefault(lbl["note"], []).append(lbl)
    for rel in m.get("relations", []):
        note_relations.setdefault(rel["from"], []).append(rel)

    zip_files = []   # [(zip_path_str, bytes)]
    warnings  = []

    # Track deduplicated base names per parent directory
    used_bases = {}  # dir_prefix → set of base names already used

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
        """
        dir_prefix — ZIP path prefix where THIS note's content file lives.
                     Children's content lives at dir_prefix + dirName + '/'.
        note_path  — list of ancestor noteUUIDs NOT including this note (for building notePath).
        """
        note_def   = notes_by_id[local_id]
        note_uuid  = uuid_map[local_id]
        note_type  = note_def.get("type", "text")
        note_mime  = note_def.get("mime", "text/html")
        title      = note_def["title"]

        local_children = children_map.get(local_id, [])
        dep_children   = dep_children_map.get(local_id, [])
        has_children   = bool(local_children or dep_children)

        # Full ancestry notePath: parent chain + this note
        current_path = note_path + [note_uuid]

        # Determine file extension; render notes use .html with empty content
        if note_type == "render":
            ext = ".html"
        else:
            ext = ext_for_mime(note_mime)

        # Deduplicate base name within this parent directory
        base = unique_base(dir_prefix, safe_name(title))

        # Avoid double extension when the title already carries the correct extension
        # e.g. "libTAM.js" + ".js" would give "libTAM.js.js"
        if base.lower().endswith(ext.lower()):
            data_name = base
        else:
            data_name = base + ext

        dir_name = base if has_children else None

        # Read content — ALL note types get a content file so TriliumNext creates
        # each note before processing its children (render notes get empty content)
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

        # Prefix for children: inside this note's directory
        child_prefix = dir_prefix + dir_name + "/" if dir_name else dir_prefix

        # Build attributes
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
                        f"dep '{dep_id}' export '{exp_name}' not in --deps — skipped"
                    )
                    continue
            else:
                target = uuid_map.get(rel["to"], rel["to"])  # fallback: literal noteId

            attrs.append({
                "type": "relation",
                "name": rel["type"],
                "value": target,
                "isInheritable": False,
                "position": pos,
            })
            pos += 10

        # Recurse into local children
        child_entries = []
        for i, child_lid in enumerate(local_children, start=1):
            child_entries.append(
                build_entry(child_lid, i * 10, child_prefix, current_path)
            )

        # Dep clone children
        for j, dep_c in enumerate(dep_children, start=len(local_children) + 1):
            dep_id      = dep_c["addon"]
            exp_name    = dep_c["child"]
            dep_note_id = (deps_map.get(dep_id) or {}).get(exp_name)
            if not dep_note_id:
                warnings.append(
                    f"child clone: parent '{local_id}' addon '{dep_id}' "
                    f"child '{exp_name}' not in --deps — skipped"
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

    # Root note always gets a dirFileName (it is the top-level export directory)
    if "dirFileName" not in root_entry:
        root_entry["dirFileName"] = safe_name(notes_by_id[root_lid]["title"])

    trilium_meta = {
        "formatVersion": 2,
        "appVersion":    TRILIUM_APP_VERSION,
        "files":         [root_entry],
    }

    addon_id = full_manifest.get("id", "export")
    out_path = Path(args.out) if args.out else addon_dir / f"{addon_id}.zip"

    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("!!!meta.json", json.dumps(trilium_meta, indent=2))
        for zip_path, content in zip_files:
            zf.writestr(zip_path, content)

    if warnings:
        print("Warnings:")
        for w in warnings:
            print(f"  {w}")

    skipped = sum(1 for w in warnings if "skipped" in w)
    print(f"Written: {out_path}  ({len(notes_by_id)} notes, {len(zip_files)} content files"
          + (f", {skipped} skipped due to missing --deps" if skipped else "") + ")")


if __name__ == "__main__":
    main()
