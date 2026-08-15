// TAM's entire backend/data layer, in one require()-able JS note; section banners below group functions by domain.

const marked = require("marked.min.js")
// The same note libsettings' own frontend half requires, so TAM's settings
// review reads a schema, a config and a registry's shipped-vs-stored delta
// exactly the way the settings form that wrote them does.
const { isPlainObject, mergeSchemas, mergeSources, mergeDefaults, titleFor } = require("libSettingsCore.js")

const addonRootLabel = "addonRoot"

async function getAddonRootNoteId() {
    return await api.currentNote.getRelationValue(addonRootLabel)
}

const addonPersistenceLabel = "addonPersistence"

async function getPersistenceNoteId() {
    return await api.currentNote.getRelationValue(addonPersistenceLabel)
}

// Synthetic local ids for the per-addon anchor notes TAM itself owns (never declared by an addon's own manifest).
const addonAnchorRootLocalId = "__tamAddonRoot__"
const addonAnchorPersistenceLocalId = "__tamAddonPersistenceRoot__"
const synthesizedAnchorLocalIds = [addonAnchorRootLocalId, addonAnchorPersistenceLocalId]

// Find-or-create the one note that owns every note this addon resolves under (structural or persistent).
async function ensureAddonAnchor(addonId, addonName, localId, parentRealId) {
    const tamFileId = `${addonId}/${localId}`
    return await api.runOnBackend((tamFileIdLabel, tamFileId, addonId, addonName, parentRealId) => {
        let existing = api.getNoteWithLabel(tamFileIdLabel, tamFileId)
        if (existing && existing.isDeleted) existing = null
        if (existing) {
            if (existing.title !== addonName) {
                existing.title = addonName
                existing.save()
            }
            return existing.noteId
        }
        const { note } = api.createTextNote(parentRealId, addonName, "")
        note.setLabel(tamFileIdLabel, tamFileId)
        note.setLabel("addonId", addonId)
        note.setLabel("iconClass", "bx bx-customize")
        return note.noteId
    }, [tamFileIdLabel, tamFileId, addonId, addonName, parentRealId])
}

const databaseLabel = "database"

// Database read/write, via the `database` relation on this note.
async function loadDatabase() {
    const databaseNoteId = await api.currentNote.getRelationValue(databaseLabel)
    const database = await api.runOnBackend((databaseId) => {
        const note = api.getNote(databaseId)
        return JSON.parse(note.getContent())
    }, [databaseNoteId])
    if (!database.catalogs) database.catalogs = []
    if (!database.installedAddons) database.installedAddons = {}
    return database
}

async function saveDatabase(database) {
    const databaseNoteId = await api.currentNote.getRelationValue(databaseLabel)
    return await api.runOnBackend((databaseId, database) => {
        const note = api.getNote(databaseId)
        return note.setContent(JSON.stringify(database, null, 4))
    }, [databaseNoteId, database])
}

// =========================================================================
// Constants: label/relation names, TAM's own id, and the "activation" attribute names enableAddon toggles under a disabled: prefix.
// =========================================================================

const tamFileIdLabel = "TAMFILEID"
const sourceUrlLabel = "TAMSOURCEURL"
const TAM_ID = "trilium-addon-manager@beatlink"
const addonLabels = [
    "widget",
    "renderNote",
    "run",
    "customRequestHandler",
    "customResourceHandler",
    "titleTemplate",
    "appCss",
    "webViewSrc",
    "iconPack",
    "runOnNoteCreation",
    "runOnNoteTitleChange",
    "runOnNoteChange",
    "runOnNoteContentChange",
    "runOnNoteDeletion",
    "runOnBranchCreation",
    "runOnBranchChange",
    "runOnBranchDeletion",
    "runOnChildNoteCreation",
    "runOnAttributeCreation",
    "runOnAttributeChange",
    "appTheme"
]

// =========================================================================
// Helpers: pure extractors, guards, and formatters for common patterns, with no side effects.
// =========================================================================

// Checks if a note's #TAMFILEID belongs to the specified addon.
function isOwnTamFileId(note, addonId) {
    const tamFileId = note.getOwnedLabelValue(tamFileIdLabel)
    return tamFileId && tamFileId.startsWith(`${addonId}/`)
}

// Encodes a TAM file ID from addon ID and local note ID.
function encodeTamFileId(addonId, localId) {
    return `${addonId}/${localId}`
}

// Decodes a TAM file ID into [addonId, localId].
function decodeTamFileId(tamFileId) {
    const [addonId, ...rest] = tamFileId.split("/")
    return [addonId, rest.join("/")]
}

// Extracts metadata fields from a manifest for storage in the database.
function extractAddonMeta(manifest) {
    return {
        name: manifest.name,
        description: manifest.description,
        author: manifest.author,
        license: manifest.license,
        type: manifest.type,
        homepage: manifest.homepage
    }
}

// =========================================================================
// Network: fetch/retry/version-comparison helpers, duplicated inline inside every api.runOnBackend callback that needs them.
// =========================================================================

function versionCompare(remote, local) {
    return remote.localeCompare(local, undefined, { numeric: true, sensitivity: 'base' })
}

/*
 * Retries on HTTP 429, honoring Retry-After when sent, else exponential backoff.
 *
 * The URL is normalized through `new URL()` rather than encodeURI, which
 * escapes a percent sign and so double-encodes a URL that already carries an
 * escape: a stored `...manager%40beatlink/...` became `%2540`, which fetched
 * GitHub's "404: Not Found" body. `new URL().href` leaves an existing escape
 * alone while still encoding a literal space.
 */
async function fetchWithRetry(url, maxRetries = 5) {
    for (let attempt = 0; ; attempt++) {
        const response = await fetch(new URL(url).href)
        if (response.status !== 429 || attempt >= maxRetries) return response
        const retryAfter = Number(response.headers.get("retry-after"))
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(1000 * 2 ** attempt, 15000)
        await new Promise(resolve => setTimeout(resolve, delayMs))
    }
}

// Fetch-and-parse a URL on the backend, retrying through 429s.
async function fetchJson(url) {
    return await api.runAsyncOnBackendWithManualTransactionHandling(async (url) => {
        async function fetchWithRetry(url, maxRetries = 5) {
            for (let attempt = 0; ; attempt++) {
                const response = await fetch(new URL(url).href)
                if (response.status !== 429 || attempt >= maxRetries) return response
                const retryAfter = Number(response.headers.get("retry-after"))
                const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
                    ? retryAfter * 1000
                    : Math.min(1000 * 2 ** attempt, 15000)
                await new Promise(resolve => setTimeout(resolve, delayMs))
            }
        }
        const response = await fetchWithRetry(url)
        // An error page is still a body, and parsing it yields a JSON syntax
        // error that names neither the status nor the URL — the actual fault
        // (a dead manifestSourceUrl, say) then has to be guessed at.
        if (!response.ok) throw new Error(`TAM: fetch of ${url} failed with HTTP ${response.status} ${response.statusText}`)
        return await response.json()
    }, [url])
}

/*
 * A published manifest carries absolute, commit-pinned sourceUrls; a
 * hand-authored source manifest carries paths relative to itself. Resolving
 * them here, against the URL the manifest was actually fetched from, is what
 * keeps every consumer below dealing only in absolute URLs.
 */
async function fetchManifest(manifestSourceUrl) {
    const manifest = await fetchJson(manifestSourceUrl)
    for (const noteDef of (manifest?.manifest?.notes || [])) {
        if (!noteDef.sourceUrl) continue
        noteDef.sourceUrl = new URL(noteDef.sourceUrl, manifestSourceUrl).href
    }
    return manifest
}

// A published manifest's per-note content hashes, keyed by local id.
function noteHashesOf(m) {
    const hashes = {}
    for (const noteDef of (m?.notes || [])) {
        if (noteDef.sha) hashes[noteDef.id] = noteDef.sha
    }
    return hashes
}

// A note whose fetch failed is absent from the note map: keeping its previously
// stored hash (or none at all) is what makes the next sync retry it rather than
// read it as already current.
function recordedNoteHashes(m, noteMap, storedNoteHashes) {
    const hashes = {}
    for (const [localId, sha] of Object.entries(noteHashesOf(m))) {
        const value = noteMap[localId] ? sha : storedNoteHashes?.[localId]
        if (value) hashes[localId] = value
    }
    return hashes
}

// =========================================================================
// Manifest shape: pure helpers operating on a fetched/stored manifest object.
// =========================================================================

// Splits children[] into each note's first-declared parent vs. any later parents.
function buildParentMaps(children) {
    const primaryParent = {}
    const extraParents = {}
    for (const c of (children || [])) {
        if (!(c.child in primaryParent)) {
            primaryParent[c.child] = c.parent
        } else {
            extraParents[c.child] = extraParents[c.child] || []
            extraParents[c.child].push(c.parent)
        }
    }
    return { primaryParent, extraParents }
}

function topologicalSort(noteIds, parentMap) {
    const result = []
    const visited = new Set()
    function visit(id) {
        if (visited.has(id)) return
        visited.add(id)
        const parentId = parentMap[id]
        if (parentId && noteIds.includes(parentId)) visit(parentId)
        result.push(id)
    }
    for (const id of noteIds) visit(id)
    return result
}

// Snapshots the manifest fields TAM still needs offline.
function stripManifestForStorage(m) {
    return {
        root: m.root,
        settingsNote: m.settingsNote,
        readmeNote: m.readmeNote,
        // Kept because resolvePrompt needs to find the schema and config notes
        // again, long after the sync that produced the prompt has finished.
        settings: m.settings || null,
        hooks: m.hooks || null,
        allowExternalReferences: m.allowExternalReferences,
        children: m.children || []
    }
}

// Parses a trailing "(inheritable)" modifier off a label name into a real isInheritable flag.
function parseInheritableName(name) {
    const match = name.match(/^(.*)\(inheritable\)$/)
    return match ? { name: match[1], isInheritable: true } : { name, isInheritable: false }
}

// Normalizes a fetched manifest into the `m` sub-object shape used throughout.
function normalizeManifest(manifestFetched) {
    return manifestFetched.manifest ?? {
        notes: manifestFetched.notes ?? [],
        children: [],
        relations: manifestFetched.relations ?? [],
        labels: manifestFetched.labels ?? [],
        root: null,
        settings: null
    }
}

