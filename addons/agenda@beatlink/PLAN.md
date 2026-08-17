# Agenda: unify area/type/priority into open-ended `dimensions`

## Context

Agenda's three main classification axes — **area**, **type** (template), **priority** — are stored
and handled all over the place, with no single source of truth:

- **Vocabularies live in three *other* addons**, discovered at runtime by anchor label:
  `area-picker@beatlink` (`#areaConfig`), `template-picker@beatlink` (`#templatePickerConfig`),
  `priority-widget@beatlink` (`#priorityConfig`).
- **The same ~9-line discovery block is hand-copied 6 times**: `organizeAreas.jsx:11-20`,
  `organizePriority.js:22-30`, `organizeTemplates.jsx:48-56`, `libAgendaConfig.js:146-153`,
  `libAgendaConfig.js:175-182`, plus `agendaSettings.jsx:3-54` for agenda's own config.
- **Agenda's `common/schema.json` hardcodes full copies of the area and priority vocabularies** in
  four separate registries — `filterGroups` (~:272-330), `prefixes` (:412-454), `colors`
  (:487-528), `groupings` (:565-617). Adding an area in area-picker updates the dropdown, the
  Organize buckets, and the sort ordinals, but *silently* does not appear in any of these. They
  have already drifted: the area filter group lists 4 of 13 areas, and priority `2-medium` is
  `lime` in agenda's colors but `gold` in priority-widget's schema.
- **The UI is triplicated**: three near-line-for-line pickers, three structurally identical triage
  `QueueSection`s, two identical settings panels (and priority never got one at all).

Intended outcome: agenda owns **one** `dimensions` registry that is the single source of truth. The
system is **open-ended** — the user can register any number of dimensions (`energy`, `context`,
`client`) and pickers, triage queues, sorting, colors, prefixes, groupings and filters all follow
with no code change. The three picker addons become fully independent; agenda stops discovering
them entirely.

## Decisions already made

- **Clean break.** Agenda owns all three vocabularies. Delete all `#areaConfig` /
  `#templatePickerConfig` / `#priorityConfig` discovery from agenda.
- **Fully open-ended**, not a fixed triple.
- **Config + UI unification**, with the dimension pickers hosted in the **task pane**
  (`task/agendaTask.jsx`).
- `~template` resolution: **"Match templates by name" button** (option b).
- Filters: **derived hybrid** — derive children from dimensions, merge stored `enabled` over the top.
- Old pickers: **strip their agenda wiring too**. Verified this is documentation prose only —
  `area-picker/README.md:16-18` and `priority-widget/README.md:30` reference `#agendaConfig` as a
  pattern example. No code coupling exists. `template-picker` has none.

## Verified constraints

1. **Nested registry works.** `libsettings-ui.jsx:86-87,103-106` — `mergeDefaults`/`filterBySchema`
   recurse on `type: "registry"` at any depth, threading `shippedNode` from the parent item's
   shipped default. `dimensions` → `values` is safe; it matches the shape `prefixes`/`colors`/
   `groupings` already use.
2. **`reference` fields only resolve TOP-LEVEL registries** (`libsettings-ui.jsx:274`, threaded from
   `SettingsForm.renderEntry:696`). Nothing can reference `dimensions.<id>.values`. Dimension values
   are addressable by string key only.
3. **`checklist` filters a sibling top-level registry by `filterBy === itemKey`**
   (`libsettings-ui.jsx:242`). `filterGroups` must stay a real top-level registry with `profileId`
   on each group.
4. **Never `saveSettings` a derived registry.** `filterRegistryBySchema:56-73` diffs
   effective-vs-shipped by `JSON.stringify`; a runtime-injected registry gets written into
   config.json wholesale as "user edits", permanently freezing the derivation. Derivation is
   strictly read-path, after `loadSettings`.

## Design

### Type stays a dimension, with an optional per-value `templateNoteId`

