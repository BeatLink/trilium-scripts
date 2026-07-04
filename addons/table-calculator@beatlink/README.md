# Table Calculator

Recursively sums a numeric label across a note's children, rolling child totals up into parent
notes. Useful for budget/table-style note trees where leaf notes carry a value and you want each
ancestor to show the sum of its descendants. Supports any number of independent table profiles.

## Setup

After installing, open the addon's root note (`table-calculator@beatlink`) in Trilium — it renders a
Settings screen where you can add one profile per table you want totaled:

| Field         | Value                       | Description                                              |
|---------------|------------------------------|-------------------------------------------------------------|
| `tableNoteId` | pick a note                  | Root note of the tree to total (uses a note picker)          |
| `attribute`   | e.g. `AmountBudgeted`         | Label name holding each leaf note's value                    |
| `currency`    | e.g. `USD`, `JMD`             | ISO 4217 currency code used to format every note's value      |

Settings (including the profile list) are saved to a persisted note (see TAM's
[Persistence](../trilium-addon-manager@beatlink/README.md#persistence) mechanism) — your edits
survive addon updates. The screen, the repeatable profile list, and the underlying schema-driven
storage are provided by [libsettings@beatlink](../libsettings@beatlink/)'s `list` field type.

## Recalculating

Two ways to trigger a recalculation:

- **Recalculate All** — a button on the settings screen that recomputes every configured profile.
- **Per-note widget** — when you're viewing a note that matches a profile's `tableNoteId`, a "Table
  Calculator" panel appears in the right pane with its own **Recalculate** button, scoped to just
  that one profile.

## How it works

For each profile, starting from `tableNoteId`, the tree is walked depth-first: leaf notes have their
`attribute` label parsed as a number; notes with children get the sum of their children's values
written back to the same label. Every note in the tree — leaf or branch — ends up with its
value/total formatted as currency using `profile.currency`.

## Known limitations / behavior changes from the original single-profile script

- Currency formatting now uses the runtime's default locale (previously hardcoded to `en-JM`) —
  only the currency *code* is configurable per profile, not the locale used to format it.
- The compute walk is intentionally duplicated across `TableCalculator.js`, `settings.jsx`, and
  `table-widget.jsx` rather than shared, since `api.runOnBackend` closures can't reference outer
  imports — only `api` and their own passed arguments.
