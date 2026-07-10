# Agenda Table View

Reusable Preact component that renders a sortable, column-toggleable data table over a flat,
already-sorted task-note-id list — the **Table** view mode of
[agenda@beatlink](../agenda@beatlink/)'s Task View page. Wraps
[libtabulator@olifolkerd](../libtabulator@olifolkerd/) (vendored Tabulator), handling its one-time
script load and adapting agenda task data into Tabulator rows.

## Usage

```jsx
import { TableView } from "TableView.jsx"

<TableView
    noteIds={noteIds}          // flat, already-sorted array of task note ids
    titles={titles}            // { noteId: title }
    colorDict={colorDict}      // { noteId: cssColor } — drives the title-cell accent dot
    constants={constants}      // agenda label-name constants (START_DATETIME_LABEL, etc.)
    columnState={columnState}  // persisted { visible: {field: bool}, sort: [{column, dir}] } | null
    onColumnState={save}       // (state) => void, called on column toggle / re-sort
    onRowClick={activateNote}  // (noteId) => void
/>
```

## Columns

Title (always shown, with a color accent dot), Start, Due, Duration, Recurrence, Rank. Every column
except Title can be shown/hidden from its **column header menu**; click a header to sort. The current
visibility + sort is reported through `onColumnState` so the caller can persist it (agenda@beatlink
stores it per profile in its config note). Column `field` keys are stable identifiers — that saved
state is keyed by them.

## Child notes

Each task note's child notes render as **expandable sub-rows** (Tabulator `dataTree`), with the
expand toggle in the Title column and collapsed by default. Child cells are read from the child
note's own labels; child rows carry no color accent and clicking one activates that note. Cloned
notes can't loop the tree — a visited set guards against cycles.

Tabulator is a browser-only global build loaded as a `<script>` (`custom/libTabulator.js`); its
stylesheet is applied via libtabulator@olifolkerd's `#appCss` note. This component depends on that
addon and wires its `core` export as a child so both install.
