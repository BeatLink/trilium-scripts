# Agenda Kanban View

Reusable Preact component rendering a kanban board — one column per group, native HTML5
drag-and-drop to move a card between columns — built from
[libagendataskcard@beatlink](../libagendataskcard@beatlink/) `TaskCard`s, for TriliumNext widget UIs.
The kanban view mode of [agenda@beatlink](../agenda@beatlink/)'s Task View page.

No drag-and-drop library exists anywhere in this repo, and none is needed for a plain
reorder-into-column gesture — this uses the browser's native `draggable`/`dragstart`/`dragover`/`drop`
events directly (`TaskCard`'s own `draggable`/`onDragStart`/`onDragEnd` props, plus this component's
own column-level `onDragOver`/`onDrop` handlers).

## Usage

Install as a dependency and clone the `KanbanView.jsx` note as a child of the JSX widget that needs
it. `columns` and `groupDict` typically come from
[libagendaoverview@beatlink](../libagendaoverview@beatlink/)'s `getGroupColumns`/`getGroups`:

```jsx
import { KanbanView } from "KanbanView.jsx"
import { activateNote } from "trilium:api"

<KanbanView
    noteIds={sortedNoteIds}
    titles={titleDict}
    groupDict={groupDict}
    columns={columns}
    prefixDict={prefixDict}
    colorDict={colorDict}
    onCardClick={activateNote}
    onCardMove={(noteId, newColumnKey) => setGroupForNote(groupingInfo, noteId, newColumnKey)}
    dragEnabled={groupingInfo.type === "label"}
/>
```

Notes whose group key doesn't match any `columns` entry land in a trailing "Ungrouped" column, which
is never a drop target (dropping onto it is a no-op — there's no single group key an "everything
else" column could write back).

`dragEnabled` should be computed by the caller from the grouping's `type` — a `type:"dayjs"` grouping
(dropping into "Overdue"/"This Week"/etc) has no settable value a drop could write, so drag must stay
disabled for those; this component doesn't know why, it just renders draggable or not.

## Props

| Prop          | Type     | Description                                                          |
|---------------|----------|------------------------------------------------------------------------|
| `noteIds`     | string[] | Note ids to place into columns                                         |
| `titles`      | object   | `{noteId: title}`                                                       |
| `groupDict`   | object   | `{noteId: groupKey \| null}` — which column each note belongs to        |
| `columns`     | array    | `[{key, display, color}]` — ordered column definitions                  |
| `prefixDict`  | object   | Optional `{noteId: prefixText}`                                        |
| `colorDict`   | object   | Optional `{noteId: color}` (card accent, independent of column color)  |
| `onCardClick` | function | Called with `noteId` when a card is clicked                            |
| `onCardMove`  | function | Called with `(noteId, newColumnKey)` when a card is dropped on a column |
| `dragEnabled` | boolean  | Whether cards are draggable (default `false`)                          |
