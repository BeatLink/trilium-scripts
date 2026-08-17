/*
 * email-to-trilium@beatlink — backend customRequestHandler ("emailToTrilium").
 *
 * A single HTTP endpoint (custom/emailToTrilium) routed by ?action=:
 *   authUrl  -> returns the provider OAuth consent URL for an account
 *   callback -> OAuth redirect target; exchanges the code for a refresh token
 *               and persists it into that account's config
 *   list     -> lists recent messages (headers + snippet) for an account
 *   create   -> creates a Trilium note (subject + HTML body + attachments)
 *               from a message, filed under the account's targetNoteId
 *   delete   -> trashes the message in the mail account
 *
 * All provider access is plain HTTPS via fetch() — Gmail API and Microsoft
 * Graph. Backend notes cannot require() npm IMAP libraries, so raw IMAP is not
 * supported; these two REST APIs cover Gmail and Outlook/Office 365.
 */

const { loadSettings, saveSettings } = require("libSettings.js")

// --- config resolution -----------------------------------------------------

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

function getAccount(settings, accountId) {
    const acct = (settings.accounts || {})[accountId]
    if (!acct) throw new Error("Unknown account")
    return acct
}

// Persist a single field back onto an account entry (used to store the refresh
// token after the OAuth exchange). Re-reads to avoid clobbering concurrent edits.
function persistAccountField(accountId, field, value) {
    const { schemaNoteId, configNoteId } = getNoteIds()
    const settings = loadSettings(schemaNoteId, configNoteId)
    if (!settings.accounts || !settings.accounts[accountId]) return
    settings.accounts[accountId][field] = value
    saveSettings(schemaNoteId, configNoteId, settings)
}

// --- provider definitions --------------------------------------------------

// The redirect URI must be reachable and registered with the provider. It is
// this exact endpoint with action=callback. Derived from the incoming request
// so it matches whatever host the user actually reaches Trilium on.
function redirectUri() {
    const proto = api.req.headers["x-forwarded-proto"] || api.req.protocol || "http"
    const host = api.req.headers.host
    return `${proto}://${host}/custom/emailToTrilium?action=callback`
}

const PROVIDERS = {
    gmail: {
        authUrl: (acct, redirect, state) =>
            "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
                client_id: acct.clientId,
                redirect_uri: redirect,
                response_type: "code",
                access_type: "offline",
                prompt: "consent",
                scope: "https://www.googleapis.com/auth/gmail.modify",
                state
            }),
        tokenUrl: () => "https://oauth2.googleapis.com/token",
    },
    graph: {
        authUrl: (acct, redirect, state) =>
            `https://login.microsoftonline.com/${acct.tenant || "common"}/oauth2/v2.0/authorize?` +
            new URLSearchParams({
                client_id: acct.clientId,
                redirect_uri: redirect,
                response_type: "code",
                response_mode: "query",
                scope: "offline_access https://graph.microsoft.com/Mail.ReadWrite",
                state
            }),
        tokenUrl: (acct) =>
            `https://login.microsoftonline.com/${acct.tenant || "common"}/oauth2/v2.0/token`,
    },
}

// --- OAuth token handling --------------------------------------------------

async function fetchJson(url, opts) {
    const res = await fetch(url, opts)
    const text = await res.text()
    let body
    try { body = text ? JSON.parse(text) : {} } catch (e) { body = { raw: text } }
    if (!res.ok) {
        const msg = body.error_description || body.error?.message || body.error || `HTTP ${res.status}`
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg))
    }
    return body
}

async function exchangeCode(acct, code) {
    const provider = PROVIDERS[acct.provider]
    const body = new URLSearchParams({
        client_id: acct.clientId,
        client_secret: acct.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(),
    })
    const tok = await fetchJson(provider.tokenUrl(acct), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    })
    return tok.refresh_token
}

// Refresh tokens are never persisted; exchanged fresh on every request.
async function getAccessToken(acct) {
    if (!acct.refreshToken) throw new Error("Account is not connected")
    const provider = PROVIDERS[acct.provider]
    const body = new URLSearchParams({
        client_id: acct.clientId,
        client_secret: acct.clientSecret,
        refresh_token: acct.refreshToken,
        grant_type: "refresh_token",
    })
    const tok = await fetchJson(provider.tokenUrl(acct), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    })
    return tok.access_token
}

