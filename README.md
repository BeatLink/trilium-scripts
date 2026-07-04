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
| Name | Type | Description | Version |
|------|------|-------------|---------|
| [Area Picker](addons/area-picker@beatlink/) | widget | A right pane dropdown widget that allows you set a note to a specific area of life | 1.0.2 |
| [Draw.io](addons/drawio@siriusxt/) | widget | Integrates Draw.io diagram editing into TriliumNext — click any SVG note to edit it inline using the embedded Draw.io editor | 0.7.1 |
| [Expanded](addons/expanded@beatlink/) | widget | Keep selected notes always expanded in the note tree. Toggle 'Always Expanded' from the right pane on any note to pin it open permanently, even after restarting Trilium. | 1.0.0 |
| [Hoist Note](addons/hoist-note@beatlink/) | widget | This script adds a launchbar button to quickly toggle the hoisting of the current note. | 1.0.0 |
| [Margin Top](addons/margin-top@beatlink/) | css | This simple CSS adds extra padding to any notes with the #cssClass=margin-top label. Useful for headings in the tree view. | 1.0.0 |
| [Mobile View](addons/mobile-view@beatlink/) | widget | These set of scripts allow you to use the full capabilities of the Trilium desktop interface while on a mobile device. | 0.0.1 |
| [MultiSort](addons/multisort@beatlink/) | script | Sorts note children by multiple attributes and criteria using the #multiSorted label. | 1.0.0 |
| [MultiSort Library](addons/libmultisort@beatlink/) | script | Shared library for sorting TriliumNext notes by multiple attributes and criteria. | 1.0.0 |
| [Notification Library](addons/libnotification@beatlink/) | script | Shared library for sending desktop notifications from TriliumNext scripts. | 1.0.0 |
| [Notifications](addons/notifications@beatlink/) | script | Polls for notes matching a date label and sends desktop notifications for past-due items. | 1.0.0 |
| [Priority Widget](addons/priority-widget@beatlink/) | widget | A widget to set the priority of a note | 1.0.0 |
| [Template Picker](addons/template-picker@beatlink/) | widget | A right-pane widget for assigning or changing the template of the currently active note. | 1.0.0 |
| [ToggleNote](addons/togglenotes@beatlink/) | widget | Configurable buttons to quickly add or remove the current note as a child of one or more parent notes. Supports exclusive mode and placement in either the right pane or left pane launchbar. | 1.0.0 |
| [Trilium Addon Manager](addons/trilium-addon-manager@beatlink/) | widget | This addon allows for the easy installation, removal and updating of Trilium addons from GitHub repositories. | 2.0.1 |
| [WhiteBlueLegacy](addons/whitebluelegacy@beatlink/) | theme | Legacy WhiteBlue theme for older versions of Trilium. A white-dominant theme with light blue accents. | 1.0.0 |
| [WhiteBlueNext](addons/whitebluenext@beatlink/) | theme | This theme has a heavy emphasis on the use of white backgrounds throughout the interface for light users. Light greys and other non white colors are removed where possible. A light blue color is used as an accent for controls, headings and other areas of interest | 0.0.1 |
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
