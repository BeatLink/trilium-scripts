# Organize rules inventory

Every rule `agenda-organize@beatlink` currently enforces, as built. This is a working document for
making the addon generic and uncoupled: it records the behaviour that must be preserved (or
deliberately dropped) and, at the end, exactly where the hardcoded couplings live.

Rule ids (`S1`, `Q2`, …) are for referring to them later; they carry no meaning in the code.

## 1. Scope — what counts as a triage candidate

[`organize.js` `getOrganizeCandidates`](organize.js)

| id | Rule |
|----|------|
| S1 | **Scope roots** are the Inbox singleton (`#agendaOrganizeSpecial=inbox`), every Area root (`#agendaOrganizeArea`, excluding legacy nested buckets which also carry `#agendaOrganizeBucket`), and every Type root (`#agendaOrganizeType`). Nothing outside those subtrees is ever a candidate. |
| S2 | The walk is **recursive over descendants** of each scope root, de-duped by noteId — a fully filed item is a clone reachable from two roots and must be collected once. |
| S3 | **Structural notes are never items.** Any note carrying one of the four identity labels is scaffolding and is skipped as a candidate (it is still descended into). |
| S4 | **Breadcrumb** = the titles of the primary-parent chain up to (excluding) root, joined with `›`. |
| S5 | **Suggested value**, per dimension label, is the nearest ancestor's value for that label (`""` if none) — a note under an Area root pre-highlights that area's button. |
| S6 | **Preview** is built only for `text` notes: HTML tags stripped, a few entities decoded, whitespace collapsed, truncated to 240 chars. Every other note type gets an empty preview. |
| S7 | **Subtask** = the note's primary parent's own `~template` is an *actionable* template. Subtasks are excluded from the scheduling-shaped queues, because they are scheduled with their parent. |
| S8 | One backend round-trip collects the whole candidate list; every queue is a frontend filter over it (backend closures are isolated and cannot share helpers). |

## 2. Queues — what surfaces where

[`organizePage.jsx`](organizePage.jsx)

| id | Queue | Membership rule |
|----|-------|-----------------|
| Q1 | **Notes Without `<Dimension>`** — one per dimension, in config order | the dimension has `triage` set and a non-empty vocabulary; lists candidates with **no value** for its label |
| Q2 | same, when the dimension has `actionableOnly` | additionally restricted to candidates whose `~template` is an actionable registry entry **and** that are not subtasks |
| Q3 | **Tasks Without a Start Date** | actionable-typed, no `#startDateTime`, not a subtask |
| Q4 | **Misfiled Notes** | §3 |
| Q5 | **Invalid Roots** | §4 — a *table* of all rows at once (a cleanup list), not a one-at-a-time queue |
| Q6 | Queues are one-at-a-time: acting on the head item patches the in-memory list so the note leaves its queue without a refetch. |
| Q7 | Every one-at-a-time queue also offers **Delete** (junk captured into the Inbox), subject to the W5 refusals. |
| Q8 | With no dimensions configured at all, the page renders an explanatory placeholder instead of queues. |

## 3. Misfiled rules

[`organize.js` `getMisfiledNotes`](organize.js)