Everything agenda does with type is dimension-shaped: writes `#type=<slug>`, sorts by registry
position, colors/groups/filters/prefixes on it, drives a triage queue. Only two behaviors are
special — the `~template` write (one optional field, one `if` in `assignDimension`) and bucket
scaffolding. Special-casing an entire dimension to avoid one `if` is worse.

`actionable`/`hasPriority` today come off the template *note's* labels
(`organizeTemplates.jsx:85-98`). They become explicit per-value config. This is the biggest semantic
change — document it: those labels stop being read as config.

Scaffolding keys off two dimension-level flags — `scaffoldsAreas` (each value gets a root note) and
`scaffoldsBuckets` (each value gets a bucket in every root) — not off the name "type".
`organizeStructure.js`'s container markers (`areacollection`/`typecollection`/`special`) stay as-is;
they are scaffolding identity, not vocabulary.

### Priority keys keep their `N-name` form

`4-critical` etc. is existing note data — do not re-key. Order comes from registry position; the
numeric prefix becomes a harmless legacy artifact. **This inverts priority sorting** — see R1.

### Schema shape

One top-level registry, `category: "Organize"`, `tab: "Dimensions"`:

```jsonc
"dimensions": {
  "type": "registry", "label": "Dimensions",
  "category": "Organize", "tab": "Dimensions",
  "itemSchema": {
    "name":        { "type": "string",  "label": "Name", "default": "New Dimension" },
    "label":       { "type": "string",  "label": "Note Label", "default": "" },
    "writeColor":  { "type": "boolean", "label": "Also Write #color", "default": false },
    "picker":      { "type": "boolean", "label": "Show Picker In Task Pane", "default": true },
    "triage":      { "type": "boolean", "label": "Triage Unassigned Notes", "default": true },
    "actionableOnly":   { "type": "boolean", "label": "Triage Only Actionable Notes", "default": false },
    "scaffoldsAreas":   { "type": "boolean", "label": "Scaffold A Root Note Per Value", "default": false },
    "scaffoldsBuckets": { "type": "boolean", "label": "Scaffold A Bucket Per Value", "default": false },
    "values": {
      "type": "registry", "label": "Values", "default": {},
      "itemSchema": {
        "name":  { "type": "string", "label": "Name", "default": "" },
        "key":   { "type": "string", "label": "Label Value", "default": "" },
        "color": { "type": "color",  "label": "Color", "default": "gray" },
        "templateNoteId": { "type": "note", "label": "Template Note", "default": "" },
        "actionable": { "type": "boolean", "label": "Actionable", "default": false },
        "icon":  { "type": "string", "label": "Bucket Icon", "default": "" }
      }
    }
  }
}
```

`key` is a field, not the registry id (mirrors how `prefixes.children` uses `labelValue`). Shipped
defaults set id = key for readability; nothing may depend on it. No `order` field — position is the
order. `hasPriority` is dropped, not ported (grep confirms nothing reads it).

**Shipped defaults reproduce today's storage exactly, so no note is rewritten:**

| id         | label      | writeColor | values                                                                                                                                                       |
| ---------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `area`     | `area`     | true       | `career`…`fun`, colors verbatim from `colors.area.children` (schema.json:497-514); `scaffoldsAreas`                                                          |
| `type`     | `type`     | false      | `ideas`,`goal`,`routine`,`task`,`future`,`project`,`note`; `actionable` true for routine/task/future/project; `icon` from `BUCKET_ICONS`; `scaffoldsBuckets` |
| `priority` | `priority` | true       | `4-critical`…`1-low` in that order, colors from `colors.priority.children`, MoSCoW names; `actionableOnly`                                                   |

### Derive prefixes/colors/groupings/filters — don't seed

Seeding needs a write path, and every seed write materializes the whole vocabulary into config.json
(constraint 4), moving drift rather than removing it. Derivation makes "add a dimension → get a
variant free" true by construction.

Injection point: `libAgendaConfig.loadData:110-124`, after `loadSettings`, keyed `dim-<dimensionId>`
so it can never collide with user ids, emitted already in *reshaped* form:

