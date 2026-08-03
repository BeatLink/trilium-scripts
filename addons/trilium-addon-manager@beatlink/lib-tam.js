// TAM's entire backend/data layer, in one require()-able JS note; section banners below group functions by domain.

const marked = require("marked.min.js")

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

async function fetchManifest(manifestSourceUrl) {
    return await fetchJson(manifestSourceUrl)
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
        root: null
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
    const { rootExternallyParented = false, entryLocalId = null, scopeLocalIds = null } = options
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
        let realNoteId
        try {
            realNoteId = await api.runAsyncOnBackendWithManualTransactionHandling(
                async (tamFileIdLabel, sourceUrlLabel, tamFileId, parentRealId, title, noteType, mime, sourceUrl, explicitContent, isBinary, skipOnUpdate, promptOnUpdate, skipParenting) => {
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
                    if (!existing && sourceUrl) {
                        const shared = api.getNoteWithLabel(sourceUrlLabel, sourceUrl)
                        if (shared && !shared.isDeleted) {
                            if (!skipParenting) api.ensureNoteIsPresentInParent(shared.noteId, parentRealId)
                            return shared.noteId
                        }
                    }
                    const willWriteContent = !existing || !(skipOnUpdate || promptOnUpdate)
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
                        if (existing.getOwnedLabelValue(sourceUrlLabel) !== (sourceUrl || "")) {
                            existing.setLabel(sourceUrlLabel, sourceUrl || "")
                        }
                        if (willWriteContent) {
                            if (existing.type !== noteType || existing.mime !== mime || existing.title !== title) {
                                existing.type = noteType
                                existing.mime = mime
                                existing.title = title
                                existing.save()
                            }
                            existing.setContent(finalContent)
                        }
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
                    note.setLabel(sourceUrlLabel, sourceUrl || "")
                    return note.noteId
                },
                [tamFileIdLabel, sourceUrlLabel, tamFileId, parentRealId, noteDef.title, effectiveType, effectiveMime, sourceUrlForBackend, explicitContent, isBinary,
                    !!noteDef.skipOnUpdate || persistentIds.has(localId), !!noteDef.promptOnUpdate, skipParenting]
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
async function collectPendingPrompts(addonId, m) {
    const persistentIds = persistentLocalIds(m)
    if (persistentIds.size === 0) return []
    const prompts = []
    for (const noteDef of (m.notes || [])) {
        if (!persistentIds.has(noteDef.id)) continue
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

async function resolvePrompt(addonId, noteLocalId, useNew) {
    if (!useNew) return
    const database = await loadDatabase()
    const prompt = (database.installedAddons?.[addonId]?.persistence?.pendingPrompts || [])
        .find(p => p.noteLocalId === noteLocalId)
    if (!prompt) return
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
        deferredRelations = null
    } = options
    const inScope = (localId) => !scopeLocalIds || scopeLocalIds.has(localId)
    const resolved = await resolveNotes(m, addonId, parentRealId, {
        entryLocalId, scopeLocalIds, rootExternallyParented
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
    const fetchUrl = manifestSourceUrl || existing?.manifestSourceUrl
    if (!fetchUrl) throw new Error(`TAM: no manifestSourceUrl available to sync '${addonId}' (not installed yet, and none provided)`)
    const manifest = await fetchManifest(fetchUrl)
    const m = normalizeManifest(manifest)
    if (isSelf && !m.root) throw new Error(`TAM: manifest for ${addonId} is missing required 'root' field`)
    const pendingPrompts = await collectPendingPrompts(addonId, m)
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
            deferredRelations
        })
    }
    await resolveManifest(m, addonId, addonRootAnchorId, {
        entryLocalId: isSelf ? m.root : null,
        rootExternallyParented: isSelf,
        scopeLocalIds: structuralScope,
        existingNoteMap: noteMap
    })
    for (const rel of deferredRelations) {
        if (noteMap[rel.from] && noteMap[rel.to]) await applyRelation(noteMap[rel.from], rel.type, noteMap[rel.to])
    }
    if (isSelf && !noteMap[m.root]) throw new Error(`TAM: root note '${m.root}' was not resolved for ${addonId}`)
    await pruneRemovedNotes(m, addonId)
    const storedManifest = stripManifestForStorage(m)
    const meta = extractAddonMeta(manifest)
    if (!wasInstalled) {
        const priorPersistence = database.installedAddons[addonId]?.persistence
        database.installedAddons[addonId] = {
            installedVersion: manifest.latestVersion,
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
        rec.manifestSourceUrl = fetchUrl
        rec.meta = meta
        rec.manifest = storedManifest
        rec.updateAvailable = false
        if (manual && !rec.manuallyInstalled) rec.manuallyInstalled = true
    }
    await saveDatabase(database)
    if (!wasInstalled && !isSelf) await enableAddon(addonId, false)
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

// Fetches every installed addon's own manifestSourceUrl and compares latestVersion against installedVersion.
async function checkForAddonUpdates() {
    let database = await loadDatabase()
    const installed = database.installedAddons || {}
    await Promise.all(Object.entries(installed).map(async ([addonId, addon]) => {
        if (!addon.installedVersion || !addon.manifestSourceUrl) return
        try {
            const manifest = await fetchManifest(addon.manifestSourceUrl)
            if (manifest.latestVersion) {
                addon.updateAvailable = versionCompare(manifest.latestVersion, addon.installedVersion) > 0
                if (addon.updateAvailable) {
                    addon.availableVersion = manifest.latestVersion
                } else {
                    delete addon.availableVersion
                }
            }
        } catch (e) {
        }
    }))
    await saveDatabase(database)
}

// Read-only audit of the installed-addon graph against the real Trilium note tree.
async function validateDatabase() {
    const database = await loadDatabase()
    const issues = []
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
        issues.push({
            addonId: tamFileId.split("/")[0],
            message: `TAMFILEID '${tamFileId}' is duplicated across notes ${noteIds.join(", ")}`
        })
    }
    for (const [addonId, addon] of Object.entries(database.installedAddons || {})) {
        const isInstalled = !!addon.installedVersion
        const manifest = addon.manifest || {}
        const persistentIds = isInstalled ? [...persistentLocalIds(manifest)] : []
        const rootLocalId = manifest.root ?? addonAnchorRootLocalId
        const backendIssues = await api.runOnBackend((tamFileIdLabel, addonId, manifest, rootLocalId, persistentIds, isInstalled) => {
            const found = []
            function resolveLocal(localId) {
                if (!localId) return null
                const note = api.getNoteWithLabel(tamFileIdLabel, `${addonId}/${localId}`)
                return (note && !note.isDeleted) ? note.noteId : null
            }
            if (isInstalled) {
                if (!resolveLocal(rootLocalId)) {
                    found.push(`root note ('${rootLocalId}') is missing`)
                }
                if (manifest.settingsNote && !resolveLocal(manifest.settingsNote)) {
                    found.push(`settings note ('${manifest.settingsNote}') is missing`)
                }
            }
            for (const localId of persistentIds) {
                if (!resolveLocal(localId)) {
                    found.push(`persistent note ('${localId}') is missing — user data may have been lost`)
                }
            }
            return found
        }, [tamFileIdLabel, addonId, manifest, rootLocalId, persistentIds, isInstalled])
        for (const message of backendIssues) {
            issues.push({ addonId, message })
        }
    }
    return issues
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
async function sweepOrphanedNotes() {
    return await api.runOnBackend((tamFileIdLabel) => {
        const removed = []
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            if (note.getParentNotes().length > 0) continue
            const tamFileId = note.getOwnedLabelValue(tamFileIdLabel)
            if (!tamFileId) continue
            removed.push(tamFileId)
            note.deleteNote()
        }
        return removed
    }, [tamFileIdLabel])
}

// User-triggered maintenance sweep: deletes any note under the global Addons root with no #TAMFILEID or an addonId that isn't currently installed.
async function sweepInvalidAddonTreeNotes() {
    const database = await loadDatabase()
    const installedIds = Object.keys(database.installedAddons || {})
    const addonsRootId = await getAddonRootNoteId()
    if (!addonsRootId) return []
    return await api.runOnBackend((tamFileIdLabel, addonsRootId, installedIds) => {
        const installedSet = new Set(installedIds)
        const rootNote = api.getNote(addonsRootId)
        if (!rootNote) return []
        const removed = []
        for (const noteId of rootNote.getSubtreeNoteIds()) {
            if (noteId === addonsRootId) continue
            const note = api.getNote(noteId)
            if (!note || note.isDeleted) continue
            const tamFileId = note.getOwnedLabelValue(tamFileIdLabel)
            const addonId = tamFileId ? tamFileId.split("/")[0] : null
            if (tamFileId && installedSet.has(addonId)) continue
            removed.push({ noteId: note.noteId, title: note.title, tamFileId })
            note.deleteNote()
        }
        return removed
    }, [tamFileIdLabel, addonsRootId, installedIds])
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

async function deleteAddon(addonId) {
    if (!addonId.trim()) return
    let database = await loadDatabase()
    const addonRecord = database.installedAddons[addonId]
    const persistentIds = [...persistentLocalIds(addonRecord?.manifest || {}), addonAnchorPersistenceLocalId]
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
async function uninstallAddon(addonId) {
    if (!addonId.trim()) return
    const database = await loadDatabase()
    if (!database.installedAddons[addonId]?.installedVersion) return
    await deleteAddon(addonId)
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
module.exports.reinitializeDatabase = reinitializeDatabase
module.exports.findExternalReferences = findExternalReferences
module.exports.enableAddon = enableAddon
module.exports.getPendingPrompts = getPendingPrompts
module.exports.resolvePrompt = resolvePrompt
module.exports.clearPendingPrompts = clearPendingPrompts
module.exports.validateDatabase = validateDatabase
module.exports.fetchReadmeHtml = fetchReadmeHtml
module.exports.sweepOrphanedNotes = sweepOrphanedNotes
module.exports.sweepInvalidAddonTreeNotes = sweepInvalidAddonTreeNotes
