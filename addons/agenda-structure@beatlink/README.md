# Agenda Structure

The notebook **scaffolder**, split out of [`agenda-organize@beatlink`](../agenda-organize@beatlink/README.md)
into its own addon: the **Workflow Setup** provisioner, the structural templates it instantiates, and
the **Structure Editor** settings page that hosts the button.

It provisions containers and owns the structural identity labels. It does not triage, file, or move
items — that is the Organize page's job, in the addon this was split from.

## Why this is its own addon

Provisioning and triage have different lifecycles. Setup runs once, then again only when the Area or
Type vocabulary changes. Triage runs constantly. Keeping them together also forced a circular
`require`: the provisioner pulled `getBucketTemplates()` out of the triage page's `organize.js`, which
is otherwise pure page logic. Split, provisioning reads
[`template-picker@beatlink`](../template-picker@beatlink/README.md)'s registry directly and the cycle
is gone.

## Configuration and cross-addon reads

This addon owns its own settings note (`structureSchema.json` / `structureConfig.json`) tagged
**`#agendaStructureConfig`**, reached from the **Structure Editor** page. It holds no settable values
today — Setup is a button, not a preference — but the anchor exists so the page is discoverable the
same way every other addon's is.

**Neither classification vocabulary is owned here**, and both are read cross-addon through
`getConfigIds()` in `structureSettings.js`:

- the **Area** list comes from [`agenda@beatlink`](../agenda@beatlink/README.md)'s `dimensions`
  registry (`#agendaConfig`) — the dimension flagged `scaffoldsAreas`;
- the **Type** list comes from `template-picker@beatlink`'s own registry (`#templatePickerConfig`).

Both owners also *write* those lists, so a local copy would silently drift. Both reads degrade
gracefully: each returns an empty vocabulary when its owner isn't installed, and Setup then
provisions only what it can — with neither present, the three singletons alone.

