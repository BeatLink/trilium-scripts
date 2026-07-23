import { useState, useEffect, useCallback } from "trilium:preact"
import { loadSettings } from "libSettingsUI.jsx"

const ENDPOINT = "custom/stremioSync"

async function callBackend(action) {
    const res = await fetch(`${ENDPOINT}?action=${action}`, { credentials: "same-origin" })
    let body
    try { body = await res.json() } catch (e) { body = { error: `HTTP ${res.status}` } }
    if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`)
    return body
}

export default function StremioSyncView() {
    const [settings, setSettings] = useState(null)
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)

    async function readSettings() {
        const schemaNoteId = await api.currentNote.getRelationValue("schemaNote")
        const settingsNoteId = await api.currentNote.getRelationValue("settingsNote")
        const configNoteId = (await api.getNote(settingsNoteId)).getRelationValue("configNote")
        return loadSettings(schemaNoteId, configNoteId)
    }

    useEffect(() => {
        (async () => setSettings(await readSettings()))()
    }, [])

    const sync = useCallback(async () => {
        setBusy(true); setStatus(null)
        try {
            const { count } = await callBackend("sync")
            setStatus({ ok: `Synced ${count} items` })
        } catch (e) {
            setStatus({ error: e.message })
        } finally {
            setBusy(false)
        }
    }, [])

    const login = useCallback(async () => {
        setBusy(true); setStatus(null)
        try {
            await callBackend("login")
            setStatus({ ok: "Logged in" })
            setSettings(await readSettings())
        } catch (e) {
            setStatus({ error: e.message })
        } finally {
            setBusy(false)
        }
    }, [])

    // Auto-sync once on load, if enabled and already logged in.
    useEffect(() => {
        if (settings && settings.autoSyncOnStartup && settings.authKey) sync()
    }, [settings])

    if (!settings) return <div class="ss-view">Loading...</div>

    return (
        <div class="ss-view">
            <h3>Stremio Watch History Sync</h3>
            <div class="ss-toolbar">
                <button class="ss-btn" disabled={busy} onClick={login}>Login</button>
                <button class="ss-btn" disabled={busy || !settings.authKey} onClick={sync}>Sync Now</button>
            </div>
            {status?.ok && <p class="ss-status-ok">{status.ok}</p>}
            {status?.error && <p class="ss-status-error">{status.error}</p>}
            {!settings.targetNoteId && <p class="ss-hint">Set "Sync Into Note" in Settings.</p>}
        </div>
    )
}
