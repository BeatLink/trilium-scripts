// TAM's entire backend/data layer in one module. Previously split across
// libTAMDatabase / libTAMNetwork / libTAMManifestUtils / libTAMNoteResolver /
// libTAMCatalog / libTAMSync / libTAMLifecycle / libTAMPersistence /
// libTAMUninstall (+ this facade); merged into one file so TAM has a single
// require()-able JS note. Section banners below group the functions by domain;
// the public surface is the same one lib-tam.js always exported (bottom).
//
// Only external dependency: marked (markdown -> HTML for READMEs / renderAsHTML).

const marked = require("marked.min.js")


// =========================================================================
// Constants: label/relation names, TAM's own id, and the set of "activation"
// attribute names enableAddon toggles under a disabled: prefix.
// =========================================================================

const databaseLabel = "database"
const addonRootLabel = "addonRoot"
const addonPersistenceLabel = "addonPersistence"
const tamFileIdLabel = "TAMFILEID"
// Identity of a persisted (AddonData:) note living under "Addon Data". Deliberately a
// SEPARATE namespace from tamFileIdLabel: every uninstall/prune sweep scans by #TAMFILEID,
// so a persisted note tagged only with this can never be caught by them. Value: `addonId/key`.
const tamDataIdLabel = "TAMDATAID"
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
// Database access: the Database note's read/write and the relation-id getters
// resolved via api.currentNote — only valid while this code executes in the note
// the manifest's database/addonRoot/addonPersistence relations point "from".
// =========================================================================

async function getDatabaseNoteId() {
    return await api.currentNote.getRelationValue(databaseLabel)
}

async function loadDatabase() {
    const database = await api.runOnBackend((databaseId) => {
        return JSON.parse(api.getNote(databaseId).getContent())
    }, [await getDatabaseNoteId()])
    if (!database.catalogs) database.catalogs = []
    if (!database.installedAddons) database.installedAddons = {}
    return database
}

async function saveDatabase(database) {
    return await api.runOnBackend((databaseId, database) => {
        return api.getNote(databaseId).setContent(JSON.stringify(database, null, 4))
    }, [await getDatabaseNoteId(), database])
}

async function getAddonRootNoteId() {
    return await api.currentNote.getRelationValue(addonRootLabel)
}

async function getPersistenceNoteId() {
    return await api.currentNote.getRelationValue(addonPersistenceLabel)
}

// =========================================================================
// Network: fetch/retry/version-comparison helpers — pure networking, no note-tree
// access. fetchWithRetry is duplicated inline inside every api.runOnBackend callback
// that also needs it, since those callbacks run in a separate serialized context.
// =========================================================================

function versionCompare(remote, local) {
    return remote.localeCompare(local, undefined, { numeric: true, sensitivity: 'base' })
}

// Retries on HTTP 429, honoring Retry-After when sent, else exponential backoff.
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

// Fetch-and-parse a URL on the backend, retrying through 429s.
async function fetchJson(url) {
    return await api.runAsyncOnBackendWithManualTransactionHandling(async (url) => {
        // Own copy of fetchWithRetry: this callback is serialized and runs in
        // a separate backend context that can't close over the module-level one.
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
        const response = await fetchWithRetry(url)
        return await response.json()
    }, [url])
}

async function fetchManifest(manifestSourceUrl) {
    return await fetchJson(manifestSourceUrl)
}

// =========================================================================
// Manifest shape: pure helpers operating on a fetched/stored manifest object —
// parsing, normalizing, computing parent/dependency/closure relationships. No
// note-tree or Database access lives here.
// =========================================================================

