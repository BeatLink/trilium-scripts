# Budget

A nested budget table for TriliumNext. Apply the **Budget** template to any note and the note body
becomes an editable table of budget lines — **Title**, **Income**, **Expense**, and **Notes** — where
any row can hold child rows whose amounts roll up into it. A second tab records what actually moved
each month, and a third measures that month against the plan.

Bookkeeping is single-entry: every record, planned or actual, carries an income amount and an expense
amount, and its **Balance** is income minus expense. Nothing declares a record to be one kind or the
other — a row with only an expense is a bill, one with only income is a paycheck, and one with both
nets out.

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

## Tabs

The note body has three tabs: **Budget** (the planned lines), **Transactions** (what actually moved),
and **Report** (the month measured against the plan). Transactions and Report always show the same
month, so switching between them keeps your place. Which tab and month you're on is view state — it
isn't stored in the note and resets when you navigate away.

## Using the table

| Control | Action |
|---|---|
| Title / Income / Expense / Notes cells | Edit in place; every change saves to the note immediately |
| Chevron | Collapse or expand a row's children |
| Expand All / Collapse All | Expand or collapse every row with children at once |
| Indent arrow | Add a child row under this row |
| Up / down arrows | Reorder a row among its siblings |
| Trash | Delete the row and everything under it |
| Import / Export JSON | Load or download the whole budget as a JSON file (see below) |

A row's **Balance** column always shows its effective income minus its effective expense; the table
footer totals all three columns across every top-level row.

Which rows are collapsed is view state, not part of the document — it isn't written to the note, so
it resets when you navigate away and is never shared between viewers. **Expand All** and **Collapse
All** are disabled when they would do nothing (nothing is collapsed, or everything already is).

## Monthly transactions

The **Transactions** tab is a ledger for one month at a time. Step through months with the arrows,
jump to any month with the month picker, or return to the current one with **This month**.

Each record has a **Date**, a **Description**, an **Income** amount, an **Expense** amount, a derived
**Balance**, and a **Budget Row**. A record can carry both amounts — a refund net of a restocking
fee is one line, not two.

The **Budget Row** picker lists every budget row by its full path (`Housing / Rent`), so two rows
sharing a title stay distinguishable. Choosing one charges the record against that row's allocation;
leaving it at `-- unbudgeted --` means the money has no allocation to be measured against, which is
the natural state for an unplanned purchase.

**Add Transaction** files the new line into the month you're viewing — today's date if that's the
current month, otherwise the 1st, so a record never disappears into a month you aren't looking at.
For the same reason the date field won't accept being cleared; clearing it reverts to the previous
date.

Deleting a budget row does **not** delete the records charged to it. They simply become unbudgeted,
so the money stays in the month's totals instead of vanishing from them, and picking a new row
charges them again.

## Report

### What on budget and off budget mean

**On and off budget measure how closely the month followed the plan** — not whether a record was
filed under a category:

| Counts as | Made up of |
|---|---|
| **Off budget** | Spending past a category's allocation, **plus** income that fell short of what the category expected, **plus** spending charged to no category at all (nothing to be within, so all of it is off) |
| **On budget** | Spending that stayed inside its allocation, **plus** income received up to what was expected |

Both are measured at the **top-level rows** — the categories that carry an allocation. They cover
every charged record exactly once whatever depth it was charged at; measuring at every level would
count a parent's allocation and its children's twice over. So a category whose children collectively
overshoot is over by the shortfall of the whole category, not row by row.

The two figures deliberately do **not** sum to the month's cash flow. A shortfall is money that never
arrived rather than money that moved, and income above expectation is a happy deviation that belongs
in neither figure. **Income**, **Spent** and **Balance** are the actual cash.

### The sections

- **The summary** — on budget and off budget with each one's share, then the month's actual income,
  spending, and balance. A proportional bar shows the on/off ratio.
- **What went off budget** — every component of the off-budget figure itemised: each category's
  overspend and income shortfall, and unbudgeted spending as its own line. The column adds up to the
  off-budget figure exactly, so it can be audited rather than just read.
- **Expenses / Income: budgeted vs actual** — every budget row with a figure in that column, its
  budgeted amount, what actually moved against it, and the variance. A row's actual includes its
  descendants', so a parent's figure is comparable to the budgeted total its rollup mode gives it.
  Variance is signed so negative always reads as off plan — overspent for expenses, short for income
  — and those rows are flagged red.
- **Income this month** — the month's income records itemised.
- **Last 6 months** — on budget, off budget, income, spending and balance for the six months ending
  with the one you're viewing, each bar scaled against the busiest month so the series is comparable.
  Click any month to jump to it.

Budgeted amounts come from the current rollup mode, so switching modes re-interprets the report the
same way it re-interprets the table. The budget itself is not per-month — one set of budget lines is
compared against whichever month you're viewing.

