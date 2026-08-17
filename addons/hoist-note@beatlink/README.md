# Hoist Note

Quick focus actions for the current note: a launchbar button that toggles hoisting, and a **Note
Actions** right-pane widget.

## Overview

Hoisting focuses the Trilium note tree on a single note, hiding everything outside it. This addon creates a persistent **Hoist Note** button in the launchbar so you can toggle hoisting on and off with one click without navigating to the menu.

It also ships a **Note Actions** right-pane widget, shown on every note, with two buttons: **Zen
Mode** and **Hoist Note**. The widget was previously part of
[`agenda@beatlink`](../agenda%40beatlink/README.md) and moved here in 1.1.0.

## How It Works

- At startup, `setupButtons.js` registers a launchbar button of type `script` pointing to `hoistNote.js`.
- Clicking the button runs `hoistNote.js`, which checks whether the current note is already hoisted:
  - If it is, hoisting is cleared (returns to root).
  - If it isn't, the current note becomes the hoisted root.
- `noteActions.jsx` renders the right-pane widget; its Hoist button applies the same toggle inline,
  and Zen Mode fires Trilium's `toggleZenMode` command. `noteActions.css` styles it.

## Installation

Install via [Trilium Addon Manager](https://github.com/BeatLink/trilium-scripts/tree/main/addons/trilium-addon-manager%40beatlink) or import the ZIP from [Releases](https://github.com/BeatLink/trilium-scripts/releases/latest).
