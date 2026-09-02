# Agenda Organize

The opinionated GTD Organize workflow, split out of the original agenda addon into its own addon: the
**Organize** render page and the **Organize Editor** settings page. It bakes a specific triage flow
on top of agenda's generic engine, driven entirely by the picker addons you have installed:
[`area-picker@beatlink`](../area-picker@beatlink/README.md),
[`priority-widget@beatlink`](../priority-widget@beatlink/README.md) and
[`template-picker@beatlink`](../template-picker@beatlink/README.md). It reuses agenda's mechanism
(config, filters, colors, kanban, task widget) — it does not fork it.

## Configuration and cross-addon reads

This addon's own settings note (`organizeSchema.json` / `organizeConfig.json`, tagged
**`#agendaOrganizeConfig`**) holds two things: the **Organize Note** picker and the four quick-times.
Both are edited from the **Organize Editor** page.

**No classification vocabulary is stored here.** Each triage queue is generated from the picker addon
that owns its axis, read live from that addon's own settings note:

| Queue | Comes from | Writes |
| ----- | ---------- | ------ |
| Area | [`area-picker@beatlink`](../area-picker@beatlink/README.md)'s `#areaConfig` | `#area`, the key behind its position (`01-career`), plus `#color` |
| Priority | [`priority-widget@beatlink`](../priority-widget@beatlink/README.md)'s `#priorityConfig` | the active profile's label, usually `#priority`, plus `#color` |
| Type | [`template-picker@beatlink`](../template-picker@beatlink/README.md)'s `#templatePickerConfig` | a note's `~template` relation, assigned by that addon's own widget |

Its own settings note also holds **Exclude Filters**, the same registry the picker addons carry: any
note matching an enabled filter's search query is dropped from every triage queue, so work you have
deliberately parked stops being offered. Excluded notes are still *descended into* — excluding a
container should not hide what is inside it — and the misfiled-notes queue and Invalid Roots table
still report them, since those are about the notebook being wrong rather than about work you have
chosen not to triage.

Install a picker and its queue appears; uninstall it and the queue goes with it. Rename, recolour or
reorder a value there and the queues follow immediately — there is no copy here to fall out of step,
and a value assigned from a queue is byte-identical to one assigned from the picker's own widget.
[`agenda-overview@beatlink`](../agenda-overview@beatlink/README.md) generates its display elements
from the same three addons, so the two agree by construction rather than by discipline.

## 1. Purpose / workflow

An opinionated system that guides a **Collect → Organize → Review → Execute** workflow.

- **Collect** — process your inboxes (email, bookmarks, files, notes, photos, browser tabs, …) into
  the Inbox note. Capture the raw item here; attributes are set later, in Organize.