```js
prefixes:  { ...mapEntries(values.prefixes, reshapeVariant),   ...derivedPrefixes(dims) }
colors:    { ...mapEntries(values.colors, reshapeVariant),     ...derivedColors(dims) }
groupings: { ...mapEntries(values.groupings, reshapeGrouping), ...derivedGroupings(dims) }
```

Cost: derived variants aren't editable. Acceptable — the dimension's own `values[].title`/`.color`
is now the edit surface driving all consumers at once; a bespoke variant is still a hand-written
registry entry, and both coexist in the merged map.

**Filters are the hybrid case.** `profiles.filterGroups` is a `checklist` over a top-level registry
filtered by `profileId` (constraint 3), and each child's `enabled` flag is *state*, not derivation.
Derive the children, merge stored `enabled` over the top; the stored side lives under the same
`dim-<id>` key so user toggles round-trip through the existing save path. `date` and `recurrence`
groups stay as-is. **Prototype the delete-a-derived-child interaction first — see R4.**

## Steps

**1 — schema.** Add `dimensions` to `common/schema.json`. Delete hardcoded `area`+`priority` from
`filterGroups.default` (~:272-330), `prefixes.default` (:412-454), `colors.default` (:487-528),
`groupings.default` (:565-617), keeping `interval`/`date`/`recurrence`. Flip shipped priority sorts
to `desc: false` (R1); point `profiles.default` at `dim-priority`.
*Verify:* `validate`; `grep -n 'career\|4-critical' common/schema.json` hits only inside `dimensions`.

**2 — new `common/dimensions.js`.** CommonJS (matches `organize.js`; `require()`d from `.js` and
`.jsx`). Exports `getDimensions()`, `getSortValueMaps()`, `assignDimension()`,
`matchTemplatesByName()`. Add `dimensions` to `getAgendaSettings`'s return
(`common/agendaSettings.jsx:3-54`) and make `getDimensions()` a thin wrapper — avoids a second
settings round-trip in `organizePage`, which already calls it. `getSortValueMaps` keys by the
dimension's `label`, so a new dimension sorts correctly automatically.

```js
async function assignDimension(noteId, dimension, value) {
    return api.runOnBackend((noteId, label, writeColor, key, color, templateNoteId) => {
        const note = api.getNote(noteId)
        if (!note) return false
        if (key) {
            note.setLabel(label, key)
            if (writeColor) { if (color) note.setLabel("color", color); else note.removeLabel("color") }
            if (templateNoteId) note.setRelation("template", templateNoteId)
        } else {
            note.removeLabel(label)
            if (writeColor) note.removeLabel("color")
        }
        return true
    }, [noteId, dimension.label, !!dimension.writeColor, value?.key || "",
        value?.color || "", value?.templateNoteId || ""])
}
```

Deliberate asymmetry: clearing does **not** remove `~template`. Today `assignTemplate("")` does, but
that path is only reachable from the misfiled-fix button, which always passes a real id; removing a
template on "clear type" would destroy the note's promoted attributes. Comment it.

`matchTemplatesByName()` resolves each `type` value's `templateNoteId` by title, reusing
`resolveTemplateId` (`organize/organizeProvision.js:403-408`), and writes the result back via
`saveSettings`. Surfaced as a button in the Dimensions panel (step 7) and called from provisioning
so a fresh install self-heals (R2).

**3 — `libAgendaConfig.loadData` derives.** Delete `getAreaSortMap`/`getTypeSortMap`/
`getSortValueMaps` (`overview/libAgendaConfig.js:142-197`); re-export from `dimensions.js` so
`libAgendaQuery.js:88`'s zero-arg call site is unchanged. Merge derived variants in `loadData`. Do
**not** touch `saveProfile`/`setActiveProfile`/`saveSectionState` (:199-248) — they call
`loadSettings` directly, never `loadData`, so they never see derived keys.
*Verify:* saving a profile adds no `colors`/`groupings` block to config.json.