// Local ids whose children[] parent chain roots at the reserved "persistence" parent keyword.
function persistentLocalIds(m) {
    const persistent = new Set()
    const childrenOf = {}
    for (const c of (m.children || []).filter(c => c.child)) {
        (childrenOf[c.parent] = childrenOf[c.parent] || []).push(c.child)
    }
    const stack = [...(childrenOf["persistence"] || [])]
    for (const id of stack) persistent.add(id)
    while (stack.length) {
        for (const child of childrenOf[stack.pop()] || []) {
            if (!persistent.has(child)) {
                persistent.add(child)
                stack.push(child)
            }
        }
    }
    return persistent
}

// =========================================================================
// Note resolution: turns a manifest's notes[]/children[]/labels[] into real, live Trilium notes tagged #TAMFILEID.
// =========================================================================

// Resolves a single real note id live by #TAMFILEID for a stored manifest's local id.
async function resolveStoredNoteId(addonId, localId) {
    if (!localId) return null
    return await api.runOnBackend((tamFileIdLabel, tamFileId) => {
        const note = api.getNoteWithLabel(tamFileIdLabel, tamFileId)
        return (note && !note.isDeleted) ? note.noteId : null
    }, [tamFileIdLabel, `${addonId}/${localId}`])
}

// Resolves an addon's root note id live.
async function resolveAddonRootNoteId(addonId, storedManifest) {
    return await resolveStoredNoteId(addonId, storedManifest?.root ?? addonAnchorRootLocalId)
}

async function applyLabels(labels, noteMap) {
    for (const label of labels) {
        const realNoteId = noteMap[label.note]
        if (!realNoteId) continue
        const { name, isInheritable } = parseInheritableName(label.name)
        await api.runOnBackend((noteId, name, value, isInheritable) => {
            const note = api.getNote(noteId)
            const disabledName = `disabled:${name}`
            const targetName = note.hasOwnedLabel(disabledName) ? disabledName : name
            if (isInheritable) {
                note.removeLabel(targetName)
                note.addLabel(targetName, value, true)
            } else {
                note.setLabel(targetName, value)
            }
        }, [realNoteId, name, String(label.value ?? ""), isInheritable])
    }
}

// Resolves every note in scope against the live tree by #TAMFILEID, find-or-create.
async function resolveNotes(m, addonId, fallbackParentNoteId, options = {}) {
    const { rootExternallyParented = false, entryLocalId = null, scopeLocalIds = null, storedNoteHashes = null } = options
    const { primaryParent } = buildParentMaps(m.children)
    const persistentIds = persistentLocalIds(m)
    const noteIds = (scopeLocalIds ? m.notes.filter(n => scopeLocalIds.has(n.id)) : m.notes).map(n => n.id)
    const sortedIds = topologicalSort(noteIds, primaryParent)
    const noteMap = {}
    for (const localId of sortedIds) {
        const noteDef = m.notes.find(n => n.id === localId)
        if (!noteDef) continue
        const isEntry = entryLocalId
            ? localId === entryLocalId
            : primaryParent[localId] === "root" || primaryParent[localId] === "persistence"
        const parentLocalId = isEntry ? null : primaryParent[localId]
        const parentRealId = parentLocalId ? noteMap[parentLocalId] : fallbackParentNoteId
        if (parentLocalId && !parentRealId) {
            console.error(`TAM: skipping note '${localId}' of ${addonId} — its parent '${parentLocalId}' failed to resolve`)
            continue
        }
        const noteType = noteDef.type ?? "text"
        const mime = noteDef.mime ?? "text/html"
        const isBinary = noteDef.binary ?? false
        const tamFileId = `${addonId}/${localId}`
        const skipParenting = isEntry && rootExternallyParented
        // An unhashed manifest (or a note whose shipped content moved) always
        // refetches; matching hashes mean the bytes on the other end of that URL
        // are the ones already installed, so both the fetch and the write go.
        const contentUnchanged = !!(noteDef.sha && storedNoteHashes?.[localId] === noteDef.sha)
        const absoluteSourceUrl = noteDef.sourceUrl || null
        let effectiveType = noteType
        let effectiveMime = mime
        let explicitContent = noteDef.content ?? null
        let sourceUrlForBackend = absoluteSourceUrl
        if (noteDef.renderAsHTML) {
            effectiveType = "text"
            effectiveMime = "text/html"
            let rawMarkdown = explicitContent
            if (rawMarkdown === null && absoluteSourceUrl) {
                try {
                    const response = await fetchWithRetry(absoluteSourceUrl)
                    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${absoluteSourceUrl}`)
                    rawMarkdown = await response.text()
                } catch (e) {
                    console.error(`TAM: skipping note '${localId}' of ${addonId} — failed to fetch markdown source '${absoluteSourceUrl}'`, e)
                    continue
                }
            }
            explicitContent = marked.parse(rawMarkdown ?? "")
            sourceUrlForBackend = null
        }
        // What #TAMSOURCEURL records, and what two addons vendoring the same file
        // are matched on. A published manifest supplies `sourceId` — the same file
        // on its branch — because the sourceUrl it fetches from is pinned to one
        // commit and so is a different string every publish.
        const sourceIdentity = sourceUrlForBackend ? (noteDef.sourceId || sourceUrlForBackend) : null
        let realNoteId
        try {
            realNoteId = await api.runAsyncOnBackendWithManualTransactionHandling(
                async (tamFileIdLabel, sourceUrlLabel, tamFileId, parentRealId, title, noteType, mime, sourceUrl, explicitContent, isBinary, skipOnUpdate, promptOnUpdate, skipParenting, contentUnchanged, sourceIdentity) => {
                    async function fetchWithRetry(url, maxRetries = 5) {
                        for (let attempt = 0; ; attempt++) {
                            const response = await fetch(new URL(url).href)
                            if (response.status !== 429 || attempt >= maxRetries) return response
                            const retryAfter = Number(response.headers.get("retry-after"))
                            const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
                                ? retryAfter * 1000
                                : Math.min(1000 * 2 ** attempt, 15000)
                            await new Promise(resolve => setTimeout(resolve, delayMs))
                        }
                    }
                    let existing = api.getNoteWithLabel(tamFileIdLabel, tamFileId)
                    if (existing && existing.isDeleted) existing = null
                    if (!existing && sourceIdentity) {
                        const shared = api.getNoteWithLabel(sourceUrlLabel, sourceIdentity)
                        if (shared && !shared.isDeleted) {
                            if (!skipParenting) api.ensureNoteIsPresentInParent(shared.noteId, parentRealId)
                            return shared.noteId
                        }
                    }
                    const willWriteContent = !existing || !(skipOnUpdate || promptOnUpdate || contentUnchanged)
                    let finalContent = null
                    if (willWriteContent) {
                        if (explicitContent !== null) {
                            finalContent = isBinary ? Buffer.from(explicitContent, "base64") : explicitContent
                        } else if (sourceUrl) {
                            const response = await fetchWithRetry(sourceUrl)
                            if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${sourceUrl}`)
                            finalContent = isBinary ? Buffer.from(await response.arrayBuffer()) : await response.text()
                        } else {
                            finalContent = ""
                        }
                    }
                    if (existing) {
                        if (!skipParenting) api.ensureNoteIsPresentInParent(existing.noteId, parentRealId)
                        if (existing.getOwnedLabelValue(sourceUrlLabel) !== (sourceIdentity || "")) {
                            existing.setLabel(sourceUrlLabel, sourceIdentity || "")
                        }
                        // Title/type/mime still track the manifest when only the
                        // content write was skipped as unchanged — a rename ships
                        // without the file itself moving.
                        if (!(skipOnUpdate || promptOnUpdate)) {
                            if (existing.type !== noteType || existing.mime !== mime || existing.title !== title) {
                                existing.type = noteType
                                existing.mime = mime
                                existing.title = title
                                existing.save()
                            }
                        }
                        if (willWriteContent) existing.setContent(finalContent)
                        return existing.noteId
                    }
                    const result = api.createTextNote(parentRealId, title, "")
                    const note = result.note
                    if (noteType !== "text" || mime !== "text/html") {
                        note.type = noteType
                        note.mime = mime
                        note.save()
                    }
                    note.setContent(finalContent)
                    note.setLabel(tamFileIdLabel, tamFileId)
                    note.setLabel(sourceUrlLabel, sourceIdentity || "")
                    return note.noteId
                },
                [tamFileIdLabel, sourceUrlLabel, tamFileId, parentRealId, noteDef.title, effectiveType, effectiveMime, sourceUrlForBackend, explicitContent, isBinary,
                    !!noteDef.skipOnUpdate || persistentIds.has(localId), !!noteDef.promptOnUpdate, skipParenting, contentUnchanged, sourceIdentity]
            )
        } catch (e) {
            console.error(`TAM: failed to resolve note '${localId}' of ${addonId}`, e)
            continue
        }
        noteMap[localId] = realNoteId
    }
    await reconcileNoteParenting(m, addonId, noteMap, fallbackParentNoteId, rootExternallyParented, entryLocalId)
    return noteMap
}

// Clones every resolved note into every parent its manifest currently declares, and detaches parents it no longer declares.
async function reconcileNoteParenting(m, addonId, noteMap, fallbackParentNoteId, rootExternallyParented, entryLocalId = null) {
    const { primaryParent, extraParents } = buildParentMaps(m.children)
    const isReservedAnchor = (pid) => pid === "root" || pid === "persistence"
    const isEntry = (localId) => entryLocalId ? localId === entryLocalId : isReservedAnchor(primaryParent[localId])
    for (const [childLocalId, parentLocalIds] of Object.entries(extraParents)) {
        const childRealId = noteMap[childLocalId]
        if (!childRealId) continue
        for (const parentLocalId of parentLocalIds) {
            const parentRealId = isReservedAnchor(parentLocalId) ? fallbackParentNoteId : noteMap[parentLocalId]
            if (!parentRealId) continue
            await api.runOnBackend((sourceId, parentId) => {
                api.ensureNoteIsPresentInParent(sourceId, parentId)
            }, [childRealId, parentRealId])
        }
    }
    for (const localId of Object.keys(noteMap)) {
        if (isEntry(localId) && rootExternallyParented) continue
        const noteRealId = noteMap[localId]
        if (!noteRealId) continue
        const declaredParentLocalIds = [primaryParent[localId], ...(extraParents[localId] || [])].filter(Boolean)
        const desiredRealParents = declaredParentLocalIds
            .map(pid => isReservedAnchor(pid) ? fallbackParentNoteId : noteMap[pid])
            .filter(Boolean)
        if (isEntry(localId) && !rootExternallyParented && fallbackParentNoteId) {
            desiredRealParents.push(fallbackParentNoteId)
        }
        if (desiredRealParents.length === 0) continue
        const declaredParentTamIds = declaredParentLocalIds.map(pid => isReservedAnchor(pid) ? null : `${addonId}/${pid}`).filter(Boolean)
        await api.runOnBackend((tamFileIdLabel, addonId, noteId, desiredRealParents, declaredParentTamIds) => {
            const note = api.getNote(noteId)
            const currentParentIds = note.getParentNotes().map(p => p.noteId)
            for (const parentId of currentParentIds) {
                if (desiredRealParents.includes(parentId)) continue
                const parentNote = api.getNote(parentId)
                const parentTamId = parentNote ? parentNote.getOwnedLabelValue(tamFileIdLabel) : null
                if (parentTamId && parentTamId.startsWith(`${addonId}/`) && !declaredParentTamIds.includes(parentTamId)) {
                    api.ensureNoteIsAbsentFromParent(noteId, parentId)
                }
            }
        }, [tamFileIdLabel, addonId, noteRealId, desiredRealParents, declaredParentTamIds])
    }
}

