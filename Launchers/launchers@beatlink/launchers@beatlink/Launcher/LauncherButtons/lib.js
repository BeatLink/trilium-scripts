async function loadConfig(configNote) {
    const content = await api.runOnBackend(
        (id) => api.getNote(id).getContent(),
        [configNote.noteId]
    )
    return JSON.parse(content)
}

async function getActiveParents(noteId, parentIds) {
    return await api.runOnBackend(
        (noteId, parentIds) => {
            const parentNoteIds = api.getNote(noteId).getParentNotes().map(n => n.noteId)
            return parentIds.map(pid => parentNoteIds.includes(pid))
        },
        [noteId, parentIds]
    )
}

async function toggleLauncher(noteId, launcher, allLaunchers, exclusive, isActive) {
    await api.runAsyncOnBackendWithManualTransactionHandling(
        (noteId, launcher, allLaunchers, exclusive, isActive) => {
            if (isActive) {
                api.toggleNoteInParent(false, noteId, launcher.parentNoteId)
            } else {
                if (exclusive) {
                    for (const other of allLaunchers) {
                        if (other.parentNoteId !== launcher.parentNoteId) {
                            api.toggleNoteInParent(false, noteId, other.parentNoteId)
                        }
                    }
                }
                api.toggleNoteInParent(true, noteId, launcher.parentNoteId)
            }
        },
        [noteId, launcher, allLaunchers, exclusive, isActive]
    )
}

module.exports = { loadConfig, getActiveParents, toggleLauncher }
