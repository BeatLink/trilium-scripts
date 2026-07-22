// TAM's entire backend/data layer in one module. Previously split across
// libTAMDatabase / libTAMNetwork / libTAMManifestUtils / libTAMNoteResolver /
// libTAMCatalog / libTAMSync / libTAMLifecycle / libTAMPersistence /
// libTAMUninstall (+ this facade); merged into one file so TAM has a single
// require()-able JS note. Section banners below group the functions by domain;
// the public surface is the same one lib-tam.js always exported (bottom).
//
// Dependencies: marked (markdown -> HTML for READMEs / renderAsHTML).

const marked = require("marked.min.js")

const addonRootLabel = "addonRoot"

async function getAddonRootNoteId() {
    return await api.currentNote.getRelationValue(addonRootLabel)
}

const addonPersistenceLabel = "addonPersistence"

async function getPersistenceNoteId() {
    return await api.currentNote.getRelationValue(addonPersistenceLabel)
}

// Synthetic local ids for the per-addon anchor notes TAM itself owns (never declared by an
// addon's own manifest). "root" anchors under the global Addons note; "persistence" anchors
// under the global Addon Data note. Both share the addon's #TAMFILEID prefix so the existing
// prefix-scan in detachAddonOwnedBranches finds them for free; the persistence one is kept
// alive across uninstall by passing it in persistentIds, same as any other persistent note.
const addonAnchorRootLocalId = "__tamAddonRoot__"
const addonAnchorPersistenceLocalId = "__tamAddonPersistenceRoot__"

// Find-or-create the one note that owns every note this addon resolves under (structural or
// persistent), named/tagged after the addon so it reads clearly in the tree. addons can only
// ever attach children to it — they never declare or reparent it themselves.
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
        return note.noteId
    }, [tamFileIdLabel, tamFileId, addonId, addonName, parentRealId])
}

const databaseLabel = "database"

// Database read/write. The `database` relation lives on this note (lib-tam), read
// via api.currentNote like addonRoot/addonPersistence above.
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
// Constants: label/relation names, TAM's own id, and the set of "activation"
// attribute names enableAddon toggles under a disabled: prefix.
// =========================================================================

const tamFileIdLabel = "TAMFILEID"
// Carries a note's resolved absolute sourceUrl (empty string if the manifest
// declares none), so a shared libs/ file already installed by one addon can be
// found and cloned by another instead of re-fetched — see the dedup lookup in
// resolveNotes.
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
// Helpers: Extractors, guards, and formatters for common patterns to reduce
// duplication across the module. These are pure functions with no side effects.
// =========================================================================