// Deletes any live #TAMFILEID-tagged note of this addon whose local id is no longer declared in the current manifest.
async function pruneRemovedNotes(m, addonId) {
    const exemptIds = [...persistentLocalIds(m), ...synthesizedAnchorLocalIds]
    await api.runOnBackend((tamFileIdLabel, addonId, currentLocalIds, exemptIds) => {
        const currentSet = new Set(currentLocalIds)
        const exemptSet = new Set(exemptIds)
        const prefix = `${addonId}/`
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            // Owned-only: getLabelValue() resolves inherited labels, so a note
            // templated from a TAM template would report the template's id and
            // be pruned along with it.
            const value = note.getOwnedLabelValue(tamFileIdLabel)
            if (!value || !value.startsWith(prefix)) continue
            const localId = value.slice(prefix.length)
            if (exemptSet.has(localId)) continue
            if (!currentSet.has(localId)) note.deleteNote()
        }
    }, [tamFileIdLabel, addonId, m.notes.map(n => n.id), exemptIds])
}

// =========================================================================
// Persistence: user data lives in notes reachable from the reserved "persistence" parent, anchored under the shared "Addon Data" note.
// =========================================================================

// Called from syncAddon before resolveNotes: compares each persistent note's live content against the incoming manifest default and queues a prompt on any difference.
async function collectPendingPrompts(addonId, m, storedNoteHashes = null) {
    const persistentIds = persistentLocalIds(m)
    if (persistentIds.size === 0) return []
    const prompts = []
    for (const noteDef of (m.notes || [])) {
        if (!persistentIds.has(noteDef.id)) continue
        // Nothing to decide when the shipped default hasn't moved since the last
        // sync: the only difference left is the user's own edit, which they've
        // already been asked about once.
        if (noteDef.sha && storedNoteHashes?.[noteDef.id] === noteDef.sha) continue
        // A declared settings config note is reviewed per setting instead (see
        // collectSettingsPrompt) — diffing it whole would offer to replace the
        // user's entire config with the blank document the addon ships.
        if (noteDef.id === m.settings?.config) continue
        let newContent = noteDef.content ?? null
        if (newContent === null && noteDef.sourceUrl) {
            try {
                const response = await fetchWithRetry(noteDef.sourceUrl)
                if (response.ok) newContent = await response.text()
            } catch (e) {
                console.error(`TAM: couldn't fetch incoming default for persistent note '${noteDef.id}' of ${addonId}`, e)
            }
        }
        if (newContent === null) continue
        const info = await api.runOnBackend((tamFileIdLabel, tamFileId) => {
            const note = api.getNoteWithLabel(tamFileIdLabel, tamFileId)
            return (note && !note.isDeleted) ? { noteId: note.noteId, content: note.getContent() } : null
        }, [tamFileIdLabel, `${addonId}/${noteDef.id}`])
        if (!info) continue
        if (info.content === newContent) continue
        prompts.push({
            noteLocalId: noteDef.id,
            title: noteDef.title,
            persistedNoteId: info.noteId,
            newContent,
            currentContent: info.content
        })
    }
    return prompts
}

async function getPendingPrompts(addonId) {
    const database = await loadDatabase()
    return database.installedAddons?.[addonId]?.persistence?.pendingPrompts || []
}

// `decision` is a plain boolean for a built-in whole-content prompt, or a
// { [itemKey]: boolean } map for an item-level one — settings items TAM applies
// itself, hook-produced items the addon's own hook applies, since only it knows
// what an item means.
async function resolvePrompt(addonId, noteLocalId, decision) {
    const database = await loadDatabase()
    const record = database.installedAddons?.[addonId]
    const prompt = (record?.persistence?.pendingPrompts || [])
        .find(p => p.noteLocalId === noteLocalId)
    if (!prompt) return
    if (prompt.source === settingsPromptSource) {
        await applySettingsSelections(addonId, record.manifest, decision || {})
        return
    }
    if (prompt.source === metadataPromptSource) {
        await applyMetadataSelections(addonId, prompt, decision || {})
        return
    }
    if (prompt.items) {
        await runHook(addonId, record.manifest?.hooks?.updateReview, {
            phase: "apply",
            noteLocalId,
            selections: decision || {}
        })
        return
    }
    if (!decision) return
    await api.runOnBackend((noteId, content) => {
        api.getNote(noteId).setContent(content)
    }, [prompt.persistedNoteId, prompt.newContent])
}

async function clearPendingPrompts(addonId) {
    let database = await loadDatabase()
    if (database.installedAddons?.[addonId]?.persistence) {
        delete database.installedAddons[addonId].persistence.pendingPrompts
    }
    await saveDatabase(database)
}

// =========================================================================
// Settings review: the per-setting half of the Update Review, for addons declaring `manifest.settings`.
// =========================================================================

// An addon's defaults.json is structural (replaced on every update) while its
// config.json is persistent (never overwritten), so both versions of "what this
// setting should be" are already on disk. What is missing is what the defaults
// looked like *last* time: without it, "the user's config differs from the
// current default" cannot tell a deliberate choice from a default that moved
// upstream. `settingsBaseline` on the addon's own database record is that
// missing side — the merged read-only sources as of the last review — which
// keeps this review down to what actually changed upstream instead of re-asking
// about every customization on every update.
//
// It lives here rather than inside config.json because it is TAM's bookkeeping,
// not the user's data: nothing in the addon has to know it exists, a settings
// save can't accidentally drop it, and it goes away with the addon's record.
const settingsPromptSource = "settings"

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// `list` is excluded from the review entirely: a stored list replaces its
// default wholesale rather than reconciling per entry, so "use the new default"
// could only mean discarding the user's entries. `checklist` stores nothing of
// its own.
function isReviewableField(key, def) {
    return !key.startsWith("_") && def.type !== "list" && def.type !== "checklist"
}

// The shipped baseline of every reviewable field, taken from the merged
// read-only sources: a plain value for a scalar, the entry map for a registry.
function shippedDefaults(schema, defaults) {
    const shipped = {}
    for (const [key, def] of Object.entries(schema)) {
        if (isReviewableField(key, def)) shipped[key] = defaults[key]
    }
    return shipped
}

// Registry entries are compared in their *runtime* (merged, flat) shape rather
// than as stored: a shipped entry may omit any itemSchema key it is happy to
// default, and a nested registry is stored as an `{ entries, removedIds }` delta
// but shipped as a flat map — only after mergeDefaults are the two comparable.
function registrySettingsItems(key, def, storedField, shippedNow, shippedThen) {
    const items = []
    const storedEntries = isPlainObject(storedField?.entries) ? storedField.entries : {}
    const removedIds = Array.isArray(storedField?.removedIds) ? storedField.removedIds : []
    for (const [id, now] of Object.entries(shippedNow)) {
        // An entry the user deleted is never resurrected, and one shipped for the
        // first time in this version has no previous version to diff against.
        if (removedIds.includes(id)) continue
        const then = shippedThen[id]
        if (!then) continue
        const nowMerged = mergeDefaults(def.itemSchema, now, null)
        const thenMerged = mergeDefaults(def.itemSchema, then, null)
        if (sameJson(thenMerged, nowMerged)) continue
        const storedItem = storedEntries[id]
        // What the user has right now: their own version if they edited this
        // entry, otherwise the entry as it shipped last time.
        const currentMerged = storedItem ? mergeDefaults(def.itemSchema, now, storedItem) : thenMerged
        if (sameJson(currentMerged, nowMerged)) continue
        items.push({
            key: `${key}.${id}`,
            label: `${def.label ?? key}: ${titleFor(def.itemSchema, currentMerged, null)}`,
            current: currentMerged,
            incoming: nowMerged,
            defaultSelected: !storedItem,
            field: key,
            id
        })
    }
    return items
}

// Everything the user would have to decide about, given what shipped last time.
// `field`/`id` are internal: the prompt strips them, and applySettingsSelections
// recomputes this list to get them back rather than parsing them out of `key`.
function settingsReviewItems(schema, stored, baseline, defaults) {
    const items = []
    for (const [key, def] of Object.entries(schema)) {
        // A field with no baseline is new in this version: nothing to diff.
        if (!isReviewableField(key, def) || !(key in baseline)) continue
        if (def.type === "registry") {
            items.push(...registrySettingsItems(key, def, stored[key], defaults[key] || {}, baseline[key] || {}))
            continue
        }
        // Every default that moved in this update gets a row, whether or not the
        // user ever saved anything: a setting they never customized is already
        // following the new value, so the row is what lets them say otherwise.
        if (sameJson(defaults[key], baseline[key])) continue
        const current = key in stored ? stored[key] : baseline[key]
        if (sameJson(current, defaults[key])) continue
        items.push({
            key,
            label: def.label ?? key,
            current,
            incoming: defaults[key],
            defaultSelected: !(key in stored),
            field: key,
            id: null
        })
    }
    return items
}

// A scalar still holding exactly the default it shipped with is one the user
// never touched, so dropping it from the config lets it follow the defaults
// source again and a changed default is theirs for free — no review. Registry
// entries need no equivalent: an untouched shipped entry is never copied into
// config.json in the first place, so it already tracks its shipped version.
// Mutates `stored`; returns whether anything moved.
function adoptUnchangedDefaults(schema, stored, baseline, defaults) {
    let changed = false
    for (const [key, def] of Object.entries(schema)) {
        if (!isReviewableField(key, def) || def.type === "registry") continue
        if (!(key in stored) || !(key in baseline)) continue
        if (sameJson(defaults[key], baseline[key]) || !sameJson(stored[key], baseline[key])) continue
        delete stored[key]
        changed = true
    }
    return changed
}

