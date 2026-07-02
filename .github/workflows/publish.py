import json
import os
import shutil
from pathlib import Path


def main():

    # Find all addon metadata files anywhere in the repo.
    # Each addon lives in its own folder alongside a metadata.json and a
    # single subfolder whose name matches the addon's "id" field.
    metadata_files = list(Path('.').glob('**/metadata.json'))

    merged_metadata = {"addons": {}}

    for metadata_file in metadata_files:
        metadata_path = metadata_file.resolve()

        with metadata_path.open() as f:
            metadata = json.load(f)

        addon_id = metadata.get("id")
        if not addon_id:
            # Every addon must declare an id — skip silently corrupting the output
            print(f"WARNING: {metadata_path} has no 'id' field, skipping")
            continue

        merged_metadata["addons"][addon_id] = metadata

        # The addon subfolder is always named after the addon id, sitting next
        # to metadata.json — no need to scan the directory for a best guess.
        addon_path = metadata_path.parent / addon_id
        if not addon_path.is_dir():
            print(f"WARNING: expected addon folder not found: {addon_path}, skipping zip")
            continue

        # Zip the addon folder contents.
        # root_dir sets the archive root so paths inside the zip are relative
        # to the addon folder, matching Trilium's expected import structure.
        shutil.make_archive(
            base_name=addon_id,
            format='zip',
            root_dir=addon_path,
            base_dir="."
        )
        print(f"Created zip: {addon_id}.zip")

    # Write the single merged metadata file that the addon manager reads
    with open("metadata.json", "w") as f:
        json.dump(merged_metadata, f, indent=2)
    print("Merged metadata.json created")


if __name__ == "__main__":
    main()
