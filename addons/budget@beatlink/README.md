# Budget

A nested budget table for TriliumNext. Apply the **Budget** template to any note and the note body
becomes an editable table of budget lines — **Title**, **Amount Budgeted**, and **Notes** — where any
row can hold child rows whose amounts roll up into it.

Replaces the former `table-calculator@beatlink`, which spread a budget across a note tree and wrote
totals back into labels. Here the whole budget lives in the note's own content as JSON, so a budget
is a single note you can edit, revision, and export as one unit.

## Setup

1. Install the addon (it pulls in [`libsettings@beatlink`](../libsettings@beatlink/)) and enable it.
2. Create a note and set its template to **Budget** (the addon ships a `#template` note by that
   name).
3. Open the note. The table renders as the note body, with an **Add Row** button below it.

Applying the template is the only wiring needed — there's no marker label to add and no script to
provision anything.

### How the render relation gets wired

The Budget template is a `render` note carrying `~renderNote` → `budgetWidget.jsx`. Trilium inherits
a template's attributes by its instances *unconditionally* — the `isInheritable` flag only gates the
parent/subtree cascade, not the template path (`BNote.__getAttributes` in
[`bnote.ts`](https://github.com/TriliumNext/Trilium/blob/main/packages/trilium-core/src/becca/entities/bnote.ts),
which excludes only the `#template` marker label itself). So every note using the template picks up
both the `render` type and the render relation, and shows the table as its whole body.

## Using the table

| Control | Action |
|---|---|
| Title / Amount / Notes cells | Edit in place; every change saves to the note immediately |
| Chevron | Collapse or expand a row's children |
| Expand All / Collapse All | Expand or collapse every row with children at once |
| Indent arrow | Add a child row under this row |
| Up / down arrows | Reorder a row among its siblings |
| Trash | Delete the row and everything under it |
| Import / Export JSON | Load or download the whole budget as a JSON file (see below) |

A row's **Total** column always shows its effective total; the table footer shows the grand total of
all top-level rows.

Which rows are collapsed is view state, not part of the document — it isn't written to the note, so
it resets when you navigate away and is never shared between viewers. **Expand All** and **Collapse
All** are disabled when they would do nothing (nothing is collapsed, or everything already is).

## Import and export

Below the table, **Export JSON** downloads the budget as a `.json` file named after the note, and
**Import JSON** loads one back in.

Import **replaces the entire budget**, so a non-empty note asks for confirmation first. Row ids are
regenerated on import, so the same file can be imported into several notes, or twice into one,
without id collisions. A file that isn't valid budget JSON reports an error and leaves the note
untouched.

The import format is the [storage format](#storage-format) below; a bare array of rows is also
accepted, and missing fields fall back to their defaults (`amount` `0`, empty `title`/`notes`/
`children`). Since amounts are plain numbers, exporting is also the simplest way to hand a budget to
a spreadsheet or script.

## Rollup modes

Open the addon's root note (`budget@beatlink`) for the settings screen, where **Parent Totals**
selects how a parent row relates to its children:

| Mode | Behaviour |
|---|---|
| **Computed** (default) | A parent's amount *is* the sum of its children. Its own amount cell is read-only and shows the derived total. |
| **Own + children** | A parent carries its own amount, and its total is that amount plus its children's sum. The Total column notes how much of it is the row's own. |
| **Budget cap** | A parent's amount is an allocation you type in. Its children's sum is shown beneath the total as "used", and the row turns red when children exceed the allocation. |

## Columns

The **Columns** tab on the settings screen controls which columns the table shows and the order they
appear in. Tick a column to show it, and use the arrows to move it earlier or later.

**Title** is always the first column and the row actions always the last, so neither is listed —
Title carries the collapse chevron and the indentation that makes nesting readable, so hiding or
moving it would leave the table unnavigable. **Amount Budgeted**, **Total**, and **Notes** can each
be hidden or reordered freely, including hiding all three.

With the **Total** column hidden the grand total still renders in the footer's last cell rather than
being dropped. A column added by a future version appears automatically in an existing config, and a
stored column that no longer exists is ignored, so a config never has to be reset across an upgrade.

**Currency** (ISO 4217, e.g. `USD`, `JMD`) and **Locale** (e.g. `en-US`; blank uses the system
default) control amount formatting. Settings are stored in a persisted note via TAM's
[Persistence](../trilium-addon-manager@beatlink/README.md#persistence) mechanism, so they survive
addon updates.

## Storage format

A budget note's content is a JSON document:

```json
{
    "rows": [
        {
            "id": "a1b2c3d4",
            "title": "Housing",
            "amount": 0,
            "notes": "",
            "children": [
                {"id": "e5f6g7h8", "title": "Rent", "amount": 1200, "notes": "due the 1st", "children": []}
            ]
        }
    ]
}
```

Because a budget note is a `render` note, no text editor ever touches its content — the document is
stored as raw JSON rather than arriving wrapped in editor markup.

Only what you typed is stored — totals are always derived at render time from the current rollup
mode, so switching modes re-interprets an existing budget rather than rewriting it. Content that
isn't valid budget JSON is treated as an empty budget rather than erroring, so a brand-new note
starts as an empty table instead of breaking — but any prior content is replaced on the first edit.

## Limitations

- The table renders for the note being viewed; it does not aggregate across separate notes. A budget
  is one note.
- Edits save on every keystroke with no debounce, so a long typing burst produces a run of note
  revisions.
- Rows can be reordered within their sibling list but not dragged to a different parent — to move a
  line under a different parent, delete it and re-add it there.
