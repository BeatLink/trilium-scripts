// libNotification.js is bundled as a child of this note
const { sendNotification } = require("libNotification.js");

async function send_notification() {

    let enabled = api.currentNote.getLabelValue("enabled")
    let earliest = api.currentNote.getLabelValue("earliest")
    let dateLabel = api.currentNote.getLabelValue("dateLabel")
    let reminderTime = Number(api.currentNote.getLabelValue("reminderTime"))

    // Quit if not enabled
    if (enabled != "true") {return}

    // Get Notes in the past
    let notes = await api.searchForNotes(`#${dateLabel} != "" AND #${dateLabel} < TODAY+1 orderBy #${dateLabel}`)


    // Filter out future notes
    let now = api.dayjs()
    let filteredNotes = notes.filter((note) => {
        let date = api.dayjs(note.getLabelValue(dateLabel))
        return (date.isBefore(now, "minute") || date.isSame(now, "minute"))
    })

    // Get the earliest/latest Note
    if (filteredNotes.length > 0) {

        let final = filteredNotes[0]

        if (filteredNotes.length > 1) {
            final = filteredNotes.reduce(function (a, b) {
                let dateA = api.dayjs(a.getLabelValue(dateLabel))
                let dateB = api.dayjs(b.getLabelValue(dateLabel))
                if (dateA.isSame(dateB, "minute")) {
                    return earliest == "true" ? a : b
                }
                else if (dateA.isBefore(dateB, "minute")) {
                    return earliest == "true" ? a : b
                } else {
                    return earliest == "true" ? b : a
                }
            })
        }

        // Send Notification
        if (final) {
            await sendNotification(final.title, "", final.noteId);
        }
    }

    setTimeout(send_notification, reminderTime * 1000);
}

send_notification()