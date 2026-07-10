import { useEffect, useRef, useState } from "trilium:preact"

// Tabulator ships as a browser-only global build with no CommonJS export, so
// it's loaded as a plain <script> that sets window.Tabulator (its stylesheet
// rides along as libtabulator@olifolkerd's #appCss note). Mirrors how
// CalendarWidget.jsx loads FullCalendar.
const SCRIPT_URL = "custom/libTabulator.js"

let loadPromise = null

// Loads the vendored script exactly once per page, however many TableView
// instances mount.
function loadTabulator() {
    if (!loadPromise) {
        loadPromise = new Promise((resolve, reject) => {
            if (window.Tabulator) { resolve(); return }
            const script = document.createElement("script")
            script.src = SCRIPT_URL
            script.onload = resolve
            script.onerror = () => reject(new Error(`Failed to load ${SCRIPT_URL}`))
            document.head.appendChild(script)
        })
    }
    return loadPromise
}

// The full set of columns this view can show, in display order. `field` is the
// row-data key; `label` maps to a constants.*_LABEL note-label name (or null
// for the synthetic "title"). Title is pinned visible and non-hideable; the
// rest are toggled per-profile via Tabulator's built-in header menu. Keep these
// `field` keys stable — they're the identifiers persisted in a profile's saved
// column-visibility/sort state.
const COLUMN_DEFS = [
    { field: "title", title: "Title", label: null, hideable: false, defaultVisible: true },
    { field: "start", title: "Start", label: "START_DATETIME_LABEL", hideable: true, defaultVisible: true },
    { field: "due", title: "Due", label: "DUE_DATETIME_LABEL", hideable: true, defaultVisible: true },
    { field: "duration", title: "Duration", label: "DURATION_LABEL", hideable: true, defaultVisible: false },
    { field: "recurrence", title: "Recurrence", label: "RECURRENCE_LABEL", hideable: true, defaultVisible: false },
    { field: "rank", title: "Rank", label: "RANK_LABEL", hideable: true, defaultVisible: false }
]

const CHECK = "✓ "
const BLANK = "  "

// The action buttons rendered in the always-visible, non-hideable "Actions"
// column. `action` is passed back to the caller's onAction(noteId, action) so
// the presentation component stays free of task-mutation logic. Keep these keys
// stable — the caller switches on them.
const ROW_ACTIONS = [
    { action: "complete", icon: "bx bx-check", title: "Complete Task" },
    { action: "today", icon: "bx bx-rocket", title: "Start Today" },
    { action: "tomorrow", icon: "bx bx-rocket", title: "Start Tomorrow" }
]

// Builds the Actions-cell formatter, bound to a ref holding the latest
// onAction callback so button clicks always see the current handler without
// rebuilding the table. Clicks stopPropagation so they don't also fire the
// row-click navigation.
function makeActionsFormatter(onActionRef) {
    return (cell) => {
        const noteId = cell.getRow().getData().id
        const wrap = document.createElement("span")
        wrap.className = "libagendatableview-actions"
        for (const a of ROW_ACTIONS) {
            const btn = document.createElement("button")
            btn.className = "libagendatableview-action"
            btn.title = a.title
            const icon = document.createElement("span")
            icon.className = a.icon
            btn.appendChild(icon)
            btn.addEventListener("click", (e) => {
                e.stopPropagation()
                onActionRef.current?.(noteId, a.action)
            })
            wrap.appendChild(btn)
        }
        return wrap
    }
}

// A Tabulator header menu: one toggle entry per hideable column. Passed as each
// column definition's `headerMenu`, which Tabulator calls every time the menu
// opens, so `tableRef.current` is populated by then and the check marks reflect
// live visibility. Bound to a ref rather than the table instance directly since
// the column definitions are built before the table exists.
function makeHeaderMenu(tableRef) {
    return () => {
        const table = tableRef.current
        if (!table) return []
        return COLUMN_DEFS.filter(c => c.hideable).map(col => ({
            label: (table.getColumn(col.field)?.isVisible() ? CHECK : BLANK) + col.title,
            action: (e) => {
                e.stopPropagation()
                table.getColumn(col.field).toggle()
            }
        }))
    }
}

// Renders the "Title" cell with a left color dot driven by colorDict.
function titleFormatter(cell) {
    const color = cell.getRow().getData().color
    const text = document.createTextNode(cell.getValue() ?? "")
    if (!color) {
        const span = document.createElement("span")
        span.appendChild(text)
        return span
    }
    const wrap = document.createElement("span")
    wrap.className = "libagendatableview-title"
    const dot = document.createElement("span")
    dot.className = "libagendatableview-dot"
    dot.style.backgroundColor = color
    wrap.appendChild(dot)
    wrap.appendChild(text)
    return wrap
}

// Builds a single Tabulator row object from a frontend note. `color` (from
// colorDict, keyed by note id) drives the title-cell accent; child notes have
// no entry there so their dot is simply absent.
function buildRow(note, titles, colorDict, constants) {
    const row = {
        id: note.noteId,
        title: titles?.[note.noteId] ?? note.title,
        color: colorDict?.[note.noteId] || ""
    }
    for (const col of COLUMN_DEFS) {
        if (col.label) row[col.field] = note.getLabelValue(constants[col.label]) || ""
    }
    return row
}

