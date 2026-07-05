# Trilium Scripts

A collection of widgets, themes, and scripts for [TriliumNext Notes](https://github.com/TriliumNext/Notes).

Browse the addon catalog: **https://beatlink.github.io/trilium-scripts/**

> ⚠️ **Work in progress.** The addon system (TAM, its manifest format, and how addons store data)
> is under active development and changing frequently. Data loss is possible. Download this to
> test and explore only — do not point it at real/production Trilium data yet.

## Installation

Install addons using [Trilium Addon Manager](./addons/trilium-addon-manager@beatlink/) by adding this catalog to TAM:

```
https://beatlink.github.io/trilium-scripts/catalog.json
```

Or download individual `.zip` files from [Releases](https://github.com/BeatLink/trilium-scripts/releases/latest) and import manually via **Trilium → Import**.

## Addons

<!-- GENERATED:START -->
<!-- GENERATED:END -->

## Development

```bash
nix-shell        # enter dev shell

validate         # validate addon structure
ci               # validate then build every addon's ZIP

zip_to_tam <zip>          # convert a Trilium export ZIP into a _tam_manifest_.json
tam_to_zip <manifest>     # convert a _tam_manifest_.json into a Trilium-importable ZIP
generate_pages            # build GitHub Pages site into docs/ and regenerate README.md
```
