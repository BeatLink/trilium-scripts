// Constants -------------------------------------------------------------------
const databaseLabel = "database"
const addonRootLabel = "addonRoot"
const addonPersistenceLabel = "addonPersistence"
const tamFileIdLabel = "TAMFILEID"
const githubURL = "https://github.com"
const releasesPath = "releases/latest/download"
const TAM_ID = "trilium-addon-manager@beatlink"
const TAM_VERSION = "3.0.0"
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


// Database Management ---------------------------------------------------------

async function getDatabaseNoteId() {
    return await api.currentNote.getRelationValue(databaseLabel)
}

async function loadDatabase() {
    const databaseId = await getDatabaseNoteId()
    const database = await api.runOnBackend((databaseId) => {
        return JSON.parse(api.getNote(databaseId).getContent())
    }, [databaseId])
    if (!database.repositories)    database.repositories    = {}
    if (!database.installedAddons) database.installedAddons = {}

    // One-time migration: persistence used to live in its own top-level tree,
    // parallel to installedAddons, duplicating every repoId/addonId lookup
    // (and requiring separate checks to keep it alive across an uninstall).
    // Fold each entry into that addon's own record instead. Idempotent and
    // safe to run on every load — whichever save happens next naturally
    // drops the stale top-level key once the merged shape is written back.
    if (database.persistence) {
        for (const [repoId, addons] of Object.entries(database.persistence)) {
            for (const [addonId, persistence] of Object.entries(addons || {})) {
                if (!database.installedAddons[repoId]) database.installedAddons[repoId] = {}
                if (!database.installedAddons[repoId][addonId]) database.installedAddons[repoId][addonId] = {}
                if (!database.installedAddons[repoId][addonId].persistence) {
                    database.installedAddons[repoId][addonId].persistence = persistence
                }
            }
        }
        delete database.persistence
    }

    return database
}

async function saveDatabase(database) {
    const databaseId = await getDatabaseNoteId()
    return await api.runOnBackend((databaseId, database) => {
        return api.getNote(databaseId).setContent(JSON.stringify(database, null, 4))
    }, [databaseId, database])
}


// Repository Management -------------------------------------------------------

async function addRepository(repoId) {
    if (!repoId.trim()) return
    let database = await loadDatabase()
    if (!database.repositories[repoId])            { database.repositories[repoId]            = {} }
    if (!database.repositories[repoId].addons)     { database.repositories[repoId].addons     = {} }
    if (!database.installedAddons[repoId])         { database.installedAddons[repoId]         = {} }
    await saveDatabase(database)
    await updateRepositories()
}

async function getAllRepositories() {
    let database = await loadDatabase()

    // rootNoteId/settingsNoteId are no longer cached — the UI still needs
    // concrete ids (Settings button, etc.), so resolve them live via
    // TAMFILEID, batched into one backend round trip for every installed
    // addon rather than one query per addon.
    const lookups = []
    for (const [repoId, addons] of Object.entries(database.installedAddons || {})) {
        for (const [addonId, addon] of Object.entries(addons || {})) {
            if (!addon.installedVersion || !addon.manifest) continue
            lookups.push({
                key: `${repoId}::${addonId}`,
                addonId,
                rootLocalId: addon.manifest.root,
                settingsLocalId: addon.manifest.settingsNote
            })
        }
    }
    const resolved = await api.runOnBackend((tamFileIdLabel, lookups) => {
        const result = {}
        for (const { key, addonId, rootLocalId, settingsLocalId } of lookups) {
            function resolveLocal(localId) {
                if (!localId) return null
                const note = api.getNoteWithLabel(tamFileIdLabel, `${addonId}/${localId}`)
                return (note && !note.isDeleted) ? note.noteId : null
            }
            result[key] = {
                rootNoteId: resolveLocal(rootLocalId),
                settingsNoteId: resolveLocal(settingsLocalId)
            }
        }
        return result
    }, [tamFileIdLabel, lookups])

    for (const [repoId, repoData] of Object.entries(database.repositories)) {
        const installedAddons = database.installedAddons[repoId] || {}
        for (const [addonId, addonData] of Object.entries(repoData.addons || {})) {
            if (installedAddons[addonId]?.installedVersion) {
                Object.assign(addonData, installedAddons[addonId])
                const ids = resolved[`${repoId}::${addonId}`]
                if (ids) Object.assign(addonData, ids)
            } else if (addonId === TAM_ID) {
                addonData.installedVersion = TAM_VERSION
                addonData.updateAvailable = addonData.latestVersion !== TAM_VERSION
                addonData.enabled = true
            }
        }
    }
    return database.repositories
}

