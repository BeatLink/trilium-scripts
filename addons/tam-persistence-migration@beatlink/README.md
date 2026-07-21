# TAM Persistence Migration

A **one-time** helper that migrates existing installs off TAM's old copy-on-write persistence
model onto the current two-roots (placement) model.

## When you need it

Only if you had TAM addons with persisted user data (settings, templates, cached content) installed
under the old `#TAMDATAID` copy-on-write model, and you have since updated TAM and those addons to
the `persistenceRoot` model. Fresh installs never need this.

## What it does

For every installed addon that still has old-model persistence bookkeeping, it takes each persisted
copy (a note tagged `#TAMDATAID = "addonId/key"` under the per-addon folder in **Addon Data**) and:

1. drops its `#TAMDATAID` label,
2. adds `#TAMFILEID = "addonId/<localId>"` (the note's persistent local id in the new manifest),
3. re-homes it directly under the shared **Addon Data** anchor,

then removes the now-unused `persistence` sub-object from TAM's Database record. Your data is never
copied or deleted — the same note is simply re-tagged and re-parented in place.

It is **idempotent**: running it again after migration does nothing.

## How to run it

1. Install this addon through TAM.
2. Enable it. The migration runs on the next frontend start and shows a message listing what it
   re-homed (or that there was nothing to do).
3. Uninstall it.
