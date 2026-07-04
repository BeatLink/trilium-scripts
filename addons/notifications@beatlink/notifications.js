// libnotification is bundled as a child of this note — available as a global
const { sendNotification } = libnotification;

async function send_notification() {
    let enabled     = api.currentNote.getLabelValue("enabled")
    let earliest    = api.currentNote.getLabelValue("earliest")
    let dateLabel   = api.currentNote.getLabelValue("dateLabel")
    let reminderTime = Number(api.currentNote.getLabelValue("reminderTime"))

    if (enabled != "true") return;

    let notes = await api.searchForNotes(`#${dateLabel} != "" AND #${dateLabel} < TODAY+1 orderBy #${dateLabel}`)

    let now = api.dayjs()
    let filteredNotes = notes.filter((note) => {
        let date = api.dayjs(note.getLabelValue(dateLabel))
        return (date.isBefore(now, "minute") || date.isSame(now, "minute"))
    })

    if (filteredNotes.length > 0) {
        let final = filteredNotes[0];

        if (filteredNotes.length > 1) {
            final = filteredNotes.reduce(function (a, b) {
                let dateA = api.dayjs(a.getLabelValue(dateLabel))
                let dateB = api.dayjs(b.getLabelValue(dateLabel))
                if (dateA.isSame(dateB, "minute")) {
                    return earliest == "true" ? a : b
                } else if (dateA.isBefore(dateB, "minute")) {
                    return earliest == "true" ? a : b
                } else {
                    return earliest == "true" ? b : a
                }
            });
        }

        if (final) {
            await sendNotification(final.title, "", final.noteId);
        }
    }

    setTimeout(send_notification, reminderTime * 1000);
}

send_notification();
