// require() resolves by note title against this note's own children (see
// CLAUDE.md's "Library note titles must be fully qualified") — this only
// works at module top level. Inside an api.runOnBackend callback, `require`
// is real Node require instead (no note-tree access there at all), which is
// why fetchReadmeHtml below fetches raw content on the backend but calls
// marked.parse() out here on the frontend, not inside that callback.
const marked = require("marked.min.js")

// Constants -------------------------------------------------------------------
const databaseLabel = "database"
const addonRootLabel = "addonRoot"
const libraryRootLabel = "libraryRoot"
const addonPersistenceLabel = "addonPersistence"
const tamFileIdLabel = "TAMFILEID"
const TAM_ID = "trilium-addon-manager@beatlink"
const TAM_VERSION = "4.12.0"
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


function versionCompare(remote, local) {
    return remote.localeCompare(local, undefined, { numeric: true, sensitivity: 'base' })
}

// A single addon's manifest can list dozens of notes (agenda@beatlink alone
// is past 30) — resolveNotes fetches each one's sourceUrl individually and
// sequentially, and a big-enough addon (or its dependency chain, synced one
// dependency at a time) can still burst enough raw.githubusercontent.com
// requests in a short window to trip GitHub's rate limiting (HTTP 429).
// Retries with backoff, honoring Retry-After when GitHub sends one, else
// exponential backoff — used by every fetch() in this file so a transient
// 429 fails a single request's timing, not the whole install.
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


// Database Management ---------------------------------------------------------

async function getDatabaseNoteId() {
    return await api.currentNote.getRelationValue(databaseLabel)
}

async function loadDatabase() {
    const databaseId = await getDatabaseNoteId()
    const database = await api.runOnBackend((databaseId) => {
        return JSON.parse(api.getNote(databaseId).getContent())
    }, [databaseId])
    if (!database.catalogs) database.catalogs = []
    if (!database.installedAddons) database.installedAddons = {}
    return database
}

async function saveDatabase(database) {
    const databaseId = await getDatabaseNoteId()
    return await api.runOnBackend((databaseId, database) => {
        return api.getNote(databaseId).setContent(JSON.stringify(database, null, 4))
    }, [databaseId, database])
}


// Catalog Management ------------------------------------------------------------
// A "catalog" is just a URL serving {"tam-addons": [manifestSourceUrl, ...]} —
// a flat list of addon manifest locations, no cached summary data. Unlike the
// old repository model, an installed addon is never nested under a catalog —
// installedAddons is keyed by addonId alone, so deleting a catalog from the
// browse list never touches anything already installed.

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
    const database = await loadDatabase()
    return database.catalogs
}

async function fetchCatalogJson(catalogUrl) {
    return await api.runAsyncOnBackendWithManualTransactionHandling(async (catalogUrl) => {
        // Duplicated rather than shared with the module-level fetchWithRetry —
        // see the identical comment in resolveNotes' content-fetch callback.
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
        const response = await fetchWithRetry(catalogUrl)
        return await response.json()
    }, [catalogUrl])
}

// Cheap, on-demand lookup for a catalog's own optional `webUrl` (a
// human-browsable website for that catalog, e.g. a GitHub Pages site) —
// used to render a "Visit Website" link per catalog without fetching every
// addon manifest it lists.
async function fetchCatalogMeta(catalogUrl) {
    const catalog = await fetchCatalogJson(catalogUrl)
    return { webUrl: catalog.webUrl || null }
}

