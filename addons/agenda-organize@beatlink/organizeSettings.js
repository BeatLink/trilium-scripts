// Settings access for organize@beatlink.
//
// Organize owns its own settings note (organizeSchema.json / organizeConfig.json)
// tagged #agendaOrganizeConfig: the Organize Note picker, the four quick-times and
// the `dimensions` classification registry its triage queues assign from
// (dimensions.js reads that one). No setting is read from another addon's config
// note; agenda-overview@beatlink keeps its own separate dimensions registry for the
// Overview's derived display elements.
//
// The Inbox is NOT read from config — organize.js finds it by its
// #agendaOrganizeSpecial=inbox label, which this addon provisions itself.

const { loadSettings } = require("libSettingsUI.jsx")

// Resolve a settings-note anchor's schema/config note ids by label, the same
// discovery shape every addon in this repo uses. Returns null when the anchor
// (or either relation) is missing.
async function getConfigIds(anchorLabel) {
    const anchors = await api.searchForNotes(`#${anchorLabel}`)
    if (!anchors.length) return null
    const anchor = anchors[0]
    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null
    return { schemaNoteId, configNoteId }
}

// Organize's own settings note ids, for panels that hand them to a SettingsForm.
async function getOrganizeConfigIds() {
    return getConfigIds("agendaOrganizeConfig")
}

const TIME_DEFAULTS = {
    morning: "08:00",
    noon: "12:00",
    evening: "17:00",
    night: "20:00"
}

// Organize's own settings, with the shipped defaults substituted for anything
// unresolvable (a fresh install, or libsettings absent).
async function getOrganizeSettings() {
    const ids = await getOrganizeConfigIds()
    if (!ids) return { schemaNoteId: "", configNoteId: "", organizeNoteId: "", times: { ...TIME_DEFAULTS } }

    const values = await loadSettings(ids.schemaNoteId, ids.configNoteId)
    return {
        schemaNoteId: ids.schemaNoteId,
        configNoteId: ids.configNoteId,
        organizeNoteId: values.organizeNoteId || "",
        times: {
            morning: values.morningTime || TIME_DEFAULTS.morning,
            noon: values.noonTime || TIME_DEFAULTS.noon,
            evening: values.eveningTime || TIME_DEFAULTS.evening,
            night: values.nightTime || TIME_DEFAULTS.night
        }
    }
}

// The quick-times the start-date queue's Morning/Noon/Evening/Night buttons set.
// Never throws — falls back to the defaults so triage keeps working.
async function getTimeSettings() {
    try {
        return (await getOrganizeSettings()).times
    } catch (e) {
        return { ...TIME_DEFAULTS }
    }
}

module.exports = {
    getConfigIds,
    getOrganizeConfigIds,
    getOrganizeSettings,
    getTimeSettings,
    TIME_DEFAULTS
}
