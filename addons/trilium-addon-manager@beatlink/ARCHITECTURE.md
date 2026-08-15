# TAM Architecture

How Trilium Addon Manager works internally: the notes it owns, how it identifies and resolves them,
what it stores, and what happens during a sync. For the manifest and toolchain an addon author
writes against, see **[MANIFEST.md](MANIFEST.md)**; for what TAM is and how to install it, see
**[README.md](README.md)**.

---

## Note tree

TAM is itself an addon. Once installed, its note tree looks like this:

```
trilium-addon-manager@beatlink  (render note)
├── Database  (JSON code note)
│   ├── Addons  (text note — global addon-root anchor)
│   │   └── <Addon Name>  (TAM-owned root — titled/`#iconClass`-tagged after the addon; every
│   │                       note the manifest attaches via the "root" parent keyword nests here)
│   └── Addon Data  (JSON code note — global persistence anchor)
│       └── <Addon Name>  (TAM-owned persistence root — every note the manifest attaches via the
│                           "persistence" parent keyword nests here)
└── Source Code  (JSX render script)
    ├── TAM.jsx  (the entire frontend widget in one file — see below)
    │   └── lib-tam.js  (the entire backend/data layer in one file)
    │       └── marked.min.js  (vendored markdown renderer)
    └── TAM.css  (appCss stylesheet)
