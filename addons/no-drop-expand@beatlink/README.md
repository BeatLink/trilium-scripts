# No Drop Expand

Keeps the note tree closed when you drag a note into a collapsed folder.

## The problem

Drag a note into a folder that is closed and Trilium opens that folder, along with every folder
above it. The expansion is saved to the database, so it survives a restart and syncs to your other
clients. Reorganising a few notes leaves a tree that is open everywhere.

## What this does

For two seconds after a drop on the tree, this addon blocks the two things that open the folders:

- `expandToNote`, which walks the path to the note and opens each folder on it
- Fancytree's `activeVisible` option, which opens the ancestors of whichever node is made active

The note you moved still becomes the active note and the tree still refreshes normally. Nothing is
written to the database, so the folders stay shut after a restart too.

Hovering over a folder while dragging still opens it after 600ms, which is how you drop into a
folder you cannot see. That behaviour is untouched.

## Installation

Install through the Trilium Addon Manager and enable it, then reload the UI.
