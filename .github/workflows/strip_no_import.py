import json
from pathlib import Path


def main():
    for meta_file in Path('.').glob('**/!!!meta.json'):
        with meta_file.open() as f:
            meta = json.load(f)

        no_import = [e for e in meta.get('files', []) if e.get('noImport')]
        if not no_import:
            continue

        # Delete each noImport file from disk
        for entry in no_import:
            target = meta_file.parent / entry['dataFileName']
            if target.exists():
                target.unlink()
                print(f"Removed: {target}")

        # Strip noImport entries from the meta file
        meta['files'] = [e for e in meta['files'] if not e.get('noImport')]
        with meta_file.open('w') as f:
            json.dump(meta, f, indent='\t')
            f.write('\n')
        print(f"Updated:  {meta_file}")


if __name__ == '__main__':
    main()
