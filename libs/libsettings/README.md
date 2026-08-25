# Settings Library

Stateless, schema-driven settings engine for TriliumNext addons — inspired by Cinnamon's
`settings-schema.json` model. An addon defines its own `schema.json` (what fields exist, their type,
label and description), ships their values in a `defaults.json`, and keeps its own persisted
`config.json` (a [persistent note](../../addons/trilium-addon-manager@beatlink/ARCHITECTURE.md#persistence));
this library merges that chain of **sources** into the runtime values, writes the user's changes back
to the last one, and can render a settings form from the same schema.

## Sources

A *source* is one JSON config document. A config note names the source below it with a
`sourceConfig` relation, so a chain resolves depth-first, **lowest priority first**, and the last
source wins on conflict. The last source is also the only writable one — everything below it is
read-only context.

```
defaults.json  (shipped by the addon, structural)
      ▲ sourceConfig
config.json    (the user's own, persistent, writable)
```

That is the normal two-source chain, and it is what the manifest's
[`settings`](#update-review--tam-owns-it) block declares. Point a `sourceConfig` at *another
addon's* config note and its values layer in underneath yours; give that note a `schemaNote`
relation and its fields join the merged schema too, which is how one settings form edits more than
one addon's settings. Nothing in the chain is passed per call site: `loadSettings(schemaNoteId,
configNoteId)` walks it itself, so a widget, a backend script and the form all see the same layering.

Only what a source *changes* about the ones below it is stored in it. A value the user never touched
is simply absent from `config.json`, so it keeps following `defaults.json` — including when a later
addon version changes it.

This library never resolves note references itself — it's handed noteIds by the consuming addon
(dependency injection). It doesn't know or care about relation names, note titles, or your addon's
tree shape; that's entirely up to you. This matters because the library note itself is cloned
byreference into every consumer — it's the same note everywhere, so it has no way to discover "which
addon is calling me" on its own.

## Schema format

A JSON object keyed by setting name, saved as your addon's own `schema.json` note (not this
library's — schema lives with the addon that defines it). It describes fields only; their shipped
values live beside it in `defaults.json`, keyed the same way:

```json
{
    "apiKey": {"type": "string", "label": "API Key", "description": "Shared secret for the panel applet"},
    "taskOrder": {"type": "select", "label": "Task Order", "options": [{"value": "earliest", "label": "Earliest"}, {"value": "latest", "label": "Latest"}]},
    "inboxNoteId": {"type": "note", "label": "Inbox Note", "description": "Note whose first line should be surfaced"}
}
```

```json
{
    "apiKey": "CHANGE_ME",
    "taskOrder": "earliest",
    "inboxNoteId": ""
}
```

| Field         | Required | Description                                              |
|---------------|----------|------------------------------------------------------------|
| `type`        | yes      | `string`, `number`, `boolean`, `date`, `time`, `datetime`, `select`, `note`, `color`, `list`, `registry`, or `reference` |
| `label`       | yes      | Field heading shown in the generated form                  |
| `description` | no       | Help text shown under the heading                           |
| `default`     | `itemSchema` fields only | Seeds this field on an item created at runtime, and fills it on an item that predates the field. Top-level fields have none — their value belongs in `defaults.json`, and a field no source holds falls back to its type's empty value (`""`, `0`, `false`, `[]`, `{}`) |
| `options`     | `select` only | Array of `{"value", "label"}` for the dropdown          |
| `itemSchema`  | `list`/`registry` only | A nested schema object (same shape as above) describing the fields of each entry |
| `registry`    | `reference` only | The sibling top-level schema key (must be a `registry` field) this field picks an entry from |
| `tab`         | no       | Explicit tab label this field is grouped under — see "Tabs" below |
| `category`    | no       | Optional second grouping level *above* the tab — the tab this field is on lands inside this category — see "Categories" below |
| `subgroup`    | no       | Optional label that clusters this field with its tab-mates sharing the same `subgroup` under a labelled fieldset *within* the tab — see "Sub-groups" below |
| `showWhen`    | no, `itemSchema` fields only | `{"otherField": value}` (or `{"otherField": [value, ...]}`) — only applies to an item whose sibling fields match; see "Polymorphic items" below |

Your addon's `config.json` ships empty and stays that way until the user changes something — it holds
only their divergences from `defaults.json`, never a copy of it.

### `list` fields — repeatable groups of settings

Use `type: "list"` when an addon needs a variable number of entries that each carry several fields
(e.g. one profile per table to total, one entry per webhook). Each stored value is an array of
objects; each object is validated/defaulted against `itemSchema`, recursively — this works the same
way at any depth `mergeDefaults`/`filterBySchema` are applied — in
[`libsettings-core.js`](libsettings-core.js) for the frontend and TAM, and in
[`libsettings-backend.js`](libsettings-backend.js) for backend scripts.

```json
{
    "profiles": {
        "type": "list",
        "label": "Profiles",
        "description": "One entry per thing you want to configure",
        "itemSchema": {
            "targetNoteId": {"type": "note", "label": "Target Note", "default": ""},
            "attribute": {"type": "string", "label": "Attribute", "default": "value"}
        }
    }
}
```

In the generated form, `SettingsForm` renders this as a stack of collapsible entries — each entry's
summary is its `name` field if `itemSchema` declares one, otherwise its first field's value, *and*
that same summary row carries its move-up/move-down/remove controls (usable whether the entry is
expanded or collapsed, so acting on an entry never requires opening it first); expanding one instead
shows one labeled field row per `itemSchema` key stacked vertically like any other form on the page
(not a wide table with a column per field) — with an "Add" button below that seeds a new entry from
`itemSchema`'s defaults, expanded by default. See
[`area-picker@beatlink`](../area-picker@beatlink/) for a real consumer.

### `registry` fields — id-keyed collections of settings

Same idea as `list`, but keyed by an opaque generated id (`{ [id]: item }`) instead of a positional
array, for the case where other data needs to reference a specific entry stably by id rather than by
array position (e.g. a second `registry`/`list` field's item pointing back at "which entry of this
other registry" — that reference would break silently on reorder if entries were addressed by index).
Validated/defaulted against `itemSchema` the same recursive way as `list`.

```json
{
    "dateRules": {
        "type": "registry",
        "label": "Date Rules",
        "itemSchema": {
            "name": {"type": "string", "label": "Name", "default": "New Date Rule"},
            "days": {"type": "number", "label": "Days", "default": 0}
        }
    }
}
```

`SettingsForm` renders this the same way as `list` — a stack of collapsible entries, each summary
carrying its own move-up/move-down/remove controls, then one labeled field row per `itemSchema` key
once expanded — just keyed by id instead of position. Reasonable to use for the same cases as `list`
when you know something else needs to reference an entry by a stable id (a `reference` field
elsewhere pointing at
"which entry of this registry" would break silently on reorder if entries were addressed by array
position instead).

### Shipped entries — `registry` fields the addon itself ships entries into

A `registry`'s entries in `defaults.json` are the addon's *shipped* entry set, reconciled against the
user's own additions/edits/deletions on every read and write. `defaults.json` is a normal
addon-shipped note (structural, *never* under the reserved `"persistence"` parent), so it gets fully
overwritten on every TAM update — same mechanism as any other shipped note — meaning an entry you add
to it in a later addon version reaches existing installs automatically, without a migration:

```json
{
    "dateRules": {
        "overdue": {"name": "Overdue", "days": -1},
        "thisWeek": {"name": "This Week", "days": 7}
    }
}
```

The runtime value (what `values.dateRules` holds, and what `RegistryItems` edits) is always the plain
flat merged map — shipped entries the user hasn't removed, overlaid with anything the user added or
edited (an edit shadows the shipped entry under the same id). What actually lands in `config.json` is
different and normally invisible to a consumer: `{ "entries": {...}, "removedIds": [...] }` —
`entries` holds only ids that are new or differ from their shipped version (an untouched shipped
entry is never copied into `config.json`, so it keeps tracking future changes to its shipped default
until the user actually edits it), and `removedIds` records which shipped ids the user deleted (so a
future addon update doesn't resurrect something they removed). A source may state its entries either
way — the flat map above, or that same wrapper — so a hand-written `defaults.json` never has to wrap
anything, while a source layering over another one can still record removals.

### Polymorphic items — a `list`/`registry` entry whose fields depend on its own type

An `itemSchema` field can declare `showWhen` to say it only applies to an item whose sibling
field(s) currently match — this is what lets one `itemSchema` describe an item that's really one of
several shapes (e.g. a filter that's either a plain search query or a date comparison), rather than
needing a separate `list`/`registry` per shape:

```json
{
    "filters": {
        "type": "registry",
        "label": "Filters",
        "itemSchema": {
            "name": {"type": "string", "label": "Name", "default": "New Filter"},
            "type": {
                "type": "select", "label": "Type", "default": "search",
                "options": [
                    {"value": "search", "label": "Search Query"},
                    {"value": "dayjs", "label": "Date Comparison"}
                ]
            },
            "rule": {"type": "string", "label": "Search Rule", "default": "", "showWhen": {"type": "search"}},
            "dateRuleId": {"type": "reference", "label": "Date Rule", "registry": "dateRules", "default": "", "showWhen": {"type": "dayjs"}}
        }
    }
}
```

The discriminator (`type` above) is just a plain `select` field — nothing marks it as special; every
other field in the same `itemSchema` that carries `showWhen` is simply omitted — not rendered at all,
whether the entry is a `list` or a `registry` — whenever the item's current values don't match. A
hidden field's stored value is left alone rather than cleared —
switching `type` back and forth doesn't lose whatever was typed into the other branch. `showWhen` is a
purely presentational filter: `mergeDefaults`/`filterBySchema` don't evaluate it at all, since every
`itemSchema` field always exists as a key on every item regardless of which branch currently applies.

### Cross-registry references — a field that picks an entry from another registry

`dateRuleId` above is a `reference` field: `"registry": "dateRules"` names a *sibling top-level
schema key* (elsewhere in the same schema, must itself be `type: "registry"`), and the field renders
as a dropdown of that registry's current entries — same picker either way, whether the reference
lives at the top level or, as here, nested inside another registry's `itemSchema`. An entry's dropdown
title is its own `name` field (falling back to its raw id if it doesn't have one) — so a `dateRules`
registry entry named "Overdue" shows up
as "Overdue" in every `dateRuleId` dropdown that references it, and renaming it there updates every
reference's display immediately, since the reference only ever stores the id.

This is what lets several registries share one underlying comparison (a filter *and* a prefix/color
interval both testing "overdue" against the same `dateRules` entry) instead of each embedding its own
copy — the motivating case this type exists for. `reference` doesn't validate that the stored id still
exists in the target registry (an entry can be deleted out from under a reference); a dangling
reference just renders as an empty dropdown selection.

### Nesting — a `list`/`registry` entry containing its own `list`/`registry`

`itemSchema` is a full schema in its own right, so an `itemSchema` field can itself be `type: "list"`
or `type: "registry"` — `Field`/`ListItems`/`RegistryItems` all dispatch and recurse the same way
regardless of depth (this is also what `mergeDefaults`/`filterBySchema` walk: a nested `registry`
field's shipped defaults live inside its *parent item's own* shipped default, not the nested field's
own schema `default`, which is only ever the blank starting point for a brand-new item added through
the UI), and `registries` (every top-level registry's current entries, for resolving `reference`
fields) is threaded down unchanged at every level, so a `reference` nested arbitrarily deep still
resolves against the *top-level* registry it names, never a same-named field at some intermediate
level. This is what lets a group-like registry hold its own fully self-contained nested collection —
each entry's own fields defined directly in the nested `itemSchema`, no separate top-level registry to
keep in sync:

```json
{
    "searchGroups": {
        "type": "registry", "label": "Search Groups",
        "itemSchema": {
            "name": {"type": "string", "label": "Name", "default": "New Group"},
            "children": {
                "type": "registry", "label": "Searches",
                "itemSchema": {
                    "name": {"type": "string", "label": "Name", "default": "New Search"},
                    "rule": {"type": "string", "label": "Search Rule", "default": ""},
                    "enabled": {"type": "boolean", "label": "Enabled", "default": true}
                }
            }
        }
    }
}
```

Each Search Group entry contains its own nested stack of search entries, rendered the same
form-per-entry way as anything else — reasonable whenever nothing needs one search shared across more
than one group; reach for a `reference` field (see above) instead when an entry genuinely needs to be
usable from more than one place without duplicating it.

### Checklist fields — toggling entries from another registry, filtered to this one

`reference` (above) lets an entry *pick* one entry from another registry. `checklist` is the inverse
shape: it shows every entry from another registry that *already points back* at this one, as a plain
list of checkboxes — no separate item-editing form, just enable/disable. It only makes sense inside a
`registry`'s `itemSchema` (it filters by the enclosing entry's own id):

```json
{
    "searchGroups": {
        "type": "registry", "label": "Search Groups",
        "itemSchema": {
            "name": {"type": "string", "label": "Name", "default": "New Group"},
            "profileId": {"type": "reference", "label": "Profile", "registry": "profiles", "default": ""},
            "children": {
                "type": "registry", "label": "Searches",
                "itemSchema": {
                    "name": {"type": "string", "label": "Name", "default": "New Search"},
                    "rule": {"type": "string", "label": "Search Rule", "default": ""},
                    "enabled": {"type": "boolean", "label": "Enabled", "default": true}
                }
            }
        }
    },
    "profiles": {
        "type": "registry", "label": "Profiles",
        "itemSchema": {
            "name": {"type": "string", "label": "Name", "default": "New Profile"},
            "searchGroups": {"type": "checklist", "label": "Searches", "registry": "searchGroups", "filterBy": "profileId"}
        }
    }
}
```

For a given `profiles` entry, the `searchGroups` checklist field looks at the top-level `searchGroups`
registry named by `registry`, keeps only the entries whose `filterBy` field (`profileId`) equals this
profile's own id, and renders each as a collapsible group of checkboxes — one per `children` entry,
bound to its `enabled` field. Toggling one stages straight into that sibling top-level `searchGroups`
registry (written on the next Save, like any other edit); the `checklist` field itself stores nothing
under its own key, so it needs no `default` and doesn't participate in
`mergeDefaults`/`filterBySchema`. Anything not covered by the checklist view
(a group's own name, its members' `rule`, adding/removing a group, reassigning which profile a group
belongs to) is still edited on the referenced registry's own tab — `checklist` only ever toggles
`enabled`.

### Tabs

Every field lands on a tab: an explicit `"tab": "Some Label"` string on the field's own definition, if
present; otherwise a `list`/`registry` field defaults to its own tab (labeled by its own `label`,
the original/default behavior), and every other field defaults to `"General"`. Fields are grouped by
resolved tab label in schema-declaration order; when the result is more than one tab, they render as
top-level tabs — one page at a time — with a field's own `<h4>` heading suppressed only when it's the
sole content of its tab (its label already matches the tab button, so repeating it would be
redundant). A schema that resolves to a single tab (the common case: a handful of scalar fields, or
just one `list`/`registry`) skips the tab bar entirely. Use explicit `tab` to combine multiple
fields — including more than one `list`/`registry`, or a mix of scalar and `list`/`registry` fields —
onto one named tab instead of each getting its own:

```json
{
    "parentNoteId": {"type": "note", "label": "File Tasks Under", "tab": "Profile"},
    "searches": {"type": "registry", "label": "Searches", "itemSchema": {...}, "tab": "Searches"},
    "searchGroups": {"type": "registry", "label": "Search Groups", "itemSchema": {...}, "tab": "Searches"}
}
```

### Categories

A schema can add a second grouping level *above* tabs — for a settings form big enough that a single
row of tabs is too flat. Two pieces enable it:

- A field declares `"category": "Some Label"` — the tab that field lands on is placed inside that
  category.
- The schema declares a top-level `_categories` array (a `_`-prefixed *meta* key, not a field —
  it holds no per-user value and never enters `config.json`) listing every category label **in the
  order they should appear**, empty ones included.

```json
{
    "_categories": ["Collect", "Organize", "Review", "Execute"],
    "myDayNoteId": {"type": "note", "label": "My Day Note", "category": "Execute", "tab": "My Day"},
    "morningTime": {"type": "string", "label": "Morning", "category": "Organize", "tab": "Times"},
    "profiles": {"type": "registry", "label": "Profiles", "itemSchema": {}, "category": "Organize", "tab": "Profiles"}
}
```

With `_categories` present, `SettingsForm` renders the category bar on top and the tab bar below it
scoped to the active category. A category listed in `_categories` but with no tabs assigned yet is
shown **disabled/greyed** rather than hidden (`Collect` and `Review` above), so the full intended set
stays visible as the schema grows. A tab whose field carries no `category` (or names one not in
`_categories`) falls under the first declared category, so no field is ever unreachable. Without
`_categories`, `category` is ignored and the form renders exactly the flat single tab row described
above.

### Sub-groups

A tab holding many related scalar fields can read as an undifferentiated wall. Give a field a
`"subgroup": "Some Label"` and it is rendered inside a labelled `fieldset` grouping it with its
tab-mates carrying the same `subgroup`:

```json
{
    "startDate": {"type": "string", "label": "Start Date", "tab": "Labels", "subgroup": "Start"},
    "startTime": {"type": "string", "label": "Start Time", "tab": "Labels", "subgroup": "Start"},
    "dueDate":   {"type": "string", "label": "Due Date",   "tab": "Labels", "subgroup": "Due"},
    "duration":  {"type": "string", "label": "Duration",   "tab": "Labels"}
}
```

Sub-groups appear in first-seen order; fields keep their order inside each group; a field with no
`subgroup` renders first, ungrouped and unheaded. A tab where no field declares a `subgroup` is
unaffected — it stays a flat field stack. This is purely presentational: `subgroup` is a `_`-free
field property but carries no per-user value and does not change what is stored.

### Saving

Every edit stages in the form's local state; nothing is written to `config.json` until the **Save**
button is clicked, which persists the whole document at once (there's no partial write of "just one
field" to a JSON note). The button flashes "Saved!" briefly on success. It renders whenever there's at
least one field to save (under `only`, whenever the visible tab has fields).

Pass an optional `onSaved(values)` callback (see `<SettingsForm>` below) to run a side-effect right
after a successful Save — for a consumer that needs to act on the just-persisted config, e.g. writing
derived labels onto notes once the config describing them is on disk.

## Backend usage

Install this addon as a dependency and declare it as a child of your `customRequestHandler` script
note (`{"parent": "script", "addon": "libsettings@beatlink", "child": "backend"}`) — `require()` it
by its note title, `libSettings.js` (Trilium's bundler resolves `require()` by exact note title, so
this library uses a fully-qualified title to avoid colliding with any other library's globals, same
convention as [libnotification](../libnotification@beatlink/README.md)):

```js
const { loadSettings, saveSettings } = require("libSettings.js")

// however your addon resolves its own noteIds — this library doesn't do it for you
const schemaNoteId = api.currentNote.getRelationValue("schemaNote")
const configNoteId = api.getNote(api.currentNote.getRelationValue("settingsNote"))
    .getRelationValue("configNote")

const values = loadSettings(schemaNoteId, configNoteId)
```

### `loadSettings(schemaNoteId, configNoteId)`

Walks the config note's [source chain](#sources), merges every source in order (last wins), and
returns the merged values object.

### `saveSettings(schemaNoteId, configNoteId, values)`

Writes to the config note only what `values` changes about the sources below it, keeping only keys
present in the schema.

## Frontend / widget usage

Declare this addon as a dependency and pull in its `ui` export as a child of your settings widget
note (`{"parent": "settings", "addon": "libsettings@beatlink", "child": "ui"}`):

For the common case — a settings note that is nothing but the form:

```jsx
import { SettingsPage } from "libSettingsUI.jsx"

export default function MySettings() {
    return <SettingsPage note={api.currentNote} />
}
```

### `<SettingsPage note />`

Resolves `note`'s `schemaNote` and `configNote` relations, then renders a `SettingsForm` for
them, showing `Loading...` until both resolve. Any other prop (`extraPanels`, `only`, `onSaved`)
passes straight through to `SettingsForm`.

**`note` is required, and must be read in your own module.** Reading `api.currentNote` inside this
library yields *the library's* note, not your settings note — it has no `schemaNote` or
`configNote` relation, so resolution silently yields nothing and the page never leaves
`Loading...`. That is why this is a prop rather than a default.

Reach for `SettingsForm` directly only when the page is more than the form — e.g. content stacked
*above* it rather than in a tab, as `template-picker@beatlink` does with its Scan button. In that
case use `resolveConfigNotes()` so you still don't hand-roll the relation lookups.

### `resolveConfigNotes(note)`

Returns `{ schemaNoteId, configNoteId }` for a note, handling both wirings:

* a **settings note**, where `schemaNote` and `configNote` both hang off the note directly;
* a **widget script note**, which carries `schemaNote` itself but reaches config indirectly through
  its `settingsNote` relation.

Either id is `null` when its relation is absent, so gate your render on both.

`note` is required, for the reason given above: pass `api.currentNote` from a settings note's own
module, or the `currentNote` imported from `trilium:api` from a widget.

Frontend only — backend scripts should keep using the `libSettings.js` require described above.

### `<SettingsForm schemaNoteId configNoteId />`

Fully self-contained: resolves the config note's whole [source chain](#sources) itself, renders one
field per merged-schema entry (`string`/`number` → text box, `boolean` → checkbox, `date`/`time`/`datetime` →
native date picker, `select` → dropdown, `note` → note
picker, `color` → swatch picker, `reference` → dropdown of another registry's entries, `list` →
repeatable stack of forms of the above, `registry` → id-keyed stack of forms of the above), and owns
its own Save button and save-status flash. Place it anywhere in your own widget — it doesn't dictate
page layout, only the fields.

`date`, `time` and `datetime` render the browser's native picker and store exactly what it produces
— `"YYYY-MM-DD"`, `"HH:mm"` and `"YYYY-MM-DDTHH:mm"`. A field that already holds strings in one of
those shapes can switch to the matching type with no migration.

`color` fields are rendered by Trilium's built-in `ColorPicker` (`trilium:preact`, 0.105+), so they
carry no dependency of their own. Picks are stored as lowercase hex; values stored as CSS colour
names by earlier versions still render and still match their swatch, and become hex the next time
the field is edited.

#### `extraPanels` — injecting custom (non-schema) tabs

Some settings content can't be expressed as a schema field — a side-effecting picker, a "run this
action" button, a bespoke widget. Pass `extraPanels` to slot such content into the *same*
category/tab nav as the schema fields, so it doesn't need a second page or a second nav bar:

```jsx
<SettingsForm
    schemaNoteId={schemaNoteId}
    configNoteId={configNoteId}
    extraPanels={[
        { category: "Settings", tab: "Maintenance", render: () => <MyMaintenancePanel /> }
    ]}
/>
```

Each entry is `{ category, tab, render }`: `render()` returns the tab's body (any JSX). Its `tab`
joins the given `category`'s tab row (after the schema tabs already there); when that tab is active,
`render()` shows in place of schema fields. An extra panel naming a category absent from `_categories`
falls under the first declared category, exactly as a field would. Give each panel its own `tab` label
— a panel sharing a label with a schema tab would collide. `extraPanels` is purely additive: omit it
(the default `[]`) and the form behaves exactly as documented above. See
[`agenda-organize@beatlink`](../../addons/agenda-organize@beatlink/)'s `organizeEditor.jsx` for a
real consumer (the Organize-note picker injected as a Settings tab).

#### `only` — embedding a single tab

Pass `only="<tab label>"` to render just one tab of the schema: the category and tab nav are hidden
and only that tab's fields show. For surfacing one registry of a larger schema on its own page while
the full schema still edits elsewhere:

```jsx
<SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} only="Templates" />
```

`only` is a display filter, not a schema subset — every field is still loaded, merged, and persisted,
so a change here writes the whole document like any other save. The Save button appears when the
*visible* tab has fields (so an embedded single-tab panel gets its own Save). See
[`agenda@beatlink`](../agenda@beatlink/)'s `organizeTemplates.jsx` (the Organize page's Templates tab),
which pairs `only` with `onSaved` to apply derived labels after each save.

#### `onSaved` — a post-save hook

Pass `onSaved={fn}` to run `fn(values)` right after a successful Save (after the config is persisted,
before the "Saved!" flash). For a consumer that derives something from the config and needs it applied
once the config is on disk — e.g. `organizeTemplates.jsx` writes each enabled template's `#type` /
`#agendaTaskWidget` labels here, so saving the template rows both persists them and applies them.

### `loadSettings(schemaNoteId, configNoteId)` (also exported from `libsettings-ui.jsx`)

The same source-chain merge as the backend function, but `async` and usable from any frontend
context — not just a widget rendering `SettingsForm`. Useful for e.g. a note-context-aware widget
that needs to check current settings without rendering the full form.

### `saveSettings(schemaNoteId, configNoteId, values)` (also exported from `libsettings-ui.jsx`)

The same diff-against-the-lower-sources write as the backend function, `async` from any frontend
context.
Useful for frontend library code that needs to persist a programmatic edit itself — a widget calling
into a shared library function that reads, patches, and writes settings, not just edits made through
`SettingsForm` directly.

## Update review — TAM owns it

`config.json` is persistent, so TAM never overwrites it; `defaults.json` is structural, so every
update replaces it with whatever the shipped values have become. Reconciling those two on update is
**[TAM's](../../addons/trilium-addon-manager@beatlink/ARCHITECTURE.md#per-setting-review-manifestsettings)
job, not this library's**, and needs no code in your addon. Declare the trio in your manifest, and
link the config note to its defaults source:

```json
"settings": {
    "schema": "schema",
    "defaults": "defaults",
    "config": "config"
}
```

```json
"relations": [
    {"from": "config", "type": "sourceConfig", "to": "defaults"}
]
```

with the schema and defaults notes structural and the config note attached under the reserved
`"persistence"` parent and shipping **no content of its own** (`"sourceUrl": null`, no `content`) —
TAM creates it empty, which this library reads as `{}`. `validate` enforces all of it. See
[`duplicate-finder@beatlink`](../../addons/duplicate-finder@beatlink/) and
[`area-picker@beatlink`](../../addons/area-picker@beatlink/) for the wiring in a real manifest.

That gets you, for free:

* the config note **excluded** from TAM's whole-file diff (a persistent note shipping `{}` would
  otherwise be offered for whole-file replacement on every update, wiping every saved setting);
* every default that moved in the update raised as one Update Review row, with Keep Mine against
  what the user has today and Use New Default against the new shipped value — a row they never
  customized starts on Use New Default, one that conflicts starts on Keep Mine.

Registry entries reconcile as [Shipped entries](#shipped-entries--registry-fields-the-addon-itself-ships-entries-into)
already describes: untouched shipped entries track upstream automatically and never appear in the
review at all, user-added and user-deleted ones are left alone, and only an entry the user *edited*
whose shipped version *also* changed is worth a question. `list` fields are excluded from review
entirely, since a stored list replaces its default wholesale.

Answering **Use New Default** drops the user's override — their key, or their shadowing registry
entry — rather than copying the new value in, so the setting goes back to tracking `defaults.json`
from then on. **Keep Mine** does the opposite: it pins what they have today into `config.json`,
which for a setting they never diverged on is the only thing that stops it following the new value.

### `libsettings-core.js`

The schema semantics — how a chain of sources combines into the runtime values, and how they come
apart on save — live in
[`libsettings-core.js`](libsettings-core.js), a plain `env=frontend` module. Both
[`libsettings-ui.jsx`](libsettings-ui.jsx) and TAM's own `lib-tam.js` require it, so the review and
the form agree exactly on what "the user changed this" means. Since TAM reuses any note carrying the
same `#TAMSOURCEURL`, that is one note in the database no matter how many addons wire it.

Consumers wire it as a **direct** child of `libSettingsUI.jsx` (that is what `require()` resolves
against):

```json
{
    "notes": [
        {
            "id": "libsettings-core",
            "title": "libSettingsCore.js",
            "type": "code",
            "mime": "application/javascript;env=frontend",
            "sourceUrl": ".../libs/libsettings/libsettings-core.js"
        }
    ],
    "children": [
        {"parent": "libsettings-ui", "child": "libsettings-core"}
    ]
}
```

[`libsettings-backend.js`](libsettings-backend.js) still carries its own copy of those helpers, and
has to: Trilium only bundles a child module whose script env matches its parent's, so a backend
script can never require a frontend note however the notes are wired. Those two must be changed
together.

## See it in use

[`cinnamon-applet-agenda@beatlink`](../../addons/cinnamon-applet-agenda@beatlink/) and
[`cinnamon-applet-inbox@beatlink`](../../addons/cinnamon-applet-inbox@beatlink/) both consume this
library — their manifests show the full relation wiring (`schemaNote`, `settingsNote`, `configNote`,
and the `sourceConfig` link from `config.json` to `defaults.json`) a consumer needs to declare, with
`config.json` attached under the reserved `"persistence"` parent and named by `manifest.settings`.
