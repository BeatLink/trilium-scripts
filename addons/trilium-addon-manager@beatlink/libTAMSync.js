// The install/update entry point (syncAddon) and everything only it needs: dependency
// resolution/recording, and the promptOnUpdate queue bookkeeping tied to a sync.

const { TAM_ID, loadDatabase, saveDatabase, getAddonRootNoteId } = require("libTAMDatabase.js")
const { fetchManifest } = require("libTAMNetwork.js")
const { normalizeManifest, stripManifestForStorage, dependencyId, resolveDependencyUrl, computeLocalClosure, applyLabels } = require("libTAMManifestUtils.js")
const { resolveNotes, pruneRemovedNotes } = require("libTAMNoteResolver.js")
const { enableAddon } = require("libTAMLifecycle.js")
const { connectAddonPersistence } = require("libTAMPersistence.js")

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

module.exports.syncAddon = syncAddon
module.exports.installByUrl = installByUrl
module.exports.getPendingPrompts = getPendingPrompts
module.exports.resolvePrompt = resolvePrompt
module.exports.clearPendingPrompts = clearPendingPrompts
