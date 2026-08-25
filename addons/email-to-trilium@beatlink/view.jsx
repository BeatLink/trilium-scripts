import { useState, useEffect, useCallback, Button } from "trilium:preact"
import { loadSettings } from "libSettingsUI.jsx"

const ENDPOINT = "custom/emailToTrilium"

// Calls the backend customRequestHandler and returns parsed JSON. The backend
// always answers with JSON ({ ok, ... } or { error }); a non-2xx still carries
// a JSON body we surface to the user.
async function callBackend(action, params = {}) {
    const qs = new URLSearchParams({ action, ...params }).toString()
    const res = await fetch(`${ENDPOINT}?${qs}`, { credentials: "same-origin" })
    let body
    try { body = await res.json() } catch (e) { body = { error: `HTTP ${res.status}` } }
    if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`)
    return body
}

export default function EmailToTriliumView() {
    const [settings, setSettings] = useState(null)
    const [accountId, setAccountId] = useState(null)
    const [messages, setMessages] = useState([])
    const [loading, setLoading] = useState(false)
    const [status, setStatus] = useState(null)

    // Load settings once. `accounts` is a registry -> plain { id: item } map.
    useEffect(() => {
        (async () => {
            const schemaNoteId = await api.currentNote.getRelationValue("schemaNote")
            const settingsNoteId = await api.currentNote.getRelationValue("settingsNote")
            const configNoteId = (await api.getNote(settingsNoteId)).getRelationValue("configNote")
            const s = await loadSettings(schemaNoteId, configNoteId)
            setSettings(s)
            const ids = Object.keys(s.accounts || {})
            if (ids.length) setAccountId(ids[0])
        })()
    }, [])

    const account = settings && accountId ? settings.accounts[accountId] : null
    const connected = account && account.refreshToken

    const refresh = useCallback(async () => {
        if (!accountId) return
        setLoading(true); setStatus(null); setMessages([])
        try {
            const { messages } = await callBackend("list", { accountId })
            setMessages(messages || [])
        } catch (e) {
            setStatus({ error: e.message })
        } finally {
            setLoading(false)
        }
    }, [accountId])

    // Auto-list when switching to a connected account.
    useEffect(() => { if (connected) refresh() }, [accountId, connected])

    async function connect() {
        try {
            const { url } = await callBackend("authUrl", { accountId })
            // Open the provider consent screen; the backend callback stores the
            // refresh token, then the user reloads this view.
            window.open(url, "_blank", "noopener")
            setStatus({ info: "A consent window opened. Authorize, then reload this note." })
        } catch (e) {
            setStatus({ error: e.message })
        }
    }

    async function createNote(msg) {
        setStatus({ info: `Creating note from "${msg.subject}"...` })
        try {
            const { noteId, deleted } = await callBackend("create", { accountId, messageId: msg.id })
            setStatus({ info: `Created note.`, noteId })
            if (deleted) setMessages(ms => ms.filter(m => m.id !== msg.id))
        } catch (e) {
            setStatus({ error: e.message })
        }
    }

    async function deleteEmail(msg) {
        if (!confirm(`Delete "${msg.subject}" from the mail account? This trashes the message.`)) return
        try {
            await callBackend("delete", { accountId, messageId: msg.id })
            setMessages(ms => ms.filter(m => m.id !== msg.id))
            setStatus({ info: "Email deleted." })
        } catch (e) {
            setStatus({ error: e.message })
        }
    }

    if (!settings) return <div class="etr-view">Loading...</div>

    const accountIds = Object.keys(settings.accounts || {})

    return (
        <div class="etr-view">
            <div class="etr-toolbar">
                <select
                    class="etr-account-select"
                    value={accountId || ""}
                    onChange={e => setAccountId(e.target.value || null)}
                >
                    {accountIds.length === 0 && <option value="">No accounts configured</option>}
                    {accountIds.map(id => (
                        <option key={id} value={id}>{settings.accounts[id].name || id}</option>
                    ))}
                </select>
                {account && !connected && (
                    <Button kind="primary" text="Connect" onClick={connect} />
                )}
                {connected && (
                    <Button text={loading ? "Loading..." : "Refresh"} disabled={loading} onClick={refresh} />
                )}
            </div>

            {accountIds.length === 0 && (
                <p class="etr-empty">
                    No accounts yet. Open this addon's Settings to add one.
                </p>
            )}

            {account && !connected && (
                <p class="etr-empty">
                    This account isn't authorized. Fill in its OAuth credentials in Settings,
                    then click <strong>Connect</strong>.
                </p>
            )}

            {status && (
                <div class={`etr-status ${status.error ? "etr-status-error" : "etr-status-info"}`}>
                    {status.error || status.info}
                    {status.noteId && (
                        <a class="etr-link" href="#" onClick={e => { e.preventDefault(); api.activateNote(status.noteId) }}> Open note</a>
                    )}
                </div>
            )}

            {connected && !loading && messages.length === 0 && (
                <p class="etr-empty">No messages.</p>
            )}

            <ul class="etr-list">
                {messages.map(msg => (
                    <li class="etr-msg" key={msg.id}>
                        <div class="etr-msg-main">
                            <div class="etr-msg-subject">{msg.subject || "(no subject)"}</div>
                            <div class="etr-msg-meta">
                                <span class="etr-msg-from">{msg.from}</span>
                                <span class="etr-msg-date">{msg.date}</span>
                            </div>
                            {msg.snippet && <div class="etr-msg-snippet">{msg.snippet}</div>}
                        </div>
                        <div class="etr-msg-actions">
                            <Button kind="primary" text="Create Note" onClick={() => createNote(msg)} />
                            <Button className="etr-btn-danger" text="Delete" onClick={() => deleteEmail(msg)} />
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    )
}
