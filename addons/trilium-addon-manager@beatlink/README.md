# Trilium Addon Manager (TAM)

![Screenshot](./image.png)

Browse available addons at **https://beatlink.github.io/trilium-scripts/**

> ⚠️ **Work in progress.** TAM's manifest format and its Database/persistence model are under
> active development and changing frequently. Data loss is possible. Install this to test and
> explore only — do not use it to manage real/production Trilium data yet.
>
> **7.0.0 breaks in-place updates from 6.x.** Addons are now installed from published manifests (see
> [Publishing](ARCHITECTURE.md#publishing)); the raw manifests a 6.x install points at no longer carry absolute
> URLs, which a 6.x client cannot resolve. Reinstall TAM from the
> [latest release](https://github.com/BeatLink/trilium-scripts/releases/latest) ZIP — every note is
> re-adopted by its `#TAMFILEID`, so nothing is duplicated and persisted data is untouched — and
> the new install points at the published catalog from then on.

## Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how TAM works: its own note tree, note identity, the
  Database record, the sync/publish pipeline, persistence, and the update review.
- **[MANIFEST.md](MANIFEST.md)** — the `_tam_manifest_.json` format, the catalog format, and the
  `tamhelper.js` toolchain that builds and publishes both.

---

## Overview

Trilium Addon Manager (TAM) is a widget-based addon installer for [TriliumNext Notes](https://github.com/TriliumNext/Notes). It lets you install, update, enable, disable, and remove addons from any manifest URL — a single addon directly, or a whole catalog of them — without leaving Trilium. Addons are described by a `_tam_manifest_.json` file that tells TAM what notes to create, how to wire them together, and how to handle updates. An addon's files don't need to live anywhere near its manifest — each note's own `sourceUrl` can point anywhere on the web, so an addon can be composed entirely from files hosted in someone else's repository.

---

## The UI

TAM's own widget is a self-contained Preact app (`TAM.jsx`), styled to match the
GitHub Pages catalog (`resources/docs/`) — same card grid, type badges, search/filter toolbar, and sidebar
detail layout — while still adapting to Trilium's light/dark theme via its own CSS custom properties
for surfaces and text. It has **no addon dependencies of its own** (`dependencies: []` in its own
manifest) — everything below is built directly against `trilium:preact`'s built-in components rather
than a shared library like `libsettings@beatlink`, since a dependency failure in the addon manager
itself would risk taking down the one thing that could otherwise fix it.

- **List view** (default) — a searchable, filterable card grid of every installed addon (libraries
  excluded — see [Hidden libraries](ARCHITECTURE.md#hidden-libraries-resolved-lazily-and-rootlessly)) merged with every
  not-yet-installed addon from every added catalog (fetched live and deduped by id against what's
  already installed), so it shows everything available across every added catalog plus anything
  manually installed by URL, not just what's already on disk. Clicking an installed card opens its
  detail view; clicking a not-yet-installed one shows an **Install** button.
- **Catalog browse view** — fetches a specific catalog's `tam-addons[]` list and every manifest it
  points at, fresh, every time (nothing about a catalog's contents is ever cached — see
  [The Database Record](ARCHITECTURE.md#the-database-record)). Not-yet-installed entries show an **Install** button;
  already-installed ones open the normal detail view instead. Reached via the **Browse** button on
  that catalog's row in the Settings view, not from the main list.
- **Addon detail view** — one page per addon (mirroring `resources/docs/{addon-id}/index.html`): a sticky
  sidebar with the addon's metadata table and full action set (Home Page, Install/Delete,
  Enable/Disable, Settings, Update), and a main panel with the description and — for
  installed addons that declare a `readmeNote` — the addon's own README rendered from its locally
  installed note (see [`readmeNote`](MANIFEST.md#readmenote-optional)), no network fetch required.
- **Settings view** — TAM's own housekeeping page, built manually (no `libsettings@beatlink`
  dependency): a stats overview (catalog count, installed addon count, addons with saved/persisted
  data, addons with an update available), catalog management (each catalog's row has **Browse**,
  **Visit Website**, and **Delete** actions, plus adding a new catalog by URL), a single-addon
  "install by URL" action, and maintenance triggers (Check for Updates, Update All Addons,
  **Run Diagnostics**, Reinitialize Database).
- **Diagnostics** — one audit covering TAM's own bookkeeping, the addon-owned note tree, and every
  installed addon against its live manifest. Results are a table, one row per problem, each with the
  repair for that row: missing notes, content that has drifted from the manifest's hash, wiring the
  manifest declares but the tree doesn't have, orphaned and unclaimed notes, sources that have gone
  dead or carry no hashes, and records left by a sync that half-failed. **Nothing changes until you
  press a row's button** — the audit is read-only, and each repair acts on its row alone. This
  replaced the old Validate Database and the two Sweep actions, which deleted first and reported
  after. TAM audits itself too; repairing its own notes reads "… & reload", since the running copy
  lives in memory and only the next load picks up the repair. Your settings are never overwritten
  silently — a persistent note that differs still goes through the usual Keep Mine / Use New prompt.
  An addon whose source has gone unreachable offers **Uninstall** alongside the repoint, and that
  goes through the normal uninstall flow, so you're still asked about dangling references and saved
  data. See [Diagnostics](ARCHITECTURE.md#diagnostics).
- **Activity log** — a full-screen page recording every operation, in place of the old blocking
  spinner overlay: each note installed, each prompt queued, each update check, each repair. It
  **opens itself whenever something starts running** so you can watch it work, and once nothing is
  running it prompts you to close it. Dismiss with the ✕, **Esc**, or the footer's Close — dismissing
  never cancels anything, and the log keeps filling up behind it. Reopen any time with **Show
  Activity Log** in the Settings view. Only the log scrolls, never the page.

---

## Installing TAM

The only thing that's actually different about installing TAM itself is *how* it gets its first
manifest fetch — there's no other TAM around to click "Install" for you. Everything else is the
ordinary sync path:

1. Download `trilium-addon-manager@beatlink.zip` from the [latest release](https://github.com/BeatLink/trilium-scripts/releases/latest).
2. In TriliumNext, use **Import** to import the ZIP under any note.
3. Open the imported `trilium-addon-manager@beatlink` render note.
4. `database.json`'s seed content pre-populates `installedAddons["trilium-addon-manager@beatlink"]`
   with just TAM's own `manifestSourceUrl` (not a full record — there's nowhere to derive the rest
   from before a real sync resolves the actual note tree). On load, the UI checks whether that
   record is fully populated yet (has an `installedVersion`); if not, it triggers one ordinary
   `syncAddon` call for TAM against that seeded URL — the exact same call any other addon's first
   sync would make. Since every note in the ZIP already carries its correct `#TAMFILEID` (baked in
   by `tamhelper.js tam-to-zip` at build time), that sync finds everything by lookup rather than creating
   anything, and finishes by writing a real, fully-populated Database record — after which TAM is
   indistinguishable from any other installed addon, including showing up correctly in future
   "Check for Updates" runs.
5. Add `https://beatlink.github.io/trilium-scripts/catalog.json` as a catalog (pre-added by default, in `database.json`'s seed content) and browse it to install addons — or install any single addon directly by pasting its `manifestSourceUrl`.
