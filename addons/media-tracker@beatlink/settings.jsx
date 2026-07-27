import { useState, useEffect, NoteAutocomplete } from "trilium:preact"
import { activateNote } from "trilium:api"
import { SettingsForm, loadSettings, saveSettings } from "libSettingsUI.jsx"

// The icon stamped on the note that hosts the tracker UI.
const LIBRARY_ICON = "bx bx-movie-play"

const ENDPOINT = "custom/mediaTracker"

async function callBackend(action, params = {}) {
    const search = new URLSearchParams({ action, ...params })
    const res = await fetch(`${ENDPOINT}?${search}`, { credentials: "same-origin" })
    let body
    try { body = await res.json() } catch (e) { body = { error: `HTTP ${res.status}` } }
    if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`)
    return body
}

// Point `noteId` at the tracker: make it a render note whose ~renderNote relation
// targets the widget code note (found by #mediaTrackerRender), and stamp its icon.
// Revert `previousNoteId` (if different) back to a plain text note, so switching
// roots never leaves an orphaned render note behind.
// Runs on the backend — the closure may reference only `api`.
async function reconcileLibraryNote(noteId, previousNoteId, icon) {
    return api.runOnBackend((noteId, previousNoteId, icon) => {
        // The widget note carries #mediaTrackerRender. An install predating that
        // label won't have it until the addon is updated in TAM, so fall back to
        // the note's title rather than silently leaving the root unwired.
        const srcResults = api.searchForNotes("#mediaTrackerRender")
        const found = srcResults[0] || api.searchForNotes('note.title = "mediaTracker.jsx"')[0]
        const srcId = found ? found.noteId : ""

        if (previousNoteId && previousNoteId !== noteId) {
            const prev = api.getNote(previousNoteId)
            if (prev) {
                prev.removeRelation("renderNote")
                if (prev.getLabelValue("iconClass") === icon) prev.removeLabel("iconClass")
                if (prev.type === "render") {
                    prev.type = "text"
                    prev.save()
                }
            }
        }

        if (!noteId) return { ok: true, cleared: true }
        if (!srcId) return { ok: false, reason: "no-render-source" }

        const note = api.getNote(noteId)
        if (!note || note.isDeleted) return { ok: false, reason: "note-not-found" }

        if (note.type !== "render") {
            note.type = "render"
            note.save()
        }
        // TAM renames activation attributes to `disabled:<name>` while an addon
        // is disabled, and ~renderNote is one of them. Clear that stale copy so
        // the note doesn't end up carrying both spellings.
        if (note.getRelationValue("disabled:renderNote")) note.removeRelation("disabled:renderNote")
        if (note.getRelationValue("renderNote") !== srcId) note.setRelation("renderNote", srcId)
        if (note.getLabelValue("iconClass") !== icon) note.setLabel("iconClass", icon)

        // Report what the note actually looks like now, so the UI can confirm
        // the wiring landed instead of assuming it did.
        return {
            ok: note.type === "render" && note.getRelationValue("renderNote") === srcId,
            type: note.type,
            renderNote: note.getRelationValue("renderNote"),
            srcId
        }
    }, [noteId, previousNoteId, icon])
}

// The Library Root picker: selecting a note wires it as the tracker's render
// surface (and reverts the previously-selected one). Persisted as
// libraryRootNoteId in this addon's own settings note.
function LibraryRootPicker({ schemaNoteId, configNoteId, initialNoteId }) {
    const [noteId, setNoteId] = useState(initialNoteId || "")
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)

    function describe(result) {
        if (!result) return { error: "Wiring did not run." }
        if (result.cleared) return { ok: "Cleared. The previous note was reverted to a text note." }
        if (result.reason === "no-render-source") {
            return {
                error: "Could not find the tracker widget note. Make sure media-tracker is enabled " +
                    "in TAM, then apply again."
            }
        }
        if (result.reason === "note-not-found") return { error: "That note no longer exists." }
        if (!result.ok) return { error: `Wiring failed (type is "${result.type}").` }
        return { ok: "Wired. Open the note to see the tracker." }
    }

    async function wire(targetNoteId, previous) {
        setBusy(true)
        setStatus(null)
        try {
            const values = await loadSettings(schemaNoteId, configNoteId)
            values.libraryRootNoteId = targetNoteId || ""
            await saveSettings(schemaNoteId, configNoteId, values)
            setStatus(describe(await reconcileLibraryNote(targetNoteId || "", previous, LIBRARY_ICON)))
        } catch (e) {
            setStatus({ error: String(e && e.message ? e.message : e) })
        } finally {
            setBusy(false)
        }
    }

    async function onPick(newNoteId) {
        if (busy || newNoteId === noteId) return
        const previous = noteId
        setNoteId(newNoteId || "")
        await wire(newNoteId, previous)
    }

    return (
        <div>
            <div className="lst-field-row" title="The note that holds your tracked titles and displays the tracker. Selecting it converts that note into a render note pointing at the tracker widget.">
                <label>Library Root</label>
                <NoteAutocomplete noteId={noteId} noteIdChanged={onPick} />
            </div>
            <p class="mt-hint">
                Every tracked title is created as a child of this note, and the note itself becomes
                the tracker UI. Clearing it reverts the previously-chosen note back to a text note.
            </p>
            {/* Re-runs the wiring on the note already selected. Needed because
                picking the same note again is a no-op, so a root that was set
                while the addon was disabled (or before it wired roots at all)
                would otherwise have no way to get fixed. */}
            <button class="mt-btn" disabled={busy || !noteId} onClick={() => wire(noteId, "")}>
                Apply render wiring
            </button>
            {status?.ok && <p class="mt-ok">{status.ok}</p>}
            {status?.error && <p class="mt-error">{status.error}</p>}
        </div>
    )
}

// Which genres appear in the Library's genre filter. Genres come from TMDB, so
// this lists whatever the library actually contains rather than a fixed
// vocabulary -- and it shows hidden ones too, since they must remain un-hideable.
function GenrePanel({ disabled = false }) {
    const [genres, setGenres] = useState(null)
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)

    const load = async () => {
        try {
            const { genres } = await callBackend("listAllGenres")
            setGenres(genres)
        } catch (e) {
            setError(e.message)
        }
    }

    useEffect(() => { load() }, [])

    const save = async (rows) => {
        setBusy(true)
        setGenres(rows)
        try {
            await callBackend("setHiddenGenres", {
                hiddenGenres: rows.filter(g => g.hidden).map(g => g.name).join(", ")
            })
        } catch (e) {
            setError(e.message)
        } finally {
            setBusy(false)
        }
    }

    const toggle = (name) => save(genres.map(g =>
        g.name === name ? { ...g, hidden: !g.hidden } : g
    ))

    const setAll = (hidden) => save(genres.map(g => ({ ...g, hidden })))

    if (error) return <p class="mt-error">{error}</p>
    if (!genres) return <p class="mt-hint">Loading genres...</p>

    // The panel stays reachable when genres are off so the list isn't lost, but
    // it says so rather than looking broken.
    if (disabled) {
        return (
            <p class="mt-hint">
                Genres are switched off in <strong>Library → Enable Genres</strong>. Turn that back
                on to use the genre filter; your selections here are kept in the meantime.
            </p>
        )
    }

    if (genres.length === 0) {
        return (
            <p class="mt-hint">
                No genres yet. Genres come from TMDB — add or import some titles, then use
                <strong> Refresh </strong> on the Library tab to fetch their metadata.
            </p>
        )
    }

    const shown = genres.filter(g => !g.hidden).length

    return (
        <div>
            <p class="mt-hint">
                Ticked genres appear as filter pills on the Library tab. Unticking one only hides it
                from that filter — it never changes a title's data. {shown} of {genres.length} shown.
            </p>
            <div class="mt-toolbar">
                <button class="mt-btn" disabled={busy} onClick={() => setAll(false)}>Show all</button>
                <button class="mt-btn" disabled={busy} onClick={() => setAll(true)}>Hide all</button>
            </div>
            <div class="mt-tag-list mt-genre-list">
                {genres.map(g => (
                    <label class="mt-tag-option" key={g.name}>
                        <input
                            type="checkbox"
                            checked={!g.hidden}
                            disabled={busy}
                            onChange={() => toggle(g.name)}
                        />
                        {g.name}
                    </label>
                ))}
            </div>
        </div>
    )
}

// Collection groups: named axes (Mood, Franchise, ...) that each become their own
// filter dropdown on the Library tab. Groups live here rather than on the titles,
// so regrouping never rewrites a single title.
const UNGROUPED = "Other"

function CollectionGroupPanel() {
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)
    const [newGroup, setNewGroup] = useState("")

    const load = async () => {
        try {
            setData(await callBackend("collectionGroups"))
        } catch (e) {
            setError(e.message)
        }
    }

    useEffect(() => { load() }, [])

    const save = async (groups, assign) => {
        setBusy(true)
        try {
            // The save returns the state it just wrote. Using that instead of a
            // follow-up read avoids a read-after-write that could still see the
            // note's previous content, which made assignments revert on reload.
            const saved = await callBackend("setCollectionGroups", {
                config: JSON.stringify({ groups, assign })
            })
            setData({ raw: saved.raw, groups: saved.groups, collections: saved.collections })
        } catch (e) {
            setError(e.message)
        } finally {
            setBusy(false)
        }
    }

    // The assignment map is rebuilt from the rendered rows each time, so it can
    // never drift from what is on screen.
    const currentAssign = (rows) => {
        const assign = {}
        for (const c of rows) {
            if (c.group && c.group !== UNGROUPED) assign[c.name] = c.group
        }
        return assign
    }

    const addGroup = () => {
        const name = newGroup.trim()
        if (!name) return
        setNewGroup("")
        if (data.groups.some(g => g.toLowerCase() === name.toLowerCase())) return
        save([...data.groups, name], currentAssign(data.collections))
    }

    const removeGroup = (group) => {
        // Collections in a removed group fall back to Other rather than vanishing.
        const assign = currentAssign(data.collections)
        for (const [name, g] of Object.entries(assign)) {
            if (g === group) delete assign[name]
        }
        save(data.groups.filter(g => g !== group), assign)
    }

    const assignTo = (collection, group) => {
        const assign = currentAssign(data.collections)
        if (group === UNGROUPED) delete assign[collection]
        else assign[collection] = group
        save(data.groups, assign)
    }

    if (error) return <p class="mt-error">{error}</p>
    if (!data) return <p class="mt-hint">Loading collections...</p>

    return (
        <div>
            <p class="mt-hint">
                Each group becomes its own filter dropdown on the Library tab. A collection with no
                group appears under <strong>{UNGROUPED}</strong>. Groups are just a way to organise
                the filters — no title is changed by regrouping.
            </p>

            {/* Shows exactly what is stored, so a save that appears to work but
                does not persist can be diagnosed rather than guessed at. */}
            <details class="mt-diag">
                <summary class="mt-hint">Stored configuration</summary>
                <pre class="mt-selectable">{data.raw ?? "(nothing stored yet)"}</pre>
            </details>

            <div class="mt-tag-edit">
                <input
                    class="mt-input"
                    placeholder="New group, e.g. Mood"
                    value={newGroup}
                    disabled={busy}
                    onInput={e => setNewGroup(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addGroup()}
                />
                <button class="mt-btn" disabled={busy || !newGroup.trim()}
                    onClick={addGroup}>Add group</button>
            </div>

            {data.groups.length > 0 && (
                <div class="mt-toolbar" style="margin-top: 8px; flex-wrap: wrap;">
                    {data.groups.map(g => (
                        <span class="mt-chip-group" key={g}>
                            <span class="mt-chip">{g}</span>
                            <button class="mt-btn mt-chip-action" disabled={busy}
                                title={`Remove the group "${g}"`}
                                onClick={() => removeGroup(g)}>×</button>
                        </span>
                    ))}
                </div>
            )}

            <h5 style="margin: 14px 0 6px;">Collections</h5>
            {data.collections.length === 0 ? (
                <p class="mt-hint">
                    No collections yet. Add one from any title's <strong>+ Add to collection</strong>
                    {" "}on the Library tab.
                </p>
            ) : (
                <div class="mt-tag-list mt-genre-list">
                    {data.collections.map(c => (
                        <div class="mt-tag-option" key={c.name}>
                            <span style="flex: 1; min-width: 0;">{c.name}</span>
                            <select class="mt-select" value={c.group} disabled={busy}
                                onChange={e => assignTo(c.name, e.target.value)}>
                                <option value={UNGROUPED}>{UNGROUPED}</option>
                                {data.groups.map(g => (
                                    <option key={g} value={g}>{g}</option>
                                ))}
                            </select>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

export default function MediaTrackerSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)
    const [libraryRootNoteId, setLibraryRootNoteId] = useState("")
    const [backNoteId, setBackNoteId] = useState("")
    const [genresDisabled, setGenresDisabled] = useState(false)
    const [ready, setReady] = useState(false)

    useEffect(() => {
        (async () => {
            const schema = await api.currentNote.getRelationValue("schemaNote")
            const target = await api.currentNote.getRelationTarget("configNote")
            setSchemaNoteId(schema)
            setConfigNoteId(target.noteId)
            const values = await loadSettings(schema, target.noteId)
            setLibraryRootNoteId(values.libraryRootNoteId || "")
            setGenresDisabled(values.genresEnabled === false)

            // Prefer the note the user actually came from (recorded by the
            // tracker's Settings button), then the library root, then the
            // launcher -- so Back works however this page was reached.
            let returnTo = ""
            try {
                returnTo = sessionStorage.getItem("mediaTracker:returnTo") || ""
            } catch (e) {
                // sessionStorage unavailable; fall through to the relations.
            }
            setBackNoteId(
                returnTo
                || values.libraryRootNoteId
                || await api.currentNote.getRelationValue("trackerPageNote")
                || ""
            )
            setReady(true)
        })()
    }, [])

    if (!ready) return <div>Loading...</div>

    // The Library Root field is `hidden` in the schema so the form doesn't render
    // it twice — this panel owns it, because picking a note has side effects
    // beyond storing the id. It gets its own tab rather than joining "Library":
    // an extra panel sharing a schema tab's label replaces that tab's fields.
    const extraPanels = [
        {
            tab: "Library Root",
            render: () => (
                <LibraryRootPicker
                    schemaNoteId={schemaNoteId}
                    configNoteId={configNoteId}
                    initialNoteId={libraryRootNoteId}
                />
            )
        },
        {
            tab: "Collections",
            render: () => <CollectionGroupPanel />
        },
        {
            tab: "Genres",
            render: () => <GenrePanel disabled={genresDisabled} />
        }
    ]

    return (
        <div class="mt-settings">
            <div class="mt-settings-head">
                <button class="mt-btn" disabled={!backNoteId} title="Back to the tracker"
                    onClick={() => activateNote(backNoteId)}>
                    &lsaquo; Back
                </button>
                <h3>Media Tracker</h3>
            </div>
            <p class="mt-hint">
                A TMDB key powers search, posters, and episode lists. Trakt and Stremio are
                optional one-way import sources: they are read, never written to.
            </p>
            <SettingsForm
                schemaNoteId={schemaNoteId}
                configNoteId={configNoteId}
                extraPanels={extraPanels}
            />
        </div>
    )
}
