// Pure manifest-shape helpers: parsing/normalizing a fetched manifest document, computing
// parent/dependency relationships, and resolving a stored local id to a live note id.
// resolveStoredNoteId/applyLabels are the only functions here that touch the note tree.

const { tamFileIdLabel } = require("libTAMDatabase.js")

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

module.exports.buildParentMaps = buildParentMaps
module.exports.topologicalSort = topologicalSort
module.exports.stripManifestForStorage = stripManifestForStorage
module.exports.dependencyId = dependencyId
module.exports.getDependents = getDependents
module.exports.resolveDependencyUrl = resolveDependencyUrl
module.exports.resolveStoredNoteId = resolveStoredNoteId
module.exports.parseInheritableName = parseInheritableName
module.exports.applyLabels = applyLabels
module.exports.normalizeManifest = normalizeManifest
module.exports.computeLocalClosure = computeLocalClosure