// Fetches a catalog's addon list fresh, every time — nothing here is cached,
// since a catalog entry is nothing more than a URL. Individual entry
// fetch failures (a dead link, a malformed manifest) are skipped rather than
// failing the whole browse view.
async function fetchCatalogAddons(catalogUrl) {
    const catalog = await fetchCatalogJson(catalogUrl)

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


// Addon Management ------------------------------------------------------------

async function fetchManifest(manifestSourceUrl) {
    return await api.runAsyncOnBackendWithManualTransactionHandling(async (manifestSourceUrl) => {
        // Duplicated rather than shared with the module-level fetchWithRetry —
        // see the identical comment in resolveNotes' content-fetch callback.
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
        const response = await fetchWithRetry(manifestSourceUrl)
        return await response.json()
    }, [manifestSourceUrl])
}

async function getAddonRootNoteId() {
    return await api.currentNote.getRelationValue(addonRootLabel)
}

// type: "library" addons are never installed on their own (TAM's UI hides
// them entirely — they only ever arrive transitively via some dependent's
// `dependencies[]`), so unlike a user-facing addon there's no reason for one
// to also sit as its own top-level entry under "Addons". They still need
// *some* stable, addon-external parent to be created under during their own
// independent resolveNotes pass, though — a dependency is fully resolved
// once, up front, before the dependent's own cross-addon children[] step
// clones anything from it, so there's no dependent to anchor to yet at
// creation time. "Libraries" exists purely to be that anchor without
// cluttering the addon list a user actually browses.
async function getLibraryRootNoteId() {
    return await api.currentNote.getRelationValue(libraryRootLabel)
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

// The database record for an installed addon stores its own manifest
// structure — everything needed to recreate/reconcile it (notes, children,
// relations, labels, dependencies, exports) — minus `sourceUrl`/`content`.
// This is deliberately NOT the same as "just re-fetch the manifest": a
// manifestSourceUrl only ever serves the *current* version, so once a newer
// one is published there is no other way to know what structure is actually
// installed. It also means the exact same shape describes both "what's
// currently offered" and "what's currently installed," so the same
// resolve/apply functions work on either one — and an upstream manifest
// change never silently affects an addon that hasn't been explicitly synced
// to it yet.
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

// A dependencies[] entry is either a bare id string (resolved against
// whatever's already installed, or against catalogContext — see
// resolveDependencyUrl) or an explicit {id, manifestSourceUrl} object for a
// dependency from an unrelated source. This is the one helper used
// everywhere an id needs pulling out of either shape.
function dependencyId(depEntry) {
    return typeof depEntry === "string" ? depEntry : depEntry.id
}

// "Who depends on this addon" is the reverse of `dependencies`, which is
// already stored (as part of `manifest`) on every OTHER installed addon's own
// record — there is nothing here that needs separately pushing/maintaining
// as its own field, and nothing that can drift out of sync, since it's
// recomputed fresh every time from data that's already there.
function getDependents(database, addonId) {
    const addons = database.installedAddons || {}
    return Object.entries(addons)
        .filter(([depId, addon]) => depId !== addonId && (addon.manifest?.dependencies || []).some(d => dependencyId(d) === addonId))
        .map(([depId]) => depId)
}

// Resolves the manifestSourceUrl to use for a dependency that isn't
// installed yet: an explicit {id, manifestSourceUrl} object always wins; a
// bare id string falls back to catalogContext, a plain {id: manifestSourceUrl}
// map the caller supplies when installing from a specific catalog's browse
// results, so sibling same-catalog dependencies resolve without a fresh
// full catalog search. Returns null if neither source has it — the caller
// then reports the dependency as unresolvable rather than guessing.
function resolveDependencyUrl(depEntry, catalogContext) {
    if (typeof depEntry === "object" && depEntry.manifestSourceUrl) return depEntry.manifestSourceUrl
    const depId = dependencyId(depEntry)
    if (catalogContext && catalogContext[depId]) return catalogContext[depId]
    return null
}

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

// Renders an addon's README as HTML for the detail view. The README is a
// note in the addon's own manifest (its `readmeNote` local id) resolved live
// via #TAMFILEID exactly like any other note — never a network fetch, since
// it's already part of the installed note tree. Returns null if the addon
// declares no readmeNote, or that note can't currently be resolved.
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

// Resolves every note in an addon's own manifest against the live Trilium
// tree by its permanent #TAMFILEID label (`{addonId}/{localId}`) rather than
// any externally-tracked id map — the note itself is the source of truth for
// its own identity, so this is naturally idempotent: re-running it (a retried
// install after a partial failure, a note that survived from a previous
// install) finds and reconciles the existing note instead of creating a
// duplicate. Content/type/mime are only overwritten on a found note if
// `skipOnUpdate`/`promptOnUpdate` don't say otherwise.
//
// Content itself is no longer read from a pre-inlined `content` field —
// each note's `sourceUrl` (relative paths resolved against this manifest's
// own manifestBaseUrl, exactly like an HTML <base href>; absolute URLs used
// as-is) is fetched fresh, backend-side, combined into the same call that
// creates/updates the note so file content never has to travel between
// frontend and backend twice. A literal `content` field on the note def
// still wins if present (an escape hatch for hand-authored notes). A single
// note's fetch failure is logged and that note is skipped rather than
// aborting the whole sync; any of its children are skipped too, since their
// parent never resolved.
async function resolveNotes(m, addonId, addonRootNoteId, manifestBaseUrl, options = {}) {
    const { rootExternallyParented = false, staleAnchorNoteId = null } = options
    // A local note can be listed as a child of more than one parent within
    // the same manifest (a same-addon clone, e.g. a shared settings note
    // pulled into several widgets) — only the first occurrence is where the
    // note actually gets resolved; every later occurrence is wired up as an
    // additional clone branch afterward. A flat parent-per-child map would
    // silently drop every parent but the last one processed.
    const primaryParent = {}
    const extraParents = {}
    for (const c of (m.children || []).filter(c => !c.addon)) {
        if (!(c.child in primaryParent)) {
            primaryParent[c.child] = c.parent
        } else {
            extraParents[c.child] = extraParents[c.child] || []
            extraParents[c.child].push(c.parent)
        }
    }

    // A note targeted by an AddonData: relation holds persisted user data once
    // connectAddonPersistence has run — and since api.duplicateSubtree copies
    // every attribute (including this very #TAMFILEID label) onto the
    // persisted copy it creates, that copy becomes the *only* note left
    // carrying the tag once the original is deleted. On the next sync, a
    // plain content overwrite here would silently clobber the user's actual
    // saved data with the manifest's shipped default. Protect any such note
    // unconditionally — independent of skipOnUpdate/promptOnUpdate, since the
    // manifest already declares the intent via the relation itself.
    const persistedLocalIds = new Set(
        (m.relations || [])
            .filter(r => r.type.startsWith("AddonData:"))
            .map(r => r.to)
    )

    const noteIds = m.notes.map(n => n.id)
    const sortedIds = topologicalSort(noteIds, primaryParent)

    const noteMap = {}
    for (const localId of sortedIds) {
        const noteDef = m.notes.find(n => n.id === localId)
        if (!noteDef) continue

        const parentLocalId = primaryParent[localId]
        const parentRealId = parentLocalId ? noteMap[parentLocalId] : addonRootNoteId
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
        const skipParenting = localId === m.root && rootExternallyParented

        let absoluteSourceUrl = null
        if (noteDef.sourceUrl) {
            try {
                absoluteSourceUrl = new URL(noteDef.sourceUrl, manifestBaseUrl).href
            } catch (e) {
                console.error(`TAM: note '${localId}' of ${addonId} has an unresolvable sourceUrl '${noteDef.sourceUrl}'`, e)
            }
        }

        // "renderAsHTML": true lets a note's source stay authored as plain
        // markdown (e.g. a README.md, hand-edited like any other) while
        // installing as a rendered text/text-html note. The conversion runs
        // out here, frontend-side, because `marked` is resolved via
        // require() against this note's own children at module load — the
        // backend callback below runs in a separate Node context with no
        // note-tree access, so it can't reach it (see fetchReadmeHtml above
        // for the same constraint). That forces one extra frontend fetch for
        // renderAsHTML notes specifically, rather than reusing the backend
        // fetch every other note relies on.
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
                    // this whole function is serialized and executed on the backend,
                    // a separate context that can't close over frontend-scope helpers
                    // (see this file's top comment re: require() inside runOnBackend).
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
                            if (noteType !== "text" || mime !== "text/html") {
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

    await reconcileNoteParenting(m, addonId, noteMap, addonRootNoteId, rootExternallyParented, staleAnchorNoteId)

    return noteMap
}

// Ensures every already-resolved note (noteMap: localId -> real note id) is
// cloned into every parent its manifest currently declares (a same-addon
// clone listed under more than one parent — the "extra parents" beyond the
// first/primary one) and detached from any parent it's no longer declared
// under (a note whose declared parent *changed* between versions — scoped to
// only ever detach a branch this same addon's own manifest created, via the
// stale parent's own #TAMFILEID prefix, so this can never rip out a clone
// another addon's applyDepChildren placed there, or one a user made by
// hand).
//
// staleAnchorNoteId is a narrow exception to that ownership rule: when a
// library-type addon's root migrates from the old "Addons" anchor to the
// new "Libraries" one (see getLibraryRootNoteId), the stale "Addons" branch
// is owned by TAM itself, not this addon, so the #TAMFILEID-prefix check
// alone would never detach it — an addon synced under the old code would be
// stuck permanently parented under both anchors otherwise.
async function reconcileNoteParenting(m, addonId, noteMap, addonRootNoteId, rootExternallyParented, staleAnchorNoteId = null) {
    const primaryParent = {}
    const extraParents = {}
    for (const c of (m.children || []).filter(c => !c.addon)) {
        if (!(c.child in primaryParent)) {
            primaryParent[c.child] = c.parent
        } else {
            extraParents[c.child] = extraParents[c.child] || []
            extraParents[c.child].push(c.parent)
        }
    }

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
        if (localId === m.root && rootExternallyParented) continue
        const noteRealId = noteMap[localId]
        if (!noteRealId) continue

        const desiredRealParents = [primaryParent[localId], ...(extraParents[localId] || [])]
            .map(pid => noteMap[pid])
            .filter(Boolean)
        if (localId === m.root && !rootExternallyParented && addonRootNoteId) {
            desiredRealParents.push(addonRootNoteId)
        }
        if (desiredRealParents.length === 0) continue

        const isRootMigratingAnchor = localId === m.root && staleAnchorNoteId && staleAnchorNoteId !== addonRootNoteId

        await api.runOnBackend((tamFileIdLabel, addonId, noteId, desiredRealParents, staleAnchorId) => {
            const note = api.getNote(noteId)
            const currentParentIds = note.getParentNotes().map(p => p.noteId)
            for (const parentId of currentParentIds) {
                if (desiredRealParents.includes(parentId)) continue
                if (parentId === staleAnchorId) {
                    api.ensureNoteIsAbsentFromParent(noteId, parentId)
                    continue
                }
                const parentNote = api.getNote(parentId)
                const parentTamId = parentNote ? parentNote.getLabelValue(tamFileIdLabel) : null
                if (parentTamId && parentTamId.startsWith(`${addonId}/`)) {
                    api.ensureNoteIsAbsentFromParent(noteId, parentId)
                }
            }
        }, [tamFileIdLabel, addonId, noteRealId, desiredRealParents, isRootMigratingAnchor ? staleAnchorNoteId : null])
    }
}

// A note removed from a newer manifest version needs to actually disappear,
// not orphan forever — resolveNotes only ever resolves notes the *current*
// manifest still declares, so it never even looks at anything else. Finds
// every live note tagged #TAMFILEID with a value prefixed `${addonId}/` and
// deletes any whose local-id suffix isn't in the current manifest's note set.
async function pruneRemovedNotes(m, addonId) {
    const currentLocalIds = m.notes.map(n => n.id)
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
    }, [tamFileIdLabel, addonId, currentLocalIds])
}

// Resolves a dependency's exported note live, by TAMFILEID, instead of a
// cached `exportedNotes` id map: `exports[localId]` (from the dependency's
// own fetched manifest, passed in via `depExportsMap`) tells us the export
// name -> local id, then `#TAMFILEID="{depAddonId}/{localId}"` finds the real
// note. `exports{}` itself stays in the manifest as a real encapsulation
// boundary (a dependency can rename its internal local ids across a version
// bump without breaking consumers) — only the *resolution* is now live.
async function resolveDepNoteId(depAddonId, exportName, depExportsMap) {
    const depExports = depExportsMap.get(depAddonId)
    const depLocalId = depExports?.[exportName]
    if (!depLocalId) return null

    const tamFileId = `${depAddonId}/${depLocalId}`
    return await api.runOnBackend((tamFileIdLabel, tamFileId) => {
        const note = api.getNoteWithLabel(tamFileIdLabel, tamFileId)
        return (note && !note.isDeleted) ? note.noteId : null
    }, [tamFileIdLabel, tamFileId])
}

async function applyDepChildren(m, noteMap, depExportsMap) {
    for (const c of (m.children || []).filter(c => c.addon)) {
        const parentRealId = noteMap[c.parent]
        if (!parentRealId) continue

        if (!depExportsMap.has(c.addon)) {
            console.error(`TAM: dependency ${c.addon} not installed, skipping clone`)
            continue
        }
        const depNoteId = await resolveDepNoteId(c.addon, c.child, depExportsMap)
        if (!depNoteId) {
            console.error(`TAM: dependency ${c.addon} has no export '${c.child}' (or its note is missing), skipping`)
            continue
        }

        await api.runOnBackend((sourceId, parentId) => {
            api.ensureNoteIsPresentInParent(sourceId, parentId)
        }, [depNoteId, parentRealId])
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

async function applyRelations(relations, noteMap, depExportsMap) {
    for (const rel of relations) {
        const fromRealId = noteMap[rel.from]
        if (!fromRealId) continue

        let toRealId
        if (rel.addon) {
            toRealId = await resolveDepNoteId(rel.addon, rel.to, depExportsMap)
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
}

// The one entry point for getting an addon's notes to match its manifest,
// whether that's a genuine first install, a version update, or TAM's own
// self-sync (no delete/reinstall capability, externally-rooted note tree).
// `manifestSourceUrl` is required for a fresh install (nothing stored yet to
// fall back to) and optional for an update (falls back to whatever's
// already recorded). `catalogContext` is an optional {id: manifestSourceUrl}
// map the caller supplies when installing from a specific catalog's browse
// results, letting bare-id dependencies from that same catalog resolve
// without a fresh full catalog search.
async function syncAddon(addonId, options = {}) {
    const { manifestSourceUrl = null, manual = true, updating = new Set(), catalogContext = null } = options
    if (!addonId.trim()) return

    // Re-entrancy guard: syncing a dependency can legitimately re-encounter
    // the same addon more than once (diamond dependencies, or a dependent
    // being the very addon whose own sync triggered the dependency sync).
    if (updating.has(addonId)) return
    updating.add(addonId)

    const isSelf = addonId === TAM_ID

    let database = await loadDatabase()
    const existing = database.installedAddons[addonId]
    const wasInstalled = !!existing?.installedVersion

    const fetchUrl = manifestSourceUrl || existing?.manifestSourceUrl
    if (!fetchUrl) throw new Error(`TAM: no manifestSourceUrl available to sync '${addonId}' (not installed yet, and none provided)`)

    const manifest = await fetchManifest(fetchUrl)

    // Normalize manifest: TAM-next sub-dict or flat top-level
    const m = manifest.manifest ?? {
        notes: manifest.notes ?? [],
        children: [],
        relations: manifest.relations ?? [],
        labels: manifest.labels ?? [],
        root: null,
        dependencies: [],
        exports: {}
    }

    if (!m.root) throw new Error(`TAM: manifest for ${addonId} is missing required 'root' field`)

    // Snapshot promptOnUpdate diffs against current persisted content first.
    // Cheap no-op when there's nothing persisted yet (a fresh install, or an
    // addon with no AddonData: notes).
    const pendingPrompts = await collectPendingPrompts(addonId, m)
    if (pendingPrompts.length > 0) {
        if (!database.installedAddons[addonId]) database.installedAddons[addonId] = {}
        if (!database.installedAddons[addonId].persistence) database.installedAddons[addonId].persistence = {}
        database.installedAddons[addonId].persistence.pendingPrompts = pendingPrompts
        await saveDatabase(database)
    }

    // Sync dependencies first — only if missing or stale. Each already-
    // installed dependency's `exports` map comes straight from its own
    // locally-stored manifest (no network fetch needed unless it's actually
    // being synced right now) — `dependents` needs nothing recorded here at
    // all, since it's computed on demand from every addon's own stored
    // `manifest.dependencies` (see getDependents).
    const depExportsMap = new Map()
    for (const depEntry of (m.dependencies || [])) {
        const depId = dependencyId(depEntry)
        const installedDep = database.installedAddons[depId]

        if (!installedDep?.installedVersion) {
            const depUrl = resolveDependencyUrl(depEntry, catalogContext)
            if (!depUrl) {
                console.error(`TAM: dependency '${depId}' could not be resolved (not installed, and no manifestSourceUrl available) — skipping`)
                depExportsMap.set(depId, {})
                continue
            }
            await syncAddon(depId, { manifestSourceUrl: depUrl, manual: false, updating, catalogContext })
            database = await loadDatabase()
        } else if (installedDep.manifestSourceUrl) {
            try {
                const depManifestFetched = await fetchManifest(installedDep.manifestSourceUrl)
                if (depManifestFetched.latestVersion &&
                    versionCompare(depManifestFetched.latestVersion, installedDep.installedVersion) > 0) {
                    await syncAddon(depId, { manifestSourceUrl: installedDep.manifestSourceUrl, manual: false, updating, catalogContext })
                    database = await loadDatabase()
                }
            } catch (e) {
                // Best-effort staleness check — keep using whatever's installed.
            }
        }
        const dep = database.installedAddons[depId]
        depExportsMap.set(depId, dep?.manifest?.exports || {})
    }

    // A library-type addon roots under "Libraries" instead of flat under
    // "Addons" — falls back to the ordinary addon root if the library anchor
    // isn't resolvable for some reason (e.g. an old TAM install mid-update),
    // rather than failing the sync outright. staleAnchorNoteId lets a library
    // synced under an older TAM version (before "Libraries" existed, so its
    // root ended up under "Addons") get migrated off that old anchor instead
    // of permanently sitting under both.
    const genericAddonRootNoteId = await getAddonRootNoteId()
    const libraryRootNoteId = manifest.type === "library" ? await getLibraryRootNoteId() : null
    const addonRootNoteId = libraryRootNoteId || genericAddonRootNoteId
    const staleAnchorNoteId = (manifest.type === "library" && libraryRootNoteId) ? genericAddonRootNoteId : null
    const noteMap = await resolveNotes(m, addonId, addonRootNoteId, fetchUrl, { rootExternallyParented: isSelf, staleAnchorNoteId })
    if (!noteMap[m.root]) throw new Error(`TAM: root note '${m.root}' was not resolved for ${addonId}`)

    await applyDepChildren(m, noteMap, depExportsMap)
    await applyLabels(m.labels || [], noteMap)
    await applyRelations(m.relations || [], noteMap, depExportsMap)
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
        // Preserve any persistence data surviving from a previous install of
        // this same addonId (e.g. it was uninstalled but had persisted
        // notes) — everything else here is meant to start fresh.
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
        // Must be explicit: this used to be an implicit side effect of
        // installAddon replacing the whole record object on every reinstall.
        rec.updateAvailable = false
        if (manual && !rec.manuallyInstalled) rec.manuallyInstalled = true
    }
    await saveDatabase(database)

    if (!wasInstalled && !isSelf) await enableAddon(addonId, false)
    await connectAddonPersistence(addonId)
}

// Convenience wrapper for "install an addon directly by its
// manifestSourceUrl" (the UI's "add addon by URL" action) — the caller
// doesn't need to already know the addon's id, unlike syncAddon itself.
async function installByUrl(manifestSourceUrl, options = {}) {
    const manifest = await fetchManifest(manifestSourceUrl)
    if (!manifest.id) throw new Error("TAM: manifest has no 'id' field")
    await syncAddon(manifest.id, { ...options, manifestSourceUrl })
}

async function getPersistenceNoteId() {
    return await api.currentNote.getRelationValue(addonPersistenceLabel)
}

async function connectAddonPersistence(addonId) {
    const persistenceRoot = await getPersistenceNoteId()
    let database = await loadDatabase()

    const addonRecord = database.installedAddons[addonId]
    if (!addonRecord.persistence) addonRecord.persistence = {}
    if (!addonRecord.persistence.persistenceNotes) addonRecord.persistence.persistenceNotes = {}

    const addonNoteId = await resolveStoredNoteId(addonId, addonRecord.manifest?.root)
    if (!addonNoteId) return
    const existingPersistRoot = addonRecord.persistence.rootNote || null
    const existingNotes = addonRecord.persistence.persistenceNotes

    // Single pass: create persisted copies, rewire AddonData: relations, delete originals.
    // Uses removeRelation + addRelation instead of setRelation: removeRelation fires attributeDeleted
    // which properly updates becca's targetRelations reverse index for the old target note.
    // This prevents deleteNote's cascade from finding and killing the rewired relation.
    // Everything runs in one runOnBackend so UI reload from note deletion can't interrupt it.
    // The addon's own persistence folder (`persistRoot`) is created lazily, the first time a note
    // actually needs to be duplicated into it — most addons persist nothing, and shouldn't get an
    // empty folder under Addon Data for it. If nothing ends up living in it (nothing to persist, or
    // everything that was persisted got removed since), it's deleted again before returning.
    const outcome = await api.runOnBackend((tamFileIdLabel, addonNoteId, persistenceRoot, addonId, existingPersistRoot, existingNotes) => {
        const result = {}
        const toDelete = []
        let persistRoot = existingPersistRoot

        for (const noteId of api.getNote(addonNoteId).getSubtreeNoteIds()) {
            const note = api.getNote(noteId)
            // getSubtreeNoteIds() descends through every descendant — for
            // most addons that's just their own notes, but TAM's own root
            // has the "Addons" folder as a child, which is the parent every
            // *other* installed addon's entire tree lives under. Without
            // this guard, TAM's own self-sync would sweep up every other
            // addon's AddonData: relations too, duplicate their target notes
            // into TAM's own persistence folder, and record them under TAM's
            // own persistenceNotes — corrupting both addons' bookkeeping on
            // every single TAM self-update.
            const ownTamFileId = note.getLabelValue(tamFileIdLabel)
            if (!ownTamFileId || !ownTamFileId.startsWith(`${addonId}/`)) continue
            for (const relation of note.getRelations()) {
                if (!relation.name.includes("AddonData:")) continue
                const key = relation.name.split("AddonData:")[1]
                const origNoteId = relation.value
                let persistNoteId = existingNotes[key]
                if (!persistNoteId || !api.getNote(persistNoteId)) {
                    if (!persistRoot) {
                        const rootResult = api.createTextNote(persistenceRoot, addonId, "")
                        rootResult.note.setLabel("iconClass", "bx bx-customize")
                        persistRoot = rootResult.note.noteId
                    }
                    const origTitle = api.getNote(origNoteId).title
                    const dup = api.duplicateSubtree(origNoteId, persistRoot)
                    dup.note.title = origTitle
                    dup.note.save()
                    persistNoteId = dup.note.noteId
                }
                note.removeRelation(relation.name)
                note.addRelation(relation.name, persistNoteId)
                result[key] = persistNoteId
                if (origNoteId !== persistNoteId) {
                    toDelete.push(origNoteId)
                }
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
    }, [tamFileIdLabel, addonNoteId, persistenceRoot, addonId, existingPersistRoot, existingNotes])

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

// Retroactive sweep for addons whose persistence folder was created before
// it was made just-in-time (or whose persisted notes all disappeared some
// other way) — removes any recorded persistence root that's now empty and
// clears the stale reference. Run alongside checkForAddonUpdates.
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

            // Nothing installed and nothing left worth keeping — drop the
            // whole record rather than leaving an empty husk behind.
            const hasPersistedNotes = persistence.persistenceNotes &&
                Object.keys(persistence.persistenceNotes).length > 0
            if (!addonRecord.installedVersion && !hasPersistedNotes && !persistence.pendingPrompts) {
                delete database.installedAddons[addonId]
            }
        }
    }

    if (changed) await saveDatabase(database)
}

// Removes only the branches this addon's own manifest actually owns, for
// every note it declares — never a blanket note-level delete. A note is only
// ever truly removed once none of its parents are left; a note that's also
// cloned somewhere outside this addon's own subtree (an exported note a
// dependent still holds, or — before a library's own #TAMFILEID-tagged
// parents exist — its Addons/Libraries anchor branch) survives via that
// other branch untouched. This intentionally doesn't rely on assumptions
// about how Trilium's own deleteNote() cascade treats a descendant with
// another live parent — every note in the manifest is checked and detached
// individually, so correctness never depends on cascade behavior at all.
async function detachAddonOwnedBranches(addonId, m) {
    const addonRootNoteId = await getAddonRootNoteId()
    const libraryRootNoteId = await getLibraryRootNoteId()
    const anchorIds = [addonRootNoteId, libraryRootNoteId].filter(Boolean)

    for (const noteDef of m.notes || []) {
        const noteId = await resolveStoredNoteId(addonId, noteDef.id)
        if (!noteId) continue
        await api.runOnBackend((tamFileIdLabel, addonId, noteId, anchorIds) => {
            const note = api.getNote(noteId)
            if (!note || note.isDeleted) return
            for (const parentNote of note.getParentNotes()) {
                const isAnchor = anchorIds.includes(parentNote.noteId)
                const parentTamId = parentNote.getLabelValue(tamFileIdLabel)
                const ownedByThisAddon = parentTamId && parentTamId.startsWith(`${addonId}/`)
                // Preserve any parent branch that's clearly owned by a
                // *different* addon (its own #TAMFILEID prefix says so) —
                // everything else (this addon's own parents, an anchor
                // folder, an untagged/manual parent) is fair game to detach.
                const ownedByAnotherAddon = parentTamId && !ownedByThisAddon && !isAnchor
                if (!ownedByAnotherAddon) {
                    api.ensureNoteIsAbsentFromParent(noteId, parentNote.noteId)
                }
            }
            const stillLive = api.getNote(noteId)
            if (stillLive && !stillLive.isDeleted && stillLive.getParentNotes().length === 0) {
                stillLive.deleteNote()
            }
        }, [tamFileIdLabel, addonId, noteId, anchorIds])
    }
}

async function deleteAddon(addonId) {
    if (!addonId.trim()) return
    let database = await loadDatabase()
    const addonRecord = database.installedAddons[addonId]
    if (addonRecord?.manifest) {
        await detachAddonOwnedBranches(addonId, addonRecord.manifest)
    }

    const persistence = addonRecord.persistence
    const hasPersistedData = persistence && (
        persistence.rootNote ||
        (persistence.persistenceNotes && Object.keys(persistence.persistenceNotes).length > 0)
    )

    if (hasPersistedData) {
        // Drop everything describing the now-deleted installed state, but
        // keep the persisted user data around — it must survive uninstall.
        database.installedAddons[addonId] = { persistence }
    } else {
        delete database.installedAddons[addonId]
    }
    await saveDatabase(database)
}

// Pre-uninstall safety check: finds every relation pointing *into* an
// addon's subtree from a note *outside* it — these would be left dangling
// (pointing at a deleted note) once deleteAddon removes the subtree, since
// deleteNote's cascade only follows relations owned by deleted notes, never
// relations that merely target one. A manifest can opt out entirely via
// "allowExternalReferences": true on its own manifest sub-object, for an
// addon whose code re-establishes any such relation itself on every load
// (e.g. expanded@beatlink sets a runOnBranchChange relation on Trilium's own
// root note, pointing at its backend script note, every time it runs — so a
// dangling copy left behind by uninstall is harmless and self-heals on
// reinstall rather than needing a user warning).
async function findExternalReferences(addonId) {
    const database = await loadDatabase()
    const addonRecord = database.installedAddons[addonId]
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

// The user-facing "uninstall" action. Unlike deleteAddon (the low-level
// primitive — just remove this one addon's own notes), this also recursively
// uninstalls any of its own dependencies that are now unused (getDependents
// finds nothing else still depending on them, now that addonId's own record
// is gone) and weren't installed directly by the user.
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

        // dependents is never stored — recompute now that addonId's own
        // record is already gone, so it naturally no longer counts.
        const stillNeeded = getDependents(database, depId).length > 0
        const depIsManual = dep.manuallyInstalled ?? true
        if (!depIsManual && !stillNeeded) {
            await uninstallAddon(depId)
        }
    }
}

// Recovery tool: uninstalls every addon except TAM itself (which can't
// uninstall itself mid-operation, and is needed afterward to reinstall
// anything from a catalog) — a real cleanup, deleting each addon's actual
// notes via the normal uninstallAddon path — then hard-resets the Database
// note itself down to just its catalogs and a bare TAM entry (only
// manifestSourceUrl; no installedVersion/meta/manifest/persistence), so
// there's nothing left of the old bookkeeping to drift out of sync again.
// TAM re-derives its own installed state next time it's synced.
async function reinitializeDatabase() {
    let database = await loadDatabase()
    const addonIds = Object.keys(database.installedAddons || {}).filter(id => id !== TAM_ID)
    for (const addonId of addonIds) {
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
    const prompts = database.installedAddons?.[addonId]?.persistence?.pendingPrompts || []
    const prompt = prompts.find(p => p.noteLocalId === noteLocalId)
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


async function enableAddon(addonId, enabled) {
    if (!addonId.trim()) return
    let database = await loadDatabase()
    const addon = database.installedAddons[addonId]
    const rootNoteId = await resolveStoredNoteId(addonId, addon.manifest?.root)
    if (!rootNoteId) return
    await api.runOnBackend((tamFileIdLabel, addonId, noteId, enabled, addonLabels) => {
        const ids = api.getNote(noteId).getSubtreeNoteIds()
        for (const id of ids) {
            const note = api.getNote(id)
            // See the identical guard (and its comment) in connectAddonPersistence:
            // getSubtreeNoteIds() on TAM's own root descends into "Addons", the
            // parent every other installed addon's tree lives under — without
            // this, disabling TAM would disable every other addon too.
            const ownTamFileId = note.getLabelValue(tamFileIdLabel)
            if (!ownTamFileId || !ownTamFileId.startsWith(`${addonId}/`)) continue
            const attributes = note.getAttributes() || []
            for (const attribute of attributes) {
                if (enabled === true) {
                    if (attribute.name.toLowerCase().includes("disabled:")) {
                        const name = attribute.name.replace("disabled:", "")
                        const value = attribute.value
                        const type = attribute.type
                        const isInheritable = attribute.isInheritable
                        const position = attribute.position
                        note.removeAttribute(type, attribute.name)
                        note.addAttribute(type, name, value, isInheritable, position)
                    }
                } else {
                    if (addonLabels.includes(attribute.name)) {
                        const name = `disabled:${attribute.name}`
                        const value = attribute.value
                        const type = attribute.type
                        const isInheritable = attribute.isInheritable
                        const position = attribute.position
                        note.removeAttribute(type, attribute.name)
                        note.addAttribute(type, name, value, isInheritable, position)
                    }
                }
            }
        }
    }, [tamFileIdLabel, addonId, rootNoteId, enabled, addonLabels])
    database.installedAddons[addonId].enabled = enabled
    await saveDatabase(database)
}


// Returns every installed addon merged with its own stored display fields
// (meta/installedVersion/manifestSourceUrl/etc.) plus live-resolved
// rootNoteId/settingsNoteId — the data the main list/detail views render.
// Unlike the old per-repository model, this never touches the network:
// browsing what's available from a catalog is a separate, on-demand action
// (fetchCatalogAddons), since a catalog is now just a flat list of URLs with
// no cached summary data. TAM itself is not special-cased here — its own
// Database record (seeded with just a manifestSourceUrl in database.json)
// gets turned into a real, fully-populated entry the same way any other
// addon's does, via an ordinary syncAddon call the UI triggers on load if
// it isn't fully installed yet (see RepoManager's "load-addons" handler).
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

// Fetches every installed addon's own manifestSourceUrl directly and
// compares latestVersion against installedVersion — there's no longer a
// per-catalog cached registry to diff against, since catalogs cache
// nothing. Best-effort per addon: a fetch failure just leaves whatever
// updateAvailable state was already there.
async function checkForAddonUpdates() {
    let database = await loadDatabase()
    const installed = database.installedAddons || {}

    await Promise.all(Object.entries(installed).map(async ([addonId, addon]) => {
        if (!addon.installedVersion || !addon.manifestSourceUrl) return
        const url = addon.manifestSourceUrl
        try {
            const manifest = await fetchManifest(url)
            if (manifest.latestVersion) {
                addon.updateAvailable = versionCompare(manifest.latestVersion, addon.installedVersion) > 0
            }
        } catch (e) {
            // Best-effort — leave whatever updateAvailable state was there.
        }
    }))

    // Libraries are hidden from the UI, so an update sitting on one would
    // otherwise be invisible. Surface it on whatever depends on it (directly
    // or transitively) instead. Fixed-point loop since updateAvailable only
    // ever flips false->true here, so it always terminates and is
    // insensitive to iteration order (a diamond dependency can otherwise get
    // visited before its own upstream flag has propagated).
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


// Validates the whole installed-addon graph against the real Trilium note
// tree: every declared dependency is actually installed, the stored
// manifest's root/settingsNote local ids still resolve to real notes, no two
// live notes claim the same #TAMFILEID (the one thing genuinely ambiguous to
// a live lookup — everything else here resolves by that label, so there's no
// separate cached id that could drift), and every live AddonData: relation
// in an addon's subtree still points at the persisted copy TAM thinks it
// does. There's no dependent-symmetry check — dependents is computed on
// demand (getDependents), never stored, so it can't go out of sync.
// Read-only: this never fixes anything itself. There's no offline "repair"
// path anymore either — an addon with an issue here should just be
// reinstalled/updated (syncAddon already idempotently reconciles everything
// fresh via #TAMFILEID), rather than reconciled from a locally stored
// snapshot that might itself be the thing that's wrong.
// Returns a flat list of { addonId, message } issues (empty if everything
// checks out).
async function validateDatabase() {
    const database = await loadDatabase()
    const issues = []

    const duplicateTamFileIds = await api.runOnBackend((tamFileIdLabel) => {
        const byValue = {}
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            const value = note.getLabelValue(tamFileIdLabel)
            byValue[value] = byValue[value] || []
            byValue[value].push(note.noteId)
        }
        return Object.entries(byValue).filter(([, noteIds]) => noteIds.length > 1)
    }, [tamFileIdLabel])

    for (const [tamFileId, noteIds] of duplicateTamFileIds) {
        const dupAddonId = tamFileId.split("/")[0]
        issues.push({
            addonId: dupAddonId,
            message: `TAMFILEID '${tamFileId}' is duplicated across notes ${noteIds.join(", ")}`
        })
    }

    for (const [addonId, addon] of Object.entries(database.installedAddons || {})) {
        const isInstalled = !!addon.installedVersion
        const persistence = addon.persistence || {}
        const manifest = addon.manifest || {}

        const backendIssues = await api.runOnBackend((tamFileIdLabel, addonId, manifest, persistence, isInstalled) => {
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

            let rootNoteId = null
            if (isInstalled) {
                rootNoteId = resolveLocal(manifest.root)
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
                if (!noteExists(realId)) {
                    found.push(`persisted note '${key}' (${realId}) is missing`)
                }
            }

            if (isInstalled && rootNoteId) {
                for (const noteId of api.getNote(rootNoteId).getSubtreeNoteIds()) {
                    const note = api.getNote(noteId)
                    if (!note) continue
                    // Same guard as connectAddonPersistence/enableAddon: TAM's own
                    // root subtree descends into every other installed addon via
                    // "Addons", so without this a scan of TAM's own tree would
                    // misattribute other addons' AddonData: relations to TAM.
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
        }, [tamFileIdLabel, addonId, manifest, persistence, isInstalled])

        for (const message of backendIssues) {
            issues.push({ addonId, message })
        }

        if (!isInstalled) continue

        // Symmetry checks no longer apply — dependents is computed on
        // demand (getDependents), never stored, so there's nothing to
        // drift out of sync. Only a genuinely missing dependency is
        // worth reporting.
        for (const depEntry of (manifest.dependencies || [])) {
            const depId = dependencyId(depEntry)
            const dep = database.installedAddons[depId]
            if (!dep?.installedVersion) {
                issues.push({ addonId, message: `depends on '${depId}', which is not installed` })
            }
        }
    }

    return issues
}


// Exports ---------------------------------------------------------------------
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