As of 2.0.0 `template-picker@beatlink` also ships the **AreaCollection** template note itself (see
[The structural templates](#the-structural-templates)). That read degrades the same way: Setup
resolves it by title, and an Area root simply gets no `~template` when template-picker isn't
installed.

## Relationship to `agenda-organize@beatlink`

**One-directional, through labels rather than code.** This addon *writes* the three structural
identity labels; Organize *reads* them to find the roots it walks. Neither requires the other's code.

Installed alone, this addon provisions a structure with no triage UI. Installed alone,
`agenda-organize` triages an already-provisioned tree but cannot scaffold one. Most users want both.

The identity labels keep their original `agendaOrganize*` names. Renaming them would orphan every
provisioned root in an existing tree for no benefit — the name is a stable contract, not a statement
of ownership. Note `agenda@beatlink`'s own `profileEditor.jsx` also reads
`#agendaOrganizeSpecial="inbox"`, so this contract has a third consumer.

## The structure

Two **parallel** top-level trees, each exactly one level deep, plus three singletons:

```
Inbox / My Day / Agenda      the singletons
Career/  Home/  ...          one root per Area value, items directly inside
Task/    Project/  ...       one root per enabled template, items directly inside
```

An item lives in **both** trees at once as a Trilium clone: one branch under the Area root matching
its `#area`, one under the Type root matching its `~template`. Neither tree nests the other.

## Provisioning model — runtime find-or-create

The structure is provisioned by the **Workflow Setup** button (Structure Editor → Structure ›
Workflow Setup), not cloned in via the manifest, so it merges with notes the user already created by
hand. `provisionStructure(dimensions)` (`provision.js`) reduces the Area dimension to a
`{ slug, name, color }` list and pulls the template list straight from template-picker's own enabled
registry entries (`{ noteId, name, icon }`, via `getBucketTemplates()`), then hands both to
`structure.js`'s `buildStructure(areaList, templateList)`; the walk/find-or-create logic is
`provision.js`.

**Containers only.** Provisioning creates the top-level roots and nothing else. Filing items into
them — the two clones per note — is the Organize page's per-note job, so provisioning never creates,
moves, reconciles or deletes an item branch. Re-running Setup cannot disturb anything you've filed.

- **Identity:** carried by three **mutually exclusive** labels — this system's analogue of TAM's
  `#TAMFILEID`, scoped to user notes:
  - `#agendaOrganizeArea=<areaSlug>` — on an Area root
  - `#agendaOrganizeType=<templateNoteId>` — on a Type root
  - `#agendaOrganizeSpecial=<name>` — on the `inbox` / `my-day` / `agenda` singletons

  No structural note ever carries more than one, so "which kind of root is this?" is a single label
  read. Neither value is parsed out of a composite string, which is what made renames and area
  renumbering fragile. A Type root's identity is the template's own noteId — stable by construction,
  unlike the string slug it replaced, so there's no rename/reorder case to migrate for it.

  The retired `#agendaOrganizeBucket` marked a per-area type bucket back when the type axis nested
  *inside* the area axis. Nothing writes it any more; it is still *read* so a legacy bucket (which
  also carries an area label) is not mistaken for an Area root.
- **Resolution per node (idempotent, rename-safe):** (1) a note already carrying this exact identity
  → adopt; (2) else a same-titled child under the parent → adopt + tag; (3) else create + tag.
- **Legacy migration:** trees provisioned before the split carry a single `#workflowNote=<key>`.
  `migrateStructuralLabels()` re-stamps them onto the identity labels and runs first on every
  provision, so an existing structure is converted in place rather than rebuilt alongside. The old
  *bucket* key shape (`area-<slug>-<templateSlug>`) has no equivalent under the flat structure, so
  those keys are reported as `unparsed` and left untouched, legacy label intact.
- **Derived vs. seed:** icon (`#iconClass`), `#color`, `~template`, an Area root's `#area`, and each
  root's `#alwaysExpanded` are re-asserted on *every* run (self-healing). Note content and
  `seedLabels` are written only on creation, so user edits survive.
- **Area-slug migration:** after the walk, `migrateAreaSlugs()` normalizes every note **owning**
  `#area` onto the area dimension's stable keys — stripping the legacy `<NN>-` prefix and applying
  `AREA_ALIASES` for folded areas. Idempotent: an already-stable value resolves to itself.
- **Structural templates** are resolved live **by title** (`AreaCollection`, `TypeCollection`,
  `Special`), wherever they ship from, so provisioning degrades gracefully if one is missing — the
  note is still created and tagged, just without a `~template` relation.
- **Provisioning never deletes.** It creates, adopts and re-asserts derived attributes; that's all.
  Orphans and duplicates are surfaced in Organize's **Invalid Roots** table for an explicit
  merge-or-delete decision.

## The structural templates

Three templates back the three kinds of container. All three are resolved **by title** at provision
time, so where the note ships from is not part of the contract:

| Template | Used by | Marker | Shipped by |
|---|---|---|---|
| `AreaCollection` | Area roots | `#area` + `#type=areacollection` | `template-picker@beatlink` |
| `TypeCollection` | Type roots | `#type=typecollection`, no `#area` | this addon |
| `Special` | Inbox / My Day / Agenda | `#type=special` | this addon |

The two this addon ships live under `persistence`, so no uninstall or prune sweep touches them.

A Type root is a **container**, not an instance of the type it holds — which is why its own
`~template` is `TypeCollection` rather than the template it collects.

**`AreaCollection` moved out in 2.0.0**, to `template-picker@beatlink`, so every bundled template
note lives in one addon and the picker's Scan sees a single Templates container. Nothing about
provisioning changed — it was already resolved by title. If you had agenda-structure installed
before 2.0.0, **run `template-picker@beatlink`'s
[`migrate-areacollection-from-structure.js`](../template-picker@beatlink/migrate-areacollection-from-structure.js)
once, manually, before updating either addon**: it re-tags the existing note's `#TAMFILEID` so
template-picker adopts it. Skipping it means this addon's next sync prunes the note — being under
`persistence` does not protect a note that has been dropped from the manifest, because
`pruneRemovedNotes` builds its exempt set from the *current* manifest.

Keep AreaCollection's row **disabled** in template-picker's registry. Setup provisions one type root
per *enabled* registry entry, so an enabled AreaCollection row would scaffold a type root for a
container template.

> **Note on `#TAMFILEID` and templates.** Every note templated from one of these inherits the
> template's labels, including `#TAMFILEID`. TAM must therefore resolve addon ownership with the
> *owned* accessors (`getOwnedLabelValue`), never the inherited ones — reading the inherited value
> makes every instance look like a TAM-owned note and a prune sweep will delete it along with its
> whole subtree. See the TAM README's [Note Identity](../trilium-addon-manager@beatlink/README.md)
> section; this is the regression fixed in TAM 6.3.1.

## Files

| File | Role |
|---|---|
| `structure.js` | Pure layout definition — `buildStructure()`, the container titles and `#type` markers. No side effects. |
| `provision.js` | The walk: find-or-create per node, the two migrations, the identity labels. |
| `structureSettings.js` | `getConfigIds()` label discovery, for this addon's own config and the two cross-addon reads. |
| `structureEditor.jsx` | The Structure Editor page; hosts the Workflow Setup button. |
| `templates/` | The `TypeCollection` and `Special` note bodies. `AreaCollection`'s ships with `template-picker@beatlink`. |