async function readJsonNote(noteId) {
    const content = await api.runOnBackend((id) => api.getNote(id).getContent(), [noteId])
    try {
        return JSON.parse(content || "{}")
    } catch (e) {
        console.error(`TAM: note ${noteId} does not hold valid JSON`, e)
        return {}
    }
}

// The config note's whole source chain, lowest priority first and the note
// itself last — the same walk libsettings does when it reads settings, so the
// review sees exactly the layering the settings form does.
async function loadSettingsSources(configNoteId) {
    return await api.runOnBackend((rootId) => {
        const readJson = (noteId) => {
            const note = noteId ? api.getNote(noteId) : null
            if (!note) return {}
            try {
                return JSON.parse(note.getContent() || "{}")
            } catch (e) {
                return {}
            }
        }
        const sources = []
        const seen = new Set()
        const visit = (noteId) => {
            if (!noteId || seen.has(noteId)) return
            seen.add(noteId)
            const note = api.getNote(noteId)
            if (!note) return
            for (const relation of note.getOwnedRelations("sourceConfig")) visit(relation.value)
            sources.push({
                schema: readJson(note.getRelationValue("schemaNote")),
                stored: readJson(noteId)
            })
        }
        visit(rootId)
        return sources
    }, [configNoteId])
}

async function writeJsonNote(noteId, value) {
    await api.runOnBackend(
        (id, content) => api.getNote(id).setContent(content),
        [noteId, JSON.stringify(value, null, 4)]
    )
}

// Everything the settings phases need, or null when the addon declares no
// settings (or its notes can't be resolved, which is not worth failing a sync over).
async function loadSettingsState(addonId, m) {
    if (!m?.settings?.schema || !m?.settings?.config) return null
    const schemaNoteId = await resolveStoredNoteId(addonId, m.settings.schema)
    const configNoteId = await resolveStoredNoteId(addonId, m.settings.config)
    if (!schemaNoteId || !configNoteId) {
        console.error(`TAM: settings notes of ${addonId} did not resolve (schema '${m.settings.schema}', config '${m.settings.config}')`)
        return null
    }
    // Every source under the config note but the config note itself: those are
    // the read-only ones the review compares the user's own document against.
    const sources = (await loadSettingsSources(configNoteId)).slice(0, -1)
    const schema = mergeSchemas([...sources.map(s => s.schema), await readJsonNote(schemaNoteId)])
    const defaults = mergeSources(schema, sources.map(s => s.stored)) || {}
    return {
        configNoteId, schema, defaults,
        stored: await readJsonNote(configNoteId),
        shipped: shippedDefaults(schema, defaults)
    }
}

async function saveSettingsBaseline(addonId, shipped) {
    const database = await loadDatabase()
    const record = database.installedAddons?.[addonId]
    if (!record) return
    record.persistence = record.persistence || {}
    record.persistence.settingsBaseline = shipped
    await saveDatabase(database)
}

// First install: the user has customized nothing, so record where the defaults
// stand and leave the first update with nothing to review.
async function recordSettingsBaseline(addonId, m) {
    const state = await loadSettingsState(addonId, m)
    if (state) await saveSettingsBaseline(addonId, state.shipped)
}

// Runs after an update's notes are in place, so it reads the *new* schema
// against the config and baseline the update left alone. Returns a prompt entry
// for the Update Review, or null when there is nothing to decide — in which
// case the baseline advances straight away.
async function collectSettingsPrompt(addonId, m, title) {
    const state = await loadSettingsState(addonId, m)
    if (!state) return null
    const database = await loadDatabase()
    const baseline = database.installedAddons?.[addonId]?.persistence?.settingsBaseline
    // No baseline means this install predates the settings review: there is
    // genuinely no way to know which of its stored values were deliberate, so
    // record where things stand and review nothing this once.
    if (!isPlainObject(baseline)) {
        await saveSettingsBaseline(addonId, state.shipped)
        return null
    }
    if (adoptUnchangedDefaults(state.schema, state.stored, baseline, state.defaults)) {
        await writeJsonNote(state.configNoteId, state.stored)
    }
    const items = settingsReviewItems(state.schema, state.stored, baseline, state.defaults)
    if (items.length === 0) {
        await saveSettingsBaseline(addonId, state.shipped)
        return null
    }
    // The baseline deliberately does not move here: it advances only once the
    // user has answered, so an update they never applied is asked about again
    // rather than silently forgotten.
    return {
        noteLocalId: m.settings.config,
        source: settingsPromptSource,
        title,
        items: items.map(({ key, label, current, incoming, defaultSelected }) => ({ key, label, current, incoming, defaultSelected }))
    }
}

// `true` for an item means "use the new default": it drops the user's override —
// a scalar's own key, a registry entry's shadowing entry — so the setting goes
// back to tracking the defaults source. `false` means "keep mine", which has to
// *pin* what they have today: a setting they never diverged on holds no value of
// its own, so without writing one it would simply follow the new default.
async function applySettingsSelections(addonId, m, selections) {
    const state = await loadSettingsState(addonId, m)
    if (!state) return
    const database = await loadDatabase()
    const baseline = database.installedAddons?.[addonId]?.persistence?.settingsBaseline
    if (isPlainObject(baseline)) {
        for (const item of settingsReviewItems(state.schema, state.stored, baseline, state.defaults)) {
            if (selections[item.key]) {
                if (item.id === null) {
                    delete state.stored[item.field]
                } else if (isPlainObject(state.stored[item.field]?.entries)) {
                    delete state.stored[item.field].entries[item.id]
                }
            } else if (item.id === null) {
                state.stored[item.field] = item.current
            } else {
                const field = isPlainObject(state.stored[item.field]) ? state.stored[item.field] : {}
                field.entries = isPlainObject(field.entries) ? field.entries : {}
                field.removedIds = Array.isArray(field.removedIds) ? field.removedIds : []
                if (!(item.id in field.entries)) field.entries[item.id] = item.current
                state.stored[item.field] = field
            }
        }
        await writeJsonNote(state.configNoteId, state.stored)
    }
    await saveSettingsBaseline(addonId, state.shipped)
}

// =========================================================================
// Metadata review: the per-item half of the Update Review for a note's title, labels and relations.
// =========================================================================

// A note's content is not the only thing an update replaces: `resolveNotes`
// rewrites every declared title, and `applyLabels`/`applyRelation` overwrite
// every declared label and relation, so a title the user renamed or a label they
// retargeted is silently reverted. This review is the same key-by-key treatment
// the settings review gives a config note, applied to that metadata:
// `metadataBaseline` on the addon's own database record holds what the manifest
// declared last time, so a row is raised only where the *declaration* moved, and
// the live value says whether the user had diverged from it.
//
// It is collected before the sync (the live values are gone once notes are
// rewritten) and applied after the user answers: "use new" makes the note match
// the manifest — which is also the only way a label or relation the manifest has
// dropped ever goes away — and "keep mine" writes the pre-update value back.
const metadataPromptSource = "metadata"
const metadataPromptLocalId = "__metadata__"

// What a manifest declares about each of its notes, in the shape the baseline is
// stored and compared in.
function declaredMetadata(m) {
    const declared = {}
    for (const note of m.notes || []) {
        declared[note.id] = { title: note.title, labels: {}, relations: {} }
    }
    for (const label of m.labels || []) {
        if (declared[label.note]) declared[label.note].labels[label.name] = String(label.value ?? "")
    }
    for (const relation of m.relations || []) {
        if (declared[relation.from]) declared[relation.from].relations[relation.type] = relation.to
    }
    return declared
}

// The live title, label values and relation targets of every note named in
// `wanted` ({ localId: { labels: [name], relations: [type] } }), read in one hop
// before the sync overwrites them. A label TAM has disabled lives under its
// `disabled:` name, which is still the user's value for review purposes.
async function liveMetadata(addonId, wanted) {
    return await api.runOnBackend((tamFileIdLabel, addonId, wanted) => {
        const live = {}
        for (const [localId, want] of Object.entries(wanted)) {
            const note = api.getNoteWithLabel(tamFileIdLabel, `${addonId}/${localId}`)
            if (!note || note.isDeleted) continue
            const entry = { title: note.title, labels: {}, relations: {} }
            for (const name of want.labels) {
                entry.labels[name] = note.getOwnedLabelValue(name) ?? note.getOwnedLabelValue(`disabled:${name}`)
            }
            for (const type of want.relations) {
                const targetId = note.getOwnedRelationValue(type) ?? note.getOwnedRelationValue(`disabled:${type}`)
                const target = targetId ? api.getNote(targetId) : null
                const targetTamId = target ? target.getOwnedLabelValue(tamFileIdLabel) : null
                // Compared as the manifest states it — a local id for a note of
                // this addon, a raw noteId for anything else.
                entry.relations[type] = targetTamId && targetTamId.startsWith(`${addonId}/`)
                    ? targetTamId.slice(addonId.length + 1)
                    : targetId
            }
            live[localId] = entry
        }
        return live
    }, [tamFileIdLabel, addonId, wanted])
}

// One row per declaration that moved in this update, skipping any the note
// already matches. `defaultSelected` starts a row on "use new" when the user
// never diverged from the old declaration — the same rule the settings review
// uses, so an untouched note is not asked about twice for no reason.
function metadataReviewItems(now, then, live) {
    const items = []
    const add = (localId, kind, name, currentValue, incomingValue, wasUntouched) => {
        if (currentValue === incomingValue) return
        const what = kind === "title" ? "title" : `${kind} ${name}`
        items.push({
            key: `${kind}:${localId}${name ? `:${name}` : ""}`,
            label: `${localId}: ${what}`,
            current: currentValue === null ? "(none)" : currentValue,
            incoming: incomingValue === null ? "(removed)" : incomingValue,
            defaultSelected: wasUntouched,
            localId,
            kind,
            name: name || null,
            currentValue,
            incomingValue
        })
    }
    for (const [localId, declaredNow] of Object.entries(now)) {
        const declaredThen = then[localId]
        const liveNote = live[localId]
        if (!declaredThen || !liveNote) continue
        if (declaredNow.title !== declaredThen.title) {
            add(localId, "title", null, liveNote.title, declaredNow.title, liveNote.title === declaredThen.title)
        }
        for (const kind of ["labels", "relations"]) {
            const names = new Set([...Object.keys(declaredNow[kind]), ...Object.keys(declaredThen[kind])])
            for (const name of names) {
                const valueNow = declaredNow[kind][name] ?? null
                const valueThen = declaredThen[kind][name] ?? null
                if (valueNow === valueThen) continue
                const liveValue = liveNote[kind][name] ?? null
                add(localId, kind === "labels" ? "label" : "relation", name, liveValue, valueNow, liveValue === valueThen)
            }
        }
    }
    return items
}