**4 — generic write path + scan in `organize.js`.** Delete `assignTemplate`/`assignArea`/
`assignPriority` (:380-441). `getOrganizeCandidates` returns `assigned: {[label]: value}` and
`suggested: {[label]: v}` instead of fixed booleans — generalizing the `ancestorArea` walk (:97-105)
to one nearest-ancestor lookup per label in the same pass makes "suggested" work for any new
dimension. `isSubtask`'s `parentIsActionable` (:138-143) tests the parent's `#type` against
actionable keys instead of template note ids. `getMisfiledNotes` (:195-364): **do not genericize to
N** — the tree has exactly one root axis and one bucket axis by construction; re-parameterize to the
two designated dimensions, keep the logic, drop the `slugByTemplateId` round-trip (R5).

**5 — `task/DimensionPicker.jsx`.** Takes `{dimension, note, onAfterChange}`, uses
`useNoteLabel(note, dimension.label)`, writes via `assignDimension`. Keep area-picker's invalid-value
option (`⚠ Invalid: <value>`, `areaPickerPreact.jsx:40-46`) — it matters more now the vocabulary is
user-editable. In `agendaTask.jsx` `MainWidget` (:351-434), load dimensions in the existing effect
(free — it already calls `getAgendaSettings`) and render a "Classification" section above Actions
mapping `dimensions.filter(d => d.picker)`.

**Gating:** keep the `#agendaTaskWidget` gate for *mounting* (:366); it is now unrelated to the
`actionable` config flag. Two concepts, two mechanisms — say so in the README, since they were one
thing before.

**6 — generic QueueSection.** Replace the three near-identical blocks
(`organize/organizePage.jsx:326-386`) with one `map` over `dimensions.filter(d => d.triage)`.
`reload` (:264-289) collapses to `getDimensions()` + candidates/misfiled/times; the
`priority === undefined` guard goes. `getItemTemplates` (:42-51) becomes dead — its only job was
resolving template titles for buttons that now read `value.name`; delete it (an orphan this change
creates, so in scope per CLAUDE.md §3).
*Verify:* adding a fourth dimension in settings makes a fourth queue appear with no code change —
the acceptance test for open-endedness.

**7 — one settings panel.** Delete `organize/organizeAreas.jsx`, `organize/organizeTemplates.jsx`,
`organize/organizePriority.js`. `OrganizePanel` (:481-525) drops to two tabs; Dimensions is
`<SettingsForm ... only="Dimensions" />` using the `ids` already resolved at :485-490, plus the
"Match templates by name" button. No `onSaved` — `applyTemplateLabels` existed only to push `#type`
onto template notes for sorting, which now comes from registry position. Keep AreasPanel's "changing
a Key orphans notes" warning (:84-89); it is now true for every dimension.

**8 — structure + provisioning.** `buildStructure(rootDim, bucketDim)` in
`organize/organizeStructure.js`; `bucketIcon` replaced by the value's own `icon` (BUCKET_ICONS
content moves into shipped defaults); `areaValue`/`typeValue` become a `labels` loop in
`provisionNode` (`organizeProvision.js:481-482`). **Keep all four migrate\* functions**
re-parameterized — `migrateAreaSlugs`/`migrateTypeSlugs` still repair legacy `<NN>-` values in the
wild; `mergeStaleBuckets`/`migrateStructuralLabels` are unaffected in substance. Call
`matchTemplatesByName()` at the end of provisioning. **No new migration is added**; defaults
reproduce today's labels and keys.
*Verify:* Workflow Setup on an existing tree logs all `adopted`, zero `created`.

