let apiKey = api.currentNote.getLabelValue("apiKey")
let inboxNoteId = api.currentNote.getRelationValue("inboxNote")

if (api.req.method == 'POST' && api.req.body.api_key === apiKey) {
    if (api.req.body.action == "get_inbox") {
        let inboxNote = api.getNote(inboxNoteId)
        let content = inboxNote.getContent()
        let first_line = content.slice(0, content.indexOf("</p>")).replace("<p>", "").replace("&nbsp;", "");
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
