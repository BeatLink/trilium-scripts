# Settings Library

Stateless, schema-driven settings engine for TriliumNext addons — inspired by Cinnamon's
`settings-schema.json` model. An addon defines its own `schema.json` (what fields exist, their type,
label, description, and default) and keeps its own persisted `config.json` (an
[`AddonData:` persisted note](../trilium-addon-manager@beatlink/README.md#persistence)); this
library reads/merges/saves those two notes for you, and can render a settings form from that same
schema.

This library never resolves note references itself — it's handed noteIds by the consuming addon
(dependency injection). It doesn't know or care about relation names, note titles, or your addon's
tree shape; that's entirely up to you. This matters because the library note itself is cloned
byreference into every consumer — it's the same note everywhere, so it has no way to discover "which
addon is calling me" on its own.

## Schema format

A JSON object keyed by setting name, saved as your addon's own `schema.json` note (not this
library's — schema lives with the addon that defines it):

```json
{
    "apiKey": {"type": "string", "label": "API Key", "description": "Shared secret for the panel applet", "default": "CHANGE_ME"},
    "taskOrder": {"type": "select", "label": "Task Order", "options": [{"value": "earliest", "label": "Earliest"}, {"value": "latest", "label": "Latest"}], "default": "earliest"},
    "inboxNoteId": {"type": "note", "label": "Inbox Note", "description": "Note whose first line should be surfaced", "default": ""}
}
```

| Field         | Required | Description                                              |
|---------------|----------|------------------------------------------------------------|
| `type`        | yes      | `string`, `number`, `boolean`, `select`, `note`, `color`, `list`, `registry`, or `reference` |
| `label`       | yes      | Field heading shown in the generated form                  |
| `description` | no       | Help text shown under the heading                           |
| `default`     | yes      | Value used when the key is missing from `config.json` (`[]` for `list`, `{}` for `registry`, `""` for `reference`) |
| `options`     | `select` only | Array of `{"value", "label"}` for the dropdown          |
| `itemSchema`  | `list`/`registry` only | A nested schema object (same shape as above) describing the fields of each entry |
| `registry`    | `reference` only | The sibling top-level schema key (must be a `registry` field) this field picks an entry from |
| `tab`         | no       | Explicit tab label this field is grouped under — see "Tabs" below |
| `category`    | no       | Optional second grouping level *above* the tab — the tab this field is on lands inside this category — see "Categories" below |
| `showWhen`    | no, `itemSchema` fields only | `{"otherField": value}` (or `{"otherField": [value, ...]}`) — only applies to an item whose sibling fields match; see "Polymorphic items" below |
| `autosave`    | no, top-level fields only, default `false` | Persist this field's edits immediately instead of waiting on the Save button — see "Autosave fields" below |

Your addon's `config.json` only needs to start as `{}` — every field is defaulted from the schema on
first read, so there's nothing to duplicate between the two files.

### `list` fields — repeatable groups of settings

Use `type: "list"` when an addon needs a variable number of entries that each carry several fields
(e.g. one profile per table to total, one entry per webhook). Each stored value is an array of
objects; each object is validated/defaulted against `itemSchema`, recursively — this works the same
way at any depth `mergeDefaults`/`filterBySchema` are applied in both
[`libsettings-backend.js`](libsettings-backend.js) and [`libsettings-ui.jsx`](libsettings-ui.jsx).

```json
{
    "profiles": {
        "type": "list",
        "label": "Profiles",
        "description": "One entry per thing you want to configure",
        "default": [],
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
[`table-calculator@beatlink`](../table-calculator@beatlink/) for a real consumer.

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
        "default": {},
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

A `registry`'s `default` isn't just "the value when the key is missing" (as for every other field
type) — it's also the *shipped* entry set, reconciled against the user's own additions/edits/deletions
on every read and write. This works because `schema.json` is a normal addon-shipped note (not tracked
by `AddonData:`), so it gets fully overwritten on every TAM update — same mechanism as any other
shipped note — meaning a new default entry you add to `default` in a later addon version reaches
existing installs automatically, without a migration:

```json
{
    "dateRules": {
        "type": "registry",
        "label": "Date Rules",
        "default": {
            "overdue": {"name": "Overdue", "days": -1},
            "thisWeek": {"name": "This Week", "days": 7}
        },
        "itemSchema": {
            "name": {"type": "string", "label": "Name", "default": "New Date Rule"},
            "days": {"type": "number", "label": "Days", "default": 0}
        }
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
future addon update doesn't resurrect something they removed). This is exactly the shipped-vs-
persisted-delta split `agenda@beatlink`'s own hand-rolled `builtinElementsNoteId` system implements —
generalized here as a property of the `registry` type itself, with no separate note needed. A
`registry` with `default: {}` (no shipped entries) behaves exactly as before this existed — the split
is a no-op when there's nothing shipped to reconcile against.

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
        "default": {},
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
        "type": "registry", "label": "Search Groups", "default": {},
        "itemSchema": {
            "name": {"type": "string", "label": "Name", "default": "New Group"},
            "children": {
                "type": "registry", "label": "Searches", "default": {},
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
        "type": "registry", "label": "Search Groups", "default": {},
        "itemSchema": {
            "name": {"type": "string", "label": "Name", "default": "New Group"},
            "profileId": {"type": "reference", "label": "Profile", "registry": "profiles", "default": ""},
            "children": {
                "type": "registry", "label": "Searches", "default": {},
                "itemSchema": {
                    "name": {"type": "string", "label": "Name", "default": "New Search"},
                    "rule": {"type": "string", "label": "Search Rule", "default": ""},
                    "enabled": {"type": "boolean", "label": "Enabled", "default": true}
                }
            }
        }
    },
    "profiles": {
        "type": "registry", "label": "Profiles", "default": {},
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
bound to its `enabled` field. Toggling one writes straight back into that sibling top-level
`searchGroups` registry and persists immediately (regardless of whether the enclosing field is
`autosave`); the `checklist` field itself stores nothing under its own key, so it needs no `default`
and doesn't participate in `mergeDefaults`/`filterBySchema`. Anything not covered by the checklist view
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
    "parentNoteId": {"type": "note", "label": "File Tasks Under", "default": "", "tab": "Profile"},
    "searches": {"type": "registry", "label": "Searches", "default": {}, "itemSchema": {...}, "tab": "Searches"},
    "searchGroups": {"type": "registry", "label": "Search Groups", "default": {}, "itemSchema": {...}, "tab": "Searches"}
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
    "myDayNoteId": {"type": "note", "label": "My Day Note", "default": "", "category": "Execute", "tab": "My Day"},
    "morningTime": {"type": "string", "label": "Morning", "default": "08:00", "category": "Organize", "tab": "Times"},
    "profiles": {"type": "registry", "label": "Profiles", "default": {}, "itemSchema": {}, "category": "Organize", "tab": "Profiles"}
}
```

With `_categories` present, `SettingsForm` renders the category bar on top and the tab bar below it
scoped to the active category. A category listed in `_categories` but with no tabs assigned yet is
shown **disabled/greyed** rather than hidden (`Collect` and `Review` above), so the full intended set
stays visible as the schema grows. A tab whose field carries no `category` (or names one not in
`_categories`) falls under the first declared category, so no field is ever unreachable. Without
`_categories`, `category` is ignored and the form renders exactly the flat single tab row described
above.

### Autosave fields

By default every field waits on the Save button — nothing is written to `config.json` until it's
clicked, same as before `autosave` existed. A top-level field marked `"autosave": true` instead
persists immediately on every edit (still the same full-document `persistValues` write; there's no
partial write of "just one field" to a JSON note). This is meant for the case where a schema mixes two
kinds of field on purpose — an element-library-style `registry` you want to feel "live" (edit an
entry, it's saved, no separate step) alongside a handful of fields that represent a deliberate choice
worth confirming explicitly (a name, which note something files under, which preset is currently
selected):

```json
{
    "parentNoteId": {"type": "note", "label": "File Tasks Under", "default": ""},
    "searches": {"type": "registry", "label": "Searches", "default": {}, "itemSchema": {...}, "autosave": true}
}
```

Autosave is silent — no save-status flash — since the explicit Save button's flash means "you had a
pending edit, and it's now saved," and an autosave field never has one. The Save button itself is only
rendered at all if at least one top-level field *isn't* `autosave`; a schema that's entirely autosave
fields has nothing left for it to do.

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
    .getRelationValue("AddonData:config")

const values = loadSettings(schemaNoteId, configNoteId)
```

### `loadSettings(schemaNoteId, configNoteId)`

Reads both notes, merges stored values over schema defaults for any missing key, and returns the
merged values object.

### `saveSettings(schemaNoteId, configNoteId, values)`

Writes `values` to the config note, keeping only keys present in the schema.

## Frontend / widget usage

Declare this addon as a dependency and pull in its `ui` export as a child of your settings widget
note (`{"parent": "settings", "addon": "libsettings@beatlink", "child": "ui"}`):

```jsx
import { SettingsForm } from "libSettingsUI.jsx"

export default function MySettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)

    useEffect(() => {
        (async () => {
            setSchemaNoteId(await api.currentNote.getRelationValue("schemaNote"))
            const target = await api.currentNote.getRelationTarget("AddonData:config")
            setConfigNoteId(target.noteId)
        })()
    }, [])

    if (!schemaNoteId || !configNoteId) return <div>Loading...</div>

    return (
        <div>
            <h3>My Addon Settings</h3>
            <SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
        </div>
    )
}
```

### `<SettingsForm schemaNoteId configNoteId />`

Fully self-contained: loads `schema.json` and `config.json` itself, renders one field per schema
entry (`string`/`number` → text box, `boolean` → checkbox, `select` → dropdown, `note` → note
picker, `color` → swatch picker, `reference` → dropdown of another registry's entries, `list` →
repeatable stack of forms of the above, `registry` → id-keyed stack of forms of the above), and owns
its own Save button and save-status flash. Place it anywhere in your own widget — it doesn't dictate
page layout, only the fields.

`color` fields are rendered by [`libcolorpicker@beatlink`](../libcolorpicker@beatlink/) — a
dependency of this library, not something a consumer needs to declare directly.

#### `extraPanels` — injecting custom (non-schema) tabs

Some settings content can't be expressed as a schema field — a side-effecting picker, a "run this
action" button, a bespoke widget. Pass `extraPanels` to slot such content into the *same*
category/tab nav as the schema fields, so it doesn't need a second page or a second nav bar:

```jsx
<SettingsForm
    schemaNoteId={schemaNoteId}
    configNoteId={configNoteId}
    extraPanels={[
        { category: "Settings", tab: "Workflow Setup", render: () => <MySetupPanel /> }
    ]}
/>
```

Each entry is `{ category, tab, render }`: `render()` returns the tab's body (any JSX). Its `tab`
joins the given `category`'s tab row (after the schema tabs already there); when that tab is active,
`render()` shows in place of schema fields. An extra panel naming a category absent from `_categories`
falls under the first declared category, exactly as a field would. Give each panel its own `tab` label
— a panel sharing a label with a schema tab would collide. `extraPanels` is purely additive: omit it
(the default `[]`) and the form behaves exactly as documented above. See
[`agenda@beatlink`](../agenda@beatlink/)'s `profileEditor.jsx` for a real consumer (Workflow Setup +
the Organize-note picker injected as a Settings tab).

#### `only` — embedding a single tab

Pass `only="<tab label>"` to render just one tab of the schema: the category and tab nav are hidden
and only that tab's fields show. For surfacing one registry of a larger schema on its own page while
the full schema still edits elsewhere:

```jsx
<SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} only="Templates" />
```

`only` is a display filter, not a schema subset — every field is still loaded, merged, and persisted,
so a change here writes the whole document like any other save. The Save button appears only if the
*visible* tab has a non-autosave field (an embedded autosave-only registry shows no Save button). See
[`agenda@beatlink`](../agenda@beatlink/)'s `organizeTemplates.jsx` (the Organize page's Templates tab).

### `loadSettings(schemaNoteId, configNoteId)` (also exported from `libsettings-ui.jsx`)

The same merge-with-defaults read as the backend function, but `async` and usable from any frontend
context — not just a widget rendering `SettingsForm`. Useful for e.g. a note-context-aware widget
that needs to check current settings without rendering the full form.

### `saveSettings(schemaNoteId, configNoteId, values)` (also exported from `libsettings-ui.jsx`)

The same diff-against-schema write as the backend function, `async` from any frontend context.
Useful for frontend library code that needs to persist a programmatic edit itself — a widget calling
into a shared library function that reads, patches, and writes settings, not just edits made through
`SettingsForm` directly.

## See it in use

[`cinnamon-applet-agenda@beatlink`](../cinnamon-applet-agenda@beatlink/) and
[`cinnamon-applet-inbox@beatlink`](../cinnamon-applet-inbox@beatlink/) both consume this library —
their manifests show the full relation wiring (`schemaNote`, `settingsNote`, `AddonData:config`) a
consumer needs to declare.