| id | Rule |
|----|------|
| M1 | A note is judged **once per structural parent it sits under**, and the axis of that parent decides the comparison. |
| M2 | Under an **Area root**: the note's own area label must equal that root's area key. |
| M3 | Under a **Type root**: the note's own `~template` must equal that root's template noteId. |
| M4 | A note filed under **only one** of the two axes is *incompletely* filed, not misfiled — flagging it here would double-report everything the per-dimension queues already cover. |
| M5 | Only notes under a structural root are checked. Inbox notes are exempt: they are not filed yet. |
| M6 | Descendants are walked and inherit the root they hang under, so a subtask beneath a misfiled parent is only reported once the parent is fixed. |
| M7 | Offered fixes, per reported note: **move** to the correct root for that axis, **re-tag** its area label (mirroring the value's `#color`), or **set** its `~template` to the branch's template. |
| M8 | A move removes the note from the branch it was found under only, leaving its clone on the other axis alone. |

## 4. Invalid-root rules

[`organize.js` `getInvalidBuckets` / `mergeBucketInto`](organize.js)

| id | Rule |
|----|------|
| I1 | An **Area root** is invalid when its slug is no longer a current value of the area dimension. |
| I2 | A **Type root** is invalid when its template noteId is no longer a currently **enabled** template registry entry (disabled, removed, or the template note deleted). |
| I3 | Each root is judged on **its own axis only** — an Area root has no template and a Type root has no area, so neither is marked invalid over a value it was never meant to carry. |
| I4 | Legacy nested buckets (`#agendaOrganizeBucket` alongside an area label) are reported too, on their area half. |
| I5 | The result also returns every **valid** root, path-labelled, as the merge-destination list. |
| I6 | **Merge** moves the source root's children into the chosen target, migrates its body under a "Merged from" heading, then deletes the emptied husk **only** on verified-empty. |
| I7 | **Delete** cascade-deletes the root; the confirm names the number of notes still held. |
| I8 | Nothing folds roots automatically — every orphan waits here for an explicit decision. |

## 5. Writes — every mutation the addon makes

| id | Write | Rule |
|----|-------|------|
| W1 | `assignDimension` ([`dimensions.js`](dimensions.js)) | writes `#<label>=<key>`; when the dimension has `writeColor`, also mirrors the value's colour onto `#color` (removing both on clear) |
| W2 | `assignStartDate` | writes **three coordinated labels**: `#startDateTime` (`YYYY-MM-DDTHH:mm`, the master) plus derived `#startDate` and `#startTime`. Only writes when both date and time are present |
| W3 | `assignTemplate` | sets `~template` directly, or removes it when cleared — the misfiled queue's "set type" fix, since there is no type dimension to route through |
| W4 | `refileNote` | adds the branch at the target **then** removes it from the source, so the note's clone on the other axis survives; a no-op when source and target match |
| W5 | `deleteNote` | Trilium's cascade delete, with two refusals: never a **structural** note (merge it instead), and never a note with **descendants** unless `allowSubtree` is passed explicitly with the count acknowledged |
| W6 | Organize-note reconciliation ([`organizeEditor.jsx`](organizeEditor.jsx)) | on change, sets the chosen note to `type=render`, `~renderNote` → the Organize page, `#iconClass=bx bx-sort-down`, and reverts the previously chosen note back to a text note |
| W7 | — | The addon **never** creates, moves or deletes a root outside the explicit Merge / Delete actions in Q5. It reads the structural identity labels; it never writes them. |

## 6. Configuration surface

| id | Rule |
|----|------|
| C1 | Own settings note, tagged `#agendaOrganizeConfig`, holds two things: `organizeNoteId` and the four quick-times (`morning` 08:00, `noon` 12:00, `evening` 17:00, `night` 20:00). No vocabulary is stored here. |
| C2 | Every classification axis is generated from the picker addon that owns it — area-picker@beatlink, priority-widget@beatlink, template-picker@beatlink — read live through `libpickersources`. Install a picker and its queue appears; uninstall it and the queue goes. `agenda-overview@beatlink` generates its display elements from the same three, so the two agree by construction. |
| C3 | Item **type** stays separate from the two label axes: a note's type is a `~template` relation, assigned by template-picker's own widget, so there is no type queue here. |
| C4 | Every cross-addon read degrades gracefully: a picker that isn't installed means no queue for that axis, never a crash. |
| C5 | Area values carry a positional prefix (`01-career`) while a root's `#agendaOrganizeArea` identity usually does not. Every comparison strips a leading `NN-` from both sides; only the value written back is canonical. |

## 7. Where the coupling actually is

The list to attack when making this generic.

1. **Four fixed label names** — `agendaOrganizeArea`, `agendaOrganizeType`, `agendaOrganizeBucket`,
   `agendaOrganizeSpecial` (`LABELS` in [`organize.js`](organize.js)) — plus the magic special value
   `"inbox"`.
2. **A hardwired two-axis world model.** Exactly one "area" axis (the single dimension flagged
   `scaffoldsAreas`) and exactly one "type" axis (`~template`). M1-M3 and I1-I3 are written around
   that specific pair rather than around N axes.
3. **The type axis is not a dimension**, so it gets bespoke code paths everywhere the other
   dimensions get generic ones: its vocabulary is template-picker's registry
   (`noteId` / `enabled` / `actionable` / bucket icon), its value lives in a relation rather than a
   label, and its assignment bypasses `assignDimension`.
4. **Agenda's dimension flags** — `triage`, `actionableOnly`, `writeColor`, `scaffoldsAreas` — are
   read from a registry this addon does not own.
5. **Literal attribute names** baked into writes: `startDateTime` / `startDate` / `startTime`, the
   `template` relation, `color`, `iconClass`, and the `bx bx-sort-down` icon.
6. **Actionability as a first-class concept**: it gates Q2, Q3 and the S7 subtask test, and it comes
   from a foreign registry's per-row flag.

The single largest generalization available: collapse (2) and (3) into one **axis** concept —
*identity label on the root*, *how a note declares its value* (label or relation), *vocabulary
source* — and make `~template` one configured axis instead of a special case. Items (1), (4) and (5)
then reduce to configuration of that concept.