## Import and export

Below the table, **Export JSON** downloads the budget as a `.json` file named after the note, and
**Import JSON** loads one back in. Both cover the whole document: budget rows *and* transactions.

Import **replaces the entire budget**, so a note with any rows or transactions asks for confirmation
first. Row ids are regenerated on import, so the same file can be imported into several notes, or
twice into one, without id collisions; each transaction's row reference is remapped through the same
table, so imported spending still points at the row it was recorded against. A file that isn't valid
budget JSON reports an error and leaves the note untouched.

The import format is the [storage format](#storage-format) below; a bare array of rows is also
accepted (with no transactions), and missing fields fall back to their defaults (`income`/`expense`
`0`, empty `title`/`notes`/`children`, `rowId` `null`). Since amounts are plain numbers and dates
plain ISO strings, exporting is also the simplest way to hand a budget to a spreadsheet or script.

## Rollup modes

Open the addon's root note (`budget@beatlink`) for the settings screen, where **Parent Totals**
selects how a parent row relates to its children:

| Mode | Behaviour |
|---|---|
| **Computed** (default) | A parent's amounts *are* the sum of its children's. Its own cells are read-only and show the derived totals. |
| **Own + children** | A parent carries its own amounts, and its totals are those plus its children's sums. Each cell notes how much of it is the row's own. |
| **Budget cap** | A parent's amounts are allocations you type in. Its children's sums are shown beneath as "used", and the row turns red when children's expenses exceed the allocation. |

The mode applies to each of the two columns independently.

## Columns

The **Columns** tab on the settings screen controls which columns the table shows and the order they
appear in. Tick a column to show it, and use the arrows to move it earlier or later.

**Title** is always the first column and the row actions always the last, so neither is listed —
Title carries the collapse chevron and the indentation that makes nesting readable, so hiding or
moving it would leave the table unnavigable. **Income**, **Expense**, **Balance**, and **Notes** can
each be hidden or reordered freely, including hiding all four.

Each footer figure sits under its own column, so hiding a column hides its total with it. A column
added by a future version appears automatically in an existing config, and a stored column that no
longer exists is ignored, so a config never has to be reset across an upgrade — the pre-2.0 `amount`
and `total` columns are dropped this way, and the new ones appear in their place.

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
            "income": 0,
            "expense": 0,
            "notes": "",
            "children": [
                {"id": "e5f6g7h8", "title": "Rent", "income": 0, "expense": 1200, "notes": "due the 1st", "children": []}
            ]
        }
    ],
    "transactions": [
        {"id": "i9j0k1l2", "date": "2026-08-01", "description": "August rent", "income": 0, "expense": 1200, "rowId": "e5f6g7h8"},
        {"id": "m3n4o5p6", "date": "2026-08-03", "description": "Concert ticket", "income": 0, "expense": 85, "rowId": null}
    ]
}
```

`rows` is what was planned, `transactions` what actually moved. Every record carries both amounts;
balance is always derived, never stored. A transaction's `rowId` names the budget row it is charged
to; `null`, or an id whose row has since been deleted, means unbudgeted. Months are taken as the
`YYYY-MM` prefix of `date` rather than by parsing it as a timestamp, so the 1st of a month never
lands in the previous one in a western timezone.

Documents from earlier versions still read: a pre-2.0 record's single `amount` field is taken as its
expense (that field only ever held spending), and a pre-1.5 document with no `transactions` key reads
as a budget with nothing recorded yet. Neither is rewritten until you next edit the note.

Because a budget note is a `render` note, no text editor ever touches its content — the document is
stored as raw JSON rather than arriving wrapped in editor markup.

Only what you typed is stored — totals are always derived at render time from the current rollup
mode, so switching modes re-interprets an existing budget rather than rewriting it. Content that
isn't valid budget JSON is treated as an empty budget rather than erroring, so a brand-new note
starts as an empty table instead of breaking — but any prior content is replaced on the first edit.

## Limitations

- The table renders for the note being viewed; it does not aggregate across separate notes. A budget
  is one note.
- Budget lines are not per-month: one set of rows is compared against every month. A budget that
  changes mid-year has to be edited, which re-reports past months against the new figures.
- The trend is fixed at six months, and there is no all-time or year-to-date view.
- A month with no records still measures against the plan, so browsing to an empty or future month
  reports every category's expected income as a shortfall.
- Transactions are entered by hand — there is no import from a bank statement or CSV, though a
  script can write the `transactions` array directly and the JSON import will load it.
- Edits save on every keystroke with no debounce, so a long typing burst produces a run of note
  revisions.
- Rows can be reordered within their sibling list but not dragged to a different parent — to move a
  line under a different parent, delete it and re-add it there.