// Checks if a note's #TAMFILEID belongs to the specified addon.
function isOwnTamFileId(note, addonId) {
    const tamFileId = note.getLabelValue(tamFileIdLabel)
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
// parsing, normalizing, computing parent relationships. No note-tree or
// Database access lives here.
// =========================================================================

// Splits children[] into each note's first-declared parent (where it actually
// resolves) vs. any later parents (wired as clone branches by reconcileNoteParenting).
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

// Snapshots the manifest fields TAM still needs offline once the fetched manifest
// itself is gone — resolving root/settingsNote/readmeNote by local id, and walking
// children[] for persistentLocalIds. notes[]/relations[]/labels[] are never read
// back (they only ever drive a live resolveNotes pass against a freshly fetched
// manifest), so they're not duplicated here.
function stripManifestForStorage(m) {
    return {
        root: m.root,
        settingsNote: m.settingsNote,
        readmeNote: m.readmeNote,
        persistenceRoot: m.persistenceRoot,
        allowExternalReferences: m.allowExternalReferences,
        children: m.children || []
    }
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
// flat top-level manifest treated as having no children (the shape a
// hand-authored, non-TAM-native manifest would have).
function normalizeManifest(manifestFetched) {
    return manifestFetched.manifest ?? {
        notes: manifestFetched.notes ?? [],
        children: [],
        relations: manifestFetched.relations ?? [],
        labels: manifestFetched.labels ?? [],
        root: null
    }
}

// Local ids whose children[] parent chain roots at m.persistenceRoot (inclusive). Empty when
// no persistenceRoot is declared. A "persistent" note is created once with its shipped default,
// prompt-on-update thereafter, and never touched by uninstall/prune — all three implied by
// placement alone (no per-note flags, no AddonData: relation).
// MUST stay in sync with persistentLocalIds() in resources/scripts/tamhelper.js.
function persistentLocalIds(m) {
    const rootId = m.persistenceRoot
    const persistent = new Set()
    if (!rootId) return persistent
    persistent.add(rootId)
    const childrenOf = {}
    for (const c of (m.children || []).filter(c => c.child)) {
        (childrenOf[c.parent] = childrenOf[c.parent] || []).push(c.child)
    }
    const stack = [rootId]
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
// against a retried/partial install). Content is fetched fresh from sourceUrl each call, EXCEPT
// when another addon has already installed a note from that same absolute sourceUrl (see
// sourceUrlLabel dedup below) — that note is cloned in instead, no fetch. A note's fetch failure
// is logged and it (and its children) are skipped, not fatal. scopeLocalIds restricts this to just
// the structural or just the persistent notes — see the two passes in syncAddon — both drawn from
// the same manifest, so a scoped note's primaryParent is always itself in scope.
async function resolveNotes(m, addonId, fallbackParentNoteId, options = {}) {
    const { rootExternallyParented = false, entryLocalId = m.root, scopeLocalIds = null } = options
    const { primaryParent } = buildParentMaps(m.children)
    // A persistent note (under persistenceRoot) is created once with its shipped default, then
    // never content-overwritten on later syncs — same content behavior as skipOnUpdate.
    const persistentIds = persistentLocalIds(m)

    const noteIds = (scopeLocalIds ? m.notes.filter(n => scopeLocalIds.has(n.id)) : m.notes).map(n => n.id)
    const sortedIds = topologicalSort(noteIds, primaryParent)

    const noteMap = {}
    for (const localId of sortedIds) {
        const noteDef = m.notes.find(n => n.id === localId)
        if (!noteDef) continue

        const parentLocalId = localId === entryLocalId ? null : primaryParent[localId]
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

        const absoluteSourceUrl = noteDef.sourceUrl || null

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
                async (tamFileIdLabel, sourceUrlLabel, tamFileId, parentRealId, title, noteType, mime, sourceUrl, explicitContent, isBinary, skipOnUpdate, promptOnUpdate, skipParenting) => {
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

                    // This addon has never installed its own copy of this note — before fetching,
                    // see if another addon already has a note sourced from the same absolute URL
                    // and reuse it instead (see sourceUrlLabel). Trusts that note is current; it's
                    // refreshed whenever whichever addon owns it next syncs.
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
                        if (existing.getLabelValue(sourceUrlLabel) !== (sourceUrl || "")) {
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
        // in the OTHER anchored pass — persistence vs. structural, see syncAddon) must never be
        // detached — only parents the manifest genuinely no longer declares.
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
// A persistent note (under persistenceRoot) is never pruned — its content is the user's,
// so a manifest that drops it must not take the user's data with it.
async function pruneRemovedNotes(m, addonId) {
    const persistentIds = [...persistentLocalIds(m)]
    await api.runOnBackend((tamFileIdLabel, addonId, currentLocalIds, persistentIds) => {
        const currentSet = new Set(currentLocalIds)
        const persistentSet = new Set(persistentIds)
        const prefix = `${addonId}/`
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            const value = note.getLabelValue(tamFileIdLabel)
            if (!value || !value.startsWith(prefix)) continue
            const localId = value.slice(prefix.length)
            if (persistentSet.has(localId)) continue
            if (!currentSet.has(localId)) note.deleteNote()
        }
    }, [tamFileIdLabel, addonId, m.notes.map(n => n.id), persistentIds])
}

// =========================================================================
// Persistence: user data lives in notes placed under persistenceRoot, resolved (like every
// other note) as real #TAMFILEID notes but anchored under the shared "Addon Data" note, which
// the uninstall/prune sweeps skip. No copy, no separate #TAMDATAID identity. See resolveNotes /
// persistentLocalIds.
// =========================================================================

// =========================================================================
// Update prompts: persistent notes (under persistenceRoot) are prompt-on-update by
// definition — a sync snapshots the shipped default against the user's live note and,
// if they diverged, queues a Keep-Mine/Use-New decision the UI surfaces.
// =========================================================================

// Called from syncAddon BEFORE resolveNotes. A persistent note is create-once, so its live
// content is always the user's copy; here we compare it against the incoming manifest default
// and queue a prompt on any difference. The live note is found directly by #TAMFILEID.
async function collectPendingPrompts(addonId, m) {
    const persistentIds = persistentLocalIds(m)
    if (persistentIds.size === 0) return []

    const prompts = []
    for (const noteDef of (m.notes || [])) {
        if (!persistentIds.has(noteDef.id)) continue
        if (noteDef.id === m.persistenceRoot) continue // the anchor holds no user content

        // The incoming default: inline content, else fetched fresh from sourceUrl.
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

        if (!info) continue // not yet installed — first install writes the default, nothing to prompt
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

// Resolves `m`'s notes (scoped to just the structural or just the persistent notes — see
// scopeLocalIds) and applies labels/relations for that same scope. A note sourced from a shared
// libs/ file already installed by another addon is cloned rather than re-fetched — see
// resolveNotes. Shared by the structural and persistence passes in syncAddon (existingNoteMap
// merges both passes' real ids so a cross-anchor relation resolves against either).
async function resolveManifest(m, addonId, parentRealId, options = {}) {
    const { entryLocalId = m.root, scopeLocalIds = null, rootExternallyParented = false, existingNoteMap = null } = options
    const inScope = (localId) => !scopeLocalIds || scopeLocalIds.has(localId)

    const resolved = await resolveNotes(m, addonId, parentRealId, {
        entryLocalId, scopeLocalIds, rootExternallyParented
    })
    // Merge this pass's real ids into the shared map so a cross-anchor relation (a structural
    // note's ~template pointing into the persistence pass, or vice versa) resolves against notes
    // created in the OTHER pass. Relations/labels are applied only for this pass's in-scope notes,
    // but their targets may live in either pass.
    const noteMap = existingNoteMap ? Object.assign(existingNoteMap, resolved) : resolved

    await applyLabels((m.labels || []).filter(l => inScope(l.note)), noteMap)

    for (const rel of (m.relations || []).filter(r => inScope(r.from))) {
        const fromRealId = noteMap[rel.from]
        if (!fromRealId) continue

        const toRealId = noteMap[rel.to] || rel.to
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

    if (!m.root) throw new Error(`TAM: manifest for ${addonId} is missing required 'root' field`)

    // Snapshot persistent-note diffs (shipped default vs. user's live copy) before resolveNotes.
    const pendingPrompts = await collectPendingPrompts(addonId, m)
    if (pendingPrompts.length > 0) {
        if (!database.installedAddons[addonId]) database.installedAddons[addonId] = {}
        if (!database.installedAddons[addonId].persistence) database.installedAddons[addonId].persistence = {}
        database.installedAddons[addonId].persistence.pendingPrompts = pendingPrompts
        await saveDatabase(database)
    }

    // The manifest resolves in two anchored passes. Structural notes go under this addon's own
    // TAM-owned root anchor (itself a child of the global "Addons" note), so every addon's tree
    // reads as a distinct, named/tagged branch instead of a flat dump. Persistent notes (the
    // persistenceRoot subtree) go under this addon's own TAM-owned persistence anchor (a child
    // of the global "Addon Data" note) — stable, uninstall never touches it, so user data
    // survives an uninstall without any copy or reparenting. Cross-anchor ~template/relation
    // edges still resolve fine; both passes share one noteMap. TAM never lets an addon declare
    // or reparent these anchors itself — only attach children beneath them.
    const persistentIds = persistentLocalIds(m)
    const structuralScope = persistentIds.size
        ? new Set(m.notes.map(n => n.id).filter(id => !persistentIds.has(id)))
        : null

    const addonRootAnchorId = isSelf
        ? await getAddonRootNoteId()
        : await ensureAddonAnchor(addonId, manifest.name, addonAnchorRootLocalId, await getAddonRootNoteId())

    // Persistence pass FIRST, so persistent notes are in the shared map before the structural
    // pass applies relations like `templates-root --template--> tpl-special` that point into them.
    const noteMap = {}
    if (persistentIds.size) {
        const persistenceAnchorId = isSelf
            ? await getPersistenceNoteId()
            : await ensureAddonAnchor(addonId, manifest.name, addonAnchorPersistenceLocalId, await getPersistenceNoteId())
        await resolveManifest(m, addonId, persistenceAnchorId, {
            entryLocalId: m.persistenceRoot,
            scopeLocalIds: persistentIds,
            existingNoteMap: noteMap
        })
    }

    await resolveManifest(m, addonId, addonRootAnchorId, {
        rootExternallyParented: isSelf,
        scopeLocalIds: structuralScope,
        existingNoteMap: noteMap
    })
    if (!noteMap[m.root]) throw new Error(`TAM: root note '${m.root}' was not resolved for ${addonId}`)

    await pruneRemovedNotes(m, addonId)

    const storedManifest = stripManifestForStorage(m)
    const meta = extractAddonMeta(manifest)

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
            if (!note.getLabelValue(tamFileIdLabel)?.startsWith(`${addonId}/`)) continue
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

    await saveDatabase(database)
}

// Read-only audit of the installed-addon graph against the real Trilium note tree.
// Never fixes anything — a flagged addon should be reinstalled/updated instead.
// Returns a flat list of { addonId, message } issues.
async function validateDatabase() {
    const database = await loadDatabase()
    const issues = []

    const duplicateIds = await api.runOnBackend((tamFileIdLabel) => {
        const byValue = {}
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            const value = note.getLabelValue(tamFileIdLabel)
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

        const backendIssues = await api.runOnBackend((tamFileIdLabel, addonId, manifest, persistentIds, isInstalled) => {
            const found = []

            function resolveLocal(localId) {
                if (!localId) return null
                const note = api.getNoteWithLabel(tamFileIdLabel, `${addonId}/${localId}`)
                return (note && !note.isDeleted) ? note.noteId : null
            }

            if (isInstalled) {
                if (!resolveLocal(manifest.root)) {
                    found.push(`root note ('${manifest.root}') is missing`)
                }
                if (manifest.settingsNote && !resolveLocal(manifest.settingsNote)) {
                    found.push(`settings note ('${manifest.settingsNote}') is missing`)
                }
            }

            // Persistent notes (under persistenceRoot) are ordinary #TAMFILEID notes that must
            // survive; flag any the manifest declares but the tree no longer has.
            for (const localId of persistentIds) {
                if (!resolveLocal(localId)) {
                    found.push(`persistent note ('${localId}') is missing — user data may have been lost`)
                }
            }

            return found
        }, [tamFileIdLabel, addonId, manifest, persistentIds, isInstalled])

        for (const message of backendIssues) {
            issues.push({ addonId, message })
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

// User-triggered maintenance sweep: deletes any note under the global Addons root (never
// Addon Data — persisted user data must survive this) that either carries no #TAMFILEID at
// all, or one whose addonId prefix isn't a currently-installed addon (e.g. left behind by an
// addon removed outside TAM's own uninstall flow). Returns the list of { noteId, title,
// tamFileId } removed.
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

            const tamFileId = note.getLabelValue(tamFileIdLabel)
            const addonId = tamFileId ? tamFileId.split("/")[0] : null
            if (tamFileId && installedSet.has(addonId)) continue

            removed.push({ noteId: note.noteId, title: note.title, tamFileId })
            note.deleteNote()
        }
        return removed
    }, [tamFileIdLabel, addonsRootId, installedIds])
}

// Removes every branch this addon owns, never a blanket note-level delete — a note only
// disappears once none of its parents are left, so a clone held by a dependent survives.
// Scans the live tree by #TAMFILEID prefix rather than walking a stored manifest's notes[]
// list, so it's self-healing against manifest churn: a note whose local id was dropped from
// a later manifest version (and so is absent from whatever manifest snapshot is on record)
// still gets found and cleaned up here, since this never depends on any particular stored
// manifest matching what's actually still in the tree.
async function detachAddonOwnedBranches(addonId, persistentIds = []) {
    const anchorIds = [await getAddonRootNoteId()].filter(Boolean)

    await api.runOnBackend((tamFileIdLabel, addonId, anchorIds, persistentIds) => {
        const prefix = `${addonId}/`
        const persistentSet = new Set(persistentIds)
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            const tamFileId = note.getLabelValue(tamFileIdLabel)
            if (!tamFileId || !tamFileId.startsWith(prefix)) continue

            // A persistent note (under persistenceRoot) holds the user's data and must survive
            // uninstall. Identified by its local id, so it's simply skipped by this sweep.
            if (persistentSet.has(tamFileId.slice(prefix.length))) continue

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
    }, [tamFileIdLabel, addonId, anchorIds, persistentIds])
}

async function deleteAddon(addonId) {
    if (!addonId.trim()) return
    let database = await loadDatabase()
    const addonRecord = database.installedAddons[addonId]
    // Persistent notes (under persistenceRoot) are left in the tree, still tagged #TAMFILEID, so a
    // later reinstall re-adopts them and the user's data survives. The TAM-owned persistence
    // anchor that holds them must survive alongside them, or its removal would orphan the data
    // it parents. Everything else (including the structural root anchor) is detached.
    const persistentIds = [...persistentLocalIds(addonRecord?.manifest || {}), addonAnchorPersistenceLocalId]
    await detachAddonOwnedBranches(addonId, persistentIds)

    delete database.installedAddons[addonId]
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

// The user-facing "uninstall" entry point.
async function uninstallAddon(addonId) {
    if (!addonId.trim()) return
    const database = await loadDatabase()
    if (!database.installedAddons[addonId]?.installedVersion) return

    await deleteAddon(addonId)
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