async function saveMetadataBaseline(addonId, declared) {
    const database = await loadDatabase()
    const record = database.installedAddons?.[addonId]
    if (!record) return
    record.persistence = record.persistence || {}
    record.persistence.metadataBaseline = declared
    await saveDatabase(database)
}

// Runs *before* the sync rewrites anything. Returns a prompt entry (appended to
// the pending prompts once the sync is done) or null when nothing moved.
async function collectMetadataPrompt(addonId, m, title) {
    const database = await loadDatabase()
    const baseline = database.installedAddons?.[addonId]?.persistence?.metadataBaseline
    // No baseline means this install predates the metadata review: there is no
    // way to tell a user's rename from a declaration that has always been this
    // way, so record where things stand and review nothing this once.
    if (!isPlainObject(baseline)) return null
    const declared = declaredMetadata(m)
    const wanted = {}
    for (const [localId, entry] of Object.entries(declared)) {
        if (!baseline[localId]) continue
        wanted[localId] = {
            labels: [...new Set([...Object.keys(entry.labels), ...Object.keys(baseline[localId].labels || {})])],
            relations: [...new Set([...Object.keys(entry.relations), ...Object.keys(baseline[localId].relations || {})])]
        }
    }
    const items = metadataReviewItems(declared, baseline, await liveMetadata(addonId, wanted))
    if (items.length === 0) return null
    return { noteLocalId: metadataPromptLocalId, source: metadataPromptSource, title, items }
}

// `true` for an item makes the note match the manifest (including dropping a
// label or relation the manifest no longer declares, which nothing else does);
// `false` writes back what the note held before the update.
async function applyMetadataSelections(addonId, prompt, selections) {
    const actions = (prompt.items || []).map(item => ({
        localId: item.localId,
        kind: item.kind,
        name: item.name,
        value: selections[item.key] ? item.incomingValue : item.currentValue
    }))
    await api.runOnBackend((tamFileIdLabel, addonId, actions) => {
        for (const action of actions) {
            const note = api.getNoteWithLabel(tamFileIdLabel, `${addonId}/${action.localId}`)
            if (!note || note.isDeleted) continue
            if (action.kind === "title") {
                note.title = action.value
                note.save()
                continue
            }
            const disabledName = `disabled:${action.name}`
            const isLabel = action.kind === "label"
            const hasDisabled = isLabel ? note.hasOwnedLabel(disabledName) : note.hasRelation(disabledName)
            const name = hasDisabled ? disabledName : action.name
            if (action.value === null) {
                if (isLabel) note.removeLabel(name)
                else note.removeRelation(name)
                continue
            }
            if (isLabel) {
                note.setLabel(name, action.value)
                continue
            }
            const target = api.getNoteWithLabel(tamFileIdLabel, `${addonId}/${action.value}`)
            note.setRelation(name, target && !target.isDeleted ? target.noteId : action.value)
        }
    }, [tamFileIdLabel, addonId, actions])
}

// =========================================================================
// Hooks: the addon-declared lifecycle scripts (manifest `hooks`) TAM executes at install/update/uninstall points.
// =========================================================================

const hookContextLabel = "tamHookContext"

// Runs one hook note and returns whatever it returned.
//
// FNote.executeScript() takes no arguments and only yields a return value for a
// *frontend* note (a backend one is POSTed to the server and its result thrown
// away), so context goes in on a temporary label and `validate` requires hooks
// to be frontend JS/JSX — backend work is still reachable through the hook's own
// api.runOnBackend. executeScript() is independent of the #run labels
// enableAddon toggles, so hooks fire on a disabled addon too, which postInstall
// (a fresh install is left disabled) and preUninstall both depend on.
//
// Never fatal: a hook that throws is swallowed by Trilium's own bundle error
// handling and arrives here as undefined, and every caller treats an
// unusable return the same as a hook that was never declared.
async function runHook(addonId, localId, context) {
    if (!localId || addonId === TAM_ID) return undefined
    const noteId = await resolveStoredNoteId(addonId, localId)
    if (!noteId) {
        console.error(`TAM: hook note '${localId}' of ${addonId} did not resolve`)
        return undefined
    }
    await api.runOnBackend((noteId, name, value) => {
        api.getNote(noteId).setLabel(name, value)
    }, [noteId, hookContextLabel, JSON.stringify({ addonId, ...context })])
    try {
        const note = await api.getNote(noteId)
        return await note.executeScript()
    } catch (e) {
        console.error(`TAM: hook '${localId}' of ${addonId} failed`, e)
        return undefined
    } finally {
        await api.runOnBackend((noteId, name) => {
            api.getNote(noteId).removeLabel(name)
        }, [noteId, hookContextLabel])
    }
}

// =========================================================================
// Install / Sync: the install/update entry point (syncAddon, installByUrl).
// =========================================================================

async function applyRelation(fromRealId, type, toRealId) {
    await api.runOnBackend((fromId, type, toId) => {
        const note = api.getNote(fromId)
        const disabledType = `disabled:${type}`
        const targetType = note.hasRelation(disabledType) ? disabledType : type
        note.setRelation(targetType, toId)
    }, [fromRealId, type, toRealId])
}

// Resolves `m`'s notes (scoped via scopeLocalIds) and applies labels/relations for that same scope.
async function resolveManifest(m, addonId, parentRealId, options = {}) {
    const {
        entryLocalId = null,
        scopeLocalIds = null,
        rootExternallyParented = false,
        existingNoteMap = null,
        deferredRelations = null,
        storedNoteHashes = null
    } = options
    const inScope = (localId) => !scopeLocalIds || scopeLocalIds.has(localId)
    const resolved = await resolveNotes(m, addonId, parentRealId, {
        entryLocalId, scopeLocalIds, rootExternallyParented, storedNoteHashes
    })
    const noteMap = existingNoteMap ? Object.assign(existingNoteMap, resolved) : resolved
    await applyLabels((m.labels || []).filter(l => inScope(l.note)), noteMap)
    // A `to` that isn't one of the manifest's own local ids is taken as a real
    // note id (e.g. "root"); one that is must come from the map, since passing
    // the local id through would set a relation to a note that doesn't exist.
    const localIds = new Set((m.notes || []).map(n => n.id))
    for (const rel of (m.relations || []).filter(r => inScope(r.from))) {
        const fromRealId = noteMap[rel.from]
        if (!fromRealId) continue
        if (localIds.has(rel.to) && !noteMap[rel.to]) {
            // The target is in a scope this pass hasn't resolved yet — a
            // persistent note pointing at a structural one. Hand it back to the
            // caller to apply once every scope has been resolved.
            if (deferredRelations) deferredRelations.push(rel)
            continue
        }
        const toRealId = noteMap[rel.to] || rel.to
        if (!toRealId) continue
        await applyRelation(fromRealId, rel.type, toRealId)
    }
    return noteMap
}

