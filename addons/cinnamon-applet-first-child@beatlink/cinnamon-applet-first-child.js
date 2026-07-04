const { loadSettings } = require("libSettings.js")

let schemaNoteId = api.currentNote.getRelationValue("schemaNote")
let settingsNoteId = api.currentNote.getRelationValue("settingsNote")
let configNoteId = api.getNote(settingsNoteId).getRelationValue("AddonData:config")

let settings = loadSettings(schemaNoteId, configNoteId)
let apiKey = settings.apiKey
let parentNoteId = settings.parentNoteId

if (api.req.method == 'POST' && api.req.body.api_key === apiKey) {

    if (api.req.body.action == "get_task") {
        let parentNote = api.getNote(parentNoteId)
        let notes = parentNote.getChildNotes()
        if (notes.length > 0) {
            api.res.status(201).json({text: notes[0].title, onclick_data: notes[0].noteId});
        } else {
            api.res.status(201).json({text: "", onclick_data: ""});
        }
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
