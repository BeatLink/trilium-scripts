# Agenda Task Card

Reusable Preact component rendering a single task note as a compact card (title, optional prefix
text, optional color accent) for TriliumNext widget UIs — shared by
[libagendatreeview@beatlink](../libagendatreeview@beatlink/) and
[libagendakanbanview@beatlink](../libagendakanbanview@beatlink/).

## Usage

Install as a dependency and clone the `TaskCard.jsx` note as a child of the JSX widget that needs it:

```jsx
import { TaskCard } from "TaskCard.jsx"
import { activateNote } from "trilium:api"

<TaskCard
    noteId={noteId}
    title={note.title}
    prefix={prefixDict[noteId]}
    color={colorDict[noteId]}
    onClick={activateNote}
/>
```

Pure presentation — no relation resolution, no data fetching (dependency injection, like every other
`lib*@beatlink` component). The caller supplies already-fetched `title`/`prefix`/`color` and wires
`onClick` to however it wants to navigate (typically `trilium:api`'s `activateNote`, letting the
target note's own right-pane widgets — e.g. `agenda@beatlink`'s task editor — handle anything further,
rather than this component reimplementing editing).

## Props

| Prop          | Type     | Description                                                    |
|---------------|----------|--------------------------------------------------------------------|
| `noteId`      | string   | The note id, passed back to `onClick`/`onDragStart`/`onDragEnd`    |
| `title`       | string   | Card title text                                                    |
| `prefix`      | string   | Optional small text shown before the title                         |
| `color`       | string   | Optional CSS color for the card's left-border accent               |
| `onClick`     | function | Called with `noteId` on click                                      |
| `draggable`   | boolean  | Enables native HTML5 drag-and-drop on the card (default `false`)   |
| `onDragStart` | function | Called with `(event, noteId)` on drag start, if `draggable`        |
| `onDragEnd`   | function | Called with `(event, noteId)` on drag end, if `draggable`          |
