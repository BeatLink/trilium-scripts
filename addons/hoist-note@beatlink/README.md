# Hoist Note

A launchbar button that toggles hoisting on the current note.

## Overview

Hoisting focuses the Trilium note tree on a single note, hiding everything outside it. This addon creates a persistent **Hoist Note** button in the launchbar so you can toggle hoisting on and off with one click without navigating to the menu.

## How It Works

- At startup, `setupButtons.js` creates (or updates) a launchbar launcher of type `command`, bound
  to Trilium's built-in `toggleNoteHoisting` command.
- Clicking the button toggles hoisting on the active note: hoisted notes return to root, unhoisted
  notes become the hoisted root.

## Installation

Install via [Trilium Addon Manager](https://github.com/BeatLink/trilium-scripts/tree/main/addons/trilium-addon-manager%40beatlink) or import the ZIP from [Releases](https://github.com/BeatLink/trilium-scripts/releases/latest).
