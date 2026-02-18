import json
import os
import shutil
from pathlib import Path

def main():
    
    # Get Metadata files
    metadata_files = list(Path('.').glob('**/metadata.json'))

    merged_metadata = {"addons": {}}
    for metadata_file in metadata_files:
        metadata_path = metadata_file.resolve()

        # Load and merge metadata files
        addon_id = ""
        with metadata_path.open() as f:
            metadata = json.load(f)
            addon_id = metadata.get("id")
            merged_metadata["addons"][addon_id] = metadata

        # Zip the addon folder
        addon_path = [x for x in metadata_path.parent.iterdir() if x.is_dir()][0]
        if not addon_path:
            print(f"No addon folder found for {metadata_path}, skipping zip")
            continue            
        shutil.make_archive(
            base_name=addon_id,
            format='zip',
            root_dir=addon_path,
            base_dir=(".")
        )
        print(f"Created zip: {addon_id}.zip")

    # Write merged metadata
    with open("metadata.json", "w") as f:
        json.dump(merged_metadata, f, indent=2)
    print("Merged metadata.json created")

if __name__ == "__main__":
    main()
