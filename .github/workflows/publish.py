import json
import os
import zipfile

def main():
    merged_metadata = {
        "plugins": {}
    }

    # Scan only top-level folders (or adjust if needed)
    for root, dirs, files in os.walk("."):
        if "metadata.json" in files:
            metadata_path = os.path.join(root, "metadata.json")
            with open(metadata_path, "r") as f:
                metadata = json.load(f)
            
            plugin_id = f'{metadata.get("id")}@{metadata.get("author")}'
            merged_metadata["plugins"][plugin_id] = metadata

            # Determine the folder to zip (one level below root)
            subfolders = [d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d))]
            if not subfolders:
                print(f"No subfolder found in {root}, skipping zip")
                continue
            source_folder = os.path.join(root, subfolders[0])  # take the first subfolder

            zip_filename = f"{plugin_id}.zip"
            with zipfile.ZipFile(zip_filename, "w", zipfile.ZIP_DEFLATED) as zipf:
                for foldername, subdirs, filenames in os.walk(source_folder):
                    for filename in filenames:
                        filepath = os.path.join(foldername, filename)
                        # relative path inside zip starts from the subfolder name
                        arcname = os.path.relpath(filepath, start=root)
                        zipf.write(filepath, arcname=arcname)

            print(f"Created zip: {zip_filename}")

    # Write merged metadata
    with open("metadata.json", "w") as f:
        json.dump(merged_metadata, f, indent=2)
    print("Merged metadata.json created")

if __name__ == "__main__":
    main()
