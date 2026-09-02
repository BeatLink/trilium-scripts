# libpickersources

Shared reader for the three "picker" addons that own a classification vocabulary, so an addon can
render by one instead of keeping a copy of it:

| Source | Reads | Tags a note with |
| ------ | ----- | ---------------- |
| `area` | `area-picker@beatlink`'s `#areaConfig` | `#area`, the key behind its 1-based position, zero-padded (`01-career`) |
| `priority` | `priority-widget@beatlink`'s `#priorityConfig` | the active profile's own label, usually `#priority`, by bare key (`4-critical`) |
| `template` | `template-picker@beatlink`'s `#templatePickerConfig` | a `~template` relation, keyed by the template note's id |

Read-only in every direction: a picker owns its vocabulary and knows nothing about who renders by it.

## Why it is shared

Both `agenda-overview@beatlink` (display elements, searches, filters, sorts) and
`agenda-organize@beatlink` (triage queues) generate their entries from these. One table means a
picker that changes shape is fixed in one place, and that the two addons agree with each other by
construction rather than by discipline.

## API

### `PICKER_SOURCES`

The table itself, keyed by source id. Each entry carries a `title`, the `anchorLabel` its settings
note is tagged with, a `defaultAttribute` for when the addon is absent, a `read(settings)`, and — for
`template` — a `nestingExclusion()` used to build search rules.

### `getPickerVocabulary(sourceId)`

`{ kind, name, values }` for one picker, or `null` when it isn't installed or has nothing resolvable.
`kind` is `"label"` or `"relation"`; `name` is the attribute it tags with; each value is
`{ labelValue, title, color }`, in the order that picker lists them.

`null` is the load-bearing case: it is what makes every entry generated from that picker disappear
along with the addon, rather than erroring or rendering empty.

### `getPickerVocabularies(sourceIds)`

The same for several at once, as `{ [sourceId]: vocabulary }`, omitting any that didn't resolve.

## Adding a source

Add an entry to `PICKER_SOURCES` with its anchor label and a `read()` mirroring the format that addon
writes. `read()` is the one place that has to keep up if the picker changes shape — mirroring the data
rather than importing the picker's own registry module keeps consumers free of its write paths.
