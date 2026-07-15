// The note-resolution engine: turns a manifest's notes[]/children[] into real, live Trilium
// notes tagged #TAMFILEID, idempotently. Works purely from the manifest and note tree it's
// given — no Database/sync-state knowledge lives in this file (see libTAMSync.js for that).

const marked = require("marked.min.js")
const { tamFileIdLabel } = require("libTAMDatabase.js")
const { fetchWithRetry } = require("libTAMNetwork.js")
const { buildParentMaps, topologicalSort, resolveStoredNoteId } = require("libTAMManifestUtils.js")

// Renders an addon's README (its `readmeNote` local id, resolved via #TAMFILEID like any
// other note) as HTML for the detail view. Null if unset or unresolvable.
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

// Resolves every note in scope against the live tree by #TAMFILEID, find-or-create (idempotent
// against a retried/partial install). Content is fetched fresh from sourceUrl each call; a note's
// fetch failure is logged and it (and its children) are skipped, not fatal. entryLocalId/scopeLocalIds
// let a lazily-resolved dependency export (see computeLocalClosure) reuse this scoped to just its own notes.
async function resolveNotes(m, addonId, fallbackParentNoteId, manifestBaseUrl, options = {}) {
    const { rootExternallyParented = false, entryLocalId = m.root, scopeLocalIds = null } = options
    const { primaryParent, extraParents } = buildParentMaps(m.children)

    // A scoped (dependency-export) resolution only sees the export's closure, but a
    // closure note's first-declared parent is usually the addon root, which lives
    // outside it. Re-anchor such a note to an in-scope declared parent (the edge
    // that pulled it into the closure) instead of skipping it as unresolvable.
    const effectiveParent = { ...primaryParent }
    if (scopeLocalIds) {
        for (const localId of scopeLocalIds) {
            const declaredPrimary = primaryParent[localId]
            if (localId !== entryLocalId && declaredPrimary && !scopeLocalIds.has(declaredPrimary)) {
                const inScopeParent = (extraParents[localId] || []).find(p => scopeLocalIds.has(p))
                if (inScopeParent) effectiveParent[localId] = inScopeParent
            }
        }
    }

    // A persisted note (AddonData: relation target) must never have its
    // content overwritten here — see connectAddonPersistence below for why.
    const persistedLocalIds = new Set(
        (m.relations || [])
            .filter(r => r.type.startsWith("AddonData:"))
            .map(r => r.to)
    )

    const noteIds = (scopeLocalIds ? m.notes.filter(n => scopeLocalIds.has(n.id)) : m.notes).map(n => n.id)
    const sortedIds = topologicalSort(noteIds, effectiveParent)

    const noteMap = {}
    for (const localId of sortedIds) {
        const noteDef = m.notes.find(n => n.id === localId)
        if (!noteDef) continue

        // entryLocalId's real parent lives outside the closure's scope and must never be
        // chased; it always uses fallbackParentNoteId instead.
        const parentLocalId = localId === entryLocalId ? null : effectiveParent[localId]
        const parentRealId = parentLocalId ? noteMap[parentLocalId] : fallbackParentNoteId
        if (parentLocalId && !parentRealId) {
            console.error(`TAM: skipping note '${localId}' of ${addonId} — its parent '${parentLocalId}' failed to resolve`)
            continue
        }

        const noteType = noteDef.type ?? "text"
        const mime = noteDef.mime ?? "text/html"
        const isBinary = noteDef.binary ?? false
        const tamFileId = `${addonId}/${localId}`
        const isPersisted = persistedLocalIds.has(localId)
        // TAM's own root note lives wherever the user manually ZIP-imported
        // it — an ancestor of the Addons tree, not a sibling under it. Never
        // touch its parent when found already existing (which, in practice,
        // is the only branch this ever hits for it — see syncAddon).
        const skipParenting = localId === entryLocalId && rootExternallyParented

        let absoluteSourceUrl = null
        if (noteDef.sourceUrl) {
            try {
                absoluteSourceUrl = new URL(noteDef.sourceUrl, manifestBaseUrl).href
            } catch (e) {
                console.error(`TAM: note '${localId}' of ${addonId} has an unresolvable sourceUrl '${noteDef.sourceUrl}'`, e)
            }
        }

        // "renderAsHTML": true converts a markdown source into a rendered text/text-html note.
        // Runs frontend-side (`marked` isn't reachable from the backend callback below),
        // so this needs its own fetch rather than reusing the backend one.
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
                async (tamFileIdLabel, tamFileId, parentRealId, title, noteType, mime, sourceUrl, explicitContent, isBinary, skipOnUpdate, promptOnUpdate, isPersisted, skipParenting) => {
                    // Duplicated rather than shared with the module-level fetchWithRetry —
                    // this callback runs in a separate backend context that can't close over it.
                    async function fetchWithRetry(url, maxRetries = 5) {
                        for (let attempt = 0; ; attempt++) {
                            const response = await fetch(url)
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

                    const willWriteContent = !existing || !(skipOnUpdate || promptOnUpdate || isPersisted)

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
                        if (willWriteContent) {
                            if (existing.type !== noteType || existing.mime !== mime) {
                                existing.type = noteType
                                existing.mime = mime
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
                    return note.noteId
                },
                [tamFileIdLabel, tamFileId, parentRealId, noteDef.title, effectiveType, effectiveMime, sourceUrlForBackend, explicitContent, isBinary,
                    !!noteDef.skipOnUpdate, !!noteDef.promptOnUpdate, isPersisted, skipParenting]
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

// Clones every resolved note into every parent its manifest currently declares, and detaches
// it from parents tagged with this addon's own #TAMFILEID prefix that it no longer declares.
async function reconcileNoteParenting(m, addonId, noteMap, fallbackParentNoteId, rootExternallyParented, entryLocalId = m.root) {
    const { primaryParent, extraParents } = buildParentMaps(m.children)

    for (const [childLocalId, parentLocalIds] of Object.entries(extraParents)) {
        const childRealId = noteMap[childLocalId]
        if (!childRealId) continue
        for (const parentLocalId of parentLocalIds) {
            const parentRealId = noteMap[parentLocalId]
            if (!parentRealId) continue
            await api.runOnBackend((sourceId, parentId) => {
                api.ensureNoteIsPresentInParent(sourceId, parentId)
            }, [childRealId, parentRealId])
        }
    }

    for (const localId of Object.keys(noteMap)) {
        if (localId === entryLocalId && rootExternallyParented) continue
        const noteRealId = noteMap[localId]
        if (!noteRealId) continue

        const declaredParentLocalIds = [primaryParent[localId], ...(extraParents[localId] || [])].filter(Boolean)
        const desiredRealParents = declaredParentLocalIds
            .map(pid => noteMap[pid])
            .filter(Boolean)
        if (localId === entryLocalId && !rootExternallyParented && fallbackParentNoteId) {
            desiredRealParents.push(fallbackParentNoteId)
        }
        if (desiredRealParents.length === 0) continue

        // A declared parent that simply wasn't resolved in this call (e.g. it lies
        // outside a dependency-export closure's scope) must never be detached —
        // only parents the manifest genuinely no longer declares.
        const declaredParentTamIds = declaredParentLocalIds.map(pid => `${addonId}/${pid}`)

        await api.runOnBackend((tamFileIdLabel, addonId, noteId, desiredRealParents, declaredParentTamIds) => {
            const note = api.getNote(noteId)
            const currentParentIds = note.getParentNotes().map(p => p.noteId)
            for (const parentId of currentParentIds) {
                if (desiredRealParents.includes(parentId)) continue
                const parentNote = api.getNote(parentId)
                const parentTamId = parentNote ? parentNote.getLabelValue(tamFileIdLabel) : null
                if (parentTamId && parentTamId.startsWith(`${addonId}/`) && !declaredParentTamIds.includes(parentTamId)) {
                    api.ensureNoteIsAbsentFromParent(noteId, parentId)
                }
            }
        }, [tamFileIdLabel, addonId, noteRealId, desiredRealParents, declaredParentTamIds])
    }
}

// Deletes any live #TAMFILEID-tagged note of this addon whose local id is no longer
// declared in the current manifest (resolveNotes only resolves notes it still declares).
async function pruneRemovedNotes(m, addonId) {
    await api.runOnBackend((tamFileIdLabel, addonId, currentLocalIds) => {
        const currentSet = new Set(currentLocalIds)
        const prefix = `${addonId}/`
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            const value = note.getLabelValue(tamFileIdLabel)
            if (!value || !value.startsWith(prefix)) continue
            const localId = value.slice(prefix.length)
            if (!currentSet.has(localId)) note.deleteNote()
        }
    }, [tamFileIdLabel, addonId, m.notes.map(n => n.id)])
}

module.exports.resolveNotes = resolveNotes
module.exports.reconcileNoteParenting = reconcileNoteParenting
module.exports.pruneRemovedNotes = pruneRemovedNotes
module.exports.fetchReadmeHtml = fetchReadmeHtml
