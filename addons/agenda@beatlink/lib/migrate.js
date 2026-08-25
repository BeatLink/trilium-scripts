// === Trilium Code note ===
// Title: migrate.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by agendaSettings.jsx).
//
// A versioned config-transform pipeline for agenda's shared config note.
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
// anchor note (the one tagged #agendaConfig), NOT a field inside config.json.
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
const MIGRATIONS = []

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
// `anchorNoteId` is the #agendaConfig note (where the version label lives);
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
