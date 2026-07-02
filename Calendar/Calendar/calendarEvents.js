const {req, res} = api;

if (req.method == 'GET' ) {
    libCal.getCalendarEvents()
    const targetNoteId = api.currentNote.getRelationValue('targetNote');
    const targetNote = api.getNote(targetNoteId).getContent()
    res.status(200).send(targetNote);
}
else {
    res.send(400);
}