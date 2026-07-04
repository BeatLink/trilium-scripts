# Hoist Note

Adds a launchbar button to quickly toggle hoisting of the current note.

## Overview

Hoisting focuses the Trilium note tree on a single note, hiding everything outside it. This addon creates a persistent **Hoist Note** button in the launchbar so you can toggle hoisting on and off with one click without navigating to the menu.

## How It Works

- At startup, `setupButtons.js` registers a launchbar button of type `script` pointing to `hoistNote.js`.
- Clicking the button runs `hoistNote.js`, which checks whether the current note is already hoisted:
  - If it is, hoisting is cleared (returns to root).
  - If it isn't, the current note becomes the hoisted root.

## Installation

Install via [Trilium Addon Manager](https://github.com/BeatLink/trilium-scripts/tree/main/addons/trilium-addon-manager%40beatlink) or import the ZIP from [Releases](https://github.com/BeatLink/trilium-scripts/releases/latest).
