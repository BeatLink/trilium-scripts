import { useState, useEffect, NoteAutocomplete } from "trilium:preact"
import { activateNote } from "trilium:api"
import { SettingsForm, loadSettings, saveSettings } from "libSettingsUI.jsx"

// The icon stamped on the note that hosts the tracker UI.
const LIBRARY_ICON = "bx bx-joystick"

const ENDPOINT = "custom/gameTracker"

async function callBackend(action, params = {}) {
    const search = new URLSearchParams({ action, ...params })
    const res = await fetch(`${ENDPOINT}?${search}`, { credentials: "same-origin" })
    let body
    try { body = await res.json() } catch (e) { body = { error: `HTTP ${res.status}` } }
    if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`)
    return body
}

// Point `noteId` at the tracker: make it a render note whose ~renderNote relation
// targets the widget code note (found by #gameTrackerRender), and stamp its icon.
// Revert `previousNoteId` (if different) back to a plain text note, so switching
// roots never leaves an orphaned render note behind.
// Runs on the backend — the closure may reference only `api`.
async function reconcileLibraryNote(noteId, previousNoteId, icon) {
    return api.runOnBackend((noteId, previousNoteId, icon) => {
        // The widget note carries #gameTrackerRender. An install predating that
        // label won't have it until the addon is updated in TAM, so fall back to
        // the note's title rather than silently leaving the root unwired.
        const srcResults = api.searchForNotes("#gameTrackerRender")
        const found = srcResults[0] || api.searchForNotes('note.title = "gameTracker.jsx"')[0]
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
                error: "Could not find the tracker widget note. Make sure game-tracker is enabled " +
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
            <div className="lst-field-row" title="The note that holds your tracked games and displays the tracker. Selecting it converts that note into a render note pointing at the tracker widget.">
                <label>Library Root</label>
                <NoteAutocomplete noteId={noteId} noteIdChanged={onPick} />
            </div>
            <p class="gt-hint">
                Every tracked game is created as a child of this note, and the note itself becomes
                the tracker UI. Clearing it reverts the previously-chosen note back to a text note.
            </p>
            {/* The tracker reads this value back through a different path than
                the one that saves it here (widget -> settingsNote -> configNote,
                versus this page's own configNote relation). If the two ever
                resolve to different notes, a root saved here reads back as unset
                over there -- so name the note being written to, for comparison
                with the id the tracker reports. */}
            <details class="gt-diag">
                <summary class="gt-hint">Where is this saved?</summary>
                <p class="gt-hint">
                    Config note <code class="gt-code gt-selectable">{configNoteId || "unknown"}</code>.
                    If the tracker still says no library root is set, check that it reports the same
                    id — a mismatch means the addon needs reinstalling in TAM.
                </p>
            </details>
            {/* Re-runs the wiring on the note already selected. Needed because
                picking the same note again is a no-op, so a root that was set
                while the addon was disabled (or before it wired roots at all)
                would otherwise have no way to get fixed. */}
            <button class="gt-btn" disabled={busy || !noteId} onClick={() => wire(noteId, "")}>
                Apply render wiring
            </button>
            {status?.ok && <p class="gt-ok">{status.ok}</p>}
            {status?.error && <p class="gt-error">{status.error}</p>}
        </div>
    )
}

// Converts a Steam profile name or URL into the SteamID64 the API needs.
// Steam's own UI shows people a vanity URL, not the numeric id, so asking for
// the id without offering this is asking most users for something they'd have to
// go find on a third-party site.
function SteamIdPanel({ schemaNoteId, configNoteId }) {
    const [input, setInput] = useState("")
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)
    const [current, setCurrent] = useState("")

    useEffect(() => {
        (async () => {
            const values = await loadSettings(schemaNoteId, configNoteId)
            setCurrent(values.steamId || "")
        })()
    }, [])

    const lookup = async () => {
        setBusy(true)
        setStatus(null)
        try {
            const { steamId, resolved } = await callBackend("steamResolveVanity", { input })
            const values = await loadSettings(schemaNoteId, configNoteId)
            values.steamId = steamId
            await saveSettings(schemaNoteId, configNoteId, values)
            setCurrent(steamId)
            setInput("")
            setStatus({
                ok: resolved
                    ? `Resolved to ${steamId} and saved.`
                    : `Saved ${steamId}.`
            })
        } catch (e) {
            setStatus({ error: e.message })
        } finally {
            setBusy(false)
        }
    }

    const verify = async () => {
        setBusy(true)
        setStatus(null)
        try {
            const r = await callBackend("steamCheck")
            setStatus({ ok: `Connected: ${r.total} games owned, ${r.played} played.` })
        } catch (e) {
            setStatus({ error: e.message })
        } finally {
            setBusy(false)
        }
    }

    return (
        <div>
            <p class="gt-hint">
                The Steam Web API needs a <strong>SteamID64</strong> — a 17-digit number, not the
                profile name you see in Steam. Paste your profile URL or vanity name here and it
                will be converted and saved. Requires the API key to already be set.
            </p>
            <div class="gt-tag-edit">
                <input
                    class="gt-input"
                    placeholder="https://steamcommunity.com/id/yourname or just yourname"
                    value={input}
                    disabled={busy}
                    onInput={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && input.trim() && lookup()}
                />
                <button class="gt-btn" disabled={busy || !input.trim()} onClick={lookup}>
                    Look up
                </button>
            </div>
            <p class="gt-hint">
                Current SteamID64: {current
                    ? <code class="gt-code gt-selectable">{current}</code>
                    : "not set"}
            </p>
            <button class="gt-btn" disabled={busy || !current} onClick={verify}>
                Check connection
            </button>
            <p class="gt-hint">
                A working key and id can still return nothing if the profile is private: set
                Steam → Profile → Privacy Settings → <strong>Game details</strong> to Public.
            </p>
        </div>
    )
}

// Explains what a status's Role is for. Worth stating plainly on the tab
// itself: the registry editor shows a "Role" dropdown with no obvious meaning,
// and getting it wrong is what makes imports behave oddly later.
function StatusHelp() {
    return (
        <div>
            <p class="gt-hint">
                Add, rename, recolour, reorder, or remove statuses freely. A game stores the
                status <em>id</em>, not its name, so renaming one never touches your library.
            </p>
            <p class="gt-hint">
                Each status has a <strong>Role</strong>, which is how imports know what it means
                without depending on its name. Rename <em>Beaten</em> to <em>Finished</em>, or add
                your own <em>Wishlist</em> alongside <em>Backlog</em>, and imports keep working.
                Several statuses can share a role — the first one in your order wins when an import
                needs to pick. Give a status the role <strong>None</strong> to make it manual-only,
                so no import ever sets it automatically.
            </p>
            <p class="gt-hint">
                Removing a status never changes a game that still holds it. Those games keep it,
                the tracker shows it marked <em>(removed)</em>, and you can reassign them whenever
                you like.
            </p>
        </div>
    )
}

// Which status a hand-added game gets. A `reference`-style picker rather than a
// schema `select`, because the options are the user's own statuses and so
// cannot be enumerated in schema.json.
function DefaultStatusPicker({ schemaNoteId, configNoteId }) {
    const [statuses, setStatuses] = useState(null)
    const [chosen, setChosen] = useState("")
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)

    const load = async () => {
        try {
            const values = await loadSettings(schemaNoteId, configNoteId)
            const { statuses } = await callBackend("listStatuses")
            setStatuses(statuses)
            setChosen(values.defaultStatusId || "")
        } catch (e) {
            setStatus({ error: e.message })
        }
    }

    useEffect(() => { load() }, [])

    const save = async (value) => {
        setBusy(true)
        setChosen(value)
        try {
            const values = await loadSettings(schemaNoteId, configNoteId)
            values.defaultStatusId = value
            await saveSettings(schemaNoteId, configNoteId, values)
            setStatus({ ok: "Saved." })
        } catch (e) {
            setStatus({ error: e.message })
        } finally {
            setBusy(false)
        }
    }

    if (status?.error) return <p class="gt-error">{status.error}</p>
    if (!statuses) return <p class="gt-hint">Loading statuses...</p>

    return (
        <div>
            <div className="lst-field-row">
                <label>Status For New Games</label>
                <select class="gt-select" value={chosen} disabled={busy}
                    onChange={e => save(e.target.value)}>
                    {/* Blank means "decide from roles", which keeps working even
                        if the chosen status is later removed. */}
                    <option value="">First backlog status (automatic)</option>
                    {statuses.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
            </div>
            <p class="gt-hint">
                Applied to a game added by hand from search. Imports choose by role instead.
                Leave this automatic and it always follows your first Backlog-role status, even
                if you reorganise your statuses later.
            </p>
            {status?.ok && <p class="gt-ok">{status.ok}</p>}
        </div>
    )
}

// Which genres appear in the Library's genre filter. Genres come from IGDB, so
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

    if (error) return <p class="gt-error">{error}</p>
    if (!genres) return <p class="gt-hint">Loading genres...</p>

    // The panel stays reachable when genres are off so the list isn't lost, but
    // it says so rather than looking broken.
    if (disabled) {
        return (
            <p class="gt-hint">
                Genres are switched off in <strong>Library → Enable Genres</strong>. Turn that back
                on to use the genre filter; your selections here are kept in the meantime.
            </p>
        )
    }

    if (genres.length === 0) {
        return (
            <p class="gt-hint">
                No genres yet. Genres come from IGDB — add or import some games, then use
                <strong> Refresh </strong> on the Library tab to fetch their metadata.
            </p>
        )
    }

    const shown = genres.filter(g => !g.hidden).length

    return (
        <div>
            <p class="gt-hint">
                Ticked genres appear in the Library's genre filter. Unticking one only hides it
                from that filter — it never changes a game's data. {shown} of {genres.length} shown.
            </p>
            <div class="gt-toolbar">
                <button class="gt-btn" disabled={busy} onClick={() => setAll(false)}>Show all</button>
                <button class="gt-btn" disabled={busy} onClick={() => setAll(true)}>Hide all</button>
            </div>
            <div class="gt-tag-list gt-genre-list">
                {genres.map(g => (
                    <label class="gt-tag-option" key={g.name}>
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

// Collection groups: named axes (Series, Mood, ...) that each become their own
// filter dropdown on the Library tab. Groups live here rather than on the games,
// so regrouping never rewrites a single game.
const UNGROUPED = "Ungrouped"

function CollectionGroupPanel() {
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)
    const [newGroup, setNewGroup] = useState("")
    // Text pending in each group's "add collection" box, keyed by group name.
    const [newInGroup, setNewInGroup] = useState({})

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
        // Collections in a removed group fall back to Ungrouped rather than vanishing.
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

    // Creates a collection directly inside a group. It exists as an assignment
    // straight away, so it shows up in that group's filter dropdown before any
    // game uses it.
    const addToGroup = (group) => {
        const name = (newInGroup[group] || "").trim()
        if (!name) return
        setNewInGroup({ ...newInGroup, [group]: "" })

        const assign = currentAssign(data.collections)
        // Reuse an existing name in any casing rather than making a twin.
        const existing = data.collections.find(c => c.name.toLowerCase() === name.toLowerCase())
        assign[existing ? existing.name : name] = group
        save(data.groups, assign)
    }

    if (error) return <p class="gt-error">{error}</p>
    if (!data) return <p class="gt-hint">Loading collections...</p>

    return (
        <div>
            <p class="gt-hint">
                Each group becomes its own filter dropdown on the Library tab. A collection with no
                group appears under <strong>{UNGROUPED}</strong>. Groups are just a way to organise
                the filters — no game is changed by regrouping.
            </p>

            {/* Shows exactly what is stored, so a save that appears to work but
                does not persist can be diagnosed rather than guessed at. */}
            <details class="gt-diag">
                <summary class="gt-hint">Stored configuration</summary>
                <pre class="gt-selectable">{data.raw ?? "(nothing stored yet)"}</pre>
            </details>

            <div class="gt-tag-edit">
                <input
                    class="gt-input"
                    placeholder="New group, e.g. Series"
                    value={newGroup}
                    disabled={busy}
                    onInput={e => setNewGroup(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addGroup()}
                />
                <button class="gt-btn" disabled={busy || !newGroup.trim()}
                    onClick={addGroup}>Add group</button>
            </div>

            {/* Collections are listed under the group they belong to, each group
                with its own box to add one directly. A collection can still be
                moved between groups with its dropdown. */}
            {data.groups.map(group => {
                const members = data.collections.filter(c => c.group === group)
                return (
                    <div class="gt-group-section" key={group}>
                        <div class="gt-group-section-head">
                            <strong>{group}</strong>
                            <button class="gt-btn gt-chip-action" disabled={busy}
                                title={`Remove the group "${group}"`}
                                onClick={() => removeGroup(group)}>×</button>
                        </div>

                        {members.length === 0 ? (
                            <p class="gt-hint">No collections in this group yet.</p>
                        ) : (
                            <div class="gt-tag-list">
                                {members.map(c => (
                                    <div class="gt-tag-option" key={c.name}>
                                        <span style="flex: 1; min-width: 0;">
                                            {c.name}
                                            {!c.inUse && <span class="gt-hint"> (unused)</span>}
                                        </span>
                                        <select class="gt-select" value={c.group} disabled={busy}
                                            onChange={e => assignTo(c.name, e.target.value)}>
                                            {data.groups.map(g => (
                                                <option key={g} value={g}>{g}</option>
                                            ))}
                                            <option value={UNGROUPED}>{UNGROUPED}</option>
                                        </select>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div class="gt-tag-edit">
                            <input
                                class="gt-input"
                                placeholder={`New ${group} collection`}
                                value={newInGroup[group] || ""}
                                disabled={busy}
                                onInput={e => setNewInGroup({ ...newInGroup, [group]: e.target.value })}
                                onKeyDown={e => e.key === "Enter" && addToGroup(group)}
                            />
                            <button class="gt-btn"
                                disabled={busy || !(newInGroup[group] || "").trim()}
                                onClick={() => addToGroup(group)}>Add</button>
                        </div>
                    </div>
                )
            })}

            {/* Strays: created before groups existed, or left behind when a group
                was removed. Omitted entirely when there are none. */}
            {data.collections.some(c => c.group === UNGROUPED) && (
                <div class="gt-group-section">
                    <div class="gt-group-section-head"><strong>{UNGROUPED}</strong></div>
                    <p class="gt-hint">
                        Not in any group, so these don't appear as a filter. Pick a group to file them.
                    </p>
                    <div class="gt-tag-list">
                        {data.collections.filter(c => c.group === UNGROUPED).map(c => (
                            <div class="gt-tag-option" key={c.name}>
                                <span style="flex: 1; min-width: 0;">{c.name}</span>
                                <select class="gt-select" value={UNGROUPED} disabled={busy}
                                    onChange={e => assignTo(c.name, e.target.value)}>
                                    <option value={UNGROUPED}>{UNGROUPED}</option>
                                    {data.groups.map(g => (
                                        <option key={g} value={g}>{g}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

export default function GameTrackerSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)
    const [libraryRootNoteId, setLibraryRootNoteId] = useState("")
    const [backNoteId, setBackNoteId] = useState("")
    const [genresDisabled, setGenresDisabled] = useState(false)
    const [ready, setReady] = useState(false)
    const [loadError, setLoadError] = useState("")

    useEffect(() => {
        (async () => {
            // TAM renames activation attributes to `disabled:<name>` while an
            // addon is disabled, so both spellings are accepted. Without this a
            // disabled addon resolves nothing, loadSettings falls back to schema
            // defaults, and a saved Library Root reads back as empty -- which
            // looks exactly like never having set one.
            const schema = await api.currentNote.getRelationValue("schemaNote")
                || await api.currentNote.getRelationValue("disabled:schemaNote")
            const config = await api.currentNote.getRelationValue("configNote")
                || await api.currentNote.getRelationValue("disabled:configNote")

            if (!schema || !config) {
                setLoadError(
                    "This settings page has no schemaNote/configNote relation, so there is nowhere "
                    + "to read or save settings. That normally means game-tracker is installed but "
                    + "not enabled in TAM — enable it, then reload this page."
                )
                setReady(true)
                return
            }

            setSchemaNoteId(schema)
            setConfigNoteId(config)
            const values = await loadSettings(schema, config)
            setLibraryRootNoteId(values.libraryRootNoteId || "")
            setGenresDisabled(values.genresEnabled === false)

            // Prefer the note the user actually came from (recorded by the
            // tracker's Settings button), then the library root, then the
            // launcher -- so Back works however this page was reached.
            let returnTo = ""
            try {
                returnTo = sessionStorage.getItem("gameTracker:returnTo") || ""
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

    if (loadError) {
        return (
            <div class="gt-settings">
                <div class="gt-settings-head"><h3>Game Tracker</h3></div>
                <p class="gt-error">Settings could not be loaded.</p>
                <p class="gt-hint">{loadError}</p>
            </div>
        )
    }

    // An extra panel sharing a schema tab's label REPLACES that tab's fields
    // rather than appending to them, so a tab that needs both (the Library Root
    // picker plus the Library settings, the Steam ID lookup plus the Steam keys)
    // renders the schema fields itself with a nested `only`-scoped form and puts
    // the custom widget alongside. That is what keeps Library Root inside
    // "Library" and Steam ID inside "Steam" instead of each needing its own tab.
    const extraPanels = [
        {
            tab: "Library",
            render: () => (
                <div>
                    <LibraryRootPicker
                        schemaNoteId={schemaNoteId}
                        configNoteId={configNoteId}
                        initialNoteId={libraryRootNoteId}
                    />
                    <hr class="gt-rule" />
                    <SettingsForm
                        schemaNoteId={schemaNoteId}
                        configNoteId={configNoteId}
                        only="Library"
                    />
                </div>
            )
        },
        {
            tab: "Statuses",
            render: () => (
                <div>
                    <StatusHelp />
                    <SettingsForm
                        schemaNoteId={schemaNoteId}
                        configNoteId={configNoteId}
                        only="Statuses"
                    />
                    <hr class="gt-rule" />
                    <DefaultStatusPicker
                        schemaNoteId={schemaNoteId}
                        configNoteId={configNoteId}
                    />
                </div>
            )
        },
        {
            tab: "Steam",
            render: () => (
                <div>
                    <SettingsForm
                        schemaNoteId={schemaNoteId}
                        configNoteId={configNoteId}
                        only="Steam"
                    />
                    <hr class="gt-rule" />
                    <SteamIdPanel schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
                </div>
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
        <div class="gt-settings">
            <div class="gt-settings-head">
                <button class="gt-btn" disabled={!backNoteId} title="Back to the tracker"
                    onClick={() => activateNote(backNoteId)}>
                    &lsaquo; Back
                </button>
                <h3>Game Tracker</h3>
            </div>
            <p class="gt-hint">
                IGDB (via a free Twitch app) powers search, covers, and metadata. Steam is an
                optional one-way import source for your owned games and playtime: it is read,
                never written to.
            </p>
            <SettingsForm
                schemaNoteId={schemaNoteId}
                configNoteId={configNoteId}
                extraPanels={extraPanels}
            />
        </div>
    )
}
