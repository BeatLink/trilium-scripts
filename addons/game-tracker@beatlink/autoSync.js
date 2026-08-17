/*
 * game-tracker@beatlink — scheduled import.
 *
 * Runs hourly (#run=hourly) and imports from Steam if enough time has passed
 * since the last run. Trilium has no sub-hourly scheduling, so the interval is
 * enforced here rather than by the trigger: the script wakes every hour and
 * returns immediately unless `autoSyncHours` has elapsed.
 *
 * Imports go through the same additive path as the manual button, so a scheduled
 * run can only add and update games -- it never removes anything, and never
 * writes to Steam or IGDB.
 *
 * The importer itself is required from gameTrackerBackend.js rather than
 * duplicated, so a scheduled import behaves identically to pressing the button.
 */

const { loadSettings, saveSettings } = require("libSettings.js")
const { importSteam } = require("gameTrackerBackend.js")

// The settings note is found the same way the widget finds it: via the addon's
// own #gameTrackerConfig marker, since a scheduled script has no currentNote
// relations pointing at it.
function resolveSettingsNotes() {
    const settingsNote = api.getNoteWithLabel("gameTrackerConfig")
    if (!settingsNote) return null
    const schemaNoteId = settingsNote.getRelationValue("schemaNote")
    const configNoteId = settingsNote.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null
    return { schemaNoteId, configNoteId }
}

function hoursSince(iso) {
    if (!iso) return Infinity
    const then = Date.parse(iso)
    if (!Number.isFinite(then)) return Infinity
    return (Date.now() - then) / 3600000
}

async function run() {
    const notes = resolveSettingsNotes()
    if (!notes) return

    const settings = loadSettings(notes.schemaNoteId, notes.configNoteId)
    const wantSteam = settings.autoSyncSteam === true
        && !!settings.steamApiKey && !!settings.steamId
    if (!wantSteam) return

    // A missing or unparseable timestamp yields Infinity, so the first run after
    // enabling happens immediately rather than waiting a full interval.
    const interval = Number(settings.autoSyncHours) || 6
    if (hoursSince(settings.autoSyncLastRun) < interval) return

    const parts = []
    try {
        const result = await importSteam(settings)
        parts.push(`Steam: ${result.added} added, ${result.updated} updated`)
    } catch (e) {
        // A failure must not prevent the timestamp being written -- otherwise a
        // persistently broken source would retry every hour forever.
        parts.push(`Steam failed: ${e.message}`)
    }

    // Re-read before writing: the import may have persisted an IGDB token of its
    // own, and a stale copy would clobber it.
    const latest = loadSettings(notes.schemaNoteId, notes.configNoteId)
    latest.autoSyncLastRun = new Date().toISOString()
    latest.autoSyncLastResult = `${new Date().toISOString().slice(0, 16).replace("T", " ")} — `
        + parts.join(" · ")
    saveSettings(notes.schemaNoteId, notes.configNoteId, latest)
}

run()
