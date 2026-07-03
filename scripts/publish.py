import json
from pathlib import Path


def main():
    manifest_files = sorted(Path('.').glob('addons/*/_tam_manifest_.json'))

    merged_metadata = {"addons": {}}

    for manifest_file in manifest_files:
        addon_dir = manifest_file.parent

        try:
            manifest = json.loads(manifest_file.read_text())
        except json.JSONDecodeError as e:
            print(f"WARNING: skipping {manifest_file}: {e}")
            continue

        addon_id = manifest.get("id")
        if not addon_id:
            print(f"WARNING: {manifest_file} has no 'id' field, skipping")
            continue

        # Top-level fields without 'manifest' go into the registry
        merged_metadata["addons"][addon_id] = {k: v for k, v in manifest.items() if k != "manifest"}

        # Build distribution version: inline sourceUrl content
        dist_manifest = dict(manifest)
        m = manifest.get("manifest")
        if m:
            inlined_notes = []
            for note in m.get("notes", []):
                note_copy = dict(note)
                source_url = note.get("sourceUrl")
                if source_url and not source_url.startswith(("http://", "https://")):
                    source_path = addon_dir / source_url
                    if source_path.exists():
                        note_copy["content"]   = source_path.read_text()
                        note_copy["sourceUrl"] = None
                    else:
                        print(f"WARNING: {manifest_file}: sourceUrl '{source_url}' not found on disk")
                inlined_notes.append(note_copy)
            dist_manifest["manifest"] = dict(m)
            dist_manifest["manifest"]["notes"] = inlined_notes

        with open(f"{addon_id}.json", "w") as f:
            json.dump(dist_manifest, f, indent=2)
        print(f"Created: {addon_id}.json")

    with open("metadata.json", "w") as f:
        json.dump(merged_metadata, f, indent=2)
    print("Created: metadata.json")


if __name__ == "__main__":
    main()
