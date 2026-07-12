# Expanded

Keep selected notes always expanded in the Trilium note tree.

## What it does

Trilium collapses note trees when you restart or navigate away. This addon lets you pin specific notes open permanently with the **Always Expanded** checkbox in the right pane header. Whenever the branch structure changes, all marked notes are automatically re-expanded.

## How it works

- A right-pane panel titled **Always Expanded** shows a checkbox in its header for the current note
- Checking it adds the configured label (default `#alwaysExpanded`) to the note; unchecking removes it
- On startup, a `runOnBranchChange` relation is set on the root note pointing to a backend script
- That backend script finds every note carrying the configured label and ensures all its parent branches are expanded

## Settings

The addon's settings (in the Trilium Addon Manager detail page) expose one option:

- **Label Name** — the note label used to mark a note as always expanded (default `alwaysExpanded`). Both the header checkbox and the backend pin script read this same setting, so changing it keeps them in sync.

## Installation

Import `expanded@beatlink.zip` via **Trilium Addon Manager** or manually via the Trilium import dialog.

## Usage

1. Navigate to any note you want to keep expanded
2. Open the right pane and check the box in the **Always Expanded** panel header
3. The note's branch will stay expanded after restarts and navigation