- **Organize** — set each item's dimension values (**`#area`**, **`#priority`**, or any you add), its
  **`~template`** (item type, via template-picker's own widget or the Missing Templates page), and
  **start date**, and fix misfiled notes. This is the fully-built page (`organizePage.jsx`).
- **Review** — Daily: Must Do + overdue, date-sorted. Weekly: sweep by Area to catch drift. These map
  onto agenda's Task View page modes + sorts; no separate code.
- **Execute** — work the daily list. Uses the same agenda views.

## 2. Where the vocabulary comes from

[`dimensions.js`](dimensions.js) → `getDimensions()` returns one axis per installed picker, read
through [`libpickersources`](../../libs/libpickersources/README.md) — the same shared table
`agenda-overview@beatlink` renders from. An axis is one note label plus its ordered vocabulary of
values `[{ key, name, color }]`, where `key` is exactly what that picker tags a note with.

Two behaviours are Organize's own rather than anything a picker declares, so they are fixed per axis
in `QUEUE_BEHAVIOUR`:

| Behaviour | Applies to | Effect |
|-----------|-----------|--------|
| `scaffoldsAreas` | area | The axis whose values are the notebook's root notes, so a root is judged against this vocabulary. |
| `actionableOnly` | priority | Restricts that queue to notes whose `~template` is marked **Actionable** in template-picker (and non-subtasks) — priority is about scheduling work, not filing it. |

Both pickers mirror the chosen value's colour onto `#color` when they assign, so
`assignDimension(noteId, dim, value)` — the single write path from the queues — does the same. It
writes `#<label>=<key>` and the matching `#color`.

**Area values carry a positional prefix.** area-picker tags `01-career`, while a root note's
`#agendaOrganizeArea` identity is usually the bare key you labelled it with, often written before that
prefix existed. Every comparison in [`organize.js`](organize.js) — misfiled detection and the Invalid
Roots check — strips a leading `NN-` from both sides before comparing, so the two spellings match and
a root is never offered for deletion over a spelling difference. Only the value *written* is
canonical: adopting a root's value writes what the picker writes today.

Item **type** stays separate from the two label axes because a note's type is a `~template` relation,
assigned by template-picker's own widget (or its Missing Templates page), never a `#type` label.
Organize reads that registry read-only, via `getBucketTemplates()` in [`organize.js`](organize.js), to
tell a Type root's identity from a current template and for the actionable-item set. There is no
"Notes Without Type" queue here.

`#agendaTaskWidget` is a separate, orthogonal label: it gates whether the Task editor shows at all,
and is set as an inheritable label on the template note.

## 3. The Organize page (`organizePage.jsx`)

One tab: **Triage**, the one-at-a-time queues. There is no Dimensions tab any more — every axis is
edited on the settings note of the picker that owns it. There, renaming or reordering a value is
safe; changing its **Key** orphans every note carrying the old one.

The Triage tab loads the dimension list plus template-picker's enabled registry
(`getBucketTemplates()`) up front, then `organize.js` does a single backend walk of the Inbox / Area
/ Type subtrees — de-duped by noteId, since a filed item is reachable from two roots — excluding the
structural (identity-labelled) notes, tagging each candidate with its
per-dimension `assigned` map (`{ [label]: value }`), a `suggested` map (nearest ancestor's value per
dimension), its `~template` noteId (`templateId`), and `isSubtask` / `hasStartDate` / `path` /
`preview`. The page keeps that list in state and filters it per section; a mutation patches the list in
place so the acted-on note leaves its queue. Sections:

1. **One "Notes Without X" queue per triaged dimension**, in config order — buttons are the
   dimension's values (color-coded); the nearest-ancestor value is highlighted as the suggestion;
   clicking calls `assignDimension`. An `actionableOnly` dimension (priority by default) restricts to
   notes whose `~template` is marked Actionable in template-picker's registry, and non-subtasks. Add a
   dimension and another queue appears with no code change. There is no "Notes Without Type" queue here
   — that's template-picker's own **Missing Templates** page.
2. **Tasks Without a Start Date** — a two-step date + time picker; writes `#startDateTime`,
   `#startDate`, `#startTime` (agenda's default label names). Subtasks (parent is itself an actionable
   note) are excluded. The Morning / Noon / Evening / Night times come from agenda's config (Agenda
   Editor → **Organize › Times** tab), read via `getAgendaSettings()`.
