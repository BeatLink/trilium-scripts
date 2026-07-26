// Settings access for agenda-structure@beatlink.
//
// This addon owns its own settings note (structureSchema.json /
// structureConfig.json) tagged #agendaStructureConfig.
//
// Two vocabularies drive provisioning and NEITHER is owned here, because both
// have another owner that also writes them:
//   - the AREA list comes from agenda@beatlink's `dimensions` registry
//     (#agendaConfig), the dimension flagged scaffoldsAreas.
//   - the TEMPLATE list comes from template-picker@beatlink's own registry
//     (#templatePickerConfig).
// A local copy of either would silently drift, so both are read cross-addon
// through getConfigIds() and degrade to "empty vocabulary" when the owning
// addon isn't installed — a Setup run then provisions only what it can.

// Resolve a settings-note anchor's schema/config note ids by label, the same
// discovery shape every addon in this repo uses. Returns null when the anchor
// (or either relation) is missing, so every caller degrades instead of throwing.
async function getConfigIds(anchorLabel) {
    const anchors = await api.searchForNotes(`#${anchorLabel}`)
    if (!anchors.length) return null
    const anchor = anchors[0]
    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null
    return { schemaNoteId, configNoteId }
}

// This addon's own settings note ids, for the SettingsForm on the editor page.
async function getStructureConfigIds() {
    return getConfigIds("agendaStructureConfig")
}

// agenda@beatlink's settings note ids, or null when agenda isn't installed.
// The `dimensions` registry lives there — see the header note above.
async function getAgendaConfigIds() {
    return getConfigIds("agendaConfig")
}

module.exports = {
    getConfigIds,
    getStructureConfigIds,
    getAgendaConfigIds
}
