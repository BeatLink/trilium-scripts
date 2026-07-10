# Agenda Tree View

Reusable Preact component rendering a flat, sorted list of
[libagendataskcard@beatlink](../libagendataskcard@beatlink/) `TaskCard`s for TriliumNext widget UIs —
the "tree" view mode of [agenda@beatlink](../agenda@beatlink/)'s Task View page.

There's no actual parent/child nesting rendered here: the note id list this receives (from
`libagendaoverview@beatlink`'s `getSortedTaskList`) is a flat filtered+sorted array with no tree
structure to draw, matching what `agenda@beatlink`'s reparenting flow already flattens into one
parent today. "Tree view" names the flat, ordered list style (as opposed to the columns of a kanban
board or a calendar grid), not a real note hierarchy.

## Usage

Install as a dependency and clone the `TreeView.jsx` note as a child of the JSX widget that needs it:

```jsx
import { TreeView } from "TreeView.jsx"
import { activateNote } from "trilium:api"

<TreeView
    noteIds={sortedNoteIds}
    titles={titleDict}
    prefixDict={prefixDict}
    colorDict={colorDict}
    onCardClick={activateNote}
/>
```

## Props

| Prop          | Type     | Description                                              |
|---------------|----------|----------------------------------------------------------|
| `noteIds`     | string[] | Already-sorted note ids to render, in order               |
| `titles`      | object   | `{noteId: title}`                                          |
| `prefixDict`  | object   | Optional `{noteId: prefixText}`                            |
| `colorDict`   | object   | Optional `{noteId: color}`                                 |
| `onCardClick` | function | Called with `noteId` when a card is clicked                |