// The one entry point for getting an addon's notes to match its manifest — fresh install, update, and TAM's own self-sync are all the same call.
async function syncAddon(addonId, options = {}) {
    const { manifestSourceUrl = null, manual = true } = options
    if (!addonId.trim()) return
    const isSelf = addonId === TAM_ID
    let database = await loadDatabase()
    const existing = database.installedAddons[addonId]
    const wasInstalled = !!existing?.installedVersion
    const previousVersion = existing?.installedVersion ?? null
    const fetchUrl = manifestSourceUrl || existing?.manifestSourceUrl
    if (!fetchUrl) throw new Error(`TAM: no manifestSourceUrl available to sync '${addonId}' (not installed yet, and none provided)`)
    const manifest = await fetchManifest(fetchUrl)
    const m = normalizeManifest(manifest)
    if (isSelf && !m.root) throw new Error(`TAM: manifest for ${addonId} is missing required 'root' field`)
    // Collected before anything is rewritten: the live title/labels/relations it
    // compares against are gone once resolveManifest has run.
    const metadataPrompt = wasInstalled && !isSelf
        ? await collectMetadataPrompt(addonId, m, manifest.name || addonId)
        : null
    const storedNoteHashes = existing?.noteHashes || null
    const pendingPrompts = await collectPendingPrompts(addonId, m, storedNoteHashes)
    if (pendingPrompts.length > 0) {
        if (!database.installedAddons[addonId]) database.installedAddons[addonId] = {}
        if (!database.installedAddons[addonId].persistence) database.installedAddons[addonId].persistence = {}
        database.installedAddons[addonId].persistence.pendingPrompts = pendingPrompts
        await saveDatabase(database)
    }
    const persistentIds = persistentLocalIds(m)
    const structuralScope = persistentIds.size
        ? new Set(m.notes.map(n => n.id).filter(id => !persistentIds.has(id)))
        : null
    const addonRootAnchorId = isSelf
        ? await getAddonRootNoteId()
        : await ensureAddonAnchor(addonId, manifest.name, addonAnchorRootLocalId, await getAddonRootNoteId())
    const noteMap = {}
    // Relations from a persistent note to a structural one, which the
    // persistence pass below can't resolve because the structural pass hasn't
    // run yet.
    const deferredRelations = []
    if (persistentIds.size) {
        const persistenceAnchorId = isSelf
            ? await getPersistenceNoteId()
            : await ensureAddonAnchor(addonId, manifest.name, addonAnchorPersistenceLocalId, await getPersistenceNoteId())
        await resolveManifest(m, addonId, persistenceAnchorId, {
            scopeLocalIds: persistentIds,
            existingNoteMap: noteMap,
            deferredRelations,
            storedNoteHashes
        })
    }
    await resolveManifest(m, addonId, addonRootAnchorId, {
        entryLocalId: isSelf ? m.root : null,
        rootExternallyParented: isSelf,
        scopeLocalIds: structuralScope,
        existingNoteMap: noteMap,
        storedNoteHashes
    })
    for (const rel of deferredRelations) {
        if (noteMap[rel.from] && noteMap[rel.to]) await applyRelation(noteMap[rel.from], rel.type, noteMap[rel.to])
    }
    if (isSelf && !noteMap[m.root]) throw new Error(`TAM: root note '${m.root}' was not resolved for ${addonId}`)
    await pruneRemovedNotes(m, addonId)
    const storedManifest = stripManifestForStorage(m)
    const meta = extractAddonMeta(manifest)
    // A sync that skipped a note (its fetch failed) has not installed what the
    // manifest hash stands for, so the hash is left unset and the next update
    // check falls back to comparing versions until a clean sync records one.
    const fullyResolved = (m.notes || []).every(n => !!noteMap[n.id])
    const contentHash = fullyResolved ? (manifest.contentHash ?? null) : null
    const noteHashes = recordedNoteHashes(m, noteMap, storedNoteHashes)
    if (!wasInstalled) {
        const priorPersistence = database.installedAddons[addonId]?.persistence
        database.installedAddons[addonId] = {
            installedVersion: manifest.latestVersion,
            contentHash,
            noteHashes,
            manifestSourceUrl: fetchUrl,
            manuallyInstalled: manual || isSelf,
            enabled: isSelf,
            meta,
            manifest: storedManifest,
            ...(priorPersistence ? { persistence: priorPersistence } : {})
        }
    } else {
        const rec = database.installedAddons[addonId]
        rec.installedVersion = manifest.latestVersion
        rec.contentHash = contentHash
        rec.noteHashes = noteHashes
        rec.manifestSourceUrl = fetchUrl
        rec.meta = meta
        rec.manifest = storedManifest
        rec.updateAvailable = false
        if (manual && !rec.manuallyInstalled) rec.manuallyInstalled = true
    }
    await saveDatabase(database)
    if (!wasInstalled && !isSelf) await enableAddon(addonId, false)
    if (isSelf) return
    // The baseline advances here rather than when the user answers: the prompt
    // below carries both values it needs, so it stays applicable either way.
    await saveMetadataBaseline(addonId, declaredMetadata(m))
    const hookContext = { previousVersion, newVersion: manifest.latestVersion }
    if (!wasInstalled) {
        await recordSettingsBaseline(addonId, m)
        await runHook(addonId, m.hooks?.postInstall, { phase: "postInstall", ...hookContext })
        return
    }
    await runHook(addonId, m.hooks?.postUpdate, { phase: "postUpdate", ...hookContext })
    // An addon shipping its own review hook replaces the whole-content diff
    // collected before the sync with its own item list. It runs here, after the
    // sync and after postUpdate, so it reads its own updated code against
    // already-migrated data. Anything other than an array (a hook that threw, or
    // returned junk) leaves the built-in diff in place as the fallback; an empty
    // array is a real answer and clears it.
    if (m.hooks?.updateReview) {
        const items = await runHook(addonId, m.hooks.updateReview, { phase: "collect", ...hookContext })
        if (Array.isArray(items)) {
            database = await loadDatabase()
            const persistence = database.installedAddons[addonId].persistence || {}
            if (items.length > 0) {
                persistence.pendingPrompts = items
            } else {
                delete persistence.pendingPrompts
            }
            database.installedAddons[addonId].persistence = persistence
            await saveDatabase(database)
        }
    }
    // Settings review runs last, against notes the sync has already replaced, and
    // is *additive*: it appends its own entry to whatever prompts are pending
    // rather than replacing them, so an addon that also ships persistent content
    // notes keeps their whole-file diffs alongside it.
    const settingsPrompt = await collectSettingsPrompt(addonId, m, meta.name || addonId)
    const extraPrompts = [metadataPrompt, settingsPrompt].filter(Boolean)
    if (extraPrompts.length > 0) {
        database = await loadDatabase()
        const persistence = database.installedAddons[addonId].persistence || {}
        const replacedSources = new Set(extraPrompts.map(p => p.source))
        const others = (persistence.pendingPrompts || []).filter(p => !replacedSources.has(p.source))
        persistence.pendingPrompts = [...others, ...extraPrompts]
        database.installedAddons[addonId].persistence = persistence
        await saveDatabase(database)
    }
}

// Installs by manifestSourceUrl alone — the caller doesn't need to know the addon's id.
async function installByUrl(manifestSourceUrl, options = {}) {
    const manifest = await fetchManifest(manifestSourceUrl)
    if (!manifest.id) throw new Error("TAM: manifest has no 'id' field")
    await syncAddon(manifest.id, { ...options, manifestSourceUrl })
}

// =========================================================================
// Lifecycle / query: enable/disable, read-only addon listing, update-checking, and database validation.
// =========================================================================

async function enableAddon(addonId, enabled) {
    if (!addonId.trim()) return
    let database = await loadDatabase()
    const rootNoteId = await resolveAddonRootNoteId(addonId, database.installedAddons[addonId].manifest)
    if (!rootNoteId) return
    await api.runOnBackend((tamFileIdLabel, addonId, noteId, enabled, addonLabels) => {
        for (const id of api.getNote(noteId).getSubtreeNoteIds()) {
            const note = api.getNote(id)
            if (!note.getOwnedLabelValue(tamFileIdLabel)?.startsWith(`${addonId}/`)) continue
            for (const attribute of note.getOwnedAttributes() || []) {
                const isDisabledAttr = attribute.name.toLowerCase().includes("disabled:")
                if (enabled ? !isDisabledAttr : !addonLabels.includes(attribute.name)) continue
                const newName = enabled ? attribute.name.replace("disabled:", "") : `disabled:${attribute.name}`
                note.removeAttribute(attribute.type, attribute.name)
                note.addAttribute(attribute.type, newName, attribute.value, attribute.isInheritable, attribute.position)
            }
        }
    }, [tamFileIdLabel, addonId, rootNoteId, enabled, addonLabels])
    database.installedAddons[addonId].enabled = enabled
    await saveDatabase(database)
}

// Returns every installed addon merged with live-resolved rootNoteId/settingsNoteId.
async function getAllAddons() {
    let database = await loadDatabase()
    const lookups = []
    for (const [addonId, addon] of Object.entries(database.installedAddons || {})) {
        if (!addon.installedVersion || !addon.manifest) continue
        lookups.push({ addonId, rootLocalId: addon.manifest.root ?? addonAnchorRootLocalId, settingsLocalId: addon.manifest.settingsNote })
    }
    const resolved = await api.runOnBackend((tamFileIdLabel, lookups) => {
        const result = {}
        for (const { addonId, rootLocalId, settingsLocalId } of lookups) {
            function resolveLocal(localId) {
                if (!localId) return null
                const note = api.getNoteWithLabel(tamFileIdLabel, `${addonId}/${localId}`)
                return (note && !note.isDeleted) ? note.noteId : null
            }
            result[addonId] = { rootNoteId: resolveLocal(rootLocalId), settingsNoteId: resolveLocal(settingsLocalId) }
        }
        return result
    }, [tamFileIdLabel, lookups])
    const addons = {}
    for (const [addonId, addon] of Object.entries(database.installedAddons || {})) {
        if (!addon.installedVersion) continue
        addons[addonId] = {
            id: addonId,
            ...(addon.meta || {}),
            latestVersion: addon.installedVersion,
            ...addon,
            ...(resolved[addonId] || {})
        }
    }
    return addons
}

/*
 * Refetches every installed addon's own manifestSourceUrl and decides whether an
 * update exists.
 *
 * A published manifest carries a `contentHash` covering its structure and every
 * note's content, so a change is detected from the content itself and shipping a
 * fix no longer depends on the author remembering to bump `latestVersion`. The
 * version comparison stays as the fallback for a manifest that carries no hash —
 * a hand-authored one, or one published before this existed.
 */
async function checkForAddonUpdates() {
    let database = await loadDatabase()
    const installed = database.installedAddons || {}
    await Promise.all(Object.entries(installed).map(async ([addonId, addon]) => {
        if (!addon.installedVersion || !addon.manifestSourceUrl) return
        try {
            const manifest = await fetchManifest(addon.manifestSourceUrl)
            if (manifest.contentHash && addon.contentHash) {
                addon.updateAvailable = manifest.contentHash !== addon.contentHash
            } else if (manifest.latestVersion) {
                addon.updateAvailable = versionCompare(manifest.latestVersion, addon.installedVersion) > 0
            } else {
                return
            }
            // Left unset for a content-only update, so the button reads "Update"
            // rather than offering the version already installed.
            if (addon.updateAvailable && manifest.latestVersion && manifest.latestVersion !== addon.installedVersion) {
                addon.availableVersion = manifest.latestVersion
            } else {
                delete addon.availableVersion
            }
        } catch (e) {
        }
    }))
    await saveDatabase(database)
}

// =========================================================================
// Diagnostics: the single audit behind TAM's maintenance page. It checks TAM's
// own bookkeeping, the addon-owned note tree, and every installed addon against
// its live manifest, and returns one row per problem with the repair for it.
//
// The audit is read-only: nothing is deleted, re-synced or repointed until
// repairIssue() is called with a row. The database validation and the two note
// sweeps used to be three separate buttons, and the sweeps deleted first and
// reported after; they're folded in here as findings you see before anything
// goes.
//
// The reason this is worth having at all: syncAddon() advances installedVersion
// unconditionally but records a contentHash only once every note resolved, so a
// note whose fetch failed leaves the addon reporting itself up to date while
// still running the previous version's code.
// =========================================================================

// One row of the diagnosis. `fix` is what repairIssue() dispatches on, and null
// for a finding TAM can't act on unattended. `fix.self` marks a repair to TAM's
// own notes, which needs a reload before it has actually taken effect.
function issueRow(addonId, code, target, detail, fix = null) {
    const FIX_LABELS = {
        resync: "Re-sync",
        repoint: "Repoint & re-sync",
        delete: "Delete note"
    }
    const fixLabel = fix ? `${FIX_LABELS[fix.kind]}${fix.self ? " & reload" : ""}` : ""
    return { addonId, code, target, detail, fix, fixLabel }
}

// sha256 of a string as lowercase hex - the digest a published manifest's `sha`
// carries for that note's source file. Needs a secure context for crypto.subtle,
// which Trilium always is (trilium-app:// is registered as a secure scheme).
async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

// addonId -> a catalog's manifest URL for it, used to repoint a record whose own
// source has gone dead or carries nothing to verify against. Only hashed
// manifests are indexed: repointing at another unverifiable one fixes nothing.
async function catalogSourceIndex() {
    const index = {}
    for (const catalogUrl of await getCatalogs()) {
        try {
            const { addons } = await fetchCatalogAddons(catalogUrl)
            for (const entry of addons) {
                if (entry.id && entry.contentHash && !index[entry.id]) index[entry.id] = entry.manifestSourceUrl
            }
        } catch (e) {
            console.error(`TAM: couldn't read catalog ${catalogUrl} while diagnosing`, e)
        }
    }
    return index
}

