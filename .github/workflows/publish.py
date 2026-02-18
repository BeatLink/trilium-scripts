import json
import os
import shutil
from pathlib import Path

def main():
    
    # Get Metadata files
    metadata_files = list(Path('.').glob('**/metadata.json'))

    merged_metadata = {"plugins": {}}
    for metadata_file in metadata_files:
        metadata_path = metadata_file.resolve()

        # Load and merge metadata files
        plugin_id = ""
        with metadata_path.open() as f:
            metadata = json.load(f)
            plugin_id = metadata.get("id")
            merged_metadata["plugins"][plugin_id] = metadata

        # Zip the plugin folder
        plugin_path = [x for x in metadata_path.parent.iterdir() if x.is_dir()][0]
        if not plugin_path:
            print(f"No plugin folder found for {metadata_path}, skipping zip")
            continue            
        shutil.make_archive(
            base_name=plugin_id,
            format='zip',
            root_dir=plugin_path,
            base_dir=(".")
        )
        print(f"Created zip: {plugin_id}.zip")

    # Write merged metadata
    with open("metadata.json", "w") as f:
        json.dump(merged_metadata, f, indent=2)
    print("Merged metadata.json created")

if __name__ == "__main__":
    main()
