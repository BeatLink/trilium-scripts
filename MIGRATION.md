# Migrating to the new catalog address

This repository moved to the [Trilium Community](https://github.com/Trilium-Community)
organisation. The catalog moved with it:

| | |
| --- | --- |
| Old | `https://beatlink.github.io/trilium-scripts/catalog.json` |
| New | `https://trilium-community.github.io/trilium-scripts/catalog.json` |

GitHub redirects the old repository address, but it does not redirect the old GitHub Pages address —
that one now returns 404. Every addon you installed before the move recorded the address it came
from, so those addons will stop finding their manifests until you point them at the new one.

You have not lost anything. Your notes, settings and saved data are untouched; only the bookkeeping
address is stale.

## Symptoms

- Addons never report an update, however long you wait.
- **Run Diagnostics** reports **Source unreachable** with the detail "its manifest can no longer be
  fetched", naming a `beatlink.github.io` address.

## Fixing it

TAM can repair this itself. It needs the new catalog first, because the repair works by finding a
replacement manifest in a catalog you have added.

1. Open TAM and go to **Settings**.
2. Under **Catalogs**, add the new address:
   ```
   https://trilium-community.github.io/trilium-scripts/catalog.json
   ```
3. Remove the old `beatlink.github.io` catalog from the same list.
4. Still in **Settings**, under **Maintenance**, press **Run Diagnostics**.
5. Each affected addon appears as **Source unreachable**. Press **Repoint & re-sync** on each one.

That rewrites the stored address and re-syncs the addon from the new location in one step.

### TAM itself

TAM manages its own installation, so it appears in the list like any other addon — its button reads
**Repoint & re-sync & reload**. Repair it last, and reload Trilium afterwards: the repaired code only
starts running on the next load.

### If Run Diagnostics is missing

Older versions of TAM have no diagnostics page. Install the current TAM manually from the
[latest release](https://github.com/Trilium-Community/trilium-scripts/releases/latest) — import the
ZIP through **Trilium → Import** — and the page appears, along with the repair described above.

## Why the addresses are not simply rewritten for you

An addon's source address is what decides which code gets installed into your database. Repointing is
offered as a repair you approve per addon rather than something a catalog can do silently, so adding
a catalog can never redirect an addon you already trust to somewhere else.
