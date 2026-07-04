#!/usr/bin/env python3
"""Convert a Trilium export ZIP to _tam_manifest_.json + flat source files."""

import argparse
import json
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path


def slugify(title):
    s = title.lower()
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s or "note"


def dedup_id(base, seen):
    if base not in seen:
        return base
    i = 2
    while f"{base}-{i}" in seen:
        i += 1
    return f"{base}-{i}"


def guess_mime(filename, note_type):
    if not filename:
        return "text/html"
    ext = Path(filename).suffix.lower()
    return {
        ".js":   "application/javascript;env=frontend",
        ".jsx":  "text/jsx",
        ".css":  "text/css",
        ".json": "application/json",
        ".html": "text/html",
        ".md":   "text/markdown",
        ".py":   "text/x-python",
    }.get(ext, "text/plain")


def unique_filename(name, used):
    if name not in used:
        used.add(name)
        return name
    stem = Path(name).stem
    suffix = Path(name).suffix
    i = 2
    while f"{stem}-{i}{suffix}" in used:
        i += 1
    result = f"{stem}-{i}{suffix}"
    used.add(result)
    return result


def assign_ids(files_array, id_map, seen_ids):
    """First pass: assign a stable local id to every noteId in the tree."""
    for entry in files_array:
        note_id = entry.get("noteId")
        if note_id is None:
            continue  # noImport scaffold entry
        if note_id in id_map:
            # Clone — already mapped; recurse in case it has children listed
            assign_ids(entry.get("children", []), id_map, seen_ids)
            continue
        title = entry.get("title", "note")
        base = slugify(title)
        local_id = dedup_id(base, seen_ids)
        seen_ids.add(local_id)
        id_map[note_id] = local_id
        assign_ids(entry.get("children", []), id_map, seen_ids)


def walk_entries(files_array, parent_local_id, id_map):
    """Second pass: yield (entry, local_id, parent_local_id, is_clone) in tree order."""
    for entry in files_array:
        note_id = entry.get("noteId")
        if note_id is None:
            continue  # noImport scaffold entry
        local_id = id_map[note_id]
        is_clone = entry.get("isClone", False)
        yield entry, local_id, parent_local_id, is_clone
        yield from walk_entries(entry.get("children", []), local_id, id_map)


def main():
    parser = argparse.ArgumentParser(
        description="Convert a Trilium export ZIP to _tam_manifest_.json + flat source files"
    )
    parser.add_argument("input", help="Trilium export ZIP file")
    parser.add_argument("--out", default=".", help="Output directory (default: current dir)")
    args = parser.parse_args()

    input_path = Path(args.input)
    out_dir = Path(args.out)

    if not input_path.exists():
        print(f"ERROR: {input_path} not found", file=sys.stderr)
        sys.exit(1)

    out_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmppath = Path(tmpdir)
        with zipfile.ZipFile(input_path) as zf:
            zf.extractall(tmppath)

        meta_files = list(tmppath.rglob("!!!meta.json"))
        if not meta_files:
            print("ERROR: no !!!meta.json found in ZIP", file=sys.stderr)
            sys.exit(1)

        meta_file = meta_files[0]
        meta_root = meta_file.parent

        with meta_file.open() as f:
            meta = json.load(f)

        files_array = [f for f in meta.get("files", []) if not f.get("noImport")]
        if not files_array:
            print("ERROR: !!!meta.json has no 'files' array", file=sys.stderr)
            sys.exit(1)

        # First pass: assign ids
        id_map = {}
        seen_ids = set()
        assign_ids(files_array, id_map, seen_ids)

        root_note_id = files_array[0].get("noteId")
        root_local_id = id_map[root_note_id]

        notes = []
        children = []
        relations = []
        labels = []
        used_filenames = set()

        for entry, local_id, parent_local_id, is_clone in walk_entries(files_array, None, id_map):
            if is_clone:
                # Just wire up the child reference — note entry already exists
                if parent_local_id:
                    children.append({"parent": parent_local_id, "child": local_id})
                continue

            note_type = entry.get("type", "text")
            data_file = entry.get("dataFileName")

            # Copy source file flat into output dir
            source_url = None
            if data_file and not data_file.endswith(".clone.html"):
                data_path = meta_root / data_file
                if not data_path.exists():
                    matches = list(tmppath.rglob(data_file))
                    data_path = matches[0] if matches else None

                if data_path and data_path.exists():
                    dest_name = unique_filename(data_file, used_filenames)
                    shutil.copy2(data_path, out_dir / dest_name)
                    source_url = dest_name

            mime = entry.get("mime") or guess_mime(data_file, note_type)

            note = {
                "id":        local_id,
                "title":     entry.get("title", local_id),
                "type":      note_type,
                "mime":      mime,
                "sourceUrl": source_url,
            }
            if note_type == "file":
                note["binary"] = True
            notes.append(note)

            if parent_local_id:
                children.append({"parent": parent_local_id, "child": local_id})

            for attr in entry.get("attributes", []):
                attr_type  = attr.get("type")
                attr_name  = attr.get("name", "")
                attr_value = attr.get("value", "")

                if attr_type == "label":
                    labels.append({"note": local_id, "name": attr_name, "value": attr_value})
                elif attr_type == "relation":
                    target_local_id = id_map.get(attr_value, attr_value)
                    relations.append({"from": local_id, "type": attr_name, "to": target_local_id})

        manifest = {
            "id":            "FILL_IN",
            "name":          "FILL_IN",
            "description":   "FILL_IN",
            "author":        "FILL_IN",
            "homepage":      "FILL_IN",
            "license":       "GPL-3.0-or-later",
            "latestVersion": "1.0.0",
            "type":          "widget",
            "readme":        "README.md",
            "manifest": {
                "root":         root_local_id,
                "dependencies": [],
                "exports":      {},
                "notes":        notes,
                "children":     children,
                "relations":    relations,
                "labels":       labels,
            }
        }

        output_file = out_dir / "_tam_manifest_.json"
        with output_file.open("w") as f:
            json.dump(manifest, f, indent=2)

    print(f"Written: {output_file}")
    print(f"  {len(notes)} notes, {len(children)} children, {len(relations)} relations, {len(labels)} labels")
    print("  Search for '\"FILL_IN\"' in _tam_manifest_.json and replace with real values")


if __name__ == "__main__":
    main()