3. **Misfiled Notes** — each note is checked **once per axis it's filed under**, and the axis of the
   root decides what's compared: under an Area root, its own `#area` must match that root; under a
   Type root, its own `~template` must match that root. Fixes are Move / Set-area / Set-type
   (Set-area calls `assignDimension` on the root dimension; Set-type calls `assignTemplate` directly,
   since there's no dimension to route it through any more). A Move re-parents only the offending
   branch, leaving the note's clone on the *other* axis alone. A note with no value on the axis being
   checked is unclassified, not misfiled — that's the per-dimension queues' job (and, for a missing
   `~template`, the Missing Templates page's). A note filed under only one of the two axes is
   likewise *incompletely* filed rather than misfiled, so it isn't double-reported here.
4. **Invalid Roots** — structural roots whose identity no longer maps to a current vocabulary: an Area
   root (`#agendaOrganizeArea`) whose slug is no longer a current Area value, or a Type root
   (`#agendaOrganizeType`) whose noteId is no longer a currently-enabled template. Each root is judged
   on its **own axis only** — an Area root has no template and a Type root has no area, so neither is
   marked invalid over a value it was never meant to carry. Legacy nested buckets (carrying
   `#agendaOrganizeBucket`) surface here too, on their area half, since the flat structure never
   recreates them and merging one away is exactly the right cleanup.
   `getInvalidBuckets(rootDim, bucketTemplates)` returns them plus the list of *valid* roots as merge
   destinations. Unlike the one-at-a-time queues above, this is a **table** (all invalid roots at
   once — it's a cleanup list, not a triage flow): a row per root showing its title/path, why it's
   invalid, its note count, and a merge-target `<select>` + **Merge** / **Delete** actions. Merge
   (`mergeBucketInto`) moves the root's children into the selected valid root, migrates its body
   under a "Merged from" heading, then deletes the emptied husk on verified-empty; Delete
   cascade-deletes it (the confirm warns when the root still holds notes). Provisioning does no
   automatic folding of its own, so every orphan ends up here for an explicit decision.

## 4. Root contract

**Gone.** There is no provisioner: the scaffolder addon, the find-or-create walk, the identity-label
writes and the legacy `#workflowNote` / area-slug migrations were all removed along with the two
structural templates it shipped.

What matters on this side is only the **contract**, which you now satisfy by hand:

- `#agendaOrganizeArea=<areaSlug>` on an Area root
- `#agendaOrganizeType=<templateNoteId>` on a Type root
- `#agendaOrganizeSpecial=<name>` on the `inbox` / `my-day` / `agenda` singletons

They are mutually exclusive, so "which kind of root is this?" stays a single label read. `organize.js`
keys every queue off them, excludes structural notes from the candidate walk on the same basis, and
surfaces roots whose slug or template id is no longer current in the **Invalid Roots** table.

Nothing here ever creates, moves or deletes a root — the only structural writes this addon makes are
the Invalid Roots table's explicit Merge / Delete actions.

## 5. Wiring

Organize has **no shipped render page**. `organizePage.jsx` (`organize-page-src`, tagged
`#agendaOrganizeRender`) is a plain code note; the render surface is an **external user-chosen note**.
The **Organize Note** picker on the Organize Editor persists `organizeNoteId` in the
shared config and, on change, reconciles the chosen note on the backend: sets its `type` to `render`,
its `~renderNote` relation to the `#agendaOrganizeRender` code note, and its `#iconClass` to
`bx bx-sort-down` — reverting the previously-chosen note back to a text note. (See
`reconcileOrganizeNote` in [`organizeEditor.jsx`](organizeEditor.jsx).)

`organizePage.jsx` requires `organize.js`, `dimensions.js` and `organizeSettings.js`; `dimensions.js`
requires `pickerSources.js` from [`libpickersources`](../../libs/libpickersources/README.md).
`organize.js` requires
`templateRegistry.jsx` directly — this addon's manifest declares its own `registry` note (same
`sourceUrl` as template-picker@beatlink's `templateRegistry.jsx`, so TAM's sourceUrl dedup clones
it in rather than re-fetching if template-picker is already installed). This is a one-directional
read: the copy tracks template-picker's registry content, but template-picker knows nothing about
Organize.

The Organize Editor (`organizeEditor.jsx`) hosts three tabs — **Times** and **Exclude Filters**
straight from the schema, plus the **Organize Note** picker as an `extraPanels` entry. There is no Workflow
Setup tab: nothing on this side provisions structure.

Per TAM's direct-child require rule, `dimensions` is a child of every note that requires it
(`organize-page-src`), and libsettings' `ui` is wired under
every note that calls `loadSettings`/`SettingsForm`. Styling is `organize.css` (`appCss`).
