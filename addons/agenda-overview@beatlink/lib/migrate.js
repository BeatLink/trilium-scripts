// === Trilium Code note ===
// Title: migrate.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by agendaSettings.jsx).
//
// A versioned config-transform pipeline for this addon's config note.
//
// Why this exists, given the schema already self-heals: a registry's `default`
// in schema.json is the *shipped* entry set, reconciled into every install on
// each read/write (see libsettings README "Shipped entries"), so ADDING a new
// dimension, sort, colour etc. to defaults reaches existing installs for free —
// no migration needed. What that mechanism CANNOT do is reshape data the user
// already owns: rename a stored key, move a value from one field to another,
// split one field into two, drop a field. Those are one-time transforms of the
// persisted config, and running them more than once would corrupt hand-edited
// data. This module gives them a home.
//
// Version storage: a plain note label `#agendaConfigVersion` on the config
// anchor note (the one tagged #agendaOverviewConfig), NOT a field inside
// config.json.
// config.json is loaded/saved through libsettings' schema-aware path, which
// rebuilds the persisted object from schema-declared keys only and would strip
// any bookkeeping key we tried to keep there. A note label sidesteps that
// entirely and is atomic to read/write.
//
// Migrations operate on the RAW persisted config object (the
// `{ entries, removedIds }`-wrapped registry shape that libsettings writes to
// config.json), never the merged runtime shape — the raw object is what is
// durable; the merged shape is derived and transient.

// The ordered migration list. Each step is { to, run } where `to` is the config
// version this step brings the install UP TO (strictly increasing, starting at
// 1), and `run(config)` mutates and returns the raw persisted config object.
//
// A step runs exactly once, only on installs whose stored version is below its
// `to`. Adding a step here and bumping LATEST_VERSION is the whole mechanism.
// A fresh install is stamped at LATEST_VERSION without running any step (its
// config is already in the current shape), so steps only ever touch configs
// written by an older agenda version.
//
// Rules for a `run`:
//   - Be defensive: config may be `{}` (fresh/empty) or missing the field you
//     target. Guard every access; never assume a shape.
//   - Be idempotent-safe anyway: the version gate already prevents re-runs, but
//     write steps that would be harmless if run twice where you can.
//   - Registry fields are stored wrapped: `config.<name> = { entries, removedIds }`.
//     `entries` is a map keyed by id; `removedIds` an array. Operate on those,
//     not on a flat map.
function registryOf(node) {
    if (!node || typeof node !== "object") return { entries: {}, removedIds: [] }
    const wrapped = node.entries || node.removedIds
    return {
        entries: (wrapped ? node.entries : node) || {},
        removedIds: (wrapped && node.removedIds) || []
    }
}

const DERIVED_PREFIX = "dim-"
const VARIANT_REGISTRIES = ["prefixes", "colors", "groupings", "filterGroups"]

// Merges `fields` into a registry entry, keeping whatever the user already
// stored there. Nested `children` merge one level deeper, since that is where
// the per-value deltas live.
function putEntry(registry, id, fields) {
    const existing = registry.entries[id] || {}
    const children = registryOf(existing.children)
    for (const [childId, childFields] of Object.entries(registryOf(fields.children).entries)) {
        children.entries[childId] = { ...(children.entries[childId] || {}), ...childFields }
    }
    for (const removed of registryOf(fields.children).removedIds) {
        if (!children.removedIds.includes(removed)) children.removedIds.push(removed)
    }
    registry.entries[id] = { ...existing, ...fields, children }
}

