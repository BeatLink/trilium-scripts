const { loadConfig } = require("config.js")

async function getActiveParents(noteId, parentIds) {
    return await api.runOnBackend(
        (noteId, parentIds) => {
            const parentNoteIds = api.getNote(noteId).getParentNotes().map(n => n.noteId)
            return parentIds.map(pid => parentNoteIds.includes(pid))
        },
        [noteId, parentIds]
    )
}

async function getLauncherInfo(parentIds) {
    return await api.runOnBackend(
        (parentIds) => parentIds.map(id => {
            const note = api.getNote(id)
            return {
                parentNoteId: id,
                label: note.title,
                icon: note.getLabelValue("iconClass") || "bx bx-star"
            }
        }),
        [parentIds]
    )
}

async function toggleLauncher(noteId, launcher, allLaunchers, exclusive, isActive) {
    await api.runOnBackend(
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

module.exports = { loadConfig, getActiveParents, getLauncherInfo, toggleLauncher }