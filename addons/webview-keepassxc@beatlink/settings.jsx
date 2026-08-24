import { SettingsPage, resolveConfigNotes, loadSettings } from "libSettingsUI.jsx"
import { useState, useEffect } from "trilium:preact"

const BUTTON = { border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", background: "#4b6fff", color: "white" }

function describe(state) {
    if (!state) return "Checking…"
    if (!state.available) return `KeePassXC is not answering: ${state.error}`
    if (state.locked) return `KeePassXC ${state.version} is running, but its database is locked.`
    if (state.associated) return `Connected to KeePassXC ${state.version}, database ${state.hash.slice(0, 12)}…`
    return `KeePassXC ${state.version} is running with a database open, but this Trilium is not associated with it yet.`
}

function ConnectionPanel() {
    const [state, setState] = useState(null)
    const [status, setStatus] = useState(null)

    async function refresh() {
        const lib = require("libWebViewKeePassXc.js")
        const noteId = await api.currentNote.getRelationValue("keyringNote")
        const { schemaNoteId, configNoteId } = await resolveConfigNotes(api.currentNote)
        const { socketPath } = await loadSettings(schemaNoteId, configNoteId)
        try {
            setState(await lib.status(noteId, socketPath))
        } catch (err) {
            setState({ available: false, error: err.message })
        }
    }

    useEffect(() => { refresh() }, [])

    async function run(what, action) {
        const lib = require("libWebViewKeePassXc.js")
        const noteId = await api.currentNote.getRelationValue("keyringNote")
        const { schemaNoteId, configNoteId } = await resolveConfigNotes(api.currentNote)
        const { socketPath } = await loadSettings(schemaNoteId, configNoteId)
        setStatus(what)
        try {
            await action(lib, noteId, socketPath)
            setStatus(null)
        } catch (err) {
            setStatus(`Failed: ${err.message}`)
            console.error("webview-keepassxc: connection action failed", err)
            return
        }
        await refresh()
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "640px" }}>
            <p style={{ margin: 0 }}>
                Connecting registers this Trilium with the database that is currently open. KeePassXC will ask
                you to name the association, and that name is what you will see in its
                <b> Database → Database Settings → Browser Integration</b> list. Do it once per database; unlock
                the database first.
            </p>
            <p style={{ margin: 0, color: "#666" }}>{describe(state)}</p>
            <div style={{ display: "flex", gap: "8px" }}>
                <button style={BUTTON} onClick={() => run("Connecting…", (lib, noteId, socketPath) => lib.associate(noteId, socketPath))}>
                    Connect
                </button>
                <button style={{ ...BUTTON, background: "#888" }} onClick={() => run("Checking…", () => {})}>
                    Refresh
                </button>
                <button style={{ ...BUTTON, background: "#b00" }} onClick={() => run("Forgetting…", (lib, noteId) => lib.forget(noteId))}>
                    Forget associations
                </button>
            </div>
            {status && <p style={{ margin: 0 }}>{status}</p>}
        </div>
    )
}

export default function WebViewKeePassXcSettings() {
    // `api.currentNote` must be read here, in this addon's own module — inside
    // libsettings it resolves to the library's note instead.
    return (
        <SettingsPage
            note={api.currentNote}
            extraPanels={[{ tab: "Connection", render: () => <ConnectionPanel /> }]}
        />
    )
}
