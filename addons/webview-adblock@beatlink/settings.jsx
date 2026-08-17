import { SettingsPage, resolveConfigNotes, loadSettings } from "libSettingsUI.jsx"
import { useState, useEffect } from "trilium:preact"

function describe(synced) {
    if (!synced) return "Never synced — the built-in EasyList/EasyPrivacy defaults are in use."
    const when = new Date(synced.syncedAt).toLocaleString()
    return `Last synced ${when} from uBO ${synced.uboVersion || "?"}: `
        + `${synced.listUrls.length} filter lists, `
        + `${synced.userFilters ? synced.userFilters.split("\n").filter((line) => line.trim()).length : 0} of your own filters, `
        + `${synced.trusted.length} trusted sites.`
}

function SyncPanel() {
    const [synced, setSynced] = useState(null)
    const [status, setStatus] = useState(null)

    async function readSynced() {
        const lib = require("libWebViewAdblock.js")
        const noteId = await api.currentNote.getRelationValue("uboConfigNote")
        setSynced(await lib.loadSyncedConfig(noteId))
    }

    useEffect(() => { readSynced() }, [])

    async function handleSync() {
        const lib = require("libWebViewAdblock.js")
        setStatus("Syncing…")
        try {
            const { schemaNoteId, configNoteId } = await resolveConfigNotes(api.currentNote)
            const { backupPath } = await loadSettings(schemaNoteId, configNoteId)
            if (!backupPath) {
                setStatus("Set the backup file path on the Settings tab first, and save.")
                return
            }
            const noteId = await api.currentNote.getRelationValue("uboConfigNote")
            const result = await lib.syncFromUboBackup(backupPath, noteId)
            setSynced(result)
            setStatus("Synced. Restart Trilium to apply it to the network layer.")
        } catch (err) {
            setStatus(`Sync failed: ${err.message}`)
            console.error("webview-adblock: uBO sync failed", err)
        }
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "640px" }}>
            <p style={{ margin: 0 }}>
                Export your config from uBlock Origin (Dashboard → Settings → <b>Backup to file</b>), point the
                backup path at that file, then sync. Selected filter lists, My filters and trusted sites are
                taken from it; uBO's dynamic filtering rules, hostname switches and scriptlets are not
                supported by this addon and are ignored.
            </p>
            <p style={{ margin: 0, color: "#666" }}>{describe(synced)}</p>
            <div>
                <button
                    style={{ border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", background: "#4b6fff", color: "white" }}
                    onClick={handleSync}
                >Sync Now</button>
            </div>
            {status && <p style={{ margin: 0 }}>{status}</p>}
        </div>
    )
}

export default function WebViewAdblockSettings() {
    // `api.currentNote` must be read here, in this addon's own module — inside
    // libsettings it resolves to the library's note instead.
    return (
        <SettingsPage
            note={api.currentNote}
            extraPanels={[{ tab: "uBO Sync", render: () => <SyncPanel /> }]}
        />
    )
}
