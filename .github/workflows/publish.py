import json
import os
import shutil

def main():
    merged_metadata = {"plugins": {}}

    # Scan all folders recursively
    for root, dirs, files in os.walk("."):
        if "metadata.json" in files:
            metadata_path = os.path.join(root, "metadata.json")
            with open(metadata_path, "r") as f:
                metadata = json.load(f)

            plugin_id = metadata.get("id")
            merged_metadata["plugins"][plugin_id] = metadata

            # Get the first subfolder inside the folder containing metadata.json
            subfolders = [d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d))]
            if not subfolders:
                print(f"No subfolder found in {root}, skipping zip")
                continue

            source_folder = os.path.join(root, subfolders[0])
            zip_filename = f"{plugin_id}"
            # Zip the subfolder, preserving its folder name
            shutil.makearchive(
                base_name=zip_filename,
                format='zip',
                root_dir=os.path.dirname(source_folder),
                base_dir=os.path.basename(source_folder)
            )

            print(f"Created zip: {zip_filename}.zip")

    # Write merged metadata
    with open("metadata.json", "w") as f:
        json.dump(merged_metadata, f, indent=2)
    print("Merged metadata.json created")

if __name__ == "__main__":
    main()