async function fetchMetadata(repoId) {
    const fullURL = `${githubURL}/${repoId}/${releasesPath}/metadata.json`
    return await api.runAsyncOnBackendWithManualTransactionHandling(async (fullURL) => {
        const response = await fetch(fullURL)
        return await response.json()
    }, [fullURL])
}

async function updateRepositories() {
    let database = await loadDatabase()
    for (let [repoId] of Object.entries(database.repositories)) {
        database.repositories[repoId] = await fetchMetadata(repoId)
    }
    await saveDatabase(database)
    await checkForAddonUpdates()
    await cleanupEmptyPersistenceRoots()
    await backfillTamFileIds()
    await backfillInstalledManifests()
}

async function checkForAddonUpdates() {
    let database = await loadDatabase()
    for (const [remoteRepoId, remoteRepo] of Object.entries(database.repositories || {})) {
        const installedRepo = database.installedAddons[remoteRepoId]
        if (remoteRepo.addons && installedRepo) {
            for (const [remoteAddonId, remoteAddon] of Object.entries(remoteRepo.addons)) {
                const installedAddon = installedRepo[remoteAddonId]
                if (installedAddon?.installedVersion && remoteAddon?.latestVersion) {
                    installedAddon.updateAvailable = versionCompare(
                        remoteAddon.latestVersion,
                        installedAddon.installedVersion
                    ) > 0
                }
            }

            // Libraries are hidden from the UI, so an update sitting on one
            // would otherwise be invisible. Surface it on whatever depends on
            // it (directly or transitively) instead. Fixed-point loop since
            // updateAvailable only ever flips false->true here, so it always
            // terminates and is insensitive to iteration order (a diamond
            // dependency can otherwise get visited before its own upstream
            // flag has propagated).
            let changed = true
            while (changed) {
                changed = false
                for (const addonId of Object.keys(installedRepo)) {
                    const addon = installedRepo[addonId]
                    if (!addon.updateAvailable) continue
                    for (const dependentId of getDependents(database, remoteRepoId, addonId)) {
                        const dependent = installedRepo[dependentId]
                        if (dependent && !dependent.updateAvailable) {
                            dependent.updateAvailable = true
                            changed = true
                        }
                    }
                }
            }
        }
    }
    await saveDatabase(database)
}

async function deleteRepository(repoId) {
    if (!repoId.trim()) return
    let database = await loadDatabase()
    if (!database.installedAddons[repoId] || Object.keys(database.installedAddons[repoId]).length === 0) {
        delete database.installedAddons[repoId]
        delete database.repositories[repoId]
        await saveDatabase(database)
    }
}


// Addon Management ------------------------------------------------------------

async function fetchManifest(repoId, addonId) {
    const fullURL = `${githubURL}/${repoId}/${releasesPath}/${addonId}.json`
    return await api.runAsyncOnBackendWithManualTransactionHandling(async (fullURL) => {
        const response = await fetch(fullURL)
        return await response.json()
    }, [fullURL])
}