function authHeaders(token) {
    return { Authorization: `Bearer ${token}` }
}

// --- message listing -------------------------------------------------------

function gmailHeader(payload, name) {
    const h = (payload.headers || []).find(x => x.name.toLowerCase() === name.toLowerCase())
    return h ? h.value : ""
}

async function listMessages(acct, max) {
    const token = await getAccessToken(acct)
    if (acct.provider === "gmail") {
        const list = await fetchJson(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}`,
            { headers: authHeaders(token) })
        const ids = (list.messages || []).map(m => m.id)
        const out = []
        for (const id of ids) {
            const msg = await fetchJson(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
                { headers: authHeaders(token) })
            out.push({
                id,
                subject: gmailHeader(msg.payload, "Subject"),
                from: gmailHeader(msg.payload, "From"),
                date: gmailHeader(msg.payload, "Date"),
                snippet: msg.snippet || "",
            })
        }
        return out
    }
    // Microsoft Graph
    const data = await fetchJson(
        `https://graph.microsoft.com/v1.0/me/messages?$top=${max}&$select=id,subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc`,
        { headers: authHeaders(token) })
    return (data.value || []).map(m => ({
        id: m.id,
        subject: m.subject || "",
        from: m.from?.emailAddress?.address || "",
        date: m.receivedDateTime || "",
        snippet: m.bodyPreview || "",
    }))
}

// --- message fetch (full body + attachments) -------------------------------

// Walks a Gmail MIME payload tree, collecting the best HTML (or text) body and
// every attachment part (those with a filename and attachmentId).
function walkGmailParts(payload, acc) {
    const mime = payload.mimeType || ""
    if (payload.parts) {
        for (const p of payload.parts) walkGmailParts(p, acc)
    }
    const filename = payload.filename
    const bodyData = payload.body?.data
    if (filename && payload.body?.attachmentId) {
        acc.attachments.push({ id: payload.body.attachmentId, filename, mime })
    } else if (mime === "text/html" && bodyData && !acc.html) {
        acc.html = decodeBase64Url(bodyData)
    } else if (mime === "text/plain" && bodyData && !acc.text) {
        acc.text = decodeBase64Url(bodyData)
    }
}

function decodeBase64Url(data) {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
}

