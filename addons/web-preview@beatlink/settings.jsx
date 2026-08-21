import { SettingsPage } from "libSettingsUI.jsx"
import { useState } from "trilium:preact"

const BUTTON = { border: "none", borderRadius: "6px", padding: "6px 14px", cursor: "pointer", background: "#4b6fff", color: "white" }
const PLAIN_BUTTON = { ...BUTTON, background: "#eee", color: "#333" }

// One duplicate set: pick which note survives, then fold the rest into it.
function DuplicateGroup({ group, onDone }) {
    const [keeperNoteId, setKeeperNoteId] = useState(group.notes[0].noteId)
    const [status, setStatus] = useState(null)
    const [busy, setBusy] = useState(false)

    async function handleMerge() {
        const lib = require("libWebPreview.js")
        const others = group.notes.filter((note) => note.noteId !== keeperNoteId)
        const summary = others.map((note) => `"${note.title}"`).join(", ")
        if (!await api.showConfirmDialog(`Replace ${summary} with clones of the note you're keeping? Their children and attributes move onto it first.`)) return

        setBusy(true)
        try {
            const result = await lib.mergeWebViewDuplicates(keeperNoteId, others.map((note) => note.noteId))
            if (result.skipped.length) {
                setStatus(`Merged ${result.merged.length}. Left alone: ${result.skipped.map((s) => s.reason).join("; ")}`)
                setBusy(false)
            } else {
                onDone()
            }
        } catch (err) {
            setStatus(`Could not merge: ${err.message}`)
            setBusy(false)
        }
    }

    return (
        <div style={{ border: "1px solid #ddd", borderRadius: "6px", padding: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ fontSize: "12px", color: "#666", wordBreak: "break-all" }}>{group.url}</div>
            {group.notes.map((note) => (
                <label key={note.noteId} style={{ display: "flex", gap: "6px", alignItems: "baseline" }}>
                    <input type="radio" checked={keeperNoteId === note.noteId} onChange={() => setKeeperNoteId(note.noteId)} />
                    <span>{note.title}</span>
                    <span style={{ fontSize: "12px", color: "#888" }}>
                        {note.parents.map((parent) => parent.title).join(", ") || "no parent"}
                        {note.childCount ? ` — ${note.childCount} children` : ""}
                    </span>
                </label>
            ))}
            <div style={{ display: "flex", gap: "6px" }}>
                <button style={BUTTON} disabled={busy} onClick={handleMerge}>Keep This One</button>
                <button style={PLAIN_BUTTON} disabled={busy} onClick={onDone}>Skip</button>
            </div>
            {status && <div style={{ fontSize: "12px" }}>{status}</div>}
        </div>
    )
}

function DuplicatesPanel() {
    const [groups, setGroups] = useState(null)
    const [status, setStatus] = useState(null)

    async function handleScan() {
        const lib = require("libWebPreview.js")
        setStatus("Scanning…")
        try {
            const found = await lib.findDuplicateWebViews()
            setGroups(found)
            setStatus(found.length ? null : "No two Web View notes share a URL.")
        } catch (err) {
            setStatus(`Scan failed: ${err.message}`)
        }
    }

    // A merged or skipped group drops out of the list, so what's left is what's still to decide.
    function dismiss(url) {
        setGroups((prev) => prev.filter((group) => group.url !== url))
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "640px" }}>
            <p style={{ margin: 0 }}>
                Finds Web View notes that point at the same URL. For each set you choose which note to keep;
                the others hand over their children and attributes, are cloned into wherever they sat, and
                are then deleted.
            </p>
            <div><button style={BUTTON} onClick={handleScan}>Find Duplicates</button></div>
            {status && <p style={{ margin: 0 }}>{status}</p>}
            {groups?.map((group) => (
                <DuplicateGroup key={group.url} group={group} onDone={() => dismiss(group.url)} />
            ))}
        </div>
    )
}

export default function WebPreviewSettings() {
    // `api.currentNote` must be read here — inside libsettings it resolves to the library's note.
    return (
        <SettingsPage
            note={api.currentNote}
            extraPanels={[{ tab: "Duplicates", render: () => <DuplicatesPanel /> }]}
        />
    )
}