async function getAddonRootNoteId() {
    return await api.currentNote.getRelationValue(addonRootLabel)
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
// This is deliberately NOT the same as "just re-fetch the manifest": GitHub
// Releases here only ever serves the *latest* version, so once a newer one
// is published there is no other way to know what structure is actually
// installed. It also means the exact same shape describes both "what a
// repository offers" and "what's currently installed," so the same
// resolve/apply functions work on either one — and an upstream manifest
// change never silently affects an addon that hasn't been explicitly synced
// to it yet.
function stripManifestForStorage(m) {
    return {
        root: m.root,
        settingsNote: m.settingsNote,
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

// "Who depends on this addon" is the reverse of `dependencies`, which is
// already stored (as part of `manifest`) on every OTHER installed addon's own
// record — there is nothing here that needs separately pushing/maintaining
// as its own field, and nothing that can drift out of sync, since it's
// recomputed fresh every time from data that's already there.
function getDependents(database, repoId, addonId) {
    const addons = database.installedAddons[repoId] || {}
    return Object.entries(addons)
        .filter(([depId, addon]) => depId !== addonId && (addon.manifest?.dependencies || []).includes(addonId))
        .map(([depId]) => depId)
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

// Resolves every note in an addon's own manifest against the live Trilium
// tree by its permanent #TAMFILEID label (`{addonId}/{localId}`) rather than
// any externally-tracked id map — the note itself is the source of truth for
// its own identity, so this is naturally idempotent: re-running it (a retried
// install after a partial failure, a note that survived from a previous
// install) finds and reconciles the existing note instead of creating a
// duplicate. Content/type/mime are only overwritten on a found note if
// `skipOnUpdate`/`promptOnUpdate` don't say otherwise — `createNotes` never
// used to hit an existing note at all (always a fresh create), so this
// gating is new: without it, a found note could silently clobber user data
// it wasn't expecting to still be there.
async function resolveNotes(m, addonId, addonRootNoteId, options = {}) {
    const { rootExternallyParented = false } = options
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
        const content   = noteDef.content  ?? ""
        const noteType  = noteDef.type     ?? "text"
        const mime      = noteDef.mime     ?? "text/html"
        const isBinary  = noteDef.binary   ?? false
        const tamFileId = `${addonId}/${localId}`
        const isPersisted = persistedLocalIds.has(localId)
        // TAM's own root note lives wherever the user manually ZIP-imported
        // it — an ancestor of the Addons tree, not a sibling under it. Never
        // touch its parent when found already existing (which, in practice,
        // is the only branch this ever hits for it — see syncAddon).
        const skipParenting = localId === m.root && rootExternallyParented

        const realNoteId = await api.runOnBackend(
            (tamFileIdLabel, tamFileId, parentRealId, title, noteType, mime, content, isBinary, skipOnUpdate, promptOnUpdate, isPersisted, skipParenting) => {
                let existing = api.getNoteWithLabel(tamFileIdLabel, tamFileId)
                if (existing && existing.isDeleted) existing = null

                if (existing) {
                    if (!skipParenting) api.ensureNoteIsPresentInParent(existing.noteId, parentRealId)
                    if (!skipOnUpdate && !promptOnUpdate && !isPersisted) {
                        if (noteType !== "text" || mime !== "text/html") {
                            existing.type = noteType
                            existing.mime = mime
                            existing.save()
                        }
                        existing.setContent(isBinary ? Buffer.from(content, "base64") : content)
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
                note.setContent(isBinary ? Buffer.from(content, "base64") : content)
                note.setLabel(tamFileIdLabel, tamFileId)
                return note.noteId
            },
            [tamFileIdLabel, tamFileId, parentRealId, noteDef.title, noteType, mime, content, isBinary,
                !!noteDef.skipOnUpdate, !!noteDef.promptOnUpdate, isPersisted, skipParenting]
        )
        noteMap[localId] = realNoteId
    }

    await reconcileNoteParenting(m, addonId, noteMap, addonRootNoteId, rootExternallyParented)

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
// hand). Shared by resolveNotes (right after resolving/creating each note,
// during a real sync) and repairAddon (structure-only reconciliation against
// the locally stored manifest, no content, no creation).
async function reconcileNoteParenting(m, addonId, noteMap, addonRootNoteId, rootExternallyParented) {
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

        await api.runOnBackend((tamFileIdLabel, addonId, noteId, desiredRealParents) => {
            const note = api.getNote(noteId)
            const currentParentIds = note.getParentNotes().map(p => p.noteId)
            for (const parentId of currentParentIds) {
                if (desiredRealParents.includes(parentId)) continue
                const parentNote = api.getNote(parentId)
                const parentTamId = parentNote ? parentNote.getLabelValue(tamFileIdLabel) : null
                if (parentTamId && parentTamId.startsWith(`${addonId}/`)) {
                    api.ensureNoteIsAbsentFromParent(noteId, parentId)
                }
            }
        }, [tamFileIdLabel, addonId, noteRealId, desiredRealParents])
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

// TAM's manual-ZIP-import bootstrap bridge: for any of TAM's own manifest
// notes not yet carrying a #TAMFILEID (a fresh import, or one predating this
// convention), fall back to the old title-matching traversal exactly once
// and tag immediately — so resolveNotes only ever needs to *find*, never
// create, any of TAM's own notes.
async function tagUntaggedSelfNotes(m, addonId) {
    let titleTraversal = null
    for (const noteDef of m.notes) {
        const existing = await resolveStoredNoteId(addonId, noteDef.id)
        if (existing) continue

        if (!titleTraversal) {
            const libTamNoteId = api.currentNote.noteId
            titleTraversal = await api.runOnBackend((libTamNoteId, manifestNotes) => {
                const result = {}
                const sourceCode = api.getNote(libTamNoteId).getParentNotes()[0]
                const tamRoot = sourceCode ? sourceCode.getParentNotes()[0] : null
                if (!tamRoot) return result
                for (const noteId of tamRoot.getSubtreeNoteIds()) {
                    const note = api.getNote(noteId)
                    const def = manifestNotes.find(n => n.title === note.title)
                    if (def) result[def.id] = noteId
                }
                return result
            }, [libTamNoteId, m.notes])
        }
        const realNoteId = titleTraversal[noteDef.id]
        if (realNoteId) {
            const tamFileId = `${addonId}/${noteDef.id}`
            await api.runOnBackend((noteId, tamFileIdLabel, tamFileId) => {
                api.getNote(noteId).setLabel(tamFileIdLabel, tamFileId)
            }, [realNoteId, tamFileIdLabel, tamFileId])
        }
    }
}

// The one entry point for getting an addon's notes to match its manifest,
// whether that's a genuine first install, a version update, or TAM's own
// self-sync (no delete/reinstall capability, externally-rooted note tree).
// All three used to be separate functions (installAddon/updateAddon/
// selfUpdateAddon) differing only because note resolution used to require
// deleting everything first to guarantee a clean slate — find-or-create by
// #TAMFILEID removes that requirement, so they're now one idempotent path.
async function syncAddon(repoId, addonId, options = {}) {
    const { manual = true, updating = new Set() } = options
    if (!repoId.trim() || !addonId.trim()) return

    // Re-entrancy guard: syncing a dependency can legitimately re-encounter
    // the same addon more than once (diamond dependencies, or a dependent
    // being the very addon whose own sync triggered the dependency sync).
    const key = `${repoId}::${addonId}`
    if (updating.has(key)) return
    updating.add(key)

    const isSelf = addonId === TAM_ID

    let database = await loadDatabase()
    const existing = (database.installedAddons[repoId] || {})[addonId]
    const wasInstalled = !!existing?.installedVersion

    const manifest = await fetchManifest(repoId, addonId)

    // Normalize manifest: TAM-next sub-dict or flat top-level
    const m = manifest.manifest ?? {
        notes:        manifest.notes     ?? [],
        children:     [],
        relations:    manifest.relations ?? [],
        labels:       manifest.labels    ?? [],
        root:         null,
        dependencies: [],
        exports:      {}
    }

    if (!m.root) throw new Error(`TAM: manifest for ${addonId} is missing required 'root' field`)

    // Snapshot promptOnUpdate diffs against current persisted content first.
    // Cheap no-op when there's nothing persisted yet (a fresh install, or an
    // addon with no AddonData: notes).
    const pendingPrompts = await collectPendingPrompts(repoId, addonId, m)
    if (pendingPrompts.length > 0) {
        if (!database.installedAddons[repoId])          database.installedAddons[repoId]          = {}
        if (!database.installedAddons[repoId][addonId]) database.installedAddons[repoId][addonId] = {}
        if (!database.installedAddons[repoId][addonId].persistence) {
            database.installedAddons[repoId][addonId].persistence = {}
        }
        database.installedAddons[repoId][addonId].persistence.pendingPrompts = pendingPrompts
        await saveDatabase(database)
    }

    // Sync dependencies first — only if missing or stale. Each already-
    // installed dependency's `exports` map comes straight from its own
    // locally-stored manifest (no network fetch needed unless it's actually
    // being synced right now) — `dependents` needs nothing recorded here at
    // all, since it's computed on demand from every addon's own stored
    // `manifest.dependencies` (see getDependents).
    const depExportsMap = new Map()
    for (const depAddonId of (m.dependencies || [])) {
        const installedDep = (database.installedAddons[repoId] || {})[depAddonId]
        if (!installedDep?.installedVersion) {
            await syncAddon(repoId, depAddonId, { manual: false, updating })
            database = await loadDatabase()
        } else {
            const depManifestFetched = await fetchManifest(repoId, depAddonId)
            if (depManifestFetched.latestVersion &&
                versionCompare(depManifestFetched.latestVersion, installedDep.installedVersion) > 0) {
                await syncAddon(repoId, depAddonId, { manual: false, updating })
                database = await loadDatabase()
            }
        }
        const dep = (database.installedAddons[repoId] || {})[depAddonId]
        depExportsMap.set(depAddonId, dep?.manifest?.exports || {})
    }

    if (isSelf) await tagUntaggedSelfNotes(m, addonId)

    const addonRootNoteId = await getAddonRootNoteId()
    const noteMap = await resolveNotes(m, addonId, addonRootNoteId, { rootExternallyParented: isSelf })
    if (!noteMap[m.root]) throw new Error(`TAM: root note '${m.root}' was not resolved for ${addonId}`)

    await applyDepChildren(m, noteMap, depExportsMap)
    await applyLabels(m.labels || [], noteMap)
    await applyRelations(m.relations || [], noteMap, depExportsMap)
    await pruneRemovedNotes(m, addonId)

    const storedManifest = stripManifestForStorage(m)

    if (!database.installedAddons[repoId]) database.installedAddons[repoId] = {}
    if (!wasInstalled) {
        // Preserve any persistence data surviving from a previous install of
        // this same addonId (e.g. it was uninstalled but had persisted
        // notes) — everything else here is meant to start fresh.
        const priorPersistence = database.installedAddons[repoId][addonId]?.persistence
        database.installedAddons[repoId][addonId] = {
            installedVersion: manifest.latestVersion,
            manuallyInstalled: manual || isSelf,
            enabled: isSelf,
            manifest: storedManifest,
            ...(priorPersistence ? { persistence: priorPersistence } : {})
        }
    } else {
        // Merge in place — never resets manuallyInstalled/enabled/persistence.
        const rec = database.installedAddons[repoId][addonId]
        rec.installedVersion = manifest.latestVersion
        rec.manifest = storedManifest
        // Must be explicit: this used to be an implicit side effect of
        // installAddon replacing the whole record object on every reinstall.
        rec.updateAvailable = false
        if (manual && !rec.manuallyInstalled) rec.manuallyInstalled = true
    }
    await saveDatabase(database)

    if (!wasInstalled && !isSelf) await enableAddon(repoId, addonId, false)
    await connectAddonPersistence(repoId, addonId)
}

// Offline structural repair: reconciles an already-installed addon's notes
// against its own *locally stored* manifest snapshot — never a network
// fetch. Fixes missing/stale parent-child branches, labels, and relations;
// never touches note content, and never creates a note that's been fully
// deleted (there's no content stored locally to rebuild it with — that gets
// reported as an issue instead, fixable only via an actual sync). Distinct
// from syncAddon: sync reconciles against whatever's newly available
// upstream and can create notes from scratch; repair only ever restores what
// should already be there, using nothing but what's already in the Database.
// Returns the same { repoId, addonId, message } issue shape as
// validateDatabase for whatever it couldn't fix.
async function repairAddon(repoId, addonId) {
    if (!repoId.trim() || !addonId.trim()) return []

    const database = await loadDatabase()
    const addon = (database.installedAddons[repoId] || {})[addonId]
    if (!addon?.manifest) {
        return [{ repoId, addonId, message: "no locally stored manifest to repair from — sync this addon first" }]
    }

    const m = addon.manifest
    const isSelf = addonId === TAM_ID
    const issues = []

    const noteMap = {}
    for (const noteDef of m.notes) {
        const realNoteId = await resolveStoredNoteId(addonId, noteDef.id)
        if (realNoteId) {
            noteMap[noteDef.id] = realNoteId
        } else {
            issues.push({ repoId, addonId, message: `note '${noteDef.id}' is missing and can't be repaired offline — use Update instead` })
        }
    }
    if (!noteMap[m.root]) return issues

    const addonRootNoteId = isSelf ? null : await getAddonRootNoteId()
    await reconcileNoteParenting(m, addonId, noteMap, addonRootNoteId, isSelf)

    const depExportsMap = new Map()
    for (const depAddonId of (m.dependencies || [])) {
        const dep = (database.installedAddons[repoId] || {})[depAddonId]
        if (!dep?.manifest) {
            issues.push({ repoId, addonId, message: `dependency '${depAddonId}' is not installed — some cross-addon links may be unrepaired` })
            continue
        }
        depExportsMap.set(depAddonId, dep.manifest.exports || {})
    }

    await applyDepChildren(m, noteMap, depExportsMap)
    await applyLabels(m.labels || [], noteMap)
    await applyRelations(m.relations || [], noteMap, depExportsMap)

    return issues
}

async function getPersistenceNoteId() {
    return await api.currentNote.getRelationValue(addonPersistenceLabel)
}

async function connectAddonPersistence(repoId, addonId) {
    const persistenceRoot = await getPersistenceNoteId()
    let database = await loadDatabase()

    const addonRecord = database.installedAddons[repoId][addonId]
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
    const outcome = await api.runOnBackend((addonNoteId, persistenceRoot, addonId, existingPersistRoot, existingNotes) => {
        const result = {}
        const toDelete = []
        let persistRoot = existingPersistRoot

        for (const noteId of api.getNote(addonNoteId).getSubtreeNoteIds()) {
            const note = api.getNote(noteId)
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
    }, [addonNoteId, persistenceRoot, addonId, existingPersistRoot, existingNotes])

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
// clears the stale reference. Run opportunistically from
// `updateRepositories` rather than needing its own UI trigger.
async function cleanupEmptyPersistenceRoots() {
    let database = await loadDatabase()
    let changed = false

    for (const [repoId, addons] of Object.entries(database.installedAddons || {})) {
        for (const [addonId, addonRecord] of Object.entries(addons || {})) {
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
                    delete database.installedAddons[repoId][addonId]
                }
            }
        }
    }

    if (changed) await saveDatabase(database)
}

// One-time-per-note backfill for addons installed before #TAMFILEID existed:
// tags every note already recorded in an addon's (now otherwise-unused)
// `noteMap` leftover from a previous install, so live TAMFILEID lookups work
// immediately without needing every addon reinstalled first. Only ever adds
// a label to a note that already exists — never creates, deletes, or moves
// anything, and never touches persistence data. Idempotent per note (skips
// anything already tagged), so an interrupted run just resumes correctly
// next time rather than being skipped wholesale. Run opportunistically from
// `updateRepositories`, same spot as `cleanupEmptyPersistenceRoots`.
async function backfillTamFileIds() {
    const database = await loadDatabase()

    for (const [, addons] of Object.entries(database.installedAddons || {})) {
        for (const [addonId, addonRecord] of Object.entries(addons || {})) {
            if (!addonRecord.installedVersion || !addonRecord.noteMap) continue

            const entries = Object.entries(addonRecord.noteMap).map(
                ([localId, realId]) => [realId, `${addonId}/${localId}`]
            )
            await api.runOnBackend((tamFileIdLabel, entries) => {
                for (const [noteId, tamFileId] of entries) {
                    const note = api.getNote(noteId)
                    if (!note || note.isDeleted) continue
                    if (note.hasLabel(tamFileIdLabel)) continue
                    note.setLabel(tamFileIdLabel, tamFileId)
                }
            }, [tamFileIdLabel, entries])
        }
    }
}

// Migration bridge: addons installed before this session's "store the
// manifest itself" redesign have their old flat fields (rootNoteId,
// settingsNoteId, dependencies, dependents) but no `.manifest` snapshot at
// all — there was nowhere to get one from until now. Best-effort backfill:
// fetch each such addon's current manifest (the only way to get one, since
// the old schema never stored one) and store its stripped structure. If the
// upstream manifest has changed since that addon was actually installed,
// this backfill reflects the newer structure rather than exactly what's
// installed — an unavoidable one-time approximation for pre-existing
// installs. From this point on the stored manifest is authoritative and
// immune to future upstream changes, same as everything synced from here on.
// Run opportunistically from updateRepositories, alongside the other
// migrations — naturally a no-op once every installed addon has been synced
// at least once under the new schema.
async function backfillInstalledManifests() {
    let database = await loadDatabase()
    let changed = false

    for (const [repoId, addons] of Object.entries(database.installedAddons || {})) {
        for (const [addonId, addon] of Object.entries(addons || {})) {
            if (!addon.installedVersion || addon.manifest) continue
            try {
                const manifest = await fetchManifest(repoId, addonId)
                const m = manifest.manifest ?? {
                    notes: [], children: [], relations: [], labels: [], root: null, dependencies: [], exports: {}
                }
                if (!m.root) continue
                addon.manifest = stripManifestForStorage(m)
                changed = true
            } catch (e) {
                // Best-effort — leave it for the next attempt.
            }
        }
    }

    if (changed) await saveDatabase(database)
}

async function deleteAddon(repoId, addonId) {
    if (!repoId.trim() || !addonId.trim()) return
    let database = await loadDatabase()
    const addonRecord = database.installedAddons[repoId][addonId]
    const rootNoteId = await resolveStoredNoteId(addonId, addonRecord.manifest?.root)
    if (rootNoteId) {
        await api.runOnBackend((noteId) => {
            api.getNote(noteId).deleteNote()
        }, [rootNoteId])
    }

    const persistence = addonRecord.persistence
    const hasPersistedData = persistence && (
        persistence.rootNote ||
        (persistence.persistenceNotes && Object.keys(persistence.persistenceNotes).length > 0)
    )

    if (hasPersistedData) {
        // Drop everything describing the now-deleted installed state, but
        // keep the persisted user data around — it must survive uninstall.
        database.installedAddons[repoId][addonId] = { persistence }
    } else {
        delete database.installedAddons[repoId][addonId]
        if (Object.keys(database.installedAddons[repoId]).length === 0) {
            delete database.installedAddons[repoId]
        }
    }
    await saveDatabase(database)
}

// The user-facing "uninstall" action. Unlike deleteAddon (the low-level
// primitive — just remove this one addon's own notes), this also recursively
// uninstalls any of its own dependencies that are now unused (getDependents
// finds nothing else still depending on them, now that addonId's own record
// is gone) and weren't installed directly by the user.
async function uninstallAddon(repoId, addonId) {
    if (!repoId.trim() || !addonId.trim()) return
    let database = await loadDatabase()
    const installed = (database.installedAddons[repoId] || {})[addonId]
    if (!installed?.installedVersion) return

    const dependencies = installed.manifest?.dependencies || []

    await deleteAddon(repoId, addonId)

    for (const depAddonId of dependencies) {
        database = await loadDatabase()
        const dep = (database.installedAddons[repoId] || {})[depAddonId]
        if (!dep) continue

        // dependents is never stored — recompute now that addonId's own
        // record is already gone, so it naturally no longer counts.
        const stillNeeded = getDependents(database, repoId, depAddonId).length > 0
        const depIsManual = dep.manuallyInstalled ?? true
        if (!depIsManual && !stillNeeded) {
            await uninstallAddon(repoId, depAddonId)
        }
    }
}

async function collectPendingPrompts(repoId, addonId, m) {
    let database = await loadDatabase()
    const persistenceNotes = database.installedAddons?.[repoId]?.[addonId]?.persistence?.persistenceNotes || {}

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
            title:       noteDef.title,
            persistedNoteId,
            newContent,
            currentContent
        })
    }
    return prompts
}

async function getPendingPrompts(repoId, addonId) {
    const database = await loadDatabase()
    return database.installedAddons?.[repoId]?.[addonId]?.persistence?.pendingPrompts || []
}

async function resolvePrompt(repoId, addonId, noteLocalId, useNew) {
    if (!useNew) return
    const database = await loadDatabase()
    const prompts = database.installedAddons?.[repoId]?.[addonId]?.persistence?.pendingPrompts || []
    const prompt = prompts.find(p => p.noteLocalId === noteLocalId)
    if (!prompt) return
    await api.runOnBackend((noteId, content) => {
        api.getNote(noteId).setContent(content)
    }, [prompt.persistedNoteId, prompt.newContent])
}

async function clearPendingPrompts(repoId, addonId) {
    let database = await loadDatabase()
    if (database.installedAddons?.[repoId]?.[addonId]?.persistence) {
        delete database.installedAddons[repoId][addonId].persistence.pendingPrompts
    }
    await saveDatabase(database)
}


async function enableAddon(repoId, addonId, enabled) {
    if (!repoId.trim() || !addonId.trim()) return
    let database = await loadDatabase()
    const addon = database.installedAddons[repoId][addonId]
    const rootNoteId = await resolveStoredNoteId(addonId, addon.manifest?.root)
    if (!rootNoteId) return
    await api.runOnBackend((noteId, enabled, addonLabels) => {
        const ids = api.getNote(noteId).getSubtreeNoteIds()
        for (const id of ids) {
            const note = api.getNote(id)
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
    }, [rootNoteId, enabled, addonLabels])
    database.installedAddons[repoId][addonId].enabled = enabled
    await saveDatabase(database)
}


// Validates the whole installed-addon graph against the real Trilium note
// tree: every declared dependency is actually installed, the stored
// manifest's root/settingsNote local ids still resolve to real notes, no two
// live notes claim the same #TAMFILEID (the one thing genuinely ambiguous to
// a live lookup — everything else here resolves by that label, so there's no
// separate cached id that could drift), and every live AddonData: relation
// in an addon's subtree still points at the persisted copy TAM thinks it
// does. There's no dependent-symmetry check — dependents is computed on
// demand (getDependents), never stored, so it can't go out of sync. Returns
// a flat list of { repoId, addonId, message } issues (empty if everything
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
        const dupRepoId = Object.entries(database.installedAddons || {})
            .find(([, addons]) => dupAddonId in (addons || {}))?.[0] || "unknown"
        issues.push({
            repoId: dupRepoId,
            addonId: dupAddonId,
            message: `TAMFILEID '${tamFileId}' is duplicated across notes ${noteIds.join(", ")}`
        })
    }

    for (const [repoId, addons] of Object.entries(database.installedAddons || {})) {
        for (const [addonId, addon] of Object.entries(addons || {})) {
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
                issues.push({ repoId, addonId, message })
            }

            if (!isInstalled) continue

            // Symmetry checks no longer apply — dependents is computed on
            // demand (getDependents), never stored, so there's nothing to
            // drift out of sync. Only a genuinely missing dependency is
            // worth reporting.
            for (const depAddonId of (manifest.dependencies || [])) {
                const dep = addons[depAddonId]
                if (!dep?.installedVersion) {
                    issues.push({ repoId, addonId, message: `depends on '${depAddonId}', which is not installed` })
                }
            }
        }
    }

    return issues
}


// Exports ---------------------------------------------------------------------
module.exports.addRepository      = addRepository
module.exports.getAllRepositories  = getAllRepositories
module.exports.updateRepositories  = updateRepositories
module.exports.deleteRepository   = deleteRepository
module.exports.syncAddon          = syncAddon
module.exports.repairAddon        = repairAddon
module.exports.deleteAddon        = deleteAddon
module.exports.uninstallAddon     = uninstallAddon
module.exports.enableAddon        = enableAddon
module.exports.getPendingPrompts  = getPendingPrompts
module.exports.resolvePrompt      = resolvePrompt
module.exports.clearPendingPrompts = clearPendingPrompts
module.exports.validateDatabase    = validateDatabase