```

TAM is deliberately just a handful of source files — `TAM.jsx` (frontend) and `lib-tam.js`
(backend/data), plus the vendored `marked.min.js`. Each file is
organized into clearly-bannered sections (former `TAMShared`/`TAMListViews`/`TAMDetailAndSettings`/
`TAMDialogs`/`TAMCommands` inside `TAM.jsx`; former `Network`/`Catalog`/`ManifestUtils`/`NoteResolver`/
`Sync`/`Persistence`/`Uninstall`/`Lifecycle`/`libTAMDatabase` inside `lib-tam.js`) rather than
separate notes.

**Relations wired at install time:**

| From | Relation | To |
|------|----------|----|
| `trilium-addon-manager@beatlink` | `renderNote` | `TAM.jsx` |
| `TAM.jsx` | `displayNote` | `trilium-addon-manager@beatlink` |
| `lib-tam.js` | `database` | `Database` |
| `lib-tam.js` | `addonRoot` | `Addons` |
| `lib-tam.js` | `addonPersistence` | `Addon Data` |

### Key notes

- **Database** — a JSON code note that holds all TAM state: the list of added catalog URLs and, per addon, a single merged record covering its installed state, own manifest structure, and pending update prompts (see [The Database Record](#the-database-record) and [Persistence](#persistence)). TAM reads and writes this note on every operation.
- **Addons** — the global anchor under which every addon gets its own TAM-owned root note (titled, `#addonId`-tagged, and `#iconClass`-tagged after the addon), created on first sync via `ensureAddonAnchor`. An addon's manifest never declares or reparents this note itself — it only ever attaches notes to it via the reserved `"root"` parent keyword in `children[]` (see [`children`](MANIFEST.md#children)). TAM's own manifest is the one exception, since it bootstraps via a manual ZIP import before any TAM code can run to synthesize one for it — see [`root`](MANIFEST.md#root-tam-only).
- **Addon Data** — the global anchor under which every addon gets its own TAM-owned persistence root (same naming/tagging), attached to the same way via the reserved `"persistence"` parent keyword. Kept safe from uninstall/prune sweeps alongside the persistent notes it holds (see [Persistence](#persistence)).
- **lib-tam.js** — TAM's whole backend/data layer in one `require()`d note (its public surface is
  available globally as `libTAMjs`). It runs in the browser but uses `api.runOnBackend`/
  `api.runAsyncOnBackendWithManualTransactionHandling` for operations that need backend access
  (fetching URLs, creating notes, modifying note content). It owns the
  `database`/`addonRoot`/`addonPersistence` `currentNote`-bound lookups itself (their relations are
  declared `"from"` this note) — everything else receives an id as a parameter instead. Its
  `loadDatabase`/`saveDatabase` read and write the Database note directly.
- **Source Code** — a plain empty parent note, existing only to group the actual widget code and its
  own children under a clearly-labeled branch of the tree (same shape as any note wrapping multiple
  env variants — see CLAUDE.md's "JS/JSX code note mime" section).
- **TAM.jsx** — the Preact/JSX render widget, nested under **Source Code**, containing the entire
  frontend in one file. Its root component (`RepoManager`, the default export) owns UI-navigation/
  dialog state and the one other `currentNote`-bound read (`displayNote`); the sections above it hold
  the presentational primitives, list/catalog/detail/settings/dialog views, and the data/command
  layer (`useTamCommands`), which in turn calls `lib-tam.js` (`libTAMjs`).

---

## Note Identity: `#TAMFILEID`

Every note TAM creates or resolves gets a permanent label: `#TAMFILEID="{addonId}/{localId}"` (e.g.
`#TAMFILEID="libical@kewisch/lib"`). This label — not any id TAM caches in the Database — is the
canonical way to answer "which real Trilium note is local id X of addon Y": the note carries its
own identity, so it can always be found directly by searching Trilium's own attribute index
(`api.getNoteWithLabel("TAMFILEID", value)`), instead of trusting an external id map that could
silently drift out of sync with the actual note tree (a partial install failure, a manual edit, a
bug).

This makes resolving/placing a note **idempotent**: whether a note is being created for the first
time, or one already exists (a retried operation, a note that survived from before, a cross-addon
export being referenced), the same "look it up by TAMFILEID, then clone or create" logic applies —
`syncAddon` never needs to special-case "did this already happen".

- **Never inheritable.** `#TAMFILEID` is set with a plain `setLabel`/`note.setLabel` call (no
  `isInheritable` flag) — it identifies exactly one note, and must never propagate to its children,
  which would make every descendant falsely match the same lookup.
- **Always read it with the *owned* accessors.** ⚠️ Writing the label non-inheritably is **not**
  enough to stop it propagating. Trilium's `~template` relation is a second, independent inheritance
  path: an instance inherits **all** of its template's labels regardless of `isInheritable`. So if a
  TAM-owned note is itself a `#template` (TAM ships several: `tpl-area`, `tpl-note`, `tpl-task`, …),
  then **every user note templated from it reports that template's `#TAMFILEID` as its own**.

  Consequently `note.getLabelValue("TAMFILEID")` and `note.hasLabel(...)` resolve inherited values
  and will claim ownership of user notes TAM never created. Every ownership check must use
  `getOwnedLabelValue` / `hasOwnedLabel` / `getOwnedAttributes` instead. Note that
  `api.getNotesWithLabel("TAMFILEID")` *also* returns template instances — the scan is only safe
  once each hit is re-checked with an owned accessor:

  ```js
  for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
      if (note.isDeleted) continue
      const value = note.getOwnedLabelValue(tamFileIdLabel)  // NOT getLabelValue
      if (!value) continue                                   // inherited-only: not ours
      // ...
  }
  ```

  This matters most in the prune/sweep paths, where the value gates a `note.deleteNote()` — itself a
  **cascade** that takes the note's entire subtree. Getting this wrong deletes user data at scale: a
  single manifest change that drops a template's local id will otherwise delete every note templated
  from it. This is not hypothetical — it is the cause of the mass-deletion regression fixed in
  6.3.1.
- **Nothing about note identity is cached in the Database at all** — not `rootNoteId`, not
  `settingsNoteId`. Instead, each installed addon's Database record stores its own **manifest
  structure** (see [The Database Record](#the-database-record) below) — `rootNoteId` is derived on
  demand via a `#TAMFILEID` lookup for the addon's TAM-owned root anchor (the reserved local id
  `__tamAddonRoot__`, or the stored `manifest.root` for TAM's own self-bootstrap record), and
  `settingsNoteId` from `manifest.settingsNote` the same way, wherever they're needed
  (`enableAddon`, `deleteAddon`, the addon list UI — batched into one backend round trip there).
  Keeping them "as a cache" would have reintroduced exactly the drift risk this convention exists
  to remove.
- **Soft deletes are accounted for.** `note.deleteNote()` is a soft delete (`note.isDeleted`), so
  every TAMFILEID lookup treats a deleted match as "not found" rather than resurrecting/cloning a
  note that's on its way out.
- **Persisted user data is separated by placement, not by tag.** A note holding user data is an
  ordinary `#TAMFILEID` note, but it's attached under the reserved `"persistence"` parent keyword
  and resolved under the shared **Addon Data** anchor, which no uninstall/prune sweep ever touches.
  See [Persistence](#persistence).

### `#TAMSOURCEURL`: one note per URL, shared across addons

Alongside `#TAMFILEID`, every resolved note carries `#TAMSOURCEURL` with the URL its content came
from — its published `sourceId`, which tracks the branch, rather than the commit-pinned `sourceUrl`
it was fetched from, since a pinned URL is a different string every publish and would match nothing
(see [Publishing](#publishing)) — and `resolveNotes` uses it as a second lookup: a note that doesn't exist yet under *this*
addon's `#TAMFILEID`, but whose `sourceUrl` already exists somewhere, is **cloned into place rather
than copied**. Two addons vendoring the same library file therefore share one note in the database,
which is what keeps a shared library from being duplicated N times.

The consequence is an authoring rule worth stating outright:

> A note shared by `sourceUrl` may not carry per-addon labels or relations.

Only the first addon to install it gets its `#TAMFILEID` — every later addon's
`resolveStoredNoteId` for that local id returns nothing — and the manifest `relations` of *every*
addon declaring it are applied to the same note, so the last sync wins. A pure library module (no
attributes of its own, everything passed in by its caller) shares perfectly; anything that needs to
know which addon it belongs to must ship as that addon's own file, at its own URL. Uninstall is
already safe either way: `detachAddonOwnedBranches` only detaches a shared note from the departing
addon's parents, and deletes it only once nothing else parents it.

---

## The Database Record

`database.installedAddons` is a **flat map keyed by `addonId` alone** — not nested under any
catalog/repository key, since an addon's identity is its own manifest `id`, independent of which
catalog (if any) it happened to be discovered through. `database.catalogs` is a plain array of added
catalog URLs — nothing about a catalog's *contents* is ever cached (see [Catalog Format](MANIFEST.md#catalog-format)),
so deleting a catalog from the browse list never touches anything already installed from it.

Every installed addon's entry in `database.installedAddons[addonId]` is:

```json
{
  "installedVersion": "1.2.3",
  "contentHash": "9f2c...",
  "noteHashes": { "widget": "3ab1...", "style": "c07e..." },
  "manifestSourceUrl": "https://beatlink.github.io/trilium-scripts/foo@bar/_tam_manifest_.json",
  "manuallyInstalled": true,
  "enabled": true,
  "meta": { "name": "...", "description": "...", "author": "...", "license": "...", "type": "...", "homepage": "..." },
  "manifest": { "settingsNote": "...", "readmeNote": "...", "settings": {...}, "hooks": {...}, "allowExternalReferences": false, "children": [...] },
  "persistence": { "pendingPrompts": [...], "settingsBaseline": {...} }
}
```

`manifest` is trimmed down to just the fields TAM still needs once the fetched manifest itself is
gone (`settingsNote`/`readmeNote`/`allowExternalReferences`, `hooks` for the uninstall/apply phases
that run without a fetched manifest in hand, plus `children[]` for walking `persistentLocalIds`) — see `stripManifestForStorage`. `root` is stored too, but only ever set for
TAM's own record (its self-bootstrap exception — see [`root`](MANIFEST.md#root-tam-only)); every other addon's
`manifest.root` is absent, and `rootNoteId` falls back to the reserved TAM-owned anchor local id
instead (see [Note Identity](#note-identity-tamfileid)). `notes[]`/`relations[]`/`labels[]`
aren't duplicated here since nothing ever reads them back from storage; they only drive a live
`resolveNotes` pass against a freshly fetched manifest. This is deliberately **not** "just re-fetch the
manifest whenever you need it": a `manifestSourceUrl` only ever serves the *current* version, so once a
newer one is published this is the only record of what's actually installed, and it means an upstream
manifest change never silently affects an addon until it's actually synced to that new version.

Only a handful of facts are genuinely irreducible and can't be derived from the manifest or the live
note tree:
- **`installedVersion`** — a manifest fetch always reflects the *latest* available version, never
  what's actually installed.
- **`contentHash`** / **`noteHashes`** — the published hashes of what is actually installed, for the
  same reason: the fetched manifest only ever describes what is current. `contentHash` is what an
  update check compares; `noteHashes` is what decides, per note, whether anything needs refetching.
  Left unset by a sync that skipped a note (its fetch failed), so the update check falls back to
  comparing versions until a clean sync records one. See [Publishing](#publishing).
- **`manifestSourceUrl`** — exactly which URL this install came from, read verbatim from the fetched
  manifest at sync time. Used to re-fetch for update checks.
- **`meta`** — a snapshot of the manifest's own top-level display fields (`name`/`description`/etc.)
  at sync time, needed to render the addon list/detail views without a live catalog to pull them from.
- **`manuallyInstalled`** — `true` if the user explicitly installed this addon; `false` if it was only
  ever pulled in as someone else's dependency. Pure user intent. Only ever *promotes* `false` → `true`,
  never the reverse.
- **`enabled`** — technically derivable (scan the root subtree for `disabled:`-prefixed activation
  labels), but cached here anyway since it's read on every addon-list render.

Everything else is read straight from the stored `manifest` (`dependencies`, `exports`) or derived on
demand: **`rootNoteId`** resolves via `#TAMFILEID` from `manifest.root` if set (TAM's own record
only) or else the reserved TAM-owned anchor local id; **`settingsNoteId`** resolves the same way
from `manifest.settingsNote`; **`dependents`** (who depends on *this* addon) is the reverse
of `dependencies`, computed by `getDependents(database, addonId)` scanning every other installed
addon's own record — nothing is pushed or maintained as edges change, so nothing can drift out of
sync. Used by `checkForAddonUpdates`'s update-propagation and `uninstallAddon`'s
cascade-uninstall-if-unused check.

`persistence` holds **`pendingPrompts`** — the update-review diffs collected during a
sync (plus any settings entry, and the item list an `updateReview` hook returned in their place),
cleared once the user applies them — and, for an addon declaring
[`settings`](MANIFEST.md#settings-optional), **`metadataBaseline`**: what the manifest declared about each
note's title, labels and relations at the last sync (see
[per-note metadata review](#per-note-metadata-review-titles-labels-and-relations)),
**`settingsBaseline`**: the merged read-only sources as of the last review,
which is what makes a per-setting review able to tell "the user chose this" from "this default moved
upstream" (see [per-setting review](#per-setting-review-manifestsettings)). The baseline lives here
rather than inside the user's own `config.json` because it is TAM's bookkeeping, not their data:
nothing in the addon has to know it exists, a settings save cannot drop it, and it is discarded with
the record on uninstall. The persistent *notes* themselves survive uninstall by living
under the Addon Data anchor, not by anything stored in this record — see [Persistence](#persistence).

### Hidden libraries, resolved lazily and rootlessly

Addons with `"type": "library"` are never shown in TAM's addon list — TAM installs, updates, and
uninstalls them automatically as a side effect of managing whatever depends on them. A library is
*never* installed on its own, so `syncAddon` never resolves one's whole manifest up front; dependency
resolution is entirely lazy and scoped, driven from whichever cross-addon `children[]`/`relations[]`
entry actually references it:

- **`ensureDependencyExport(depId, exportKey, parentRealId, ctx)`** is the whole mechanism. It looks
  up the export's local id in the dependency's manifest, then **`computeLocalClosure`** walks
  *outward* through the dependency's own `children[]`/local `relations[]` to find the transitive set
  of notes that export actually needs — nothing else in the dependency's manifest is touched. That
  closure is resolved via `resolveManifest` (the same pipeline a full addon install uses, just scoped)
  with the export note parented directly wherever the consumer needs it — **no addon-external anchor
  note anywhere**, since a dependency's notes only ever exist as clones under whichever consumer(s)
  pulled them in.
- A second consumer needing the same or overlapping export finds what was already resolved via
  `#TAMFILEID` and clones it in — there's no "which addon owns the master copy" question.
- A cross-addon reference within that closure (a library depending on another library) recurses into
  `ensureDependencyExport` one level deeper, with cycle protection (`ctx.resolvingExports`).
- Each dependency still gets its own `database.installedAddons[depId]` entry (`recordDependencyMeta`)
  with its full fetched manifest (not just the resolved closure — every lookup already tolerates "not
  found"), so update-checking and dependent-tracking work exactly as for a directly-installed addon.
  `pruneRemovedNotes` still runs on every resolution.
- **Known, deliberate gap:** the persistence pass and the enable/disable label-toggling machinery
  aren't wired into the lazy dependency path — both assume a single addon-owned root note whose
  subtree *is* the whole addon, which doesn't fit a partially-resolved closure. No current library in
  this repo attaches anything under the reserved `"persistence"` parent or needs independent
  enable/disable.

`deleteAddon` is branch-scoped, not a direct `note.deleteNote()` on the root: `detachAddonOwnedBranches`
scans every live `#TAMFILEID`-tagged note whose value starts with `{addonId}/` and detaches it from
each current parent unless that parent is tagged as belonging to a *different* addon. A note only
actually disappears once none of its parents are left — so a dependency still depended on by another
installed addon is provably safe to leave alone, not just probably safe, and this never depends on
assumptions about Trilium's own delete-cascade behavior toward a multi-parented note. Scanning the live
tree by tag (rather than walking `addonRecord.manifest.notes`, a stored snapshot from the last sync) is
what makes this self-healing: a note whose local id got removed from a later manifest version, but
whose removal was never picked up by a `pruneRemovedNotes` run on an in-between update, still gets
found here — cleanup no longer depends on the stored manifest matching what's actually in the tree.

**`sweepOrphanedNotes`** (Settings' "Sweep Orphaned Notes" button) is a separate, user-triggered
maintenance action — never run automatically — that deletes any `#TAMFILEID`-tagged note with zero
parents anywhere. Nothing in normal operation should ever produce one; it's a safety net for a partial
sync failure, not a routine cleanup step.

**`sweepInvalidAddonTreeNotes`** (Settings' "Sweep Invalid Addon Tree Notes" button) is another
user-triggered maintenance action, scoped to descendants of the global **Addons** root only (never
**Addon Data** — persisted user data must survive this). It deletes any note there with no
`#TAMFILEID` at all, or one whose addonId prefix doesn't match a currently-installed addon — e.g. a
stray manually-created note, or leftovers from an addon removed outside TAM's own uninstall flow.

---

## How Sync Works

`syncAddon(addonId, options)` is the single entry point for getting an addon's notes to match its
manifest — a first install, a version update, and TAM updating *itself* are all the same call.
`options.manifestSourceUrl` is required for a fresh install and optional for an update (falls back to
the stored record). This used to be three separate functions (`installAddon`/`updateAddon`/
`selfUpdateAddon`) before find-or-create-by-`#TAMFILEID` removed the need to delete everything first
for a clean slate.

1. Fetch the addon's manifest from `manifestSourceUrl`, resolving any relative `sourceUrl` in it against that URL.
2. `collectPendingPrompts` snapshots any `promptOnUpdate` diffs against currently persisted content, before anything touches it (see [`promptOnUpdate`](#promptonupdate)).
3. `ensureAddonAnchor` find-or-creates this addon's own TAM-owned root anchor (under **Addons**) and, if its manifest attaches anything under the reserved `"persistence"` parent keyword, its own persistence anchor (under **Addon Data**) — titled, `#addonId`-tagged, and `#iconClass`-tagged after the addon, never something the addon's manifest declares itself. `resolveManifest` then resolves the addon's notes (`resolveNotes`, topological order) and walks `children[]`/`relations[]`, recursing into `ensureDependencyExport` for cross-addon references (see [Hidden libraries](#hidden-libraries-resolved-lazily-and-rootlessly)). A note whose declared parent is the reserved `"root"`/`"persistence"` keyword resolves directly under the matching anchor instead of another local note. Per note: found via `#TAMFILEID` (and not soft-deleted) → cloned into the correct parent, content/type/mime overwritten unless `skipOnUpdate` (or persistent placement) says otherwise; not found → created and tagged. Content is fetched fresh from `sourceUrl`, backend-side, through the same 429 retry-with-backoff wrapper every fetch in this file uses — skipped entirely for a note whose published `sha` matches the one recorded at the last sync (see [Publishing](#publishing)). A note's fetch failure is logged and it (and anything parented under it) is skipped, not fatal. TAM's own root note is the one structural special case — its manifest still declares a real `root` note (see [`root`](MANIFEST.md#root-tam-only)), which lives above the Addons tree (wherever it was manually ZIP-imported) and skips the per-addon anchor entirely, so its own parent is never touched. This step runs twice when the addon's manifest attaches anything under `"persistence"`: a **persistence pass** resolving that subtree under this addon's own persistence anchor first, then a **structural pass** resolving everything else under this addon's own root anchor — both writing into one shared note map so cross-anchor relations resolve (see [Persistence](#persistence)). A persistent note is never content-overwritten once it exists.
4. `reconcileNoteParenting` clones every note into every parent its manifest currently declares and detaches it from any parent it's no longer declared under — scoped to only ever detach a branch *this addon's own* manifest created, so a lazily-resolved dependency export shared by multiple consumers is never mistaken as stale by another consumer's clone.
5. Labels/relations are (re)applied, scoped to whatever was just resolved. Both are disable-state aware — if the addon is currently disabled, writes go to the `disabled:`-prefixed name instead of live-reactivating it. A trailing `(inheritable)` suffix on a label name sets a real `isInheritable` attribute.
6. `pruneRemovedNotes` deletes any live `#TAMFILEID`-tagged note under this addon's prefix whose local id is no longer in the current manifest — for the top-level addon and again for every dependency touched along the way.
7. The Database record is updated: merged in place (never resetting `manuallyInstalled`/`enabled`) if already installed, written fresh only for a genuine first install. `updateAvailable` is explicitly cleared on the merge path.
8. A brand-new (non-self) install is left disabled; an already-installed addon's `enabled` state is untouched.
9. The addon's own lifecycle hooks run, if it declares any (see [`hooks`](MANIFEST.md#hooks-optional)): `postInstall` on a first install, or `postUpdate` followed by the `updateReview` collect pass on an update. TAM's own record is exempt — a hook for TAM would run mid-self-replacement. Hooks only run on this top-level call, never for a dependency resolved along the way by `ensureDependencyExport`, which only ever resolves the exports a consumer asked for rather than the whole addon.
10. The settings review runs last for an addon declaring [`settings`](MANIFEST.md#settings-optional): on a first install it just records the merged defaults sources as the `settingsBaseline`; on an update it adopts defaults the user never diverged from, then appends one per-setting entry to the pending prompts if anything is left to decide (see [per-setting review](#per-setting-review-manifestsettings)). Being last and additive is what lets it coexist with both the whole-file diff and an `updateReview` hook.

There is no cascade to a dependent when its own dependency updates: a dependency's notes resolve in
place (the real note id a dependent's clone points at never changes across a version bump), so there's
nothing for existing clones to break. The one known gap: if a dependency *removes* a previously
exported note while a dependent still holds a clone of it, that dependent isn't automatically
resynced — `ensureDependencyExport` just returns `null` for a vanished export (logged and skipped).

**Update All Addons:** calls `syncAddon` for every out-of-date addon in sequence, TAM included. If any
have pending `promptOnUpdate` prompts, the Update Review screen is shown once per addon until the
queue is empty.

---

## Publishing

A manifest is written in one form and installed in another.

A **source manifest** (`addons/{id}/_tam_manifest_.json`) is the hand-authored one: it names each
note's file by a path relative to itself and carries no URLs of its own. `tamhelper.js publish`
turns every source manifest into a **published manifest**, deployed to the catalog site at
`https://beatlink.github.io/trilium-scripts/{id}/_tam_manifest_.json`, which is what TAM actually
fetches and installs from. Publishing does three things:

1. **Resolves every relative `sourceUrl`** against one commit —
   `raw.githubusercontent.com/{owner}/{repo}/{sha}/...`. A published URL therefore never moves, and
   never serves a stale cached copy the way a `refs/heads/main` URL does. Each note also gets a
   `sourceId`: the same file's branch-tracking URL, which is what note sharing is matched on (see
   [`#TAMSOURCEURL`](#tamsourceurl-one-note-per-url-shared-across-addons)) precisely because it does
   *not* change every publish.
2. **Hashes every file**, as a `sha` per note and one `contentHash` over the manifest as a whole.
3. **Writes `catalog.json`**, the list of every published manifest URL (see
   [Catalog Format](MANIFEST.md#catalog-format)).

It is deliberately offline and deterministic: only files on disk are hashed, and the same commit
always publishes byte-identically. A `sourceUrl` that was already absolute in the source manifest
points at someone else's repo, so it is carried through untouched and contributes its URL rather
than its content to the hash — fetching it here would make the same commit publish differently
depending on what upstream did that day. Such a note has no `sha`, so it simply refetches on every
sync, as everything did before hashes existed.

`contentHash` covers the manifest with each note's `sourceUrl` replaced by that note's `sha`, so it
tracks content and structure and **not** the commit the URLs happen to be pinned to — otherwise
every addon would report an update on every push.

### What the hashes are for

**Detecting updates without a version bump.** `checkForAddonUpdates` compares the fetched
`contentHash` against the one recorded at the last sync: any change to any file, or to the manifest's
structure, is an available update on its own. `latestVersion` is still declared, still shown, and
still the fallback comparison for a manifest carrying no hash (a hand-authored one, or an install
predating this) — but shipping a fix no longer depends on remembering to bump it.

**Not refetching what hasn't changed.** A sync used to fetch every file in the manifest whether or
not anything had moved. Now a note whose incoming `sha` matches the one recorded at the last sync is
skipped entirely — no fetch, no content write — so changing one file in a 25-note addon costs one
request instead of 25. Its title, type and mime still track the manifest, so a rename with no content
change still applies. A note whose fetch failed is left out of the recorded hashes, so the next sync
retries it rather than reading it as already current.

**Asking about a persistent note only when the shipped side moved.** A persistent note whose
upstream default is unchanged raises no Update Review entry, even if the user has edited theirs —
the same rule the per-setting review already followed (see
[per-setting review](#per-setting-review-manifestsettings)).

---

## Persistence

Some addon notes hold user data (settings, cached data, customized content) that should survive addon
updates *and* uninstalls. A manifest attaches one or more notes (directly or via further nesting)
under the reserved **`"persistence"`** parent keyword in `children[]` — the persistence-anchor
equivalent of `"root"`. Everything reachable from `"persistence"` through `children[]` is the
addon's *persistent* notes; everything else is *structural*.

The rule is placement, not per-note flags: a note is persistent because it's reachable from the
reserved `"persistence"` parent, full stop. Persistent notes are **created once and never
overwritten on update** (they are implicitly prompt-on-update — see
[`promptOnUpdate`](#promptonupdate)), and they are **never deleted on update**. An uninstall keeps
them too unless the user explicitly asks otherwise: for an addon that owns any persistent note, the
uninstall dialog offers **"Also delete this addon's stored data"**, off by default, which drops the
protected-id list so the same sweep takes the persistent notes and their anchor along with everything
else. An addon's own `preUninstall` hook is told which way that went via `deleteData`, but does not
make the decision (see [`hooks`](MANIFEST.md#hooks-optional)).

### Two anchors, two passes

Persistent notes are ordinary `#TAMFILEID` notes — same identity as any structural note — but they are
resolved under a different, stable anchor. Structural notes hang under this addon's own TAM-owned root
anchor (a child of **Addons**, torn down on uninstall); persistent notes hang under this addon's own
TAM-owned persistence anchor (a child of **Addon Data**) that no uninstall or prune sweep ever touches.
So survival is a property of *which anchor a note lives under*, not of a separate tag namespace. Both
per-addon anchors are created by `ensureAddonAnchor`, titled/`#addonId`/`#iconClass`-tagged after the
addon — an addon's own manifest never declares or reparents either one, only attaches children beneath
them via the reserved `"root"`/`"persistence"` parent keywords.

`syncAddon` therefore resolves an addon in two passes over the same shared note map:

1. **Persistence pass** — resolves everything reachable from the reserved `"persistence"` parent
   under this addon's persistence anchor. Runs first so persistent notes are already in the note
   map before any relation is applied.
2. **Structural pass** — resolves everything else under this addon's root anchor. A cross-anchor
   relation (e.g. `settings --configNote--> config`, where `config` is persistent) resolves cleanly
   because the persistence pass already populated its target.

`resolveNotes` skips content writes for any note whose local id is in the persistent set, so a persistent
note that already exists keeps the user's data; a persistent note that doesn't exist yet is created from
its shipped `sourceUrl`/inline content exactly once.

### Sweeps skip persistent notes

Every uninstall/prune sweep (`detachAddonOwnedBranches`, `pruneRemovedNotes`) is passed the addon's
persistent id set — which `deleteAddon` extends with the persistence anchor's own synthetic local id, so
the anchor holding those notes survives alongside them — and leaves all of it in place. The structural
root anchor is not protected, so it (and everything under it) is torn down along with the rest of the
structural tree; the persistence anchor and its subtree remain under Addon Data, and a later reinstall of
the same addonId re-adopts each note by its `#TAMFILEID`, user data intact.

⚠️ The persistent-id set protects notes TAM *owns*. It does nothing for **user notes templated from a
TAM-owned template**, which are not TAM notes at all but inherit the template's `#TAMFILEID` and are
therefore invisible to this protection. That is a read-side concern: the sweeps must resolve ownership
with the owned accessors, per
[Note Identity: `#TAMFILEID`](#note-identity-tamfileid). A sweep that reads the inherited value will
delete those user notes and their whole subtrees regardless of what the persistent set contains. Deleting stored data on uninstall is opt-in per uninstall for exactly
this reason.

---

## `promptOnUpdate`

Every **persistent** note (one reachable from the reserved `"persistence"` parent keyword — see
[Persistence](#persistence)) is prompt-on-update *by default*: TAM never overwrites it silently, but
it does surface an upstream change so the user can opt in. There is no per-note `promptOnUpdate`
flag to set — placement under `"persistence"` is what enables this behaviour.

Before an update, for each persistent note — skipping any whose published `sha` is unchanged since
the last sync, since nothing upstream moved to ask about:
1. TAM reads the note's current content (the live persistent note).
2. TAM reads the new content from the incoming manifest (fetched fresh from its `sourceUrl`, or the
   inline default).
3. If they differ, TAM stores a pending prompt (both versions of the content plus the note title).

After reinstallation, if there are pending prompts, TAM shows the **Update Review** screen:
- Each changed note is shown with two side-by-side panels: **Keep Mine** (current) and **Use New Default** (incoming).
- The default selection is **Keep Mine**, unless the row itself says otherwise (a per-setting or
  per-metadata row the user never diverged from starts on **Use New Default** — see below).
- The user can switch any note to "Use New Default" before clicking Apply.
- Choosing "Use New Default" writes the new content to the persistent note. Choosing "Keep Mine" leaves it untouched.
- Once all choices are applied, the review is dismissed and the addon UI reloads.

### Per-setting review: `manifest.settings`

Whole-file diffing is the right shape for a note whose *content* is the thing the user edited (a
bundled template, a seeded page). It is the wrong shape for a settings document: `config.json` is
one blob holding dozens of unrelated answers, so a whole-file prompt asks a question nobody can
answer well, and "Use New Default" replaces every setting at once.

An addon that declares [`settings`](MANIFEST.md#settings-optional) gets a per-setting review instead, produced
by TAM itself — no hook note, no code in the addon:

1. Its config note is **excluded** from whole-file diffing (a config note ships empty, so diffing it
   would offer to replace everything the user ever saved with `{}`).
2. On a **first install**, TAM records the merged read-only sources — everything under the config
   note in its `sourceConfig` chain — as that addon's `settingsBaseline`.
3. On an **update**, TAM compares those sources against that baseline. **Every default that moved
   gets a row**, whether or not the user ever customized it — an update that brings new defaults is
   shown key by key rather than silently adopted.
4. The entry has one row per setting: **Keep Mine** against what the user has today, **Use New
   Default** against the new shipped value. A row the user never customized starts on Use New
   Default (it is already following the source); one that conflicts starts on Keep Mine.
5. **Use New Default** drops the user's override — the scalar's key, or a registry entry's shadowing
   entry — so the setting tracks the defaults source again. **Keep Mine** *pins* what they have
   today into `config.json`, which is what stops an untouched setting from following the new default.
   Either way the baseline advances, so the same question is never asked twice.

An item is only raised when the **shipped** side changed since the baseline. Everything else stays
silent: a value that already equals the new default, a customization made against a default that has
not moved, a field new in this version (no baseline to diff), and — for registries — entries the
user deleted (a removal is never resurrected) or that the addon no longer ships. An install
predating this feature has no baseline, so its first update records one and reviews nothing: there
is genuinely no way to know which of its stored values were deliberate.

`list` fields are skipped entirely: a stored list replaces its default wholesale rather than
reconciling per entry, so "use the new default" could only mean discarding the user's entries.

TAM reads all of this through the very same `libSettingsCore.js` note that libsettings' own frontend
half uses, wired under `lib-tam.js` in TAM's manifest, so "the user changed this" means exactly what
the settings form that wrote the file meant by it.

### Per-note metadata review: titles, labels and relations

Content is not the only thing an update rewrites. `resolveNotes` sets every declared title, and
`applyLabels`/`applyRelation` set every declared label and relation — so a note the user renamed, or
a label they retargeted, is silently reverted on the next update. That metadata gets the same
key-by-key review a settings document does, for every addon, with nothing to declare:

1. Before the sync rewrites anything, TAM reads the live title, label values and relation targets of
   every note the manifest declares.
2. It compares what the manifest declares **now** against `metadataBaseline` — what it declared at
   the last sync, kept on the addon's own database record.
3. Every declaration that moved becomes one Update Review row: `<note>: title`,
   `<note>: label <name>`, `<note>: relation <type>`. A declaration the manifest **dropped** shows
   `(removed)` as its incoming side; one it **added** shows `(none)` as the current side.
4. A row starts on **Use New Default** when the live value still matches the old declaration (the
   user never touched it), and on **Keep Mine** when it does not.
5. **Use New Default** makes the note match the manifest — which is also the only way a label or
   relation the manifest no longer declares is ever removed. **Keep Mine** writes the pre-update
   value back, since the sync has already overwritten it by the time the user answers.

A row is only raised where the *declaration* changed: a title the user renamed against a manifest
that still says the same thing is left alone and never asked about. An install predating this
feature has no baseline, so its first update records one and reviews nothing. The baseline advances
at sync time, not when the user answers — each row already carries both values, so it stays
applicable either way.

### Replacing the diff with per-item review

An addon that declares an `updateReview` hook (see [`hooks`](MANIFEST.md#hooks-optional)) supplies its own list
of reviewable items instead of the whole-file diff, and applies the chosen ones itself. TAM renders
whole-file, hook and settings entries on the same Update Review screen; on the hook path it writes
nothing itself.

The built-in diff is still collected before every sync, so an addon whose hook throws or returns
something unusable falls back to it rather than losing the prompt entirely. The settings entry is
**additive** — it is appended after the hook has had its say, so an addon can have both.

Setting `promptOnUpdate` or `skipOnUpdate` on a note that is already reachable from the reserved
`"persistence"` parent is redundant (the placement already governs it) and `validate` warns about it.

---

## Enabling and Disabling

TAM enables and disables addons by toggling Trilium activation labels. The following labels are considered "activation labels":

`widget`, `renderNote`, `run`, `customRequestHandler`, `customResourceHandler`, `titleTemplate`, `appCss`, `webViewSrc`, `iconPack`, `runOnNoteCreation`, `runOnNoteTitleChange`, `runOnNoteChange`, `runOnNoteContentChange`, `runOnNoteDeletion`, `runOnBranchCreation`, `runOnBranchChange`, `runOnBranchDeletion`, `runOnChildNoteCreation`, `runOnAttributeCreation`, `runOnAttributeChange`, `appTheme`

**Disabling:** Each activation label is renamed to `disabled:{labelName}` (e.g., `run` → `disabled:run`). Trilium does not recognize `disabled:` prefixed labels, so the scripts stop running.

**Enabling:** Each `disabled:{labelName}` label is renamed back to `{labelName}`.

TAM scans the entire subtree of the addon's root note, so activation labels on any descendant note are toggled correctly.

---

## Validating the Database

The **Validate Database** button runs `libTAMjs.validateDatabase()`, which audits every installed
addon against the live Trilium note tree — read-only, never fixes anything:

- **Duplicate `#TAMFILEID`s** — no two live notes claim the same `{addonId}/{localId}` id (the one thing
  a live-lookup design can't self-correct, since `getNoteWithLabel` just returns whichever match it finds
  first).
- **Missing dependency** — a declared `manifest.dependencies` entry that isn't actually installed.
- **Note existence** — the addon's root note (the stored `manifest.root` local id for TAM itself,
  or the reserved TAM-owned anchor local id for every other addon) and the stored
  `manifest.settingsNote` local id still resolve, checked only for an addon that's both installed
  *and* `manuallyInstalled` — a lazily-resolved dependency's root is never forced into existence at
  all (see [Hidden libraries](#hidden-libraries-resolved-lazily-and-rootlessly)), so a missing one
  there is expected, not an issue.
- **Persistence integrity** — for an addon whose manifest attaches anything under the reserved
  `"persistence"` parent keyword, every persistent note still resolves by its `#TAMFILEID` under
  that addon's own persistence anchor (a child of Addon Data). A missing one means the note was
  lost and a re-sync is needed.

Returns a flat list of `{ addonId, message }` issues, rendered as a dismissible panel. It fixes
nothing itself. Related but separate: **Sweep Orphaned Notes** (`sweepOrphanedNotes`) deletes any
`#TAMFILEID`-tagged note with zero parents, a safety net for a partial sync failure.

---

## Diagnosing and Repairing Addons

Validation above answers *"is TAM's own bookkeeping intact?"* and checks only the notes TAM can't
function without. **Diagnose Installed Addons** (`diagnoseAddons()`) answers the wider question —
*"is what's installed actually what the manifest says?"* — by fetching every installed addon's live
manifest and comparing it against the tree.

This exists because of a specific hole in `syncAddon`: it advances `installedVersion`
**unconditionally**, but records a `contentHash` only once *every* note resolved. A note whose fetch
failed is logged and `continue`d, so the addon ends up reporting itself up to date while still
running the previous version's code.

| Issue code | What it means | `repair` |
|---|---|---|
| `dead-source` | The record's `manifestSourceUrl` can no longer be fetched. | `repoint`, or none if no catalog carries it |
| `unverifiable-source` | The manifest has no `contentHash` and no per-note `sha`, so updates fall back to comparing version numbers and installed content can't be checked at all. | `repoint`, or none |
| `partial-sync` | The manifest has a `contentHash` but the record doesn't — the fingerprint of a sync that half-failed. | `resync` |
| `missing-note` | A declared note isn't installed. | `resync` |
| `content-drift` | The installed note's sha256 doesn't match the manifest's `sha` — stale bytes or a hand edit. | `resync` |
| `broken-wiring` | A declared `children[]` parenting, `relations[]` entry, or `labels[]` entry isn't applied in the tree. Catches the require-needs-a-*direct*-child case that `validate` can't see at build time. | `resync` |

Three exclusions keep the content check honest, since a manifest `sha` is the digest of the *source
file*: **persistent** notes hold the user's own data and are meant to diverge, a **`renderAsHTML`**
note stores `marked.parse()` output rather than the markdown that was hashed, and a **binary** note
isn't worth shipping over the wire to hash.

Note resolution mirrors `resolveNotes()` exactly, including the shared-vendored-file path: a file two
addons both vendor is installed **once**, under whichever addon got there first, so a note that
doesn't answer to this addon's `#TAMFILEID` is still installed if one carries its `#TAMSOURCEURL`.
Matching on the id alone would report every shared library note as missing.

**Repair All** (`healAddons(issues)`) repoints every record whose source went dead or unverifiable —
to a hashed manifest from an added catalog — then calls `syncAddon(addonId, { manual: false })` for
each affected addon. `syncAddon` is the *only* repair: it already re-creates missing notes, rewrites
drifted content, re-applies wiring and records the hashes, so there is no second repair path to keep
correct. It also still routes persistent notes through the prompt system, so healing can never
silently overwrite settings. `manual: false` keeps a healed addon from starting to claim the user
installed it by hand.

---

## Dependency graph

The **GitHub Pages catalog** (`resources/docs/`) renders a [Mermaid](https://mermaid.js.org/) flowchart of the
dependency edges between addons (every addon's `manifest.dependencies`): a collapsible whole-catalog
graph on the index page, and a focused per-addon subgraph (the addon plus its transitive dependencies
and dependents) on each addon's detail page. Built at generate time by `tamhelper.js generate-pages`
(`buildDepGraph` + `mermaidBody`/`mermaidForAddon`) and rendered client-side by the Mermaid ESM
build loaded from a CDN in `base.html`, only on pages that actually contain a diagram. Arrows point
from an addon to what it depends on; nodes are coloured by the type palette as the catalog badges
(`TYPE_COLORS`).

The in-Trilium TAM widget does not render dependency graphs.
