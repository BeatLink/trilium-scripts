# Trilium Scripts

A collection of widgets, themes, and scripts for [TriliumNext Notes](https://github.com/TriliumNext/Notes).

## Installation

Install addons using [Trilium Addon Manager](./addons/trilium-addon-manager@beatlink/) by adding this repository's metadata URL to TAM:

```
https://github.com/BeatLink/trilium-scripts/releases/latest/download/metadata.json
```

Or download individual `.zip` files from [Releases](https://github.com/BeatLink/trilium-scripts/releases/latest) and import manually via **Trilium → Import**.

## Addons

<!-- GENERATED:START -->
| Name | Type | Description | Version |
|------|------|-------------|---------|
| [Area Picker](addons/Area Picker/) | widget | A right pane dropdown widget that allows you set a note to a specific area of life | 1.0.2 |
| [Expanded](addons/expanded@beatlink/) | widget | Keep selected notes always expanded in the note tree. Toggle 'Always Expanded' from the right pane on any note to pin it open permanently, even after restarting Trilium. | 1.0.0 |
| [Hoist Note](addons/HoistNote/) | widget | This addon creates a launchbar shortcut to hoise the current note. | 1.0.0 |
| [Launchers](addons/Launchers/) | widget | Configurable launcher buttons to quickly add the current note as a child of one or more parent notes, with optional exclusive mode. | 1.0.0 |
| [Margin Top](addons/Margin Top/) | css | A simple AppCSS. Add #cssClass=margin-top to any root note to separate it from others in the note tree. | 1.0.0 |
| [Mobile View](addons/Mobile View/) | widget | These set of scripts allow you to use the full capabilities of the Trilium server user interface while on a mobile device. | 0.0.1 |
| [Priority Widget](addons/Priority/) | widget | This right pane widget provides a dropdown to set the priority of a note. Various priority profiles can be selected. | 1.0.0 |
| [Template Picker](addons/template-picker@beatlink/) | widget | A right pane dropdown widget that allows you to quickly set the template of the current note. | 1.0.1 |
| [Trilium Addon Manager](addons/trilium-addon-manager@beatlink/) | widget | This addon allows for the easy installation, removal and updating of Trilium addons from GitHub repositories. | 1.2.0 |
| [WhiteBlueNext](addons/WhiteBlueNext/) | theme | This is a Trilium theme consisting of mostly white, a few grays and a light blue accent. | 0.0.1 |
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