// Everything the audit needs about one addon's live notes, in a single backend
// round trip. Content comes back only for `contentIds`, so a 1MB binary or a
// note with nothing to compare against isn't serialized for nothing.
//
// Resolution mirrors resolveNotes(): a file vendored by two addons is installed
// once, under whichever addon got there first, so a note that doesn't answer to
// this addon's #TAMFILEID is still installed if one carries its #TAMSOURCEURL.
// Matching on the id alone would report every shared library note as missing.
async function readLiveAddon(addonId, noteDefs, contentIds) {
    return await api.runOnBackend((tamFileIdLabel, sourceUrlLabel, addonId, noteDefs, contentIds) => {
        const live = {}
        for (const { id: localId, sourceId } of noteDefs) {
            let note = api.getNoteWithLabel(tamFileIdLabel, `${addonId}/${localId}`)
            if (note && note.isDeleted) note = null
            if (!note && sourceId) {
                const shared = api.getNoteWithLabel(sourceUrlLabel, sourceId)
                if (shared && !shared.isDeleted) note = shared
            }
            if (!note) continue
            const attributes = note.getOwnedAttributes() || []
            live[localId] = {
                noteId: note.noteId,
                parentIds: note.getParentNotes().map(parent => parent.noteId),
                labels: attributes.filter(a => a.type === "label").map(a => ({ name: a.name, value: a.value })),
                relations: attributes.filter(a => a.type === "relation").map(a => ({ name: a.name, value: a.value })),
                content: contentIds.includes(localId) ? note.getContent() : null
            }
        }
        return live
    }, [tamFileIdLabel, sourceUrlLabel, addonId, noteDefs, contentIds])
}

// The whole audit, as one flat list of rows. Read-only: nothing is deleted,
// re-synced or repointed until repairIssue() is called with a row.
async function diagnose() {
    const database = await loadDatabase()
    const catalogSources = await catalogSourceIndex()
    const rows = []

    // TAM's own bookkeeping. A duplicate is the one thing a live-lookup design
    // can't self-correct - getNoteWithLabel() just returns whichever match it
    // finds first - and TAM can't tell which copy is the real one, so this is
    // reported without a repair.
    const duplicateIds = await api.runOnBackend((tamFileIdLabel) => {
        const byValue = {}
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            const value = note.getOwnedLabelValue(tamFileIdLabel)
            if (!value) continue
            byValue[value] = byValue[value] || []
            byValue[value].push(note.noteId)
        }
        return Object.entries(byValue).filter(([, noteIds]) => noteIds.length > 1)
    }, [tamFileIdLabel])
    for (const [tamFileId, noteIds] of duplicateIds) {
        rows.push(issueRow(tamFileId.split("/")[0], "duplicate-id", tamFileId,
            `claimed by ${noteIds.length} notes at once (${noteIds.join(", ")}) - delete the wrong one by hand`))
    }

    // Notes the tree is holding that nothing owns any more.
    for (const note of await findOrphanedNotes()) {
        rows.push(issueRow(note.tamFileId.split("/")[0], "orphaned-note", note.title,
            "has no parents left, so nothing in the tree reaches it",
            { kind: "delete", noteId: note.noteId }))
    }
    for (const note of await findInvalidAddonTreeNotes()) {
        rows.push(issueRow(note.tamFileId ? note.tamFileId.split("/")[0] : "(none)", "unclaimed-note", note.title,
            note.tamFileId
                ? `is tagged for '${note.tamFileId}', which isn't installed`
                : "sits under the addon root carrying no #TAMFILEID",
            { kind: "delete", noteId: note.noteId }))
    }

    // Each installed addon against its live manifest.
    for (const [addonId, addon] of Object.entries(database.installedAddons || {})) {
        if (!addon.installedVersion) continue

        // TAM audits itself like anything else, but its repairs are marked
        // `self`. Rewriting a script note doesn't disturb the already-loaded
        // instance - the running copy lives in memory - so the repair is safe to
        // apply from inside TAM; what isn't safe is treating it as done, since
        // every note would be repaired while the old code kept running. `self`
        // is what makes the UI demand a reload instead.
        const isSelf = addonId === TAM_ID
        const canRepoint = !!catalogSources[addonId]
        const resyncFix = { kind: "resync", self: isSelf }
        const sourceFix = canRepoint ? { kind: "repoint", self: isSelf } : null

        let manifestFetched
        try {
            manifestFetched = await fetchManifest(addon.manifestSourceUrl)
        } catch (e) {
            rows.push(issueRow(addonId, "dead-source", addon.manifestSourceUrl,
                "its manifest can no longer be fetched"
                + (canRepoint ? "" : ", and no catalog offers a replacement - uninstall it, or add a catalog that carries it"),
                sourceFix))
            continue
        }

        const m = normalizeManifest(manifestFetched)
        const notes = m.notes || []
        const hashedNotes = notes.filter(noteDef => noteDef.sha)

        if (!manifestFetched.contentHash && hashedNotes.length === 0) {
            rows.push(issueRow(addonId, "unverifiable-source", addon.manifestSourceUrl,
                "carries no contentHash and no per-note hashes, so update detection falls back to comparing "
                + "version numbers and installed content can't be checked at all"
                + (canRepoint ? "" : ", and no catalog offers a hashed replacement"),
                sourceFix))
        } else if (manifestFetched.contentHash && !addon.contentHash) {
            rows.push(issueRow(addonId, "partial-sync", `v${addon.installedVersion}`,
                "the last sync never recorded a contentHash, so at least one note failed to install "
                + "while the version was still advanced",
                resyncFix))
        }

        // What can meaningfully be compared against a manifest `sha`, which is
        // the digest of the *source file*. A note the sync itself never rewrites
        // is meant to diverge - persistent notes hold the user's own data, and a
        // skipOnUpdate note (TAM's own live database among them) keeps whatever
        // it has - so comparing either against the shipped default reports drift
        // forever. Same pairing resolveNotes() makes when it decides to write.
        // A renderAsHTML note stores marked.parse() output rather than the
        // markdown that was hashed, and a binary note isn't worth shipping over
        // the wire to hash.
        const persistentIds = persistentLocalIds(m)
        const contentIds = hashedNotes
            .filter(noteDef => !noteDef.binary
                && !noteDef.renderAsHTML
                && !noteDef.skipOnUpdate
                && !persistentIds.has(noteDef.id))
            .map(noteDef => noteDef.id)
        const live = await readLiveAddon(
            addonId,
            // Same identity resolveNotes() records in #TAMSOURCEURL: none for a
            // renderAsHTML note (it stores a rendering, not the fetched file).
            notes.map(noteDef => ({
                id: noteDef.id,
                sourceId: (!noteDef.renderAsHTML && noteDef.sourceUrl)
                    ? (noteDef.sourceId || noteDef.sourceUrl)
                    : null
            })),
            contentIds
        )

        for (const noteDef of notes) {
            if (live[noteDef.id]) continue
            rows.push(issueRow(addonId, "missing-note", noteDef.title,
                persistentIds.has(noteDef.id)
                    ? `persistent note '${noteDef.id}' is not installed - saved data for it may have been lost`
                    : `declared note '${noteDef.id}' is not installed`,
                resyncFix))
        }

        for (const noteDef of notes) {
            const entry = live[noteDef.id]
            if (!entry || entry.content === null) continue
            if (await sha256Hex(entry.content) !== noteDef.sha) {
                rows.push(issueRow(addonId, "content-drift", noteDef.title,
                    "the installed copy doesn't match the manifest - stale bytes, or edited by hand",
                    resyncFix))
            }
        }

        // A note missing entirely is already a row above; these only look at
        // wiring between notes that both exist, so one failure reads as one row.
        for (const link of (m.children || [])) {
            if (link.parent === "root" || link.parent === "persistence") continue
            const parent = live[link.parent]
            const child = live[link.child]
            if (!parent || !child) continue
            if (!child.parentIds.includes(parent.noteId)) {
                rows.push(issueRow(addonId, "broken-wiring", link.child,
                    `is not parented under '${link.parent}' as the manifest declares`,
                    resyncFix))
            }
        }
        for (const relation of (m.relations || [])) {
            const from = live[relation.from]
            const to = live[relation.to]
            if (!from || !to) continue
            // A disabled addon carries its activation attributes under a
            // `disabled:` prefix, which is still the wiring the manifest declared.
            const present = from.relations.some(attr =>
                (attr.name === relation.type || attr.name === `disabled:${relation.type}`) && attr.value === to.noteId)
            if (!present) {
                rows.push(issueRow(addonId, "broken-wiring", `~${relation.type}`,
                    `from '${relation.from}' to '${relation.to}' is missing`,
                    resyncFix))
            }
        }
        for (const label of (m.labels || [])) {
            const entry = live[label.note]
            if (!entry) continue
            const { name } = parseInheritableName(label.name)
            const value = String(label.value ?? "")
            const present = entry.labels.some(attr =>
                (attr.name === name || attr.name === `disabled:${name}`) && attr.value === value)
            if (!present) {
                rows.push(issueRow(addonId, "broken-wiring", `#${name}`,
                    `on '${label.note}' is missing or holds the wrong value`,
                    resyncFix))
            }
        }
    }

    return rows
}

// Applies one row's repair, and only that row's.
//
// Everything an addon owns is repaired by a re-sync: syncAddon() already
// re-creates missing notes, rewrites drifted content, re-applies wiring and
// records the hashes, so there is no second repair path to keep correct. It also
// still routes persistent notes through the prompt system, so a repair can never
// silently overwrite settings.
// Returns { requiresReload } - true once TAM has rewritten its own notes, whose
// repaired code only starts running on the next load.
async function repairIssue(issue) {
    if (!issue || !issue.fix) return { requiresReload: false }
    if (issue.fix.kind === "delete") {
        await deleteTamNote(issue.fix.noteId)
        return { requiresReload: false }
    }
    if (issue.fix.kind === "repoint") {
        const catalogSources = await catalogSourceIndex()
        const url = catalogSources[issue.addonId]
        const database = await loadDatabase()
        const record = database.installedAddons[issue.addonId]
        if (!url || !record) return { requiresReload: false }
        record.manifestSourceUrl = url
        await saveDatabase(database)
    }
    // Maintenance, not a manual install: a repaired addon must not start
    // claiming the user installed it by hand.
    await syncAddon(issue.addonId, { manual: false })
    return { requiresReload: !!issue.fix.self }
}