// 1 -> folds the `dimensions` registry into hand-written prefix/color/grouping/
// filter entries, one per dimension, keyed by the dimension's own id. The
// registry is gone from the schema, so its stored deltas would otherwise be
// dropped on the next save, taking a renamed value or a recoloured area with
// them. Shipped area/priority variants come from defaults.json now, so only the
// user's own edits have to be carried across - which is exactly what a stored
// delta holds.
//
// Filter groups are the one variant that was already persisted, under the
// derivation's `dim-` prefixed ids (that is where each child's `enabled` flag
// lived), so those entries are renamed onto the new ids first and the fold
// merges over them.
function foldDimensionsIntoVariants(config) {
    const registries = {}
    for (const name of VARIANT_REGISTRIES) {
        const registry = registryOf(config[name])
        for (const id of Object.keys(registry.entries)) {
            if (!id.startsWith(DERIVED_PREFIX)) continue
            const plainId = id.slice(DERIVED_PREFIX.length)
            registry.entries[plainId] = { ...registry.entries[plainId], ...registry.entries[id] }
            delete registry.entries[id]
        }
        registry.removedIds = registry.removedIds.map(id =>
            id.startsWith(DERIVED_PREFIX) ? id.slice(DERIVED_PREFIX.length) : id)
        registries[name] = registry
    }

    const profiles = registryOf(config.profiles)
    const firstProfileId = Object.keys(profiles.entries)[0] || "default"
    const dimensions = registryOf(config.dimensions)

    for (const [dimId, dim] of Object.entries(dimensions.entries)) {
        if (!dim || typeof dim !== "object") continue
        const values = registryOf(dim.values)
        const { name, label } = dim

        const shared = {}
        if (name !== undefined) shared.name = name
        if (label !== undefined) shared.label = label

        const children = { prefixes: {}, colors: {}, groupings: {}, filterGroups: {} }
        for (const [valueId, value] of Object.entries(values.entries)) {
            if (!value || typeof value !== "object") continue
            const prefix = {}, color = {}, grouping = {}, filter = {}
            if (value.key !== undefined) {
                prefix.labelValue = value.key
                color.labelValue = value.key
                grouping.labelValue = value.key
                if (label !== undefined) filter.rule = `#${label}='${value.key}'`
            }
            if (value.name !== undefined) {
                prefix.display = value.name
                grouping.display = value.name
                filter.name = value.name
            }
            if (value.color !== undefined) {
                color.display = value.color
                grouping.color = value.color
            }
            // A value with no filter child to merge into is new, so it needs a
            // complete entry; one that has a child keeps that child's `enabled`.
            const storedFilter = registryOf((registries.filterGroups.entries[dimId] || {}).children)
            if (!storedFilter.entries[valueId]) {
                filter.type = "search"
                filter.enabled = true
            }
            children.prefixes[valueId] = prefix
            children.colors[valueId] = color
            children.groupings[valueId] = grouping
            children.filterGroups[valueId] = filter
        }

        const childRemovals = values.removedIds
        putEntry(registries.prefixes, dimId, {
            ...shared, type: "label",
            children: { entries: children.prefixes, removedIds: childRemovals }
        })
        putEntry(registries.colors, dimId, {
            ...shared, type: "label",
            children: { entries: children.colors, removedIds: childRemovals }
        })
        putEntry(registries.groupings, dimId, {
            ...shared, type: "label",
            ...(name === undefined ? {} : { name: `By ${name}` }),
            children: { entries: children.groupings, removedIds: childRemovals }
        })
        putEntry(registries.filterGroups, dimId, {
            ...(name === undefined ? {} : { name }),
            profileId: (registries.filterGroups.entries[dimId] || {}).profileId || firstProfileId,
            children: { entries: children.filterGroups, removedIds: childRemovals }
        })
    }

    // A dimension the user deleted has to stay deleted in each variant.
    for (const name of VARIANT_REGISTRIES) {
        for (const id of dimensions.removedIds) {
            if (!registries[name].removedIds.includes(id)) registries[name].removedIds.push(id)
        }
        config[name] = registries[name]
    }

    // Profiles referenced the derived variants by their `dim-` prefixed ids.
    for (const profile of Object.values(profiles.entries)) {
        if (!profile || typeof profile !== "object") continue
        for (const key of ["prefixSelected", "colorSelected", "groupingSelected", "sortSelected"]) {
            const value = profile[key]
            if (typeof value === "string" && value.startsWith(DERIVED_PREFIX)) {
                profile[key] = value.slice(DERIVED_PREFIX.length)
            }
        }
    }
    config.profiles = profiles

    delete config.dimensions
    return config
}

const PICKER_IDS = ["area", "priority", "template"]
const PICKER_PREFIX = "picker-"

// 2 -> repoints an install at the entries the pickers now generate. Area,
// priority and template stopped being shipped entries: whichever pickers are
// installed stand their own up at `picker-<source>`, per profile for the search
// and filter groups. What was stored under the old ids was a delta against a
// copy of a vocabulary that lives in those addons, so the only parts worth
// carrying over are the ones the config genuinely owns - a profile's choice of
// entry, and a group's per-value on/off flags.
function repointAtDerivedEntries(config) {
    const profiles = registryOf(config.profiles)

    for (const profile of Object.values(profiles.entries)) {
        if (!profile || typeof profile !== "object") continue
        for (const key of ["prefixSelected", "colorSelected", "groupingSelected", "sortSelected"]) {
            if (PICKER_IDS.includes(profile[key])) profile[key] = PICKER_PREFIX + profile[key]
        }
    }
    config.profiles = profiles

    // The variants held nothing but a stale copy of the picker's vocabulary.
    for (const name of ["prefixes", "colors", "groupings"]) {
        const registry = registryOf(config[name])
        for (const id of PICKER_IDS) delete registry.entries[id]
        config[name] = registry
    }

    // The groups held the flags, which move onto the per-profile derived id.
    for (const name of ["searchGroups", "filterGroups"]) {
        const registry = registryOf(config[name])
        for (const id of PICKER_IDS) {
            const group = registry.entries[id]
            if (!group) continue
            const profileId = group.profileId || Object.keys(profiles.entries)[0] || "default"
            const moved = `${PICKER_PREFIX}${id}-${profileId}`
            registry.entries[moved] = { ...registry.entries[moved], ...group }
            delete registry.entries[id]
        }
        config[name] = registry
    }

    return config
}

