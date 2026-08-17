# Picker Registry

Shared registry-support logic for right-pane "picker" widgets that assign a label or relation to
the active note (e.g. `area-picker@beatlink`, `template-picker@beatlink`): the exclude-filter list,
scanning for notes still missing the picker's assignment, and the excluded-from-picker check. Each
consumer keeps its own registry read/write (which entries the dropdown offers, in what order) since
that part's shape differs per picker.

## Usage

Add `pickerRegistry.jsx` as a note wherever it's `import`ed from — Trilium's require resolver only
finds a module note that is a **direct child** of the requiring note, so wire it as a child of every
note that imports from it (not just once via an ancestor).

```jsx
import { getExcludeFilters, isExcludedFromPicker, getMissingAssignmentNotes } from "pickerRegistry.jsx"
```

`pickerRegistry.jsx` itself imports `loadSettings` from `libSettingsUI.jsx`, so it also needs
`libSettingsUI.jsx` wired as its own direct child.

### `getExcludeFilters(schemaNoteId, configNoteId)`

The enabled exclude filters from the consumer's own `config.json`, in registry order:
`[{ id, name, query }]`.

### `isExcludedFromPicker(schemaNoteId, configNoteId, noteId)`

Whether the given note matches any enabled exclude filter's search query — the check each picker
widget uses to decide whether to render itself at all.

### `getMissingAssignmentNotes(schemaNoteId, configNoteId, searchQuery, attrType, attrName)`

Every non-hidden note matching `searchQuery` that lacks the label/relation named `attrName`
(`attrType` is `"label"` or `"relation"`), minus anything matching an enabled exclude filter.
Returns `[{ noteId, title, path, preview }]` — the feed for a "Missing X" triage page.

## See it in use

[`area-picker@beatlink`](../../addons/area-picker@beatlink/areaRegistry.jsx) and
[`template-picker@beatlink`](../../addons/template-picker@beatlink/templateRegistry.jsx) both call
`getMissingAssignmentNotes` from their own `getMissingAreaNotes`/`getMissingTemplateNotes`, and
their widgets (`areaPickerPreact.jsx`/`templatePickerPreact.jsx`) call `isExcludedFromPicker`
directly.