// Recursively expands a note into a row plus a `_children` array of its child
// notes' rows, so Tabulator's dataTree can render them as expandable sub-rows.
// A visited set guards against cycles from cloned notes. Child cells are read
// from the child note's own labels; child notes aren't in titles/colorDict, so
// buildRow falls back to the note's real title and no color.
async function buildRowTree(note, titles, colorDict, constants, visited) {
    const row = buildRow(note, titles, colorDict, constants)
    const children = await note.getChildNotes()
    const childRows = []
    for (const child of children) {
        if (visited.has(child.noteId)) continue
        visited.add(child.noteId)
        childRows.push(await buildRowTree(child, titles, colorDict, constants, visited))
    }
    if (childRows.length > 0) row._children = childRows
    return row
}

// Turns a sorted note-id list into Tabulator row objects. Each top-level row
// carries the note id (as the Tabulator index), one cell per column read from
// the note's labels, and a `_children` tree of that note's descendant notes.
async function buildRows(noteIds, titles, colorDict, constants) {
    const notes = await Promise.all(noteIds.map(noteId => api.getNote(noteId)))
    return Promise.all(notes.map(note =>
        buildRowTree(note, titles, colorDict, constants, new Set([note.noteId]))))
}

// Renders a sortable, column-toggleable table over a flat, already-sorted
// task-note-id list.
//   - noteIds/titles/colorDict/constants: same shape the other agenda views get
//   - columnState: persisted { visible: {field: bool}, sort: [{column, dir}] };
//     null/undefined falls back to each column's defaultVisible and no sort
//   - onColumnState(state): called when the user toggles a column or re-sorts,
//     with the new state to persist
//   - onRowClick(noteId): row activation
//   - onAction(noteId, action): an Actions-column button was clicked; `action`
//     is one of "complete" | "today" | "tomorrow" (see ROW_ACTIONS)
export function TableView({ noteIds, titles, colorDict, constants, columnState, onColumnState, onRowClick, onAction }) {
    const containerRef = useRef(null)
    const tableRef = useRef(null)
    const [loaded, setLoaded] = useState(false)
    const [rows, setRows] = useState(null)

    // Keep the latest callbacks/state in refs so the Tabulator event handlers
    // (bound once at table-build time) always see current values without
    // forcing a full table rebuild.
    const onColumnStateRef = useRef(onColumnState)
    const onRowClickRef = useRef(onRowClick)
    const onActionRef = useRef(onAction)
    const columnStateRef = useRef(columnState)
    onColumnStateRef.current = onColumnState
    onRowClickRef.current = onRowClick
    onActionRef.current = onAction
    columnStateRef.current = columnState

    useEffect(() => {
        let cancelled = false
        loadTabulator().then(() => { if (!cancelled) setLoaded(true) })
        return () => { cancelled = true }
    }, [])

    useEffect(() => {
        if (!noteIds) { setRows(null); return }
        let cancelled = false
        buildRows(noteIds, titles, colorDict, constants).then(r => { if (!cancelled) setRows(r) })
        return () => { cancelled = true }
    }, [noteIds, titles, colorDict, constants])

    useEffect(() => {
        if (!loaded || !containerRef.current || !rows) return

        const state = columnStateRef.current || {}
        const visible = state.visible || {}
        const savedSort = Array.isArray(state.sort) ? state.sort : []
        const headerMenu = makeHeaderMenu(tableRef)
        const actionsFormatter = makeActionsFormatter(onActionRef)

        const columns = COLUMN_DEFS.map(col => {
            const isVisible = (col.field in visible) ? !!visible[col.field] : col.defaultVisible
            return {
                title: col.title,
                field: col.field,
                visible: col.hideable ? isVisible : true,
                headerMenu: col.hideable ? headerMenu : undefined,
                formatter: col.field === "title" ? titleFormatter : undefined
            }
        })

        // Always-visible, non-hideable Actions column. Not a data field, so it
        // isn't sortable and carries no header menu; width is content-sized.
        columns.push({
            title: "Actions",
            field: "_actions",
            headerSort: false,
            hozAlign: "center",
            width: 120,
            formatter: actionsFormatter
        })

        const table = new window.Tabulator(containerRef.current, {
            data: rows,
            index: "id",
            columns,
            layout: "fitColumns",
            // Render each note's child notes as expandable sub-rows. The toggle
            // control lives in the always-visible, non-hideable title column.
            dataTree: true,
            dataTreeChildField: "_children",
            dataTreeStartExpanded: false,
            dataTreeElementColumn: "title",
            initialSort: savedSort
                .filter(s => COLUMN_DEFS.some(c => c.field === s.column))
                .map(s => ({ column: s.column, dir: s.dir === "desc" ? "desc" : "asc" }))
        })
        tableRef.current = table

        function emitState() {
            if (!onColumnStateRef.current) return
            const vis = {}
            for (const col of COLUMN_DEFS) {
                if (col.hideable) vis[col.field] = table.getColumn(col.field).isVisible()
            }
            const sort = table.getSorters().map(s => ({ column: s.field, dir: s.dir }))
            onColumnStateRef.current({ visible: vis, sort })
        }

        table.on("columnVisibilityChanged", emitState)
        table.on("dataSorted", () => {
            // dataSorted fires on the initial build too; only persist real user
            // re-sorts, once the table is up.
            if (table.initialized) emitState()
        })
        table.on("rowClick", (e, row) => {
            if (onRowClickRef.current) onRowClickRef.current(row.getData().id)
        })

        return () => {
            table.destroy()
            tableRef.current = null
        }
    }, [loaded, rows])

    if (!noteIds || noteIds.length === 0) {
        return <div className="libagendatableview-empty">No tasks.</div>
    }

    return <div ref={containerRef} className="libagendatableview" />
}
