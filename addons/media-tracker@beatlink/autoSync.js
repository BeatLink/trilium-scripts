/*
 * media-tracker@beatlink — scheduled import.
 *
 * Runs hourly (#run=hourly) and imports from Stremio and/or Trakt if enough time
 * has passed since the last run. Trilium has no sub-hourly scheduling, so the
 * interval is enforced here rather than by the trigger: the script wakes every
 * hour and returns immediately unless `autoSyncHours` has elapsed.
 *
 * Imports go through the same additive path as the manual buttons, so a
 * scheduled run can only add and update titles -- it never removes anything, and
 * never writes to Stremio or Trakt.
 *
 * The importers themselves are required from mediaTrackerBackend.js rather than
 * duplicated, so a scheduled import behaves identically to pressing the button.
 */

const { loadSettings, saveSettings } = require("libSettings.js")
const { importStremio, importTrakt } = require("mediaTrackerBackend.js")

// The settings note is found the same way the widget finds it: via the addon's
// own #mediaTrackerConfig marker, since a scheduled script has no currentNote
// relations pointing at it.
function resolveSettingsNotes() {
    const settingsNote = api.getNoteWithLabel("mediaTrackerConfig")
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
    const wantStremio = settings.autoSyncStremio === true && !!settings.stremioAuthKey
    const wantTrakt = settings.autoSyncTrakt === true && !!settings.traktAccessToken
    if (!wantStremio && !wantTrakt) return

    // A missing or unparseable timestamp yields Infinity, so the first run after
    // enabling happens immediately rather than waiting a full interval.
    const interval = Number(settings.autoSyncHours) || 6
    if (hoursSince(settings.autoSyncLastRun) < interval) return

    const parts = []

    const sources = [
        wantStremio && ["Stremio", importStremio],
        wantTrakt && ["Trakt", importTrakt]
    ].filter(Boolean)

    for (const [label, importer] of sources) {
        try {
            const result = await importer(settings)
            parts.push(`${label}: ${result.added} added, ${result.updated} updated`)
        } catch (e) {
            // One source failing must not stop the other, and must not prevent
            // the timestamp being written -- otherwise a persistently broken
            // source would retry every hour forever.
            parts.push(`${label} failed: ${e.message}`)
        }
    }

    // Re-read before writing: an import may have persisted tokens of its own
    // (Trakt refresh, Stremio auth), and a stale copy would clobber them.
    const latest = loadSettings(notes.schemaNoteId, notes.configNoteId)
    latest.autoSyncLastRun = new Date().toISOString()
    latest.autoSyncLastResult = `${new Date().toISOString().slice(0, 16).replace("T", " ")} — `
        + parts.join(" · ")
    saveSettings(notes.schemaNoteId, notes.configNoteId, latest)
}

run()
