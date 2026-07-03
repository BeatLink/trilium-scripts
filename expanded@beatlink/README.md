# Expanded

Keep selected notes always expanded in the Trilium note tree.

## What it does

Trilium collapses note trees when you restart or navigate away. This addon lets you pin specific notes open permanently by marking them with an **Always Expanded** toggle in the right pane. Whenever the branch structure changes, all marked notes are automatically re-expanded.

## How it works

- A right-pane widget shows an **Always Expanded** checkbox for the current note
- Checking it adds the `#alwaysExpanded` label to the note; unchecking removes it
- On startup, a `runOnBranchChange` relation is set on the root note pointing to a backend script
- That backend script finds every note with `#alwaysExpanded` and ensures all its parent branches are expanded

## Installation

Import `expanded@beatlink.zip` via **Trilium Addon Manager** or manually via the Trilium import dialog.

## Usage

1. Navigate to any note you want to keep expanded
2. Open the right pane and check **Always Expanded**
3. The note's branch will stay expanded after restarts and navigation
