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
| `type`        | yes      | `string`, `number`, `boolean`, `select`, `note`, `color`, `list`, or `registry` |
| `label`       | yes      | Field heading shown in the generated form                  |
| `description` | no       | Help text shown under the heading                           |
| `default`     | yes      | Value used when the key is missing from `config.json` (`[]` for `list`, `{}` for `registry`) |
| `options`     | `select` only | Array of `{"value", "label"}` for the dropdown          |
| `itemSchema`  | `list`/`registry` only | A nested schema object (same shape as above) describing the fields of each entry |
| `tab`         | no       | Explicit tab label this field is grouped under — see "Tabs" below |

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

In the generated form, `SettingsForm` renders this as a real `<table>` — one row per entry, one
column per `itemSchema` field, plus a fixed actions column (move-up/move-down/remove) — with an
"Add" button that seeds a new row from `itemSchema`'s defaults. See
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

`SettingsForm` renders this as a stack of collapsible cards (one per entry) instead of a table row —
each card's summary is its `name` field if `itemSchema` declares one, otherwise its first field's
value, and its body is one labeled field row per `itemSchema` key. Reasonable to use for the same
cases as `list` when entries get numerous/verbose enough that a wide table becomes hard to scan, or
whenever you know something else needs to reference an entry by a stable id.

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
picker, `color` → swatch picker, `list` → repeatable table of the above, `registry` → id-keyed stack
of collapsible cards of the above), and owns its own Save button and save-status flash. Place it
anywhere in your own widget — it doesn't dictate page layout, only the fields.

`color` fields are rendered by [`libcolorpicker@beatlink`](../libcolorpicker@beatlink/) — a
dependency of this library, not something a consumer needs to declare directly.

### `loadSettings(schemaNoteId, configNoteId)` (also exported from `libsettings-ui.jsx`)

The same merge-with-defaults read as the backend function, but `async` and usable from any frontend
context — not just a widget rendering `SettingsForm`. Useful for e.g. a note-context-aware widget
that needs to check current settings without rendering the full form.

## See it in use

[`cinnamon-applet-agenda@beatlink`](../cinnamon-applet-agenda@beatlink/) and
[`cinnamon-applet-inbox@beatlink`](../cinnamon-applet-inbox@beatlink/) both consume this library —
their manifests show the full relation wiring (`schemaNote`, `settingsNote`, `AddonData:config`) a
consumer needs to declare.