**9 — manifest.** In `_tam_manifest_.json`: remove `organize-areas`/`organize-templates`/
`organize-priority` notes, children and attributes; add `dimensions` and `dimension-picker`. **Fix
`#type=3-task` and siblings to bare slugs** (:251-305) — a genuine pre-existing bug (a fresh install
writes stale values that `migrateTypeSlugs` then immediately strips); keep `migrateTypeSlugs` anyway
since it repairs *user* notes. Keep `#label:priority`/`#label:area` (Trilium promoted-attribute
declarations, still correct) and `#agendaTaskWidget` (step 5 gate). Remove the three picker addons
from `dependencies` (:296-300). Bump 1.14.0 → **2.0.0**. Rewrite `description` (:4) — its last three
sentences become false.

**10 — strip agenda references from the picker addons.** Verified this is prose only:
`area-picker@beatlink/README.md:16-18` and `priority-widget@beatlink/README.md:30` cite
`#agendaConfig`/agenda as the discovery-pattern example. Reword to describe the pattern without
naming agenda. `template-picker@beatlink` has no references. No code changes, no version bumps
needed beyond a docs patch bump.

**11 — docs.** agenda `README.md` + `organize/README.md`, then `generate_readme` && `generate_pages`.

## Verification

`validate` (inside `nix-shell`) is the repo's only automated check and lints manifests only —
everything below is manual, in Trilium:

1. `validate` after every step touching a manifest or schema.
2. **No-rewrite check:** run Workflow Setup on an existing tree; log shows all `adopted`, zero
   `created`. Spot-check that a note's `#area`/`#type`/`#priority` values are byte-identical to
   before.
3. **Open-endedness (the acceptance test):** add a 4th dimension `energy` with 3 values in the
   Dimensions tab. Without touching code, confirm: a picker appears in the task pane, a triage queue
   appears in Organize, `#energy` is sortable, and a color/prefix/grouping/filter variant exists in
   the profile editor.
4. **Derivation is read-only:** save a profile, then diff config.json — no `colors`/`groupings`/
   `prefixes` block should appear.
5. **Filters (R4):** delete a derived filter child in the UI, reload Trilium, confirm behavior is
   sane. If not, fall back to manual `filterGroups`.
6. **Priority sort (R1):** confirm the shipped Priority sort still shows critical first.
7. **`~template` (R2):** on a fresh install, assign a type from the triage queue and confirm
   `~template` is set (i.e. `matchTemplatesByName` ran during provisioning).

Sequence so the tree is never half-migrated across a Trilium reload: steps 1-4 are one consistent
unit, 5-7 another. Don't reload mid-unit.

## Risks

**R1 (certain behavior change): priority sort inverts.** Today `#priority` sorts as a string where
`4-critical` > `1-low`, so `desc: true` means critical-first. With a registry ordinal map, position 0
is critical, so `desc: true` becomes critical-*last*. Shipped sorts flip to `desc: false`. A
**user-authored** sort in an existing config.json with `desc: true` will silently invert and cannot
be auto-fixed — indistinguishable from a deliberate choice. Unavoidable under "order comes from
position". Put it in the release notes.

**R2 (mitigated): `templateNoteId` cannot ship as a default.** Note ids are install-specific.
Resolved via the "Match templates by name" button, also called during provisioning so a fresh
install self-heals without user action.

**R3 (accepted): duplicate pickers.** A user with area-picker still installed gets two area
dropdowns writing `#area` from two configs that can now genuinely drift. The `picker` boolean exists
for exactly this; README says uninstall the old pickers or disable agenda's picker per dimension.

**R4 (uncertain — prototype before committing): the filterGroups hybrid.** If a user deletes a
derived filter child through the UI, `filterRegistryBySchema` records it in `removedIds` against a
shipped baseline that no longer contains it, and next-load behavior isn't deducible from the code.
Test this one interaction in Trilium during step 3. Fallback: keep `filterGroups` fully manual and
accept that a new dimension doesn't auto-generate filters.

**R5: `getMisfiledNotes` stays two-dimensional by design.** If a user flags three scaffolding
dimensions, behavior is undefined — guard by taking the first `scaffoldsAreas`/`scaffoldsBuckets`
and ignoring the rest, rather than pretending to support N.

**R6: no automated test covers any of this.** Every behavioral check is manual.