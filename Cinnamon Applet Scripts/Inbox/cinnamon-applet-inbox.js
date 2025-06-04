/*
    This script is designed to be used with the Trilium API Cinnamon panel applet

    Setup Instructions
    Paste the following in a JS Backend Script Note
    Add the label #customRequestHandler=inboxPanel
    Add the Label #apiKey=<RANDOM STRING HERE>
    Add the relationship ~inboxNote pointing to the inbox note

    Install the Trilium API cinnamon panel applet
    On the api settings tab
    Set the API endpoint to inboxPanel (same as the #customRequestHandler label above)
    Set the API key to the random string you created (same as the #apiKey label above)
    Set the fetch action to get_inbox
    Set the click action to open_inbox
*/

let apiKey = api.currentNote.getLabelValue("apiKey")
let inboxNoteId = api.currentNote.getRelationValue("inboxNote")

if (api.req.method == 'POST' && api.req.body.api_key === apiKey) {
    if (api.req.body.action == "get_inbox") {
        let inboxNote = api.getNote(inboxNoteId)
        let content = inboxNote.getContent()
        let first_line = content.slice(0, content.indexOf("</p>")).replace("<p>", "");
        api.res.status(200).json({text: first_line, onclick_data: inboxNoteId});
    } else if (api.req.body.action == "open_inbox") {
        api.runOnFrontend((noteID) => {
	    	api.activateNote(noteID)
        }, [api.req.body.onclick_data]);
        api.res.status(200).json({"noteActivated": "true"});
    }
}
else {
    api.res.send(400);
}