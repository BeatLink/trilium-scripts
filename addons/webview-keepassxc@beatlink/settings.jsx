import { SettingsPage, resolveConfigNotes, loadSettings } from "libSettingsUI.jsx"
import { useState, useEffect, Admonition, Button, LoadingSpinner } from "trilium:preact"

// The connection state as a sentence plus the admonition tone that fits it —
// only a live, unlocked, associated database is not something to act on.
function describe(state) {
    if (!state.available) return ["warning", `KeePassXC is not answering: ${state.error}`]
    if (state.locked) return ["warning", `KeePassXC ${state.version} is running, but its database is locked.`]
    if (state.associated) return ["note", `Connected to KeePassXC ${state.version}, database ${state.hash.slice(0, 12)}…`]
    return ["warning", `KeePassXC ${state.version} is running with a database open, but this Trilium is not associated with it yet.`]
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

    const [tone, message] = state ? describe(state) : []

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "640px" }}>
            <p style={{ margin: 0 }}>
                Connecting registers this Trilium with the database that is currently open. KeePassXC will ask
                you to name the association, and that name is what you will see in its
                <b> Database → Database Settings → Browser Integration</b> list. Do it once per database; unlock
                the database first.
            </p>
            {state
                ? <Admonition type={tone}>{message}</Admonition>
                : <p style={{ margin: 0 }}><LoadingSpinner /> Checking…</p>}
            <div style={{ display: "flex", gap: "8px" }}>
                <Button
                    kind="primary" icon="bx-link" text="Connect"
                    onClick={() => run("Connecting…", (lib, noteId, socketPath) => lib.associate(noteId, socketPath))}
                />
                <Button
                    icon="bx-refresh" text="Refresh"
                    onClick={() => run("Checking…", () => {})}
                />
                <Button
                    icon="bx-trash" text="Forget associations"
                    onClick={() => run("Forgetting…", (lib, noteId) => lib.forget(noteId))}
                />
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