// =========================================================================
// Catalog: catalog CRUD + browsing. A "catalog" is a URL serving {"tam-addons": [manifestSourceUrl, ...]}.
// =========================================================================

async function addCatalog(catalogUrl) {
    catalogUrl = catalogUrl.trim()
    if (!catalogUrl) return
    let database = await loadDatabase()
    if (!database.catalogs.includes(catalogUrl)) {
        database.catalogs.push(catalogUrl)
        await saveDatabase(database)
    }
}

async function deleteCatalog(catalogUrl) {
    let database = await loadDatabase()
    database.catalogs = database.catalogs.filter(u => u !== catalogUrl)
    await saveDatabase(database)
}

async function getCatalogs() {
    return (await loadDatabase()).catalogs
}

// Renders a catalog's "Visit Website" link without fetching every addon manifest it lists.
async function fetchCatalogMeta(catalogUrl) {
    return { webUrl: (await fetchJson(catalogUrl)).webUrl || null }
}

// Fetches a catalog's addon list fresh every time.
async function fetchCatalogAddons(catalogUrl) {
    const catalog = await fetchJson(catalogUrl)
    const urls = catalog["tam-addons"] || []
    const results = await Promise.all(urls.map(async (manifestSourceUrl) => {
        try {
            const manifest = await fetchManifest(manifestSourceUrl)
            return { ...manifest, manifestSourceUrl }
        } catch (e) {
            console.error(`TAM: failed to fetch catalog entry ${manifestSourceUrl}`, e)
            return null
        }
    }))
    return { webUrl: catalog.webUrl || null, addons: results.filter(Boolean) }
}

// =========================================================================
// Uninstall / recovery: removing an addon's own note branches, detecting dangling external references, and the orphan-sweep / full-reinitialize recovery tools.
// =========================================================================

// User-triggered maintenance sweep: deletes any #TAMFILEID-tagged note with zero parents.
// Read-only: every #TAMFILEID-tagged note with no parents left. Deleting one is
// deleteTamNote() below, so the diagnosis can list them before anything goes.
async function findOrphanedNotes() {
    return await api.runOnBackend((tamFileIdLabel) => {
        const found = []
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            if (note.getParentNotes().length > 0) continue
            const tamFileId = note.getOwnedLabelValue(tamFileIdLabel)
            if (!tamFileId) continue
            found.push({ noteId: note.noteId, title: note.title, tamFileId })
        }
        return found
    }, [tamFileIdLabel])
}

// Read-only: every note under the addon root that no installed addon claims -
// either untagged, or tagged for an addon that isn't installed any more.
async function findInvalidAddonTreeNotes() {
    const database = await loadDatabase()
    const installedIds = Object.keys(database.installedAddons || {})
    const addonsRootId = await getAddonRootNoteId()
    if (!addonsRootId) return []
    return await api.runOnBackend((tamFileIdLabel, addonsRootId, installedIds) => {
        const installedSet = new Set(installedIds)
        const rootNote = api.getNote(addonsRootId)
        if (!rootNote) return []
        const found = []
        for (const noteId of rootNote.getSubtreeNoteIds()) {
            if (noteId === addonsRootId) continue
            const note = api.getNote(noteId)
            if (!note || note.isDeleted) continue
            const tamFileId = note.getOwnedLabelValue(tamFileIdLabel)
            const addonId = tamFileId ? tamFileId.split("/")[0] : null
            if (tamFileId && installedSet.has(addonId)) continue
            found.push({ noteId: note.noteId, title: note.title, tamFileId })
        }
        return found
    }, [tamFileIdLabel, addonsRootId, installedIds])
}

// The repair behind every "Delete note" row.
async function deleteTamNote(noteId) {
    await api.runOnBackend((noteId) => {
        const note = api.getNote(noteId)
        if (note && !note.isDeleted) note.deleteNote()
    }, [noteId])
}

// Removes every branch this addon owns, never a blanket note-level delete.
async function detachAddonOwnedBranches(addonId, persistentIds = []) {
    const anchorIds = [await getAddonRootNoteId()].filter(Boolean)
    await api.runOnBackend((tamFileIdLabel, addonId, anchorIds, persistentIds) => {
        const prefix = `${addonId}/`
        const persistentSet = new Set(persistentIds)
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            const tamFileId = note.getOwnedLabelValue(tamFileIdLabel)
            if (!tamFileId || !tamFileId.startsWith(prefix)) continue
            if (persistentSet.has(tamFileId.slice(prefix.length))) continue
            const parentsToDetach = []
            let keepsAnyParent = false
            for (const parentNote of note.getParentNotes()) {
                const isAnchor = anchorIds.includes(parentNote.noteId)
                const parentTamId = parentNote.getOwnedLabelValue(tamFileIdLabel)
                const ownedByThisAddon = parentTamId && parentTamId.startsWith(prefix)
                const ownedByAnotherAddon = parentTamId && !ownedByThisAddon && !isAnchor
                if (ownedByAnotherAddon) {
                    keepsAnyParent = true
                } else {
                    parentsToDetach.push(parentNote)
                }
            }
            if (!keepsAnyParent) {
                note.deleteNote()
                continue
            }
            for (const parentNote of parentsToDetach) {
                api.ensureNoteIsAbsentFromParent(note.noteId, parentNote.noteId)
            }
        }
    }, [tamFileIdLabel, addonId, anchorIds, persistentIds])
}

// `deleteData` drops the protected-id list entirely, so the same sweep that tears
// down the structural tree also takes the persistent notes and their anchor.
async function deleteAddon(addonId, options = {}) {
    const { deleteData = false } = options
    if (!addonId.trim()) return
    let database = await loadDatabase()
    const addonRecord = database.installedAddons[addonId]
    const persistentIds = deleteData
        ? []
        : [...persistentLocalIds(addonRecord?.manifest || {}), addonAnchorPersistenceLocalId]
    await detachAddonOwnedBranches(addonId, persistentIds)
    delete database.installedAddons[addonId]
    await saveDatabase(database)
}

// Pre-uninstall safety check: finds every relation pointing into an addon's subtree from outside it.
async function findExternalReferences(addonId) {
    const addonRecord = (await loadDatabase()).installedAddons[addonId]
    if (addonRecord?.manifest?.allowExternalReferences) return []
    const rootNoteId = await resolveAddonRootNoteId(addonId, addonRecord?.manifest)
    if (!rootNoteId) return []
    return await api.runOnBackend((rootNoteId) => {
        const subtreeIds = new Set(api.getNote(rootNoteId).getSubtreeNoteIds())
        const found = []
        for (const noteId of subtreeIds) {
            const note = api.getNote(noteId)
            for (const rel of note.getTargetRelations()) {
                if (subtreeIds.has(rel.noteId)) continue
                const sourceNote = api.getNote(rel.noteId)
                found.push({
                    sourceNoteId: rel.noteId,
                    sourceTitle: sourceNote ? sourceNote.title : "(unknown)",
                    relationName: rel.name,
                    targetNoteId: noteId,
                    targetTitle: note.title
                })
            }
        }
        return found
    }, [rootNoteId])
}

// The user-facing "uninstall" entry point.
async function uninstallAddon(addonId, options = {}) {
    const { deleteData = false } = options
    if (!addonId.trim()) return
    const database = await loadDatabase()
    const record = database.installedAddons[addonId]
    if (!record?.installedVersion) return
    // Runs while every note this addon owns is still in place, and is told
    // whether its data is about to go with them.
    await runHook(addonId, record.manifest?.hooks?.preUninstall, {
        phase: "preUninstall",
        version: record.installedVersion,
        deleteData
    })
    await deleteAddon(addonId, { deleteData })
}

// Whether an addon owns any persistent notes — drives the "delete stored data" option on uninstall.
async function hasPersistentData(addonId) {
    const record = (await loadDatabase()).installedAddons[addonId]
    return persistentLocalIds(record?.manifest || {}).size > 0
}

// Recovery tool: uninstalls every addon except TAM itself, then hard-resets the Database note to just its catalogs and a bare TAM entry.
async function reinitializeDatabase() {
    let database = await loadDatabase()
    for (const addonId of Object.keys(database.installedAddons || {}).filter(id => id !== TAM_ID)) {
        await uninstallAddon(addonId)
    }
    database = await loadDatabase()
    await saveDatabase({
        catalogs: database.catalogs || [],
        installedAddons: {
            [TAM_ID]: {
                manifestSourceUrl: database.installedAddons[TAM_ID]?.manifestSourceUrl
            }
        }
    })
}

// =========================================================================
// UI helpers: rendering support for the TAM.jsx views that isn't part of the install/resolve machinery.
// =========================================================================

// Renders an addon's README as HTML for the detail view.
async function fetchReadmeHtml(addonId, readmeLocalId) {
    const noteId = await resolveStoredNoteId(addonId, readmeLocalId)
    if (!noteId) return null
    const markdown = await api.runOnBackend((noteId) => {
        const note = api.getNote(noteId)
        return note ? note.getContent() : null
    }, [noteId])
    if (markdown === null) return null
    return marked.parse(markdown)
}

// =========================================================================
// Public surface — the same names lib-tam.js has always exported.
// =========================================================================

module.exports.addCatalog = addCatalog
module.exports.deleteCatalog = deleteCatalog
module.exports.getCatalogs = getCatalogs
module.exports.fetchCatalogAddons = fetchCatalogAddons
module.exports.fetchCatalogMeta = fetchCatalogMeta
module.exports.getAllAddons = getAllAddons
module.exports.checkForAddonUpdates = checkForAddonUpdates
module.exports.syncAddon = syncAddon
module.exports.installByUrl = installByUrl
module.exports.uninstallAddon = uninstallAddon
module.exports.hasPersistentData = hasPersistentData
module.exports.reinitializeDatabase = reinitializeDatabase
module.exports.findExternalReferences = findExternalReferences
module.exports.enableAddon = enableAddon
module.exports.getPendingPrompts = getPendingPrompts
module.exports.resolvePrompt = resolvePrompt
module.exports.clearPendingPrompts = clearPendingPrompts
module.exports.fetchReadmeHtml = fetchReadmeHtml
module.exports.diagnose = diagnose
module.exports.repairIssue = repairIssue
