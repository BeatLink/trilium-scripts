# No Drop Expand

Keeps the note tree closed when you drop a note into a collapsed folder.

## The problem

Drag a note into a folder that is closed and Trilium opens it. The expansion is saved, so it
survives a restart and syncs to your other clients. Reorganising a few notes leaves a tree that is
open everywhere.

The decision is made on the server, not in the browser. Moving a branch into a note runs
`moveBranchToBranch()` in Trilium's `services/branches.ts`, which sets `isExpanded` on the target
branch and saves it, "so that the new placement of the branch is immediately visible". That comes
back down as an entity change, and the tree syncs the folder open to match.

## What this does

There is nothing to prevent, only something to undo. The addon notes which folder a drop landed on
while it was still closed, watches for that folder being opened by the entity change, and closes it
again, writing the collapse back to the server so it does not return.

The tree also keeps the open note visible: after a move it expands every folder on the way down to
the active note. Dropping the note you are reading would open the folder a second time, and again
on every later refresh. So when the dragged note is the active one, the tree moves first to a note
that stays put: the next sibling of where it was dragged from, else the previous one, else its old
parent.

Only drops *into* a folder are affected. Dropping between notes to reorder them never expanded
anything, and hovering over a folder while dragging still opens it after 600ms, which is how you
drop into a folder you cannot see.

## Installation

Install through the Trilium Addon Manager and enable it, then reload the UI.
