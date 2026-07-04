# Trilium Scripts

A collection of widgets, themes, and scripts for [TriliumNext Notes](https://github.com/TriliumNext/Notes).

Browse the addon catalog: **https://beatlink.github.io/trilium-scripts/**

## Installation

Install addons using [Trilium Addon Manager](./addons/trilium-addon-manager@beatlink/) by adding this repository's metadata URL to TAM:

```
https://github.com/BeatLink/trilium-scripts/releases/latest/download/metadata.json
```

Or download individual `.zip` files from [Releases](https://github.com/BeatLink/trilium-scripts/releases/latest) and import manually via **Trilium → Import**.

## Addons

<!-- GENERATED:START -->
<!-- GENERATED:END -->

## Development

```bash
nix-shell        # enter dev shell

validate         # validate addon structure
strip            # strip noImport files
publish          # merge and zip addons
ci               # run all three in sequence

import_addon <zip>        # import a Trilium export ZIP into addons/
generate_pages            # build GitHub Pages site into docs/ and regenerate README.md
```
