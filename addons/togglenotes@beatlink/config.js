const CONFIG_RELATION = "AddonData:config"

async function loadConfig() {
    const configNote = await api.currentNote.getRelationTarget(CONFIG_RELATION)
    const content = await api.runOnBackend(
        (id) => api.getNote(id).getContent(),
        [configNote.noteId]
    )
    return { config: JSON.parse(content), configNoteId: configNote.noteId }
}

async function saveConfig(config) {
    const configNote = await api.currentNote.getRelationTarget(CONFIG_RELATION)
    await api.runOnBackend(
        (id, content) => api.getNote(id).setContent(content),
        [configNote.noteId, JSON.stringify(config, null, 4)]
    )
}

module.exports = { loadConfig, saveConfig }