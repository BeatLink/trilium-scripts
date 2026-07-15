const query = require("libAgendaQuery.js")

async function addTaskToAgendaNow(nowNoteId, noteId, todoEnabled) {
    api.runOnBackend((nowNoteId, currentNoteId, todoEnabled) => {
        const currentNote = api.getNote(currentNoteId)
        let currentNoteString = `<a class="reference-link" href="#root/${currentNoteId}">${currentNote.title}</a>`
        const nowNote = api.getNote(nowNoteId)
        const nowNoteContent = nowNote.getContent()

        if (!nowNoteContent.includes(currentNoteString)){
            if (todoEnabled) {
                currentNoteString = `<ul class="todo-list"><li data-list-item-id="${api.randomString(32)}"><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description">${currentNoteString}</span></label></li></ul>`
            } else {
                currentNoteString = `<p>${currentNoteString}</p>`
            }
            const newNoteContent = nowNoteContent.concat(currentNoteString)
            nowNote.setContent(newNoteContent)
            nowNote.save()
        }
    }, [nowNoteId, noteId, todoEnabled])
}

async function addDueTasksToAgendaNow(profileContext, constants, nowNoteId){
    const taskList = await query.getTaskList(profileContext)
    for (const taskId of taskList){
        const task = await api.getNote(taskId)
        const startDate = task.getLabelValue(constants.START_DATETIME_LABEL)
        if (startDate) {
            if (api.dayjs().isSame(startDate, "minute")) {
                await addTaskToAgendaNow(nowNoteId, taskId, true)
            }
        }
    }
}

module.exports = {
    addTaskToAgendaNow,
    addDueTasksToAgendaNow
}