const MIGRATIONS = [
    { to: 1, run: foldDimensionsIntoVariants },
    { to: 2, run: repointAtDerivedEntries }
]

// The version a fresh install (and an install past every migration) sits at.
// Equals the highest `to` in MIGRATIONS. Kept as its own constant so a fresh
// install can be stamped without iterating an empty list, and so a mismatch
// against MIGRATIONS is easy to eyeball.
const LATEST_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.to), 0)

const VERSION_LABEL = "agendaConfigVersion"

// Read the stored config version off the anchor note. Absent/blank/non-numeric
// reads as 0 (an install that predates this mechanism, or a note we haven't
// stamped yet) so every migration is considered pending. Runs on the backend —
// the closure may reference only `api`.
async function readVersion(anchorNoteId) {
    return api.runOnBackend((id) => {
        const note = api.getNote(id)
        if (!note) return 0
        const raw = note.getLabelValue("agendaConfigVersion")
        const n = parseInt(raw, 10)
        return Number.isFinite(n) ? n : 0
    }, [anchorNoteId])
}

// Stamp the anchor note's version label. Backend-only.
async function writeVersion(anchorNoteId, version) {
    await api.runOnBackend((id, value) => {
        const note = api.getNote(id)
        if (note) note.setLabel("agendaConfigVersion", value)
    }, [anchorNoteId, String(version)])
}

// Read + parse the raw persisted config JSON. Returns {} on empty/invalid so a
// step never has to defend against a parse throw. Backend-only read.
async function readConfig(configNoteId) {
    const content = await api.runOnBackend((id) => api.getNote(id).getContent(), [configNoteId])
    if (!content) return {}
    try {
        const parsed = JSON.parse(content)
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

// Serialize + write the raw persisted config JSON, matching the 4-space
// indentation libsettings writes with so diffs stay clean. Backend-only.
async function writeConfig(configNoteId, config) {
    await api.runOnBackend(
        (id, content) => api.getNote(id).setContent(content),
        [configNoteId, JSON.stringify(config, null, 4)]
    )
}

// Run every pending migration once, in order, then stamp the anchor at
// LATEST_VERSION. Idempotent across calls: a second call finds the version
// already current and does nothing. Called from getAgendaSettings() before it
// loads settings, so every widget and page sees migrated config.
//
// `anchorNoteId` is the #agendaOverviewConfig note (where the version label lives);
// `configNoteId` is its configNote target (the config.json note).
//
// A brand-new install (version 0, but its config was written by the current
// agenda so it's already in the current shape) is stamped straight to
// LATEST_VERSION without running steps — steps only reshape OLD data. We tell
// the two apart by the presence of any stored config: an empty config note is
// treated as fresh. A pre-mechanism install with real config reads as version
// 0 with non-empty config, so its steps run.
//
// Returns true if any migration ran (config was rewritten), false otherwise —
// callers can ignore it; it exists for tests/logging.
async function runMigrations(anchorNoteId, configNoteId) {
    const current = await readVersion(anchorNoteId)
    if (current >= LATEST_VERSION) return false

    const config = await readConfig(configNoteId)
    const isFresh = Object.keys(config).length === 0

    // Fresh install: nothing to reshape, just stamp it current.
    if (isFresh || current === LATEST_VERSION) {
        await writeVersion(anchorNoteId, LATEST_VERSION)
        return false
    }

    let migrated = config
    let ran = false
    for (const step of MIGRATIONS) {
        if (current < step.to) {
            migrated = step.run(migrated) || migrated
            ran = true
        }
    }

    if (ran) await writeConfig(configNoteId, migrated)
    await writeVersion(anchorNoteId, LATEST_VERSION)
    return ran
}

module.exports = {
    MIGRATIONS,
    LATEST_VERSION,
    runMigrations,
    // exported for tests / direct use
    readVersion,
    writeVersion,
    readConfig,
    writeConfig
}
