import json
import shutil
from pathlib import Path


def main():
    metadata_files = list(Path('.').glob('**/metadata.json'))

    merged_metadata = {"addons": {}}

    for metadata_file in metadata_files:
        metadata_path = metadata_file.resolve()

        with metadata_path.open() as f:
            metadata = json.load(f)

        addon_id = metadata.get("id")
        if not addon_id:
            print(f"WARNING: {metadata_path} has no 'id' field, skipping")
            continue

        merged_metadata["addons"][addon_id] = metadata

        scripts_rel = metadata.get("scripts")
        if not scripts_rel:
            print(f"WARNING: {metadata_path} has no 'scripts' field, skipping zip")
            continue

        addon_path = metadata_path.parent / scripts_rel
        if not addon_path.is_dir():
            print(f"WARNING: scripts folder not found: {addon_path}, skipping zip")
            continue

        shutil.make_archive(
            base_name=addon_id,
            format='zip',
            root_dir=addon_path,
            base_dir="."
        )
        print(f"Created zip: {addon_id}.zip")

    with open("metadata.json", "w") as f:
        json.dump(merged_metadata, f, indent=2)
    print("Merged metadata.json created")


if __name__ == "__main__":
    main()
