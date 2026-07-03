/*
    This script is designed to be used with the Trilium API Cinnamon panel applet

    Setup Instructions
    Paste the following in a JS Backend Script Note
    Add the label #customRequestHandler=agenda_panel
    Add the Label #apiKey=<RANDOM STRING HERE>
    Add the label #dateLabel with the value being the label used to store due dates for tasks
    Add the label #taskOrder with the value being either earliest or latest. Earliest fetches the note with the earliest date time indicated by #dateLabel and vice versa
    
    Install the Trilium API cinnamon panel applet
    On the api settings tab
    Set the API endpoint to agenda_panel (same as the #customRequestHandler label above)
    Set the API key to the random string you created (same as the #apiKey label above)
    Set the fetch action to get_task
    Set the click action to open_task
*/

let apiKey = api.currentNote.getLabelValue("apiKey")
let dateLabel = api.currentNote.getLabelValue("dateLabel")
let taskOrder = api.currentNote.getLabelValue("taskOrder")

if (api.req.method == 'POST' && api.req.body.api_key === apiKey) {

    if (api.req.body.action == "get_task") {
        let earliest = taskOrder == "earliest" ? true : false
        // Get Notes in the past
        let notes = api.searchForNotes(`#${dateLabel} != "" AND #${dateLabel} < TODAY+1 orderBy 	#${dateLabel}`)

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