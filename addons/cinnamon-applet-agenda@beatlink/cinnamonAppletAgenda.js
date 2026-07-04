let configNoteId = api.currentNote.getRelationValue("AddonData:config")
let config = JSON.parse(api.getNote(configNoteId).getContent())
let apiKey = config.apiKey
let dateLabel = config.dateLabel
let taskOrder = config.taskOrder

if (api.req.method == 'POST' && api.req.body.api_key === apiKey) {

    if (api.req.body.action == "get_task") {
        let earliest = taskOrder == "earliest" ? true : false
        // Get Notes in the past
        let notes = api.searchForNotes(`#${dateLabel} != "" AND #${dateLabel} < TODAY+1 orderBy #${dateLabel}`)

        // Filter out future notes
        let now = api.dayjs()
        let filteredNotes = notes.filter((note)=>{
            let date = api.dayjs(note.getLabelValue(dateLabel))
            return (date.isBefore(now, "minute") || date.isSame(now, "minute"))
        })

        // Get the earliest/latest Note
        let final = null
        if (filteredNotes.length > 0) {
            final = filteredNotes[0];
            if (filteredNotes.length > 1) {
                final = filteredNotes.reduce(function (a, b) {
                    let dateA = api.dayjs(a.getLabelValue(dateLabel))
                    let dateB = api.dayjs(b.getLabelValue(dateLabel))
                    if (dateA.isSame(dateB, "minute")){
                        return earliest == true ? a : b
                    }
                    else if (dateA.isBefore(dateB, "minute")) {
                        return earliest == true ? a : b
                    } else {
                        return earliest == true ? b : a
                    }
                });
            }
        }
        api.res.status(201).json({text: final.title, onclick_data: final.noteId});
    } else if (api.req.body.action == "open_task") {
        api.runOnFrontend((noteID) => {
            api.activateNote(noteID)
        }, [api.req.body.onclick_data]);
        api.res.status(200).json({"noteActivated": "true"});
    }
}
else {
    api.res.send(400);
}
