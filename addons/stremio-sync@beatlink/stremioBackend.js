/*
 * stremio-sync@beatlink — backend customRequestHandler ("stremioSync").
 *
 * A single HTTP endpoint (custom/stremioSync) routed by ?action=:
 *   login -> logs into api.strem.io with email/password, stores the returned authKey
 *   sync  -> fetches the full library (datastoreGet/libraryItem) and rewrites the
 *            target note as an HTML table of watch history
 *
 * Talks to the same public REST API Stremio's own clients use
 * (https://api.strem.io/api/...). Field names verified against the
 * Stremio/stremio-core Rust source (types/api/request.rs, types/library/library_item.rs).
 */

const { loadSettings, saveSettings } = require("libSettings.js")

const API_URL = "https://api.strem.io/api"

function getNoteIds() {
    const schemaNoteId = api.currentNote.getRelationValue("schemaNote")
    const settingsNoteId = api.currentNote.getRelationValue("settingsNote")
    const configNoteId = api.getNote(settingsNoteId).getRelationValue("configNote")
    return { schemaNoteId, configNoteId }
}

function getSettings() {
    const { schemaNoteId, configNoteId } = getNoteIds()
    return loadSettings(schemaNoteId, configNoteId)
}

function persistField(field, value) {
    const { schemaNoteId, configNoteId } = getNoteIds()
    const settings = loadSettings(schemaNoteId, configNoteId)
    settings[field] = value
    saveSettings(schemaNoteId, configNoteId, settings)
}

async function apiPost(path, body) {
    const res = await fetch(`${API_URL}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
    let json
    try { json = await res.json() } catch (e) { throw new Error(`HTTP ${res.status}`) }
    if (json.error) throw new Error(json.error.message || "Stremio API error")
    return json.result
}

async function login(email, password) {
    const result = await apiPost("login", { type: "Login", email, password })
    return result.authKey
}

async function fetchLibrary(authKey) {
    const result = await apiPost("datastoreGet", {
        authKey,
        collection: "libraryItem",
        ids: [],
        all: true,
    })
    return result || []
}

// --- note rendering ---------------------------------------------------------

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ))
}

function formatDate(iso) {
    if (!iso) return ""
    const d = new Date(iso)
    if (isNaN(d)) return ""
    return d.toISOString().slice(0, 10)
}

function progressPercent(item) {
    const { timeOffset, duration } = item.state
    if (timeOffset > 0 && duration > 0) return Math.round((timeOffset / duration) * 100)
    return 0
}

function renderTable(items) {
    const rows = items
        .filter(i => !i.removed && i.type !== "other")
        .sort((a, b) => new Date(b.state.lastWatched || 0) - new Date(a.state.lastWatched || 0))
        .map(i => `<tr>
            <td>${escapeHtml(i.name)}</td>
            <td>${escapeHtml(i.type)}</td>
            <td>${formatDate(i.state.lastWatched)}</td>
            <td>${progressPercent(i)}%</td>
            <td>${i.state.timesWatched}</td>
        </tr>`)
        .join("\n")

    return `<p>Last synced: ${new Date().toISOString().slice(0, 19).replace("T", " ")}</p>
<table>
<thead><tr><th>Title</th><th>Type</th><th>Last Watched</th><th>Progress</th><th>Times Watched</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`
}

function writeTargetNote(targetNoteId, items) {
    if (!targetNoteId) throw new Error("Set 'Sync Into Note' in Settings first")
    const note = api.getNote(targetNoteId)
    if (!note) throw new Error("Target note not found")
    note.setContent(renderTable(items))
}

// --- routing ---------------------------------------------------------------

function sendJson(status, obj) {
    api.res.status(status).json(obj)
}

async function handle() {
    const action = api.req.query.action

    try {
        const settings = getSettings()

        if (action === "login") {
            if (!settings.email || !settings.password) throw new Error("Set Stremio email and password in Settings first")
            const authKey = await login(settings.email, settings.password)
            persistField("authKey", authKey)
            return sendJson(200, { ok: true })
        }

        if (action === "sync") {
            if (!settings.authKey) throw new Error("Not logged in. Click Login first.")
            const items = await fetchLibrary(settings.authKey)
            writeTargetNote(settings.targetNoteId, items)
            return sendJson(200, { ok: true, count: items.length })
        }

        return sendJson(400, { error: `Unknown action: ${action}` })
    } catch (e) {
        return sendJson(500, { error: e.message })
    }
}

handle()