function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// Returns { subject, from, date, html, attachments: [{ filename, mime, contentBuffer }] }
async function fetchFullMessage(acct, messageId) {
    const token = await getAccessToken(acct)
    if (acct.provider === "gmail") {
        const msg = await fetchJson(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
            { headers: authHeaders(token) })
        const acc = { html: "", text: "", attachments: [] }
        walkGmailParts(msg.payload || {}, acc)
        const attachments = []
        for (const att of acc.attachments) {
            const data = await fetchJson(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${att.id}`,
                { headers: authHeaders(token) })
            attachments.push({
                filename: att.filename,
                mime: att.mime,
                contentBuffer: Buffer.from((data.data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64"),
            })
        }
        const html = acc.html || (acc.text ? `<pre>${escapeHtml(acc.text)}</pre>` : "")
        return {
            subject: gmailHeader(msg.payload, "Subject"),
            from: gmailHeader(msg.payload, "From"),
            date: gmailHeader(msg.payload, "Date"),
            html,
            attachments,
        }
    }
    // Microsoft Graph
    const msg = await fetchJson(
        `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=subject,from,receivedDateTime,body`,
        { headers: authHeaders(token) })
    const body = msg.body || {}
    const html = body.contentType === "html"
        ? (body.content || "")
        : `<pre>${escapeHtml(body.content || "")}</pre>`
    const attData = await fetchJson(
        `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments`,
        { headers: authHeaders(token) })
    const attachments = []
    for (const att of (attData.value || [])) {
        // Only file attachments carry contentBytes; skip item/reference attachments.
        if (att["@odata.type"] === "#microsoft.graph.fileAttachment" && att.contentBytes) {
            attachments.push({
                filename: att.name,
                mime: att.contentType || "application/octet-stream",
                contentBuffer: Buffer.from(att.contentBytes, "base64"),
            })
        }
    }
    return {
        subject: msg.subject || "",
        from: msg.from?.emailAddress?.address || "",
        date: msg.receivedDateTime || "",
        html,
        attachments,
    }
}

// --- delete ----------------------------------------------------------------

async function deleteMessage(acct, messageId) {
    const token = await getAccessToken(acct)
    if (acct.provider === "gmail") {
        const res = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`,
            { method: "POST", headers: authHeaders(token) })
        if (!res.ok) throw new Error(`Gmail trash failed: HTTP ${res.status}`)
    } else {
        const res = await fetch(
            `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
            { method: "DELETE", headers: authHeaders(token) })
        if (!res.ok && res.status !== 204) throw new Error(`Graph delete failed: HTTP ${res.status}`)
    }
}

// --- note creation ---------------------------------------------------------

function createNoteFromMessage(acct, full) {
    if (!acct.targetNoteId) throw new Error("This account has no 'File Emails Under' note set")
    const { note } = api.createNewNote({
        parentNoteId: acct.targetNoteId,
        title: full.subject || "(no subject)",
        type: "text",
        mime: "text/html",
        content: full.html || "",
    })
    note.setLabel("emailFrom", full.from || "")
    if (full.date) note.setLabel("emailDate", full.date)
    for (const att of full.attachments) {
        note.saveAttachment({
            role: "file",
            mime: att.mime,
            title: att.filename,
            content: att.contentBuffer,
        })
    }
    return note.noteId
}

// --- routing ---------------------------------------------------------------

function sendJson(status, obj) {
    api.res.status(status).json(obj)
}

async function handle() {
    const action = api.req.query.action
    const accountId = api.req.query.accountId

    // OAuth callback is a browser redirect — respond with HTML, not JSON.
    if (action === "callback") {
        try {
            const state = api.req.query.state || ""
            const code = api.req.query.code
            if (!code) throw new Error(api.req.query.error_description || "No authorization code returned")
            const settings = getSettings()
            const acct = getAccount(settings, state)
            const refreshToken = await exchangeCode(acct, code)
            if (!refreshToken) throw new Error("Provider did not return a refresh token. Ensure offline access / consent prompt is enabled.")
            persistAccountField(state, "refreshToken", refreshToken)
            api.res.status(200).send(
                "<html><body style='font-family:sans-serif;padding:2rem'>" +
                "<h3>Account connected.</h3><p>You can close this window and reload the Email to Trilium note.</p>" +
                "</body></html>")
        } catch (e) {
            api.res.status(400).send(
                `<html><body style='font-family:sans-serif;padding:2rem'><h3>Authorization failed</h3><p>${escapeHtml(e.message)}</p></body></html>`)
        }
        return
    }

    try {
        const settings = getSettings()

        if (action === "authUrl") {
            const acct = getAccount(settings, accountId)
            if (!acct.clientId || !acct.clientSecret) throw new Error("Set the OAuth Client ID and Secret in Settings first")
            const provider = PROVIDERS[acct.provider]
            const url = provider.authUrl(acct, redirectUri(), accountId)
            return sendJson(200, { ok: true, url })
        }

        if (action === "list") {
            const acct = getAccount(settings, accountId)
            const max = Math.max(1, Math.min(100, settings.maxMessages || 25))
            const messages = await listMessages(acct, max)
            return sendJson(200, { ok: true, messages })
        }

        if (action === "create") {
            const acct = getAccount(settings, accountId)
            const full = await fetchFullMessage(acct, api.req.query.messageId)
            const noteId = createNoteFromMessage(acct, full)
            let deleted = false
            if (settings.deleteAfterCreate) {
                await deleteMessage(acct, api.req.query.messageId)
                deleted = true
            }
            return sendJson(200, { ok: true, noteId, deleted })
        }

        if (action === "delete") {
            const acct = getAccount(settings, accountId)
            await deleteMessage(acct, api.req.query.messageId)
            return sendJson(200, { ok: true })
        }

        return sendJson(400, { error: `Unknown action: ${action}` })
    } catch (e) {
        return sendJson(500, { error: e.message })
    }
}

handle()
