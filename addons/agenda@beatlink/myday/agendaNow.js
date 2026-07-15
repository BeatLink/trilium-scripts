const query = require("libAgendaQuery.js")

async function addTaskToAgendaNow(nowNoteId, taskNoteId, renderAsTodo) {
    api.runOnBackend((nowNoteId, taskNoteId, renderAsTodo) => {
        const taskNote = api.getNote(taskNoteId)
        const taskLink = `<a class="reference-link" href="#root/${taskNoteId}">${taskNote.title}</a>`

        const nowNote = api.getNote(nowNoteId)
        const nowNoteContent = nowNote.getContent()
        if (nowNoteContent.includes(taskLink)) return

        const todoListItem =
            `<ul class="todo-list"><li data-list-item-id="${api.randomString(32)}">` +
            `<label class="todo-list__label"><input type="checkbox" disabled="disabled">` +
            `<span class="todo-list__label__description">${taskLink}</span></label></li></ul>`
        const entry = renderAsTodo ? todoListItem : `<p>${taskLink}</p>`

        nowNote.setContent(nowNoteContent.concat(entry))
        nowNote.save()
    }, [nowNoteId, taskNoteId, renderAsTodo])
}

async function addDueTasksToAgendaNow(profileContext, constants, nowNoteId) {
    const taskIds = await query.getTaskList(profileContext)
    for (const taskId of taskIds) {
        const task = await api.getNote(taskId)
        const startDatetime = task.getLabelValue(constants.START_DATETIME_LABEL)
        const isDueNow = startDatetime && api.dayjs().isSame(startDatetime, "minute")
        if (isDueNow) {
            await addTaskToAgendaNow(nowNoteId, taskId, true)
        }
    }
}

module.exports = {
    addTaskToAgendaNow,
    addDueTasksToAgendaNow
}
