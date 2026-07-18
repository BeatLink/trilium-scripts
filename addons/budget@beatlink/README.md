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

The Budget template is a `render` note carrying an inheritable `~renderNote` relation, so every note
templated from it renders `budgetWidget.jsx` as its entire body instead of a text editor. Applying
the template is the only wiring needed — there's no marker label to add.

## Using the table

| Control | Action |
|---|---|
| Title / Amount / Notes cells | Edit in place; every change saves to the note immediately |
| Chevron | Collapse or expand a row's children |
| Indent arrow | Add a child row under this row |
| Up / down arrows | Reorder a row among its siblings |
| Trash | Delete the row and everything under it |

A row's **Total** column always shows its effective total; the table footer shows the grand total of
all top-level rows.

## Rollup modes

Open the addon's root note (`budget@beatlink`) for the settings screen, where **Parent Totals**
selects how a parent row relates to its children:

| Mode | Behaviour |
|---|---|
| **Computed** (default) | A parent's amount *is* the sum of its children. Its own amount cell is read-only and shows the derived total. |
| **Own + children** | A parent carries its own amount, and its total is that amount plus its children's sum. The Total column notes how much of it is the row's own. |
| **Budget cap** | A parent's amount is an allocation you type in. Its children's sum is shown beneath the total as "used", and the row turns red when children exceed the allocation. |

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

Only what you typed is stored — totals are always derived at render time from the current rollup
mode, so switching modes re-interprets an existing budget rather than rewriting it. Content that
isn't valid budget JSON is treated as an empty budget rather than erroring, so a brand-new note (or
one converted from a text note, whose content arrives HTML-wrapped) starts as an empty table instead
of breaking — but any prior content is replaced on the first edit.

## Limitations

- The table renders for the note being viewed; it does not aggregate across separate notes. A budget
  is one note.
- Edits save on every keystroke with no debounce, so a long typing burst produces a run of note
  revisions.
- Rows can be reordered within their sibling list but not dragged to a different parent — to move a
  line under a different parent, delete it and re-add it there.
