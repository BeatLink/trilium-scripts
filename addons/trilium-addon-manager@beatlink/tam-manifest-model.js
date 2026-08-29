// Pure manifest-shape helpers and shared constants: the one definition of what
// a manifest's notes[], children[] and source identities mean structurally.
// Required by lib-tam.js as a child note at runtime and by tamhelper.js
// straight from disk at build time, so the runtime and the toolchain read a
// manifest the same way by construction.
// Keep this file free of `api` and any other runtime-only global.

// Synthetic local ids for the per-addon anchor notes TAM itself owns (never declared by an addon's own manifest).
const addonAnchorRootLocalId = "__tamAddonRoot__"
const addonAnchorPersistenceLocalId = "__tamAddonPersistenceRoot__"

// The #iconClass TAM sets uniformly on every anchor note it synthesizes.
const anchorIconClass = "bx bx-customize"

// Badge color per addon `type`, shared by TAM's own UI and the catalog site.
const TYPE_COLORS = {
    widget: "#2563eb",
    theme: "#7c3aed",
    css: "#059669",
    script: "#d97706",
    library: "#0891b2",
    template: "#be185d",
    iconpack: "#c2410c"
}

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

// The inverse split: parent -> [children] edges.
function childEdges(children) {
    const childrenOf = {}
    for (const c of (children || [])) {
        if (!c.child) continue
        (childrenOf[c.parent] = childrenOf[c.parent] || []).push(c.child)
    }
    return childrenOf
}

function topologicalSort(noteIds, parentMap) {
    const idSet = new Set(noteIds)
    const result = []
    const visited = new Set()
    function visit(id) {
        if (visited.has(id)) return
        visited.add(id)
        const parentId = parentMap[id]
        if (parentId && idSet.has(parentId)) visit(parentId)
        result.push(id)
    }
    for (const id of noteIds) visit(id)
    return result
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
    const childrenOf = childEdges(m.children)
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

// The identity #TAMSOURCEURL records, and what two addons vendoring the same
// file are matched on. A published manifest supplies `sourceId` - the same file
// on its branch - because the sourceUrl it fetches from is pinned to one commit
// and so is a different string every publish. A renderAsHTML note has none: it
// stores a rendering, not the file that was fetched.
function sourceIdentityOf(noteDef) {
    if (noteDef.renderAsHTML || !noteDef.sourceUrl) return null
    return noteDef.sourceId || noteDef.sourceUrl
}

module.exports = {
    addonAnchorRootLocalId,
    addonAnchorPersistenceLocalId,
    anchorIconClass,
    TYPE_COLORS,
    buildParentMaps,
    childEdges,
    topologicalSort,
    normalizeManifest,
    persistentLocalIds,
    sourceIdentityOf
}
