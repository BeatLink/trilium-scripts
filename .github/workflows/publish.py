import json
import os
import zipfile

def main():
    merged_metadata = {
        "plugins": {}
    }

    # Scan only top-level folders (you can adjust if plugins are nested)
    for root, dirs, files in os.walk("."):
        if "metadata.json" in files:
            metadata_path = os.path.join(root, "metadata.json")
            with open(metadata_path, "r") as f:
                metadata = json.load(f)
            plugin_id = f'{metadata.get("id")}@{metadata.get("author")}'
            merged_metadata["plugins"][plugin_id] = metadata

            # Create zip of plugin folder
            zip_filename = f"{plugin_id}.zip"
            with zipfile.ZipFile(zip_filename, "w", zipfile.ZIP_DEFLATED) as zipf:
                for foldername, subdirs, filenames in os.walk(root):
                    for filename in filenames:
                        filepath = os.path.join(foldername, filename)
                        # store relative path in zip
                        arcname = os.path.relpath(filepath, start=root)
                        zipf.write(filepath, arcname=os.path.join(os.path.basename(root), arcname))
            print(f"Created zip: {zip_filename}")

    # Write merged metadata
    with open("metadata.json", "w") as f:
        json.dump(merged_metadata, f, indent=2)
    print("Merged metadata.json created")

if __name__ == "__main__":
    main()