// Splits children[] into each note's first-declared parent (where it actually
// resolves) vs. any later parents (wired as clone branches by reconcileNoteParenting).
function buildParentMaps(children) {
    const primaryParent = {}
    const extraParents = {}
    for (const c of (children || []).filter(c => !c.addon)) {
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

// Snapshots the addon's manifest structure (minus sourceUrl/content) for storage —
// manifestSourceUrl only ever serves the current version, so this is the only
// record of what's actually installed once a newer one is published.
function stripManifestForStorage(m) {
    return {
        root: m.root,
        settingsNote: m.settingsNote,
        readmeNote: m.readmeNote,
        notes: (m.notes || []).map(n => ({
            id: n.id,
            title: n.title,
            type: n.type ?? "text",
            mime: n.mime ?? "text/html",
            ...(n.binary ? { binary: true } : {}),
            ...(n.skipOnUpdate ? { skipOnUpdate: true } : {}),
            ...(n.promptOnUpdate ? { promptOnUpdate: true } : {})
        })),
        children: m.children || [],
        relations: m.relations || [],
        labels: m.labels || [],
        dependencies: m.dependencies || [],
        exports: m.exports || {}
    }
}

// A dependencies[] entry is either a bare id string or an explicit
// {id, manifestSourceUrl} object; this pulls the id out of either shape.
function dependencyId(depEntry) {
    return typeof depEntry === "string" ? depEntry : depEntry.id
}

// The reverse of `dependencies`, recomputed from every other installed addon's
// own stored manifest rather than tracked as its own field.
function getDependents(database, addonId) {
    const addons = database.installedAddons || {}
    return Object.entries(addons)
        .filter(([depId, addon]) => depId !== addonId && (addon.manifest?.dependencies || []).some(d => dependencyId(d) === addonId))
        .map(([depId]) => depId)
}

// Resolves the manifestSourceUrl for a not-yet-installed dependency: an explicit
// {id, manifestSourceUrl} wins, else a bare id string falls back to catalogContext
// (the {id: manifestSourceUrl} map of the catalog being installed from). Null if neither has it.
function resolveDependencyUrl(depEntry, catalogContext) {
    if (typeof depEntry === "object" && depEntry.manifestSourceUrl) return depEntry.manifestSourceUrl
    const depId = dependencyId(depEntry)
    if (catalogContext && catalogContext[depId]) return catalogContext[depId]
    return null
}

// Trilium attribute names support a trailing "(inheritable)" modifier — a
// convention borrowed from label-definition syntax. Parse it off here so a
// manifest label like "iconClass(inheritable)" sets a real isInheritable
// attribute instead of literally creating one named "iconClass(inheritable)".
function parseInheritableName(name) {
    const match = name.match(/^(.*)\(inheritable\)$/)
    return match ? { name: match[1], isInheritable: true } : { name, isInheritable: false }
}

// Normalizes a fetched manifest document into the `m` sub-object shape used
// throughout: the TAM-next `{manifest: {...}}` wrapper if present, else a
// flat top-level manifest treated as having no children/dependencies/exports
// (the shape a hand-authored, non-TAM-native manifest would have).
function normalizeManifest(manifestFetched) {
    return manifestFetched.manifest ?? {
        notes: manifestFetched.notes ?? [],
        children: [],
        relations: manifestFetched.relations ?? [],
        labels: manifestFetched.labels ?? [],
        root: null,
        dependencies: [],
        exports: {}
    }
}

// The transitive closure of local ids an export needs: every note reachable outward from
// startLocalId via same-addon children[]/relations[]. Never includes ancestors — the export
// is cloned directly wherever the consumer needs it.
function computeLocalClosure(m, startLocalId) {
    const closure = new Set([startLocalId])
    const localNoteIds = new Set((m.notes || []).map(n => n.id))
    let changed = true
    while (changed) {
        changed = false
        for (const c of (m.children || []).filter(c => !c.addon)) {
            if (closure.has(c.parent) && !closure.has(c.child)) {
                closure.add(c.child)
                changed = true
            }
        }
        for (const rel of (m.relations || [])) {
            if (rel.addon || !localNoteIds.has(rel.to)) continue
            if (closure.has(rel.from) && !closure.has(rel.to)) {
                closure.add(rel.to)
                changed = true
            }
        }
    }
    return closure
}

// =========================================================================
// Note resolution: turns a manifest's notes[]/children[]/labels[] into real, live
// Trilium notes tagged #TAMFILEID, idempotently, and prunes ones it no longer
// declares. Works purely from the manifest and note tree — no Database/sync state.
// =========================================================================

// Resolves a single real note id live, by TAMFILEID, for whichever local id
// a stored manifest declares (e.g. its own `root`/`settingsNote`). Returns
// null if the local id is unset or the note doesn't currently exist.
async function resolveStoredNoteId(addonId, localId) {
    if (!localId) return null
    return await api.runOnBackend((tamFileIdLabel, tamFileId) => {
        const note = api.getNoteWithLabel(tamFileIdLabel, tamFileId)
        return (note && !note.isDeleted) ? note.noteId : null
    }, [tamFileIdLabel, `${addonId}/${localId}`])
}

async function applyLabels(labels, noteMap) {
    for (const label of labels) {
        const realNoteId = noteMap[label.note]
        if (!realNoteId) continue
        const { name, isInheritable } = parseInheritableName(label.name)
        await api.runOnBackend((noteId, name, value, isInheritable) => {
            const note = api.getNote(noteId)
            // If this addon is currently disabled, its activation labels
            // live under a "disabled:" prefix — write there instead of
            // creating a live-named duplicate that would silently re-enable
            // just this one label the moment it gets reapplied.
            const disabledName = `disabled:${name}`
            const targetName = note.hasLabel(disabledName) ? disabledName : name
            if (isInheritable) {
                note.removeLabel(targetName)
                note.addLabel(targetName, value, true)
            } else {
                note.setLabel(targetName, value)
            }
        }, [realNoteId, name, String(label.value ?? ""), isInheritable])
    }
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
                async (tamFileIdLabel, tamFileId, parentRealId, title, noteType, mime, sourceUrl, explicitContent, isBinary, skipOnUpdate, promptOnUpdate, skipParenting) => {
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
                    return note.noteId
                },
                [tamFileIdLabel, tamFileId, parentRealId, noteDef.title, effectiveType, effectiveMime, sourceUrlForBackend, explicitContent, isBinary,
                    !!noteDef.skipOnUpdate, !!noteDef.promptOnUpdate, skipParenting]
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

// =========================================================================
// Persistence: persisted user data (AddonData: notes). The persisted copy is a
// FULL, independent copy under "Addon Data" identified by its own #TAMDATAID
// (never #TAMFILEID), so no #TAMFILEID uninstall/prune sweep can delete it.
// =========================================================================

// One-time migration off the old design, run BEFORE resolveNotes so it can't clobber user data.
// In the old model the persisted copy was a duplicateSubtree clone living under "Addon Data" that
// kept the origin's copied #TAMFILEID; the in-tree origin was deleted. So the clone is now the
// SOLE bearer of `addonId/key` in the #TAMFILEID namespace — resolveNotes' find-by-#TAMFILEID
// would adopt it as the in-tree note and overwrite it with the shipped default. Re-tagging the
// recorded clone to #TAMDATAID first makes that lookup miss it (a fresh throwaway origin is
// created instead), and connectAddonPersistence then links the relation back to this same note.
async function migrateLegacyPersistence(addonId) {
    const database = await loadDatabase()
    const persistenceNotes = database.installedAddons?.[addonId]?.persistence?.persistenceNotes
    if (!persistenceNotes || Object.keys(persistenceNotes).length === 0) return

    await api.runOnBackend((tamFileIdLabel, tamDataIdLabel, addonId, persistenceNotes) => {
        for (const [key, noteId] of Object.entries(persistenceNotes)) {
            const note = api.getNote(noteId)
            if (!note || note.isDeleted) continue
            if (note.getLabelValue(tamDataIdLabel)) continue // already migrated
            note.removeLabel(tamFileIdLabel)
            note.setLabel(tamDataIdLabel, `${addonId}/${key}`)
        }
    }, [tamFileIdLabel, tamDataIdLabel, addonId, persistenceNotes])
}

async function connectAddonPersistence(addonId) {
    const persistenceRoot = await getPersistenceNoteId()
    let database = await loadDatabase()

    const addonRecord = database.installedAddons[addonId]
    if (!addonRecord.persistence) addonRecord.persistence = {}
    if (!addonRecord.persistence.persistenceNotes) addonRecord.persistence.persistenceNotes = {}

    const addonNoteId = await resolveStoredNoteId(addonId, addonRecord.manifest?.root)
    if (!addonNoteId) return
    const existingNotes = addonRecord.persistence.persistenceNotes

    // Single pass so a UI reload can't interrupt it partway: for each AddonData: relation, find
    // (by #TAMDATAID, else adopt the recorded legacy clone, else make a fresh copy) the persisted
    // note under "Addon Data". Every reference to the shipped-default origin is then moved to the
    // copy — the AddonData: relation and any OTHER inbound relation (e.g. templates' `template`
    // relation on root) — before the origin is deleted, so nothing dangles. Uses removeRelation +
    // addRelation rather than setRelation, since removeRelation updates becca's reverse index for
    // the old target, preventing the origin's deleteNote cascade from killing a rewired relation.
    const outcome = await api.runOnBackend((tamFileIdLabel, tamDataIdLabel, addonNoteId, persistenceRoot, addonId, existingPersistRoot, existingNotes) => {
        const result = {}
        const toDelete = []
        const originToPersisted = {}
        let persistRoot = existingPersistRoot

        function tagAsPersisted(note, key) {
            // A persisted note lives only in the #TAMDATAID namespace. Strip any #TAMFILEID it
            // inherited (a legacy clone carries the origin's copied tag; duplicateSubtree copies
            // it too) so no #TAMFILEID sweep can see it, and stamp its stable data identity.
            note.removeLabel(tamFileIdLabel)
            note.setLabel(tamDataIdLabel, `${addonId}/${key}`)
        }
        function ensurePersistRoot() {
            if (persistRoot && api.getNote(persistRoot)) return persistRoot
            const rootResult = api.createTextNote(persistenceRoot, addonId, "")
            rootResult.note.setLabel("iconClass", "bx bx-customize")
            persistRoot = rootResult.note.noteId
            return persistRoot
        }

        for (const noteId of api.getNote(addonNoteId).getSubtreeNoteIds()) {
            const note = api.getNote(noteId)
            // TAM's own root descends into "Addons", the parent of every other addon's tree —
            // without this guard, TAM's self-sync would corrupt every other addon's bookkeeping.
            const ownTamFileId = note.getLabelValue(tamFileIdLabel)
            if (!ownTamFileId || !ownTamFileId.startsWith(`${addonId}/`)) continue
            // Snapshot name+value up front: the remove/add below mutates this note's attribute
            // list, and a note like templates' root carries many AddonData: relations at once.
            const addonDataRelations = note.getRelations()
                .filter(r => r.name.includes("AddonData:"))
                .map(r => ({ name: r.name, value: r.value }))
            for (const relation of addonDataRelations) {
                const key = relation.name.split("AddonData:")[1]
                const origNoteId = relation.value

                // 1. Authoritative link: a persisted note already carrying this data identity.
                let persisted = api.getNoteWithLabel(tamDataIdLabel, `${addonId}/${key}`)
                if (persisted && persisted.isDeleted) persisted = null

                // 2. Migration: a legacy clone from the old design, recorded but not yet re-tagged.
                if (!persisted && existingNotes[key]) {
                    const legacy = api.getNote(existingNotes[key])
                    if (legacy && !legacy.isDeleted) {
                        tagAsPersisted(legacy, key)
                        persisted = legacy
                    }
                }

                // 3. First install: make a full, independent copy of the shipped-default origin.
                if (!persisted) {
                    const origTitle = api.getNote(origNoteId).title
                    const dup = api.duplicateSubtree(origNoteId, ensurePersistRoot())
                    dup.note.title = origTitle
                    dup.note.save()
                    tagAsPersisted(dup.note, key)
                    persisted = dup.note
                }

                note.removeRelation(relation.name)
                note.addRelation(relation.name, persisted.noteId)
                result[key] = persisted.noteId
                if (origNoteId !== persisted.noteId) {
                    toDelete.push(origNoteId)
                    originToPersisted[origNoteId] = persisted.noteId
                }
            }
        }

        // Move every OTHER inbound relation off each origin onto its persisted copy, so a
        // reference like templates' `root --template--> special` survives the origin's deletion.
        // (The AddonData: relation itself was already rewired above.) duplicateSubtree copied the
        // origin's OUTBOUND relations onto the copy, but inbound ones still point at the origin.
        for (const [origNoteId, persistedNoteId] of Object.entries(originToPersisted)) {
            const origin = api.getNote(origNoteId)
            if (!origin) continue
            const inbound = origin.getTargetRelations()
                .filter(r => !r.name.includes("AddonData:"))
                .map(r => ({ name: r.name, sourceId: r.noteId }))
            for (const { name, sourceId } of inbound) {
                const source = api.getNote(sourceId)
                if (!source) continue
                source.removeRelation(name)
                source.addRelation(name, persistedNoteId)
            }
        }

        for (const noteId of toDelete) {
            const note = api.getNote(noteId)
            if (note) note.deleteNote()
        }

        if (persistRoot) {
            const rootNote = api.getNote(persistRoot)
            if (rootNote && rootNote.getChildNotes().length === 0) {
                rootNote.deleteNote()
                persistRoot = null
            }
        }

        return { persistRoot, persistenceNotes: result }
    }, [tamFileIdLabel, tamDataIdLabel, addonNoteId, persistenceRoot, addonId, addonRecord.persistence.rootNote || null, existingNotes])

    if (outcome.persistRoot) {
        addonRecord.persistence.rootNote = outcome.persistRoot
    } else {
        delete addonRecord.persistence.rootNote
    }
    addonRecord.persistence.persistenceNotes = {
        ...existingNotes,
        ...outcome.persistenceNotes
    }
    await saveDatabase(database)
}

// Removes any recorded persistence root that's now empty and clears the stale reference.
async function cleanupEmptyPersistenceRoots() {
    let database = await loadDatabase()
    let changed = false

    for (const [addonId, addonRecord] of Object.entries(database.installedAddons || {})) {
        const persistence = addonRecord.persistence
        const rootNoteId = persistence?.rootNote
        if (!rootNoteId) continue

        const isEmpty = await api.runOnBackend((rootNoteId) => {
            const note = api.getNote(rootNoteId)
            if (!note) return true
            if (note.getChildNotes().length > 0) return false
            note.deleteNote()
            return true
        }, [rootNoteId])

        if (isEmpty) {
            delete persistence.rootNote
            changed = true

            // Nothing installed and nothing left worth keeping — drop the whole record.
            const hasPersistedNotes = persistence.persistenceNotes &&
                Object.keys(persistence.persistenceNotes).length > 0
            if (!addonRecord.installedVersion && !hasPersistedNotes && !persistence.pendingPrompts) {
                delete database.installedAddons[addonId]
            }
        }
    }

    if (changed) await saveDatabase(database)
}

// =========================================================================
// Update prompts: the promptOnUpdate queue — snapshotting a shipped default that
// diverged from the user's persisted copy, then reading/applying/clearing the
// pending decisions the UI surfaces.
// =========================================================================

async function collectPendingPrompts(addonId, m) {
    let database = await loadDatabase()
    const persistenceNotes = database.installedAddons?.[addonId]?.persistence?.persistenceNotes || {}

    const prompts = []
    for (const noteDef of (m.notes || [])) {
        if (!noteDef.promptOnUpdate) continue

        // Find the AddonData relation that targets this note
        const rel = (m.relations || []).find(r =>
            r.to === noteDef.id && r.type.startsWith("AddonData:")
        )
        if (!rel) continue

        const key = rel.type.split("AddonData:")[1]
        const persistedNoteId = persistenceNotes[key]
        if (!persistedNoteId) continue

        const newContent = noteDef.content ?? ""
        const currentContent = await api.runOnBackend((id) => {
            const note = api.getNote(id)
            return note ? note.getContent() : null
        }, [persistedNoteId])

        if (currentContent === null) continue
        if (currentContent === newContent) continue

        prompts.push({
            noteLocalId: noteDef.id,
            title: noteDef.title,
            persistedNoteId,
            newContent,
            currentContent
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
// Install / Sync: the install/update entry point (syncAddon, installByUrl) and the
// dependency resolution it drives — lazy per-export closure resolution, dependency
// metadata fetch/record.
// =========================================================================

// Metadata-only fetch for a dependency — prefers an installed manifestSourceUrl, else
// falls back to ctx.dependencyEntries. Cached in ctx.depMetaCache per sync.
async function fetchDependencyMeta(depId, ctx) {
    if (ctx.depMetaCache.has(depId)) return ctx.depMetaCache.get(depId)

    const installedDep = ctx.database.installedAddons[depId]
    const depEntry = ctx.dependencyEntries.get(depId) || depId
    const depUrl = installedDep?.manifestSourceUrl || resolveDependencyUrl(depEntry, ctx.catalogContext)

    let result = null
    if (!depUrl) {
        console.error(`TAM: dependency '${depId}' could not be resolved (not installed, and no manifestSourceUrl available)`)
    } else {
        try {
            const manifestFetched = await fetchManifest(depUrl)
            result = {
                m: normalizeManifest(manifestFetched),
                manifestSourceUrl: depUrl,
                latestVersion: manifestFetched.latestVersion,
                meta: {
                    name: manifestFetched.name,
                    description: manifestFetched.description,
                    author: manifestFetched.author,
                    license: manifestFetched.license,
                    type: manifestFetched.type,
                    homepage: manifestFetched.homepage
                }
            }
        } catch (e) {
            console.error(`TAM: failed to fetch dependency manifest for ${depId}`, e)
        }
    }
    ctx.depMetaCache.set(depId, result)
    return result
}

// Records a dependency's database entry with its full fetched manifest (not just the
// closure just resolved), and prunes any note it no longer declares.
async function recordDependencyMeta(database, depId, depMeta) {
    const existing = database.installedAddons[depId]
    database.installedAddons[depId] = {
        installedVersion: depMeta.latestVersion,
        manifestSourceUrl: depMeta.manifestSourceUrl,
        manuallyInstalled: existing?.manuallyInstalled || false,
        enabled: true,
        meta: depMeta.meta,
        manifest: stripManifestForStorage(depMeta.m),
        ...(existing?.persistence ? { persistence: existing.persistence } : {})
    }
    await pruneRemovedNotes(depMeta.m, depId)
}

// The lazy dependency resolver: pulls in only the transitive closure of notes a specific
// export needs (computeLocalClosure), parented directly wherever the caller needs it.
async function ensureDependencyExport(depId, exportKey, parentRealId, ctx) {
    // Guards against a circular dependency graph recursing forever.
    const resolutionKey = `${depId}::${exportKey}`
    if (ctx.resolvingExports.has(resolutionKey)) {
        console.error(`TAM: circular dependency detected resolving ${resolutionKey} — skipping`)
        return null
    }
    ctx.resolvingExports.add(resolutionKey)

    try {
        const depMeta = await fetchDependencyMeta(depId, ctx)
        if (!depMeta) return null

        const exportLocalId = depMeta.m.exports?.[exportKey]
        if (!exportLocalId) {
            console.error(`TAM: dependency ${depId} has no export '${exportKey}', skipping`)
            return null
        }

        const closure = computeLocalClosure(depMeta.m, exportLocalId)
        const noteMap = await resolveManifest(depMeta.m, depId, parentRealId, depMeta.manifestSourceUrl, ctx, {
            entryLocalId: exportLocalId,
            scopeLocalIds: closure
        })
        const entryNoteId = noteMap[exportLocalId]
        if (!entryNoteId) return null

        await recordDependencyMeta(ctx.database, depId, depMeta)

        return entryNoteId
    } finally {
        ctx.resolvingExports.delete(resolutionKey)
    }
}

// Resolves `m`'s notes (the whole manifest, or just an export's closure — see
// options.scopeLocalIds) and applies labels/relations, recursing into cross-addon
// children/relations via ensureDependencyExport. Shared by top-level sync and nested
// dependency resolution.
async function resolveManifest(m, addonId, parentRealId, manifestSourceUrl, ctx, options = {}) {
    const { entryLocalId = m.root, scopeLocalIds = null, rootExternallyParented = false } = options
    const inScope = (localId) => !scopeLocalIds || scopeLocalIds.has(localId)

    for (const depEntry of (m.dependencies || [])) {
        const depId = dependencyId(depEntry)
        if (!ctx.dependencyEntries.has(depId)) ctx.dependencyEntries.set(depId, depEntry)
    }

    const noteMap = await resolveNotes(m, addonId, parentRealId, manifestSourceUrl, {
        entryLocalId, scopeLocalIds, rootExternallyParented
    })

    for (const c of (m.children || []).filter(c => c.addon && inScope(c.parent))) {
        const childParentRealId = noteMap[c.parent]
        if (!childParentRealId) continue
        const depNoteId = await ensureDependencyExport(c.addon, c.child, childParentRealId, ctx)
        if (!depNoteId) {
            console.error(`TAM: dependency ${c.addon} has no export '${c.child}' (or it couldn't be resolved), skipping`)
            continue
        }
        await api.runOnBackend((sourceId, parentId) => {
            api.ensureNoteIsPresentInParent(sourceId, parentId)
        }, [depNoteId, childParentRealId])
    }

    await applyLabels((m.labels || []).filter(l => inScope(l.note)), noteMap)

    for (const rel of (m.relations || []).filter(r => inScope(r.from))) {
        const fromRealId = noteMap[rel.from]
        if (!fromRealId) continue

        let toRealId
        if (rel.addon) {
            toRealId = await ensureDependencyExport(rel.addon, rel.to, fromRealId, ctx)
        } else {
            toRealId = noteMap[rel.to] || rel.to
        }
        if (!toRealId) continue

        await api.runOnBackend((fromId, type, toId) => {
            const note = api.getNote(fromId)
            // Same disabled-state guard as applyLabels — TAM's own manifest
            // declares "renderNote" as a relation, and it's in the
            // activation-label list, so this isn't hypothetical.
            const disabledType = `disabled:${type}`
            const targetType = note.hasRelation(disabledType) ? disabledType : type
            note.setRelation(targetType, toId)
        }, [fromRealId, rel.type, toRealId])
    }

    return noteMap
}

// The one entry point for getting an addon's notes to match its manifest — fresh install,
// version update, and TAM's own self-sync are all the same call. manifestSourceUrl is
// required for a fresh install, optional for an update (falls back to the stored record).
async function syncAddon(addonId, options = {}) {
    const { manifestSourceUrl = null, manual = true, catalogContext = null } = options
    if (!addonId.trim()) return

    const isSelf = addonId === TAM_ID

    let database = await loadDatabase()
    const existing = database.installedAddons[addonId]
    const wasInstalled = !!existing?.installedVersion

    const fetchUrl = manifestSourceUrl || existing?.manifestSourceUrl
    if (!fetchUrl) throw new Error(`TAM: no manifestSourceUrl available to sync '${addonId}' (not installed yet, and none provided)`)

    const manifest = await fetchManifest(fetchUrl)
    const m = normalizeManifest(manifest)

    if (!m.root) throw new Error(`TAM: manifest for ${addonId} is missing required 'root' field`)

    // Snapshot promptOnUpdate diffs against current persisted content first.
    const pendingPrompts = await collectPendingPrompts(addonId, m)
    if (pendingPrompts.length > 0) {
        if (!database.installedAddons[addonId]) database.installedAddons[addonId] = {}
        if (!database.installedAddons[addonId].persistence) database.installedAddons[addonId].persistence = {}
        database.installedAddons[addonId].persistence.pendingPrompts = pendingPrompts
        await saveDatabase(database)
    }

    // Migrate any legacy persisted clone to the #TAMDATAID model BEFORE resolveNotes runs —
    // otherwise its find-by-#TAMFILEID would adopt the clone and overwrite user data (see there).
    await migrateLegacyPersistence(addonId)

    // A directly-installed addon always resolves its whole manifest, unscoped, under the
    // "Addons" anchor; transitive dependencies resolve lazily/scoped instead (ensureDependencyExport).
    const ctx = { database, catalogContext, depMetaCache: new Map(), dependencyEntries: new Map(), resolvingExports: new Set() }
    const noteMap = await resolveManifest(m, addonId, await getAddonRootNoteId(), fetchUrl, ctx, { rootExternallyParented: isSelf })
    if (!noteMap[m.root]) throw new Error(`TAM: root note '${m.root}' was not resolved for ${addonId}`)

    await pruneRemovedNotes(m, addonId)

    const storedManifest = stripManifestForStorage(m)
    const meta = {
        name: manifest.name,
        description: manifest.description,
        author: manifest.author,
        license: manifest.license,
        type: manifest.type,
        homepage: manifest.homepage
    }

    if (!wasInstalled) {
        // Preserve any persistence data surviving from a previous install of this addonId.
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
        // Merge in place — never resets manuallyInstalled/enabled/persistence.
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
    await connectAddonPersistence(addonId)
}

// Installs by manifestSourceUrl alone — the caller doesn't need to know the addon's id.
async function installByUrl(manifestSourceUrl, options = {}) {
    const manifest = await fetchManifest(manifestSourceUrl)
    if (!manifest.id) throw new Error("TAM: manifest has no 'id' field")
    await syncAddon(manifest.id, { ...options, manifestSourceUrl })
}

// =========================================================================
// Lifecycle / query: enable/disable, read-only addon listing, update-checking, and
// database validation — the "query and toggle" surface outside install/uninstall.
// =========================================================================

async function enableAddon(addonId, enabled) {
    if (!addonId.trim()) return
    let database = await loadDatabase()
    const rootNoteId = await resolveStoredNoteId(addonId, database.installedAddons[addonId].manifest?.root)
    if (!rootNoteId) return
    await api.runOnBackend((tamFileIdLabel, addonId, noteId, enabled, addonLabels) => {
        for (const id of api.getNote(noteId).getSubtreeNoteIds()) {
            const note = api.getNote(id)
            // TAM's own root descends into "Addons" — without this guard, disabling TAM
            // would disable every other installed addon too (see connectAddonPersistence).
            const ownTamFileId = note.getLabelValue(tamFileIdLabel)
            if (!ownTamFileId || !ownTamFileId.startsWith(`${addonId}/`)) continue
            for (const attribute of note.getAttributes() || []) {
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

// Returns every installed addon merged with live-resolved rootNoteId/settingsNoteId —
// the data the list/detail views render. Never touches the network.
async function getAllAddons() {
    let database = await loadDatabase()

    const lookups = []
    for (const [addonId, addon] of Object.entries(database.installedAddons || {})) {
        if (!addon.installedVersion || !addon.manifest) continue
        lookups.push({ addonId, rootLocalId: addon.manifest.root, settingsLocalId: addon.manifest.settingsNote })
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

// Fetches every installed addon's own manifestSourceUrl and compares latestVersion against
// installedVersion. Best-effort per addon: a fetch failure leaves the prior state.
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
            // Best-effort — leave whatever updateAvailable state was there.
        }
    }))

    // Libraries are hidden from the UI, so surface an update sitting on one via whatever
    // depends on it instead. Fixed-point loop: updateAvailable only ever flips false->true.
    let changed = true
    while (changed) {
        changed = false
        for (const addonId of Object.keys(installed)) {
            const addon = installed[addonId]
            if (!addon.updateAvailable) continue
            for (const dependentId of getDependents(database, addonId)) {
                const dependent = installed[dependentId]
                if (dependent && !dependent.updateAvailable) {
                    dependent.updateAvailable = true
                    changed = true
                }
            }
        }
    }

    await saveDatabase(database)
    await cleanupEmptyPersistenceRoots()
}

// Read-only audit of the installed-addon graph against the real Trilium note tree.
// Never fixes anything — a flagged addon should be reinstalled/updated instead.
// Returns a flat list of { addonId, message } issues.
async function validateDatabase() {
    const database = await loadDatabase()
    const issues = []

    const duplicateIds = await api.runOnBackend((tamFileIdLabel, tamDataIdLabel) => {
        function duplicatesOf(label) {
            const byValue = {}
            for (const note of api.getNotesWithLabel(label)) {
                if (note.isDeleted) continue
                const value = note.getLabelValue(label)
                byValue[value] = byValue[value] || []
                byValue[value].push(note.noteId)
            }
            return Object.entries(byValue).filter(([, noteIds]) => noteIds.length > 1)
        }
        return { tamFileId: duplicatesOf(tamFileIdLabel), tamDataId: duplicatesOf(tamDataIdLabel) }
    }, [tamFileIdLabel, tamDataIdLabel])

    for (const [tamFileId, noteIds] of duplicateIds.tamFileId) {
        issues.push({
            addonId: tamFileId.split("/")[0],
            message: `TAMFILEID '${tamFileId}' is duplicated across notes ${noteIds.join(", ")}`
        })
    }

    for (const [tamDataId, noteIds] of duplicateIds.tamDataId) {
        issues.push({
            addonId: tamDataId.split("/")[0],
            message: `TAMDATAID '${tamDataId}' is duplicated across notes ${noteIds.join(", ")} (persisted data note has a conflicting copy)`
        })
    }

    for (const [addonId, addon] of Object.entries(database.installedAddons || {})) {
        const isInstalled = !!addon.installedVersion
        // A lazily-resolved dependency (see ensureDependencyExport) never forces its own root
        // note into existence, so a missing root is only an issue for a manually-installed addon.
        const requiresOwnRoot = isInstalled && !!addon.manuallyInstalled
        const persistence = addon.persistence || {}
        const manifest = addon.manifest || {}

        const backendIssues = await api.runOnBackend((tamFileIdLabel, tamDataIdLabel, addonId, manifest, persistence, isInstalled, requiresOwnRoot) => {
            const found = []

            function noteExists(noteId) {
                if (!noteId) return false
                const note = api.getNote(noteId)
                return !!(note && !note.isDeleted)
            }
            function resolveLocal(localId) {
                if (!localId) return null
                const note = api.getNoteWithLabel(tamFileIdLabel, `${addonId}/${localId}`)
                return (note && !note.isDeleted) ? note.noteId : null
            }

            let rootNoteId = resolveLocal(manifest.root)
            if (requiresOwnRoot) {
                if (!rootNoteId) {
                    found.push(`root note ('${manifest.root}') is missing`)
                }

                if (manifest.settingsNote && !resolveLocal(manifest.settingsNote)) {
                    found.push(`settings note ('${manifest.settingsNote}') is missing`)
                }
            }

            if (persistence.rootNote && !noteExists(persistence.rootNote)) {
                found.push(`persistence root note (${persistence.rootNote}) is missing`)
            }

            for (const [key, realId] of Object.entries(persistence.persistenceNotes || {})) {
                const note = noteExists(realId) ? api.getNote(realId) : null
                if (!note) {
                    found.push(`persisted note '${key}' (${realId}) is missing`)
                    continue
                }
                // A persisted note must live purely in the #TAMDATAID namespace: carrying
                // #TAMFILEID means it is still entangled with the addon's structural tree and
                // an uninstall/prune sweep could delete it (the hazard this model removes).
                if (note.getLabelValue(tamFileIdLabel)) {
                    found.push(`persisted note '${key}' (${realId}) still carries a #TAMFILEID label — not migrated to the #TAMDATAID model; re-sync ${addonId} to fix`)
                }
                if (note.getLabelValue(tamDataIdLabel) !== `${addonId}/${key}`) {
                    found.push(`persisted note '${key}' (${realId}) is missing its #TAMDATAID '${addonId}/${key}'`)
                }
            }

            if (isInstalled && rootNoteId) {
                for (const noteId of api.getNote(rootNoteId).getSubtreeNoteIds()) {
                    const note = api.getNote(noteId)
                    if (!note) continue
                    // Same guard as connectAddonPersistence/enableAddon (see there for why).
                    const ownTamFileId = note.getLabelValue(tamFileIdLabel)
                    if (!ownTamFileId || !ownTamFileId.startsWith(`${addonId}/`)) continue
                    for (const relation of note.getRelations()) {
                        if (!relation.name.includes("AddonData:")) continue
                        const key = relation.name.split("AddonData:")[1]
                        const expected = (persistence.persistenceNotes || {})[key]
                        if (!expected) {
                            found.push(`relation '${relation.name}' on note ${noteId} has no matching persistence record for key '${key}'`)
                        } else if (relation.value !== expected) {
                            found.push(`relation '${relation.name}' on note ${noteId} points at ${relation.value}, expected persisted note ${expected}`)
                        }
                    }
                }
            }

            return found
        }, [tamFileIdLabel, tamDataIdLabel, addonId, manifest, persistence, isInstalled, requiresOwnRoot])

        for (const message of backendIssues) {
            issues.push({ addonId, message })
        }

        if (!isInstalled) continue

        for (const depEntry of (manifest.dependencies || [])) {
            const depId = dependencyId(depEntry)
            if (!database.installedAddons[depId]?.installedVersion) {
                issues.push({ addonId, message: `depends on '${depId}', which is not installed` })
            }
        }
    }

    return issues
}

// =========================================================================
// Catalog: catalog CRUD + browsing. A "catalog" is a URL serving
// {"tam-addons": [manifestSourceUrl, ...]} — a flat list of manifest locations.
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

// Fetches a catalog's addon list fresh every time; a dead link or malformed manifest
// is skipped rather than failing the whole browse view.
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
// Uninstall / recovery: removing an addon's own note branches, detecting external
// references that would dangle, the recursive "uninstall unused deps" logic, and
// the orphan-sweep / full-reinitialize recovery tools.
// =========================================================================

// User-triggered maintenance sweep: deletes any #TAMFILEID-tagged note with zero parents
// (a safety net for a partial sync failure). Returns the list of TAMFILEIDs removed.
async function sweepOrphanedNotes() {
    return await api.runOnBackend((tamFileIdLabel) => {
        const removed = []
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            if (note.getParentNotes().length > 0) continue
            removed.push(note.getLabelValue(tamFileIdLabel))
            note.deleteNote()
        }
        return removed
    }, [tamFileIdLabel])
}

// Removes every branch this addon owns, never a blanket note-level delete — a note only
// disappears once none of its parents are left, so a clone held by a dependent survives.
// Scans the live tree by #TAMFILEID prefix rather than walking a stored manifest's notes[]
// list, so it's self-healing against manifest churn: a note whose local id was dropped from
// a later manifest version (and so is absent from whatever manifest snapshot is on record)
// still gets found and cleaned up here, since this never depends on any particular stored
// manifest matching what's actually still in the tree.
async function detachAddonOwnedBranches(addonId) {
    const anchorIds = [await getAddonRootNoteId()].filter(Boolean)

    await api.runOnBackend((tamFileIdLabel, tamDataIdLabel, addonId, anchorIds) => {
        const prefix = `${addonId}/`
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            const tamFileId = note.getLabelValue(tamFileIdLabel)
            if (!tamFileId || !tamFileId.startsWith(prefix)) continue

            // A persisted (AddonData:) note must survive uninstall. It normally carries only
            // #TAMDATAID and so never reaches this #TAMFILEID scan, but a legacy clone from the
            // old design can still carry a copied #TAMFILEID until its first re-sync migrates it —
            // guard against deleting one here regardless.
            const dataId = note.getLabelValue(tamDataIdLabel)
            if (dataId && dataId.startsWith(prefix)) continue

            const parentsToDetach = []
            let keepsAnyParent = false
            for (const parentNote of note.getParentNotes()) {
                const isAnchor = anchorIds.includes(parentNote.noteId)
                const parentTamId = parentNote.getLabelValue(tamFileIdLabel)
                const ownedByThisAddon = parentTamId && parentTamId.startsWith(prefix)
                // Preserve a parent branch clearly owned by a different addon; detach everything else.
                const ownedByAnotherAddon = parentTamId && !ownedByThisAddon && !isAnchor
                if (ownedByAnotherAddon) {
                    keepsAnyParent = true
                } else {
                    parentsToDetach.push(parentNote)
                }
            }

            if (!keepsAnyParent) {
                // Every parent branch here is slated for removal — this note should end up fully
                // deleted. Go straight to deleteNote() instead of stripping branches one at a time
                // via ensureNoteIsAbsentFromParent: that function silently REFUSES to remove a
                // note's last remaining strong branch ("this would delete the note as well" is
                // exactly the outcome wanted here, not a reason to abort), so calling it on every
                // parent one-by-one always leaves exactly one branch behind and the note never
                // actually gets removed.
                note.deleteNote()
                continue
            }

            for (const parentNote of parentsToDetach) {
                api.ensureNoteIsAbsentFromParent(note.noteId, parentNote.noteId)
            }
        }
    }, [tamFileIdLabel, tamDataIdLabel, addonId, anchorIds])
}

async function deleteAddon(addonId) {
    if (!addonId.trim()) return
    let database = await loadDatabase()
    const addonRecord = database.installedAddons[addonId]
    await detachAddonOwnedBranches(addonId)

    const persistence = addonRecord?.persistence
    const hasPersistedData = persistence && (
        persistence.rootNote ||
        (persistence.persistenceNotes && Object.keys(persistence.persistenceNotes).length > 0)
    )

    if (hasPersistedData) {
        // Keep the persisted user data around — it must survive uninstall.
        database.installedAddons[addonId] = { persistence }
    } else {
        delete database.installedAddons[addonId]
    }
    await saveDatabase(database)
}

// Pre-uninstall safety check: finds every relation pointing into an addon's subtree from
// outside it, which would dangle once deleteAddon removes the subtree. A manifest can opt
// out via "allowExternalReferences": true (see expanded@beatlink).
async function findExternalReferences(addonId) {
    const addonRecord = (await loadDatabase()).installedAddons[addonId]
    if (addonRecord?.manifest?.allowExternalReferences) return []

    const rootNoteId = await resolveStoredNoteId(addonId, addonRecord?.manifest?.root)
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

// The user-facing "uninstall": unlike deleteAddon, also recursively uninstalls any of its
// own dependencies that are now unused and weren't installed directly by the user.
async function uninstallAddon(addonId) {
    if (!addonId.trim()) return
    let database = await loadDatabase()
    const installed = database.installedAddons[addonId]
    if (!installed?.installedVersion) return

    const dependencies = installed.manifest?.dependencies || []

    await deleteAddon(addonId)

    for (const depEntry of dependencies) {
        const depId = dependencyId(depEntry)
        database = await loadDatabase()
        const dep = database.installedAddons[depId]
        if (!dep) continue

        const stillNeeded = getDependents(database, depId).length > 0
        const depIsManual = dep.manuallyInstalled ?? true
        if (!depIsManual && !stillNeeded) {
            await uninstallAddon(depId)
        }
    }
}

// Recovery tool: uninstalls every addon except TAM itself, then hard-resets the Database
// note to just its catalogs and a bare TAM entry. TAM re-derives its own installed state
// next time it's synced.
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
// UI helpers: rendering support for the TAM.jsx views that isn't part of the
// install/resolve machinery.
// =========================================================================

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
module.exports.deleteAddon = deleteAddon
module.exports.uninstallAddon = uninstallAddon
module.exports.reinitializeDatabase = reinitializeDatabase
module.exports.findExternalReferences = findExternalReferences
module.exports.enableAddon = enableAddon
module.exports.getPendingPrompts = getPendingPrompts
module.exports.resolvePrompt = resolvePrompt
module.exports.clearPendingPrompts = clearPendingPrompts
module.exports.validateDatabase = validateDatabase
module.exports.fetchReadmeHtml = fetchReadmeHtml
module.exports.cleanupEmptyPersistenceRoots = cleanupEmptyPersistenceRoots
module.exports.sweepOrphanedNotes = sweepOrphanedNotes
